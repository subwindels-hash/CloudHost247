/**
 * A small rasteriser for Design Studio geometry, used only by tests.
 *
 * The studio's output is vector: bars are rectangles, 2D modules are outlines, and the SVG and PDF
 * writers emit them as such. "The label carries a scannable code" is a claim about that geometry,
 * so the tests turn the *same operations* the writers receive into pixels with this module and hand
 * the pixels to an independent decoder. Nothing here comes from the barcode encoder's own bitmap
 * path, which is what makes a successful read evidence about the vector output rather than about
 * the encoder.
 *
 * Shapes only: fills, outlines of rectangles and ruled lines. Corner radii are ignored. Text and
 * images are skipped (a decoder does not need them) and reported in `skipped`, so a caller can
 * never mistake this for a faithful picture of the label.
 */

import type { PathSegment, StudioOp } from '../../src/tools/design-studio/render/draw-ops';

export interface RasterResult {
  width: number;
  height: number;
  /** RGBA, row-major. */
  data: Uint8ClampedArray;
  skipped: string[];
}

interface Edge {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function parseHex(color: string | undefined): [number, number, number] | null {
  if (!color || color === 'none' || color === 'transparent') return null;
  const match = /^#([0-9a-fA-F]{6})$/.exec(color);
  if (!match) return [0, 0, 0];
  const value = parseInt(match[1] as string, 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** Flatten a path into closed polylines. Curves are subdivided finely enough for module-size shapes. */
function flatten(segments: readonly PathSegment[]): Array<Array<{ x: number; y: number }>> {
  const loops: Array<Array<{ x: number; y: number }>> = [];
  let current: Array<{ x: number; y: number }> = [];
  let pen = { x: 0, y: 0 };
  const STEPS = 12;
  for (const segment of segments) {
    if (segment.type === 'M') {
      if (current.length > 2) loops.push(current);
      current = [{ x: segment.x, y: segment.y }];
      pen = { x: segment.x, y: segment.y };
    } else if (segment.type === 'L') {
      current.push({ x: segment.x, y: segment.y });
      pen = { x: segment.x, y: segment.y };
    } else if (segment.type === 'Q') {
      for (let step = 1; step <= STEPS; step += 1) {
        const t = step / STEPS;
        const u = 1 - t;
        current.push({
          x: u * u * pen.x + 2 * u * t * segment.cx + t * t * segment.x,
          y: u * u * pen.y + 2 * u * t * segment.cy + t * t * segment.y,
        });
      }
      pen = { x: segment.x, y: segment.y };
    } else if (segment.type === 'C') {
      for (let step = 1; step <= STEPS; step += 1) {
        const t = step / STEPS;
        const u = 1 - t;
        current.push({
          x: u * u * u * pen.x + 3 * u * u * t * segment.c1x + 3 * u * t * t * segment.c2x + t * t * t * segment.x,
          y: u * u * u * pen.y + 3 * u * u * t * segment.c1y + 3 * u * t * t * segment.c2y + t * t * t * segment.y,
        });
      }
      pen = { x: segment.x, y: segment.y };
    } else {
      if (current.length > 2) loops.push(current);
      current = [];
    }
  }
  if (current.length > 2) loops.push(current);
  return loops;
}

/**
 * Rasterise operations placed on a `widthMm` × `heightMm` white area.
 *
 * A pixel is painted when its centre is inside the shape, which is the sampling rule a printer's
 * RIP applies; sub-pixel coverage is deliberately not blended, so a decode cannot be helped along by
 * anti-aliasing.
 */
export function rasteriseOps(ops: readonly StudioOp[], widthMm: number, heightMm: number, pixelsPerMm: number): RasterResult {
  const width = Math.max(1, Math.round(widthMm * pixelsPerMm));
  const height = Math.max(1, Math.round(heightMm * pixelsPerMm));
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const skipped: string[] = [];

  const paint = (x: number, y: number, rgb: [number, number, number]): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const offset = (y * width + x) * 4;
    data[offset] = rgb[0];
    data[offset + 1] = rgb[1];
    data[offset + 2] = rgb[2];
    data[offset + 3] = 255;
  };

  const fillLoops = (loops: Array<Array<{ x: number; y: number }>>, rgb: [number, number, number], rule: 'nonzero' | 'evenodd'): void => {
    const edges: Edge[] = [];
    let minY = Infinity;
    let maxY = -Infinity;
    for (const loop of loops) {
      for (let index = 0; index < loop.length; index += 1) {
        const a = loop[index] as { x: number; y: number };
        const b = loop[(index + 1) % loop.length] as { x: number; y: number };
        if (a.y === b.y) continue;
        edges.push({ x0: a.x * pixelsPerMm, y0: a.y * pixelsPerMm, x1: b.x * pixelsPerMm, y1: b.y * pixelsPerMm });
        minY = Math.min(minY, a.y * pixelsPerMm, b.y * pixelsPerMm);
        maxY = Math.max(maxY, a.y * pixelsPerMm, b.y * pixelsPerMm);
      }
    }
    if (edges.length === 0) return;
    const firstRow = Math.max(0, Math.floor(minY));
    const lastRow = Math.min(height - 1, Math.ceil(maxY));
    for (let row = firstRow; row <= lastRow; row += 1) {
      const sampleY = row + 0.5;
      const crossings: Array<{ x: number; direction: number }> = [];
      for (const edge of edges) {
        const top = Math.min(edge.y0, edge.y1);
        const bottom = Math.max(edge.y0, edge.y1);
        if (sampleY < top || sampleY >= bottom) continue;
        const t = (sampleY - edge.y0) / (edge.y1 - edge.y0);
        crossings.push({ x: edge.x0 + t * (edge.x1 - edge.x0), direction: edge.y1 > edge.y0 ? 1 : -1 });
      }
      if (crossings.length < 2) continue;
      crossings.sort((left, right) => left.x - right.x);
      let winding = 0;
      for (let index = 0; index < crossings.length - 1; index += 1) {
        winding += (crossings[index] as { direction: number }).direction;
        const inside = rule === 'evenodd' ? (index + 1) % 2 === 1 : winding !== 0;
        if (!inside) continue;
        const from = (crossings[index] as { x: number }).x;
        const to = (crossings[index + 1] as { x: number }).x;
        // Pixel centres at column + 0.5 within [from, to). The epsilon keeps a shape whose edge
        // lies exactly on a pixel boundary from gaining or losing a column to float error.
        const startColumn = Math.max(0, Math.ceil(from - 0.5 - 1e-6));
        const endColumn = Math.min(width - 1, Math.ceil(to - 0.5 - 1e-6) - 1);
        for (let column = startColumn; column <= endColumn; column += 1) paint(column, row, rgb);
      }
    }
  };

  for (const op of ops) {
    if (op.kind === 'rect') {
      const rgb = parseHex(op.fill);
      if (rgb) {
        fillLoops(
          [[
            { x: op.x, y: op.y },
            { x: op.x + op.w, y: op.y },
            { x: op.x + op.w, y: op.y + op.h },
            { x: op.x, y: op.y + op.h },
          ]],
          rgb,
          'nonzero'
        );
      }
      // An outline is ink too: a cell border beside a barcode is part of what a scanner sees.
      const outline = parseHex(op.stroke);
      if (outline) {
        const half = (op.strokeWidth ?? 0.25) / 2;
        const band = (x0: number, y0: number, x1: number, y1: number): Array<{ x: number; y: number }> => [
          { x: x0, y: y0 },
          { x: x1, y: y0 },
          { x: x1, y: y1 },
          { x: x0, y: y1 },
        ];
        fillLoops([band(op.x - half, op.y - half, op.x + op.w + half, op.y + half)], outline, 'nonzero');
        fillLoops([band(op.x - half, op.y + op.h - half, op.x + op.w + half, op.y + op.h + half)], outline, 'nonzero');
        fillLoops([band(op.x - half, op.y - half, op.x + half, op.y + op.h + half)], outline, 'nonzero');
        fillLoops([band(op.x + op.w - half, op.y - half, op.x + op.w + half, op.y + op.h + half)], outline, 'nonzero');
      }
    } else if (op.kind === 'path') {
      const rgb = parseHex(op.fill);
      if (!rgb) continue;
      fillLoops(flatten(op.segments), rgb, op.fillRule === 'evenodd' ? 'evenodd' : 'nonzero');
    } else if (op.kind === 'polygon') {
      const rgb = parseHex(op.fill);
      if (!rgb || op.points.length < 3) continue;
      fillLoops([op.points], rgb, 'nonzero');
    } else if (op.kind === 'circle') {
      const rgb = parseHex(op.fill);
      if (!rgb) continue;
      const loop: Array<{ x: number; y: number }> = [];
      for (let step = 0; step < 48; step += 1) {
        const angle = (step / 48) * Math.PI * 2;
        loop.push({ x: op.cx + Math.cos(angle) * op.r, y: op.cy + Math.sin(angle) * op.r });
      }
      fillLoops([loop], rgb, 'nonzero');
    } else if (op.kind === 'line') {
      const rgb = parseHex(op.color);
      if (!rgb) continue;
      const dx = op.x2 - op.x1;
      const dy = op.y2 - op.y1;
      const length = Math.hypot(dx, dy);
      if (length === 0) continue;
      const nx = (-dy / length) * (op.width / 2);
      const ny = (dx / length) * (op.width / 2);
      fillLoops(
        [[
          { x: op.x1 + nx, y: op.y1 + ny },
          { x: op.x2 + nx, y: op.y2 + ny },
          { x: op.x2 - nx, y: op.y2 - ny },
          { x: op.x1 - nx, y: op.y1 - ny },
        ]],
        rgb,
        'nonzero'
      );
    } else if (!skipped.includes(op.kind)) {
      skipped.push(op.kind);
    }
  }

  return { width, height, data, skipped };
}
