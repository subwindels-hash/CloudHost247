/**
 * VDA 4902 transport label.
 *
 * Draws the sixteen-field goods label used between automotive suppliers and plants: receiver,
 * unloading point, delivery note, supplier, weights, part number, quantity, description, supplier
 * part number, supplier number, date, change level, package number and batch. The fields that
 * identify the shipment carry Code 39 barcodes whose data begins with the field's data identifier
 * (N, P, Q, 30S, V, S/M/G, H).
 *
 * What this is and is not. The field set, numbering, identifiers and symbology follow the published
 * description of the label. The cell geometry is CloudHost247's own arrangement of those fields on
 * the standard A5 (210 × 148 mm) and KLT (210 × 74 mm) formats; it was not produced from, or checked
 * against, the VDA's own document, and it carries no certification. Every result says so, and tells
 * the user to check it against the receiving plant's packaging guideline.
 */

import { invalidInput } from '../../core/errors';
import type { ToolInput } from '../../handlers/kit';
import type { StudioSurface } from '../render/draw-ops';
import { SANS_METRICS } from '../render/text-metrics';
import { buildVectorPdf, type PdfPageSpec } from '../render/pdf-vector';
import { surfaceToSvg } from '../render/svg';
import {
  CODE39_PATTERN,
  VDA_FIELDS,
  VDA_FORMATS,
  VDA_LABEL_TYPES,
  VDA_LANGUAGES,
  type VdaField,
  type VdaFormat,
  type VdaLabelType,
  type VdaLanguage,
} from '../definitions';
import { LabelCanvas, type Box } from '../shared/compose';
import { imposeOnSheet, onePerPage } from '../shared/impose';
import { choiceOf, fieldText, flag, incrementTrailingNumber, refusable, wholeNumber } from '../shared/input';
import { binaryFile, fileStem, mmText, previewOf, sheetPreview, sizeText, textFile, type StudioFact, type StudioResult } from '../shared/result';
import { labelSheet } from '../shared/sheets';

export const VDA_COPIES_LIMIT = 100;

const CAP = SANS_METRICS.capHeight;
const CAPTION_SIZE = 2.05;
const LINE = 0.3;
/** Preferred and smallest Code 39 narrow-bar widths on these labels, in millimetres. */
const MODULE_PREFERRED = 0.38;
const MODULE_MINIMUM = 0.25;

interface Cell {
  /** Field number, 1 to 16. */
  number: number;
  box: Box;
  /** Capital height of the printed value, in millimetres. */
  valueCap: number;
  /** Print the barcode for this field. Only fields with a data identifier can. */
  barcode?: boolean;
  /** Lines of text a text-only field may use. */
  lines?: number;
}

/** A5 landscape: two columns, the part number across both. */
function a5Cells(): Cell[] {
  const left = 4;
  const mid = 105;
  const right = 206;
  const half = mid - left;
  const y = [4, 20, 45, 72, 102, 144];
  const third = (right - mid) / 3;
  return [
    { number: 1, box: { x: left, y: y[0] as number, w: half, h: 16 }, valueCap: 2.3, lines: 3 },
    { number: 2, box: { x: mid, y: y[0] as number, w: half, h: 16 }, valueCap: 3.4, lines: 2 },
    { number: 3, box: { x: left, y: y[1] as number, w: half, h: 25 }, valueCap: 4, barcode: true },
    { number: 4, box: { x: mid, y: y[1] as number, w: half, h: 14 }, valueCap: 2.3, lines: 3 },
    { number: 5, box: { x: mid, y: (y[1] as number) + 14, w: third, h: 11 }, valueCap: 2.8 },
    { number: 6, box: { x: mid + third, y: (y[1] as number) + 14, w: third, h: 11 }, valueCap: 2.8 },
    { number: 7, box: { x: mid + 2 * third, y: (y[1] as number) + 14, w: third, h: 11 }, valueCap: 2.8 },
    { number: 8, box: { x: left, y: y[2] as number, w: right - left, h: 27 }, valueCap: 7, barcode: true },
    { number: 9, box: { x: left, y: y[3] as number, w: half, h: 30 }, valueCap: 6.5, barcode: true },
    { number: 10, box: { x: mid, y: y[3] as number, w: half, h: 10 }, valueCap: 2.8 },
    { number: 11, box: { x: mid, y: (y[3] as number) + 10, w: half, h: 20 }, valueCap: 3.2, barcode: true },
    { number: 12, box: { x: left, y: y[4] as number, w: half, h: 21 }, valueCap: 3.4, barcode: true },
    { number: 13, box: { x: mid, y: y[4] as number, w: half / 2, h: 11 }, valueCap: 2.8 },
    { number: 14, box: { x: mid + half / 2, y: y[4] as number, w: half / 2, h: 11 }, valueCap: 2.8 },
    { number: 15, box: { x: left, y: (y[4] as number) + 21, w: half, h: 21 }, valueCap: 3.4, barcode: true },
    { number: 16, box: { x: mid, y: (y[4] as number) + 11, w: half, h: 31 }, valueCap: 3.4, barcode: true },
  ];
}

