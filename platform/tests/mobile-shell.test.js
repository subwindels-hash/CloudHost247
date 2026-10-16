'use strict';

/**
 * Mobile shell contract (`platform/mobile/`).
 *
 * Closes §1.3 ("no app code"): the Capacitor shell is the same SPA bundle plus `src/mobile-boot.js`,
 * and every behaviour here is verified against injected fakes — the API-origin resolution and its
 * refusal of invalid origins, the guarded native calls (splash, status bar, Android back button),
 * the honest warning when a local-assets shell has no API origin, idempotence, and the strict
 * no-op on the web. Also pins the config contract and the SPA wiring.
 *
 * What this file cannot verify: `cap add`, Gradle/Xcode builds and on-device behaviour — no
 * Android SDK or Xcode exists in this environment (see platform/mobile/README.md).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MOBILE_DIR = path.join(__dirname, '..', 'mobile');
const SPA_SRC = path.join(__dirname, '..', 'spa', 'src');

// The shell and the shared client are ES modules (they ship inside the SPA bundle); load them the
// same way Node's ESM loader does, so the tests execute the real code rather than a re-implementation.
const loadEsm = (relative) => import(pathToFileURL(path.join(__dirname, '..', relative)).href);

test('mobile shell: API origin resolution', async () => {
  const { resolveApiOrigin, configureApiOrigin, apiUrl } = await loadEsm('spa/src/lib/api.js');

  // Default: same-origin, exactly today's web behaviour.
  assert.strictEqual(resolveApiOrigin({ win: {}, storage: null }), '');

  // The bootstrap's window assignment wins over the localStorage override.
  assert.strictEqual(
    resolveApiOrigin({
      win: { __CH247_API_ORIGIN__: 'https://api.example.com' },
      storage: { getItem: (k) => (k === 'ch247.apiOrigin' ? 'https://override.example.com' : null) },
    }),
    'https://api.example.com',
  );

  // localStorage is the operator/runtime override when the bootstrap set nothing.
  assert.strictEqual(
    resolveApiOrigin({ win: {}, storage: { getItem: (k) => (k === 'ch247.apiOrigin' ? 'https://override.example.com' : null) } }),
    'https://override.example.com',
  );

  // Invalid origins are refused — never a half-working base. https required except loopback.
  for (const bad of ['not-a-url', '/relative/path', 'ftp://example.com', 'javascript:alert(1)', 'http://example.com']) {
    assert.strictEqual(
      resolveApiOrigin({ win: { __CH247_API_ORIGIN__: bad }, storage: null }), '',
      `invalid origin refused: ${bad}`,
    );
  }
  for (const good of ['http://localhost:8080', 'http://127.0.0.1:3000', 'https://api.example.com', 'https://api.example.com/platform/']) {
    assert.notStrictEqual(
      resolveApiOrigin({ win: { __CH247_API_ORIGIN__: good }, storage: null }), '',
      `valid origin accepted: ${good}`,
    );
  }

  // Trailing slashes are stripped; a path prefix is preserved; apiUrl prepends the resolved base.
  const win = { __CH247_API_ORIGIN__: 'https://api.example.com/platform/' };
  assert.strictEqual(resolveApiOrigin({ win, storage: null }), 'https://api.example.com/platform');
  assert.strictEqual(apiUrl('/api/v1/auth/login', { win, storage: null }), 'https://api.example.com/platform/api/v1/auth/login');
  assert.strictEqual(apiUrl('/api/v1/auth/login', { win: {}, storage: null }), '/api/v1/auth/login');

  // configureApiOrigin sets and clears the runtime override and reports what will be used.
  const target = {};
  assert.strictEqual(configureApiOrigin('https://api.example.com', { win: target }), 'https://api.example.com');
  assert.strictEqual(target.__CH247_API_ORIGIN__, 'https://api.example.com');
  assert.strictEqual(configureApiOrigin('', { win: target }), '');
  assert.ok(!('__CH247_API_ORIGIN__' in target), 'clearing removes the override');
});

test('mobile shell: bootstrap is a strict no-op on the web', async () => {
  const { createMobileBoot, isNativePlatform } = await loadEsm('mobile/src/mobile-boot.js');

  assert.strictEqual(isNativePlatform({}), false);
  assert.strictEqual(isNativePlatform({ isNativePlatform: () => false }), false);
  assert.strictEqual(isNativePlatform({ isNativePlatform: () => true }), true);

  const calls = { splash: 0, status: 0, listeners: 0 };
  const win = { Capacitor: undefined };
  const report = createMobileBoot({
    win,
    capacitor: { isNativePlatform: () => false, Plugins: { SplashScreen: { hide: () => { calls.splash += 1; } } } },
    history: { length: 2, back() {} },
    document: { documentElement: { dataset: {} } },
  }).run();

  assert.strictEqual(report.native, false, 'not native');
  assert.strictEqual(calls.splash, 0, 'no native call happens on the web');
  assert.ok(!('__CH247_MOBILE_BOOTED__' in win), 'the web never gets the boot marker');
});

test('mobile shell: native bootstrap configures, hides, wires — and never invents', async () => {
  const { createMobileBoot } = await loadEsm('mobile/src/mobile-boot.js');

  const calls = { splashHidden: 0, statusStyle: [], statusColor: [], listeners: [], backed: 0, minimized: 0, warned: [] };
  const win = { __CH247_API_ORIGIN__: 'https://set-earlier.example.com' };
  const fakeConsole = { warn: (msg) => calls.warned.push(msg) };
  const history = {
    length: 2,
    back() { calls.backed += 1; },
  };
  const doc = { documentElement: { dataset: {} } };

  const capacitor = {
    isNativePlatform: () => true,
    getConfig: () => ({
      plugins: {
        CloudHost247: { apiOrigin: 'https://api.example.com' },
        StatusBar: { style: 'LIGHT', backgroundColor: '#0756d8' },
      },
    }),
    Plugins: {
      SplashScreen: { hide: () => { calls.splashHidden += 1; } },
      StatusBar: {
        setStyle: (arg) => calls.statusStyle.push(arg),
        setBackgroundColor: (arg) => calls.statusColor.push(arg),
      },
      App: {
        addListener: (event, handler) => calls.listeners.push({ event, handler }),
        minimizeApp: () => { calls.minimized += 1; },
      },
    },
  };

  // Swap console.warn capture without touching the module: pass through the real console but
  // record — the boot warns via console.warn, so intercept for this test.
  const originalWarn = console.warn;
  console.warn = fakeConsole.warn;
  let report;
  try {
    report = createMobileBoot({ win, capacitor, history, document: doc }).run();
  } finally {
    console.warn = originalWarn;
  }

  assert.strictEqual(report.native, true);
  assert.strictEqual(report.apiOriginConfigured, true, 'the configured origin was applied');
  assert.strictEqual(win.__CH247_API_ORIGIN__, 'https://api.example.com', 'config beats an earlier runtime value');
  assert.strictEqual(report.splashHidden, true);
  assert.deepEqual(calls.statusStyle, [{ style: 'LIGHT' }], 'status bar style comes from the config');
  assert.deepEqual(calls.statusColor, [{ color: '#0756d8' }], 'status bar colour comes from the config');
  assert.strictEqual(report.backButtonWired, true);
  assert.strictEqual(calls.listeners.length, 1);
  assert.strictEqual(calls.listeners[0].event, 'backButton');
  assert.strictEqual(doc.documentElement.dataset.platform, 'capacitor', 'platform marker set');
  assert.deepEqual(report.warned, [], 'a configured shell warns about nothing');

  // Back button: history when there is somewhere to go back to…
  calls.listeners[0].handler();
  assert.strictEqual(calls.backed, 1, 'back navigates history');

  // …and minimise at the root, never an invented exit.
  history.length = 1;
  calls.listeners[0].handler();
  assert.strictEqual(calls.minimized, 1, 'at the root the app minimises');
  assert.strictEqual(calls.backed, 1, 'no history back at the root');

  // Idempotent: a second run changes nothing.
  const second = createMobileBoot({ win, capacitor, history, document: doc }).run();
  assert.strictEqual(second.alreadyBooted, true);
  assert.strictEqual(calls.splashHidden, 1, 'the splash is hidden exactly once');

  // Missing plugins: every call is guarded, the run still completes.
  const bare = createMobileBoot({
    win: {},
    capacitor: { isNativePlatform: () => true, getConfig: () => ({ plugins: { CloudHost247: { apiOrigin: 'https://api.example.com' } } }) },
    history: { length: 1, back() {} },
    document: { documentElement: { dataset: {} } },
  }).run();
  assert.strictEqual(bare.native, true);
  assert.strictEqual(bare.splashHidden, false, 'no plugin, no claim');
  assert.strictEqual(bare.backButtonWired, false);

  // The honest warning: a local-assets shell with no API origin says so, loudly.
  const orphan = createMobileBoot({
    win: {},
    capacitor: { isNativePlatform: () => true, getConfig: () => ({ plugins: {} }) },
    history: null,
    document: null,
  }).run();
  assert.strictEqual(orphan.apiOriginConfigured, false);
  assert.ok(orphan.warned.some((w) => w.includes('plugins.CloudHost247.apiOrigin')), 'the warning names the fix');

  // A hosted shell (server.url set) needs no origin and does not warn.
  const hosted = createMobileBoot({
    win: {},
    capacitor: { isNativePlatform: () => true, getConfig: () => ({ server: { url: 'https://app.example.com' }, plugins: {} }) },
    history: null,
    document: null,
  }).run();
  assert.deepEqual(hosted.warned, [], 'a hosted shell is fine without an apiOrigin');
});

test('mobile shell: capacitor config and package contract', async () => {
  const config = JSON.parse(fs.readFileSync(path.join(MOBILE_DIR, 'capacitor.config.json'), 'utf8'));
  assert.strictEqual(config.appId, 'com.cloudhost247.app');
  assert.strictEqual(config.appName, 'CloudHost247');
  assert.strictEqual(config.webDir, '../spa/dist', 'the shell wraps the SPA build, not a second UI');
  assert.ok(fs.existsSync(path.join(MOBILE_DIR, config.webDir, '..')), 'webDir parent exists');
  assert.ok(config.plugins?.CloudHost247 && 'apiOrigin' in config.plugins.CloudHost247,
    'the config carries the shell\'s API-origin slot');
  assert.ok(config.plugins?.SplashScreen, 'splash config present');
  assert.ok(config.plugins?.StatusBar, 'status bar config present');
  assert.strictEqual(config.server?.androidScheme, 'https');
  assert.strictEqual(config.android?.allowMixedContent, false, 'no mixed content');

  const pkg = JSON.parse(fs.readFileSync(path.join(MOBILE_DIR, 'package.json'), 'utf8'));
  for (const script of ['build:web', 'sync', 'sync:android', 'sync:ios', 'run:android', 'run:ios']) {
    assert.ok(pkg.scripts[script], `package script '${script}' exists`);
  }

  // The native trees are generated locally and ignored by design.
  const gitignore = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
  assert.ok(gitignore.includes('mobile/android/'), 'android tree is gitignored');
  assert.ok(gitignore.includes('mobile/ios/'), 'ios tree is gitignored');
});

test('mobile shell: SPA wiring pins', async () => {
  const mainSrc = fs.readFileSync(path.join(SPA_SRC, 'main.jsx'), 'utf8');
  assert.ok(mainSrc.includes('mobile/src/mobile-boot.js'), 'the entry runs the shell bootstrap');
  assert.ok(mainSrc.includes('HashRouter'), 'the native shell uses hash routing');
  assert.ok(mainSrc.includes('isNativePlatform'), 'the router swap is platform-aware');
  assert.ok(mainSrc.includes('!nativeShell'), 'the service worker is gated off the native shell');

  const apiSrc = fs.readFileSync(path.join(SPA_SRC, 'lib', 'api.js'), 'utf8');
  assert.ok(apiSrc.includes('resolveApiOrigin'), 'the shared client resolves the API origin');
  assert.equal((apiSrc.match(/fetch\(apiUrl\(/g) ?? []).length, 2, 'both fetch sites go through apiUrl');
});
