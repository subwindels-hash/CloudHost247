/**
 * Barcode Generator.
 *
 * One symbol, or a batch of them, as files that print at the size they were asked for:
 *
 *  - SVG and PDF are vector. The narrowest element is exactly the module width requested, so the
 *    file can be placed in artwork or sent to a label printer without anything being resampled.
 *  - PNG is a bitmap, and a bitmap barcode is only sound when each module is a whole number of
 *    pixels. The module is therefore snapped to the pixel grid of the chosen resolution, the image
 *    records that resolution, and the result says what the module width became.
 *
 * Every symbol is produced by BWIPP. Whether a symbology has additionally been read back by an
 * independent decoder in the test suite is stated in the result rather than implied.
 */

import { invalidInput } from '../../core/errors';
import type { ToolInput } from '../../handlers/kit';
import { buildZip, type ZipEntry } from '../../business/id-card/zip';
import type { StudioSurface } from '../render/draw-ops';
import { buildVectorPdf, type PdfPageSpec } from '../render/pdf-vector';
import { setPngDpi, pngDimensions } from '../render/png-meta';
import { surfaceToSvg } from '../render/svg';
import { BarcodeError, encodeSymbol, renderSymbolPng, resolveEncoding, rotateSymbol, translateOps, type EncodeRequest } from '../barcode/encoder';
import { carriedContent } from '../barcode/carried';
import { optionField, symbologyById, type Symbology } from '../barcode/symbologies';
import { imposeOnSheet, onePerPage } from '../shared/impose';
import { choiceOf, decimalNumber, fieldText, flag, hexColour, refusable, wholeNumber } from '../shared/input';
import { labelSheet } from '../shared/sheets';
import { binaryFile, contrastNotice, fileStem, mmText, previewOf, sizeText, textFile, type StudioFile, type StudioResult } from '../shared/result';

export const BARCODE_BATCH_LIMIT = 50;
export const BARCODE_COPIES_LIMIT = 500;
const PREVIEW_LIMIT = 6;
const DATA_LIMIT = 20_000;

interface Settings {
  symbology: Symbology;
  moduleMm: number | undefined;
  barHeightMm: number | undefined;
  showText: boolean;
  quietZone: boolean;
  quarterTurns: number;
  color: string;
  /** `null` means transparent. */
  background: string | null;
  dpi: number;
  options: Record<string, unknown>;
}

function parseSettings(input: ToolInput): Settings {
  const id = typeof input.symbology === 'string' && input.symbology.trim() !== '' ? input.symbology.trim() : 'code128';
  const symbology = symbologyById(id);
  if (!symbology) throw invalidInput('That is not a barcode type this tool offers.');

  // Symbology options may arrive nested (`options: { eclevel: 'H' }`) or flat (`eclevel: 'H'`), so
  // the same request works from the API and from a plain form.
  const nested = typeof input.options === 'object' && input.options !== null && !Array.isArray(input.options) ? (input.options as Record<string, unknown>) : {};
  const options: Record<string, unknown> = {};
  for (const option of symbology.options ?? []) {
    const field = optionField(option);
    const value = nested[field] ?? input[field];
    if (value !== undefined && value !== null && value !== '') options[option.key] = value;
  }

  const transparent = flag(input, 'transparent', false) || String(input.background ?? '').toLowerCase() === 'transparent';

  return {
    symbology,
    moduleMm: decimalNumber(input, 'moduleMm', 'Module width', { min: 0.05, max: 5 }),
    barHeightMm: decimalNumber(input, 'barHeightMm', 'Bar height', { min: 1, max: 100 }),
    showText: flag(input, 'showText', true),
    quietZone: flag(input, 'quietZone', true),
    quarterTurns: Number(choiceOf(input, 'rotation', 'Rotation', ['0', '90', '180', '270'], '0')) / 90,
    color: hexColour(input, 'color', 'Bar colour', '#000000'),
    background: transparent ? null : hexColour(input, 'background', 'Background colour', '#ffffff'),
    dpi: wholeNumber(input, 'dpi', 'Resolution', { min: 72, max: 1200, fallback: 300 }),
    options,
  };
}

function requestFor(settings: Settings, data: string): EncodeRequest {
  return {
    symbology: settings.symbology,
    data,
    options: settings.options,
    showText: settings.showText,
    color: settings.color,
    ...(settings.moduleMm !== undefined ? { moduleMm: settings.moduleMm } : {}),
    ...(settings.barHeightMm !== undefined ? { barHeightMm: settings.barHeightMm } : {}),
  };
}

interface Rendered {
  data: string;
  surface: StudioSurface;
  moduleMm: number;
  png: Uint8Array;
  pngModuleMm: number;
  pixelsPerModule: number;
}

