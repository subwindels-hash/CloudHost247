/**
 * PNG physical-size metadata.
 *
 * A PNG is a grid of pixels with no inherent size. A barcode rendered at 4 pixels per module is
 * only "0.34 mm per module" if whatever prints it knows the grid was drawn for 300 dpi — otherwise a
 * layout program places it at its own default (usually 72 or 96 dpi) and the symbol comes out three
 * to four times too large. The `pHYs` chunk carries that resolution, and writing it is the
 * difference between an image that prints at the size it was generated for and one that has to be
 * resized by hand, which is how module widths get rounded into unreadable ones.
 *
 * Pure byte manipulation: no decoding, no re-encoding, so the pixels cannot change.
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      crcTable[index] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crcTable[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset] as number) << 24) | ((bytes[offset + 1] as number) << 16) | ((bytes[offset + 2] as number) << 8) | (bytes[offset + 3] as number)) >>> 0;
}

function writeUint32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 8 && PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

/** Pixel dimensions from the IHDR chunk, or null when the bytes are not a PNG. */
export function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (!isPng(bytes) || bytes.length < 24) return null;
  return { width: readUint32(bytes, 16), height: readUint32(bytes, 20) };
}

/**
 * Return a copy of `png` that declares `dpi` as its resolution.
 *
 * An existing `pHYs` chunk is replaced. The chunk is placed directly after `IHDR`, which satisfies
 * the specification's requirement that it precede the image data. Input that is not a PNG is
 * returned untouched rather than corrupted.
 */
export function setPngDpi(png: Uint8Array, dpi: number): Uint8Array {
  if (!isPng(png) || !(dpi > 0)) return png;
  const pixelsPerMetre = Math.round(dpi / 0.0254);

  const chunk = new Uint8Array(21);
  writeUint32(chunk, 0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  writeUint32(chunk, 8, pixelsPerMetre);
  writeUint32(chunk, 12, pixelsPerMetre);
  chunk[16] = 1; // unit: metre
  writeUint32(chunk, 17, crc32(chunk.subarray(4, 17)));

  const kept: Uint8Array[] = [png.subarray(0, 8)];
  let offset = 8;
  let inserted = false;
  while (offset + 12 <= png.length) {
    const length = readUint32(png, offset);
    const type = String.fromCharCode(png[offset + 4] as number, png[offset + 5] as number, png[offset + 6] as number, png[offset + 7] as number);
    const end = offset + 12 + length;
    if (end > png.length) break;
    if (type !== 'pHYs') kept.push(png.subarray(offset, end));
    if (type === 'IHDR' && !inserted) {
      kept.push(chunk);
      inserted = true;
    }
    offset = end;
  }
  if (!inserted) return png;

  const total = kept.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of kept) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

/** The resolution a PNG declares, in dots per inch, or null when it declares none. */
export function readPngDpi(png: Uint8Array): number | null {
  if (!isPng(png)) return null;
  let offset = 8;
  while (offset + 12 <= png.length) {
    const length = readUint32(png, offset);
    const type = String.fromCharCode(png[offset + 4] as number, png[offset + 5] as number, png[offset + 6] as number, png[offset + 7] as number);
    if (type === 'pHYs' && length === 9 && png[offset + 16] === 1) return Math.round(readUint32(png, offset + 8) * 0.0254);
    if (type === 'IDAT') return null;
    offset += 12 + length;
  }
  return null;
}
