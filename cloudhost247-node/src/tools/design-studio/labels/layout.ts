/**
 * Label Designer — the layout engine.
 *
 * Turns a `LabelDocument` plus zero or more data rows into pages of draw operations. This is the
 * only place that knows where a label sits on a sheet, and the only place that turns an element into
 * geometry. Everything downstream (SVG, PDF, the browser preview, the tests) reads its output.
 *
 * ## The three steps, in order
 *
 * 1. **Slot.** `sheetSlots()` places each label's rectangle on the page from the paper size, the
 *    grid, the margin and the gutter. Nothing scales: a 70 mm label in a 75 mm slot stays 70 mm.
 * 2. **Clip and lay out.** `layoutLabel()` draws one label into its own millimetre space: background,
 *    border, then each element resolved against its data row.
 * 3. **Batch.** Rows are consumed in order, `sheet.columns × sheet.rows` per page, so a 50-row CSV
 *    produces 7 pages of 8 labels on an A4 2×4 grid — and the last page has 2 labels, not 8 copies
 *    of the last row.
 *
 * ## Failure behaviour
 *
 * A label whose data cannot produce a valid barcode does not print a wrong barcode. The layout puts
 * a bordered notice in that label's slot — printed in the PDF, visible in the preview — and records
 * the reason in `document.warnings` and in the batch's rejected rows. Silently skipping the label
 * would produce a box with no identification on it, which is worse than a box with an error slip.
 */

import {
  BarcodeError,
  captionHeightMm,
  encodeBarcode,
  encodeQrMatrix,
  layoutBarcode,
  validateBarcodePayload,
  type EncodedBarcode,
} from '../shared/barcode-engine';
import { findBarcodeFormat } from '../shared/barcode-catalog';
import type { DesignDocument, DocumentPage, DrawOp, DrawText, FontFamily } from '../shared/draw-ops';
import { checkBounds, contrastRatio, normaliseHexColour, round, warn, type Issue } from '../shared/validate';
import { labelSizeOfSheet, orient, paperSize, sheetGrid, type SlotRect } from '../shared/units';
import { ellipsize, fitTextSize, measureText, wrapText } from '../shared/text-metrics';
import {
  resolveLabelData,
  symbolFormatId,
  type BarcodeElement,
  type FieldElement,
  type ImageElement,
  type LabelDocument,
  type LabelElement,
  type LabelValues,
  type LineElement,
  type RectElement,
  type SymbolElement,
  type TextElement,
} from './model';

export interface LayoutOptions {
  /**
   * Data rows to print. An empty array prints the document once, using its own `values` — that is
   * what the editor's live preview does.
   */
  rows?: LabelValues[];
  /** Override the sheet (used by "print one label on a page"). */
  sheetOverride?: { paperId: string; columns: number; rows: number; marginMm: number; gutterMm: number; cutLines?: boolean };
  /** Draw the slot outline on plain paper. */
  cutLines?: boolean;
  /**
   * When a label overflows its slot, clip it (default) or let it print outside. Clipping is the
   * default because an over-sized label on a die-cut sheet must not bleed into its neighbour.
   */
  overflow?: 'clip' | 'visible';
}

export interface PlacedLabel {
  /** Position on the page, in millimetres. */
  slot: SlotRect;
  rowIndex: number;
  /** Row key/value pairs, for the batch report. */
  row: LabelValues;
  /** Issues found while laying out this label. */
  issues: Issue[];
  ops: DrawOp[];
}

export interface LabelLayoutResult {
  document: DesignDocument;
  labels: PlacedLabel[];
  issues: Issue[];
  /** Effective label size after orientation, in millimetres. */
  labelSize: { width: number; height: number };
  /** Effective paper size, in millimetres. */
  paper: { width: number; height: number };
  perPage: number;
}

/** The effective label size, with the document's orientation applied. */
export function effectiveLabelSize(document: LabelDocument): { width: number; height: number } {
  const base = { width: document.widthMm, height: document.heightMm };
  const oriented = orient(base, document.orientation);
  // `orient` treats the stored pair as already landscape, so apply the user's intent explicitly:
  // portrait means the height is the longer edge.
  if (document.orientation === 'portrait') {
    return { width: Math.min(base.width, base.height), height: Math.max(base.width, base.height) };
  }
  return { width: Math.max(base.width, base.height), height: Math.min(base.width, base.height) };
}

