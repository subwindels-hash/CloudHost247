/**
 * Online Label Printing.
 *
 * Pick a template, fill in its fields, choose the label stock and print. Each template is a small
 * layout function written against `LabelCanvas`, so it adapts to the label it is drawn on instead of
 * being a fixed picture: the same asset tag works on a 38 × 21 mm sheet label and on a 100 × 50 mm
 * roll label, and a barcode always keeps a module width a scanner can read or the label is refused.
 *
 * The PDF is the print file. On sheet stock the labels are placed at the positions the sheet's own
 * measurements give, at true size; on single-label stock every page is exactly one label.
 */

import { invalidInput } from '../../core/errors';
import type { ToolInput } from '../../handlers/kit';
import type { StudioSurface } from '../render/draw-ops';
import { SANS_METRICS } from '../render/text-metrics';
import { buildVectorPdf, type PdfPageSpec } from '../render/pdf-vector';
import { surfaceToSvg } from '../render/svg';
import { BarcodeError } from '../barcode/encoder';
import { isLinear, symbologyById } from '../barcode/symbologies';
import {
  CUSTOM_STOCK_ID,
  CUSTOM_STOCK_LIMITS,
  LABEL_STOCKS,
  LABEL_TEMPLATES,
  labelStock,
  labelTemplate,
  type LabelTemplate,
} from '../definitions';
import { LabelCanvas, inset, type Box } from '../shared/compose';
import { imposeOnSheet, onePerPage } from '../shared/impose';
import { choiceOf, decimalNumber, fieldText, flag, incrementTrailingNumber, refusable, wholeNumber } from '../shared/input';
import { binaryFile, fileStem, mmText, previewOf, sheetPreview, sizeText, textFile, type StudioFact, type StudioResult } from '../shared/result';
import { labelSheet, type SheetLayout } from '../shared/sheets';

export const LABEL_COPIES_LIMIT = 300;

const CAP = SANS_METRICS.capHeight;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface Draw {
  canvas: LabelCanvas;
  area: Box;
  /** Body type size (the em) in millimetres, derived from the label's size. */
  base: number;
  gap: number;
  values: Record<string, string>;
  /** The chosen barcode type, or null for a text-only template. */
  symbology: string | null;
}

function value(draw: Draw, name: string): string {
  return draw.values[name] ?? '';
}

function isTwoDimensional(id: string): boolean {
  const symbology = symbologyById(id);
  return symbology !== undefined && !isLinear(symbology);
}

/** The largest size at which `text` fits `width` on one line, capped at `maxSize`. */
function sizeToFit(canvas: LabelCanvas, text: string, width: number, maxSize: number, weight: '400' | '700' = '700'): number {
  const natural = canvas.measure(text, { size: 1, weight });
  return natural <= 0 ? maxSize : Math.min(maxSize, width / natural);
}

function drawAssetTag(draw: Draw): void {
  const { canvas, area, base, gap } = draw;
  const symbology = draw.symbology ?? 'code128';
  const code = value(draw, 'code');
  const heading = value(draw, 'heading');
  const detail = value(draw, 'detail');

  if (isTwoDimensional(symbology)) {
    const side = Math.min(area.h, area.w * 0.46);
    const placed = canvas.symbol({ symbology, data: code, what: 'The asset number code', moduleMm: 1, align: 'left', valign: 'middle' }, { x: area.x, y: area.y, w: side, h: area.h });
    const left = placed.box.x + placed.box.w + gap;
    canvas.stack(
      { x: left, y: area.y, w: area.x + area.w - left, h: area.h },
      [
        { text: heading, size: base * 0.9, weight: '700', maxLines: 2, what: 'The heading' },
        { text: code, size: base * 1.2, weight: '700' },
        { text: detail, size: base * 0.8, maxLines: 2, what: 'The description' },
      ],
      gap
    );
    return;
  }

  let top = area.y;
  let bottom = area.y + area.h;
  if (heading !== '') {
    canvas.lineIn(heading, { x: area.x, y: top, w: area.w, h: base * CAP }, { size: base, weight: '700', align: 'center' });
    top += base * CAP + gap;
  }
  if (detail !== '') {
    const size = base * 0.82;
    bottom -= size * CAP;
    canvas.lineIn(detail, { x: area.x, y: bottom, w: area.w, h: size * CAP }, { size, align: 'center' });
    bottom -= gap;
  }
  const codeSize = base * 1.05;
  bottom -= codeSize * CAP;
  canvas.lineIn(code, { x: area.x, y: bottom, w: area.w, h: codeSize * CAP }, { size: codeSize, weight: '700', align: 'center' });
  bottom -= gap * 0.8;
  canvas.symbol({ symbology, data: code, what: 'The asset number barcode' }, { x: area.x, y: top, w: area.w, h: bottom - top });
}

