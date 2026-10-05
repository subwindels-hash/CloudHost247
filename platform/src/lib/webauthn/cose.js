/**
 * COSE public keys → node:crypto verification keys.
 *
 * A WebAuthn credential's public key arrives as a COSE_Key (RFC 9052) inside the authenticator
 * data. This module converts it into a Node `KeyObject` by building the equivalent DER SPKI
 * structure by hand — no dependency, and no ASN.1 library to get subtly wrong — then exposes a
 * `verify(data, signature)` closure that applies the algorithm the key itself declares.
 *
 * Supported (the algorithms a browser authenticator actually uses):
 *   - EC2 / P-256 / ES256  (alg -7)   — DER-encoded ECDSA signatures, the WebAuthn default
 *   - RSA / RS256          (alg -257) — PKCS#1 v1.5
 *   - RSA / PS256          (alg -37)  — PSS with a 32-byte salt
 *   - OKP / Ed25519        (alg -8)   — EdDSA
 *
 * Anything else is refused with the reason. In particular the curve and algorithm must agree (a
 * P-256 key that advertises RS256 is refused), and key material must have the exact byte length the
 * curve requires — a short or long coordinate is a malformed key, not a key to pad.
 */
'use strict';

const crypto = require('node:crypto');

const { decodeAll, CborError } = require('./cbor');

const COSE = {
  KTY_OKP: 1,
  KTY_EC2: 2,
  KTY_RSA: 3,
  ALG_ES256: -7,
  ALG_EDDSA: -8,
  ALG_PS256: -37,
  ALG_RS256: -257,
  CRV_P256: 1,
  CRV_ED25519: 6,
};

const ALGORITHMS = {
  [COSE.ALG_ES256]: { name: 'ES256', kty: COSE.KTY_EC2, hash: 'sha256' },
  [COSE.ALG_RS256]: { name: 'RS256', kty: COSE.KTY_RSA, hash: 'sha256' },
  [COSE.ALG_PS256]: { name: 'PS256', kty: COSE.KTY_RSA, hash: 'sha256' },
  [COSE.ALG_EDDSA]: { name: 'EdDSA', kty: COSE.KTY_OKP, hash: null },
};

class CoseKeyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CoseKeyError';
  }
}

// --- minimal DER builders ---------------------------------------------------

function derLength(length) {
  if (length < 0x80) return Buffer.from([length]);
  const bytes = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining = Math.floor(remaining / 256);
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function derSequence(...parts) {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([0x30]), derLength(body.length), body]);
}

function derInteger(value) {
  let bytes = value;
  while (bytes.length > 1 && bytes[0] === 0) bytes = bytes.subarray(1);
  if (bytes.length === 0) bytes = Buffer.from([0]);
  if (bytes[0] & 0x80) bytes = Buffer.concat([Buffer.from([0]), bytes]);
  return Buffer.concat([Buffer.from([0x02]), derLength(bytes.length), bytes]);
}

function derBitString(value) {
  return Buffer.concat([Buffer.from([0x03]), derLength(value.length + 1), Buffer.from([0x00]), value]);
}

function derOid(bytes) {
  return Buffer.concat([Buffer.from([0x06]), derLength(bytes.length), bytes]);
}

const OID_EC_PUBLIC_KEY = Buffer.from([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]);
const OID_PRIME256V1 = Buffer.from([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]);
const OID_ED25519 = Buffer.from([0x2b, 0x65, 0x70]);
const OID_RSA_ENCRYPTION = Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01]);
const DER_NULL = Buffer.from([0x05, 0x00]);

function ecP256Spki(x, y) {
  if (x.length !== 32 || y.length !== 32) {
    throw new CoseKeyError('P-256 key coordinates must be 32 bytes each');
  }
  const point = Buffer.concat([Buffer.from([0x04]), x, y]);
  return derSequence(derSequence(derOid(OID_EC_PUBLIC_KEY), derOid(OID_PRIME256V1)), derBitString(point));
}

