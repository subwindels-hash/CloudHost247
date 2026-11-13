/**
 * Label composition: text that fits and symbols that scan.
 *
 * Every label template in the studio is written against this small canvas instead of pushing draw
 * operations by hand, because the two things a label most often gets wrong are decided here once:
 *
 *  - Text is measured before it is placed. A value that is too wide shrinks, then wraps, and is cut
 *    only as a last resort — and when it is cut the label says so in its notices.
 *  - A symbol is sized to its box by changing its module width, never by scaling the drawing. If the
 *    data cannot be printed at a module width a scanner can resolve, the label is refused with the
 *    reason, rather than printed with bars too fine to read.
 */

import type { StudioOp, StudioSurface } from '../render/draw-ops';
import { SANS_METRICS, fontFor, measureText, wrapText } from '../render/text-metrics';
import { auditText } from '../render/text-run';
import { carriedContent } from '../barcode/carried';
import { BarcodeError, encodeSymbol, rotateSymbol, translateOps, type EncodeRequest, type EncodedSymbol } from '../barcode/encoder';
import { isLinear, symbologyById, type Symbology } from '../barcode/symbologies';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextStyle {
  /** Font size (the em) in millimetres. */
  size: number;
  weight?: '400' | '600' | '700' | '800';
  family?: 'sans' | 'mono';
  color?: string;
}

export interface LineStyle extends TextStyle {
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
}

export interface ParagraphStyle extends TextStyle {
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  /** Line pitch as a multiple of the font size. */
  leading?: number;
  /** The smallest size the paragraph may shrink to before lines are dropped. Defaults to 70%. */
  minSize?: number;
  maxLines?: number;
  /** Named in the notice if the text has to be cut, e.g. "The description". */
  what?: string;
}

export interface StackItem extends TextStyle {
  text: string;
  /** More than one line makes the item a wrapped paragraph. */
  maxLines?: number;
  /** Named in the notice if the text has to be cut. */
  what?: string;
}

export interface SymbolSpec {
  /** Symbology id from the registry. */
  symbology: string;
  data: string;
  /** How error messages and notices refer to this symbol, e.g. "The part number barcode". */
  what: string;
  /** Preferred module width in millimetres. Reduced, down to the minimum, if the box is too small. */
  moduleMm?: number;
  /** The smallest module width this label accepts for the symbol. */
  minModuleMm?: number;
  /** Bar height for linear codes. Omitted means "as tall as the box allows". */
  barHeightMm?: number;
  /** Largest bar height when filling the box. */
  maxBarHeightMm?: number;
  showText?: boolean;
  options?: Record<string, unknown>;
  color?: string;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  /** Clockwise quarter turns. */
  quarterTurns?: number;
  /** The caller reports the module width in its own words, so the generic notice is not added. */
  reportsOwnSize?: boolean;
  /** Encode `data` exactly as given. For payloads the tool builds itself, such as a vCard. */
  verbatim?: boolean;
  /**
   * What to do when the symbol does not fit, where the general advice (a larger label, a more
   * compact barcode type) is not open to the user: a transport label has one size and one symbology.
   */
  advice?: string;
}

export interface PlacedSymbol {
  /** The symbol's footprint on the label, quiet zone included. */
  box: Box;
  moduleMm: number;
  /** The data as entered, after tidying. */
  data: string;
  /** What the symbol holds: `data`, plus any check digit or padding the barcode type adds itself. */
  carries: string;
  symbologyName: string;
}

const EPSILON = 0.01;
const CAP = SANS_METRICS.capHeight;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number): string {
  return `${Math.round(value * 100) / 100}`;
}

function anchorOf(align: 'left' | 'center' | 'right' | undefined): 'start' | 'middle' | 'end' {
  return align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
}

function anchorX(box: Box, align: 'left' | 'center' | 'right' | undefined): number {
  return align === 'center' ? box.x + box.w / 2 : align === 'right' ? box.x + box.w : box.x;
}

/** Shrink a box by a margin on every side. */
export function inset(box: Box, dx: number, dy: number = dx): Box {
  return { x: box.x + dx, y: box.y + dy, w: Math.max(0, box.w - 2 * dx), h: Math.max(0, box.h - 2 * dy) };
}

export class LabelCanvas {
  readonly ops: StudioOp[] = [];
  readonly symbols: PlacedSymbol[] = [];
  private readonly noticeSet = new Set<string>();

  constructor(
    public readonly width: number,
    public readonly height: number,
    public readonly background: string = '#ffffff'
  ) {}

