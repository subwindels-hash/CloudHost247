/**
 * Vector PDF writer for Design Studio surfaces.
 *
 * The ID-card PDF writer (`business/id-card/pdf.ts`) places one JPEG per page. That is right for a
 * photographed badge and wrong for a label: a barcode embedded as a compressed photograph has soft
 * edges, and a label printer is a 203 or 300 dpi device that needs hard ones. This writer emits
 * drawing operators instead — bars are filled rectangles, modules are filled paths, text is text in
 * a standard font — so the page is resolution-independent and prints at whatever the device can do.
 *
 * What it produces, and why it is built by hand:
 *
 *  - A catalog, a page tree and one content stream per page, with a byte-exact cross-reference
 *    table. A PDF whose xref is off by a byte opens in some readers and not in others; computing the
 *    offsets from the bytes actually written is the only way to be sure, and it is what lets the
 *    test suite verify the file without a PDF viewer.
 *  - Each distinct surface becomes a Form XObject that pages place by reference. A sheet of
 *    twenty-four identical labels therefore stores the label once.
 *  - Text uses the fonts every reader must provide (Helvetica, Helvetica-Bold, Courier,
 *    Courier-Bold) with WinAnsi encoding, so nothing is embedded and the widths are the ones
 *    `text-metrics.ts` measured the layout with.
 *  - `/PrintScaling /None` asks the reader to print at actual size. A label scaled to "fit page" is
 *    a label whose barcode has the wrong module width, so this is the default the document carries.
 *
 * Server-side only: it deflates streams with `node:zlib` and decodes PNG logos with `pngjs`.
 */

import { deflateSync } from 'node:zlib';
import { PNG } from 'pngjs';
import type { PathSegment, StudioOp, StudioSurface } from './draw-ops';
import { resolveTextRun } from './text-run';
import type { StudioFont } from './text-metrics';

export interface PdfPlacement {
  surface: StudioSurface;
  /** Offset of the surface's top-left corner on the page, in millimetres. */
  x: number;
  y: number;
}

export interface PdfPageSpec {
  /** Page size in millimetres. */
  width: number;
  height: number;
  placements: PdfPlacement[];
  /** Drawn in page coordinates on top of the placements (crop marks, registration notes). */
  overlay?: StudioOp[];
}

export interface PdfInfo {
  title: string;
  subject?: string;
  author?: string;
  keywords?: string;
  creator?: string;
}

export interface PdfBuildOptions {
  /** Deflate content streams. On by default; tests turn it off to read the operators. */
  compress?: boolean;
}

export interface PdfBuildResult {
  bytes: Uint8Array;
  pageCount: number;
  /** Images that could not be embedded, with the reason. The page is still produced without them. */
  skippedImages: string[];
}

export const PDF_PRODUCER = 'CloudHost247 Design Studio';
const MM_TO_PT = 72 / 25.4;
/** Control-point offset that makes four cubic Béziers approximate a circle. */
const KAPPA = 0.5522847498;

const FONT_BASE: Record<StudioFont, string> = {
  sans: 'Helvetica',
  'sans-bold': 'Helvetica-Bold',
  mono: 'Courier',
  'mono-bold': 'Courier-Bold',
};

/* ------------------------------------------------------------------ */
/* Low-level helpers                                                   */
/* ------------------------------------------------------------------ */

/** Latin-1 encode: PDF syntax is bytes, and no character here is above 0xFF. */
function latin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) out[index] = text.charCodeAt(index) & 0xff;
  return out;
}

function fmt(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? '0' : rounded.toString();
}

/** A PDF literal string from Windows-1252 byte values; everything unsafe is written as octal. */
function literalFromCodes(codes: readonly number[]): string {
  let out = '(';
  for (const code of codes) {
    if (code === 0x28 || code === 0x29 || code === 0x5c) out += `\\${String.fromCharCode(code)}`;
    else if (code < 0x20 || code > 0x7e) out += `\\${code.toString(8).padStart(3, '0')}`;
    else out += String.fromCharCode(code);
  }
  return `${out})`;
}