/**
 * KLT, 210 × 74 mm: the same sixteen fields in five rows. There is room for five barcodes, so the
 * delivery note and the supplier part number are printed as text only on this format.
 */
function kltCells(): Cell[] {
  const left = 3;
  const width = 204;
  const col = width / 3;
  const sixth = width / 6;
  const rows = [3, 14, 33, 41, 49, 71];
  const y = (index: number): number => rows[index] as number;
  return [
    { number: 1, box: { x: left, y: y(0), w: col, h: 11 }, valueCap: 1.7, lines: 3 },
    { number: 2, box: { x: left + col, y: y(0), w: col, h: 11 }, valueCap: 2.6, lines: 2 },
    { number: 4, box: { x: left + 2 * col, y: y(0), w: col, h: 11 }, valueCap: 1.7, lines: 3 },
    { number: 8, box: { x: left, y: y(1), w: 2 * col, h: 19 }, valueCap: 4.8, barcode: true },
    { number: 9, box: { x: left + 2 * col, y: y(1), w: col, h: 19 }, valueCap: 4.8, barcode: true },
    { number: 10, box: { x: left, y: y(2), w: width / 2, h: 8 }, valueCap: 2.3 },
    { number: 11, box: { x: left + width / 2, y: y(2), w: width / 2, h: 8 }, valueCap: 2.3 },
    { number: 3, box: { x: left, y: y(3), w: sixth * 1.5, h: 8 }, valueCap: 2.3 },
    { number: 13, box: { x: left + sixth * 1.5, y: y(3), w: sixth, h: 8 }, valueCap: 2.3 },
    { number: 14, box: { x: left + sixth * 2.5, y: y(3), w: sixth, h: 8 }, valueCap: 2.3 },
    { number: 5, box: { x: left + sixth * 3.5, y: y(3), w: sixth * 0.85, h: 8 }, valueCap: 2.3 },
    { number: 6, box: { x: left + sixth * 4.35, y: y(3), w: sixth * 0.85, h: 8 }, valueCap: 2.3 },
    { number: 7, box: { x: left + sixth * 5.2, y: y(3), w: sixth * 0.8, h: 8 }, valueCap: 2.3 },
    { number: 12, box: { x: left, y: y(4), w: col, h: 22 }, valueCap: 2.8, barcode: true },
    { number: 15, box: { x: left + col, y: y(4), w: col, h: 22 }, valueCap: 2.8, barcode: true },
    { number: 16, box: { x: left + 2 * col, y: y(4), w: col, h: 22 }, valueCap: 2.8, barcode: true },
  ];
}

export function vdaCells(format: VdaFormat): Cell[] {
  return format === 'klt' ? kltCells() : a5Cells();
}

function fieldByNumber(number: number): VdaField {
  return VDA_FIELDS.find((field) => field.number === number) as VdaField;
}

export interface VdaValues {
  [name: string]: string;
}

