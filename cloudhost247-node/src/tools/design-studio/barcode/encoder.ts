/**
 * Barcode encoder: BWIPP (via bwip-js) in, studio draw operations out.
 *
 * bwip-js can hand back a finished SVG or PNG, but the studio needs more than an image: a label
 * places a symbol at an exact physical module width inside a box, and the same symbol has to appear
 * in the SVG preview and in the vector PDF. So this module drives bwip-js through its drawing
 * interface instead, records the bars, modules and glyph outlines it asks for, and converts them to
 * millimetres. Everything downstream is ordinary vector geometry.
 *
 * Geometry is taken from the encoder exactly. bwip-js issues bars as stroked lines on an integer
 * pixel grid; the rectangle each line covers is computed with the same rule its own bitmap renderer
 * uses, so a bar here is the bar the reference renderer would have drawn, to the pixel. Capturing at
 * an even scale keeps every bar edge on the grid, which is why no rounding appears in this file.
 *
 * Server-side only. bwip-js ships megabytes of encoder and font data that must not reach the browser
 * bundle; the browser sends data and receives SVG, PNG or PDF.
 *
 * bwip-js publishes one build per platform and nothing platform-neutral, so the frontend's type
 * check (which sees this file only because a frontend test imports the server's handler table) is
 * pointed at the Node typings by the "paths" entry in frontend/tsconfig.json. That entry affects
 * type checking only; it does not put this module, or bwip-js, in any browser bundle.
 */

import bwipjs from 'bwip-js';
import type { PathSegment, StudioOp } from '../render/draw-ops';
import { normaliseData, type Symbology, type SymbologyOption } from './symbologies';

/** A request the encoder cannot satisfy. The message is safe to show: it never echoes the data. */
export class BarcodeError extends Error {
  constructor(
    message: string,
    public readonly reason: 'data' | 'option' | 'size' = 'data'
  ) {
    super(message);
    this.name = 'BarcodeError';
  }
}

export interface EncodeRequest {
  symbology: Symbology;
  data: string;
  /** User-selected options, validated against `symbology.options`. Unknown keys are ignored. */
  options?: Record<string, unknown>;
  /** Width of the narrowest element in millimetres. Ignored for fixed-size symbologies. */
  moduleMm?: number;
  /** Bar height in millimetres, for symbologies that allow it. */
  barHeightMm?: number;
  /** Print the human-readable line, where the symbology has one. */
  showText?: boolean;
  /** Height of the human-readable text in millimetres. Defaults to the encoder's own proportion. */
  textSizeMm?: number;
  /** Bar colour, `#rrggbb`. */
  color?: string;
  /** Human-readable text colour, `#rrggbb`. Defaults to the bar colour. */
  textColor?: string;
  /**
   * Encode `data` byte for byte, without the tidying applied to typed input. For payloads a tool
   * builds itself, where the exact characters are the format: a vCard's lines end in CRLF, and
   * folding them to LF, as is right for text typed into a form, would make it a different file.
   */
  verbatim?: boolean;
}

export interface EncodedSymbol {
  /** The symbol at the origin, in millimetres, without a quiet zone. */
  ops: StudioOp[];
  width: number;
  height: number;
  /** Effective width of one module in millimetres (of one encoder unit, for fixed-size codes). */
  moduleMm: number;
  /** Quiet zone to leave clear on every side, in millimetres. */
  quietMm: number;
  /** The data exactly as it was handed to the encoder. */
  data: string;
  /** True when the symbology draws a human-readable line and one was requested. */
  hasText: boolean;
}

/** bwip-js is driven at this scale. Even, so bars stay on the pixel grid; large enough for fine heights. */
const CAPTURE_SCALE = 4;
const DEFAULT_COLOR = '#000000';
const HEX = /^#[0-9a-fA-F]{6}$/;

