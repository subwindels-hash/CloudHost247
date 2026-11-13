/**
 * Barcode Scanner: the basic decoder. Reads barcodes out of pixels with ZXing in plain JavaScript
 * (`@zxing/library`).
 *
 * It runs in two places. The API runs it on the server on an uploaded PNG: it needs no native build
 * and no WebAssembly, and the server runs under cPanel without a toolchain. The scanner page runs it
 * in a browser that will not run WebAssembly; everywhere else the page uses the full decoder
 * (zxing-cpp, see `frontend/src/lib/scan-cpp.ts`), which reads more.
 *
 * This decoder reads the types in BASIC_SCAN_FORMATS and no others. UPC-E, the limited and expanded
 * GS1 DataBar forms, Micro QR, rMQR, MicroPDF417, Telepen and MaxiCode need the full decoder; the
 * postal codes are read by neither.
 *
 * A barcode both decoders read is reported in the same words by both, which takes corrections to
 * what the library returns (`reported`, below). Each one also makes this decoder say what a
 * hardware scanner would send. Text beyond ASCII takes more: the library turns bytes into text one
 * way under Node and another in a browser, and wrongly in both (see "Bytes to text").
 *
 * No imports from Node, so the browser bundle can use this module as it is. The list of types and
 * the text helpers live in `formats.ts`, which a page can load without loading a decoder.
 */

import {
  BarcodeFormat,
  BinaryBitmap,
  CharacterSetECI,
  DataMatrixDecodedBitStreamParser,
  DecodeHintType,
  GlobalHistogramBinarizer,
  HybridBinarizer,
  InvertedLuminanceSource,
  MultiFormatReader,
  PDF417DecodedBitStreamParser,
  QRCodeDecodedBitStreamParser,
  RGBLuminanceSource,
  StringUtils,
  ZXingStringEncoding,
  type LuminanceSource,
  type Result,
} from '@zxing/library';
import { BASIC_SCAN_FORMATS, judged, judgedSet, latin1, leniently, scanHit, strictly, type ScanHit, type ScanPixels } from './formats';

export { BASIC_SCAN_FORMATS, SCAN_FORMATS, kindOf, scanHit, telepenNumber, visibleText, type ScanFormat, type ScanHit, type ScanKind, type ScanPixels } from './formats';

const ZXING_FORMAT: Record<string, BarcodeFormat> = {
  qr_code: BarcodeFormat.QR_CODE,
  data_matrix: BarcodeFormat.DATA_MATRIX,
  aztec: BarcodeFormat.AZTEC,
  pdf_417: BarcodeFormat.PDF_417,
  code_128: BarcodeFormat.CODE_128,
  code_39: BarcodeFormat.CODE_39,
  code_93: BarcodeFormat.CODE_93,
  itf: BarcodeFormat.ITF,
  codabar: BarcodeFormat.CODABAR,
  ean_13: BarcodeFormat.EAN_13,
  ean_8: BarcodeFormat.EAN_8,
  upc_a: BarcodeFormat.UPC_A,
  rss_14: BarcodeFormat.RSS_14,
};

const ID_BY_ZXING = new Map<BarcodeFormat, string>(BASIC_SCAN_FORMATS.map((format) => [ZXING_FORMAT[format.id] as BarcodeFormat, format.id]));

/** The check digit GS1 puts after these digits. */
function gs1CheckDigit(digits: string): string {
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) sum += Number(digits[digits.length - 1 - index]) * (index % 2 === 0 ? 3 : 1);
  return String((10 - (sum % 10)) % 10);
}

/** Code 128's FNC1 character, and Data Matrix's codewords for the same thing and for "a character set follows". */
const CODE_128_FNC1 = 102;
const DATA_MATRIX_FNC1 = 232;
const DATA_MATRIX_ECI = 241;
const GS = '\u001d';

/* ------------------------------------------------------------------ */
/* Bytes to text                                                       */
/* ------------------------------------------------------------------ */

