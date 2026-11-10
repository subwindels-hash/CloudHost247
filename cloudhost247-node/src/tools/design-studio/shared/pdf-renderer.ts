/**
 * Design Studio — PDF renderer.
 *
 * Takes the same `DesignDocument` the SVG renderer consumes and produces a real PDF: one page per
 * document page, at the document's exact physical size, with fonts embedded as Base-14 references
 * (every reader has Helvetica, Times and Courier, so nothing has to be downloaded at print time).
 *
 * ## Why `pdf-lib`
 *
 * The Employee ID Card module hand-writes its PDF because it places two JPEGs on a fixed page and a
 * general-purpose library would have been 100 % overhead. Labels are the opposite case: text,
 * vector barcodes, images and multi-page output with correct page trees. `pdf-lib` is pure
 * JavaScript (no native binary, so it deploys on cPanel shared hosting) and writes standards-
 * conforming files.
 *
 * ## The coordinate flip
 *
 * The document model is top-left origin, y down, in millimetres — the same space the SVG renderer
 * and the tests use. PDF is bottom-left origin, y up, in points. All of that is converted here, in
 * one place, by `toPdfBox`. A renderer that leaks the flip into layout code produces labels whose
 * barcodes are mirrored on one exporter and not the other; keeping it here is deliberate.
 *
 * ## Barcode geometry
 *
 * Bars are emitted as a single filled path per symbol (not one rectangle per bar), because that is
 * what keeps a 200-module QR code from producing a 200-object page — and because a path is
 * resolution-independent in the PDF, so the print is as crisp as the printer allows.
 */

import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFImage } from 'pdf-lib';
import type { DesignDocument, DocumentPage, DrawBarcode, DrawOp, DrawSymbol, FontFamily } from './draw-ops';
import { mmToPoints } from './units';

