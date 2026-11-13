/**
 * Text metrics for the Design Studio renderers.
 *
 * A label is typeset before it is drawn: a part number has to fit its box, an address has to wrap,
 * a caption has to sit clear of the barcode next to it. That needs widths, and the widths have to
 * agree with what finally draws the text. The studio's print output is a vector PDF that uses the
 * standard Type 1 fonts every PDF reader must supply (Helvetica, Helvetica-Bold, Courier), so the
 * metrics here are those fonts' published advance widths. The layout therefore measures with the
 * same numbers the PDF renders with, and the SVG preview pins each run to the measured width
 * (`textLength`), so a browser that substitutes a wider font cannot push text out of its box.
 *
 * Two limits, stated rather than hidden:
 *
 *  - The standard fonts carry the Windows-1252 (Western European) character set. Anything outside it
 *    cannot be drawn without embedding a font, which this module does not do. `toWinAnsi()` reports
 *    exactly which characters were replaced so the caller can tell the user instead of printing a
 *    label that silently lost a letter.
 *  - No kerning is applied. The standard fonts are set unkerned in a PDF, so measuring unkerned is
 *    the accurate choice here, not an approximation.
 *
 * Pure and dependency-free: the same module runs in the API process and in the browser.
 */

export type StudioFont = 'sans' | 'sans-bold' | 'mono' | 'mono-bold';

/** Vertical metrics of Helvetica, as fractions of the font size. */
export const SANS_METRICS = { capHeight: 0.718, xHeight: 0.523, ascender: 0.718, descender: 0.207 } as const;

/** Font size (em) that produces capitals of the requested height. */
export function sizeForCapHeight(capHeightMm: number): number {
  return capHeightMm / SANS_METRICS.capHeight;
}

/** Points to millimetres (1 pt = 1/72 in). */
export function pt(points: number): number {
  return (points * 25.4) / 72;
}

// Advance widths per 1000 units of em, codes 32..126, in code order.
const SANS_ASCII = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const SANS_BOLD_ASCII = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/**
 * Codes 128..255 of Windows-1252. A string is the base character whose width the glyph shares (an
 * accented letter is as wide as its base letter); a pair is [regular, bold]; a number applies to both.
 */
const HIGH: Record<number, string | number | [number, number]> = {
  128: 556, 130: [222, 278], 131: 556, 132: [333, 500], 133: 1000, 134: 556, 135: 556, 136: 333,
  137: 1000, 138: 'S', 139: 333, 140: 1000, 142: 'Z', 145: [222, 278], 146: [222, 278],
  147: [333, 500], 148: [333, 500], 149: 350, 150: 556, 151: 1000, 152: 333, 153: 1000, 154: 's',
  155: 333, 156: 944, 158: 'z', 159: 'Y',
  160: 278, 161: 333, 162: 556, 163: 556, 164: 556, 165: 556, 166: [260, 280], 167: 556, 168: 333,
  169: 737, 170: 370, 171: 556, 172: 584, 173: 333, 174: 737, 175: 333, 176: 400, 177: 584,
  178: 333, 179: 333, 180: 333, 181: [556, 611], 182: [537, 556], 183: 278, 184: 333, 185: 333,
  186: 365, 187: 556, 188: 834, 189: 834, 190: 834, 191: 611,
  192: 'A', 193: 'A', 194: 'A', 195: 'A', 196: 'A', 197: 'A', 198: 1000, 199: 'C',
  200: 'E', 201: 'E', 202: 'E', 203: 'E', 204: 'I', 205: 'I', 206: 'I', 207: 'I',
  208: 'D', 209: 'N', 210: 'O', 211: 'O', 212: 'O', 213: 'O', 214: 'O', 215: 584, 216: 'O',
  217: 'U', 218: 'U', 219: 'U', 220: 'U', 221: 'Y', 222: 667, 223: 611,
  224: 'a', 225: 'a', 226: 'a', 227: 'a', 228: 'a', 229: 'a', 230: 889, 231: 'c',
  232: 'e', 233: 'e', 234: 'e', 235: 'e', 236: 278, 237: 278, 238: 278, 239: 278,
  240: 'o', 241: 'n', 242: 'o', 243: 'o', 244: 'o', 245: 'o', 246: 'o', 247: 584, 248: 611,
  249: 'u', 250: 'u', 251: 'u', 252: 'u', 253: 'y', 254: 'p', 255: 'y',
};

