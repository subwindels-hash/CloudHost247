/**
 * Design Studio: the tools, from request to print file.
 *
 * Barcode Generator, Online Label Printing, VDA 4902 labels, shipping labels and QR code business
 * cards all end in a PDF that somebody prints, so most of this file examines the PDF bytes a
 * request returns rather than the code that produced them:
 *
 *  - tests/helpers/studio-pdf.ts parses the file strictly (cross-reference offsets, stream
 *    lengths, page tree) and replays each page's drawing operators into page millimetres;
 *  - tests/helpers/studio-raster.ts turns those shapes into pixels at a printer's resolution;
 *  - tests/helpers/barcode-reader.ts (zxing-cpp, which shares nothing with the encoder) reads every
 *    symbol on the page.
 *
 * "The label carries the part number" therefore means: a decoder found it on the printed page.
 *
 * Expected values are written out by hand from the published rules (GS1 modulo-10 check digits,
 * RFC 2426 vCard syntax, the VDA 4902 data identifiers, the Code 128 symbol structure), not taken
 * from the code under test.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { NON_PERSISTABLE_TOOL_SLUGS, NON_RUNNABLE_TOOL_SLUGS, TOOL_CATALOG } from '../../src/tools/catalog';
import { ToolError } from '../../src/tools/core/errors';
import { handlerFor, missingHandlers, targetFor } from '../../src/tools/handlers';
import { SYMBOLOGIES, symbologyById } from '../../src/tools/design-studio/barcode/symbologies';
import {
  CARD_SIZES,
  CUSTOM_STOCK_ID,
  LABEL_STOCKS,
  LABEL_TEMPLATES,
  SHIPPING_SHEETS,
  SHIPPING_SIZES,
  STUDIO_SLUGS,
  STUDIO_TOOL_SLUGS,
  VDA_FIELDS,
  labelStocksFor,
  labelTemplate,
  shippingSheetsFor,
  type StudioSlug,
} from '../../src/tools/design-studio/definitions';
import {
  STUDIO_FORMS,
  applyStudioChange,
  buildStudioInput,
  isStudioExample,
  resolveStudioField,
  studioDefaults,
  studioExample,
  studioFields,
  visibleStudioFields,
  type StudioForm,
  type StudioValues,
} from '../../src/tools/design-studio/forms';
import type { StudioOp, StudioSurface } from '../../src/tools/design-studio/render/draw-ops';
import { PDF_PRODUCER, buildVectorPdf } from '../../src/tools/design-studio/render/pdf-vector';
import { pngDimensions, readPngDpi } from '../../src/tools/design-studio/render/png-meta';
import { fontFor, measureText } from '../../src/tools/design-studio/render/text-metrics';
import { BarcodeError } from '../../src/tools/design-studio/barcode/encoder';
import { LabelCanvas } from '../../src/tools/design-studio/shared/compose';
import { buildContactVCard, buildMeCard, contactLines, emptyContact } from '../../src/tools/design-studio/shared/contact';
import { gs1CheckDigit, nextSscc, resolveSscc } from '../../src/tools/design-studio/shared/gs1';
import { ImpositionError, MAX_SHEETS_PER_JOB, imposeOnSheet, onePerPage, type ImpositionReason } from '../../src/tools/design-studio/shared/impose';
import { incrementTrailingNumber } from '../../src/tools/design-studio/shared/input';
import { contrastNotice, fileStem, type StudioFile, type StudioResult } from '../../src/tools/design-studio/shared/result';
import { LABEL_SHEETS, PAGE_SIZES, centredGrid, fitsSheetPosition, labelSheet, validateSheet, type PageSize, type SheetLayout } from '../../src/tools/design-studio/shared/sheets';
import { BARCODE_BATCH_LIMIT, SERIES_LIMITS, seriesValues } from '../../src/tools/design-studio/tools/barcode-generator';
import { drawCard } from '../../src/tools/design-studio/tools/business-card';
import { drawLabel } from '../../src/tools/design-studio/tools/label-designer';
import { drawVdaLabel } from '../../src/tools/design-studio/tools/vda-4902';
import { decodePixels } from '../helpers/barcode-reader';
import { parsePdf, pdfFonts, pdfImageCount, replayPage, type ParsedPdf, type ReplayedPage } from '../helpers/studio-pdf';
import { rasteriseOps } from '../helpers/studio-raster';

const APP_ROOT = join(__dirname, '..', '..');
const A4 = PAGE_SIZES.find((page) => page.id === 'a4') as PageSize;
const LETTER = PAGE_SIZES.find((page) => page.id === 'letter') as PageSize;
const PT_PER_MM = 72 / 25.4;

/* ------------------------------------------------------------------ */
/* Running a tool and reading what it returns                          */
/* ------------------------------------------------------------------ */

/** The handlers take a request context they never use: every studio tool is a pure function. */
const context = {} as never;

async function run(slug: StudioSlug, input: Record<string, unknown>): Promise<StudioResult> {
  const handler = handlerFor(slug);
  if (!handler) throw new Error(`No handler is registered for ${slug}.`);
  return (await handler(input, context)) as StudioResult;
}

async function refusal(slug: StudioSlug, input: Record<string, unknown>): Promise<ToolError> {
  try {
    await run(slug, input);
  } catch (error) {
    if (error instanceof ToolError) return error;
    throw error;
  }
  throw new Error(`Expected ${slug} to refuse this request.`);
}

function fileOf(result: StudioResult, mime: StudioFile['mime'], index = 0): StudioFile {
  const file = result.files.filter((entry) => entry.mime === mime)[index];
  if (!file) throw new Error(`The result has no ${mime} file.`);
  return file;
}

function bytesOf(file: StudioFile): Uint8Array {
  const bytes = new Uint8Array(Buffer.from(file.base64, 'base64'));
  expect(bytes.length, `${file.name}: declared size`).toBe(file.bytes);
  return bytes;
}

/** The result's PDF, parsed. A structural fault in the file fails the test here. */
function pdfOf(result: StudioResult): ParsedPdf {
  const pdf = parsePdf(bytesOf(fileOf(result, 'application/pdf')));
  expect(pdf.problems).toEqual([]);
  return pdf;
}

/** Replay a page; an operator the reader does not know would mean part of the page went unchecked. */
function pageOf(pdf: ParsedPdf, index: number): ReplayedPage {
  const page = replayPage(pdf, index);
  expect(page.unknownOperators).toEqual([]);
  return page;
}

interface Read {
  format: string;
  text: string;
}

/** Print the shapes at `dpi` and read every symbol on them. */
async function read(ops: readonly StudioOp[], widthMm: number, heightMm: number, dpi = 300): Promise<Read[]> {
  const found = await decodePixels(rasteriseOps(ops, widthMm, heightMm, dpi / 25.4));
  for (const symbol of found) expect(symbol.valid, `${symbol.format} "${symbol.text}": ${symbol.error}`).toBe(true);
  return found.map(({ format, text }) => ({ format, text }));
}

async function readPage(pdf: ParsedPdf, index: number, dpi = 300): Promise<Read[]> {
  const page = pageOf(pdf, index);
  return read(page.ops, page.widthMm, page.heightMm, dpi);
}

const texts = (found: Read[]): string[] => found.map((symbol) => symbol.text).sort();

/** The shapes that lie inside one rectangle of the page, moved to its origin. */
function crop(ops: readonly StudioOp[], box: { x: number; y: number; w: number; h: number }): StudioOp[] {
  const inside = (x: number, y: number): boolean => x >= box.x - 0.02 && x <= box.x + box.w + 0.02 && y >= box.y - 0.02 && y <= box.y + box.h + 0.02;
  const kept: StudioOp[] = [];
  for (const op of ops) {
    if (op.kind === 'path') {
      const points = op.segments.filter((segment): segment is { type: 'M' | 'L'; x: number; y: number } => segment.type === 'M' || segment.type === 'L');
      if (points.length === 0 || !points.every((point) => inside(point.x, point.y))) continue;
      kept.push({ ...op, segments: op.segments.map((segment) => (segment.type === 'M' || segment.type === 'L' ? { ...segment, x: segment.x - box.x, y: segment.y - box.y } : segment)) });
    } else if (op.kind === 'line') {
      if (!inside(op.x1, op.y1) || !inside(op.x2, op.y2)) continue;
      kept.push({ ...op, x1: op.x1 - box.x, y1: op.y1 - box.y, x2: op.x2 - box.x, y2: op.y2 - box.y });
    }
  }
  return kept;
}

/** Widths of the black rectangles on a page, in millimetres: the bars of a linear symbol. */
function barWidths(page: ReplayedPage): number[] {
  const widths: number[] = [];
  for (const op of page.ops) {
    if (op.kind !== 'path' || op.fill !== '#000000') continue;
    const corners = op.segments.filter((segment): segment is { type: 'M' | 'L'; x: number; y: number } => segment.type === 'M' || segment.type === 'L');
    if (corners.length !== 4) continue;
    const xs = corners.map((corner) => corner.x);
    widths.push(Math.max(...xs) - Math.min(...xs));
  }
  return widths;
}

function fact(result: StudioResult, label: string): string {
  const found = result.facts.find((entry) => entry.label === label);
  if (!found) throw new Error(`The result has no "${label}" fact. It has: ${result.facts.map((entry) => entry.label).join(', ')}.`);
  return found.value;
}

/** A form's example, after a series of changes made the way the page makes them. */
function example(slug: StudioSlug, changes: Array<[string, string | boolean]> = []): Record<string, unknown> {
  const form = STUDIO_FORMS[slug];
  let values = studioExample(form, studioDefaults(form));
  for (const [name, value] of changes) values = applyStudioChange(form, values, name, value);
  return buildStudioInput(form, values);
}

function surface(width: number, height: number): StudioSurface {
  return { width, height, ops: [{ kind: 'rect', x: 0, y: 0, w: width, h: height, fill: '#000000' }], background: '#ffffff' };
}

/* ------------------------------------------------------------------ */
/* Sample data, written out so the expectations below can be too       */
/* ------------------------------------------------------------------ */

const VDA_INPUT = {
  receiver: 'Example Automotive GmbH\nWerk 2\n12345 Musterstadt',
  dock: 'Tor 14 - LG 07 - M3',
  deliveryNote: '12345678',
  supplierAddress: 'Plateau Components Ltd\nPlant 1, 930001 Jos',
  netWeight: '450 kg',
  grossWeight: '480 kg',
  packages: '12',
  partNumber: 'A 123 456 78 90',
  quantity: '1200',
  description: 'Bracket, left, zinc plated',
  supplierPartNumber: 'PC-48213-B',
  supplierNumber: '123456789',
  date: 'D 2026-11-11',
  changeLevel: '03',
  packageNumber: '100200301',
  batchNumber: 'CH2611A',
};

/** Field value prefixed by its VDA 4902 data identifier: N, P, Q, 30S, V, S (single package), H. */
const VDA_A5_BARCODES = ['N12345678', 'PA 123 456 78 90', 'Q1200', '30SPC-48213-B', 'V123456789', 'S100200301', 'HCH2611A'];
/** The KLT format prints the delivery note (3) and the supplier part number (11) as text only. */
const VDA_KLT_BARCODES = ['PA 123 456 78 90', 'Q1200', 'V123456789', 'S100200301', 'HCH2611A'];

const SHIPPING_INPUT = {
  fromName: 'CloudHost247 Fulfilment',
  fromAddress: '2 Marina Road\nLagos Island\nLagos 101221\nNIGERIA',
  toName: 'Amina Yusuf',
  toCompany: 'Plateau Components Ltd',
  toAddress: '14 Ahmadu Bello Way\nSuite 5',
  toCity: 'Jos',
  toRegion: 'Plateau State',
  toPostcode: '930001',
  toCountry: 'Nigeria',
  toPhone: '+234 803 555 0142',
  service: 'Standard',
  reference: 'ORD-2026-001542',
  date: '11 Nov 2026',
  weight: '2.5 kg',
  note: 'Fragile - handle with care',
};

const CARD_INPUT = {
  firstName: 'Amina',
  lastName: 'Yusuf',
  jobTitle: 'Solutions Architect',
  organization: 'CloudHost247',
  email: 'amina.yusuf@cloudhost247.com',
  phone: '+234 803 555 0142',
  mobile: '+234 809 555 0177',
  website: 'https://cloudhost247.com',
  street: '14 Ahmadu Bello Way',
  city: 'Jos',
  region: 'Plateau State',
  postalCode: '930001',
  country: 'Nigeria',
};

/** RFC 2426: CRLF line ends; N is family;given;additional;prefix;suffix; ADR is pobox;extended;street;locality;region;code;country. */
const CARD_VCARD = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'N:Yusuf;Amina;;;',
  'FN:Amina Yusuf',
  'ORG:CloudHost247',
  'TITLE:Solutions Architect',
  'TEL;TYPE=WORK,VOICE:+234 803 555 0142',
  'TEL;TYPE=CELL,VOICE:+234 809 555 0177',
  'EMAIL;TYPE=INTERNET:amina.yusuf@cloudhost247.com',
  'URL:https://cloudhost247.com',
  'ADR;TYPE=WORK:;;14 Ahmadu Bello Way;Jos;Plateau State;930001;Nigeria',
  'END:VCARD',
].join('\r\n');

/** MeCard: fields end in ";", the card in ";;", and \ ; , : are escaped inside a value. */
const CARD_MECARD =
  'MECARD:N:Yusuf,Amina;ORG:CloudHost247;TEL:+2348035550142;TEL:+2348095550177;EMAIL:amina.yusuf@cloudhost247.com;URL:https\\://cloudhost247.com;' +
  'ADR:14 Ahmadu Bello Way\\, Jos\\, Plateau State 930001\\, Nigeria;NOTE:Solutions Architect;;';

/* ------------------------------------------------------------------ */
/* Catalogue and wiring                                                */
/* ------------------------------------------------------------------ */

function inWords(value: number): string {
  const ones = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  if (value < 20) return ones[value] as string;
  return value % 10 === 0 ? (tens[Math.floor(value / 10)] as string) : `${tens[Math.floor(value / 10)]}-${ones[value % 10]}`;
}

const capitalised = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

