/**
 * Label Designer — the document model.
 *
 * A label document is data: a size, a set of elements in millimetres, and the sheet it prints on.
 * It contains no draw calls and no HTML, which is what lets the same document render to a browser
 * preview, an SVG file, a PDF sheet and a CSV batch, and what lets a saved template stay valid after
 * the editor changes.
 *
 * ## Coordinate system
 *
 * Element positions are millimetres from the **top-left of the label**, not the page. Padding,
 * sheet margins and the label's slot on a sheet are applied by the layout engine (`layout.ts`), so
 * moving a label to a different sheet never moves the elements inside it.
 *
 * ## Why elements are a discriminated union
 *
 * Each element type carries only the fields it uses — a barcode has a format and a payload, static
 * text has content and a font. That keeps validation honest (there is no such thing as a "text
 * element with an invalid barcode payload") and makes the editor's property panel a function of the
 * element's `kind` rather than a pile of conditionals.
 */

import type { FontFamily, HorizontalAlign } from '../shared/draw-ops';
import type { BarcodeFormat, BarcodeUseCase, BarcodeFamily } from '../shared/barcode-catalog';
import type { ErrorCorrection } from '../barcode/generator';

export type ElementKind = 'text' | 'field' | 'barcode' | 'symbol' | 'image' | 'rect' | 'line';

/** Fields whose value comes from a data row (CSV, a shipping record, a VDA field). */
export interface DataBinding {
  /**
   * The key looked up in the label's data row. Empty for static content.
   *
   * Bindings are resolved by `resolveLabelData`: a row value wins, then the document's own
   * `values`, then the element's fallback. That order is what makes "print a preview with the
   * example data, then print a batch with the real data" work without changing the template.
   */
  key?: string;
  /** What to print when neither the row nor the document supplies a value. */
  fallback?: string;
}

export interface ElementBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface BaseElement extends ElementBox {
  id: string;
  /** Human name shown in the layer list. */
  name: string;
  /** Hidden elements stay in the template but print nothing. */
  visible: boolean;
  /** 0–1. Applied by the renderers. */
  opacity?: number;
  /** Rotation in degrees, clockwise. Only 0/90/180/270 are offered by the editor. */
  rotation?: 0 | 90 | 180 | 270;
}

export interface TextStyle {
  size: number;
  family: FontFamily;
  colour: string;
  align: HorizontalAlign;
  /** Extra letter spacing, in millimetres. */
  letterSpacing?: number;
  /** Uppercase the value at render time (a display transform, never a data mutation). */
  uppercase?: boolean;
  /** Wrap to the element's width instead of clipping to one line. */
  wrap?: boolean;
  lineHeight?: number;
  /** Vertically centre the text block inside the element box. */
  verticalAlign?: 'top' | 'middle' | 'bottom';
}

export interface TextElement extends BaseElement {
  kind: 'text';
  text: string;
  style: TextStyle;
}

/** A text element whose content comes from the data row. */
export interface FieldElement extends BaseElement {
  kind: 'field';
  binding: DataBinding;
  /** Fallback text shown when the row has no value for the key. */
  placeholder?: string;
  style: TextStyle;
}

export interface BarcodeElement extends BaseElement {
  kind: 'barcode';
  binding: DataBinding;
  formatId: string;
  /** Show the human-readable line under the bars. */
  showText: boolean;
  colour: string;
  background?: string;
  /** X-dimension in millimetres; the layout engine scales the symbol to it. */
  moduleMm: number;
}

export type SymbolKind = 'qrcode' | 'datamatrix' | 'azteccode' | 'pdf417' | 'microqrcode';

export interface SymbolElement extends BaseElement {
  kind: 'symbol';
  binding: DataBinding;
  /** 2D symbology; the encoder lives in the barcode engine. */
  symbol: SymbolKind;
  errorCorrection: ErrorCorrection;
  colour: string;
  background?: string;
  /** Quiet-zone override in modules; the format's minimum always applies. */
  quietModules?: number;
}

export interface ImageElement extends BaseElement {
  kind: 'image';
  /** Data URL. SVG is refused by validation, so this is always a raster image. */
  src: string;
  fit: 'contain' | 'cover' | 'fill';
  /** Corner radius in millimetres and, for logos, a circular mask. */
  radius?: number;
  shape?: 'rect' | 'circle';
  alt?: string;
}

export interface RectElement extends BaseElement {
  kind: 'rect';
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
}

export interface LineElement extends BaseElement {
  kind: 'line';
  colour: string;
  thickness: number;
  dashed?: boolean;
  /** Orientation is derived from the box: a 0-height box is horizontal. */
}

export type LabelElement = TextElement | FieldElement | BarcodeElement | SymbolElement | ImageElement | RectElement | LineElement;

/** A named value the document supplies to bindings (e.g. the preview row). */
export type LabelValues = Record<string, string>;

