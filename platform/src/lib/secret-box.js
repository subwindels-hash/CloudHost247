/**
 * Secret box — the one place a provider credential is encrypted and decrypted at rest.
 *
 * Three domains had each written their own copy of the *encrypt* half of this
 * (`admin-cloudflare.js`, `admin-domain-services.js`, `app-installations.js` — all AES-256-GCM with a
 * scrypt-derived key and the same `v1:iv:tag:ciphertext` envelope), and **none of them could decrypt**.
 * That is why every stored credential was write-only and every provider integration was "deferred":
 * a token that can be written but not read cannot authenticate an outbound call. Rather than add a
 * fourth copy with a `decrypt`, this module owns both halves.
 *
 * Two properties are deliberate:
 *
 *  1. **Per-purpose key derivation.** `purpose` is the scrypt salt, so a token encrypted for one
 *     feature cannot be decrypted with another feature's key even when both derive from the same
 *     `JWT_SECRET`. The existing salts are kept verbatim, so credentials already at rest still open.
 *  2. **Authentication is not optional.** GCM's tag is verified on every open, so a tampered or
 *     truncated value fails loudly instead of yielding a corrupt credential that would be sent
 *     upstream as a wrong password.
 *
 * The plaintext never leaves this module's callers: `decryptSecret` results are consumed by the
 * outbound client and are never logged, returned in a DTO or written to an audit row.
 */
'use strict';

const crypto = require('node:crypto');

/** Envelope version. A future format change must not be read as "no credential stored". */
const VERSION = 'v1';

/** Feature-scoped salts. Add to this map rather than passing a literal, so keys stay unique. */
const PURPOSES = Object.freeze({
  cloudflareAccount: 'cloudhost247-cf-accounts',
  domainProvider: 'cloudhost247-domain-providers',
  applicationEnvironment: 'cloudhost247-app-env',
});

function resolveSalt(purpose) {
  const salt = PURPOSES[purpose] ?? purpose;
  if (typeof salt !== 'string' || salt.length < 8) {
    throw new Error('secret-box: a purpose (or a salt of at least 8 characters) is required');
  }
  return salt;
}

/** scrypt is deliberately slow; the derived key is cached per (secret, salt) pair per process. */
const keyCache = new Map();
function deriveKey(secret, purpose) {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('secret-box: a non-empty master secret is required to derive a key');
  }
  const salt = resolveSalt(purpose);
  const cacheKey = `${salt}\u0000${secret}`;
  const cached = keyCache.get(cacheKey);
  if (cached) return cached;
  const key = crypto.scryptSync(secret, salt, 32);
  keyCache.set(cacheKey, key);
  return key;
}

/**
 * Encrypt a value into the `v1:<iv>:<tag>:<ciphertext>` envelope (all base64).
 *
 * `null`/`undefined`/empty is refused rather than encrypted, because an empty envelope would later
 * read as "a credential is stored" while authenticating nothing.
 */
function encryptSecret(secret, purpose, plaintext) {
  if (plaintext === null || plaintext === undefined || String(plaintext).length === 0) {
    throw new Error('secret-box: refusing to encrypt an empty value');
  }
  const key = deriveKey(secret, purpose);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return [
    VERSION,
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

/**
 * Decrypt an envelope produced by `encryptSecret`.
 *
 * Returns `null` — never a partial or guessed value — when the input is absent, is not in this
 * format, or fails authentication. A caller that needs to distinguish "no credential stored" from
 * "stored credential is unreadable" should use `describeSecret` first; a caller that is about to
 * make an outbound call must treat both as "cannot authenticate" and refuse before egress.
 */
function decryptSecret(secret, purpose, envelope) {
  if (typeof envelope !== 'string' || envelope.length === 0) return null;
  const parts = envelope.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  const [, ivB64, tagB64, dataB64] = parts;
  try {
    const key = deriveKey(secret, purpose);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
    return plaintext.toString('utf8');
  } catch {
    // Wrong key, tampered ciphertext or a truncated value: all mean "no usable credential".
    return null;
  }
}

/**
 * Classify a stored credential without revealing it. Used by readiness reports and by "Test
 * Connection", both of which must say *why* a provider cannot be called.
 *
 *  - `none`     — nothing is stored
 *  - `readable` — a v1 envelope that decrypts with the configured master secret
 *  - `unreadable` — an envelope is present but does not open (rotated `JWT_SECRET`, corruption, or a
 *    value written by a different deployment). Reported by name so an operator rotates the token
 *    instead of chasing a phantom provider outage.
 */
function describeSecret(secret, purpose, envelope) {
  if (typeof envelope !== 'string' || envelope.length === 0) {
    return { state: 'none', version: null };
  }
  if (!envelope.startsWith(`${VERSION}:`)) return { state: 'unreadable', version: envelope.split(':')[0] ?? null };
  const version = VERSION;
  return { state: decryptSecret(secret, purpose, envelope) === null ? 'unreadable' : 'readable', version };
}

module.exports = { encryptSecret, decryptSecret, describeSecret, PURPOSES, VERSION };
