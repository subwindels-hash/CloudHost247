/**
 * Minimal CBOR (RFC 8949) decoder — enough for the two structures WebAuthn hands a server, and
 * deliberately strict about everything else.
 *
 * WebAuthn sends CBOR in exactly two places: the attestation object
 * (`{ fmt, attStmt, authData }`) and the COSE public key embedded in the authenticator data. Both
 * come from the client, i.e. from an attacker-controlled request. A decoder that is lenient about
 * what it accepts is how parser bugs become authentication bypasses, so this one:
 *
 *   - accepts only **definite-length** items (indefinite lengths are refused outright)
 *   - refuses CBOR tags (neither structure uses them; a tag could re-frame a value)
 *   - refuses floats and simple values other than `false` / `true` / `null`
 *   - refuses duplicate map keys (ambiguous lookups)
 *   - caps nesting depth
 *   - validates UTF-8 text by requiring the round-trip to reproduce the exact bytes
 *   - reports trailing bytes so callers can insist the item consumed the whole buffer
 *
 * Every refusal throws `CborError`; callers treat that as "verification failed", never as "continue
 * with defaults".
 */
'use strict';

class CborError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CborError';
  }
}

const MAX_DEPTH = 16;

function readLength(reader, info) {
  if (info < 24) return info;
  if (info === 24) return readUint(reader, 1);
  if (info === 25) return readUint(reader, 2);
  if (info === 26) return readUint(reader, 4);
  if (info === 27) {
    const value = readUint(reader, 8);
    if (!Number.isSafeInteger(value)) throw new CborError('CBOR integer exceeds the safe integer range');
    return value;
  }
  // Handled by the caller (indefinite length) or invalid (28-30).
  throw new CborError('unsupported CBOR additional information');
}

function readUint(reader, bytes) {
  if (reader.offset + bytes > reader.buf.length) throw new CborError('unexpected end of CBOR input');
  const slice = reader.buf.subarray(reader.offset, reader.offset + bytes);
  reader.offset += bytes;
  let value = 0;
  for (const byte of slice) value = value * 256 + byte;
  return value;
}

function readBytes(reader, length) {
  if (reader.offset + length > reader.buf.length) throw new CborError('unexpected end of CBOR input');
  const slice = reader.buf.subarray(reader.offset, reader.offset + length);
  reader.offset += length;
  return slice;
}

function readText(reader, length) {
  const bytes = readBytes(reader, length);
  const text = bytes.toString('utf8');
  // Node replaces invalid UTF-8 with U+FFFD; require an exact round-trip so malformed text is
  // refused rather than silently rewritten (a rewritten key could dodge a string comparison).
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new CborError('CBOR text string is not valid UTF-8');
  return text;
}

function readItem(reader, depth) {
  if (depth > MAX_DEPTH) throw new CborError('CBOR nesting is too deep');
  if (reader.offset >= reader.buf.length) throw new CborError('unexpected end of CBOR input');

  const initial = reader.buf[reader.offset];
  reader.offset += 1;

  const major = initial >> 5;
  const info = initial & 0x1f;

  if (info === 31) throw new CborError('indefinite-length CBOR items are not accepted');

  switch (major) {
    case 0: // unsigned integer
      return readLength(reader, info);
    case 1: // negative integer
      return -1 - readLength(reader, info);
    case 2: // byte string
      return readBytes(reader, readLength(reader, info));
    case 3: // text string
      return readText(reader, readLength(reader, info));
    case 4: { // array
      const length = readLength(reader, info);
      const items = [];
      for (let i = 0; i < length; i += 1) items.push(readItem(reader, depth + 1));
      return items;
    }
    case 5: { // map
      const length = readLength(reader, info);
      const map = new Map();
      for (let i = 0; i < length; i += 1) {
        const key = readItem(reader, depth + 1);
        if (typeof key !== 'string' && typeof key !== 'number') {
          throw new CborError('CBOR map keys must be strings or integers');
        }
        if (map.has(key)) throw new CborError(`duplicate CBOR map key: ${key}`);
        map.set(key, readItem(reader, depth + 1));
      }
      return map;
    }
    case 6: // tag
      throw new CborError('CBOR tags are not accepted');
    default: { // major 7: simple values / floats
      if (info === 20) return false;
      if (info === 21) return true;
      if (info === 22) return null;
      throw new CborError('unsupported CBOR simple value or floating point value');
    }
  }
}

/** Decodes the first CBOR item at `offset`, reporting how many bytes it consumed. */
function decodeFirst(buffer, offset = 0) {
  if (!Buffer.isBuffer(buffer)) throw new CborError('CBOR input must be a Buffer');
  const reader = { buf: buffer, offset };
  const value = readItem(reader, 0);
  return { value, bytesRead: reader.offset - offset };
}

/** Decodes exactly one CBOR item that must consume the entire buffer. */
function decodeAll(buffer) {
  const { value, bytesRead } = decodeFirst(buffer, 0);
  if (bytesRead !== buffer.length) {
    throw new CborError(`trailing bytes after the CBOR item (${buffer.length - bytesRead} unused)`);
  }
  return value;
}

module.exports = { decodeFirst, decodeAll, CborError };
