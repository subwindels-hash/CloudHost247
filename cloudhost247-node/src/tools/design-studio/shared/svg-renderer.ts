/**
 * Design Studio — SVG renderer.
 *
 * Turns a `DesignDocument` into a standalone SVG file: one `<svg>` per page, or a single `<svg>`
 * with the page size as its viewBox when the document has one page (the common case, and what the
 * live preview embeds).
 *
 * Why SVG is the primary export format:
 *
 *  * it is resolution-independent, so the same file prints at 300 dpi or 1200 dpi;
 *  * it is *inspectable* — the tests parse it, and so can anyone auditing a label;
 *  * it needs no canvas, so the API can produce exactly the file the browser produces.
 *
 * Sizes in this file are millimetres, written into the SVG as user units with a `width`/`height` in
 * `mm`. A browser or printer then knows the physical size without guessing from pixels.
 *
 * Barcode geometry comes from `EncodedBarcode`, whose rectangles are already in symbol units; this
 * renderer scales them by `moduleMm` and offsets them, and never re-derives a bar position.
 */

import type { DrawOp, DesignDocument, DocumentPage, DrawBarcode, DrawSymbol, FontFamily } from './draw-ops';
import { FONT_FAMILIES } from './draw-ops';
import { CAP_HEIGHT_RATIO, measureText } from './text-metrics';

