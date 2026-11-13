/**
 * Imposition: placing finished labels onto printable pages.
 *
 * The rule this module exists to enforce is that artwork is never altered to make it fit. A label
 * carries barcodes drawn at an exact module width; scaling it by even a few percent to squeeze it
 * onto a sheet changes that width, and rotating or clipping it is worse. So imposition either places
 * a label at its true size or refuses and says why:
 *
 *   INVALID_GEOMETRY   the sheet's own measurements are inconsistent
 *   GRID_EXCEEDS_PAGE  the grid of labels does not fit on the page
 *   LABEL_EXCEEDS_CELL a label is larger than the position it would be placed in
 *   LABEL_EXCEEDS_PAGE a label is larger than the page itself
 *   TOO_MANY_PAGES     the job would produce more sheets than one request may
 *
 * Labels fill a sheet row by row, left to right, and continue on further sheets; the number of
 * sheets is always ceil(labels / positions per sheet), counting any positions skipped at the start
 * of the first sheet (for a part-used sheet).
 */

import type { StudioOp, StudioSurface } from '../render/draw-ops';
import type { PdfPageSpec } from '../render/pdf-vector';
import { SHEET_TOLERANCE_MM, fitsSheetPosition, validateSheet, type SheetLayout } from './sheets';

export type ImpositionReason = 'INVALID_GEOMETRY' | 'GRID_EXCEEDS_PAGE' | 'LABEL_EXCEEDS_CELL' | 'LABEL_EXCEEDS_PAGE' | 'TOO_MANY_PAGES';

export class ImpositionError extends Error {
  constructor(
    public readonly reason: ImpositionReason,
    message: string
  ) {
    super(message);
    this.name = 'ImpositionError';
  }
}

export const MAX_SHEETS_PER_JOB = 40;

export interface ImposeOptions {
  /** Positions to leave empty at the start of the first sheet (0-based count). */
  skip?: number;
  /** Draw short cut marks at the corners of every placed item. For plain paper that will be cut. */
  cropMarks?: boolean;
  /** Draw a hairline around every position, to check alignment on plain paper before using labels. */
  outlines?: boolean;
}

export interface ImposeResult {
  pages: PdfPageSpec[];
  perSheet: number;
  sheets: number;
  placed: number;
}

function mm(value: number): string {
  return `${Math.round(value * 100) / 100}`;
}

/**
 * Cut marks for a grid of same-sized items.
 *
 * Marks are drawn only in the margin outside the grid, in line with every cut. Marks at each item's
 * own corners would land on the neighbouring item wherever two items share a cut line.
 */
function gridCropMarks(sheet: SheetLayout, itemWidth: number, itemHeight: number): StudioOp[] {
  const gap = 1.5;
  const length = 3.5;
  const insetX = (sheet.labelWidth - itemWidth) / 2;
  const insetY = (sheet.labelHeight - itemHeight) / 2;
  const left = sheet.marginLeft + insetX;
  const top = sheet.marginTop + insetY;
  const right = sheet.marginLeft + (sheet.columns - 1) * sheet.pitchX + insetX + itemWidth;
  const bottom = sheet.marginTop + (sheet.rows - 1) * sheet.pitchY + insetY + itemHeight;
  const mark = (x1: number, y1: number, x2: number, y2: number): StudioOp => ({ kind: 'line', x1, y1, x2, y2, color: '#000000', width: 0.1 });
  const ops: StudioOp[] = [];
  for (let column = 0; column < sheet.columns; column += 1) {
    const x0 = sheet.marginLeft + column * sheet.pitchX + insetX;
    for (const x of [x0, x0 + itemWidth]) {
      ops.push(mark(x, top - gap - length, x, top - gap));
      ops.push(mark(x, bottom + gap, x, bottom + gap + length));
    }
  }
  for (let row = 0; row < sheet.rows; row += 1) {
    const y0 = sheet.marginTop + row * sheet.pitchY + insetY;
    for (const y of [y0, y0 + itemHeight]) {
      ops.push(mark(left - gap - length, y, left - gap, y));
      ops.push(mark(right + gap, y, right + gap + length, y));
    }
  }
  return ops;
}

/**
 * Place `surfaces` onto sheets, one per position, in order.
 *
 * A surface smaller than its position is centred in it, which is the right behaviour for a symbol on
 * a larger label. A surface larger than its position is refused.
 */
