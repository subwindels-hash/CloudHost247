/**
 * SVG renderer for Design Studio surfaces.
 *
 * A surface is measured in millimetres and so is the document this writes: `width`/`height` carry
 * the unit and the `viewBox` is the same numbers, so the file opens at true physical size in any
 * program that honours SVG units and scales cleanly everywhere else.
 *
 * Text is real text, not outlines, so it stays selectable and searchable. Each run carries the width
 * the layout measured for it (`textLength`), which means a viewer that substitutes a different
 * sans-serif cannot make a value overflow the box the layout fitted it into.
 *
 * Machine-readable symbols arrive here already expanded into rectangles and outlines by the barcode
 * encoder. This module never encodes anything; it only writes what it is given.
 */

import type { PathSegment, StudioOp, StudioSurface } from './draw-ops';
import { resolveTextRun } from './text-run';

const FONT_STACK = {
  sans: "Helvetica, Arial, 'Liberation Sans', 'Nimbus Sans', sans-serif",
  mono: "Courier, 'Courier New', 'Liberation Mono', 'Nimbus Mono PS', monospace",
} as const;

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Three decimals of a millimetre is a micron: finer than any printer, and it keeps files small. */
function n(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? '0' : rounded.toString();
}

/** Colours are restricted to hex and `none`, so a value can never smuggle markup into an attribute. */
export function safeColor(value: string | undefined, fallback = '#000000'): string {
  if (!value) return fallback;
  if (value === 'none' || value === 'transparent') return 'none';
  return /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/.test(value) ? value : fallback;
}

export function pathData(segments: readonly PathSegment[]): string {
  let out = '';
  for (const segment of segments) {
    switch (segment.type) {
      case 'M':
        out += `M${n(segment.x)} ${n(segment.y)}`;
        break;
      case 'L':
        out += `L${n(segment.x)} ${n(segment.y)}`;
        break;
      case 'Q':
        out += `Q${n(segment.cx)} ${n(segment.cy)} ${n(segment.x)} ${n(segment.y)}`;
        break;
      case 'C':
        out += `C${n(segment.c1x)} ${n(segment.c1y)} ${n(segment.c2x)} ${n(segment.c2y)} ${n(segment.x)} ${n(segment.y)}`;
        break;
      default:
        out += 'Z';
    }
  }
  return out;
}

function roundedRect(x: number, y: number, w: number, h: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  if (r <= 0) return `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}Z`;
  return (
    `M${n(x + r)} ${n(y)}h${n(w - 2 * r)}a${n(r)} ${n(r)} 0 0 1 ${n(r)} ${n(r)}v${n(h - 2 * r)}` +
    `a${n(r)} ${n(r)} 0 0 1 ${n(-r)} ${n(r)}h${n(-(w - 2 * r))}a${n(r)} ${n(r)} 0 0 1 ${n(-r)} ${n(-r)}` +
    `v${n(-(h - 2 * r))}a${n(r)} ${n(r)} 0 0 1 ${n(r)} ${n(-r)}Z`
  );
}

/** Only raster data URLs are ever written into an `href`; anything else is dropped. */
export function safeImageHref(href: string | undefined): string | null {
  if (!href) return null;
  return /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(href) ? href : null;
}

interface RenderState {
  clipCounter: number;
  idPrefix: string;
}

function opacityAttr(op: { opacity?: number }): string {
  return typeof op.opacity === 'number' && op.opacity < 1 ? ` opacity="${n(Math.max(0, op.opacity))}"` : '';
}

