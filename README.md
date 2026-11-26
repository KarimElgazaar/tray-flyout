# Tray Flyout

GNOME Shell 50 extension. Adds a Windows-style `^` button to the top bar. Clicking it opens the tray icons you chose to hide in a small grid popup. Clicking an icon in the popup opens that icon's menu and keeps the popup open. Escape closes the icon menu first, then the popup. A click outside closes both.

Optionally it stacks the clock as time over date, like Windows.

## Install

```sh
gnome-extensions install tray-flyout@karimelgazaar.github.io.shell-extension.zip
```

Log out and back in, then:

```sh
gnome-extensions enable tray-flyout@karimelgazaar.github.io
```

## Settings

Open the preferences with `gnome-extensions prefs tray-flyout@karimelgazaar.github.io`:

- **Icons in the flyout**: tick the top-bar indicators that should move into the popup. An indicator is listed once the extension has seen it in the top bar.
- **Move all app icons**: moves every AppIndicator / StatusNotifier icon into the popup (on by default).
- **Stack the clock**: shows the time over the date (off by default).

## Do not use together with Lilypad

[Lilypad](https://github.com/shendrew/Lilypad) also moves top-bar indicators. Running both makes them fight over the same icons. Disable Lilypad before enabling Tray Flyout.

## Credits

The way indicators are named comes from Lilypad by shendrew, licensed GPL-3.0.

## License

GPL-3.0-or-later. See `LICENSE`.
