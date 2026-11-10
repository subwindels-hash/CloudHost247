/**
 * VDA-4902 — the label layout.
 *
 * Two fixed layouts, drawn to the published dimensions: the 210 × 148 mm master tag and the
 * 210 × 74 mm KLT label. Nothing here is scaled to fit a user's page: the page *is* the label, so a
 * PDF printed at 100 % is dimensionally right, which is the only property that matters when the
 * label goes into a goods-in scanner.
 *
 * ## Layout structure (master tag)
 *
 * The tag is a grid of field boxes, and the published sample numbers them 1–15. This layout uses
 * the same reading order and groups them the way the sample does:
 *
 * ```
 * ┌─────────────────────────────┬──────────────┬───────────────┐
 * │ 3 Supplier     │ 4 No.     │ 5 Delivery note │ 6 Date     │   ← supplier / despatch row
 * ├─────────────────────────────┴──────────────┴───────────────┤
 * │ 1 Goods receiver                       │ 2 Delivery plant  │
 * ├────────────────────────────────────────┴───────────────────┤
 * │ 8 Part number        │ 9 Description     │ 10 Qty │ 11 Unit │
 * ├───────────────────────────────────────────────────────────-┤
 * │ 7 Customer no. │ 12 Order │ 13 Delivery date │ 14 Batch │ 15 Serial │
 * ├───────────────────────────────────────────────────────────-┤
 * │  [Code 39 delivery note]              [PDF417 2D content]   │
 * └───────────────────────────────────────────────────────────-┘
 * ```
 *
 * Vertical space for the two symbols is reserved first and the field rows are laid out above them,
 * so a long receiver name can never push the PDF417 code off the page. That ordering is the reason
 * the layout is computed top-down from the *bottom* edge.
 */

import { encodeBarcode, layoutBarcode, type EncodedBarcode } from '../shared/barcode-engine';
import type { DesignDocument, DrawOp } from '../shared/draw-ops';
import { ellipsize, fitTextSize, measureText, wrapText } from '../shared/text-metrics';
import { normaliseHexColour, round, type Issue } from '../shared/validate';
import { vdaFormat, VDA_LIMITATIONS, fieldsForFormat, type VdaFieldSpec } from './spec';
import { buildVda2dPayload, buildVdaLinearValue, toGermanDate, validateVdaData, type VdaData } from './schema';

/** Print colours. Black on white is the only combination a goods-in scanner is specified against. */
const INK = '#000000';
const PAPER = '#ffffff';
/** Frame line weight, in millimetres: thin enough to stay crisp at 300 dpi, thick enough to print. */
const RULE = 0.35;

export interface VdaLabelResult {
  document: DesignDocument;
  issues: Issue[];
  /** The 2D payload, so the page can show (and copy) exactly what the code contains. */
  payload2d: string;
  /** The Code 39 value, or an empty string when the delivery note cannot be encoded. */
  linearValue: string;
  formatId: string;
  sizeMm: { width: number; height: number };
  blocked: boolean;
}

