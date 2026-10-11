/**
 * A dependency-free rasteriser for the card's *geometric* content.
 *
 * Why this exists: "the exported card carries a scannable code" is only a claim until something
 * reads the code back. A canvas needs a browser, so the test suite cannot decode a canvas export —
 * but it can render the same operations into pixels with this module, then hand the pixels to a real
 * QR/Code 128 decoder. Whatever comes out was placed by the same layout and the same expansion code
 * that the browser draws, so a code found here is a code the export contains.
 *
 * Text and photographs are deliberately not rasterised: glyph rasterisation belongs to the platform
 * font engine, and pretending otherwise would produce a fake preview. Ops that are not drawn are
 * reported in `skipped`, so a caller can never mistake an empty raster for a blank card.
 */

import { expandOps } from './expand';
import { decodeCode128Widths } from './code128';
import { parseColor } from './colors';
import type { CardFace, DrawOp } from './types';

export interface RasterImage {
  width: number;
  height: number;
  /** RGBA, row-major, 4 bytes per pixel. */
  data: Uint8ClampedArray;
  /** Op kinds this renderer does not draw (always includes `text`, and `image` when unembedded). */
  skipped: string[];
}

interface Canvas {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

function createCanvas(width: number, height: number, background: string): Canvas {
  const data = new Uint8ClampedArray(width * height * 4);
  const rgb = parseColor(background) ?? { r: 255, g: 255, b: 255 };
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = rgb.r;
    data[index * 4 + 1] = rgb.g;
    data[index * 4 + 2] = rgb.b;
    data[index * 4 + 3] = 255;
  }
  return { width, height, data };
}

function blend(canvas: Canvas, x: number, y: number, color: string, alpha: number): void {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
  const rgb = parseColor(color);
  if (!rgb) return;
  const offset = (y * canvas.width + x) * 4;
  const a = Math.max(0, Math.min(1, alpha));
  canvas.data[offset] = (canvas.data[offset] ?? 255) * (1 - a) + rgb.r * a;
  canvas.data[offset + 1] = (canvas.data[offset + 1] ?? 255) * (1 - a) + rgb.g * a;
  canvas.data[offset + 2] = (canvas.data[offset + 2] ?? 255) * (1 - a) + rgb.b * a;
  canvas.data[offset + 3] = 255;
}

function fillRect(canvas: Canvas, x: number, y: number, w: number, h: number, color: string, alpha: number, radius: number): void {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(canvas.width, Math.ceil(x + w));
  const y1 = Math.min(canvas.height, Math.ceil(y + h));
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      if (r > 0) {
        const dx = px < x + r ? x + r - px : px > x + w - r ? px - (x + w - r) : 0;
        const dy = py < y + r ? y + r - py : py > y + h - r ? py - (y + h - r) : 0;
        if (dx * dx + dy * dy > r * r) continue;
      }
      blend(canvas, px, py, color, alpha);
    }
  }
}

function strokeRect(canvas: Canvas, x: number, y: number, w: number, h: number, color: string, width: number, radius: number): void {
  const band = Math.max(1, Math.round(width));
  fillRect(canvas, x, y, w, band, color, 1, Math.min(radius, band));
  fillRect(canvas, x, y + h - band, w, band, color, 1, Math.min(radius, band));
  fillRect(canvas, x, y + band, band, h - band * 2, color, 1, Math.min(radius, band));
  fillRect(canvas, x + w - band, y + band, band, h - band * 2, color, 1, Math.min(radius, band));
}

function fillCircle(canvas: Canvas, cx: number, cy: number, r: number, color: string, alpha: number): void {
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(canvas.width, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(canvas.height, Math.ceil(cy + r));
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      const dx = px + 0.5 - cx;
      const dy = py + 0.5 - cy;
      if (dx * dx + dy * dy <= r * r) blend(canvas, px, py, color, alpha);
    }
  }
}