function buildTable(ascii: number[], bold: boolean): number[] {
  const table = new Array<number>(256).fill(0);
  ascii.forEach((width, index) => {
    table[32 + index] = width;
  });
  for (const [key, value] of Object.entries(HIGH)) {
    const code = Number(key);
    if (typeof value === 'number') table[code] = value;
    else if (typeof value === 'string') table[code] = table[value.charCodeAt(0)] ?? 556;
    else table[code] = bold ? value[1] : value[0];
  }
  return table;
}

const SANS_TABLE = buildTable(SANS_ASCII, false);
const SANS_BOLD_TABLE = buildTable(SANS_BOLD_ASCII, true);
const MONO_WIDTH = 600;

/** Unicode code points of the Windows-1252 characters that live at 0x80–0x9F. */
const CP1252_HIGH: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91,
  0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98,
  0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

/** Characters with a faithful single-character stand-in inside Windows-1252. */
const SUBSTITUTES: Record<number, string> = {
  0x00a0: ' ', 0x2010: '-', 0x2011: '-', 0x2012: '-', 0x2015: '-', 0x2212: '-', 0x2032: "'",
  0x2033: '"', 0x00ad: '-', 0x2009: ' ', 0x200a: ' ', 0x2002: ' ', 0x2003: ' ', 0x202f: ' ',
};

/** The Windows-1252 code for a character, or -1 when the standard fonts cannot draw it. */
export function winAnsiCode(char: string): number {
  const point = char.codePointAt(0) ?? 0;
  if (point >= 0x20 && point <= 0x7e) return point;
  if (point >= 0xa0 && point <= 0xff) return point;
  const high = CP1252_HIGH[point];
  return high === undefined ? -1 : high;
}

export interface WinAnsiText {
  /** The text as it will be drawn: unsupported characters are replaced by `?`. */
  text: string;
  /** One byte per drawn character, ready for a PDF literal string. */
  codes: number[];
  /** The distinct characters that could not be drawn at all, in order of first appearance. */
  unsupported: string[];
  /** Characters drawn in a simpler form the fonts do have, as `original → drawn`, in order of first appearance. */
  simplified: string[];
}

/**
 * Currency signs with a stand-in people already write when the sign is unavailable. A price that
 * reads "N4,500" is still a price; one that reads "?4,500" is not.
 */
const CURRENCY_STAND_INS: Record<number, string> = {
  0x20a6: 'N', // naira
  0x20b5: '\u00a2', // cedi, as the cent sign
  0x20b1: 'P', // peso
  0x20a9: 'W', // won
};

/**
 * Latin letters that Unicode does not decompose into a base letter and an accent, with the plain
 * letter each is conventionally written as when the special form is unavailable. The hooked letters
 * are Hausa's, the open vowels and eng are used across West Africa, and the barred ones are Polish,
 * Croatian and Maltese.
 */
const LETTER_STAND_INS: Record<string, string> = {
  Ɓ: 'B', ɓ: 'b', Ɗ: 'D', ɗ: 'd', Ƙ: 'K', ƙ: 'k', Ƴ: 'Y', ƴ: 'y',
  Ɛ: 'E', ɛ: 'e', Ɔ: 'O', ɔ: 'o', Ŋ: 'N', ŋ: 'n', Ǝ: 'E', ǝ: 'e',
  Ł: 'L', ł: 'l', Đ: 'D', đ: 'd', Ħ: 'H', ħ: 'h', Ŧ: 'T', ŧ: 't', ı: 'i',
};