  get bounds(): Box {
    return { x: 0, y: 0, w: this.width, h: this.height };
  }

  note(message: string): void {
    this.noticeSet.add(message);
  }

  rect(box: Box, style: { fill?: string; stroke?: string; strokeWidth?: number; radius?: number } = {}): void {
    this.ops.push({ kind: 'rect', x: box.x, y: box.y, w: box.w, h: box.h, ...style });
  }

  line(x1: number, y1: number, x2: number, y2: number, width = 0.25, color = '#000000'): void {
    this.ops.push({ kind: 'line', x1, y1, x2, y2, width, color });
  }

  /** A rectangular outline drawn inside `box`, so the stroke never crosses the label edge. */
  frame(box: Box, strokeWidth = 0.3, color = '#000000'): void {
    const half = strokeWidth / 2;
    this.rect({ x: box.x + half, y: box.y + half, w: box.w - strokeWidth, h: box.h - strokeWidth }, { stroke: color, strokeWidth });
  }

  /** One line of text at a baseline. Wider than `maxWidth`, it shrinks, and is cut only if it must be. */
  text(value: string, x: number, baseline: number, style: TextStyle & { anchor?: 'start' | 'middle' | 'end'; maxWidth?: number }): void {
    if (value.trim() === '') return;
    this.ops.push({
      kind: 'text',
      x,
      y: baseline,
      text: value,
      size: style.size,
      color: style.color ?? '#000000',
      ...(style.weight ? { weight: style.weight } : {}),
      ...(style.family ? { family: style.family } : {}),
      ...(style.anchor ? { anchor: style.anchor } : {}),
      ...(style.maxWidth ? { maxWidth: style.maxWidth } : {}),
    });
  }

  /** One line of text placed inside a box by its capital height. Returns the height it occupies. */
  lineIn(value: string, box: Box, style: LineStyle): number {
    const capHeight = style.size * CAP;
    if (value.trim() === '') return capHeight;
    const top = style.valign === 'middle' ? box.y + (box.h - capHeight) / 2 : style.valign === 'bottom' ? box.y + box.h - capHeight : box.y;
    this.text(value, anchorX(box, style.align), top + capHeight, { ...style, anchor: anchorOf(style.align), maxWidth: box.w });
    return capHeight;
  }

  /**
   * Wrapped text inside a box. The type shrinks until the lines fit the box; only if they still do
   * not fit at the smallest size are trailing lines dropped, and that is reported.
   *
   * Returns the y coordinate just below the last line drawn.
   */
  paragraph(value: string, box: Box, style: ParagraphStyle): number {
    if (value.trim() === '' || box.w <= 0 || box.h <= 0) return box.y;
    const font = fontFor(style.family, style.weight);
    const leading = style.leading ?? 1.22;
    const minSize = Math.min(style.size, style.minSize ?? style.size * 0.7);
    const cap = style.maxLines ?? 99;

    const blockHeight = (count: number, size: number): number => (count - 1) * size * leading + size * CAP;
    const roomFor = (size: number): number => Math.max(1, Math.min(cap, Math.floor((box.h - size * CAP) / (size * leading) + 1 + 1e-6)));

    let size = style.size;
    let wrapped = wrapText(value, box.w, size, { font, maxLines: roomFor(size) });
    while (wrapped.truncated && size > minSize + 1e-6) {
      size = Math.max(minSize, size - Math.max(0.1, style.size * 0.05));
      wrapped = wrapText(value, box.w, size, { font, maxLines: roomFor(size) });
    }
    if (wrapped.truncated) {
      // Shrinking did not rescue it, so there is no reason to print what is left in small type.
      size = style.size;
      wrapped = wrapText(value, box.w, size, { font, maxLines: roomFor(size) });
      this.note(`${style.what ?? 'Some text'} did not fit and was shortened on the label.`);
    }

    const lines = wrapped.lines;
    const total = blockHeight(lines.length, size);
    const top = style.valign === 'middle' ? box.y + Math.max(0, (box.h - total) / 2) : style.valign === 'bottom' ? box.y + Math.max(0, box.h - total) : box.y;
    lines.forEach((line, index) => {
      this.text(line, anchorX(box, style.align), top + size * CAP + index * size * leading, {
        size,
        anchor: anchorOf(style.align),
        maxWidth: box.w,
        ...(style.weight ? { weight: style.weight } : {}),
        ...(style.family ? { family: style.family } : {}),
        ...(style.color ? { color: style.color } : {}),
      });
    });
    return top + total;
  }

