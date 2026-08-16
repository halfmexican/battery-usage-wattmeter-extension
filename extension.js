import {
    Extension,
    gettext as _,
} from 'resource:///org/gnome/shell/extensions/extension.js';
import {panel} from 'resource:///org/gnome/shell/ui/main.js';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

// Order matters: index 0 is the "Automatic" probe order, and index N-1 maps
// to entry N of the battery combo row in prefs.js.
const BATTERY_PATHS = [
    '/sys/class/power_supply/BAT0/',
    '/sys/class/power_supply/BAT1/',
    '/sys/class/power_supply/BAT2/',
    '/sys/class/power_supply/sbs-5-000b/',
    '/sys/class/power_supply/macsmc-battery/',
];

const SETTINGS_SCHEMA = 'org.gnome.shell.extensions.battery_usage_wattmeter';

const MAX_RETRIES = 5;
const RETRY_DELAY = 2;
const MIN_INTERVAL = 1;

// Reads a sysfs file, returning null when it does not exist or cannot be read.
function readFileSafely(filePath) {
    try {
        const file = Gio.File.new_for_path(filePath);
        const [ok, contents] = file.load_contents(null);
        return ok ? new TextDecoder().decode(contents) : null;
    } catch (e) {
        // Missing files are expected while probing, so keep this at debug level.
        console.debug(`[wattmeter-extension] cannot read ${filePath}: ${e.message}`);
        return null;
    }
}

// Resolves the settings value to a usable battery. `battery` is 0 for
// automatic detection, or a 1-based index into BATTERY_PATHS.
function findBattery(battery) {
    const candidates =
        battery === 0 ? BATTERY_PATHS : [BATTERY_PATHS[battery - 1]];

    for (const path of candidates) {
        if (!path || readFileSafely(`${path}status`) === null)
            continue;
        return {
            path,
            hasPowerNow: readFileSafely(`${path}power_now`) !== null,
        };
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
            this._battery = findBattery(this._settings.get_int('battery'));

            this._settings.connectObject(
                'changed::battery', () => this._onBatteryChanged(),
                'changed::interval', () => this._restartTimer(),
                'changed::combine-batteries', () => this._sync(),
                'changed::hide-na', () => this._sync(),
                'changed::show-minus-sign', () => this._sync(),
                'changed::pad-single-digit', () => this._sync(),
                this
            );
            this.connect('destroy', () => this._onDestroy());

            this._sync();
            this._restartTimer();
        }

        // Reads a sysfs value stored in micro-units, in base units.
        _readMicro(path) {
            const raw = readFileSafely(path);
            if (raw === null)
                return null;
            const value = parseFloat(raw);
            return Number.isFinite(value) ? value / 1000000 : null;
        }

        // Power draw of a single battery in Watts, or null if unavailable.
        _powerAt(path, hasPowerNow) {
            if (hasPowerNow)
                return this._readMicro(`${path}power_now`);

            const current = this._readMicro(`${path}current_now`);
            const voltage = this._readMicro(`${path}voltage_now`);
            if (current === null || voltage === null)
                return null;
            return current * voltage;
        }

        _getPower() {
            if (!this._settings.get_boolean('combine-batteries')) {
                return this._powerAt(
                    this._battery.path,
                    this._battery.hasPowerNow
                );
            }

            let total = null;
            for (const path of BATTERY_PATHS) {
                if (readFileSafely(`${path}status`) === null)
                    continue;
                const reading = this._powerAt(
                    path,
                    readFileSafely(`${path}power_now`) !== null
                );
                if (reading !== null)
                    total = (total ?? 0) + reading;
            }
            return total;
        }

        // Power draw formatted for display, or null if it cannot be read.
        _meas() {
            const power = this._getPower();
            if (power === null)
                return null;

            const value = String(Math.round(Math.abs(power)));
            return this._settings.get_boolean('pad-single-digit')
                ? value.padStart(2, '0')
                : value;
        }

        _getBatteryStatus() {
            const status =
                readFileSafely(`${this._battery.path}status`) ?? 'Unknown';
            const naText = this._settings.get_boolean('hide-na')
                ? ''
                : _(' N/A ');

            if (status.includes('Full'))
                return ''; // Don't display anything if battery is full
            if (status.includes('Unknown'))
                return _(' ? ');

            const powerDraw = this._meas();
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

        _onBatteryChanged() {
            this._battery = findBattery(this._settings.get_int('battery'));
            this._sync();
        }

        _sync() {
            if (!this._settings)
                return GLib.SOURCE_REMOVE;

            // Re-probe when nothing was found yet: sysfs entries can appear
            // late, and batteries can be hot-plugged.
            if (!this._battery.path)
                this._battery = findBattery(this._settings.get_int('battery'));

            this.text = this._battery.path ? this._getBatteryStatus() : ' ⚠ ';
            return GLib.SOURCE_CONTINUE;
        }

        _restartTimer() {
            this._stopTimer();
            const interval = Math.max(
                MIN_INTERVAL,
                this._settings.get_int('interval')
            );
            this._timeoutId = GLib.timeout_add_seconds(
                GLib.PRIORITY_LOW,
                interval,
                () => this._sync()
            );
        }

        _stopTimer() {
            if (this._timeoutId) {
                GLib.Source.remove(this._timeoutId);
                this._timeoutId = null;
            }
        }

        _onDestroy() {
            this._stopTimer();
            this._settings?.disconnectObject(this);
            this._settings = null;
        }
    }
);

export default class WattmeterExtension extends Extension {
    enable() {
        this._settings = this.getSettings(SETTINGS_SCHEMA);
        this._retries = 0;
        this._retryId = null;
        this._batLabelIndicator = new BatLabelIndicator(this._settings);
        this._addToPanel();
    }

    // The quick settings system indicator is not guaranteed to exist yet when
    // the extension is enabled during shell startup, so retry a few times.
    _addToPanel() {
        const system = panel.statusArea?.quickSettings?._system;
        if (system?._systemItem?._powerToggle) {
            system.add_child(this._batLabelIndicator);
            return;
        }

        if (this._retries >= MAX_RETRIES) {
            console.warn(
                `[wattmeter-extension] Failed to find power toggle indicator after ${MAX_RETRIES} retries.`
            );
            return;
        }

        this._retries++;
        this._retryId = GLib.timeout_add_seconds(
            GLib.PRIORITY_LOW,
            RETRY_DELAY,
            () => {
                this._retryId = null;
                this._addToPanel();
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    disable() {
        if (this._retryId) {
            GLib.Source.remove(this._retryId);
            this._retryId = null;
        }
        this._batLabelIndicator?.destroy();
        this._batLabelIndicator = null;
        this._settings = null;
    }
}