describe('catalogue and wiring', () => {
  const entries = STUDIO_TOOL_SLUGS.map((slug) => TOOL_CATALOG.find((entry) => entry.slug === slug));

  it('publishes the studio tools as public, POST-only tools that are never cached or stored', () => {
    expect(STUDIO_TOOL_SLUGS).toEqual(['barcode-generator', 'label-designer', 'vda-4902-label-generator', 'shipping-label-generator', 'qr-business-card-designer', 'qr-code-maker']);
    expect(entries.map((entry) => entry?.name)).toEqual(['Barcode Generator', 'Online Label Printing', 'VDA 4902 Label Generator', 'Shipping Label Generator', 'QR Code Business Cards', 'QR Code Maker']);
    for (const entry of entries) {
      if (!entry) throw new Error('A Design Studio tool is missing from the catalogue.');
      expect(entry.path, entry.slug).toBe(`/tools/${entry.slug}`);
      expect(entry.apiPath, entry.slug).toBe(`/api/tools/${entry.slug}`);
      expect(entry.methods, entry.slug).toEqual(['POST']);
      expect(entry.authRequired, entry.slug).toBe(false);
      expect(entry.visibility, entry.slug).toBe('public');
      // A label or a card carries an address or a phone number: nothing is cached, and the result
      // can never be written to a saved report or a support ticket.
      expect(entry.cacheSeconds, entry.slug).toBe(0);
      expect(NON_PERSISTABLE_TOOL_SLUGS.has(entry.slug), entry.slug).toBe(true);
      expect(NON_RUNNABLE_TOOL_SLUGS.has(entry.slug), entry.slug).toBe(false);
      expect(entry.discoveryCategories, entry.slug).toContain('utilities');
      expect(entry.resultMode, entry.slug).toBe('calculated');
      expect(entry.providerKind, entry.slug).toBeUndefined();
      expect((entry.notes ?? []).length, entry.slug).toBeGreaterThanOrEqual(2);
    }
  });

  it('answers the names people type, and forwards them to the canonical page', () => {
    const aliases = Object.fromEntries(entries.map((entry) => [entry?.slug, entry?.legacyPaths]));
    expect(aliases).toEqual({
      'barcode-generator': ['/tools/barcode'],
      'label-designer': ['/tools/label-printing', '/tools/online-label-printing'],
      'vda-4902-label-generator': ['/tools/vda-4902'],
      'shipping-label-generator': ['/tools/shipping-labels'],
      'qr-business-card-designer': ['/tools/qr-code-business-cards'],
      'qr-code-maker': ['/tools/qr-maker', '/tools/qr-codes'],
    });
    // No alias may shadow another tool's published path.
    const published = new Set(TOOL_CATALOG.map((entry) => entry.path));
    for (const entry of entries) for (const alias of entry?.legacyPaths ?? []) expect(published.has(alias), alias).toBe(false);
  });

  it('links each tool to related tools that exist, and leaves the existing QR generator as it was', () => {
    const slugs = new Set(TOOL_CATALOG.map((entry) => entry.slug));
    for (const entry of entries) {
      expect(entry?.relatedTools?.length, entry?.slug).toBe(3);
      for (const related of entry?.relatedTools ?? []) expect(slugs.has(related), `${entry?.slug} → ${related}`).toBe(true);
    }
    expect(TOOL_CATALOG.filter((entry) => entry.slug === 'qr-generator')).toHaveLength(1);
    expect(new Set(TOOL_CATALOG.map((entry) => entry.slug)).size).toBe(TOOL_CATALOG.length);
  });

  it('has a handler for every runnable catalogue entry, the studio tools included', () => {
    expect(missingHandlers()).toEqual([]);
    for (const slug of STUDIO_TOOL_SLUGS) expect(handlerFor(slug), slug).toBeTypeOf('function');
  });

  it('quotes numbers in the barcode copy that the symbology registry bears out', () => {
    const entry = entries[0];
    const decodable = SYMBOLOGIES.filter((symbology) => symbology.verification === 'decode').length;
    const partly = SYMBOLOGIES.filter((symbology) => symbology.readBack !== undefined).length;
    const encoderOnly = SYMBOLOGIES.length - decodable - partly;
    expect(entry?.summary).toContain(`${SYMBOLOGIES.length} barcode types`);
    expect(entry?.description).toContain(`any of ${SYMBOLOGIES.length} `);
    expect(entry?.notes?.[0]).toContain(`${capitalised(inWords(decodable))} of the barcode types are read back by an independent decoder`);
    expect(entry?.notes?.[0]).toContain(`${capitalised(inWords(partly))} more are read back in part`);
    expect(entry?.notes?.[0]).toContain(`The other ${inWords(encoderOnly)} are produced by the encoder only`);
    // Every type named in the summary is one the tool offers.
    for (const name of ['Code 128', 'EAN-13', 'QR Code', 'Data Matrix']) expect(SYMBOLOGIES.some((symbology) => symbology.name === name), name).toBe(true);
    expect(SYMBOLOGIES.some((symbology) => symbology.name.startsWith('UPC'))).toBe(true);
  });

  it('states the limits of each tool where a visitor reads them', () => {
    const notes = (slug: string): string => (TOOL_CATALOG.find((entry) => entry.slug === slug)?.notes ?? []).join(' ');
    expect(notes('vda-4902-label-generator')).toMatch(/not certified by the VDA/);
    expect(notes('shipping-label-generator')).toMatch(/not a carrier label/i);
    expect(notes('shipping-label-generator')).toMatch(/your own GS1 company prefix/);
    expect(notes('label-designer')).toMatch(/test on plain paper/);
    expect(notes('qr-business-card-designer')).toMatch(/without bleed/);
    expect(notes('barcode-generator')).toMatch(/test with the scanner that will read it/);
  });

  it('labels a signed-in caller’s history by the kind of artwork, never by its content', () => {
    const secret = 'SECRET-7781';
    const input = { data: secret, code: secret, toName: secret, firstName: secret, partNumber: secret, reference: secret };
    expect(targetFor('barcode-generator', { ...input, symbology: 'qrcode' })).toBe('QR Code');
    expect(targetFor('label-designer', { ...input, template: 'shelf-label' })).toBe(labelTemplate('shelf-label')?.name);
    expect(targetFor('vda-4902-label-generator', { ...input, format: 'klt' })).toBe('VDA 4902 KLT');
    expect(targetFor('shipping-label-generator', { ...input, size: 'a6' })).toBe('Shipping label a6');
    expect(targetFor('qr-business-card-designer', { ...input, layout: 'duplex' })).toBe('Business card, duplex layout');
    for (const slug of STUDIO_TOOL_SLUGS) expect(targetFor(slug, input) ?? '', slug).not.toContain(secret);
  });

  it('answers hostile input in every field with a plain refusal that repeats none of it', async () => {
    // A refusal's message and detail are written to the execution log, so neither may carry what
    // was typed. Every field of every tool is given text it was not built for, one field at a time.
    const mark = 'ZQ7781MARK';
    let refused = 0;
    let accepted = 0;
    for (const slug of STUDIO_TOOL_SLUGS) {
      const form = STUDIO_FORMS[slug];
      const base = buildStudioInput(form, studioExample(form, studioDefaults(form)));
      const fields = studioFields(form);
      const attempts: Array<[string, Record<string, unknown>]> = [['every field', Object.fromEntries(fields.map((field) => [field.name, mark]))]];
      for (const field of fields) {
        attempts.push([`${field.name}: text`, { ...base, [field.name]: mark }]);
        attempts.push([`${field.name}: control characters`, { ...base, [field.name]: `${mark}\u0001\u0007` }]);
        attempts.push([`${field.name}: very long`, { ...base, [field.name]: `${mark}-`.repeat(400) }]);
        attempts.push([`${field.name}: 80 lines`, { ...base, [field.name]: Array.from({ length: 80 }, (_, index) => `${mark}${index}`).join('\n') }]);
        attempts.push([`${field.name}: an object`, { ...base, [field.name]: { nested: mark } }]);
        attempts.push([`${field.name}: a list`, { ...base, [field.name]: [mark, mark] }]);
      }
      for (const [label, input] of attempts) {
        let error: unknown = null;
        try {
          await run(slug, input);
          accepted += 1;
        } catch (thrown) {
          error = thrown;
        }
        if (error === null) continue;
        // Never a crash: always the tool's own refusal, as a 400.
        expect(error instanceof ToolError, `${slug}, ${label}: ${String(error)}`).toBe(true);
        const refusalError = error as ToolError;
        expect(refusalError.code, `${slug}, ${label}`).toBe('INVALID_INPUT');
        expect(refusalError.statusCode, `${slug}, ${label}`).toBe(400);
        expect(JSON.stringify({ message: refusalError.message, detail: refusalError.detail ?? null }), `${slug}, ${label}`).not.toContain(mark);
        expect(refusalError.message.length, `${slug}, ${label}`).toBeGreaterThan(15);
        refused += 1;
      }
    }
    // Both outcomes occur in numbers: free text is accepted, everything else is refused.
    expect(refused).toBeGreaterThan(300);
    expect(accepted).toBeGreaterThan(150);
  });

  it('keeps copy free of the em dash the frontend build rewrites', () => {
    // The Vite build replaces U+2014 with a hyphen in everything it compiles, including the shared
    // form definitions, so a dash in a label would read differently in the browser than in the API.
    expect(JSON.stringify(STUDIO_FORMS)).not.toContain('\u2014');
    expect(JSON.stringify(entries)).not.toContain('\u2014');
    expect(JSON.stringify([LABEL_TEMPLATES, LABEL_STOCKS, VDA_FIELDS, SHIPPING_SIZES, SHIPPING_SHEETS, CARD_SIZES, SYMBOLOGIES])).not.toContain('\u2014');
  });

  it('reaches the site search index, the Tools menu, the All Tools page and the router', async () => {
    // The site generator reads the catalogue as text; an entry it cannot parse is silently absent
    // from search. Run its own parser instead of trusting the layout.
    const site = (await import('../../../scripts/site/generate.mjs' as string)) as { publicTools: () => Array<{ slug: string; name: string; path: string; description: string; visibility: string }> };
    const indexed = site.publicTools();
    const committed = JSON.parse(readFileSync(join(APP_ROOT, 'frontend', 'src', 'content', 'tools.generated.json'), 'utf8')) as { tools: Array<{ slug: string; name: string; path: string; description: string }> };
    for (const entry of entries) {
      if (!entry) continue;
      const expected = { slug: entry.slug, name: entry.name, path: entry.path, description: entry.summary };
      expect(indexed.find((tool) => tool.slug === entry.slug), `${entry.slug} in the generator's view of the catalogue`).toMatchObject({ ...expected, visibility: 'public' });
      expect(committed.tools.find((tool) => tool.slug === entry.slug), `${entry.slug} in the committed search index`).toMatchObject(expected);
    }

    const listIn = (file: string, name: string): string[] => {
      const source = readFileSync(join(APP_ROOT, 'frontend', 'src', file), 'utf8');
      const body = new RegExp(`${name}[^=]*=\\s*\\[([^\\]]*)\\]`).exec(source)?.[1] ?? '';
      return [...body.matchAll(/'([^']+)'/g)].map((match) => match[1] as string);
    };
    // The menu group and the All Tools block list the studio tools and, last, the scanner that reads their output back.
    expect(listIn('components/navigation/PlatformMegaMenu.tsx', 'STUDIO_MENU_SLUGS')).toEqual([...STUDIO_TOOL_SLUGS, 'barcode-scanner']);
    expect(listIn('pages/ToolsCenterPage.tsx', 'PRINT_TOOLS')).toEqual([...STUDIO_TOOL_SLUGS, 'barcode-scanner']);

    const app = readFileSync(join(APP_ROOT, 'frontend', 'src', 'App.tsx'), 'utf8');
    for (const slug of STUDIO_TOOL_SLUGS) expect(app).toContain(`<Route path="/tools/${slug}" element={<DesignStudioPage key="${slug}" slug="${slug}" />} />`);
    expect(app).toContain('<Route path="/tools/barcode-scanner" element={<BarcodeScannerPage />} />');
  });

  it('paints no green, which the brand has retired', () => {
    // tests/website/test_theme_palette.py judges every colour in the frontend by hue, so that a new
    // green fails whatever it is called. That gate already fails on older files, which hides a new
    // offender behind the old ones: these tools' own files are therefore held to the same rule
    // here. The measure is the gate's: a hue of 75 to 175 degrees, saturation above 0.25 and value
    // above 0.20.
    const isGreen = (hex: string): boolean => {
      const [red, green, blue] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255) as [number, number, number];
      const max = Math.max(red, green, blue);
      const spread = max - Math.min(red, green, blue);
      if (max === 0 || spread === 0) return false;
      const sixth = max === red ? ((green - blue) / spread + 6) % 6 : max === green ? (blue - red) / spread + 2 : (red - green) / spread + 4;
      const hue = sixth * 60;
      return hue >= 75 && hue <= 175 && spread / max > 0.25 && max > 0.2;
    };
    // The rule itself, on colours whose answer is known: two greens, then the brand gold, the ink and white.
    expect(['#3fbf7f', '#1d4a35', '#e6c875', '#10171d', '#ffffff'].map(isGreen)).toEqual([true, true, false, false, false]);

    const files = [
      'pages/tools/design-studio.css',
      'pages/tools/barcode-scanner.css',
      'components/tools/studio-result.css',
      'pages/tools/DesignStudioPage.tsx',
      'pages/tools/BarcodeScannerPage.tsx',
      'components/tools/StudioResult.tsx',
    ];
    for (const file of files) {
      const source = readFileSync(join(APP_ROOT, 'frontend', 'src', file), 'utf8');
      // Short colours are widened first, so #3b7 is judged as #33bb77.
      const colours = [...source.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)].map((match) => {
        const digits = (match[1] as string).toLowerCase();
        return `#${digits.length === 3 ? [...digits].map((digit) => digit + digit).join('') : digits}`;
      });
      expect(colours.filter(isGreen), file).toEqual([]);
    }
    // The stylesheets do state colours, so an empty list above is a finding and not an empty search.
    expect(readFileSync(join(APP_ROOT, 'frontend', 'src', 'pages/tools/barcode-scanner.css'), 'utf8')).toMatch(/#[0-9a-f]{6}\b/);
  });
});

/* ------------------------------------------------------------------ */
/* Small rules with published answers                                  */
/* ------------------------------------------------------------------ */

describe('GS1 check digits and serial numbers', () => {
  it('computes the modulo-10 check digit of the published examples', () => {
    // GTIN-13 6291041500213: 3·(1+0+5+4+1+2) + (2+0+1+0+9+6) = 39 + 18 = 57, so the digit is 3.
    expect(gs1CheckDigit('629104150021')).toBe(3);
    // SSCC 106141411234567897, the example printed in GS1's own guidance.
    expect(gs1CheckDigit('10614141123456789')).toBe(7);
    // GTIN-8 95200002 and GTIN-14 09521234543213.
    expect(gs1CheckDigit('9520000')).toBe(2);
    expect(gs1CheckDigit('0952123454321')).toBe(3);
    expect(gs1CheckDigit('00000000000000000')).toBe(0);
  });

  it('completes a 17-digit SSCC, verifies an 18-digit one and says what is wrong with any other', () => {
    expect(resolveSscc('10614141123456789')).toEqual({ ok: true, sscc: '106141411234567897' });
    expect(resolveSscc('(00) 1 0614141 123456789 7')).toEqual({ ok: true, sscc: '106141411234567897' });
    const wrong = resolveSscc('106141411234567890');
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) {
      expect(wrong.message).toContain('the last digit should be 7');
      expect(wrong.message).not.toContain('10614141123456789');
    }
    expect(resolveSscc('12345').ok).toBe(false);
    expect(resolveSscc('1061414112345678X').ok).toBe(false);
  });

  it('gives each further package the next serial with its own check digit', () => {
    // 09528765432101234 → weighted sum 124 → 6; +1 → 127 → 3; +2 → 130 → 0.
    expect(nextSscc('095287654321012346', 0)).toBe('095287654321012346');
    expect(nextSscc('095287654321012346', 1)).toBe('095287654321012353');
    expect(nextSscc('095287654321012346', 2)).toBe('095287654321012360');
    expect(nextSscc('999999999999999995', 1)).toBeNull();
  });
});

describe('contact payloads', () => {
  const contact = { ...emptyContact(), ...CARD_INPUT };

  it('writes a vCard 3.0 a phone will accept', () => {
    expect(buildContactVCard(contact)).toBe(CARD_VCARD);
    // Only what was entered is written; N and FN are always present.
    expect(buildContactVCard({ ...emptyContact(), firstName: 'Amina' })).toBe(['BEGIN:VCARD', 'VERSION:3.0', 'N:;Amina;;;', 'FN:Amina', 'END:VCARD'].join('\r\n'));
  });

  it('escapes the characters that would otherwise split a vCard value', () => {
    const card = buildContactVCard({ ...emptyContact(), firstName: 'Tunde', lastName: 'Okoro; Jr, PhD', organization: 'Back\\slash, Ltd', street: 'Plot 4; Block B' });
    expect(card).toContain('N:Okoro\\; Jr\\, PhD;Tunde;;;');
    expect(card).toContain('FN:Tunde Okoro\\; Jr\\, PhD');
    expect(card).toContain('ORG:Back\\\\slash\\, Ltd');
    expect(card).toContain('ADR;TYPE=WORK:;;Plot 4\\; Block B;;;;');
  });

  it('writes a MeCard, with the job title in the note because MeCard has no field for it', () => {
    expect(buildMeCard(contact)).toBe(CARD_MECARD);
    expect(buildMeCard({ ...emptyContact(), firstName: 'Amina' })).toBe('MECARD:N:Amina;;');
  });

  it('prints the contact lines a reader expects, marking the two phone numbers apart', () => {
    expect(contactLines(contact)).toEqual(['T  +234 803 555 0142', 'M  +234 809 555 0177', 'amina.yusuf@cloudhost247.com', 'cloudhost247.com', '14 Ahmadu Bello Way', 'Jos, Plateau State, 930001, Nigeria']);
    expect(contactLines({ ...emptyContact(), firstName: 'A', phone: '+234 803 555 0142' })).toEqual(['+234 803 555 0142']);
  });
});

describe('small helpers', () => {
  it('numbers labels by adding to the last number in the value, keeping its padding', () => {
    expect(incrementTrailingNumber('SN-0099', 1)).toBe('SN-0100');
    expect(incrementTrailingNumber('CH-000123', 20)).toBe('CH-000143');
    expect(incrementTrailingNumber('A9', 1)).toBe('A10');
    expect(incrementTrailingNumber('LOT-7-B', 2)).toBe('LOT-9-B');
    expect(incrementTrailingNumber('99999999999999999999', 1)).toBe('100000000000000000000');
    expect(incrementTrailingNumber('ABC', 1)).toBeNull();
  });

  it('makes download names that are safe on every filesystem', () => {
    expect(fileStem('Ọláyínká Adéwálé')).toBe('olayinka-adewale');
    expect(fileStem('../../etc/passwd')).toBe('etc-passwd');
    expect(fileStem('CON: <report>|?*')).toBe('con-report');
    expect(fileStem('!!!', 'label')).toBe('label');
    expect(fileStem('x'.repeat(200)).length).toBeLessThanOrEqual(48);
  });

  it('warns about colours a scanner cannot read, and only those', () => {
    expect(contrastNotice('#000000', '#ffffff')).toBeNull();
    expect(contrastNotice('#1a3c6e', '#ffffff')).toBeNull();
    expect(contrastNotice('#cccccc', '#ffffff')).toMatch(/close in brightness/);
    expect(contrastNotice('#ffffff', '#000000')).toMatch(/not darker than the background/);
    // Pure red passes a brightness test and still vanishes under a red scan line.
    expect(contrastNotice('#d81e05', '#ffffff')).toMatch(/Red and orange bars/);
  });
});

/* ------------------------------------------------------------------ */
/* Sheets and imposition                                               */
/* ------------------------------------------------------------------ */