function escapeXml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Two decimals is 0.01 mm — finer than any printer, and keeps files small. */
function n(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function cssFont(family: FontFamily): string {
  return FONT_FAMILIES[family]?.css ?? FONT_FAMILIES.sans.css;
}

function fontWeight(family: FontFamily): string {
  return family === 'sans-bold' ? '700' : '400';
}

function alignAnchor(align: 'left' | 'center' | 'right' | undefined): string {
  if (align === 'center') return 'middle';
  if (align === 'right') return 'end';
  return 'start';
}

/** Baseline y for a text box whose top edge is `y` at font `size`. */
function baseline(y: number, size: number): number {
  return y + size * CAP_HEIGHT_RATIO;
}

function rectPath(x: number, y: number, w: number, h: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  if (r <= 0) return `M${n(x)},${n(y)}h${n(w)}v${n(h)}h${n(-w)}Z`;
  return (
    `M${n(x + r)},${n(y)}h${n(w - 2 * r)}a${n(r)},${n(r)} 0 0 1 ${n(r)},${n(r)}` +
    `v${n(h - 2 * r)}a${n(r)},${n(r)} 0 0 1 ${n(-r)},${n(r)}` +
    `h${n(-(w - 2 * r))}a${n(r)},${n(r)} 0 0 1 ${n(-r)},${n(-r)}` +
    `v${n(-(h - 2 * r))}a${n(r)},${n(r)} 0 0 1 ${n(r)},${n(-r)}Z`
  );
}

/* ------------------------------------------------------------------ */
/* Individual ops                                                      */
/* ------------------------------------------------------------------ */

function renderBarcode(op: DrawBarcode): string {
  const out: string[] = [];
  const { encoded, moduleMm, colour } = op;
  const quiet = op.quietMm ?? 0;
  const textHeight = op.showText ? (op.textHeight ?? 0) : 0;
  // The quiet zone is part of the op's footprint; the symbol itself starts inside it.
  const barsWidth = op.w - quiet * 2;
  const barsHeight = op.h - textHeight - quiet * 2;
  const scaleX = barsWidth / encoded.widthUnits;
  const scaleY = barsHeight / encoded.heightUnits;
  const originX = op.x + quiet;
  const originY = op.y + quiet;

  if (op.background) {
    out.push(`<rect x="${n(op.x)}" y="${n(op.y)}" width="${n(op.w)}" height="${n(op.h)}" fill="${escapeXml(op.background)}"/>`);
  }

  // One path for every dark region. A Code 128 symbol is ~50 rectangles, a QR is ~200, and a
  // PDF417 row is a concave stepped outline — so the path is built from the region polygons rather
  // than from bounding boxes, which would ink the white gaps the symbology depends on.
  let bars = '';
  for (const polygon of encoded.polygons) {
    if (polygon.length < 3) continue;
    const [first, ...rest] = polygon;
    if (!first) continue;
    bars += `M${n(originX + first[0] * scaleX)},${n(originY + first[1] * scaleY)}`;
    for (const [x, y] of rest) bars += `L${n(originX + x * scaleX)},${n(originY + y * scaleY)}`;
    bars += 'Z';
  }
  out.push(`<path d="${bars}" fill="${escapeXml(colour)}" fill-rule="nonzero" shape-rendering="crispEdges"/>`);

  if (op.showText && encoded.texts.length > 0 && textHeight > 0) {
    const textTop = originY + barsHeight;
    // Cap height as a share of the caption strip: the strip is sized by the module and is the only
    // measurement the caller controls, so the caption is derived from it rather than from the
    // encoder's layout units (which vary per symbology and are not millimetres).
    const sizeMm = Math.max(1.2, textHeight * 0.7);
    for (const entry of encoded.texts) {
      const x = originX + entry.x * scaleX;
      const y = textTop + Math.max(0, (textHeight - sizeMm) / 2) + sizeMm * 0.72;
      out.push(
        `<text x="${n(x)}" y="${n(y)}" font-family="'DejaVu Sans Mono','Courier New',monospace" font-size="${n(sizeMm)}" fill="${escapeXml(colour)}">${escapeXml(entry.text)}</text>`
      );
    }
  }

  // `data-payload` makes the encoded value readable to a decoder-based test (and to a reviewer)
  // straight out of the document.
  out.push(`<!-- barcode:${escapeXml(encoded.formatId)} payload:${escapeXml(encoded.payload)} module:${n(moduleMm)}mm -->`);
  return out.join('\n');
}

function renderSymbol(op: DrawSymbol): string {
  const out: string[] = [];
  const totalModules = op.modules + op.quietModules * 2;
  const moduleMm = op.size / totalModules;
  const offset = op.quietModules * moduleMm;
  if (op.background) {
    out.push(`<rect x="${n(op.x)}" y="${n(op.y)}" width="${n(op.size)}" height="${n(op.size)}" fill="${escapeXml(op.background)}"/>`);
  }
  let path = '';
  for (let row = 0; row < op.matrix.length; row += 1) {
    const line = op.matrix[row] ?? [];
    let column = 0;
    while (column < line.length) {
      if (line[column]) {
        let run = 1;
        while (column + run < line.length && line[column + run]) run += 1;
        path += `M${n(op.x + offset + column * moduleMm)},${n(op.y + offset + row * moduleMm)}h${n(run * moduleMm)}v${n(moduleMm)}h${n(-run * moduleMm)}Z`;
        column += run;
      } else {
        column += 1;
      }
    }
  }
  out.push(`<path d="${path}" fill="${escapeXml(op.colour)}" shape-rendering="crispEdges"/>`);
  out.push(`<!-- symbol:${op.modules}x${op.modules} payload:${escapeXml(op.payload)} -->`);
  return out.join('\n');
}

function renderOp(op: DrawOp): string {
  switch (op.kind) {
    case 'rect': {
      const fill = op.fill ? ` fill="${escapeXml(op.fill)}"` : ' fill="none"';
      const stroke = op.stroke ? ` stroke="${escapeXml(op.stroke)}" stroke-width="${n(op.strokeWidth ?? 0.2)}"` : '';
      const opacity = op.opacity !== undefined && op.opacity < 1 ? ` opacity="${n(op.opacity)}"` : '';
      const radius = op.radius ?? 0;
      if (radius > 0) {
        return `<path d="${rectPath(op.x, op.y, op.w, op.h, radius)}"${fill}${stroke}${opacity}/>`;
      }
      return `<rect x="${n(op.x)}" y="${n(op.y)}" width="${n(op.w)}" height="${n(op.h)}"${fill}${stroke}${opacity}/>`;
    }
    case 'rule': {
      const dash = op.dashed ? ' stroke-dasharray="2 1.5"' : '';
      return `<line x1="${n(op.x1)}" y1="${n(op.y1)}" x2="${n(op.x2)}" y2="${n(op.y2)}" stroke="${escapeXml(op.colour)}" stroke-width="${n(op.width)}"${dash}/>`;
    }
    case 'text': {
      const anchor = alignAnchor(op.align);
      const x = op.align === 'center' ? op.x : op.align === 'right' ? op.x : op.x;
      const spacing = op.letterSpacing ? ` letter-spacing="${n(op.letterSpacing)}"` : '';
      const y = baseline(op.y, op.size);
      // A `textLength` on an overflowing string would squash the glyphs; instead the layout engine
      // already fitted the size. This only guards a caller that skipped that step.
      return `<text x="${n(x)}" y="${n(y)}" font-family="${escapeXml(cssFont(op.family))}" font-size="${n(op.size)}" font-weight="${fontWeight(op.family)}" fill="${escapeXml(op.color)}" text-anchor="${anchor}"${spacing}>${escapeXml(op.text)}</text>`;
    }
    case 'lines': {
      const out: string[] = [];
      op.lines.forEach((line, index) => {
        const y = baseline(op.y + index * op.lineHeight, op.size);
        out.push(
          `<text x="${n(op.x)}" y="${n(y)}" font-family="${escapeXml(cssFont(op.family))}" font-size="${n(op.size)}" font-weight="${fontWeight(op.family)}" fill="${escapeXml(op.color)}" text-anchor="${alignAnchor(op.align)}">${escapeXml(line)}</text>`
        );
      });
      return out.join('\n');
    }
    case 'image': {
      const opacity = op.opacity !== undefined && op.opacity < 1 ? ` opacity="${n(op.opacity)}"` : '';
      const clipId = `clip-${Math.abs(hashString(op.href.slice(0, 48) + n(op.x) + n(op.y)))}`;
      const radius = op.radius ?? 0;
      const defs =
        radius > 0
          ? `<defs><clipPath id="${clipId}"><path d="${rectPath(op.x, op.y, op.w, op.h, radius)}"/></clipPath></defs>`
          : '';
      const clip = radius > 0 ? ` clip-path="url(#${clipId})"` : '';
      // preserveAspectRatio is how "contain" and "cover" are expressed in SVG without cropping.
      const aspect =
        op.fit === 'fill' ? 'none' : op.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet';
      return `${defs}<image x="${n(op.x)}" y="${n(op.y)}" width="${n(op.w)}" height="${n(op.h)}" href="${escapeXml(op.href)}" preserveAspectRatio="${aspect}"${clip}${opacity}/>`;
    }
    case 'barcode':
      return renderBarcode(op);
    case 'symbol':
      return renderSymbol(op);
    default:
      return '';
  }
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return hash;
}

/* ------------------------------------------------------------------ */
/* Pages and documents                                                 */
/* ------------------------------------------------------------------ */

export function renderPageSvg(page: DocumentPage, options: { background?: string } = {}): string {
  const background = options.background ?? '#ffffff';
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(page.width)}mm" height="${n(page.height)}mm" viewBox="0 0 ${n(page.width)} ${n(page.height)}" role="img">`,
    `<rect x="0" y="0" width="${n(page.width)}" height="${n(page.height)}" fill="${background}"/>`,
    ...page.ops.map(renderOp),
    '</svg>',
  ].join('\n');
}

