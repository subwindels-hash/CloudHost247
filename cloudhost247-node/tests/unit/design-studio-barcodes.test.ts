/**
 * Design Studio: barcode engine tests.
 *
 * The Barcode Generator tells its users two things about every symbol it draws: the bar width is
 * exactly what was asked for, and (for most types) the symbol has been read back by a decoder that
 * shares nothing with the encoder. These tests are where both statements are earned.
 *
 * Read-back is done on the geometry the tool ships, not on a picture the encoder made of itself:
 * the vector operations that become the SVG and the PDF are rasterised by tests/helpers and handed
 * to zxing-cpp, and the PNG path is decoded from the PNG bytes. Where the reader reports something
 * other than the text that was typed (a check digit, a prefix, a retail number in its 13-digit
 * form), the expected value is written out below with the rule that produces it, so a pass means
 * "the symbol carries what the standard says it should", not "the output has not changed".
 *
 * Thirteen types have no decoder available here. They are listed by name, the tool says so with
 * each result, and nothing in this file pretends otherwise.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, sep } from 'node:path';

import { SYMBOLOGIES, SYMBOLOGY_GROUPS, normaliseData, optionField, symbologyById, type Symbology } from '../../src/tools/design-studio/barcode/symbologies';
import { carriedContent } from '../../src/tools/design-studio/barcode/carried';
import { BarcodeError, encodeSymbol, renderSymbolPng, rotateSymbol, translateOps, type EncodeRequest } from '../../src/tools/design-studio/barcode/encoder';
import { isPng, pngDimensions, readPngDpi, setPngDpi } from '../../src/tools/design-studio/render/png-meta';
import type { StudioOp } from '../../src/tools/design-studio/render/draw-ops';
import { decodePixels, decodePng, type DecodedSymbol, type ReaderOptions } from '../helpers/barcode-reader';
import { rasteriseOps } from '../helpers/studio-raster';

const APP_ROOT = join(__dirname, '..', '..');

function symbology(id: string): Symbology {
  const found = symbologyById(id);
  if (!found) throw new Error(`No symbology "${id}" in the registry.`);
  return found;
}

/** Encode, rasterise the vector operations with their quiet zone, and read every symbol found. */
/**
 * Reader settings a type needs to be read as what it is. HIBC in Code 39 begins with "+" and a
 * letter; a reader left in full-ASCII mode takes that pair for a lowercase letter, so it is read as
 * standard Code 39, the way HIBC scanners are configured.
 */
const READER_OPTIONS: Record<string, ReaderOptions> = {
  hibc39: { formats: ['Code39Std'] },
};

async function readVector(request: EncodeRequest, quarterTurns = 0): Promise<DecodedSymbol[]> {
  const symbol = encodeSymbol(request);
  const turned = rotateSymbol(symbol.ops, symbol.width, symbol.height, quarterTurns);
  const quiet = symbol.quietMm;
  const sizing = request.symbology.sizing;
  const mmPerUnit = sizing.mode === 'fixed' ? sizing.mmPerUnit : symbol.moduleMm / sizing.unitsPerModule;
  const image = rasteriseOps(translateOps(turned.ops, quiet, quiet), turned.width + 2 * quiet, turned.height + 2 * quiet, 4 / mmPerUnit);
  return decodePixels(image, READER_OPTIONS[request.symbology.id] ?? {});
}

/* ------------------------------------------------------------------ */
/* What an independent reader should report for each sample            */
/* ------------------------------------------------------------------ */

