/**
 * Design Studio — the barcode format registry.
 *
 * One entry per symbology this build can actually encode. Each entry names the BWIPP encoder
 * (`bcid`), what the format is for, how its data is validated, and which options it accepts — so
 * the UI, the validator, the API and the tests all read the truth from one place instead of
 * re-deciding (differently) whether, say, UPC-E takes 6 or 8 digits.
 *
 * **The rule this file exists to enforce:** a format is offered only if `bwip-js` can encode it.
 * There is no "looks like a barcode" fallback anywhere in this module. A format that a caller asks
 * for and this registry does not list is refused with an explanation, never drawn.
 *
 * `bwip-js` is a JavaScript port of BWIPP (Terry Burton's Barcode Writer in Pure PostScript), which
 * implements each symbology to its published specification. That is the difference between this
 * tool and the many "barcode generators" that draw decorative bars.
 */

export type BarcodeFamily = 'linear' | '2d';

/** What the code is typically used for — drives grouping and the "which format?" guidance. */
export type BarcodeUseCase = 'retail' | 'logistics' | 'industrial' | 'general' | 'pharma';

export interface BarcodeFormat {
  /** Stable identifier used by the UI, the API and saved templates. */
  id: string;
  /** BWIPP encoder name passed to `bwip-js` as `bcid`. */
  bcid: string;
  name: string;
  family: BarcodeFamily;
  useCase: BarcodeUseCase;
  /** One line for the picker. */
  summary: string;
  /** Longer explanation shown under the picker: what it encodes, what it does not. */
  notes: string[];
  /** Digits only? Fixed length range? Free text? */
  data: {
    kind: 'numeric' | 'alphanumeric' | 'gs1' | 'bytes';
    minLength: number;
    maxLength: number;
    /** Exact lengths accepted, when the symbology has fixed sizes (EAN-8 = 8, ITF-14 = 14). */
    lengths?: number[];
    /** Human-readable example the UI can prefill. */
    example: string;
    /** Restrict to this character set (applied after trimming). */
    charset?: RegExp;
    /** Explanation shown when validation fails. */
    hint: string;
    /**
     * True when the encoder computes and appends the check digit itself, so the user supplies the
     * data without it (EAN-13 accepts 12 or 13 digits; with 13 the last must be correct).
     */
    checkDigit?: 'required' | 'calculated';
  };
  /** Which of the user-facing options are meaningful for this format. */
  options: {
    /** Bar width / module size in millimetres, where the format allows it. */
    moduleSize?: boolean;
    /** Bar height in millimetres (linear formats only). */
    barHeight?: boolean;
    /** Quiet zone (mm) the user may enlarge but not reduce below the standard. */
    quietZone?: boolean;
    /** Human-readable text under (or beside) the symbol. */
    humanReadable?: boolean;
    /** 2D density controls. */
    columns?: boolean;
    errorCorrection?: 'qr' | 'pdf417' | 'aztec' | 'datamatrix' | 'microqr' | null;
  };
  /** Minimum X-dimension (mm) for reliable printing, used to warn — never to block. */
  minModuleMm: number;
  /**
   * Quiet zone the specification requires, in modules (or in narrow bars, for linear formats).
   * The renderer reserves this space; a caller may enlarge it but the engine never shrinks below it.
   */
  quietModules: number;
  /** Formats that carry a mandatory FNC1 / GS1 semantics flag. */
  gs1?: boolean;
  /** Formats with a practical payload ceiling tighter than the theoretical one. */
  practicalMaxChars?: number;
}

const ALNUM = /^[0-9A-Za-z \-.$/+%]+$/;
const CODE39_CHARS = /^[0-9A-Z\-. $/+%]+$/;
const CODABAR_CHARS = /^[0-9\-$:/.+]+$/;
const GS1_ELEMENT = /^\(\d{2,4}\)[^()]+/;

/**
 * The registry, in the order a user is most likely to want them: everyday retail and logistics
 * formats first, then industrial, then 2D.
 */