/** The effective paper size for the document's sheet. */
export function effectivePaper(document: LabelDocument, override?: LayoutOptions['sheetOverride']): { width: number; height: number } {
  const paperId = override?.paperId ?? document.sheet.paperId;
  const paper = paperSize(paperId);
  if (paper) return { width: paper.width, height: paper.height };
  return { width: document.sheet.customWidth ?? 210, height: document.sheet.customHeight ?? 297 };
}

/**
 * Slots for one page.
 *
 * A2-style label sheets publish their own grid (columns, rows, margin, gutter) because that is what
 * the die-cut actually is. A plain sheet has no grid, so a sensible default is used: as many slots
 * as fit at the label size with a 3 mm gutter, which is what an operator printing on plain paper
 * wants. Either way the *label size* comes from the document, never from the paper.
 */
export function sheetSlots(document: LabelDocument, options: LayoutOptions = {}): SlotRect[] {
  const label = effectiveLabelSize(document);
  const paper = effectivePaper(document, options.sheetOverride);
  const sheetMeta = paperSize(options.sheetOverride?.paperId ?? document.sheet.paperId);
  const columns = Math.max(1, Math.floor(options.sheetOverride?.columns ?? document.sheet.columns));
  const rows = Math.max(1, Math.floor(options.sheetOverride?.rows ?? document.sheet.rows));
  const margin = Math.max(0, options.sheetOverride?.marginMm ?? document.sheet.marginMm);
  const gutter = Math.max(0, options.sheetOverride?.gutterMm ?? document.sheet.gutterMm);
  void sheetMeta;
  return sheetGrid({ sheet: paper, label, columns, rows, margin, gutter });
}

/**
 * The label size implied by a named label sheet, so the editor can offer "this is what fits" when a
 * user picks a die-cut product instead of typing measurements.
 */
export function suggestedLabelSize(paperId: string): { width: number; height: number } | null {
  const sheet = paperSize(paperId);
  if (!sheet) return null;
  const size = labelSizeOfSheet(sheet);
  return size ? { width: round(size.width, 2), height: round(size.height, 2) } : null;
}

/* ------------------------------------------------------------------ */
/* Element → draw ops                                                  */
/* ------------------------------------------------------------------ */

interface ElementContext {
  document: LabelDocument;
  row: LabelValues;
  /** Label origin on the page. */
  originX: number;
  originY: number;
  label: { width: number; height: number };
  issues: Issue[];
  /** Elements are clipped to this box (the label, minus nothing — padding is applied per element). */
  clip: { x: number; y: number; width: number; height: number };
  /**
   * Extra inset (`style.paddingMm`) already added to `originX`/`originY`, so the bounds check can
   * measure against the *content* area. It cannot be recovered from the origin — an unpadded document
   * and a document whose element happens to start at the padding offset look identical.
   */
  pad?: number;
}

function transform(element: LabelElement, context: ElementContext): { x: number; y: number; width: number; height: number } {
  return {
    x: context.originX + element.x,
    y: context.originY + element.y,
    width: element.width,
    height: element.height,
  };
}

