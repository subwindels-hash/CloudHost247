/**
 * Barcode Scanner: what it reads, and how what it read is described.
 *
 * Plain data and text handling with no imports at all. The scanner page shows the list of barcode
 * types and the scanned content from this module as soon as it loads, and fetches a decoder only
 * when someone starts to scan.
 *
 * There are two decoders, and they do not read the same list:
 *
 *  - the full one is zxing-cpp compiled to WebAssembly. The scanner page runs it in the visitor's
 *    browser, and it reads every type below;
 *  - the basic one is ZXing in plain JavaScript (`decode.ts`). The API runs it on the server, and
 *    the scanner page falls back to it in a browser that will not run WebAssembly. It reads the
 *    types that are not marked `fullOnly`.
 *
 * Both report a barcode they both read in the same words: the same type and the same text.
 */

export interface ScanFormat {
  id: string;
  name: string;
  /** Other names the same symbol goes by, or a limit on reading it, shown beside the name. */
  covers?: string;
  /** Read by the full decoder only: not by the API, and not by the page where WebAssembly is off. */
  fullOnly?: true;
}

/** Every barcode type the scanner reads, the ones both decoders read first. The page and the API description are generated from it. */
export const SCAN_FORMATS: readonly ScanFormat[] = [
  { id: 'qr_code', name: 'QR Code' },
  { id: 'data_matrix', name: 'Data Matrix', covers: 'including GS1 DataMatrix' },
  { id: 'aztec', name: 'Aztec Code' },
  { id: 'pdf_417', name: 'PDF417' },
  { id: 'code_128', name: 'Code 128', covers: 'including GS1-128 and SSCC-18' },
  { id: 'code_39', name: 'Code 39' },
  { id: 'code_93', name: 'Code 93' },
  { id: 'itf', name: 'Interleaved 2 of 5', covers: 'including ITF-14' },
  { id: 'codabar', name: 'Codabar' },
  { id: 'ean_13', name: 'EAN-13', covers: 'including ISBN, ISSN and ISMN' },
  { id: 'ean_8', name: 'EAN-8' },
  { id: 'upc_a', name: 'UPC-A' },
  { id: 'rss_14', name: 'GS1 DataBar', covers: 'omnidirectional, truncated and stacked' },
  { id: 'upc_e', name: 'UPC-E', fullOnly: true },
  { id: 'rss_limited', name: 'GS1 DataBar Limited', fullOnly: true },
  { id: 'rss_expanded', name: 'GS1 DataBar Expanded', covers: 'including the stacked form', fullOnly: true },
  { id: 'micro_qr_code', name: 'Micro QR Code', fullOnly: true },
  { id: 'rmqr_code', name: 'rMQR Code', covers: 'the rectangular Micro QR Code', fullOnly: true },
  { id: 'micro_pdf_417', name: 'MicroPDF417', fullOnly: true },
  { id: 'telepen', name: 'Telepen', fullOnly: true },
  // The decoder finds a MaxiCode only when it is upright and the one dark thing in the picture:
  // an image file of the code, not a photograph of a parcel. The catalogue's notes say so in full.
  { id: 'maxicode', name: 'MaxiCode', covers: 'from a clean, upright image only', fullOnly: true },
];

/** The types the basic decoder reads: what the API reads, and the page without WebAssembly. */
export const BASIC_SCAN_FORMATS: readonly ScanFormat[] = SCAN_FORMATS.filter((format) => !format.fullOnly);

const FORMAT_BY_ID = new Map(SCAN_FORMATS.map((format) => [format.id, format]));

/** A hit for one of SCAN_FORMATS, or null for an id that is not on the list or a barcode that holds nothing. */
export function scanHit(id: string, text: string): ScanHit | null {
  const format = FORMAT_BY_ID.get(id);
  return format && text !== '' ? { format: format.id, formatName: format.name, text } : null;
}

