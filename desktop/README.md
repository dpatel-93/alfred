# Alfred desktop

Alfred as a Windows app: the dashboard in its own window, and, when that window is minimised
or closed, a floating brain you can drag anywhere — the same brain as the dashboard's Brain
tab, animated. Its badge counts what is left today; it pulses rose when something is late or
waiting on you. Click it to bring the dashboard back.

- **Right-click the brain** (or the tray icon): Open Alfred, Tell Alfred…, Morning brief,
  Keep on top of other windows (on/off), Size (small to extra large), Put the brain back in
  the corner, Start with Windows (installed app only), Quit Alfred.
- **Resize**: drag the grip in the brain's bottom-right corner, or pick a size.
- **The engine**: the app uses Alfred's engine (`brain/server.mjs`, local to this PC on
  127.0.0.1) if it is already running, and starts it otherwise; quitting stops only an
  engine the app started. Sign-ins (Claude, Grok, Gemini, Drive for Desktop) are unchanged:
  the engine uses them exactly as before.
- **Settings** live in `%APPDATA%\Alfred\state.json` (window size, the brain's spot, size,
  keep-on-top); an engine the app starts logs to `%APPDATA%\Alfred\engine.log`.

## Build and install

```
npm install
npm run dist
```

`dist/Alfred Setup 1.0.0.exe` installs it for the current user (no admin), with Start menu
and desktop shortcuts. It is not code-signed, so Windows SmartScreen asks once: More info,
then Run anyway. The installed app runs the engine from the `brain/` folder it was built
next to (recorded in `engine.json` at build time), so dashboard changes need no rebuild.

`node scripts/make-icon.mjs` redraws `build/icon.png` from the brain itself.

## Test

```
node test/smoke.mjs
```

Drives the app with Playwright against a throwaway engine and brain on port 7791 (never the
live ones). `ALFRED_APP_EXE=dist/win-unpacked/Alfred.exe` runs the same checks on the
packaged app.
