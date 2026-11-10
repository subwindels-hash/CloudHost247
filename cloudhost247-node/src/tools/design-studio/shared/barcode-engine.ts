/**
 * Design Studio — the barcode engine.
 *
 * One function turns a format + payload into a normalised drawing that every exporter (screen SVG,
 * downloaded SVG, PDF, PNG via canvas) consumes. Nothing here draws bars by hand: the geometry comes
 * from BWIPP through `bwip-js`, which implements each symbology against its specification.
 *
 * ## Why the engine returns paths and module grids, not an SVG string
 *
 * An SVG string is a dead end. It cannot be placed inside a larger label document, cannot be
 * re-coloured without string surgery, and cannot be validated element-by-element. So the engine
 * renders through a custom BWIPP drawing context and records what it drew:
 *
 *   - `rects`     — the bars and 2D modules, in *symbol units* (1 unit = 1 module for 2D codes,
 *                   1 unit = 1 narrow bar for linear codes);
 *   - `texts`     — the human-readable line BWIPP positioned itself, with the font cell size and the
 *                   exact x/y it chose, so the label renderer never re-guesses typography;
 *   - `widthUnits` / `heightUnits` — the symbol's natural size, which is what "module size in mm"
 *                   multiplies to get a physical size.
 *
 * That is what makes the interactive preview, the PDF and the test-suite decoder read the *same*
 * symbol instead of three approximations of it.
 *
 * ## Honesty rules
 *
 * 1. An unknown format, an invalid payload or a payload too large for the chosen symbol is an
 *    error with the encoder's own reason. It never degrades into a decorative placeholder.
 * 2. Payloads are validated before encoding, so a wrong-length EAN-13 says "EAN-13 needs 12 or 13
 *    digits" instead of an opaque BWIPP exception.
 * 3. A `checkDigit: 'calculated'` format accepts the short form and lets the encoder append the
 *    check digit; the returned `payload` is the value actually encoded.
 */

import bwipjs from 'bwip-js';
import QRCode from 'qrcode';
import {
  BARCODE_FORMATS,
  findBarcodeFormat,
  gs1AiSpec,
  type BarcodeFormat,
} from './barcode-catalog';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** A single dark rectangle in symbol units, relative to the symbol's top-left corner. */
export interface SymbolRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Human-readable text the encoder positioned, in symbol units. */
export interface SymbolText {
  x: number;
  /** Baseline y in symbol units (top-down). */
  y: number;
  text: string;
  /** Font cell height in symbol units. */
  size: number;
  family: 'ocr-b' | 'mono' | 'sans';
}

/**
 * A normalised, fully encoded symbol.
 *
 * `widthUnits × heightUnits` is the symbol's natural size; multiply by the chosen module size in
 * millimetres to get the physical footprint.
 */
export interface EncodedBarcode {
  formatId: string;
  bcid: string;
  family: 'linear' | '2d';
  /** The exact string handed to the encoder (includes a computed check digit where applicable). */
  payload: string;
  widthUnits: number;
  heightUnits: number;
  /**
   * Every dark region as a closed polygon, in symbol units. This is the *drawing* geometry: a
   * PDF417 row is a concave stepped shape, and its bounding box would over-ink the spaces that make
   * it readable, so renderers must draw these points and not `rects`.
   */
  polygons: Array<Array<[number, number]>>;
  /**
   * Axis-aligned bounding box of each region, in symbol units. Kept because it is what tests and
   * the X-dimension estimate want, and because it is easier to read when auditing a symbol.
   */
  rects: SymbolRect[];
  texts: SymbolText[];
  /** True when the symbol carries a guard/bearer bar the encoder drew as part of the symbol. */
  hasBearerBar: boolean;
  /** Quiet zone the specification requires, in modules / narrow bars. */
  quietModules: number;
  /** Physical width of one narrow bar (linear) or module (2D), in millimetres. */
  moduleMm: number;
  /** Narrow bar width, in symbol units — the divisor that turns `moduleMm` into a physical size. */
  xDimension: number;
  /** Extra explanation produced while encoding (e.g. "check digit 7 was calculated"). */
  notes: string[];
}

export interface EncodeOptions {
  /** Encoder name override; normally taken from the format. */
  formatId: string;
  payload: string;
  /** 2D error-correction setting. Meaning depends on the format. */
  errorCorrection?: string;
  /** PDF417 data columns (1–30). */
  columns?: number;
}

export class BarcodeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'BarcodeError';
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export interface BarcodeValidation {
  ok: boolean;
  /** The value to encode (trimmed, upper-cased where the format requires it). */
  value: string;
  issues: { level: 'error' | 'warn'; message: string; field: string }[];
}