function drawProductLabel(draw: Draw): void {
  const { canvas, area, base, gap } = draw;
  const symbology = draw.symbology ?? 'ean13';
  const twoDimensional = isTwoDimensional(symbology);
  const price = value(draw, 'price');
  const detail = value(draw, 'detail');

  const nameSize = base * 1.1;
  let top = canvas.paragraph(value(draw, 'name'), { x: area.x, y: area.y, w: area.w, h: nameSize * (CAP + 1.22) + 0.01 }, { size: nameSize, weight: '700', maxLines: 2, minSize: nameSize * 0.8, what: 'The product name' });
  top += gap;
  if (detail !== '') {
    const size = base * 0.85;
    canvas.lineIn(detail, { x: area.x, y: top, w: area.w, h: size * CAP }, { size });
    top += size * CAP + gap;
  }

  const rest: Box = { x: area.x, y: top, w: area.w, h: area.y + area.h - top };
  const spec = {
    symbology,
    data: value(draw, 'code'),
    what: 'The product barcode',
    showText: !twoDimensional,
    moduleMm: twoDimensional ? 1 : 0.33,
    valign: 'bottom',
  } as const;
  if (price === '') {
    canvas.symbol({ ...spec, align: 'center' }, rest);
    return;
  }

  // Where the barcode goes depends on where it scans best. Beside the price is the usual place;
  // a narrow label gives the barcode more of the row, and one too narrow for that puts the price
  // on a line of its own so the barcode has the full width. The first place that gives it a module
  // needing no caution is used; failing that, the place that gives it the widest module. The label
  // is refused only when the barcode fits in none of them.
  const priceLine = base * CAP + gap;
  const layouts: Array<{ code: Box; price: Box; stacked: boolean }> = [0.62, 0.72].map((share) => ({
    code: { ...rest, w: rest.w * share },
    price: { x: rest.x + rest.w * share + gap, y: rest.y, w: rest.w * (1 - share) - gap, h: rest.h },
    stacked: false,
  }));
  layouts.push({
    code: { x: rest.x, y: rest.y + priceLine, w: rest.w, h: rest.h - priceLine },
    price: { x: rest.x, y: rest.y, w: rest.w, h: base * CAP },
    stacked: true,
  });
  let chosen: { layout: (typeof layouts)[number]; moduleMm: number } | null = null;
  let refusal: unknown = null;
  for (const layout of layouts) {
    try {
      const fitted = canvas.measureSymbol(spec, layout.code);
      if (!chosen || fitted.moduleMm > chosen.moduleMm + 1e-9) chosen = { layout, moduleMm: fitted.moduleMm };
      if (fitted.comfortable) {
        chosen = { layout, moduleMm: fitted.moduleMm };
        break;
      }
    } catch (error) {
      if (!(error instanceof BarcodeError) || error.reason !== 'size') throw error;
      refusal = error;
    }
  }
  // The last place tried has the most room, so its refusal is the one that says what is missing.
  if (!chosen) throw refusal;

  const { layout } = chosen;
  canvas.symbol({ ...spec, align: layout.stacked ? 'center' : 'left' }, layout.code);
  if (layout.stacked) {
    canvas.lineIn(price, layout.price, { size: sizeToFit(canvas, price, layout.price.w, base), weight: '700', align: 'right' });
  } else {
    const size = sizeToFit(canvas, price, layout.price.w, Math.min((rest.h * 0.5) / CAP, base * 2.6));
    canvas.lineIn(price, layout.price, { size, weight: '700', align: 'right', valign: 'middle' });
  }
}

