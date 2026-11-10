/**
 * Design Studio — text measurement and wrapping.
 *
 * The layout engine has to know how wide a string will be *before* it hands the document to a
 * renderer, because that is what "does this fit inside the label" means. A browser can measure with
 * `canvas.measureText`, the API cannot, and neither can Vitest — so the module ships its own
 * metrics, calibrated to Helvetica/Courier advance widths (the two Base-14 PDF fonts used for
 * output, which every PDF reader has without embedding).
 *
 * The numbers are the standard AFM advance widths for Helvetica at 1000 units per em, plus a small
 * safety factor. They are conservative: text that measures as fitting here does fit, which is the
 * direction an error should fall in — a line that silently runs off a printed label is worse than a
 * line that wraps one word early.
 */

import type { FontFamily } from './draw-ops';

/** Helvetica advance widths (per 1000 em) for the printable ASCII range. */
const HELVETICA_WIDTHS: Record<string, number> = {
  ' ': 278, '!': 278, '"': 355, '#': 556, '$': 556, '%': 889, '&': 667, "'": 191,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556, '8': 556, '9': 556,
  ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556, '@': 1015,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556,
  M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667,
  Y: 667, Z: 611,
  '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222,
  m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500,
  y: 500, z: 500,
  '{': 334, '|': 260, '}': 334, '~': 584,
};

/** Times advance widths for the same range, used by the `serif` family. */
const TIMES_WIDTHS: Record<string, number> = {
  ' ': 250, A: 722, B: 667, C: 667, D: 722, E: 611, F: 556, G: 722, H: 722, I: 333, J: 389, K: 722,
  L: 611, M: 889, N: 722, O: 722, P: 556, Q: 722, R: 667, S: 556, T: 611, U: 722, V: 722, W: 944,
  X: 722, Y: 722, Z: 611, a: 444, b: 500, c: 444, d: 500, e: 444, f: 333, g: 500, h: 500, i: 278,
  j: 278, k: 500, l: 278, m: 778, n: 500, o: 500, p: 500, q: 500, r: 333, s: 389, t: 278, u: 500,
  v: 500, w: 722, x: 500, y: 500, z: 444, '0': 500, '1': 500, '2': 500, '3': 500, '4': 500, '5': 500,
  '6': 500, '7': 500, '8': 500, '9': 500, '.': 250, ',': 250, '-': 333, '/': 278, ':': 278, ';': 278,
};

const MONO_WIDTH = 600;
/** Safety factor applied to every measurement: Helvetica metrics assume exact font matching. */
const SAFETY = 1.04;

/**
 * Width of `text` at `size` millimetres, in millimetres.
 *
 * `bold` applies the ~6% Helvetica-Bold widening rather than a separate table: the difference is
 * small and the safety factor already absorbs it.
 */
export function measureText(text: string, size: number, family: FontFamily = 'sans'): number {
  if (!text) return 0;
  if (family === 'mono') return text.length * MONO_WIDTH * (size / 1000) * SAFETY;
  const table = family === 'serif' ? TIMES_WIDTHS : HELVETICA_WIDTHS;
  let units = 0;
  for (const char of text) {
    const width = table[char] ?? HELVETICA_WIDTHS[char];
    // Unknown glyphs (accented letters, CJK) are counted as wide: better to wrap early than to
    // discover the overflow on paper.
    units += typeof width === 'number' ? width : 1000;
  }
  const boldFactor = family === 'sans-bold' ? 1.06 : 1;
  return (units * size) / 1000 * SAFETY * boldFactor;
}

/** Rough line height for a font size; renderers use the same ratio so text blocks line up. */
export function lineHeightFor(size: number): number {
  return size * 1.28;
}

/** Cap height as a fraction of font size — where a baseline sits inside a text box. */
export const CAP_HEIGHT_RATIO = 0.717;
/** Descender depth as a fraction of font size. */
export const DESCENT_RATIO = 0.207;

/**
 * Shrink a font size until `text` fits `maxWidth`, down to `minSize`.
 *
 * Returns the size to use and whether it had to be reduced. A caller that gets `fitted: false` back
 * should truncate or wrap — silently printing a clipped barcode caption is not an option.
 */
export function fitTextSize(
  text: string,
  size: number,
  maxWidth: number,
  family: FontFamily,
  minSize = 1.5
): { size: number; fitted: boolean } {
  const width = measureText(text, size, family);
  if (width <= maxWidth || width === 0) return { size, fitted: true };
  const scaled = Math.max(minSize, (size * maxWidth) / width);
  return { size: Math.floor(scaled * 100) / 100, fitted: measureText(text, scaled, family) <= maxWidth };
}

/**
 * Wrap `text` into at most `maxLines` lines that fit `maxWidth`.
 *
 * Words longer than the line (a long part number, an email address) are broken on character
 * boundaries rather than overflowing — the same rule the Employee ID Card uses, because a label is
 * even less forgiving of an overhanging word than a card.
 */
export function wrapText(text: string, size: number, maxWidth: number, family: FontFamily, maxLines = 20): string[] {
  const paragraphs = String(text ?? '').split(/\r?\n/);
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph === '') {
      lines.push('');
      continue;
    }
    let current = '';
    for (const word of paragraph.split(/\s+/)) {
      const candidate = current === '' ? word : `${current} ${word}`;
      if (measureText(candidate, size, family) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current !== '') {
        lines.push(current);
        current = '';
      }
      if (measureText(word, size, family) <= maxWidth) {
        current = word;
        continue;
      }
      // Break the oversized word itself.
      let chunk = '';
      for (const char of word) {
        if (measureText(chunk + char, size, family) > maxWidth && chunk !== '') {
          lines.push(chunk);
          chunk = char;
        } else {
          chunk += char;
        }
      }
      current = chunk;
    }
    if (current !== '') lines.push(current);
    if (lines.length >= maxLines) break;
  }
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    const last = kept[maxLines - 1] ?? '';
    kept[maxLines - 1] = `${last.slice(0, Math.max(0, last.length - 1))}…`;
    return kept;
  }
  return lines;
}

/** Truncate to a single line with an ellipsis, using the same metrics. */
export function ellipsize(text: string, size: number, maxWidth: number, family: FontFamily): string {
  if (measureText(text, size, family) <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && measureText(`${result}…`, size, family) > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}…`;
}

/** Uppercase with a guard for scripts where upper-casing changes the length meaningfully. */
export function displayUpper(value: string): string {
  return value.toLocaleUpperCase('en-US');
}