/*
 * A two-dimensional barcode holds bytes. What characters they are is either stated in the symbol
 * (an ECI: "what follows is UTF-8") or, far more often, not stated at all, and the reader has to
 * judge. The library gets this wrong in ways that differ by where it runs:
 *
 *  - Under Node it turns "ISO-8859-1" bytes into text with decodeURIComponent, which reads them as
 *    UTF-8 and throws on anything else. So a Data Matrix of UTF-8 text reads, and a QR Code of
 *    Latin-1 text ("Café") is not found at all.
 *  - In a browser it uses the browser's own converter, which does what was asked. So the Latin-1
 *    QR Code reads, and the UTF-8 Data Matrix comes out with two wrong characters for every
 *    accented letter (the two bytes of the "é" in "Café", each shown as a character of its own).
 *  - In both, a character set stated in a Data Matrix or a PDF417 is not applied, and in a Data
 *    Matrix its number is read as a character of the data.
 *
 * So the library is not left to convert anything. Whenever it asks for bytes to be converted, the
 * bytes are set aside and it is handed a one-character token in their place
 * (`ZXingStringEncoding.customDecoder`). Once it has finished, `reported` puts the bytes back as
 * text: by the character set the symbol states where it states one, and otherwise judged once, over
 * all the unstated bytes together (`judged`, in formats.ts): UTF-8 if they are valid UTF-8, Shift
 * JIS if they look like it, otherwise Latin-1.
 *
 * That takes hooks in the library, all installed in this section. They are held in place by
 * tests/unit/barcode-scanner.test.ts ("text beyond ASCII"), which reads the same symbols with both
 * decoders; the library's version is pinned in package.json. Decoding is synchronous, so the record
 * the hooks keep belongs to one attempt at a time.
 */

/** The names the library uses for character sets, as the labels a TextDecoder knows. */
const CHARSET_LABEL: Record<string, string> = { SJIS: 'shift_jis', UNICODEBIGUNMARKED: 'utf-16be', EUCKR: 'euc-kr', EUCJP: 'euc-jp', GB2312: 'gb18030', GB18030: 'gb18030', BIG5: 'big5' };

const plainName = (name: string): string => name.toUpperCase().replace(/[^A-Z0-9]/g, '');
const isLatin1 = (name: string): boolean => ['ISO88591', 'ASCII', 'USASCII'].includes(plainName(name));

/** Bytes in a character set the barcode states. Throws for a set this runtime cannot convert, so the barcode is not read rather than misread. */
function stated(bytes: Uint8Array, name: string): string {
  if (isLatin1(name)) return latin1(bytes);
  const plain = plainName(name);
  const label = CHARSET_LABEL[plain] ?? (/^CP125\d$/.test(plain) ? `windows-${plain.slice(2)}` : /^ISO8859\d+$/.test(plain) ? `iso-8859-${plain.slice(7)}` : plain === 'UTF8' ? 'utf-8' : name);
  return leniently(label, bytes);
}

/** A run of bytes the library asked to have converted, and the character set it named for them. */
type Piece = { bytes: Uint8Array; name: string };

/** What the hooks noted while the library read one symbol. */
type Notes = {
  /** The runs of bytes set aside, in the order the library asked for them. */
  pieces: Piece[];
  /** The number of the character set the symbol stated last, noted when the library looks it up. */
  eci: number | null;
  /** Data Matrix: the stretches of codewords the library read as plain (ASCII-mode) codewords, as [from, to). */
  plainRuns: Array<[number, number]>;
  /** PDF417: how many codewords state a character set, whether the data opens with one, and how many state some other interpretation. */
  setMarks: number;
  opensWithSet: boolean;
  otherMarks: number;
};

const blank = (): Notes => ({ pieces: [], eci: null, plainRuns: [], setMarks: 0, opensWithSet: false, otherMarks: 0 });
let notes: Notes = blank();

/**
 * A token is a private-use character, numbered from here. Nothing else the library puts into a text
 * is above U+00FF until the bytes are put back, so a token cannot be mistaken for data.
 */