/** Draw a captioned field box and return its ops. */
function fieldBox(
  field: VdaFieldSpec,
  value: string,
  box: { x: number; y: number; w: number; h: number },
  options: { german: boolean; valueSize: number; captionSize: number; bold?: boolean }
): DrawOp[] {
  const ops: DrawOp[] = [];
  ops.push({ kind: 'rect', x: box.x, y: box.y, w: box.w, h: box.h, stroke: INK, strokeWidth: RULE });
  /*
   * Build the caption in whatever fits, from the longest form downwards.
   *
   * "4  SUPPLIER NUMBER / LIEFERANTENNUMMER" does not fit a 38 mm column, and `ellipsize` used to end
   * it at "LIEFERANT…" — a truncated word reads as a different word, and on a goods tag the caption is
   * what a human uses to check the field. So the caption degrades deliberately: both languages, then
   * the English alone, then the German alone, and only then is it ellipsized. Losing a translation is
   * honest; losing the end of a word is not.
   */
  const captionWidth = box.w - 2;
  /*
   * Measure the *upper-cased* caption, because that is what prints.
   *
   * Capitals are wider than lower-case in every font here, so measuring the mixed-case form and then
   * rendering `.toLocaleUpperCase()` under-measures the string by roughly a tenth — which is exactly
   * how "5  DELIVERY NOTE NUMBER / LIEFERSCH…" kept its ellipsis through two rounds of "fixing" the
   * caption.
   */
  const upper = (text: string) => text.toLocaleUpperCase('en-US');
  const candidates = (options.german
    ? [`${field.no}  ${field.label} / ${field.german}`, `${field.no}  ${field.label}`, `${field.no}  ${field.german}`]
    : [`${field.no}  ${field.label}`]
  ).map(upper);
  /*
   * Prefer a full-size caption, then a caption shrunk by no more than 15% (a slightly small caption is
   * still a legible caption), and only then a shorter caption. Below that the difference in size is
   * visible as inconsistent captions across the row, which looks like a rendering fault.
   */
  const floor = options.captionSize * 0.85;
  const fitted = candidates
    .map((candidate) => ({ candidate, size: fitTextSize(candidate, options.captionSize, captionWidth, 'sans').size }))
    .find((entry) => entry.size >= floor)
    ?? { candidate: candidates[candidates.length - 1]!, size: fitTextSize(candidates[candidates.length - 1]!, options.captionSize, captionWidth, 'sans').size };
  const caption = fitted.candidate;
  const captionSize = fitted.size;
  ops.push({
    kind: 'text',
    x: box.x + 1,
    y: box.y + 0.9,
    text: ellipsize(caption, captionSize, box.w - 2, 'sans'),
    size: captionSize,
    family: 'sans',
    color: INK,
    align: 'left',
  });
  const valueTop = box.y + 0.9 + captionSize * 1.15;
  const available = box.h - (valueTop - box.y) - 0.8;
  const lines = wrapText(value === '' ? '' : value, options.valueSize, box.w - 2, options.bold ? 'sans-bold' : 'sans', Math.max(1, Math.floor(available / (options.valueSize * 1.2))));
  ops.push({
    kind: 'lines',
    x: box.x + 1,
    y: valueTop,
    lines,
    size: options.valueSize,
    family: options.bold ? 'sans-bold' : 'sans',
    color: INK,
    lineHeight: options.valueSize * 1.2,
    maxWidth: box.w - 2,
  });
  return ops;
}

/** A labelled region without a numeric field number (the receiver/plant header block). */
function headerBox(
  number: number,
  caption: string,
  value: string,
  box: { x: number; y: number; w: number; h: number },
  options: { valueSize: number; captionSize: number; bold?: boolean }
): DrawOp[] {
  const ops: DrawOp[] = [];
  ops.push({ kind: 'rect', x: box.x, y: box.y, w: box.w, h: box.h, stroke: INK, strokeWidth: RULE });
  ops.push({
    kind: 'text',
    x: box.x + 1,
    y: box.y + 1,
    text: `${number}  ${caption.toLocaleUpperCase('en-US')}`,
    size: options.captionSize,
    family: 'sans',
    color: INK,
    align: 'left',
  });
  const valueTop = box.y + 1 + options.captionSize * 1.3;
  const available = box.h - (valueTop - box.y) - 1;
  const size = options.valueSize;
  const lines = wrapText(value, size, box.w - 2, options.bold ? 'sans-bold' : 'sans', Math.max(1, Math.floor(available / (size * 1.25))));
  ops.push({
    kind: 'lines',
    x: box.x + 1,
    y: valueTop,
    lines,
    size,
    family: options.bold ? 'sans-bold' : 'sans',
    color: INK,
    lineHeight: size * 1.25,
    maxWidth: box.w - 2,
  });
  return ops;
}

function barcodeOp(encoded: EncodedBarcode, x: number, y: number, heightMm: number, showText: boolean): DrawOp {
  const layout = layoutBarcode(encoded, { moduleMm: encoded.moduleMm, barHeightMm: heightMm, showText });
  return {
    kind: 'barcode',
    x,
    y,
    w: layout.widthMm,
    h: layout.heightMm,
    moduleMm: layout.moduleMm,
    encoded,
    colour: INK,
    background: PAPER,
    textHeight: layout.textHeightMm,
    showText: layout.showText,
    quietMm: layout.quietMm,
  };
}

/**
 * Build the VDA label document.
 *
 * Invalid data still produces a document — with the field boxes drawn and the failing fields marked
 * — because an operator fixing a rejected label needs to see the layout, not a blank page. The
 * symbols are omitted in that case: printing a barcode for data that failed validation is the one
 * thing this tool must never do.
 */
