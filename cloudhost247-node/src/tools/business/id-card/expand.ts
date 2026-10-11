/**
 * Op expansion: QR symbols and Code 128 barcodes become primitives.
 *
 * Both machine-readable elements are drawn module-by-module and bar-by-bar rather than handed to a
 * renderer's own barcode support, because no two renderers agree on how to draw them. Expanding once,
 * here, means the SVG, the canvas preview, the PNG/JPG export, the PDF and the test rasteriser all
 * place the same dark modules on the same pixels — which is what makes it legitimate to say the
 * downloaded card carries the same scannable code as the preview.
 */

import { encodeCode128Code } from './code128';
import { encodeQrMatrix } from './qr';
import { measureTextWidth } from './text';
import type { DrawBarcode, DrawOp, DrawQr, DrawRect, DrawText } from './types';

/** The number of light modules kept around a QR symbol so a scanner can find its edge. */
export const QR_QUIET_MODULES = 4;

/**
 * Quiet zone either side of a Code 128 symbol, in modules (ISO/IEC 15417 requires at least 10).
 */
export const CODE128_QUIET_MODULES = 10;

/**
 * The narrowest bar a card barcode may print, in pixels at 300 dpi.
 *
 * 2.2 px at 300 dpi is 0.19 mm, the ISO/IEC 15417 minimum X-dimension for a general-purpose
 * symbol. Below it the bars blur together under a scanner's optics and the barcode reads as nothing
 * even though it looks correct on screen — so the layout refuses to draw one rather than shipping a
 * barcode that fails in the corridor.
 */
export const MIN_CODE128_MODULE_PX = 2.2;

export interface ExpandedBarcode {
  bars: DrawRect[];
  caption?: DrawText;
  /** Total module count including quiet zones; the renderer scales bars by `w / moduleCount`. */
  moduleCount: number;
  warning?: string;
}

/**
 * A QR symbol as one rectangle per dark module.
 *
 * The quiet zone is part of the returned geometry: a symbol drawn edge-to-edge against a card border
 * is a symbol many phone cameras will not lock onto, so the caller's `size` is the slot *including*
 * the quiet zone, exactly as it is printed.
 */
export function expandQr(op: DrawQr): DrawRect[] {
  const matrix = encodeQrMatrix(op.payload, 'M');
  if ('ok' in matrix) return [];
  const total = matrix.size + QR_QUIET_MODULES * 2;
  const moduleSize = op.size / total;
  const rects: DrawRect[] = [];
  for (let row = 0; row < matrix.size; row += 1) {
    const line = matrix.modules[row] ?? [];
    for (let column = 0; column < matrix.size; column += 1) {
      if (!line[column]) continue;
      rects.push({
        kind: 'rect',
        x: op.x + (column + QR_QUIET_MODULES) * moduleSize,
        y: op.y + (row + QR_QUIET_MODULES) * moduleSize,
        // The 0.4 module bleed closes the sub-pixel seams the renderers otherwise leave between
        // adjacent modules at 300 dpi; it never reaches a neighbouring module's centre.
        w: moduleSize + 0.4,
        h: moduleSize + 0.4,
        fill: op.dark,
      });
    }
  }
  return rects;
}

/** A Code 128 symbol as bars, with the human-readable line underneath. */
export function expandBarcode(op: DrawBarcode): ExpandedBarcode {
  const encoded = encodeCode128Code(op.value);
  if ('ok' in encoded) {
    return { bars: [], moduleCount: 0, warning: encoded.message };
  }
  const totalModules = encoded.moduleCount + CODE128_QUIET_MODULES * 2;
  const moduleWidth = op.w / totalModules;
  const bars: DrawRect[] = [];
  let cursor = CODE128_QUIET_MODULES;
  for (const symbol of encoded.symbols) {
    symbol.widths.forEach((width, index) => {
      if (index % 2 === 0) {
        // The bar's width is exact — no per-bar rounding up, which would accumulate across 300 runs
        // and make the symbol unreadable. The renderer rounds the *edges*, and the decoder tolerates
        // sub-pixel widths; a bar is never allowed to vanish entirely.
        bars.push({
          kind: 'rect',
          x: op.x + cursor * moduleWidth,
          y: op.y,
          w: Math.max(1, width * moduleWidth),
          h: op.h,
          fill: op.dark,
        });
      }
      cursor += width;
    });
  }
  const caption: DrawText | undefined = op.caption
    ? {
        kind: 'text',
        x: op.x + op.w / 2,
        y: op.y + op.h + Math.max(10, op.h * 0.55),
        text: op.value,
        size: Math.max(9, Math.min(op.h * 0.42, 16)),
        color: op.dark,
        anchor: 'middle',
        family: 'mono',
        maxWidth: op.w,
      }
    : undefined;
  return { bars, caption, moduleCount: totalModules };
}

/**
 * Expand every QR and barcode op, leaving the rest untouched.
 * `warnings` collects the reasons a code could not be drawn, so a caller can surface them instead of
 * exporting a card that quietly lost its barcode.
 */
export function expandOps(ops: DrawOp[], options: { keepQrGroups?: boolean } = {}): { ops: DrawOp[]; warnings: string[] } {
  const out: DrawOp[] = [];
  const warnings: string[] = [];
  for (const op of ops) {
    if (op.kind === 'qr') {
      if (options.keepQrGroups) {
        // The SVG renderer draws the symbol itself so it can label the group with the payload it
        // carries — which is what a reader (and the test suite) needs to verify the card without
        // guessing. The canvas, raster and PDF paths expand it into rectangles instead.
        out.push(op);
        continue;
      }
      const rects = expandQr(op);
      if (rects.length === 0) warnings.push(`The QR symbol carrying “${op.payload.slice(0, 40)}” could not be encoded and was not drawn.`);
      out.push(...rects);
      continue;
    }
    if (op.kind === 'barcode') {
      const expanded = expandBarcode(op);
      if (expanded.warning) warnings.push(expanded.warning);
      out.push(...expanded.bars);
      if (expanded.caption) out.push(expanded.caption);
      continue;
    }
    out.push(op);
  }
  return { ops: out, warnings };
}

/** True when the op list contains a drawable QR or barcode at the requested size. */
export function hasMachineReadableCode(ops: DrawOp[]): boolean {
  return ops.some((op) => op.kind === 'qr' || op.kind === 'barcode');
}

/**
 * Fit a text op to its declared `maxWidth`.
 * Renderers call this rather than trusting the layout, so a name that grew after the layout was
 * computed still cannot run off the card.
 */
export function fitTextOp(op: DrawText): DrawText {
  if (!op.maxWidth || op.maxWidth <= 0) return op;
  const width = measureTextWidth(op.text, op.size, op.family ?? 'sans') + (op.letterSpacing ?? 0) * op.text.length;
  if (width <= op.maxWidth) return op;
  let size = op.size;
  while (size > 8 && (measureTextWidth(op.text, size, op.family ?? 'sans') + (op.letterSpacing ?? 0) * op.text.length) > op.maxWidth) {
    size -= 1;
  }
  return { ...op, size };
}
