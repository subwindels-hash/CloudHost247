/**
 * TOTP (RFC 6238) + recovery codes — replaces the `qrcode` / `pngjs` / `jsqr` dependency chain
 * used by cloudhost247-node/src/services/mfa-*.
 *
 * QR enrolment images are produced by src/lib/qr.js (a self-contained QR + PNG encoder), so no
 * third-party module is involved anywhere in the MFA flow.
 */
'use strict';

const crypto = require('node:crypto');
const base32 = require('./base32');

const DEFAULT_OPTIONS = { digits: 6, period: 30, algorithm: 'sha1' };

const HMAC_ALG = { sha1: 'sha1', sha256: 'sha256', sha512: 'sha512' };

/** Generate a fresh 20-byte secret, returned base32-encoded (what authenticator apps expect). */
function generateSecret(bytes = 20) {
  return base32.encode(crypto.randomBytes(bytes)).replace(/=+$/, '');
}

function hotp(secretBase32, counter, options = {}) {
  const { digits = 6, algorithm = 'sha1' } = options;
  const key = base32.decode(secretBase32);

  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac(HMAC_ALG[algorithm] ?? 'sha1', key).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff);

  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** Current TOTP code for the given time. */
function totp(secretBase32, options = {}) {
  const { period = DEFAULT_OPTIONS.period, ...rest } = options;
  const counter = Math.floor(Date.now() / 1000 / period);
  return hotp(secretBase32, counter, rest);
}

/**
 * Verify a user-supplied code, tolerating clock drift of ±`window` periods.
 *
 * `lastCounter` guards against replay: the caller persists the highest counter it has accepted and
 * passes it here, so the same code cannot be used twice inside its validity window.
 *
 * @returns {{ valid: boolean, counter: number|null }}
 */
function verifyTotp(secretBase32, token, options = {}) {
  const { period = DEFAULT_OPTIONS.period, window = 1, lastCounter = -1 } = options;

  if (typeof token !== 'string' || !/^\d{6,8}$/.test(token.trim())) {
    return { valid: false, counter: null };
  }
  const code = token.trim();
  const currentCounter = Math.floor(Date.now() / 1000 / period);

  for (let offset = -window; offset <= window; offset += 1) {
    const counter = currentCounter + offset;
    // Reject any counter at or before the last one already accepted (replay protection).
    if (counter <= lastCounter) continue;
    const expected = hotp(secretBase32, counter, { digits: code.length, ...options });

    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(code, 'utf8');
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return { valid: true, counter };
    }
  }
  return { valid: false, counter: null };
}

/** otpauth:// provisioning URI consumed by Google Authenticator / 1Password / Authy / etc. */
function otpauthUri({ secret, issuer, account, digits = 6, period = 30, algorithm = 'SHA1' }) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret: secret.replace(/=+$/, ''),
    issuer,
    algorithm,
    digits: String(digits),
    period: String(period),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * Recovery codes: 10 single-use codes, stored as SHA-256 hashes (never plaintext).
 * @returns {{ plaintext: string[], hashes: string[] }}
 */
function generateRecoveryCodes(count = 10) {
  const plaintext = [];
  const hashes = [];
  for (let i = 0; i < count; i += 1) {
    // Format as xxxxx-xxxxx so it is easy to read aloud over a support call.
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
    const code = `${raw.slice(0, 5)}-${raw.slice(5)}`;
    plaintext.push(code);
    hashes.push(hashRecoveryCode(code));
  }
  return { plaintext, hashes };
}

function hashRecoveryCode(code) {
  return crypto.createHash('sha256').update(String(code).toUpperCase().replace(/\s/g, '')).digest('hex');
}

/** Constant-time lookup: hashes every candidate rather than comparing plaintext. */
function findRecoveryCode(storedHashes, code) {
  const candidate = hashRecoveryCode(code);
  const index = (storedHashes ?? []).findIndex(
    (h) => typeof h === 'string' && h.length === candidate.length
      && crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(candidate, 'hex'))
  );
  return index === -1 ? null : index;
}

module.exports = {
  generateSecret,
  hotp,
  totp,
  verifyTotp,
  otpauthUri,
  generateRecoveryCodes,
  hashRecoveryCode,
  findRecoveryCode,
};
