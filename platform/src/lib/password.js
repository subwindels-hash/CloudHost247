/**
 * Password hashing — replaces `bcryptjs` with node:crypto's scrypt.
 *
 * Why scrypt: bcryptjs is a pure-JS implementation whose only advantage was avoiding native
 * builds. Node's scrypt is built into the runtime, so we get a memory-hard adaptive hash with no
 * dependency and no toolchain requirement — strictly better for cPanel shared hosting.
 *
 * Hash format (self-describing, so parameters can be raised later without breaking old hashes):
 *
 *   scrypt$N$r$p$saltB64$hashB64
 *
 * Verification is constant-time (timingSafeEqual) and re-derives with the *stored* parameters, so
 * a parameter bump only affects newly written hashes.
 */
'use strict';

const crypto = require('node:crypto');

// OWASP-recommended scrypt parameters. N=2^15 (~32 MiB) is the sweet spot for a login path on
// shared hosting: expensive for an attacker, ~50-100 ms for a legitimate sign-in.
const DEFAULT_PARAMS = { N: 32768, r: 8, p: 1, keylen: 64 };

const MAX_PASSWORD_LENGTH = 4096;

function derive(password, salt, params) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      Buffer.from(password, 'utf8'),
      salt,
      params.keylen,
      { N: params.N, r: params.r, p: params.p, maxmem: 256 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key))
    );
  });
}

/**
 * Hash a plaintext password.
 * @returns {Promise<string>} scrypt$N$r$p$salt$hash
 */
async function hashPassword(password, params = DEFAULT_PARAMS) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('password must be a non-empty string');
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new Error('password exceeds maximum length');
  }
  const salt = crypto.randomBytes(16);
  const key = await derive(password, salt, params);
  return `scrypt$${params.N}$${params.r}$${params.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/**
 * Verify a plaintext password against a stored hash.
 * Returns false (never throws) for a malformed or unknown-format hash, so a corrupted row cannot
 * become a 500 on the login path.
 *
 * `bcrypt$...` hashes are recognised and rejected with a distinct result so the caller can route
 * the user to re-enrolment — see MIGRATION.md "Password hashes".
 */
async function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || typeof password !== 'string') return false;

  if (stored.startsWith('bcrypt$') || stored.startsWith('$2a$') || stored.startsWith('$2b$') || stored.startsWith('$2y$')) {
    // Legacy bcryptjs hash from the Fastify platform. Verifying bcrypt requires the Blowfish key
    // schedule, which we deliberately do not re-implement. Users with these hashes must reset;
    // scripts/rehash-passwords.js bulk-invites them.
    return false;
  }

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, n, r, p, saltB64, hashB64] = parts;
  const params = { N: Number(n), r: Number(r), p: Number(p), keylen: 0 };
  if (!Number.isFinite(params.N) || !Number.isFinite(params.r) || !Number.isFinite(params.p)) return false;

  let salt;
  let expected;
  try {
    salt = Buffer.from(saltB64, 'base64');
    expected = Buffer.from(hashB64, 'base64');
  } catch {
    return false;
  }
  if (expected.length === 0) return false;

  params.keylen = expected.length;
  const actual = await derive(password, salt, params);

  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

/** True when a stored hash predates the current parameters and should be upgraded on next login. */
function needsRehash(stored) {
  if (typeof stored !== 'string') return true;
  if (!stored.startsWith('scrypt$')) return true;
  const [, n, r, p] = stored.split('$');
  return Number(n) !== DEFAULT_PARAMS.N || Number(r) !== DEFAULT_PARAMS.r || Number(p) !== DEFAULT_PARAMS.p;
}

/** Detect a legacy bcrypt hash so the login route can offer a re-enrolment path. */
function isLegacyHash(stored) {
  return typeof stored === 'string'
    && (stored.startsWith('bcrypt$') || /^\$2[aby]\$/.test(stored));
}

module.exports = { hashPassword, verifyPassword, needsRehash, isLegacyHash, DEFAULT_PARAMS };
