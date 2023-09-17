import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Panel from 'resource:///org/gnome/shell/ui/main.js';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

const BAT0 = "/sys/class/power_supply/BAT0/";
const BAT1 = "/sys/class/power_supply/BAT1/";
const BAT2 = "/sys/class/power_supply/BAT2/";

let BatteryInfo = null;

function getBatteryIndicator(callback) {
    let system = Panel.statusArea.quickSettings._system;
    if (system && system._systemItem._powerToggle) {
        callback(system._systemItem._powerToggle._proxy, system);
    }
}

// Function to get the appropriate battery path and its type (TP or not)
function getBatteryPath(battery) {
  let path = BAT0;
  if (battery === 1) path = BAT0;
  if (battery === 2) path = BAT1;
  if (battery === 3) path = BAT2;

  const finalPath = readFileSafely(`${path}status`, "none") === "none" ? -1 : path;
  const isTP = readFileSafely(`${path}power_now`, "none") === "none" ? false : true;

  return { 'path': finalPath, 'isTP': isTP };
}

// Safely read a file and return its contents or a default value
function readFileSafely(filePath, defaultValue) {
  try {
    return Shell.get_file_contents_utf8_sync(filePath);
  } catch (e) {
    log(`Cannot read file ${filePath}: ${e}`);
    return defaultValue;
  }
}

// Indicator class
var BatLabelIndicator = GObject.registerClass(
  class BatLabelIndicator extends St.Label {
    _init() {
      super._init({
        text: _('Calculating...'),
        y_align: Clutter.ActorAlign.CENTER
      });
      
      this._settings = this.getSettings('org.gnome.shell.extensions.battery_usage_wattmeter');
      let battery = this._settings.get_int("battery");
      BatteryInfo = getBatteryPath(battery);
      this._spawn();
    }

    // Get power consumption in Watts
    _getPower() {
      const path = BatteryInfo["path"];
      if (!BatteryInfo['isTP']) {
        const current_now = this._getValue(`${path}current_now`);
        const voltage_now = this._getValue(`${path}voltage_now`);
        return (current_now * voltage_now);
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
      const status = readFileSafely(`${BatteryInfo["path"]}status`, "Unknown");
      return status.includes('Charging') ? _(" +%s W").format(this._meas()) :
        status.includes('Discharging') ? _(" -%s W").format(this._meas()) :
        status.includes('Unknown') ? _(" ?") :
        _(" N/A");
    }

    // Convert power to string with appropriate formatting
    _meas() {
      const power = this._getPower();
      return power < 0 ? 0 : String(Math.round(power)).padStart(2, '0');
    }

    // Update the indicator label
    _sync() {
      if (BatteryInfo["path"] !== -1) {
        this.text = this._getBatteryStatus();
      } else {
        log(`[consumption-extension] can't find battery!!!`);
      }
      return GLib.SOURCE_CONTINUE;
    }

    // Start the update loop
    _spawn() {
      this._biForceSync = GLib.timeout_add(
        GLib.PRIORITY_DEFAULT,
        parseInt(this._settings.get_string("interval")) * 1000,
        this._sync.bind(this)
      );
    }

    // Stop the update loop
    _stop() {
      GLib.source_remove(this._biForceSync);
    }
  }
);

// Main extension class
export default class MyGNOME45Extension extends Extension {
  enable() {
    this._batLabelIndicator = new BatLabelIndicator();
    
    getBatteryIndicator((proxy, icon) => {
        icon.add_child(batLabelIndicator);
    });
  }

  disable() {
    if (this._batLabelIndicator) {
      this._batLabelIndicator._stop();
      this._batLabelIndicator.destroy();
      this._batLabelIndicator = null;
    }
  }
}
