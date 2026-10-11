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
 * Order of preference, and the reasoning behind it:
 *
 *  1. **Fits as asked** — nothing to do.
 *  2. **Shrink the font down to `minSize`** — carried out before any text is dropped, because a
 *     smaller complete value is nearly always better on a badge than a larger incomplete one. An
 *     employee ID, an email address or an emergency-contact number that has been clipped is *wrong
 *     information*, printed at a size that makes it look deliberate.
 *  3. **Drop trailing words with an ellipsis** (multi-word values only) at the size reached in step
 *     2, when even the shrunken text is too wide.
 *  4. **Truncate the tail** as the last resort, so nothing can be drawn outside its panel. A single
 *     token — an identifier, an email, a URL — reaches this step only if it is too wide at
 *     `minSize`, which is why the floor for a single token is very low: shrinking beats lying.
 *
 * `minSize` defaults to 32% of the requested size for a single token and 55% for prose; callers
 * that print an identifier with a hard length limit can pass their own floor.
 */
export function fitText(
  text: string,
  maxWidth: number,
  size: number,
  options: { minSize?: number; family?: 'sans' | 'mono'; tracking?: number } = {}
): FitResult {
  const family = options.family ?? 'sans';
  const tracking = options.tracking ?? 0;
  const plain = text.trim();
  if (plain === '') return { text: '', size, fitted: false };

  /** A value with no whitespace cannot be broken across words, so shrinking is the only honest fit. */
  const singleToken = !/\s/.test(plain);
  const lowestReadable = Math.max(5, Math.round(size * 0.32));
  /* A caller's floor expresses a *design* preference — a table row that must not become a wall of
     6 px text — but it never overrides the rule that an unbreakable value is completed rather than
     clipped. An email address or an identifier shortened mid-token looks like real data and matches
     nothing, which is the worst outcome a badge can produce. */
  const minSize = options.minSize === undefined ? (singleToken ? lowestReadable : Math.max(7, Math.round(size * 0.55))) : singleToken ? Math.min(options.minSize, lowestReadable) : options.minSize;

  const widthOf = (value: string, at: number): number =>
    tracking > 0 ? measureTrackedWidth(value, at, tracking, family) : measureTextWidth(value, at, family);

  if (widthOf(plain, size) <= maxWidth) return { text: plain, size, fitted: false };

  // Step 2: shrink to fit, keeping the whole value.
  let current = size;
  while (current > minSize && widthOf(plain, current) > maxWidth) current -= 1;
  if (widthOf(plain, current) <= maxWidth) {
    return { text: plain, size: current, fitted: current !== size };
  }

  // Step 3: prose only — drop trailing words at the shrunken size.
  const words = plain.split(/\s+/);
  if (words.length > 1) {
    for (let take = words.length - 1; take >= 1; take -= 1) {
      const candidate = `${words.slice(0, take).join(' ')}…`;
      if (widthOf(candidate, current) <= maxWidth) return { text: candidate, size: current, fitted: true };
    }
  }

  // Step 4: nothing else fits — truncate the tail so the text cannot leave its panel.
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

/**
 * `2024-03-01` → `1 March 2024`. Anything else is returned unchanged so nothing is invented.
 *
 * The month is spelled out: "31 Dec 2027" and "31 December 2027" are the same date, but an expiry
 * date is read at a glance by a guard or a security desk, and the unambiguous form is worth the
 * extra width on a field that is three characters long.
 */
export function formatCardDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return value.trim();
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return value.trim();
  const name = MONTHS[month - 1] ?? '';
  return `${day} ${name} ${match[1]}`;
}

/** A card face label: `1 March 2024`. */
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