describe('label sheets', () => {
  it('offers only layouts whose own measurements fit their page', () => {
    expect(LABEL_SHEETS.length).toBe(13);
    expect(new Set(LABEL_SHEETS.map((sheet) => sheet.id)).size).toBe(LABEL_SHEETS.length);
    for (const sheet of LABEL_SHEETS) {
      expect(validateSheet(sheet), sheet.id).toBeNull();
      // The label count in the name is the grid's.
      expect(sheet.label, sheet.id).toContain(`${sheet.columns * sheet.rows} labels`);
      expect(sheet.label, sheet.id).toContain(`(${sheet.columns} × ${sheet.rows}`);
      // Die-cut sheets are symmetrical left to right.
      const right = sheet.page.width - (sheet.marginLeft + (sheet.columns - 1) * sheet.pitchX + sheet.labelWidth);
      expect(Math.abs(right - sheet.marginLeft), `${sheet.id} left and right margins`).toBeLessThan(0.5);
    }
  });

  it('describes every stock by its measurements, with no manufacturer code', () => {
    for (const stock of LABEL_STOCKS) expect(stock.label, stock.id).not.toMatch(/avery|herma|zweckform|dymo|brother|zebra|\bL7\d{3}\b|\b5160\b/i);
  });

  it('refuses a layout that would print off the page or overlap its own labels', () => {
    const base = labelSheet('a4-3x7-63x38') as SheetLayout;
    expect(validateSheet({ ...base, columns: 4 })).toBe('the grid is wider than the page');
    expect(validateSheet({ ...base, rows: 8 })).toBe('the grid is taller than the page');
    expect(validateSheet({ ...base, pitchX: 60 })).toBe('neighbouring columns overlap');
    expect(validateSheet({ ...base, pitchY: 30 })).toBe('neighbouring rows overlap');
    expect(validateSheet({ ...base, marginTop: -1 })).toBe('a margin is negative');
    expect(validateSheet({ ...base, rows: 0 })).toBe('the grid needs at least one whole row and column');
    expect(validateSheet({ ...base, labelHeight: 0 })).toBe('a label has no area');
    expect(validateSheet({ ...base, pitchX: Number.NaN })).toBe('a measurement is not a number');
  });

  it('centres cut-to-size cards on the page with room for the printer’s margin', () => {
    // A4, 85 × 55 mm, 8 mm margin: floor(194 / 85) = 2 across, floor(281 / 55) = 5 down.
    expect(centredGrid(A4, 85, 55, 0, 8)).toMatchObject({ columns: 2, rows: 5, marginLeft: 20, marginTop: 11, pitchX: 85, pitchY: 55 });
    // Letter is shorter: floor(263.4 / 55) = 4 down.
    const letter = centredGrid(LETTER, 85, 55, 0, 8);
    expect(letter).toMatchObject({ columns: 2, rows: 4 });
    expect(letter?.marginLeft).toBeCloseTo(22.95, 6);
    expect(letter?.marginTop).toBeCloseTo(29.7, 6);
    expect(centredGrid(A4, 300, 55, 0, 8)).toBeNull();
    for (const size of CARD_SIZES) for (const page of [A4, LETTER]) expect(validateSheet(centredGrid(page, size.width, size.height, 0, 8) as SheetLayout), `${size.id} on ${page.id}`).toBeNull();
  });
});

describe('imposition', () => {
  const sheet = labelSheet('a4-3x7-63x38') as SheetLayout;

  function refused(step: () => unknown): ImpositionReason {
    try {
      step();
    } catch (error) {
      if (error instanceof ImpositionError) return error.reason;
      throw error;
    }
    throw new Error('Expected the imposition to be refused.');
  }

  it('fills a sheet row by row and continues on further sheets', () => {
    const label = surface(63.5, 38.1);
    const imposed = imposeOnSheet(Array.from({ length: 25 }, () => label), sheet);
    expect(imposed).toMatchObject({ perSheet: 21, sheets: 2, placed: 25 });
    expect(imposed.pages.map((page) => page.placements.length)).toEqual([21, 4]);
    const first = imposed.pages[0]?.placements ?? [];
    // Position 1 is the top-left label; position 4 starts the second row; position 21 is the last.
    expect(first[0]).toMatchObject({ x: 7.2, y: 15.15 });
    expect(first[2]?.x).toBeCloseTo(7.2 + 2 * 66, 9);
    expect(first[3]).toMatchObject({ x: 7.2 });
    expect(first[3]?.y).toBeCloseTo(15.15 + 38.1, 9);
    expect(first[20]?.x).toBeCloseTo(7.2 + 2 * 66, 9);
    expect(first[20]?.y).toBeCloseTo(15.15 + 6 * 38.1, 9);
    for (const page of imposed.pages) expect([page.width, page.height]).toEqual([210, 297]);
  });

  it('starts part-way down a part-used sheet and counts the skipped positions', () => {
    const label = surface(63.5, 38.1);
    const imposed = imposeOnSheet(Array.from({ length: 30 }, () => label), sheet, { skip: 19 });
    // 19 skipped + 30 labels = 49 positions = 3 sheets of 21.
    expect(imposed.sheets).toBe(3);
    expect(imposed.pages.map((page) => page.placements.length)).toEqual([2, 21, 7]);
    expect(imposed.pages[0]?.placements[0]?.x).toBeCloseTo(7.2 + 66, 9);
    expect(imposed.pages[0]?.placements[0]?.y).toBeCloseTo(15.15 + 6 * 38.1, 9);
  });

  it('centres artwork smaller than its position and leaves its size alone', () => {
    const imposed = imposeOnSheet([surface(20, 20)], sheet);
    expect(imposed.pages[0]?.placements[0]?.x).toBeCloseTo(7.2 + (63.5 - 20) / 2, 9);
    expect(imposed.pages[0]?.placements[0]?.y).toBeCloseTo(15.15 + (38.1 - 20) / 2, 9);
    expect(imposed.pages[0]?.placements[0]?.surface).toMatchObject({ width: 20, height: 20 });
  });

  it('refuses, with a reason, rather than scaling, rotating or clipping', () => {
    expect(refused(() => imposeOnSheet([surface(70, 38.1)], sheet))).toBe('LABEL_EXCEEDS_CELL');
    expect(refused(() => imposeOnSheet([surface(38.1, 63.5)], sheet))).toBe('LABEL_EXCEEDS_CELL');
    expect(refused(() => imposeOnSheet([surface(300, 100)], sheet))).toBe('LABEL_EXCEEDS_PAGE');
    expect(refused(() => imposeOnSheet([surface(10, 10)], { ...sheet, columns: 4 }))).toBe('GRID_EXCEEDS_PAGE');
    expect(refused(() => imposeOnSheet([surface(10, 10)], { ...sheet, pitchX: 60 }))).toBe('INVALID_GEOMETRY');
    expect(refused(() => imposeOnSheet([], sheet))).toBe('INVALID_GEOMETRY');
    expect(refused(() => imposeOnSheet([surface(10, 10)], sheet, { skip: 21 }))).toBe('INVALID_GEOMETRY');
    expect(refused(() => onePerPage([]))).toBe('INVALID_GEOMETRY');
    const twoUp = labelSheet('a4-1x2-210x148') as SheetLayout;
    expect(MAX_SHEETS_PER_JOB).toBe(40);
    expect(imposeOnSheet(Array.from({ length: 80 }, () => surface(210, 148)), twoUp).sheets).toBe(40);
    expect(refused(() => imposeOnSheet(Array.from({ length: 81 }, () => surface(210, 148)), twoUp))).toBe('TOO_MANY_PAGES');
  });

  it('allows for inch-to-millimetre rounding, and no more', () => {
    const fourBySix = labelSheet('letter-2x1-4x6') as SheetLayout;
    const a6 = labelSheet('a4-2x2-105x148') as SheetLayout;
    expect(fitsSheetPosition(fourBySix, 101.6, 152.4)).toBe(true);
    expect(fitsSheetPosition(fourBySix, 100, 150)).toBe(true);
    expect(fitsSheetPosition(fourBySix, 105, 148)).toBe(false);
    expect(fitsSheetPosition(a6, 105, 148)).toBe(true);
    expect(fitsSheetPosition(a6, 101.6, 152.4)).toBe(false);
    expect(fitsSheetPosition(a6, 105.31, 148)).toBe(false);
  });

  it('makes one exact-size page per label for label printers', () => {
    const pages = onePerPage([surface(100, 150), surface(57, 32)]);
    expect(pages.map((page) => [page.width, page.height])).toEqual([[100, 150], [57, 32]]);
    expect(pages[1]?.placements).toEqual([{ surface: expect.objectContaining({ width: 57, height: 32 }), x: 0, y: 0 }]);
  });
});

/* ------------------------------------------------------------------ */
/* The PDF file                                                        */
/* ------------------------------------------------------------------ */

describe('PDF output', () => {
  it.each(STUDIO_TOOL_SLUGS.map((slug) => [slug] as const))('%s: writes a structurally sound, vector-only file that asks to be printed at actual size', async (slug) => {
    const result = await run(slug, example(slug));
    const bytes = bytesOf(fileOf(result, 'application/pdf'));
    const pdf = parsePdf(bytes);
    // Every cross-reference offset, stream length and page-tree link was checked by the parser.
    expect(pdf.problems).toEqual([]);
    expect(pdf.version).toBe('1.6');
    expect(pdf.pages.length).toBeGreaterThanOrEqual(1);
    expect(pdf.catalog).toContain('/ViewerPreferences << /PrintScaling /None >>');
    expect(pdf.info).toContain(`/Producer (${PDF_PRODUCER})`);
    // Vector only: no bitmap is embedded, so bars print at the device's own resolution.
    expect(pdfImageCount(pdf)).toBe(0);
    // Text uses the fonts every reader has built in; nothing is embedded.
    const fonts = pdfFonts(pdf);
    expect(fonts.embedded).toBe(false);
    for (const font of fonts.baseFonts) expect(['Helvetica', 'Helvetica-Bold', 'Courier', 'Courier-Bold']).toContain(font);
    for (const [index] of pdf.pages.entries()) {
      const page = pageOf(pdf, index);
      expect(page.images).toBe(0);
      // Artwork is placed at true size: one millimetre of label is one millimetre of page.
      for (const placement of page.placements) {
        expect(placement.scaleX).toBeCloseTo(1, 5);
        expect(placement.scaleY).toBeCloseTo(1, 5);
        expect(placement.rotated).toBe(false);
      }
    }
  });

  it('is checked by a reader that notices a damaged file', () => {
    const sound = buildVectorPdf([{ width: 50, height: 30, placements: [{ surface: surface(20, 10), x: 5, y: 5 }] }], { title: 'Control' });
    expect(parsePdf(sound.bytes).problems).toEqual([]);

    // One byte inserted after the header moves every object: all cross-reference offsets are stale.
    const shifted = new Uint8Array(sound.bytes.length + 1);
    shifted.set(sound.bytes.subarray(0, 9));
    shifted[9] = 0x0a;
    shifted.set(sound.bytes.subarray(9), 10);
    expect(parsePdf(shifted).problems.length).toBeGreaterThan(0);

    // A stream one byte shorter than its /Length.
    const text = Buffer.from(sound.bytes).toString('latin1');
    const cut = text.indexOf('\nendstream');
    const shortened = Buffer.from(text.slice(0, cut - 1) + text.slice(cut), 'latin1');
    expect(parsePdf(new Uint8Array(shortened)).problems.length).toBeGreaterThan(0);

    expect(parsePdf(sound.bytes.subarray(0, sound.bytes.length - 20)).problems.length).toBeGreaterThan(0);
  });

  it('sizes each page in points from millimetres and draws in millimetres from the top-left', () => {
    const built = buildVectorPdf(
      [{ width: 100, height: 150, placements: [{ surface: { width: 40, height: 20, ops: [{ kind: 'rect', x: 10, y: 5, w: 20, h: 10, fill: '#000000' }] }, x: 30, y: 100 }] }],
      { title: 'Geometry' }
    );
    const pdf = parsePdf(built.bytes);
    expect(pdf.problems).toEqual([]);
    expect(pdf.pages[0]?.widthPt).toBeCloseTo(100 * PT_PER_MM, 2);
    expect(pdf.pages[0]?.heightPt).toBeCloseTo(150 * PT_PER_MM, 2);
    const page = pageOf(pdf, 0);
    expect(page.placements).toHaveLength(1);
    expect(page.placements[0]?.x).toBeCloseTo(30, 3);
    expect(page.placements[0]?.y).toBeCloseTo(100, 3);
    // The rectangle sits 40 mm from the left and 105 mm from the top of the page.
    const rect = page.ops[0];
    if (rect?.kind !== 'path') throw new Error('Expected a filled path.');
    const corners = rect.segments.filter((segment): segment is { type: 'M' | 'L'; x: number; y: number } => segment.type !== 'Z');
    expect(Math.min(...corners.map((corner) => corner.x))).toBeCloseTo(40, 3);
    expect(Math.max(...corners.map((corner) => corner.x))).toBeCloseTo(60, 3);
    expect(Math.min(...corners.map((corner) => corner.y))).toBeCloseTo(105, 3);
    expect(Math.max(...corners.map((corner) => corner.y))).toBeCloseTo(115, 3);
  });

  it('stores artwork once however many times a sheet repeats it', async () => {
    const one = await run('label-designer', { template: 'asset-tag', stock: 'a4-3x7-63x38', code: 'CH-000123', copies: 1 });
    const many = await run('label-designer', { template: 'asset-tag', stock: 'a4-3x7-63x38', code: 'CH-000123', copies: 21 });
    const pdf = pdfOf(many);
    const forms = [...pdf.objects.values()].filter((object) => /\/Subtype \/Form/.test(object.dictionary));
    expect(forms).toHaveLength(1);
    expect(pageOf(pdf, 0).placements).toHaveLength(21);
    // Twenty more labels cost a few hundred bytes of placement, not twenty copies of the artwork.
    expect(fileOf(many, 'application/pdf').bytes - fileOf(one, 'application/pdf').bytes).toBeLessThan(600);
  });

  it('produces the same page with and without stream compression', () => {
    const pages = [{ width: 60, height: 30, placements: [{ surface: surface(20, 10), x: 5, y: 5 }], overlay: [{ kind: 'line' as const, x1: 0, y1: 1, x2: 60, y2: 1, color: '#000000', width: 0.1 }] }];
    const packed = parsePdf(buildVectorPdf(pages, { title: 'Streams' }).bytes);
    const plain = parsePdf(buildVectorPdf(pages, { title: 'Streams' }, { compress: false }).bytes);
    expect(packed.problems).toEqual([]);
    expect(plain.problems).toEqual([]);
    expect(pageOf(plain, 0).ops).toEqual(pageOf(packed, 0).ops);
    const stored = (pdf: ParsedPdf): string[] => [...pdf.objects.values()].filter((object) => object.stream).map((object) => (/\/Filter \/FlateDecode/.test(object.dictionary) ? 'flate' : 'plain'));
    expect(new Set(stored(packed))).toEqual(new Set(['flate']));
    expect(new Set(stored(plain))).toEqual(new Set(['plain']));
  });

  it('writes a document title that is not plain ASCII as UTF-16 with a byte order mark', async () => {
    const batch = await run('barcode-generator', { symbology: 'code128', data: 'A-1\nA-2', batch: true });
    // "2 × Code 128 | CloudHost247 Barcode Generator": the multiplication sign is U+00D7.
    expect(pdfOf(batch).info).toMatch(/\/Title <FEFF003200200{0,1}0D7/);
    const single = await run('barcode-generator', { symbology: 'code128', data: 'A-1' });
    expect(pdfOf(single).info).toContain('/Title (Code 128 | CloudHost247 Barcode Generator)');
  });
});

/* ------------------------------------------------------------------ */
/* Barcode Generator                                                   */
/* ------------------------------------------------------------------ */

