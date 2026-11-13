/**
 * Barcode Scanner: the full decoder, zxing-cpp compiled to WebAssembly.
 *
 * This module holds everything about that decoder except the decoder itself: what it is asked to
 * look for, how it is asked, and how what it finds is put in the scanner's words. It takes the
 * library's reading function as an argument and imports nothing but types, so the same code runs in
 * the page (`scan-engine.ts` hands it the function) and in a test under Node.
 *
 * The decoder is asked for exactly the types in SCAN_FORMATS, by name. It can read more (DX film
 * edge codes, Aztec runes, Code 32, PZN), and it would read some symbols differently if it were
 * left to decide: see CPP_FORMATS.
 */
import type { ReaderOptions, ReadResult } from 'zxing-wasm/reader';
import { judged, scanHit, type ScanHit, type ScanPixels } from '../../../src/tools/scanner/formats';

/** The library's reading function: pixels and options in, the barcodes it found out. */
export type CppRead = (pixels: ScanPixels, options: ReaderOptions) => Promise<CppResult[]>;

/** One barcode as the library reports it: the fields used here. The last two are looked at only for the two-dimensional types. */
export type CppResult = Pick<ReadResult, 'format' | 'symbology' | 'text' | 'isValid' | 'extra'> & Partial<Pick<ReadResult, 'bytes' | 'hasECI'>>;

type CppFormat = NonNullable<ReaderOptions['formats']>[number];

/**
 * What the decoder is asked to look for, in its own names.
 *
 *  - `QRCode`, `PDF417` and `DataBar` are families: QR Code with Micro QR and rMQR, PDF417 with its
 *    compact and micro forms, GS1 DataBar with its stacked, limited and expanded forms.
 *  - `Code39Std` and not `Code39`. Asked for the family, the decoder also tries Code 39's full ASCII
 *    reading, in which "+A" means "a": a HIBC code, which opens with "+" and a letter, comes back
 *    with its first two characters replaced by one. It would also turn a six-character Code 39 that
 *    happens to pass a check into a Code 32 number. A scanner is told which reading a symbol uses;
 *    this one reports the characters as printed, as the basic decoder does.
 *  - `TelepenAlpha` and not `Telepen`, so the reading is the text one whatever a later version of
 *    the library would guess. `kindOf` offers the numeric reading beside it.
 *  - `AztecCode` and not `Aztec`, which would add Aztec runes: a rune is a number from 0 to 255 in
 *    a mark small enough to be found in a picture of something else.
 *  - `EAN13` finds UPC-A too: a UPC-A symbol is an EAN-13 symbol whose first digit is 0.
 */
export const CPP_FORMATS: readonly CppFormat[] = ['QRCode', 'DataMatrix', 'AztecCode', 'PDF417', 'MaxiCode', 'Code128', 'Code39Std', 'Code93', 'ITF', 'Codabar', 'TelepenAlpha', 'EAN13', 'EAN8', 'UPCE', 'DataBar'];

/**
 * The types made of bars, which the decoder does not find printed light on dark even when asked to
 * try (it finds the square ones that way). A still picture is therefore searched a second time with
 * its light and dark exchanged, for these alone.
 */
export const CPP_BAR_FORMATS: readonly CppFormat[] = ['PDF417', 'Code128', 'Code39Std', 'Code93', 'ITF', 'Codabar', 'TelepenAlpha', 'EAN13', 'EAN8', 'UPCE', 'DataBar'];

const SHARED: ReaderOptions = {
  // Every scan line, the picture turned a quarter turn, and a reduced copy where the picture is large.
  tryHarder: true,
  tryRotate: true,
  tryDownscale: true,
  // One barcode per frame or picture, as the list expects.
  maxNumberOfSymbols: 1,
  // The content as it is, control characters included, and not a bracketed rendering of it.
  textMode: 'Plain',
  tryCode39ExtendedMode: false,
  // The two- or five-digit add-on beside a retail barcode is left out, so a barcode reads the same
  // whether or not the add-on was caught in the picture.
  eanAddOnSymbol: 'Ignore',
  // A barcode that fails its own check is not a result.
  returnErrors: false,
};

/** One look at a picture as it is, in every type; square types are also found light on dark. */
export const CPP_OPTIONS: ReaderOptions = { ...SHARED, formats: [...CPP_FORMATS], tryInvert: true };

/** The second look, at a copy with light and dark exchanged: see CPP_BAR_FORMATS. */
export const CPP_INVERTED_OPTIONS: ReaderOptions = { ...SHARED, formats: [...CPP_BAR_FORMATS], tryInvert: false };

/** The eight digits printed under a UPC-E symbol, which the library gives beside the number they stand for. */
function upcePrinted(extra: string): string | null {
  try {
    const printed = (JSON.parse(extra) as { UPCE?: unknown } | null)?.UPCE;
    return typeof printed === 'string' && /^\d{8}$/.test(printed) ? printed : null;
  } catch {
    return null;
  }
}

/**
 * The text of a two-dimensional barcode, from its bytes where the library's text has lost some.
 *
 * Bytes that state no character set are judged by the library, which then writes U+FFFD, the
 * replacement character, for every byte that does not fit its judgement. A barcode holding data
 * that is not text comes back as a few stray characters and a row of those marks, and the bytes are
 * gone. Where that has happened the bytes are judged here instead, by the rule the basic decoder
 * uses, which gives each byte as one character when they fit no character set it knows. Text the
 * library converted without loss is left as the library gave it.
 */
export function fromBytes(result: CppResult): string {
  if (result.hasECI !== false || !result.bytes || !result.text.includes('\ufffd')) return result.text;
  return judged(result.bytes);
}

