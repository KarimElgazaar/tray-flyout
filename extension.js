import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

// shortcut: hidden set is hard-coded (was Lilypad's list); add a settings schema if it needs editing often
const HIDE = ['livepatch', 'tiling_assistant', 'software_update_available', 'unattended_upgrade',
    'emoji_copy', 'extension_list', 'clipboardIndicator', 'StatusNotifierItem'];
const COLS = 4;
// same naming as Lilypad: 'emoji-copy@felipeftn' -> 'emoji_copy'
const nameOf = role => (role.split('/').pop().split('@')[0].match(/((\d)*[A-Z]+(\d)*)+/gi) ?? []).join('_');
const tucked = role => role.startsWith('appindicator') || HIDE.includes(nameOf(role));

export default class TrayFlyout extends Extension {
    enable() {
        this._moved = new Map(); // indicator -> {parent, index, source, id}

        this._button = new PanelMenu.Button(0.5, 'Show hidden icons');
        this._button.add_child(new St.Icon({icon_name: 'pan-up-symbolic', style_class: 'system-status-icon'}));
        this._grid = new St.BoxLayout({style_class: 'tray-flyout-grid', orientation: Clutter.Orientation.VERTICAL});
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false, style_class: 'tray-flyout-item'});
        item.add_child(this._grid);
        this._button.menu.addMenuItem(item);
        Main.panel.addToStatusArea('trayFlyout', this._button, 0, 'right');

        this._hadOwnAdd = Object.hasOwn(Main.panel, 'addToStatusArea');
        const orig = this._origAdd = Main.panel.addToStatusArea;
        const self = this;
        Main.panel.addToStatusArea = function (role, indicator, ...rest) {
            const ret = orig.call(this, role, indicator, ...rest);
            if (tucked(role)) self._tuck(indicator);
            return ret;
        };
        for (const [role, ind] of Object.entries(Main.panel.statusArea))
            if (tucked(role)) this._tuck(ind);
        this._sync();

        // Windows-style clock: time over date, right-aligned
        this._dm = Main.panel.statusArea.dateMenu;
        this._iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._dm._clockDisplay.clutter_text.set_line_alignment(Pango.Alignment.RIGHT);
        this._clockId = this._dm._clock.connect('notify::clock', () => this._stackClock());
        this._fmtId = this._iface.connect('changed::clock-format', () => this._stackClock());
        this._stackClock();
    }

    _stackClock() {
        const now = GLib.DateTime.new_now_local();
        const time = now.format(this._iface.get_string('clock-format') === '24h' ? '%H:%M' : '%-l:%M %p');
        this._dm._clockDisplay.text = `${time}\n${now.format('%-m/%-d/%Y')}`;
    }

    _tuck(ind) {
        const c = ind.container;
        if (!c || this._moved.has(ind)) return;
        const parent = c.get_parent();
        const rec = {parent, index: parent ? parent.get_children().indexOf(c) : -1, source: ind.menu?.sourceActor};
        parent?.remove_child(c);
        this._row().add_child(c);
        // drop Dash to Panel's inline tray padding/size so the flyout CSS gives every cell the same size
        const clean = a => {
            if (a._dtp_original_inline_style !== undefined) {
                a.set_style(a._dtp_original_inline_style);
                delete a._dtp_original_inline_style;
                delete a._dtp_style_overrides;
            }
            a.get_children().forEach(clean);
        };
        clean(c);
        // fixed 36px cell with the icon centered, whatever the indicator's own width or padding
        rec.style = ind.get_style();
        // ButtonBox sizes itself in JS and ignores CSS width, so fix the actor size instead
        ind.set_style('-natural-hpadding: 0; -minimum-hpadding: 0; padding: 0;');
        ind.set_size(36, 36);
        const content = ind.get_first_child();
        if (content) { content.x_align = Clutter.ActorAlign.CENTER; content.y_align = Clutter.ActorAlign.CENTER; }
        c.visible = ind.visible; // Lilypad leaves collapsed icons hidden; follow the indicator's own state
        if (ind.menu?.sourceActor) ind.menu.sourceActor = this._button; // its menu pops up from the ^ like Windows
        rec.vis = c.connect('notify::visible', () => this._sync());
        rec.indVis = ind.connect('notify::visible', () => this._sync());
        rec.gone = c.connect('destroy', () => {
            this._moved.delete(ind);
            c.get_parent()?.remove_child(c);
            this._sync();
        });
        this._moved.set(ind, rec);
        this._sync();
    }

    _row() {
        let row = this._grid.get_last_child();
        if (!row || row.get_n_children() >= COLS) {
            row = new St.BoxLayout({style_class: 'tray-flyout-row'});
            this._grid.add_child(row);
        }
        return row;
    }

    _icons() {
        return this._grid.get_children().flatMap(r => r.get_children());
    }

    // re-pack the grid: shown icons first in rows of COLS, hidden ones last so they leave no holes
    _sync() {
        const shown = c => c.visible && (c.child?.visible ?? true);
        const all = this._icons();
        const order = [...all.filter(shown), ...all.filter(c => !shown(c))];
        for (const c of all) c.get_parent().remove_child(c);
        this._grid.destroy_all_children();
        for (const c of order) this._row().add_child(c);
        this._button.visible = order.some(shown);
    }

    disable() {
        this._dm._clock.disconnect(this._clockId);
        this._iface.disconnect(this._fmtId);
        this._dm._clockDisplay.clutter_text.set_line_alignment(Pango.Alignment.LEFT);
        this._dm._clockDisplay.text = this._dm._clock.clock;
        this._dm = this._iface = null;
        if (this._hadOwnAdd) Main.panel.addToStatusArea = this._origAdd;
        else delete Main.panel.addToStatusArea;
        for (const [ind, rec] of this._moved) {
            const c = ind.container;
            c.disconnect(rec.vis);
            c.disconnect(rec.gone);
            ind.disconnect(rec.indVis);
            ind.set_size(-1, -1);
            if (ind.menu && rec.source) ind.menu.sourceActor = rec.source;
            ind.set_style(rec.style ?? null);
            const content = ind.get_first_child();
            if (content) content.x_align = content.y_align = Clutter.ActorAlign.FILL;
            c.get_parent()?.remove_child(c);
            rec.parent?.insert_child_at_index(c, rec.index);
        }
        this._moved = null;
        this._button.destroy();
        this._button = this._grid = null;
    }
}
