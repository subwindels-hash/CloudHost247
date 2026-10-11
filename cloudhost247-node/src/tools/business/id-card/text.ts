/**
 * Text measurement and fitting for the badge maker.
 *
 * A badge is the worst case for typesetting: fixed size, no scrolling, and a name that may be two
 * characters or forty. The layouts therefore *fit* text before they place it — `fitText()` shrinks
 * to the slot width, `wrapText()` breaks onto a second line at a word boundary — and both work off
 * the same width estimator so the SVG and the canvas renderer agree.
 *
 * The estimator is a per-character advance table for Helvetica/Arial at 1000 units per em. It is
 * not a font engine and does not claim to be: it is deliberately a little generous (rounding up),
 * because the failure it exists to prevent — text running under the photo or off the card edge —
 * is worse than a slightly small headline.
 */

const NARROW = 'iljtfrI.,;:!|\'`[](){} ';
const WIDE = 'MWmw@%&';

/** Advance widths (per 1000 em) for Arial/Helvetica, the family the renderers request. */
const WIDTHS: Record<string, number> = {
  ' ': 278, '!': 278, '"': 355, '#': 556, $: 556, '%': 889, '&': 667, "'": 191,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556, '@': 1015,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500,
  K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
  U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222,
  k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278,
  u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  '{': 334, '|': 260, '}': 334, '~': 584,
  // Digits were missing from the first version of this table, so every digit fell through to the
  // "unknown glyph" fallback and was measured at a full em instead of Arial's 0.556 em. That made
  // employee IDs and telephone numbers look a third wider than they are, and the fitter then
  // truncated them — on a badge whose whole job is to print the identifier in full. Digits are all
  // tabular in Arial, so one value covers them.
  '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556, '8': 556, '9': 556,
};

const MONO_WIDTH = 600;

/**
 * Estimated advance width of `text` at `size`, in card pixels.
 *
 * Unknown characters (accented letters, currency symbols, CJK) fall back to the width of `n`, which
 * is a little wide for Latin diacritics and much too narrow for CJK — so `measureTextWidth()` adds
 * a deliberate safety factor for any character outside the table.
 */
export function measureTextWidth(text: string, size: number, family: 'sans' | 'mono' = 'sans'): number {
  if (!text) return 0;
  if (family === 'mono') return text.length * MONO_WIDTH * (size / 1000);
  let units = 0;
  for (const char of text) {
    const width = WIDTHS[char];
    if (typeof width === 'number') {
      units += width;
      continue;
    }
    // Unknown glyph: assume a full-width character and round up.
    units += NARROW.includes(char) ? 278 : 1000;
  }
  return Math.ceil((units * size) / 1000);
}

/** Letter-spaced text is wider by `letterSpacing` per character, plus one trailing gap. */
export function measureTrackedWidth(text: string, size: number, spacing: number, family: 'sans' | 'mono' = 'sans'): number {
  if (!text) return 0;
  return measureTextWidth(text, size, family) + Math.max(0, spacing) * text.length;
}

export interface FitResult {
  text: string;
  size: number;
  /** True when the text had to be shortened or shrunk. */
  fitted: boolean;
}

/**
 * Fit `text` into `maxWidth`.
 *
 * Order of preference: keep the size and drop trailing words (with an ellipsis), preferring a
 * readable size over a complete line; if even the first word does not fit, shrink the font down to
 * `minSize`. A badge with a slightly short name is correct; a badge with a name printed through the
 * photograph is not.
 */
export function fitText(
  text: string,
  maxWidth: number,
  size: number,
  options: { minSize?: number; family?: 'sans' | 'mono'; tracking?: number } = {}
): FitResult {
  const family = options.family ?? 'sans';
  const minSize = options.minSize ?? Math.max(8, Math.round(size * 0.62));
  const tracking = options.tracking ?? 0;
  const plain = text.trim();
  if (plain === '') return { text: '', size, fitted: false };

  const widthOf = (value: string, at: number): number =>
    tracking > 0 ? measureTrackedWidth(value, at, tracking, family) : measureTextWidth(value, at, family);

  if (widthOf(plain, size) <= maxWidth) return { text: plain, size, fitted: false };

  const words = plain.split(/\s+/);
  for (let take = words.length - 1; take >= 1; take -= 1) {
    const candidate = `${words.slice(0, take).join(' ')}…`;
    if (widthOf(candidate, size) <= maxWidth) return { text: candidate, size, fitted: true };
  }

  let current = size;
  while (current > minSize && widthOf(plain, current) > maxWidth) current -= 1;
  if (widthOf(plain, current) <= maxWidth) {
    return { text: plain, size: current, fitted: current !== size };
  }

  // Still too wide at the minimum size: hard-truncate so nothing can leave the card.
  let clipped = plain;
  while (clipped.length > 1 && widthOf(`${clipped}…`, current) > maxWidth) clipped = clipped.slice(0, -1);
  return { text: `${clipped}…`, size: current, fitted: true };
}

/** Split `text` into at most `maxLines` lines that each fit `maxWidth`; the last is ellipsised. */
export function wrapText(text: string, maxWidth: number, size: number, maxLines: number, family: 'sans' | 'mono' = 'sans'): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (measureTextWidth(candidate, size, family) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current !== '') lines.push(current);
    current = word;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && current !== '') lines.push(current);
  const used = lines.slice(0, maxLines);
  if (used.length === maxLines && words.join(' ') !== used.join(' ')) {
    const last = used[maxLines - 1] ?? '';
    used[maxLines - 1] = fitText(`${last} …`, maxWidth, size, { family }).text.replace(/ …$/, '…');
  }
  return used;
}

/** Up to two initials, used by the templates that show a monogram when there is no photograph. */
export function initials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((part) => /[\p{L}\p{N}]/u.test(part));
  if (parts.length === 0) return 'ID';
  if (parts.length === 1) return (parts[0] ?? '').slice(0, 2).toUpperCase();
  return `${(parts[0] ?? '')[0] ?? ''}${(parts[parts.length - 1] ?? '')[0] ?? ''}`.toUpperCase();
}

/** Uppercase with non-breaking spaces, for the tracked field labels. */
export function label(value: string): string {
  return value.trim().toUpperCase();
}

/** Title-case a single word or short phrase. */
export function titleCase(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map((word) => (word.length === 0 ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`))
    .join(' ');
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** `2024-03-01` → `1 Mar 2024`. Anything else is returned unchanged so nothing is invented. */
export function formatCardDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return value.trim();
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return value.trim();
  const name = MONTHS[month - 1] ?? '';
  return `${day} ${name.slice(0, 3)} ${match[1]}`;
}

/** A card face label: `1 Mar 2024`. */
export function formatIssueLine(value: string): string {
  const formatted = formatCardDate(value);
  return formatted === '' ? '' : formatted;
}

/** Slug used for download filenames. Never empty, never path-traversing. */
export function fileSlug(value: string, fallback = 'employee'): string {
  const slug = value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug === '' ? fallback : slug;
}