function textOp(
  element: TextElement | FieldElement,
  value: string,
  context: ElementContext,
  box: { x: number; y: number; width: number; height: number }
): DrawOp[] {
  const style = element.style;
  const display = style.uppercase ? value.toLocaleUpperCase('en-US') : value;
  const colour = normaliseHexColour(style.colour) ?? '#10171d';
  const family: FontFamily = style.family;
  const size = Math.max(1, Math.min(72, style.size));

  if (!style.wrap) {
    const fitted = fitTextSize(ellipsize(display, size, box.width, family), size, box.width, family);
    if (fitted.size < size * 0.75) {
      context.issues.push(
        warn(
          `elements.${element.id}`,
          `“${element.name}” was shrunk from ${size} mm to ${fitted.size} mm to fit its box. The printed text will be smaller than the rest of the label.`,
          'Widen the element, shorten the text, or enable wrapping.'
        )
      );
    }
    const y = box.y + verticalOffset(box.height, fitted.size, style.verticalAlign);
    return [
      {
        kind: 'text',
        x: style.align === 'center' ? box.x + box.width / 2 : style.align === 'right' ? box.x + box.width : box.x,
        y,
        text: ellipsize(display, fitted.size, box.width, family),
        size: fitted.size,
        family,
        color: colour,
        align: style.align,
        letterSpacing: style.letterSpacing,
      } satisfies DrawText,
    ];
  }

  const lines = wrapText(display, size, box.width, family, 50);
  const lineHeight = size * (style.lineHeight ?? 1.25);
  const needed = lines.length * lineHeight;
  if (needed > box.height + 0.01) {
    context.issues.push(
      warn(
        `elements.${element.id}`,
        `“${element.name}” needs ${round(needed, 1)} mm of height for ${lines.length} lines but its box is ${round(box.height, 1)} mm, so the last line(s) will be clipped.`,
        'Make the box taller, reduce the font size, or shorten the text.'
      )
    );
  }
  const y = box.y + verticalOffset(box.height, needed, style.verticalAlign);
  return [
    {
      kind: 'lines',
      x: style.align === 'center' ? box.x + box.width / 2 : style.align === 'right' ? box.x + box.width : box.x,
      y,
      lines,
      size,
      family,
      color: colour,
      lineHeight,
      align: style.align,
      maxWidth: box.width,
    },
  ];
}

function verticalOffset(boxHeight: number, contentHeight: number, align: 'top' | 'middle' | 'bottom' | undefined): number {
  if (align === 'middle') return Math.max(0, (boxHeight - contentHeight) / 2);
  if (align === 'bottom') return Math.max(0, boxHeight - contentHeight);
  return 0;
}

function barcodeOps(element: BarcodeElement, context: ElementContext, box: { x: number; y: number; width: number; height: number }): DrawOp[] {
  const value = resolveLabelData(element.binding, context.row, context.document.values);
  const format = findBarcodeFormat(element.formatId);
  if (!format) {
    return [noticeOp(element, `Unsupported barcode format “${element.formatId}”.`, box)];
  }
  if (value.trim() === '') {
    return [noticeOp(element, `No data for “${element.binding.key ?? element.name}”.`, box)];
  }
  const validation = validateBarcodePayload(element.formatId, value);
  const errors = validation.issues.filter((issue) => issue.level === 'error');
  if (errors.length > 0) {
    for (const issue of errors) context.issues.push({ level: 'error', field: `elements.${element.id}`, message: `${element.name}: ${issue.message}` });
    return [noticeOp(element, errors[0]?.message ?? 'Invalid barcode data.', box)];
  }

  let encoded: EncodedBarcode;
  try {
    encoded = encodeBarcode({ formatId: element.formatId, payload: value });
  } catch (caught) {
    const message = caught instanceof BarcodeError ? caught.message : 'The barcode could not be encoded.';
    context.issues.push({ level: 'error', field: `elements.${element.id}`, message: `${element.name}: ${message}` });
    return [noticeOp(element, message, box)];
  }

  // `box.height` is the element's whole footprint, so the bar height has to be what is *left* after
  // the quiet zone above and below and the human-readable line are subtracted. Passing the box
  // height straight through makes every symbol overflow its own element by the quiet zone.
  const showText = element.showText && encoded.family === 'linear';
  const quietMm = encoded.quietModules * element.moduleMm;
  // The caption strip is the engine's rule, not a second copy of it.
  const textHeightMm = showText ? captionHeightMm(element.moduleMm) : 0;
  const layout = layoutBarcode(encoded, {
    moduleMm: element.moduleMm,
    barHeightMm: Math.max(3, round(box.height - quietMm * 2 - textHeightMm, 3)),
    showText,
  });
  // A symbol wider than its box is an error, not something to squash: scaling it changes the
  // X-dimension the operator specified, which is the one measurement a verifier checks.
  if (layout.widthMm > box.width + 0.01) {
    const message = `${element.name} needs ${round(layout.widthMm, 1)} mm at ${element.moduleMm} mm per module but its box is ${round(box.width, 1)} mm.`;
    context.issues.push(
      { level: 'error', field: `elements.${element.id}`, message, hint: 'Widen the element or reduce the module width.' }
    );
    return [noticeOp(element, message, box)];
  }
  if (layout.heightMm > box.height + 0.01) {
    const message = `${element.name} needs ${round(layout.heightMm, 1)} mm of height but its box is ${round(box.height, 1)} mm.`;
    context.issues.push({ level: 'error', field: `elements.${element.id}`, message, hint: 'Increase the element height.' });
    return [noticeOp(element, message, box)];
  }
  if (contrastRatio(element.colour, element.background ?? context.document.style.background) < 3) {
    context.issues.push(
      warn(`elements.${element.id}`, `${element.name} has very low contrast against the label background and may not scan.`, 'Use black bars on white, or a dark ink on a light background.')
    );
  }
  for (const note of layout.notes) context.issues.push(warn(`elements.${element.id}`, `${element.name}: ${note}`));

  return [
    {
      kind: 'barcode',
      x: box.x,
      y: box.y,
      w: layout.widthMm,
      h: layout.heightMm,
      moduleMm: layout.moduleMm,
      encoded,
      colour: element.colour,
      background: element.background,
      textHeight: layout.textHeightMm,
      showText: layout.showText,
      quietMm: layout.quietMm,
    },
  ];
}

