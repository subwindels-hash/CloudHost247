/**
 * The barcode symbology registry.
 *
 * One list answers every question the Barcode Generator, the label templates and the business cards
 * ask about a symbology: what it is called, which encoder draws it, what data it accepts, how it is
 * sized, and — the field that matters most — how far its output has been checked.
 *
 * `verification` is a statement of evidence, not of confidence:
 *
 *  - `decode`  — the test suite renders the sample, reads it back with an independent decoder
 *                (zxing-cpp) and compares the text. A symbol in this group has been proven to carry
 *                its payload.
 *  - `encoder` — the encoder (BWIPP, via bwip-js) produces the symbol, but nothing in this
 *                repository can read that symbology back, so the output is the encoder's word alone.
 *                The tool says so on the page instead of implying a check that did not happen.
 *
 * The set is asserted in `tests/unit/design-studio-barcodes.test.ts`: promoting a symbology to
 * `decode` without a passing round-trip fails the build.
 *
 * Pure data with no imports, so the browser can render the picker without loading the encoder.
 */

export type SymbologyGroup = 'linear' | 'retail' | 'gs1' | 'matrix' | 'postal' | 'healthcare';

export const SYMBOLOGY_GROUPS: ReadonlyArray<{ id: SymbologyGroup; label: string; blurb: string }> = [
  { id: 'linear', label: 'Linear codes', blurb: 'One-dimensional codes for serial numbers, part numbers and logistics.' },
  { id: 'retail', label: 'EAN / UPC', blurb: 'Retail point-of-sale codes, plus the book and periodical variants.' },
  { id: 'gs1', label: 'GS1', blurb: 'GS1 application-identifier codes for trade items and logistic units.' },
  { id: 'matrix', label: '2D codes', blurb: 'Matrix and stacked codes that hold far more data in a small area.' },
  { id: 'postal', label: 'Postal codes', blurb: 'Height-modulated codes used by postal operators to sort mail.' },
  { id: 'healthcare', label: 'Healthcare', blurb: 'Pharmaceutical and medical-device labelling formats.' },
];

export type SymbologySizing =
  /** Scaled by the width of the narrowest element. `unitsPerModule` is the encoder's own module size. */
  | { mode: 'module'; unitsPerModule: 1 | 2; defaultModuleMm: number; minModuleMm: number; maxModuleMm: number }
  /** A symbology whose dimensions are fixed by its specification. */
  | { mode: 'fixed'; mmPerUnit: number; note: string };

export interface SymbologyOption {
  /** The encoder's own parameter name. */
  key: string;
  /**
   * The request field that carries this option, when it differs from `key`. Two symbologies can use
   * one encoder parameter for different things (QR's `eclevel` is a letter, PDF417's a number); a
   * distinct field name keeps a flat form from sending one where the other is expected.
   */
  field?: string;
  label: string;
  type: 'select' | 'boolean' | 'integer';
  /** For `select`. */
  choices?: ReadonlyArray<{ value: string; label: string }>;
  /** For `integer`. */
  min?: number;
  max?: number;
  default: string | number | boolean;
  help?: string;
}

export interface Symbology {
  /** Public identifier used in URLs and API requests. Stable. */
  id: string;
  /** The BWIPP encoder name. */
  bcid: string;
  name: string;
  group: SymbologyGroup;
  /** One line: what this code is for. */
  summary: string;
  /** What to type, in the user's terms. */
  hint: string;
  sample: string;
  /** The longest input accepted, in characters. A bound on work, not a statement of capacity. */
  maxLength: number;
  /** Optional client-side shape check. The encoder remains the authority on validity. */
  pattern?: string;
  /** Uppercase the input before encoding (the symbology has no lowercase). */
  uppercase?: boolean;
  /** Strip spaces and hyphens before encoding (they are presentation, not data). */
  compact?: boolean;
  /** The symbol can carry line breaks (free-text 2D codes). Elsewhere a line break becomes a space. */
  multiline?: boolean;
  sizing: SymbologySizing;
  /** Linear codes only: the bar height may be chosen. Absent for codes whose height is prescribed. */
  barHeight?: { defaultMm: number; minMm: number; maxMm: number };
  /** Whether a human-readable line can be printed under the bars. */
  text: boolean;
  /** Encoder options that are always applied for this symbology. */
  fixed?: Readonly<Record<string, string | number | boolean>>;
  /** Options the user may change. */
  options?: ReadonlyArray<SymbologyOption>;
  verification: 'decode' | 'encoder';
  /**
   * For an `encoder` type of which one part is nevertheless read back by the test suite: that part,
   * in words that complete "our automated tests read back ...". The linear component of a composite
   * symbol is one; the rest of the symbol remains the encoder's word alone.
   */
  readBack?: string;
  /** Shown beside the symbology when there is something the user must know before relying on it. */
  note?: string;
}

const LINEAR: SymbologySizing = { mode: 'module', unitsPerModule: 1, defaultModuleMm: 0.33, minModuleMm: 0.19, maxModuleMm: 1.5 };
const RETAIL: SymbologySizing = { mode: 'module', unitsPerModule: 1, defaultModuleMm: 0.33, minModuleMm: 0.264, maxModuleMm: 0.66 };
const MATRIX: SymbologySizing = { mode: 'module', unitsPerModule: 2, defaultModuleMm: 0.5, minModuleMm: 0.25, maxModuleMm: 3 };
const STACKED: SymbologySizing = { mode: 'module', unitsPerModule: 1, defaultModuleMm: 0.33, minModuleMm: 0.19, maxModuleMm: 1.5 };
const POSTAL: SymbologySizing = {
  mode: 'fixed',
  mmPerUnit: 25.4 / 72,
  note: 'Postal codes have dimensions fixed by the operator’s specification, so this one is drawn at its nominal size.',
};

const BAR = { defaultMm: 15, minMm: 3, maxMm: 60 } as const;
const RETAIL_BAR = { defaultMm: 22.85, minMm: 8, maxMm: 40 } as const;

const CHECK_OPTION: SymbologyOption = {
  key: 'includecheck',
  label: 'Append a check digit',
  type: 'boolean',
  default: false,
  help: 'Only enable this when the system that reads the code expects a check digit.',
};

const QR_LEVEL: SymbologyOption = {
  key: 'eclevel',
  label: 'Error correction',
  type: 'select',
  default: 'M',
  choices: [
    { value: 'L', label: 'L: about 7% recovery' },
    { value: 'M', label: 'M: about 15% recovery' },
    { value: 'Q', label: 'Q: about 25% recovery' },
    { value: 'H', label: 'H: about 30% recovery' },
  ],
  help: 'Higher levels survive more damage and make the symbol denser.',
};