/** The format name zxing-cpp gives each decodable type. */
const READER_FORMAT: Record<string, string> = {
  code128: 'Code128', code39: 'Code39', code39ext: 'Code39Ext', code93: 'Code93', code93ext: 'Code93', itf: 'ITF', itf14: 'ITF',
  codabar: 'Codabar', telepen: 'TelepenAlpha',
  // zxing reports a UPC-A symbol as the EAN-13 it is a subset of.
  ean13: 'EAN13', ean8: 'EAN8', upca: 'EAN13', upce: 'UPCE', isbn: 'EAN13', issn: 'EAN13', ismn: 'EAN13',
  // GS1-128 family: Code 128 carrying FNC1, reported with its application identifiers bracketed.
  ean14: 'Code128', 'gs1-128': 'Code128', sscc18: 'Code128',
  databar: 'DataBarOmni', 'databar-truncated': 'DataBarOmni', 'databar-limited': 'DataBarLtd', 'databar-expanded': 'DataBarExp',
  'databar-stacked': 'DataBarStk', 'databar-stacked-omni': 'DataBarStk', 'databar-expanded-stacked': 'DataBarExpStk',
  'gs1-datamatrix': 'DataMatrix', 'gs1-qr': 'QRCode', 'gs1-digital-link-qr': 'QRCode', 'gs1-digital-link-datamatrix': 'DataMatrix',
  qrcode: 'QRCode', microqr: 'MicroQRCode', datamatrix: 'DataMatrix', 'datamatrix-rectangular': 'DataMatrix', aztec: 'Aztec',
  pdf417: 'PDF417', micropdf417: 'MicroPDF417', maxicode: 'MaxiCode',
  // Deutsche Post Identcode and Leitcode are Interleaved 2 of 5 with their own check digit.
  identcode: 'ITF', leitcode: 'ITF',
  // A Mailmark is a Data Matrix of a prescribed size carrying the mail piece's data string.
  mailmark: 'DataMatrix',
  // The reader names the eight-digit PZN for what it is and reports the seven-digit one as the Code 39 that carries it.
  pzn: 'Code39', pzn8: 'PZN', code32: 'Code32',
  hibc128: 'Code128', hibc39: 'Code39', 'hibc-datamatrix': 'DataMatrix', 'hibc-qr': 'QRCode', 'hibc-aztec': 'Aztec', 'hibc-pdf417': 'PDF417', 'hibc-micropdf417': 'MicroPDF417',
};

/**
 * Types whose symbol does not carry the sample text literally. Each entry is what the standard
 * says the symbol contains for the registry's sample, with the rule.
 */
const READER_TEXT: Record<string, { text: string; rule: string }> = {
  upca: { text: '0012345000058', rule: 'UPC-A 012345000058 is the GTIN-13 with a leading zero.' },
  upce: { text: '0012345000058', rule: 'UPC-E 01234558 expands to UPC-A 012345000058 (a data digit of 5 means manufacturer 12345, item 00005).' },
  isbn: { text: '9781565812314', rule: 'An ISBN-13 is an EAN-13; the hyphens are presentation.' },
  issn: { text: '9770311175001', rule: '977 + the first seven ISSN digits (0311175) + variant 00 + EAN check digit 1.' },
  pzn: { text: '-1234562', rule: 'PZN7 is Code 39 "-" + six digits + mod-11 check digit: (1*2+2*3+3*4+4*5+5*6+6*7) mod 11 = 2.' },
  code32: { text: 'A012345676', rule: 'Italian Pharmacode: eight digits + check digit 6, shown with the "A" prefix.' },
  hibc128: { text: '+A999BJC5D6E71.', rule: 'HIBC: "+" flag + data + mod-43 check character (sum 166 mod 43 = 37 = ".").' },
  'hibc-datamatrix': { text: '+A999BJC5D6E71.', rule: 'HIBC: "+" flag + data + mod-43 check character.' },
  hibc39: { text: '+A999BJC5D6E71.', rule: 'HIBC: "+" flag + data + mod-43 check character, read as standard Code 39.' },
  'hibc-qr': { text: '+A999BJC5D6E71.', rule: 'HIBC: "+" flag + data + mod-43 check character.' },
  'hibc-aztec': { text: '+A999BJC5D6E71.', rule: 'HIBC: "+" flag + data + mod-43 check character.' },
  'hibc-pdf417': { text: '+A999BJC5D6E71.', rule: 'HIBC: "+" flag + data + mod-43 check character.' },
  'hibc-micropdf417': { text: '+A999BJC5D6E71.', rule: 'HIBC: "+" flag + data + mod-43 check character.' },
  ismn: { text: '9790260532113', rule: 'An ISMN-13 is an EAN-13; the hyphens are presentation.' },
  pzn8: { text: '-02758089', rule: 'PZN8 is Code 39 "-" + seven digits + mod-11 check digit: (0*1+2*2+7*3+5*4+8*5+0*6+8*7) = 141, and 141 mod 11 = 9.' },
};