export interface VdaArtwork {
  surface: StudioSurface;
  notices: string[];
  /** One entry per printed barcode: the field number, the encoded data and the module width used. */
  barcodes: Array<{ field: number; data: string; moduleMm: number }>;
}

function captionFor(field: VdaField, language: VdaLanguage, labelType: VdaLabelType): string {
  const text = field.captions[language];
  return field.number === 15 ? `(${field.number}) ${text} (${labelType})` : `(${field.number}) ${text}`;
}

/** The data identifier encoded before a field's value. Field 15 depends on what the label is attached to. */
export function vdaIdentifier(field: VdaField, labelType: VdaLabelType): string {
  return field.number === 15 ? labelType : (field.identifier ?? '');
}

export function drawVdaLabel(format: VdaFormat, language: VdaLanguage, labelType: VdaLabelType, values: VdaValues): VdaArtwork {
  const size = VDA_FORMATS.find((entry) => entry.id === format) ?? VDA_FORMATS[0];
  const canvas = new LabelCanvas(size.width, size.height);
  const barcodes: VdaArtwork['barcodes'] = [];
  const cells = vdaCells(format);
  const compact = format === 'klt';
  const captionSize = compact ? 1.75 : CAPTION_SIZE;
  const padX = compact ? 1 : 1.3;
  const captionTop = compact ? 0.8 : 1.1;

  for (const cell of cells) {
    const field = fieldByNumber(cell.number);
    const { box } = cell;
    canvas.rect(box, { stroke: '#000000', strokeWidth: LINE });
    canvas.text(captionFor(field, language, labelType), box.x + padX, box.y + captionTop + captionSize * CAP, { size: captionSize, maxWidth: box.w - 2 * padX });

    const text = values[field.name] ?? '';
    if (text === '') continue;
    const valueTop = box.y + captionTop + captionSize * CAP + (compact ? 0.9 : 1.2);
    const valueSize = cell.valueCap / CAP;

    if (!cell.barcode) {
      canvas.paragraph(text, { x: box.x + padX + 0.3, y: valueTop, w: box.w - 2 * padX - 0.6, h: box.y + box.h - 0.7 - valueTop }, {
        size: valueSize,
        weight: '700',
        leading: 1.18,
        minSize: valueSize * 0.6,
        maxLines: cell.lines ?? 1,
        what: `Field ${field.number} (${field.label})`,
      });
      continue;
    }

    canvas.text(text, box.x + padX + 0.3, valueTop + cell.valueCap, { size: valueSize, weight: '700', maxWidth: box.w - 2 * padX - 0.6 });
    const barcodeTop = valueTop + cell.valueCap + (compact ? 0.9 : 1.3);
    const placed = canvas.symbol(
      {
        symbology: 'code39',
        data: `${vdaIdentifier(field, labelType)}${text}`,
        what: `The barcode for field ${field.number} (${field.label.toLowerCase()})`,
        moduleMm: MODULE_PREFERRED,
        minModuleMm: MODULE_MINIMUM,
        reportsOwnSize: true,
        // The size of the label and its symbology are given, so the value is what can change. The
        // barcode fields of the KLT format are all narrower than their A5 counterparts.
        advice: compact ? 'Use a shorter value, or the A5 format, where this field is wider.' : 'Use a shorter value.',
        maxBarHeightMm: 15,
        align: 'left',
        valign: 'top',
      },
      { x: box.x + 0.6, y: barcodeTop, w: box.w - 1.2, h: box.y + box.h - (compact ? 0.8 : 1) - barcodeTop }
    );
    barcodes.push({ field: field.number, data: placed.data, moduleMm: placed.moduleMm });
  }

  // The outer rule is heavier than the cell rules, and drawn last so it sits on top of them.
  const first = cells[0] as Cell;
  const bounds = cells.reduce(
    (acc, cell) => ({
      x0: Math.min(acc.x0, cell.box.x),
      y0: Math.min(acc.y0, cell.box.y),
      x1: Math.max(acc.x1, cell.box.x + cell.box.w),
      y1: Math.max(acc.y1, cell.box.y + cell.box.h),
    }),
    { x0: first.box.x, y0: first.box.y, x1: first.box.x + first.box.w, y1: first.box.y + first.box.h }
  );
  canvas.rect({ x: bounds.x0, y: bounds.y0, w: bounds.x1 - bounds.x0, h: bounds.y1 - bounds.y0 }, { stroke: '#000000', strokeWidth: 0.55 });

  const { surface, notices } = canvas.finish();
  return { surface, notices, barcodes };
}