/** A document-information string: ASCII as a literal, anything else as UTF-16BE with a BOM. */
function infoString(text: string): string {
  if (/^[\x20-\x7e]*$/.test(text)) return literalFromCodes([...text].map((char) => char.charCodeAt(0)));
  let hex = 'FEFF';
  for (let index = 0; index < text.length; index += 1) hex += text.charCodeAt(index).toString(16).toUpperCase().padStart(4, '0');
  return `<${hex}>`;
}

function parseHex(color: string | undefined): [number, number, number] | null {
  if (!color) return null;
  const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(color);
  if (!match) return null;
  const hex = match[1] as string;
  const full = hex.length === 3 ? hex.split('').map((char) => char + char).join('') : hex;
  return [parseInt(full.slice(0, 2), 16) / 255, parseInt(full.slice(2, 4), 16) / 255, parseInt(full.slice(4, 6), 16) / 255];
}

function fillColor(color: string | undefined): string | null {
  const rgb = parseHex(color);
  return rgb ? `${fmt(rgb[0])} ${fmt(rgb[1])} ${fmt(rgb[2])} rg` : null;
}

function strokeColor(color: string | undefined): string | null {
  const rgb = parseHex(color);
  return rgb ? `${fmt(rgb[0])} ${fmt(rgb[1])} ${fmt(rgb[2])} RG` : null;
}

function rectPath(x: number, y: number, w: number, h: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  if (r <= 0) return `${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)} re`;
  const k = r * KAPPA;
  return [
    `${fmt(x + r)} ${fmt(y)} m`,
    `${fmt(x + w - r)} ${fmt(y)} l`,
    `${fmt(x + w - r + k)} ${fmt(y)} ${fmt(x + w)} ${fmt(y + r - k)} ${fmt(x + w)} ${fmt(y + r)} c`,
    `${fmt(x + w)} ${fmt(y + h - r)} l`,
    `${fmt(x + w)} ${fmt(y + h - r + k)} ${fmt(x + w - r + k)} ${fmt(y + h)} ${fmt(x + w - r)} ${fmt(y + h)} c`,
    `${fmt(x + r)} ${fmt(y + h)} l`,
    `${fmt(x + r - k)} ${fmt(y + h)} ${fmt(x)} ${fmt(y + h - r + k)} ${fmt(x)} ${fmt(y + h - r)} c`,
    `${fmt(x)} ${fmt(y + r)} l`,
    `${fmt(x)} ${fmt(y + r - k)} ${fmt(x + r - k)} ${fmt(y)} ${fmt(x + r)} ${fmt(y)} c`,
    'h',
  ].join('\n');
}

function circlePath(cx: number, cy: number, r: number): string {
  const k = r * KAPPA;
  return [
    `${fmt(cx + r)} ${fmt(cy)} m`,
    `${fmt(cx + r)} ${fmt(cy + k)} ${fmt(cx + k)} ${fmt(cy + r)} ${fmt(cx)} ${fmt(cy + r)} c`,
    `${fmt(cx - k)} ${fmt(cy + r)} ${fmt(cx - r)} ${fmt(cy + k)} ${fmt(cx - r)} ${fmt(cy)} c`,
    `${fmt(cx - r)} ${fmt(cy - k)} ${fmt(cx - k)} ${fmt(cy - r)} ${fmt(cx)} ${fmt(cy - r)} c`,
    `${fmt(cx + k)} ${fmt(cy - r)} ${fmt(cx + r)} ${fmt(cy - k)} ${fmt(cx + r)} ${fmt(cy)} c`,
    'h',
  ].join('\n');
}