function drawQrLabel(draw: Draw): void {
  const { canvas, area, base, gap } = draw;
  const symbology = draw.symbology ?? 'qrcode';
  const heading = value(draw, 'heading');
  const detail = value(draw, 'text');
  const spec = { symbology, data: value(draw, 'content'), what: 'The code', moduleMm: 1.2 } as const;
  const items = [
    { text: heading, size: base * 1.15, weight: '700' as const, maxLines: 2, what: 'The title' },
    { text: detail, size: base * 0.9, maxLines: 4, what: 'The text' },
  ];

  if (heading === '' && detail === '') {
    canvas.symbol({ ...spec, align: 'center', valign: 'middle' }, area);
    return;
  }
  if (area.w >= area.h * 1.2) {
    const side = Math.min(area.h, area.w * 0.48);
    const placed = canvas.symbol({ ...spec, align: 'left', valign: 'middle' }, { x: area.x, y: area.y, w: side, h: area.h });
    const left = placed.box.x + placed.box.w + gap * 1.2;
    canvas.stack({ x: left, y: area.y, w: area.x + area.w - left, h: area.h }, items, gap);
    return;
  }
  const textHeight = Math.min(area.h * 0.34, base * 6);
  const side = Math.min(area.w, area.h - textHeight - gap);
  const placed = canvas.symbol({ ...spec, align: 'center', valign: 'top' }, { x: area.x, y: area.y, w: area.w, h: side });
  const topOfText = placed.box.y + placed.box.h + gap;
  canvas.stack({ x: area.x, y: topOfText, w: area.w, h: area.y + area.h - topOfText }, items, gap, 'center', 'top');
}

function drawPartSerial(draw: Draw): void {
  const { canvas, area, base, gap } = draw;
  const symbology = draw.symbology ?? 'code128';
  const heading = value(draw, 'heading');
  let top = area.y;
  if (heading !== '') {
    canvas.lineIn(heading, { x: area.x, y: top, w: area.w, h: base * CAP }, { size: base, weight: '700' });
    top += base * CAP + gap;
  }
  const rowHeight = (area.y + area.h - top - gap) / 2;
  const rows: Array<[string, string, string]> = [
    ['PART NO.', value(draw, 'part'), 'The part number barcode'],
    ['SERIAL NO.', value(draw, 'code'), 'The serial number barcode'],
  ];
  rows.forEach(([caption, text, what], index) => {
    const y = top + index * (rowHeight + gap);
    const captionSize = base * 0.66;
    const valueSize = base * 0.95;
    const captionWidth = canvas.measure(caption, { size: captionSize, weight: '700' });
    const baseline = y + valueSize * CAP;
    canvas.text(caption, area.x, baseline, { size: captionSize, weight: '700', color: '#333333' });
    canvas.text(text, area.x + captionWidth + base * 0.5, baseline, { size: valueSize, weight: '700', maxWidth: area.w - captionWidth - base * 0.5 });
    const barcodeTop = baseline + gap * 0.7;
    canvas.symbol({ symbology, data: text, what }, { x: area.x, y: barcodeTop, w: area.w, h: y + rowHeight - barcodeTop });
  });
}