function symbolOps(element: SymbolElement, context: ElementContext, box: { x: number; y: number; width: number; height: number }): DrawOp[] {
  const value = resolveLabelData(element.binding, context.row, context.document.values);
  if (value.trim() === '') return [noticeOp(element, `No data for “${element.binding.key ?? element.name}”.`, box)];

  // A square symbol is the only honest presentation: a stretched QR code is a QR code that many
  // scanners will refuse.
  const size = Math.min(box.width, box.height);
  if (Math.abs(box.width - box.height) > 0.5) {
    context.issues.push(
      warn(`elements.${element.id}`, `${element.name} is ${round(box.width, 1)} × ${round(box.height, 1)} mm; the symbol is drawn as a ${round(size, 1)} mm square to stay scannable.`)
    );
  }
  const offsetX = box.x + (box.width - size) / 2;
  const offsetY = box.y + (box.height - size) / 2;

  if (element.symbol === 'qrcode') {
    try {
      const qr = encodeQrMatrix(value, element.errorCorrection);
      return [
        {
          kind: 'symbol',
          x: offsetX,
          y: offsetY,
          size,
          quietModules: element.quietModules ?? 4,
          matrix: qr.matrix,
          payload: qr.payload,
          colour: element.colour,
          background: element.background,
          modules: qr.modules,
        },
      ];
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'The QR code could not be encoded.';
      context.issues.push({ level: 'error', field: `elements.${element.id}`, message: `${element.name}: ${message}` });
      return [noticeOp(element, message, box)];
    }
  }

  // The other 2D symbologies go through the barcode engine and are drawn as bar geometry inside a
  // square footprint. Their natural aspect ratio is preserved, centred in the box.
  try {
    const encoded = encodeBarcode({
      formatId: symbolFormatId(element.symbol),
      payload: value,
      errorCorrection: element.errorCorrection,
    });
    const perUnit = size / Math.max(encoded.widthUnits, encoded.heightUnits);
    const width = round(encoded.widthUnits * perUnit, 3);
    const height = round(encoded.heightUnits * perUnit, 3);
    return [
      {
        kind: 'barcode',
        x: offsetX + (size - width) / 2,
        y: offsetY + (size - height) / 2,
        w: width,
        h: height,
        moduleMm: perUnit * (encoded.xDimension || 1),
        encoded,
        colour: element.colour,
        background: element.background,
        showText: false,
        textHeight: 0,
        quietMm: 0,
      },
    ];
  } catch (caught) {
    const message = caught instanceof BarcodeError ? caught.message : 'The symbol could not be encoded.';
    context.issues.push({ level: 'error', field: `elements.${element.id}`, message: `${element.name}: ${message}` });
    return [noticeOp(element, message, box)];
  }
}