/** Quiet zone in modules, per encoder. Values follow each symbology's specification minimum or more. */
const QUIET_MODULES: Record<string, number> = {
  qrcode: 4, gs1qrcode: 4, gs1dlqrcode: 4, microqrcode: 2, datamatrix: 2, datamatrixrectangular: 2,
  gs1datamatrix: 2, hibcdatamatrix: 2, azteccode: 1, pdf417: 2, micropdf417: 2, hanxin: 3, dotcode: 3,
  databarstacked: 1, databarstackedomni: 1, codablockf: 10, ean13: 11, ean8: 7, upca: 9, upce: 9, isbn: 11, issn: 11, ismn: 11,
  gs1dldatamatrix: 2, hibcqrcode: 4, hibcazteccode: 1, hibcpdf417: 2, hibcmicropdf417: 2, hibccodablockf: 10,
  // Royal Mail asks for 2 mm of clear space around a Mailmark; that is four modules at the smallest module.
  mailmark: 4,
};

/**
 * EAN and UPC symbols print digits and guard marks *in* their quiet zones, so when the
 * human-readable line is on, the drawn symbol already spans the light margins it needs.
 */
const QUIET_ZONE_CARRIED_BY_TEXT = new Set(['ean13', 'ean8', 'upca', 'upce', 'isbn', 'issn', 'ismn']);

