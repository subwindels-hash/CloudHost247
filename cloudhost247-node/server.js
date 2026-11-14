/**
 * cPanel Passenger / Application Manager startup file.
 *
 * This file is intentionally plain CommonJS JavaScript (not TypeScript) because Passenger
 * launches it directly with the Node.js binary selected in cPanel's "Setup Node.js App" screen —
 * it does not run a build step for you. It loads the compiled application from dist/, which is
 * produced by `npm run build` (see package.json and docs/CPANEL_DEPLOYMENT.md).
 *
 * Do not put application logic in this file. Do not hardcode a port — the real listener is
 * configured in src/server.ts via process.env.PORT.
 *
 * Missing-build recovery (see docs/CPANEL_DEPLOYMENT.md, Appendix B):
 *   `dist/` is git-ignored build output, so a fresh source upload has no
 *   `dist/src/server.js` until the server is compiled. Passenger then crash-loops on this file
 *   forever. To stop that crash-loop, this file now:
 *     1. requires `dist/src/server.js` when it exists (the normal path);
 *     2. otherwise detects the common "pre-built zip extracted into a nested folder" mistake and
 *        starts that complete nested build, with a loud warning telling the operator to fix the
 *        layout at the next maintenance window;
 *     3. otherwise, when the TypeScript + Vite build tooling is installed, performs a one-time
 *        atomic recovery build (server into a temp dir, frontend into public/) under a lock, then
 *        requires the result;
 *     4. otherwise prints diagnostics and the exact fix, and exits cleanly (never a stack trace).
 *
 *   Set DISABLE_AUTO_BUILD=1 to skip step 3 and fail fast. Set DISABLE_NESTED_BUILD=1 to skip
 *   step 2 as well. Both are useful in CI and when an operator prefers to build manually in the
 *   cPanel virtual-environment terminal.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const APP_ROOT = __dirname;
const compiledEntry = path.join(APP_ROOT, 'dist', 'src', 'server.js');
const distDir = path.join(APP_ROOT, 'dist');
const publicIndex = path.join(APP_ROOT, 'public', 'index.html');
const srcEntry = path.join(APP_ROOT, 'src', 'server.ts');
const tsconfigPath = path.join(APP_ROOT, 'tsconfig.json');
const frontendViteConfig = path.join(APP_ROOT, 'frontend', 'vite.config.ts');
const tscBin = path.join(APP_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
const viteBin = path.join(APP_ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const buildLockDir = path.join(APP_ROOT, '.server-build-lock');

const BUILD_TIMEOUT_MS = 300000; // 5 minutes; shared hosting can be slow.
const LOCK_STALE_MS = 10 * 60 * 1000; // clean up a lock left by a killed Passenger process.

function isDisabled(name) {
  const value = process.env[name];
  return value === '1' || value === 'true' || value === 'yes';
}

function log(lines) {
  const prefix = '[server.js] ';
  // eslint-disable-next-line no-console
  console.error(prefix + lines.join('\n' + prefix));
}

/** Top-level folders that cannot be a mistakenly-extracted release package. */
const NON_PACKAGE_DIRS = new Set([
  'node_modules',
  'dist',
  'public',
  'release',
  'src',
  'frontend',
  'database',
  'tests',
  'e2e',
  'scripts',
  'tools',
  'docs',
  'config',
  'manifests',
  '.git',
  '.server-build-lock',
]);

/**
 * Find `cloudhost247-cpanel-<sha>/dist/src/server.js` (or any other nested pre-built package).
 * Returns newest-first so a stale leftover cannot silently win over a fresh upload.
 */
function findNestedBuilds() {
  const builds = [];
  try {
    for (const entry of fs.readdirSync(APP_ROOT, { withFileTypes: true })) {
      if (!entry.isDirectory() || NON_PACKAGE_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith('.dist-build-')) continue;
      const nestedRoot = path.join(APP_ROOT, entry.name);
      const nestedEntry = path.join(nestedRoot, 'dist', 'src', 'server.js');
      if (!fs.existsSync(nestedEntry)) continue;
      let mtime = 0;
      try {
        mtime = fs.statSync(nestedEntry).mtimeMs;
      } catch (_) {
        // stat failed — still usable, just sort it last.
      }
      builds.push({
        root: nestedRoot,
        entry: nestedEntry,
        hasPublic: fs.existsSync(path.join(nestedRoot, 'public', 'index.html')),
        mtime,
      });
    }
  } catch (err) {
    log([`Could not scan ${APP_ROOT} for a nested build: ${err.message}`]);
  }
  return builds.sort((a, b) => b.mtime - a.mtime);
}

