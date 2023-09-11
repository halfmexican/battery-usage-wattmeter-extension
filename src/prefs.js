'use strict';

const {
    Gio,
    Gtk
} = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Utils = Me.imports.utils;

function init() {}
class Preferences {
    constructor() {
        this.main = new Gtk.Grid({
            margin_top: 10,
            margin_bottom: 10,
            margin_start: 10,
            margin_end: 10,
            row_spacing: 12,
            column_spacing: 18,
            column_homogeneous: false,
            row_homogeneous: false
        });

        const addRow = ((main) => {
            let row = 0;
            return (label, input) => {
                let inputWidget = input;

                if (input instanceof Gtk.Switch) {
                    inputWidget = new Gtk.Box({
                        orientation: Gtk.Orientation.HORIZONTAL,
                    });
                    inputWidget.append(input);
                }

                if (label) {
                    main.attach(label, 0, row, 1, 1);
                    if (inputWidget)
                        main.attach(inputWidget, 1, row, 1, 1);
                } else {
                    main.attach(inputWidget, 0, row, 2, 1);
                }

                row++;
            };
        })(this.main);




        const createLabel = (label) => {
            return new Gtk.Label({
                label: label,
                hexpand: true,
                halign: Gtk.Align.START
            })
        }

        const title_label = new Gtk.Label({
            use_markup: true,
            label: '<span size="large" weight="heavy">' +
                'BATTERY CONSUMPTION WATT METER' + '</span>',
            hexpand: true,
            halign: Gtk.Align.CENTER
        });
        addRow(null, title_label)

        const title_label2 = new Gtk.Label({
            use_markup: true,
            label: '<span size="small">' + 'Version' +
                ' ' + Utils.PrefFields.VERSION + '</span>',
            hexpand: true,
            halign: Gtk.Align.CENTER
        });
        addRow(null, title_label2)

        const link_label = new Gtk.Label({
            use_markup: true,
            label: '<span size="small"><a href="https://github.com/halfmexican/battery-usage-indicator-extensions">' +
                'https://github.com/halfmexican/battery-usage-indicator-extensions' + '</a></span>',
            hexpand: true,
            halign: Gtk.Align.CENTER,
            margin_bottom: 10
        });
        addRow(null, link_label)

        addRow(null, new Gtk.Separator())

        //INTERVAL BOX
        const intervalBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 30
        })
        //const intervalEdit = new Gtk.Entry({ buffer: new Gtk.EntryBuffer() })
        const intervalEdit = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 15,
                step_increment: 1
            })
        })

        intervalBox.append(intervalEdit);
        //const useDefaultLocaleLabel = createLabel(_("Use default locale") + ` (test)`)
        const intervalLabel = createLabel("Interval (seconds)")
        addRow(intervalLabel, intervalBox)

        intervalEdit.value = Utils.PrefFields.INTERVAL

        addRow(null, new Gtk.Separator())


        //BATTERY COMBOBOX
        let combo = new Gtk.ComboBoxText();
        combo.tooltip_text = "Choose battery to use for metric";
        combo.append_text("AUTOMATIC");
        combo.append_text("BAT0");
        combo.append_text("BAT1");
        combo.append_text("BAT2");
        combo.active = Utils.PrefFields.BATTERY

        addRow(createLabel("Choose battery"), combo)


        addRow(null, new Gtk.Separator())

        //bind SETTINGS
        const settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.battery_usage_wattmeter');
        settings.bind("interval", intervalEdit, 'text', Gio.SettingsBindFlags.DEFAULT);
        settings.bind("battery", combo, 'active', Gio.SettingsBindFlags.DEFAULT);


    }

}

function buildPrefsWidget() {
    let frame = new Gtk.Box();
    let widget = new Preferences();
    //addBox(frame, widget.main);
    frame.append(widget.main);
    if (frame.show_all)
        frame.show_all();
    return frame;
}
