/**
 * Employee ID Card Generator — the card model.
 *
 * The badge maker is deliberately split into a *model* (this file and its siblings) and two thin
 * *renderers* (`svg.ts`, `canvas.ts`). Every template produces the same draw-operation list, and
 * both renderers consume that list, which is what makes the live preview, the PNG, the JPG, the
 * PDF and the server-side SVG the same card rather than five approximations of it.
 *
 * The model never touches the DOM, the clock or the network. Photographs and signatures are handled
 * as data URLs by the caller and are only ever referenced here, so the engine can be unit-tested
 * without a browser and can run identically in the API process.
 */

/** The twelve selectable templates, in the order the reference directory lists them. */
export const CARD_TEMPLATE_IDS = [
  'corporate-split',
  'modern-badge',
  'minimal-centre',
  'signature-wave',
  'creative-panel',
  'startup-frame',
  'gradient-edge',
  'portrait-pass',
  'tech-diagonal',
  'mono-stripe',
  'executive-ribbon',
  'soft-geometry',
] as const;

export type CardTemplateId = (typeof CARD_TEMPLATE_IDS)[number];

export interface CardTemplateMeta {
  id: CardTemplateId;
  name: string;
  /** Shown under the template picker so the choice is not a mystery. */
  blurb: string;
}

export const CARD_TEMPLATES: readonly CardTemplateMeta[] = [
  { id: 'corporate-split', name: 'Corporate Split', blurb: 'Colour panel on the left, details on white.' },
  { id: 'modern-badge', name: 'Modern Badge', blurb: 'Dark card, accent stripe, rounded photo tile.' },
  { id: 'minimal-centre', name: 'Minimal Centre', blurb: 'Centred, quiet, almost no colour.' },
  { id: 'signature-wave', name: 'Signature Wave', blurb: 'Wave band with a signature line.' },
  { id: 'creative-panel', name: 'Creative Panel', blurb: 'Tilted panel and a bold initials block.' },
  { id: 'startup-frame', name: 'Startup Frame', blurb: 'Full frame with corner accents.' },
  { id: 'gradient-edge', name: 'Gradient Edge', blurb: 'Layered edge bands and a ringed photo.' },
  { id: 'portrait-pass', name: 'Portrait Pass', blurb: 'Full-height photo with a lanyard slot.' },
  { id: 'tech-diagonal', name: 'Tech Diagonal', blurb: 'Diagonal cuts, grid texture, technical type.' },
  { id: 'mono-stripe', name: 'Mono Stripe', blurb: 'Monochrome stripes and an ID chip.' },
  { id: 'executive-ribbon', name: 'Executive Ribbon', blurb: 'Ribbon corner, subdued, signature-led.' },
  { id: 'soft-geometry', name: 'Soft Geometry', blurb: 'Rounded blobs and generous spacing.' },
];

/** The eight colour presets. Values are the accent colour; the rest of the palette follows. */
export const CARD_PRESETS = [
  { id: 'salario-green', name: 'Salario Green', accent: '#18BF63', detail: '#0E7A3F' },
  { id: 'corporate-blue', name: 'Corporate Blue', accent: '#155EEF', detail: '#0B3BA8' },
  { id: 'midnight', name: 'Midnight', accent: '#1F2A44', detail: '#0B1220' },
  { id: 'royal-purple', name: 'Royal Purple', accent: '#6D28D9', detail: '#4C1D95' },
  { id: 'bright-orange', name: 'Bright Orange', accent: '#EA580C', detail: '#B23C06' },
  { id: 'crimson', name: 'Crimson', accent: '#C81E3A', detail: '#8C0F26' },
  { id: 'elegant-teal', name: 'Elegant Teal', accent: '#0E7490', detail: '#0A4E60' },
  { id: 'charcoal', name: 'Charcoal', accent: '#334155', detail: '#1E293B' },
] as const;

export type CardPresetId = (typeof CARD_PRESETS)[number]['id'];