/** GS1 element string check: parentheses balanced, known AIs well-formed. */
export function validateGs1(value: string): { issues: BarcodeValidation['issues']; normalised: string } {
  const issues: BarcodeValidation['issues'] = [];
  const normalised = value.replace(/\s+/g, '');
  if (!/^(\(\d{2,4}\)[^()]+)+$/.test(normalised)) {
    issues.push({
      level: 'error',
      field: 'payload',
      message: 'GS1 data must be written as AI elements in parentheses, for example (01)09521234543213(10)BATCH7.',
    });
    return { issues, normalised };
  }
  const elements = [...normalised.matchAll(/\((\d{2,4})\)([^()]+)/g)].map((match) => ({ ai: match[1] ?? '', data: match[2] ?? '' }));
  if (elements.length === 0) {
    issues.push({ level: 'error', field: 'payload', message: 'No GS1 element was found in the data.' });
  }
  for (const element of elements) {
    const spec = gs1AiSpec(element.ai);
    if (!spec) {
      issues.push({
        level: 'warn',
        field: 'payload',
        message: `AI (${element.ai}) is not in this tool's AI table, so its length and character rules were not checked. The structure was passed to the encoder unchanged.`,
      });
      continue;
    }
    if (spec.fixed > 0 && element.data.length !== spec.fixed) {
      issues.push({
        level: 'error',
        field: 'payload',
        message: `AI (${element.ai}) — ${spec.name} must be exactly ${spec.fixed} characters; ${element.data.length} were supplied.`,
      });
    }
    if (spec.fixed === 0 && spec.max && element.data.length > spec.max) {
      issues.push({
        level: 'error',
        field: 'payload',
        message: `AI (${element.ai}) — ${spec.name} is limited to ${spec.max} characters; ${element.data.length} were supplied.`,
      });
    }
    if (spec.numericOnly && !/^\d*$/.test(element.data)) {
      issues.push({ level: 'error', field: 'payload', message: `AI (${element.ai}) — ${spec.name} must be numeric.` });
    }
  }
  return { issues, normalised };
}

/**
 * Validate a payload for a format *before* encoding.
 *
 * The checks mirror what the specification requires, so the message a user reads names the rule
 * rather than quoting an encoder exception.
 */