export async function runVdaLabel(input: ToolInput): Promise<StudioResult> {
  const format = choiceOf(input, 'format', 'Label format', VDA_FORMATS.map((entry) => entry.id), 'a5') as VdaFormat;
  const language = choiceOf(input, 'language', 'Caption language', VDA_LANGUAGES.map((entry) => entry.id), 'en') as VdaLanguage;
  const labelType = choiceOf(input, 'labelType', 'Label type', VDA_LABEL_TYPES.map((entry) => entry.id), 'S') as VdaLabelType;
  const size = VDA_FORMATS.find((entry) => entry.id === format) ?? VDA_FORMATS[0];

  const values: VdaValues = {};
  for (const field of VDA_FIELDS) {
    let text = fieldText(input, {
      name: field.name,
      label: field.label,
      maxLength: field.maxLength,
      multiline: field.type === 'textarea',
      ...(field.required ? { required: true } : {}),
      ...(field.type === 'textarea' ? { maxLines: 3 } : {}),
    });
    if (field.identifier !== undefined) {
      text = text.toUpperCase();
      if (!CODE39_PATTERN.test(text)) {
        throw invalidInput(`${field.label} is printed as a Code 39 barcode, which carries digits, capital letters, spaces and - . $ / + % only.`);
      }
    }
    values[field.name] = text;
  }

  const copies = wholeNumber(input, 'copies', 'Number of labels', { min: 1, max: VDA_COPIES_LIMIT, fallback: 1 });
  const numbering = copies > 1 && flag(input, 'numbering', true);
  const onSheet = flag(input, 'sheet', false);
  if (numbering && incrementTrailingNumber(values.packageNumber ?? '', 0) === null) {
    throw invalidInput('To number the labels, the package number must contain a number to count from.');
  }

  const artworks: VdaArtwork[] = [];
  const surfaces: StudioSurface[] = [];
  let lastPackage = values.packageNumber ?? '';
  if (numbering) {
    for (let index = 0; index < copies; index += 1) {
      lastPackage = incrementTrailingNumber(values.packageNumber ?? '', index) as string;
      const labelValues = { ...values, packageNumber: lastPackage };
      const artwork = refusable(() => drawVdaLabel(format, language, labelType, labelValues));
      artworks.push(artwork);
      surfaces.push(artwork.surface);
    }
  } else {
    const artwork = refusable(() => drawVdaLabel(format, language, labelType, values));
    artworks.push(artwork);
    for (let index = 0; index < copies; index += 1) surfaces.push(artwork.surface);
  }
  const first = artworks[0] as VdaArtwork;

  let pages: PdfPageSpec[];
  let sheets = 0;
  if (onSheet) {
    const layout = labelSheet(size.sheet);
    if (!layout) throw invalidInput('That sheet layout is not available.');
    const imposed = refusable(() => imposeOnSheet(surfaces, layout));
    pages = imposed.pages;
    sheets = imposed.sheets;
  } else {
    pages = refusable(() => onePerPage(surfaces));
  }
  const title = `VDA 4902 label (${format === 'klt' ? 'KLT' : 'A5'}) | CloudHost247`;
  const pdf = buildVectorPdf(pages, { title, subject: `VDA 4902 transport label, ${sizeText(size.width, size.height)}` });
  const stem = fileStem(`vda-4902-${format}`, 'vda-4902');

  const notices: string[] = [
    'This label follows the VDA 4902 field set, numbering, data identifiers and Code 39 symbology, in CloudHost247’s own cell arrangement. It is not certified by the VDA. Check sizes, field lengths and wording against the receiving plant’s packaging guideline before production use.',
  ];
  const missing = VDA_FIELDS.filter((field) => field.expected && (values[field.name] ?? '') === '');
  if (missing.length > 0) {
    notices.push(`Left empty: ${missing.map((field) => `(${field.number}) ${field.label.toLowerCase()}`).join(', ')}. Receiving plants normally require these fields.`);
  }
  if (format === 'klt') {
    notices.push('On the KLT format the delivery note number (3) and the supplier part number (11) are printed as text; the part number, quantity, supplier number, package number and batch carry barcodes.');
  }
  if (language !== 'de' && language !== 'en') {
    notices.push('The French, Spanish and Portuguese captions are CloudHost247 translations of the German field names. Use the wording your customer specifies if it differs.');
  }
  // Over every label, not only the first: a package number that gains a digit while counting
  // (…999 to …1000) makes a wider barcode, and so narrower bars, on the labels after it.
  const finest = artworks.reduce((min, artwork) => artwork.barcodes.reduce((least, entry) => Math.min(least, entry.moduleMm), min), Number.POSITIVE_INFINITY);
  if (Number.isFinite(finest) && finest < 0.3) {
    notices.push(
      `The narrowest bars on ${artworks.length > 1 ? 'these labels' : 'this label'} are ${mmText(finest)} mm wide because a value is long for its field. Confirm that your customer accepts that width, or shorten the value.`
    );
  }
  if (numbering) notices.push(`Package numbers run from ${values.packageNumber ?? ''} to ${lastPackage}.`);
  notices.push(onSheet ? 'Print at 100% / “Actual size” with page scaling off, then cut the labels apart.' : 'Each PDF page is exactly one label. Print at 100% / “Actual size”.');
  const seen = new Set(notices);
  for (const artwork of artworks) {
    for (const notice of artwork.notices) {
      if (!seen.has(notice)) {
        seen.add(notice);
        notices.push(notice);
      }
    }
  }

  const facts: StudioFact[] = [
    { label: 'Format', value: size.label },
    { label: 'Label type', value: VDA_LABEL_TYPES.find((entry) => entry.id === labelType)?.label ?? labelType },
    { label: 'Caption language', value: VDA_LANGUAGES.find((entry) => entry.id === language)?.label ?? language },
    { label: 'Labels', value: onSheet ? `${copies} on ${sheets} A4 ${sheets === 1 ? 'sheet' : 'sheets'}` : `${copies}` },
    { label: 'Barcodes', value: `${first.barcodes.length} × Code 39${Number.isFinite(finest) ? `, narrow bar ${mmText(finest)} mm or wider` : ''}` },
    ...first.barcodes.map((entry) => ({ label: `Field ${entry.field} encodes`, value: entry.data })),
  ];

  const previews = [previewOf(first.surface, copies > 1 && numbering ? 'First label' : 'Label')];
  const firstPage = pages[0];
  if (onSheet && firstPage) previews.push(sheetPreview(firstPage, sheets > 1 ? `Sheet 1 of ${sheets}` : 'Sheet'));

  return {
    studio: true,
    title: `VDA 4902 label (${format === 'klt' ? 'KLT' : 'A5'})`,
    previews,
    files: [
      binaryFile(`${stem}.pdf`, 'application/pdf', pdf.bytes, onSheet ? `Download PDF (${sheets} A4 ${sheets === 1 ? 'sheet' : 'sheets'})` : copies === 1 ? 'Download PDF' : `Download PDF (${copies} labels)`, 'The print file. Vector, at true size.'),
      textFile(`${stem}.svg`, 'image/svg+xml', surfaceToSvg(first.surface, { title: 'VDA 4902 label' }), 'Download SVG (one label)', 'Vector artwork of a single label.'),
    ],
    facts,
    notices,
    count: copies,
  };
}
