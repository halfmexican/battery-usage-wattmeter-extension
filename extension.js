import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import {panel} from 'resource:///org/gnome/shell/ui/main.js';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');

const BATTERY_PATHS = [
    '/sys/class/power_supply/BAT0/',
    '/sys/class/power_supply/BAT1/',
    '/sys/class/power_supply/BAT2/',
    '/sys/class/power_supply/sbs-5-000b/',
    '/sys/class/power_supply/macsmc-battery/',
    '/sys/class/power_supply/qcom-battmgr-bat/',
];

const MAX_RETRIES = 5;
const RETRY_DELAY = 2;
const MIN_INTERVAL = 1;
const AVG_BUFFER_SIZE = 10;

async function readFileSafely(filePath) {
    try {
        const file = Gio.File.new_for_path(filePath);
        const [contents] = await file.load_contents_async(null);
        return new TextDecoder().decode(contents);
    } catch (e) {
        if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
            console.debug(`[wattmeter] Failed to read ${filePath}: ${e.message}`);

        return null;
    }
}

// Resolves the settings value to a usable battery. `battery` is 0 for
// automatic detection, or a 1-based index into BATTERY_PATHS.
async function findBattery(batteryIndex) {
    const candidates = batteryIndex === 0
        ? BATTERY_PATHS
        : [BATTERY_PATHS[batteryIndex - 1]];

    for (const path of candidates) {
        if (!path)
            continue;

        const status = await readFileSafely(`${path}status`);
        if (status === null)
            continue;

        const powerNow = await readFileSafely(`${path}power_now`);
        return {path, hasPowerNow: powerNow !== null};
    }

    return {path: null, hasPowerNow: false};
}

