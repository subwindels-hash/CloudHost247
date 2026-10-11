/**
 * SVG renderer.
 *
 * The SVG path exists for two reasons: it is what the server-side API can return without a canvas,
 * and it is what the test suite inspects op-by-op. It is a renderer, not a second layout engine —
 * it consumes the same `DrawOp` list as the canvas, expands the same QR and barcode ops, and applies
 * the same text fitting, so a card that is well-formed on screen is well-formed here.
 *
 * Images are embedded as data URLs and clipped to their rounded rectangle. A card is a single
 * self-contained file: no external fetch, no font download, nothing that can fail at print time.
 */

import { expandOps, fitTextOp, QR_QUIET_MODULES } from './expand';
import { encodeQrMatrix } from './qr';
import type { CardFace, DrawOp } from './types';

const FONT_STACK: Record<'sans' | 'mono', string> = {
  sans: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  mono: "'DejaVu Sans Mono', 'Courier New', monospace",
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Numbers are emitted with at most two decimals — enough for 300 dpi, and it keeps files small. */
function n(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}

function rectPath(x: number, y: number, w: number, h: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  if (r <= 0) return `M${n(x)},${n(y)}h${n(w)}v${n(h)}h${n(-w)}Z`;
  return (
    `M${n(x + r)},${n(y)}h${n(w - 2 * r)}a${n(r)},${n(r)} 0 0 1 ${n(r)},${n(r)}v${n(h - 2 * r)}` +
    `a${n(r)},${n(r)} 0 0 1 ${n(-r)},${n(r)}h${n(-(w - 2 * r))}a${n(r)},${n(r)} 0 0 1 ${n(-r)},${n(-r)}` +
    `v${n(-(h - 2 * r))}a${n(r)},${n(r)} 0 0 1 ${n(r)},${n(-r)}Z`
  );
}

let clipCounter = 0;

function opToSvg(op: DrawOp): string {
  const opacity =
    'opacity' in op && typeof op.opacity === 'number' && op.opacity < 1 ? ` opacity="${n(op.opacity)}"` : '';
  switch (op.kind) {
    case 'rect': {
      const radius = op.radius ?? 0;
      const fill = op.fill ? ` fill="${escapeXml(op.fill)}"` : ' fill="none"';
      const stroke = op.stroke ? ` stroke="${escapeXml(op.stroke)}" stroke-width="${n(op.strokeWidth ?? 1)}"` : '';
      // A stroked rectangle is drawn on the path centre line; SVG must not inset it, because the
      // template geometry already accounts for the stroke.
      if (radius > 0) return `<path d="${rectPath(op.x, op.y, op.w, op.h, radius)}"${fill}${stroke}${opacity}/>`;
      return `<rect x="${n(op.x)}" y="${n(op.y)}" width="${n(op.w)}" height="${n(op.h)}"${fill}${stroke}${opacity}/>`;
    }
    case 'circle': {
      const fill = op.fill ? ` fill="${escapeXml(op.fill)}"` : ' fill="none"';
      const stroke = op.stroke ? ` stroke="${escapeXml(op.stroke)}" stroke-width="${n(op.strokeWidth ?? 1)}"` : '';
      return `<circle cx="${n(op.cx)}" cy="${n(op.cy)}" r="${n(op.r)}"${fill}${stroke}${opacity}/>`;
    }
    case 'polygon':
      return `<polygon points="${op.points.map((point) => `${n(point.x)},${n(point.y)}`).join(' ')}" fill="${escapeXml(op.fill ?? '#000')}"${opacity}/>`;
    case 'line': {
      const dash = op.dash && op.dash.length > 0 ? ` stroke-dasharray="${op.dash.map((value) => n(value)).join(' ')}"` : '';
      return `<line x1="${n(op.x1)}" y1="${n(op.y1)}" x2="${n(op.x2)}" y2="${n(op.y2)}" stroke="${escapeXml(op.color)}" stroke-width="${n(op.width)}"${dash}/>`;
    }
    case 'text': {
      const text = fitTextOp(op);
      if (text.text === '') return '';
      const anchor = text.anchor && text.anchor !== 'start' ? ` text-anchor="${text.anchor}"` : '';
      const letterSpacing = text.letterSpacing ? ` letter-spacing="${n(text.letterSpacing)}"` : '';
      const family = FONT_STACK[text.family ?? 'sans'];
      const weight = text.weight ?? '400';
      return (
        `<text x="${n(text.x)}" y="${n(text.y)}" font-family="${family}" font-size="${n(text.size)}" font-weight="${weight}" fill="${escapeXml(text.color)}"${anchor}${letterSpacing}${opacity}>` +
        `${escapeXml(text.text)}</text>`
      );
    }
    case 'image': {
      const clipId = `clip${(clipCounter += 1)}`;
      const radius = op.radius ?? 0;
      const preserve = op.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet';
      if (!op.href) {
        if (!op.placeholder) return '';
        return (
          `<clipPath id="${clipId}"><path d="${rectPath(op.x, op.y, op.w, op.h, radius)}"/></clipPath>` +
          `<g clip-path="url(#${clipId})">` +
          `<rect x="${n(op.x)}" y="${n(op.y)}" width="${n(op.w)}" height="${n(op.h)}" fill="${escapeXml(op.placeholder.fill)}"/>` +
          `<text x="${n(op.x + op.w / 2)}" y="${n(op.y + op.h / 2)}" font-family="${FONT_STACK.sans}" font-size="${n(Math.min(op.w, op.h) * 0.3)}" font-weight="700" fill="${escapeXml(op.placeholder.color)}" text-anchor="middle">${escapeXml(op.placeholder.label)}</text>` +
          `</g>`
        );
      }
      const stroke = op.stroke ? `<path d="${rectPath(op.x, op.y, op.w, op.h, radius)}" fill="none" stroke="${escapeXml(op.stroke)}" stroke-width="${n(op.strokeWidth ?? 1)}"/>` : '';
      return (
        `<clipPath id="${clipId}"><path d="${rectPath(op.x, op.y, op.w, op.h, radius)}"/></clipPath>` +
        `<g clip-path="url(#${clipId})">` +
        `<image href="${escapeXml(op.href)}" x="${n(op.x)}" y="${n(op.y)}" width="${n(op.w)}" height="${n(op.h)}" preserveAspectRatio="${preserve}"/>` +
        `</g>${stroke}`
      );
    }
    case 'qr': {
      // Drawn here rather than through `expandOps` so the group can carry the payload it encodes:
      // `<g class="bt247-qr" data-qr-payload="…">` with one rect per dark module, quiet zone
      // included. Anyone inspecting the file can read what the symbol says without scanning it.
      const matrix = encodeQrMatrix(op.payload, 'M');
      if ('ok' in matrix) return '';
      const total = matrix.size + QR_QUIET_MODULES * 2;
      const moduleSize = op.size / total;
      const modules: string[] = [];
      for (let row = 0; row < matrix.size; row += 1) {
        for (let column = 0; column < matrix.size; column += 1) {
          if (!matrix.modules[row]?.[column]) continue;
          modules.push(
            `<rect x="${n(op.x + (column + QR_QUIET_MODULES) * moduleSize)}" y="${n(op.y + (row + QR_QUIET_MODULES) * moduleSize)}" width="${n(moduleSize + 0.4)}" height="${n(moduleSize + 0.4)}"/>`
          );
        }
      }
      return (
        `<rect x="${n(op.x)}" y="${n(op.y)}" width="${n(op.size)}" height="${n(op.size)}" fill="${escapeXml(op.light)}"/>` +
        `<g class="bt247-qr" data-qr-payload="${escapeXml(op.payload)}" data-qr-ecc="M" fill="${escapeXml(op.dark)}">${modules.join('')}</g>`
      );
    }
    default:
      // Barcode ops are expanded before rendering; anything left is a programming error.
      return '';
  }
}

/** One face of the card as a standalone SVG document. */
export function faceToSvg(face: CardFace, options: { title: string; description?: string } = { title: 'Employee ID card' }): string {
  clipCounter = 0;
  const { ops, warnings } = expandOps(face.ops, { keepQrGroups: true });
  const body = ops.map(opToSvg).filter((value) => value !== '').join('');
  const description = options.description ? `<desc>${escapeXml(options.description)}</desc>` : '';
  const warningComment = warnings.length > 0 ? `<!-- ${warnings.map((warning) => escapeXml(warning)).join(' ') } -->` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${face.width}" height="${face.height}" viewBox="0 0 ${face.width} ${face.height}" role="img" aria-label="${escapeXml(options.title)}">` +
    `<title>${escapeXml(options.title)}</title>${description}${warningComment}${body}</svg>`
  );
}

/**
 * A two-page print sheet: front and back, each exactly ID-1 size, ready for a card printer or for
 * "print at 100%" on a sheet of CR80 blanks.
 */
export function cardToPrintSvg(front: CardFace, back: CardFace, title: string): string {
  const gap = 24;
  const width = Math.max(front.width, back.width) + gap * 2;
  const height = front.height + back.height + gap * 3;
  const extract = (face: CardFace): string => {
    const svg = faceToSvg(face, { title });
    return svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  };
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}">` +
    `<title>${escapeXml(title)}</title>` +
    `<rect width="${width}" height="${height}" fill="#FFFFFF"/>` +
    `<g transform="translate(${gap},${gap})">${extract(front)}</g>` +
    `<g transform="translate(${gap},${gap * 2 + front.height})">${extract(back)}</g>` +
    `</svg>`
  );
}
