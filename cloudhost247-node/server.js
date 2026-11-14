/**
 * cPanel Passenger / LiteSpeed (lsnode) / Application Manager startup file.
 *
 * This file is intentionally plain CommonJS JavaScript (not TypeScript) because Passenger
 * launches it directly with the Node.js binary selected in cPanel's "Setup Node.js App" screen.
 *
 * Startup guarantees against cPanel 503 crash-loops:
 *   1. Caps libuv / Go (esbuild) / Rust Rayon (@napi-rs/canvas) / libvips (sharp) thread pools
 *      before any module loads so 32/64-core CloudLinux shared hosts with tight NPROC limits (20-35)
 *      never panic with EAGAIN on thread creation.
 *   2. Normalizes working directory to APP_ROOT and pre-loads <APP_ROOT>/.env without overriding
 *      host-injected variables.
 *   3. Fast path: when both dist/src/server.js and public/index.html exist, requires the compiled
 *      server immediately.
 *   4. Nested-package recovery: when a single complete pre-built zip was extracted into a
 *      subfolder, boots it with a clear warning.
 *   5. Non-blocking recovery build: when build output is missing (unless DISABLE_AUTO_BUILD=1),
 *      binds the Passenger socket/PORT immediately so PassengerStartTimeout never kills the build,
 *      installs missing devDependencies if needed, compiles TypeScript + Vite asynchronously under
 *      a PID-verified lock, and hot-mounts the compiled Fastify app onto the live HTTP server.
 */
'use strict';