function opToSvg(op: StudioOp, state: RenderState): string {
  switch (op.kind) {
    case 'rect': {
      const fill = op.fill ? ` fill="${safeColor(op.fill)}"` : ' fill="none"';
      const stroke = op.stroke ? ` stroke="${safeColor(op.stroke)}" stroke-width="${n(op.strokeWidth ?? 0.25)}"` : '';
      if ((op.radius ?? 0) > 0) return `<path d="${roundedRect(op.x, op.y, op.w, op.h, op.radius ?? 0)}"${fill}${stroke}${opacityAttr(op)}/>`;
      return `<rect x="${n(op.x)}" y="${n(op.y)}" width="${n(op.w)}" height="${n(op.h)}"${fill}${stroke}${opacityAttr(op)}/>`;
    }
    case 'circle': {
      const fill = op.fill ? ` fill="${safeColor(op.fill)}"` : ' fill="none"';
      const stroke = op.stroke ? ` stroke="${safeColor(op.stroke)}" stroke-width="${n(op.strokeWidth ?? 0.25)}"` : '';
      return `<circle cx="${n(op.cx)}" cy="${n(op.cy)}" r="${n(op.r)}"${fill}${stroke}${opacityAttr(op)}/>`;
    }
    case 'polygon':
      if (op.points.length < 3) return '';
      return `<polygon points="${op.points.map((point) => `${n(point.x)},${n(point.y)}`).join(' ')}" fill="${safeColor(op.fill)}"${opacityAttr(op)}/>`;
    case 'line': {
      const dash = op.dash && op.dash.length > 0 ? ` stroke-dasharray="${op.dash.map((value) => n(value)).join(' ')}"` : '';
      return `<line x1="${n(op.x1)}" y1="${n(op.y1)}" x2="${n(op.x2)}" y2="${n(op.y2)}" stroke="${safeColor(op.color)}" stroke-width="${n(op.width)}"${dash}${opacityAttr(op)}/>`;
    }
    case 'path':
      if (op.segments.length === 0) return '';
      return `<path d="${pathData(op.segments)}" fill="${safeColor(op.fill)}"${op.fillRule === 'evenodd' ? ' fill-rule="evenodd"' : ''}${opacityAttr(op)}/>`;
    case 'text': {
      const run = resolveTextRun(op);
      if (!run) return '';
      const family = run.font.startsWith('mono') ? FONT_STACK.mono : FONT_STACK.sans;
      const weight = run.font.endsWith('bold') ? '700' : '400';
      const anchor = op.anchor && op.anchor !== 'start' ? ` text-anchor="${op.anchor}"` : '';
      const spacing = op.letterSpacing ? ` letter-spacing="${n(op.letterSpacing)}"` : '';
      // A single character has no inter-glyph space to adjust, and some renderers mishandle
      // `textLength` on it, so the pin is applied only where it can do its job.
      const pin = run.text.length > 1 ? ` textLength="${n(run.width)}" lengthAdjust="spacingAndGlyphs"` : '';
      return (
        `<text x="${n(op.x)}" y="${n(op.y)}" font-family="${family}" font-size="${n(run.size)}" font-weight="${weight}" ` +
        `fill="${safeColor(op.color)}"${anchor}${spacing}${pin}${opacityAttr(op)} xml:space="preserve">${escapeXml(run.text)}</text>`
      );
    }
    case 'image': {
      const href = safeImageHref(op.href);
      const radius = op.radius ?? 0;
      const stroke = op.stroke
        ? `<path d="${roundedRect(op.x, op.y, op.w, op.h, radius)}" fill="none" stroke="${safeColor(op.stroke)}" stroke-width="${n(op.strokeWidth ?? 0.25)}"/>`
        : '';
      if (!href) {
        if (!op.placeholder) return stroke;
        const size = Math.min(op.w, op.h) * 0.34;
        return (
          `<path d="${roundedRect(op.x, op.y, op.w, op.h, radius)}" fill="${safeColor(op.placeholder.fill)}"/>` +
          `<text x="${n(op.x + op.w / 2)}" y="${n(op.y + op.h / 2 + size * 0.36)}" font-family="${FONT_STACK.sans}" font-size="${n(size)}" font-weight="700" ` +
          `fill="${safeColor(op.placeholder.color)}" text-anchor="middle">${escapeXml(op.placeholder.label)}</text>${stroke}`
        );
      }
      state.clipCounter += 1;
      const clipId = `${state.idPrefix}clip${state.clipCounter}`;
      const preserve = op.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet';
      return (
        `<clipPath id="${clipId}"><path d="${roundedRect(op.x, op.y, op.w, op.h, radius)}"/></clipPath>` +
        `<g clip-path="url(#${clipId})"${opacityAttr(op)}><image href="${href}" x="${n(op.x)}" y="${n(op.y)}" width="${n(op.w)}" height="${n(op.h)}" preserveAspectRatio="${preserve}"/></g>${stroke}`
      );
    }
    default:
      return '';
  }
}

/** The surface's drawing as SVG markup without the enclosing `<svg>` element. */
export function surfaceBodySvg(surface: StudioSurface, idPrefix = ''): string {
  const state: RenderState = { clipCounter: 0, idPrefix };
  const background =
    surface.background && safeColor(surface.background, 'none') !== 'none'
      ? `<rect x="0" y="0" width="${n(surface.width)}" height="${n(surface.height)}" fill="${safeColor(surface.background)}"/>`
      : '';
  return background + surface.ops.map((op) => opToSvg(op, state)).join('');
}

export interface SvgDocumentOptions {
  title: string;
  description?: string;
}

/** One surface as a standalone SVG document at true physical size. */
export function surfaceToSvg(surface: StudioSurface, options: SvgDocumentOptions): string {
  const description = options.description ? `<desc>${escapeXml(options.description)}</desc>` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(surface.width)}mm" height="${n(surface.height)}mm" ` +
    `viewBox="0 0 ${n(surface.width)} ${n(surface.height)}" role="img" aria-label="${escapeXml(options.title)}">` +
    `<title>${escapeXml(options.title)}</title>${description}${surfaceBodySvg(surface)}</svg>`
  );
}

/** A page of placed surfaces. Structurally the same as the PDF writer's page, without importing it. */
export interface SvgPage {
  width: number;
  height: number;
  placements: ReadonlyArray<{ surface: StudioSurface; x: number; y: number }>;
  overlay?: readonly StudioOp[];
}

/**
 * A whole page — every placed surface and the overlay — as one SVG document.
 *
 * Used to preview a sheet exactly as the PDF lays it out. Each distinct surface is written once and
 * referenced per position, so a sheet of sixty-five identical labels is not sixty-five copies.
 */
export function pageToSvg(page: SvgPage, options: SvgDocumentOptions & { paper?: string }): string {
  const ids = new Map<StudioSurface, string>();
  let defs = '';
  let body = '';
  for (const placement of page.placements) {
    let id = ids.get(placement.surface);
    if (!id) {
      id = `s${ids.size}`;
      ids.set(placement.surface, id);
      defs += `<g id="${id}">${surfaceBodySvg(placement.surface, `${id}-`)}</g>`;
    }
    body += `<use href="#${id}" x="${n(placement.x)}" y="${n(placement.y)}"/>`;
  }
  const overlay = surfaceBodySvg({ width: page.width, height: page.height, ops: [...(page.overlay ?? [])] }, 'o-');
  const description = options.description ? `<desc>${escapeXml(options.description)}</desc>` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(page.width)}mm" height="${n(page.height)}mm" ` +
    `viewBox="0 0 ${n(page.width)} ${n(page.height)}" role="img" aria-label="${escapeXml(options.title)}">` +
    `<title>${escapeXml(options.title)}</title>${description}` +
    `<rect x="0" y="0" width="${n(page.width)}" height="${n(page.height)}" fill="${safeColor(options.paper ?? '#ffffff')}"/>` +
    `<defs>${defs}</defs>${body}${overlay}</svg>`
  );
}
