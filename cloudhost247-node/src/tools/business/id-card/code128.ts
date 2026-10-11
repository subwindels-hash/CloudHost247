/**
 * Code 128 encoder — and, because "it looks like a barcode" is not evidence, a decoder.
 *
 * The badge maker prints a barcode of the employee identifier so a turnstile or a stock-room scanner
 * can read it. A decorative bar pattern would be worse than no barcode at all: it would be printed,
 * believed and then fail at the door. So this module implements Code 128 properly —
 * the full 107-symbol pattern table, the modulo-103 check symbol, Code B for alphanumeric payloads
 * and Code C for long digit runs (half the width for the same data) — and ships the inverse
 * function. `decodeCode128(encodeCode128Code(value).modules)` is asserted in the test suite, which
 * is what makes the claim "this barcode scans" checkable rather than aspirational.
 *
 * References: ISO/IEC 15417 (Code 128). The symbol patterns below are the standard table.
 */

/** Symbol patterns, digit-per-module-width, for symbol values 0–106. */
const PATTERNS: readonly string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const START_A = 103;
const START_B = 104;
const START_C = 105;
const STOP = 106;
const SHIFT = 98;
const CODE_A = 101;
const CODE_B = 100;
const CODE_C = 99;

export interface Code128Symbol {
  value: number;
  /** Bar/space widths in modules. */
  widths: number[];
}

export interface Code128Code {
  value: string;
  /** `B`, `C` or `mixed` — which code set(s) the encoder chose. */
  codeSet: 'B' | 'C' | 'mixed';
  symbols: Code128Symbol[];
  /** `1` = bar, `0` = space, one character per module, quiet zones excluded. */
  modules: string;
  /** Number of modules the symbol occupies, excluding quiet zones. */
  moduleCount: number;
  checkSymbol: number;
}

export interface Code128Failure {
  ok: false;
  message: string;
}

/**
 * Code 128 encodes the 128 ASCII characters (Code B) or pairs of digits (Code C).
 * Anything outside that — including accented Latin, Cyrillic and emoji — cannot be encoded, and the
 * caller is told so instead of being handed a silently mangled payload.
 */
export function code128Supported(value: string): { ok: true } | Code128Failure {
  if (value.length === 0) return { ok: false, message: 'There is nothing to encode.' };
  if (value.length > 48) {
    return { ok: false, message: 'Code 128 payloads longer than 48 characters produce a symbol too dense to scan reliably on a card.' };
  }
  const bad = [...value].find((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) > 126);
  if (bad !== undefined) {
    return {
      ok: false,
      message: `Code 128 (set B) cannot encode “${bad}”. Use digits, letters and keyboard punctuation for the barcode value, or turn the barcode off.`,
    };
  }
  return { ok: true };
}

function digitsOnly(value: string): boolean {
  return /^[0-9]+$/.test(value);
}

/** Symbol widths for a symbol value. */
export function symbolWidths(value: number): number[] {
  const pattern = PATTERNS[value];
  if (pattern === undefined) throw new Error(`Code 128 symbol ${value} is out of range.`);
  return pattern.split('').map((digit) => Number(digit));
}

/**
 * The modulo-103 check symbol.
 *
 * The start symbol counts with weight 1, each data symbol with its 1-based position. A single
 * mistyped digit changes the check symbol, which is why the printed caption and the bars must agree.
 */
export function checkSymbol(values: number[]): number {
  let sum = values[0] ?? 0;
  for (let index = 1; index < values.length; index += 1) sum += (values[index] ?? 0) * index;
  return sum % 103;
}

/**
 * Encode `value`.
 *
 * Code C is selected when the payload is a long run of digits (six or more, and even, or an
 * odd count handled by encoding the leading digit in Code B and switching) because it halves the
 * width of numeric employee identifiers — the case that decides whether an identifier fits beside a
 * photograph.
 */
export function encodeCode128Code(value: string): Code128Code | Code128Failure {
  const supported = code128Supported(value);
  if (!supported.ok) return supported;

  const values: number[] = [];
  let codeSet: 'B' | 'C' | 'mixed' = 'B';

  const useC = digitsOnly(value) && value.length >= 4 && value.length % 2 === 0;
  if (useC) {
    values.push(START_C);
    for (let index = 0; index < value.length; index += 2) values.push(Number(value.slice(index, index + 2)));
    codeSet = 'C';
  } else if (digitsOnly(value) && value.length >= 6 && value.length % 2 === 1) {
    // Odd digit count: encode the first digit in Code B, then switch to Code C for the rest.
    values.push(START_B, value.charCodeAt(0) - 32, CODE_C);
    for (let index = 1; index < value.length; index += 2) values.push(Number(value.slice(index, index + 2)));
    codeSet = 'mixed';
  } else {
    values.push(START_B);
    for (const char of value) {
      const code = char.charCodeAt(0);
      if (code < 32 || code > 126) return { ok: false, message: `Code 128 cannot encode “${char}”.` };
      values.push(code - 32);
    }
  }

  const check = checkSymbol(values);
  const sequence = [...values, check, STOP];
  const symbols = sequence.map((symbolValue) => ({ value: symbolValue, widths: symbolWidths(symbolValue) }));

  let modules = '';
  for (const symbol of symbols) {
    // Symbols alternate bar, space, bar, … and the stop symbol's trailing 2-module bar closes it.
    symbol.widths.forEach((width, widthIndex) => {
      modules += (widthIndex % 2 === 0 ? '1' : '0').repeat(width);
    });
  }

  return { value, codeSet, symbols, modules, moduleCount: modules.length, checkSymbol: check };
}