/**
 * A character the fonts lack, reduced to one they have by dropping accents: `ọ` → `o`, `ṣ` → `s`.
 *
 * The standard fonts cover Western European letters only, so names written with other Latin
 * diacritics would otherwise print with `?` in the middle of them. One accent the fonts can draw is
 * kept where the letter carries several (`ọ́` → `ó`). Returns null when no recognisable form exists,
 * which is the case for every non-Latin script.
 */
function simplifyCluster(cluster: string): string | null {
  const points = Array.from(cluster.normalize('NFD'));
  const first = points[0];
  if (first === undefined) return null;
  const base = LETTER_STAND_INS[first] ?? first;
  const marks = points.slice(1);
  if (!marks.every((mark) => /^\p{M}$/u.test(mark))) return null;
  if (marks.length === 0) return base !== first ? base : null;
  for (const mark of marks) {
    const candidate = `${base}${mark}`.normalize('NFC');
    if (Array.from(candidate).length === 1 && winAnsiCode(candidate) !== -1) return candidate;
  }
  return winAnsiCode(base) !== -1 ? base : null;
}

/**
 * Reduce a string to what the standard fonts can draw.
 *
 * Tabs and line breaks become spaces (a text run is one line; wrapping is the layout's job), a few
 * typographic characters fold to their plain equivalents, letters with accents the fonts lack are
 * drawn without them, and anything else outside Windows-1252 is replaced with `?`. Every change
 * other than the purely typographic ones is reported, so the caller can tell the user.
 */
export function toWinAnsi(input: string): WinAnsiText {
  const codes: number[] = [];
  const unsupported: string[] = [];
  const simplified: string[] = [];
  let text = '';
  const push = (char: string): void => {
    codes.push(winAnsiCode(char));
    text += char;
  };
  // A cluster is a character with the combining marks that follow it; marks with nothing to sit on
  // are dropped.
  for (const cluster of input.normalize('NFC').match(/\P{M}\p{M}*|\p{M}+/gu) ?? []) {
    const point = cluster.codePointAt(0) ?? 0;
    if (/^\p{M}/u.test(cluster)) continue;
    if (cluster.length === 1 || Array.from(cluster).length === 1) {
      if (point === 0x09 || point === 0x0a || point === 0x0d) {
        push(' ');
        continue;
      }
      if (point < 0x20 || point === 0x7f) continue;
      const substitute = SUBSTITUTES[point];
      if (substitute !== undefined) {
        push(substitute);
        continue;
      }
      if (winAnsiCode(cluster) !== -1) {
        push(cluster);
        continue;
      }
    }
    const standIn = CURRENCY_STAND_INS[point] ?? simplifyCluster(cluster);
    if (standIn !== null && standIn !== undefined && winAnsiCode(standIn) !== -1) {
      const entry = `${cluster} \u2192 ${standIn}`;
      if (!simplified.includes(entry)) simplified.push(entry);
      push(standIn);
      continue;
    }
    if (!unsupported.includes(cluster)) unsupported.push(cluster);
    codes.push(0x3f);
    text += '?';
  }
  return { text, codes, unsupported, simplified };
}

function tableFor(font: StudioFont): number[] | null {
  if (font === 'sans') return SANS_TABLE;
  if (font === 'sans-bold') return SANS_BOLD_TABLE;
  return null;
}

/** Advance width of `text` at `size`, in the same unit as `size`. Unsupported characters measure as `?`. */
export function measureText(text: string, size: number, font: StudioFont = 'sans'): number {
  if (!text) return 0;
  const table = tableFor(font);
  let units = 0;
  for (const char of text) {
    if (!table) {
      units += MONO_WIDTH;
      continue;
    }
    const code = winAnsiCode(char);
    units += table[code === -1 ? 0x3f : code] ?? 556;
  }
  return (units * size) / 1000;
}

