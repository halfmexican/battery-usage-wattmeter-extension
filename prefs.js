import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import Adw from 'gi://Adw';
import {
    ExtensionPreferences,
    gettext as _,
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class MyExtensionPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        // Attach settings to window
        window._settings = this.getSettings(
            'org.gnome.shell.extensions.battery_usage_wattmeter'
        );

        // Create a preferences page
        const generalPage = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'dialog-information-symbolic',
        });
        window.add(generalPage);

        // Create a preferences group titled 'Behavior'
        const behaviorGroup = new Adw.PreferencesGroup({
            title: _('Behavior'),
            description: _('Configure extension behavior'),
        });
        generalPage.add(behaviorGroup);

        // Create a SpinRow for the 'interval' setting
        const intervalRow = new Adw.SpinRow({
            title: _('Sync Interval'),
            subtitle: _('Seconds'),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 120,
                step_increment: 1,
                value: 4,
            }),
        });
        behaviorGroup.add(intervalRow);
        window._settings.bind(
            'interval',
            intervalRow,
            'value',
            Gio.SettingsBindFlags.DEFAULT
        );

        // Create a StringList and populate it with battery options
        const batteryStringList = new Gtk.StringList();
        batteryStringList.splice(0, 0, ['Automatic', 'BAT0', 'BAT1', 'BAT2']);

        // Create a ComboRow for the 'battery' setting
        const batteryRow = new Adw.ComboRow({
            title: _('Battery Selection'),
            model: batteryStringList,
        });
        behaviorGroup.add(batteryRow);
        window._settings.bind(
            'battery',
            batteryRow,
            'selected',
            Gio.SettingsBindFlags.DEFAULT
        );

        const hideNARow = new Adw.SwitchRow({
            title: _('Hide N/A Status'),
            subtitle: _(
                'Hide the N/A status when battery is neither charging nor discharging'
            ),
        });
        behaviorGroup.add(hideNARow);
        window._settings.bind(
            'hide-na',
            hideNARow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        const customBatteryPathExpander = new Adw.ExpanderRow({
            title: _('Custom Battery Path'),
            subtitle: _('Leave empty to use default paths'),
            show_enable_switch: true,
        });
        behaviorGroup.add(customBatteryPathExpander);

        const customBatteryPathRow = new Adw.EntryRow();
        customBatteryPathExpander.add_row(customBatteryPathRow);

        window._settings.bind(
            'use-custom-battery',
            customBatteryPathExpander,
            'enable-expansion',
            Gio.SettingsBindFlags.DEFAULT
        );

        window._settings.bind(
            'custom-battery-path',
            customBatteryPathRow,
            'text',
            Gio.SettingsBindFlags.DEFAULT
        );
    }
}
