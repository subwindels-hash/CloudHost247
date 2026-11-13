/**
 * Paper sizes and label-sheet geometry.
 *
 * A sheet layout is nothing more than measurements: how many labels across and down, how big each
 * one is, and where the first one starts. The presets below are common die-cut formats, plus a few
 * plain-paper layouts for labels that are cut out, described by those measurements alone — no
 * manufacturer codes — because the measurements are what has to match the pack in the printer, and
 * they are printed on every pack.
 *
 * Pure data, shared by the API and the browser.
 */

export interface PageSize {
  id: string;
  label: string;
  /** Millimetres, portrait. */
  width: number;
  height: number;
}

export const PAGE_SIZES: readonly PageSize[] = [
  { id: 'a4', label: 'A4 (210 × 297 mm)', width: 210, height: 297 },
  { id: 'letter', label: 'US Letter (8.5 × 11 in)', width: 215.9, height: 279.4 },
];

export function pageSize(id: string): PageSize | undefined {
  return PAGE_SIZES.find((page) => page.id === id);
}

export interface SheetLayout {
  id: string;
  label: string;
  page: PageSize;
  columns: number;
  rows: number;
  /** One label's size in millimetres. */
  labelWidth: number;
  labelHeight: number;
  /** Top-left corner of the first label. */
  marginLeft: number;
  marginTop: number;
  /** Distance between the left edges of neighbouring columns, and the top edges of neighbouring rows. */
  pitchX: number;
  pitchY: number;
}

const A4 = PAGE_SIZES[0] as PageSize;
const LETTER = PAGE_SIZES[1] as PageSize;

/**
 * Die-cut label sheets, by geometry. Every entry is checked by `validateSheet()` in the test suite:
 * a preset that ran off its page would be a preset that prints half a label.
 */
export const LABEL_SHEETS: readonly SheetLayout[] = [
  { id: 'a4-3x8-70x37', label: 'A4 · 24 labels · 70 × 37 mm (3 × 8)', page: A4, columns: 3, rows: 8, labelWidth: 70, labelHeight: 37, marginLeft: 0, marginTop: 0.5, pitchX: 70, pitchY: 37 },
  { id: 'a4-3x7-63x38', label: 'A4 · 21 labels · 63.5 × 38.1 mm (3 × 7)', page: A4, columns: 3, rows: 7, labelWidth: 63.5, labelHeight: 38.1, marginLeft: 7.2, marginTop: 15.15, pitchX: 66, pitchY: 38.1 },
  { id: 'a4-2x7-99x38', label: 'A4 · 14 labels · 99.1 × 38.1 mm (2 × 7)', page: A4, columns: 2, rows: 7, labelWidth: 99.1, labelHeight: 38.1, marginLeft: 4.65, marginTop: 15.15, pitchX: 101.6, pitchY: 38.1 },
  { id: 'a4-2x4-99x67', label: 'A4 · 8 labels · 99.1 × 67.7 mm (2 × 4)', page: A4, columns: 2, rows: 4, labelWidth: 99.1, labelHeight: 67.7, marginLeft: 4.65, marginTop: 13.1, pitchX: 101.6, pitchY: 67.7 },
  { id: 'a4-5x13-38x21', label: 'A4 · 65 labels · 38.1 × 21.2 mm (5 × 13)', page: A4, columns: 5, rows: 13, labelWidth: 38.1, labelHeight: 21.2, marginLeft: 4.75, marginTop: 10.7, pitchX: 40.6, pitchY: 21.2 },
  { id: 'a4-2x2-105x148', label: 'A4 · 4 labels · 105 × 148 mm (2 × 2, A6)', page: A4, columns: 2, rows: 2, labelWidth: 105, labelHeight: 148.5, marginLeft: 0, marginTop: 0, pitchX: 105, pitchY: 148.5 },
  { id: 'a4-1x2-210x148', label: 'A4 · 2 labels · 210 × 148 mm (1 × 2, A5)', page: A4, columns: 1, rows: 2, labelWidth: 210, labelHeight: 148.5, marginLeft: 0, marginTop: 0, pitchX: 210, pitchY: 148.5 },
  { id: 'a4-1x4-210x74', label: 'A4 · 4 labels · 210 × 74 mm (1 × 4)', page: A4, columns: 1, rows: 4, labelWidth: 210, labelHeight: 74.25, marginLeft: 0, marginTop: 0, pitchX: 210, pitchY: 74.25 },
  { id: 'letter-3x10-2.625x1', label: 'Letter · 30 labels · 2⅝ × 1 in (3 × 10)', page: LETTER, columns: 3, rows: 10, labelWidth: 66.675, labelHeight: 25.4, marginLeft: 4.7625, marginTop: 12.7, pitchX: 69.85, pitchY: 25.4 },
  { id: 'letter-2x5-4x2', label: 'Letter · 10 labels · 4 × 2 in (2 × 5)', page: LETTER, columns: 2, rows: 5, labelWidth: 101.6, labelHeight: 50.8, marginLeft: 3.96875, marginTop: 12.7, pitchX: 106.3625, pitchY: 50.8 },
  { id: 'letter-2x3-4x3.33', label: 'Letter · 6 labels · 4 × 3⅓ in (2 × 3)', page: LETTER, columns: 2, rows: 3, labelWidth: 101.6, labelHeight: 84.667, marginLeft: 3.96875, marginTop: 12.7, pitchX: 106.3625, pitchY: 84.667 },
  { id: 'letter-2x1-4x6', label: 'Letter · 2 labels · 4 × 6 in (2 × 1)', page: LETTER, columns: 2, rows: 1, labelWidth: 101.6, labelHeight: 152.4, marginLeft: 4.7625, marginTop: 12.7, pitchX: 104.775, pitchY: 152.4 },
  { id: 'letter-1x2-8.5x5.5', label: 'Letter · 2 labels · 8½ × 5½ in (1 × 2)', page: LETTER, columns: 1, rows: 2, labelWidth: 215.9, labelHeight: 139.7, marginLeft: 0, marginTop: 0, pitchX: 215.9, pitchY: 139.7 },
];

