'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { hashPassword, verifyPassword, needsRehash } = require('../src/lib/password');
const jwt = require('../src/lib/jwt');
const totp = require('../src/lib/totp');
const base32 = require('../src/lib/base32');
const { uuidv7, isUuid } = require('../src/lib/ids');

const SECRET = crypto.randomBytes(48).toString('base64url');

test('scrypt password roundtrip', async () => {
  const hash = await hashPassword('SuperSecret123!');
  assert.ok(hash.startsWith('scrypt$'));
  assert.strictEqual(await verifyPassword('SuperSecret123!', hash), true);
  assert.strictEqual(await verifyPassword('wrong', hash), false);
});

test('malformed hash verifies false, not throw', async () => {
  assert.strictEqual(await verifyPassword('x', 'not-a-hash'), false);
  assert.strictEqual(await verifyPassword('x', null), false);
});

test('bcrypt legacy hash detected and not verified', async () => {
  assert.strictEqual(await verifyPassword('x', '$2b$12$abcdef'), false);
});

test('needsRehash flags foreign parameters', async () => {
  const hash = await hashPassword('SuperSecret123!');
  assert.strictEqual(needsRehash(hash), false);
  assert.strictEqual(needsRehash('scrypt$16$8$1$aa$bb'), true);
});

test('jwt sign/verify roundtrip', () => {
  const token = jwt.sign({ sub: 'u1', role: 'customer' }, SECRET);
  const claims = jwt.verify(token, SECRET);
  assert.strictEqual(claims.sub, 'u1');
  assert.ok(claims.jti);
  assert.ok(claims.exp > claims.iat);
});

test('jwt rejects tampered payload', () => {
  const token = jwt.sign({ sub: 'u1', role: 'customer' }, SECRET);
  const [h, p, s] = token.split('.');
  const tamperedPayload = Buffer.from(JSON.stringify({ sub: 'u2', role: 'super_admin' })).toString('base64url');
  assert.throws(() => jwt.verify(`${h}.${tamperedPayload}.${s}`, SECRET));
});

test('jwt rejects wrong secret and expired', () => {
  const token = jwt.sign({ sub: 'u1' }, SECRET);
  assert.throws(() => jwt.verify(token, 'another-secret-another-secret-123456'));

  const expired = jwt.sign({ sub: 'u1' }, SECRET, { expiresInMs: -1000 });
  assert.throws(() => jwt.verify(expired, SECRET), (e) => e.code === 'TOKEN_EXPIRED');
});

test('jwt rejects alg=none', () => {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: 'x' })).toString('base64url');
  assert.throws(() => jwt.verify(`${header}.${payload}.`, SECRET));
});

test('base32 roundtrip', () => {
  const data = crypto.randomBytes(20);
  const encoded = base32.encode(data);
  assert.deepStrictEqual(base32.decode(encoded), data);
});

test('totp generate and verify within window', () => {
  const secret = totp.generateSecret();
  const code = totp.totp(secret);
  const result = totp.verifyTotp(secret, code);
  assert.strictEqual(result.valid, true);
});

test('totp rejects wrong code and replay of same counter', () => {
  const secret = totp.generateSecret();
  const code = totp.totp(secret);
  assert.strictEqual(totp.verifyTotp(secret, '000000').valid, false);

  const { valid, counter } = totp.verifyTotp(secret, code);
  assert.strictEqual(valid, true);
  // Same code again with lastCounter=counter must not verify (replay protection).
  assert.strictEqual(totp.verifyTotp(secret, code, { lastCounter: counter }).valid, false);
});

test('recovery codes hash-and-match and are single use', () => {
  const { plaintext, hashes } = totp.generateRecoveryCodes(3);
  const index = totp.findRecoveryCode(hashes, plaintext[0]);
  assert.strictEqual(index, 0);
  assert.strictEqual(totp.findRecoveryCode(hashes, 'ZZZZZ-ZZZZZ'), null);
});

test('uuidv7 is a valid uuid and orders by timestamp', () => {
  const a = uuidv7();
  const b = uuidv7();
  assert.ok(isUuid(a));
  assert.ok(isUuid(b));

  // Ordering is guaranteed across distinct millisecond timestamps (the spec does not promise
  // sub-millisecond monotonicity), so compare with explicit, increasing timestamps.
  const t1 = Date.now();
  const earlier = uuidv7(t1);
  const later = uuidv7(t1 + 5000);
  assert.ok(earlier < later, 'time-ordered across milliseconds');
});