describe('Barcode Generator', () => {
  it('returns SVG, PNG and PDF of one symbol at the size it states', async () => {
    const result = await run('barcode-generator', { symbology: 'code128', data: 'CH247-000123' });
    expect(Object.keys(result).sort()).toEqual(['count', 'facts', 'files', 'notices', 'previews', 'studio', 'title']);
    expect(result.files.map((file) => [file.name, file.mime])).toEqual([
      ['code128-ch247-000123.svg', 'image/svg+xml'],
      ['code128-ch247-000123-300dpi.png', 'image/png'],
      ['code128-ch247-000123.pdf', 'application/pdf'],
    ]);

    // Code 128 for "CH247-000123": start, six characters in set B, the switch to set C, three digit
    // pairs, the checksum and the stop: 12 symbols of 11 modules plus a 13-module stop = 145 modules.
    // With the 10-module quiet zone on each side that is 165 modules.
    const moduleMm = 0.33;
    const svg = Buffer.from(fileOf(result, 'image/svg+xml').base64, 'base64').toString('utf8');
    expect(svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" width="${165 * moduleMm}mm"`)).toBe(true);
    expect(svg).toContain(`viewBox="0 0 ${165 * moduleMm} `);
    expect(svg).not.toContain('<image');

    const png = bytesOf(fileOf(result, 'image/png'));
    // 0.33 mm is 3.9 pixels at 300 dpi; each module is drawn as 4 whole pixels.
    expect(pngDimensions(png)?.width).toBe(165 * 4);
    expect(readPngDpi(png)).toBe(300);
    expect(result.notices.join(' ')).toContain('The PNG uses 4 pixels per module, which is 0.34 mm at 300 dpi');

    const pdf = pdfOf(result);
    expect(pdf.pages).toHaveLength(1);
    expect(pdf.pages[0]?.widthMm).toBeCloseTo(165 * moduleMm, 2);
    const page = pageOf(pdf, 0);
    // Every bar in the print file is a whole number of modules wide, 1 to 4, to within a micron.
    const widths = barWidths(page).filter((width) => width < 2);
    expect(widths.length).toBeGreaterThan(30);
    for (const width of widths) {
      const modules = width / moduleMm;
      expect(Math.abs(modules - Math.round(modules)) * moduleMm).toBeLessThan(0.0011);
      expect(Math.round(modules)).toBeGreaterThanOrEqual(1);
      expect(Math.round(modules)).toBeLessThanOrEqual(4);
    }
    expect(Math.min(...widths)).toBeCloseTo(moduleMm, 3);
    expect(await readPage(pdf, 0)).toEqual([{ format: 'Code128', text: 'CH247-000123' }]);
    // A 203 dpi thermal printer reads the same file.
    expect(await readPage(pdf, 0, 203)).toEqual([{ format: 'Code128', text: 'CH247-000123' }]);

    expect(fact(result, 'Barcode type')).toBe('Code 128');
    expect(fact(result, 'Your data')).toBe('CH247-000123');
    expect(fact(result, 'Size')).toBe('54.45 × 24.26 mm including the quiet zone');
    expect(fact(result, 'Module width (SVG, PDF)')).toBe('0.33 mm');
    expect(fact(result, 'PNG')).toBe('660 × 294 px at 300 dpi');
    expect(result.previews).toHaveLength(1);
    expect(result.previews[0]?.widthMm).toBeCloseTo(54.45, 6);
    expect(result.count).toBe(1);
  });

  it('says what the symbol carries when the barcode type completes the data', async () => {
    const result = await run('barcode-generator', { symbology: 'ean13', data: '952012345678' });
    expect(fact(result, 'Your data')).toBe('952012345678');
    expect(fact(result, 'The symbol carries')).toBe('9520123456788 (check digit 8 added)');
    expect(await readPage(pdfOf(result), 0)).toEqual([{ format: 'EAN13', text: '9520123456788' }]);

    const itf = await run('barcode-generator', { symbology: 'itf', data: '123' });
    expect(fact(itf, 'The symbol carries')).toBe('0123 (a leading zero added, because ITF encodes digits in pairs)');
    expect(await readPage(pdfOf(itf), 0)).toEqual([{ format: 'ITF', text: '0123' }]);

    const whole = await run('barcode-generator', { symbology: 'ean13', data: '9520123456788' });
    expect(whole.facts.map((entry) => entry.label)).not.toContain('The symbol carries');

    const checked = await run('barcode-generator', { symbology: 'code39', data: 'PART-1234', includecheck: true });
    expect(checked.notices).toContain('A check character was added to the bars after your data.');
    expect(await readPage(pdfOf(checked), 0)).toEqual([{ format: 'Code39', text: 'PART-12348' }]);
  });

  it('reports each type as read back, read in part or encoder-only, exactly as the registry classifies it', async () => {
    for (const symbology of SYMBOLOGIES) {
      const result = await run('barcode-generator', { symbology: symbology.id, data: symbology.sample });
      const verification = fact(result, 'Verification');
      if (symbology.verification === 'decode') {
        expect(verification, symbology.id).toBe('This barcode type is read back by an independent decoder in our automated tests.');
        expect(result.notices.join(' '), symbology.id).not.toMatch(/your own scanner/);
      } else if (symbology.readBack) {
        // A composite symbol or an add-on: one part is read, and the result claims that part only.
        expect(['the linear part', 'the main symbol'], symbology.id).toContain(symbology.readBack);
        expect(verification, symbology.id).toBe(`Partly read back: our automated tests read ${symbology.readBack} with an independent decoder, and no more of this symbol than that.`);
        expect(symbology.note, symbology.id).toMatch(new RegExp(`^Our automated tests read ${symbology.readBack}( of this symbol)? back with an independent decoder, but `));
        expect(symbology.note, symbology.id).toMatch(/Scan a printed sample with your own scanner before you rely on it\.$/);
        expect(result.notices, symbology.id).toContain(symbology.note);
      } else {
        expect(verification, symbology.id).toBe('Not read back: no independent decoder for this barcode type is available to our automated tests.');
        expect(result.notices, symbology.id).toContain('Our automated tests have no independent decoder for this barcode type, so it is not read back there. Scan a printed sample with your own scanner before you rely on it.');
        expect(symbology.note, symbology.id).toBe('Our automated tests have no independent decoder for this barcode type, so it is not read back there. Scan a printed sample with your own scanner before you rely on it.');
      }
      expect(result.files.map((file) => file.mime), symbology.id).toEqual(['image/svg+xml', 'image/png', 'application/pdf']);
      expect(pdfOf(result).pages, symbology.id).toHaveLength(1);
    }
  });

  it('turns the symbol, drops the quiet zone and changes colours on request', async () => {
    const upright = await run('barcode-generator', { symbology: 'code128', data: 'CH247-000123' });
    const turned = await run('barcode-generator', { symbology: 'code128', data: 'CH247-000123', rotation: '90' });
    const uprightPage = pdfOf(upright).pages[0];
    const turnedPage = pdfOf(turned).pages[0];
    expect(turnedPage?.widthMm).toBeCloseTo(uprightPage?.heightMm ?? 0, 3);
    expect(turnedPage?.heightMm).toBeCloseTo(uprightPage?.widthMm ?? 0, 3);
    expect(await readPage(pdfOf(turned), 0)).toEqual([{ format: 'Code128', text: 'CH247-000123' }]);

    const bare = await run('barcode-generator', { symbology: 'code128', data: 'CH247-000123', quietZone: false });
    expect(pdfOf(bare).pages[0]?.widthMm).toBeCloseTo(145 * 0.33, 2);
    expect(fact(bare, 'Size')).not.toContain('quiet zone');
    expect(bare.notices.join(' ')).toContain('The quiet zone is off.');

    const coloured = await run('barcode-generator', { symbology: 'code128', data: 'A1', color: '#1A3C6E', background: '#fff8e1' });
    const svg = Buffer.from(fileOf(coloured, 'image/svg+xml').base64, 'base64').toString('utf8');
    expect(svg).toContain('fill="#1a3c6e"');
    expect(svg).toContain('fill="#fff8e1"');
    expect(await readPage(pdfOf(coloured), 0)).toEqual([{ format: 'Code128', text: 'A1' }]);

    const clear = await run('barcode-generator', { symbology: 'code128', data: 'A1', transparent: true });
    expect(Buffer.from(fileOf(clear, 'image/svg+xml').base64, 'base64').toString('utf8')).not.toContain('#ffffff');

    expect((await run('barcode-generator', { symbology: 'code128', data: 'A1', color: '#cccccc' })).notices.join(' ')).toContain('close in brightness');
    expect((await run('barcode-generator', { symbology: 'code128', data: 'A1', color: '#ffffff', background: '#000000' })).notices.join(' ')).toContain('not darker than the background');
  });

  it('keeps sizes inside the range offered and says when it changed one', async () => {
    const narrow = await run('barcode-generator', { symbology: 'code128', data: 'A1', moduleMm: 0.1 });
    expect(fact(narrow, 'Module width (SVG, PDF)')).toBe('0.19 mm');
    expect(narrow.notices.join(' ')).toContain('The module width was set to 0.19 mm');
    const short = await run('barcode-generator', { symbology: 'code128', data: 'A1', barHeightMm: 2 });
    expect(short.notices.join(' ')).toContain('The bar height was set to 3 mm');
    const matrix = await run('barcode-generator', { symbology: 'qrcode', data: 'A1', barHeightMm: 20 });
    expect(matrix.notices.join(' ')).toContain('The bar height setting does not apply to QR Code');
    expect((await run('barcode-generator', { symbology: 'code128', data: 'A1', barHeightMm: 20 })).notices.join(' ')).not.toContain('bar height');
  });

  it('accepts symbology options flat, as a form sends them, or nested, as an API client might', async () => {
    const data = 'https://cloudhost247.com/tools/barcode-generator';
    const width = async (input: Record<string, unknown>): Promise<number> => pdfOf(await run('barcode-generator', { symbology: 'qrcode', data, ...input })).pages[0]?.widthMm ?? 0;
    const low = await width({ eclevel: 'L' });
    const high = await width({ eclevel: 'H' });
    expect(high).toBeGreaterThan(low);
    expect(await width({ options: { eclevel: 'H' } })).toBeCloseTo(high, 6);
    // PDF417's security level shares an encoder key with QR error correction; the form field is its own.
    const loose = pdfOf(await run('barcode-generator', { symbology: 'pdf417', data, securityLevel: 1 })).pages[0];
    const strong = pdfOf(await run('barcode-generator', { symbology: 'pdf417', data, securityLevel: 6 })).pages[0];
    expect((strong?.heightMm ?? 0) * (strong?.widthMm ?? 0)).toBeGreaterThan((loose?.heightMm ?? 0) * (loose?.widthMm ?? 0));
  });

  it('makes one barcode per line in a batch: a ZIP of SVG and PNG, and a PDF page each', async () => {
    const result = await run('barcode-generator', { symbology: 'code128', data: 'A-1\r\nA-2\n\n  A-3  ', batch: true });
    expect(result.title).toBe('3 × Code 128');
    expect(result.count).toBe(3);
    expect(result.files.map((file) => [file.name, file.mime, file.label])).toEqual([
      ['code128-batch.zip', 'application/zip', 'Download ZIP (3 SVG + 3 PNG)'],
      ['code128-batch.pdf', 'application/pdf', 'Download PDF (3 pages)'],
    ]);
    // The ZIP's central directory lists what it holds.
    const zip = Buffer.from(fileOf(result, 'application/zip').base64, 'base64');
    const names: string[] = [];
    for (let at = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); at >= 0; at = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), at + 46)) {
      names.push(zip.subarray(at + 46, at + 46 + zip.readUInt16LE(at + 28)).toString('utf8'));
    }
    expect(names).toEqual(['svg/01-a-1.svg', 'png/01-a-1.png', 'svg/02-a-2.svg', 'png/02-a-2.png', 'svg/03-a-3.svg', 'png/03-a-3.png']);
    const pdf = pdfOf(result);
    expect(pdf.pages).toHaveLength(3);
    for (const [index, expected] of ['A-1', 'A-2', 'A-3'].entries()) expect(await readPage(pdf, index)).toEqual([{ format: 'Code128', text: expected }]);
    expect(result.previews.map((preview) => preview.title)).toEqual(['1. A-1', '2. A-2', '3. A-3']);
  });

  it('counts a numbered series itself: fixed text, a counter and leading zeros', async () => {
    expect(seriesValues({ prefix: 'CH-', first: 98, count: 5, step: 1, digits: 4, suffix: '' })).toEqual(['CH-0098', 'CH-0099', 'CH-0100', 'CH-0101', 'CH-0102']);
    expect(seriesValues({ prefix: '', first: 5, count: 3, step: 10, digits: 0, suffix: '/A' })).toEqual(['5/A', '15/A', '25/A']);
    // A number that outgrows the digits asked for is never cut.
    expect(seriesValues({ prefix: '', first: 8, count: 4, step: 1, digits: 1, suffix: '' })).toEqual(['8', '9', '10', '11']);

    const result = await run('barcode-generator', { symbology: 'code128', series: true, seriesPrefix: 'CH-', seriesStart: 98, seriesCount: 5, seriesDigits: 4 });
    expect(result.title).toBe('5 × Code 128');
    expect(result.count).toBe(5);
    expect(result.files.map((file) => [file.name, file.label])).toEqual([
      ['code128-series.zip', 'Download ZIP (5 SVG + 5 PNG)'],
      ['code128-series.pdf', 'Download PDF (5 pages)'],
    ]);
    expect(fact(result, 'Barcodes')).toBe('5');
    expect(fact(result, 'Series')).toBe('CH-0098 to CH-0102');
    // Each page of the PDF is read: the numbers are in the bars, in order.
    const pdf = pdfOf(result);
    expect(pdf.pages).toHaveLength(5);
    for (const [index, expected] of ['CH-0098', 'CH-0099', 'CH-0100', 'CH-0101', 'CH-0102'].entries()) expect(await readPage(pdf, index)).toEqual([{ format: 'Code128', text: expected }]);

    // The data field is not needed, and is not read, once a series is asked for.
    const ignored = await run('barcode-generator', { symbology: 'code128', series: true, data: 'NOT-THIS', seriesCount: 2 });
    expect(fact(ignored, 'Series')).toBe('1 to 2');
    // The defaults: ten barcodes from 1, counting by one.
    expect(fact(await run('barcode-generator', { symbology: 'code128', series: true }), 'Series')).toBe('1 to 10');
    expect(fact(await run('barcode-generator', { symbology: 'code128', series: true, seriesCount: 1, seriesStart: 7 }), 'Series')).toBe('7');
  });

  it('completes each number of a retail series with its own check digit, and says what the symbols carry', async () => {
    const result = await run('barcode-generator', { symbology: 'ean13', series: true, seriesPrefix: '95201234', seriesStart: 5678, seriesCount: 3, seriesDigits: 4 });
    // 952012345678 → 8, 952012345679 → 5, 952012345680 → 1 (GS1 mod 10).
    expect(fact(result, 'Series')).toBe('9520123456788 to 9520123456801, as the symbols carry them');
    const pdf = pdfOf(result);
    for (const [index, expected] of ['9520123456788', '9520123456795', '9520123456801'].entries()) expect(await readPage(pdf, index)).toEqual([{ format: 'EAN13', text: expected }]);
  });

  it('lays a series out on a label sheet with copies, and refuses a series it cannot make', async () => {
    const sheet = labelSheet('a4-3x7-63x38') as SheetLayout;
    const onSheet = await run('barcode-generator', { symbology: 'code128', series: true, seriesPrefix: 'A', seriesCount: 4, sheet: sheet.id, copies: 2 });
    expect(onSheet.count).toBe(8);
    expect(fact(onSheet, 'Labels')).toBe('8 on 1 sheet');

    const refusals: Array<[Record<string, unknown>, string]> = [
      [{ seriesCount: 51 }, 'How many must be between 1 and 50.'],
      [{ seriesCount: 0 }, 'How many must be between 1 and 50.'],
      [{ seriesStart: -1 }, 'First number must be between 0 and 999999999999.'],
      [{ seriesStart: 1.5 }, 'First number must be a whole number.'],
      [{ seriesStep: 0 }, 'Count up by must be between 1 and 1000000.'],
      [{ seriesDigits: 21 }, 'Digits must be between 0 and 20.'],
      [{ seriesPrefix: 'x'.repeat(41) }, 'Text before the number is limited to 40 characters.'],
      [{ seriesSuffix: 'x'.repeat(41) }, 'Text after the number is limited to 40 characters.'],
      // A value the barcode type cannot hold is refused by its place in the series, not by its content.
      [{ symbology: 'ean13', seriesPrefix: 'ABC' }, 'Number 1 of the series: That is not valid EAN-13 data. Expected: 12 digits (the check digit is added) or 13 digits including it.'],
      [{ seriesCount: 6, sheet: sheet.id, copies: 100 }, 'This would print 600 labels; one request is limited to 500.'],
    ];
    for (const [input, message] of refusals) {
      const error = await refusal('barcode-generator', { symbology: 'code128', series: true, ...input });
      expect(error.message, JSON.stringify(input)).toBe(message);
    }
  });

  it('lays copies out on a label sheet, each centred in its position', async () => {
    const sheet = labelSheet('a4-3x7-63x38') as SheetLayout;
    const result = await run('barcode-generator', { symbology: 'qrcode', data: 'https://cloudhost247.com', sheet: sheet.id, copies: 30 });
    expect(fact(result, 'Sheet')).toBe(sheet.label);
    expect(fact(result, 'Labels')).toBe('30 on 2 sheets');
    expect(result.count).toBe(30);
    const pdf = pdfOf(result);
    expect(pdf.pages.map((page) => [Math.round(page.widthMm), Math.round(page.heightMm)])).toEqual([[210, 297], [210, 297]]);
    const first = pageOf(pdf, 0);
    expect(first.placements).toHaveLength(21);
    expect(pageOf(pdf, 1).placements).toHaveLength(9);
    // The symbol is 16.5 mm square with its quiet zone, so it starts (63.5 - 16.5) / 2 into the position.
    expect(first.placements[0]?.x).toBeCloseTo(7.2 + (63.5 - 16.5) / 2, 2);
    expect(first.placements[0]?.y).toBeCloseTo(15.15 + (38.1 - 16.5) / 2, 2);
    expect(first.placements[1]?.x).toBeCloseTo(7.2 + 66 + (63.5 - 16.5) / 2, 2);
    expect(texts(await readPage(pdf, 0))).toEqual(Array.from({ length: 21 }, () => 'https://cloudhost247.com'));
    expect(texts(await readPage(pdf, 1))).toEqual(Array.from({ length: 9 }, () => 'https://cloudhost247.com'));
  });

  it('refuses requests it cannot print truthfully, without repeating what was entered', async () => {
    const secret = 'SECRET-VALUE-77';
    const cases: Array<[Record<string, unknown>, RegExp, string | undefined]> = [
      [{ symbology: 'code128', data: '' }, /^Enter the data to encode\.$/, undefined],
      [{ symbology: 'no-such-type', data: secret }, /not a barcode type this tool offers/, undefined],
      [{ symbology: 'ean13', data: secret }, /not valid EAN-13 data|limited to 13 characters/, undefined],
      [{ symbology: 'ean13', data: `9520123456788\n${secret}`, batch: true }, /^Line 2: /, undefined],
      [{ symbology: 'code128', data: secret, copies: 5 }, /Copies are laid out on a label sheet/, undefined],
      [{ symbology: 'code128', data: Array.from({ length: 51 }, (_, index) => `${secret}${index}`).join('\n'), batch: true }, /limited to 50 barcodes per request; this one has 51/, undefined],
      [{ symbology: 'code128', data: `${secret}-LONG-VALUE-THAT-IS-WIDE`, sheet: 'a4-5x13-38x21', copies: 2 }, /It is not scaled to fit, because that would change its barcodes/, 'LABEL_EXCEEDS_CELL'],
      [{ symbology: 'code128', data: secret, sheet: 'no-such-sheet' }, /not one this tool offers/, undefined],
      [{ symbology: 'code128', data: secret, dpi: 5000 }, /Resolution must be between 72 and 1200/, undefined],
      [{ symbology: 'code128', data: secret, color: 'red' }, /Bar colour must be a colour such as #1a2b3c/, undefined],
      [{ symbology: 'qrcode', data: secret, eclevel: 'Z' }, /L, M, Q, H/, undefined],
    ];
    for (const [input, message, reason] of cases) {
      const error = await refusal('barcode-generator', input);
      expect(error.code).toBe('INVALID_INPUT');
      expect(error.statusCode).toBe(400);
      expect(error.message).toMatch(message);
      expect(error.message).not.toContain(secret);
      expect(error.detail.reason).toBe(reason);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Online Label Printing                                               */
/* ------------------------------------------------------------------ */

describe('Online Label Printing', () => {
  it('prints a readable barcode for every template and barcode type it offers', async () => {
    const form = STUDIO_FORMS['label-designer'];
    let checked = 0;
    for (const template of LABEL_TEMPLATES) {
      for (const symbology of template.symbologies) {
        const input = example('label-designer', [['template', template.id], ['symbology', symbology]]);
        expect(input.template, `${template.id}/${symbology}`).toBe(template.id);
        expect(input.symbology, `${template.id}/${symbology}`).toBe(symbology);
        const result = await run('label-designer', input);
        // What a scanner should report is what the form holds. UPC-A is read as the 13-digit
        // number it is a subset of, with a leading zero.
        const expected = (template.id === 'part-serial' ? [String(input.part), String(input.code)] : [String(input[template.codeField ?? 'code'])]).map((value) => (symbology === 'upca' ? `0${value}` : value));
        const found = await readPage(pdfOf(result), 0);
        expect(texts(found), `${template.id}/${symbology}`).toEqual([...expected].sort());
        checked += 1;
      }
    }
    // 4 + 5 + 3 + 2 + 3 offered pairings; the address label has no barcode.
    expect(checked).toBe(17);
    expect(visibleStudioFields(form, form.sections[1] as StudioForm['sections'][number], { ...studioDefaults(form), template: 'address-label' }).map((field) => field.name)).not.toContain('symbology');
  });

  it('numbers a sheet of labels, each in its own position', async () => {
    const sheet = labelSheet('a4-3x7-63x38') as SheetLayout;
    const result = await run('label-designer', { template: 'asset-tag', stock: sheet.id, heading: 'Property of CloudHost247', code: 'CH-000123', detail: 'IT Department', copies: 21, numbering: true });
    expect(fact(result, 'Labels')).toBe('21 on 1 sheet');
    expect(result.notices).toContain('Labels are numbered from CH-000123 to CH-000143.');
    // Every label carries a different number, so the fact says which label it describes.
    expect(fact(result, 'Barcode on the first label')).toBe('Code 128, 0.33 mm module, encodes “CH-000123”');
    const pdf = pdfOf(result);
    expect(pdf.pages).toHaveLength(1);
    const page = pageOf(pdf, 0);
    expect(page.placements).toHaveLength(21);
    // Read each position on its own: label k of the sheet carries the k-th number.
    for (let position = 0; position < 21; position += 1) {
      const box = { x: sheet.marginLeft + (position % 3) * sheet.pitchX, y: sheet.marginTop + Math.floor(position / 3) * sheet.pitchY, w: sheet.labelWidth, h: sheet.labelHeight };
      expect(page.placements[position]?.x, `position ${position + 1}`).toBeCloseTo(box.x, 2);
      expect(page.placements[position]?.y, `position ${position + 1}`).toBeCloseTo(box.y, 2);
      const found = await read(crop(page.ops, box), box.w, box.h);
      expect(found, `position ${position + 1}`).toEqual([{ format: 'Code128', text: `CH-${String(123 + position).padStart(6, '0')}` }]);
    }
    // The printed number is real text in the file, so the PDF can be searched.
    expect(page.texts.map((entry) => entry.text)).toContain('CH-000143');
  });

  it('starts at a chosen position on a part-used sheet and can print position outlines', async () => {
    const base = { template: 'asset-tag', stock: 'a4-3x7-63x38', code: 'CH-000123', copies: 30, numbering: true, startPosition: 20 };
    const result = await run('label-designer', base);
    expect(fact(result, 'Labels')).toBe('30 on 3 sheets');
    const pdf = pdfOf(result);
    expect(pdf.pages.map((_, index) => pageOf(pdf, index).placements.length)).toEqual([2, 21, 7]);
    const first = pageOf(pdf, 0);
    expect(first.placements[0]?.x).toBeCloseTo(7.2 + 66, 2);
    expect(first.placements[0]?.y).toBeCloseTo(15.15 + 6 * 38.1, 2);
    expect(texts(await readPage(pdf, 0))).toEqual(['CH-000123', 'CH-000124']);
    expect(result.previews.map((preview) => preview.title)).toEqual(['First label', 'Sheet 1 of 3']);

    const outlined = await run('label-designer', { ...base, outlines: true });
    expect(outlined.notices.join(' ')).toContain('Position outlines are printed.');
    const strokes = (page: ReplayedPage): number => page.ops.filter((op) => op.kind === 'line').length;
    // Twenty-one positions, four sides each.
    expect(strokes(pageOf(pdfOf(outlined), 0)) - strokes(first)).toBe(21 * 4);
  });

  it('prints one exact-size page per label for a label printer, at a stock or a custom size', async () => {
    const roll = await run('label-designer', { template: 'shelf-label', stock: 'roll-57x32', code: 'A-12-03', detail: 'Aisle A, bay 12, level 3', copies: 3, numbering: true });
    const pdf = pdfOf(roll);
    expect(pdf.pages.map((page) => [Math.round(page.widthMm * 10) / 10, Math.round(page.heightMm * 10) / 10])).toEqual([[57, 32], [57, 32], [57, 32]]);
    expect(fact(roll, 'Labels')).toBe('3');
    for (const [index, expected] of ['A-12-03', 'A-12-04', 'A-12-05'].entries()) expect(await readPage(pdf, index)).toEqual([{ format: 'Code128', text: expected }]);
    expect(roll.notices.join(' ')).toContain('Each PDF page is exactly one label.');

    const custom = await run('label-designer', { template: 'qr-label', stock: CUSTOM_STOCK_ID, widthMm: '45,5', heightMm: 30, content: 'https://cloudhost247.com/tools', heading: 'Scan me' });
    expect(pdfOf(custom).pages[0]?.widthMm).toBeCloseTo(45.5, 2);
    expect(pdfOf(custom).pages[0]?.heightMm).toBeCloseTo(30, 2);
    expect(fact(custom, 'Stock')).toBe('Custom label · 45.5 × 30 mm');
    expect(await readPage(pdfOf(custom), 0)).toEqual([{ format: 'QRCode', text: 'https://cloudhost247.com/tools' }]);
  });

  it('states what the barcode carries, check digit included', async () => {
    const result = await run('label-designer', { template: 'product-label', stock: 'roll-57x32', name: 'Arabica Coffee Beans', code: '952012345678', symbology: 'ean13' });
    expect(fact(result, 'Barcode')).toMatch(/^EAN-13, 0\.\d+ mm module, encodes “9520123456788”$/);
    expect(await readPage(pdfOf(result), 0)).toEqual([{ format: 'EAN13', text: '9520123456788' }]);
  });

  it('puts a product barcode where it scans best: beside the price, or under it on a narrow label', async () => {
    const template = labelTemplate('product-label');
    if (!template) throw new Error('The product label template is missing.');
    const values = { name: 'Arabica Coffee Beans', detail: 'Medium roast · 500 g', price: 'NGN 4,500', code: '9520123456788' };
    const layout = (width: number, height: number, symbology: string, fields: Record<string, string> = values) => {
      const artwork = drawLabel(template, fields, width, height, { symbology, border: false });
      const code = artwork.symbols[0];
      if (!code) throw new Error('The label has no barcode.');
      const price = artwork.surface.ops.find((op) => op.kind === 'text' && op.text === fields.price);
      if (fields.price && (!price || price.kind !== 'text')) throw new Error('The label has no price.');
      // The price is set from its right-hand end, so its left edge is that less its width.
      if (price && price.kind === 'text') expect(price.anchor).toBe('end');
      const priceLeft = price && price.kind === 'text' ? price.x - measureText(price.text, price.size, fontFor('sans', '700')) : 0;
      const priceBaseline = price && price.kind === 'text' ? price.y : 0;
      return { artwork, code, priceLeft, priceBaseline, under: price !== undefined && priceBaseline <= code.box.y + 0.01 };
    };

    // On the default 63.5 × 38.1 mm label the price sits to the right of the barcode, on its row.
    const roomy = layout(63.5, 38.1, 'ean13');
    expect(roomy.priceLeft).toBeGreaterThan(roomy.code.box.x + roomy.code.box.w);
    expect(roomy.priceBaseline).toBeGreaterThan(roomy.code.box.y);
    expect(roomy.priceBaseline).toBeLessThan(roomy.code.box.y + roomy.code.box.h);

    // An EAN-13 has a fixed number of bars. On a 51 mm label it still fits beside the price, at
    // no less than 80% magnification, the smallest size GS1 allows for retail scanning.
    const narrower = layout(51, 25, 'ean13');
    expect(narrower.priceLeft).toBeGreaterThan(narrower.code.box.x + narrower.code.box.w);
    expect(narrower.code.moduleMm).toBeGreaterThanOrEqual(0.264);

    // At 38 mm it cannot share the row, so the price moves to a line of its own above the barcode
    // and the barcode takes the width of the label.
    const narrow = layout(38, 25, 'ean13');
    expect(narrow.priceBaseline).toBeLessThanOrEqual(narrow.code.box.y);
    expect(narrow.code.box.w).toBeGreaterThan(38 * 0.8);
    expect(narrow.code.moduleMm).toBeGreaterThanOrEqual(0.264);
    expect(narrow.artwork.notices).toEqual([]);

    // The same move is made when sharing the row would leave bars too fine to print with
    // confidence: thirteen digits of Code 128 on a 51 mm label get 0.33 mm bars under the price
    // where the shared row would have needed the caution about fine bars.
    const fine = layout(51, 25, 'code128');
    expect(fine.priceBaseline).toBeLessThanOrEqual(fine.code.box.y);
    expect(fine.code.moduleMm).toBeCloseTo(0.33, 3);
    expect(fine.artwork.notices).toEqual([]);

    // Without a price the barcode is centred on the label.
    const unpriced = layout(51, 25, 'ean13', { ...values, price: '' });
    expect(unpriced.code.box.x + unpriced.code.box.w / 2).toBeCloseTo(51 / 2, 1);

    // From the smallest label the template accepts upwards, every barcode type it offers prints
    // and reads, on a laser printer and on a 203 dpi label printer, unless the label says to use
    // a finer printer. Nothing overlaps the barcode's quiet zone or leaves the label.
    const placements = { beside: 0, under: 0 };
    for (const symbology of template.symbologies) {
      const sample = symbology === 'ean8' ? '9520000' : symbology === 'upca' ? '01234500005' : values.code;
      for (let width = template.minWidth; width <= 70; width += 4) {
        const where = `${symbology} on ${width} × ${template.minHeight} mm`;
        const result = await run('label-designer', { template: 'product-label', stock: 'custom', widthMm: width, heightMm: template.minHeight, ...values, code: sample, symbology });
        const pdf = pdfOf(result);
        const cautioned = result.notices.some((notice) => notice.includes('Print at 300 dpi or finer'));
        expect(await readPage(pdf, 0, 300), where).toHaveLength(1);
        if (!cautioned) expect(await readPage(pdf, 0, 203), `${where} at 203 dpi`).toHaveLength(1);
        const drawn = layout(width, template.minHeight, symbology, { ...values, code: sample });
        const { box } = drawn.code;
        expect(box.x, where).toBeGreaterThanOrEqual(0);
        expect(box.x + box.w, where).toBeLessThanOrEqual(width + 0.01);
        expect(box.y + box.h, where).toBeLessThanOrEqual(template.minHeight + 0.01);
        // The price is clear of the barcode: either right of it or above it.
        expect(drawn.priceLeft >= box.x + box.w - 0.01 || drawn.under, where).toBe(true);
        placements[drawn.under ? 'under' : 'beside'] += 1;
        if (['ean13', 'upca', 'ean8'].includes(symbology)) expect(drawn.code.moduleMm, where).toBeGreaterThanOrEqual(0.264);
      }
    }
    // Both placements occur across these sizes, so both were checked.
    expect(placements.beside).toBeGreaterThan(5);
    expect(placements.under).toBeGreaterThan(5);
  });

  it('advises a shorter value only where a shorter value would make the barcode smaller', () => {
    const attempt = (symbology: string, data: string, w: number, h: number): BarcodeError => {
      const canvas = new LabelCanvas(100, 60);
      try {
        canvas.symbol({ symbology, data, what: 'The barcode', showText: true }, { x: 0, y: 0, w, h });
      } catch (error) {
        if (error instanceof BarcodeError) {
          // A refused symbol leaves nothing behind on the label.
          expect(canvas.symbols).toEqual([]);
          expect(canvas.finish().surface.ops).toEqual([]);
          return error;
        }
        throw error;
      }
      throw new Error(`${symbology} was expected not to fit ${w} × ${h} mm.`);
    };
    // These carry a fixed number of digits, so the only remedies are a larger label or another type.
    for (const [symbology, data] of [['ean13', '9520123456788'], ['ean13', '952012345678'], ['upca', '012345000058'], ['ean8', '95200002'], ['itf14', '09521234543213'], ['sscc18', '(00)095287654321012346']] as const) {
      const error = attempt(symbology, data, 12, 20);
      expect(error.reason, symbology).toBe('size');
      expect(error.message, symbology).toMatch(/Use a larger label or a more compact barcode type\.$/);
      expect(error.message, symbology).not.toContain(data);
    }
    // These grow with their content, and say so.
    for (const [symbology, data] of [['code128', 'CH247-000123-LONG-VALUE'], ['code39', 'PART-1234'], ['codabar', 'A0123456789B'], ['itf', '2401234567'], ['qrcode', 'https://cloudhost247.com/tools/a-long-address-that-needs-many-modules']] as const) {
      const error = attempt(symbology, data, 5, 5);
      expect(error.reason, symbology).toBe('size');
      expect(error.message, symbology).toMatch(/Use a larger label, a shorter value or a more compact barcode type\.$/);
    }
    // The figures in the message are the ones a ruler would give: an EAN-13 at 80% magnification.
    expect(attempt('ean13', '9520123456788', 25, 20).message).toBe(
      'The barcode does not fit: at the narrowest bar this label allows (0.26 mm) it is 30.62 mm wide with its quiet zone, and the label has 25 mm for it. Use a larger label or a more compact barcode type.'
    );
    // Too little height is a different shortfall with a different remedy.
    expect(attempt('ean13', '9520123456788', 60, 6).message).toBe('The barcode does not fit: this label leaves 2.78 mm for bars that need at least 8 mm. Use a taller label or put less text on it.');
  });

  it('measures a barcode for a place without drawing it, and draws it at the size measured', () => {
    for (const [symbology, data, w, h] of [['code128', 'CH-000123', 30, 12], ['ean13', '9520123456788', 34, 18], ['qrcode', 'https://cloudhost247.com', 14, 14], ['code39', 'PART-1', 60, 10]] as const) {
      const canvas = new LabelCanvas(80, 40);
      const spec = { symbology, data, what: 'The barcode', showText: symbology !== 'qrcode' };
      const measured = canvas.measureSymbol(spec, { x: 5, y: 5, w, h });
      expect(canvas.symbols, symbology).toEqual([]);
      expect(canvas.finish().surface.ops, symbology).toEqual([]);
      const placed = canvas.symbol(spec, { x: 5, y: 5, w, h });
      expect(placed.moduleMm, symbology).toBe(measured.moduleMm);
      expect(placed.box.x, symbology).toBeGreaterThanOrEqual(5 - 0.01);
      expect(placed.box.x + placed.box.w, symbology).toBeLessThanOrEqual(5 + w + 0.01);
      expect(placed.box.y + placed.box.h, symbology).toBeLessThanOrEqual(5 + h + 0.01);
      // The caution about fine bars is given exactly when the measurement says it is needed.
      expect(canvas.finish().notices.some((notice) => notice.includes('Print at 300 dpi or finer')), symbology).toBe(!measured.comfortable);
    }
    // Both outcomes are in the list above.
    const outcomes = [['code128', 'CH-000123', 30, 12], ['code39', 'PART-1', 60, 10]].map(([symbology, data, w, h]) =>
      new LabelCanvas(80, 40).measureSymbol({ symbology: String(symbology), data: String(data), what: 'The barcode' }, { x: 0, y: 0, w: Number(w), h: Number(h) }).comfortable
    );
    expect(outcomes).toEqual([false, true]);
  });

  it('draws a border on request and falls back, with a notice, from a barcode type the template lacks', async () => {
    const plain = await run('label-designer', { template: 'address-label', stock: 'roll-100x50', name: 'Amina Yusuf', address: '14 Ahmadu Bello Way\nJos 930001' });
    const bordered = await run('label-designer', { template: 'address-label', stock: 'roll-100x50', name: 'Amina Yusuf', address: '14 Ahmadu Bello Way\nJos 930001', border: true });
    const strokes = (result: StudioResult): number => pageOf(pdfOf(result), 0).ops.filter((op) => op.kind === 'line').length;
    expect(strokes(bordered) - strokes(plain)).toBe(4);
    expect(pageOf(pdfOf(plain), 0).texts.map((entry) => entry.text)).toEqual(expect.arrayContaining(['Amina Yusuf', '14 Ahmadu Bello Way', 'Jos 930001']));
    expect(plain.facts.map((entry) => entry.label)).not.toContain('Barcode');

    const swapped = await run('label-designer', { template: 'part-serial', stock: 'roll-100x50', part: 'PN-4471', code: 'SN-0001', symbology: 'qrcode' });
    expect(swapped.notices).toContain(`The “${labelTemplate('part-serial')?.name}” template does not offer QR Code, so Code 128 was used.`);
    expect(texts(await readPage(pdfOf(swapped), 0))).toEqual(['PN-4471', 'SN-0001']);
  });

  it('says so when the built-in fonts cannot print a character, and still encodes it', async () => {
    const result = await run('label-designer', { template: 'qr-label', stock: 'roll-76x51', content: 'Ọláyínká Adéwálé · ₦5,000', heading: 'Ọláyínká Adéwálé', text: 'Chị Ngọc' });
    expect(result.notices.join(' ')).toMatch(/built-in fonts/);
    expect(result.notices.join(' ')).toContain('Barcodes and QR codes still carry the original value.');
    expect(await readPage(pdfOf(result), 0)).toEqual([{ format: 'QRCode', text: 'Ọláyínká Adéwálé · ₦5,000' }]);
    // Western European text needs no notice.
    const latin = await run('label-designer', { template: 'qr-label', stock: 'roll-76x51', content: 'https://cloudhost247.com', heading: 'Café Müller – Größe 42 €' });
    expect(latin.notices.join(' ')).not.toMatch(/built-in fonts/);
  });

  it('refuses a label it cannot draw truthfully, with the reason and without the content', async () => {
    const secret = 'SECRET-7781';
    const small = await refusal('label-designer', { template: 'address-label', stock: 'roll-38x19', name: secret, address: secret });
    expect(small.detail.reason).toBe('LABEL_TOO_SMALL');
    expect(small.message).toBe('The “Address label” template needs a label of at least 50 × 25 mm; this one is 38 × 19 mm.');

    // Code 39 needs 16 modules a character. At the narrowest bar offered this value is wider than the label.
    const wide = await refusal('label-designer', { template: 'asset-tag', stock: 'roll-38x19', code: 'CH-000123', symbology: 'code39' });
    expect(wide.detail.reason).toBe('size');
    const sizes = /it is ([\d.]+) mm wide with its quiet zone, and the label has ([\d.]+) mm for it/.exec(wide.message);
    expect(sizes, wide.message).not.toBeNull();
    expect(Number(sizes?.[1])).toBeGreaterThan(Number(sizes?.[2]));
    expect(wide.message).toContain('Use a larger label, a shorter value or a more compact barcode type.');
    // A shorter value fits the same label.
    expect(await readPage(pdfOf(await run('label-designer', { template: 'asset-tag', stock: 'roll-38x19', code: 'A-1001', symbology: 'code39' })), 0)).toEqual([{ format: 'Code39', text: 'A-1001' }]);

    expect((await refusal('label-designer', { template: 'asset-tag', stock: 'a4-1x2-210x148', code: 'CH-1', copies: 300 })).detail.reason).toBe('TOO_MANY_PAGES');
    expect((await refusal('label-designer', { template: 'asset-tag', code: 'LAPTOP', copies: 3, numbering: true })).message).toBe('To number the labels, the value must contain a number to count from, for example CH-000123.');
    expect((await refusal('label-designer', { template: 'asset-tag' })).message).toBe('Asset number is required.');
    expect((await refusal('label-designer', { template: 'asset-tag', stock: CUSTOM_STOCK_ID, code: secret })).message).toBe('Enter the width and height of your label in millimetres.');
    expect((await refusal('label-designer', { template: 'asset-tag', stock: CUSTOM_STOCK_ID, code: secret, widthMm: 500, heightMm: 20 })).message).toBe('Label width must be between 20 and 210.');
    expect((await refusal('label-designer', { template: 'no-such-template', code: secret })).message).toMatch(/^Template must be one of: /);
    expect((await refusal('label-designer', { template: 'asset-tag', code: secret, copies: 301 })).message).toBe('Number of labels must be between 1 and 300.');
    for (const input of [
      { template: 'address-label', stock: 'roll-38x19', name: secret, address: secret },
      { template: 'asset-tag', stock: 'roll-38x19', code: `${secret}-${secret}`, symbology: 'code39' },
      { template: 'product-label', name: secret, code: secret, symbology: 'ean13' },
    ]) {
      expect((await refusal('label-designer', input)).message).not.toContain(secret);
    }
  });
});

/* ------------------------------------------------------------------ */
/* VDA 4902                                                            */
/* ------------------------------------------------------------------ */

describe('VDA 4902 Label Generator', () => {
  it('prints all sixteen fields at A5 with a Code 39 barcode on each identifying field', async () => {
    const result = await run('vda-4902-label-generator', { ...VDA_INPUT });
    const pdf = pdfOf(result);
    expect(pdf.pages).toHaveLength(1);
    expect([pdf.pages[0]?.widthMm, pdf.pages[0]?.heightMm].map((value) => Math.round((value ?? 0) * 10) / 10)).toEqual([210, 148]);
    const found = await readPage(pdf, 0);
    expect(found.map((symbol) => symbol.format)).toEqual(Array.from({ length: 7 }, () => 'Code39'));
    expect(texts(found)).toEqual([...VDA_A5_BARCODES].sort());
    // The same label on a 203 dpi thermal printer.
    expect(texts(await readPage(pdf, 0, 203))).toEqual([...VDA_A5_BARCODES].sort());

    // Every field is captioned with its number, and every value is printed as text.
    const printed = pageOf(pdf, 0).texts.map((entry) => entry.text);
    for (let number = 1; number <= 16; number += 1) expect(printed.some((text) => text.startsWith(`(${number}) `)), `caption (${number})`).toBe(true);
    expect(printed).toEqual(expect.arrayContaining(['Example Automotive GmbH', 'Werk 2', '12345 Musterstadt', 'Tor 14 - LG 07 - M3', '12345678', 'A 123 456 78 90', '1200', 'Bracket, left, zinc plated', 'PC-48213-B', '123456789', 'D 2026-11-11', '03', '100200301', 'CH2611A', '450 kg', '480 kg', '12']));

    expect(fact(result, 'Barcodes')).toMatch(/^7 × Code 39, narrow bar 0\.\d+ mm or wider$/);
    expect(fact(result, 'Field 8 encodes')).toBe('PA 123 456 78 90');
    expect(fact(result, 'Field 15 encodes')).toBe('S100200301');
    expect(result.notices[0]).toContain('It is not certified by the VDA.');
  });

  it('prints the KLT format with five barcodes and says which two fields became text', async () => {
    const result = await run('vda-4902-label-generator', { ...VDA_INPUT, format: 'klt' });
    const pdf = pdfOf(result);
    expect([pdf.pages[0]?.widthMm, pdf.pages[0]?.heightMm].map((value) => Math.round((value ?? 0) * 10) / 10)).toEqual([210, 74]);
    expect(texts(await readPage(pdf, 0))).toEqual([...VDA_KLT_BARCODES].sort());
    expect(result.notices.join(' ')).toContain('On the KLT format the delivery note number (3) and the supplier part number (11) are printed as text');
    const printed = pageOf(pdf, 0).texts.map((entry) => entry.text);
    expect(printed).toEqual(expect.arrayContaining(['12345678', 'PC-48213-B']));
  });

  it('encodes the package number under the identifier for what the label is attached to', async () => {
    for (const [labelType, expected] of [['S', 'S100200301'], ['M', 'M100200301'], ['G', 'G100200301']] as const) {
      const result = await run('vda-4902-label-generator', { ...VDA_INPUT, format: 'klt', labelType });
      expect(texts(await readPage(pdfOf(result), 0)), labelType).toContain(expected);
      expect(fact(result, 'Field 15 encodes')).toBe(expected);
    }
  });

  it('captions the label in the language chosen', async () => {
    const captions = async (language: string): Promise<string[]> => pageOf(pdfOf(await run('vda-4902-label-generator', { ...VDA_INPUT, language })), 0).texts.map((entry) => entry.text);
    expect(await captions('en')).toEqual(expect.arrayContaining(['(9) Quantity (Q)', '(12) Supplier no. (V)']));
    // Umlauts are in the standard fonts' character set and reach the page as themselves.
    expect(await captions('de')).toEqual(expect.arrayContaining(['(9) Füllmenge (Q)', '(12) Lieferanten-Nr. (V)', '(15) Packstück-Nr. (S)']));
    expect((await run('vda-4902-label-generator', { ...VDA_INPUT, language: 'fr' })).notices.join(' ')).toContain('CloudHost247 translations of the German field names');
    expect((await run('vda-4902-label-generator', { ...VDA_INPUT, language: 'de' })).notices.join(' ')).not.toContain('translations');
  });

  it('numbers the packages of a delivery and lays them out on A4 sheets on request', async () => {
    const single = await run('vda-4902-label-generator', { ...VDA_INPUT, copies: 3 });
    expect(single.notices).toContain('Package numbers run from 100200301 to 100200303.');
    const pages = pdfOf(single);
    expect(pages.pages).toHaveLength(3);
    for (const [index, expected] of ['S100200301', 'S100200302', 'S100200303'].entries()) expect(texts(await readPage(pages, index))).toContain(expected);

    const sheets = await run('vda-4902-label-generator', { ...VDA_INPUT, format: 'klt', labelType: 'G', copies: 5, sheet: true });
    expect(fact(sheets, 'Labels')).toBe('5 on 2 A4 sheets');
    const pdf = pdfOf(sheets);
    // Four KLT labels of 74 mm fit the 297 mm page; each is centred in its 74.25 mm position.
    expect(pdf.pages.map((_, index) => pageOf(pdf, index).placements.length)).toEqual([4, 1]);
    expect(pageOf(pdf, 0).placements.map((placement) => Math.round(placement.y * 1000) / 1000)).toEqual([0.125, 74.375, 148.625, 222.875]);
    const onFirst = texts(await readPage(pdf, 0));
    for (const expected of ['G100200301', 'G100200302', 'G100200303', 'G100200304']) expect(onFirst).toContain(expected);
    expect(texts(await readPage(pdf, 1))).toContain('G100200305');

    const same = await run('vda-4902-label-generator', { ...VDA_INPUT, copies: 2, numbering: false });
    expect(same.notices.join(' ')).not.toContain('Package numbers run');
    expect(texts(await readPage(pdfOf(same), 1))).toContain('S100200301');

    // Counting past 999999999 adds a digit, so the later labels have a wider barcode and narrower
    // bars than the first. What the result states is true of every label, not only the first.
    const alone = await run('vda-4902-label-generator', { ...VDA_INPUT, format: 'klt', packageNumber: '999999999' });
    expect(fact(alone, 'Barcodes')).toBe('5 × Code 39, narrow bar 0.32 mm or wider');
    const counted = await run('vda-4902-label-generator', { ...VDA_INPUT, format: 'klt', packageNumber: '999999999', copies: 3 });
    expect(fact(counted, 'Barcodes')).toBe('5 × Code 39, narrow bar 0.29 mm or wider');
    expect(counted.notices).toContain('Package numbers run from 999999999 to 1000000001.');
    expect(counted.notices).toContain('The narrowest bars on these labels are 0.29 mm wide because a value is long for its field. Confirm that your customer accepts that width, or shorten the value.');
    const countedPdf = pdfOf(counted);
    for (const [index, expected] of ['S999999999', 'S1000000000', 'S1000000001'].entries()) expect(texts(await readPage(countedPdf, index))).toContain(expected);
  });

  it('reports fields a plant will expect that were left empty, and never invents them', async () => {
    const result = await run('vda-4902-label-generator', { partNumber: 'a 123', quantity: '5', packageNumber: '77' });
    expect(result.notices.join(' ')).toContain('Left empty: (1) receiver (short address), (2) unloading point, storage location, usage code, (3) delivery note number');
    // Lower case is folded to the capitals Code 39 carries.
    expect(texts(await readPage(pdfOf(result), 0))).toEqual(['PA 123', 'Q5', 'S77']);
  });

  it('refuses values Code 39 cannot carry and requests outside its limits', async () => {
    const secret = 'SECRET_7781';
    const characters = await refusal('vda-4902-label-generator', { ...VDA_INPUT, partNumber: secret });
    expect(characters.message).toBe('Customer part number is printed as a Code 39 barcode, which carries digits, capital letters, spaces and - . $ / + % only.');
    expect((await refusal('vda-4902-label-generator', { ...VDA_INPUT, partNumber: '' })).message).toBe('Customer part number is required.');
    expect((await refusal('vda-4902-label-generator', { ...VDA_INPUT, packageNumber: 'ABC', copies: 2 })).message).toBe('To number the labels, the package number must contain a number to count from.');
    expect((await refusal('vda-4902-label-generator', { ...VDA_INPUT, copies: 100, sheet: true })).detail.reason).toBe('TOO_MANY_PAGES');
    expect((await refusal('vda-4902-label-generator', { ...VDA_INPUT, copies: 101 })).message).toBe('Number of labels must be between 1 and 100.');
    expect((await refusal('vda-4902-label-generator', { ...VDA_INPUT, quantity: '1'.repeat(13) })).message).toBe('Quantity is limited to 12 characters.');
  });

  it('never prints a bar narrower than 0.25 mm: a value too long for its field is refused or flagged', async () => {
    // Every barcode field, at every length it accepts, in the widest character Code 39 has.
    const barcodeFields = VDA_FIELDS.filter((field) => field.identifier !== undefined);
    expect(barcodeFields.map((field) => field.number)).toEqual([3, 8, 9, 11, 12, 15, 16]);
    const outcomes = { full: 0, narrowed: 0, refused: 0 };
    const refusedAt: string[] = [];
    const longestDrawn = new Map<string, number>();
    for (const format of ['a5', 'klt'] as const) {
      for (const field of barcodeFields) {
        for (let length = 1; length <= field.maxLength; length += 1) {
          const where = `${format} field ${field.number} × ${length}`;
          const values = { ...VDA_INPUT, [field.name]: 'W'.repeat(length) };
          try {
            const artwork = drawVdaLabel(format, 'en', 'S', values);
            // The exact module width of every barcode on the label, not the rounded figure shown.
            for (const barcode of artwork.barcodes) expect(barcode.moduleMm, `${where}, field ${barcode.field}`).toBeGreaterThanOrEqual(0.25);
            const own = artwork.barcodes.find((barcode) => barcode.field === field.number);
            if (own) {
              expect(own.data, where).toBe(`${field.number === 15 ? 'S' : field.identifier}${'W'.repeat(length)}`);
              outcomes[own.moduleMm < 0.38 - 1e-9 ? 'narrowed' : 'full'] += 1;
              longestDrawn.set(`${format}/${field.name}`, length);
            }
          } catch (error) {
            expect(error, where).toBeInstanceOf(BarcodeError);
            expect((error as BarcodeError).reason, where).toBe('size');
            outcomes.refused += 1;
            refusedAt.push(where);
            // On the KLT format the remedy offered is the A5 format, so A5 must take the value.
            if (format === 'klt') expect(() => drawVdaLabel('a5', 'en', 'S', values), where).not.toThrow();
          }
        }
      }
    }
    // All three outcomes occur, so each branch above was exercised.
    expect(outcomes.full).toBeGreaterThan(100);
    expect(outcomes.narrowed).toBeGreaterThan(10);
    // Exactly the two fields whose barcode can outgrow its cell: the supplier part number at A5
    // (three identifier characters and a narrow cell) and the batch number on the KLT format.
    expect(refusedAt).toEqual(['a5 field 11 × 19', 'a5 field 11 × 20', 'a5 field 11 × 21', 'a5 field 11 × 22', 'klt field 16 × 13', 'klt field 16 × 14', 'klt field 16 × 15', 'klt field 16 × 16', 'klt field 16 × 17']);

    // The longest value each field takes still reads from the printed page, at the finest bars used.
    for (const [key, length] of longestDrawn) {
      const [format, name] = key.split('/') as [string, string];
      const field = barcodeFields.find((entry) => entry.name === name);
      const result = await run('vda-4902-label-generator', { ...VDA_INPUT, format, [name]: 'W'.repeat(length) });
      expect(texts(await readPage(pdfOf(result), 0)), key).toContain(`${field?.number === 15 ? 'S' : field?.identifier}${'W'.repeat(length)}`);
      const narrow = Number(/narrow bar ([\d.]+) mm or wider/.exec(fact(result, 'Barcodes'))?.[1]);
      // Bars under 0.3 mm are printed, and the result says the customer should agree to them.
      expect(result.notices.some((notice) => notice.includes('Confirm that your customer accepts that width')), key).toBe(narrow < 0.3);
    }

    // The refusal names the field and what would fix it, gives the measurements, and leaves the value out.
    const a5 = await refusal('vda-4902-label-generator', { ...VDA_INPUT, supplierPartNumber: 'W'.repeat(19) });
    expect(a5.detail.reason).toBe('size');
    expect(a5.message).toBe(
      'The barcode for field 11 (supplier part number) does not fit: at the narrowest bar this label allows (0.25 mm) it is 100.75 mm wide with its quiet zone, and the label has 99.8 mm for it. Use a shorter value.'
    );
    const klt = await refusal('vda-4902-label-generator', { ...VDA_INPUT, format: 'klt', batchNumber: 'W'.repeat(13) });
    expect(klt.message).toBe(
      'The barcode for field 16 (batch number) does not fit: at the narrowest bar this label allows (0.25 mm) it is 68.75 mm wide with its quiet zone, and the label has 66.8 mm for it. Use a shorter value, or the A5 format, where this field is wider.'
    );
  });
});

/* ------------------------------------------------------------------ */
/* Shipping labels                                                     */
/* ------------------------------------------------------------------ */

describe('Shipping Label Generator', () => {
  it('prints sender, recipient and a reference barcode on a 4 × 6 inch label', async () => {
    const result = await run('shipping-label-generator', { ...SHIPPING_INPUT });
    const pdf = pdfOf(result);
    expect(pdf.pages).toHaveLength(1);
    expect(pdf.pages[0]?.widthMm).toBeCloseTo(101.6, 2);
    expect(pdf.pages[0]?.heightMm).toBeCloseTo(152.4, 2);
    expect(await readPage(pdf, 0)).toEqual([{ format: 'Code128', text: 'ORD-2026-001542' }]);
    // 203 dpi is what most thermal label printers are.
    expect(await readPage(pdf, 0, 203)).toEqual([{ format: 'Code128', text: 'ORD-2026-001542' }]);
    const printed = pageOf(pdf, 0).texts.map((entry) => entry.text);
    expect(printed).toEqual(expect.arrayContaining(['CloudHost247 Fulfilment', '2 Marina Road', 'Amina Yusuf', 'Plateau Components Ltd', '14 Ahmadu Bello Way', 'Suite 5', '1 of 1', 'ORD-2026-001542']));
    expect(printed.join(' ')).toContain('NIGERIA');
    expect(result.notices[0]).toBe('This is a carrier-neutral label. It does not replace a label issued by a carrier for a booked shipment, and it carries no carrier routing code.');
    expect(fact(result, 'Reference barcode')).toBe('Code 128, 0.4 mm module, encodes “ORD-2026-001542”');
  });

  it('gives every package its own label, numbered, with the package number in the barcode on request', async () => {
    const result = await run('shipping-label-generator', { ...SHIPPING_INPUT, packages: 3, barcode: 'reference-package' });
    const pdf = pdfOf(result);
    expect(pdf.pages).toHaveLength(3);
    for (let index = 0; index < 3; index += 1) {
      expect(await readPage(pdf, index)).toEqual([{ format: 'Code128', text: `ORD-2026-001542-${index + 1}` }]);
      expect(pageOf(pdf, index).texts.map((entry) => entry.text)).toContain(`${index + 1} of 3`);
    }
    expect(result.count).toBe(3);
    expect(result.files[0]?.label).toBe('Download PDF (3 labels)');
    // The barcode differs from package to package, so the fact says which one it describes.
    expect(fact(result, 'Reference barcode on package 1')).toBe('Code 128, 0.4 mm module, encodes “ORD-2026-001542-1”');
    // The same reference on every package needs no such qualifier.
    expect(fact(await run('shipping-label-generator', { ...SHIPPING_INPUT, packages: 3 }), 'Reference barcode')).toBe('Code 128, 0.4 mm module, encodes “ORD-2026-001542”');
  });

  it('prints a GS1-128 SSCC with a calculated check digit, the next serial on each package', async () => {
    const result = await run('shipping-label-generator', { ...SHIPPING_INPUT, barcode: 'sscc', sscc: '09528765432101234', packages: 3 });
    const pdf = pdfOf(result);
    // The reader reports the application identifier (00) in brackets, which shows the symbol opens
    // with FNC1: it is GS1-128, not a plain Code 128 of the same digits.
    for (const [index, sscc] of ['095287654321012346', '095287654321012353', '095287654321012360'].entries()) {
      expect(await readPage(pdf, index)).toEqual([{ format: 'Code128', text: `(00)${sscc}` }]);
      expect(pageOf(pdf, index).texts.map((entry) => entry.text)).toContain(`(00) ${sscc}`);
    }
    expect(fact(result, 'SSCC range')).toBe('095287654321012346 to 095287654321012360');
    expect(fact(result, 'SSCC barcode on package 1')).toBe('SSCC-18, 0.5 mm module, encodes “(00)095287654321012346”');
    expect(result.notices.join(' ')).toContain('Use a serial range you have allocated under your own GS1 company prefix');
    // All 18 digits are accepted when the last one is right, and refused with the right one when it is not.
    expect(await readPage(pdfOf(await run('shipping-label-generator', { ...SHIPPING_INPUT, barcode: 'sscc', sscc: '(00) 106141411234567897' })), 0)).toEqual([{ format: 'Code128', text: '(00)106141411234567897' }]);
    expect((await refusal('shipping-label-generator', { ...SHIPPING_INPUT, barcode: 'sscc', sscc: '106141411234567890' })).message).toBe('The SSCC check digit is wrong: the last digit should be 7. Enter the first 17 digits to have it calculated.');
    expect((await refusal('shipping-label-generator', { ...SHIPPING_INPUT, barcode: 'sscc', sscc: '12345' })).message).toBe('An SSCC has 18 digits. Enter all 18, or the first 17 to have the check digit calculated.');
    expect((await refusal('shipping-label-generator', { ...SHIPPING_INPUT, barcode: 'sscc' })).message).toBe('SSCC is required.');
    expect((await refusal('shipping-label-generator', { ...SHIPPING_INPUT, barcode: 'sscc', sscc: '99999999999999999', packages: 2 })).message).toBe('The SSCC serial number runs out before the last package. Start from a lower number.');
  });

  it('adds a postal code barcode for the sender’s own sorting and says what it is not', async () => {
    const result = await run('shipping-label-generator', { ...SHIPPING_INPUT, postcodeBarcode: true });
    expect(texts(await readPage(pdfOf(result), 0))).toEqual(['930001', 'ORD-2026-001542']);
    expect(result.notices.join(' ')).toContain('It is not a postal operator’s routing barcode.');
    // Two barcodes of one type on the label: each fact says which it is.
    expect(fact(result, 'Postal code barcode')).toBe('Code 128, 0.4 mm module, encodes “930001”');
    expect(fact(result, 'Reference barcode')).toBe('Code 128, 0.4 mm module, encodes “ORD-2026-001542”');
    expect(new Set(result.facts.map((entry) => entry.label)).size).toBe(result.facts.length);
    const none = await run('shipping-label-generator', { ...SHIPPING_INPUT, barcode: 'none' });
    expect(await readPage(pdfOf(none), 0)).toEqual([]);
  });

  it('prints each label size at its true size, alone or on the sheets that hold it', async () => {
    for (const size of SHIPPING_SIZES) {
      const alone = pdfOf(await run('shipping-label-generator', { ...SHIPPING_INPUT, size: size.id }));
      expect(alone.pages[0]?.widthMm, size.id).toBeCloseTo(size.width, 2);
      expect(alone.pages[0]?.heightMm, size.id).toBeCloseTo(size.height, 2);
      for (const paper of SHIPPING_SHEETS) {
        const input = { ...SHIPPING_INPUT, size: size.id, sheet: paper.id, packages: 3, barcode: 'reference-package' };
        if (shippingSheetsFor(size.id).includes(paper.id)) {
          const result = await run('shipping-label-generator', input);
          const pdf = pdfOf(result);
          const found = (await Promise.all(pdf.pages.map((_, index) => readPage(pdf, index)))).flat();
          expect(texts(found), `${size.id} on ${paper.id}`).toEqual(['ORD-2026-001542-1', 'ORD-2026-001542-2', 'ORD-2026-001542-3']);
        } else {
          // Never scaled to fit: the pairing is refused instead.
          expect((await refusal('shipping-label-generator', input)).detail.reason, `${size.id} on ${paper.id}`).toBe('LABEL_EXCEEDS_CELL');
        }
      }
    }
    // The pairings, worked out from the sheet measurements: 4 × 6 in and 100 × 150 mm labels fit
    // the two-up Letter sheet; A6 fits the four-up A4 sheet; no size fits the other sheet.
    expect(Object.fromEntries(SHIPPING_SIZES.map((size) => [size.id, shippingSheetsFor(size.id)]))).toEqual({
      '4x6': ['none', 'letter-2x1-4x6'],
      a6: ['none', 'a4-2x2-105x148'],
      '100x150': ['none', 'letter-2x1-4x6'],
    });
  });

  it('needs a recipient and something to encode, and keeps addresses out of its messages', async () => {
    const secret = 'SECRET-7781';
    expect((await refusal('shipping-label-generator', { ...SHIPPING_INPUT, toName: '' })).message).toBe('Recipient name is required.');
    expect((await refusal('shipping-label-generator', { ...SHIPPING_INPUT, reference: '' })).message).toBe('Enter a reference or order number to print as the barcode, or choose “No barcode”.');
    expect((await refusal('shipping-label-generator', { ...SHIPPING_INPUT, packages: 51 })).message).toBe('Number of packages must be between 1 and 50.');
    const long = await refusal('shipping-label-generator', { ...SHIPPING_INPUT, toAddress: `${secret}\n2\n3\n4` });
    expect(long.message).toBe('Street address is limited to 3 lines.');
    expect((await refusal('shipping-label-generator', { ...SHIPPING_INPUT, toName: `${secret}${'x'.repeat(60)}` })).message).not.toContain(secret);
  });
});

/* ------------------------------------------------------------------ */
/* QR code business cards                                              */
/* ------------------------------------------------------------------ */

describe('QR Code Business Cards', () => {
  it('prints a card whose code is the contact as a vCard, and returns the same contact as a file', async () => {
    const result = await run('qr-business-card-designer', { ...CARD_INPUT });
    const pdf = pdfOf(result);
    expect(pdf.pages).toHaveLength(1);
    expect([pdf.pages[0]?.widthMm, pdf.pages[0]?.heightMm].map((value) => Math.round((value ?? 0) * 10) / 10)).toEqual([85, 55]);
    expect(await readPage(pdf, 0)).toEqual([{ format: 'QRCode', text: CARD_VCARD }]);
    const printed = pageOf(pdf, 0).texts.map((entry) => entry.text);
    expect(printed).toEqual(expect.arrayContaining(['Amina Yusuf', 'Solutions Architect', 'CloudHost247', 'T  +234 803 555 0142', 'M  +234 809 555 0177', 'amina.yusuf@cloudhost247.com', 'cloudhost247.com']));

    expect(result.files.map((file) => [file.name, file.mime])).toEqual([
      ['business-card-amina-yusuf.pdf', 'application/pdf'],
      ['business-card-amina-yusuf-front.svg', 'image/svg+xml'],
      ['business-card-amina-yusuf.vcf', 'text/vcard'],
    ]);
    expect(Buffer.from(fileOf(result, 'text/vcard').base64, 'base64').toString('utf8')).toBe(`${CARD_VCARD}\r\n`);
    expect(fact(result, 'Contact format')).toBe(`vCard 3.0, ${Buffer.byteLength(CARD_VCARD, 'utf8')} bytes`);
    expect(result.notices).toContain('Scan the code with a phone before you print a batch.');
  });

  it('offers MeCard and Data Matrix, on every layout', async () => {
    for (const layout of ['classic', 'band', 'duplex']) {
      for (const [code, format] of [['qrcode', 'QRCode'], ['datamatrix', 'DataMatrix']] as const) {
        for (const [payload, expected] of [['vcard', CARD_VCARD], ['mecard', CARD_MECARD]] as const) {
          const result = await run('qr-business-card-designer', { ...CARD_INPUT, layout, code, payload });
          const pdf = pdfOf(result);
          const found = (await Promise.all(pdf.pages.map((_, index) => readPage(pdf, index)))).flat();
          expect(found, `${layout}/${code}/${payload}`).toEqual([{ format, text: expected }]);
          expect(pdf.pages.length, layout).toBe(layout === 'duplex' ? 2 : 1);
        }
      }
    }
  });

  it('puts the code on the back of a two-sided card and returns both sides', async () => {
    const result = await run('qr-business-card-designer', { ...CARD_INPUT, layout: 'duplex' });
    const pdf = pdfOf(result);
    expect(await readPage(pdf, 0)).toEqual([]);
    expect(await readPage(pdf, 1)).toEqual([{ format: 'QRCode', text: CARD_VCARD }]);
    expect(result.files.map((file) => file.name)).toEqual(['business-card-amina-yusuf.pdf', 'business-card-amina-yusuf-front.svg', 'business-card-amina-yusuf-back.svg', 'business-card-amina-yusuf.vcf']);
    expect(result.previews.map((preview) => preview.title)).toEqual(['Front', 'Back']);
    expect(result.notices).toContain('Page 1 is the front and page 2 is the back.');
  });

  it('lays cards out on a sheet at true size with cut marks outside the cards', async () => {
    const result = await run('qr-business-card-designer', { ...CARD_INPUT, sheet: 'a4' });
    expect(result.count).toBe(10);
    expect(fact(result, 'Sheet')).toContain('2 × 5: 10 cards');
    const pdf = pdfOf(result);
    const page = pageOf(pdf, 0);
    expect(page.placements).toHaveLength(10);
    // Two columns of 85 mm centred on 210 mm; five rows of 55 mm centred on 297 mm.
    expect(page.placements[0]?.x).toBeCloseTo(20, 3);
    expect(page.placements[0]?.y).toBeCloseTo(11, 3);
    expect(page.placements[9]?.x).toBeCloseTo(105, 3);
    expect(page.placements[9]?.y).toBeCloseTo(11 + 4 * 55, 3);
    expect(texts(await readPage(pdf, 0))).toEqual(Array.from({ length: 10 }, () => CARD_VCARD));
    // Cut marks: one pair at each end of every cut line (3 vertical + 6 horizontal lines... drawn
    // per card edge), and none of them inside the block of cards.
    const marks = page.ops.filter((op): op is Extract<StudioOp, { kind: 'line' }> => op.kind === 'line');
    expect(marks.length).toBe(2 * 2 * 2 + 5 * 2 * 2);
    for (const mark of marks) {
      const outside = (x: number, y: number): boolean => x < 20 - 1 || x > 190 + 1 || y < 11 - 1 || y > 286 + 1;
      expect(outside(mark.x1, mark.y1) && outside(mark.x2, mark.y2)).toBe(true);
    }

    // Letter paper is shorter: four rows of 85 × 55 mm cards, five of the shorter US size.
    expect((await run('qr-business-card-designer', { ...CARD_INPUT, sheet: 'letter' })).count).toBe(8);
    expect((await run('qr-business-card-designer', { ...CARD_INPUT, sheet: 'letter', size: 'us' })).count).toBe(10);
    const duplex = await run('qr-business-card-designer', { ...CARD_INPUT, sheet: 'a4', layout: 'duplex' });
    expect(pdfOf(duplex).pages).toHaveLength(2);
    expect(duplex.notices).toContain('Page 1 holds the fronts and page 2 the backs. Print double-sided, flipping on the long edge.');
  });

  it('never prints a code finer than 0.3 mm a module: longer details get a refusal with advice', async () => {
    const short = { ...emptyContact(), ...CARD_INPUT };
    const medium = { ...short, jobTitle: `Solutions Architect, ${'Cloud Platform '.repeat(2)}Team`, street: `14 Ahmadu Bello Way, ${'Suite 5, '.repeat(5)}Block C`, website: 'https://cloudhost247.com/team/solutions/amina-yusuf' };
    const long = {
      firstName: 'A'.repeat(40), lastName: 'B'.repeat(40), jobTitle: 'C'.repeat(60), organization: 'D'.repeat(60), email: `${'e'.repeat(60)}@example.com`,
      phone: '+234 803 555 0142 0000 0000 00', mobile: '+234 809 555 0177 0000 0000 00', website: `https://example.com/${'f'.repeat(58)}`,
      street: 'G'.repeat(80), city: 'H'.repeat(40), region: 'I'.repeat(40), postalCode: 'J'.repeat(16), country: 'K'.repeat(40),
    };
    let drawn = 0;
    let refused = 0;
    for (const contact of [short, medium, long]) {
      for (const layout of ['classic', 'band', 'duplex'] as const) {
        for (const symbology of ['qrcode', 'datamatrix'] as const) {
          for (const eclevel of ['L', 'M', 'Q', 'H']) {
            const where = `${contact.firstName.slice(0, 5)}/${layout}/${symbology}/${eclevel}`;
            try {
              const artwork = drawCard({ width: 85, height: 55, layout, accent: '#0f4c81', symbology, eclevel, payload: buildContactVCard(contact), contact });
              expect(artwork.code.moduleMm, where).toBeGreaterThanOrEqual(0.3);
              drawn += 1;
            } catch (error) {
              // The only way out other than a module of 0.3 mm or more is the size refusal.
              expect((error as { reason?: string }).reason, where).toBe('size');
              refused += 1;
            }
          }
        }
      }
    }
    // Both outcomes occur in the sweep, so both paths are exercised.
    expect(drawn).toBeGreaterThan(20);
    expect(refused).toBeGreaterThan(5);

    const dense = await refusal('qr-business-card-designer', { ...long, eclevel: 'H' });
    expect(dense.detail.reason).toBe('CODE_TOO_DENSE');
    expect(dense.message).toContain('Remove a field, choose MeCard or a lower error correction level, or use the two-sided layout');
    expect(dense.message).not.toContain('AAAA');
  });

  it('keeps the code black on white whatever accent colour is chosen', async () => {
    for (const accent of ['#0f4c81', '#f5d90a', '#111111', '#ffffff']) {
      for (const layout of ['band', 'duplex']) {
        const result = await run('qr-business-card-designer', { ...CARD_INPUT, layout, accent });
        const pdf = pdfOf(result);
        const found = (await Promise.all(pdf.pages.map((_, index) => readPage(pdf, index)))).flat();
        expect(found, `${layout} with ${accent}`).toEqual([{ format: 'QRCode', text: CARD_VCARD }]);
      }
    }
  });

  it('carries names with punctuation and accents through the code unchanged', async () => {
    const result = await run('qr-business-card-designer', { firstName: 'Ọláyínká', lastName: 'Adéwálé; Jr, PhD', organization: 'Okoro & Sons, Ltd', email: 'o.adewale@example.com' });
    const expected = ['BEGIN:VCARD', 'VERSION:3.0', 'N:Adéwálé\\; Jr\\, PhD;Ọláyínká;;;', 'FN:Ọláyínká Adéwálé\\; Jr\\, PhD', 'ORG:Okoro & Sons\\, Ltd', 'EMAIL;TYPE=INTERNET:o.adewale@example.com', 'END:VCARD'].join('\r\n');
    expect(await readPage(pdfOf(result), 0)).toEqual([{ format: 'QRCode', text: expected }]);
    expect(fileOf(result, 'application/pdf').name).toBe('business-card-olayinka-adewale-jr-phd.pdf');
    expect(result.notices.join(' ')).toMatch(/built-in fonts/);
  });

  it('needs a first name and a plausible email address', async () => {
    const secret = 'SECRET-not-an-email';
    expect((await refusal('qr-business-card-designer', { lastName: 'Yusuf' })).message).toBe('First name is required.');
    const email = await refusal('qr-business-card-designer', { firstName: 'Amina', email: secret });
    expect(email.message).toBe('Email does not look like an email address.');
    expect((await refusal('qr-business-card-designer', { firstName: 'Amina', accent: 'blue' })).message).toBe('Accent colour must be a colour such as #1a2b3c.');
    expect((await refusal('qr-business-card-designer', { firstName: 'Amina', size: 'a0' })).message).toMatch(/^Card size must be one of: /);
  });
});

/* ------------------------------------------------------------------ */
/* Forms                                                               */
/* ------------------------------------------------------------------ */

describe('forms', () => {
  it('describes each tool with fields that are named once, defaulted to something offered, and never duplicated', () => {
    expect(Object.keys(STUDIO_FORMS)).toEqual([...STUDIO_TOOL_SLUGS]);
    for (const slug of STUDIO_TOOL_SLUGS) {
      const form = STUDIO_FORMS[slug];
      expect(form.slug).toBe(slug);
      expect(form.intro.length, slug).toBeGreaterThan(40);
      const fields = studioFields(form);
      const names = fields.map((field) => field.name);
      expect(new Set(names).size, `${slug}: duplicate field name`).toBe(names.length);
      for (const field of fields) {
        expect(field.label.length, `${slug}.${field.name}`).toBeGreaterThan(0);
        if (field.type === 'select') {
          const values = (field.options ?? []).map((option) => option.value);
          expect(values.length, `${slug}.${field.name} options`).toBeGreaterThan(1);
          expect(new Set(values).size, `${slug}.${field.name} options`).toBe(values.length);
          expect(values, `${slug}.${field.name} default`).toContain(String(field.defaultValue));
          for (const [key, variant] of Object.entries(field.variants?.by ?? {})) {
            for (const allowed of variant.options ?? []) expect(values, `${slug}.${field.name} variant ${key}`).toContain(allowed);
            if (variant.defaultValue !== undefined && variant.options) expect(variant.options, `${slug}.${field.name} variant ${key} default`).toContain(variant.defaultValue);
          }
        }
        if (field.showWhen) expect(names, `${slug}.${field.name} depends on`).toContain(field.showWhen.field);
        if (field.variants) expect(names, `${slug}.${field.name} varies by`).toContain(field.variants.field);
      }
    }
  });

  it('starts empty and fills with an example that generates, for every tool', async () => {
    for (const slug of STUDIO_TOOL_SLUGS) {
      const form = STUDIO_FORMS[slug];
      const defaults = studioDefaults(form);
      expect(isStudioExample(form, defaults), slug).toBe(false);
      const filled = studioExample(form, defaults);
      expect(isStudioExample(form, filled), slug).toBe(true);
      const result = await run(slug, buildStudioInput(form, filled));
      expect(result.studio, slug).toBe(true);
      expect(result.files.length, slug).toBeGreaterThanOrEqual(2);
      expect(result.previews.length, slug).toBeGreaterThanOrEqual(1);
      for (const preview of result.previews) expect(preview.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), slug).toBe(true);
      // Nothing in a result is copied into logs or history: there is no summary to copy.
      expect(Object.keys(result).sort(), slug).toEqual(['count', 'facts', 'files', 'notices', 'previews', 'studio', 'title']);
    }
  });

  it('gives the barcode generator an example that suits each of its types', async () => {
    const form = STUDIO_FORMS['barcode-generator'];
    for (const symbology of SYMBOLOGIES) {
      const values = applyStudioChange(form, studioExample(form, studioDefaults(form)), 'symbology', symbology.id);
      expect(values.data, symbology.id).toBe(symbology.sample);
      const result = await run('barcode-generator', buildStudioInput(form, values));
      expect(fact(result, 'Barcode type'), symbology.id).toBe(symbology.name);
    }
  });

  it('offers a label template only the stock it fits, so choosing never ends in a size refusal', async () => {
    const form = STUDIO_FORMS['label-designer'];
    const stockField = studioFields(form).find((field) => field.name === 'stock');
    const typeField = studioFields(form).find((field) => field.name === 'symbology');
    if (!stockField || !typeField) throw new Error('The label form has no stock or barcode type field.');
    const refusedPairs: string[] = [];
    let runs = 0;
    for (const template of LABEL_TEMPLATES) {
      const state = applyStudioChange(form, studioExample(form, studioDefaults(form)), 'template', template.id);
      const stocks = (resolveStudioField(form, stockField, state).options ?? []).map((option) => option.value);
      // Offered: every stock at least as large as the layout's minimum, and a custom size.
      expect(stocks, template.id).toEqual([...labelStocksFor(template).map((stock) => stock.id), CUSTOM_STOCK_ID]);
      for (const stock of LABEL_STOCKS) {
        const fits = stock.width >= template.minWidth && stock.height >= template.minHeight;
        expect(stocks.includes(stock.id), `${template.id} on ${stock.id}`).toBe(fits);
      }
      for (const stock of stocks) {
        for (const symbology of template.symbologies.length > 0 ? template.symbologies : [null]) {
          let values = applyStudioChange(form, state, 'stock', stock);
          if (symbology) values = applyStudioChange(form, values, 'symbology', symbology);
          if (stock === CUSTOM_STOCK_ID) values = { ...values, widthMm: String(template.minWidth), heightMm: String(template.minHeight) };
          runs += 1;
          try {
            await run('label-designer', buildStudioInput(form, values));
          } catch (error) {
            expect(error).toBeInstanceOf(ToolError);
            refusedPairs.push(`${template.id}/${stock}/${symbology}: ${(error as ToolError).detail.reason}`);
          }
        }
      }
    }
    // Every pairing the form can produce was generated: offered stocks × offered barcode types.
    expect(runs).toBe(LABEL_TEMPLATES.reduce((sum, template) => sum + (labelStocksFor(template).length + 1) * Math.max(1, template.symbologies.length), 0));
    expect(runs).toBeGreaterThan(300);
    // What is left depends on the content, not the choice: the nine-character example asset number
    // in Code 39 is 37 mm wide at the narrowest bar offered, wider than a 38 mm label has room for.
    // A shorter value fits (tested with the label tool).
    expect(refusedPairs.sort()).toEqual(['asset-tag/a4-5x13-38x21/code39: size', 'asset-tag/custom/code39: size', 'asset-tag/roll-38x19/code39: size']);
  });

  it('follows a change of template or barcode type without touching what the user typed', () => {
    const form = STUDIO_FORMS['label-designer'];
    const start = studioExample(form, studioDefaults(form));
    expect(start).toMatchObject({ template: 'asset-tag', symbology: 'code128', stock: 'a4-3x7-63x38', code: 'CH-000123' });

    // Example content is replaced by the new template's example, and its selects move with it.
    const product = applyStudioChange(form, start, 'template', 'product-label');
    expect(product).toMatchObject({ template: 'product-label', symbology: 'ean13', code: '9520123456788', stock: 'a4-3x7-63x38' });
    // The example number suits the barcode type: twelve digits for UPC-A, eight for EAN-8.
    expect(applyStudioChange(form, product, 'symbology', 'upca').code).toBe('012345000058');
    expect(applyStudioChange(form, product, 'symbology', 'ean8').code).toBe('95200002');
    expect(gs1CheckDigit('01234500005')).toBe(8);

    // Something the user typed survives both kinds of change.
    const typed = { ...start, code: 'MY-ASSET-7' } as StudioValues;
    expect(applyStudioChange(form, typed, 'template', 'shelf-label').code).toBe('MY-ASSET-7');
    expect(applyStudioChange(form, typed, 'symbology', 'qrcode').code).toBe('MY-ASSET-7');

    // A stock the new template cannot use moves to that template's default; one it can use stays.
    const small = applyStudioChange(form, start, 'stock', 'roll-38x19');
    expect(applyStudioChange(form, small, 'template', 'part-serial').stock).toBe('a4-2x7-99x38');
    expect(applyStudioChange(form, small, 'template', 'qr-label').stock).toBe('roll-38x19');
    // A barcode type the new template does not offer moves to its first type.
    expect(applyStudioChange(form, applyStudioChange(form, start, 'symbology', 'datamatrix'), 'template', 'part-serial').symbology).toBe('code128');
  });

  it('offers a shipping label only the papers it fits, and resets a paper that no longer does', () => {
    const form = STUDIO_FORMS['shipping-label-generator'];
    const paper = studioFields(form).find((field) => field.name === 'sheet');
    if (!paper) throw new Error('The shipping form has no paper field.');
    const start = studioDefaults(form);
    for (const size of SHIPPING_SIZES) {
      const state = applyStudioChange(form, start, 'size', size.id);
      expect((resolveStudioField(form, paper, state).options ?? []).map((option) => option.value), size.id).toEqual(shippingSheetsFor(size.id));
    }
    const onLetter = applyStudioChange(form, start, 'sheet', 'letter-2x1-4x6');
    expect(applyStudioChange(form, onLetter, 'size', 'a6').sheet).toBe('none');
    expect(applyStudioChange(form, onLetter, 'size', '100x150').sheet).toBe('letter-2x1-4x6');
  });

  it('sends only the fields on screen, with numbers as numbers', () => {
    const labels = STUDIO_FORMS['label-designer'];
    const input = buildStudioInput(labels, { ...studioExample(labels, studioDefaults(labels)), copies: '12', widthMm: '45,5' });
    expect(input.copies).toBe(12);
    // The custom size fields are hidden while a stock is chosen, so they are not sent.
    expect(input).not.toHaveProperty('widthMm');
    expect(input).not.toHaveProperty('name');
    expect(input).toMatchObject({ template: 'asset-tag', numbering: false, border: false });
    const custom = buildStudioInput(labels, { ...studioDefaults(labels), stock: CUSTOM_STOCK_ID, widthMm: '45,5', heightMm: '30' });
    expect(custom).toMatchObject({ widthMm: 45.5, heightMm: 30 });
    expect(custom).not.toHaveProperty('startPosition');

    const shipping = STUDIO_FORMS['shipping-label-generator'];
    expect(buildStudioInput(shipping, { ...studioDefaults(shipping), sscc: '09528765432101234' })).not.toHaveProperty('sscc');
    expect(buildStudioInput(shipping, { ...studioDefaults(shipping), barcode: 'sscc', sscc: '09528765432101234' })).toMatchObject({ sscc: '09528765432101234' });
  });

  it('swaps the data field for the series fields when a numbered series is chosen, and sends only those', async () => {
    const form = STUDIO_FORMS['barcode-generator'];
    const names = (values: StudioValues): string[] => form.sections.flatMap((section) => visibleStudioFields(form, section, values)).map((field) => field.name);
    const SERIES = ['seriesPrefix', 'seriesSuffix', 'seriesStart', 'seriesCount', 'seriesStep', 'seriesDigits'];
    const off = studioDefaults(form);
    expect(names(off)).toEqual(expect.arrayContaining(['series', 'data', 'batch']));
    for (const name of SERIES) expect(names(off), name).not.toContain(name);

    const on = applyStudioChange(form, off, 'series', true);
    expect(names(on)).toEqual(expect.arrayContaining(['series', ...SERIES]));
    expect(names(on)).not.toContain('data');
    expect(names(on)).not.toContain('batch');

    // What the form sends is a request the tool accepts as it stands, with the form's own defaults.
    const input = buildStudioInput(form, { ...on, data: 'left over from before', seriesPrefix: 'CH-', seriesDigits: '3' });
    expect(input).toMatchObject({ series: true, seriesPrefix: 'CH-', seriesStart: 1, seriesCount: 10, seriesStep: 1, seriesDigits: 3 });
    expect(input).not.toHaveProperty('data');
    expect(input).not.toHaveProperty('batch');
    const result = await run('barcode-generator', input);
    expect(fact(result, 'Series')).toBe('CH-001 to CH-010');
    // The limits the form states are the limits the tool enforces.
    const field = (name: string) => studioFields(form).find((entry) => entry.name === name);
    expect([field('seriesCount')?.min, field('seriesCount')?.max]).toEqual([1, BARCODE_BATCH_LIMIT]);
    expect([field('seriesStart')?.max, field('seriesStep')?.max, field('seriesDigits')?.max, field('seriesPrefix')?.maxLength, field('seriesSuffix')?.maxLength]).toEqual([
      SERIES_LIMITS.firstMax, SERIES_LIMITS.stepMax, SERIES_LIMITS.digitsMax, SERIES_LIMITS.textMax, SERIES_LIMITS.textMax,
    ]);
  });

  it('shows the barcode generator only the options its selected type has', () => {
    const form = STUDIO_FORMS['barcode-generator'];
    const visible = (symbology: string): string[] => form.sections.flatMap((section) => visibleStudioFields(form, section, { ...studioDefaults(form), symbology })).map((field) => field.name);
    expect(visible('qrcode')).toContain('eclevel');
    expect(visible('qrcode')).not.toContain('includecheck');
    expect(visible('qrcode')).not.toContain('barHeightMm');
    expect(visible('code39')).toContain('includecheck');
    expect(visible('code39')).toContain('barHeightMm');
    expect(visible('pdf417')).toEqual(expect.arrayContaining(['columns', 'securityLevel']));
    expect(visible('pdf417')).not.toContain('eclevel');
    expect(visible('mailmark')).toContain('mailmarkType');
    expect(visible('datamatrix')).not.toContain('mailmarkType');
    // The options a type declares are exactly the option fields its form shows.
    const optionFields = new Set(SYMBOLOGIES.flatMap((symbology) => (symbology.options ?? []).map((option) => option.field ?? option.key)));
    expect([...optionFields].sort()).toEqual(['columns', 'eclevel', 'includecheck', 'mailmarkType', 'securityLevel']);
    for (const symbology of SYMBOLOGIES) {
      const declared = (symbologyById(symbology.id)?.options ?? []).map((option) => option.field ?? option.key).sort();
      const shown = visible(symbology.id).filter((name) => optionFields.has(name)).sort();
      expect(shown, symbology.id).toEqual(declared);
    }
  });
});