export function labelSheet(id: string): SheetLayout | undefined {
  return LABEL_SHEETS.find((sheet) => sheet.id === id);
}

/** Why a sheet's own measurements are inconsistent, or null when they are sound. */
export function validateSheet(sheet: SheetLayout): string | null {
  const numbers = [sheet.columns, sheet.rows, sheet.labelWidth, sheet.labelHeight, sheet.marginLeft, sheet.marginTop, sheet.pitchX, sheet.pitchY];
  if (numbers.some((value) => !Number.isFinite(value))) return 'a measurement is not a number';
  if (!Number.isInteger(sheet.columns) || !Number.isInteger(sheet.rows) || sheet.columns < 1 || sheet.rows < 1) return 'the grid needs at least one whole row and column';
  if (sheet.labelWidth <= 0 || sheet.labelHeight <= 0) return 'a label has no area';
  if (sheet.marginLeft < 0 || sheet.marginTop < 0) return 'a margin is negative';
  if (sheet.columns > 1 && sheet.pitchX < sheet.labelWidth - 1e-6) return 'neighbouring columns overlap';
  if (sheet.rows > 1 && sheet.pitchY < sheet.labelHeight - 1e-6) return 'neighbouring rows overlap';
  const right = sheet.marginLeft + (sheet.columns - 1) * sheet.pitchX + sheet.labelWidth;
  const bottom = sheet.marginTop + (sheet.rows - 1) * sheet.pitchY + sheet.labelHeight;
  // A hundredth of a millimetre of slack absorbs inch-to-millimetre rounding in the presets.
  if (right > sheet.page.width + 0.01) return 'the grid is wider than the page';
  if (bottom > sheet.page.height + 0.01) return 'the grid is taller than the page';
  return null;
}

/** Slack for comparing sizes: inch-based sheets and millimetre-based labels differ by rounding. */
export const SHEET_TOLERANCE_MM = 0.3;

/**
 * Whether an item of this size can be placed, at its true size, in one position of the sheet.
 * Imposition applies this rule, and the forms use it to offer only the papers a label fits.
 */
export function fitsSheetPosition(sheet: SheetLayout, width: number, height: number): boolean {
  return width <= sheet.labelWidth + SHEET_TOLERANCE_MM && height <= sheet.labelHeight + SHEET_TOLERANCE_MM;
}

/**
 * A grid for cut-to-size items (business cards, tags) on a plain page: the items are centred, share
 * cut lines when `gap` is 0, and the page keeps at least `minMargin` of unprinted edge.
 */
export function centredGrid(page: PageSize, itemWidth: number, itemHeight: number, gap: number, minMargin: number): SheetLayout | null {
  const columns = Math.floor((page.width - 2 * minMargin + gap) / (itemWidth + gap));
  const rows = Math.floor((page.height - 2 * minMargin + gap) / (itemHeight + gap));
  if (columns < 1 || rows < 1) return null;
  const usedWidth = columns * itemWidth + (columns - 1) * gap;
  const usedHeight = rows * itemHeight + (rows - 1) * gap;
  return {
    id: `${page.id}-grid-${columns}x${rows}`,
    label: `${page.label} · ${columns * rows} per sheet (${columns} × ${rows})`,
    page,
    columns,
    rows,
    labelWidth: itemWidth,
    labelHeight: itemHeight,
    marginLeft: (page.width - usedWidth) / 2,
    marginTop: (page.height - usedHeight) / 2,
    pitchX: itemWidth + gap,
    pitchY: itemHeight + gap,
  };
}