async function renderOne(settings: Settings, data: string, position: string): Promise<Rendered> {
  try {
    const request = requestFor(settings, data);
    const symbol = encodeSymbol(request);
    const rotated = rotateSymbol(symbol.ops, symbol.width, symbol.height, settings.quarterTurns);
    const quiet = settings.quietZone ? symbol.quietMm : 0;
    const surface: StudioSurface = {
      width: rotated.width + 2 * quiet,
      height: rotated.height + 2 * quiet,
      ops: translateOps(rotated.ops, quiet, quiet),
      ...(settings.background ? { background: settings.background } : {}),
    };
    const bitmap = await renderSymbolPng({
      ...request,
      dpi: settings.dpi,
      quietZone: settings.quietZone,
      quarterTurns: settings.quarterTurns,
      ...(settings.background ? { background: settings.background } : {}),
    });
    return {
      data: symbol.data,
      surface,
      moduleMm: symbol.moduleMm,
      png: setPngDpi(bitmap.png, settings.dpi),
      pngModuleMm: bitmap.moduleMm,
      pixelsPerModule: bitmap.pixelsPerModule,
    };
  } catch (error) {
    if (error instanceof BarcodeError) throw invalidInput(`${position}${error.message}`);
    throw error;
  }
}

export const SERIES_LIMITS = { firstMax: 999_999_999_999, stepMax: 1_000_000, digitsMax: 20, textMax: 40 } as const;

export interface SeriesSpec {
  first: number;
  count: number;
  step: number;
  /** Pad the number with leading zeros to this many digits. 0 leaves it as it is. */
  digits: number;
  prefix: string;
  suffix: string;
}

/**
 * The values of a numbered series: a counter between fixed text, one value per barcode.
 * `CH-` + 0001, 0002, 0003... is `{ prefix: 'CH-', first: 1, step: 1, digits: 4 }`.
 * A number that outgrows `digits` is not cut: 9, 10, 11 with one digit gives 9, 10, 11.
 */
export function seriesValues(spec: SeriesSpec): string[] {
  return Array.from({ length: spec.count }, (_, index) => `${spec.prefix}${String(spec.first + index * spec.step).padStart(spec.digits, '0')}${spec.suffix}`);
}

function parseSeries(input: ToolInput): SeriesSpec {
  return {
    first: wholeNumber(input, 'seriesStart', 'First number', { min: 0, max: SERIES_LIMITS.firstMax, fallback: 1 }),
    count: wholeNumber(input, 'seriesCount', 'How many', { min: 1, max: BARCODE_BATCH_LIMIT, fallback: 10 }),
    step: wholeNumber(input, 'seriesStep', 'Count up by', { min: 1, max: SERIES_LIMITS.stepMax, fallback: 1 }),
    digits: wholeNumber(input, 'seriesDigits', 'Digits', { min: 0, max: SERIES_LIMITS.digitsMax, fallback: 0 }),
    prefix: fieldText(input, { name: 'seriesPrefix', label: 'Text before the number', maxLength: SERIES_LIMITS.textMax }),
    suffix: fieldText(input, { name: 'seriesSuffix', label: 'Text after the number', maxLength: SERIES_LIMITS.textMax }),
  };
}

function seriesRange(symbology: Symbology, values: string[], includeCheck: boolean): string {
  const first = values[0] as string;
  const last = values[values.length - 1] as string;
  const carriedFirst = carriedContent(symbology, first, includeCheck);
  const carriedLast = carriedContent(symbology, last, includeCheck);
  const range = (from: string, to: string): string => (values.length === 1 ? from : `${from} to ${to}`);
  return carriedFirst && carriedLast ? `${range(carriedFirst.content, carriedLast.content)}, as the symbols carry them` : range(first, last);
}