// --- 1. CloudLinux LVE thread-pool safety (must run before any native module loads) ----------
process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '4';
process.env.GOMAXPROCS = process.env.GOMAXPROCS || '2';
process.env.RAYON_NUM_THREADS = process.env.RAYON_NUM_THREADS || '2';
process.env.VIPS_CONCURRENCY = process.env.VIPS_CONCURRENCY || '2';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const APP_ROOT = __dirname;
const compiledEntry = path.join(APP_ROOT, 'dist', 'src', 'server.js');
const distDir = path.join(APP_ROOT, 'dist');
const publicIndex = path.join(APP_ROOT, 'public', 'index.html');
const srcEntry = path.join(APP_ROOT, 'src', 'server.ts');
const tsconfigPath = path.join(APP_ROOT, 'tsconfig.json');
const frontendViteConfig = path.join(APP_ROOT, 'frontend', 'vite.config.ts');
const tscBin = path.join(APP_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
const tsModuleDir = path.join(APP_ROOT, 'node_modules', 'typescript');
const esbuildModuleDir = path.join(APP_ROOT, 'node_modules', 'esbuild');
const viteBin = path.join(APP_ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const buildLockDir = path.join(APP_ROOT, '.server-build-lock');
const buildLockOwnerFile = path.join(buildLockDir, 'owner.json');

const BUILD_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes max per build step on shared hosting
const LOCK_STALE_MS = 10 * 60 * 1000;

function log(lines) {
  const prefix = '[server.js] ';
  // eslint-disable-next-line no-console
  console.error(prefix + lines.join('\n' + prefix));
}

function isDisabled(name) {
  const value = String(process.env[name] || '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

function escapeHtml(input) {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Minimal .env loader so <APP_ROOT>/.env flags (DISABLE_AUTO_BUILD, PORT, JWT_SECRET, etc.) take
 * effect before dotenv loads and survive chdir() into a nested release directory.
 */
function preloadDotEnv(envFile) {
  try {
    if (!fs.existsSync(envFile)) return;
    const content = fs.readFileSync(envFile, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const trimmed = rawLine.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const body = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
      const eq = body.indexOf('=');
      if (eq === -1) continue;
      const key = body.slice(0, eq).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      if (process.env[key] !== undefined) continue;
      let val = body.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
        (val.startsWith("'") && val.endsWith("'") && val.length >= 2)
      ) {
        const quote = val[0];
        val = val.slice(1, -1);
        if (quote === '"') {
          val = val
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, '\t')
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, '\\');
        }
      } else {
        const commentIdx = val.indexOf(' #');
        if (commentIdx !== -1) val = val.slice(0, commentIdx).trim();
      }
      process.env[key] = val;
    }
  } catch (_) {
    // Non-fatal; host env vars may be sufficient.
  }
}

preloadDotEnv(path.join(APP_ROOT, '.env'));
try {
  process.chdir(APP_ROOT);
} catch (err) {
  log([`Warning: could not chdir to ${APP_ROOT}: ${err.message}`]);
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
      if (entry.name.startsWith('.dist-build-') || entry.name.startsWith('.')) continue;
      const nestedRoot = path.join(APP_ROOT, entry.name);
      const nestedEntry = path.join(nestedRoot, 'dist', 'src', 'server.js');
      if (!fs.existsSync(nestedEntry)) continue;
      let mtime = 0;
      try {
        mtime = fs.statSync(nestedEntry).mtimeMs;
      } catch (_) {
        // stat failed — still usable, sort last.
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
    'dist/src/server.js is missing at <APP_ROOT>, but a complete pre-built package was found in a nested folder:',
    `  ${build.root}`,
    'Starting that build now as a RECOVERY path. This is not the intended layout —',
    `move the CONTENTS of ${build.root} into ${APP_ROOT}`,
    'at the next maintenance window, then Restart the application.',
    'See DEPLOY.txt / docs/CPANEL_DEPLOYMENT.md in the release package.',
  ]);
  // <APP_ROOT>/.env was already preloaded above; also preload nested .env as fallback and chdir
  // into build.root so relative config/ and manifests/ paths inside the package resolve cleanly.
  preloadDotEnv(path.join(build.root, '.env'));
  try {
    process.chdir(build.root);
  } catch (err) {
    log([`Warning: could not chdir to ${build.root}: ${err.message}`]);
  }
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

function writeLockOwner() {
  try {
    fs.writeFileSync(
      buildLockOwnerFile,
      JSON.stringify({ pid: process.pid, startedAt: Date.now() }),
      'utf8'
    );
  } catch (_) {
    // Best-effort metadata for immediate dead-PID recovery.
  }
}

/**
 * Atomic mkdir-based lock with dead-PID detection. If a previous Passenger worker was SIGKILLed
 * mid-build by CloudLinux LVE, its dead PID in owner.json lets us reclaim the lock immediately
 * instead of stalling for 10 minutes.
 */
function acquireBuildLock() {
  try {
    fs.mkdirSync(buildLockDir);
    writeLockOwner();
    return 'acquired';
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;

    let stale = false;
    try {
      if (fs.existsSync(buildLockOwnerFile)) {
        const owner = JSON.parse(fs.readFileSync(buildLockOwnerFile, 'utf8'));
        if (owner && Number.isInteger(owner.pid) && owner.pid !== process.pid && !isPidAlive(owner.pid)) {
          stale = true;
        }
      }
      if (!stale) {
        const age = Date.now() - fs.statSync(buildLockDir).mtimeMs;
        if (age > LOCK_STALE_MS) stale = true;
      }
    } catch (_) {
      stale = true;
    }

    if (stale) {
      try {
        fs.rmSync(buildLockDir, { recursive: true, force: true });
        fs.mkdirSync(buildLockDir);
        writeLockOwner();
        return 'acquired';
      } catch (_) {
        // Another worker won the race; fall through to wait.
      }
    }
    return 'wait';
  }
}

function releaseBuildLock() {
  try {
    fs.rmSync(buildLockDir, { recursive: true, force: true });
  } catch (_) {
    // Best effort only.
  }
}

function buildChildEnv(extraEnv) {
  const env = Object.assign({}, process.env, extraEnv || {});
  if (!env.NODE_OPTIONS || !env.NODE_OPTIONS.includes('--max-old-space-size')) {
    env.NODE_OPTIONS = ((env.NODE_OPTIONS || '') + ' --max-old-space-size=1536').trim();
  }
  env.GOMAXPROCS = env.GOMAXPROCS || '2';
  env.UV_THREADPOOL_SIZE = env.UV_THREADPOOL_SIZE || '4';
  env.RAYON_NUM_THREADS = env.RAYON_NUM_THREADS || '2';
  env.VIPS_CONCURRENCY = env.VIPS_CONCURRENCY || '2';
  return env;
}

/**
 * Low-memory server transpiler script executed in a short-lived child process.
 * Full `tsc -p tsconfig.json` typechecking allocates ~900 MB+ (due to AWS SDK + large generated
 * JSON ASTs), which gets OOM-killed on 1 GB CloudLinux cPanel LVE containers. File-by-file
 * transpilation via TypeScript's own `transpileModule` (or esbuild) emits identical CommonJS
 * output in ~2 seconds using < 80 MB of RAM, and copies JSON assets imported via resolveJsonModule.
 */
const LOW_MEM_TRANSPILER_SCRIPT = `
'use strict';
const fs = require('fs');
const path = require('path');
const outRoot = process.env.CH247_OUT_DIR;
const appRoot = process.cwd();

function walk(dir, acc) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

let transpileFn = null;
try {
  const ts = require('typescript');
  transpileFn = (code, fileName) => ts.transpileModule(code, {
    fileName,
    compilerOptions: {
      target: ts.ScriptTarget.ES2021,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      esModuleInterop: true,
      resolveJsonModule: true,
      sourceMap: false,
    },
  }).outputText;
} catch (_) {
  const esbuild = require('esbuild');
  transpileFn = (code, fileName) => esbuild.transformSync(code, {
    loader: 'ts',
    format: 'cjs',
    target: 'es2021',
    sourcefile: fileName,
  }).code;
}

const files = [...walk(path.join(appRoot, 'src'), []), ...walk(path.join(appRoot, 'database'), [])];
let count = 0;
for (const file of files) {
  const rel = path.relative(appRoot, file);
  if (file.endsWith('.d.ts')) continue;
  if (file.endsWith('.ts')) {
    const dest = path.join(outRoot, rel.replace(/\\.ts$/, '.js'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const src = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(dest, transpileFn(src, file), 'utf8');
    count += 1;
  } else if (file.endsWith('.json')) {
    const dest = path.join(outRoot, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(file, dest);
  }
}
console.error('[server.js] Transpiled ' + count + ' server modules into ' + outRoot);
`;

function runStepAsync(label, cmd, args, extraEnv) {
  log([label]);
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(cmd, args, {
      cwd: APP_ROOT,
      env: buildChildEnv(extraEnv),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const tail = [];
    const pushLines = (chunk) => {
      const text = chunk.toString('utf8');
      process.stderr.write(text);
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) {
          tail.push(line.trim());
          if (tail.length > 25) tail.shift();
        }
      }
    };

    if (child.stdout) child.stdout.on('data', pushLines);
    if (child.stderr) child.stderr.on('data', pushLines);

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill('SIGKILL');
      } catch (_) {
        // ignore
      }
      log([`${label} timed out after ${Math.round(BUILD_TIMEOUT_MS / 1000)}s.`]);
      resolve({ ok: false, detail: `${label} timed out`, tail });
    }, BUILD_TIMEOUT_MS);
    timer.unref();

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      log([`${label} failed to start: ${err.message}`]);
      resolve({ ok: false, detail: err.message, tail });
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ ok: true, tail });
      } else {
        const why = signal ? `killed by ${signal}` : `exit code ${code}`;
        log([`${label} failed (${why}).`]);
        resolve({ ok: false, detail: `${label} failed (${why})`, tail });
      }
    });
  });
}