const TOKEN_BASE = 0xe000;
const TOKEN_COUNT = 0x1900;

/**
 * The name the library is given for bytes of a QR Code that state no character set. On its own it
 * would guess run by run, by a test that takes some runs for UTF-8 or Shift JIS that are not.
 */
const UNSTATED = 'x-unstated';
StringUtils.guessEncoding = (): string => UNSTATED;

ZXingStringEncoding.customDecoder = (bytes: Uint8Array, name: string): string => {
  if (notes.pieces.length >= TOKEN_COUNT) throw new Error('More runs of bytes than one barcode can hold.');
  notes.pieces.push({ bytes: bytes.slice(), name });
  return String.fromCharCode(TOKEN_BASE + notes.pieces.length - 1);
};

/** The library's text with each run of bytes put back, as text. */
function withBytes(text: string, convert: (piece: Piece) => string): string {
  let whole = '';
  for (let index = 0; index < text.length; index += 1) {
    const piece = notes.pieces[text.charCodeAt(index) - TOKEN_BASE];
    whole += piece ? convert(piece) : text[index];
  }
  return whole;
}

const asLatin1 = (piece: Piece): string => latin1(piece.bytes);

/** ECI 899 says "these are bytes, not text". They are reported as the full decoder reports them: each byte as one character. */
const ECI_BYTES = 899;
const lookUpEci = CharacterSetECI.getCharacterSetECIByValue.bind(CharacterSetECI);
CharacterSetECI.getCharacterSetECIByValue = (value: number): CharacterSetECI => {
  notes.eci = value;
  return value === ECI_BYTES ? CharacterSetECI.ISO8859_1 : lookUpEci(value);
};

/** The character set an ECI number names, or null for a number that names none this decoder knows. */
function charsetOfEci(eci: number): string | null {
  try {
    return (eci === ECI_BYTES ? CharacterSetECI.ISO8859_1 : lookUpEci(eci)).getName();
  } catch {
    return null;
  }
}

/** A parser of the library's, made to start each symbol with clean notes. */
type Parser = { decode: (...parameters: never[]) => unknown };
function startsClean(parser: Parser, first: (...parameters: unknown[]) => void = () => undefined): void {
  const decode = parser.decode as (this: unknown, ...parameters: unknown[]) => unknown;
  (parser as { decode: unknown }).decode = function (this: unknown, ...parameters: unknown[]): unknown {
    notes = blank();
    first(...parameters);
    return decode.apply(this, parameters);
  };
}

startsClean(QRCodeDecodedBitStreamParser);

/** PDF417's codewords that say "a character set follows", and the two that state other interpretations. No data codeword is as high as these. */
const PDF417_SET_MARK = 927;
const PDF417_OTHER_MARKS = [925, 926];
startsClean(PDF417DecodedBitStreamParser, (codewords) => {
  const words = codewords as ArrayLike<number>;
  notes.opensWithSet = words[1] === PDF417_SET_MARK;
  for (let index = 1; index < (words[0] as number) && index < words.length; index += 1) {
    if (words[index] === PDF417_SET_MARK) notes.setMarks += 1;
    else if (PDF417_OTHER_MARKS.includes(words[index] as number)) notes.otherMarks += 1;
  }
});

startsClean(DataMatrixDecodedBitStreamParser);
{
  // Only a plain codeword can state a character set; the same number inside packed text or a run of
  // bytes is data. The library knows which is which as it reads, so its reading is watched.
  const parser = DataMatrixDecodedBitStreamParser as unknown as { decodeAsciiSegment(this: unknown, bits: { getByteOffset(): number }, ...rest: unknown[]): unknown };
  const readPlain = parser.decodeAsciiSegment;
  parser.decodeAsciiSegment = function (this: unknown, bits, ...rest): unknown {
    const from = bits.getByteOffset();
    try {
      return readPlain.call(this, bits, ...rest);
    } finally {
      notes.plainRuns.push([from, bits.getByteOffset()]);
    }
  };
}

