/**
 * CloudHost247 mobile shell bootstrap — the Capacitor side of the app.
 *
 * The bundle is the same SPA the browser gets (`capacitor.config.json` points `webDir` at
 * `../spa/dist`); this module is the only native-specific code and it is a strict no-op on the
 * web. Every native capability is reached through `window.Capacitor.Plugins` and every call is
 * guarded, so a missing plugin degrades to "nothing happens" rather than crashing the app — and
 * nothing here invents a capability the runtime does not provide.
 *
 * What it does, only when actually running natively:
 *   1. Configures the API origin (local-assets shells are not on the platform's origin; the
 *      origin comes from `capacitor.config.json` → `plugins.CloudHost247.apiOrigin`). When the
 *      shell instead points `server.url` at the hosted platform, relative calls already work and
 *      no origin is needed — the boot warns only when neither is true.
 *   2. Hides the splash screen once the WebView is up.
 *   3. Applies the StatusBar style from the same config block the native side reads.
 *   4. Wires the Android hardware back button: back through history, and only exit at the root.
 *   5. Marks `document.documentElement.dataset.platform = 'capacitor'` for CSS/hooks.
 *
 * Dependency-free and side-effect-free at import time; `runMobileBoot()` is idempotent.
 */
import { configureApiOrigin, resolveApiOrigin } from '../../spa/src/lib/api.js';

/** True only on a real Capacitor native runtime (Android/iOS), never in a browser. */
export function isNativePlatform(capacitor) {
  const cap = capacitor ?? (typeof window !== 'undefined' ? window.Capacitor : undefined);
  try {
    return Boolean(cap?.isNativePlatform?.() ?? cap?.nativePlatform);
  } catch {
    return false;
  }
}

/**
 * Build the bootstrap against injected globals (so every behaviour is unit-testable without a
 * device). `run()` returns a plain report of what it did — never a claim it cannot back.
 */
export function createMobileBoot({ win = typeof window !== 'undefined' ? window : undefined, capacitor, history, document: doc } = {}) {
  const cap = capacitor ?? win?.Capacitor;
  const hist = history ?? win?.history;
  const docRef = doc ?? win?.document;

  function run() {
    const report = { native: false, apiOriginConfigured: false, splashHidden: false, statusBarApplied: false, backButtonWired: false, warned: [] };
    if (!isNativePlatform(cap)) return report;
    if (win?.__CH247_MOBILE_BOOTED__) return { ...report, native: true, alreadyBooted: true };
    if (win) win.__CH247_MOBILE_BOOTED__ = true;
    report.native = true;

    // 1. API origin for local-assets shells.
    let config = {};
    try {
      config = cap?.getConfig?.() ?? cap?.config ?? {};
    } catch {
      config = {};
    }
    const configured = config?.plugins?.CloudHost247?.apiOrigin ?? null;
    if (configured) {
      configureApiOrigin(configured, { win });
    }
    report.apiOriginConfigured = resolveApiOrigin({ win }) !== '';
    const hosted = Boolean(config?.server?.url);
    if (!report.apiOriginConfigured && !hosted) {
      report.warned.push(
        'This shell serves the app from local assets but has no API origin '
        + '(capacitor.config.json → plugins.CloudHost247.apiOrigin). API calls will hit the WebView origin and fail.',
      );
    }

    // 2. Splash screen away once the WebView is up. Guarded: a build without the plugin just keeps
    //    the native launch screen behaviour the platform default already defines.
    try {
      const splash = cap?.Plugins?.SplashScreen;
      if (splash?.hide) {
        splash.hide();
        report.splashHidden = true;
      }
    } catch {
      /* plugin missing or bridge not ready — not an app error */
    }

    // 3. Status bar from the same block the native side reads.
    try {
      const bar = cap?.Plugins?.StatusBar;
      const style = config?.plugins?.StatusBar?.style;
      const color = config?.plugins?.StatusBar?.backgroundColor;
      if (bar && (bar.setStyle || bar.setBackgroundColor)) {
        if (style && bar.setStyle) bar.setStyle({ style });
        if (color && bar.setBackgroundColor) bar.setBackgroundColor({ color });
        report.statusBarApplied = Boolean(bar.setStyle || bar.setBackgroundColor);
      }
    } catch {
      /* plugin missing — cosmetic, never fatal */
    }

    // 4. Android hardware back button.
    try {
      const appPlugin = cap?.Plugins?.App;
      if (appPlugin?.addListener && hist) {
        appPlugin.addListener('backButton', () => {
          if (hist.length > 1) {
            hist.back();
            return;
          }
          try {
            if (appPlugin.minimizeApp) appPlugin.minimizeApp();
            else if (appPlugin.exitApp) appPlugin.exitApp();
          } catch {
            /* nothing to do: staying on the root screen is safe */
          }
        });
        report.backButtonWired = true;
      }
    } catch {
      /* plugin missing — the OS default back behaviour stands */
    }

    // 5. Platform marker for CSS and feature hooks.
    try {
      if (docRef?.documentElement?.dataset) docRef.documentElement.dataset.platform = 'capacitor';
    } catch {
      /* no DOM in some test hosts */
    }

    for (const warning of report.warned) {
      try { console.warn(`[cloudhost247-mobile] ${warning}`); } catch { /* no console */ }
    }
    return report;
  }

  return { run };
}

/** Run the bootstrap against the real globals. Idempotent — safe to call from every entry. */
export function runMobileBoot() {
  return createMobileBoot().run();
}
