import {
    Extension,
    gettext as _,
} from 'resource:///org/gnome/shell/extensions/extension.js';
import {panel} from 'resource:///org/gnome/shell/ui/main.js';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

const BAT0 = '/sys/class/power_supply/BAT0/';
const BAT1 = '/sys/class/power_supply/BAT1/';
const BAT2 = '/sys/class/power_supply/BAT2/';

let retry_count = 0;
const max_retries = 5;
const retry_delay = 2;
let BatteryInfo = null;
let batteryIndicatorTimeoutId = null;

function getBatteryIndicator(callback) {
    let system = panel.statusArea?.quickSettings?._system;
    if (system?._systemItem?._powerToggle) {
        callback(system._systemItem._powerToggle._proxy, system);
    } else if (retry_count < max_retries) {
        retry_count++;
        if (batteryIndicatorTimeoutId)
            GLib.Source.remove(batteryIndicatorTimeoutId);
        batteryIndicatorTimeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_LOW,
            retry_delay,
            () => {
                Extension;
                getBatteryIndicator(callback);
                return GLib.SOURCE_REMOVE;
            }
        );
    } else {
        console.error(
            `[wattmeter-extension] Failed to find power toggle indicator after ${max_retries} retries.`
        );
    }
}

// Function to get the appropriate battery path and its type
function getBatteryPath(battery) {
    const settings = Extension.lookupByUUID(
        'battery-usage-wattmeter@halfmexicanhalfamazing.gmail.com'
    );
    const useCustom = settings.get_boolean('use-custom');
    const customPath = settings.get_string('custom-battery-path');
    // Array of possible battery paths
    const batteryPaths = [BAT0, BAT1, BAT2];
    const invalidPath = -1;

    if (useCustom && customPath) {
        return {
            path: customPath,
            isTP: readFileSafely(`${customPath}/power_now`, 'none') !== 'none',
        };
    }

    if (battery === 0) {
        // Automatic setting
        // Check each path and return the first one that contains a valid status file
        for (let path of batteryPaths) {
            if (readFileSafely(`${path}status`, 'none') !== 'none') {
                return {
                    path: path,
                    isTP: readFileSafely(`${path}power_now`, 'none') !== 'none',
                };
            }
        }
        console.error(
            '[wattmeter-extension] No valid battery path found for automatic setting.'
        );
        return {path: invalidPath, isTP: false};
    } else {
        // Manual setting
        let pathIndex = battery - 1;
        if (pathIndex >= 0 && pathIndex < batteryPaths.length) {
            let path = batteryPaths[pathIndex];
            if (readFileSafely(`${path}status`, 'none') !== 'none') {
                return {
                    path: path,
                    isTP: readFileSafely(`${path}power_now`, 'none') !== 'none',
                };
            }
        }
        // If the selected battery path is not valid, return an error
        console.error(
            `[wattmeter-extension] No valid battery path found for battery ${battery}.`
        );
        return {path: invalidPath, isTP: false};
    }
}

// Read a file and return its contents or a default value
function readFileSafely(filePath, defaultValue) {
    try {
        return Shell.get_file_contents_utf8_sync(filePath);
    } catch (e) {
        console.log(`Cannot read file ${filePath}: ${e}`);
        return defaultValue;
    }
}

// Indicator class
let BatLabelIndicator = GObject.registerClass(
    class BatLabelIndicator extends St.Label {
        constructor(settings) {
            super({
                text: _('Calculating…'),
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._settings = settings;
            let battery = this._settings.get_int('battery');
            BatteryInfo = getBatteryPath(battery);
            this._spawn();
        }

        // Get power consumption in Watts
        _getPower() {
            const path = BatteryInfo['path'];
            if (!BatteryInfo['isTP']) {
                const current_now = this._getValue(`${path}current_now`);
                const voltage_now = this._getValue(`${path}voltage_now`);
                return current_now * voltage_now;
            }
            return this._getValue(`${path}power_now`);
        }

        // Helper function to get the value from a sysfs file
        _getValue(path) {
            const value = parseFloat(readFileSafely(path, -1));
            return value === -1 ? value : value / 1000000;
        }

        // Determine battery status and power
        _getBatteryStatus() {
            const status = readFileSafely(
                BatteryInfo['path'] + 'status',
                'Unknown'
            );
            const hideNA = this._settings.get_boolean('hide-na');

            if (status.includes('Full')) {
                return ''; // Don't display anything if battery is full
            }

            return status.includes('Charging')
                ? _(' +%s W ').format(this._meas())
                : status.includes('Discharging')
                  ? _(' −%s W ').format(this._meas())
                  : status.includes('Unknown')
                    ? _(' ? ')
                    : hideNA
                      ? ''
                      : _(' N/A ');
        }

        // Convert power to string with appropriate formatting
        _meas() {
            const power = this._getPower();
            return power < 0 ? 0 : String(Math.round(power)).padStart(2, '0');
        }

        // Update the indicator label
        _sync() {
            if (BatteryInfo['path'] !== -1) {
                this.text = this._getBatteryStatus();
            } else {
                console.log("[wattmeter-extension] can't find battery!!!");
                this.text = ' ⚠ ';
            }
            return GLib.SOURCE_CONTINUE;
        }

        // Start the update loop
        _spawn() {
            // Remove the existing timeout before creating a new one
            if (this._biForceSync) {
                GLib.Source.remove(this._biForceSync);
                this._biForceSync = null;
            }

            this._biForceSync = GLib.timeout_add_seconds(
                GLib.PRIORITY_LOW,
                this._settings.get_int('interval'),
                this._sync.bind(this)
            );
        }

        // Stop the update loop
        _stop() {
            if (this._biForceSync) {
                GLib.Source.remove(this._biForceSync);
                this._biForceSync = null;
            }
        }
    }
);

// Main extension class
export default class WattmeterExtension extends Extension {
    enable() {
        this._settings = this.getSettings(
            'org.gnome.shell.extensions.battery_usage_wattmeter'
        );

        this._batLabelIndicator = new BatLabelIndicator(this._settings);
        getBatteryIndicator((proxy, icon) => {
            icon.add_child(this._batLabelIndicator);
        });
        this._settings.connect('changed::battery', () => {
            let newBatteryValue = this._settings.get_int('battery');
            BatteryInfo = getBatteryPath(newBatteryValue);
            this._batLabelIndicator._sync();
        });
    }

    disable() {
        if (batteryIndicatorTimeoutId) {
            GLib.Source.remove(batteryIndicatorTimeoutId);
            batteryIndicatorTimeoutId = null;
        }
        if (this._batLabelIndicator) {
            this._batLabelIndicator._stop();
            this._batLabelIndicator.destroy();
            this._batLabelIndicator = null;
        }
        this._settings = null;
    }
}