/** Text the library built with each byte as one character, as those bytes. Null if it holds anything else. */
function bytesOf(text: string): Uint8Array | null {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code > 0xff) return null;
    bytes[index] = code;
  }
  return bytes;
}

/* ------------------------------------------------------------------ */
/* Aztec Code: its data, read from the corrected bits                  */
/* ------------------------------------------------------------------ */

const P_S = -1; // Punctuation shift, and so on: negative numbers are the control codes.
const L_L = -2;
const M_L = -3;
const D_L = -4;
const B_S = -5;
const U_S = -6;
const U_L = -7;
const P_L = -8;
const FLG = -9;

const codes = (text: string): number[][] => Array.from(text, (character) => [character.charCodeAt(0)]);

/** What each code means in each of Aztec's five tables: the bytes it stands for, or a control code. */
const AZTEC_UPPER: Array<number | number[]> = [P_S, [32], ...codes('ABCDEFGHIJKLMNOPQRSTUVWXYZ'), L_L, M_L, D_L, B_S];
const AZTEC_LOWER: Array<number | number[]> = [P_S, [32], ...codes('abcdefghijklmnopqrstuvwxyz'), U_S, M_L, D_L, B_S];
const AZTEC_MIXED: Array<number | number[]> = [P_S, [32], ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 27, 28, 29, 30, 31].map((code) => [code]), ...codes('@\\^_`|~'), [127], L_L, U_L, P_L, B_S];
const AZTEC_PUNCT: Array<number | number[]> = [FLG, [13], [13, 10], [46, 32], [44, 32], [58, 32], ...codes('!"#$%&\'()*+,-./:;<=>?[]{}'), U_L];
const AZTEC_DIGIT: Array<number | number[]> = [P_S, [32], ...codes('0123456789,.'), U_L, U_S];

/** Where a control code leads, and whether it stays there (a latch) or returns after one code (a shift). */
const AZTEC_MOVE: Record<number, { table: Array<number | number[]> | 'bytes'; latch: boolean }> = {
  [P_S]: { table: AZTEC_PUNCT, latch: false },
  [U_S]: { table: AZTEC_UPPER, latch: false },
  [B_S]: { table: 'bytes', latch: false },
  [L_L]: { table: AZTEC_LOWER, latch: true },
  [M_L]: { table: AZTEC_MIXED, latch: true },
  [D_L]: { table: AZTEC_DIGIT, latch: true },
  [U_L]: { table: AZTEC_UPPER, latch: true },
  [P_L]: { table: AZTEC_PUNCT, latch: true },
};

/**
 * The content of an Aztec Code, from its data bits after error correction.
 *
 * The library finds the symbol and corrects it, and that part is sound. Its reading of the bits is
 * not: it knows nothing of the code that introduces an FNC1 or a character set, and reads the bits
 * after it as data, so a GS1 Aztec Code comes out as a confident string of wrong characters. The
 * bits are read again here, by ISO/IEC 24778.
 *
 * An FNC1 that opens the symbol, or follows one letter or two digits, is a mark (GS1, or an
 * industry format) and not data; anywhere else it separates two fields and is the GS character.
 * Returns null for bits that are not a valid message.
 */