export const BARCODE_FORMATS: readonly BarcodeFormat[] = [
  {
    id: 'code128',
    bcid: 'code128',
    name: 'Code 128',
    family: 'linear',
    useCase: 'logistics',
    summary: 'Dense, full-ASCII linear code; the default for internal labels and shipping.',
    notes: [
      'Encodes all 128 ASCII characters and switches between character sets automatically, so a mixed alphanumeric payload stays short.',
      'The encoder adds the mandatory checksum character (modulo 103). You supply only the data.',
    ],
    data: {
      kind: 'alphanumeric', minLength: 1, maxLength: 80, example: 'CH247-2026-000123',
      hint: 'Code 128 accepts printable ASCII (no control characters) — letters, digits, spaces and punctuation.',
    },
    options: { moduleSize: true, barHeight: true, quietZone: true, humanReadable: true },
    minModuleMm: 0.25,
    quietModules: 10,
  },
  {
    id: 'code39',
    bcid: 'code39',
    name: 'Code 39',
    family: 'linear',
    useCase: 'industrial',
    summary: 'Simple, widely readable industrial code using digits, capitals and a few symbols.',
    notes: [
      'Uppercase A–Z, digits, space and - . $ / + % are allowed. Lower-case input is converted to upper case.',
      'Wider than Code 128 for the same payload; still ubiquitous in automotive and defence labelling.',
    ],
    data: {
      kind: 'alphanumeric', minLength: 1, maxLength: 40, example: 'ABC-1234',
      charset: CODE39_CHARS,
      hint: 'Code 39 supports 0-9, A-Z, space and - . $ / + % only. Use Code 128 for anything else.',
    },
    options: { moduleSize: true, barHeight: true, quietZone: true, humanReadable: true },
    minModuleMm: 0.19,
    quietModules: 10,
  },
  {
    id: 'code93',
    bcid: 'code93',
    name: 'Code 93',
    family: 'linear',
    useCase: 'industrial',
    summary: 'Compact industrial code with two check characters; a denser alternative to Code 39.',
    notes: ['Encodes the same character set as Code 39 in roughly 25% less space, with two check characters (C and K).'],
    data: {
      kind: 'alphanumeric', minLength: 1, maxLength: 40, example: 'CH247-CODE93',
      charset: ALNUM,
      hint: 'Code 93 accepts digits, upper-case letters and space - . $ / + %.',
    },
    options: { moduleSize: true, barHeight: true, quietZone: true, humanReadable: true },
    minModuleMm: 0.19,
    quietModules: 10,
  },
  {
    id: 'ean13',
    bcid: 'ean13',
    name: 'EAN-13',
    family: 'linear',
    useCase: 'retail',
    summary: 'The standard 13-digit retail product code used on almost every consumer item.',
    notes: [
      'Enter 12 digits and the check digit is calculated, or 13 digits and the last one is verified.',
      'The first digit selects the numbering organisation (0/1 US-Canada, 40-44 Germany, 690-699 China, and so on).',
    ],
    data: {
      kind: 'numeric', minLength: 12, maxLength: 13, lengths: [12, 13], example: '400638133393',
      charset: /^[0-9]+$/,
      hint: 'EAN-13 needs 12 digits (check digit calculated) or 13 digits (check digit verified).',
      checkDigit: 'calculated',
    },
    options: { moduleSize: true, barHeight: true, quietZone: true, humanReadable: true },
    minModuleMm: 0.264,
    quietModules: 11,
  },
  {
    id: 'ean8',
    bcid: 'ean8',
    name: 'EAN-8',
    family: 'linear',
    useCase: 'retail',
    summary: 'The short retail code for small packages, where an EAN-13 will not fit.',
    notes: ['Seven digits plus a check digit. Used on small retail items such as sweets, cigarettes and cosmetics.'],
    data: {
      kind: 'numeric', minLength: 7, maxLength: 8, lengths: [7, 8], example: '9638507',
      charset: /^[0-9]+$/,
      hint: 'EAN-8 needs 7 digits (check digit calculated) or 8 digits (check digit verified).',
      checkDigit: 'calculated',
    },
    options: { moduleSize: true, barHeight: true, quietZone: true, humanReadable: true },
    minModuleMm: 0.264,
    quietModules: 7,
  },
  {
    id: 'upca',
    bcid: 'upca',
    name: 'UPC-A',
    family: 'linear',
    useCase: 'retail',
    summary: 'The North American 12-digit retail product code.',
    notes: ['Eleven digits plus a check digit; visually identical to EAN-13 with a leading zero.'],
    data: {
      kind: 'numeric', minLength: 11, maxLength: 12, lengths: [11, 12], example: '03600029145',
      charset: /^[0-9]+$/,
      hint: 'UPC-A needs 11 digits (check digit calculated) or 12 digits (check digit verified).',
      checkDigit: 'calculated',
    },
    options: { moduleSize: true, barHeight: true, quietZone: true, humanReadable: true },
    minModuleMm: 0.264,
    quietModules: 9,
  },
  {
    id: 'upce',
    bcid: 'upce',
    name: 'UPC-E',
    family: 'linear',
    useCase: 'retail',
    summary: 'The zero-suppressed short form of UPC-A for very small packages.',
    notes: ['Six digits of data plus a check digit, expanded by the scanner into the matching UPC-A.'],
    data: {
      kind: 'numeric', minLength: 6, maxLength: 8, lengths: [6, 7, 8], example: '012345',
      charset: /^[0-9]+$/,
      hint: 'UPC-E takes 6 data digits (check digit calculated), 7 digits (6 + a check digit that is verified) or 8 (number system + 6 + check digit).',
      checkDigit: 'calculated',
    },
    options: { moduleSize: true, barHeight: true, quietZone: true, humanReadable: true },
    minModuleMm: 0.264,
    quietModules: 9,
  },
  {
    id: 'itf14',
    bcid: 'itf14',
    name: 'ITF-14',
    family: 'linear',
    useCase: 'logistics',
    summary: 'The 14-digit Interleaved 2 of 5 code printed on corrugated shipping cartons.',
    notes: [
      'Encodes a GTIN-14 with a bearer bar around the symbol, which is why it tolerates printing on corrugated board.',
      'Enter 13 digits and the check digit is calculated, or 14 digits and it is verified.',
    ],
    data: {
      kind: 'numeric', minLength: 13, maxLength: 14, lengths: [13, 14], example: '10012345000017',
      charset: /^[0-9]+$/,
      hint: 'ITF-14 needs 13 digits (check digit calculated) or 14 digits (check digit verified).',
      checkDigit: 'calculated',
    },
    options: { moduleSize: true, barHeight: true, quietZone: true, humanReadable: true },
    minModuleMm: 0.25,
    quietModules: 10,
  },
  {
    id: 'interleaved2of5',
    bcid: 'interleaved2of5',
    name: 'Interleaved 2 of 5',
    family: 'linear',
    useCase: 'logistics',
    summary: 'Numeric-only paired code, common on cartons and older warehouse systems.',
    notes: [
      'Encodes an even number of digits; an odd-length payload gets a leading zero so the pairs are complete.',
      'No check digit is implied by the format — add one in the data if your system expects it.',
    ],
    data: {
      kind: 'numeric', minLength: 2, maxLength: 40, example: '12345678',
      charset: /^[0-9]+$/,
      hint: 'Interleaved 2 of 5 encodes digits only.',
    },
    options: { moduleSize: true, barHeight: true, quietZone: true, humanReadable: true },
    minModuleMm: 0.25,
    quietModules: 10,
  },
  {
    id: 'codabar',
    bcid: 'rationalizedCodabar',
    name: 'Codabar',
    family: 'linear',
    useCase: 'industrial',
    summary: 'Self-checking numeric code still used by libraries, blood banks and couriers.',
    notes: [
      'Digits plus - $ : / . + are allowed. The symbol is wrapped in start/stop characters A–D, which the encoder adds.',
    ],
    data: {
      kind: 'alphanumeric', minLength: 1, maxLength: 30, example: '1234567890',
      charset: CODABAR_CHARS,
      hint: 'Codabar accepts digits and - $ : / . + (the A–D start/stop characters are added automatically).',
    },
    options: { moduleSize: true, barHeight: true, quietZone: true, humanReadable: true },
    minModuleMm: 0.19,
    quietModules: 10,
  },
  {
    id: 'gs1-128',
    bcid: 'gs1-128',
    name: 'GS1-128',
    family: 'linear',
    useCase: 'logistics',
    summary: 'Code 128 carrying GS1 Application Identifier data, as used on pallet and carton labels.',
    notes: [
      'Enter the data as GS1 AI elements, e.g. (01)09521234543213(3103)000123(10)ABC123.',
      'AI 01 is the GTIN; (3103) is a net weight of 000.123 kg; (10) is a batch. The encoder adds the FNC1 separators and the check digit.',
      'Whether the result is compliant for a specific trading partner is a business decision — this tool encodes and validates structure, it does not certify an implementation.',
    ],
    data: {
      kind: 'gs1', minLength: 4, maxLength: 120, example: '(01)09521234543213(3103)000123(10)ABC123',
      charset: GS1_ELEMENT,
      hint: 'Use GS1 AI notation in parentheses, e.g. (01)09521234543213(10)BATCH7. At least one element is required.',
    },
    options: { moduleSize: true, barHeight: true, quietZone: true, humanReadable: true },
    minModuleMm: 0.25,
    quietModules: 10,
    gs1: true,
  },
  {
    id: 'gs1databar',
    bcid: 'databaromni',
    name: 'GS1 DataBar Omnidirectional',
    family: 'linear',
    useCase: 'retail',
    summary: 'Compact retail code for small items; carries a 14-digit GTIN in half the width of EAN-13.',
    notes: ['Accepts a 13- or 14-digit numeric GTIN. Scanned omnidirectionally at the point of sale.'],
    data: {
      kind: 'gs1', minLength: 13, maxLength: 18, example: '(01)09521234543213',
      hint: 'GS1 DataBar Omnidirectional carries a GTIN: enter (01) plus a 14-digit code, or the 13/14 digits on their own.',
    },
    options: { moduleSize: true, barHeight: true, quietZone: true, humanReadable: false },
    minModuleMm: 0.264,
    quietModules: 10,
    gs1: true,
  },
  {
    id: 'qrcode',
    bcid: 'qrcode',
    name: 'QR Code',
    family: '2d',
    useCase: 'general',
    summary: 'The most widely supported 2D code: URLs, contact cards, Wi-Fi, payment and tracking.',
    notes: [
      'Error correction recovers up to ~30% of the symbol (level H), which is why QR codes survive a logo overlay and a scuffed print.',
      'A QR code is not encrypted: anyone who scans it reads the payload. Do not encode secrets.',
    ],
    data: {
      kind: 'bytes', minLength: 1, maxLength: 2953, example: 'https://cloudhost247.com/tools/barcode-generator',
      hint: 'QR Code accepts text, URLs, vCard data and UTF-8; the practical ceiling depends on the error-correction level.',
    },
    options: { moduleSize: true, quietZone: true, errorCorrection: 'qr' },
    minModuleMm: 0.4,
    quietModules: 4,
    practicalMaxChars: 1200,
  },
  {
    id: 'datamatrix',
    bcid: 'datamatrix',
    name: 'Data Matrix (ECC200)',
    family: '2d',
    useCase: 'industrial',
    summary: 'Very small, high-contrast 2D code used for parts marking, pharma and logistics.',
    notes: [
      'Reads at much smaller print sizes than a QR code because its finder pattern is continuous.',
      'The encoder selects the smallest symbol that fits the payload; ECC200 error correction is always on.',
    ],
    data: {
      kind: 'bytes', minLength: 1, maxLength: 1555, example: 'CH247-PART-000123',
      hint: 'Data Matrix accepts up to ~1555 bytes of data, depending on the symbol size chosen by the encoder.',
    },
    options: { moduleSize: true, quietZone: true, errorCorrection: 'datamatrix' },
    minModuleMm: 0.3,
    quietModules: 1,
    practicalMaxChars: 800,
  },
  {
    id: 'pdf417',
    bcid: 'pdf417',
    name: 'PDF417',
    family: '2d',
    useCase: 'logistics',
    summary: 'Stacked 2D code for large payloads: driving licences, boarding passes, VDA-4902 labels.',
    notes: [
      'Encodes up to ~1.8 kB in a symbol of stacked rows, so it suits structured records rather than short URLs.',
      'The number of data columns and the error-correction level control density and robustness.',
    ],
    data: {
      kind: 'bytes', minLength: 1, maxLength: 1850, example: 'VDA4902-DATA-EXAMPLE',
      hint: 'PDF417 accepts up to ~1850 bytes; reduce columns or payload if the symbol is too wide for your label.',
    },
    options: { moduleSize: true, quietZone: true, columns: true, errorCorrection: 'pdf417' },
    minModuleMm: 0.3,
    quietModules: 2,
    practicalMaxChars: 1000,
  },
  {
    id: 'azteccode',
    bcid: 'azteccode',
    name: 'Aztec Code',
    family: '2d',
    useCase: 'general',
    summary: 'Compact 2D code with a central bullseye; common on transport tickets.',
    notes: ['Needs no quiet zone, so it fits tighter layouts than QR. Error correction is a percentage of the payload (default 23%).'],
    data: {
      kind: 'bytes', minLength: 1, maxLength: 1900, example: 'CH247-AZTEC-1',
      hint: 'Aztec Code accepts up to ~1900 bytes depending on the error-correction percentage.',
    },
    options: { moduleSize: true, quietZone: true, errorCorrection: 'aztec' },
    minModuleMm: 0.3,
    quietModules: 1,
    practicalMaxChars: 900,
  },
  {
    id: 'microqrcode',
    bcid: 'microqrcode',
    name: 'Micro QR Code',
    family: '2d',
    useCase: 'industrial',
    summary: 'The small-footprint QR variant for very short payloads in tight spaces.',
    notes: [
      'Versions M1–M4 hold 5 to 35 numeric characters, or a short alphanumeric/byte payload.',
      'Not every scanner supports Micro QR — check the reading device before printing thousands of labels.',
    ],
    data: {
      kind: 'bytes', minLength: 1, maxLength: 35, example: '12345',
      hint: 'Micro QR holds a maximum of 35 numeric characters (21 alphanumeric, 15 bytes) in version M4.',
    },
    options: { moduleSize: true, quietZone: true, errorCorrection: 'microqr' },
    minModuleMm: 0.4,
    quietModules: 2,
    practicalMaxChars: 21,
  },
];