function drawShelfLabel(draw: Draw): void {
  const { canvas, area, base, gap } = draw;
  const symbology = draw.symbology ?? 'code128';
  const code = value(draw, 'code');
  const detail = value(draw, 'detail');

  if (isTwoDimensional(symbology)) {
    const side = Math.min(area.h, area.w * 0.4);
    const placed = canvas.symbol({ symbology, data: code, what: 'The location code', moduleMm: 1, align: 'right', valign: 'middle' }, { x: area.x + area.w - side, y: area.y, w: side, h: area.h });
    const width = placed.box.x - gap - area.x;
    const big = sizeToFit(canvas, code, width, (area.h * 0.5) / CAP);
    canvas.stack({ x: area.x, y: area.y, w: width, h: area.h }, [{ text: code, size: big, weight: '700' }, { text: detail, size: base * 0.85, maxLines: 2, what: 'The description' }], gap);
    return;
  }

  let bottom = area.y + area.h;
  if (detail !== '') {
    const size = base * 0.82;
    bottom -= size * CAP;
    canvas.lineIn(detail, { x: area.x, y: bottom, w: area.w, h: size * CAP }, { size, align: 'center' });
    bottom -= gap;
  }
  const big = sizeToFit(canvas, code, area.w, (area.h * 0.36) / CAP);
  canvas.lineIn(code, { x: area.x, y: area.y, w: area.w, h: big * CAP }, { size: big, weight: '700', align: 'center' });
  const top = area.y + big * CAP + gap;
  canvas.symbol({ symbology, data: code, what: 'The location barcode' }, { x: area.x, y: top, w: area.w, h: bottom - top });
}

function drawAddressLabel(draw: Draw): void {
  const { canvas, area, base, gap } = draw;
  const sender = value(draw, 'sender');
  let top = area.y;
  if (sender !== '') {
    const size = base * 0.72;
    canvas.lineIn(sender, { x: area.x, y: top, w: area.w, h: size * CAP }, { size, color: '#333333' });
    top += size * CAP + gap * 0.7;
    canvas.line(area.x, top, area.x + area.w, top, 0.15, '#555555');
    top += gap;
  }
  const indent = base * 0.6;
  canvas.stack(
    { x: area.x + indent, y: top, w: area.w - 2 * indent, h: area.y + area.h - top },
    [
      { text: value(draw, 'name'), size: base * 1.2, weight: '700' },
      { text: value(draw, 'address'), size: base * 1.08, maxLines: 6, what: 'The address' },
    ],
    gap * 0.9
  );
}

const RENDERERS: Record<string, (draw: Draw) => void> = {
  'asset-tag': drawAssetTag,
  'product-label': drawProductLabel,
  'qr-label': drawQrLabel,
  'part-serial': drawPartSerial,
  'shelf-label': drawShelfLabel,
  'address-label': drawAddressLabel,
};

export interface LabelArtwork {
  surface: StudioSurface;
  notices: string[];
  /**
   * Every symbol on the label, in drawing order. `carries` is its full content, check digit
   * included; `box` is the space it occupies on the label, quiet zone included.
   */
  symbols: Array<{ name: string; moduleMm: number; data: string; carries: string; box: Box }>;
}

/** Draw one label. Exposed so the tests can read a label back without going through the PDF. */
export function drawLabel(template: LabelTemplate, values: Record<string, string>, width: number, height: number, options: { symbology: string | null; border: boolean }): LabelArtwork {
  const renderer = RENDERERS[template.id];
  if (!renderer) throw invalidInput('That label template is not available.');
  const canvas = new LabelCanvas(width, height);
  const padding = clamp(Math.min(width, height) * 0.07, 1, 3.5);
  const base = clamp(Math.min(width * 0.052, height * 0.105), 1.7, 4.2);
  renderer({ canvas, area: inset(canvas.bounds, padding), base, gap: base * 0.45, values, symbology: options.symbology });
  if (options.border) canvas.frame(canvas.bounds, 0.2);
  const { surface, notices } = canvas.finish();
  return { surface, notices, symbols: canvas.symbols.map((placed) => ({ name: placed.symbologyName, moduleMm: placed.moduleMm, data: placed.data, carries: placed.carries, box: placed.box })) };
}