/**
 * Render a document to SVG.
 *
 * Multi-page documents become one SVG per page inside an `<svg>` wrapper with explicit page
 * offsets, which is the only way to keep "page N is 210 × 148 mm" true in a format that has no page
 * concept. Callers that need real pages ask for a PDF instead.
 */
export function renderDocumentSvg(document: DesignDocument): string {
  if (document.pages.length === 0) throw new Error('A document needs at least one page.');
  if (document.pages.length === 1) {
    const page = document.pages[0]!;
    return renderPageSvg(page);
  }
  const totalHeight = document.pages.reduce((total, page) => total + page.height, 0);
  const width = Math.max(...document.pages.map((page) => page.width));
  let offsetY = 0;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(width)}mm" height="${n(totalHeight)}mm" viewBox="0 0 ${n(width)} ${n(totalHeight)}">`,
  ];
  for (const page of document.pages) {
    parts.push(`<g transform="translate(0 ${n(offsetY)})">`);
    parts.push(`<rect x="0" y="0" width="${n(page.width)}" height="${n(page.height)}" fill="#ffffff" stroke="#cbd5e0" stroke-width="0.2"/>`);
    parts.push(page.ops.map(renderOp).join('\n'));
    parts.push('</g>');
    offsetY += page.height;
  }
  parts.push('</svg>');
  return parts.join('\n');
}

/**
 * A single opaque page for the interactive preview.
 *
 * The preview embeds this in an `<img>`; nothing in it is interactive, so no user content can
 * execute inside the app's origin even if a text element contains markup (it cannot — everything is
 * escaped on the way in).
 */
export function renderPreviewSvg(page: DocumentPage): string {
  return renderPageSvg(page);
}

/** Width in millimetres of a string, exposed for layout code and tests. */
export function textWidthMm(text: string, size: number, family: FontFamily): number {
  return measureText(text, size, family);
}
