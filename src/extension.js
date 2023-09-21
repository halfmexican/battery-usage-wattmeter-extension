const ExtensionUtils = imports.misc.extensionUtils;
const Panel = imports.ui.main.panel;

const {
    GLib,
    GObject,
    Shell,
    Gio,
    St,
    Clutter
} = imports.gi;

const PanelMenu = imports.ui.panelMenu;
const BAT0 = "/sys/class/power_supply/BAT0/"
const BAT1 = "/sys/class/power_supply/BAT1/"
const BAT2 = "/sys/class/power_supply/BAT2/"

let BatteryInfo = null;

function getBatteryIndicator(callback) {
    let system = Panel.statusArea.quickSettings._system;
    if (system && system._systemItem._powerToggle) {
        callback(system._systemItem._powerToggle._proxy, system);
    }
}

function getBatteryPath(battery) {
    let path = BAT0;
    if (battery === 1) path = BAT0;
    if (battery === 2) path = BAT1;
    if (battery === 3) path = BAT2;

    const finalPath = readFileSafely(path + "status", "none") === "none" ? -1 : path;
    const isTP = readFileSafely(path + "power_now", "none") === "none" ? false : true;

    return {
        'path': finalPath,
        'isTP': isTP
    };
}

function _getValue(path) {
    const value = parseFloat(readFileSafely(path, -1));
    return value === -1 ? value : value / 1000000;
}

function readFileSafely(filePath, defaultValue) {
    try {
        return Shell.get_file_contents_utf8_sync(filePath);
    } catch (e) {
        console.error(`Cannot read file ${filePath}`, e);
    }
    return defaultValue;
}

// Indicator
var BatLabelIndicator = GObject.registerClass(
    class BatLabelIndicator extends St.Label {
        _init() {
            super._init({
                text: _(' Calculating...'), // Initial text
                y_align: Clutter.ActorAlign.CENTER,
            });

            this.settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.battery_usage_wattmeter');
            this.bi_force_sync = null;

            let battery = this.settings.get_int("battery");
            BatteryInfo = getBatteryPath(battery);

            // Spawn the update loop
            this._spawn();
        }

        _getPower() {
            const path = BatteryInfo["path"]
            if (BatteryInfo['isTP'] === false) {
                const current_now = _getValue(path + "current_now");
                const voltage_now = _getValue(path + "voltage_now");
                return (current_now * voltage_now);
            }
            return _getValue(path + "power_now");
        }

        _getBatteryStatus() {
            const status = readFileSafely(BatteryInfo["path"] + "status", "Unknown");

            if (status.includes('Full')) {
                return "";  // Don't display anything if battery is full
            }

            return status.includes('Charging') ? _(" +%s W").format(this._meas()) :
               status.includes('Discharging') ? _(" -%s W").format(this._meas()) :
               status.includes('Unknown') ? _(" ?") :
               _(" N/A");
        }

        _sync() {

            if (BatteryInfo["path"] !== -1) {
                this.text = this._getBatteryStatus();
            } else {
                console.error(`[consumption-extension] can't find battery!!!`);
            }

            return GLib.SOURCE_CONTINUE; // Important: keep the source alive
        }

        _meas() {
            const power = this._getPower();

            if (power < 0) {
                return 0;
            } else {
                let pStr = String(Math.round(power))
                return pStr.length == 1 ? "0" + pStr : pStr
            }
        }

        _spawn() {
            this.bi_force_sync = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                this.settings.get_string("interval") + "000",
                this._sync.bind(this));

        }

        _stop() {
            GLib.source_remove(this.bi_force_sync);
        }
    }
);

// Extension
let batLabelIndicator;

function enable() {
    batLabelIndicator = new BatLabelIndicator();

    getBatteryIndicator((proxy, icon) => {
        icon.add_child(batLabelIndicator);
    });
}

function disable() {
    if (batLabelIndicator) {
        batLabelIndicator._stop();
        batLabelIndicator.destroy();
        batLabelIndicator = null;
    }
}
