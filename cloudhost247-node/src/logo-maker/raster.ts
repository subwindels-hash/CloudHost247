/**
 * Logo Maker PNG rasterizer.
 *
 * The platform ships no font rasterizer (no headless browser, no native canvas) because the
 * supported cPanel/Passenger target cannot be relied on to build one. Rather than pretend otherwise
 * — or silently return an empty PNG — PNG export is rasterized here by this module's own renderer:
 *
 *   - the mark is drawn from the same geometry as the SVG, at the requested pixel size;
 *   - typography is drawn with a built-in 5×7 block font that is scaled by an integer factor and
 *     anti-aliased by sub-pixel coverage, so the result is legible and deterministic.
 *
 * The exported SVG remains the print-quality, resolution-independent source; the PNG is the
 * convenience export for favicons, social previews and quick uploads, and the UI says exactly that.
 */
import { PNG } from 'pngjs';
import { escapeXml, type LogoConceptSpec, type MarkStyle } from './vector-engine';
import { monogramFor, type LogoPalette } from './catalog';
import { GLYPHS, GLYPH_HEIGHT, GLYPH_WIDTH } from '../tools/shared/block-font';

/* The 5x7 block font lives in src/tools/shared/block-font.ts: the badge rasteriser needs the same
 * glyphs, and two copies of a font table is two places for it to drift. */

const GLYPH_W = 5;
const GLYPH_H = 7;

interface Raster {
  width: number;
  height: number;
  pixels: Uint8ClampedArray; // RGBA
}

function createRaster(width: number, height: number): Raster {
  return { width, height, pixels: new Uint8ClampedArray(width * height * 4) };
}

function parseHex(color: string): [number, number, number] {
  const value = color.replace('#', '');
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

/** Alpha-blended pixel write; out-of-bounds writes are ignored rather than wrapped. */
function blend(raster: Raster, x: number, y: number, [r, g, b]: [number, number, number], alpha: number): void {
  if (alpha <= 0 || x < 0 || y < 0 || x >= raster.width || y >= raster.height) return;
  const index = (Math.floor(y) * raster.width + Math.floor(x)) * 4;
  const a = Math.min(1, alpha);
  const dstA = raster.pixels[index + 3]! / 255;
  const outA = a + dstA * (1 - a);
  if (outA === 0) return;
  raster.pixels[index] = Math.round((r * a + raster.pixels[index]! * dstA * (1 - a)) / outA);
  raster.pixels[index + 1] = Math.round((g * a + raster.pixels[index + 1]! * dstA * (1 - a)) / outA);
  raster.pixels[index + 2] = Math.round((b * a + raster.pixels[index + 2]! * dstA * (1 - a)) / outA);
  raster.pixels[index + 3] = Math.round(outA * 255);
}

/** Fills a rectangle with coverage-based anti-aliasing on the fractional edges. */
function fillRect(raster: Raster, x: number, y: number, w: number, h: number, color: [number, number, number], alpha = 1): void {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(raster.width, Math.ceil(x + w));
  const y1 = Math.min(raster.height, Math.ceil(y + h));
  for (let py = y0; py < y1; py += 1) {
    const coverY = Math.min(py + 1, y + h) - Math.max(py, y);
    for (let px = x0; px < x1; px += 1) {
      const coverX = Math.min(px + 1, x + w) - Math.max(px, x);
      blend(raster, px, py, color, alpha * coverX * coverY);
    }
  }
}

function fillCircle(raster: Raster, cx: number, cy: number, radius: number, color: [number, number, number], alpha = 1, innerRadius = 0): void {
  const x0 = Math.max(0, Math.floor(cx - radius - 1));
  const x1 = Math.min(raster.width, Math.ceil(cx + radius + 1));
  const y0 = Math.max(0, Math.floor(cy - radius - 1));
  const y1 = Math.min(raster.height, Math.ceil(cy + radius + 1));
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      const dx = px + 0.5 - cx;
      const dy = py + 0.5 - cy;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > radius + 0.7 || (innerRadius > 0 && distance < innerRadius - 0.7)) continue;
      const outer = Math.min(1, radius + 0.7 - distance);
      const inner = innerRadius > 0 ? Math.min(1, distance - innerRadius + 0.7) : 1;
      blend(raster, px, py, color, alpha * Math.min(outer, inner));
    }
  }
}

