/**
 * Design Studio — the draw-op model.
 *
 * Every document in this module (a barcode, a label sheet, a VDA label, a shipping label, a
 * business card) is reduced to one flat list of `DrawOp`s in millimetres, positioned from the
 * top-left corner of a page. The SVG renderer, the PDF renderer, the canvas preview and the tests
 * all read that same list.
 *
 * Two consequences worth stating, because they are the reason this exists:
 *
 *  1. **The preview is the export.** There is no separate "draw it for the screen" path, so a
 *     layout bug cannot appear in one output and not another.
 *  2. **A document is data, not a picture.** The API can return the ops (or an SVG/PDF built from
 *     them) and a saved template can be re-rendered years later without the app that made it.
 */

import type { EncodedBarcode, EncodedQr } from './barcode-engine';

/** Font families a document may use. Restricted to fonts a PDF reader can render without embedding. */
export type FontFamily = 'sans' | 'sans-bold' | 'mono' | 'serif';

export const FONT_FAMILIES: Record<FontFamily, { label: string; css: string }> = {
  sans: { label: 'Sans-serif (Helvetica)', css: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  'sans-bold': { label: 'Sans-serif bold', css: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  mono: { label: 'Monospace (Courier)', css: "'DejaVu Sans Mono', 'Courier New', monospace" },
  serif: { label: 'Serif (Times)', css: "'Times New Roman', Times, serif" },
};

export type HorizontalAlign = 'left' | 'center' | 'right';

/** Rounded-rectangle or plain rectangle, filled and/or stroked. All values in millimetres. */
export interface DrawRect {
  kind: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
  radius?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  /** 0–1. */
  opacity?: number;
}

/** A single line of text. `y` is the *top* of the text box; the renderer positions the baseline. */
export interface DrawText {
  kind: 'text';
  x: number;
  y: number;
  text: string;
  /** Font size in millimetres (point size ≈ size × 2.835). */
  size: number;
  family: FontFamily;
  color: string;
  align?: HorizontalAlign;
  /** When set, the renderer measures and shrinks the text until it fits. */
  maxWidth?: number;
  /** Extra space between characters, in millimetres. */
  letterSpacing?: number;
  /** 0–1. */
  opacity?: number;
  /** Small caps-style upper-casing applied by the layout engine, never by the renderer. */
  bold?: boolean;
}

/** A block of pre-wrapped lines; the engine wraps, the renderer obeys. */
export interface DrawLines {
  kind: 'lines';
  x: number;
  y: number;
  lines: string[];
  size: number;
  family: FontFamily;
  color: string;
  /** Baseline-to-baseline distance in millimetres. */
  lineHeight: number;
  align?: HorizontalAlign;
  maxWidth?: number;
}

/** An image placed in a box. Either `contain` (letterbox) or `cover` (crop). */
export interface DrawImage {
  kind: 'image';
  x: number;
  y: number;
  w: number;
  h: number;
  /** Base64 data URL (raster only — SVG uploads are refused by validation). */
  href: string;
  fit?: 'contain' | 'cover' | 'fill';
  /** Fully rounded corners, for logos in circles. */
  radius?: number;
  opacity?: number;
}

/** A linear barcode or 2D symbol drawn from pre-computed geometry. */
export interface DrawBarcode {
  kind: 'barcode';
  x: number;
  y: number;
  /** Total footprint in millimetres, including quiet zone and the human-readable line. */
  w: number;
  h: number;
  /** Physical width of one narrow bar / module, in millimetres (the X-dimension). */
  moduleMm: number;
  encoded: EncodedBarcode;
  colour: string;
  background?: string;
  /** Reserved space under the bars for the human-readable line, in millimetres. */
  textHeight?: number;
  showText: boolean;
  /** Quiet zone on each side, in millimetres — already included in `w` and `h`. */
  quietMm: number;
}

/** A matrix symbol (QR, Data Matrix, Aztec) drawn module by module. */
export interface DrawSymbol {
  kind: 'symbol';
  x: number;
  y: number;
  /** Edge length of the symbol in millimetres, quiet zone included. */
  size: number;
  /** Quiet-zone width in modules (already inside `size`). */
  quietModules: number;
  /** Row-major matrix, true = dark. Null when the symbol is a barcode geometry instead. */
  matrix: boolean[][];
  /** Payload, kept in the document so a rendered file states what it encodes. */
  payload: string;
  colour: string;
  background?: string;
  /** QR version/module count for the note printed under the document. */
  modules: number;
}

/** A horizontal or vertical rule. */
export interface DrawRule {
  kind: 'rule';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  colour: string;
  width: number;
  dashed?: boolean;
}

export type DrawOp = DrawRect | DrawText | DrawLines | DrawImage | DrawBarcode | DrawSymbol | DrawRule;

/** One page of a document: physical size plus its operations. */
export interface DocumentPage {
  /** Page size in millimetres. */
  width: number;
  height: number;
  ops: DrawOp[];
  /** Human label for the page, used in PDF metadata and the print preview. */
  label?: string;
}

export interface DesignDocument {
  title: string;
  subject?: string;
  author?: string;
  /** Creator string recorded in the PDF metadata. */
  creator?: string;
  pages: DocumentPage[];
  warnings: string[];
}

/** Convenience: total number of ops across all pages (used in tests and the preview badge). */
export function countOps(document: DesignDocument): number {
  return document.pages.reduce((total, page) => total + page.ops.length, 0);
}

/** True when the document contains at least one machine-readable symbol. */
export function hasMachineReadableSymbol(document: DesignDocument): boolean {
  return document.pages.some((page) => page.ops.some((op) => op.kind === 'barcode' || op.kind === 'symbol'));
}

/** Build a QR `DrawSymbol` from an `EncodedQr`, at a physical size in millimetres. */
export function symbolFromQr(
  qr: EncodedQr,
  box: { x: number; y: number; size: number },
  style: { colour: string; background?: string; quietModules?: number }
): DrawSymbol {
  return {
    kind: 'symbol',
    x: box.x,
    y: box.y,
    size: box.size,
    quietModules: style.quietModules ?? 4,
    matrix: qr.matrix,
    payload: qr.payload,
    colour: style.colour,
    background: style.background,
    modules: qr.modules,
  };
}
