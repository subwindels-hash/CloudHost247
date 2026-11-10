/**
 * Design Studio — measurement, paper and print geometry.
 *
 * Every number in this module is millimetres-first. That is the only way a label tool can be
 * honest about print output: the browser does not know what a millimetre is on the user's printer,
 * but the PDF does, so the model keeps millimetres as the single source and converts once, at the
 * edge (PDF points for the page, pixels only for screen preview and PNG exports at a declared dpi).
 *
 * The module is pure: no DOM, no clock, no network. It is imported by the browser bundle, by the
 * API and by the test suite, and the same input always produces the same geometry.
 */

/** Millimetres per unit. `px` is the CSS reference pixel (96 dpi), which is what a screen shows. */
export const MM_PER_UNIT = { mm: 1, cm: 10, in: 25.4, px: 25.4 / 96 } as const;

export type LengthUnit = keyof typeof MM_PER_UNIT;

export const LENGTH_UNITS: readonly LengthUnit[] = ['mm', 'cm', 'in', 'px'];

export const LENGTH_UNIT_LABELS: Record<LengthUnit, string> = {
  mm: 'Millimetres (mm)',
  cm: 'Centimetres (cm)',
  in: 'Inches (in)',
  px: 'Pixels (px)',
};

/** Convert a user-entered length to millimetres. Unknown units are treated as millimetres. */
export function toMillimetres(value: number, unit: LengthUnit = 'mm'): number {
  if (!Number.isFinite(value)) return 0;
  return value * (MM_PER_UNIT[unit] ?? 1);
}

/** Convert millimetres to a display unit, rounded to 4 decimals so the UI never shows 12.0000001. */
export function fromMillimetres(mm: number, unit: LengthUnit = 'mm'): number {
  if (!Number.isFinite(mm)) return 0;
  const value = mm / (MM_PER_UNIT[unit] ?? 1);
  return Math.round(value * 10_000) / 10_000;
}

/** PDF points: 1 pt = 1/72 in = 25.4/72 mm. */
export function mmToPoints(mm: number): number {
  return (mm * 72) / 25.4;
}

/** Pixels at a declared resolution. 300 dpi is the print standard used throughout this module. */
export function mmToPixels(mm: number, dpi = 300): number {
  return Math.round((mm / 25.4) * dpi);
}

/** Pixels → millimetres at a declared resolution. Used when reading an uploaded image's size. */
export function pixelsToMillimetres(px: number, dpi = 300): number {
  return (px / dpi) * 25.4;
}

export const DEFAULT_DPI = 300;

/** A page or label size in millimetres. */
export interface SizeMm {
  width: number;
  height: number;
}

/**
 * Named paper and label-stock sizes, in millimetres.
 *
 * The label-sheet entries describe the *pitch* (label + gutter) rather than a marketing name,
 * because that is what determines whether a print lands on the die-cut. Sizes are the ISO 216
 * series (A4/A5/A6), the two North-American sizes this platform sees most often, and three
 * standard label sheets.
 */
export interface PaperSize extends SizeMm {
  id: string;
  name: string;
  /** True when the size is a die-cut label sheet rather than a plain sheet of paper. */
  labelSheet?: boolean;
  /** Columns × rows on a label sheet. */
  columns?: number;
  rows?: number;
  /** Gutter between labels, and the sheet margin, in millimetres. */
  gutter?: number;
  margin?: number;
}

export const PAPER_SIZES: readonly PaperSize[] = [
  { id: 'a4', name: 'A4 — 210 × 297 mm', width: 210, height: 297 },
  { id: 'a5', name: 'A5 — 148 × 210 mm', width: 148, height: 210 },
  { id: 'a6', name: 'A6 — 105 × 148 mm', width: 105, height: 148 },
  { id: 'letter', name: 'US Letter — 215.9 × 279.4 mm', width: 215.9, height: 279.4 },
  { id: 'legal', name: 'US Legal — 215.9 × 355.6 mm', width: 215.9, height: 355.6 },
  {
    id: 'label-a4-3x8', name: 'A4 label sheet — 3 × 8 (63.5 × 33.9 mm)', width: 210, height: 297,
    labelSheet: true, columns: 3, rows: 8, gutter: 2.5, margin: 7,
  },
  {
    id: 'label-a4-2x7', name: 'A4 label sheet — 2 × 7 (99.1 × 38.1 mm)', width: 210, height: 297,
    labelSheet: true, columns: 2, rows: 7, gutter: 2.5, margin: 4.7,
  },
  {
    id: 'label-a4-4x10', name: 'A4 label sheet — 4 × 10 (48.3 × 25.4 mm)', width: 210, height: 297,
    labelSheet: true, columns: 4, rows: 10, gutter: 2, margin: 6,
  },
  { id: 'label-100x150', name: 'Thermal label — 100 × 150 mm', width: 100, height: 150 },
  { id: 'label-100x50', name: 'Thermal label — 100 × 50 mm', width: 100, height: 50 },
  { id: 'vda-a5', name: 'VDA-4902 master label — 210 × 148 mm', width: 210, height: 148 },
  { id: 'vda-klt', name: 'VDA-4902 KLT label — 210 × 74 mm', width: 210, height: 74 },
  { id: 'business-card', name: 'Business card — 85 × 55 mm', width: 85, height: 55 },
  { id: 'business-card-us', name: 'US business card — 88.9 × 50.8 mm', width: 88.9, height: 50.8 },
];

