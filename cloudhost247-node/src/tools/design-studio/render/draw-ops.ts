/**
 * The shared draw-operation contract.
 *
 * Every renderer in the platform — SVG, PNG, and the vector PDF backend — consumes this one list of
 * primitives. That is deliberate: it is what makes a preview, a download and a print the same
 * artwork rather than three approximations of it.
 *
 * Extracted verbatim from `business/id-card/types.ts` so the label, shipping-label and
 * business-card tools can share it instead of growing their own renderers. The declaration text is
 * unchanged; only its location moved, and `id-card/types.ts` re-exports it, so no importer changed.
 *
 * `Surface` is the general form: any rectangular area in millimetres with draw operations on it.
 * A card face is one specific surface (fixed ID-1 geometry, with a `side`).
 */

/* ------------------------------------------------------------------ */
/* Draw operations                                                     */
/* ------------------------------------------------------------------ */

export interface DrawRect {
  kind: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
  opacity?: number;
}

export interface DrawCircle {
  kind: 'circle';
  cx: number;
  cy: number;
  r: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
}

export interface DrawPolygon {
  kind: 'polygon';
  points: Array<{ x: number; y: number }>;
  fill?: string;
  opacity?: number;
}

export interface DrawLine {
  kind: 'line';
  opacity?: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
  dash?: number[];
}

export interface DrawText {
  kind: 'text';
  x: number;
  y: number;
  text: string;
  /** Font size in card pixels (the card is rendered at 300 dpi). */
  size: number;
  color: string;
  weight?: '400' | '600' | '700' | '800';
  family?: 'sans' | 'mono';
  anchor?: 'start' | 'middle' | 'end';
  /** When set, the renderer shrinks the text until it fits instead of letting it run off the card. */
  maxWidth?: number;
  letterSpacing?: number;
  opacity?: number;
  /** Uppercase label with wide tracking, the convention for badge field names. */
  tracking?: boolean;
}

export interface DrawImage {
  kind: 'image';
  opacity?: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Data URL, or empty for a drawn placeholder. */
  href?: string;
  fit: 'cover' | 'contain';
  radius?: number;
  /** Drawn when `href` is missing so a card never shows a hole. */
  placeholder?: { label: string; fill: string; color: string };
  stroke?: string;
  strokeWidth?: number;
}

export interface DrawQr {
  kind: 'qr';
  x: number;
  y: number;
  size: number;
  payload: string;
  dark: string;
  light: string;
}

export interface DrawBarcode {
  kind: 'barcode';
  x: number;
  y: number;
  w: number;
  h: number;
  value: string;
  dark: string;
  light: string;
  /** Drawn under the bars; the human-readable line of a Code 128 symbol. */
  caption?: boolean;
}

export type DrawOp =
  | DrawRect
  | DrawCircle
  | DrawPolygon
  | DrawLine
  | DrawText
  | DrawImage
  | DrawQr
  | DrawBarcode;

/**
 * Any rectangular drawing surface, in millimetres.
 *
 * `width`/`height` are the physical size of the surface, and the coordinates inside `ops` are in the
 * same units, so a renderer never has to guess a scale factor.
 */
export interface Surface {
  width: number;
  height: number;
  ops: DrawOp[];
}
