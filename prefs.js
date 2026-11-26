// SPDX-License-Identifier: GPL-3.0-or-later
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class TrayFlyoutPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings; // keep it alive as long as the window
        const page = new Adw.PreferencesPage();
        window.add(page);

        const general = new Adw.PreferencesGroup();
        page.add(general);
        const clock = new Adw.SwitchRow({title: 'Stack the clock', subtitle: 'Show time over date, like Windows'});
        settings.bind('stack-clock', clock, 'active', Gio.SettingsBindFlags.DEFAULT);
        general.add(clock);
        const apps = new Adw.SwitchRow({title: 'Move all app icons', subtitle: 'AppIndicator / StatusNotifier icons'});
        settings.bind('hide-appindicators', apps, 'active', Gio.SettingsBindFlags.DEFAULT);
        general.add(apps);

        const group = new Adw.PreferencesGroup({
            title: 'Icons in the flyout',
            description: 'Ticked indicators move from the top bar into the flyout. ' +
                'Indicators appear here once the extension has seen them in the top bar.',
        });
        page.add(group);
        const hidden = settings.get_strv('hidden-indicators');
        const titles = settings.get_value('indicator-titles').deepUnpack();
        const names = [...new Set([...settings.get_strv('seen-indicators'), ...hidden])].sort();
        for (const name of names) {
            const check = new Gtk.CheckButton({active: hidden.includes(name), valign: Gtk.Align.CENTER});
            check.connect('toggled', () => {
                const list = settings.get_strv('hidden-indicators').filter(n => n !== name);
                if (check.active)
                    list.push(name);
                settings.set_strv('hidden-indicators', list);
            });
            const title = titles[name];
            const row = new Adw.ActionRow({title: title ?? name, subtitle: title ? name : '', activatable_widget: check});
            row.add_prefix(check);
            group.add(row);
        }
    }
}
