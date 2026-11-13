/**
 * Barcode Scanner: its two decoders.
 *
 *  - The basic one, ZXing in JavaScript, which the API runs on the server and the scanner page
 *    falls back to in a browser that will not run WebAssembly.
 *  - The full one, zxing-cpp as WebAssembly, which the scanner page runs everywhere else. It is run
 *    here under Node through the same code the page uses (`frontend/src/lib/scan-cpp.ts`), with the
 *    library started from its installed binary.
 *
 * The barcodes read here are produced by the Barcode Generator's encoder (BWIPP) and read by a
 * different library, so a pass means two independent implementations agree on what the symbol
 * holds; where both decoders read a symbol, three do. Every image is an actual PNG file, decoded
 * from its bytes.
 *
 * What is not tested here: a real camera. Blur, glare and perspective are the camera's contribution
 * and cannot be reproduced honestly in a unit test. Nor a browser: that the page loads the full
 * decoder under the site's security policy, and falls back without it, is e2e/barcode-scanner.spec.ts.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { ZXingStringEncoding } from '@zxing/library';
import bwipjs from 'bwip-js';
import { PNG } from 'pngjs';
import { prepareZXingModule as prepareWriter, writeBarcode } from 'zxing-wasm/writer';

import { CPP_BAR_FORMATS, CPP_FORMATS, CPP_INVERTED_OPTIONS, CPP_OPTIONS, fromBytes, hitFromCpp, onWhite, scanFrame, scanStill, type CppRead, type CppResult } from '../../frontend/src/lib/scan-cpp';
import { NON_PERSISTABLE_TOOL_SLUGS, TOOL_CATALOG } from '../../src/tools/catalog';
import { ToolError } from '../../src/tools/core/errors';
import { handlerFor, targetFor } from '../../src/tools/handlers';
import { renderSymbolPng } from '../../src/tools/design-studio/barcode/encoder';
import { symbologyById, type Symbology } from '../../src/tools/design-studio/barcode/symbologies';
import { BASIC_SCAN_FORMATS, SCAN_BUDGET_MS, SCAN_FORMATS, kindOf, luminanceOf, scanHit, scanPasses, scanPixels, telepenNumber, visibleText, type ScanHit, type ScanPixels } from '../../src/tools/scanner/decode';
import { scanImage, type BarcodeScanResult } from '../../src/tools/scanner/scan-image';
import { libraryReader } from '../helpers/barcode-reader';

const symbology = (id: string): Symbology => {
  const found = symbologyById(id);
  if (!found) throw new Error(`No barcode type ${id}.`);
  return found;
};

/** A PNG of a barcode type's sample, on white, as the Barcode Generator would hand it out. */
async function barcodePng(id: string, options: { data?: string; quarterTurns?: number; dpi?: number } = {}): Promise<Uint8Array> {
  const entry = symbology(id);
  // Content given by a test is encoded byte for byte, so a CRLF stays a CRLF.
  const bitmap = await renderSymbolPng({ symbology: entry, data: options.data ?? entry.sample, ...(options.data !== undefined ? { verbatim: true } : {}), dpi: options.dpi ?? 300, quietZone: true, background: '#ffffff', quarterTurns: options.quarterTurns ?? 0 });
  return bitmap.png;
}

/** A PNG of a barcode the Barcode Generator does not offer, drawn by the same encoder library directly. */
async function encoderPng(options: Record<string, unknown>): Promise<Uint8Array> {
  const draw = bwipjs as unknown as { toBuffer(options: Record<string, unknown>): Promise<Buffer> };
  return new Uint8Array(await draw.toBuffer({ scale: 4, paddingwidth: 12, paddingheight: 12, backgroundcolor: 'ffffff', ...options }));
}

let writer: Promise<unknown> | null = null;

/**
 * A PNG of a barcode drawn by the full decoder's own library (its encoder is zint), for the one
 * thing BWIPP will not draw: a QR Code in Kanji mode, which is how QR Codes printed in Japan hold
 * their text.
 */
async function libraryPng(text: string, format: 'QRCode'): Promise<Uint8Array> {
  if (!writer) {
    const binary = readFileSync(createRequire(__filename).resolve('zxing-wasm/writer/zxing_writer.wasm'));
    writer = Promise.resolve(prepareWriter({ overrides: { wasmBinary: binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength) as ArrayBuffer }, fireImmediately: true }));
  }
  await writer;
  const drawn = await writeBarcode(text, { format, scale: 4, withQuietZones: true });
  if (drawn.error || !drawn.image) throw new Error(`The library could not draw ${format}: ${drawn.error}`);
  return new Uint8Array(await drawn.image.arrayBuffer());
}