function resolveNpmCommand() {
  const siblingNpmCli = path.join(
    path.dirname(process.execPath),
    '..',
    'lib',
    'node_modules',
    'npm',
    'bin',
    'npm-cli.js'
  );
  if (fs.existsSync(siblingNpmCli)) {
    return { cmd: process.execPath, prefixArgs: [siblingNpmCli] };
  }
  const siblingNpm = path.join(path.dirname(process.execPath), 'npm');
  if (fs.existsSync(siblingNpm)) {
    return { cmd: siblingNpm, prefixArgs: [] };
  }
  return { cmd: 'npm', prefixArgs: [] };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function newestSourceMtimeMs(dirs) {
  let newest = 0;
  const stack = dirs.slice();
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir || !fs.existsSync(dir)) continue;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.json')) {
        try {
          const mtime = fs.statSync(full).mtimeMs;
          if (mtime > newest) newest = mtime;
        } catch (_) {
          // ignore race
        }
      }
    }
  }
  return newest;
}

/**
 * Returns true if dist/src/server.js is missing OR (when src/ exists in a git checkout) older
 * than src/ or compiled from a pre-resilience revision. Ensures `git pull` + Passenger Restart
 * never silently boots stale dist/ code from an earlier commit.
 */
function isServerBuildOutdated() {
  if (!fs.existsSync(compiledEntry)) return true;
  if (!fs.existsSync(srcEntry)) return false;
  try {
    const entryCode = fs.readFileSync(compiledEntry, 'utf8');
    if (!entryCode.includes('createRuntimeApp')) return true;
    const compiledMtime = fs.statSync(compiledEntry).mtimeMs;
    const srcMtime = newestSourceMtimeMs([
      path.join(APP_ROOT, 'src'),
      path.join(APP_ROOT, 'database'),
    ]);
    return srcMtime > compiledMtime + 1000;
  } catch (_) {
    return true;
  }
}