/**
 * What the decoder found, in the scanner's words, or null for anything that is not on the scanner's
 * list. The type and the text are the ones the basic decoder gives for the same barcode.
 */
export function hitFromCpp(result: CppResult): ScanHit | null {
  if (!result.isValid || typeof result.text !== 'string') return null;
  const { format, text } = result;
  switch (result.symbology) {
    case 'QRCode':
      return scanHit(format === 'MicroQRCode' ? 'micro_qr_code' : format === 'RMQRCode' ? 'rmqr_code' : 'qr_code', fromBytes(result));
    case 'DataMatrix':
      return scanHit('data_matrix', fromBytes(result));
    case 'Aztec':
      return format === 'AztecRune' ? null : scanHit('aztec', fromBytes(result));
    case 'PDF417':
      return scanHit(format === 'MicroPDF417' ? 'micro_pdf_417' : 'pdf_417', fromBytes(result));
    case 'MaxiCode':
      return scanHit('maxicode', fromBytes(result));
    case 'Code128':
      return scanHit('code_128', text);
    case 'Code39':
      // The other members of the family are readings of the characters, not the characters.
      return format === 'Code39' || format === 'Code39Std' ? scanHit('code_39', text) : null;
    case 'Code93':
      return scanHit('code_93', text);
    case 'ITF':
      return scanHit('itf', text);
    case 'Codabar':
      return scanHit('codabar', text);
    case 'Telepen':
      return format === 'TelepenAlpha' ? scanHit('telepen', text) : null;
    case 'EANUPC':
      if (format === 'EAN8') return scanHit('ean_8', text);
      // The library gives the thirteen-digit number a UPC-E stands for. The scanner gives the eight
      // digits printed under the bars, which is what was typed to make the barcode.
      if (format === 'UPCE') return scanHit('upc_e', upcePrinted(result.extra) ?? text);
      // Thirteen digits beginning with 0 are a UPC-A, shown as its twelve.
      if (format === 'EAN13' || format === 'UPCA') return /^0\d{12}$/.test(text) ? scanHit('upc_a', text.slice(1)) : scanHit('ean_13', text);
      return null;
    case 'DataBar':
      return scanHit(format === 'DataBarLtd' ? 'rss_limited' : format === 'DataBarExp' || format === 'DataBarExpStk' ? 'rss_expanded' : 'rss_14', text);
    default:
      return null;
  }
}

const usable = (pixels: ScanPixels): boolean => pixels.width > 0 && pixels.height > 0 && pixels.data.length >= pixels.width * pixels.height * 4;

/**
 * The picture with nothing see-through in it. The library looks at colour alone, and the colour of
 * a transparent pixel is black: a barcode on a transparent background would be bars on black. The
 * picture is put on white paper, as the basic decoder does. A picture that is already opaque, which
 * is every camera frame, is returned as it is.
 */
export function onWhite(pixels: ScanPixels): ScanPixels {
  const { data } = pixels;
  const length = pixels.width * pixels.height * 4;
  let offset = 3;
  while (offset < length && data[offset] === 255) offset += 4;
  if (offset >= length) return pixels;
  const out = new Uint8ClampedArray(length);
  for (let index = 0; index < length; index += 4) {
    const alpha = (data[index + 3] as number) / 255;
    out[index] = (data[index] as number) * alpha + 255 * (1 - alpha);
    out[index + 1] = (data[index + 1] as number) * alpha + 255 * (1 - alpha);
    out[index + 2] = (data[index + 2] as number) * alpha + 255 * (1 - alpha);
    out[index + 3] = 255;
  }
  return { data: out, width: pixels.width, height: pixels.height };
}

/** An opaque picture with light and dark exchanged. */
export function exchanged(pixels: ScanPixels): ScanPixels {
  const { data } = pixels;
  const length = pixels.width * pixels.height * 4;
  const out = new Uint8ClampedArray(length);
  for (let index = 0; index < length; index += 4) {
    out[index] = 255 - (data[index] as number);
    out[index + 1] = 255 - (data[index + 1] as number);
    out[index + 2] = 255 - (data[index + 2] as number);
    out[index + 3] = 255;
  }
  return { data: out, width: pixels.width, height: pixels.height };
}

async function look(read: CppRead, pixels: ScanPixels, options: ReaderOptions): Promise<ScanHit | null> {
  for (const result of await read(pixels, options)) {
    const hit = hitFromCpp(result);
    if (hit) return hit;
  }
  return null;
}

/**
 * Read one barcode from a camera frame, or return null. One look: a barcode held in view is in the
 * next frame as well.
 */
export async function scanFrame(read: CppRead, pixels: ScanPixels): Promise<ScanHit | null> {
  return usable(pixels) ? look(read, onWhite(pixels), CPP_OPTIONS) : null;
}

/**
 * Read one barcode from a still picture, or return null. Two looks: the picture as it is, then with
 * light and dark exchanged for the types made of bars. `pause` is awaited between them, so a page
 * can let the screen update.
 *
 * The caller decides how large a picture is worth searching: the time taken grows with the number
 * of pixels (see the measurements in docs/tools/DESIGN-STUDIO-PLAN.md).
 */
export async function scanStill(read: CppRead, pixels: ScanPixels, pause: () => Promise<void> = async () => undefined): Promise<ScanHit | null> {
  if (!usable(pixels)) return null;
  const picture = onWhite(pixels);
  const hit = await look(read, picture, CPP_OPTIONS);
  if (hit) return hit;
  await pause();
  return look(read, exchanged(picture), CPP_INVERTED_OPTIONS);
}