/** Grid used by the label sheet: how many labels per page and where. */
export interface LabelSheet {
  /** Paper size id from `PAPER_SIZES`, or `custom`. */
  paperId: string;
  /** Page size in millimetres, used when `paperId` is `custom`. */
  customWidth?: number;
  customHeight?: number;
  columns: number;
  rows: number;
  /** Page margin, in millimetres. */
  marginMm: number;
  /** Space between labels, in millimetres. */
  gutterMm: number;
  /** Print a faint cut line between label slots (useful on plain paper). */
  cutLines?: boolean;
}

export interface LabelStyleOptions {
  background: string;
  /** Optional border around each label. */
  border?: { colour: string; width: number; radius?: number };
  /** Inner padding the layout engine applies to the label's content area. */
  paddingMm: number;
}

/** Categories a template can be filed under in the picker. */
export type LabelCategory = 'address' | 'product' | 'asset' | 'shipping' | 'retail' | 'custom' | 'vda';

export interface LabelDocument {
  /** Stable id; `null` for a document that has never been saved. */
  id?: string | null;
  name: string;
  category: LabelCategory;
  /** Label size (not the sheet size), in millimetres. */
  widthMm: number;
  heightMm: number;
  orientation: 'portrait' | 'landscape';
  style: LabelStyleOptions;
  sheet: LabelSheet;
  elements: LabelElement[];
  /** Values used for previews and for bindings the row does not supply. */
  values: LabelValues;
  /** Free-text notes shown under the template description. */
  notes?: string;
  /** Template this document was created from, for the "reset to template" action. */
  templateId?: string;
}

/* ------------------------------------------------------------------ */
/* Element defaults                                                    */
/* ------------------------------------------------------------------ */

export const DEFAULT_TEXT_STYLE: TextStyle = {
  size: 3.2,
  family: 'sans',
  colour: '#10171d',
  align: 'left',
  wrap: true,
  lineHeight: 1.25,
  verticalAlign: 'top',
};

let elementCounter = 0;

