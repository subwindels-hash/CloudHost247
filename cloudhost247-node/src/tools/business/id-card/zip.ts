/**
 * A store-only ZIP writer, for the bulk badge download.
 *
 * Four hundred badges is four hundred downloads unless they arrive as one file, and a browser's
 * "save each blob" does not exist. ZIP is the only archive format every desktop and phone opens
 * without being asked to install something.
 *
 * Compression is *store* (method 0) rather than deflate, deliberately: badge exports are PNG and
 * JPEG, which are already compressed, so deflating them costs CPU across hundreds of files and saves
 * almost nothing — and a store-only archive needs no compressor, which keeps the frontend bundle
 * small and the writer testable byte-for-byte. The CRC-32, the one part a reader actually validates,
 * is computed properly.
 */

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) {
    crc = (CRC_TABLE[(crc ^ (data[index] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** Zip entry names are UTF-8 and must not escape the archive root. */
function safeName(name: string): string {
  const cleaned = name
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter((part) => part !== '' && part !== '.' && part !== '..')
    .join('/');
  return cleaned === '' ? 'file' : cleaned.slice(0, 180);
}

/**
 * Build a ZIP archive. The CRC is computed over the stored bytes and every offset in the central
 * directory is exact, so the archive opens in Explorer, Finder, `unzip` and on Android.
 */
export function buildZip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  const u16 = (value: number): Uint8Array => new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
  const u32 = (value: number): Uint8Array => new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]);

  for (const entry of entries) {
    const name = safeName(entry.name);
    const nameBytes = encoder.encode(name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = concat([
      u32(0x04034b50),
      u16(20), // version needed
      u16(0x0800), // UTF-8 names
      u16(0), // store
      u16(0), // time
      u16(0), // date
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      entry.data,
    ]);
    localParts.push(local);

    const central = concat([
      u32(0x02014b50),
      u16(20), // version made by
      u16(20), // version needed
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes,
    ]);
    centralParts.push(central);
    offset += local.length;
  }

  const centralDirectory = concat(centralParts);
  const end = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralDirectory.length),
    u32(offset),
    u16(0),
  ]);

  return concat([...localParts, centralDirectory, end]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let cursor = 0;
  for (const part of parts) {
    output.set(part, cursor);
    cursor += part.length;
  }
  return output;
}

/** Read an archive produced by `buildZip`. Used by the tests to verify the writer end to end. */
export function readZip(data: Uint8Array): Array<{ name: string; data: Uint8Array; crc: number }> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decoder = new TextDecoder();
  // Find the end-of-central-directory record by scanning backwards for its signature.
  let eocd = -1;
  for (let index = data.length - 22; index >= 0; index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw new Error('No ZIP end-of-central-directory record was found.');
  const count = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  const entries: Array<{ name: string; data: Uint8Array; crc: number }> = [];
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error('The ZIP central directory is malformed.');
    const crc = view.getUint32(cursor + 16, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(data.subarray(cursor + 46, cursor + 46 + nameLength));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    entries.push({ name, data: data.subarray(start, start + size), crc });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