function fillPolygon(canvas: Canvas, points: Array<{ x: number; y: number }>, color: string, alpha: number): void {
  if (points.length < 3) return;
  const ys = points.map((point) => point.y);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(canvas.height, Math.ceil(Math.max(...ys)));
  for (let py = y0; py < y1; py += 1) {
    const intersections: number[] = [];
    for (let index = 0; index < points.length; index += 1) {
      const a = points[index];
      const b = points[(index + 1) % points.length];
      if (!a || !b || a.y === b.y) continue;
      const minY = Math.min(a.y, b.y);
      const maxY = Math.max(a.y, b.y);
      const scan = py + 0.5;
      if (scan < minY || scan >= maxY) continue;
      intersections.push(a.x + ((scan - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    intersections.sort((left, right) => left - right);
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      const start = Math.max(0, Math.round(intersections[index] ?? 0));
      const end = Math.min(canvas.width, Math.round(intersections[index + 1] ?? 0));
      for (let px = start; px < end; px += 1) blend(canvas, px, py, color, alpha);
    }
  }
}

function drawLine(canvas: Canvas, x1: number, y1: number, x2: number, y2: number, color: string, width: number): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1)));
  const band = Math.max(1, width);
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    fillRect(canvas, x - band / 2, y - band / 2, band, band, color, 1, 0);
  }
}

/** Render a face to pixels. `scale` multiplies the card size (2 → 2022 × 1276 for landscape). */
export function renderFaceToRgba(face: CardFace, options: { scale?: number; background?: string } = {}): RasterImage {
  const scale = options.scale ?? 1;
  const width = Math.round(face.width * scale);
  const height = Math.round(face.height * scale);
  const canvas = createCanvas(width, height, options.background ?? '#FFFFFF');
  const { ops } = expandOps(face.ops);
  const skipped = new Set<string>();

  for (const op of ops) {
    const draw = scaleOp(op, scale);
    switch (draw.kind) {
      case 'rect': {
        const alpha = typeof draw.opacity === 'number' ? draw.opacity : 1;
        if (draw.fill) fillRect(canvas, draw.x, draw.y, draw.w, draw.h, draw.fill, alpha, draw.radius ?? 0);
        if (draw.stroke) strokeRect(canvas, draw.x, draw.y, draw.w, draw.h, draw.stroke, draw.strokeWidth ?? 1, draw.radius ?? 0);
        break;
      }
      case 'circle':
        if (draw.fill) fillCircle(canvas, draw.cx, draw.cy, draw.r, draw.fill, typeof draw.opacity === 'number' ? draw.opacity : 1);
        break;
      case 'polygon':
        fillPolygon(canvas, draw.points, draw.fill ?? '#000000', typeof draw.opacity === 'number' ? draw.opacity : 1);
        break;
      case 'line':
        drawLine(canvas, draw.x1, draw.y1, draw.x2, draw.y2, draw.color, draw.width);
        break;
      case 'text':
        skipped.add('text');
        break;
      case 'image':
        skipped.add('image');
        break;
      default:
        break;
    }
  }

  return { width, height, data: canvas.data, skipped: [...skipped] };
}

function scaleNumber(value: number, scale: number): number {
  return value * scale;
}

function scaleOp(op: DrawOp, scale: number): DrawOp {
  switch (op.kind) {
    case 'rect':
      return {
        ...op,
        x: scaleNumber(op.x, scale),
        y: scaleNumber(op.y, scale),
        w: scaleNumber(op.w, scale),
        h: scaleNumber(op.h, scale),
        radius: op.radius ? scaleNumber(op.radius, scale) : undefined,
        strokeWidth: op.strokeWidth ? Math.max(1, scaleNumber(op.strokeWidth, scale)) : undefined,
      };
    case 'circle':
      return { ...op, cx: scaleNumber(op.cx, scale), cy: scaleNumber(op.cy, scale), r: scaleNumber(op.r, scale) };
    case 'polygon':
      return { ...op, points: op.points.map((point) => ({ x: scaleNumber(point.x, scale), y: scaleNumber(point.y, scale) })) };
    case 'line':
      return {
        ...op,
        x1: scaleNumber(op.x1, scale),
        y1: scaleNumber(op.y1, scale),
        x2: scaleNumber(op.x2, scale),
        y2: scaleNumber(op.y2, scale),
        width: Math.max(1, scaleNumber(op.width, scale)),
      };
    case 'text':
      return { ...op, x: scaleNumber(op.x, scale), y: scaleNumber(op.y, scale), size: scaleNumber(op.size, scale) };
    case 'image':
      return {
        ...op,
        x: scaleNumber(op.x, scale),
        y: scaleNumber(op.y, scale),
        w: scaleNumber(op.w, scale),
        h: scaleNumber(op.h, scale),
      };
    default:
      return op;
  }
}