function ed25519Spki(x) {
  if (x.length !== 32) throw new CoseKeyError('Ed25519 public keys must be 32 bytes');
  return derSequence(derSequence(derOid(OID_ED25519)), derBitString(x));
}

function rsaSpki(n, e) {
  if (n.length === 0 || e.length === 0) throw new CoseKeyError('RSA key is missing its modulus or exponent');
  const publicKey = derSequence(derInteger(n), derInteger(e));
  return derSequence(derSequence(derOid(OID_RSA_ENCRYPTION), DER_NULL), derBitString(publicKey));
}

// --- verification -----------------------------------------------------------

function verifyWithAlgorithm(algorithm, keyObject, data, signature) {
  if (algorithm.name === 'EdDSA') return crypto.verify(null, data, keyObject, signature);
  if (algorithm.name === 'RS256') {
    return crypto.verify('sha256', data, { key: keyObject, padding: crypto.constants.RSA_PKCS1_PADDING }, signature);
  }
  if (algorithm.name === 'PS256') {
    return crypto.verify('sha256', data, {
      key: keyObject, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32,
    }, signature);
  }
  // ES256: WebAuthn transports an ASN.1 DER ECDSA signature, which is Node's default encoding.
  return crypto.verify('sha256', data, keyObject, signature);
}

/**
 * Parses a COSE_Key. Returns `{ algorithm, keyType, keyObject, verify(data, signature) }`.
 * Throws `CoseKeyError` (or `CborError`) for anything malformed or unsupported.
 */
function parseCosePublicKey(bytes) {
  let map;
  try {
    map = decodeAll(bytes);
  } catch (err) {
    if (err instanceof CborError) throw new CoseKeyError(`COSE key is not valid CBOR: ${err.message}`);
    throw err;
  }
  if (!(map instanceof Map)) throw new CoseKeyError('COSE key must be a CBOR map');

  const keyType = map.get(1);
  const algorithmId = map.get(3);
  const algorithm = ALGORITHMS[algorithmId];
  if (!algorithm) throw new CoseKeyError(`unsupported COSE algorithm: ${algorithmId}`);
  if (keyType !== algorithm.kty) {
    throw new CoseKeyError(`COSE key type ${keyType} does not match algorithm ${algorithm.name}`);
  }

  let der;
  if (keyType === COSE.KTY_EC2) {
    const curve = map.get(-1);
    if (curve !== COSE.CRV_P256) throw new CoseKeyError(`unsupported EC curve: ${curve}`);
    const x = map.get(-2);
    const y = map.get(-3);
    if (!Buffer.isBuffer(x) || !Buffer.isBuffer(y)) throw new CoseKeyError('EC key is missing coordinates');
    der = ecP256Spki(x, y);
  } else if (keyType === COSE.KTY_OKP) {
    const curve = map.get(-1);
    if (curve !== COSE.CRV_ED25519) throw new CoseKeyError(`unsupported OKP curve: ${curve}`);
    const x = map.get(-2);
    if (!Buffer.isBuffer(x)) throw new CoseKeyError('Ed25519 key is missing its public key bytes');
    der = ed25519Spki(x);
  } else {
    const n = map.get(-1);
    const e = map.get(-2);
    if (!Buffer.isBuffer(n) || !Buffer.isBuffer(e)) throw new CoseKeyError('RSA key is missing its modulus or exponent');
    der = rsaSpki(n, e);
  }

  let keyObject;
  try {
    keyObject = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
  } catch (err) {
    throw new CoseKeyError(`COSE key could not be converted to a verification key: ${err.message}`);
  }

  return {
    algorithm: algorithm.name,
    algorithmId,
    keyType,
    keyObject,
    verify: (data, signature) => verifyWithAlgorithm(algorithm, keyObject, data, signature),
  };
}

module.exports = { parseCosePublicKey, CoseKeyError, COSE, ALGORITHMS };