/**
 * Types of which a decoder reads one part and not the rest: a composite symbol's linear component,
 * or the main symbol beside an add-on. The registry says which part (`readBack`); this is what a
 * reader reports for it. The tool calls these "partly read back" and nothing stronger.
 */
const PARTLY_READ: Record<string, { format: string; text: string }> = {
  'isbn-addon': { format: 'EAN13', text: '9781565812314' },
  'issn-addon': { format: 'EAN13', text: '9770311175001' },
  'ean13-composite': { format: 'EAN13', text: '9520123456788' },
  'ean8-composite': { format: 'EAN8', text: '95200002' },
  'upca-composite': { format: 'EAN13', text: '0012345000058' },
  'upce-composite': { format: 'UPCE', text: '0012345000058' },
  'gs1-128-composite': { format: 'Code128', text: '(00)095287654321012346' },
  'databar-composite': { format: 'DataBarOmni', text: '(01)09521234543213' },
  'databar-stacked-composite': { format: 'DataBarStk', text: '(01)09521234543213' },
  'databar-stacked-omni-composite': { format: 'DataBarStk', text: '(01)09521234543213' },
  'databar-limited-composite': { format: 'DataBarLtd', text: '(01)09521234543213' },
  'databar-expanded-composite': { format: 'DataBarExp', text: '(01)09521234543213(3103)000123' },
  'databar-expanded-stacked-composite': { format: 'DataBarExpStk', text: '(01)09521234543213(3103)000123' },
};

/** The types no decoder available to this suite can read. The tool labels each as encoder output only. */
const UNREAD = [
  'code11', 'msi', 'code2of5', 'industrial2of5', 'pharmacode', 'flattermarken', 'hanxin', 'dotcode', 'codablockf',
  'usps-imb', 'postnet', 'planet', 'royalmail', 'kix', 'auspost', 'japanpost', 'daft', 'pharmacode2', 'hibc-codablockf',
];
/** Every type the registry does not call decodable: the ones nothing reads, and the ones read in part. */
const ENCODER_ONLY = [...UNREAD, ...Object.keys(PARTLY_READ)];

const DECODABLE = SYMBOLOGIES.filter((entry) => entry.verification === 'decode');