/** Convenience wrapper: the module string, or null when the payload cannot be encoded. */
export function encodeCode128(value: string): string | null {
  const encoded = encodeCode128Code(value);
  return 'ok' in encoded ? null : encoded.modules;
}

export interface Code128Decoded {
  value: string;
  codeSet: 'B' | 'C' | 'mixed';
  checkSymbol: number;
}

/**
 * Decode a module string produced by `encodeCode128Code` (or by any conforming encoder that emits
 * one character per module). Used by the test suite as the scanner, and by the workspace's
 * "verify this barcode" action.
 */
export function decodeCode128(modules: string): Code128Decoded | Code128Failure {
  const clean = modules.replace(/[^01]/g, '');
  if (clean.length < 20) return { ok: false, message: 'That is too short to be a Code 128 symbol.' };
  const widths: number[] = [];
  let index = 0;
  while (index < clean.length) {
    const char = clean[index];
    let run = 0;
    while (index < clean.length && clean[index] === char) {
      run += 1;
      index += 1;
    }
    widths.push(run);
  }
  return decodeCode128Widths(widths);
}

/**
 * Decode from alternating bar/space widths, in any unit.
 *
 * Separating this from the module-string wrapper is what lets a *scanned* symbol be decoded: a
 * scanner (or the raster reader in `raster.ts`) sees pixel widths, not modules, and the widths must
 * be normalised back to modules before the symbol table means anything.
 */
export function decodeCode128Widths(widths: number[]): Code128Decoded | Code128Failure {
  const cleaned = widths.filter((width) => width > 0);
  if (cleaned.length < 19) return { ok: false, message: 'That is too short to be a Code 128 symbol.' };
  widths = cleaned;

  // A symbol is six widths long, plus the stop symbol's seventh; anything else is not Code 128.
  if (widths.length % 6 !== 1) {
    return { ok: false, message: 'The barcode does not have a valid Code 128 symbol structure.' };
  }

  const symbolWidthsList: number[][] = [];
  let cursor = 0;
  while (cursor < widths.length) {
    const isStop = widths.length - cursor === 7;
    const take = isStop ? 7 : 6;
    const chunk = widths.slice(cursor, cursor + take);
    if (chunk.some((width) => width < 1 || width > 4)) {
      return { ok: false, message: 'A bar or space in this barcode is outside the Code 128 width range.' };
    }
    symbolWidthsList.push(chunk);
    cursor += take;
    if (isStop) break;
  }

  const reverse = new Map<string, number>();
  PATTERNS.forEach((pattern, value) => {
    if (!reverse.has(pattern)) reverse.set(pattern, value);
  });

  const values: number[] = [];
  for (const chunk of symbolWidthsList) {
    const symbolValue = reverse.get(chunk.join(''));
    if (symbolValue === undefined) return { ok: false, message: 'This barcode contains a bar pattern that is not a Code 128 symbol.' };
    values.push(symbolValue);
  }

  if (values[values.length - 1] !== STOP) return { ok: false, message: 'The barcode has no Code 128 stop symbol.' };

  const data = values.slice(0, -2);
  const check = values[values.length - 2];
  if (data.length === 0) return { ok: false, message: 'The barcode has no start symbol.' };
  const expected = checkSymbol(data);
  if (expected !== check) {
    return { ok: false, message: `The barcode check symbol is wrong (read ${check}, expected ${expected}); it is damaged or was not produced by a conforming encoder.` };
  }

  const start = data[0];
  let codeSet: 'B' | 'C' | 'mixed';
  let active: 'B' | 'C';
  let out = '';
  let switched = false;
  if (start === START_B) {
    codeSet = 'B';
    active = 'B';
  } else if (start === START_C) {
    codeSet = 'C';
    active = 'C';
  } else {
    // Code A (control characters) is intentionally not decoded: nothing this platform generates
    // uses it, and half-decoding it would produce a plausible-looking wrong string.
    return { ok: false, message: 'The barcode does not begin with a Code 128 start symbol this tool understands (set B or C).' };
  }

  for (let position = 1; position < data.length; position += 1) {
    const value = data[position] ?? 0;
    if (value === CODE_B) {
      active = 'B';
      switched = true;
      continue;
    }
    if (value === CODE_C) {
      active = 'C';
      switched = true;
      continue;
    }
    if (value === SHIFT || value === CODE_A) continue;
    if (active === 'B') out += String.fromCharCode(value + 32);
    else out += String(value).padStart(2, '0');
  }

  if (switched) codeSet = 'mixed';
  return { value: out, codeSet, checkSymbol: check };
}
