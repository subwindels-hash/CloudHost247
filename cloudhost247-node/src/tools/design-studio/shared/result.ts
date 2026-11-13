/**
 * The response every Design Studio tool returns.
 *
 * One shape, so one result component can show a preview and offer downloads for a barcode, a label
 * or a business card alike. Files travel as base64 inside the JSON envelope the Tools Center already
 * uses: they are small (a label PDF is tens of kilobytes), and a single response means a preview can
 * never be shown beside a download that was generated from different input.
 *
 * Nothing in a result is stored. In particular there is no `summary` field: the executor copies a
 * few well-known keys into the execution log and the history row, and artwork that may carry an
 * address or a phone number must not leave a trace there.
 */

import type { StudioSurface } from '../render/draw-ops';
import { pageToSvg, surfaceToSvg, type SvgPage } from '../render/svg';

export type StudioMime = 'image/svg+xml' | 'image/png' | 'application/pdf' | 'application/zip' | 'text/vcard';

export interface StudioFile {
  /** Suggested download name, already safe for every filesystem. */
  name: string;
  mime: StudioMime;
  base64: string;
  bytes: number;
  /** What the file is for, as a button label. */
  label: string;
  /** One sentence of guidance shown under the button. */
  hint?: string;
}

export interface StudioPreview {
  title: string;
  /** A complete SVG document at true physical size. */
  svg: string;
  widthMm: number;
  heightMm: number;
}

export interface StudioFact {
  label: string;
  value: string;
}

export interface StudioResult {
  studio: true;
  title: string;
  previews: StudioPreview[];
  files: StudioFile[];
  facts: StudioFact[];
  /** What the user should know before printing: cut text, replaced characters, size caveats. */
  notices: string[];
  /** How many items (symbols, labels, cards) the files contain. */
  count: number;
}

/** A lowercase, hyphenated, ASCII file-name stem. Never empty, never a path. */
export function fileStem(text: string, fallback = 'cloudhost247'): string {
  const stem = text
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return stem === '' ? fallback : stem;
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

export function binaryFile(name: string, mime: StudioMime, bytes: Uint8Array, label: string, hint?: string): StudioFile {
  return { name, mime, base64: toBase64(bytes), bytes: bytes.length, label, ...(hint ? { hint } : {}) };
}

export function textFile(name: string, mime: StudioMime, text: string, label: string, hint?: string): StudioFile {
  return binaryFile(name, mime, new Uint8Array(Buffer.from(text, 'utf8')), label, hint);
}

export function previewOf(surface: StudioSurface, title: string, description?: string): StudioPreview {
  return {
    title,
    svg: surfaceToSvg(surface, { title, ...(description ? { description } : {}) }),
    widthMm: surface.width,
    heightMm: surface.height,
  };
}

/** The first sheet of a print job, drawn as the PDF lays it out. */
export function sheetPreview(page: SvgPage, title: string): StudioPreview {
  return { title, svg: pageToSvg(page, { title }), widthMm: page.width, heightMm: page.height };
}

/** Millimetres to two decimals, without trailing zeros. */
export function mmText(value: number): string {
  return `${Math.round(value * 100) / 100}`;
}

export function sizeText(width: number, height: number): string {
  return `${mmText(width)} × ${mmText(height)} mm`;
}

/** WCAG relative luminance of a `#rrggbb` colour. */
export function luminance(hex: string): number {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!match) return 0;
  const value = parseInt(match[1] as string, 16);
  const channel = (raw: number): number => {
    const c = raw / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((value >> 16) & 0xff) + 0.7152 * channel((value >> 8) & 0xff) + 0.0722 * channel(value & 0xff);
}

/**
 * A warning when a symbol's colours are likely to defeat a scanner, or null when they are sound.
 * Scanners need dark bars on a light ground, and most read with red light, under which red and
 * orange bars look as bright as the paper.
 */
export function contrastNotice(bar: string, background: string): string | null {
  const dark = luminance(bar);
  const light = luminance(background);
  if (dark >= light) return 'The bars are not darker than the background. Most scanners cannot read light-on-dark symbols; use a dark bar colour on a light background.';
  const ratio = (light + 0.05) / (dark + 0.05);
  if (ratio < 4) return 'The bar and background colours are close in brightness. Scanners need strong contrast; black on white is the safe choice.';
  const match = /^#([0-9a-fA-F]{6})$/.exec(bar);
  if (match) {
    const value = parseInt(match[1] as string, 16);
    const red = (value >> 16) & 0xff;
    const green = (value >> 8) & 0xff;
    const blue = value & 0xff;
    if (red > 150 && red > green * 1.4 && red > blue * 1.4) {
      return 'Red and orange bars reflect the red light most scanners use and can read as blank. Prefer black, dark blue or dark green bars.';
    }
  }
  return null;
}
