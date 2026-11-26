// SPDX-License-Identifier: GPL-3.0-or-later
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension, InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';

const COLS = 4;
const CELL = 36; // logical pixels
const ROLE = 'trayFlyout';

// Indicator naming from Lilypad by shendrew (GPL-3.0, https://github.com/shendrew/Lilypad):
// 'emoji-copy@felipeftn' -> 'emoji_copy'
const nameOf = role => (role.split('/').pop().split('@')[0].match(/((\d)*[A-Z]+(\d)*)+/gi) ?? []).join('_');
const isAppIndicator = role => role.startsWith('appindicator');

// Some indicators stay visible while showing nothing; those would leave an empty cell.
const draws = a => a.visible && (
    (a instanceof St.Icon && !!(a.gicon || a.icon_name || a.fallback_gicon || a.fallback_icon_name)) ||
    (a instanceof St.Label && !!a.text) ||
    a.get_children().some(draws));

const scale = () => St.ThemeContext.get_for_stage(global.stage).scale_factor;

export default class TrayFlyout extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._moved = new Map(); // indicator -> {parent, parentId, index, style, menu}
        this._dying = false;

        this._button = new PanelMenu.Button(0.5, 'Show hidden icons');
        this._button.add_child(new St.Icon({icon_name: 'pan-up-symbolic', style_class: 'system-status-icon'}));
        const flyout = this._button.menu;
        flyout.actor.add_style_class_name('tray-flyout-menu');
        this._grid = new St.Widget({style_class: 'tray-flyout-grid', layout_manager: new Clutter.GridLayout()});
        // the flyout is torn down with the session; nothing may be re-packed while that happens
        this._grid.connect('destroy', () => (this._dying = true));
        this._spare = new St.Widget({visible: false}); // tucked icons that currently draw nothing
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false, style_class: 'tray-flyout-item'});
        item.add_child(this._grid);
        item.add_child(this._spare);
        flyout.addMenuItem(item);

        // Tucked icons' menus get their own manager, so opening one does not close the flyout
        // (the panel's manager allows only one open menu). The flyout keeps its grab underneath.
        this._iconMenus = new PopupMenu.PopupMenuManager(this._button);
        flyout.connect('open-state-changed', (_m, open) => {
            if (open)
                this._sync();
            else
                this._iconMenus.activeMenu?.close();
        });
        Main.panel.addToStatusArea(ROLE, this._button, 0, 'right');

        const self = this;
        this._injection = new InjectionManager();
        this._injection.overrideMethod(Object.getPrototypeOf(Main.panel), 'addToStatusArea',
            orig => function (...args) {
                const ret = orig.apply(this, args);
                if (this === Main.panel)
                    self._refresh();
                return ret;
            });

        this._themeContext = St.ThemeContext.get_for_stage(global.stage);
        this._themeContext.connectObject('notify::scale-factor',
            () => this._moved.forEach((_rec, ind) => this._resize(ind)), this);
        this._settings.connectObject(
            'changed::hidden-indicators', () => this._refresh(),
            'changed::hide-appindicators', () => this._refresh(),
            'changed::stack-clock', () => this._setClock(this._settings.get_boolean('stack-clock')),
            this);
        this._refresh();
        this._setClock(this._settings.get_boolean('stack-clock'));
    }

    // tuck or restore every indicator according to the settings
    _refresh() {
        const hidden = this._settings.get_strv('hidden-indicators');
        const hideApps = this._settings.get_boolean('hide-appindicators');
        const seen = this._settings.get_strv('seen-indicators');
        const known = new Set(seen);
        for (const [role, ind] of Object.entries(Main.panel.statusArea)) {
            if (role === ROLE || !ind)
                continue;
            if (!isAppIndicator(role))
                known.add(nameOf(role));
            if (isAppIndicator(role) ? hideApps : hidden.includes(nameOf(role)))
                this._tuck(ind);
            else
                this._untuck(ind);
        }
        if (known.size !== seen.length) // lets prefs list indicators it cannot see itself
            this._settings.set_strv('seen-indicators', [...known].sort());
        this._sync();
    }

    _tuck(ind) {
        const c = ind.container;
        if (!c || this._moved.has(ind))
            return;
        const parent = c.get_parent();
        const rec = {parent, index: parent ? parent.get_children().indexOf(c) : -1, style: ind.get_style()};
        if (parent)
            rec.parentId = parent.connect('destroy', () => (rec.parent = null));
        parent?.remove_child(c);
        this._grid.add_child(c);
        this._dropDashToPanelStyle(c);
        // ButtonBox sizes itself in JS and ignores CSS width, so fix the actor size instead
        ind.set_style('-natural-hpadding: 0; -minimum-hpadding: 0; padding: 0;');
        this._resize(ind);
        const content = ind.get_first_child();
        if (content)
            content.x_align = content.y_align = Clutter.ActorAlign.CENTER;
        c.connectObject(
            'notify::visible', () => this._sync(),
            'destroy', () => {
                if (this._dying)
                    return;
                rec.parent?.disconnect(rec.parentId);
                this._moved.delete(ind);
                this._sync();
            }, this);
        ind.connectObject(
            'notify::visible', () => this._sync(),
            'menu-set', () => this._adoptMenu(ind, rec), this);
        this._moved.set(ind, rec);
        this._adoptMenu(ind, rec);
    }

    _untuck(ind) {
        const rec = this._moved.get(ind);
        if (!rec)
            return;
        this._moved.delete(ind);
        const c = ind.container;
        c.disconnectObject(this);
        ind.disconnectObject(this);
        if (rec.menu) {
            rec.menu.close();
            rec.menu.disconnectObject(this);
            rec.menu.actor.disconnectObject(this);
            this._iconMenus.removeMenu(rec.menu);
            Main.panel.menuManager.addMenu(rec.menu);
        }
        ind.set_size(-1, -1);
        ind.set_style(rec.style ?? null);
        const content = ind.get_first_child();
        if (content)
            content.x_align = content.y_align = Clutter.ActorAlign.FILL;
        c.get_parent()?.remove_child(c);
        if (rec.parent) {
            rec.parent.disconnect(rec.parentId);
            rec.parent.insert_child_at_index(c, Math.min(rec.index, rec.parent.get_n_children()));
        } else {
            Main.panel._rightBox.insert_child_at_index(c, 0); // its old box is gone
        }
    }

    // Dash to Panel keeps the original inline style of tray actors in a private field and pads
    // them; put that style back so every cell gets the same size. Does nothing without DtP.
    _dropDashToPanelStyle(actor) {
        const orig = actor._dtp_original_inline_style;
        if (typeof orig === 'string' || orig === null) {
            actor.set_style(orig);
            delete actor._dtp_original_inline_style;
            delete actor._dtp_style_overrides;
        }
        actor.get_children().forEach(a => this._dropDashToPanelStyle(a));
    }

    _resize(ind) {
        ind.set_size(CELL * scale(), CELL * scale());
    }

    _adoptMenu(ind, rec) {
        const menu = ind.menu;
        if (!(menu instanceof PopupMenu.PopupMenu) || rec.menu === menu)
            return;
        rec.menu = menu;
        // connected before the manager's own handler so a click on another icon can switch menus
        menu.actor.connectObject('captured-event', (_a, event) => this._onIconMenuEvent(menu, event), this);
        Main.panel.menuManager.removeMenu(menu);
        this._iconMenus.addMenu(menu);
        menu.connectObject('open-state-changed', (_m, open) => {
            if (open && menu.actor.get_parent() === Main.uiGroup)
                Main.uiGroup.set_child_above_sibling(menu.actor, this._button.menu.actor);
        }, this);
    }

    // While an icon's menu is open it holds the grab, so the flyout does not see clicks.
    _onIconMenuEvent(menu, event) {
        const type = event.type();
        if (!menu.isOpen || (type !== Clutter.EventType.BUTTON_PRESS && type !== Clutter.EventType.TOUCH_BEGIN))
            return Clutter.EVENT_PROPAGATE;
        const target = global.stage.get_event_actor(event);
        if (menu.actor.contains(target))
            return Clutter.EVENT_PROPAGATE;
        const flyout = this._button.menu;
        if (!flyout.actor.contains(target)) {
            flyout.close(); // outside everything: close the icon menu and the flyout
            return Clutter.EVENT_PROPAGATE;
        }
        const other = [...this._moved.keys()].find(i => i.contains(target))?.menu;
        if (other instanceof PopupMenu.PopupMenu && other !== menu) {
            other.open();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE; // the manager closes this menu; the flyout stays open
    }

    // place icons that draw something in a COLS-wide grid, the rest out of the layout
    _sync() {
        if (this._dying)
            return;
        const layout = this._grid.layout_manager;
        let n = 0;
        for (const ind of this._moved.keys()) {
            const c = ind.container;
            c.get_parent()?.remove_child(c);
            if (c.visible && draws(ind)) {
                layout.attach(c, n % COLS, Math.floor(n / COLS), 1, 1);
                n++;
            } else {
                this._spare.add_child(c);
            }
        }
        this._button.visible = n > 0;
    }

    _setClock(on) {
        const dm = Main.panel.statusArea.dateMenu;
        if (on === !!this._iface || !dm?._clockDisplay || !dm._clock)
            return;
        const text = dm._clockDisplay.clutter_text;
        if (on) {
            // Windows-style clock: time over date, right-aligned
            this._iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
            this._alignment = text.get_line_alignment();
            text.set_line_alignment(Pango.Alignment.RIGHT);
            const update = () => {
                const now = GLib.DateTime.new_now_local();
                const time = now.format(this._iface.get_string('clock-format') === '24h' ? '%H:%M' : '%-l:%M %p');
                dm._clockDisplay.text = `${time}\n${now.format('%x')}`;
            };
            dm._clock.connectObject('notify::clock', update, this);
            this._iface.connectObject('changed::clock-format', update, this);
            update();
        } else {
            dm._clock.disconnectObject(this);
            this._iface.disconnectObject(this);
            this._iface = null;
            text.set_line_alignment(this._alignment);
            dm._clockDisplay.text = dm._clock.clock;
        }
    }

    disable() {
        this._settings.disconnectObject(this);
        this._themeContext.disconnectObject(this);
        this._setClock(false);
        this._injection.clear();
        for (const ind of [...this._moved.keys()])
            this._untuck(ind);
        this._button.destroy();
        this._moved = this._button = this._grid = this._spare = this._iconMenus = null;
        this._injection = this._themeContext = this._settings = null;
    }
}