  /**
   * A column of text items, top to bottom, placed in a box as one group.
   *
   * If the group is taller than the box every size and gap is reduced together, so the hierarchy
   * between a heading and its body survives on a small label.
   */
  stack(box: Box, items: readonly StackItem[], gap: number, align: 'left' | 'center' | 'right' = 'left', valign: 'top' | 'middle' | 'bottom' = 'middle'): void {
    const present = items.filter((item) => item.text.trim() !== '');
    if (present.length === 0 || box.w <= 0 || box.h <= 0) return;
    const leading = 1.22;

    const measureAt = (scale: number): { heights: number[]; total: number } => {
      const heights = present.map((item) => {
        const size = item.size * scale;
        const lines = wrapText(item.text, box.w, size, { font: fontFor(item.family, item.weight), maxLines: item.maxLines ?? 1 }).lines.length;
        return (Math.max(1, lines) - 1) * size * leading + size * CAP;
      });
      return { heights, total: heights.reduce((sum, value) => sum + value, 0) + gap * scale * (present.length - 1) };
    };

    let scale = 1;
    let measured = measureAt(scale);
    for (let attempt = 0; attempt < 6 && measured.total > box.h + EPSILON && scale > 0.5; attempt += 1) {
      scale = Math.max(0.5, scale * Math.min(0.97, box.h / measured.total));
      measured = measureAt(scale);
    }

    let y = valign === 'middle' ? box.y + Math.max(0, (box.h - measured.total) / 2) : valign === 'bottom' ? box.y + Math.max(0, box.h - measured.total) : box.y;
    present.forEach((item, index) => {
      const height = measured.heights[index] ?? 0;
      const style = {
        size: item.size * scale,
        align,
        ...(item.weight ? { weight: item.weight } : {}),
        ...(item.family ? { family: item.family } : {}),
        ...(item.color ? { color: item.color } : {}),
      };
      if (y + height > box.y + box.h + 0.5) {
        this.note(`${item.what ?? 'Some text'} did not fit on the label and was left out.`);
        return;
      }
      if ((item.maxLines ?? 1) <= 1) {
        this.lineIn(item.text, { x: box.x, y, w: box.w, h: height }, style);
      } else {
        this.paragraph(item.text, { x: box.x, y, w: box.w, h: height + EPSILON }, {
          ...style,
          leading,
          minSize: style.size,
          ...(item.maxLines !== undefined ? { maxLines: item.maxLines } : {}),
          ...(item.what ? { what: item.what } : {}),
        });
      }
      y += height + gap * scale;
    });
  }

  /** The width one line of text would take, for layouts that place things beside a value. */
  measure(value: string, style: TextStyle): number {
    return measureText(value, style.size, fontFor(style.family, style.weight));
  }

  /**
   * The module width a symbol would get in a box, without drawing it. A layout with more than one
   * place for a barcode uses this to choose the place where it scans best.
   *
   * Throws exactly as `symbol` does.
   */
  measureSymbol(spec: SymbolSpec, box: Box): { moduleMm: number; comfortable: boolean } {
    const fitted = this.fit(spec, box);
    return { moduleMm: fitted.symbol.moduleMm, comfortable: fitted.comfortable };
  }

  /**
   * Place a symbol inside a box, quiet zone included.
   *
   * The module width starts at the preferred value and is reduced only as far as the label's minimum.
   * Throws `BarcodeError('size')` when the data cannot fit at that minimum.
   */
  symbol(spec: SymbolSpec, box: Box): PlacedSymbol {
    const { symbology, symbol, turns, sideways, linear, comfortable } = this.fit(spec, box);
    if (!spec.reportsOwnSize && !comfortable) {
      this.note(`${spec.what} is printed with a ${round2(symbol.moduleMm)} mm module to fit the label. Print at 300 dpi or finer and test-scan before using it.`);
    }

    const quietRun = symbol.quietMm;
    const quietRise = linear ? 0 : symbol.quietMm;
    const rotated = rotateSymbol(symbol.ops, symbol.width, symbol.height, turns);
    const footprintW = rotated.width + 2 * (sideways ? quietRise : quietRun);
    const footprintH = rotated.height + 2 * (sideways ? quietRun : quietRise);
    const x = spec.align === 'left' ? box.x : spec.align === 'right' ? box.x + box.w - footprintW : box.x + (box.w - footprintW) / 2;
    const y = spec.valign === 'top' ? box.y : spec.valign === 'bottom' ? box.y + box.h - footprintH : box.y + (box.h - footprintH) / 2;
    this.ops.push(...translateOps(rotated.ops, x + (sideways ? quietRise : quietRun), y + (sideways ? quietRun : quietRise)));

    const carried = carriedContent(symbology, symbol.data, spec.options?.includecheck === true);
    const placed: PlacedSymbol = { box: { x, y, w: footprintW, h: footprintH }, moduleMm: symbol.moduleMm, data: symbol.data, carries: carried?.content ?? symbol.data, symbologyName: symbology.name };
    this.symbols.push(placed);
    return placed;
  }

