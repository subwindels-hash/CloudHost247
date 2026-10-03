/**
 * CloudHost247 Server Agent — Docker operation and backup tests.
 *
 * `docker.js` and `backups.js` were the last two files in the tree with no tests at all, and they are
 * the ones that actually touch a customer's machine: they write the compose project and its secrets,
 * run the containers, tar the data and restore over live volumes.
 *
 * These tests execute the real modules. External commands are not mocked at the module boundary —
 * `docker` and `tar` are *stub executables* placed first on PATH, so the assertions can see the exact
 * argv the agent would have run. That is the point: several of the defects below were about *which*
 * command was run (or that none was) rather than about the values returned, and a module-level mock
 * would have hidden them.
 *
 * The stubs are shell scripts with no dependencies, matching the agent's own dependency-free design.
 */
import assert from 'node:assert/strict';
import test, { describe, it } from 'node:test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

import {
  appLogs,
  appStatus,
  assertProjectName,
  deployApp,
  projectDir,
  runHealthcheck,
  teardownApp,
} from '../src/docker.js';
import { restoreBackup, runBackup } from '../src/backups.js';

const PROJECT = 'app_abc123';

/** Resolved before any sandbox patches PATH, so fixtures are built by the real tar. */
const REAL_TAR = execFileSync('sh', ['-c', 'command -v tar'], { encoding: 'utf8' }).trim();
const REAL_TAR_DIR = path.dirname(REAL_TAR);

/**
 * One isolated sandbox per test: apps dir, backup dir, stub bin dir, and an argv log.
 *
 * `dockerStub` is shell code run with the argv as "$@"; `delegateTar` makes the tar stub forward to
 * the real tar after logging (so extraction genuinely happens and can be asserted on disk).
 */
function sandbox(t, { dockerStub = 'exit 0', tarStub, delegateTar = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'ch247-agent-'));
  const binDir = path.join(root, 'bin');
  const appsDir = path.join(root, 'apps');
  const backupDir = path.join(root, 'backups');
  const logFile = path.join(root, 'calls.log');
  mkdirSync(binDir);
  mkdirSync(path.join(appsDir, PROJECT, 'volumes'), { recursive: true });
  mkdirSync(backupDir);

  const stub = (name, behaviour) => {
    const file = path.join(binDir, name);
    writeFileSync(
      file,
      `#!/bin/sh\n` +
        `printf '%s\\t%s\\n' '${name}' "$*" >> "$CH247_TEST_CALL_LOG"\n` +
        `${behaviour}\n`
    );
    chmodSync(file, 0o755);
  };
  stub('docker', dockerStub);
  stub('tar', delegateTar ? `exec "${REAL_TAR}" "$@"` : tarStub ?? 'exit 0');

  const modeLog = path.join(root, 'modes.log');
  const previousPath = process.env.PATH;
  const previousLog = process.env.CH247_TEST_CALL_LOG;
  const previousModeLog = process.env.CH247_TEST_MODE_LOG;
  process.env.PATH = `${binDir}:${previousPath}`;
  process.env.CH247_TEST_CALL_LOG = logFile;
  process.env.CH247_TEST_MODE_LOG = modeLog;
  t.after(() => {
    process.env.PATH = previousPath;
    for (const [key, previous] of [
      ['CH247_TEST_CALL_LOG', previousLog],
      ['CH247_TEST_MODE_LOG', previousModeLog],
    ]) {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  });

  /** Every external call the agent made, in order, as `${command} ${argv}`. */
  const calls = () => {
    try {
      return readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
    } catch {
      return [];
    }
  };
  /** The mode a stub observed on a file the instant it ran ('' when nothing was recorded). */
  const observedMode = (file) => {
    try {
      const line = readFileSync(modeLog, 'utf8')
        .split('\n')
        .find((l) => l.endsWith(` ${file}`));
      return line ? line.split(' ')[0] : '';
    } catch {
      return '';
    }
  };
  return { root, binDir, appsDir, backupDir, projectDir: path.join(appsDir, PROJECT), calls, observedMode, modeLog };
}