/**
 * The four custom colour controls the brief requires, plus the surfaces they paint.
 *
 * `background` and `surface` are separate because a card needs a body colour and a lighter/darker
 * panel derived from it; `surface` is computed from `background` unless the caller overrides it.
 */
export interface CardPalette {
  /** Primary accent — bands, rules, chips, the photo ring. */
  primary: string;
  /** Card body. */
  background: string;
  /** Body text. Contrast against `background` is checked, never assumed. */
  text: string;
  /** Detail accent — secondary rules, labels, the QR frame. */
  detail: string;
}

export interface CardEmployee {
  fullName: string;
  employeeId: string;
  jobTitle: string;
  department: string;
  email: string;
  phone: string;
  bloodGroup: string;
  dateOfJoining: string;
  emergencyContact: string;
  /** Optional card validity window (the issue/expiry dates printed on the badge). */
  validFrom?: string;
  validUntil?: string;
}

export interface CardCompany {
  name: string;
  address: string;
  website: string;
}

export interface CardOptions {
  template: CardTemplateId;
  preset: CardPresetId | 'custom';
  palette: CardPalette;
  orientation: 'landscape' | 'portrait';
  showPhoto: boolean;
  showLogo: boolean;
  showSignature: boolean;
  showQr: boolean;
  qrContent: string;
  showBarcode: boolean;
  barcodeValue: string;
}

export interface CardImages {
  /** Data URL. Validated by `images.ts` before it reaches the model. */
  photo?: string;
  logo?: string;
  signature?: string;
}

/** Everything a renderer needs. Produced by `buildCard()`. */
export interface CardSpec {
  employee: CardEmployee;
  company: CardCompany;
  images: CardImages;
  options: CardOptions;
}

/* ------------------------------------------------------------------ */
/* Draw operations                                                     */
/* ------------------------------------------------------------------ */

export interface DrawRect {
  /**
   * True for decoration that is meant to run off the card edge (a bleeding circle or band).
   * The layout test ignores these when checking that content stays inside the card; everything
   * that is not marked bleeds is required to sit within the card boundary.
   */
  bleed?: boolean;
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
  /**
   * True for decoration that is meant to run off the card edge (a bleeding circle or band).
   * The layout test ignores these when checking that content stays inside the card; everything
   * that is not marked bleeds is required to sit within the card boundary.
   */
  bleed?: boolean;
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
  /**
   * True for decoration that is meant to run off the card edge (a bleeding circle or band).
   * The layout test ignores these when checking that content stays inside the card; everything
   * that is not marked bleeds is required to sit within the card boundary.
   */
  bleed?: boolean;
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
  /**
   * True for decoration that is meant to run off the card edge (a bleeding circle or band).
   * The layout test ignores these when checking that content stays inside the card; everything
   * that is not marked bleeds is required to sit within the card boundary.
   */
  bleed?: boolean;
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

/** A rendered badge face. */
export interface CardFace {
  side: 'front' | 'back';
  width: number;
  height: number;
  ops: DrawOp[];
}

export interface CardLayout {
  front: CardFace;
  back: CardFace;
  warnings: string[];
}

/**
 * CR80 / ISO/IEC 7810 ID-1 geometry, and the pixel size used for exports.
 *
 * The card is 85.60 × 53.98 mm. At 300 dpi that is 1011 × 638 px, which is what a print bureau
 * expects, and it is the size encoded into the exported PNG, JPG and PDF. The preview shrinks it
 * with CSS rather than rendering a smaller card, so what is on screen is the exported artwork.
 */
export const CARD_MM = { width: 85.6, height: 53.98 } as const;

export function cardPixelSize(orientation: 'landscape' | 'portrait'): { width: number; height: number } {
  const landscape = { width: 1011, height: 638 };
  return orientation === 'portrait'
    ? { width: landscape.height, height: landscape.width }
    : { ...landscape };
}

/** Millimetres → PDF points (1 pt = 1/72 in). Used for the print-ready sheet size. */
export function mmToPoints(mm: number): number {
  return (mm * 72) / 25.4;
}