/** RGBA pixels, row by row from the top left: a canvas's ImageData, or a decoded PNG. */
export interface ScanPixels {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export interface ScanHit {
  /** One of SCAN_FORMATS' ids. */
  format: string;
  formatName: string;
  /** The content exactly as decoded, control characters included. */
  text: string;
}

/* ------------------------------------------------------------------ */
/* Bytes to text                                                       */
/* ------------------------------------------------------------------ */

/*
 * A two-dimensional barcode holds bytes, and mostly does not say what characters they are. Both
 * decoders settle that question with the functions below, so that they settle it alike: the basic
 * one for all such bytes (see "Bytes to text" in decode.ts), the full one where its library's own
 * answer has lost bytes (see `fromBytes` in frontend/src/lib/scan-cpp.ts).
 */

/** Each byte as the character with that number: ISO-8859-1. */
export function latin1(bytes: ArrayLike<number>): string {
  let text = '';
  for (let index = 0; index < bytes.length; index += 1) text += String.fromCharCode((bytes[index] as number) & 0xff);
  return text;
}

/**
 * Bytes as text, by the runtime's converter for a character set. A byte-order mark is kept: it is
 * part of what the barcode holds.
 *
 * Shift JIS takes care. Node's converter exchanges three control characters (bytes 1A, 1C and 7F)
 * where a browser's leaves them as they are, so those three are taken out of its hands and the text
 * is the same in both.
 */
function converted(label: string, bytes: Uint8Array, fatal: boolean): string {
  const converter = new TextDecoder(label, { fatal, ignoreBOM: true });
  if (converter.encoding !== 'shift_jis') return converter.decode(bytes);
  let text = '';
  let from = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    const value = bytes[index] as number;
    if ((value > 0x80 && value < 0xa0) || (value > 0xdf && value < 0xfd)) {
      // The first byte of a two-byte character: the next byte belongs to it, whatever its value.
      index += 1;
    } else if (value === 0x1a || value === 0x1c || value === 0x7f) {
      text += converter.decode(bytes.subarray(from, index)) + String.fromCharCode(value);
      from = index + 1;
    }
  }
  return text + converter.decode(bytes.subarray(from));
}

/** Bytes as text in a character set, or null if they are not valid in it. */
export function strictly(label: string, bytes: Uint8Array): string | null {
  try {
    return converted(label, bytes, true);
  } catch {
    return null;
  }
}

/**
 * Bytes as text in a character set a barcode states, with U+FFFD for any that are not valid in it.
 * Throws for a set this runtime has no converter for.
 */
export function leniently(label: string, bytes: Uint8Array): string {
  return converted(label, bytes, false);
}

/**
 * Whether bytes that are not UTF-8 look like Shift JIS rather than Latin-1. This is the test the
 * full decoder's library applies (ZXing's, with zxing-cpp's rule about control characters), kept as
 * it is so that both decoders give the same answer. It errs towards Shift JIS for a run of three or
 * more accented capitals, in both.
 */
function looksShiftJis(bytes: Uint8Array): boolean {
  let canBeLatin1 = true;
  let canBeShiftJis = true;
  let bytesLeft = 0;
  let katakana = 0;
  let katakanaRun = 0;
  let doubleRun = 0;
  let longestKatakanaRun = 0;
  let longestDoubleRun = 0;
  let latin1Symbols = 0;
  for (const value of bytes) {
    if (canBeLatin1) {
      if (value > 0x7f && value < 0xa0) canBeLatin1 = false;
      else if (value > 0x9f && (value < 0xc0 || value === 0xd7 || value === 0xf7)) latin1Symbols += 1;
    }
    if (canBeShiftJis) {
      if (bytesLeft > 0) {
        if (value < 0x40 || value === 0x7f || value > 0xfc) canBeShiftJis = false;
        else bytesLeft -= 1;
      } else if (value === 0x80 || value === 0xa0 || value > 0xef) {
        canBeShiftJis = false;
      } else if (value < 0x20 && value !== 0x0a && value !== 0x0d) {
        // A control character says the bytes are data and not writing.
        canBeShiftJis = false;
      } else if (value > 0xa0 && value < 0xe0) {
        katakana += 1;
        doubleRun = 0;
        katakanaRun += 1;
        longestKatakanaRun = Math.max(longestKatakanaRun, katakanaRun);
      } else if (value > 0x7f) {
        bytesLeft += 1;
        katakanaRun = 0;
        doubleRun += 1;
        longestDoubleRun = Math.max(longestDoubleRun, doubleRun);
      } else {
        katakanaRun = 0;
        doubleRun = 0;
      }
    }
  }
  if (bytesLeft > 0) canBeShiftJis = false;
  if (!canBeShiftJis) return false;
  if (longestKatakanaRun >= 3 || longestDoubleRun >= 3) return true;
  if (canBeLatin1) return (longestKatakanaRun === 2 && katakana === 2) || latin1Symbols * 10 >= bytes.length;
  return true;
}