async function waitForConcurrentBuild(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isServerBuildOutdated() && fs.existsSync(publicIndex)) return true;
    // If the lock disappeared or its owner died without producing the build, stop waiting early.
    if (!fs.existsSync(buildLockDir)) {
      return !isServerBuildOutdated() && fs.existsSync(publicIndex);
    }
    try {
      if (fs.existsSync(buildLockOwnerFile)) {
        const owner = JSON.parse(fs.readFileSync(buildLockOwnerFile, 'utf8'));
        if (owner && Number.isInteger(owner.pid) && !isPidAlive(owner.pid)) {
          return false;
        }
      }
    } catch (_) {
      // keep waiting briefly
    }
    await sleep(1000);
  }
  return !isServerBuildOutdated() && fs.existsSync(publicIndex);
}

async function runAsyncRecoveryBuild(onPhase) {
  const needServerBuild = isServerBuildOutdated();
  const needFrontendBuild = !fs.existsSync(publicIndex);

  const sourceMissing = [];
  if (needServerBuild && !fs.existsSync(srcEntry)) sourceMissing.push('src/server.ts');
  if (needServerBuild && !fs.existsSync(tsconfigPath)) sourceMissing.push('tsconfig.json');
  if (needFrontendBuild && !fs.existsSync(frontendViteConfig)) sourceMissing.push('frontend/vite.config.ts');
  if (sourceMissing.length > 0) {
    return { ok: false, reason: 'missing-source', missing: sourceMissing };
  }

  let lockState;
  try {
    lockState = acquireBuildLock();
  } catch (err) {
    return { ok: false, reason: 'lock-error', error: err.message };
  }

  if (lockState === 'wait') {
    onPhase('Waiting for in-progress application build…');
    log(['Another worker is already building dist/ — waiting asynchronously for it to finish…']);
    if (await waitForConcurrentBuild(BUILD_TIMEOUT_MS)) {
      return { ok: true, waited: true };
    }
    // Re-attempt lock acquisition in case the previous builder died mid-flight.
    try {
      lockState = acquireBuildLock();
    } catch (err) {
      return { ok: false, reason: 'lock-error', error: err.message };
    }
    if (lockState !== 'acquired') {
      return { ok: false, reason: 'wait-timeout' };
    }
  }

  let tempDir = null;
  try {
    // On cPanel with Application mode = Production, "Run NPM Install" runs with NODE_ENV=production
    // and skips devDependencies (typescript, vite, @vitejs/plugin-react). When only the server
    // needs transpilation (e.g. after `git pull`), install just `typescript` (~22 MB, 0 sub-deps)
    // rather than all devDependencies (which include Playwright/Chromium).
    const freshNeedServer = isServerBuildOutdated();
    const freshNeedFrontend = !fs.existsSync(publicIndex);
    const hasServerTranspiler = () => fs.existsSync(tsModuleDir) || fs.existsSync(esbuildModuleDir);

    if (freshNeedFrontend && !fs.existsSync(viteBin)) {
      onPhase('Installing TypeScript and frontend build tools…');
      const npmBin = resolveNpmCommand();
      const installStep = await runStepAsync(
        'Installing missing build devDependencies (npm install --include=dev)…',
        npmBin.cmd,
        [...npmBin.prefixArgs, 'install', '--include=dev', '--no-audit', '--no-fund'],
        { NODE_ENV: 'development', npm_config_production: 'false' }
      );
      if (!installStep.ok || !fs.existsSync(viteBin) || (freshNeedServer && !hasServerTranspiler())) {
        const missingTools = [];
        if (freshNeedServer && !hasServerTranspiler()) missingTools.push('node_modules/typescript');
        if (!fs.existsSync(viteBin)) missingTools.push('node_modules/vite/bin/vite.js');
        return {
          ok: false,
          reason: 'missing-tooling',
          missing: missingTools,
          detail: installStep.detail,
        };
      }
    } else if (freshNeedServer && !hasServerTranspiler()) {
      onPhase('Installing TypeScript transpiler…');
      const npmBin = resolveNpmCommand();
      const installStep = await runStepAsync(
        'Installing TypeScript transpiler (npm install --no-save typescript)…',
        npmBin.cmd,
        [...npmBin.prefixArgs, 'install', '--no-save', '--no-package-lock', '--no-audit', '--no-fund', 'typescript@^5.5.4'],
        { NODE_ENV: 'development', npm_config_production: 'false' }
      );
      if (!installStep.ok || !hasServerTranspiler()) {
        return {
          ok: false,
          reason: 'missing-tooling',
          missing: ['node_modules/typescript'],
          detail: installStep.detail,
        };
      }
    }

    if (freshNeedServer) {
      onPhase('Compiling TypeScript server…');
      tempDir = fs.mkdtempSync(path.join(APP_ROOT, '.dist-build-'));
      const tscStep = await runStepAsync(
        'Recovery build: transpiling TypeScript server (low-memory mode)…',
        process.execPath,
        ['-e', LOW_MEM_TRANSPILER_SCRIPT],
        { CH247_OUT_DIR: tempDir }
      );
      if (!tscStep.ok) {
        return { ok: false, reason: 'tsc-failed', detail: tscStep.detail };
      }
      if (!fs.existsSync(path.join(tempDir, 'src', 'server.js'))) {
        return { ok: false, reason: 'no-compiled-entry' };
      }
    }

    if (freshNeedFrontend) {
      onPhase('Building frontend static assets…');
      const viteStep = await runStepAsync(
        'Recovery build: building frontend static assets…',
        process.execPath,
        [viteBin, 'build', '--config', frontendViteConfig]
      );
      if (!viteStep.ok) {
        return { ok: false, reason: 'vite-failed', detail: viteStep.detail };
      }
      if (!fs.existsSync(publicIndex)) {
        return { ok: false, reason: 'no-public-index' };
      }
    }

    if (tempDir) {
      fs.rmSync(distDir, { recursive: true, force: true });
      fs.chmodSync(tempDir, 0o755);
      fs.renameSync(tempDir, distDir);
      tempDir = null;
    }

    log(['Recovery build succeeded — mounting compiled application.']);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'exception', error: err.message };
  } finally {
    if (tempDir) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (_) {
        // best effort
      }
    }
    releaseBuildLock();
  }
}