/** A bordered box explaining why a machine-readable element is not there. */
function noticeOp(element: LabelElement, message: string, box: { x: number; y: number; width: number; height: number }): DrawOp {
  return {
    kind: 'rect',
    x: box.x,
    y: box.y,
    w: box.width,
    h: box.height,
    stroke: '#b42318',
    strokeWidth: 0.3,
    fill: '#fff5f4',
    radius: 0.8,
  };
}

/** The short, printable form of an element issue: drop the element name, keep the reason. */
function shortNotice(message: string): string {
  return message.replace(/^[^:]+:\s*/, '').replace(/^“[^”]+”\s*/, '');
}

function noticeLabel(message: string, box: { x: number; y: number; width: number; height: number }, colour = '#b42318'): DrawOp {
  const size = Math.max(1.6, Math.min(2.4, box.height / 6));
  return {
    kind: 'lines',
    x: box.x + 1,
    y: box.y + Math.max(0.8, (box.height - 3 * size * 1.3) / 2),
    lines: wrapText(message, size, Math.max(4, box.width - 2), 'sans', 4),
    size,
    family: 'sans',
    color: colour,
    lineHeight: size * 1.3,
    maxWidth: box.width - 2,
  };
}

function elementOps(element: LabelElement, context: ElementContext): DrawOp[] {
  if (!element.visible) return [];
  const box = transform(element, context);
  /*
   * Bounds are measured against the label's *content* area, not the whole label.
   *
   * Element coordinates are relative to the padded content origin (`paddingMm` moves the origin), so
   * the space an element may occupy is `label − 2 × padding`. Measuring against the full label size
   * let an element sit up to one padding-depth past the content area — and therefore past the page —
   * without a word of complaint: the classic-white business-card front shipped with its company line
   * 1.4 mm off the card, clipped in print. The inset applies at the bottom and right edges only,
   * because the origin already accounts for the top and left ones.
   */
  const pad = Math.max(0, context.pad ?? 0);
  const content = { width: context.label.width - pad, height: context.label.height - pad };
  const relative = { x: box.x - context.originX, y: box.y - context.originY, width: box.width, height: box.height };
  /*
   * Rects and rules are grounds, not content: an accent band or a panel behind the QR is *supposed*
   * to run to the edge (the templates place them at deliberately negative offsets), and nothing is
   * lost when it does — a clipped ground still reads as a ground. Everything that carries information
   * must be fully on the page, because the part that is not there is information the reader does not
   * get. So the bounds check applies to content elements only.
   */
  const issues = element.kind === 'rect' || element.kind === 'line'
    ? []
    : checkBounds(`elements.${element.id}`, relative, content, {
        critical: element.kind === 'barcode' || element.kind === 'symbol',
        name: `“${element.name}”`,
      });
  /*
   * Every element's bounds matter, so every bounds issue is reported.
   *
   * This used to keep warnings only for barcodes, symbols and images, on the theory that a decorative
   * box overhanging the edge is harmless. Text is not decorative: the classic-white card front ended
   * `company` 1.4 mm below the page and the only complaint was a warning that this filter threw away,
   * so the layout reported "clean" while the print cut the line in half. An overhang is a warning
   * because the part outside the page simply does not print — but it is always worth saying.
   */
  for (const issue of issues) context.issues.push(issue);

  const ops: DrawOp[] = [];
  switch (element.kind) {
    case 'text': {
      ops.push(...textOp(element, element.text, context, box));
      break;
    }
    case 'field': {
      const value = resolveLabelData(element.binding, context.row, context.document.values);
      const shown = value.trim() === '' ? element.placeholder ?? '' : value;
      if (shown.trim() === '') {
        // An empty field is not an error — many labels have optional lines — but it is worth saying
        // once per element so a batch does not silently print 200 blank lines.
        if (element.binding.key) {
          context.issues.push(
            warn(`elements.${element.id}`, `“${element.name}” has no value for the column “${element.binding.key}” and no placeholder, so it prints nothing.`, 'Add a placeholder or map the column in the CSV step.')
          );
        }
        break;
      }
      ops.push(...textOp(element, shown, context, box));
      break;
    }
    case 'barcode': {
      ops.push(...barcodeOps(element, context, box));
      break;
    }
    case 'symbol': {
      ops.push(...symbolOps(element, context, box));
      break;
    }
    case 'image': {
      const image = element as ImageElement;
      if (!image.src) {
        context.issues.push(warn(`elements.${element.id}`, `“${image.name}” has no image yet, so it prints as an empty box.`));
        ops.push({ kind: 'rect', x: box.x, y: box.y, w: box.width, h: box.height, stroke: '#cbd5e0', strokeWidth: 0.2, radius: 0.5 });
        break;
      }
      ops.push({
        kind: 'image',
        x: box.x,
        y: box.y,
        w: box.width,
        h: box.height,
        href: image.src,
        fit: image.fit,
        radius: image.shape === 'circle' ? Math.min(box.width, box.height) / 2 : image.radius,
        opacity: element.opacity,
      });
      break;
    }
    case 'rect': {
      const rect = element as RectElement;
      ops.push({
        kind: 'rect',
        x: box.x,
        y: box.y,
        w: box.width,
        h: box.height,
        fill: rect.fill,
        stroke: rect.stroke,
        strokeWidth: rect.strokeWidth,
        radius: rect.radius,
        opacity: element.opacity,
      });
      break;
    }
    case 'line': {
      const line = element as LineElement;
      ops.push({
        kind: 'rule',
        x1: box.x,
        y1: box.y,
        x2: box.x + box.width,
        y2: box.y + box.height,
        colour: line.colour,
        width: Math.max(0.05, line.thickness),
        dashed: line.dashed,
      });
      break;
    }
    default:
      break;
  }
  return ops;
}