const dataUrl = (png: Uint8Array): string => `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
const pixelsOf = (png: Uint8Array): ScanPixels => {
  const image = PNG.sync.read(Buffer.from(png));
  return { data: new Uint8Array(image.data), width: image.width, height: image.height };
};

/** A white (or other) canvas with an image pasted onto it, optionally enlarged by a whole factor. */
function placedOn(png: Uint8Array, width: number, height: number, left: number, top: number, scale = 1, paper = 255): Uint8Array {
  const source = PNG.sync.read(Buffer.from(png));
  const canvas = new PNG({ width, height });
  canvas.data.fill(paper);
  for (let offset = 3; offset < canvas.data.length; offset += 4) canvas.data[offset] = 255;
  for (let y = 0; y < source.height * scale; y += 1) {
    for (let x = 0; x < source.width * scale; x += 1) {
      const from = (Math.floor(y / scale) * source.width + Math.floor(x / scale)) * 4;
      const to = ((top + y) * width + left + x) * 4;
      canvas.data[to] = source.data[from] as number;
      canvas.data[to + 1] = source.data[from + 1] as number;
      canvas.data[to + 2] = source.data[from + 2] as number;
    }
  }
  return new Uint8Array(PNG.sync.write(canvas));
}

/** A second image pasted onto a picture. */
function withAlso(picture: Uint8Array, png: Uint8Array, left: number, top: number): Uint8Array {
  const page = PNG.sync.read(Buffer.from(picture));
  const source = PNG.sync.read(Buffer.from(png));
  for (let y = 0; y < source.height; y += 1) {
    source.data.copy(page.data, ((top + y) * page.width + left) * 4, y * source.width * 4, (y + 1) * source.width * 4);
  }
  return new Uint8Array(PNG.sync.write(page));
}

function inverted(png: Uint8Array): Uint8Array {
  const image = PNG.sync.read(Buffer.from(png));
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data[offset] = 255 - (image.data[offset] as number);
    image.data[offset + 1] = 255 - (image.data[offset + 1] as number);
    image.data[offset + 2] = 255 - (image.data[offset + 2] as number);
  }
  return new Uint8Array(PNG.sync.write(image));
}

async function refusal(run: () => unknown): Promise<ToolError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ToolError) return error;
    throw error;
  }
  throw new Error('Expected a refusal.');
}

/**
 * What the scanner reports for the Barcode Generator's own samples: the type by the scanner's name
 * for it, and the content. Where the content is not the sample text, the reason is given. Both
 * decoders are held to this list.
 */
const READS: Array<{ id: string; type: string; content: string; why?: string }> = [
  { id: 'qrcode', type: 'QR Code', content: 'https://cloudhost247.com/tools' },
  { id: 'datamatrix', type: 'Data Matrix', content: 'CH247-DM-0001' },
  { id: 'datamatrix-rectangular', type: 'Data Matrix', content: 'CH247-0001' },
  { id: 'aztec', type: 'Aztec Code', content: 'CH247 Aztec 0001' },
  { id: 'pdf417', type: 'PDF417', content: 'CloudHost247 PDF417 sample' },
  { id: 'code128', type: 'Code 128', content: 'CH247-000123' },
  { id: 'code39', type: 'Code 39', content: 'PART-1234' },
  { id: 'code93', type: 'Code 93', content: 'CODE 93' },
  { id: 'code93ext', type: 'Code 93', content: 'Code93 Ext' },
  { id: 'itf', type: 'Interleaved 2 of 5', content: '2401234567' },
  { id: 'itf14', type: 'Interleaved 2 of 5', content: '09521234543213' },
  { id: 'codabar', type: 'Codabar', content: 'A0123456789B' },
  { id: 'ean13', type: 'EAN-13', content: '9520123456788' },
  { id: 'ean8', type: 'EAN-8', content: '95200002' },
  { id: 'upca', type: 'UPC-A', content: '012345000058' },
  { id: 'isbn', type: 'EAN-13', content: '9781565812314', why: 'An ISBN-13 is an EAN-13; the hyphens are presentation.' },
  { id: 'issn', type: 'EAN-13', content: '9770311175001', why: '977 + the ISSN digits + variant 00 + the EAN check digit.' },
  { id: 'ismn', type: 'EAN-13', content: '9790260532113', why: 'An ISMN-13 is an EAN-13.' },
  // A GS1 DataBar holds a GTIN, sent as a GS1 element string: 01 and the fourteen digits.
  { id: 'databar', type: 'GS1 DataBar', content: '0109521234543213', why: '(01)09521234543213 without the brackets.' },
  { id: 'databar-truncated', type: 'GS1 DataBar', content: '0109521234543213', why: '(01)09521234543213 without the brackets.' },
  { id: 'databar-stacked', type: 'GS1 DataBar', content: '0109521234543213', why: '(01)09521234543213 without the brackets.' },
  { id: 'databar-stacked-omni', type: 'GS1 DataBar', content: '0124012345678905', why: '(01)24012345678905 without the brackets.' },
  // GS1 element strings come out as their digits run together: the brackets are print, not data.
  { id: 'gs1-128', type: 'Code 128', content: '010952123454321310AB123', why: '(01)09521234543213(10)AB123 without the brackets.' },
  { id: 'sscc18', type: 'Code 128', content: '00095287654321012346', why: '(00)095287654321012346 without the brackets.' },
  { id: 'ean14', type: 'Code 128', content: '0109528765432108', why: '(01)09528765432108 without the brackets.' },
  // The FNC1 that marks a GS1 Data Matrix is a mark and not data, so it is not part of the content.
  { id: 'gs1-datamatrix', type: 'Data Matrix', content: '01095212345432131726123110AB123', why: '(01)…(17)…(10)… without the brackets.' },
  { id: 'gs1-qr', type: 'QR Code', content: '010952123454321310AB123', why: '(01)09521234543213(10)AB123 without the brackets.' },
  { id: 'pzn', type: 'Code 39', content: '-1234562', why: 'PZN7: "-" + six digits + check digit 2.' },
  { id: 'hibc128', type: 'Code 128', content: '+A999BJC5D6E71.', why: 'HIBC: "+" + data + check character.' },
  { id: 'identcode', type: 'Interleaved 2 of 5', content: '563102430313' },
  // Code 39 is reported as the characters printed, whichever reading its maker had in mind.
  { id: 'code39ext', type: 'Code 39', content: 'P+A+R+T-1234', why: 'Full ASCII Code 39 writes a lower-case letter as "+" and the capital.' },
  { id: 'hibc39', type: 'Code 39', content: '+A999BJC5D6E71.', why: 'HIBC: "+" + data + check character. Not "a999…", which the full ASCII reading would make of "+A".' },
  { id: 'code32', type: 'Code 39', content: '0CSSBD', why: 'The six Code 39 characters an Italian pharmacode is printed as.' },
  { id: 'pzn8', type: 'Code 39', content: '-02758089', why: 'PZN8: "-" + seven digits + check digit.' },
];

/** The types only the full decoder reads, from the generator's samples. rMQR, which the generator does not draw, is read separately. */
const FULL_ONLY_READS: Array<{ id: string; type: string; content: string; why?: string }> = [
  { id: 'upce', type: 'UPC-E', content: '01234558', why: 'The eight digits printed under the bars, as typed.' },
  { id: 'databar-limited', type: 'GS1 DataBar Limited', content: '0109521234543213', why: '(01)09521234543213 without the brackets.' },
  { id: 'databar-expanded', type: 'GS1 DataBar Expanded', content: '01095212345432133103000123', why: '(01)09521234543213(3103)000123 without the brackets.' },
  { id: 'databar-expanded-stacked', type: 'GS1 DataBar Expanded', content: '01095212345432133103000123', why: '(01)09521234543213(3103)000123 without the brackets.' },
  { id: 'microqr', type: 'Micro QR Code', content: '12345678' },
  { id: 'micropdf417', type: 'MicroPDF417', content: 'MicroPDF417' },
  { id: 'hibc-micropdf417', type: 'MicroPDF417', content: '+A999BJC5D6E71.' },
  { id: 'telepen', type: 'Telepen', content: 'ABC-123' },
  { id: 'maxicode', type: 'MaxiCode', content: 'CloudHost247 MaxiCode' },
];

const RMQR = { type: 'rMQR Code', content: 'CH247 rMQR 0001' };
const rmqrPng = (): Promise<Uint8Array> => encoderPng({ bcid: 'rectangularmicroqrcode', text: RMQR.content, version: 'R11x77' });

/** Types the generator draws that neither decoder reads. */
const NEVER_READ = ['postnet', 'planet', 'royalmail', 'kix', 'usps-imb', 'auspost', 'japanpost', 'daft', 'pharmacode', 'pharmacode2', 'msi', 'code11', 'code2of5', 'industrial2of5', 'flattermarken', 'dotcode', 'hanxin'];

/** The full decoder, as the page runs it: the library's reading function behind the page's own code. */
let read: CppRead;
beforeAll(async () => {
  const library = await libraryReader();
  read = (pixels, options) => library(pixels, options);
});
const fullStill = (png: Uint8Array): Promise<ScanHit | null> => scanStill(read, pixelsOf(png));

async function scan(png: Uint8Array): Promise<BarcodeScanResult> {
  const handler = handlerFor('barcode-scanner');
  if (!handler) throw new Error('No handler is registered for the Barcode Scanner.');
  return (await handler({ image: dataUrl(png) }, {} as never)) as BarcodeScanResult;
}

/* ------------------------------------------------------------------ */
/* What it reads                                                       */
/* ------------------------------------------------------------------ */

describe('the basic decoder, through the API: reading the Barcode Generator’s output', () => {
  it('reads thirteen barcode types, each exercised below', () => {
    expect(BASIC_SCAN_FORMATS.map((format) => format.name)).toEqual(['QR Code', 'Data Matrix', 'Aztec Code', 'PDF417', 'Code 128', 'Code 39', 'Code 93', 'Interleaved 2 of 5', 'Codabar', 'EAN-13', 'EAN-8', 'UPC-A', 'GS1 DataBar']);
    expect(new Set(BASIC_SCAN_FORMATS.map((format) => format.id)).size).toBe(13);
    // They are the first thirteen of the whole list, which is how the page counts them out.
    expect(SCAN_FORMATS.slice(0, 13)).toEqual(BASIC_SCAN_FORMATS);
    expect(SCAN_FORMATS.slice(13).every((format) => format.fullOnly === true)).toBe(true);
    // Every type this decoder claims is read from a real image in this file.
    expect([...new Set(READS.map((entry) => entry.type))].sort()).toEqual(BASIC_SCAN_FORMATS.map((format) => format.name).sort());
  });

  it.each(READS)('$id: reads $type "$content"', async ({ id, type, content }) => {
    const result = await scan(await barcodePng(id));
    expect(result.found).toBe(true);
    expect(result.count).toBe(1);
    expect(result.codes.map((code) => [code.type, code.content])).toEqual([[type, content]]);
    const image = PNG.sync.read(Buffer.from(await barcodePng(id)));
    expect(result.image).toMatchObject({ width: image.width, height: image.height });
  });

  it('reads a linear barcode whichever way up the picture is', async () => {
    for (const id of ['code128', 'ean13', 'code39', 'itf14', 'codabar', 'upca', 'databar', 'pdf417']) {
      const expected = READS.find((entry) => entry.id === id);
      for (const quarterTurns of [1, 2, 3]) {
        const result = await scan(await barcodePng(id, { quarterTurns }));
        expect(result.codes.map((code) => code.content), `${id} turned ${quarterTurns * 90} degrees`).toEqual([expected?.content]);
      }
    }
  });

  it('reads a barcode that is a small part of a large picture, and one far larger than it needs to be', async () => {
    const code128 = await barcodePng('code128');
    const qr = await barcodePng('qrcode');
    // A 660-pixel barcode on a 1800 x 1300 page, off-centre.
    expect((await scan(placedOn(code128, 1800, 1300, 900, 150))).codes[0]?.content).toBe('CH247-000123');
    expect((await scan(placedOn(qr, 1800, 1300, 200, 900))).codes[0]?.content).toBe('https://cloudhost247.com/tools');
    // The same barcodes enlarged four times, in a twelve-megapixel picture: read from a reduced copy.
    expect((await scan(placedOn(code128, 4000, 3000, 600, 900, 4))).codes[0]?.content).toBe('CH247-000123');
    expect((await scan(placedOn(qr, 4000, 3000, 1500, 1000, 4))).codes[0]?.content).toBe('https://cloudhost247.com/tools');
  }, 60_000);

  it('reads light bars on a dark background', async () => {
    expect((await scan(inverted(await barcodePng('code128')))).codes[0]?.content).toBe('CH247-000123');
    expect((await scan(inverted(await barcodePng('qrcode')))).codes[0]?.content).toBe('https://cloudhost247.com/tools');
  });

  it('reads at thermal-printer resolution as well', async () => {
    expect((await scan(await barcodePng('code128', { dpi: 203 }))).codes[0]?.content).toBe('CH247-000123');
    expect((await scan(await barcodePng('ean13', { dpi: 203 }))).codes[0]?.content).toBe('9520123456788');
    expect((await scan(await barcodePng('datamatrix', { dpi: 203 }))).codes[0]?.content).toBe('CH247-DM-0001');
  });

  it('carries text beyond ASCII and line breaks through a QR Code', async () => {
    const text = 'Ọláyínká Adéwálé\n₦5,000 · Jos → Lagos';
    const result = await scan(await barcodePng('qrcode', { data: text }));
    expect(result.codes[0]?.content).toBe(text);
    expect(result.codes[0]?.characters).toBe(text.length);
  });

  it('does not claim the types it cannot read, and says where eight of them are read', async () => {
    // These are drawn correctly: the full decoder reads the first group below, and the generator's
    // own tests cover the rest. This decoder does not recognise them, and its answer says so.
    for (const id of [...FULL_ONLY_READS.map((entry) => entry.id), 'postnet', 'royalmail', 'pharmacode', 'msi', 'code11']) {
      const result = await scan(await barcodePng(id));
      expect(result.found, id).toBe(false);
      expect(result.codes, id).toEqual([]);
    }
    const result = await scan(await rmqrPng());
    expect(result.found).toBe(false);
    expect(result.reads).toEqual(BASIC_SCAN_FORMATS.map((format) => (format.covers ? `${format.name} (${format.covers})` : format.name)));
    expect(result.notes).toContain(
      'Only the barcode types listed under "reads" are recognised here. The scanner page at /tools/barcode-scanner reads 8 more in your browser: UPC-E, GS1 DataBar Limited, GS1 DataBar Expanded, Micro QR Code, rMQR Code, MicroPDF417, Telepen, MaxiCode.'
    );
  }, 120_000);

  it('keeps the separators between the fields of a GS1-128, and the GTIN of a GS1 DataBar that has a composite part', async () => {
    // Batch AB123, then serial SER99. Without the separator the two cannot be told from one long batch number.
    const fields = await scan(await barcodePng('gs1-128', { data: '(01)09521234543213(10)AB123(21)SER99' }));
    expect(fields.codes.map((code) => [code.type, code.content])).toEqual([['Code 128', '010952123454321310AB123\u241d21SER99']]);
    const matrix = await scan(await barcodePng('gs1-datamatrix', { data: '(01)09521234543213(10)AB123(21)SER99' }));
    expect(matrix.codes.map((code) => [code.type, code.content])).toEqual([['Data Matrix', '010952123454321310AB123\u241d21SER99']]);
    // The two-dimensional part above the bars is not read, and the bars' GTIN is not altered by its presence.
    for (const id of ['databar-composite', 'databar-stacked-composite', 'databar-stacked-omni-composite']) {
      expect((await scan(await barcodePng(id))).codes.map((code) => [code.type, code.content]), id).toEqual([['GS1 DataBar', '0109521234543213']]);
    }
  });

  it('takes a GS1 mark off the content only where the symbol carries the mark', async () => {
    // Data that merely looks like the mark stays as it is.
    expect(scanPixels(pixelsOf(await encoderPng({ bcid: 'code128', text: ']C1ABC', height: 12 })))).toMatchObject({ format: 'code_128', text: ']C1ABC' });
    expect(scanPixels(pixelsOf(await encoderPng({ bcid: 'datamatrix', text: '^029ABC', parse: true })))).toMatchObject({ format: 'data_matrix', text: '\u001dABC' });
    // An FNC1 inside a Code 128 that is not GS1 is a separator there too.
    expect(scanPixels(pixelsOf(await encoderPng({ bcid: 'code128', text: 'AB^FNC1CD', parsefnc: true, height: 12 })))).toMatchObject({ format: 'code_128', text: 'AB\u001dCD' });
  });
});

/* ------------------------------------------------------------------ */
/* The camera's mode                                                   */
/* ------------------------------------------------------------------ */

describe('one frame at a time', () => {
  it('reads an upright barcode in a single quick pass, and a sideways one on the alternate pass', async () => {
    const upright = pixelsOf(await barcodePng('code128'));
    const sideways = pixelsOf(await barcodePng('code128', { quarterTurns: 1 }));
    expect(scanPixels(upright, 'quick', false)?.text).toBe('CH247-000123');
    expect(scanPixels(upright, 'quick', true)).toBeNull();
    expect(scanPixels(sideways, 'quick', false)).toBeNull();
    expect(scanPixels(sideways, 'quick', true)?.text).toBe('CH247-000123');
    // A 2D code has no "way up" for this purpose.
    const qr = pixelsOf(await barcodePng('qrcode'));
    expect(scanPixels(qr, 'quick', false)?.text).toBe('https://cloudhost247.com/tools');
    expect(scanPixels(qr, 'quick', true)?.text).toBe('https://cloudhost247.com/tools');
  });

  it('reads a barcode in a camera-sized frame', async () => {
    const frame = pixelsOf(placedOn(await barcodePng('ean13'), 1280, 720, 400, 200));
    expect(scanPixels(frame, 'quick')).toMatchObject({ format: 'ean_13', formatName: 'EAN-13', text: '9520123456788' });
  });

  it('gives up on an empty frame quickly, so the next frame gets its turn', () => {
    const blank: ScanPixels = { data: new Uint8Array(1280 * 720 * 4).fill(255), width: 1280, height: 720 };
    const started = Date.now();
    for (let frame = 0; frame < 5; frame += 1) expect(scanPixels(blank, 'quick', frame % 2 === 1)).toBeNull();
    // Five frames in well under the time one exhaustive search may take.
    expect(Date.now() - started).toBeLessThan(SCAN_BUDGET_MS);
  });

  it('returns nothing, without throwing, for pixels that are not an image', () => {
    expect(scanPixels({ data: new Uint8Array(0), width: 0, height: 0 }, 'quick')).toBeNull();
    expect(scanPixels({ data: new Uint8Array(10), width: 100, height: 100 }, 'thorough')).toBeNull();
    expect(scanPasses({ data: new Uint8Array(10), width: 100, height: 100 })).toEqual([]);
  });

  it('offers the passes over a still image one at a time, the first of which reads a clean barcode', async () => {
    const passes = scanPasses(pixelsOf(await barcodePng('code128')));
    expect(passes.length).toBeGreaterThanOrEqual(6);
    expect(passes[0]?.()?.text).toBe('CH247-000123');
    // A sideways barcode is found by the second pass, not the first.
    const turned = scanPasses(pixelsOf(await barcodePng('code128', { quarterTurns: 1 })));
    expect(turned[0]?.()).toBeNull();
    expect(turned[1]?.()?.text).toBe('CH247-000123');
  });

  it('treats a transparent background as white paper', async () => {
    const entry = symbology('code128');
    const transparent = (await renderSymbolPng({ symbology: entry, data: entry.sample, dpi: 300, quietZone: true })).png;
    const pixels = pixelsOf(transparent);
    // The corner pixel is fully transparent black, and counts as white.
    expect([pixels.data[0], pixels.data[1], pixels.data[2], pixels.data[3]]).toEqual([0, 0, 0, 0]);
    expect(luminanceOf(pixels)[0]).toBe(255);
    expect(scanPixels(pixels, 'quick')?.text).toBe('CH247-000123');
  });
});

/* ------------------------------------------------------------------ */
/* The full decoder                                                    */
/* ------------------------------------------------------------------ */

describe('the full decoder, as the scanner page runs it', () => {
  it('reads twenty-one barcode types, each exercised below', () => {
    expect(SCAN_FORMATS.map((format) => format.name)).toEqual([
      'QR Code', 'Data Matrix', 'Aztec Code', 'PDF417', 'Code 128', 'Code 39', 'Code 93', 'Interleaved 2 of 5', 'Codabar', 'EAN-13', 'EAN-8', 'UPC-A', 'GS1 DataBar',
      'UPC-E', 'GS1 DataBar Limited', 'GS1 DataBar Expanded', 'Micro QR Code', 'rMQR Code', 'MicroPDF417', 'Telepen', 'MaxiCode',
    ]);
    expect(new Set(SCAN_FORMATS.map((format) => format.id)).size).toBe(21);
    // Every type the scanner claims is read from a real image in this file.
    expect([...new Set([...READS, ...FULL_ONLY_READS, RMQR].map((entry) => entry.type))].sort()).toEqual(SCAN_FORMATS.map((format) => format.name).sort());
  });

  it.each([...READS, ...FULL_ONLY_READS])('$id: reads $type "$content"', async ({ id, type, content }) => {
    const hit = await fullStill(await barcodePng(id));
    expect(hit && [hit.formatName, visibleText(hit.text)]).toEqual([type, content]);
  });

  it('reads an rMQR Code, which the Barcode Generator does not draw', async () => {
    expect(await fullStill(await rmqrPng())).toEqual({ format: 'rmqr_code', formatName: RMQR.type, text: RMQR.content });
  });

  it('reports a barcode both decoders read in the same words as the basic decoder', async () => {
    for (const { id } of READS) {
      const pixels = pixelsOf(await barcodePng(id));
      const basic = scanPixels(pixels, 'thorough');
      expect(basic, id).not.toBeNull();
      expect(await scanStill(read, pixels), id).toEqual(basic);
    }
    // The cases where the two libraries disagree until they are put right: GS1 separators and marks,
    // a GS1 DataBar with a composite part, data that looks like a GS1 mark, and a UPC-A written as
    // an EAN-13 with a leading zero.
    const others: Array<[string, Uint8Array]> = [
      ['GS1-128 with three fields', await barcodePng('gs1-128', { data: '(01)09521234543213(10)AB123(21)SER99' })],
      ['GS1 DataMatrix with three fields', await barcodePng('gs1-datamatrix', { data: '(01)09521234543213(10)AB123(21)SER99' })],
      ['GS1 QR Code with three fields', await barcodePng('gs1-qr', { data: '(01)09521234543213(10)AB123(21)SER99' })],
      ['GS1 DataBar with a composite part', await barcodePng('databar-composite')],
      ['GS1 DataBar Stacked with a composite part', await barcodePng('databar-stacked-composite')],
      ['EAN-13 with a composite part', await barcodePng('ean13-composite')],
      ['GS1-128 with a composite part', await barcodePng('gs1-128-composite')],
      ['Code 128 data beginning ]C1', await encoderPng({ bcid: 'code128', text: ']C1ABC', height: 12 })],
      ['Code 128 with an FNC1 inside', await encoderPng({ bcid: 'code128', text: 'AB^FNC1CD', parsefnc: true, height: 12 })],
      ['Data Matrix data beginning with a GS character', await encoderPng({ bcid: 'datamatrix', text: '^029ABC', parse: true })],
      ['EAN-13 beginning with 0', await barcodePng('ean13', { data: '0012345678905' })],
      ['ISBN with a price add-on', await barcodePng('isbn-addon')],
      ['QR Code beyond ASCII', await barcodePng('qrcode', { data: 'Ọláyínká Adéwálé\n₦5,000 · Jos → Lagos' })],
      ['vCard with CRLF line ends', await barcodePng('qrcode', { data: 'BEGIN:VCARD\r\nVERSION:3.0\r\nN:Yusuf;Amina;;;\r\nEND:VCARD' })],
    ];
    for (const [name, png] of others) {
      const pixels = pixelsOf(png);
      const basic = scanPixels(pixels, 'thorough');
      expect(basic, name).not.toBeNull();
      expect(await scanStill(read, pixels), name).toEqual(basic);
    }
    expect(scanPixels(pixelsOf(others[0]?.[1] as Uint8Array))?.text).toBe('010952123454321310AB123\u001d21SER99');
    expect(scanPixels(pixelsOf(others[10]?.[1] as Uint8Array))).toMatchObject({ format: 'upc_a', text: '012345678905' });
  }, 120_000);

  it('reads a barcode whichever way up the picture is, in one look', async () => {
    for (const id of ['code128', 'ean13', 'upce', 'databar', 'databar-limited', 'databar-expanded', 'telepen', 'pdf417', 'micropdf417', 'microqr', 'datamatrix']) {
      const expected = [...READS, ...FULL_ONLY_READS].find((entry) => entry.id === id);
      for (const quarterTurns of [0, 1, 2, 3]) {
        const hit = await scanFrame(read, pixelsOf(await barcodePng(id, { quarterTurns })));
        expect(hit && [hit.formatName, hit.text], `${id} turned ${quarterTurns * 90} degrees`).toEqual([expected?.type, expected?.content]);
      }
    }
  });

  it('reads a barcode that is a small part of a large picture, and one in a camera-sized frame', async () => {
    expect((await fullStill(placedOn(await barcodePng('code128'), 1800, 1300, 900, 150)))?.text).toBe('CH247-000123');
    expect((await fullStill(placedOn(await barcodePng('upce'), 1800, 1300, 200, 600)))?.text).toBe('01234558');
    expect((await fullStill(placedOn(await barcodePng('microqr'), 1800, 1300, 1200, 900)))?.text).toBe('12345678');
    const frame = pixelsOf(placedOn(await barcodePng('ean13'), 1280, 720, 400, 100));
    expect(await scanFrame(read, frame)).toEqual({ format: 'ean_13', formatName: 'EAN-13', text: '9520123456788' });
  });

  it('reads light on dark: the square types in the first look, the types made of bars in a second', async () => {
    const looks: unknown[] = [];
    const watched: CppRead = (pixels, options) => {
      looks.push(options);
      return read(pixels, options);
    };
    expect((await scanStill(watched, pixelsOf(inverted(await barcodePng('qrcode')))))?.text).toBe('https://cloudhost247.com/tools');
    expect(looks).toEqual([CPP_OPTIONS]);
    looks.length = 0;
    expect((await scanStill(watched, pixelsOf(inverted(await barcodePng('code128')))))?.text).toBe('CH247-000123');
    expect(looks).toEqual([CPP_OPTIONS, CPP_INVERTED_OPTIONS]);
    for (const [id, text] of [['ean13', '9520123456788'], ['pdf417', 'CloudHost247 PDF417 sample'], ['upce', '01234558'], ['databar-expanded', '01095212345432133103000123'], ['datamatrix', 'CH247-DM-0001'], ['microqr', '12345678']] as const) {
      expect((await fullStill(inverted(await barcodePng(id))))?.text, id).toBe(text);
    }
    // The library is asked to try light on dark in the first look and does not find bars that way,
    // which is why there is a second. A camera frame gets the first look only.
    expect(CPP_OPTIONS.tryInvert).toBe(true);
    expect(await scanFrame(read, pixelsOf(inverted(await barcodePng('code128'))))).toBeNull();
    expect((await scanFrame(read, pixelsOf(inverted(await barcodePng('qrcode')))))?.text).toBe('https://cloudhost247.com/tools');
  });

  it('lets the screen update between the two looks, and only when there is a second', async () => {
    let pauses = 0;
    const pause = async (): Promise<void> => {
      pauses += 1;
    };
    expect((await scanStill(read, pixelsOf(await barcodePng('code128')), pause))?.text).toBe('CH247-000123');
    expect(pauses).toBe(0);
    const blank: ScanPixels = { data: new Uint8Array(600 * 400 * 4).fill(255), width: 600, height: 400 };
    expect(await scanStill(read, blank, pause)).toBeNull();
    expect(pauses).toBe(1);
  });

  it('gives up on an empty frame quickly, so the next frame gets its turn', async () => {
    const blank: ScanPixels = { data: new Uint8Array(1280 * 720 * 4).fill(255), width: 1280, height: 720 };
    const started = Date.now();
    for (let frame = 0; frame < 5; frame += 1) expect(await scanFrame(read, blank)).toBeNull();
    expect(Date.now() - started).toBeLessThan(SCAN_BUDGET_MS);
  });

  it('returns nothing, without asking the library, for pixels that are not an image', async () => {
    let asked = 0;
    const counting: CppRead = (pixels, options) => {
      asked += 1;
      return read(pixels, options);
    };
    expect(await scanFrame(counting, { data: new Uint8Array(0), width: 0, height: 0 })).toBeNull();
    expect(await scanStill(counting, { data: new Uint8Array(10), width: 100, height: 100 })).toBeNull();
    expect(asked).toBe(0);
  });

  it('treats a transparent background as white paper, and leaves an opaque picture as it is', async () => {
    const entry = symbology('code128');
    const pixels = pixelsOf((await renderSymbolPng({ symbology: entry, data: entry.sample, dpi: 300, quietZone: true })).png);
    expect([pixels.data[0], pixels.data[1], pixels.data[2], pixels.data[3]]).toEqual([0, 0, 0, 0]);
    // The library looks at colour alone, and sees black bars on a black ground.
    expect((await read(pixels, CPP_OPTIONS)).map(hitFromCpp)).toEqual([]);
    const paper = onWhite(pixels);
    expect([paper.data[0], paper.data[1], paper.data[2], paper.data[3]]).toEqual([255, 255, 255, 255]);
    expect((await scanFrame(read, pixels))?.text).toBe('CH247-000123');
    expect((await scanStill(read, pixels))?.text).toBe('CH247-000123');
    const opaque = pixelsOf(await barcodePng('code128'));
    expect(onWhite(opaque)).toBe(opaque);
  });

  it('gives a UPC-E as the eight digits printed under it, and a UPC-A as its twelve', async () => {
    const upce = await fullStill(await barcodePng('upce'));
    expect(upce).toEqual({ format: 'upc_e', formatName: 'UPC-E', text: '01234558' });
    expect(kindOf(upce as ScanHit)).toEqual({ id: 'product', label: 'Product number' });
    // The library reports the thirteen-digit number the symbol stands for, and the printed digits beside it.
    const [raw] = await read(pixelsOf(await barcodePng('upce')), CPP_OPTIONS);
    expect(raw).toMatchObject({ format: 'UPCE', symbology: 'EANUPC', text: '0012345000058', extra: '{"UPCE":"01234558"}' });
    // Were the printed digits ever missing, the number the library read is reported as it is.
    const stated: CppResult = { format: 'UPCE', symbology: 'EANUPC', text: '0012345000058', isValid: true, extra: '' };
    expect(hitFromCpp(stated)?.text).toBe('0012345000058');
    expect(hitFromCpp({ ...stated, extra: '{"UPCE":"0123"}' })?.text).toBe('0012345000058');
    expect(hitFromCpp({ ...stated, extra: 'null' })?.text).toBe('0012345000058');

    expect(await fullStill(await barcodePng('upca'))).toEqual({ format: 'upc_a', formatName: 'UPC-A', text: '012345000058' });
    // The library calls a UPC-A an EAN-13 with a leading zero, which is what it is.
    expect((await read(pixelsOf(await barcodePng('upca')), CPP_OPTIONS))[0]).toMatchObject({ format: 'EAN13', text: '0012345000058' });
    expect(await fullStill(await barcodePng('ean13'))).toEqual({ format: 'ean_13', formatName: 'EAN-13', text: '9520123456788' });
  });

  it('reads a Telepen as text and offers the number the same bars would be', async () => {
    const hit = await fullStill(await barcodePng('telepen'));
    expect(hit).toEqual({ format: 'telepen', formatName: 'Telepen', text: 'ABC-123' });
    expect(kindOf(hit as ScanHit)).toEqual({ id: 'text', label: 'Text', caution: 'Read as text. If this is a numeric Telepen, the same bars are the number 38394018222324.' });
    // Numeric Telepen symbols, read as text and worked back to their number. The library, asked for
    // its own numeric reading of the same picture, gives the same digits.
    for (const number of ['1234567890', '123456789X', '0099', '4711']) {
      const pixels = pixelsOf(await encoderPng({ bcid: 'telepennumeric', text: number, height: 12 }));
      const text = (await scanStill(read, pixels))?.text;
      expect(typeof text, number).toBe('string');
      expect(telepenNumber(text as string), number).toBe(number);
      const [numeric] = await read(pixels, { formats: ['TelepenNumeric'], textMode: 'Plain' });
      expect(numeric).toMatchObject({ format: 'TelepenNumeric', text: number });
    }
    expect((await read(pixelsOf(await barcodePng('telepen')), { formats: ['TelepenNumeric'], textMode: 'Plain' }))[0]?.text).toBe('38394018222324');
    // Text with a character no number produces has no numeric reading.
    expect(telepenNumber('AB\u0005')).toBeNull();
    expect(telepenNumber('')).toBeNull();
    // Content that is plainly something else keeps its own label.
    expect(kindOf({ format: 'telepen', formatName: 'Telepen', text: 'https://example.com' }).id).toBe('web');
  });

  it('is asked for the types on the list and reports no others', async () => {
    expect([...CPP_FORMATS]).toEqual(['QRCode', 'DataMatrix', 'AztecCode', 'PDF417', 'MaxiCode', 'Code128', 'Code39Std', 'Code93', 'ITF', 'Codabar', 'TelepenAlpha', 'EAN13', 'EAN8', 'UPCE', 'DataBar']);
    expect(CPP_OPTIONS.formats).toEqual([...CPP_FORMATS]);
    expect(CPP_INVERTED_OPTIONS.formats).toEqual([...CPP_BAR_FORMATS]);
    expect(CPP_BAR_FORMATS.every((format) => CPP_FORMATS.includes(format))).toBe(true);
    expect(CPP_OPTIONS).toMatchObject({ tryHarder: true, tryRotate: true, tryInvert: true, maxNumberOfSymbols: 1, textMode: 'Plain', tryCode39ExtendedMode: false, eanAddOnSymbol: 'Ignore', returnErrors: false });
    expect(CPP_INVERTED_OPTIONS).toMatchObject({ tryInvert: false, maxNumberOfSymbols: 1, textMode: 'Plain', tryCode39ExtendedMode: false });

    for (const id of NEVER_READ) expect(await fullStill(await barcodePng(id)), id).toBeNull();

    // What the library can report that the scanner does not list is not passed on.
    const result = (fields: Partial<CppResult>): ScanHit | null => hitFromCpp({ format: 'QRCode', symbology: 'QRCode', text: 'x', isValid: true, extra: '', ...fields } as CppResult);
    expect(result({})).toEqual({ format: 'qr_code', formatName: 'QR Code', text: 'x' });
    expect(result({ isValid: false })).toBeNull();
    expect(result({ text: '' })).toBeNull();
    expect(result({ symbology: 'Aztec', format: 'AztecRune' })).toBeNull();
    expect(result({ symbology: 'OtherBarcode', format: 'DXFilmEdge' })).toBeNull();
    expect(result({ symbology: 'EANUPC', format: 'ISBN' })).toBeNull();
    expect(result({ symbology: 'Telepen', format: 'TelepenNumeric' })).toBeNull();
    // The other members of the Code 39 family are readings of the characters, not the characters.
    for (const format of ['Code39Ext', 'Code32', 'PZN'] as const) expect(result({ symbology: 'Code39', format }), format).toBeNull();
    expect(scanHit('not_a_type', 'x')).toBeNull();
  });

  it('reads Code 39 as the characters printed, which the library would not do if asked for the whole family', async () => {
    const hibc = pixelsOf(await barcodePng('hibc39'));
    // Left to choose, the library reads "+A" as the letter "a" and loses the HIBC flag character.
    const [family] = await read(hibc, { ...CPP_OPTIONS, formats: ['Code39'], tryCode39ExtendedMode: true });
    expect(family).toMatchObject({ format: 'Code39Ext', text: 'a999BJC5D6E71.' });
    expect(await scanStill(read, hibc)).toEqual({ format: 'code_39', formatName: 'Code 39', text: '+A999BJC5D6E71.' });
  });

  it('reads a MaxiCode only from a clean, upright image of the code alone, and says so', async () => {
    const maxicode = await barcodePng('maxicode');
    const expected = { format: 'maxicode', formatName: 'MaxiCode', text: 'CloudHost247 MaxiCode' };
    expect(await fullStill(maxicode)).toEqual(expected);
    // On a larger white page it is still the one dark thing in the picture.
    const page = placedOn(maxicode, 1600, 1200, 900, 600);
    expect(await fullStill(page)).toEqual(expected);
    // Turned, on a grey ground, or with anything else in the picture, it is not found.
    expect(await fullStill(await barcodePng('maxicode', { quarterTurns: 1 }))).toBeNull();
    expect(await fullStill(await barcodePng('maxicode', { quarterTurns: 2 }))).toBeNull();
    expect(await fullStill(placedOn(maxicode, 1000, 900, 300, 250, 1, 200))).toBeNull();
    expect((await fullStill(withAlso(page, await barcodePng('code128'), 60, 60)))?.formatName).toBe('Code 128');

    expect(SCAN_FORMATS.find((format) => format.id === 'maxicode')?.covers).toBe('from a clean, upright image only');
    const notes = TOOL_CATALOG.find((entry) => entry.slug === 'barcode-scanner')?.notes ?? [];
    expect(notes).toContain('MaxiCode is read only from a clean, upright image of the code alone, such as a saved label image. It is not read from a camera or a photograph.');
  });

  it('does not read a Codablock F: what either decoder reports is one row of it, and the notes say so', async () => {
    const entry = symbology('codablockf');
    const pixels = pixelsOf(await barcodePng('codablockf'));
    for (const hit of [await scanStill(read, pixels), scanPixels(pixels, 'thorough')]) {
      expect(hit?.formatName).toBe('Code 128');
      expect(hit?.text).not.toBe(entry.sample);
      expect((hit?.text ?? '').length).toBeLessThan(entry.sample.length);
    }
    const notes = TOOL_CATALOG.find((tool) => tool.slug === 'barcode-scanner')?.notes ?? [];
    expect(notes).toContain('Postal barcodes, Code 11, MSI, Pharmacode, DotCode and Han Xin are not read. Nor is Codablock F: it is built from rows of Code 128, and the scanner reports one row of it as a Code 128 barcode, which is a fragment and not the content.');
  });

  it('is described by the catalogue as it is: every type named, the eight that need WebAssembly, and what is left out', () => {
    const entry = TOOL_CATALOG.find((tool) => tool.slug === 'barcode-scanner');
    const notes = entry?.notes ?? [];
    expect(notes[0]).toBe(`The scanner page reads twenty-one barcode types: ${SCAN_FORMATS.slice(0, -1).map((format) => format.name).join(', ')} and ${SCAN_FORMATS[SCAN_FORMATS.length - 1]?.name}.`);
    expect(notes[1]).toBe('The last eight of those types, from UPC-E on, need WebAssembly in the browser. Where a browser has it switched off, the page reads the first thirteen and says so. The API reads the same thirteen from an uploaded PNG.');
    expect(SCAN_FORMATS.findIndex((format) => format.name === 'UPC-E')).toBe(13);
    expect(SCAN_FORMATS.filter((format) => format.fullOnly)).toHaveLength(8);
    expect(notes).toContain('Of a GS1 composite symbol the bars are read and the two-dimensional part printed above them is not. The two- or five-digit add-on beside an EAN or ISBN barcode is not read either.');
    // How text is settled and shown: exercised in "text beyond ASCII", below.
    expect(notes).toContain(
      'Text is read as UTF-8, Latin-1 or Shift JIS, whichever the bytes fit, or in the character set the barcode itself names. A character that cannot be printed, such as the separator between the fields of a GS1 barcode, is shown as a small picture of it (␝). A barcode that holds data and not text is shown one character to each byte.'
    );
  });
});

/* ------------------------------------------------------------------ */
/* Text beyond ASCII, and marks that are not data                      */
/* ------------------------------------------------------------------ */

/**
 * A two-dimensional barcode holds bytes, and mostly does not say what characters they are. The two
 * decoders are different libraries with different habits, and the basic one's library converts
 * bytes one way under Node and another in a browser. Each case below is read by both decoders, which
 * must agree with each other and with what was encoded.
 */
describe('text beyond ASCII: both decoders, in the same words', () => {
  const TWO_D: Array<[string, string]> = [
    ['qrcode', 'QR Code'],
    ['datamatrix', 'Data Matrix'],
    ['pdf417', 'PDF417'],
    ['azteccode', 'Aztec Code'],
  ];
  /** Bytes, written the way the encoder library takes them: ^NNN for each. */
  const bytes = (values: Iterable<number>): string => Array.from(values, (value) => `^${String(value).padStart(3, '0')}`).join('');
  const holding = (bcid: string, values: Iterable<number>, before = ''): Promise<Uint8Array> => encoderPng({ bcid, text: `${before}${bytes(values)}`, parse: true, parsefnc: before !== '', binarytext: true });
  const eci = (number: number): string => `^ECI${String(number).padStart(6, '0')}`;

  /** What both decoders read, having checked that they read the same. */
  async function both(png: Uint8Array, what: string): Promise<{ type: string; text: string } | null> {
    const pixels = pixelsOf(png);
    const basic = scanPixels(pixels, 'thorough');
    const full = await scanStill(read, pixels);
    expect(basic, what).toEqual(full);
    return basic ? { type: basic.formatName, text: basic.text } : null;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(TWO_D)('%s: reads text in UTF-8 and text in Latin-1, where the barcode does not say which it is', async (bcid, type) => {
    const utf8 = 'Ọláyínká Adéwálé ₦5,000 · Jos';
    expect(await both(await holding(bcid, Buffer.from(utf8, 'utf8')), 'UTF-8')).toEqual({ type, text: utf8 });
    const latin1 = 'Café München, señor: 5 €?';
    // In Latin-1 the bytes are the character numbers; there is no euro sign, so the last word is plain.
    const plain = latin1.replace('€', 'EUR');
    expect(await both(await holding(bcid, Buffer.from(plain, 'latin1')), 'Latin-1')).toEqual({ type, text: plain });
    // Japanese in Shift JIS, which is what a barcode printed in Japan is likely to hold.
    expect(await both(await holding(bcid, [0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea]), 'Shift JIS')).toEqual({ type, text: '日本語' });
  });

  it.each(TWO_D)('%s: converts by the character set the barcode states, where it states one', async (bcid, type) => {
    expect(await both(await holding(bcid, Buffer.from('Ọláyínká ₦5', 'utf8'), eci(26)), 'ECI 26')).toEqual({ type, text: 'Ọláyínká ₦5' });
    // ISO-8859-5: Cyrillic. Nothing but the statement says so.
    expect(await both(await holding(bcid, [0xbf, 0xe0, 0xd8, 0xd2, 0xd5, 0xe2], eci(7)), 'ECI 7')).toEqual({ type, text: 'Привет' });
    // Three accented capitals in a row. Stated to be Latin-1, they are read as Latin-1 ...
    const capitals = [0xc0, 0xc9, 0xce, 0x20, 0x41, 0x42, 0x43];
    expect(await both(await holding(bcid, capitals, eci(3)), 'ECI 3')).toEqual({ type, text: 'ÀÉÎ ABC' });
    // ... and unstated, both decoders take the same bytes for Japanese. That is a wrong guess, made by
    // every ZXing; what matters here is that the two decoders make it alike.
    expect(await both(await holding(bcid, capitals), 'unstated')).toEqual({ type, text: 'ﾀﾉﾎ ABC' });
  });

  it.each(TWO_D)('%s: gives bytes that are not text as one character each, and keeps a byte-order mark', async (bcid, type) => {
    expect(await both(await holding(bcid, [0x41, 0x80, 0x85, 0x9f, 0x42]), 'bytes')).toEqual({ type, text: 'A\u0080\u0085\u009fB' });
    expect(await both(await holding(bcid, [0xef, 0xbb, 0xbf, 0x43, 0x61, 0x66, 0xc3, 0xa9]), 'byte-order mark')).toEqual({ type, text: '\ufeffCafé' });
    // A control character among the bytes says they are data, not writing: no guess at Japanese.
    expect(await both(await holding(bcid, [0x71, 0x19, 0xbb, 0x35, 0xa4]), 'data')).toEqual({ type, text: 'q\u0019»5¤' });
  });

  it('reads bytes marked as bytes (ECI 899) one character each', async () => {
    for (const [bcid, type] of [TWO_D[0], TWO_D[2], TWO_D[3]] as Array<[string, string]>) {
      expect(await both(await holding(bcid, [0x41, 0xc8, 0x82, 0x42], eci(899)), bcid)).toEqual({ type, text: 'A\u00c8\u0082B' });
    }
  });

  it('gives the same text whether or not the runtime looks like a browser', async () => {
    // The library asks "is this a browser?" before it converts bytes, and answers differently under
    // Node. It is not asked any more: this decoder gives it one converter for both.
    expect(typeof ZXingStringEncoding.customDecoder).toBe('function');
    const pictures = [
      await holding('datamatrix', Buffer.from('Ọláyínká ₦5', 'utf8')),
      await holding('qrcode', Buffer.from('Café München', 'latin1')),
      await holding('pdf417', Buffer.from('Café München', 'latin1')),
      await holding('azteccode', Buffer.from('Ọláyínká ₦5', 'utf8')),
    ].map(pixelsOf);
    const underNode = pictures.map((pixels) => scanPixels(pixels, 'thorough'));
    expect(underNode.map((hit) => hit?.text)).toEqual(['Ọláyínká ₦5', 'Café München', 'Café München', 'Ọláyínká ₦5']);
    vi.stubGlobal('window', Object.create(null, { [Symbol.toStringTag]: { value: 'Window' } }));
    expect({}.toString.call(window)).toBe('[object Window]');
    expect(pictures.map((pixels) => scanPixels(pixels, 'thorough'))).toEqual(underNode);
  });

  it('reads an Aztec Code with a GS1 mark, an FNC1 between fields, and a mark after a letter or two digits', async () => {
    const aztec = (text: string): Promise<Uint8Array> => encoderPng({ bcid: 'azteccode', text, parsefnc: true });
    const cases: Array<[string, string]> = [
      // The opening FNC1 marks the symbol as GS1 and is not data.
      ['^FNC1010952123454321310AB123', '010952123454321310AB123'],
      // One further in ends a field of variable length, and is the GS character.
      ['^FNC1010952123454321310AB123^FNC121SER99', '010952123454321310AB123\u001d21SER99'],
      ['AB^FNC1CD', 'AB\u001dCD'],
      // After one letter or two digits it is the mark of an industry format, and again not data.
      ['A^FNC1BCD', 'ABCD'],
      ['a^FNC1BCD', 'aBCD'],
      ['12^FNC1ABC', '12ABC'],
      ['1A^FNC1BCD', '1A\u001dBCD'],
      ['#^FNC1BCD', '#\u001dBCD'],
      ['123^FNC1BCD', '123\u001dBCD'],
      // With text beyond ASCII after the mark.
      ['^FNC110Ọlá', '10Ọlá'],
    ];
    for (const [text, expected] of cases) expect(await both(await aztec(text), text)).toEqual({ type: 'Aztec Code', text: expected });
    // The API reads the same.
    expect((await scan(await aztec('^FNC1010952123454321310AB123^FNC121SER99'))).codes).toEqual([
      { type: 'Aztec Code', content: '010952123454321310AB123␝21SER99', contentKind: 'Text', characters: 31, caution: null },
    ]);
  });

  it('reads an Aztec Code through every one of its character tables, and when it changes character set part-way', async () => {
    const aztec = (options: Record<string, unknown>): Promise<Uint8Array> => encoderPng({ bcid: 'azteccode', ...options });
    const texts = [
      'a, b. c: d\r\ne! [f] {g} ~|^_`@\\ 12,3.4',
      'BEGIN:VCARD\r\nVERSION:3.0\r\nN:Yusuf;Amina;;;\r\nTEL:+2348030000000\r\nEMAIL:amina@example.com\r\nEND:VCARD',
      'UPPER lower 0123456789 Mixed\tTab ' + 'x'.repeat(40) + ' 0123456789 '.repeat(12) + 'É',
    ];
    for (const text of texts) expect(await both(await aztec({ text }), text.slice(0, 20))).toEqual({ type: 'Aztec Code', text });
    expect(await both(await aztec({ bcid: 'azteccodecompact', text: 'ABC def 123' }), 'compact')).toEqual({ type: 'Aztec Code', text: 'ABC def 123' });
    // More bytes than the short form of a byte run can count.
    const run = Array.from({ length: 70 }, (_, index) => 0x80 + index);
    expect(await both(await holding('azteccode', run), 'long run')).toEqual({ type: 'Aztec Code', text: String.fromCharCode(...run) });
    // Cyrillic, then UTF-8, each stated where it starts.
    expect(await both(await aztec({ text: `${eci(7)}${bytes([0xbf, 0xe0])}${eci(26)}${bytes(Buffer.from('é ₦', 'utf8'))}`, parse: true, parsefnc: true, binarytext: true }), 'two sets')).toEqual({ type: 'Aztec Code', text: 'Пр\u00e9 ₦' });
    expect(await both(await aztec({ text: `ABC${eci(26)}${bytes(Buffer.from('DéF', 'utf8'))}`, parse: true, parsefnc: true, binarytext: true }), 'set stated part-way')).toEqual({ type: 'Aztec Code', text: 'ABCDéF' });

    // Strings from every table in turn, so that each shift and latch between them is taken.
    let seed = 20261111;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const alphabets = ['ABCDEFGHIJKLMNOPQRSTUVWXYZ ', 'abcdefghijklmnopqrstuvwxyz ', '0123456789,. ', 'ABCabc0123 ,.:;!?@#$%&*()[]{}<>=+-/\\|~_`\'"', 'Aa0,. \r\n\t:;\u0001\u001b\u007f'];
    for (let sample = 0; sample < 40; sample += 1) {
      let text = '';
      const length = 1 + Math.floor(random() * 40);
      for (let index = 0; index < length; index += 1) {
        const alphabet = alphabets[Math.floor(random() * alphabets.length)] as string;
        text += alphabet[Math.floor(random() * alphabet.length)];
      }
      expect(await both(await holding('azteccode', Buffer.from(text, 'latin1')), JSON.stringify(text))).toEqual({ type: 'Aztec Code', text });
    }
  }, 60_000);

  it('reads a Data Matrix that states its character set, with or without a GS1 mark', async () => {
    const matrix = (text: string): Promise<Uint8Array> => encoderPng({ bcid: 'datamatrix', text, parsefnc: true });
    // The mark is the FNC1 in the first position. After a character set it is a separator.
    expect(await both(await matrix(`^FNC1${eci(26)}10Ọlá`), 'mark, then set')).toEqual({ type: 'Data Matrix', text: '10Ọlá' });
    expect(await both(await matrix(`${eci(26)}^FNC1010952123454321310AB`), 'set, then FNC1')).toEqual({ type: 'Data Matrix', text: '\u001d010952123454321310AB' });
    expect(await both(await matrix(`${eci(26)}PLAIN TEXT 123`), 'set and plain text')).toEqual({ type: 'Data Matrix', text: 'PLAIN TEXT 123' });
  });

  it('does not read, rather than misread, what the basic decoder cannot convert', async () => {
    const neither = async (png: Uint8Array, expected: { format: string; text: string }): Promise<void> => {
      const pixels = pixelsOf(png);
      expect(await scanStill(read, pixels)).toMatchObject(expected);
      expect(scanPixels(pixels, 'thorough')).toBeNull();
    };
    // Code page 437, the character set of the first PDF417 specification. A browser has no table for it.
    await neither(await holding('azteccode', [0x41, 0x82, 0x42], eci(0)), { format: 'aztec', text: 'AéB' });
    await neither(await holding('pdf417', [0x41, 0x82, 0x42], eci(0)), { format: 'pdf_417', text: 'AéB' });
    // A character set whose number takes two codewords in a Data Matrix.
    await neither(await holding('datamatrix', [0x41, 0x42, 0x43], eci(899)), { format: 'data_matrix', text: 'ABC' });
    // A character set stated part-way through a Data Matrix or a PDF417. The basic decoder's library
    // reads the statement as data: "ABC", a stray character, then "D", the two bytes of the "é" as
    // two characters, and "F". That text is not passed on.
    const partWay = `ABC${eci(26)}${bytes(Buffer.from('DéF', 'utf8'))}`;
    await neither(await encoderPng({ bcid: 'datamatrix', text: partWay, parse: true, parsefnc: true, binarytext: true }), { format: 'data_matrix', text: 'ABCDéF' });
    await neither(await encoderPng({ bcid: 'pdf417', text: partWay, parse: true, parsefnc: true, binarytext: true }), { format: 'pdf_417', text: 'ABCDéF' });
    // The API says no barcode was found, and does not guess.
    expect(await scan(await holding('pdf417', [0x41, 0x82, 0x42], eci(0)))).toMatchObject({ found: false, codes: [] });
    expect(await scan(await encoderPng({ bcid: 'datamatrix', text: partWay, parse: true, parsefnc: true, binarytext: true }))).toMatchObject({ found: false, codes: [] });
  });

  it('converts by each character set a barcode can state, alike in both decoders', async () => {
    const cases: Array<[number, number[], string]> = [
      [4, [0xa3, 0xf3], 'Łó'], // ISO-8859-2
      [9, [0xc1, 0xe2], 'Αβ'], // ISO-8859-7
      [11, [0xd0, 0xdd, 0xfe], 'Ğİş'], // ISO-8859-9
      [13, [0xa1, 0xa2], 'กข'], // ISO-8859-11
      [17, [0xa4, 0xbc], '€Œ'], // ISO-8859-15
      [20, [0x93, 0xfa, 0x96, 0x7b], '日本'], // Shift JIS
      [21, [0x8a, 0x9a], 'Šš'], // Windows-1250
      [22, [0xcf, 0xf0], 'Пр'], // Windows-1251
      [23, [0x80, 0x93, 0x94], '€“”'], // Windows-1252
      [24, [0xc7, 0xe1], 'ال'], // Windows-1256
      [25, [0x20, 0xa6, 0x1e, 0xcc], '₦Ọ'], // UTF-16, big end first
      [27, [0x41, 0x7e], 'A~'], // ASCII
      [28, [0xa4, 0xa4, 0xa4, 0xe5], '中文'], // Big5
      [29, [0xd6, 0xd0, 0xce, 0xc4], '中文'], // GB 18030
      [30, [0xc7, 0xd1, 0xb1, 0xdb], '한글'], // EUC-KR
    ];
    for (const [number, values, text] of cases) {
      for (const [bcid, type] of TWO_D) expect(await both(await holding(bcid, values, eci(number)), `${bcid} ECI ${number}`)).toEqual({ type, text });
    }
    // Bytes that are not valid in the set stated are marked, and the rest kept.
    expect(await both(await holding('qrcode', [0x41, 0xe9, 0x42, 0xc3], eci(26)), 'not UTF-8')).toEqual({ type: 'QR Code', text: 'A\ufffdB\ufffd' });
    // Shift JIS with the three control characters Node's converter would exchange.
    expect(await both(await holding('azteccode', [0x93, 0xfa, 0x1a, 0x96, 0x7b, 0x1c, 0x7f, 0x41], eci(20)), 'controls')).toEqual({ type: 'Aztec Code', text: '日\u001a本\u001c\u007fA' });
  }, 60_000);

  it('judges the bytes of a QR Code apart from its digits and capitals, and reads one written in Kanji mode', async () => {
    // One byte in three is a Latin-1 symbol: taken for Japanese, with or without forty digits in front.
    expect(await both(await holding('qrcode', [0x41, 0xa9, 0x42]), 'bytes alone')).toEqual({ type: 'QR Code', text: 'AｩB' });
    expect(await both(await encoderPng({ bcid: 'qrcode', text: `${'0123456789'.repeat(4)}${bytes([0x41, 0xa9, 0x42])}`, parse: true, binarytext: true }), 'after digits')).toEqual({ type: 'QR Code', text: `${'0123456789'.repeat(4)}AｩB` });
    expect(await both(await encoderPng({ bcid: 'qrcode', text: `HTTPS://EXAMPLE.COM/ABCDEFGHIJKLMNOPQRSTUVWXYZ ${bytes(Buffer.from('café', 'latin1'))}`, parse: true, binarytext: true }), 'after capitals')).toEqual({ type: 'QR Code', text: 'HTTPS://EXAMPLE.COM/ABCDEFGHIJKLMNOPQRSTUVWXYZ café' });
    expect(await both(await encoderPng({ bcid: 'qrcode', text: `${'0123456789'.repeat(2)}${bytes(Buffer.from('Ọlá', 'utf8'))}`, parse: true, binarytext: true }), 'UTF-8 after digits')).toEqual({ type: 'QR Code', text: `${'0123456789'.repeat(2)}Ọlá` });

    // Kanji mode packs each character into thirteen bits, and the characters are Shift JIS by definition.
    for (const text of ['日本語のテキスト', '東京都1234567890123456']) {
      const png = await libraryPng(text, 'QRCode');
      expect(await both(png, text)).toEqual({ type: 'QR Code', text });
      expect((await scan(png)).codes[0]).toMatchObject({ type: 'QR Code', content: text });
    }
  });

  it('reports bytes that fit no character set alike from both decoders: one character to each byte', async () => {
    const hex = (digits: string): number[] => Array.from(Buffer.from(digits, 'hex'));
    // These look like Shift JIS and are not valid Shift JIS.
    const data = hex('d32f846b86608772884c');
    for (const [bcid, type] of TWO_D) expect(await both(await holding(bcid, data), bcid)).toEqual({ type, text: String.fromCharCode(...data) });
    // The full decoder's library, left to itself, gives a row of replacement marks for the same bytes.
    const [found] = await read(pixelsOf(await holding('datamatrix', data)), CPP_OPTIONS);
    expect(found).toMatchObject({ hasECI: false, text: 'ﾓ/\ufffd\ufffd\ufffd\ufffd' });
    expect(Array.from((found as CppResult).bytes ?? [])).toEqual(data);
    expect(fromBytes(found as CppResult)).toBe(String.fromCharCode(...data));
    // It is left alone where it lost nothing, where the barcode stated a character set, and where it gave no bytes.
    const partial = { format: 'DataMatrix', symbology: 'DataMatrix', isValid: true, extra: '' } as const;
    expect(fromBytes({ ...partial, text: 'Caf\ufffd', hasECI: true, bytes: Uint8Array.from([0x43, 0x61, 0x66, 0xe9]) })).toBe('Caf\ufffd');
    expect(fromBytes({ ...partial, text: 'Caf\ufffd' })).toBe('Caf\ufffd');
    expect(fromBytes({ ...partial, text: 'Café', hasECI: false, bytes: Uint8Array.from([0x43, 0x61, 0x66, 0xe9]) })).toBe('Café');
    // A replacement mark that is really in the text, as UTF-8, stays one.
    expect(await both(await holding('qrcode', Buffer.from('a\ufffdb', 'utf8')), 'a real mark')).toEqual({ type: 'QR Code', text: 'a\ufffdb' });

    // Characters only the Windows form of Shift JIS has, and a DEL in the middle of Japanese text.
    expect(await both(await holding('qrcode', hex('8fd395f2eda2879b')), 'Windows-31J')).toEqual({ type: 'QR Code', text: '蒋奉悊∩' });
    expect(await both(await holding('datamatrix', hex('594c99b22455a2377fadd04d26d52b')), 'DEL')).toEqual({ type: 'Data Matrix', text: 'YL甸$U｢7\u007fｭﾐM&ﾕ+' });

    // Shown, the controls above U+007F have a picture too, so nothing in the content is invisible.
    expect(visibleText('A\u0080\u0085\u009fB\u001d\u007f')).toBe('A␦␦␦B␝␡');
    expect((await scan(await holding('datamatrix', data))).codes).toEqual([{ type: 'Data Matrix', content: 'Ó/␦k␦`␦r␦L', contentKind: 'Text', characters: 10, caution: null }]);
  });

  it('agrees on barcodes of random bytes: text, almost-text and data', async () => {
    let seed = 2026;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    const printable = (): number => 32 + Math.floor(random() * 95);
    const character = (): number[] => Array.from(Buffer.from(String.fromCodePoint(pick([0xe9, 0xf1, 0x1ecc, 0x20a6, 0x4e2d, 0x1f600, 0x430, 0x3b1, 0xfffd, 0xfeff])), 'utf8'));
    const makers: Array<() => number[]> = [
      () => [printable()],
      () => [random() < 0.3 ? 0xc0 + Math.floor(random() * 0x40) : printable()], // Latin-1 text
      () => (random() < 0.4 ? character() : [printable()]), // UTF-8 text
      () => (random() < 0.5 ? [0x82 + Math.floor(random() * 20), 0x40 + Math.floor(random() * 60)] : random() < 0.5 ? [0xa1 + Math.floor(random() * 0x3e)] : [printable()]), // Shift JIS, more or less
      () => (random() < 0.2 ? character() : random() < 0.3 ? [0xa0 + Math.floor(random() * 0x60)] : [printable()]), // a mixture
      () => [0x80 + Math.floor(random() * 0x80)], // high bytes
      () => [random() < 0.15 ? pick([0x80, 0x85, 0x91, 0x92, 0x93, 0x94, 0x96, 0x97]) : printable()], // Windows-1252 text
      () => [Math.floor(random() * 256)], // anything
    ];
    let compared = 0;
    for (let sample = 0; sample < 160; sample += 1) {
      const [bcid] = pick(TWO_D);
      const make = pick(makers);
      const length = 1 + Math.floor(random() * 26);
      const values: number[] = [];
      while (values.length < length) values.push(...make());
      const before = random() < 0.15 ? '0123456789012345678901' : random() < 0.15 ? 'HTTPS://EXAMPLE.COM/PATH ' : '';
      const png = await encoderPng({ bcid, text: `${before}${bytes(values)}`, parse: true, binarytext: true });
      const read = await both(png, `${bcid} ${before}${Buffer.from(values).toString('hex')}`);
      expect(read, `${bcid} ${Buffer.from(values).toString('hex')}`).not.toBeNull();
      compared += 1;
    }
    expect(compared).toBe(160);
  }, 120_000);

  it('reads a Codabar with every character but the plus sign, which only the full decoder reads', async () => {
    const codabar = (text: string): Promise<Uint8Array> => encoderPng({ bcid: 'rationalizedCodabar', text, height: 12 });
    for (const text of ['A123-456B', 'A12$34B', 'A1:2B', 'A1/2B', 'A1.2B', 'C123456D']) {
      expect(await both(await codabar(text), text)).toEqual({ type: 'Codabar', text });
    }
    // The basic decoder's library has the wrong bars for "+", so it finds no barcode. It does not report another character.
    const plus = pixelsOf(await codabar('A1+2B'));
    expect(await scanStill(read, plus)).toMatchObject({ format: 'codabar', text: 'A1+2B' });
    expect(scanPixels(plus, 'thorough')).toBeNull();
  });

  it('gives Latin-1 text in a Code 128 as both decoders find it', async () => {
    // The encoder writes the two UTF-8 bytes of "é" as two Code 128 characters; neither decoder joins them.
    expect(await both(await encoderPng({ bcid: 'code128', text: 'Café', height: 12 }), 'Code 128')).toEqual({ type: 'Code 128', text: 'Caf\u00c3\u00a9' });
    expect(await both(await encoderPng({ bcid: 'code128', text: 'A^009B^013^010C', parse: true, height: 12 }), 'controls')).toEqual({ type: 'Code 128', text: 'A\tB\r\nC' });
  });
});