function printFatalDiagnostics(result) {
  const nested = findNestedBuilds();
  const has = (p) => (fs.existsSync(p) ? 'yes' : 'NO');
  const lines = [
    'Compiled application not ready (dist/src/server.js or public/index.html missing).',
    `  app root (__dirname): ${APP_ROOT}`,
    `  cwd: ${process.cwd()}`,
    `  node: ${process.version}`,
    `  src/server.ts: ${has(srcEntry)}`,
    `  tsconfig.json: ${has(tsconfigPath)}`,
    `  frontend/vite.config.ts: ${has(frontendViteConfig)}`,
    `  TypeScript compiler: ${has(tscBin)}`,
    `  Vite compiler: ${has(viteBin)}`,
    `  dist/src/server.js: ${has(compiledEntry)}`,
    `  public/index.html: ${has(publicIndex)}`,
  ];

  if (result.reason === 'disabled') {
    lines.push('', '  Auto-build is disabled (DISABLE_AUTO_BUILD=1) — failing fast as requested.');
  } else if (result.reason === 'missing-tooling' || result.reason === 'missing-source') {
    lines.push(
      '',
      `  Auto-build could not proceed — missing: ${(result.missing || []).join(', ')}`,
      '  Run "npm ci && npm run build" in the cPanel virtual-environment terminal, or upload the pre-built cPanel zip.'
    );
  } else if (result.reason === 'wait-timeout') {
    lines.push('', '  Timed out waiting for another worker to finish the recovery build.');
  } else if (result.reason === 'lock-error') {
    lines.push('', `  Could not acquire build lock: ${result.error}`);
  } else if (result.reason === 'exception') {
    lines.push('', `  Recovery build threw: ${result.error}`);
  } else if (result.detail) {
    lines.push('', `  Build step failed: ${result.detail}`);
  }

  if (nested.length > 0) {
    lines.push('', `  Nested pre-built package(s) found (${nested.length}):`);
    for (const build of nested) {
      lines.push(
        `    ${build.root}${build.hasPublic ? '' : '  [INCOMPLETE: public/index.html missing]'}`
      );
    }
    lines.push(
      '  Fix: move the CONTENTS of the correct nested folder into <APP_ROOT>, then Restart.'
    );
  }

  lines.push(
    '',
    '  Fix — pick ONE:',
    '    A) Build on the server (needs terminal access):',
    '         cPanel -> Setup Node.js App -> "Enter to virtual environment", then run:',
    '           npm ci && npm run build',
    '         Then Restart the application.',
    '    B) Pre-built cPanel package (no server-side build required):',
    '         On a workstation/CI:  cd cloudhost247-node && bash scripts/package-cpanel.sh',
    '         Upload release/cloudhost247-cpanel-<sha>.zip, Extract, move its CONTENTS into',
    '         <APP_ROOT>, run "npm ci --omit=dev", then Restart.',
    '',
    '  See docs/CPANEL_DEPLOYMENT.md §0a/§2 and Appendix B.'
  );

  log(lines);
}