function aztecText(raw: Uint8Array, bitCount: number): string | null {
  let position = 0;
  const left = (): number => bitCount - position;
  const read = (count: number): number => {
    let value = 0;
    for (let bit = 0; bit < count; bit += 1, position += 1) value = (value << 1) | (((raw[position >> 3] as number) >> (7 - (position & 7))) & 1);
    return value;
  };

  let text = '';
  let bytes: number[] = [];
  let charset: string | null = null;
  // How much data has come so far, and its first two bytes: an FNC1 is judged by what precedes it.
  let dataBytes = 0;
  const opening: number[] = [];
  const data = (...values: number[]): void => {
    for (const value of values) {
      bytes.push(value);
      if (opening.length < 2) opening.push(value);
      dataBytes += 1;
    }
  };
  const flush = (): void => {
    if (bytes.length === 0) return;
    text += charset === null ? latin1(bytes) : stated(Uint8Array.from(bytes), charset);
    bytes = [];
  };
  const isLetter = (code: number | undefined): boolean => code !== undefined && ((code >= 65 && code <= 90) || (code >= 97 && code <= 122));
  const isDigit = (code: number | undefined): boolean => code !== undefined && code >= 48 && code <= 57;

  let latched: Array<number | number[]> | 'bytes' = AZTEC_UPPER;
  let current: Array<number | number[]> | 'bytes' = AZTEC_UPPER;
  while (position < bitCount) {
    if (current === 'bytes') {
      if (left() < 5) break;
      let length = read(5);
      if (length === 0) {
        if (left() < 11) break;
        length = read(11) + 31;
      }
      for (let count = 0; count < length; count += 1) {
        if (left() < 8) {
          // The run is cut short by the end of the symbol: what is left is padding, not a character.
          position = bitCount;
          break;
        }
        data(read(8));
      }
      current = latched;
      continue;
    }
    const size = current === AZTEC_DIGIT ? 4 : 5;
    if (left() < size) break;
    const entry = current[read(size)] as number | number[];
    if (typeof entry !== 'number') {
      data(...entry);
      current = latched;
    } else if (entry === FLG) {
      if (left() < 3) break;
      const digits = read(3);
      if (digits === 7) return null;
      if (digits === 0) {
        const mark = dataBytes === 0 || (dataBytes === 1 && isLetter(opening[0])) || (dataBytes === 2 && isDigit(opening[0]) && isDigit(opening[1]));
        if (!mark) data(29);
      } else {
        if (left() < 4 * digits) break;
        let eci = 0;
        for (let digit = 0; digit < digits; digit += 1) {
          const code = read(4);
          if (code < 2 || code > 11) return null;
          eci = eci * 10 + (code - 2);
        }
        const named = charsetOfEci(eci);
        if (named === null) return null;
        flush();
        charset = named;
      }
      current = latched;
    } else {
      // A shift taken from a shift returns to where the first one was taken, not to the last latch.
      const move = AZTEC_MOVE[entry] as { table: Array<number | number[]> | 'bytes'; latch: boolean };
      latched = move.latch ? move.table : current;
      current = move.table;
    }
  }
  // No character set was stated anywhere: the bytes are judged as a whole.
  if (charset === null && text === '') return judged(Uint8Array.from(bytes));
  flush();
  return text;
}

/**
 * What a barcode is reported to hold: the library's text, corrected in these cases.
 *
 *  - GS1 DataBar. The symbol holds a GTIN, and a scanner sends it as a GS1 element string: "01" and
 *    the fourteen digits. The library returns the digits alone. It also knows nothing of the flag
 *    that says a two-dimensional part is printed above the bars (a GS1 composite): the flag is
 *    stored as ten trillion added to the number, and the library returns that as a fifteen-digit
 *    number beginning with 1 and ending in a check digit worked out from the wrong digits. Here the
 *    flag is taken off and the check digit worked out again, so the GTIN is the one printed.
 *  - GS1-128. The FNC1 that opens the symbol marks it as GS1 and is not data; an FNC1 further in
 *    separates one field from the next and is sent as the GS character. The library is asked to
 *    keep them (it drops them otherwise, and "10AB123" followed by "21SER99" cannot then be told
 *    from one long batch number), and the "]C1" it writes for the opening one is taken off again.
 *  - GS1 DataMatrix. The opening FNC1 is returned as a GS character in front of the data. It is
 *    taken off: it is the same mark, not data.
 *  - Data Matrix with a stated character set. The library skips the codeword that says "a
 *    character set follows" and then reads the number of the set as a character of the data. Where
 *    one statement opens the data, which is where encoders put it, the stray character is taken off
 *    and the data converted by the set named. A symbol that states a set anywhere else is not read:
 *    the library's text for it cannot be put right from here.
 *  - PDF417 with a stated character set. The library notes the set and converts by Latin-1 anyway,
 *    and misses the statement altogether where it comes in the middle of a run of text. Where one
 *    statement opens the data, the data is converted by the set named. Any other is not read.
 *  - Aztec Code. The data is read again from the corrected bits: see `aztecText`.
 *  - QR Code, Data Matrix and PDF417 holding bytes of no stated character set. The bytes are judged
 *    together: see "Bytes to text".
 *
 * Where a mark is taken off, the raw codewords are looked at and not the text, so a barcode whose
 * data really does begin with "]C1" or with a GS character keeps it.
 */