export function validateBarcodePayload(formatId: string, rawPayload: string): BarcodeValidation {
  const format = findBarcodeFormat(formatId);
  if (!format) {
    return {
      ok: false,
      value: rawPayload,
      issues: [{ level: 'error', field: 'format', message: `“${formatId}” is not a format this build can encode.` }],
    };
  }
  const issues: BarcodeValidation['issues'] = [];
  let value = (rawPayload ?? '').trim();

  if (value === '') {
    issues.push({ level: 'error', field: 'payload', message: 'Enter the data to encode.' });
    return { ok: false, value, issues };
  }

  if (format.data.kind === 'gs1') {
    // GS1 DataBar carries a bare GTIN, while GS1-128 carries AI element strings. Normalise both
    // into BWIPP's "(01)…" form so one validator serves the whole GS1 family.
    if (format.id === 'gs1databar') {
      if (/^\d{13,14}$/.test(value)) value = `(01)${value.length === 13 ? `0${value}` : value}`;
      if (!/^\(01\)\d{14}$/.test(value)) {
        issues.push({ level: 'error', field: 'payload', message: format.data.hint });
        return { ok: false, value, issues };
      }
      const gtin = value.slice(4);
      const expected = gtinCheckDigit(gtin.slice(0, -1));
      if (expected !== null && Number(gtin[gtin.length - 1]) !== expected) {
        issues.push({ level: 'error', field: 'payload', message: `The GTIN check digit is wrong: it must be ${expected}, not ${gtin[gtin.length - 1]}.` });
      }
      return { ok: !issues.some((issue) => issue.level === 'error'), value, issues };
    }
    const gs1 = validateGs1(value);
    issues.push(...gs1.issues);
    return { ok: !issues.some((issue) => issue.level === 'error'), value: gs1.normalised, issues };
  }

  if (format.data.kind === 'numeric' && !/^\d+$/.test(value)) {
    issues.push({ level: 'error', field: 'payload', message: `${format.name} encodes digits only.` });
    return { ok: false, value, issues };
  }

  if (format.id === 'code39') {
    const upper = value.toUpperCase();
    if (upper !== value) {
      issues.push({ level: 'warn', field: 'payload', message: 'Code 39 has no lower-case letters; the data was upper-cased.' });
      value = upper;
    }
  }

  if (format.data.charset && !format.data.charset.test(value)) {
    issues.push({ level: 'error', field: 'payload', message: format.data.hint });
  }

  if (value.length < format.data.minLength) {
    issues.push({
      level: 'error',
      field: 'payload',
      message: `${format.name} needs at least ${format.data.minLength} characters; ${value.length} ${value.length === 1 ? 'was' : 'were'} supplied.`,
    });
  }
  if (value.length > format.data.maxLength) {
    issues.push({
      level: 'error',
      field: 'payload',
      message: `${format.name} accepts at most ${format.data.maxLength} characters; ${value.length} were supplied.`,
    });
  }
  if (format.id === 'upce') {
    // UPC-E's check digit is computed over its UPC-A *expansion*, so it cannot use the generic
    // GTIN rule below. Each accepted length is checked against the expansion it stands for.
    if (value.length === 6) {
      const check = upceCheckDigit(value, '0');
      if (check === null) issues.push({ level: 'error', field: 'payload', message: format.data.hint });
      else issues.push({ level: 'warn', field: 'payload', message: `The check digit ${check} will be calculated from the UPC-A expansion and appended.` });
    } else if (value.length === 7 || value.length === 8) {
      const numberSystem = value.length === 8 ? value[0] ?? '0' : '0';
      const body = value.length === 8 ? value.slice(1, 7) : value.slice(0, 6);
      const supplied = Number(value[value.length - 1]);
      const expected = upceCheckDigit(body, numberSystem);
      if (expected === null) {
        issues.push({ level: 'error', field: 'payload', message: format.data.hint });
      } else if (supplied !== expected) {
        issues.push({
          level: 'error',
          field: 'payload',
          message: `The UPC-E check digit is wrong: for ${body} it must be ${expected}, not ${supplied}.`,
        });
      }
    } else {
      issues.push({ level: 'error', field: 'payload', message: format.data.hint });
    }
    return { ok: !issues.some((issue) => issue.level === 'error'), value, issues };
  }

  if (format.data.lengths && !format.data.lengths.includes(value.length)) {
    issues.push({
      level: 'error',
      field: 'payload',
      message: format.data.hint,
    });
  }

  // EAN/UPC family check-digit verification when the full-length form is supplied.
  if (format.data.checkDigit === 'calculated' && format.data.lengths) {
    const full = format.data.lengths[format.data.lengths.length - 1];
    const short = format.data.lengths[0];
    if (full !== undefined && short !== undefined && value.length === full) {
      const expected = gtinCheckDigit(value.slice(0, -1));
      if (expected !== null && Number(value[value.length - 1]) !== expected) {
        issues.push({
          level: 'error',
          field: 'payload',
          message: `The check digit is wrong: for ${value.slice(0, -1)} it must be ${expected}, not ${value[value.length - 1]}.`,
          // Keep the promise of the message: explain both ways out.
          ...({ hint: 'Enter the data without the check digit and it will be calculated for you.' } as object),
        });
      }
    } else if (value.length === short) {
      const expected = gtinCheckDigit(value);
      if (expected !== null) {
        issues.push({
          level: 'warn',
          field: 'payload',
          message: `The check digit ${expected} will be calculated and appended, so the symbol encodes ${value}${expected}.`,
        });
      }
    }
  }

  if (format.id === 'interleaved2of5' && value.length % 2 !== 0) {
    issues.push({
      level: 'warn',
      field: 'payload',
      message: 'Interleaved 2 of 5 encodes digit pairs, so a leading zero was added to make the length even.',
    });
  }

  const maxChars = format.practicalMaxChars ?? format.data.maxLength;
  if (format.family === '2d' && value.length > maxChars) {
    issues.push({
      level: 'warn',
      field: 'payload',
      message: `This payload is long for ${format.name}. Print it large enough that each module stays above ${format.minModuleMm} mm, or shorten it.`,
    });
  }

  return { ok: !issues.some((issue) => issue.level === 'error'), value, issues };
}

/**
 * GS1 / GTIN mod-10 check digit over the supplied digits (weights 3,1 alternating from the right).
 *
 * EAN-8/13, UPC-A/E and ITF-14 all use this calculation over their data digits; the weight pattern
 * starts at 3 for the rightmost data digit.
 */