function resolveListenTarget() {
  const explicitSocket = (process.env.SOCKET_PATH || '').trim();
  if (explicitSocket) return { path: explicitSocket };

  const rawPort = (process.env.PORT || '').trim();
  if (rawPort && /^(\/|unix:|\\\\\.\\pipe\\)/i.test(rawPort)) {
    return { path: rawPort.replace(/^unix:/i, '') };
  }

  const parsedPort = Number(rawPort);
  const port = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : 3000;
  return { port, host: '0.0.0.0' };
}

function renderWarmupPage(phase) {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex">' +
    '<meta http-equiv="refresh" content="5">' +
    '<title>Starting CloudHost247…</title>' +
    '<style>body{margin:0;background:#101e2c;color:#fff;font:16px/1.65 system-ui,-apple-system,sans-serif}' +
    'main{max-width:680px;margin:12vh auto;padding:32px}' +
    '.badge{display:inline-block;background:#1d354d;color:#b4f2cd;padding:4px 10px;border-radius:4px;font-size:13px;font-weight:600;margin-bottom:16px}' +
    'h1{font-size:clamp(28px,4vw,40px);margin:0 0 12px}p{color:#c6d3dd}' +
    '.status{background:#16283a;border:1px solid #294661;border-radius:8px;padding:16px 20px;margin-top:20px;color:#b4f2cd;font-family:ui-monospace,monospace;font-size:14px}' +
    '</style></head><body><main>' +
    '<span class="badge">CloudHost247 Platform</span>' +
    '<h1>Preparing application…</h1>' +
    '<p>CloudHost247 is completing its one-time startup build. This page refreshes automatically every 5 seconds and will open as soon as compilation finishes.</p>' +
    `<div class="status">${escapeHtml(phase)}</div>` +
    '</main></body></html>'
  );
}

function renderBuildRequiredPage(reason) {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex">' +
    '<title>Build Required | CloudHost247</title>' +
    '<style>body{margin:0;background:#101e2c;color:#fff;font:16px/1.65 system-ui,-apple-system,sans-serif}' +
    'main{max-width:760px;margin:8vh auto;padding:32px}' +
    '.badge{display:inline-block;background:#1d354d;color:#b4f2cd;padding:4px 10px;border-radius:4px;font-size:13px;font-weight:600;margin-bottom:16px}' +
    'h1{font-size:clamp(28px,4vw,40px);margin:0 0 12px}p,li{color:#c6d3dd}' +
    '.card{background:#16283a;border:1px solid #294661;border-radius:8px;padding:20px;margin:20px 0}' +
    'code,pre{background:#0b1520;color:#b4f2cd;border-radius:4px;font-size:14px}' +
    'code{padding:2px 6px}pre{padding:12px;overflow-x:auto}</style></head><body><main>' +
    '<span class="badge">CloudHost247 Deployment Check</span>' +
    '<h1>Application Build Artifacts Missing</h1>' +
    `<p>The Node.js server is online, but compiled artifacts (<code>dist/src/server.js</code> and <code>public/index.html</code>) are missing and automatic build could not complete (<code>${escapeHtml(reason)}</code>).</p>` +
    '<div class="card"><strong>Option A — Build in cPanel Terminal:</strong>' +
    '<pre>npm ci && npm run build</pre>' +
    '<strong>Option B — Upload Pre-Built cPanel Package (Recommended for shared hosting):</strong>' +
    '<pre>cd cloudhost247-node && bash scripts/package-cpanel.sh</pre>' +
    '<p>Extract the generated <code>release/cloudhost247-cpanel-&lt;sha&gt;.zip</code> directly into your application root, run <code>npm ci --omit=dev</code>, and click <strong>Restart</strong> in cPanel.</p></div>' +
    '</main></body></html>'
  );
}