const GS1_HINT = 'GS1 element string with each application identifier in brackets, for example (01)09521234543213(10)AB123.';
const GS1_PATTERN = '^(\\(\\d{2,4}\\)[^()]+)+$';
// Shown to the visitor, so it names no library: what matters to them is that nothing here read the
// symbol back, and what to do about it.
const ENCODER_ONLY = 'Our automated tests have no independent decoder for this barcode type, so it is not read back there. Scan a printed sample with your own scanner before you rely on it.';

const COMPOSITE_HINT = 'The linear part, a vertical bar, then the 2D part as GS1 application identifiers in brackets, for example ';
const COMPOSITE_PART = '(\\(\\d{2,4}\\)[^()|]+)+';
const COMPOSITE_READ = 'the linear part';
const COMPOSITE_NOTE = 'Our automated tests read the linear part of this symbol back with an independent decoder, but have no decoder for its 2D composite part. Scan a printed sample with your own scanner before you rely on it.';
const ADDON_READ = 'the main symbol';
const ADDON_NOTE = 'Our automated tests read the main symbol back with an independent decoder, but not the add-on digits beside it. Scan a printed sample with your own scanner before you rely on it.';
const HIBC_HINT = 'HIBC data without the leading + and check character; both are added.';
const HIBC_PATTERN = '^[0-9A-Z \\-.$/+%]+$';