/**
 * The character set of bytes whose barcode states none, as a TextDecoder label; null is Latin-1,
 * which is also the answer for plain ASCII and for bytes that are valid in neither of the others.
 */
export function judgedSet(bytes: Uint8Array): 'utf-8' | 'shift_jis' | null {
  if (bytes.every((value) => value < 0x80)) return null;
  if (strictly('utf-8', bytes) !== null) return 'utf-8';
  return looksShiftJis(bytes) && strictly('shift_jis', bytes) !== null ? 'shift_jis' : null;
}

/** Bytes whose barcode states no character set, as text. */
export function judged(bytes: Uint8Array): string {
  const set = judgedSet(bytes);
  return (set === null ? null : strictly(set, bytes)) ?? latin1(bytes);
}

/* ------------------------------------------------------------------ */
/* What was read                                                       */
/* ------------------------------------------------------------------ */

/**
 * The decoded text made safe to show: a control character (a GS1 separator, for instance) is drawn
 * as its "control picture" so it can be seen, and line breaks and tabs are kept. The controls from
 * U+0080 to U+009F have no pictures of their own and share one, ␦; they turn up where a barcode
 * holds bytes that are not text and each byte is given as a character.
 */
export function visibleText(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, (character) => {
    const code = character.charCodeAt(0);
    return code > 0x7f ? '\u2426' : code === 0x7f ? '\u2421' : String.fromCharCode(0x2400 + code);
  });
}

export interface ScanKind {
  id: 'web' | 'wifi' | 'contact' | 'email' | 'phone' | 'sms' | 'event' | 'place' | 'payment' | 'product' | 'text';
  label: string;
  /** Something to keep in mind before acting on the content. */
  caution?: string;
}

/** The retail types: digits in one of these are a product number. */
const PRODUCT_FORMATS = new Set(['ean_13', 'ean_8', 'upc_a', 'upc_e']);

/**
 * What kind of content a barcode holds, judged from its opening characters the way a phone does.
 * The scanner never opens, dials or joins anything: it reports text, and this is a label for it.
 */
export function kindOf(hit: ScanHit): ScanKind {
  const text = hit.text.trim();
  if (/^https?:\/\//i.test(text)) return { id: 'web', label: 'Web address', caution: 'Check the address before you open it. A code can point anywhere.' };
  if (/^WIFI:/i.test(text)) return { id: 'wifi', label: 'Wi-Fi network', caution: 'This holds a network password in readable form.' };
  if (/^BEGIN:VCARD/i.test(text) || /^MECARD:/i.test(text)) return { id: 'contact', label: 'Contact' };
  if (/^mailto:/i.test(text) || /^MATMSG:/i.test(text)) return { id: 'email', label: 'Email' };
  if (/^tel:/i.test(text)) return { id: 'phone', label: 'Phone number' };
  if (/^(smsto|sms|mmsto):/i.test(text)) return { id: 'sms', label: 'Text message' };
  if (/^BEGIN:(VEVENT|VCALENDAR)/i.test(text)) return { id: 'event', label: 'Calendar event' };
  if (/^geo:/i.test(text)) return { id: 'place', label: 'Map location' };
  if (/^BCD\r?\n00[12]\r?\n/.test(text)) return { id: 'payment', label: 'SEPA payment', caution: 'Check the name, IBAN and amount before you pay.' };
  if (PRODUCT_FORMATS.has(hit.format) && /^\d+$/.test(text)) return { id: 'product', label: 'Product number' };
  if (hit.format === 'telepen') {
    const number = telepenNumber(hit.text);
    // The bars cannot say which of the two was meant, so the other reading is offered beside the first.
    if (number !== null) return { id: 'text', label: 'Text', caution: `Read as text. If this is a numeric Telepen, the same bars are the number ${number}.` };
  }
  return { id: 'text', label: 'Text' };
}

/**
 * A Telepen read as text, read again as a numeric Telepen, or null where the bars cannot be one.
 *
 * Telepen has two ways of using the same bars and no mark that says which one a symbol uses: as
 * text, one character to each group of bars, or as a number, where each group stands for a pair of
 * digits (character 27 is "00", character 126 is "99") or for one digit followed by X (characters
 * 17 to 26). A scanner is told which to expect; this one reads text and works the number out.
 */
export function telepenNumber(text: string): string | null {
  let number = '';
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 27 && code <= 126) number += String(code - 27).padStart(2, '0');
    else if (code >= 17 && code <= 26) number += `${code - 17}X`;
    else return null;
  }
  return number === '' ? null : number;
}