/**
 * Starts an HTTP listener immediately (preventing Passenger startup timeouts / 503 kills), runs
 * the recovery build in the background, and hot-mounts the compiled Fastify app onto the same
 * live http.Server once ready.
 */
async function startWithBackgroundRecovery() {
  let state = 'building';
  let currentPhase = 'Initializing startup recovery build…';
  let failReason = 'unknown';
  let mountedApp = null;
  let closeDbPool = null;

  let activeHandler = (req, res) => {
    const pathname = (req.url || '/').split(/[?#]/)[0] || '/';
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (state === 'building') {
      if (pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ status: 'starting', phase: currentPhase }));
        return;
      }
      if (pathname === '/ready' || pathname.startsWith('/api')) {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': '5' });
        res.end(
          JSON.stringify({
            status: 'starting',
            error: 'APPLICATION_STARTING',
            message: currentPhase,
          })
        );
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderWarmupPage(currentPhase));
      return;
    }

    if (pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ status: 'degraded', error: 'BUILD_REQUIRED', reason: failReason }));
      return;
    }
    if (pathname === '/ready' || pathname.startsWith('/api')) {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          status: 'error',
          error: 'BUILD_REQUIRED',
          reason: failReason,
          message: 'Compiled application artifacts (dist/ and public/) are missing. See stderr.log.',
        })
      );
      return;
    }
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderBuildRequiredPage(failReason));
  };

  const httpServer = http.createServer((req, res) => {
    activeHandler(req, res);
  });
  httpServer.keepAliveTimeout = 72000;

  const target = resolveListenTarget();
  if (target.path) {
    try {
      if (fs.existsSync(target.path)) fs.unlinkSync(target.path);
    } catch (_) {
      // Ignore if Passenger owns or just replaced the socket path.
    }
  }
  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(target, resolve);
  });
  log(['HTTP listener bound immediately while one-time recovery build runs in background.']);

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log([`Received ${signal}, shutting down…`]);
    releaseBuildLock();
    await new Promise((resolve) => httpServer.close(resolve));
    try {
      if (mountedApp) await mountedApp.close();
      if (closeDbPool) await closeDbPool();
    } catch (_) {
      // best effort
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  const buildResult = await runAsyncRecoveryBuild((phase) => {
    currentPhase = phase;
  });

  if (!buildResult.ok) {
    state = 'failed';
    failReason = buildResult.reason || 'build-failed';
    printFatalDiagnostics(buildResult);
    return;
  }

  try {
    currentPhase = 'Starting compiled application…';
    process.env.CH247_DEFER_AUTORUN = '1';
    const compiledServer = require(compiledEntry);
    const poolMod = require(path.join(APP_ROOT, 'dist', 'src', 'db', 'pool.js'));
    closeDbPool = poolMod.closePool;
    const { app } = compiledServer.createRuntimeApp();
    await app.ready();
    mountedApp = app;
    activeHandler = (req, res) => {
      app.server.emit('request', req, res);
    };
    state = 'ready';
    log(['Recovery build mounted cleanly — CloudHost247 application is now live.']);
  } catch (err) {
    state = 'failed';
    failReason = err && err.name === 'EnvValidationError' ? 'invalid-environment' : 'boot-error';
    log([`Failed to initialize compiled application after recovery build: ${err && err.message ? err.message : err}`]);
  }
}

// --- Entrypoint dispatch ----------------------------------------------------------------------
const hasCompleteFreshBuild = !isServerBuildOutdated() && fs.existsSync(publicIndex);

if (hasCompleteFreshBuild) {
  require(compiledEntry);
} else {
  const nested = findNestedBuilds();
  const canUseNested =
    !isDisabled('DISABLE_NESTED_BUILD') &&
    nested.length === 1 &&
    nested[0].hasPublic;

  if (canUseNested) {
    useNestedBuild(nested[0]);
    require(nested[0].entry);
  } else if (isDisabled('DISABLE_AUTO_BUILD') || isDisabled('FAIL_FAST_STARTUP')) {
    printFatalDiagnostics({ ok: false, reason: 'disabled' });
    process.exit(1);
  } else {
    startWithBackgroundRecovery().catch((err) => {
      log([`Fatal startup error: ${err && err.stack ? err.stack : err}`]);
      process.exit(1);
    });
  }
}