function fillPolygon(raster: Raster, points: Array<[number, number]>, color: [number, number, number], alpha = 1): void {
  if (points.length < 3) return;
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const x1 = Math.min(raster.width, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(raster.height, Math.ceil(Math.max(...ys)));
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      if (pointInPolygon(px + 0.5, py + 0.5, points)) blend(raster, px, py, color, alpha);
    }
  }
}

function pointInPolygon(x: number, y: number, points: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i]!;
    const [xj, yj] = points[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function drawText(
  raster: Raster,
  text: string,
  x: number,
  y: number,
  scale: number,
  color: [number, number, number],
  options: { align?: 'left' | 'center'; letterSpacing?: number } = {}
): number {
  const letters = text.toUpperCase().split('');
  const spacing = options.letterSpacing ?? 1;
  const totalWidth = letters.length * (GLYPH_W + spacing) * scale - spacing * scale;
  let cursor = options.align === 'center' ? x - totalWidth / 2 : x;
  for (const letter of letters) {
    const glyph = GLYPHS[letter] ?? ['11111', '10001', '10001', '10001', '10001', '10001', '11111'];
    for (let row = 0; row < GLYPH_H; row += 1) {
      const bits = glyph[row] ?? '00000';
      for (let col = 0; col < GLYPH_W; col += 1) {
        if (bits[col] === '1') fillRect(raster, cursor + col * scale, y + row * scale, scale, scale, color);
      }
    }
    cursor += (GLYPH_W + spacing) * scale;
  }
  return totalWidth;
}

function measureText(text: string, scale: number, letterSpacing = 1): number {
  return text.length * (GLYPH_W + letterSpacing) * scale - letterSpacing * scale;
}

/** Draws the brand mark into the raster at a given box origin and size, mirroring the SVG styles. */
function drawMark(raster: Raster, style: MarkStyle, box: { x: number; y: number; size: number }, palette: LogoPalette, monogram: string): void {
  const primary = parseHex(palette.primary);
  const accent = parseHex(palette.accent);
  const { x, y, size } = box;
  const scale = size / 100;
  const at = (vx: number, vy: number): [number, number] => [x + vx * scale, y + vy * scale];

  switch (style) {
    case 'ring':
      fillCircle(raster, ...at(50, 50), 40 * scale, primary, 1, 32 * scale);
      fillCircle(raster, ...at(50, 50), 18 * scale, accent);
      return;
    case 'shield': {
      const outer: Array<[number, number]> = [at(50, 8), at(86, 24), at(86, 54), at(50, 94), at(14, 54), at(14, 24)];
      fillPolygon(raster, outer, primary);
      fillPolygon(raster, [at(50, 26), at(70, 35), at(70, 54), at(50, 80), at(30, 54), at(30, 35)], accent);
      return;
    }
    case 'orbit':
      fillCircle(raster, ...at(50, 50), 20 * scale, primary);
      fillCircle(raster, ...at(50, 50), 44 * scale, accent, 1, 37 * scale);
      fillCircle(raster, ...at(86, 32), 7 * scale, accent);
      return;
    case 'leaf': {
      // Two arcs approximated by the polygon between them — the same silhouette the SVG draws.
      const points: Array<[number, number]> = [];
      for (let step = 0; step <= 24; step += 1) {
        const t = step / 24;
        points.push(at(18 + t * 66, 82 - Math.sin(t * Math.PI * 0.72) * 62));
      }
      fillPolygon(raster, points, primary);
      return;
    }
    case 'bolt': {
      fillPolygon(raster, [at(56, 6), at(22, 56), at(46, 56), at(40, 94), at(78, 40), at(52, 40)], primary);
      fillPolygon(raster, [at(56, 6), at(22, 56), at(38, 56), at(46, 24)], accent, 0.9);
      return;
    }
    case 'wave': {
      for (const offset of [62, 82]) {
        for (let step = 0; step < 20; step += 1) {
          const t = step / 19;
          const px = 8 + t * 84;
          const py = offset - Math.sin(t * Math.PI * 1.6) * 12;
          fillCircle(raster, ...at(px, py), 6 * scale, offset === 62 ? primary : accent);
        }
      }
      return;
    }
    case 'cube': {
      fillPolygon(raster, [at(50, 8), at(88, 30), at(88, 70), at(50, 92), at(12, 70), at(12, 30)], primary);
      fillPolygon(raster, [at(50, 8), at(88, 30), at(50, 52), at(12, 30)], accent, 0.9);
      return;
    }
    case 'geometric':
    default: {
      fillRect(raster, x + 14 * scale, y + 14 * scale, 50 * scale, 50 * scale, primary);
      fillRect(raster, x + 36 * scale, y + 36 * scale, 50 * scale, 50 * scale, accent, 0.9);
      drawText(raster, monogram, ...at(50, 38), Math.max(1, Math.round(4.2 * scale)), [255, 255, 255], { align: 'center' });
      return;
    }
  }
}

export interface RasterizeOptions {
  width: number;
  height: number;
  background: 'transparent' | 'palette';
  subtitle?: string;
}

/**
 * Rasterizes a concept at the requested size. `width`/`height` are clamped by the caller
 * (src/logo-maker/logo-service.ts) to the same 64–4096 range the database constraint enforces.
 */
export function rasterizeLogo(spec: LogoConceptSpec, options: RasterizeOptions): Buffer {
  const raster = createRaster(options.width, options.height);
  const primary = parseHex(spec.palette.primary);
  const accent = parseHex(spec.palette.accent);
  const ink = parseHex(spec.palette.text);
  const monogram = monogramFor(spec.companyName);

  if (options.background === 'palette') {
    fillRect(raster, 0, 0, options.width, options.height, parseHex(spec.palette.background));
  }

  const size = Math.min(options.width, options.height);
  const nameScale = Math.max(1, Math.round(size / 42));
  const text = spec.companyName.toUpperCase();

  switch (spec.layout) {
    case 'mark_only':
      drawMark(raster, spec.markStyle, { x: (options.width - size * 0.72) / 2, y: (options.height - size * 0.72) / 2, size: size * 0.72 }, spec.palette, monogram);
      break;
    case 'mark_above': {
      const markSize = size * 0.44;
      drawMark(raster, spec.markStyle, { x: (options.width - markSize) / 2, y: size * 0.12, size: markSize }, spec.palette, monogram);
      drawText(raster, text, options.width / 2, size * 0.64, nameScale, ink, { align: 'center' });
      if (spec.tagline) {
        drawText(raster, spec.tagline.toUpperCase(), options.width / 2, size * 0.64 + nameScale * 9, Math.max(1, nameScale - 1), primary, {
          align: 'center',
          letterSpacing: 2,
        });
      }
      break;
    }
    case 'monogram_badge': {
      const badge = size * 0.42;
      fillRect(raster, size * 0.08, (options.height - badge) / 2, badge, badge, primary);
      drawText(raster, monogram, size * 0.08 + badge / 2, (options.height - badge) / 2 + badge * 0.3, Math.max(1, Math.round(badge / 16)), [255, 255, 255], {
        align: 'center',
        letterSpacing: 2,
      });
      drawText(raster, text, size * 0.08 + badge + nameScale * 3, options.height / 2 - nameScale * 3.5, nameScale, ink);
      if (spec.tagline) {
        drawText(raster, spec.tagline.toUpperCase(), size * 0.08 + badge + nameScale * 3, options.height / 2 + nameScale * 4, Math.max(1, nameScale - 1), primary, {
          letterSpacing: 2,
        });
      }
      break;
    }
    case 'emblem_round': {
      const ringSize = size * 0.52;
      drawMark(raster, 'ring', { x: (options.width - ringSize) / 2, y: size * 0.08, size: ringSize }, spec.palette, monogram);
      drawText(raster, text, options.width / 2, size * 0.66, nameScale, ink, { align: 'center' });
      fillCircle(raster, options.width / 2, size * 0.08 + ringSize / 2, ringSize / 2, accent, 1, ringSize / 2 - Math.max(2, ringSize * 0.05));
      break;
    }
    case 'mark_left':
    default: {
      const markSize = size * 0.4;
      drawMark(raster, spec.markStyle, { x: size * 0.06, y: (options.height - markSize) / 2, size: markSize }, spec.palette, monogram);
      const textX = size * 0.06 + markSize + nameScale * 2;
      drawText(raster, text, textX, options.height / 2 - nameScale * 3.5, nameScale, ink);
      if (spec.tagline) {
        drawText(raster, spec.tagline.toUpperCase(), textX, options.height / 2 + nameScale * 4, Math.max(1, nameScale - 1), primary, { letterSpacing: 2 });
      }
      break;
    }
  }

  const png = new PNG({ width: raster.width, height: raster.height });
  png.data = Buffer.from(raster.pixels.buffer, raster.pixels.byteOffset, raster.pixels.byteLength);
  return PNG.sync.write(png, { colorType: 6 });
}

/** Exposed for the service layer's filename/label generation and for tests. */
export const rasterInternals = { measureText, escapeXml };