export function buildVdaLabel(data: VdaData): VdaLabelResult {
  const issues = validateVdaData(data);
  const blocked = issues.some((issue) => issue.level === 'error');
  const spec = vdaFormat(data.format);
  if (!spec) {
    return {
      document: { title: 'VDA 4902', pages: [{ width: 210, height: 148, ops: [], label: 'VDA 4902' }], warnings: ['Unknown VDA label format.'] },
      issues,
      payload2d: '',
      linearValue: '',
      formatId: data.format,
      sizeMm: { width: 210, height: 148 },
      blocked: true,
    };
  }

  const width = spec.widthMm;
  const height = spec.heightMm;
  const margin = 5;
  const ops: DrawOp[] = [
    { kind: 'rect', x: 0, y: 0, w: width, h: height, fill: PAPER },
  ];
  const content = { x: margin, y: margin, w: width - margin * 2, h: height - margin * 2 };

  const isKlt = spec.id === 'klt';
  const captionSize = isKlt ? 2.1 : 2.4;
  const valueSize = isKlt ? 3.4 : 4.2;

  // Symbols are reserved first: their height is fixed by the standard (13 mm on the master tag,
  // 6 mm on KLT per the barcode-height guidance), and everything else must fit above them.
  const linearValue = buildVdaLinearValue(data);
  let linear: EncodedBarcode | null = null;
  if (linearValue !== '' && !blocked) {
    try {
      linear = encodeBarcode({ formatId: 'code39', payload: linearValue });
    } catch {
      linear = null;
    }
  }

  const symbolBandHeight = isKlt ? 22 : 30;
  const symbolTop = content.y + content.h - symbolBandHeight;

  /* ---------------- field grid ---------------- */
  const gridTop = content.y;
  const gridHeight = symbolTop - gridTop - 1.5;

  if (!isKlt) {
    // Master tag: 4 rows of fields, then the symbol band.
    const rowHeights = [gridHeight * 0.24, gridHeight * 0.22, gridHeight * 0.24, gridHeight * 0.30];
    let y = gridTop;
    const [r1, r2, r3, r4] = rowHeights as [number, number, number, number];

    // Row 1 — supplier block (fields 3, 4, 5, 6)
    const cols1 = [0.34, 0.16, 0.28, 0.22];
    let x = content.x;
    const row1: Array<{ field: number; value: string; fraction: number; bold?: boolean }> = [
      { field: 3, value: data.supplier, fraction: cols1[0]! },
      { field: 4, value: data.supplierNumber, fraction: cols1[1]!, bold: true },
      { field: 5, value: data.deliveryNote, fraction: cols1[2]!, bold: true },
      { field: 6, value: toGermanDate(data.deliveryNoteDate), fraction: cols1[3]! },
    ];
    for (const entry of row1) {
      const field = fieldsForFormat('master').find((item) => item.no === entry.field);
      if (!field) continue;
      const w = content.w * entry.fraction;
      ops.push(...fieldBox(field, entry.value, { x, y, w, h: r1 }, { german: data.germanCaptions, valueSize, captionSize, bold: entry.bold }));
      x += w;
    }
    y += r1;

    // Row 2 — receiver and plant (fields 1, 2)
    const receiverWidth = content.w * 0.62;
    const receiverField = fieldsForFormat('master').find((item) => item.no === 1);
    const plantField = fieldsForFormat('master').find((item) => item.no === 2);
    if (receiverField) ops.push(...headerBox(1, receiverField.label, data.receiver, { x: content.x, y, w: receiverWidth, h: r2 }, { valueSize: valueSize + 1.2, captionSize, bold: true }));
    if (plantField) ops.push(...headerBox(2, plantField.label, data.plant, { x: content.x + receiverWidth, y, w: content.w - receiverWidth, h: r2 }, { valueSize: valueSize + 0.6, captionSize, bold: true }));
    y += r2;

    // Row 3 — part number, description, quantity, unit (fields 8, 9, 10, 11)
    const cols3 = [0.36, 0.36, 0.16, 0.12];
    x = content.x;
    const row3: Array<{ field: number; value: string; fraction: number; bold?: boolean }> = [
      { field: 8, value: data.mixedLoad ? `${data.partNumber}  —  MIXED LOAD / Mischladung` : data.partNumber, fraction: cols3[0]!, bold: true },
      { field: 9, value: data.partDescription, fraction: cols3[1]! },
      { field: 10, value: data.quantity, fraction: cols3[2]!, bold: true },
      { field: 11, value: data.unit, fraction: cols3[3]! },
    ];
    for (const entry of row3) {
      const field = fieldsForFormat('master').find((item) => item.no === entry.field);
      if (!field) continue;
      const w = content.w * entry.fraction;
      ops.push(...fieldBox(field, entry.value, { x, y, w, h: r3 }, { german: data.germanCaptions, valueSize, captionSize, bold: entry.bold }));
      x += w;
    }
    y += r3;

    // Row 4 — customer number, order, dates, batch, serial (fields 7, 12, 13, 14, 15)
    const cols4 = [0.2, 0.2, 0.2, 0.2, 0.2];
    x = content.x;
    const row4: Array<{ field: number; value: string; fraction: number }> = [
      { field: 7, value: data.customerNumber, fraction: cols4[0]! },
      { field: 12, value: data.purchaseOrder, fraction: cols4[1]! },
      { field: 13, value: toGermanDate(data.deliveryDate), fraction: cols4[2]! },
      { field: 14, value: data.batch, fraction: cols4[3]! },
      { field: 15, value: data.serial, fraction: cols4[4]! },
    ];
    for (const entry of row4) {
      const field = fieldsForFormat('master').find((item) => item.no === entry.field);
      if (!field) continue;
      const w = content.w * entry.fraction;
      ops.push(...fieldBox(field, entry.value, { x, y, w, h: r4 }, { german: data.germanCaptions, valueSize: valueSize - 0.2, captionSize }));
      x += w;
    }
  } else {
    // KLT label: three compact rows on a 74 mm tall page.
    const rowHeights = [gridHeight * 0.32, gridHeight * 0.3, gridHeight * 0.38];
    let y = gridTop;
    const [r1, r2, r3] = rowHeights as [number, number, number];

    // Row 1 — supplier, supplier number, delivery note, date
    const cols1 = [0.32, 0.18, 0.28, 0.22];
    let x = content.x;
    const row1: Array<{ field: number; value: string; fraction: number; bold?: boolean }> = [
      { field: 3, value: data.supplier, fraction: cols1[0]! },
      { field: 4, value: data.supplierNumber, fraction: cols1[1]!, bold: true },
      { field: 5, value: data.deliveryNote, fraction: cols1[2]!, bold: true },
      { field: 6, value: toGermanDate(data.deliveryNoteDate), fraction: cols1[3]! },
    ];
    for (const entry of row1) {
      const field = fieldsForFormat('klt').find((item) => item.no === entry.field);
      if (!field) continue;
      const w = content.w * entry.fraction;
      ops.push(...fieldBox(field, entry.value, { x, y, w, h: r1 }, { german: data.germanCaptions, valueSize, captionSize, bold: entry.bold }));
      x += w;
    }
    y += r1;

    // Row 2 — receiver (short form) and plant
    const receiverWidth = content.w * 0.62;
    const receiverField = fieldsForFormat('klt').find((item) => item.no === 1);
    const plantField = fieldsForFormat('klt').find((item) => item.no === 2);
    if (receiverField) ops.push(...headerBox(1, receiverField.label, data.receiver, { x: content.x, y, w: receiverWidth, h: r2 }, { valueSize: valueSize + 0.6, captionSize, bold: true }));
    if (plantField) ops.push(...headerBox(2, plantField.label, data.plant, { x: content.x + receiverWidth, y, w: content.w - receiverWidth, h: r2 }, { valueSize: valueSize + 0.4, captionSize, bold: true }));
    y += r2;

    // Row 3 — part number, description, quantity, unit
    const cols3 = [0.36, 0.36, 0.16, 0.12];
    x = content.x;
    const row3: Array<{ field: number; value: string; fraction: number; bold?: boolean }> = [
      { field: 8, value: data.partNumber, fraction: cols3[0]!, bold: true },
      { field: 9, value: data.partDescription, fraction: cols3[1]! },
      { field: 10, value: data.quantity, fraction: cols3[2]!, bold: true },
      { field: 11, value: data.unit, fraction: cols3[3]! },
    ];
    for (const entry of row3) {
      const field = fieldsForFormat('klt').find((item) => item.no === entry.field);
      if (!field) continue;
      const w = content.w * entry.fraction;
      ops.push(...fieldBox(field, entry.value, { x, y, w, h: r3 }, { german: data.germanCaptions, valueSize, captionSize, bold: entry.bold }));
      x += w;
    }
  }

  /* ---------------- symbols ---------------- */
  const payload = buildVda2dPayload(data);
  const symbolY = symbolTop + 1;
  const availableSymbolHeight = content.y + content.h - symbolY;

  if (!blocked) {
    // Code 39 for the delivery note, at the standard's minimum height.
    if (linear) {
      const linearHeight = Math.min(spec.barcodeHeightMm, availableSymbolHeight - 2);
      const op = barcodeOp(linear, content.x, symbolY, linearHeight, false) as Extract<DrawOp, { kind: 'barcode' }>;
      // If the symbol would run into the 2D area, shrink the module rather than clip the bars.
      if (op.w > content.w * 0.5) {
        const scaled = layoutBarcode(linear, { moduleMm: (linear.moduleMm * (content.w * 0.5 - 4)) / op.w, barHeightMm: linearHeight, showText: false });
        ops.push({ ...op, w: scaled.widthMm, h: scaled.heightMm, moduleMm: scaled.moduleMm, textHeight: scaled.textHeightMm, quietMm: scaled.quietMm, encoded: linear });
        ops.push({
          kind: 'text', x: content.x, y: symbolY + scaled.heightMm + 0.6,
          text: `Code 39 · delivery note ${linear.payload}`, size: 2.1, family: 'sans', color: INK, align: 'left',
        });
      } else {
        ops.push(op);
        ops.push({
          kind: 'text', x: content.x, y: symbolY + op.h + 0.6,
          text: `Code 39 · delivery note ${linear.payload}`, size: 2.1, family: 'sans', color: INK, align: 'left',
        });
      }
    }

    // PDF417 for the 2D content, on the right, sized to the remaining height.
    try {
      const pdf417 = encodeBarcode({ formatId: 'pdf417', payload: payload.payload, columns: 8 });
      const targetHeight = Math.min(availableSymbolHeight, isKlt ? 18 : 24);
      const perUnit = targetHeight / pdf417.heightUnits;
      const w = pdf417.widthUnits * perUnit;
      const x = content.x + content.w - w;
      ops.push({
        kind: 'barcode',
        x: Math.max(content.x + 2, x),
        y: symbolY,
        w,
        h: targetHeight,
        moduleMm: perUnit * (pdf417.xDimension || 1),
        encoded: pdf417,
        colour: INK,
        background: PAPER,
        showText: false,
        textHeight: 0,
        quietMm: 2 * perUnit,
      });
      ops.push({
        kind: 'text',
        x: content.x + content.w,
        y: symbolY + targetHeight + 0.6,
        text: `PDF417 · ${payload.payload.length} characters`,
        size: 2.1,
        family: 'sans',
        color: INK,
        align: 'right',
      });
    } catch (caught) {
      issues.push({
        level: 'warn',
        field: 'payload',
        message: `The PDF417 code could not be generated: ${caught instanceof Error ? caught.message : 'payload too large'}. The label prints without it — reduce the field lengths and try again.`,
      });
    }
  } else {
    ops.push({
      kind: 'lines',
      x: content.x,
      y: symbolY + 2,
      lines: wrapText(
        'Symbols omitted: the label data has errors. Fix the fields listed on the page and the Code 39 and PDF417 codes will be generated.',
        2.6,
        content.w,
        'sans',
        2
      ),
      size: 2.6,
      family: 'sans',
      color: '#b42318',
      lineHeight: 3.4,
      maxWidth: content.w,
    });
  }

  const document: DesignDocument = {
    title: `VDA 4902 v4 — ${spec.name} — ${data.deliveryNote || 'draft'}`,
    subject: 'VDA 4902 goods tag (version 4) generated by CloudHost247 Design Studio',
    creator: 'CloudHost247 Design Studio',
    pages: [{ width, height, ops, label: spec.name }],
    warnings: [
      ...issues.filter((issue) => issue.level === 'error').map((issue) => issue.message),
      // A payload shorter than the label is legitimate (optional fields are blank), but the user has
      // to be told *which* identifiers are missing: a recipient scanning this code sees only what is
      // in it, so a silently shorter payload is a support call waiting to happen.
      ...(payload.omitted.length > 0
        ? [`The PDF417 payload omits: ${payload.omitted.join(', ')}. Fill those fields if the receiving plant requires them.`]
        : []),
      ...VDA_LIMITATIONS.slice(0, 2),
    ],
  };

  return {
    document,
    issues,
    payload2d: payload.payload,
    linearValue,
    formatId: data.format,
    sizeMm: { width, height },
    blocked,
  };
}

/** Text summary used by the API, the results panel and the copy action. */
export function describeVdaLabel(result: VdaLabelResult): string[] {
  const lines = [
    `Format: ${vdaFormat(result.formatId)?.name ?? result.formatId}`,
    `Page size: ${result.sizeMm.width} × ${result.sizeMm.height} mm`,
    `PDF417 content: ${result.payload2d === '' ? '(none)' : `${result.payload2d.length} characters`}`,
    `Code 39 value: ${result.linearValue || '(not encodable)'}`,
  ];
  return lines;
}

/** Width of a caption + value pair, used by the tests to prove nothing overlaps. */
export function measureFieldWidth(value: string, valueSize: number): number {
  return round(measureText(value, valueSize, 'sans'), 2);
}

/** Colour helper kept here so the VDA label stays mono even if a caller passes a colour. */
export function vdaColour(value: string | undefined): string {
  return normaliseHexColour(value ?? INK) ?? INK;
}
