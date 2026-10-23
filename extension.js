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

        this._settings.connectObject(
            'changed::battery', () => this._onBatteryChanged(),
            'changed::interval', () => this._restartTimer(),
            'changed::combine-batteries', () => this._sync(),
            'changed::hide-na', () => this._sync(),
            'changed::show-minus-sign', () => this._sync(),
            'changed::pad-single-digit', () => this._sync(),
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

    // Power draw of a single battery in Watts, or null if unavailable.
    async _powerAt(path, hasPowerNow) {
        if (hasPowerNow)
            return this._read(`${path}power_now`);

        const current = await this._read(`${path}current_now`);
        const voltage = await this._read(`${path}voltage_now`);

        if (current === null || voltage === null)
            return null;

        return current * voltage;
    }

    async _getPower() {
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

        if (status.includes('Charging'))
            return _(' +%s W ').format(powerDraw);

        if (status.includes('Discharging')) {
            return this._settings.get_boolean('show-minus-sign')
                ? _(' -%s W ').format(powerDraw)
                : _(' %s W ').format(powerDraw);
        }

        return naText;
    }

    async _onBatteryChanged() {
        this._battery = await findBattery(this._settings.get_int('battery'));
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
        const system = panel.statusArea.quickSettings._system;

        if (system._systemItem._powerToggle) {
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
