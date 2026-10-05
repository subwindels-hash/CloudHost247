/**
 * Tests for scripts/rehash-passwords.js.
 *
 * The tool's whole reason to exist is honesty about what can and cannot be migrated, so the tests
 * are written around those guarantees:
 *
 *   - a bcrypt hash cannot be verified or re-hashed, so the only output allowed is a reset
 *     invitation whose token hashes to the row that was written (the row must actually be usable);
 *   - a stale scrypt hash must be reported and then left completely alone;
 *   - the same account must not accumulate invitations;
 *   - production must refuse to write tokens to nowhere.
 *
 * Each case runs the script as a real subprocess against a real JSON store on a temp DATA_DIR, so
 * argument parsing, config loading, storage and exit codes are all exercised as an operator gets
 * them.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const run = promisify(execFile);

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts/rehash-passwords.js');

const { JsonStore } = require('../src/store/json-store');
const { createLogger } = require('../src/core/logger');
const { uuidv7 } = require('../src/lib/ids');
const { hashPassword, isLegacyHash, needsRehash } = require('../src/lib/password');

// A real bcrypt-shaped hash. It is not a hash of any known password, and nothing here ever tries to
// verify it: the tool must treat it as unverifiable, and so must the test.
const LEGACY_HASH = 'bcrypt$2b$10$FakeButWellFormedLegacyHashValue000000000000000000000';
// Duplicated deliberately: an independent copy of the login route's sha256(token) rule.
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
// Production config refuses to load without a real secret; the tool still has to run on such a host.
const PROD_SECRET = 'test-only-jwt-secret-that-is-long-enough-for-production';

const silent = createLogger({ level: 'error' });

// JsonStore is an in-memory cache flushed to disk, and the tool runs as a separate process, so every
// phase opens its own store: seed, run the tool, then read back. A store left open would serve
// stale rows and mask exactly the bugs these tests exist to catch.
async function withDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rehash-'));
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function seed(dir, fn) {
  const store = new JsonStore({ dir, logger: silent });
  await store.connect();
  try {
    await fn(store);
  } finally {
    await store.close(); // flushes to disk
  }
}

async function read(dir, fn) {
  const store = new JsonStore({ dir, logger: silent });
  await store.connect();
  try {
    return await fn(store);
  } finally {
    await store.close();
  }
}

const invites = (dir) => read(dir, (store) => store.table('auth_recovery').find({ kind: 'password_reset' })
  .then((r) => r.rows));

const allRecoveryRows = (dir) => read(dir, (store) => store.table('auth_recovery').find({})
  .then((r) => r.rows));

function user(email, passwordHash) {
  return {
    id: uuidv7(),
    email,
    password_hash: passwordHash,
    full_name: 'Test Person',
  };
}

async function runTool(dir, args, env = {}) {
  const options = {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      DATA_DIR: dir,
      NODE_ENV: 'development',
      LOG_LEVEL: 'error',
      ...env,
    },
  };
  try {
    const { stdout, stderr } = await run(process.execPath, [SCRIPT, ...args], options);
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

test('rehash-passwords: dry run reports every hash that needs attention and writes nothing', async () => {
  await withDir(async (dir) => {
    const current = await hashPassword('correct horse battery staple');
    const stale = await hashPassword('another password', { N: 16384, r: 8, p: 1, keylen: 64 });
    assert.equal(needsRehash(current), false, 'the current parameters are current');
    assert.equal(needsRehash(stale), true, 'smaller N is stale');
    assert.equal(isLegacyHash(LEGACY_HASH), true);

    await seed(dir, async (store) => {
      await store.table('users').insert(user('legacy@example.com', LEGACY_HASH));
      await store.table('users').insert(user('stale@example.com', stale));
      await store.table('users').insert(user('current@example.com', current));
      // A blank hash is a corrupted or half-provisioned row: reported, but never invited.
      await store.table('users').insert({
        id: uuidv7(), email: 'blank@example.com', password_hash: '', full_name: 'Blank Hash',
      });
    });

    const result = await runTool(dir, []);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /legacy-bcrypt/);
    assert.match(result.stdout, /legacy@example\.com/);
    assert.match(result.stdout, /stale-scrypt-params/);
    assert.match(result.stdout, /stale@example\.com/);
    assert.doesNotMatch(result.stdout, /current@example\.com/, 'a current hash is not reported');
    assert.match(result.stdout, /blank-hash/);
    assert.match(result.stdout, /blank@example\.com/);
    assert.match(result.stdout, /nothing was written/i);
    assert.deepEqual(await allRecoveryRows(dir), []);
  });
});

test('rehash-passwords: --apply creates a usable reset invitation for a bcrypt account', async () => {
  await withDir(async (dir) => {
    const legacy = user('legacy@example.com', LEGACY_HASH);
    await seed(dir, async (store) => { await store.table('users').insert(legacy); });

    const before = Date.now();
    const result = await runTool(dir, ['--apply']);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Created 1 reset invitation/);

    const rows = await invites(dir);
    assert.equal(rows.length, 1, 'exactly one invitation');
    const row = rows[0];
    assert.equal(row.user_id, legacy.id);
    assert.equal(row.kind, 'password_reset');
    assert.match(row.token_hash, /^[0-9a-f]{64}$/, 'sha256 hex, not a plaintext token');
    assert.equal(row.consumed_at, null);
    const ttl = new Date(row.expires_at).getTime() - before;
    assert.ok(ttl > 55 * 60_000 && ttl <= 61 * 60_000, `one hour-ish, got ${Math.round(ttl / 1000)}s`);

    // The token printed in development must be the token that opens the invitation — otherwise the
    // row would be unusable and the tool would be lying about having invited anyone.
    const printed = result.stdout.match(/\t([A-Za-z0-9_-]{20,})\s*$/m);
    assert.ok(printed, 'development output includes the token');
    assert.equal(sha256(printed[1]), row.token_hash, 'printed token hashes to the stored token_hash');
    assert.notEqual(printed[1], row.token_hash, 'the stored value is never the plaintext');
  });
});

test('rehash-passwords: a stale scrypt hash is reported, never rewritten', async () => {
  await withDir(async (dir) => {
    const stale = await hashPassword('still verifies fine', { N: 16384, r: 8, p: 1, keylen: 64 });
    const account = user('stale@example.com', stale);
    await seed(dir, async (store) => { await store.table('users').insert(account); });

    const result = await runTool(dir, ['--apply']);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /stale-scrypt-params/);
    assert.match(result.stdout, /upgrades them on the next successful sign-in/);

    const after = await read(dir, (store) => store.table('users').findById(account.id));
    assert.equal(after.password_hash, stale, 'the hash is untouched');
    assert.deepEqual(await allRecoveryRows(dir), [], 'no reset invitation for a hash that still works');
  });
});

test('rehash-passwords: invitations are not stacked, and --force re-invites on purpose', async () => {
  await withDir(async (dir) => {
    await seed(dir, async (store) => { await store.table('users').insert(user('legacy@example.com', LEGACY_HASH)); });

    assert.equal((await runTool(dir, ['--apply'])).code, 0);
    assert.equal((await invites(dir)).length, 1);

    const second = await runTool(dir, ['--apply']);
    assert.equal(second.code, 0, second.stderr);
    assert.match(second.stdout, /skipped 1 account/);
    assert.equal((await invites(dir)).length, 1, 'a live invite is not duplicated');

    const forced = await runTool(dir, ['--apply', '--force']);
    assert.equal(forced.code, 0, forced.stderr);
    assert.match(forced.stdout, /Created 1 reset invitation/);
    const rows = await invites(dir);
    assert.equal(rows.length, 2, '--force issues a fresh invitation');
    assert.notEqual(rows[0].token_hash, rows[1].token_hash);
  });
});

test('rehash-passwords: an expired or consumed invitation does not block a new one', async () => {
  await withDir(async (dir) => {
    const account = user('legacy@example.com', LEGACY_HASH);
    await seed(dir, async (store) => {
      await store.table('users').insert(account);
      await store.table('auth_recovery').insert({
        id: uuidv7(),
        user_id: account.id,
        kind: 'password_reset',
        token_hash: sha256('an-old-token'),
        expires_at: new Date(Date.now() - 60_000).toISOString(),
      });
      await store.table('auth_recovery').insert({
        id: uuidv7(),
        user_id: account.id,
        kind: 'password_reset',
        token_hash: sha256('a-used-token'),
        consumed_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      });
    });

    const result = await runTool(dir, ['--apply']);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Created 1 reset invitation/);
    assert.equal((await allRecoveryRows(dir)).length, 3, 'a third row was added');
  });
});

test('rehash-passwords: production refuses to conjure tokens out of nowhere', async () => {
  await withDir(async (dir) => {
    await seed(dir, async (store) => { await store.table('users').insert(user('legacy@example.com', LEGACY_HASH)); });
    const env = { NODE_ENV: 'production', JWT_SECRET: PROD_SECRET };

    const refused = await runTool(dir, ['--apply'], env);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /--out/);
    assert.deepEqual(await allRecoveryRows(dir), [], 'nothing is written when the refusal fires');

    // A dry run is still allowed in production: it writes nothing at all.
    const dry = await runTool(dir, [], env);
    assert.equal(dry.code, 0, dry.stderr);
    assert.match(dry.stdout, /legacy-bcrypt/);
    assert.doesNotMatch(dry.stdout, /\t[A-Za-z0-9_-]{20,}\s*$/m, 'no token in production output');
    assert.deepEqual(await allRecoveryRows(dir), []);
  });
});

test('rehash-passwords: --out writes usable tokens to a 0600 file, not to stdout', async () => {
  await withDir(async (dir) => {
    await seed(dir, async (store) => { await store.table('users').insert(user('legacy@example.com', LEGACY_HASH)); });
    const outFile = path.join(dir, 'invites.txt');

    const result = await runTool(dir, ['--apply', '--out', outFile], { NODE_ENV: 'production', JWT_SECRET: PROD_SECRET });
    assert.equal(result.code, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /\t[A-Za-z0-9_-]{20,}\s*$/m, 'no token on stdout in production');

    assert.equal(fs.statSync(outFile).mode & 0o777, 0o600, 'mode 0600');
    const contents = fs.readFileSync(outFile, 'utf8');
    assert.match(contents, /legacy@example\.com\t[A-Za-z0-9_-]{20,}\t\d{4}-/);
    const token = contents.match(/legacy@example\.com\t([A-Za-z0-9_-]+)/)[1];
    const rows = await invites(dir);
    assert.equal(rows.length, 1);
    assert.equal(sha256(token), rows[0].token_hash, 'the delivered token opens the invitation');
  });
});

test('rehash-passwords: --email targets one account and --json is machine-readable', async () => {
  await withDir(async (dir) => {
    await seed(dir, async (store) => {
      await store.table('users').insert(user('one@example.com', LEGACY_HASH));
      await store.table('users').insert(user('two@example.com', LEGACY_HASH));
    });

    const result = await runTool(dir, ['--apply', '--email', 'TWO@example.com', '--json']);
    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout); // stdout must contain nothing but the JSON
    assert.equal(payload.summary.applied, true);
    assert.equal(payload.summary.scanned, 1);
    assert.equal(payload.summary.invited, 1);
    assert.equal(payload.accounts.length, 1);
    assert.equal(payload.accounts[0].email, 'two@example.com');
    assert.equal(payload.accounts[0].status, 'invited');
    assert.equal(payload.accounts[0].token, undefined, 'tokens never appear in the JSON summary');

    const rows = await invites(dir);
    assert.equal(rows.length, 1, 'only the targeted account was invited');
    const [one, two] = await read(dir, async (store) => [
      await store.table('users').findOneCi('email', 'one@example.com'),
      await store.table('users').findOneCi('email', 'two@example.com'),
    ]);
    assert.equal(rows[0].user_id, two.id);
    assert.notEqual(rows[0].user_id, one.id);
  });
});

test('rehash-passwords: --limit caps the scan and bad input is refused', async () => {
  await withDir(async (dir) => {
    await seed(dir, async (store) => {
      for (let i = 0; i < 3; i += 1) await store.table('users').insert(user(`u${i}@example.com`, LEGACY_HASH));
    });

    const limited = await runTool(dir, ['--limit', '2', '--apply']);
    assert.equal(limited.code, 0, limited.stderr);
    assert.match(limited.stdout, /Scanned 2 account/);
    assert.equal((await invites(dir)).length, 2);

    const bad = await runTool(dir, ['--nope']);
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /Unknown option/);

    const badLimit = await runTool(dir, ['--limit', 'zero']);
    assert.equal(badLimit.code, 1);
    assert.match(badLimit.stderr, /--limit must be a positive integer/);

    const help = await runTool(dir, ['--help']);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /--apply/);
  });
});