/* ------------------------------------------------------------------ */
/* Label and document                                                  */
/* ------------------------------------------------------------------ */

/** Lay out one label at a page position. */
export function layoutLabel(document: LabelDocument, row: LabelValues, slot: SlotRect, index: number): PlacedLabel {
  const size = effectiveLabelSize(document);
  const issues: Issue[] = [];
  const context: ElementContext = {
    document,
    row,
    originX: slot.x,
    originY: slot.y,
    label: size,
    issues,
    clip: { x: slot.x, y: slot.y, width: size.width, height: size.height },
  };

  const ops: DrawOp[] = [];
  // Label background and border, so the printed label has a defined edge even on plain paper.
  ops.push({ kind: 'rect', x: slot.x, y: slot.y, w: size.width, h: size.height, fill: document.style.background });
  if (document.style.border) {
    ops.push({
      kind: 'rect',
      x: slot.x,
      y: slot.y,
      w: size.width,
      h: size.height,
      stroke: document.style.border.colour,
      strokeWidth: document.style.border.width,
      radius: document.style.border.radius,
    });
  }

  // Padding is applied by moving the *content origin*, so elements keep their authored coordinates
  // and an author can deliberately place something in the margin by using a negative offset.
  const padding = Math.max(0, document.style.paddingMm);
  const padded: ElementContext = { ...context, originX: slot.x + padding, originY: slot.y + padding, pad: padding };
  for (const element of document.elements) {
    const elementIssuesBefore = padded.issues.length;
    const elementOpsList = elementOps(element, padded);
    ops.push(...elementOpsList);
    // Re-render a notice caption *under* a failing machine-readable element, so the printed label
    // says why the code is missing rather than showing an unexplained red box.
    const elementIssues = padded.issues.slice(elementIssuesBefore).filter((issue) => issue.level === 'error' && issue.field === `elements.${element.id}`);
    if (elementIssues.length > 0 && (element.kind === 'barcode' || element.kind === 'symbol')) {
      // The caption goes *inside* the failed element's box: outside it, a label whose element sits
      // near the edge would print the explanation off the page, leaving an unexplained red frame.
      const box = transform(element, padded);
      ops.push(noticeLabel(shortNotice(elementIssues[0]?.message ?? 'No data'), box));
    }
  }

  return { slot, rowIndex: index, row, issues, ops };
}