function useNestedBuild(build) {
  log([
    'dist/src/server.js is missing, but a complete pre-built package was found in a nested folder:',
    `  ${build.root}`,
    'Starting that build now as a RECOVERY path. This is not the intended layout —',
    `move the CONTENTS of ${build.root} into ${APP_ROOT}`,
    'at the next maintenance window, then Restart the application.',
    'See DEPLOY.txt / docs/CPANEL_DEPLOYMENT.md in the release package.',
  ]);
  // dotenv/config reads .env from process.cwd(); keep env lookup at the configured app root.
  try {
    process.chdir(APP_ROOT);
  } catch (err) {
    log([`Warning: could not chdir to ${APP_ROOT}: ${err.message}`]);
  }
}

/** Atomic mkdir-based lock. Returns 'acquired', 'wait', or throws. */
function acquireBuildLock() {
  try {
    fs.mkdirSync(buildLockDir);
    return 'acquired';
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    let age = Infinity;
    try {
      age = Date.now() - fs.statSync(buildLockDir).mtimeMs;
    } catch (_) {
      // lock disappeared between mkdir and stat — treat as stale.
    }
    if (age > LOCK_STALE_MS) {
      try {
        fs.rmSync(buildLockDir, { recursive: true, force: true });
        fs.mkdirSync(buildLockDir);
        return 'acquired';
      } catch (_) {
        // Another process won the race; fall through to wait.
      }
    }
    return 'wait';
  }
}

function waitForRecoveryBuild(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  while (Date.now() < deadline) {
    if (fs.existsSync(compiledEntry) && fs.existsSync(publicIndex)) return true;
    // Atomics.wait is available on Node's main thread and blocks without spinning the CPU.
    Atomics.wait(sleeper, 0, 0, 1000);
  }
  return fs.existsSync(compiledEntry) && fs.existsSync(publicIndex);
}

function runStep(label, bin, args) {
  log([label]);
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd: APP_ROOT,
    stdio: 'inherit',
    timeout: BUILD_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    log([`${label} failed to start: ${result.error.message}`]);
    return false;
  }
  if (result.status !== 0) {
    const why = result.signal ? `killed by ${result.signal}` : `exit code ${result.status}`;
    log([`${label} failed (${why}). See the build output above.`]);
    return false;
  }
  return true;
}

/**
 * Build server + frontend into place without ever leaving a half-written dist/.
 * TypeScript emits to .dist-build-XXXX/ first; only after BOTH halves succeed do we swap it to
 * dist/. A concurrent Passenger worker waits on the lock instead of racing the compiler.
 */
function tryRecoveryBuild() {
  if (isDisabled('DISABLE_AUTO_BUILD')) {
    return { ok: false, reason: 'disabled' };
  }

  const missing = [];
  if (!fs.existsSync(srcEntry)) missing.push('src/server.ts');
  if (!fs.existsSync(tsconfigPath)) missing.push('tsconfig.json');
  if (!fs.existsSync(frontendViteConfig)) missing.push('frontend/vite.config.ts');
  if (!fs.existsSync(tscBin)) missing.push('node_modules/typescript/bin/tsc');
  if (!fs.existsSync(viteBin)) missing.push('node_modules/vite/bin/vite.js');
  if (missing.length > 0) {
    return { ok: false, reason: 'missing-tooling', missing };
  }

  let lockState;
  try {
    lockState = acquireBuildLock();
  } catch (err) {
    return { ok: false, reason: 'lock-error', error: err.message };
  }

  if (lockState === 'wait') {
    log(['Another startup is already building dist/ — waiting up to 5 minutes for it to finish…']);
    if (waitForRecoveryBuild(BUILD_TIMEOUT_MS)) {
      return { ok: true, waited: true };
    }
    return { ok: false, reason: 'wait-timeout' };
  }

  let tempDir = null;
  try {
    // A previous failed attempt may have left a partial dist/. It is generated output only.
    fs.rmSync(distDir, { recursive: true, force: true });
    tempDir = fs.mkdtempSync(path.join(APP_ROOT, '.dist-build-'));

    if (
      !runStep('Attempting one-time recovery build: compiling TypeScript server…', tscBin, [
        '-p',
        tsconfigPath,
        '--outDir',
        tempDir,
      ])
    ) {
      return { ok: false, reason: 'tsc-failed' };
    }

    if (
      !runStep('Attempting one-time recovery build: building frontend static assets…', viteBin, [
        'build',
        '--config',
        frontendViteConfig,
      ])
    ) {
      return { ok: false, reason: 'vite-failed' };
    }

    if (!fs.existsSync(path.join(tempDir, 'src', 'server.js'))) {
      log(['TypeScript finished but dist/src/server.js was not produced — check tsconfig rootDir/outDir.']);
      return { ok: false, reason: 'no-compiled-entry' };
    }
    if (!fs.existsSync(publicIndex)) {
      log(['Vite finished but public/index.html is missing — the SPA cannot be served.']);
      return { ok: false, reason: 'no-public-index' };
    }

    fs.rmSync(distDir, { recursive: true, force: true });
    // mkdtemp creates 0700; Passenger runs as the app owner, but 0755 keeps dist/ readable by
    // any cPanel tooling (migration CLI, File Manager) that inspects the build output.
    fs.chmodSync(tempDir, 0o755);
    fs.renameSync(tempDir, distDir);
    tempDir = null;
    log(['Recovery build succeeded — starting compiled application.']);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'exception', error: err.message };
  } finally {
    if (tempDir) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (_) {
        // best effort only
      }
    }
    try {
      fs.rmSync(buildLockDir, { recursive: true, force: true });
    } catch (_) {
      // best effort only
    }
  }
}