export function findBarcodeFormat(id: string): BarcodeFormat | undefined {
  return BARCODE_FORMATS.find((format) => format.id === id);
}

export const BARCODE_USE_CASES: Record<BarcodeUseCase, string> = {
  retail: 'Retail & point of sale',
  logistics: 'Logistics & shipping',
  industrial: 'Industrial & parts',
  general: 'General purpose',
  pharma: 'Pharma & healthcare',
};

/**
 * GS1 Application Identifiers this tool recognises, with the length rules needed to validate the
 * element string. Not exhaustive — GS1 publishes hundreds — so an AI outside this table is accepted
 * structurally and flagged as "not checked by this tool" rather than refused.
 */
export interface Gs1AiSpec {
  ai: string;
  name: string;
  /** Fixed data length; 0 = variable. */
  fixed: number;
  /** Max data length for variable-length AIs. */
  max?: number;
  numericOnly?: boolean;
}

export const GS1_AI_SPECS: readonly Gs1AiSpec[] = [
  { ai: '00', name: 'SSCC (serial shipping container code)', fixed: 18, numericOnly: true },
  { ai: '01', name: 'GTIN-14', fixed: 14, numericOnly: true },
  { ai: '02', name: 'GTIN of contained trade items', fixed: 14, numericOnly: true },
  { ai: '10', name: 'Batch / lot number', fixed: 0, max: 20 },
  { ai: '11', name: 'Production date (YYMMDD)', fixed: 6, numericOnly: true },
  { ai: '13', name: 'Packaging date (YYMMDD)', fixed: 6, numericOnly: true },
  { ai: '15', name: 'Best before date (YYMMDD)', fixed: 6, numericOnly: true },
  { ai: '17', name: 'Expiry date (YYMMDD)', fixed: 6, numericOnly: true },
  { ai: '20', name: 'Product variant', fixed: 2, numericOnly: true },
  { ai: '21', name: 'Serial number', fixed: 0, max: 20 },
  { ai: '30', name: 'Variable count', fixed: 0, max: 8, numericOnly: true },
  { ai: '37', name: 'Count of trade items', fixed: 0, max: 8, numericOnly: true },
  { ai: '400', name: 'Customer purchase order number', fixed: 0, max: 30 },
  { ai: '401', name: 'Global location number of consignment', fixed: 13, numericOnly: true },
  { ai: '410', name: 'GLN of ship-from location', fixed: 13, numericOnly: true },
  { ai: '420', name: 'Postal code (ship-to)', fixed: 0, max: 20 },
  { ai: '421', name: 'GLN of ship-to location (with ISO country code)', fixed: 15 },
  { ai: '90', name: 'Trading partner internal', fixed: 0, max: 30 },
  { ai: '91', name: 'Company internal', fixed: 0, max: 90 },
  { ai: '92', name: 'Company internal', fixed: 0, max: 90 },
];

/**
 * Weight and price AIs are a 4-digit family (310n, 311n, …) where the third digit is the implied
 * decimal position; they are matched by prefix instead of enumerated.
 */
export function gs1AiSpec(ai: string): Gs1AiSpec | undefined {
  const exact = GS1_AI_SPECS.find((spec) => spec.ai === ai);
  if (exact) return exact;
  if (/^310[0-9]$/.test(ai)) return { ai, name: 'Net weight (kg, implied decimals)', fixed: 6, numericOnly: true };
  if (/^311[0-9]$/.test(ai)) return { ai, name: 'Length (m, implied decimals)', fixed: 6, numericOnly: true };
  if (/^312[0-9]$/.test(ai)) return { ai, name: 'Width (m, implied decimals)', fixed: 6, numericOnly: true };
  if (/^393[0-9]$/.test(ai)) return { ai, name: 'Amount payable (ISO currency, implied decimals)', fixed: 3, numericOnly: true };
  return undefined;
}