/** Builds a real gzip tar with the real tar, so fixtures are never products of a stub. */
function makeArchive(dir, name, members, extraArgs = []) {
  const src = mkdtempSync(path.join(dir, `src-${name}-`));
  for (const [rel, content] of Object.entries(members)) {
    const target = path.join(src, rel);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  const archive = path.join(dir, name);
  execFileSync(REAL_TAR, [...extraArgs, '-czf', archive, '-C', src, '.']);
  return archive;
}

// --- project name / path safety ------------------------------------------------------------------

test('project names are validated before any path is built from them', () => {
  assert.equal(assertProjectName('app_abc123'), 'app_abc123');
  for (const bad of ['../etc', 'app/../../etc', 'ab', 'UPPER1234', 'app name', '', '-leading', 'a'.repeat(65)]) {
    assert.throws(() => assertProjectName(bad), /Invalid project name/, `expected rejection of ${JSON.stringify(bad)}`);
  }
  assert.throws(() => projectDir('/opt/apps', '../../etc'), /Invalid project name/);
});

// --- deploy -------------------------------------------------------------------------------------

test('deploy writes compose.yaml 0640 and .env 0600, then brings the project up', async (t) => {
  const box = sandbox(t);
  const result = await deployApp(box.appsDir, PROJECT, {
    composeYaml: 'services:\n  app:\n    image: nginx\n',
    environment: { DB_PASSWORD: 'p@ss word#1', PLAIN: 'value' },
  });

  assert.deepEqual(result, { project: PROJECT, started: true, output: '' });
  assert.equal(statSync(path.join(box.projectDir, 'compose.yaml')).mode & 0o777, 0o640);
  const envFile = path.join(box.projectDir, '.env');
  assert.equal(statSync(envFile).mode & 0o777, 0o600, 'the secret file must never be group/world readable');
  assert.equal(readFileSync(envFile, 'utf8'), 'DB_PASSWORD="p@ss word#1"\nPLAIN=value\n');
  assert.deepEqual(box.calls(), [
    `docker\tcompose --project-directory ${box.projectDir} up --detach --pull always --remove-orphans`,
  ]);
});

test('environment entries that would let a secret escape its line are rejected or escaped', async (t) => {
  const box = sandbox(t);
  await assert.rejects(
    () => deployApp(box.appsDir, PROJECT, { composeYaml: 'x', environment: { 'BAD KEY': 'v' } }),
    /Invalid environment variable name/
  );
  await assert.rejects(
    () => deployApp(box.appsDir, PROJECT, { composeYaml: 'x', environment: { OK: { nested: true } } }),
    /Invalid environment variable value/
  );
  await deployApp(box.appsDir, PROJECT, { composeYaml: 'x', environment: { A: 'one\ntwo', B: 'has"quote' } });
  const env = readFileSync(path.join(box.projectDir, '.env'), 'utf8');
  assert.equal(env, 'A="one\\ntwo"\nB="has\\"quote"\n');
  assert.equal(env.trim().split('\n').length, 2, 'a newline in a value must not become a second variable');
});

// --- status / logs / teardown -------------------------------------------------------------------

test('appStatus understands both JSON-array and newline-delimited compose ps output', async (t) => {
  const box = sandbox(t, {
    dockerStub: `printf '%s\\n' '[{"Name":"p-app-1","State":"running","Health":"healthy"}]'`,
  });
  assert.deepEqual(await appStatus(box.appsDir, PROJECT), {
    running: true,
    containers: [{ name: 'p-app-1', state: 'running', health: 'healthy' }],
  });
  assert.match(box.calls()[0], / ps --format json$/);
});

test('appStatus reports an exited container as not running, and a node without health as undefined', async (t) => {
  const box = sandbox(t, {
    dockerStub: `printf '{"Name":"p-app-1","State":"exited"}\\n{"Name":"p-db-1","State":"running"}\\n'`,
  });
  assert.deepEqual(await appStatus(box.appsDir, PROJECT), {
    running: true,
    containers: [
      { name: 'p-app-1', state: 'exited', health: undefined },
      { name: 'p-db-1', state: 'running', health: undefined },
    ],
  });

  const down = sandbox(t, { dockerStub: `printf '[{"Name":"p-app-1","State":"exited"}]'` });
  assert.equal((await appStatus(down.appsDir, PROJECT)).running, false);
});

test('logs are tailed with a clamped tail count', async (t) => {
  const box = sandbox(t);
  await appLogs(box.appsDir, PROJECT, 5); // below the floor
  await appLogs(box.appsDir, PROJECT, 99999); // above the ceiling
  assert.deepEqual(
    box.calls().map((c) => c.split('logs --tail ')[1]),
    ['10', '1000']
  );
});

test('teardown removes the project directory only when volumes are removed', async (t) => {
  const box = sandbox(t);
  await teardownApp(box.appsDir, PROJECT, false);
  assert.deepEqual(box.calls(), [
    `docker\tcompose --project-directory ${box.projectDir} down --remove-orphans`,
  ]);
  assert.equal(statSync(box.projectDir).isDirectory(), true, 'the project directory must survive');

  const box2 = sandbox(t);
  const result = await teardownApp(box2.appsDir, PROJECT, true);
  assert.equal(result.removed, true);
  assert.deepEqual(box2.calls(), [
    `docker\tcompose --project-directory ${box2.projectDir} down --volumes --remove-orphans`,
  ]);
  assert.throws(() => statSync(box2.projectDir), /ENOENT/, 'the project directory must be gone');
});

// --- health checks ------------------------------------------------------------------------------

test('an unsupported healthcheck type fails closed and names the supported types', async (t) => {
  const box = sandbox(t);
  const result = await runHealthcheck(box.appsDir, PROJECT, 'app', { type: 'icmp' });
  assert.equal(result.healthy, false, 'a check that was never executed must never report healthy');
  assert.match(result.detail, /unsupported healthcheck type "icmp"/);
  assert.match(result.detail, /supported: command, http, tcp/);
  assert.deepEqual(box.calls(), [], 'no probe should have been run for an unsupported type');
});

test('a command healthcheck with a malformed command fails closed instead of reporting a pass', async (t) => {
  const box = sandbox(t);
  for (const command of [undefined, 'curl localhost', []]) {
    const result = await runHealthcheck(box.appsDir, PROJECT, 'app', { type: 'command', command });
    assert.equal(result.healthy, false, `expected failure for command=${JSON.stringify(command)}`);
    assert.match(result.detail, /requires a non-empty command array/);
  }
  assert.deepEqual(box.calls(), []);
});

test('a real command healthcheck runs the declared command inside the service', async (t) => {
  const box = sandbox(t);
  assert.deepEqual(await runHealthcheck(box.appsDir, PROJECT, 'app', { type: 'command', command: ['nginx', '-t'] }), {
    healthy: true,
    detail: 'command healthcheck passed',
  });
  assert.deepEqual(box.calls(), [`docker\tcompose --project-directory ${box.projectDir} exec -T app nginx -t`]);
});

test('http and tcp checks probe inside the compose network and report the port and path', async (t) => {
  const box = sandbox(t);
  const http = await runHealthcheck(box.appsDir, PROJECT, 'app', {
    type: 'http',
    port: 8080,
    path: '/healthz',
    timeoutMs: 3000,
  });
  assert.equal(http.detail, 'http 200 on :8080/healthz');
  const tcp = await runHealthcheck(box.appsDir, PROJECT, 'app', { type: 'tcp', port: 5432 });
  assert.equal(tcp.detail, 'tcp connect ok on :5432');

  const [httpCall, tcpCall] = box.calls();
  assert.match(httpCall, /exec -T app sh -c curl -fsS -m 3 -o \/dev\/null http:\/\/127\.0\.0\.1:8080\/healthz/);
  assert.match(tcpCall, /exec -T app sh -c timeout 10 sh -c 'cat < \/dev\/null > \/dev\/tcp\/127\.0\.0\.1\/5432'/);
});

test('a failing probe is reported unhealthy with the command error, not thrown', async (t) => {
  const box = sandbox(t, { dockerStub: 'echo "connection refused" >&2; exit 1' });
  const result = await runHealthcheck(box.appsDir, PROJECT, 'app', { type: 'http' });
  assert.equal(result.healthy, false);
  assert.match(result.detail, /healthcheck failed/);
  assert.match(result.detail, /connection refused/);
});

test('the probe timeout is clamped to the 30s ceiling', async (t) => {
  const box = sandbox(t);
  await runHealthcheck(box.appsDir, PROJECT, 'app', { type: 'http', timeoutMs: 600_000 });
  assert.match(box.calls()[0], /curl -fsS -m 30 /);
});

// --- backup: the archive itself ------------------------------------------------------------------

test('the archive is created 0600 before tar runs, so it is never readable by another user', async (t) => {
  // The archive deliberately contains the project's .env, and tar creates its output from the process
  // umask (0644 for the usual 022): the file mode is the whole defence. The stub models tar's
  // behaviour faithfully by writing through `>` (open O_TRUNC), which keeps an existing file's mode.
  const box = sandbox(t, {
    tarStub:
      'while [ $# -gt 0 ]; do case "$1" in -czf) out=$2; shift 2;; *) shift;; esac; done; ' +
      // Record the mode of the file tar is about to write: this is the window the pre-create closes.
      'printf "%s %s\\n" "$(stat -c %a "$out" 2>/dev/null || echo MISSING)" "$out" >> "$CH247_TEST_MODE_LOG"; ' +
      'printf SECRETS > "$out"',
  });
  const result = await runBackup(box.appsDir, box.backupDir, PROJECT, {
    includeVolumes: true,
    includeDatabases: false,
  });

  // The archive must already be 0600 while tar runs, not merely after it: tar creates the file from
  // the process umask, so fixing the mode only afterwards leaves the secrets in .env world-readable
  // for the whole duration of the archive.
  assert.equal(box.observedMode(result.archivePath), '600', 'the archive must be 0600 before tar writes it');
  assert.equal(statSync(result.archivePath).mode & 0o777, 0o600);
  assert.equal(readFileSync(result.archivePath, 'utf8'), 'SECRETS');
  assert.equal(result.sizeBytes, 7);
  assert.equal(result.checksum, createHash('sha256').update('SECRETS').digest('hex'));
});

test('the archive path is timestamped inside the backup root and named after the project', async (t) => {
  const box = sandbox(t);
  const result = await runBackup(box.appsDir, box.backupDir, PROJECT, { includeDatabases: false });
  assert.equal(path.dirname(result.archivePath), box.backupDir);
  assert.match(path.basename(result.archivePath), new RegExp(`^${PROJECT}-\\d{4}-\\d{2}-\\d{2}T[\\d-]+Z\\.tar\\.gz$`));
});

// --- backup: database dumps ----------------------------------------------------------------------

/**
 * A `docker` stub whose `exec` results are driven by `<service>:<command>` → stdout.
 *
 * Argv is `docker compose --project-directory <dir> config --services` for the service list and
 * `docker compose --project-directory <dir> exec -T <service> <command>` for a probe, so the service
 * is $6 and the command is $7. Unlisted combinations exit 127 like a missing client binary.
 */
function dumpStub(table) {
  const { __services = '', ...cases } = table;
  const branches = Object.entries(cases)
    .map(([key, output]) => `    '${key}') printf '%s' ${JSON.stringify(output)}; exit 0 ;;`)
    .join('\n');
  // Each service is printed on its own line, exactly as `docker compose config --services` does.
  const serviceArgs = __services
    .split(/\s+/)
    .filter(Boolean)
    .map((s) => `'${s}'`)
    .join(' ');
  return [
    'if [ "$4" = "config" ]; then printf "%s\\n" ' + serviceArgs + '; exit 0; fi',
    'if [ "$4" = "exec" ]; then',
    `  case "$6:$7" in`,
    branches,
    `    *) echo "exec $6 $7: command not found" >&2; exit 127 ;;`,
    '  esac',
    'fi',
    'exit 0',
  ].join('\n');
}

test('a database dump is taken from whatever the database service is actually called', async (t) => {
  // Service names are free-form slugs in the manifest schema; the old implementation only ever tried a
  // service literally named `db`, so this project was dumped by nobody — and said nothing about it.
  const box = sandbox(t, {
    dockerStub: dumpStub({ __services: 'app postgres', 'postgres:pg_dumpall': 'PGDUMP-OK' }),
  });
  const result = await runBackup(box.appsDir, box.backupDir, PROJECT, { includeDatabases: true });

  assert.equal(result.databaseDump.engine, 'postgres');
  assert.equal(result.databaseDump.service, 'postgres');
  assert.equal(result.includes.databases, 'postgres');
  assert.equal(readFileSync(result.databaseDump.file, 'utf8'), 'PGDUMP-OK');
  assert.equal(statSync(result.databaseDump.file).mode & 0o777, 0o600);
  assert.match(box.calls().join('\n'), /config --services/);
});

test('a MongoDB project really gets a mongodump, captured as bytes', async (t) => {
  // `database: 'mongodb'` is a first-class manifest dependency and BSON is not text: decoding the dump
  // as utf8 replaces every invalid byte sequence, so it must be captured and written as a buffer.
  const box = sandbox(t, {
    dockerStub: [
      'if [ "$4" = "config" ]; then printf "app\\nmongo\\n"; exit 0; fi',
      'if [ "$4" = "exec" ]; then',
      '  case "$6:$7" in',
      '    mongo:pg_dumpall|mongo:mysqldump|mongo:mariadb-dump) exit 127 ;;',
      `    mongo:mongodump) printf '\\377\\376\\101BSON'; exit 0 ;;`,
      '    *) exit 127 ;;',
      '  esac',
      'fi',
      'exit 0',
    ].join('\n'),
  });
  const result = await runBackup(box.appsDir, box.backupDir, PROJECT, { includeDatabases: true });

  assert.equal(result.databaseDump.engine, 'mongodb');
  assert.equal(result.databaseDump.service, 'mongo');
  assert.match(result.databaseDump.file, /db-dump-mongodb\.archive$/);
  const bytes = readFileSync(result.databaseDump.file);
  assert.deepEqual([...bytes], [0xff, 0xfe, 0x41, 0x42, 0x53, 0x4f, 0x4e], 'the dump must survive byte-for-byte');
});

test('a requested dump that produced nothing says so instead of looking like a clean backup', async (t) => {
  const box = sandbox(t, { dockerStub: dumpStub({ __services: 'app cache', 'cache:pg_dumpall': '' }) });
  const result = await runBackup(box.appsDir, box.backupDir, PROJECT, { includeDatabases: true });

  assert.equal(result.databaseDump.engine, null);
  assert.equal(result.includes.databases, null);
  assert.match(result.databaseDump.reason, /no service produced a logical database dump/);
  assert.deepEqual(result.databaseDump.services, ['cache']);
  assert.deepEqual(result.databaseDump.attempted[0], 'cache:postgres (empty output)');
  assert.equal(result.databaseDump.attempted.length, 4, 'every engine must be recorded as attempted');
  assert.match(result.checksum, /^[0-9a-f]{64}$/, 'volume data is still archived — redis persists there');
});

test('the app service is never probed for a database client', async (t) => {
  const box = sandbox(t, { dockerStub: dumpStub({ __services: 'app', 'app:pg_dumpall': 'WRONG' }) });
  const result = await runBackup(box.appsDir, box.backupDir, PROJECT, { includeDatabases: true });
  assert.equal(result.databaseDump.engine, null);
  assert.deepEqual(result.databaseDump.reason, 'project defines no service other than app');
  assert.deepEqual(box.calls().filter((c) => c.includes('exec')), []);
});

test('a service list that cannot be read is reported, not silently treated as "no database"', async (t) => {
  const box = sandbox(t, {
    dockerStub: 'if [ "$4" = "config" ]; then echo "cannot reach docker daemon" >&2; exit 1; fi; exit 127',
  });
  const result = await runBackup(box.appsDir, box.backupDir, PROJECT, { includeDatabases: true });
  assert.equal(result.databaseDump.engine, null);
  assert.match(result.databaseDump.reason, /could not list compose services/);
  assert.match(result.databaseDump.reason, /cannot reach docker daemon/);
});

test('no dump is attempted when the caller did not ask for one', async (t) => {
  const box = sandbox(t);
  const result = await runBackup(box.appsDir, box.backupDir, PROJECT, { includeDatabases: false });
  assert.equal(result.databaseDump.reason, 'not requested');
  assert.equal(result.includes.databases, null);
  assert.deepEqual(box.calls().filter((c) => c.includes('exec ')), []);
});

test('the volumes flag does not narrow the archive, and the result says what was really included', async (t) => {
  // includeVolumes:false must not drop volumes/ — the database dump is written inside it, and a restore
  // of an archive missing it would bring back an app with no data.
  const box = sandbox(t);
  const result = await runBackup(box.appsDir, box.backupDir, PROJECT, { includeVolumes: false, includeDatabases: false });
  assert.deepEqual(result.includes, { volumes: true, databases: null });
  assert.match(box.calls().find((c) => c.startsWith('tar\t')), /-czf .* -C .* \.$/);
});

// --- restore -------------------------------------------------------------------------------------

test('restore refuses an archive that is not a readable gzip tar', async (t) => {
  const box = sandbox(t, { delegateTar: true });
  const broken = makeArchive(box.backupDir, 'truncated.tar.gz', { 'compose.yaml': 'services: {}\n' });
  writeFileSync(broken, readFileSync(broken).subarray(0, 30)); // truncated gzip stream

  await assert.rejects(
    () => restoreBackup(box.appsDir, box.backupDir, PROJECT, broken),
    /not a readable gzip tar/,
    'a truncated archive must not half-apply and then be reported as a successful restore'
  );
  assert.deepEqual(box.calls().filter((c) => c.includes('-xzf')), [], 'nothing may be extracted after a failed check');
});

test('restore refuses an empty archive instead of reporting a successful no-op', async (t) => {
  const box = sandbox(t, { delegateTar: true });
  const empty = path.join(box.backupDir, 'empty.tar.gz');
  writeFileSync(empty, gzipSync(Buffer.alloc(1024, 0))); // two zero blocks are tar's end-of-archive marker
  await assert.rejects(() => restoreBackup(box.appsDir, box.backupDir, PROJECT, empty), /empty \(no members\)/);
  assert.deepEqual(box.calls().filter((c) => c.includes('-xzf')), []);
});

test('restore refuses an archive whose member paths escape the project directory', async (t) => {
  const box = sandbox(t, { delegateTar: true });
  const staged = mkdtempSync(path.join(box.root, 'evil-'));
  writeFileSync(path.join(staged, 'passwd'), 'root::0:0');
  const evil = path.join(box.backupDir, 'evil.tar.gz');
  execFileSync(REAL_TAR, ['-czf', evil, '-C', staged, '--transform', 's|^\\./||;s|^passwd|/etc/passwd|', '.']);
  assert.match(execFileSync(REAL_TAR, ['-tzf', evil]).toString(), /^\/etc\/passwd/m);

  await assert.rejects(
    () => restoreBackup(box.appsDir, box.backupDir, PROJECT, evil),
    /unsafe member path: \/etc\/passwd/
  );
  assert.deepEqual(box.calls().filter((c) => c.includes('-xzf')), [], 'the escape must be refused before extraction');
});

test('restore verifies first, then extracts, and reports how many members it applied', async (t) => {
  const box = sandbox(t, { delegateTar: true });
  const archive = makeArchive(box.backupDir, 'good.tar.gz', {
    'compose.yaml': 'services: {}\n',
    '.env': 'X=1\n',
    'volumes/app/data.txt': 'payload',
  });
  const result = await restoreBackup(box.appsDir, box.backupDir, PROJECT, archive);

  assert.equal(result.restored, true);
  assert.equal(result.members, 6, 'three files, two directories and the "." root entry');
  assert.equal(readFileSync(path.join(box.projectDir, 'volumes/app/data.txt'), 'utf8'), 'payload');
  const [first, second] = box.calls();
  assert.match(first, /^tar\t-tzf /, 'the archive must be listed before anything is written');
  assert.match(second, /^tar\t-xzf /);
});

test('restore still refuses an archive outside the agent backup directory', async (t) => {
  const box = sandbox(t, { delegateTar: true });
  const outside = makeArchive(box.root, 'outside.tar.gz', { 'compose.yaml': 'x' });
  await assert.rejects(
    () => restoreBackup(box.appsDir, box.backupDir, PROJECT, outside),
    /restore path must be inside the agent backup directory/
  );
  // A sibling directory whose name merely starts with the backup root must not pass either.
  const sibling = `${box.backupDir}-sibling`;
  mkdirSync(sibling);
  await assert.rejects(
    () => restoreBackup(box.appsDir, box.backupDir, PROJECT, path.join(sibling, 'x.tar.gz')),
    /restore path must be inside the agent backup directory/
  );
  assert.deepEqual(box.calls(), [], 'neither refusal may reach a command');
});

// --- restore: integrity of the archive at rest ---------------------------------------------------

describe('restore verifies the archive against the recorded checksum', () => {
  /**
   * The control plane stores the sha256 the agent computed when the archive was created and sends it
   * back on restore. Without this check an archive damaged after the backup — a partial write, a full
   * disk, bit rot, a truncated copy — is extracted over the live project, because damage that still
   * decompresses passes `tar -t` and only shows up as missing or corrupted data afterwards.
   */
  it('extracts when the recorded checksum matches, and says the archive was verified', async (t) => {
    const box = sandbox(t, { delegateTar: true });
    const archive = makeArchive(box.backupDir, 'verified.tar.gz', {
      'compose.yaml': 'services: {}\n',
      'volumes/app/data.txt': 'payload',
    });
    const recorded = createHash('sha256').update(readFileSync(archive)).digest('hex');

    const result = await restoreBackup(box.appsDir, box.backupDir, PROJECT, archive, { expectedChecksum: recorded });

    assert.equal(result.restored, true);
    assert.equal(result.checksumVerified, true);
    assert.equal(readFileSync(path.join(box.projectDir, 'volumes/app/data.txt'), 'utf8'), 'payload');
  });

  it('refuses a damaged archive, and extracts nothing at all', async (t) => {
    const box = sandbox(t, { delegateTar: true });
    const archive = makeArchive(box.backupDir, 'damaged.tar.gz', {
      'compose.yaml': 'services: {}\n',
      'volumes/app/wallet.txt': 'important',
    });
    const recorded = createHash('sha256').update(readFileSync(archive)).digest('hex');

    // Flip one byte in the middle of the file. The gzip stream still decompresses and `tar -t` still
    // lists every member, which is exactly why the tar pass alone cannot catch this.
    const bytes = readFileSync(archive);
    bytes[Math.floor(bytes.length / 2)] ^= 0x20;
    writeFileSync(archive, bytes);

    await assert.rejects(
      () => restoreBackup(box.appsDir, box.backupDir, PROJECT, archive, { expectedChecksum: recorded }),
      /checksum mismatch/
    );
    assert.deepEqual(box.calls(), [], 'nothing may be read or written once the digest does not match');
    assert.throws(
      () => readFileSync(path.join(box.projectDir, 'volumes/app/wallet.txt')),
      /ENOENT/,
      'the live project must be untouched'
    );
  });

  it('names both digests in the refusal, so the damage is diagnosable', async (t) => {
    const box = sandbox(t, { delegateTar: true });
    const archive = makeArchive(box.backupDir, 'diagnose.tar.gz', { 'compose.yaml': 'x' });
    const recorded = 'a'.repeat(64);
    const actual = createHash('sha256').update(readFileSync(archive)).digest('hex');

    await assert.rejects(
      () => restoreBackup(box.appsDir, box.backupDir, PROJECT, archive, { expectedChecksum: recorded }),
      (err) => {
        assert.match(err.message, new RegExp(recorded));
        assert.match(err.message, new RegExp(actual));
        return true;
      }
    );
  });

  it('rejects a malformed checksum instead of treating it as no check', async (t) => {
    const box = sandbox(t, { delegateTar: true });
    const archive = makeArchive(box.backupDir, 'malformed.tar.gz', { 'compose.yaml': 'x' });
    const real = createHash('sha256').update(readFileSync(archive)).digest('hex');

    for (const bad of [real.toUpperCase(), real.slice(0, 63), ` ${real}`, `${real}0`, 'not-a-digest', '']) {
      await assert.rejects(
        () => restoreBackup(box.appsDir, box.backupDir, PROJECT, archive, { expectedChecksum: bad }),
        /expectedChecksum must be a lowercase sha256 hex digest/,
        `expected rejection of ${JSON.stringify(bad.slice(0, 12))}…`
      );
    }
    assert.deepEqual(box.calls(), []);
  });

  it('still restores when no checksum is on record, and reports that it was not verified', async (t) => {
    // An older backup row (or an older control plane) has nothing to check against. The restore must
    // still work — and must not report a verification that never happened.
    const box = sandbox(t, { delegateTar: true });
    const archive = makeArchive(box.backupDir, 'unverifiable.tar.gz', { 'compose.yaml': 'services: {}\n' });

    const result = await restoreBackup(box.appsDir, box.backupDir, PROJECT, archive);

    assert.equal(result.restored, true);
    assert.equal(result.checksumVerified, false);
    assert.equal(readFileSync(path.join(box.projectDir, 'compose.yaml'), 'utf8'), 'services: {}\n');
  });

  it('hashes the archive it writes exactly as it hashes the archive it verifies', async (t) => {
    // The streaming hash replaced a readFile+createHash pair in runBackup; if the two ever disagreed,
    // every restore of a freshly taken backup would be refused as corrupt.
    const box = sandbox(t, { delegateTar: true });
    writeFileSync(path.join(box.projectDir, 'compose.yaml'), 'services: {}\n');
    writeFileSync(path.join(box.projectDir, '.env'), 'DB_PASSWORD="secret"\n');

    const taken = await runBackup(box.appsDir, box.backupDir, PROJECT, { includeDatabases: false });
    assert.equal(
      taken.checksum,
      createHash('sha256').update(readFileSync(taken.archivePath)).digest('hex'),
      'the recorded checksum must be the digest of the archive that was written'
    );

    const result = await restoreBackup(box.appsDir, box.backupDir, PROJECT, taken.archivePath, {
      expectedChecksum: taken.checksum,
    });
    assert.equal(result.checksumVerified, true);
  });
});

// --- non-vacuity guard ---------------------------------------------------------------------------

test('the stub executables are on PATH, so the suite cannot silently test nothing', async (t) => {
  const box = sandbox(t);
  await appLogs(box.appsDir, PROJECT, 50);
  assert.equal(box.calls().length, 1, 'the docker stub must have been executed');
  assert.match(box.calls()[0], /^docker\tcompose /);
  assert.ok(REAL_TAR.startsWith(REAL_TAR_DIR), 'the real tar used for fixtures must be resolvable');
});