/* ------------------------------------------------------------------ */
/* The API                                                             */
/* ------------------------------------------------------------------ */

describe('the API', () => {
  it('says so, and what to try, when an image holds no barcode', async () => {
    const blank = new PNG({ width: 600, height: 400 });
    blank.data.fill(255);
    const result = await scan(new Uint8Array(PNG.sync.write(blank)));
    expect(result).toMatchObject({ found: false, count: 0, codes: [], image: { width: 600, height: 400 } });
    expect(result.notes[0]).toMatch(/^No barcode was read from this image\. Try a sharper, closer picture/);
    expect(result.reads).toHaveLength(13);
    expect(result.reads).toContain('Code 128 (including GS1-128 and SSCC-18)');
    expect(result.reads.join(' ')).not.toMatch(/UPC-E|Micro|Telepen|MaxiCode|Limited|Expanded/);
  });

  it('reports the content as text with a label for what it is, and opens nothing', async () => {
    const cases: Array<[string, string, string | null]> = [
      ['https://cloudhost247.com/tools', 'Web address', 'Check the address before you open it. A code can point anywhere.'],
      ['WIFI:T:WPA;S:Office;P:secret-pass;;', 'Wi-Fi network', 'This holds a network password in readable form.'],
      ['BEGIN:VCARD\r\nVERSION:3.0\r\nN:Yusuf;Amina;;;\r\nFN:Amina Yusuf\r\nEND:VCARD', 'Contact', null],
      ['MECARD:N:Yusuf,Amina;;', 'Contact', null],
      ['mailto:support@cloudhost247.com', 'Email', null],
      ['tel:+2348035550142', 'Phone number', null],
      ['SMSTO:+2348035550142:Hello', 'Text message', null],
      ['BEGIN:VEVENT\r\nSUMMARY:Open day\r\nEND:VEVENT', 'Calendar event', null],
      ['geo:9.8965,8.8583', 'Map location', null],
      ['BCD\n002\n1\nSCT\n\nExample GmbH\nDE89370400440532013000', 'SEPA payment', 'Check the name, IBAN and amount before you pay.'],
      ['Just some words', 'Text', null],
    ];
    for (const [data, label, caution] of cases) {
      const [code] = (await scan(await barcodePng('qrcode', { data }))).codes;
      // Line ends come back as they went in: a vCard's CRLF is part of its format.
      expect(code?.content, label).toBe(data);
      expect(code?.contentKind, data).toBe(label);
      expect(code?.caution ?? null, data).toBe(caution);
    }
    expect((await scan(await barcodePng('ean13'))).codes[0]?.contentKind).toBe('Product number');
    expect((await scan(await barcodePng('code128'))).codes[0]?.contentKind).toBe('Text');
    const found = await scan(await barcodePng('qrcode'));
    expect(found.notes).toContain('The content is reported as text. Nothing in it was opened, dialled or followed.');
  });

  it('shows control characters instead of dropping them', () => {
    expect(visibleText('A\u001dB\u0000C\u007f')).toBe('A\u241dB\u2400C\u2421');
    expect(visibleText('line 1\nline 2\tend\r\n')).toBe('line 1\nline 2\tend\r\n');
    expect(kindOf({ format: 'qr_code', formatName: 'QR Code', text: '  HTTPS://EXAMPLE.COM' }).id).toBe('web');
    expect(kindOf({ format: 'code_128', formatName: 'Code 128', text: '9520123456788' }).id).toBe('text');
    for (const format of ['ean_13', 'ean_8', 'upc_a', 'upc_e']) expect(kindOf({ format, formatName: format, text: '01234558' }).id, format).toBe('product');
  });

  it('refuses what is not a PNG it can safely decode', async () => {
    const png = await barcodePng('code128');
    const handler = handlerFor('barcode-scanner');
    const run = (image: unknown) => refusal(() => handler?.({ image } as never, {} as never));

    expect((await refusal(() => scanImage({ image: '' }))).message).toBe('Upload a PNG image that contains the barcode.');
    expect((await run('data:image/png;base64,@@not base64@@')).message).toBe('The image data is not valid Base64.');
    // A JPEG's first bytes.
    expect((await run(`data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0]).toString('base64')}`)).message).toBe(
      'The image is not a PNG. Save or export it as PNG and try again. Uploaded images are read as PNG only; the scanner page at /tools/barcode-scanner also reads JPEG and other picture formats, in your browser.'
    );
    // A PNG header that declares 5000 x 5000 pixels is refused from the header, before anything is expanded.
    const huge = Buffer.from(png);
    huge.writeUInt32BE(5000, 16);
    huge.writeUInt32BE(5000, 20);
    expect((await run(dataUrl(huge))).message).toBe('Images larger than 4096 × 4096 pixels are not accepted.');
    // A PNG cut short.
    expect((await run(dataUrl(png.slice(0, 200)))).message).toBe('The PNG could not be decoded. Export it again and retry.');
    expect((await run(`data:image/png;base64,${'A'.repeat(4 * 1024 * 1024 + 4)}`)).message).toBe('The uploaded image is too large (limit 4 MB of Base64 data).');
    for (const error of [await run('data:image/png;base64,@@'), await run(dataUrl(huge))]) {
      expect(error.code).toBe('INVALID_INPUT');
      expect(error.statusCode).toBe(400);
    }
  });

  it('accepts the image with or without the data URL prefix, and with line breaks in the Base64', async () => {
    const png = await barcodePng('code128');
    const bare = Buffer.from(png).toString('base64');
    expect(scanImage({ image: bare }).codes[0]?.content).toBe('CH247-000123');
    expect(scanImage({ image: `data:image/png;base64,${bare.replace(/(.{76})/g, '$1\n')}` }).codes[0]?.content).toBe('CH247-000123');
  });

  it('is published as a public POST tool whose results are never stored, with no history label', () => {
    const entry = TOOL_CATALOG.find((tool) => tool.slug === 'barcode-scanner');
    expect(entry).toMatchObject({ name: 'Barcode Scanner', path: '/tools/barcode-scanner', apiPath: '/api/tools/barcode-scanner', methods: ['POST'], authRequired: false, visibility: 'public', cacheSeconds: 0 });
    expect(NON_PERSISTABLE_TOOL_SLUGS.has('barcode-scanner')).toBe(true);
    expect(targetFor('barcode-scanner', { image: 'anything' })).toBeNull();
    expect(entry?.description).toContain('Reads twenty-one barcode types');
    expect(entry?.description).toContain('The API reads a barcode from an uploaded PNG, in thirteen of those types.');
    expect(entry?.legacyPaths).toEqual(['/tools/barcode-reader', '/tools/scan-barcode']);
  });
});

