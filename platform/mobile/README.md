# CloudHost247 mobile shell

A Capacitor 6 shell around the same React SPA the platform serves on the web (`platform/spa`).
There is no second UI: `capacitor.config.json` points `webDir` at `../spa/dist`, and the only
native-specific code is `src/mobile-boot.js`, a strict no-op in a browser.

## What the shell does

`src/mobile-boot.js` runs before the first render (wired from `spa/src/main.jsx`) and, **only on a
real Capacitor runtime**:

1. **Configures the API origin** for local-assets shells (see “Deployment modes” below).
2. **Hides the splash screen** once the WebView is up.
3. **Applies the status bar** style/colour from `capacitor.config.json`.
4. **Wires the Android back button** — back through history, exit only at the root.
5. **Marks `documentElement.dataset.platform = 'capacitor'`** for CSS and feature hooks.

Every native call is guarded through `window.Capacitor.Plugins`; a missing plugin degrades to a
no-op and is never faked. The web bundle keeps using `BrowserRouter` under `/app`; the native shell
uses `HashRouter` because the WebView's local server does not guarantee HTML5-history fallback for
deep links. The service worker is not registered inside the native shell.

## Deployment modes

| Mode | Config | API origin |
|---|---|---|
| **Hosted shell** | set `server.url` to the deployed platform (and allow its host in `server.allowNavigation`) | not needed — the page *is* the platform origin, relative `/api/v1/...` works |
| **Local-assets shell** | leave `server.url` unset; the bundle ships inside the app | set `plugins.CloudHost247.apiOrigin` in `capacitor.config.json` (e.g. `https://api.cloudhost247.com`) |

The origin must be `https:` (plain `http:` only for loopback development). An invalid origin is
refused and the app falls back to same-origin — which fails loudly in testing instead of
half-working in production. The boot logs one warning when running natively with neither
`server.url` nor `apiOrigin` set.

Runtime override (e.g. staging builds): `localStorage['ch247.apiOrigin'] = 'https://…'` — it wins
over the config value.

## Build and run

```sh
npm install                 # @capacitor/cli + platform packages
npm run build:web           # builds ../spa into ../spa/dist (webDir)
npx cap add android         # generates android/ (gitignored — see below)
npx cap add ios             # generates ios/     (gitignored — see below)
npm run sync                # build:web + cap sync (copies webDir into the native projects)
npm run run:android         # or: npm run open:android / run:ios / open:ios
```

`android/` and `ios/` are **generated locally and gitignored by design** (`platform/.gitignore`):
they are pure `cap add` output, rebuildable from this directory on any machine with the Android
SDK / Xcode, and this repository does not ship platform build artifacts.

## Verification status (honest)

Verified in this repository: the bootstrap logic (`platform/tests/mobile-shell.test.js` covers the
API-origin resolution and every guarded native behaviour against injected fakes), the config
contract, the SPA wiring (boot import, router swap, service-worker gate), and a green SPA build and
smoke with the shell wired in.

**Not verified here:** `cap add`, `cap sync`, Gradle/Xcode builds, and on-device behaviour — no
Android SDK or Xcode exists in this environment. The first device run should check: splash hides,
back-button behaviour, and that API calls reach the configured origin (the boot's warning is the
first thing to look for in `adb logcat` / the Xcode console).
