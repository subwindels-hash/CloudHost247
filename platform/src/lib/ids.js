/**
 * Identifier and random-token helpers.
 *
 * UUIDv7 is used for primary keys: it is time-ordered, so JSON-store appends and Postgres B-tree
 * inserts both stay cheap, while remaining globally unique without a coordinator.
 */
'use strict';

const crypto = require('node:crypto');

/** UUIDv7 (RFC 9562): 48-bit unix-ms timestamp + 74 bits of randomness, version 7 / variant 10. */
function uuidv7(timestampMs = Date.now()) {
  const bytes = crypto.randomBytes(16);

  // 48-bit big-endian millisecond timestamp.
  bytes[0] = (timestampMs / 2 ** 40) & 0xff;
  bytes[1] = (timestampMs / 2 ** 32) & 0xff;
  bytes[2] = (timestampMs / 2 ** 24) & 0xff;
  bytes[3] = (timestampMs / 2 ** 16) & 0xff;
  bytes[4] = (timestampMs / 2 ** 8) & 0xff;
  bytes[5] = timestampMs & 0xff;

  // Version 7 in the high nibble of byte 6; variant 10 in the high bits of byte 8.
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** URL-safe random token of the given byte length (default 32 → 43 chars). */
function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Hex random string, for values that appear in URLs or logs where base64url's `-`/`_` are awkward. */
function randomHex(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

/** Cryptographically uniform integer in [0, max). */
function randomInt(max) {
  return crypto.randomInt(0, max);
}

/**
 * Six-digit permanent Customer ID candidate (see users.customer_id). Zero-padded so it always
 * renders as exactly six characters.
 */
function generateCustomerId() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/** base64url encode without padding. */
function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

/** base64url decode, tolerating input with or without padding. */
function b64urlDecode(input) {
  return Buffer.from(String(input).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

module.exports = { uuidv7, isUuid, randomToken, randomHex, randomInt, generateCustomerId, b64url, b64urlDecode };
