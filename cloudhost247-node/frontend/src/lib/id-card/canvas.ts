/**
 * Canvas renderer — the browser half of the badge maker.
 *
 * The preview canvas and the PNG/JPG/PDF exports are the *same* canvas: the preview is the export
 * scaled down by CSS, not a separate drawing. That is a deliberate design decision. A live preview
 * that is only approximately the same as the download is a preview that will eventually be wrong,
 * and the user will only find out after printing 400 badges.
 *
 * Everything asynchronous about raster work is handled here, once: images are decoded before any
 * drawing begins, so a face is never captured half-painted, and a failed image load is reported
 * rather than silently leaving a hole in the card.
 */

import { expandOps, fitTextOp } from '../../../../src/tools/business/id-card/expand';
import type { CardFace, DrawOp } from '../../../../src/tools/business/id-card/types';

export interface ImageSourceMap {
  [href: string]: CanvasImageSource;
}

const FONT_STACK: Record<'sans' | 'mono', string> = {
  sans: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  mono: "'DejaVu Sans Mono', 'Courier New', monospace",
};

/** Every image href referenced by a set of faces, deduplicated. */
export function imageHrefs(faces: CardFace[]): string[] {
  const seen = new Set<string>();
  for (const face of faces) {
    for (const op of face.ops) {
      if (op.kind === 'image' && op.href) seen.add(op.href);
    }
  }
  return [...seen];
}

/**
 * Decode every image the card needs.
 *
 * `Image` is used rather than `fetch` + `createImageBitmap` because Safari has historically refused
 * to decode data URLs through `createImageBitmap`. Failures are returned, not thrown: a missing
 * logo should degrade to the monogram tile, not abort the download.
 */
export async function loadImages(hrefs: string[]): Promise<{ sources: ImageSourceMap; failed: string[] }> {
  const sources: ImageSourceMap = {};
  const failed: string[] = [];
  await Promise.all(
    hrefs.map(
      (href) =>
        new Promise<void>((resolve) => {
          const image = new Image();
          image.onload = () => {
            sources[href] = image;
            resolve();
          };
          image.onerror = () => {
            failed.push(href);
            resolve();
          };
          image.src = href;
        })
    )
  );
  return { sources, failed };
}

function roundedPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number): void {
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}

function drawText(ctx: CanvasRenderingContext2D, op: Extract<DrawOp, { kind: 'text' }>): void {
  const text = fitTextOp(op);
  if (text.text === '') return;
  ctx.save();
  ctx.globalAlpha = typeof text.opacity === 'number' ? Math.max(0, Math.min(1, text.opacity)) : 1;
  ctx.fillStyle = text.color;
  ctx.font = `${text.weight ?? '400'} ${text.size}px ${FONT_STACK[text.family ?? 'sans']}`;
  ctx.textAlign = text.anchor === 'middle' ? 'center' : text.anchor === 'end' ? 'right' : 'left';
  ctx.textBaseline = 'alphabetic';
  if (text.letterSpacing && text.letterSpacing > 0) {
    // Drawn glyph by glyph: canvas letter-spacing support is recent and inconsistent, and a tracked
    // label that renders untracked in one browser is not a reason to lose the layout.
    const characters = [...text.text];
    const spacing = text.letterSpacing ?? 0;
    const widths = characters.map((character) => ctx.measureText(character).width + spacing);
    const total = widths.reduce((sum, width) => sum + width, 0) - spacing;
    let cursor = text.x;
    if (text.anchor === 'middle') cursor -= total / 2;
    else if (text.anchor === 'end') cursor -= total;
    characters.forEach((character, index) => {
      ctx.fillText(character, cursor, text.y);
      cursor += widths[index] ?? 0;
    });
    ctx.restore();
    return;
  }
  ctx.fillText(text.text, text.x, text.y);
  ctx.restore();
}