describe('the decoder modules', () => {
  const root = join(__dirname, '..', '..');
  const importsOf = (source: string): string[] => [...source.matchAll(/^(?:import|export)[^;]*?from '([^']+)';/gm)].map((match) => match[1] as string);

  it('basic: imports nothing but its library, so the browser can use it as it is', () => {
    const read = (file: string): string => readFileSync(join(root, 'src', 'tools', 'scanner', file), 'utf8');
    const source = read('decode.ts');
    expect([...new Set(importsOf(source))]).toEqual(['@zxing/library', './formats']);
    expect(source).not.toMatch(/\brequire\(|\bBuffer\b|process\./);
    // The list of types and the text helpers import nothing, so a page can show them before a decoder has loaded.
    expect(importsOf(read('formats.ts'))).toEqual([]);
    expect(read('formats.ts')).not.toMatch(/\brequire\(|\bBuffer\b|process\./);
    // The library is plain JavaScript: no native build and no WebAssembly, which is why the server can run it.
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    expect(manifest.dependencies['@zxing/library']).toMatch(/^\d+\.\d+\.\d+$/);
    const library = JSON.parse(readFileSync(join(root, 'node_modules', '@zxing', 'library', 'package.json'), 'utf8')) as { engines?: { node?: string } };
    // It must run on the Node versions this application supports (20.9 and later).
    expect(library.engines?.node).toBe('>= 10.4.0');
    // The API and the server's other code use this decoder and never the full one.
    expect(read('scan-image.ts')).not.toMatch(/zxing-wasm|scan-cpp|scan-engine/);
  });

  it('full: the library is loaded in one page module, with its binary fetched from this site', () => {
    const read = (file: string): string => readFileSync(join(root, 'frontend', 'src', 'lib', file), 'utf8');
    // What the decoder is asked and how its answer is put takes only the library's types, so it runs in this file.
    const rules = read('scan-cpp.ts');
    expect(importsOf(rules)).toEqual(['zxing-wasm/reader', '../../../src/tools/scanner/formats']);
    expect(rules).toMatch(/^import type \{[^}]+\} from 'zxing-wasm\/reader';$/m);
    expect(rules).not.toMatch(/import\(/);
    // The loader fetches the binary itself, from the address the build gives it, and hands it over.
    const loader = read('scan-engine.ts');
    expect(loader).toContain("import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';");
    expect(loader).toContain("import('zxing-wasm/reader')");
    expect(loader).toContain("fetch(wasmUrl, { credentials: 'same-origin' })");
    expect(loader).toContain('overrides: { wasmBinary: binary }');
    expect(loader).not.toMatch(/https?:\/\//);
    // The version is pinned exactly: the tests above are statements about this build of the decoder.
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    expect(manifest.devDependencies['zxing-wasm']).toBe('3.1.6');
    expect(manifest.dependencies['zxing-wasm']).toBeUndefined();
  });
});