export const SYMBOLOGIES: readonly Symbology[] = [
  // ------------------------------------------------------------------ Linear
  {
    id: 'code128', bcid: 'code128', name: 'Code 128', group: 'linear',
    summary: 'Dense alphanumeric code for the full ASCII set; the default choice for labels.',
    hint: 'Any printable ASCII text.', sample: 'CH247-000123', maxLength: 80, pattern: '^[\\x20-\\x7E]+$',
    sizing: LINEAR, barHeight: BAR, text: true, verification: 'decode',
  },
  {
    id: 'code39', bcid: 'code39', name: 'Code 39', group: 'linear',
    summary: 'Widely supported alphanumeric code used in automotive and defence labelling.',
    hint: 'Digits, capital letters, space and - . $ / + %', sample: 'PART-1234', maxLength: 60,
    pattern: '^[0-9A-Z \\-.$/+%]+$', uppercase: true,
    sizing: LINEAR, barHeight: BAR, text: true, options: [CHECK_OPTION], verification: 'decode',
  },
  {
    id: 'code39ext', bcid: 'code39ext', name: 'Code 39 Extended', group: 'linear',
    summary: 'Code 39 with the full ASCII set, encoded as character pairs.',
    hint: 'Any printable ASCII text. Lowercase and symbols take two bar groups each.', sample: 'Part-1234', maxLength: 40,
    pattern: '^[\\x20-\\x7E]+$', sizing: LINEAR, barHeight: BAR, text: true, options: [CHECK_OPTION], verification: 'decode',
  },
  {
    id: 'code93', bcid: 'code93', name: 'Code 93', group: 'linear',
    summary: 'More compact successor to Code 39 with two mandatory check characters.',
    hint: 'Digits, capital letters, space and - . $ / + %', sample: 'CODE 93', maxLength: 60,
    pattern: '^[0-9A-Z \\-.$/+%]+$', uppercase: true,
    sizing: LINEAR, barHeight: BAR, text: true, fixed: { includecheck: true }, verification: 'decode',
  },
  {
    id: 'code93ext', bcid: 'code93ext', name: 'Code 93 Extended', group: 'linear',
    summary: 'Code 93 with the full ASCII set.',
    hint: 'Any printable ASCII text.', sample: 'Code93 Ext', maxLength: 40, pattern: '^[\\x20-\\x7E]+$',
    sizing: LINEAR, barHeight: BAR, text: true, fixed: { includecheck: true }, verification: 'decode',
  },
  {
    id: 'itf', bcid: 'interleaved2of5', name: 'Interleaved 2 of 5 (ITF)', group: 'linear',
    summary: 'Numeric code that encodes digits in pairs; common on cartons.',
    hint: 'Digits only. An odd number of digits is padded with a leading zero.', sample: '2401234567', maxLength: 60,
    pattern: '^\\d+$', sizing: LINEAR, barHeight: BAR, text: true, options: [CHECK_OPTION], verification: 'decode',
  },
  {
    id: 'itf14', bcid: 'itf14', name: 'ITF-14', group: 'linear',
    summary: 'A GTIN-14 in Interleaved 2 of 5 with bearer bars, for outer cases.',
    hint: '13 digits (the check digit is added) or 14 digits including it.', sample: '09521234543213', maxLength: 20,
    pattern: '^[\\d ]{13,20}$', compact: true,
    sizing: { mode: 'module', unitsPerModule: 1, defaultModuleMm: 0.495, minModuleMm: 0.25, maxModuleMm: 1.02 },
    barHeight: { defaultMm: 32, minMm: 5.7, maxMm: 60 }, text: true, verification: 'decode',
  },
  {
    id: 'codabar', bcid: 'rationalizedCodabar', name: 'Codabar', group: 'linear',
    summary: 'Legacy numeric code still used by libraries, blood banks and couriers.',
    hint: 'Start and stop with A, B, C or D; digits and - $ : / . + in between.', sample: 'A0123456789B', maxLength: 60,
    pattern: '^[ABCD][0-9\\-$:/.+]+[ABCD]$', uppercase: true,
    sizing: LINEAR, barHeight: BAR, text: true, options: [CHECK_OPTION], verification: 'decode',
  },
  {
    id: 'telepen', bcid: 'telepen', name: 'Telepen', group: 'linear',
    summary: 'Full-ASCII code used mainly by UK libraries and universities.',
    hint: 'Any printable ASCII text.', sample: 'ABC-123', maxLength: 40, pattern: '^[\\x20-\\x7E]+$',
    sizing: LINEAR, barHeight: BAR, text: true, verification: 'decode',
  },
  {
    id: 'code11', bcid: 'code11', name: 'Code 11', group: 'linear',
    summary: 'Numeric code with a dash, used on telecommunications equipment.',
    hint: 'Digits and the dash.', sample: '0123-4567', maxLength: 60, pattern: '^[\\d-]+$',
    sizing: LINEAR, barHeight: BAR, text: true, options: [CHECK_OPTION], verification: 'encoder', note: ENCODER_ONLY,
  },
  {
    id: 'msi', bcid: 'msi', name: 'MSI Plessey', group: 'linear',
    summary: 'Numeric shelf-labelling code used in retail inventory.',
    hint: 'Digits only.', sample: '0123456789', maxLength: 40, pattern: '^\\d+$',
    sizing: LINEAR, barHeight: BAR, text: true, options: [CHECK_OPTION], verification: 'encoder', note: ENCODER_ONLY,
  },
  {
    id: 'code2of5', bcid: 'code2of5', name: 'Standard 2 of 5', group: 'linear',
    summary: 'Simple numeric code with information in the bars only.',
    hint: 'Digits only.', sample: '01234567', maxLength: 40, pattern: '^\\d+$',
    sizing: LINEAR, barHeight: BAR, text: true, options: [CHECK_OPTION], verification: 'encoder', note: ENCODER_ONLY,
  },
  {
    id: 'industrial2of5', bcid: 'industrial2of5', name: 'Industrial 2 of 5', group: 'linear',
    summary: 'Low-density numeric code from warehouse and airline use.',
    hint: 'Digits only.', sample: '01234567', maxLength: 40, pattern: '^\\d+$',
    sizing: LINEAR, barHeight: BAR, text: true, options: [CHECK_OPTION], verification: 'encoder', note: ENCODER_ONLY,
  },
  {
    id: 'pharmacode', bcid: 'pharmacode', name: 'Pharmacode (one-track)', group: 'linear',
    summary: 'Pharmaceutical packaging control code read by packing-line scanners.',
    hint: 'A whole number from 3 to 131070.', sample: '117480', maxLength: 6, pattern: '^\\d{1,6}$',
    sizing: { mode: 'module', unitsPerModule: 1, defaultModuleMm: 0.5, minModuleMm: 0.35, maxModuleMm: 1 },
    barHeight: { defaultMm: 8, minMm: 5, maxMm: 30 }, text: false, verification: 'encoder', note: ENCODER_ONLY,
  },

  {
    id: 'flattermarken', bcid: 'flattermarken', name: 'Flattermarken', group: 'linear',
    summary: 'Collating marks that let a bindery check the order of printed sheets.',
    hint: 'Digits only; each digit sets the position of one mark.', sample: '11099', maxLength: 30, pattern: '^\\d+$',
    sizing: LINEAR, barHeight: BAR, text: false, verification: 'encoder', note: ENCODER_ONLY,
  },

  // ------------------------------------------------------------------ EAN / UPC
  {
    id: 'ean13', bcid: 'ean13', name: 'EAN-13', group: 'retail',
    summary: 'The retail product code used at point of sale outside North America.',
    hint: '12 digits (the check digit is added) or 13 digits including it.', sample: '9520123456788', maxLength: 13,
    pattern: '^\\d{12,13}$', sizing: RETAIL, barHeight: RETAIL_BAR, text: true, fixed: { guardwhitespace: true }, verification: 'decode',
  },
  {
    id: 'ean8', bcid: 'ean8', name: 'EAN-8', group: 'retail',
    summary: 'Short retail code for packs too small for an EAN-13.',
    hint: '7 digits (the check digit is added) or 8 digits including it.', sample: '95200002', maxLength: 8,
    pattern: '^\\d{7,8}$', sizing: RETAIL, barHeight: { defaultMm: 18.23, minMm: 8, maxMm: 40 }, text: true,
    fixed: { guardwhitespace: true }, verification: 'decode',
  },
  {
    id: 'upca', bcid: 'upca', name: 'UPC-A', group: 'retail',
    summary: 'The retail product code used at point of sale in North America.',
    hint: '11 digits (the check digit is added) or 12 digits including it.', sample: '012345000058', maxLength: 12,
    pattern: '^\\d{11,12}$', sizing: RETAIL, barHeight: RETAIL_BAR, text: true, verification: 'decode',
  },
  {
    id: 'upce', bcid: 'upce', name: 'UPC-E', group: 'retail',
    summary: 'Zero-suppressed UPC for small packs.',
    hint: '7 digits (the check digit is added) or 8 digits including it, beginning with 0 or 1.', sample: '01234558', maxLength: 8,
    pattern: '^[01]\\d{6,7}$', sizing: RETAIL, barHeight: RETAIL_BAR, text: true, verification: 'decode',
  },
  {
    id: 'isbn', bcid: 'isbn', name: 'ISBN', group: 'retail',
    summary: 'Book identifier, printed as an EAN-13.',
    hint: 'An ISBN-13 or ISBN-10, with or without hyphens.', sample: '978-1-56581-231-4', maxLength: 20,
    pattern: '^[\\dXx -]{10,20}$', sizing: RETAIL, barHeight: RETAIL_BAR, text: true, fixed: { guardwhitespace: true }, verification: 'decode',
  },
  {
    id: 'issn', bcid: 'issn', name: 'ISSN', group: 'retail',
    summary: 'Periodical identifier, printed as an EAN-13.',
    hint: 'An eight-character ISSN such as 0311-175X, optionally followed by a two-digit variant.', sample: '0311-175X 00', maxLength: 20,
    pattern: '^[\\dXx -]{8,20}$', sizing: RETAIL, barHeight: RETAIL_BAR, text: true, fixed: { guardwhitespace: true }, verification: 'decode',
  },
  {
    id: 'ean14', bcid: 'ean14', name: 'EAN-14 (GTIN-14)', group: 'retail',
    summary: 'A GTIN-14 for trade units, carried in a GS1-128 symbol.',
    hint: '(01) followed by 13 digits (the check digit is added) or 14 digits.', sample: '(01)09528765432108', maxLength: 24,
    pattern: '^\\(01\\)[\\d ]{13,20}$', sizing: LINEAR, barHeight: BAR, text: true, verification: 'decode',
  },

  {
    id: 'ismn', bcid: 'ismn', name: 'ISMN', group: 'retail',
    summary: 'Identifier for printed music, printed as an EAN-13.',
    hint: 'An ISMN beginning 979-0, with or without hyphens.', sample: '979-0-2605-3211-3', maxLength: 20,
    pattern: '^[\\dMm -]{10,20}$', sizing: RETAIL, barHeight: RETAIL_BAR, text: true, fixed: { guardwhitespace: true }, verification: 'decode',
  },
  {
    id: 'isbn-addon', bcid: 'isbn', name: 'ISBN with 5-digit add-on', group: 'retail',
    summary: 'A book’s ISBN with the five-digit add-on that carries its recommended price.',
    hint: 'An ISBN-13 or ISBN-10, a space, then the five add-on digits.', sample: '978-1-56581-231-4 90000', maxLength: 24,
    pattern: '^[\\dXx-]{10,17} \\d{5}$', sizing: RETAIL, barHeight: RETAIL_BAR, text: true, fixed: { guardwhitespace: true },
    verification: 'encoder', readBack: ADDON_READ, note: ADDON_NOTE,
  },
  {
    id: 'issn-addon', bcid: 'issn', name: 'ISSN with 2-digit add-on', group: 'retail',
    summary: 'A periodical’s ISSN with the two-digit add-on that carries the issue number.',
    hint: 'The ISSN, a space, the two-digit variant, a space, then the two add-on digits.', sample: '0311-175X 00 17', maxLength: 16,
    pattern: '^[\\dXx-]{8,9} \\d{2} \\d{2}$', sizing: RETAIL, barHeight: RETAIL_BAR, text: true, fixed: { guardwhitespace: true },
    verification: 'encoder', readBack: ADDON_READ, note: ADDON_NOTE,
  },
  {
    id: 'ean13-composite', bcid: 'ean13composite', name: 'EAN-13 Composite', group: 'retail',
    summary: 'An EAN-13 with a small 2D component above it for a batch, date or serial number.',
    hint: `${COMPOSITE_HINT}9520123456788|(10)AB123`, sample: '9520123456788|(10)AB123', maxLength: 160,
    pattern: `^\\d{12,13}\\|${COMPOSITE_PART}$`, sizing: RETAIL, text: true, verification: 'encoder', readBack: COMPOSITE_READ, note: COMPOSITE_NOTE,
  },
  {
    id: 'ean8-composite', bcid: 'ean8composite', name: 'EAN-8 Composite', group: 'retail',
    summary: 'An EAN-8 with a 2D component above it.',
    hint: `${COMPOSITE_HINT}95200002|(10)AB123`, sample: '95200002|(10)AB123', maxLength: 160,
    pattern: `^\\d{7,8}\\|${COMPOSITE_PART}$`, sizing: RETAIL, text: true, verification: 'encoder', readBack: COMPOSITE_READ, note: COMPOSITE_NOTE,
  },
  {
    id: 'upca-composite', bcid: 'upcacomposite', name: 'UPC-A Composite', group: 'retail',
    summary: 'A UPC-A with a 2D component above it.',
    hint: `${COMPOSITE_HINT}012345000058|(10)AB123`, sample: '012345000058|(10)AB123', maxLength: 160,
    pattern: `^\\d{11,12}\\|${COMPOSITE_PART}$`, sizing: RETAIL, text: true, verification: 'encoder', readBack: COMPOSITE_READ, note: COMPOSITE_NOTE,
  },
  {
    id: 'upce-composite', bcid: 'upcecomposite', name: 'UPC-E Composite', group: 'retail',
    summary: 'A UPC-E with a 2D component above it.',
    hint: `${COMPOSITE_HINT}01234558|(10)AB123`, sample: '01234558|(10)AB123', maxLength: 160,
    pattern: `^[01]\\d{6,7}\\|${COMPOSITE_PART}$`, sizing: RETAIL, text: true, verification: 'encoder', readBack: COMPOSITE_READ, note: COMPOSITE_NOTE,
  },

  // ------------------------------------------------------------------ GS1
  {
    id: 'gs1-128', bcid: 'gs1-128', name: 'GS1-128', group: 'gs1',
    summary: 'Code 128 carrying GS1 application identifiers; the logistics-label workhorse.',
    hint: GS1_HINT, sample: '(01)09521234543213(10)AB123', maxLength: 90, pattern: GS1_PATTERN,
    sizing: LINEAR, barHeight: { defaultMm: 32, minMm: 13, maxMm: 60 }, text: true, verification: 'decode',
  },
  {
    id: 'sscc18', bcid: 'sscc18', name: 'SSCC-18', group: 'gs1',
    summary: 'Serial Shipping Container Code that identifies one logistic unit.',
    hint: '(00) followed by 17 digits (the check digit is added) or 18 digits.', sample: '(00)095287654321012346', maxLength: 30,
    pattern: '^\\(00\\)[\\d ]{17,26}$', sizing: LINEAR, barHeight: { defaultMm: 32, minMm: 13, maxMm: 60 }, text: true, verification: 'decode',
  },
  {
    id: 'databar', bcid: 'databaromni', name: 'GS1 DataBar Omnidirectional', group: 'gs1',
    summary: 'Compact GTIN symbol readable in any orientation at point of sale.',
    hint: '(01) followed by a 14-digit GTIN.', sample: '(01)09521234543213', maxLength: 20, pattern: '^\\(01\\)\\d{13,14}$',
    sizing: LINEAR, text: false, verification: 'decode',
  },
  {
    id: 'databar-truncated', bcid: 'databartruncated', name: 'GS1 DataBar Truncated', group: 'gs1',
    summary: 'Reduced-height DataBar for small items.',
    hint: '(01) followed by a 14-digit GTIN.', sample: '(01)09521234543213', maxLength: 20, pattern: '^\\(01\\)\\d{13,14}$',
    sizing: LINEAR, text: false, verification: 'decode',
  },
  {
    id: 'databar-limited', bcid: 'databarlimited', name: 'GS1 DataBar Limited', group: 'gs1',
    summary: 'DataBar for small items whose GTIN starts with 0 or 1.',
    hint: '(01) followed by a 14-digit GTIN beginning with 0 or 1.', sample: '(01)09521234543213', maxLength: 20, pattern: '^\\(01\\)[01]\\d{12,13}$',
    sizing: LINEAR, text: false, verification: 'decode',
  },
  {
    id: 'databar-expanded', bcid: 'databarexpanded', name: 'GS1 DataBar Expanded', group: 'gs1',
    summary: 'DataBar that carries a GTIN plus attributes such as weight or date.',
    hint: GS1_HINT, sample: '(01)09521234543213(3103)000123', maxLength: 74, pattern: GS1_PATTERN,
    sizing: LINEAR, text: false, verification: 'decode',
  },
  {
    id: 'databar-stacked', bcid: 'databarstacked', name: 'GS1 DataBar Stacked', group: 'gs1',
    summary: 'Two-row DataBar for very narrow items.',
    hint: '(01) followed by a 14-digit GTIN.', sample: '(01)09521234543213', maxLength: 20, pattern: '^\\(01\\)\\d{13,14}$',
    sizing: STACKED, text: false, verification: 'decode',
  },
  {
    id: 'databar-stacked-omni', bcid: 'databarstackedomni', name: 'GS1 DataBar Stacked Omnidirectional', group: 'gs1',
    summary: 'Two-row DataBar readable in any orientation, used on loose produce.',
    hint: '(01) followed by a 14-digit GTIN.', sample: '(01)24012345678905', maxLength: 20, pattern: '^\\(01\\)\\d{13,14}$',
    sizing: STACKED, text: false, verification: 'decode',
  },
  {
    id: 'gs1-datamatrix', bcid: 'gs1datamatrix', name: 'GS1 DataMatrix', group: 'gs1',
    summary: 'Data Matrix carrying GS1 application identifiers; the code for regulated healthcare items.',
    hint: GS1_HINT, sample: '(01)09521234543213(17)261231(10)AB123', maxLength: 200, pattern: GS1_PATTERN,
    sizing: MATRIX, text: false, verification: 'decode',
  },
  {
    id: 'gs1-qr', bcid: 'gs1qrcode', name: 'GS1 QR Code', group: 'gs1',
    summary: 'QR Code carrying GS1 application identifiers.',
    hint: GS1_HINT, sample: '(01)09521234543213(10)AB123', maxLength: 200, pattern: GS1_PATTERN,
    sizing: MATRIX, text: false, options: [QR_LEVEL], verification: 'decode',
  },
  {
    id: 'gs1-digital-link-qr', bcid: 'gs1dlqrcode', name: 'GS1 Digital Link QR Code', group: 'gs1',
    summary: 'A web address that is also a GS1 identifier, for consumer and supply-chain scans.',
    hint: 'A GS1 Digital Link URI, for example https://id.gs1.org/01/09521234543213/10/AB123', sample: 'https://id.gs1.org/01/09521234543213/10/AB123', maxLength: 250,
    pattern: '^[Hh][Tt][Tt][Pp][Ss]?://\\S+$', sizing: MATRIX, text: false, options: [QR_LEVEL], verification: 'decode',
  },

  {
    id: 'databar-expanded-stacked', bcid: 'databarexpandedstacked', name: 'GS1 DataBar Expanded Stacked', group: 'gs1',
    summary: 'DataBar Expanded broken into rows, for a GTIN plus attributes on a narrow item.',
    hint: GS1_HINT, sample: '(01)09521234543213(3103)000123', maxLength: 74, pattern: GS1_PATTERN,
    sizing: STACKED, text: false, fixed: { segments: 4 }, verification: 'decode',
  },
  {
    id: 'gs1-digital-link-datamatrix', bcid: 'gs1dldatamatrix', name: 'GS1 Digital Link Data Matrix', group: 'gs1',
    summary: 'A GS1 Digital Link web address in a Data Matrix, where there is no room for a QR Code.',
    hint: 'A GS1 Digital Link URI, for example https://id.gs1.org/01/09521234543213/10/AB123', sample: 'https://id.gs1.org/01/09521234543213/10/AB123', maxLength: 250,
    pattern: '^[Hh][Tt][Tt][Pp][Ss]?://\\S+$', sizing: MATRIX, text: false, verification: 'decode',
  },
  {
    id: 'gs1-128-composite', bcid: 'gs1-128composite', name: 'GS1-128 Composite', group: 'gs1',
    summary: 'A GS1-128 with a 2D component above it for the data that does not fit in the bars.',
    hint: `${COMPOSITE_HINT}(00)095287654321012346|(02)09521234543213(37)24(10)AB123`, sample: '(00)095287654321012346|(02)09521234543213(37)24(10)AB123', maxLength: 200,
    pattern: `^${COMPOSITE_PART}\\|${COMPOSITE_PART}$`, sizing: LINEAR, text: true, verification: 'encoder', readBack: COMPOSITE_READ, note: COMPOSITE_NOTE,
  },
  {
    id: 'databar-composite', bcid: 'databaromnicomposite', name: 'GS1 DataBar Composite', group: 'gs1',
    summary: 'DataBar Omnidirectional with a 2D component above it.',
    hint: `${COMPOSITE_HINT}(01)09521234543213|(10)AB123`, sample: '(01)09521234543213|(10)AB123', maxLength: 160,
    pattern: `^\\(01\\)\\d{13,14}\\|${COMPOSITE_PART}$`, sizing: LINEAR, text: false, verification: 'encoder', readBack: COMPOSITE_READ, note: COMPOSITE_NOTE,
  },
  {
    id: 'databar-stacked-composite', bcid: 'databarstackedcomposite', name: 'GS1 DataBar Stacked Composite', group: 'gs1',
    summary: 'DataBar Stacked with a 2D component above it.',
    hint: `${COMPOSITE_HINT}(01)09521234543213|(10)AB123`, sample: '(01)09521234543213|(10)AB123', maxLength: 160,
    pattern: `^\\(01\\)\\d{13,14}\\|${COMPOSITE_PART}$`, sizing: STACKED, text: false, verification: 'encoder', readBack: COMPOSITE_READ, note: COMPOSITE_NOTE,
  },
  {
    id: 'databar-stacked-omni-composite', bcid: 'databarstackedomnicomposite', name: 'GS1 DataBar Stacked Omnidirectional Composite', group: 'gs1',
    summary: 'DataBar Stacked Omnidirectional with a 2D component above it.',
    hint: `${COMPOSITE_HINT}(01)09521234543213|(10)AB123`, sample: '(01)09521234543213|(10)AB123', maxLength: 160,
    pattern: `^\\(01\\)\\d{13,14}\\|${COMPOSITE_PART}$`, sizing: STACKED, text: false, verification: 'encoder', readBack: COMPOSITE_READ, note: COMPOSITE_NOTE,
  },
  {
    id: 'databar-limited-composite', bcid: 'databarlimitedcomposite', name: 'GS1 DataBar Limited Composite', group: 'gs1',
    summary: 'DataBar Limited with a 2D component above it.',
    hint: `${COMPOSITE_HINT}(01)09521234543213|(10)AB123. The GTIN begins with 0 or 1.`, sample: '(01)09521234543213|(10)AB123', maxLength: 160,
    pattern: `^\\(01\\)[01]\\d{12,13}\\|${COMPOSITE_PART}$`, sizing: LINEAR, text: false, verification: 'encoder', readBack: COMPOSITE_READ, note: COMPOSITE_NOTE,
  },
  {
    id: 'databar-expanded-composite', bcid: 'databarexpandedcomposite', name: 'GS1 DataBar Expanded Composite', group: 'gs1',
    summary: 'DataBar Expanded with a 2D component above it.',
    hint: `${COMPOSITE_HINT}(01)09521234543213(3103)000123|(10)AB123`, sample: '(01)09521234543213(3103)000123|(10)AB123', maxLength: 200,
    pattern: `^${COMPOSITE_PART}\\|${COMPOSITE_PART}$`, sizing: LINEAR, text: false, verification: 'encoder', readBack: COMPOSITE_READ, note: COMPOSITE_NOTE,
  },
  {
    id: 'databar-expanded-stacked-composite', bcid: 'databarexpandedstackedcomposite', name: 'GS1 DataBar Expanded Stacked Composite', group: 'gs1',
    summary: 'DataBar Expanded Stacked with a 2D component above it.',
    hint: `${COMPOSITE_HINT}(01)09521234543213(3103)000123|(10)AB123`, sample: '(01)09521234543213(3103)000123|(10)AB123', maxLength: 200,
    pattern: `^${COMPOSITE_PART}\\|${COMPOSITE_PART}$`, sizing: STACKED, text: false, fixed: { segments: 4 },
    verification: 'encoder', readBack: COMPOSITE_READ, note: COMPOSITE_NOTE,
  },

  // ------------------------------------------------------------------ 2D
  {
    id: 'qrcode', bcid: 'qrcode', name: 'QR Code', group: 'matrix',
    summary: 'The most widely scanned 2D code; any phone camera reads it.',
    hint: 'Text or a web address. Content helpers for Wi-Fi and contacts live in the QR Code Generator.', sample: 'https://cloudhost247.com/tools', maxLength: 1500,
    multiline: true, sizing: MATRIX, text: false, options: [QR_LEVEL], verification: 'decode',
  },
  {
    id: 'microqr', bcid: 'microqrcode', name: 'Micro QR Code', group: 'matrix',
    summary: 'A very small QR variant for short data on tiny parts.',
    hint: 'Up to 35 digits or 21 letters and digits.', sample: '12345678', maxLength: 35,
    sizing: MATRIX, text: false, verification: 'decode',
  },
  {
    id: 'datamatrix', bcid: 'datamatrix', name: 'Data Matrix', group: 'matrix',
    summary: 'Compact 2D code used for direct part marking and electronics.',
    hint: 'Text or binary-safe ASCII.', sample: 'CH247-DM-0001', maxLength: 1500,
    multiline: true, sizing: MATRIX, text: false, verification: 'decode',
  },
  {
    id: 'datamatrix-rectangular', bcid: 'datamatrixrectangular', name: 'Data Matrix (rectangular)', group: 'matrix',
    summary: 'Rectangular Data Matrix for narrow label areas.',
    hint: 'Short text; the rectangular sizes hold up to about 72 characters.', sample: 'CH247-0001', maxLength: 72,
    sizing: MATRIX, text: false, verification: 'decode',
  },
  {
    id: 'aztec', bcid: 'azteccode', name: 'Aztec Code', group: 'matrix',
    summary: '2D code that needs no quiet zone; used on transport tickets.',
    hint: 'Text or binary-safe ASCII.', sample: 'CH247 Aztec 0001', maxLength: 1500,
    multiline: true, sizing: MATRIX, text: false, verification: 'decode',
  },
  {
    id: 'pdf417', bcid: 'pdf417', name: 'PDF417', group: 'matrix',
    summary: 'Stacked code used on boarding passes, driving licences and shipping labels.',
    hint: 'Text or binary-safe ASCII.', sample: 'CloudHost247 PDF417 sample', maxLength: 1200,
    multiline: true, sizing: STACKED, text: false,
    options: [
      { key: 'columns', label: 'Data columns', type: 'integer', min: 1, max: 30, default: 4, help: 'More columns make a wider, shorter symbol.' },
      { key: 'eclevel', field: 'securityLevel', label: 'Error correction level', type: 'integer', min: 0, max: 8, default: 2, help: '0 to 8. Each level roughly doubles the correction codewords.' },
    ],
    verification: 'decode',
  },
  {
    id: 'micropdf417', bcid: 'micropdf417', name: 'MicroPDF417', group: 'matrix',
    summary: 'Small-footprint PDF417 for short data.',
    hint: 'Up to about 150 characters.', sample: 'MicroPDF417', maxLength: 150,
    sizing: STACKED, text: false, verification: 'decode',
  },
  {
    id: 'maxicode', bcid: 'maxicode', name: 'MaxiCode', group: 'matrix',
    summary: 'Fixed-size 2D code used on parcels for high-speed sorting.',
    hint: 'Up to about 90 characters of plain ASCII text (mode 4). Carrier-formatted messages are not built here.', sample: 'CloudHost247 MaxiCode', maxLength: 90,
    pattern: '^[\\x20-\\x7E]+$',
    // bwip-js draws MaxiCode on a 100-units-per-inch grid, which is the symbol's nominal size.
    sizing: { mode: 'fixed', mmPerUnit: 0.254, note: 'MaxiCode has one fixed size (about 26.6 × 25.3 mm before its quiet zone); it is drawn at that size and cannot be scaled.' },
    text: false, fixed: { mode: 4 }, verification: 'decode',
  },
  {
    id: 'hanxin', bcid: 'hanxin', name: 'Han Xin Code', group: 'matrix',
    summary: '2D code optimised for Chinese text.',
    hint: 'Text.', sample: 'Han Xin 0001', maxLength: 800,
    multiline: true, sizing: MATRIX, text: false, verification: 'encoder', note: ENCODER_ONLY,
  },
  {
    id: 'dotcode', bcid: 'dotcode', name: 'DotCode', group: 'matrix',
    summary: 'Dot-matrix code designed for high-speed ink-jet marking.',
    hint: 'Printable ASCII text.', sample: 'DotCode 0001', maxLength: 200, pattern: '^[\\x20-\\x7E]+$',
    sizing: MATRIX, text: false, fixed: { inkspread: 0.16 }, verification: 'encoder', note: ENCODER_ONLY,
  },
  {
    id: 'codablockf', bcid: 'codablockf', name: 'Codablock F', group: 'matrix',
    summary: 'Stacked Code 128 rows, used in European healthcare logistics.',
    hint: 'Printable ASCII text.', sample: 'CODABLOCK F 0001', maxLength: 200, pattern: '^[\\x20-\\x7E]+$',
    sizing: STACKED, text: false, verification: 'encoder', note: ENCODER_ONLY,
  },

  // ------------------------------------------------------------------ Postal
  {
    id: 'usps-imb', bcid: 'onecode', name: 'USPS Intelligent Mail', group: 'postal',
    summary: 'The 65-bar code on United States letter mail.',
    hint: '20 digits of tracking data followed by a 0, 5, 9 or 11-digit routing code.', sample: '0123456709498765432101234567891', maxLength: 31,
    pattern: '^\\d{20}(\\d{5}|\\d{9}|\\d{11})?$', sizing: POSTAL, text: false, verification: 'encoder', note: ENCODER_ONLY,
  },
  {
    id: 'postnet', bcid: 'postnet', name: 'USPS POSTNET', group: 'postal',
    summary: 'The older United States ZIP code barcode.',
    hint: 'A 5, 9 or 11-digit ZIP code.', sample: '012345678', maxLength: 11, pattern: '^(\\d{5}|\\d{9}|\\d{11})$',
    sizing: POSTAL, text: false, verification: 'encoder', note: ENCODER_ONLY,
  },
  {
    id: 'royalmail', bcid: 'royalmail', name: 'Royal Mail 4-State (RM4SCC)', group: 'postal',
    summary: 'United Kingdom customer barcode for automated sorting.',
    hint: 'Postcode and delivery point suffix: capital letters and digits, no spaces.', sample: 'LE28HS9Z', maxLength: 12,
    pattern: '^[0-9A-Z]+$', uppercase: true, compact: true, sizing: POSTAL, text: false, verification: 'encoder', note: ENCODER_ONLY,
  },
  {
    id: 'kix', bcid: 'kix', name: 'KIX (PostNL)', group: 'postal',
    summary: 'Netherlands customer barcode.',
    hint: 'Postcode and house number: capital letters and digits.', sample: '1231FZ13XHS', maxLength: 20,
    pattern: '^[0-9A-Z]+$', uppercase: true, compact: true, sizing: POSTAL, text: false, verification: 'encoder', note: ENCODER_ONLY,
  },
  {
    id: 'identcode', bcid: 'identcode', name: 'Deutsche Post Identcode', group: 'postal',
    summary: 'Parcel identifier used by Deutsche Post and DHL.',
    hint: '11 digits (the check digit is added) or 12 digits.', sample: '563102430313', maxLength: 12, pattern: '^\\d{11,12}$',
    sizing: LINEAR, barHeight: { defaultMm: 25, minMm: 10, maxMm: 60 }, text: true, verification: 'decode',
  },
  {
    id: 'leitcode', bcid: 'leitcode', name: 'Deutsche Post Leitcode', group: 'postal',
    summary: 'Routing code used by Deutsche Post and DHL.',
    hint: '13 digits (the check digit is added) or 14 digits.', sample: '21348075016401', maxLength: 14, pattern: '^\\d{13,14}$',
    sizing: LINEAR, barHeight: { defaultMm: 25, minMm: 10, maxMm: 60 }, text: true, verification: 'decode',
  },

  {
    id: 'planet', bcid: 'planet', name: 'USPS PLANET', group: 'postal',
    summary: 'United States code that tracked mail pieces before Intelligent Mail replaced it.',
    hint: '11 or 13 digits; the check digit is added.', sample: '01234567890', maxLength: 13, pattern: '^(\\d{11}|\\d{13})$',
    sizing: POSTAL, text: false, verification: 'encoder', note: ENCODER_ONLY,
  },
  {
    id: 'auspost', bcid: 'auspost', name: 'Australia Post 4-State', group: 'postal',
    summary: 'Australia Post customer barcode for automated sorting.',
    hint: 'The format code (11, 45, 59 or 62) and the 8-digit delivery point identifier; 59 and 62 may be followed by up to 5 or 10 characters of customer information.',
    sample: '1156439111', maxLength: 20, pattern: '^(?:(?:11|45)\\d{8}|59\\d{8}[0-9A-Za-z #]{0,5}|62\\d{8}[0-9A-Za-z #]{0,10})$',
    sizing: POSTAL, text: false, fixed: { custinfoenc: 'character' }, verification: 'encoder', note: ENCODER_ONLY,
  },
  {
    id: 'japanpost', bcid: 'japanpost', name: 'Japan Post 4-State', group: 'postal',
    summary: 'Japan Post customer barcode: the postcode and the address number.',
    hint: 'The 7-digit postcode, then the address number: digits, capital letters and hyphens.', sample: '6540123789-A-K-Z', maxLength: 20,
    pattern: '^\\d{7}[0-9A-Z-]*$', uppercase: true, sizing: POSTAL, text: false, verification: 'encoder', note: ENCODER_ONLY,
  },
  {
    id: 'daft', bcid: 'daft', name: 'DAFT (generic 4-state)', group: 'postal',
    summary: 'A 4-state code drawn bar by bar, for postal formats this tool does not build itself.',
    hint: 'One letter per bar: D (descender), A (ascender), F (full) or T (tracker).', sample: 'FATDAFTDAD', maxLength: 100,
    pattern: '^[DAFT]+$', uppercase: true, sizing: POSTAL, text: false, verification: 'encoder', note: ENCODER_ONLY,
  },
  {
    id: 'mailmark', bcid: 'mailmark', name: 'Royal Mail Mailmark 2D', group: 'postal',
    summary: 'The Data Matrix that identifies a mail piece to Royal Mail.',
    hint: 'The 45-character Mailmark data beginning JGB, then any customer content. Spaces inside the data are part of it.',
    sample: 'JGB 012100123412345678AB19XY1A 0             www.xyz.com', maxLength: 90, pattern: '^JGB [\\x20-\\x7E]{41,86}$',
    sizing: { mode: 'module', unitsPerModule: 2, defaultModuleMm: 0.5, minModuleMm: 0.5, maxModuleMm: 0.7 }, text: false,
    options: [
      {
        key: 'type', field: 'mailmarkType', label: 'Mailmark type', type: 'select', default: '9',
        choices: [
          { value: '7', label: 'Type 7: 24 × 24 modules, 45 characters' },
          { value: '9', label: 'Type 9: 32 × 32 modules, up to 90 characters' },
          { value: '29', label: 'Type 29: 16 × 48 modules, up to 70 characters' },
        ],
        help: 'Use the type your Royal Mail agreement names. Type 7 has no room for customer content.',
      },
    ],
    verification: 'decode',
  },

  // ------------------------------------------------------------------ Healthcare
  {
    id: 'pzn', bcid: 'pzn', name: 'PZN7 (Pharmazentralnummer)', group: 'healthcare',
    summary: 'The older seven-digit German pharmaceutical product number, printed as Code 39.',
    hint: '6 digits (the check digit is added) or 7 digits.', sample: '123456', maxLength: 7, pattern: '^\\d{6,7}$',
    sizing: LINEAR, barHeight: BAR, text: true, verification: 'decode',
  },
  {
    id: 'code32', bcid: 'code32', name: 'Code 32 (Italian Pharmacode)', group: 'healthcare',
    summary: 'Italian pharmaceutical product code, printed as Code 39.',
    hint: '8 digits (the check digit is added) or 9 digits.', sample: '01234567', maxLength: 9, pattern: '^\\d{8,9}$',
    sizing: LINEAR, barHeight: BAR, text: true, verification: 'decode',
  },
  {
    id: 'hibc128', bcid: 'hibccode128', name: 'HIBC Code 128', group: 'healthcare',
    summary: 'Health Industry Bar Code supplier label in Code 128.',
    hint: 'HIBC data without the leading + and check character; both are added.', sample: 'A999BJC5D6E71', maxLength: 60,
    pattern: '^[0-9A-Z \\-.$/+%]+$', uppercase: true, sizing: LINEAR, barHeight: BAR, text: true, verification: 'decode',
  },
  {
    id: 'hibc-datamatrix', bcid: 'hibcdatamatrix', name: 'HIBC Data Matrix', group: 'healthcare',
    summary: 'Health Industry Bar Code supplier label in Data Matrix.',
    hint: 'HIBC data without the leading + and check character; both are added.', sample: 'A999BJC5D6E71', maxLength: 120,
    pattern: '^[0-9A-Z \\-.$/+%]+$', uppercase: true, sizing: MATRIX, text: false, verification: 'decode',
  },
  {
    id: 'pharmacode2', bcid: 'pharmacode2', name: 'Pharmacode (two-track)', group: 'healthcare',
    summary: 'Two-track pharmaceutical packaging control code.',
    hint: 'A whole number from 4 to 64570080.', sample: '117480', maxLength: 8, pattern: '^\\d{1,8}$',
    sizing: POSTAL, text: false, verification: 'encoder', note: ENCODER_ONLY,
  },
  {
    id: 'pzn8', bcid: 'pzn', name: 'PZN8 (Pharmazentralnummer)', group: 'healthcare',
    summary: 'The eight-digit German pharmaceutical product number, printed as Code 39.',
    hint: '7 digits (the check digit is added) or 8 digits.', sample: '0275808', maxLength: 8, pattern: '^\\d{7,8}$',
    sizing: LINEAR, barHeight: BAR, text: true, fixed: { pzn8: true }, verification: 'decode',
  },
  {
    id: 'hibc39', bcid: 'hibccode39', name: 'HIBC Code 39', group: 'healthcare',
    summary: 'Health Industry Bar Code label in Code 39.',
    hint: HIBC_HINT, sample: 'A999BJC5D6E71', maxLength: 40, pattern: HIBC_PATTERN, uppercase: true,
    sizing: LINEAR, barHeight: BAR, text: true, verification: 'decode',
  },
  {
    id: 'hibc-qr', bcid: 'hibcqrcode', name: 'HIBC QR Code', group: 'healthcare',
    summary: 'Health Industry Bar Code label in a QR Code.',
    hint: HIBC_HINT, sample: 'A999BJC5D6E71', maxLength: 120, pattern: HIBC_PATTERN, uppercase: true,
    sizing: MATRIX, text: false, verification: 'decode',
  },
  {
    id: 'hibc-aztec', bcid: 'hibcazteccode', name: 'HIBC Aztec Code', group: 'healthcare',
    summary: 'Health Industry Bar Code label in an Aztec Code.',
    hint: HIBC_HINT, sample: 'A999BJC5D6E71', maxLength: 120, pattern: HIBC_PATTERN, uppercase: true,
    sizing: MATRIX, text: false, verification: 'decode',
  },
  {
    id: 'hibc-pdf417', bcid: 'hibcpdf417', name: 'HIBC PDF417', group: 'healthcare',
    summary: 'Health Industry Bar Code label in PDF417.',
    hint: HIBC_HINT, sample: 'A999BJC5D6E71', maxLength: 120, pattern: HIBC_PATTERN, uppercase: true,
    sizing: STACKED, text: false, verification: 'decode',
  },
  {
    id: 'hibc-micropdf417', bcid: 'hibcmicropdf417', name: 'HIBC MicroPDF417', group: 'healthcare',
    summary: 'Health Industry Bar Code label in MicroPDF417.',
    hint: HIBC_HINT, sample: 'A999BJC5D6E71', maxLength: 60, pattern: HIBC_PATTERN, uppercase: true,
    sizing: STACKED, text: false, verification: 'decode',
  },
  {
    id: 'hibc-codablockf', bcid: 'hibccodablockf', name: 'HIBC Codablock F', group: 'healthcare',
    summary: 'Health Industry Bar Code label in Codablock F.',
    hint: HIBC_HINT, sample: 'A999BJC5D6E71', maxLength: 120, pattern: HIBC_PATTERN, uppercase: true,
    sizing: STACKED, text: false, verification: 'encoder', note: ENCODER_ONLY,
  },
];

const BY_ID = new Map(SYMBOLOGIES.map((symbology) => [symbology.id, symbology]));

export function symbologyById(id: string): Symbology | undefined {
  return BY_ID.get(id);
}

export function symbologiesInGroup(group: SymbologyGroup): Symbology[] {
  return SYMBOLOGIES.filter((symbology) => symbology.group === group);
}

/** The request field an option is read from. */
export function optionField(option: SymbologyOption): string {
  return option.field ?? option.key;
}

/** Kinds that are drawn as bars with a selectable height. */
export function isLinear(symbology: Symbology): boolean {
  return symbology.barHeight !== undefined;
}

/** The data as the encoder should receive it, after the symbology's own normalisation. */
export function normaliseData(symbology: Symbology, data: string): string {
  let value = symbology.multiline
    ? data.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/^\n+|\n+$/g, '')
    : data.replace(/[\r\n\t]+/g, ' ').trim();
  if (symbology.uppercase) value = value.toUpperCase();
  if (symbology.compact) value = value.replace(/[\s-]+/g, '');
  return value;
}
