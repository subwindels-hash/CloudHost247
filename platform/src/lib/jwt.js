/**
 * JWT (HS256) — replaces `jsonwebtoken`.
 *
 * Wire format is byte-for-byte what jsonwebtoken produces for HS256, so tokens issued by either
 * platform verify in the other during migration: base64url(header).base64url(payload).signature,
 * with `iat`/`exp` in *seconds* and an auto-generated `jti`.
 *
 * Only HS256 is implemented. The `alg` header is checked against an allowlist and `none` is
 * rejected — the classic algorithm-confusion vulnerability.
 */
'use strict';

const crypto = require('node:crypto');
const { b64url, b64urlDecode, uuidv7 } = require('./ids');

const HEADER = { alg: 'HS256', typ: 'JWT' };

class TokenError extends Error {
  constructor(message, code = 'INVALID_TOKEN') {
    super(message);
    this.name = 'TokenError';
    this.code = code;
  }
}

function sign(payload, secret, options = {}) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('JWT secret must be at least 32 characters');
  }

  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = options.expiresInMs !== undefined
    ? Math.floor(options.expiresInMs / 1000)
    : 43200; // 12h

  const claims = {
    ...payload,
    iat: options.issuedAt ? Math.floor(options.issuedAt / 1000) : now,
    exp: now + ttlSeconds,
    jti: options.jwtid ?? uuidv7(),
  };
  if (options.issuer) claims.iss = options.issuer;
  if (options.audience) claims.aud = options.audience;

  const encodedHeader = b64url(JSON.stringify(HEADER));
  const encodedPayload = b64url(JSON.stringify(claims));
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

/**
 * Verify signature and standard claims.
 * @throws TokenError with a specific code so callers can distinguish "expired" (offer refresh)
 *         from "invalid" (force re-login).
 */
function verify(token, secret, options = {}) {
  if (typeof token !== 'string' || token === '') throw new TokenError('Token is missing');

  const parts = token.split('.');
  if (parts.length !== 3) throw new TokenError('Token is malformed');

  const [encodedHeader, encodedPayload, signature] = parts;

  let header;
  try {
    header = JSON.parse(b64urlDecode(encodedHeader).toString('utf8'));
  } catch {
    throw new TokenError('Token header is malformed');
  }
  if (!header || header.alg !== 'HS256' || header.typ !== 'JWT') {
    throw new TokenError('Unsupported token algorithm', 'INVALID_ALGORITHM');
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest();

  let actual;
  try {
    actual = b64urlDecode(signature);
  } catch {
    throw new TokenError('Token signature is malformed');
  }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw new TokenError('Token signature is invalid', 'INVALID_SIGNATURE');
  }

  let claims;
  try {
    claims = JSON.parse(b64urlDecode(encodedPayload).toString('utf8'));
  } catch {
    throw new TokenError('Token payload is malformed');
  }

  const now = Math.floor(Date.now() / 1000);
  const leeway = options.clockTolerance ?? 0;

  if (typeof claims.exp === 'number' && now > claims.exp + leeway) {
    throw new TokenError('Token has expired', 'TOKEN_EXPIRED');
  }
  if (typeof claims.nbf === 'number' && now + leeway < claims.nbf) {
    throw new TokenError('Token is not yet valid', 'TOKEN_NOT_ACTIVE');
  }
  if (options.issuer && claims.iss !== options.issuer) {
    throw new TokenError('Token issuer mismatch', 'INVALID_ISSUER');
  }
  if (options.audience && claims.aud !== options.audience) {
    throw new TokenError('Token audience mismatch', 'INVALID_AUDIENCE');
  }

  return claims;
}

/** Decode without verifying — for logging/inspection only. Never for authorization. */
function decode(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(b64urlDecode(parts[1]).toString('utf8'));
  } catch {
    return null;
  }
}

module.exports = { sign, verify, decode, TokenError };