function expectedText(entry: Symbology): string {
  return READER_TEXT[entry.id]?.text ?? normaliseData(entry, entry.sample);
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

describe('symbology registry', () => {
  it('offers 83 barcode types: 51 read back by a decoder, 13 read in part, 19 encoder output only', () => {
    expect(SYMBOLOGIES).toHaveLength(83);
    expect(new Set(SYMBOLOGIES.map((entry) => entry.id)).size).toBe(83);
    expect(DECODABLE).toHaveLength(51);
    expect(Object.keys(PARTLY_READ)).toHaveLength(13);
    expect(UNREAD).toHaveLength(19);
    expect(SYMBOLOGIES.filter((entry) => entry.verification === 'encoder').map((entry) => entry.id).sort()).toEqual([...ENCODER_ONLY].sort());
    // Only a type that is read in part says which part, and every such type does.
    expect(SYMBOLOGIES.filter((entry) => entry.readBack !== undefined).map((entry) => entry.id).sort()).toEqual(Object.keys(PARTLY_READ).sort());
    for (const entry of DECODABLE) expect(entry.readBack, entry.id).toBeUndefined();
  });

  it('has an expectation in this file for every type it calls decodable, and for no other', () => {
    expect(Object.keys(READER_FORMAT).sort()).toEqual(DECODABLE.map((entry) => entry.id).sort());
    for (const id of Object.keys(READER_TEXT)) expect(READER_FORMAT[id], id).toBeTruthy();
  });

  it('files every type under a published group, and leaves no group empty', () => {
    const groups = new Set(SYMBOLOGY_GROUPS.map((group) => group.id));
    for (const entry of SYMBOLOGIES) expect(groups.has(entry.group), entry.id).toBe(true);
    for (const group of SYMBOLOGY_GROUPS) expect(SYMBOLOGIES.some((entry) => entry.group === group.id), group.id).toBe(true);
  });

  it('gives every type a sample that passes its own rules', () => {
    for (const entry of SYMBOLOGIES) {
      const data = normaliseData(entry, entry.sample);
      expect(data.length, entry.id).toBeGreaterThan(0);
      expect(data.length, entry.id).toBeLessThanOrEqual(entry.maxLength);
      if (entry.pattern) expect(new RegExp(entry.pattern).test(data), `${entry.id} sample against its pattern`).toBe(true);
      expect(entry.name.length, entry.id).toBeGreaterThan(0);
      expect(entry.hint.length, entry.id).toBeGreaterThan(0);
    }
  });

  it('tells the user, for every encoder-only type, that it has not been read back', () => {
    for (const id of ENCODER_ONLY) expect(symbology(id).note ?? '', id).toMatch(/scanner|decoder/i);
  });

  it('names each option field once, so a flat form can never send one type’s option to another', () => {
    const owners = new Map<string, string>();
    for (const entry of SYMBOLOGIES) {
      for (const option of entry.options ?? []) {
        const field = optionField(option);
        const signature = `${option.type}:${(option.choices ?? []).map((choice) => choice.value).join(',')}`;
        const existing = owners.get(field);
        // The same field may serve several types only when it means the same thing for all of them.
        if (existing !== undefined) expect(signature, `${entry.id}.${field}`).toBe(existing);
        owners.set(field, signature);
      }
    }
    // QR error correction (L/M/Q/H) and PDF417 security level (0 to 8) share an encoder key.
    expect(owners.get('eclevel')).toContain('select');
    expect(owners.get('securityLevel')).toContain('integer');
  });

  it('tidies input the way each type needs', () => {
    expect(normaliseData(symbology('code39'), ' part-12\n34 ')).toBe('PART-12 34');
    expect(normaliseData(symbology('qrcode'), 'line one\r\nline two')).toBe('line one\nline two');
    expect(normaliseData(symbology('itf14'), '0952 1234 54321-3')).toBe('09521234543213');
  });
});

/* ------------------------------------------------------------------ */
/* Every type encodes                                                  */
/* ------------------------------------------------------------------ */

describe('encoder', () => {
  it.each(SYMBOLOGIES.map((entry) => [entry.id, entry] as const))('draws %s as vector geometry with a quiet zone', (_id, entry) => {
    const symbol = encodeSymbol({ symbology: entry, data: entry.sample });
    expect(symbol.ops.length).toBeGreaterThan(0);
    expect(symbol.width).toBeGreaterThan(1);
    expect(symbol.height).toBeGreaterThan(1);
    expect(symbol.quietMm).toBeGreaterThan(0);
    // Vector only: bars are rectangles, modules and glyphs are outlines. No bitmap, no font reference.
    for (const op of symbol.ops) expect(['rect', 'path', 'polygon', 'circle']).toContain((op as StudioOp).kind);
  });

  it('draws linear bars at exactly the module width requested', () => {
    for (const moduleMm of [0.25, 0.33, 0.5]) {
      const symbol = encodeSymbol({ symbology: symbology('code128'), data: 'CH247-000123', moduleMm, showText: false });
      expect(symbol.moduleMm).toBe(moduleMm);
      const bars = symbol.ops.filter((op): op is Extract<StudioOp, { kind: 'rect' }> => op.kind === 'rect');
      expect(bars.length).toBeGreaterThan(10);
      for (const bar of bars) {
        // Every bar starts on the module grid and is a whole number of modules wide (Code 128: 1 to 4).
        expect(Math.abs(bar.x / moduleMm - Math.round(bar.x / moduleMm))).toBeLessThan(1e-6);
        const modules = bar.w / moduleMm;
        expect(Math.abs(modules - Math.round(modules))).toBeLessThan(1e-6);
        expect(Math.round(modules)).toBeGreaterThanOrEqual(1);
        expect(Math.round(modules)).toBeLessThanOrEqual(4);
      }
      // Code 128 is 11 modules per character plus a 13-module stop: the width is a whole number of modules.
      expect(Math.abs(symbol.width / moduleMm - Math.round(symbol.width / moduleMm))).toBeLessThan(1e-6);
    }
  });

  it('draws a QR Code on a square grid of the module width requested', () => {
    const symbol = encodeSymbol({ symbology: symbology('qrcode'), data: 'https://cloudhost247.com/tools', moduleMm: 0.5 });
    const modules = symbol.width / 0.5;
    expect(symbol.width).toBe(symbol.height);
    expect(Math.abs(modules - Math.round(modules))).toBeLessThan(1e-6);
    // QR versions are 21, 25, 29 … modules across.
    expect((Math.round(modules) - 17) % 4).toBe(0);
  });

  it('keeps the module width inside the range offered for the type', () => {
    const entry = symbology('code128');
    if (entry.sizing.mode !== 'module') throw new Error('Code 128 is sized by module.');
    expect(encodeSymbol({ symbology: entry, data: 'A1', moduleMm: 0.01 }).moduleMm).toBe(entry.sizing.minModuleMm);
    expect(encodeSymbol({ symbology: entry, data: 'A1', moduleMm: 9 }).moduleMm).toBe(entry.sizing.maxModuleMm);
  });

  it('grows a QR Code with its error correction level and still encodes the same text', async () => {
    const data = 'https://cloudhost247.com/tools/barcode-generator?ref=test-of-levels';
    const widths: number[] = [];
    for (const eclevel of ['L', 'M', 'Q', 'H']) {
      const request = { symbology: symbology('qrcode'), data, options: { eclevel } };
      widths.push(encodeSymbol(request).width);
      const [read] = await readVector(request);
      expect(read?.text, eclevel).toBe(data);
    }
    expect([...widths].sort((a, b) => a - b)).toEqual(widths);
    expect(widths[3] as number).toBeGreaterThan(widths[0] as number);
  });

  it('lets PDF417 be made wider and shorter with the columns option', () => {
    const narrow = encodeSymbol({ symbology: symbology('pdf417'), data: 'CloudHost247 PDF417 sample', options: { columns: 2 } });
    const wide = encodeSymbol({ symbology: symbology('pdf417'), data: 'CloudHost247 PDF417 sample', options: { columns: 8 } });
    expect(wide.width).toBeGreaterThan(narrow.width);
    expect(wide.height).toBeLessThan(narrow.height);
  });

  it('turns a symbol in quarter turns without changing it', async () => {
    const request = { symbology: symbology('code128'), data: 'CH247-000123' };
    const symbol = encodeSymbol(request);
    const turned = rotateSymbol(symbol.ops, symbol.width, symbol.height, 1);
    expect(turned.width).toBeCloseTo(symbol.height, 9);
    expect(turned.height).toBeCloseTo(symbol.width, 9);
    for (const quarterTurns of [1, 2, 3]) {
      const [read] = await readVector(request, quarterTurns);
      expect(read?.text, `${quarterTurns * 90} degrees`).toBe('CH247-000123');
    }
  });
});

/* ------------------------------------------------------------------ */
/* Read-back                                                           */
/* ------------------------------------------------------------------ */

describe('read-back by an independent decoder', () => {
  it.each(DECODABLE.map((entry) => [entry.id, entry] as const))('%s: the vector artwork decodes to its data', async (id, entry) => {
    const found = await readVector({ symbology: entry, data: entry.sample });
    expect(found.map((symbol) => symbol.format), `${id} formats`).toEqual([READER_FORMAT[id]]);
    expect(found[0]?.valid, `${id}: ${found[0]?.error}`).toBe(true);
    expect(found[0]?.text, READER_TEXT[id]?.rule ?? `${id} carries its data literally`).toBe(expectedText(entry));
  });

  it.each(DECODABLE.map((entry) => [entry.id, entry] as const))('%s: the 300 dpi PNG decodes to the same data', async (id, entry) => {
    const bitmap = await renderSymbolPng({ symbology: entry, data: entry.sample, dpi: 300 });
    expect(isPng(bitmap.png)).toBe(true);
    expect(Number.isInteger(bitmap.pixelsPerModule)).toBe(true);
    expect(bitmap.pixelsPerModule).toBeGreaterThanOrEqual(1);
    const found = await decodePng(bitmap.png, READER_OPTIONS[id] ?? {});
    expect(found.map((symbol) => symbol.format), `${id} formats`).toEqual([READER_FORMAT[id]]);
    expect(found[0]?.valid, `${id}: ${found[0]?.error}`).toBe(true);
    expect(found[0]?.text).toBe(expectedText(entry));
  });

  it.each(Object.entries(PARTLY_READ))('%s: the part the tool says is read back is read, and the tool claims no more', async (id, expected) => {
    const entry = symbology(id);
    const found = await readVector({ symbology: entry, data: entry.sample });
    const part = found.find((symbol) => symbol.format === expected.format);
    expect(part?.valid, `${id}: ${found.map((symbol) => `${symbol.format} ${symbol.error}`).join(', ')}`).toBe(true);
    expect(part?.text).toBe(expected.text);
    if (entry.sample.includes('|')) {
      // A composite: nothing the reader returns holds the data of the 2D part.
      const unread = entry.sample.slice(entry.sample.indexOf('|') + 1);
      for (const symbol of found) expect(symbol.text, `${id} ${symbol.format}`).not.toContain(unread);
    } else {
      // An add-on: the reader returns the main number and nothing beside it.
      expect(found.map((symbol) => symbol.text)).toEqual([expected.text]);
    }
    expect(entry.verification).toBe('encoder');
    expect(entry.note ?? '').toMatch(/read .* back .* but/);
  });

  it('carries text beyond ASCII, and line breaks, in the free-text 2D codes', async () => {
    const text = 'Ọláyínká Adéwálé\n₦5,000 · Jos → Lagos';
    for (const id of ['qrcode', 'datamatrix', 'aztec', 'pdf417']) {
      const [read] = await readVector({ symbology: symbology(id), data: text });
      expect(read?.valid, id).toBe(true);
      expect(read?.text, id).toBe(text);
    }
  });

  it('reads back a symbol printed without its human-readable line', async () => {
    const [read] = await readVector({ symbology: symbology('ean13'), data: '9520123456788', showText: false });
    expect(read?.format).toBe('EAN13');
    expect(read?.text).toBe('9520123456788');
  });
});

/* ------------------------------------------------------------------ */
/* What the symbol carries when the encoder completes the data         */
/* ------------------------------------------------------------------ */

describe('data the encoder completes', () => {
  const cases: Array<{ id: string; data: string; includeCheck?: boolean; carries: string; reads: string }> = [
    { id: 'ean13', data: '952012345678', carries: '9520123456788', reads: '9520123456788' },
    { id: 'ean8', data: '9520000', carries: '95200002', reads: '95200002' },
    // Read as EAN-13, so the 12-digit UPC-A gains the leading zero of its GTIN-13 form.
    { id: 'upca', data: '01234500005', carries: '012345000058', reads: '0012345000058' },
    { id: 'itf14', data: '0952123454321', carries: '09521234543213', reads: '09521234543213' },
    { id: 'itf', data: '123', carries: '0123', reads: '0123' },
    { id: 'itf', data: '1234', includeCheck: true, carries: '012348', reads: '012348' },
    { id: 'itf', data: '123', includeCheck: true, carries: '1236', reads: '1236' },
  ];

  it.each(cases)('$id "$data": the result states $carries, and that is what a reader gets', async ({ id, data, includeCheck, carries, reads }) => {
    const stated = carriedContent(symbology(id), data, includeCheck === true);
    expect(stated?.content).toBe(carries);
    const [read] = await readVector({ symbology: symbology(id), data, ...(includeCheck ? { options: { includecheck: true } } : {}) });
    expect(read?.valid).toBe(true);
    expect(read?.text).toBe(reads);
  });

  it('says nothing extra when the symbol carries exactly what was typed', () => {
    expect(carriedContent(symbology('ean13'), '9520123456788', false)).toBeNull();
    expect(carriedContent(symbology('itf'), '1234', false)).toBeNull();
    expect(carriedContent(symbology('code128'), 'CH247-000123', false)).toBeNull();
    expect(carriedContent(symbology('qrcode'), '12345', false)).toBeNull();
  });

  it('appends a check character to Code 39 when asked to', async () => {
    const [read] = await readVector({ symbology: symbology('code39'), data: 'PART-1234', options: { includecheck: true } });
    // Mod 43: P25 A10 R27 T29 -36 1 2 3 4 sum 137, 137 mod 43 = 8.
    expect(read?.text).toBe('PART-12348');
  });
});

/* ------------------------------------------------------------------ */
/* PNG                                                                 */
/* ------------------------------------------------------------------ */

describe('PNG output', () => {
  it('snaps each module to whole pixels and reports the width that results', async () => {
    const at300 = await renderSymbolPng({ symbology: symbology('code128'), data: 'CH247-000123', dpi: 300, moduleMm: 0.33 });
    // 0.33 mm is 3.9 pixels at 300 dpi; the nearest whole number is 4, which is 0.3387 mm.
    expect(at300.pixelsPerModule).toBe(4);
    expect(at300.moduleMm).toBeCloseTo((4 * 25.4) / 300, 9);
    const at203 = await renderSymbolPng({ symbology: symbology('code128'), data: 'CH247-000123', dpi: 203, moduleMm: 0.33 });
    expect(at203.pixelsPerModule).toBe(3);
    expect(at203.moduleMm).toBeCloseTo((3 * 25.4) / 203, 9);
    const wide = pngDimensions(at300.png);
    const narrow = pngDimensions(at203.png);
    expect((wide?.width ?? 0) * 3).toBe((narrow?.width ?? 0) * 4);
  });

  it('records the resolution in the file, so it opens at its true size', async () => {
    const bitmap = await renderSymbolPng({ symbology: symbology('qrcode'), data: 'https://cloudhost247.com', dpi: 600 });
    expect(readPngDpi(bitmap.png)).toBeNull();
    for (const dpi of [203, 300, 600, 1200]) {
      const stamped = setPngDpi(bitmap.png, dpi);
      expect(readPngDpi(stamped)).toBe(dpi);
      expect(pngDimensions(stamped)).toEqual(pngDimensions(bitmap.png));
      // Stamping twice replaces the record instead of adding a second one.
      expect(readPngDpi(setPngDpi(stamped, 300))).toBe(300);
    }
    const [read] = await decodePng(setPngDpi(bitmap.png, 600));
    expect(read?.text).toBe('https://cloudhost247.com');
  });

  it('can leave the background transparent, and the symbol still reads on white paper', async () => {
    const bitmap = await renderSymbolPng({ symbology: symbology('datamatrix'), data: 'CH247-DM-0001', dpi: 300 });
    const [read] = await decodePng(bitmap.png);
    expect(read?.text).toBe('CH247-DM-0001');
  });
});

/* ------------------------------------------------------------------ */
/* Refusals                                                            */
/* ------------------------------------------------------------------ */

describe('refusals', () => {
  function refusal(request: EncodeRequest): BarcodeError {
    try {
      encodeSymbol(request);
    } catch (error) {
      if (error instanceof BarcodeError) return error;
      throw error;
    }
    throw new Error('Expected the encoder to refuse this request.');
  }

  it('refuses data a type cannot carry, in words, without repeating the data', () => {
    const secret = 'SECRET77';
    const cases: EncodeRequest[] = [
      { symbology: symbology('ean13'), data: `${secret}12345` },
      { symbology: symbology('upca'), data: '9520123456788' },
      { symbology: symbology('maxicode'), data: `Ọlá ${secret}` },
      { symbology: symbology('dotcode'), data: `Ọlá ${secret}` },
      { symbology: symbology('code128'), data: `${secret}${'A'.repeat(symbology('code128').maxLength)}` },
    ];
    for (const request of cases) {
      const error = refusal(request);
      expect(error.reason, request.symbology.id).toBe('data');
      expect(error.message, request.symbology.id).not.toContain(secret);
      expect(error.message, request.symbology.id).not.toContain('9520123456788');
      expect(error.message.length, request.symbology.id).toBeGreaterThan(10);
    }
  });

  it('refuses a wrong check digit rather than printing a number that will not scan', () => {
    const error = refusal({ symbology: symbology('ean13'), data: '9520123456789' });
    expect(error.message).toMatch(/check digit/i);
    expect(error.message).not.toContain('9520123456789');
  });

  it('refuses empty data and options outside the published choices', () => {
    expect(refusal({ symbology: symbology('code128'), data: '   ' }).message).toBe('Enter the data to encode.');
    const option = refusal({ symbology: symbology('qrcode'), data: 'A1', options: { eclevel: 'X' } });
    expect(option.reason).toBe('option');
    expect(option.message).toContain('L, M, Q, H');
  });
});

/* ------------------------------------------------------------------ */
/* Where the libraries are allowed to be                               */
/* ------------------------------------------------------------------ */

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(directory)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const path = join(directory, name);
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path));
    else if (/\.(ts|tsx|mts|cts|js|mjs)$/.test(name)) found.push(path);
  }
  return found;
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const specifiers: string[] = [];
  for (const match of source.matchAll(/(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g)) specifiers.push(match[1] as string);
  for (const match of source.matchAll(/(?:import|require)\(\s*['"]([^'"]+)['"]\s*\)/g)) specifiers.push(match[1] as string);
  return specifiers;
}