export async function runLabelDesigner(input: ToolInput): Promise<StudioResult> {
  const templateId = choiceOf(input, 'template', 'Template', LABEL_TEMPLATES.map((entry) => entry.id), 'asset-tag');
  const template = labelTemplate(templateId) as LabelTemplate;

  // ----- Stock -----
  const stockId = choiceOf(input, 'stock', 'Label stock', [...LABEL_STOCKS.map((entry) => entry.id), CUSTOM_STOCK_ID], template.defaultStock);
  let width: number;
  let height: number;
  let stockLabel: string;
  let sheet: SheetLayout | null = null;
  if (stockId === CUSTOM_STOCK_ID) {
    const customWidth = decimalNumber(input, 'widthMm', 'Label width', { min: CUSTOM_STOCK_LIMITS.minWidth, max: CUSTOM_STOCK_LIMITS.maxWidth });
    const customHeight = decimalNumber(input, 'heightMm', 'Label height', { min: CUSTOM_STOCK_LIMITS.minHeight, max: CUSTOM_STOCK_LIMITS.maxHeight });
    if (customWidth === undefined || customHeight === undefined) throw invalidInput('Enter the width and height of your label in millimetres.');
    width = customWidth;
    height = customHeight;
    stockLabel = `Custom label · ${sizeText(width, height)}`;
  } else {
    const stock = labelStock(stockId);
    if (!stock) throw invalidInput('That label stock is not available.');
    width = stock.width;
    height = stock.height;
    stockLabel = stock.label;
    sheet = stock.sheet ? (labelSheet(stock.sheet) ?? null) : null;
  }
  if (width < template.minWidth - 0.01 || height < template.minHeight - 0.01) {
    throw invalidInput(`The “${template.name}” template needs a label of at least ${template.minWidth} × ${template.minHeight} mm; this one is ${sizeText(width, height)}.`, { reason: 'LABEL_TOO_SMALL' });
  }

  // ----- Content -----
  const values: Record<string, string> = {};
  for (const field of template.fields) {
    values[field.name] = fieldText(input, {
      name: field.name,
      label: field.label.replace(/ \(optional\)$/, ''),
      maxLength: field.maxLength,
      multiline: field.type === 'textarea',
      ...(field.required ? { required: true } : {}),
      ...(field.type === 'textarea' ? { maxLines: 6 } : {}),
    });
  }
  // A barcode type the template does not offer falls back to the template's own first type and is
  // reported: a plain form lists every type, and refusing the label over it would help nobody.
  let symbology: string | null = null;
  let symbologyNotice: string | null = null;
  if (template.symbologies.length > 0) {
    const requested = typeof input.symbology === 'string' ? input.symbology.trim().toLowerCase() : '';
    const fallback = template.symbologies[0] as string;
    if (requested === '' || template.symbologies.includes(requested)) {
      symbology = requested === '' ? fallback : requested;
    } else {
      symbology = fallback;
      const wanted = symbologyById(requested);
      symbologyNotice = `The “${template.name}” template does not offer ${wanted ? wanted.name : 'that barcode type'}, so ${symbologyById(fallback)?.name ?? fallback} was used.`;
    }
  }

  const copies = wholeNumber(input, 'copies', 'Number of labels', { min: 1, max: LABEL_COPIES_LIMIT, fallback: 1 });
  const numbering = template.numbering && flag(input, 'numbering', false);
  const border = flag(input, 'border', false);
  const startPosition = sheet ? wholeNumber(input, 'startPosition', 'First label position', { min: 1, max: sheet.columns * sheet.rows, fallback: 1 }) : 1;
  const outlines = sheet !== null && flag(input, 'outlines', false);

  const codeField = template.codeField;
  if (numbering && codeField && copies > 1 && incrementTrailingNumber(values[codeField] ?? '', 0) === null) {
    throw invalidInput('To number the labels, the value must contain a number to count from, for example CH-000123.');
  }

  // ----- Artwork -----
  const artworks: LabelArtwork[] = [];
  const surfaces: StudioSurface[] = [];
  const draw = (labelValues: Record<string, string>): LabelArtwork => refusable(() => drawLabel(template, labelValues, width, height, { symbology, border }));
  let numberedTo: string | null = null;
  if (numbering && codeField && copies > 1) {
    for (let index = 0; index < copies; index += 1) {
      const next = incrementTrailingNumber(values[codeField] ?? '', index) as string;
      const artwork = draw({ ...values, [codeField]: next });
      artworks.push(artwork);
      surfaces.push(artwork.surface);
      numberedTo = next;
    }
  } else {
    const artwork = draw(values);
    artworks.push(artwork);
    // The same surface object repeated: the PDF stores the artwork once and places it many times.
    for (let index = 0; index < copies; index += 1) surfaces.push(artwork.surface);
  }
  const first = artworks[0] as LabelArtwork;

  // ----- Print file -----
  let pages: PdfPageSpec[];
  let sheets = 0;
  if (sheet) {
    const layout = sheet;
    const imposed = refusable(() => imposeOnSheet(surfaces, layout, { skip: startPosition - 1, outlines }));
    pages = imposed.pages;
    sheets = imposed.sheets;
  } else {
    pages = refusable(() => onePerPage(surfaces));
  }
  const title = `${template.name} | CloudHost247 Online Label Printing`;
  const pdf = buildVectorPdf(pages, { title, subject: `${template.name}, ${sizeText(width, height)}` });
  const stem = fileStem(`${template.id}-${mmText(width)}x${mmText(height)}mm`, 'labels');

  const notices = new Set<string>();
  if (symbologyNotice) notices.add(symbologyNotice);
  for (const artwork of artworks) for (const notice of artwork.notices) notices.add(notice);
  if (numberedTo !== null && codeField) {
    notices.add(`Labels are numbered from ${values[codeField] ?? ''} to ${numberedTo}.`);
  }
  if (sheet) {
    notices.add('Print at 100% / “Actual size” with page scaling off, or the labels will not line up with the sheet.');
    if (outlines) notices.add('Position outlines are printed. Use them for a test on plain paper, then turn them off for the label sheet.');
  } else {
    notices.add('Each PDF page is exactly one label. Select your label size in the printer settings and print at 100%.');
  }
  for (const message of pdf.skippedImages) notices.add(message);

  const facts: StudioFact[] = [
    { label: 'Template', value: template.name },
    { label: 'Label size', value: sizeText(width, height) },
    { label: 'Stock', value: stockLabel },
    { label: 'Labels', value: sheet ? `${copies} on ${sheets} ${sheets === 1 ? 'sheet' : 'sheets'}` : `${copies}` },
  ];
  // In a numbered run every label carries a different value, so the fact says which label it describes.
  const whichLabel = numberedTo !== null ? ' on the first label' : '';
  first.symbols.slice(0, 3).forEach((symbol, index) => {
    // The full content of the symbol: a retail number entered without its check digit has gained one.
    const data = symbol.carries.length > 60 ? `${symbol.carries.slice(0, 57)}…` : symbol.carries;
    facts.push({ label: `${first.symbols.length > 1 ? `Barcode ${index + 1}` : 'Barcode'}${whichLabel}`, value: `${symbol.name}, ${mmText(symbol.moduleMm)} mm module, encodes “${data}”` });
  });

  const previews = [previewOf(first.surface, numbering && artworks.length > 1 ? 'First label' : 'Label')];
  const firstPage = pages[0];
  if (sheet && firstPage) previews.push(sheetPreview(firstPage, sheets > 1 ? `Sheet 1 of ${sheets}` : 'Sheet'));

  return {
    studio: true,
    title: template.name,
    previews,
    files: [
      binaryFile(`${stem}.pdf`, 'application/pdf', pdf.bytes, sheet ? `Download PDF (${sheets} ${sheets === 1 ? 'sheet' : 'sheets'})` : copies === 1 ? 'Download PDF' : `Download PDF (${copies} labels)`, 'The print file. Vector, at true size.'),
      textFile(`${stem}.svg`, 'image/svg+xml', surfaceToSvg(first.surface, { title: template.name }), 'Download SVG (one label)', 'Vector artwork of a single label, for other design software.'),
    ],
    facts,
    notices: [...notices],
    count: copies,
  };
}