const BatLabelIndicator = GObject.registerClass(
class BatLabelIndicator extends St.Label {
    constructor(settings) {
        super({
            text: _('Calculating…'),
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._settings = settings;
        this._timeoutId = null;
        this._battery = {path: null, hasPowerNow: false};
        this._powerBuffer = [];

        this._settings.connectObject(
            'changed::battery', () => this._onBatteryChanged(),
            'changed::interval', () => this._restartTimer(),
            'changed::combine-batteries', () => this._sync(),
            'changed::hide-na', () => this._sync(),
            'changed::show-minus-sign', () => this._sync(),
            'changed::pad-single-digit', () => this._sync(),
            'changed::show-decimal', () => this._sync(),
            'changed::show-time-remaining', () => this._sync(),
            this
        );

        this._sync();
        this._restartTimer();
    }

    async _read(path) {
        const raw = await readFileSafely(path);
        if (raw === null)
            return null;

        const value = parseFloat(raw);
        return Number.isFinite(value) ? value / 1000000 : null;
    }

    async _powerAt(path, hasPowerNow) {
        if (hasPowerNow)
            return this._read(`${path}power_now`);

        const current = await this._read(`${path}current_now`);
        const voltage = await this._read(`${path}voltage_now`);

        if (current === null || voltage === null)
            return null;

        return current * voltage;
    }

    async _getRawPower() {
        if (!this._settings.get_boolean('combine-batteries')) {
            if (!this._battery.path)
                return null;

            return this._powerAt(this._battery.path, this._battery.hasPowerNow);
        }

        let total = null;
        const results = await Promise.all(BATTERY_PATHS.map(async path => {
            if (!path)
                return null;

            const status = await readFileSafely(`${path}status`);
            if (status === null)
                return null;

            const hasPowerNow = (await readFileSafely(`${path}power_now`)) !== null;
            return this._powerAt(path, hasPowerNow);
        }));

        for (const reading of results) {
            if (reading !== null)
                total = (total ?? 0) + reading;
        }

        return total;
    }

    async _getPower() {
        const raw = await this._getRawPower();
        if (raw === null)
            return null;

        this._powerBuffer.push(raw);
        if (this._powerBuffer.length > AVG_BUFFER_SIZE)
            this._powerBuffer.shift();

        const sum = this._powerBuffer.reduce((a, b) => a + b, 0);
        return sum / this._powerBuffer.length;
    }
    // Power draw formatted for display, or null if it cannot be read.
    async _meas() {
        const power = await this._getPower();
        if (power === null)
            return null;

        let value;
        if (this._settings.get_boolean('show-decimal'))
            value = Math.abs(power).toFixed(1);
        else
            value = String(Math.round(Math.abs(power)));

        return this._settings.get_boolean('pad-single-digit')
            ? value.padStart(2, '0')
            : value;
    }

    async _energyAt(path, key) {
        const energyKey = key === 'now' ? 'energy_now' : 'energy_full';
        const chargeKey = key === 'now' ? 'charge_now' : 'charge_full';

        let energy = await this._read(`${path}${energyKey}`);
        if (energy !== null)
            return energy;

        const charge = await this._read(`${path}${chargeKey}`);
        const voltage = await this._read(`${path}voltage_now`);
        if (charge !== null && voltage !== null)
            return charge * voltage;

        return null;
    }

    async _getTimeRemaining(status) {
        const power = await this._getPower();
        if (!power || power === 0)
            return '';

        const draw = Math.abs(power);
        let energyNow = null;
        let energyFull = null;

        if (this._settings.get_boolean('combine-batteries')) {
            let totalNow = null;
            let totalFull = null;

            const results = await Promise.all(BATTERY_PATHS.map(async path => {
                if (!path) return null;
                const pStatus = await readFileSafely(`${path}status`);
                if (pStatus === null) return null;

                return {
                    now: await this._energyAt(path, 'now'),
                    full: status.includes('Charging') ? await this._energyAt(path, 'full') : null
                };
            }));

            for (const reading of results) {
                if (reading !== null) {
                    if (reading.now !== null) totalNow = (totalNow ?? 0) + reading.now;
                    if (reading.full !== null) totalFull = (totalFull ?? 0) + reading.full;
                }
            }
            energyNow = totalNow;
            energyFull = totalFull;
        } else {
            if (!this._battery.path) return '';
            energyNow = await this._energyAt(this._battery.path, 'now');
            if (status.includes('Charging'))
                energyFull = await this._energyAt(this._battery.path, 'full');
        }

        let hours = null;
        if (status.includes('Discharging') && energyNow !== null) {
            hours = energyNow / draw;
        } else if (status.includes('Charging') && energyNow !== null && energyFull !== null) {
            hours = (energyFull - energyNow) / draw;
        }

        if (hours !== null && hours > 0) {
            let m = Math.round(hours * 60);
            const h = Math.floor(m / 60);
            m = m % 60;
            return h > 0 ? ` ~${h}:${String(m).padStart(2, '0')}` : ` ~${m}m`;
        }

        return '';
    }

    async _getBatteryStatus() {
        const status = (await readFileSafely(`${this._battery.path}status`)) ?? 'Unknown';
        const naText = this._settings.get_boolean('hide-na') ? '' : _(' N/A ');

        if (status.includes('Full'))
            return '';

        if (status.includes('Unknown'))
            return _(' ? ');

        const powerDraw = await this._meas();
        if (powerDraw === null)
            return naText;

        let timeStr = '';
        if (this._settings.get_boolean('show-time-remaining'))
            timeStr = await this._getTimeRemaining(status);

        if (status.includes('Charging'))
            return _(' +%s W%s ').format(powerDraw, timeStr);

        if (status.includes('Discharging')) {
            return this._settings.get_boolean('show-minus-sign')
                ? _(' -%s W%s ').format(powerDraw, timeStr)
                : _(' %s W%s ').format(powerDraw, timeStr);
        }

        return naText;
    }

    async _onBatteryChanged() {
        this._battery = await findBattery(this._settings.get_int('battery'));
        this._powerBuffer = [];
        this._sync();
    }

    async _sync() {
        if (!this._settings)
            return;
        // Re-probe when nothing was found yet: sysfs entries can appear
        // late, and batteries can be hot-plugged.
        if (!this._battery.path)
            this._battery = await findBattery(this._settings.get_int('battery'));

        this.text = this._battery.path
            ? await this._getBatteryStatus()
            : ' ⚠ ';
    }

    _restartTimer() {
        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = null;
        }

        const interval = Math.max(MIN_INTERVAL, this._settings.get_int('interval'));
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, interval, () => {
            this._sync();
            return GLib.SOURCE_CONTINUE;
        });
    }

    destroy() {
        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = null;
        }

        this._settings.disconnectObject(this);
        this._settings = null;
        this._powerBuffer = null;

        super.destroy();
    }
});

export default class WattmeterExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._retries = 0;
        this._retryId = null;

        this._indicator = new BatLabelIndicator(this._settings);
        this._addToPanel();
    }

    _addToPanel() {
        const system = panel.statusArea.quickSettings?._system;

        if (system?._systemItem?._powerToggle) {
            system.add_child(this._indicator);
            return;
         }
        // The quick settings system indicator is not guaranteed to exist yet when
        // the extension is enabled during shell startup, so retry a few times.
	      if (this._retries >= MAX_RETRIES) {
	          console.warn(
	              `[wattmeter-extension] Failed to find power toggle indicator after ${MAX_RETRIES} retries.`
	          );
	          return;
	      }

        this._retries++;
        this._retryId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, RETRY_DELAY, () => {
            this._retryId = null;
            this._addToPanel();
            return GLib.SOURCE_REMOVE;
        });
    }

    disable() {
        if (this._retryId) {
            GLib.Source.remove(this._retryId);
            this._retryId = null;
        }

        this._indicator.destroy();
        this._indicator = null;
        this._settings = null;
    }
}
