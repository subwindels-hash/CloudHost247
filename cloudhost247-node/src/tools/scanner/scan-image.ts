/**
 * Barcode Scanner: the API side. Reads barcodes from an uploaded PNG.
 *
 * The scanner page decodes in the visitor's browser and never calls this. It exists for the general
 * tool page, the embedded build and anyone using the API, and it takes the same input as the QR
 * Scanner: an image as a Base64 data URL. Only PNG is accepted, because PNG is the one format this
 * server can decode without a native imaging library.
 *
 * The server runs the basic decoder, which reads fewer types than the scanner page does in a
 * browser (see `formats.ts`). Every answer lists the types read here, and an answer that found
 * nothing says where the others are read.
 *
 * The content of a barcode is reported as text and nothing else is done with it: a web address in a
 * code is never fetched, opened or followed.
 */

import { PNG } from 'pngjs';
import { invalidInput } from '../core/errors';
import { BASIC_SCAN_FORMATS, SCAN_FORMATS, kindOf, scanPixels, visibleText } from './decode';

const MAX_BASE64 = 4 * 1024 * 1024;
const MAX_BYTES = 8 * 1024 * 1024;
/** A decoded image this size is 64 MB of pixels; larger would be a way to exhaust the worker. */
const MAX_SIDE = 4096;

export interface BarcodeScanResult {
  found: boolean;
  count: number;
  codes: Array<{ type: string; content: string; contentKind: string; caution: string | null; characters: number }>;
  image: { width: number; height: number; bytes: number };
  reads: string[];
  notes: string[];
}

const READS = BASIC_SCAN_FORMATS.map((format) => (format.covers ? `${format.name} (${format.covers})` : format.name));
const PAGE_ONLY = SCAN_FORMATS.filter((format) => format.fullOnly).map((format) => format.name);

export function scanImage(input: { image: string }): BarcodeScanResult {
  const raw = input.image ?? '';
  if (raw.length === 0) throw invalidInput('Upload a PNG image that contains the barcode.');
  if (raw.length > MAX_BASE64) throw invalidInput(`The uploaded image is too large (limit ${Math.round(MAX_BASE64 / 1024 / 1024)} MB of Base64 data).`);
  const base64 = raw.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw invalidInput('The image data is not valid Base64.');
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0) throw invalidInput('The uploaded image is empty.');
  if (buffer.length > MAX_BYTES) throw invalidInput('The decoded image exceeds the 8 MB limit.');

  // The size is read from the header before any pixel is decoded, so an image that would expand to
  // gigabytes is refused without being expanded.
  const isPng = buffer.length >= 24 && buffer.readUInt32BE(0) === 0x89504e47 && buffer.readUInt32BE(4) === 0x0d0a1a0a;
  if (!isPng) throw invalidInput('The image is not a PNG. Save or export it as PNG and try again. Uploaded images are read as PNG only; the scanner page at /tools/barcode-scanner also reads JPEG and other picture formats, in your browser.');
  const declaredWidth = buffer.readUInt32BE(16);
  const declaredHeight = buffer.readUInt32BE(20);
  if (declaredWidth === 0 || declaredHeight === 0 || declaredWidth > MAX_SIDE || declaredHeight > MAX_SIDE) {
    throw invalidInput(`Images larger than ${MAX_SIDE} × ${MAX_SIDE} pixels are not accepted.`);
  }

  let png: PNG;
  try {
    png = PNG.sync.read(buffer);
  } catch {
    throw invalidInput('The PNG could not be decoded. Export it again and retry.');
  }

  const hit = scanPixels({ data: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength), width: png.width, height: png.height }, 'thorough');
  const image = { width: png.width, height: png.height, bytes: buffer.length };
  if (!hit) {
    return {
      found: false,
      count: 0,
      codes: [],
      image,
      reads: READS,
      notes: [
        'No barcode was read from this image. Try a sharper, closer picture with the whole code and the clear space around it in view, and even lighting without glare.',
        `Only the barcode types listed under "reads" are recognised here. The scanner page at /tools/barcode-scanner reads ${PAGE_ONLY.length} more in your browser: ${PAGE_ONLY.join(', ')}.`,
        'The image was decoded on the CloudHost247 server and was not stored or sent anywhere else.',
      ],
    };
  }
  const kind = kindOf(hit);
  return {
    found: true,
    count: 1,
    codes: [{ type: hit.formatName, content: visibleText(hit.text), contentKind: kind.label, caution: kind.caution ?? null, characters: hit.text.length }],
    image,
    reads: READS,
    notes: [
      'One barcode is read per image. Crop to a single code if the picture holds several.',
      'The content is reported as text. Nothing in it was opened, dialled or followed.',
      'The image was decoded on the CloudHost247 server and was not stored or sent anywhere else.',
    ],
  };
}