/** Path segments as PDF operators. A quadratic is raised to the equivalent cubic. */
function segmentsToOperators(segments: readonly PathSegment[]): string {
  const out: string[] = [];
  let px = 0;
  let py = 0;
  let startX = 0;
  let startY = 0;
  for (const segment of segments) {
    switch (segment.type) {
      case 'M':
        out.push(`${fmt(segment.x)} ${fmt(segment.y)} m`);
        px = startX = segment.x;
        py = startY = segment.y;
        break;
      case 'L':
        out.push(`${fmt(segment.x)} ${fmt(segment.y)} l`);
        px = segment.x;
        py = segment.y;
        break;
      case 'Q': {
        const c1x = px + (2 / 3) * (segment.cx - px);
        const c1y = py + (2 / 3) * (segment.cy - py);
        const c2x = segment.x + (2 / 3) * (segment.cx - segment.x);
        const c2y = segment.y + (2 / 3) * (segment.cy - segment.y);
        out.push(`${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(segment.x)} ${fmt(segment.y)} c`);
        px = segment.x;
        py = segment.y;
        break;
      }
      case 'C':
        out.push(`${fmt(segment.c1x)} ${fmt(segment.c1y)} ${fmt(segment.c2x)} ${fmt(segment.c2y)} ${fmt(segment.x)} ${fmt(segment.y)} c`);
        px = segment.x;
        py = segment.y;
        break;
      default:
        out.push('h');
        px = startX;
        py = startY;
    }
  }
  return out.join('\n');
}

/* ------------------------------------------------------------------ */
/* Images                                                              */
/* ------------------------------------------------------------------ */

interface PdfImage {
  width: number;
  height: number;
  /** The image dictionary's entries after `/Type /XObject /Subtype /Image`. */
  dictionary: string;
  data: Uint8Array;
  /** Alpha channel as a separate grey image, when the source had transparency. */
  mask?: { data: Uint8Array };
}

function decodeDataUrl(href: string): { mime: string; data: Uint8Array } | null {
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(href);
  if (!match) return null;
  return { mime: match[1] as string, data: new Uint8Array(Buffer.from(match[2] as string, 'base64')) };
}

/** Read the frame header of a JPEG: the PDF image dictionary has to state its true dimensions. */
function readJpegFrame(data: Uint8Array): { width: number; height: number; components: number } | null {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) return null;
    const marker = data[offset + 1] as number;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }
    const length = ((data[offset + 2] as number) << 8) | (data[offset + 3] as number);
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      const height = ((data[offset + 5] as number) << 8) | (data[offset + 6] as number);
      const width = ((data[offset + 7] as number) << 8) | (data[offset + 8] as number);
      return { width, height, components: data[offset + 9] as number };
    }
    offset += 2 + length;
  }
  return null;
}