const FONT_NAMES: Record<FontFamily, StandardFonts> = {
  sans: StandardFonts.Helvetica,
  'sans-bold': StandardFonts.HelveticaBold,
  mono: StandardFonts.Courier,
  serif: StandardFonts.TimesRoman,
};

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex) ? hex : '#000000';
  const full = value.length === 4 ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}` : value;
  return {
    r: parseInt(full.slice(1, 3), 16) / 255,
    g: parseInt(full.slice(3, 5), 16) / 255,
    b: parseInt(full.slice(5, 7), 16) / 255,
  };
}

function colour(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  return rgb(r, g, b);
}

/**
 * WinAnsi can represent the accents in most European names, but not, say, Devanagari or CJK. Rather
 * than dropping the characters silently (which is how a delivery label loses a street name),
 * unsupported code points become `?` *and* the document warns — the renderer collects those.
 */
function sanitiseForWinAnsi(text: string, warnings: Set<string>): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (char === '\n' || char === '\t') {
      out += ' ';
    } else if (code >= 32 && code <= 126) {
      out += char;
    } else if ('·°±µÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïñòóôõöøùúûüýþÿ€‚„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ×÷'.includes(char)) {
      out += char;
    } else {
      out += '?';
      warnings.add(
        `The PDF font could not represent “${char}”. It is printed as “?” — use Latin characters or the SVG/PNG export, which render the full Unicode text.`
      );
    }
  }
  return out;
}

interface RenderState {
  fonts: Map<FontFamily, PDFFont>;
  images: Map<string, PDFImage | null>;
  warnings: Set<string>;
}

/** Convert a top-left-origin millimetre box to PDF points with a bottom-left origin. */
function toPdfBox(page: DocumentPage, box: { x: number; y: number; w: number; h: number }) {
  return {
    x: mmToPoints(box.x),
    y: mmToPoints(page.height - box.y - box.h),
    width: mmToPoints(box.w),
    height: mmToPoints(box.h),
  };
}

function rectPathData(w: number, h: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  if (r <= 0) return `M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`;
  const arc = `A ${r} ${r} 0 0 1`;
  return [
    `M ${r} 0`,
    `L ${w - r} 0`,
    `${arc} ${w} ${r}`,
    `L ${w} ${h - r}`,
    `${arc} ${w - r} ${h}`,
    `L ${r} ${h}`,
    `${arc} 0 ${h - r}`,
    `L 0 ${r}`,
    `${arc} ${r} 0`,
    'Z',
  ].join(' ');
}

const PT_PER_MM = 72 / 25.4;

/**
 * A filled path built from axis-aligned rectangles, in PDF points.
 *
 * Two conversions happen here and nowhere else:
 *
 *  1. **Millimetres → points.** A path's coordinates are user-space units; pdf-lib does not scale
 *     them. Getting this wrong produces a symbol metrically 2.83× too small — still scannable on
 *     screen and 2.83× under the specified X-dimension on paper, which is exactly the class of
 *     silent error the tests catch by decoding the PDF.
 *  2. **The flip.** pdf-lib translates the path to the anchor and then applies `scale(1, -1)`, so
 *     path coordinates are *top-down* — the same direction as the document model. Rectangles can
 *     therefore be emitted verbatim, and the anchor is the top-left corner of the symbol.
 */
function barsPath(polygons: ReadonlyArray<ReadonlyArray<readonly [number, number]>>): string {
  const pt = (mm: number): string => String(Math.round(mm * PT_PER_MM * 1000) / 1000);
  let path = '';
  for (const polygon of polygons) {
    const first = polygon[0];
    if (!first || polygon.length < 3) continue;
    path += `M ${pt(first[0])} ${pt(first[1])} `;
    for (const [x, y] of polygon.slice(1)) path += `L ${pt(x)} ${pt(y)} `;
    path += 'Z ';
  }
  return path.trim();
}

async function drawOp(
  pdf: PDFDocument,
  page: ReturnType<PDFDocument['addPage']>,
  pageModel: DocumentPage,
  op: DrawOp,
  state: RenderState
): Promise<void> {
  switch (op.kind) {
    case 'rect': {
      const box = toPdfBox(pageModel, { x: op.x, y: op.y, w: op.w, h: op.h });
      const draw: Record<string, unknown> = { x: box.x, y: box.y, width: box.width, height: box.height };
      if (op.fill) draw.color = colour(op.fill);
      if (op.stroke) {
        draw.borderColor = colour(op.stroke);
        draw.borderWidth = mmToPoints(op.strokeWidth ?? 0.2);
      }
      if (op.opacity !== undefined && op.opacity < 1) draw.opacity = op.opacity;
      const radius = op.radius ?? 0;
      if (radius > 0) {
        // `drawSvgPath` anchors at the path's top-left corner (it flips internally), so the anchor
        // is the rectangle's top edge — `box.y` would place it one height too low.
        page.drawSvgPath(rectPathData(box.width, box.height, mmToPoints(radius)), {
          x: box.x,
          y: box.y + box.height,
          ...(op.fill ? { color: colour(op.fill) } : {}),
          ...(op.stroke ? { borderColor: colour(op.stroke), borderWidth: mmToPoints(op.strokeWidth ?? 0.2) } : {}),
          ...(op.opacity !== undefined && op.opacity < 1 ? { opacity: op.opacity } : {}),
        });
      } else {
        page.drawRectangle(draw as never);
      }
      return;
    }
    case 'rule': {
      const start = { x: mmToPoints(op.x1), y: mmToPoints(pageModel.height - op.y1) };
      const end = { x: mmToPoints(op.x2), y: mmToPoints(pageModel.height - op.y2) };
      page.drawLine({
        start,
        end,
        color: colour(op.colour),
        thickness: mmToPoints(op.width),
        ...(op.dashed ? { dashArray: [2, 1.5] as number[] } : {}),
      });
      return;
    }
    case 'text': {
      const font = await fontFor(pdf, op.family, state);
      const text = sanitiseForWinAnsi(op.text, state.warnings);
      if (text.trim() === '') return;
      const size = mmToPoints(op.size);
      const width = font.widthOfTextAtSize(text, size);
      const topLeft = { x: mmToPoints(op.x), y: mmToPoints(pageModel.height - op.y) };
      let drawX = topLeft.x;
      if (op.align === 'center') drawX = topLeft.x - width / 2;
      if (op.align === 'right') drawX = topLeft.x - width;
      const baselineY = topLeft.y - size * 0.717;
      page.drawText(text, {
        x: drawX,
        y: baselineY,
        size,
        font,
        color: colour(op.color),
        ...(op.opacity !== undefined && op.opacity < 1 ? { opacity: op.opacity } : {}),
      });
      return;
    }
    case 'lines': {
      const font = await fontFor(pdf, op.family, state);
      const size = mmToPoints(op.size);
      op.lines.forEach((line, index) => {
        const text = sanitiseForWinAnsi(line, state.warnings);
        if (text === '') return;
        const width = font.widthOfTextAtSize(text, size);
        const topLeft = { x: mmToPoints(op.x), y: mmToPoints(pageModel.height - (op.y + index * op.lineHeight)) };
        let drawX = topLeft.x;
        if (op.align === 'center') drawX = topLeft.x - width / 2;
        if (op.align === 'right') drawX = topLeft.x - width;
        page.drawText(text, { x: drawX, y: topLeft.y - size * 0.717, size, font, color: colour(op.color) });
      });
      return;
    }
    case 'image': {
      const image = await imageFor(pdf, op.href, state);
      if (!image) return;
      const box = toPdfBox(pageModel, { x: op.x, y: op.y, w: op.w, h: op.h });
      const imageRatio = image.width / image.height;
      const boxRatio = box.width / box.height;
      let drawWidth = box.width;
      let drawHeight = box.height;
      if (op.fit !== 'fill') {
        if (imageRatio > boxRatio) {
          drawHeight = box.width / imageRatio;
          drawWidth = box.width;
        } else {
          drawWidth = box.height * imageRatio;
          drawHeight = box.height;
        }
      }
      page.drawImage(image, {
        x: box.x + (box.width - drawWidth) / 2,
        y: box.y + (box.height - drawHeight) / 2,
        width: drawWidth,
        height: drawHeight,
      });
      return;
    }
    case 'barcode':
      return drawBarcode(pdf, page, pageModel, op, state);
    case 'symbol':
      return drawSymbol(pdf, page, pageModel, op);
    default:
      return;
  }
}

async function drawBarcode(
  _pdf: PDFDocument,
  page: ReturnType<PDFDocument['addPage']>,
  pageModel: DocumentPage,
  op: DrawBarcode,
  state: RenderState
): Promise<void> {
  const { encoded } = op;
  const textHeight = op.showText ? (op.textHeight ?? 0) : 0;
  const quiet = op.quietMm ?? 0;
  const barsHeight = op.h - textHeight - quiet * 2;
  const barsWidth = op.w - quiet * 2;
  if (op.background) {
    const box = toPdfBox(pageModel, { x: op.x, y: op.y, w: op.w, h: op.h });
    page.drawRectangle({ x: box.x, y: box.y, width: box.width, height: box.height, color: colour(op.background) });
  }

  const scaleX = barsWidth / encoded.widthUnits;
  const scaleY = barsHeight / encoded.heightUnits;
  const scaled = encoded.polygons.map((polygon) => polygon.map(([x, y]) => [x * scaleX, y * scaleY] as const));
  // Anchor at the top-left of the bars area: `drawSvgPath` flips y, so the path is expressed
  // top-down from this point.
  const originBox = { x: mmToPoints(op.x + quiet), y: mmToPoints(pageModel.height - (op.y + quiet)) };
  const path = barsPath(scaled);
  if (path !== '') {
    page.drawSvgPath(path, { x: originBox.x, y: originBox.y, color: colour(op.colour) });
  }

  if (op.showText && encoded.texts.length > 0 && textHeight > 0) {
    const font = await fontFor(_pdf, 'mono', state);
    for (const entry of encoded.texts) {
      // Same rule as the SVG renderer: cap height is a share of the caption strip the caller sized.
      const sizeMm = Math.max(1.2, textHeight * 0.7);
      const size = mmToPoints(sizeMm);
      const text = sanitiseForWinAnsi(entry.text, state.warnings);
      const width = font.widthOfTextAtSize(text, size);
      const centreX = mmToPoints(op.x + quiet + entry.x * scaleX);
      // Baseline measured from the top of the caption strip, the same rule the SVG renderer uses.
      const textTopMm = op.y + quiet + barsHeight;
      const baselineY = mmToPoints(pageModel.height - textTopMm) - size * 0.72;
      page.drawText(text, {
        x: centreX - width / 2,
        y: baselineY,
        size,
        font,
        color: colour(op.colour),
      });
    }
  }
}

function drawSymbol(
  _pdf: PDFDocument,
  page: ReturnType<PDFDocument['addPage']>,
  pageModel: DocumentPage,
  op: DrawSymbol
): void {
  const totalModules = op.modules + op.quietModules * 2;
  const moduleMm = op.size / totalModules;
  const offset = op.quietModules * moduleMm;
  if (op.background) {
    const box = toPdfBox(pageModel, { x: op.x, y: op.y, w: op.size, h: op.size });
    page.drawRectangle({ x: box.x, y: box.y, width: box.width, height: box.height, color: colour(op.background) });
  }
  const rects: Array<Array<[number, number]>> = [];
  for (let row = 0; row < op.matrix.length; row += 1) {
    const line = op.matrix[row] ?? [];
    let column = 0;
    while (column < line.length) {
      if (line[column]) {
        let run = 1;
        while (column + run < line.length && line[column + run]) run += 1;
        const left = offset + column * moduleMm;
        const top = offset + row * moduleMm;
        const right = left + run * moduleMm;
        const bottom = top + moduleMm;
        rects.push([
          [left, top],
          [right, top],
          [right, bottom],
          [left, bottom],
        ]);
        column += run;
      } else {
        column += 1;
      }
    }
  }
  const originBox = { x: mmToPoints(op.x), y: mmToPoints(pageModel.height - op.y) };
  const path = barsPath(rects);
  if (path !== '') page.drawSvgPath(path, { x: originBox.x, y: originBox.y, color: colour(op.colour) });
}

async function fontFor(pdf: PDFDocument, family: FontFamily, state: RenderState): Promise<PDFFont> {
  const existing = state.fonts.get(family);
  if (existing) return existing;
  const font = await pdf.embedFont(FONT_NAMES[family] ?? StandardFonts.Helvetica);
  state.fonts.set(family, font);
  return font;
}

async function imageFor(pdf: PDFDocument, href: string, state: RenderState): Promise<PDFImage | null> {
  const cached = state.images.get(href);
  if (cached !== undefined) return cached;
  const match = /^data:(image\/(?:png|jpeg|jpg));base64,([a-z0-9+/=\s]+)$/i.exec(href);
  if (!match) {
    state.images.set(href, null);
    state.warnings.add('An image could not be embedded in the PDF because it is not a PNG or JPEG data URL. It is still shown in the SVG and PNG exports.');
    return null;
  }
  try {
    const bytes = Uint8Array.from(Buffer.from((match[2] ?? '').replace(/\s+/g, ''), 'base64'));
    const image = (match[1] ?? '').toLowerCase().includes('png') ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    state.images.set(href, image);
    return image;
  } catch (error) {
    state.images.set(href, null);
    state.warnings.add(`An image could not be embedded in the PDF: ${error instanceof Error ? error.message : 'the file could not be read'}.`);
    return null;
  }
}

export interface PdfRenderOptions {
  /** Restrict the output to one page (1-based). Used by "export current label". */
  page?: number;
}

/**
 * Render a document to PDF bytes.
 *
 * The page's `MediaBox` is the document page's exact millimetre size converted to points, so a
 * 210 × 148 mm VDA label prints at 210 × 148 mm — not at A4 — when the reader is told to use the
 * actual size.
 */
export async function renderDocumentPdf(document: DesignDocument, options: PdfRenderOptions = {}): Promise<Uint8Array> {
  if (document.pages.length === 0) throw new Error('A document needs at least one page.');
  const pdf = await PDFDocument.create();
  pdf.setTitle(document.title);
  pdf.setCreator(document.creator ?? 'CloudHost247 Design Studio');
  pdf.setProducer('CloudHost247 Design Studio');
  if (document.subject) pdf.setSubject(document.subject);
  if (document.author) pdf.setAuthor(document.author);
  pdf.setCreationDate(new Date(0));
  pdf.setModificationDate(new Date(0));

  const state: RenderState = { fonts: new Map(), images: new Map(), warnings: new Set() };
  const pages = options.page ? document.pages.filter((_, index) => index === options.page! - 1) : document.pages;
  if (pages.length === 0) throw new Error(`Page ${options.page} does not exist in this document.`);

  for (const model of pages) {
    const page = pdf.addPage([mmToPoints(model.width), mmToPoints(model.height)]);
    page.drawRectangle({
      x: 0,
      y: 0,
      width: mmToPoints(model.width),
      height: mmToPoints(model.height),
      color: rgb(1, 1, 1),
    });
    for (const op of model.ops) {
      // Sequential on purpose: pdf-lib's embedding is async but stateful, and a parallel map over
      // the same document would interleave image/font embeddings unpredictably.
      // eslint-disable-next-line no-await-in-loop
      await drawOp(pdf, page, model, op, state);
    }
  }

  const bytes = await pdf.save();
  document.warnings.push(...state.warnings);
  return bytes;
}

/** Exposed for the tests: verify the coordinate flip independently of the drawing code. */
export function flipY(pageHeightMm: number, yMm: number): number {
  return pageHeightMm - yMm;
}

export { degrees };