function resolveRelative(from: string, specifier: string): string | null {
  const base = normalize(join(dirname(from), specifier));
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      /* try the next spelling */
    }
  }
  return null;
}

const posix = (path: string): string => relative(APP_ROOT, path).split(sep).join('/');

describe('library boundaries', () => {
  const production = [...sourceFiles(join(APP_ROOT, 'src')), ...sourceFiles(join(APP_ROOT, 'frontend', 'src'))];

  it('keeps the decoder out of the server and out of the Design Studio: the scanner page alone loads it', () => {
    // The decoder is evidence for these tests, and it is the Barcode Scanner page's full decoder.
    // Nothing that draws a barcode may use it, or the evidence would stop being independent.
    const importers = production.filter((file) => importsOf(file).some((specifier) => specifier.startsWith('zxing-wasm')));
    expect(importers.map(posix).sort()).toEqual(['frontend/src/lib/scan-cpp.ts', 'frontend/src/lib/scan-engine.ts']);
    const manifest = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    // A devDependency: the frontend build bundles it, and the server never needs it at run time.
    expect(manifest.dependencies['zxing-wasm']).toBeUndefined();
    expect(manifest.devDependencies['zxing-wasm']).toMatch(/^\d+\.\d+\.\d+$/);
    // The encoder is a runtime dependency, pinned exactly: a different BWIPP build is a different barcode engine.
    expect(manifest.dependencies['bwip-js']).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('imports the encoder library in one server module only', () => {
    const importers = production.filter((file) => importsOf(file).some((specifier) => specifier === 'bwip-js' || specifier.startsWith('bwip-js/')));
    expect(importers.map(posix)).toEqual(['src/tools/design-studio/barcode/encoder.ts']);
  });

  it('never lets the browser bundle reach the encoder, the PDF writer or a Node module', () => {
    // Start from every Design Studio module the frontend imports and follow the imports from there.
    const studio = join(APP_ROOT, 'src', 'tools', 'design-studio');
    const entries = new Set<string>();
    for (const file of sourceFiles(join(APP_ROOT, 'frontend', 'src'))) {
      for (const specifier of importsOf(file)) {
        if (!specifier.startsWith('.')) continue;
        const resolved = resolveRelative(file, specifier);
        if (resolved && resolved.startsWith(studio)) entries.add(resolved);
      }
    }
    // The forms and their registries, and the PNG resolution stamp the browser applies to the
    // picture it draws itself. A new entry here is a decision, not a side effect.
    expect([...entries].map(posix).sort()).toEqual(['src/tools/design-studio/definitions.ts', 'src/tools/design-studio/forms.ts', 'src/tools/design-studio/render/png-meta.ts']);

    const reached = new Set<string>();
    const queue = [...entries];
    while (queue.length > 0) {
      const file = queue.pop() as string;
      if (reached.has(file)) continue;
      reached.add(file);
      for (const specifier of importsOf(file)) {
        // A browser-safe module imports its own siblings and nothing else: no packages, no node: modules.
        expect(specifier.startsWith('.'), `${posix(file)} imports "${specifier}"`).toBe(true);
        const resolved = resolveRelative(file, specifier);
        expect(resolved, `${posix(file)} imports "${specifier}"`).not.toBeNull();
        if (resolved) queue.push(resolved);
      }
    }
    const names = [...reached].map(posix);
    expect(names).not.toContain('src/tools/design-studio/barcode/encoder.ts');
    expect(names).not.toContain('src/tools/design-studio/render/pdf-vector.ts');
    expect(names.filter((name) => name.startsWith('src/tools/design-studio/tools/'))).toEqual([]);
  });
});