function buildImage(href: string, compress: boolean): PdfImage | string {
  const decoded = decodeDataUrl(href);
  if (!decoded) return 'it is not a PNG or JPEG data URL';
  if (decoded.mime === 'image/jpeg') {
    const frame = readJpegFrame(decoded.data);
    if (!frame || frame.width <= 0 || frame.height <= 0) return 'the JPEG header could not be read';
    if (frame.components !== 1 && frame.components !== 3) return 'only greyscale and RGB JPEGs can be embedded';
    return {
      width: frame.width,
      height: frame.height,
      dictionary: `/Width ${frame.width} /Height ${frame.height} /ColorSpace ${frame.components === 1 ? '/DeviceGray' : '/DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode`,
      data: decoded.data,
    };
  }
  let png: PNG;
  try {
    png = PNG.sync.read(Buffer.from(decoded.data));
  } catch {
    return 'the PNG could not be decoded';
  }
  const pixels = png.width * png.height;
  const rgb = new Uint8Array(pixels * 3);
  const alpha = new Uint8Array(pixels);
  let translucent = false;
  for (let index = 0; index < pixels; index += 1) {
    rgb[index * 3] = png.data[index * 4] as number;
    rgb[index * 3 + 1] = png.data[index * 4 + 1] as number;
    rgb[index * 3 + 2] = png.data[index * 4 + 2] as number;
    const a = png.data[index * 4 + 3] as number;
    alpha[index] = a;
    if (a !== 255) translucent = true;
  }
  const filter = compress ? ' /Filter /FlateDecode' : '';
  return {
    width: png.width,
    height: png.height,
    dictionary: `/Width ${png.width} /Height ${png.height} /ColorSpace /DeviceRGB /BitsPerComponent 8${filter}`,
    data: compress ? new Uint8Array(deflateSync(Buffer.from(rgb))) : rgb,
    ...(translucent ? { mask: { data: compress ? new Uint8Array(deflateSync(Buffer.from(alpha))) : alpha } } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Content streams                                                     */
/* ------------------------------------------------------------------ */

interface ResourceRegistry {
  fonts: Map<StudioFont, string>;
  images: Map<string, { name: string; image: PdfImage }>;
  states: Map<string, string>;
  skippedImages: string[];
  compress: boolean;
}

function fontName(registry: ResourceRegistry, font: StudioFont): string {
  let name = registry.fonts.get(font);
  if (!name) {
    name = `F${registry.fonts.size + 1}`;
    registry.fonts.set(font, name);
  }
  return name;
}

function stateName(registry: ResourceRegistry, opacity: number): string {
  const key = fmt(Math.max(0, Math.min(1, opacity)));
  let name = registry.states.get(key);
  if (!name) {
    name = `GS${registry.states.size + 1}`;
    registry.states.set(key, name);
  }
  return name;
}

function imageEntry(registry: ResourceRegistry, href: string): { name: string; image: PdfImage } | null {
  const existing = registry.images.get(href);
  if (existing) return existing;
  const built = buildImage(href, registry.compress);
  if (typeof built === 'string') {
    registry.skippedImages.push(`An image was left out of the PDF because ${built}.`);
    return null;
  }
  const entry = { name: `Im${registry.images.size + 1}`, image: built };
  registry.images.set(href, entry);
  return entry;
}

function opToOperators(op: StudioOp, registry: ResourceRegistry): string {
  const body = drawOp(op, registry);
  if (body === '') return '';
  if (typeof op.opacity === 'number' && op.opacity < 1) return `q\n/${stateName(registry, op.opacity)} gs\n${body}\nQ`;
  return body;
}

function drawOp(op: StudioOp, registry: ResourceRegistry): string {
  switch (op.kind) {
    case 'rect': {
      const fill = fillColor(op.fill);
      const stroke = strokeColor(op.stroke);
      if (!fill && !stroke) return '';
      const lines: string[] = [];
      if (fill) lines.push(fill);
      if (stroke) lines.push(stroke, `${fmt(op.strokeWidth ?? 0.25)} w`);
      lines.push(rectPath(op.x, op.y, op.w, op.h, op.radius ?? 0), fill && stroke ? 'B' : fill ? 'f' : 'S');
      return lines.join('\n');
    }
    case 'circle': {
      const fill = fillColor(op.fill);
      const stroke = strokeColor(op.stroke);
      if (!fill && !stroke) return '';
      const lines: string[] = [];
      if (fill) lines.push(fill);
      if (stroke) lines.push(stroke, `${fmt(op.strokeWidth ?? 0.25)} w`);
      lines.push(circlePath(op.cx, op.cy, op.r), fill && stroke ? 'B' : fill ? 'f' : 'S');
      return lines.join('\n');
    }
    case 'polygon': {
      const fill = fillColor(op.fill ?? '#000000');
      if (!fill || op.points.length < 3) return '';
      const [first, ...rest] = op.points;
      if (!first) return '';
      return [fill, `${fmt(first.x)} ${fmt(first.y)} m`, ...rest.map((point) => `${fmt(point.x)} ${fmt(point.y)} l`), 'h', 'f'].join('\n');
    }
    case 'line': {
      const stroke = strokeColor(op.color);
      if (!stroke) return '';
      const dash = op.dash && op.dash.length > 0 ? `[${op.dash.map((value) => fmt(value)).join(' ')}] 0 d` : '[] 0 d';
      return [stroke, `${fmt(op.width)} w`, dash, `${fmt(op.x1)} ${fmt(op.y1)} m`, `${fmt(op.x2)} ${fmt(op.y2)} l`, 'S', '[] 0 d'].join('\n');
    }
    case 'path': {
      const fill = fillColor(op.fill);
      if (!fill || op.segments.length === 0) return '';
      return [fill, segmentsToOperators(op.segments), op.fillRule === 'evenodd' ? 'f*' : 'f'].join('\n');
    }
    case 'text': {
      const run = resolveTextRun(op);
      const fill = fillColor(op.color);
      if (!run || !fill) return '';
      const spacing = op.letterSpacing ?? 0;
      // The page is drawn with y pointing down, which would mirror glyphs. The text matrix flips y
      // back for this run only, so the baseline sits where the layout put it and text reads upright.
      return [
        fill,
        'BT',
        `/${fontName(registry, run.font)} ${fmt(run.size)} Tf`,
        ...(spacing !== 0 ? [`${fmt(spacing)} Tc`] : []),
        `1 0 0 -1 ${fmt(run.startX)} ${fmt(op.y)} Tm`,
        `${literalFromCodes(run.codes)} Tj`,
        ...(spacing !== 0 ? ['0 Tc'] : []),
        'ET',
      ].join('\n');
    }
    case 'image': {
      const lines: string[] = [];
      const radius = op.radius ?? 0;
      const entry = op.href ? imageEntry(registry, op.href) : null;
      if (entry) {
        const scale =
          op.fit === 'cover'
            ? Math.max(op.w / entry.image.width, op.h / entry.image.height)
            : Math.min(op.w / entry.image.width, op.h / entry.image.height);
        const drawW = entry.image.width * scale;
        const drawH = entry.image.height * scale;
        const drawX = op.x + (op.w - drawW) / 2;
        const drawY = op.y + (op.h - drawH) / 2;
        lines.push('q', rectPath(op.x, op.y, op.w, op.h, radius), 'W n');
        // An image occupies the unit square with y up; the negative height turns it upright here.
        lines.push(`${fmt(drawW)} 0 0 ${fmt(-drawH)} ${fmt(drawX)} ${fmt(drawY + drawH)} cm`, `/${entry.name} Do`, 'Q');
      } else if (op.placeholder) {
        const fill = fillColor(op.placeholder.fill);
        if (fill) lines.push(fill, rectPath(op.x, op.y, op.w, op.h, radius), 'f');
        const size = Math.min(op.w, op.h) * 0.34;
        const label = drawOp(
          { kind: 'text', x: op.x + op.w / 2, y: op.y + op.h / 2 + size * 0.36, text: op.placeholder.label, size, color: op.placeholder.color, weight: '700', anchor: 'middle' },
          registry
        );
        if (label) lines.push(label);
      }
      const stroke = strokeColor(op.stroke);
      if (stroke) lines.push(stroke, `${fmt(op.strokeWidth ?? 0.25)} w`, rectPath(op.x, op.y, op.w, op.h, radius), 'S');
      return lines.join('\n');
    }
    default:
      return '';
  }
}

function surfaceContent(surface: StudioSurface, registry: ResourceRegistry): string {
  const parts: string[] = [];
  const background = fillColor(surface.background);
  if (background) parts.push(background, `0 0 ${fmt(surface.width)} ${fmt(surface.height)} re`, 'f');
  for (const op of surface.ops) {
    const operators = opToOperators(op, registry);
    if (operators !== '') parts.push(operators);
  }
  return `${parts.join('\n')}\n`;
}

/* ------------------------------------------------------------------ */
/* Document assembly                                                   */
/* ------------------------------------------------------------------ */

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  return out;
}

function streamObject(dictionary: string, data: Uint8Array): Uint8Array {
  return concat([latin1(`<< ${dictionary} /Length ${data.length} >>\nstream\n`), data, latin1('\nendstream')]);
}

function contentStream(extra: string, content: string, compress: boolean): Uint8Array {
  const raw = latin1(content);
  if (!compress) return streamObject(extra.trim(), raw);
  return streamObject(`${extra} /Filter /FlateDecode`.trim(), new Uint8Array(deflateSync(Buffer.from(raw))));
}

/**
 * Build the document. One PDF page per entry in `pages`, in order.
 *
 * Throws only for a request that cannot produce a document at all (no pages, or a page with no
 * area). An image that cannot be embedded is skipped and reported in `skippedImages`, because a
 * label without its logo is still a usable label and a failed download is not.
 */
export function buildVectorPdf(pages: PdfPageSpec[], info: PdfInfo, options: PdfBuildOptions = {}): PdfBuildResult {
  if (pages.length === 0) throw new Error('A PDF needs at least one page.');
  for (const [index, page] of pages.entries()) {
    if (!(page.width > 0) || !(page.height > 0)) throw new Error(`Page ${index + 1} has no area.`);
  }
  const compress = options.compress !== false;
  const registry: ResourceRegistry = { fonts: new Map(), images: new Map(), states: new Map(), skippedImages: [], compress };

  // Content is generated first: it is what discovers the fonts, images and graphics states the
  // resource dictionary has to list.
  const surfaces: StudioSurface[] = [];
  const surfaceIndex = new Map<StudioSurface, number>();
  for (const page of pages) {
    for (const placement of page.placements) {
      if (!surfaceIndex.has(placement.surface)) {
        surfaceIndex.set(placement.surface, surfaces.length);
        surfaces.push(placement.surface);
      }
    }
  }
  const formContents = surfaces.map((surface) => surfaceContent(surface, registry));
  const pageContents = pages.map((page) => {
    const heightPt = page.height * MM_TO_PT;
    // Millimetres, origin top-left, y down: the coordinate system every surface is laid out in.
    // The scale is written to six decimals: at three, 210 mm of page would drift by 0.03 mm.
    const parts = ['q', `${MM_TO_PT.toFixed(6)} 0 0 ${(-MM_TO_PT).toFixed(6)} 0 ${fmt(heightPt)} cm`];
    for (const placement of page.placements) {
      parts.push('q', `1 0 0 1 ${fmt(placement.x)} ${fmt(placement.y)} cm`, `/Fm${(surfaceIndex.get(placement.surface) ?? 0) + 1} Do`, 'Q');
    }
    for (const op of page.overlay ?? []) {
      const operators = opToOperators(op, registry);
      if (operators !== '') parts.push(operators);
    }
    parts.push('Q');
    return `${parts.join('\n')}\n`;
  });

  // Object numbering: 1 catalog, 2 page tree, 3 resources, then fonts, graphics states, images
  // (each with its optional mask), forms, and finally a page + content pair per page.
  let nextId = 4;
  const fontIds = new Map<StudioFont, number>();
  for (const font of registry.fonts.keys()) fontIds.set(font, nextId++);
  const stateIds = new Map<string, number>();
  for (const key of registry.states.keys()) stateIds.set(key, nextId++);
  const imageIds = new Map<string, { id: number; maskId?: number }>();
  for (const [href, entry] of registry.images) {
    const id = nextId++;
    const maskId = entry.image.mask ? nextId++ : undefined;
    imageIds.set(href, maskId === undefined ? { id } : { id, maskId });
  }
  const formIds = surfaces.map(() => nextId++);
  const pageIds = pages.map(() => {
    const id = nextId;
    nextId += 2;
    return id;
  });
  const infoId = nextId++;

  const bodies = new Map<number, Uint8Array>();
  const viewer = '/ViewerPreferences << /PrintScaling /None >>';
  bodies.set(1, latin1(`<< /Type /Catalog /Pages 2 0 R ${viewer} >>`));
  bodies.set(2, latin1(`<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`));

  const fontEntries = [...registry.fonts].map(([font, name]) => `/${name} ${fontIds.get(font)} 0 R`).join(' ');
  const stateEntries = [...registry.states].map(([key, name]) => `/${name} ${stateIds.get(key)} 0 R`).join(' ');
  const xobjectEntries = [
    ...[...registry.images].map(([href, entry]) => `/${entry.name} ${imageIds.get(href)?.id} 0 R`),
    ...formIds.map((id, index) => `/Fm${index + 1} ${id} 0 R`),
  ].join(' ');
  bodies.set(
    3,
    latin1(
      `<< /ProcSet [/PDF /Text /ImageB /ImageC]` +
        (fontEntries ? ` /Font << ${fontEntries} >>` : '') +
        (stateEntries ? ` /ExtGState << ${stateEntries} >>` : '') +
        (xobjectEntries ? ` /XObject << ${xobjectEntries} >>` : '') +
        ' >>'
    )
  );

  for (const [font, id] of fontIds) {
    bodies.set(id, latin1(`<< /Type /Font /Subtype /Type1 /BaseFont /${FONT_BASE[font]} /Encoding /WinAnsiEncoding >>`));
  }
  for (const [key, id] of stateIds) bodies.set(id, latin1(`<< /Type /ExtGState /ca ${key} /CA ${key} >>`));
  for (const [href, entry] of registry.images) {
    const ids = imageIds.get(href);
    if (!ids) continue;
    const mask = ids.maskId !== undefined ? ` /SMask ${ids.maskId} 0 R` : '';
    bodies.set(ids.id, streamObject(`/Type /XObject /Subtype /Image ${entry.image.dictionary}${mask}`, entry.image.data));
    if (ids.maskId !== undefined && entry.image.mask) {
      const filter = compress ? ' /Filter /FlateDecode' : '';
      bodies.set(
        ids.maskId,
        streamObject(`/Type /XObject /Subtype /Image /Width ${entry.image.width} /Height ${entry.image.height} /ColorSpace /DeviceGray /BitsPerComponent 8${filter}`, entry.image.mask.data)
      );
    }
  }
  surfaces.forEach((surface, index) => {
    bodies.set(
      formIds[index] as number,
      contentStream(`/Type /XObject /Subtype /Form /FormType 1 /BBox [0 0 ${fmt(surface.width)} ${fmt(surface.height)}] /Resources 3 0 R`, formContents[index] as string, compress)
    );
  });
  pages.forEach((page, index) => {
    const id = pageIds[index] as number;
    bodies.set(
      id,
      latin1(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(page.width * MM_TO_PT)} ${fmt(page.height * MM_TO_PT)}] /Resources 3 0 R /Contents ${id + 1} 0 R >>`)
    );
    bodies.set(id + 1, contentStream('', pageContents[index] as string, compress));
  });
  bodies.set(
    infoId,
    latin1(
      `<< /Title ${infoString(info.title)}` +
        (info.subject ? ` /Subject ${infoString(info.subject)}` : '') +
        (info.author ? ` /Author ${infoString(info.author)}` : '') +
        (info.keywords ? ` /Keywords ${infoString(info.keywords)}` : '') +
        ` /Creator ${infoString(info.creator ?? PDF_PRODUCER)} /Producer ${infoString(PDF_PRODUCER)} >>`
    )
  );

  // Serialise in object-number order, recording each object's byte offset as it is written.
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (chunk: Uint8Array): void => {
    chunks.push(chunk);
    length += chunk.length;
  };
  push(latin1('%PDF-1.6\n'));
  // Four bytes above 0x7F mark the file as binary for tools that sniff the first lines.
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  const total = infoId + 1;
  for (let id = 1; id < total; id += 1) {
    const body = bodies.get(id);
    if (!body) throw new Error(`PDF object ${id} was never written.`);
    offsets.push(length);
    push(latin1(`${id} 0 obj\n`));
    push(body);
    push(latin1('\nendobj\n'));
  }
  const xrefOffset = length;
  let xref = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (const offset of offsets) xref += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  push(latin1(xref));
  push(latin1(`trailer\n<< /Size ${total} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`));

  return { bytes: concat(chunks), pageCount: pages.length, skippedImages: registry.skippedImages };
}

/** A one-page document that is exactly the size of its surface. */
export function surfaceToPdf(surface: StudioSurface, info: PdfInfo, options: PdfBuildOptions = {}): PdfBuildResult {
  return buildVectorPdf([{ width: surface.width, height: surface.height, placements: [{ surface, x: 0, y: 0 }] }], info, options);
}