export function quietModules(symbology: Symbology, hasText = false): number {
  if (hasText && QUIET_ZONE_CARRIED_BY_TEXT.has(symbology.bcid)) return 1;
  const specific = QUIET_MODULES[symbology.bcid];
  if (specific !== undefined) return specific;
  return symbology.group === 'matrix' ? 2 : 10;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hexWithoutHash(color: string | undefined, fallback: string): string {
  const value = color && HEX.test(color) ? color : fallback;
  return value.slice(1).toLowerCase();
}

/** Turn a BWIPP exception into a sentence. BWIPP messages name the rule that failed, not the data. */
export function describeEncoderError(error: unknown, symbology: Symbology): string {
  const raw = error instanceof Error ? error.message : String(error);
  const match = /^bwipp\.[A-Za-z0-9_]+(?:#\d+)?:\s*(.+)$/s.exec(raw);
  const detail = (match ? (match[1] as string) : raw).replace(/\s+/g, ' ').trim();
  if (detail === '' || /unknown encoder/i.test(detail)) return `${symbology.name} could not be encoded in this build.`;
  return `${symbology.name}: ${detail.replace(/\.$/, '')}.`;
}

function validateOption(option: SymbologyOption, raw: unknown): string | number | boolean {
  if (raw === undefined || raw === null || raw === '') return option.default;
  if (option.type === 'boolean') {
    if (typeof raw === 'boolean') return raw;
    if (raw === 'true' || raw === '1' || raw === 'on') return true;
    if (raw === 'false' || raw === '0' || raw === 'off') return false;
    throw new BarcodeError(`“${option.label}” must be on or off.`, 'option');
  }
  if (option.type === 'integer') {
    const value = typeof raw === 'number' ? raw : Number(String(raw));
    if (!Number.isInteger(value)) throw new BarcodeError(`“${option.label}” must be a whole number.`, 'option');
    if ((option.min !== undefined && value < option.min) || (option.max !== undefined && value > option.max)) {
      throw new BarcodeError(`“${option.label}” must be between ${option.min} and ${option.max}.`, 'option');
    }
    return value;
  }
  const text = String(raw);
  const choice = option.choices?.find((entry) => entry.value.toLowerCase() === text.toLowerCase());
  if (!choice) throw new BarcodeError(`“${option.label}” must be one of: ${option.choices?.map((entry) => entry.value).join(', ')}.`, 'option');
  return choice.value;
}

export interface ResolvedEncoding {
  data: string;
  /** Options for bwip-js, excluding scale, padding, rotation and background. */
  params: Record<string, string | number | boolean>;
  /** Millimetres per encoder unit at scale 1. */
  mmPerUnit: number;
  moduleMm: number;
  hasText: boolean;
}

/**
 * Validate a request and translate it into encoder parameters.
 *
 * Shared by the vector path and the PNG path, so a symbol downloaded as PNG is encoded with exactly
 * the options its SVG and PDF were.
 */
export function resolveEncoding(request: EncodeRequest): ResolvedEncoding {
  const { symbology } = request;
  const data = request.verbatim ? (request.data ?? '') : normaliseData(symbology, request.data ?? '');
  if (data === '') throw new BarcodeError('Enter the data to encode.');
  if (data.length > symbology.maxLength) {
    throw new BarcodeError(`${symbology.name} input is limited to ${symbology.maxLength} characters here.`);
  }
  if (symbology.pattern && !new RegExp(symbology.pattern).test(data)) {
    throw new BarcodeError(`That is not valid ${symbology.name} data. Expected: ${symbology.hint}`);
  }

  let mmPerUnit: number;
  let moduleMm: number;
  if (symbology.sizing.mode === 'fixed') {
    mmPerUnit = symbology.sizing.mmPerUnit;
    moduleMm = mmPerUnit;
  } else {
    const sizing = symbology.sizing;
    const requested = request.moduleMm ?? sizing.defaultModuleMm;
    if (!Number.isFinite(requested) || requested <= 0) throw new BarcodeError('The module width must be a positive number of millimetres.', 'size');
    moduleMm = clamp(requested, sizing.minModuleMm, sizing.maxModuleMm);
    mmPerUnit = moduleMm / sizing.unitsPerModule;
  }

  const params: Record<string, string | number | boolean> = { ...(symbology.fixed ?? {}) };
  for (const option of symbology.options ?? []) {
    const value = validateOption(option, request.options?.[option.key]);
    // A false boolean is the encoder's default; sending it would only add noise.
    if (option.type === 'boolean' && value === false) continue;
    params[option.key] = value;
  }

  if (symbology.barHeight) {
    const height = clamp(request.barHeightMm ?? symbology.barHeight.defaultMm, symbology.barHeight.minMm, symbology.barHeight.maxMm);
    // bwip-js takes the bar height in millimetres at its own 72-units-per-inch scale.
    params.height = ((height / mmPerUnit) * 25.4) / 72;
  }

  const hasText = symbology.text && request.showText !== false;
  if (hasText) {
    params.includetext = true;
    if (request.textSizeMm !== undefined) {
      params.textsize = clamp(request.textSizeMm / mmPerUnit, 4, 40);
    }
  }
  params.barcolor = hexWithoutHash(request.color, DEFAULT_COLOR);
  params.textcolor = hexWithoutHash(request.textColor ?? request.color, DEFAULT_COLOR);

  return { data, params, mmPerUnit, moduleMm, hasText };
}

/* ------------------------------------------------------------------ */
/* Capture                                                             */
/* ------------------------------------------------------------------ */

interface Captured {
  width: number;
  height: number;
  ops: StudioOp[];
}

function ellipseSegments(x: number, y: number, rx: number, ry: number): PathSegment[] {
  const k = 0.5522847498;
  const dx = rx * k;
  const dy = ry * k;
  return [
    { type: 'M', x: x - rx, y },
    { type: 'C', c1x: x - rx, c1y: y - dy, c2x: x - dx, c2y: y - ry, x, y: y - ry },
    { type: 'C', c1x: x + dx, c1y: y - ry, c2x: x + rx, c2y: y - dy, x: x + rx, y },
    { type: 'C', c1x: x + rx, c1y: y + dy, c2x: x + dx, c2y: y + ry, x, y: y + ry },
    { type: 'C', c1x: x - dx, c1y: y + ry, c2x: x - rx, c2y: y + dy, x: x - rx, y },
    { type: 'Z' },
  ];
}

/**
 * Run the encoder and record what it draws, in encoder pixels.
 *
 * The callbacks mirror bwip-js's own SVG drawing, with one deliberate difference: bars are emitted
 * as filled rectangles rather than stroked lines, because a filled rectangle has unambiguous edges
 * in every output format.
 */
function capture(bcid: string, text: string, params: Record<string, string | number | boolean>): Captured {
  const fontLib = bwipjs.FontLib;
  const ops: StudioOp[] = [];
  let pending: PathSegment[] = [];
  let width = 0;
  let height = 0;
  let scaleX = CAPTURE_SCALE;

  const drawing = {
    setopts(): void {
      // Padding, rotation and background are applied by the studio, not by the encoder.
    },
    scale(sx: number): null {
      scaleX = sx;
      return null;
    },
    measure(str: string, font: string, fwidth: number, fheight: number): { width: number; ascent: number; descent: number } {
      const fw = fwidth | 0;
      const fh = fheight | 0;
      const fontId = fontLib.lookup(font);
      let measured = 0;
      let ascent = 0;
      let descent = 0;
      for (let index = 0; index < str.length; index += 1) {
        const glyph = fontLib.getglyph(fontId, str.charCodeAt(index), fw, fh);
        if (!glyph) continue;
        ascent = Math.max(ascent, glyph.top);
        descent = Math.max(descent, glyph.height - glyph.top);
        measured += index === str.length - 1 ? glyph.left + glyph.width : glyph.advance;
      }
      return { width: measured, ascent, descent };
    },
    init(w: number, h: number): void {
      width = w;
      height = h;
    },
    line(x0: number, y0: number, x1: number, y1: number, lw: number, rgb: string): void {
      let ax = x0 | 0;
      let ay = y0 | 0;
      let bx = x1 | 0;
      let by = y1 | 0;
      const lineWidth = Math.round(lw) || 1;
      if (by < ay) [ay, by] = [by, ay];
      if (bx < ax) [ax, bx] = [bx, ax];
      const half = (lineWidth / 2) | 0;
      // The same pixel coverage bwip-js's bitmap renderer gives a line: inclusive end points, and
      // for an odd width the larger half on the left (vertical) or the bottom (horizontal).
      if (ax === bx) {
        ops.push({ kind: 'rect', x: ax - lineWidth + half, y: ay, w: lineWidth, h: by - ay + 1, fill: `#${rgb}` });
      } else {
        ops.push({ kind: 'rect', x: ax, y: ay - half, w: bx - ax + 1, h: lineWidth, fill: `#${rgb}` });
      }
      void scaleX;
    },
    polygon(points: Array<[number, number]>): void {
      points.forEach((point, index) => {
        pending.push({ type: index === 0 ? 'M' : 'L', x: point[0], y: point[1] });
      });
      pending.push({ type: 'Z' });
    },
    hexagon(points: Array<[number, number]>): void {
      this.polygon(points);
    },
    ellipse(x: number, y: number, rx: number, ry: number): void {
      pending.push(...ellipseSegments(x, y, rx, ry));
    },
    fill(rgb: string): void {
      if (pending.length === 0) return;
      // Module regions never overlap, and rings are an outer and an inner outline: even-odd is the
      // rule bwip-js itself uses for them.
      ops.push({ kind: 'path', segments: pending, fill: `#${rgb}`, fillRule: 'evenodd' });
      pending = [];
    },
    clip(): void {
      // Only the Swiss QR cross uses clipping, and that symbology is not offered.
    },
    unclip(): void {},
    text(x: number, y: number, str: string, rgb: string, font: { name: string; width: number; height: number; dx: number; rotate?: number }): void {
      const originX = x | 0;
      const originY = y | 0;
      const fontId = fontLib.lookup(font.name);
      const fw = font.width | 0;
      const fh = font.height | 0;
      const dx = font.dx | 0;
      const segments: PathSegment[] = [];
      let cursor = originX;
      for (let index = 0; index < str.length; index += 1) {
        const code = str.charCodeAt(index);
        const glyph = fontLib.getpaths(fontId, code, fw, fh);
        if (!glyph) continue;
        if (glyph.length > 0) {
          for (const segment of glyph) {
            if (segment.type === 'M' || segment.type === 'L') {
              segments.push({ type: segment.type, x: segment.x + cursor, y: originY - segment.y });
            } else if (segment.type === 'Q') {
              segments.push({ type: 'Q', cx: segment.cx + cursor, cy: originY - segment.cy, x: segment.x + cursor, y: originY - segment.y });
            } else {
              segments.push({
                type: 'C',
                c1x: segment.cx1 + cursor, c1y: originY - segment.cy1,
                c2x: segment.cx2 + cursor, c2y: originY - segment.cy2,
                x: segment.x + cursor, y: originY - segment.y,
              });
            }
          }
          segments.push({ type: 'Z' });
        }
        // bwip-js advances by the bitmap metric even when drawing outlines; matching it keeps the
        // text exactly where the encoder centred it.
        cursor += fontLib.getglyph(fontId, code, fw, fh).advance + dx;
      }
      if (segments.length === 0) return;
      const turns = ((font.rotate ?? 0) / 90) | 0;
      ops.push({ kind: 'path', segments: turns === 0 ? segments : rotateSegments(segments, originX, originY, turns), fill: `#${rgb}`, fillRule: 'nonzero' });
    },
    end(): Captured {
      return { width, height, ops };
    },
  };

  return bwipjs.render({ bcid, text, scale: CAPTURE_SCALE, ...params } as never, drawing as never) as unknown as Captured;
}

/** Rotate outline points anticlockwise about a pivot by a number of quarter turns. */
function rotateSegments(segments: PathSegment[], px: number, py: number, turns: number): PathSegment[] {
  const steps = ((turns % 4) + 4) % 4;
  const turn = (x: number, y: number): [number, number] => {
    let dx = x - px;
    let dy = y - py;
    for (let step = 0; step < steps; step += 1) [dx, dy] = [dy, -dx];
    return [px + dx, py + dy];
  };
  return segments.map((segment) => {
    if (segment.type === 'Z') return segment;
    const [x, y] = turn(segment.x, segment.y);
    if (segment.type === 'M' || segment.type === 'L') return { type: segment.type, x, y };
    if (segment.type === 'Q') {
      const [cx, cy] = turn(segment.cx, segment.cy);
      return { type: 'Q', cx, cy, x, y };
    }
    const [c1x, c1y] = turn(segment.c1x, segment.c1y);
    const [c2x, c2y] = turn(segment.c2x, segment.c2y);
    return { type: 'C', c1x, c1y, c2x, c2y, x, y };
  });
}

function scaleSegments(segments: PathSegment[], factor: number): PathSegment[] {
  return segments.map((segment) => {
    if (segment.type === 'Z') return segment;
    if (segment.type === 'M' || segment.type === 'L') return { type: segment.type, x: segment.x * factor, y: segment.y * factor };
    if (segment.type === 'Q') return { type: 'Q', cx: segment.cx * factor, cy: segment.cy * factor, x: segment.x * factor, y: segment.y * factor };
    return {
      type: 'C',
      c1x: segment.c1x * factor, c1y: segment.c1y * factor,
      c2x: segment.c2x * factor, c2y: segment.c2y * factor,
      x: segment.x * factor, y: segment.y * factor,
    };
  });
}

/** Encode a symbol and return it as millimetre geometry at the origin. */
export function encodeSymbol(request: EncodeRequest): EncodedSymbol {
  const resolved = resolveEncoding(request);
  let captured: Captured;
  try {
    captured = capture(request.symbology.bcid, resolved.data, resolved.params);
  } catch (error) {
    throw new BarcodeError(describeEncoderError(error, request.symbology));
  }
  if (!(captured.width > 0) || !(captured.height > 0) || captured.ops.length === 0) {
    throw new BarcodeError(`${request.symbology.name} produced an empty symbol for that data.`);
  }

  const factor = resolved.mmPerUnit / CAPTURE_SCALE;
  const ops: StudioOp[] = captured.ops.map((op) => {
    if (op.kind === 'rect') return { ...op, x: op.x * factor, y: op.y * factor, w: op.w * factor, h: op.h * factor };
    if (op.kind === 'path') return { ...op, segments: scaleSegments(op.segments, factor) };
    return op;
  });

  const quietMm =
    request.symbology.sizing.mode === 'fixed'
      ? Math.max(2, quietModules(request.symbology) * 0.25)
      : quietModules(request.symbology, resolved.hasText) * resolved.moduleMm;

  return {
    ops,
    width: captured.width * factor,
    height: captured.height * factor,
    moduleMm: resolved.moduleMm,
    quietMm,
    data: resolved.data,
    hasText: resolved.hasText,
  };
}

/** Move a symbol's operations to a position on a surface. */
export function translateOps(ops: readonly StudioOp[], dx: number, dy: number): StudioOp[] {
  return ops.map((op) => {
    if (op.kind === 'rect') return { ...op, x: op.x + dx, y: op.y + dy };
    if (op.kind === 'path') {
      return {
        ...op,
        segments: op.segments.map((segment) => {
          if (segment.type === 'Z') return segment;
          if (segment.type === 'M' || segment.type === 'L') return { type: segment.type, x: segment.x + dx, y: segment.y + dy };
          if (segment.type === 'Q') return { type: 'Q', cx: segment.cx + dx, cy: segment.cy + dy, x: segment.x + dx, y: segment.y + dy };
          return {
            type: 'C',
            c1x: segment.c1x + dx, c1y: segment.c1y + dy,
            c2x: segment.c2x + dx, c2y: segment.c2y + dy,
            x: segment.x + dx, y: segment.y + dy,
          };
        }),
      };
    }
    return op;
  });
}

/**
 * Rotate a symbol clockwise by quarter turns inside its own bounding box.
 * Returns the rotated operations and the box's new width and height.
 */
export function rotateSymbol(ops: readonly StudioOp[], width: number, height: number, quarterTurns: number): { ops: StudioOp[]; width: number; height: number } {
  const turns = ((quarterTurns % 4) + 4) % 4;
  if (turns === 0) return { ops: [...ops], width, height };
  const map = (x: number, y: number): [number, number] => {
    if (turns === 1) return [height - y, x];
    if (turns === 2) return [width - x, height - y];
    return [y, width - x];
  };
  const rotated = ops.map((op): StudioOp => {
    if (op.kind === 'rect') {
      const [ax, ay] = map(op.x, op.y);
      const [bx, by] = map(op.x + op.w, op.y + op.h);
      return { ...op, x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
    }
    if (op.kind === 'path') {
      return {
        ...op,
        segments: op.segments.map((segment) => {
          if (segment.type === 'Z') return segment;
          const [x, y] = map(segment.x, segment.y);
          if (segment.type === 'M' || segment.type === 'L') return { type: segment.type, x, y };
          if (segment.type === 'Q') {
            const [cx, cy] = map(segment.cx, segment.cy);
            return { type: 'Q', cx, cy, x, y };
          }
          const [c1x, c1y] = map(segment.c1x, segment.c1y);
          const [c2x, c2y] = map(segment.c2x, segment.c2y);
          return { type: 'C', c1x, c1y, c2x, c2y, x, y };
        }),
      };
    }
    return op;
  });
  return turns === 2 ? { ops: rotated, width, height } : { ops: rotated, width: height, height: width };
}

export interface PngRequest extends EncodeRequest {
  dpi: number;
  /** Include the recommended quiet zone around the symbol. */
  quietZone?: boolean;
  /** Background `#rrggbb`, or omitted for a transparent image. */
  background?: string;
  /** Clockwise rotation in quarter turns. */
  quarterTurns?: number;
}

export interface PngResult {
  png: Uint8Array;
  /** Whole pixels per module, after rounding to the device grid. */
  pixelsPerModule: number;
  /** The module width those pixels represent at the requested resolution. */
  moduleMm: number;
}

/**
 * Render a pixel-exact PNG.
 *
 * A bitmap barcode is only reliable when every module is a whole number of pixels, so the requested
 * module width is snapped to the nearest whole-pixel size at the requested resolution and the size
 * actually used is reported back. Resampling a vector to an arbitrary size is what produces bars of
 * uneven width.
 */
export async function renderSymbolPng(request: PngRequest): Promise<PngResult> {
  const resolved = resolveEncoding(request);
  const dpi = clamp(Math.round(request.dpi), 72, 1200);
  const pixelsPerUnit = Math.max(1, Math.round((resolved.mmPerUnit / 25.4) * dpi));
  const unitsPerModule = request.symbology.sizing.mode === 'module' ? request.symbology.sizing.unitsPerModule : 1;
  const quietUnits =
    request.quietZone === false
      ? 0
      : request.symbology.sizing.mode === 'fixed'
        ? Math.ceil(Math.max(2, quietModules(request.symbology) * 0.25) / resolved.mmPerUnit)
        : Math.round(quietModules(request.symbology, resolved.hasText) * unitsPerModule);
  const rotation = (['N', 'R', 'I', 'L'] as const)[(((request.quarterTurns ?? 0) % 4) + 4) % 4] ?? 'N';

  let png: Buffer;
  try {
    png = await bwipjs.toBuffer({
      bcid: request.symbology.bcid,
      text: resolved.data,
      scale: pixelsPerUnit,
      rotate: rotation,
      paddingwidth: quietUnits,
      paddingheight: quietUnits,
      ...(request.background && HEX.test(request.background) ? { backgroundcolor: request.background.slice(1) } : {}),
      ...resolved.params,
    } as never);
  } catch (error) {
    throw new BarcodeError(describeEncoderError(error, request.symbology));
  }
  const pixelsPerModule = pixelsPerUnit * unitsPerModule;
  return { png: new Uint8Array(png), pixelsPerModule, moduleMm: (pixelsPerModule * 25.4) / dpi };
}