  /** Encode a symbol at the largest module width, up to the preferred one, that fits the box. */
  private fit(spec: SymbolSpec, box: Box): { symbology: Symbology; symbol: EncodedSymbol; turns: number; sideways: boolean; linear: boolean; comfortable: boolean } {
    const symbology = symbologyById(spec.symbology);
    if (!symbology) throw new BarcodeError(`${spec.what} uses a barcode type this build does not offer.`, 'option');

    const turns = (((spec.quarterTurns ?? 0) % 4) + 4) % 4;
    const sideways = turns % 2 === 1;
    // "run" is the direction the modules advance in; "rise" is across it.
    const run = sideways ? box.h : box.w;
    const rise = sideways ? box.w : box.h;
    const linear = isLinear(symbology);

    const base: EncodeRequest = {
      symbology,
      data: spec.data,
      showText: spec.showText ?? false,
      ...(spec.options ? { options: spec.options } : {}),
      ...(spec.color ? { color: spec.color } : {}),
      ...(spec.verbatim ? { verbatim: true } : {}),
    };
    let symbol: EncodedSymbol;
    // A symbol of prescribed size is always the size its specification asks for.
    let comfortable = true;
    if (symbology.sizing.mode === 'fixed') {
      symbol = encodeSymbol(base);
      const quiet = symbol.quietMm;
      if (symbol.width + 2 * quiet > run + EPSILON || symbol.height + 2 * (linear ? 0 : quiet) > rise + EPSILON) {
        throw new BarcodeError(`${spec.what} has a fixed size of ${round2(symbol.width)} × ${round2(symbol.height)} mm and does not fit this label.`, 'size');
      }
    } else {
      const sizing = symbology.sizing;
      const minModule = clamp(spec.minModuleMm ?? sizing.minModuleMm, sizing.minModuleMm, sizing.maxModuleMm);
      let moduleMm = clamp(spec.moduleMm ?? sizing.defaultModuleMm, minModule, sizing.maxModuleMm);
      const bar = symbology.barHeight;
      let barHeight = bar ? clamp(spec.barHeightMm ?? bar.defaultMm, bar.minMm, bar.maxMm) : undefined;
      const encode = (): EncodedSymbol =>
        encodeSymbol({ ...base, moduleMm, ...(barHeight !== undefined ? { barHeightMm: barHeight } : {}) });
      const runOf = (item: EncodedSymbol): number => item.width + 2 * item.quietMm;
      const riseOf = (item: EncodedSymbol): number => item.height + 2 * (linear ? 0 : item.quietMm);
      // The refusal says what the symbol needs at the smallest module this label accepts and what
      // the label has, so the reader can see by how much it misses and what would fix it.
      const tooSmall = (along: 'run' | 'rise'): BarcodeError => {
        const available = along === 'run' ? run : rise;
        const direction = (along === 'run') === sideways ? 'tall' : 'wide';
        const sizeAtMinimum = (data: string): number | null => {
          try {
            const atMinimum = encodeSymbol({ ...base, data, moduleMm: minModule, ...(barHeight !== undefined ? { barHeightMm: barHeight } : {}) });
            return along === 'run' ? runOf(atMinimum) : riseOf(atMinimum);
          } catch {
            return null;
          }
        };
        const needed = sizeAtMinimum(spec.data);
        const smallest = `the ${linear ? 'narrowest bar' : 'smallest module'} this label allows (${round2(minModule)} mm)`;
        const sizes =
          needed !== null
            ? `at ${smallest} it is ${round2(needed)} mm ${direction} with its quiet zone, and the label has ${round2(available)} mm for it`
            : `the label has ${round2(available)} mm for it, which is too little at ${smallest}`;
        if (spec.advice) return new BarcodeError(`${spec.what} does not fit: ${sizes}. ${spec.advice}`, 'size');
        // "Use a shorter value" is advice only where a shorter value makes a smaller symbol. An
        // EAN-13 is the same width whatever its digits, so the suggestion is made only after a
        // shortened value has been encoded and found smaller.
        const middle = Math.floor(spec.data.length / 2);
        const shortened = [spec.data.slice(0, -1), spec.data.slice(0, -2), spec.data.slice(0, middle) + spec.data.slice(middle + 1), spec.data.slice(0, middle) + spec.data.slice(middle + 2), spec.data.slice(0, middle)];
        const shorterHelps =
          needed !== null &&
          shortened.some((candidate) => {
            if (candidate.trim() === '') return false;
            const size = sizeAtMinimum(candidate);
            return size !== null && size < needed - 1e-6;
          });
        return new BarcodeError(`${spec.what} does not fit: ${sizes}. Use a larger label${shorterHelps ? ', a shorter value' : ''} or a more compact barcode type.`, 'size');
      };

      symbol = encode();

      // Along the run, the footprint is proportional to the module width, so the fitting width is exact.
      if (runOf(symbol) > run + EPSILON) {
        moduleMm = Math.floor(((moduleMm * run) / runOf(symbol)) * 200) / 200;
        if (moduleMm < minModule - 1e-9) throw tooSmall('run');
        symbol = encode();
        while (runOf(symbol) > run + EPSILON) {
          moduleMm = Math.round((moduleMm - 0.005) * 1000) / 1000;
          if (moduleMm < minModule - 1e-9) throw tooSmall('run');
          symbol = encode();
        }
      }

      if (bar && barHeight !== undefined) {
        // A linear symbol's height is its bars plus whatever the human-readable line adds.
        const extra = Math.max(0, symbol.height - barHeight);
        const room = rise - extra;
        if (room < bar.minMm - EPSILON) {
          throw new BarcodeError(
            `${spec.what} does not fit: this label leaves ${round2(Math.max(0, room))} mm for bars that need at least ${bar.minMm} mm. ${spec.advice ?? 'Use a taller label or put less text on it.'}`,
            'size'
          );
        }
        const wanted = spec.barHeightMm === undefined ? Math.min(room, spec.maxBarHeightMm ?? bar.maxMm) : Math.min(barHeight, room);
        const next = clamp(wanted, bar.minMm, bar.maxMm);
        if (Math.abs(next - barHeight) > 1e-6) {
          barHeight = next;
          symbol = encode();
        }
        if (riseOf(symbol) > rise + EPSILON) {
          barHeight = clamp(barHeight - (riseOf(symbol) - rise), bar.minMm, bar.maxMm);
          symbol = encode();
        }
      } else if (riseOf(symbol) > rise + EPSILON) {
        moduleMm = Math.floor(((moduleMm * rise) / riseOf(symbol)) * 200) / 200;
        if (moduleMm < minModule - 1e-9) throw tooSmall('rise');
        symbol = encode();
        while (riseOf(symbol) > rise + EPSILON) {
          moduleMm = Math.round((moduleMm - 0.005) * 1000) / 1000;
          if (moduleMm < minModule - 1e-9) throw tooSmall('rise');
          symbol = encode();
        }
      }

      // Below this the result carries a notice asking for a finer printer and a test scan.
      comfortable = symbol.moduleMm >= (linear ? 0.25 : 0.33) - 1e-9;
    }
    return { symbology, symbol, turns, sideways, linear, comfortable };
  }

  /** The finished surface, with a notice for anything the text lost on its way to the page. */
  finish(): { surface: StudioSurface; notices: string[] } {
    const audit = auditText(this.ops);
    if (audit.unsupported.length > 0) {
      const shown = audit.unsupported.slice(0, 12).join(' ');
      this.note(
        `These characters cannot be printed with the built-in fonts and appear as “?” in the text: ${shown}${audit.unsupported.length > 12 ? ' …' : ''}. Barcodes and QR codes still carry the original value.`
      );
    }
    if (audit.simplified.length > 0) {
      this.note(
        `The built-in fonts lack some characters, so the printed text uses the nearest form they have: ${audit.simplified.slice(0, 12).join(', ')}${audit.simplified.length > 12 ? ' …' : ''}. Barcodes and QR codes still carry the original value.`
      );
    }
    if (audit.truncated.length > 0) {
      this.note(`Text that was too long for its space was shortened: ${audit.truncated.slice(0, 4).map((value) => `“${value}”`).join(', ')}${audit.truncated.length > 4 ? ' …' : ''}.`);
    }
    return { surface: { width: this.width, height: this.height, ops: this.ops, background: this.background }, notices: [...this.noticeSet] };
  }
}