function printFatalDiagnostics(result) {
  const nested = findNestedBuilds();
  const has = (p) => (fs.existsSync(p) ? 'yes' : 'NO');
  const lines = [
    'Compiled application not found at dist/src/server.js.',
    `  app root (__dirname): ${APP_ROOT}`,
    `  cwd: ${process.cwd()}`,
    `  node: ${process.version}`,
    `  src/server.ts: ${has(srcEntry)}`,
    `  tsconfig.json: ${has(tsconfigPath)}`,
    `  frontend/vite.config.ts: ${has(frontendViteConfig)}`,
    `  TypeScript compiler: ${has(tscBin)}`,
    `  Vite compiler: ${has(viteBin)}`,
    `  public/index.html: ${has(publicIndex)}`,
  ];

  if (result.reason === 'disabled') {
    lines.push('', '  Auto-build is disabled (DISABLE_AUTO_BUILD=1) — failing fast as requested.');
  } else if (result.reason === 'missing-tooling') {
    lines.push(
      '',
      `  Auto-build skipped — missing: ${result.missing.join(', ')}`,
      '  A source-only upload cannot start without a build. Run "npm ci" (full install, NOT',
      '  --omit=dev) in the cPanel virtual-environment terminal, or use the pre-built zip.'
    );
  } else if (result.reason === 'wait-timeout') {
    lines.push('', '  Timed out waiting for another startup to finish the recovery build.');
  } else if (result.reason === 'lock-error') {
    lines.push('', `  Could not acquire build lock: ${result.error}`);
  } else if (result.reason === 'exception') {
    lines.push('', `  Recovery build threw: ${result.error}`);
  }

  if (nested.length > 0) {
    lines.push(
      '',
      `  Nested pre-built package(s) found (${nested.length}):`
    );
    for (const build of nested) {
      lines.push(
        `    ${build.root}${build.hasPublic ? '' : '  [INCOMPLETE: public/index.html missing]'}`
      );
    }
    if (!isDisabled('DISABLE_NESTED_BUILD')) {
      lines.push(
        '  A single complete nested package is normally started automatically. If you see this',
        '  message, either none of them is complete, or more than one was found (refusing to guess).'
      );
    }
    lines.push(
      '  Fix: move the CONTENTS of the correct nested folder into the application root',
      '  (server.js, dist/, public/, database/, manifests/, package.json must all sit directly',
      '  in <APP_ROOT>), then Restart.'
    );
  }

  lines.push(
    '',
    '  Fix — pick ONE:',
    '    A) Build on the server (needs terminal access):',
    '         cPanel → Setup Node.js App → "Enter to virtual environment", then run:',
    '           npm ci && npm run build',
    '         ("npm run build:server" alone is NOT enough — src/app.ts serves public/ and will',
    '          fail without public/index.html. Do NOT use "npm ci --omit=dev" here: TypeScript',
    '          and Vite are devDependencies.) Then Restart the application.',
    '    B) No terminal / builds keep getting killed (CloudLinux LVE limits) — pre-built zip:',
    '         On a laptop/CI:  cd cloudhost247-node && bash scripts/package-cpanel.sh',
    '         Upload release/cloudhost247-cpanel-<sha>.zip via File Manager, Extract, then move',
    '         the CONTENTS of cloudhost247-cpanel-<sha>/ into <APP_ROOT> (see DEPLOY.txt inside',
    '         the zip). Run "npm ci --omit=dev", then Restart. No server-side build is needed.',
    '',
    '  See docs/CPANEL_DEPLOYMENT.md §0a/§2 and Appendix B.',
    '  Set DISABLE_AUTO_BUILD=1 to skip the automatic build attempt and fail fast.'
  );

  log(lines);
}

let entryToRequire = compiledEntry;

if (!fs.existsSync(compiledEntry)) {
  const nested = findNestedBuilds();
  const canUseNested =
    !isDisabled('DISABLE_NESTED_BUILD') &&
    nested.length === 1 &&
    nested[0].hasPublic;

  if (canUseNested) {
    useNestedBuild(nested[0]);
    entryToRequire = nested[0].entry;
  } else {
    const result = tryRecoveryBuild();
    if (!result.ok) {
      printFatalDiagnostics(result);
      process.exit(1);
    }
  }
}

require(entryToRequire);