/** The studio font for a draw-op's `family` and `weight`. */
export function fontFor(family: 'sans' | 'mono' | undefined, weight: string | undefined): StudioFont {
  const bold = weight === '600' || weight === '700' || weight === '800';
  if (family === 'mono') return bold ? 'mono-bold' : 'mono';
  return bold ? 'sans-bold' : 'sans';
}

export interface FittedText {
  text: string;
  size: number;
  width: number;
  /** True when the font had to shrink below the requested size. */
  shrunk: boolean;
  /** True when characters were dropped because the value could not fit even at `minSize`. */
  truncated: boolean;
}

/**
 * Fit one line into `maxWidth`: shrink first, cut last.
 *
 * A complete value in smaller type is nearly always better on a label than a larger incomplete one,
 * so the font shrinks all the way to `minSize` before a single character is dropped. A caller that
 * prints an identifier should treat `truncated` as a reportable problem, not a cosmetic one.
 */
export function fitText(text: string, maxWidth: number, size: number, options: { minSize?: number; font?: StudioFont } = {}): FittedText {
  const font = options.font ?? 'sans';
  const minSize = Math.min(size, options.minSize ?? size * 0.5);
  const value = text.trim();
  if (value === '' || maxWidth <= 0) return { text: value, size, width: 0, shrunk: false, truncated: false };

  const natural = measureText(value, size, font);
  if (natural <= maxWidth) return { text: value, size, width: natural, shrunk: false, truncated: false };

  // Width is linear in size, so the fitting size is exact: no search loop is needed.
  const fitted = Math.max(minSize, (size * maxWidth) / natural);
  if (measureText(value, fitted, font) <= maxWidth + 1e-9) {
    return { text: value, size: fitted, width: measureText(value, fitted, font), shrunk: true, truncated: false };
  }

  let clipped = value;
  while (clipped.length > 1 && measureText(`${clipped}...`, minSize, font) > maxWidth) clipped = clipped.slice(0, -1);
  const result = `${clipped.trimEnd()}...`;
  return { text: result, size: minSize, width: measureText(result, minSize, font), shrunk: true, truncated: true };
}

export interface WrappedText {
  lines: string[];
  /** True when the text did not fit in `maxLines` and the last line was cut. */
  truncated: boolean;
}

/**
 * Break text into lines that each fit `maxWidth`.
 *
 * Explicit line breaks are honoured (an address is entered line by line), long words are split
 * rather than allowed to overflow, and overflow beyond `maxLines` is reported instead of dropped
 * without a trace.
 */
export function wrapText(text: string, maxWidth: number, size: number, options: { font?: StudioFont; maxLines?: number } = {}): WrappedText {
  const font = options.font ?? 'sans';
  const maxLines = options.maxLines ?? 99;
  const lines: string[] = [];
  let truncated = false;

  const pushLine = (line: string): boolean => {
    if (lines.length >= maxLines) {
      truncated = true;
      return false;
    }
    lines.push(line);
    return true;
  };

  outer: for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    let current = '';
    for (let word of words) {
      // A single token wider than the line is split at the character level.
      while (measureText(word, size, font) > maxWidth && word.length > 1) {
        if (current !== '') {
          if (!pushLine(current)) break outer;
          current = '';
        }
        let take = word.length - 1;
        while (take > 1 && measureText(word.slice(0, take), size, font) > maxWidth) take -= 1;
        if (!pushLine(word.slice(0, take))) break outer;
        word = word.slice(take);
      }
      const candidate = current === '' ? word : `${current} ${word}`;
      if (measureText(candidate, size, font) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (!pushLine(current)) break outer;
      current = word;
    }
    if (current !== '' && !pushLine(current)) break;
  }

  if (truncated && lines.length > 0) {
    let last = lines[lines.length - 1] ?? '';
    while (last.length > 1 && measureText(`${last}...`, size, font) > maxWidth) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last.trimEnd()}...`;
  }
  return { lines, truncated };
}