export function paperSize(id: string): PaperSize | undefined {
  return PAPER_SIZES.find((size) => size.id === id);
}

/** One label position on a sheet, in millimetres from the sheet's top-left corner. */
export interface SlotRect extends SizeMm {
  x: number;
  y: number;
  /** 0-based position on the sheet. */
  index: number;
}

export interface SheetGridOptions {
  sheet: SizeMm;
  label: SizeMm;
  margin: number;
  gutter: number;
  columns: number;
  rows: number;
  /** Rotate each label 90° inside its slot when the slot is wider than it is tall. */
  rotate?: boolean;
}

/**
 * Compute the per-label rectangles for a sheet.
 *
 * Deliberately *does not* stretch the label to fill the sheet: a 63.5 mm label printed in a
 * 65 mm slot is correct, a 63.5 mm label scaled to 65 mm is a label that no longer lines up with
 * the die-cut. The caller gets the true label size and the leftover space stays blank.
 */
export function sheetGrid(options: SheetGridOptions): SlotRect[] {
  const columns = Math.max(1, Math.floor(options.columns));
  const rows = Math.max(1, Math.floor(options.rows));
  const slots: SlotRect[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      slots.push({
        x: options.margin + column * (options.label.width + options.gutter),
        y: options.margin + row * (options.label.height + options.gutter),
        width: options.label.width,
        height: options.label.height,
        index: row * columns + column,
      });
    }
  }
  return slots;
}

/** How many labels a sheet holds, given the grid. Always at least 1. */
export function labelsPerSheet(sheet: PaperSize): number {
  return Math.max(1, (sheet.columns ?? 1) * (sheet.rows ?? 1));
}

/**
 * Effective label size of a named label sheet, in millimetres.
 *
 * Derived from the sheet geometry rather than hard-coded a second time, so a sheet and its label
 * size can never disagree. Returns `null` for a plain sheet, where the caller supplies the size.
 */
export function labelSizeOfSheet(sheet: PaperSize): SizeMm | null {
  if (!sheet.labelSheet || !sheet.columns || !sheet.rows) return null;
  const margin = sheet.margin ?? 0;
  const gutter = sheet.gutter ?? 0;
  const width = (sheet.width - margin * 2 - gutter * (sheet.columns - 1)) / sheet.columns;
  const height = (sheet.height - margin * 2 - gutter * (sheet.rows - 1)) / sheet.rows;
  return { width: Math.round(width * 100) / 100, height: Math.round(height * 100) / 100 };
}

/** Orientation is a view on the size, never a second dimension pair. */
export function orient(size: SizeMm, orientation: 'portrait' | 'landscape'): SizeMm {
  if (orientation === 'portrait') return size;
  return { width: Math.max(size.width, size.height), height: Math.min(size.width, size.height) };
}

/**
 * The minimum module size (mm) a symbology needs to scan reliably, used by warnings.
 *
 * These are engineering judgement, not standards: the standards give X-dimension *ranges* by
 * application (retail, logistics, direct part marking) and a printed code below the low end of its
 * application's range is out of specification even if a modern phone still reads it. The values
 * here are the commonly cited practical floors and the UI is worded accordingly.
 */
export const MIN_MODULE_MM = {
  ean: 0.264,
  upc: 0.264,
  code128: 0.25,
  code39: 0.19,
  datamatrix: 0.3,
  qr: 0.4,
  pdf417: 0.3,
} as const;