function reported(result: Result): ScanHit | null {
  const id = ID_BY_ZXING.get(result.getBarcodeFormat());
  const read: unknown = result.getText();
  if (!id || typeof read !== 'string') return null;
  let text: string = read;
  const raw = result.getRawBytes();
  if (id === 'rss_14') {
    if (/^\d{14}$/.test(text)) text = `01${text}`;
    else if (/^1\d{14}$/.test(text)) text = `01${text.slice(1, 14)}${gs1CheckDigit(text.slice(1, 14))}`;
    else return null;
  } else if (id === 'code_128') {
    if (raw && raw[1] === CODE_128_FNC1 && text.startsWith(']C1')) text = text.slice(3);
  } else if (id === 'aztec') {
    const content = raw ? aztecText(raw, result.getNumBits()) : null;
    if (content === null) return null;
    text = content;
  } else if (id === 'data_matrix') {
    if (!raw) return null;
    // The library names Latin-1 for every run of bytes. What they are is settled below.
    text = withBytes(text, asLatin1);
    // The mark is the FNC1 in the first position. One that follows a character set is a separator.
    const gs1 = raw[0] === DATA_MATRIX_FNC1;
    if (gs1 && text.startsWith(GS)) text = text.slice(1);
    const first = gs1 ? 1 : 0;
    const bytes = bytesOf(text);
    if (bytes === null) return null;
    const setMarks: number[] = [];
    for (const [from, to] of notes.plainRuns) {
      for (let index = from; index < to; index += 1) if (raw[index] === DATA_MATRIX_ECI) setMarks.push(index);
    }
    if (setMarks.length === 0) {
      text = judged(bytes);
    } else {
      // One codeword names sets 0 to 126, which covers every character set there is. The longer forms are not read.
      const eci = (raw[first + 1] as number) - 1;
      const charset = setMarks.length === 1 && setMarks[0] === first && eci >= 0 && eci <= 126 ? charsetOfEci(eci) : null;
      if (charset === null || bytes[0] !== eci) return null;
      text = stated(bytes.subarray(1), charset);
    }
  } else if (id === 'pdf_417') {
    text = withBytes(text, asLatin1);
    const bytes = bytesOf(text);
    // An interpretation of a kind the library skips leaves a text that cannot be trusted.
    if (bytes === null || notes.otherMarks > 0) return null;
    if (notes.setMarks === 0) {
      text = judged(bytes);
    } else {
      // One statement, opening the data, is one the library acted on and covers all of the text. A
      // statement anywhere else it reads as data.
      const charset = notes.setMarks === 1 && notes.opensWithSet && notes.eci !== null ? charsetOfEci(notes.eci) : null;
      if (charset === null) return null;
      text = stated(bytes, charset);
    }
  } else if (id === 'qr_code') {
    // Bytes under a stated set are converted by it, and Kanji characters by theirs. The rest state
    // nothing. With a set stated anywhere in the symbol they are Latin-1, the default the statement
    // departs from; with none they are judged, all of them together.
    const unstated = notes.pieces.filter((piece) => piece.name === UNSTATED);
    const together = new Uint8Array(unstated.reduce((length, piece) => length + piece.bytes.length, 0));
    let offset = 0;
    for (const piece of unstated) {
      together.set(piece.bytes, offset);
      offset += piece.bytes.length;
    }
    const set = notes.eci === null ? judgedSet(together) : null;
    text = withBytes(text, (piece) => {
      if (piece.name !== UNSTATED) return stated(piece.bytes, piece.name);
      return (set === null ? null : strictly(set, piece.bytes)) ?? latin1(piece.bytes);
    });
  }
  return scanHit(id, text);
}

