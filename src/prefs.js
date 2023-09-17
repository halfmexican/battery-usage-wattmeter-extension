'use strict';

import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import * as Utils from './utils.js';

export default class MyExtensionPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    this._settings = this.getSettings();
    this.builder = new Gtk.Builder();
    this.builder.set_translation_domain(this.metadata['gettext-domain']);
    this.builder.add_from_file(this.path + '/prefs.ui');
    const main = this.builder.get_object('prefs_box');

    window.append(main);
    this._bindSettings();
  }

  _bindSettings() {
    // Bind the 'interval' setting to the 'interval_adjustment' object in the UI
    this._settings.bind('interval', this.builder.get_object('interval_adjustment'), 'value', Gio.SettingsBindFlags.DEFAULT);

    // Bind the 'battery' setting to the 'battery' object in the UI
    this._settings.bind('battery', this.builder.get_object('battery'), 'active', Gio.SettingsBindFlags.DEFAULT);
  }
}