/** A crop of a raster, in pixels. Used by the tests to read one code back off the card. */
export function cropRaster(image: RasterImage, box: { x: number; y: number; w: number; h: number }): RasterImage {
  const width = Math.max(1, Math.round(box.w));
  const height = Math.max(1, Math.round(box.h));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.round(box.x) + x;
      const sourceY = Math.round(box.y) + y;
      const target = (y * width + x) * 4;
      if (sourceX < 0 || sourceY < 0 || sourceX >= image.width || sourceY >= image.height) {
        data[target] = data[target + 1] = data[target + 2] = 255;
        data[target + 3] = 255;
        continue;
      }
      const source = (sourceY * image.width + sourceX) * 4;
      data[target] = image.data[source] ?? 255;
      data[target + 1] = image.data[source + 1] ?? 255;
      data[target + 2] = image.data[source + 2] ?? 255;
      data[target + 3] = 255;
    }
  }
  return { width, height, data, skipped: [] };
}

/** The dark/light run lengths along one row of a raster, in pixels. */
export function scanRowWidths(image: RasterImage, row: number): number[] {
  const y = Math.max(0, Math.min(image.height - 1, row));
  const widths: number[] = [];
  let previous: boolean | null = null;
  let run = 0;
  for (let x = 0; x < image.width; x += 1) {
    const offset = (y * image.width + x) * 4;
    const luminance =
      ((image.data[offset] ?? 255) * 0.299 + (image.data[offset + 1] ?? 255) * 0.587 + (image.data[offset + 2] ?? 255) * 0.114) / 255;
    const dark = luminance < 0.5;
    if (previous === null) {
      previous = dark;
      run = 1;
      continue;
    }
    if (dark === previous) {
      run += 1;
      continue;
    }
    widths.push(run);
    run = 1;
    previous = dark;
  }
  widths.push(run);
  return widths;
}

/**
 * Read a Code 128 symbol back out of a raster — the equivalent of pointing a scanner at the card.
 *
 * The symbol is sampled across several rows and each row is decoded independently; the result that
 * the majority of rows agree on wins. A single row can straddle a sub-pixel seam where the bar edge
 * falls mid-pixel, which is exactly the failure a real scanner recovers from by looking at the whole
 * symbol, so this does the same thing rather than trusting one line of pixels.
 */
export function rasterToCode128(image: RasterImage, options: { rows?: number } = {}): { value: string; rows: number } | null {
  const rows = options.rows ?? 5;
  const start = Math.max(1, Math.floor(image.height * 0.3));
  const step = Math.max(1, Math.floor((image.height - start * 2) / rows));
  const votes = new Map<string, number>();
  for (let index = 0; index < rows; index += 1) {
    const widths = scanRowWidths(image, start + index * step);
    if (widths.length < 19) continue;
    // The leading and trailing runs are the quiet zones; a scanner measures only the symbol.
    let first = 0;
    while (first < widths.length && (widths[first] ?? 0) > 20) first += 1;
    let last = widths.length - 1;
    while (last > first && (widths[last] ?? 0) > 20) last -= 1;
    const symbol = widths.slice(first, last + 1);
    if (symbol.length < 19) continue;
    // The decoder estimates the module width from the symbol's own structure; passing pixel widths
    // through unchanged keeps the rounding decisions in one place.
    const decoded = decodeCode128Widths(symbol);
    if ('ok' in decoded) continue;
    votes.set(decoded.value, (votes.get(decoded.value) ?? 0) + 1);
  }
  let best: { value: string; rows: number } | null = null;
  for (const [value, count] of votes) {
    if (!best || count > best.rows) best = { value, rows: count };
  }
  return best;
}