export function gtinCheckDigit(dataDigits: string): number | null {
  if (!/^\d+$/.test(dataDigits)) return null;
  let sum = 0;
  let weight = 3;
  for (let index = dataDigits.length - 1; index >= 0; index -= 1) {
    sum += Number(dataDigits[index]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Expand a UPC-E six-digit body to its UPC-A eleven-digit form, per the GS1 zero-suppression rules.
 * The last digit of the body selects which of the four expansion patterns applies.
 */
export function expandUpce(body: string, numberSystem = '0'): string | null {
  if (!/^\d{6}$/.test(body)) return null;
  const [d1, d2, d3, d4, d5, d6] = body.split('');
  const ns = numberSystem;
  switch (d6) {
    case '0': case '1': case '2':
      return `${ns}${d1}${d2}${d6}0000${d3}${d4}${d5}`;
    case '3':
      return `${ns}${d1}${d2}${d3}00000${d4}${d5}`;
    case '4':
      return `${ns}${d1}${d2}${d3}${d4}00000${d5}`;
    default:
      return `${ns}${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  }
}

/** The check digit for a UPC-E body, computed from the UPC-A expansion it stands for. */
export function upceCheckDigit(body: string, numberSystem = '0'): number | null {
  const expanded = expandUpce(body, numberSystem);
  if (!expanded) return null;
  return gtinCheckDigit(expanded);
}

/**
 * Append the check digit a retail format requires, returning the completed value and the note that
 * explains it. UPC-E's check digit is computed over its UPC-A expansion, not over its own digits.
 */
export function completeIdentifier(formatId: string, value: string): { value: string; note: string } | null {
  if (formatId === 'upce') {
    // Only the 6-digit form needs completing; 7 and 8 digits already carry a verified check digit.
    if (value.length !== 6) return null;
    const expanded = expandUpce(value, '0');
    const check = upceCheckDigit(value, '0');
    if (!expanded || check === null) return null;
    return {
      value: `${value}${check}`,
      note: `The check digit ${check} was calculated from the UPC-A expansion ${expanded} and appended.`,
    };
  }
  const check = gtinCheckDigit(value);
  if (check === null) return null;
  return { value: `${value}${check}`, note: `The check digit ${check} was calculated and appended, so the symbol encodes ${value}${check}.` };
}

/* ------------------------------------------------------------------ */
/* Encoding                                                            */
/* ------------------------------------------------------------------ */

/**
 * Per-format BWIPP option strings.
 *
 * `includetext` is set for every linear format so BWIPP draws the human-readable line in the font
 * the specification prescribes (OCR-B for the retail family, its own metrics elsewhere). The
 * renderer decides whether to keep that line, so the toggle does not change the encoded symbol,
 * only its presentation.
 */
function encoderOptions(format: BarcodeFormat, options: EncodeOptions): Record<string, unknown> {
  /*
   * `includetext` must be ON for linear formats, or BWIPP never draws the human-readable line — and
   * `texts` then comes back empty, which the renderer silently obeys by leaving the caption band
   * blank. That was the shipped behaviour: every linear symbol reserved 8 modules of space under the
   * bars and printed nothing in it, so an EAN-13 with no digits under it passed every geometry test
   * (the bars were correct!) and failed the only test that matters — a person reading the number.
   * The layout decides whether the caption is *kept*; the encoder decides whether it is *drawn*.
   */
  const opts: Record<string, unknown> = {
    bcid: format.bcid,
    text: options.payload,
    scale: 1,
    includetext: format.family === 'linear',
  };
  if (format.family === 'linear') {
    // A tall symbol gives the renderer room to scale height independently; the value is in
    // millimetres at BWIPP's nominal scale and is only a shape hint here.
    opts.height = 15;
    // Centre the caption under the symbol, the way the retail specifications lay it out.
    opts.textxalign = 'center';
  }
  if (format.id === 'qrcode' || format.id === 'microqrcode') {
    opts.eclevel = (options.errorCorrection ?? 'M').toUpperCase();
  }
  if (format.id === 'pdf417') {
    if (options.columns && Number.isInteger(options.columns) && options.columns >= 1 && options.columns <= 30) {
      opts.columns = options.columns;
    }
    if (options.errorCorrection) opts.eclevel = options.errorCorrection;
  }
  if (format.id === 'azteccode' && options.errorCorrection) {
    // BWIPP expects an integer percentage for Aztec.
    const percent = Number.parseInt(options.errorCorrection, 10);
    if (Number.isFinite(percent) && percent >= 5 && percent <= 95) opts.eclevel = percent;
  }
  if (format.id === 'gs1-128') {
    // BWIPP parses the AI notation itself for this encoder.
    opts.parse = true;
  }
  if (format.id === 'codabar') {
    // Codabar symbols are framed by start/stop characters A–D. The user supplies data only; the
    // encoder refuses data without framing, so the frame is added here and stated in the notes.
    opts.text = codabarFramed(options.payload);
  }
  if (format.id === 'upce') {
    // BWIPP expects the 7-digit (number-system-less) form; validating an 8-digit value means
    // checking its check digit against the expansion, so the number-system digit is passed through.
    const digits = options.payload;
    opts.text = digits.length === 8 ? digits.slice(1) : digits;
  }
  return opts;
}

interface CollectedGeometry {
  width: number;
  height: number;
  /**
   * Every dark region as a closed polygon, in symbol units. This is the *drawing* geometry: a
   * PDF417 row is a concave stepped shape, and its bounding box would over-ink the spaces that make
   * it readable, so renderers must draw these points and not `rects`.
   */
  polygons: Array<Array<[number, number]>>;
  /**
   * Axis-aligned bounding box of each region, in symbol units. Kept because it is what tests and
   * the X-dimension estimate want, and because it is easier to read when auditing a symbol.
   */
  rects: SymbolRect[];
  texts: SymbolText[];
  bearer: boolean;
  scaleX: number;
  scaleY: number;
}

/**
 * Render through BWIPP's drawing API and collect geometry.
 *
 * BWIPP emits bars as stroked vertical lines (linear) or as filled polygons (2D). Both are reduced
 * to rectangles here — a bar is `line(x, top, x, bottom, width)` and a 2D run is an axis-aligned
 * rectangle — which is all a barcode actually is. Anything that is not an axis-aligned run (there
 * is nothing in the formats this registry offers) is reported rather than approximated.
 */
function collectGeometry(params: Record<string, unknown>): CollectedGeometry {
  const rects: SymbolRect[] = [];
  const polygons: Array<Array<[number, number]>> = [];
  const texts: SymbolText[] = [];
  let width = 0;
  let height = 0;
  let bearer = false;
  let scaleX = 1;
  let scaleY = 1;

  const context = {
    setopts: () => undefined,
    scale(sx: number, sy: number): [number, number] {
      scaleX = sx;
      scaleY = sy;
      return [sx, sy];
    },
    measure(text: string, _font: string, fwidth: number, fheight: number) {
      // A proportional estimate is enough: BWIPP uses this to centre the human-readable line, and
      // the renderer draws the text with a real font at the same width.
      const charWidth = fwidth * 0.62;
      return { width: text.length * charWidth, ascent: fheight * 0.75, descent: fheight * 0.25 };
    },
    init(w: number, h: number): void {
      width = w;
      height = h;
    },
    line(x0: number, y0: number, x1: number, y1: number, lw: number): void {
      const thickness = Math.max(1, lw);
      // BWIPP's `line(x0, y0, x1, y1, lw)` gives the bar *centreline* and its thickness, exactly like
      // an SVG stroke (`toSVG` emits `M(x) ... stroke-width=lw`). The footprint therefore starts half
      // a thickness before the coordinate.
      //
      // The catch: BWIPP rounds the centreline to an integer before calling us and re-applies a
      // half-pixel bias inside its own SVG writer, so an odd-thickness bar arrives a half module to
      // the right. Without this correction every narrow bar of a 1-module symbol is displaced and the
      // result looks perfect while failing to decode.
      const bias = thickness % 2 === 1 ? -0.5 : 0;
      if (x0 === x1) {
        const rect = { x: x0 + bias - thickness / 2, y: Math.min(y0, y1), w: thickness, h: Math.abs(y1 - y0) };
        rects.push(rect);
        polygons.push(rectPolygon(rect));
      } else if (y0 === y1) {
        const rect = { x: Math.min(x0, x1), y: y0 + bias - thickness / 2, w: Math.abs(x1 - x0), h: thickness };
        rects.push(rect);
        polygons.push(rectPolygon(rect));
      } else {
        // BWIPP only emits orthogonal lines; a diagonal would mean a format this engine does not
        // understand, and silently drawing a box around it would be a lie.
        throw new BarcodeError('UNSUPPORTED_GEOMETRY', 'The encoder produced a non-orthogonal bar; this format is not supported by the design studio renderer.');
      }
    },
    /**
     * BWIPP calls `polygon()` once per *disjoint* dark region and then a single `fill()` for the
     * whole path. Each region is axis-aligned, so one rectangle per call is exactly the region —
     * which is what makes a QR code come out as ~200 rectangles rather than one black square.
     */
    polygon(points: Array<[number, number]>): void {
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (const [x, y] of points) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) return;
      rects.push({ x: minX, y: minY, w: maxX - minX, h: maxY - minY });
      // The exact outline, not the bounding box: PDF417 emits concave stepped regions whose box
      // covers white space that the symbology needs to decode.
      polygons.push(points.map(([x, y]) => [x, y] as [number, number]));
    },
    hexagon(points: Array<[number, number]>): void {
      bearer = true;
      // A hexagon is a filled region like any other; its bounding box is what gets inked at the
      // sizes used here (the only hexagon user is MaxiCode, which the registry does not offer).
      context.polygon(points);
    },
    ellipse(): void {
      throw new BarcodeError('UNSUPPORTED_GEOMETRY', 'This encode uses circular dots, which the design studio renderer does not draw. Choose a different format.');
    },
    fill(): void {
      // Regions were already recorded by polygon(); the fill only closes BWIPP's path.
    },
    text(x: number, y: number, value: string, _rgb: string, font: { name: string; height: number; rotate: number }): void {
      const family = /OCR/i.test(font.name) ? 'ocr-b' : /mono|courier/i.test(font.name) ? 'mono' : 'sans';
      texts.push({ x, y, text: value, size: font.height, family: family as SymbolText['family'] });
    },
    end(): void {
      // Nothing to flush: geometry is recorded as it is drawn.
    },
  };

  bwipjs.render(params as never, context as never);
  return { width, height, rects, polygons, texts, bearer, scaleX, scaleY };
}

/** Wrap a Codabar payload in the standard A…B frame unless the caller supplied its own. */
export function codabarFramed(payload: string): string {
  const value = payload.trim();
  if (/^[A-D][\s\S]*[A-D]$/.test(value) && value.length >= 3) return value;
  return `A${value}B`;
}

/**
 * Encode a barcode.
 *
 * Throws `BarcodeError` with a message that can be shown to the user; callers should validate with
 * `validateBarcodePayload` first so the common mistakes never reach this function.
 */
export function encodeBarcode(options: EncodeOptions): EncodedBarcode {
  const format = findBarcodeFormat(options.formatId);
  if (!format) {
    throw new BarcodeError('UNSUPPORTED_FORMAT', `“${options.formatId}” is not a format this build can encode.`);
  }
  const validation = validateBarcodePayload(format.id, options.payload);
  if (!validation.ok) {
    throw new BarcodeError('INVALID_PAYLOAD', validation.issues.filter((issue) => issue.level === 'error').map((issue) => issue.message).join(' '));
  }

  const notes: string[] = [];
  let payload = validation.value;

  // Complete the check digit before encoding, so the reported payload is what the symbol contains.
  // BWIPP would add it silently; a tool that prints "encodes exactly what you typed" must not.
  if (format.data.checkDigit === 'calculated' && format.data.lengths) {
    const full = format.data.lengths[format.data.lengths.length - 1] ?? 0;
    const short = format.data.lengths[0] ?? 0;
    if (payload.length === short) {
      const completed = completeIdentifier(format.id, payload);
      if (completed) {
        payload = completed.value;
        notes.push(completed.note);
      }
    }
  }

  const params = encoderOptions(format, { ...options, payload });

  let geometry: CollectedGeometry;
  try {
    geometry = collectGeometry(params);
  } catch (error) {
    if (error instanceof BarcodeError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new BarcodeError('ENCODE_FAILED', translateEncoderError(message, format));
  }

  if (format.id === 'interleaved2of5' && payload.length % 2 !== 0) {
    payload = `0${payload}`;
    notes.push(`The symbol encodes ${payload} — a leading zero was added so the digits pair up.`);
  }
  if (format.id === 'code39' && payload !== payload.toUpperCase()) {
    payload = payload.toUpperCase();
  }
  if (format.id === 'codabar') {
    const framed = codabarFramed(payload);
    if (framed !== payload) {
      payload = framed;
      notes.push('The symbol is framed with the Codabar start/stop characters A and B, as the standard requires.');
    }
  }

  // Re-base geometry so the symbol starts at (0,0). BWIPP includes its quiet zone in the drawing
  // area for some encoders, and a consumer that positions the symbol must not have to know that.
  const minX = geometry.rects.reduce((value, rect) => Math.min(value, rect.x, rect.x + rect.w), Number.POSITIVE_INFINITY);
  const minY = geometry.rects.reduce((value, rect) => Math.min(value, rect.y, rect.y + rect.h), Number.POSITIVE_INFINITY);
  const maxX = geometry.rects.reduce((value, rect) => Math.max(value, rect.x + rect.w), 0);
  const maxY = geometry.rects.reduce((value, rect) => Math.max(value, rect.y + rect.h), 0);
  const offsetX = Number.isFinite(minX) ? minX : 0;
  const offsetY = Number.isFinite(minY) ? minY : 0;
  const rects = geometry.rects.map((rect) => ({
    x: round(rect.x - offsetX, 3),
    y: round(rect.y - offsetY, 3),
    w: round(rect.w, 3),
    h: round(rect.h, 3),
  }));
  const texts = geometry.texts.map((entry) => ({
    ...entry,
    x: round(entry.x - offsetX, 3),
    y: round(entry.y - offsetY, 3),
  }));
  const polygons = geometry.polygons.map((polygon) => polygon.map(([x, y]) => [round(x - offsetX, 3), round(y - offsetY, 3)] as [number, number]));

  return {
    formatId: format.id,
    bcid: format.bcid,
    family: format.family,
    payload,
    widthUnits: round(maxX - offsetX || geometry.width, 3),
    heightUnits: round(maxY - offsetY || geometry.height, 3),
    polygons,
    rects,
    texts,
    hasBearerBar: geometry.bearer || format.id === 'itf14',
    quietModules: format.quietModules,
    moduleMm: format.minModuleMm,
    xDimension: estimateXDimension(rects),
    notes,
  };
}

function rectPolygon(rect: SymbolRect): Array<[number, number]> {
  return [
    [rect.x, rect.y],
    [rect.x + rect.w, rect.y],
    [rect.x + rect.w, rect.y + rect.h],
    [rect.x, rect.y + rect.h],
  ];
}

/**
 * The narrow-bar width, in symbol units, derived from the geometry itself.
 *
 * BWIPP draws bar widths as whole numbers of units, so the narrow bar is the greatest common divisor
 * of every width — the same trick barcode verifiers use. For a 2D matrix every module is the same
 * size and the result is 1. Deriving it instead of hard-coding keeps `moduleMm` honest across
 * formats whose encoders use different internal scales.
 */
export function estimateXDimension(rects: readonly SymbolRect[]): number {
  const widths = rects.map((rect) => Math.round(rect.w * 1000)).filter((width) => width > 0);
  if (widths.length === 0) return 1;
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  let result = widths[0] ?? 1;
  for (const width of widths.slice(1)) {
    result = gcd(result, width);
    if (result === 1) return 1;
  }
  return result / 1000;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * Turns a BWIPP exception into something a person can act on.
 *
 * BWIPP's messages are precise but terse (`bwipp.ean13BadCheckDigit`), and exposing the raw string
 * to a visitor reads like a crash. The mapping keeps the encoder's reason and adds the fix.
 */
export function translateEncoderError(message: string, format: BarcodeFormat): string {
  const known: Array<[RegExp, string]> = [
    [/BadCheckDigit/i, 'The check digit does not match the data. Remove the last digit and it will be calculated for you.'],
    [/BadLength|InvalidLength/i, `${format.name} does not accept a payload of that length. ${format.data.hint}`],
    [/numdigits|numeric/i, `${format.name} encodes digits only.`],
    [/encodation|character/i, `${format.name} cannot encode one or more characters in this payload.`],
    [/too (long|large)|overflow|capacity/i, `This payload is too large for ${format.name}. Shorten it or choose a format with more capacity.`],
    [/unknownEncoder/i, `${format.name} is not available in this build of the encoder.`],
  ];
  for (const [pattern, text] of known) {
    if (pattern.test(message)) return text;
  }
  return `${format.name} could not encode this payload: ${message.replace(/^bwipp\.[A-Za-z0-9]+[:#]?\s*/, '')}`;
}

/* ------------------------------------------------------------------ */
/* QR (module matrix)                                                  */
/* ------------------------------------------------------------------ */

export interface EncodedQr {
  payload: string;
  /** Modules per side, excluding the quiet zone. */
  modules: number;
  version: number;
  /** Row-major, true = dark. */
  matrix: boolean[][];
  errorCorrection: string;
}

export type QrErrorCorrection = 'L' | 'M' | 'Q' | 'H';

/**
 * Encode a QR code to a module matrix.
 *
 * Uses the same `qrcode` encoder as the Tools Center QR generator, the Employee ID Card and the
 * Business Card generator, so a QR on a label is the same symbol as a QR from the QR tool for the
 * same payload and error-correction level. Tests decode the rendered result with `jsqr`.
 */
export function encodeQrMatrix(payload: string, errorCorrection: QrErrorCorrection = 'M'): EncodedQr {
  const value = (payload ?? '').trim();
  if (value === '') throw new BarcodeError('INVALID_PAYLOAD', 'Enter the content to encode.');
  let symbol: QRCode.QRCode;
  try {
    symbol = QRCode.create(value, { errorCorrectionLevel: errorCorrection });
  } catch (error) {
    throw new BarcodeError('ENCODE_FAILED', `The QR code could not be generated: ${error instanceof Error ? error.message : 'the payload is too large for the chosen error-correction level.'}`);
  }
  const size = symbol.modules.size;
  const data = symbol.modules.data;
  const matrix: boolean[][] = [];
  for (let row = 0; row < size; row += 1) {
    const line: boolean[] = [];
    for (let column = 0; column < size; column += 1) line.push(Boolean(data[row * size + column]));
    matrix.push(line);
  }
  return { payload: value, modules: size, version: symbol.version, matrix, errorCorrection };
}

/** Number of dark modules in a matrix — a cheap fingerprint used by tests. */
export function darkModuleCount(matrix: boolean[][]): number {
  return matrix.reduce((total, row) => total + row.filter(Boolean).length, 0);
}

/* ------------------------------------------------------------------ */
/* Physical layout                                                     */
/* ------------------------------------------------------------------ */

/** Caption strip height in modules: the retail rule of thumb is 8–10. */
export const DEFAULT_CAPTION_SCALE = 10;

export interface BarcodeLayoutOptions {
  /** Physical width of one narrow bar / module, in millimetres. Defaults to the format minimum. */
  moduleMm?: number;
  /** Bar height for linear formats, in millimetres. Ignored for 2D. */
  barHeightMm?: number;
  /** Show the human-readable line. Defaults to true for linear formats (never for 2D). */
  showText?: boolean;
  /** Caption height as a multiple of the module size, default 10× (the retail rule of thumb is 8–10). */
  textScale?: number;
}

export interface BarcodeLayout {
  /** Bars only, excluding quiet zone and caption. */
  barsWidthMm: number;
  barsHeightMm: number;
  /** Quiet zone on each side, in millimetres. */
  quietMm: number;
  /** Total footprint including quiet zone and caption. */
  widthMm: number;
  heightMm: number;
  textHeightMm: number;
  moduleMm: number;
  showText: boolean;
  notes: string[];
}

/**
 * Height of the human-readable caption strip, in millimetres.
 *
 * One function, exported, because two callers need the same number for different reasons: the layout
 * adds it to the footprint, and a label document subtracts it from an element box to find out how tall
 * the *bars* may be. When those two calculations lived in separate files with separate constants
 * (`× 10` here, `× 8` there) every barcode label overflowed its own element by two modules and the
 * layout reported a fit error for a box that had been measured to fit.
 */
export function captionHeightMm(moduleMm: number, textScale = DEFAULT_CAPTION_SCALE): number {
  return round(moduleMm * textScale, 3);
}

/**
 * Convert an encoded symbol into a physical footprint, in millimetres.
 *
 * This is the one place that decides how big a symbol will actually be on paper, and it derives
 * that from the X-dimension rather than a percentage: a Code 128 payload twice as long is twice as
 * wide, which is the property that makes a printed barcode scannable at a stated resolution. A
 * renderer that stretched a symbol to fill a box instead would change the X-dimension per label and
 * turn a compliant 0.25 mm code into a 0.19 mm one.
 */
export function layoutBarcode(encoded: EncodedBarcode, options: BarcodeLayoutOptions = {}): BarcodeLayout {
  const notes: string[] = [];
  const moduleMm = Math.max(0.05, options.moduleMm ?? encoded.moduleMm);
  const perUnit = moduleMm / (encoded.xDimension || 1);
  const barsWidthMm = round(encoded.widthUnits * perUnit, 3);
  const quietMm = round(encoded.quietModules * moduleMm, 3);
  const is2d = encoded.family === '2d';
  const showText = is2d ? false : options.showText !== false;
  /*
   * The caption gets 10 modules of height (the retail rule of thumb is 8–10), and the *cap height* of
   * the printed line is arithmetic on that strip — not a rescale of BWIPP's font size.
   *
   * BWIPP reports `font.height` in its own layout units (10 for a 20-unit cell), and the renderers used
   * to apply `size / heightUnits × scaleY`, which landed somewhere between 1 mm and 20 mm depending on
   * the symbol. A human-readable line that is too small to read is as useless as no line at all, so the
   * strip is the authority: cap height is a fixed fraction of it, whatever the encoder said.
   */
  const textHeightMm = showText ? captionHeightMm(moduleMm, options.textScale) : 0;
  const barsHeightMm = is2d
    ? round(encoded.heightUnits * perUnit, 3)
    : Math.max(moduleMm * 5, options.barHeightMm ?? 15);
  if (moduleMm < encoded.moduleMm) {
    notes.push(
      `A ${moduleMm.toFixed(2)} mm module is below the ${encoded.moduleMm.toFixed(2)} mm practical minimum for this format. It may still scan from a good printer, but it is out of the specification's normal range.`
    );
  }
  return {
    barsWidthMm,
    barsHeightMm,
    quietMm,
    widthMm: round(barsWidthMm + quietMm * 2, 3),
    heightMm: round(barsHeightMm + quietMm * 2 + textHeightMm, 3),
    textHeightMm,
    moduleMm,
    showText,
    notes,
  };
}

/** Formats this build can encode, in catalogue order. */
export const SUPPORTED_FORMAT_IDS: readonly string[] = BARCODE_FORMATS.map((format) => format.id);