/**
 * How hard to look.
 *
 *  - `quick` is for a camera: one pass, a few scan lines, so a frame that holds no barcode costs
 *    little and the next frame gets its turn. A barcode held steady is in dozens of frames.
 *  - `thorough` is for a still image, where there is one chance: the image as it is and on its side
 *    (a linear barcode photographed upright), then every scan line with both binarisers on a
 *    reduced copy, then light-on-dark. See `scanPasses`.
 */
export type ScanMode = 'quick' | 'thorough';

const HINT_FORMATS = BASIC_SCAN_FORMATS.map((format) => ZXING_FORMAT[format.id] as BarcodeFormat);

function hints(tryHarder: boolean): Map<DecodeHintType, unknown> {
  const map = new Map<DecodeHintType, unknown>();
  map.set(DecodeHintType.POSSIBLE_FORMATS, HINT_FORMATS);
  // Keeps the FNC1 characters of a Code 128 symbol: see `reported`.
  map.set(DecodeHintType.ASSUME_GS1, true);
  if (tryHarder) map.set(DecodeHintType.TRY_HARDER, true);
  return map;
}

const QUICK_HINTS = hints(false);
const THOROUGH_HINTS = hints(true);

/** Brightness of each pixel, 0 to 255, with transparency treated as white paper. */
export function luminanceOf(pixels: ScanPixels): Uint8ClampedArray {
  const { data, width, height } = pixels;
  const out = new Uint8ClampedArray(width * height);
  for (let index = 0, offset = 0; index < out.length; index += 1, offset += 4) {
    const alpha = (data[offset + 3] as number) / 255;
    const red = (data[offset] as number) * alpha + 255 * (1 - alpha);
    const green = (data[offset + 1] as number) * alpha + 255 * (1 - alpha);
    const blue = (data[offset + 2] as number) * alpha + 255 * (1 - alpha);
    out[index] = (red * 299 + green * 587 + blue * 114) / 1000;
  }
  return out;
}

interface Grey {
  values: Uint8ClampedArray;
  width: number;
  height: number;
}

/** The image turned a quarter turn clockwise. */
function turned(grey: Grey): Grey {
  const { values, width, height } = grey;
  const out = new Uint8ClampedArray(values.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) out[x * height + (height - 1 - y)] = values[y * width + x] as number;
  }
  return { values: out, width: height, height: width };
}

/** The image at 1/factor of its size, each new pixel the average of the block it replaces. */
function reduced(grey: Grey, factor: number): Grey {
  const width = Math.floor(grey.width / factor);
  const height = Math.floor(grey.height / factor);
  const out = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let dy = 0; dy < factor; dy += 1) {
        const row = (y * factor + dy) * grey.width + x * factor;
        for (let dx = 0; dx < factor; dx += 1) sum += grey.values[row + dx] as number;
      }
      out[y * width + x] = sum / (factor * factor);
    }
  }
  return { values: out, width, height };
}

function attempt(source: LuminanceSource, thorough: boolean): ScanHit | null {
  const binarisers = thorough ? [HybridBinarizer, GlobalHistogramBinarizer] : [HybridBinarizer];
  for (const Binariser of binarisers) {
    try {
      notes = blank();
      // A new reader each time: the library's reader keeps state between calls.
      const hit = reported(new MultiFormatReader().decode(new BinaryBitmap(new Binariser(source)), thorough ? THOROUGH_HINTS : QUICK_HINTS));
      if (hit) return hit;
    } catch {
      // Not found, found and failed its checksum, or in a character set this runtime cannot
      // convert: in each case there is nothing to report.
    }
  }
  return null;
}