function drawImageOp(ctx: CanvasRenderingContext2D, op: Extract<DrawOp, { kind: 'image' }>, sources: ImageSourceMap): void {
  const radius = op.radius ?? 0;
  const source = op.href ? sources[op.href] : undefined;
  ctx.save();
  roundedPath(ctx, op.x, op.y, op.w, op.h, radius);
  ctx.clip();
  if (source) {
    const natural = imageSize(source);
    if (natural.width > 0 && natural.height > 0) {
      if (op.fit === 'cover') {
        const scale = Math.max(op.w / natural.width, op.h / natural.height);
        const width = natural.width * scale;
        const height = natural.height * scale;
        ctx.drawImage(source, op.x + (op.w - width) / 2, op.y + (op.h - height) / 2, width, height);
      } else {
        const scale = Math.min(op.w / natural.width, op.h / natural.height);
        const width = natural.width * scale;
        const height = natural.height * scale;
        ctx.drawImage(source, op.x + (op.w - width) / 2, op.y + (op.h - height) / 2, width, height);
      }
    }
  } else if (op.placeholder) {
    ctx.fillStyle = op.placeholder.fill;
    ctx.fillRect(op.x, op.y, op.w, op.h);
    ctx.fillStyle = op.placeholder.color;
    ctx.font = `700 ${Math.min(op.w, op.h) * 0.3}px ${FONT_STACK.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(op.placeholder.label, op.x + op.w / 2, op.y + op.h / 2);
  }
  ctx.restore();
  if (op.stroke) {
    ctx.save();
    roundedPath(ctx, op.x, op.y, op.w, op.h, radius);
    ctx.strokeStyle = op.stroke;
    ctx.lineWidth = op.strokeWidth ?? 1;
    ctx.stroke();
    ctx.restore();
  }
}

function imageSize(source: CanvasImageSource): { width: number; height: number } {
  const candidate = source as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };
  const width = candidate.naturalWidth ?? candidate.width ?? 0;
  const height = candidate.naturalHeight ?? candidate.height ?? 0;
  return { width, height };
}

/** Draw one face. The caller supplies a canvas already sized to `face.width × face.height`. */
export function drawFace(ctx: CanvasRenderingContext2D, face: CardFace, sources: ImageSourceMap, options: { background?: string } = {}): string[] {
  const { ops, warnings } = expandOps(face.ops);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  if (options.background) {
    ctx.fillStyle = options.background;
    ctx.fillRect(0, 0, face.width, face.height);
  }
  for (const op of ops) {
    switch (op.kind) {
      case 'rect': {
        ctx.save();
        ctx.globalAlpha = typeof op.opacity === 'number' ? Math.max(0, Math.min(1, op.opacity)) : 1;
        const radius = op.radius ?? 0;
        if (op.fill) {
          roundedPath(ctx, op.x, op.y, op.w, op.h, radius);
          ctx.fillStyle = op.fill;
          ctx.fill();
        }
        if (op.stroke) {
          roundedPath(ctx, op.x, op.y, op.w, op.h, radius);
          ctx.strokeStyle = op.stroke;
          ctx.lineWidth = op.strokeWidth ?? 1;
          ctx.stroke();
        }
        ctx.restore();
        break;
      }
      case 'circle': {
        ctx.save();
        ctx.globalAlpha = typeof op.opacity === 'number' ? Math.max(0, Math.min(1, op.opacity)) : 1;
        ctx.beginPath();
        ctx.arc(op.cx, op.cy, Math.max(0.5, op.r), 0, Math.PI * 2);
        if (op.fill) {
          ctx.fillStyle = op.fill;
          ctx.fill();
        }
        if (op.stroke) {
          ctx.strokeStyle = op.stroke;
          ctx.lineWidth = op.strokeWidth ?? 1;
          ctx.stroke();
        }
        ctx.restore();
        break;
      }
      case 'polygon': {
        if (op.points.length < 3) break;
        ctx.save();
        ctx.globalAlpha = typeof op.opacity === 'number' ? Math.max(0, Math.min(1, op.opacity)) : 1;
        ctx.beginPath();
        op.points.forEach((point, index) => (index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)));
        ctx.closePath();
        ctx.fillStyle = op.fill ?? '#000000';
        ctx.fill();
        ctx.restore();
        break;
      }
      case 'line': {
        ctx.save();
        ctx.strokeStyle = op.color;
        ctx.lineWidth = op.width;
        if (op.dash && op.dash.length > 0) ctx.setLineDash(op.dash);
        ctx.beginPath();
        ctx.moveTo(op.x1, op.y1);
        ctx.lineTo(op.x2, op.y2);
        ctx.stroke();
        ctx.restore();
        break;
      }
      case 'text':
        drawText(ctx, op);
        break;
      case 'image':
        drawImageOp(ctx, op, sources);
        break;
      default:
        break;
    }
  }
  ctx.restore();
  return warnings;
}

/**
 * A canvas as a Blob.
 *
 * `toBlob` is asynchronous and its failure mode is a null blob, which is why the promise rejects
 * with a message the caller can show. An export that produces an empty file and reports success is
 * exactly the failure this whole module exists to prevent.
 */
export function canvasToBlob(canvas: HTMLCanvasElement, type: 'image/png' | 'image/jpeg', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('The browser could not encode this image. Try a smaller photograph or a JPEG export.'));
      },
      type,
      quality
    );
  });
}

/** Read a blob's bytes. Used to embed a JPEG in the PDF. */
export async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

/** A data URL for an uploaded image, read and validated by the caller. */
export function canvasToDataUrl(canvas: HTMLCanvasElement, type: 'image/png' | 'image/jpeg' = 'image/png', quality?: number): string {
  return canvas.toDataURL(type, quality);
}
