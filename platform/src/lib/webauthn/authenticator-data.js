/**
 * Authenticator data parsing (WebAuthn §6.1).
 *
 * Layout:
 *
 *   rpIdHash    32 bytes  SHA-256 of the relying party id the credential is scoped to
 *   flags        1 byte   UP | UV | BE | BS | AT | ED
 *   signCount    4 bytes  big-endian signature counter
 *   [ attestedCredentialData, present when AT is set:
 *       aaguid 16 bytes | credentialIdLength 2 bytes | credentialId | COSE public key (CBOR) ]
 *   [ extensions (CBOR), present when ED is set ]
 *
 * The COSE key is variable length, so the CBOR decoder's byte count is what tells us where the
 * extensions begin. Trailing bytes are reported rather than ignored: authenticator data that does
 * not parse to its own end is malformed, and a server that shrugs at extra bytes is a server that
 * will one day accept a smuggled second structure.
 */
'use strict';

const { decodeFirst } = require('./cbor');

const FLAG = {
  UP: 0x01, // user present
  UV: 0x04, // user verified
  BE: 0x08, // backup eligible
  BS: 0x10, // backup state
  AT: 0x40, // attested credential data included
  ED: 0x80, // extension data included
};

class AuthenticatorDataError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthenticatorDataError';
  }
}

/** 16-byte AAGUID → the canonical 8-4-4-4-12 hex form (all-zero when the authenticator has none). */
function formatAaguid(bytes) {
  const hex = bytes.toString('hex');
  if (hex === '0'.repeat(32)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function parseAuthenticatorData(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 37) {
    throw new AuthenticatorDataError('authenticator data must be at least 37 bytes');
  }

  const rpIdHash = buffer.subarray(0, 32);
  const flagsByte = buffer[32];
  const signCount = buffer.readUInt32BE(33);

  const flags = {
    up: (flagsByte & FLAG.UP) !== 0,
    uv: (flagsByte & FLAG.UV) !== 0,
    be: (flagsByte & FLAG.BE) !== 0,
    bs: (flagsByte & FLAG.BS) !== 0,
    at: (flagsByte & FLAG.AT) !== 0,
    ed: (flagsByte & FLAG.ED) !== 0,
  };

  let offset = 37;
  let aaguid = null;
  let credentialId = null;
  let cosePublicKeyBytes = null;
  let extensions = null;

  if (flags.at) {
    if (buffer.length < offset + 18) {
      throw new AuthenticatorDataError('attested credential data is truncated');
    }
    aaguid = formatAaguid(buffer.subarray(offset, offset + 16));
    const credentialIdLength = buffer.readUInt16BE(offset + 16);
    offset += 18;

    if (credentialIdLength === 0 || buffer.length < offset + credentialIdLength) {
      throw new AuthenticatorDataError('credential id is missing or truncated');
    }
    credentialId = buffer.subarray(offset, offset + credentialIdLength);
    offset += credentialIdLength;

    const { bytesRead } = decodeFirst(buffer.subarray(offset));
    cosePublicKeyBytes = buffer.subarray(offset, offset + bytesRead);
    offset += bytesRead;
  }

  if (flags.ed) {
    const { value, bytesRead } = decodeFirst(buffer.subarray(offset));
    extensions = value;
    offset += bytesRead;
  }

  return {
    rpIdHash,
    flagsByte,
    flags,
    signCount,
    aaguid,
    credentialId,
    cosePublicKeyBytes,
    extensions,
    // Bytes left over after the declared structures. Callers must refuse when this is non-zero:
    // the signature covers the authenticator data exactly as received, so a server that ignores
    // extra bytes is a server that ignores input it never validated.
    trailingBytes: buffer.length - offset,
  };
}

module.exports = { parseAuthenticatorData, formatAaguid, AuthenticatorDataError, FLAG };