/** Split batch input into entries: one per line, blank lines ignored. */
export function splitBatch(text: string): string[] {
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

export async function runBarcodeGenerator(input: ToolInput): Promise<StudioResult> {
  const settings = parseSettings(input);
  const { symbology } = settings;
  // A numbered series supplies its own values, so it takes the place of the data and of a batch.
  const series = flag(input, 'series', false) ? parseSeries(input) : null;
  let raw = '';
  if (!series) {
    if (typeof input.data !== 'string' && typeof input.data !== 'number') throw invalidInput('Enter the data to encode.');
    raw = String(input.data);
    if (raw.trim() === '') throw invalidInput('Enter the data to encode.');
    if (raw.length > DATA_LIMIT) throw invalidInput(`The data is limited to ${DATA_LIMIT.toLocaleString('en-GB')} characters per request.`);
  }
  const batch = series !== null || flag(input, 'batch', false);
  const copies = wholeNumber(input, 'copies', 'Copies', { min: 1, max: BARCODE_COPIES_LIMIT, fallback: 1 });
  const sheetId = typeof input.sheet === 'string' ? input.sheet.trim() : '';
  const sheet = sheetId === '' || sheetId === 'none' ? null : labelSheet(sheetId);
  if (sheet === undefined) throw invalidInput('That sheet layout is not one this tool offers.');

  const entries = series ? seriesValues(series) : batch ? splitBatch(raw) : [raw];
  if (entries.length === 0) throw invalidInput('Enter the data to encode.');
  if (entries.length > BARCODE_BATCH_LIMIT) {
    throw invalidInput(`A batch is limited to ${BARCODE_BATCH_LIMIT} barcodes per request; this one has ${entries.length}. Split it into smaller batches.`);
  }
  if (copies > 1 && !sheet) throw invalidInput('Copies are laid out on a label sheet. Choose a sheet layout, or set copies to 1.');
  if (entries.length * copies > BARCODE_COPIES_LIMIT) {
    throw invalidInput(`This would print ${entries.length * copies} labels; one request is limited to ${BARCODE_COPIES_LIMIT}.`);
  }

  const rendered: Rendered[] = [];
  for (const [index, entry] of entries.entries()) {
    rendered.push(await renderOne(settings, entry, series ? `Number ${index + 1} of the series: ` : batch ? `Line ${index + 1}: ` : ''));
  }
  const first = rendered[0] as Rendered;
  const stem = fileStem(`${symbology.id}-${series ? 'series' : batch ? 'batch' : first.data}`, symbology.id);
  const title = batch ? `${rendered.length} × ${symbology.name}` : symbology.name;

  // ----- PDF: exact-size pages, or positions on a label sheet -----
  const printed: StudioSurface[] = rendered.flatMap((item) => Array.from({ length: copies }, () => item.surface));
  let pdfPages: PdfPageSpec[];
  let pdfLabel: string;
  let pdfHint: string;
  let sheetCount = 0;
  if (sheet) {
    const imposed = refusable(() => imposeOnSheet(printed, sheet));
    pdfPages = imposed.pages;
    sheetCount = imposed.sheets;
    pdfLabel = `Download PDF (${imposed.sheets} ${imposed.sheets === 1 ? 'sheet' : 'sheets'})`;
    pdfHint = `${sheet.label}. Print at 100% / “Actual size”; scaling changes the module width.`;
  } else {
    pdfPages = refusable(() => onePerPage(printed));
    pdfLabel = printed.length === 1 ? 'Download PDF' : `Download PDF (${printed.length} pages)`;
    pdfHint = 'Each page is exactly the size of its symbol. Print at 100% / “Actual size”.';
  }
  const pdf = buildVectorPdf(pdfPages, { title: `${title} | CloudHost247 Barcode Generator`, subject: `${symbology.name} barcode` });

  const files: StudioFile[] = [];
  if (!batch) {
    files.push(
      textFile(`${stem}.svg`, 'image/svg+xml', surfaceToSvg(first.surface, { title: `${symbology.name} barcode` }), 'Download SVG', 'Vector. Scales without loss; best for artwork and print.'),
      binaryFile(`${stem}-${settings.dpi}dpi.png`, 'image/png', first.png, `Download PNG (${settings.dpi} dpi)`, 'Bitmap. Place it at 100% of its size; resizing a barcode bitmap blurs the bars.')
    );
  } else {
    const zipEntries: ZipEntry[] = [];
    const used = new Set<string>();
    rendered.forEach((item, index) => {
      let name = `${String(index + 1).padStart(2, '0')}-${fileStem(item.data, 'barcode')}`;
      while (used.has(name)) name = `${name}-${index + 1}`;
      used.add(name);
      zipEntries.push({ name: `svg/${name}.svg`, data: new Uint8Array(Buffer.from(surfaceToSvg(item.surface, { title: `${symbology.name} barcode` }), 'utf8')) });
      zipEntries.push({ name: `png/${name}.png`, data: item.png });
    });
    files.push(binaryFile(`${stem}.zip`, 'application/zip', buildZip(zipEntries), `Download ZIP (${rendered.length} SVG + ${rendered.length} PNG)`, series ? 'One vector and one bitmap file per number.' : 'One vector and one bitmap file per line.'));
  }
  files.push(binaryFile(`${stem}.pdf`, 'application/pdf', pdf.bytes, pdfLabel, pdfHint));

  // ----- What the user should know -----
  const notices: string[] = [];
  if (symbology.sizing.mode === 'fixed') {
    notices.push(symbology.sizing.note);
  } else {
    const sizing = symbology.sizing;
    if (settings.moduleMm !== undefined && Math.abs(settings.moduleMm - first.moduleMm) > 1e-9) {
      notices.push(`The module width was set to ${mmText(first.moduleMm)} mm: ${symbology.name} is offered between ${mmText(sizing.minModuleMm)} and ${mmText(sizing.maxModuleMm)} mm here.`);
    }
    if (Math.abs(first.pngModuleMm - first.moduleMm) > 0.005) {
      notices.push(
        `The PNG uses ${first.pixelsPerModule} ${first.pixelsPerModule === 1 ? 'pixel' : 'pixels'} per module, which is ${mmText(first.pngModuleMm)} mm at ${settings.dpi} dpi. A bitmap module must be a whole number of pixels, so it cannot be exactly ${mmText(first.moduleMm)} mm; the SVG and PDF are.`
      );
    }
    if (first.pixelsPerModule < 2) {
      notices.push(`At ${settings.dpi} dpi each module of the PNG is a single pixel. Raise the resolution or the module width for a bitmap that prints reliably.`);
    }
  }
  if (settings.barHeightMm !== undefined) {
    const range = symbology.barHeight;
    if (!range) {
      notices.push(`The bar height setting does not apply to ${symbology.name} and was not used.`);
    } else if (settings.barHeightMm < range.minMm || settings.barHeightMm > range.maxMm) {
      const used = Math.min(range.maxMm, Math.max(range.minMm, settings.barHeightMm));
      notices.push(`The bar height was set to ${mmText(used)} mm: ${symbology.name} is offered between ${mmText(range.minMm)} and ${mmText(range.maxMm)} mm here.`);
    }
  }
  const includeCheck = resolveEncoding(requestFor(settings, first.data)).params.includecheck === true;
  if (includeCheck && symbology.id !== 'itf') notices.push('A check character was added to the bars after your data.');
  const contrast = contrastNotice(settings.color, settings.background ?? '#ffffff');
  if (contrast) notices.push(contrast);
  if (!settings.quietZone) notices.push('The quiet zone is off. Leave clear space around the symbol when you place it, or scanners may not find its edges.');
  if (symbology.note) notices.push(symbology.note);
  for (const message of pdf.skippedImages) notices.push(message);

  const dimensions = pngDimensions(first.png);
  // "Your data" is what was entered (after tidying). Where the symbol carries more than that, the
  // next line says exactly what; the label never claims the input is the whole symbol.
  const carried = batch ? null : carriedContent(symbology, first.data, includeCheck);
  const facts = [
    { label: 'Barcode type', value: symbology.name },
    { label: batch ? 'Barcodes' : 'Your data', value: batch ? String(rendered.length) : first.data.length > 80 ? `${first.data.slice(0, 77)}…` : first.data },
    // The first and last value, so a wrong start or step shows before anything is printed. Where the
    // barcode type completes the number (a retail check digit), the completed numbers are shown.
    ...(series ? [{ label: 'Series', value: seriesRange(symbology, rendered.map((item) => item.data), includeCheck) }] : []),
    ...(carried ? [{ label: 'The symbol carries', value: `${carried.content} (${carried.why})` }] : []),
    ...(sheet ? [{ label: 'Sheet', value: sheet.label }, { label: 'Labels', value: `${printed.length} on ${sheetCount} ${sheetCount === 1 ? 'sheet' : 'sheets'}` }] : []),
    { label: 'Size', value: `${sizeText(first.surface.width, first.surface.height)}${settings.quietZone ? ' including the quiet zone' : ''}` },
    ...(symbology.sizing.mode === 'module' ? [{ label: 'Module width (SVG, PDF)', value: `${mmText(first.moduleMm)} mm` }] : []),
    ...(dimensions ? [{ label: 'PNG', value: `${dimensions.width} × ${dimensions.height} px at ${settings.dpi} dpi` }] : []),
    {
      label: 'Verification',
      value:
        symbology.verification === 'decode'
          ? 'This barcode type is read back by an independent decoder in our automated tests.'
          : symbology.readBack
            ? `Partly read back: our automated tests read ${symbology.readBack} with an independent decoder, and no more of this symbol than that.`
            : 'Not read back: no independent decoder for this barcode type is available to our automated tests.',
    },
  ];

  return {
    studio: true,
    title,
    previews: rendered.slice(0, PREVIEW_LIMIT).map((item, index) => previewOf(item.surface, batch ? `${index + 1}. ${item.data.length > 40 ? `${item.data.slice(0, 37)}…` : item.data}` : symbology.name)),
    files,
    facts,
    notices: [...(batch && rendered.length > PREVIEW_LIMIT ? [`Showing the first ${PREVIEW_LIMIT} of ${rendered.length} barcodes. The downloads contain all of them.`] : []), ...notices],
    count: rendered.length * copies,
  };
}