/** Unique, stable, readable element id — the layer list and the editor address elements by it. */
export function newElementId(prefix = 'el'): string {
  elementCounter += 1;
  return `${prefix}-${elementCounter.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createElement(kind: ElementKind, overrides: Partial<LabelElement> = {}): LabelElement {
  const base: BaseElement = {
    id: newElementId(kind),
    name: KIND_LABELS[kind],
    visible: true,
    x: 3,
    y: 3,
    width: 40,
    height: 8,
  };
  switch (kind) {
    case 'text':
      return { ...base, kind: 'text', text: 'Text', style: { ...DEFAULT_TEXT_STYLE }, ...overrides } as TextElement;
    case 'field':
      return {
        ...base,
        kind: 'field',
        binding: { key: 'value', fallback: '' },
        placeholder: '—',
        style: { ...DEFAULT_TEXT_STYLE },
        ...overrides,
      } as FieldElement;
    case 'barcode':
      return {
        ...base,
        kind: 'barcode',
        binding: { key: 'barcode', fallback: '' },
        formatId: 'code128',
        showText: true,
        colour: '#000000',
        moduleMm: 0.3,
        height: 14,
        width: 50,
        ...overrides,
      } as BarcodeElement;
    case 'symbol':
      return {
        ...base,
        kind: 'symbol',
        binding: { key: 'qr', fallback: '' },
        symbol: 'qrcode',
        errorCorrection: 'M',
        colour: '#000000',
        width: 22,
        height: 22,
        ...overrides,
      } as SymbolElement;
    case 'image':
      return { ...base, kind: 'image', src: '', fit: 'contain', shape: 'rect', width: 25, height: 12, ...overrides } as ImageElement;
    case 'rect':
      return { ...base, kind: 'rect', fill: '#f1efe9', radius: 0, ...overrides } as RectElement;
    case 'line':
      return { ...base, kind: 'line', colour: '#c9c6bd', thickness: 0.3, height: 0, ...overrides } as LineElement;
    default:
      return { ...base, kind: 'text', text: '', style: { ...DEFAULT_TEXT_STYLE } } as TextElement;
  }
}

export const KIND_LABELS: Record<ElementKind, string> = {
  text: 'Text',
  field: 'Data field',
  barcode: 'Barcode',
  symbol: '2D code',
  image: 'Image',
  rect: 'Panel',
  line: 'Rule',
};

/* ------------------------------------------------------------------ */
/* Bindings                                                            */
/* ------------------------------------------------------------------ */

/**
 * Resolve an element's value from a data row, then the document's own values, then a fallback.
 *
 * A CSV cell that is present but empty counts as *absent*, so a blank cell falls through to the
 * document value instead of printing nothing where a default was configured. Whitespace-only values
 * are treated the same way, because that is how spreadsheets express "no value".
 */
export function resolveLabelData(binding: DataBinding | undefined, row: LabelValues | undefined, values: LabelValues): string {
  if (!binding?.key) return binding?.fallback ?? '';
  const fromRow = row?.[binding.key];
  if (typeof fromRow === 'string' && fromRow.trim() !== '') return fromRow;
  const fromDocument = values[binding.key];
  if (typeof fromDocument === 'string' && fromDocument.trim() !== '') return fromDocument;
  return binding.fallback ?? '';
}

/** Every binding key the document reads — this is what the CSV mapper matches columns against. */
export function labelBindingKeys(document: LabelDocument): string[] {
  const keys = new Set<string>();
  for (const element of document.elements) {
    if ((element.kind === 'field' || element.kind === 'barcode' || element.kind === 'symbol') && element.binding.key) {
      keys.add(element.binding.key);
    }
  }
  return [...keys].sort();
}

/* ------------------------------------------------------------------ */
/* Document defaults                                                   */
/* ------------------------------------------------------------------ */

export const DEFAULT_LABEL_SHEET: LabelSheet = {
  paperId: 'a4',
  columns: 2,
  rows: 4,
  marginMm: 8,
  gutterMm: 3,
  cutLines: false,
};

const DEFAULT_STYLE: LabelStyleOptions = {
  background: '#ffffff',
  border: { colour: '#c9c6bd', width: 0.25, radius: 1.5 },
  paddingMm: 3,
};

export function defaultLabelDocument(overrides: Partial<LabelDocument> = {}): LabelDocument {
  return {
    id: null,
    name: 'Untitled label',
    category: 'custom',
    widthMm: 70,
    heightMm: 40,
    orientation: 'landscape',
    style: { ...DEFAULT_STYLE, border: { colour: '#c9c6bd', width: 0.25, radius: 1.5 } },
    sheet: { ...DEFAULT_LABEL_SHEET },
    elements: [],
    values: {},
    ...overrides,
  };
}

/** Bytes of storage a document may use, mostly images. Template saves are capped at this. */
export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;

/** Serialise a document for storage, with a size guard that names the offending image. */
export function serializeLabelDocument(document: LabelDocument): string {
  const json = JSON.stringify(document);
  if (json.length > MAX_DOCUMENT_BYTES) {
    const largest = document.elements
      .filter((element): element is ImageElement => element.kind === 'image')
      .sort((left, right) => (right.src?.length ?? 0) - (left.src?.length ?? 0))[0];
    throw new Error(
      `This template is ${(json.length / 1024).toFixed(0)} kB; templates are limited to ${(MAX_DOCUMENT_BYTES / 1024).toFixed(0)} kB.${largest ? ` The largest image (“${largest.name}”) is ${(largest.src.length / 1024).toFixed(0)} kB — reduce it before saving.` : ''}`
    );
  }
  return json;
}

/**
 * Parse a stored template.
 *
 * Unknown element kinds are dropped rather than crashing the editor, and the count of dropped
 * elements is reported, because a template saved by a newer build should degrade to "some elements
 * are not supported here" instead of "this template is broken".
 */
export function parseLabelDocument(json: string): { document: LabelDocument; dropped: number } {
  const parsed = JSON.parse(json) as Partial<LabelDocument> & { elements?: unknown };
  const base = defaultLabelDocument();
  const elements: LabelElement[] = [];
  let dropped = 0;
  for (const item of Array.isArray(parsed.elements) ? parsed.elements : []) {
    const candidate = item as { kind?: string };
    if (!candidate || typeof candidate.kind !== 'string' || !(candidate.kind in KIND_LABELS)) {
      dropped += 1;
      continue;
    }
    elements.push(item as LabelElement);
  }
  return {
    document: {
      ...base,
      ...(parsed as Partial<LabelDocument>),
      style: { ...base.style, ...(parsed.style ?? {}) },
      sheet: { ...base.sheet, ...(parsed.sheet ?? {}) },
      values: { ...(parsed.values ?? {}) },
      elements,
    },
    dropped,
  };
}

/* ------------------------------------------------------------------ */
/* Format helpers                                                      */
/* ------------------------------------------------------------------ */

export const SYMBOL_KINDS: readonly { id: SymbolKind; label: string; formatId: string }[] = [
  { id: 'qrcode', label: 'QR Code', formatId: 'qrcode' },
  { id: 'datamatrix', label: 'Data Matrix', formatId: 'datamatrix' },
  { id: 'azteccode', label: 'Aztec Code', formatId: 'azteccode' },
  { id: 'pdf417', label: 'PDF417', formatId: 'pdf417' },
  { id: 'microqrcode', label: 'Micro QR', formatId: 'microqrcode' },
];

export function symbolFormatId(kind: SymbolKind): string {
  return SYMBOL_KINDS.find((entry) => entry.id === kind)?.formatId ?? 'qrcode';
}

export type { BarcodeFormat, BarcodeUseCase, BarcodeFamily, ErrorCorrection };