/**
 * The sizes an image is searched at, by its longest side in pixels.
 *
 * Searching costs time in proportion to the pixels, and the exhaustive search costs about ten times
 * the quick one, so the work is bounded by size and not by hope: a twelve-megapixel photograph with
 * no barcode in it would otherwise keep a server worker, or a phone's only thread, busy for minutes.
 * The quick search runs on up to QUICK_SIDE pixels, which keeps fine bars intact; the exhaustive one
 * on up to THOROUGH_SIDE, where averaging has also removed the sensor noise that breaks bars up.
 */
const QUICK_SIDE = 2000;
const THOROUGH_SIDE = 1000;
/** Once this much time has gone, no further pass is started. A pass already running is finished. */
export const SCAN_BUDGET_MS = 4000;

function fitted(grey: Grey, side: number): Grey {
  const longest = Math.max(grey.width, grey.height);
  return longest > side ? reduced(grey, Math.ceil(longest / side)) : grey;
}

const sourceOf = (grey: Grey): RGBLuminanceSource => new RGBLuminanceSource(grey.values, grey.width, grey.height);

/**
 * The passes over a still image, cheapest and likeliest first. Each is a function so that a page
 * can run one, let the screen update, and run the next; `scanPixels` runs them in a row.
 */
export function scanPasses(pixels: ScanPixels): Array<() => ScanHit | null> {
  if (!(pixels.width > 0) || !(pixels.height > 0) || pixels.data.length < pixels.width * pixels.height * 4) return [];
  const full: Grey = { values: luminanceOf(pixels), width: pixels.width, height: pixels.height };
  const large = fitted(full, QUICK_SIDE);
  const small = fitted(full, THOROUGH_SIDE);
  // Turning an image is itself a pass over its pixels, so each turned copy is made once, when first needed.
  let largeTurned: Grey | null = null;
  let smallTurned: Grey | null = null;
  const turnedLarge = (): Grey => (largeTurned ??= turned(large));
  const turnedSmall = (): Grey => (smallTurned ??= small === large ? turnedLarge() : turned(small));

  const passes: Array<() => ScanHit | null> = [
    // A clean image of a barcode is read here, at its own resolution.
    () => attempt(sourceOf(large), false),
    // The same on its side: a linear barcode photographed upright.
    () => attempt(sourceOf(turnedLarge()), false),
  ];
  if (small !== large) passes.push(() => attempt(sourceOf(small), false), () => attempt(sourceOf(turnedSmall()), false));
  passes.push(
    // Every scan line and both ways of telling dark from light.
    () => attempt(sourceOf(small), true),
    () => attempt(sourceOf(turnedSmall()), true),
    // Light bars on a dark background: rare, so last.
    () => attempt(new InvertedLuminanceSource(sourceOf(small)), false),
    () => attempt(new InvertedLuminanceSource(sourceOf(small)), true)
  );
  return passes;
}

/**
 * Read one barcode from an image, or return null.
 *
 * `quick` is one pass for a camera frame. `quarterTurn` applies to it alone: the caller alternates
 * it between frames, so a linear barcode held upright is found on the next frame without doubling
 * the cost of every frame. `thorough` runs the passes for a still image until one succeeds or the
 * time budget is spent.
 */
export function scanPixels(pixels: ScanPixels, mode: ScanMode = 'thorough', quarterTurn = false, budgetMs = SCAN_BUDGET_MS): ScanHit | null {
  if (mode === 'quick') {
    if (!(pixels.width > 0) || !(pixels.height > 0) || pixels.data.length < pixels.width * pixels.height * 4) return null;
    const full: Grey = { values: luminanceOf(pixels), width: pixels.width, height: pixels.height };
    const grey = fitted(full, QUICK_SIDE);
    return attempt(sourceOf(quarterTurn ? turned(grey) : grey), false);
  }
  const started = Date.now();
  for (const pass of scanPasses(pixels)) {
    const hit = pass();
    if (hit) return hit;
    if (Date.now() - started > budgetMs) return null;
  }
  return null;
}
