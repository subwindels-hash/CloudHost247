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

/* ------------------------------------------------------------------ */
/* Design Studio additions                                             */
/* ------------------------------------------------------------------ */

/**
 * One segment of a vector outline, in the surface's own units (millimetres), y pointing down.
 *
 * `Q` is a quadratic and `C` a cubic Bézier, with the same control-point order SVG uses. `Z` closes
 * the current sub-path. Every coordinate is absolute, which is what lets one list be written as an
 * SVG `d` attribute and as PDF path operators without a second interpretation step.
 */
export type PathSegment =
  | { type: 'M'; x: number; y: number }
  | { type: 'L'; x: number; y: number }
  | { type: 'Q'; cx: number; cy: number; x: number; y: number }
  | { type: 'C'; c1x: number; c1y: number; c2x: number; c2y: number; x: number; y: number }
  | { type: 'Z' };

/**
 * A filled vector outline.
 *
 * Added for the Design Studio tools: a 2D symbol is a set of joined module regions and a symbol's
 * human-readable line is a set of glyph outlines, and neither is expressible as rectangles without
 * either losing the shape or emitting thousands of them. It is deliberately *not* a member of
 * `DrawOp`: the ID-card renderers switch over that union, and widening it would change a shipped
 * tool. The studio renderers accept `StudioOp`, which is the union below.
 */
export interface DrawPath {
  kind: 'path';
  segments: PathSegment[];
  fill: string;
  /** Module regions are drawn even-odd (holes are cut by containment); glyphs are non-zero. */
  fillRule?: 'nonzero' | 'evenodd';
  opacity?: number;
}

/** Everything a Design Studio surface may contain. QR and Code 128 ops are expanded before this. */
export type StudioOp = DrawRect | DrawCircle | DrawPolygon | DrawLine | DrawText | DrawImage | DrawPath;

/**
 * A Design Studio surface: physical size in millimetres, operations in millimetres.
 *
 * Text sizes on a studio surface are the font size (the em square) in millimetres, not card pixels.
 */
export interface StudioSurface {
  width: number;
  height: number;
  ops: StudioOp[];
  /** Painted behind the operations. Omitted means transparent in SVG and white on a PDF page. */
  background?: string;
}