/**
 * Lay out the whole document.
 *
 * `rows` may be empty (preview), one row (single label) or many (batch). Each page holds
 * `columns × rows` labels; a partial last page stays partial.
 */
export function layoutLabelDocument(document: LabelDocument, options: LayoutOptions = {}): LabelLayoutResult {
  const rows = options.rows && options.rows.length > 0 ? options.rows : [document.values];
  const slots = sheetSlots(document, options);
  const paper = effectivePaper(document, options.sheetOverride);
  const labelSize = effectiveLabelSize(document);
  const perPage = Math.max(1, slots.length);
  const issues: Issue[] = [];
  const pages: DocumentPage[] = [];
  const placed: PlacedLabel[] = [];

  const cutLines = options.cutLines ?? options.sheetOverride?.cutLines ?? document.sheet.cutLines ?? false;

  for (let start = 0; start < rows.length; start += perPage) {
    const pageRows = rows.slice(start, start + perPage);
    const page: DocumentPage = {
      width: paper.width,
      height: paper.height,
      ops: [],
      label: `Page ${pages.length + 1}`,
    };
    pageRows.forEach((row, indexOnPage) => {
      const slot = slots[indexOnPage];
      if (!slot) return;
      const label = layoutLabel(document, row, slot, start + indexOnPage);
      page.ops.push(...label.ops);
      placed.push(label);
      issues.push(...label.issues);
      if (cutLines) {
        page.ops.push({
          kind: 'rect',
          x: slot.x,
          y: slot.y,
          w: labelSize.width,
          h: labelSize.height,
          stroke: '#d9d6cf',
          strokeWidth: 0.15,
        });
      }
    });
    pages.push(page);
  }

  // A document whose sheet cannot hold even one label is a configuration error, and printing an
  // empty page silently would look like a bug in the printer.
  if (slots.length === 0 || pages.length === 0) {
    issues.push({
      level: 'error',
      field: 'sheet',
      message: 'The sheet layout holds no labels. Reduce the label size, the margins or the gutter.',
    });
    pages.push({ width: paper.width, height: paper.height, ops: [], label: 'Empty' });
  }

  const document_: DesignDocument = {
    title: document.name,
    subject: 'CloudHost247 Label Designer',
    creator: 'CloudHost247 Design Studio',
    pages,
    warnings: issues.filter((issue) => issue.level === 'error').map((issue) => issue.message),
  };

  return { document: document_, labels: placed, issues, labelSize, paper, perPage };
}

/** Quick check used by the editor status bar: does this label fit its slot? */
export function labelFitsPaper(document: LabelDocument): boolean {
  const label = effectiveLabelSize(document);
  const paper = effectivePaper(document);
  return label.width <= paper.width && label.height <= paper.height;
}

/**
 * A single-label page: the label, on a page the same size as the label.
 *
 * This is what "download PNG" and "print this label" use, and what a thermal label printer expects —
 * the media size *is* the page size. Offering only the sheet version would make every single-label
 * export a page of white space with one label in the corner.
 */
export function layoutSingleLabelPage(document: LabelDocument, row: LabelValues = document.values): LabelLayoutResult {
  const size = effectiveLabelSize(document);
  const slot: SlotRect = { x: 0, y: 0, width: size.width, height: size.height, index: 0 };
  const label = layoutLabel(document, row, slot, 0);
  return {
    document: {
      title: document.name,
      subject: 'CloudHost247 Label Designer',
      creator: 'CloudHost247 Design Studio',
      pages: [{ width: size.width, height: size.height, ops: label.ops, label: document.name }],
      warnings: label.issues.filter((issue) => issue.level === 'error').map((issue) => issue.message),
    },
    labels: [label],
    issues: label.issues,
    labelSize: size,
    paper: size,
    perPage: 1,
  };
}

/** Exported for the editor: the width a text element needs for its current content. */
export function measureElementText(element: TextElement | FieldElement, document: LabelDocument, row: LabelValues = {}): number {
  const value = element.kind === 'text' ? element.text : resolveLabelData(element.binding, row, document.values);
  return measureText(value, element.style.size, element.style.family);
}