export function imposeOnSheet(surfaces: readonly StudioSurface[], sheet: SheetLayout, options: ImposeOptions = {}): ImposeResult {
  const problem = validateSheet(sheet);
  if (problem) {
    const reason: ImpositionReason = /page/.test(problem) ? 'GRID_EXCEEDS_PAGE' : 'INVALID_GEOMETRY';
    throw new ImpositionError(reason, `This sheet layout cannot be used: ${problem}.`);
  }
  if (surfaces.length === 0) throw new ImpositionError('INVALID_GEOMETRY', 'There is nothing to place on the sheet.');

  const perSheet = sheet.columns * sheet.rows;
  const skip = Math.max(0, Math.floor(options.skip ?? 0));
  if (skip >= perSheet) {
    throw new ImpositionError('INVALID_GEOMETRY', `The first label cannot start at position ${skip + 1}: this sheet has ${perSheet} positions.`);
  }

  for (const surface of surfaces) {
    if (surface.width > sheet.page.width + SHEET_TOLERANCE_MM || surface.height > sheet.page.height + SHEET_TOLERANCE_MM) {
      throw new ImpositionError(
        'LABEL_EXCEEDS_PAGE',
        `A ${mm(surface.width)} × ${mm(surface.height)} mm label is larger than the ${mm(sheet.page.width)} × ${mm(sheet.page.height)} mm page. Choose a larger page or print one label per page.`
      );
    }
    if (!fitsSheetPosition(sheet, surface.width, surface.height)) {
      throw new ImpositionError(
        'LABEL_EXCEEDS_CELL',
        `A ${mm(surface.width)} × ${mm(surface.height)} mm label does not fit the ${mm(sheet.labelWidth)} × ${mm(sheet.labelHeight)} mm positions on this sheet. It is not scaled to fit, because that would change its barcodes. Choose a sheet with larger labels.`
      );
    }
  }

  const sheets = Math.ceil((surfaces.length + skip) / perSheet);
  if (sheets > MAX_SHEETS_PER_JOB) {
    throw new ImpositionError('TOO_MANY_PAGES', `This job needs ${sheets} sheets; one request is limited to ${MAX_SHEETS_PER_JOB}. Print it in smaller batches.`);
  }

  const pages: PdfPageSpec[] = [];
  for (let sheetIndex = 0; sheetIndex < sheets; sheetIndex += 1) {
    pages.push({ width: sheet.page.width, height: sheet.page.height, placements: [], overlay: [] });
  }

  if (options.outlines) {
    for (const page of pages) {
      for (let row = 0; row < sheet.rows; row += 1) {
        for (let column = 0; column < sheet.columns; column += 1) {
          page.overlay?.push({
            kind: 'rect',
            x: sheet.marginLeft + column * sheet.pitchX,
            y: sheet.marginTop + row * sheet.pitchY,
            w: sheet.labelWidth,
            h: sheet.labelHeight,
            stroke: '#9aa3ad',
            strokeWidth: 0.1,
          });
        }
      }
    }
  }

  surfaces.forEach((surface, index) => {
    const position = index + skip;
    const page = pages[Math.floor(position / perSheet)] as PdfPageSpec;
    const slot = position % perSheet;
    const column = slot % sheet.columns;
    const row = Math.floor(slot / sheet.columns);
    const cellX = sheet.marginLeft + column * sheet.pitchX;
    const cellY = sheet.marginTop + row * sheet.pitchY;
    // Centre within the position. A label a fraction larger than a rounded inch-based position is
    // centred too, so the overhang is shared and stays within the tolerance on each side.
    const x = cellX + (sheet.labelWidth - surface.width) / 2;
    const y = cellY + (sheet.labelHeight - surface.height) / 2;
    page.placements.push({ surface, x, y });
  });

  if (options.cropMarks) {
    const first = surfaces[0] as StudioSurface;
    const marks = gridCropMarks(sheet, first.width, first.height);
    for (const page of pages) page.overlay?.push(...marks);
  }

  return { pages, perSheet, sheets, placed: surfaces.length };
}

/** One page per surface, each page exactly the size of its surface: the form label printers expect. */
export function onePerPage(surfaces: readonly StudioSurface[]): PdfPageSpec[] {
  if (surfaces.length === 0) throw new ImpositionError('INVALID_GEOMETRY', 'There is nothing to print.');
  return surfaces.map((surface) => ({ width: surface.width, height: surface.height, placements: [{ surface, x: 0, y: 0 }] }));
}
