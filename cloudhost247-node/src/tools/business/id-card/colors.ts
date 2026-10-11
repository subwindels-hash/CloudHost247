/**
 * Colour handling for the badge maker.
 *
 * Two rules shape this file:
 *
 *  1. **A colour the user typed is never trusted as CSS.** Every value is parsed, validated and
 *     re-emitted as `#rrggbb`, so a crafted "colour" cannot smuggle a second declaration or a
 *     `url()` into the preview, the SVG or the PDF.
 *  2. **Contrast is computed, not assumed.** A badge is read at arm's length in a corridor, often
 *     in poor light, and a pale accent with white text is unreadable at exactly the moment it
 *     matters. `autoTextOn()` and `contrastRatio()` are used by the templates and reported to the
 *     user rather than silently applied.
 */

import type { CardPalette } from './types';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Parse `#abc`, `#aabbcc` or `abc` → RGB. Returns null for anything else. */
export function parseColor(value: unknown): Rgb | null {
  if (typeof value !== 'string') return null;
  const match = HEX.exec(value.trim());
  if (!match) return null;
  const digits = match[1] ?? '';
  const full = digits.length === 3 ? digits.split('').map((d) => d + d).join('') : digits;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/** A colour as `#rrggbb`. Falls back to `fallback` when the value is not a colour at all. */
export function normalizeColor(value: unknown, fallback: string): string {
  const rgb = parseColor(value);
  return rgb ? toHex(rgb) : fallback;
}

export function toHex({ r, g, b }: Rgb): string {
  const part = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** WCAG 2.1 relative luminance. */
export function relativeLuminance(color: string | Rgb): number {
  const rgb = typeof color === 'string' ? parseColor(color) : color;
  if (!rgb) return 0;
  const channel = (value: number): number => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/** WCAG 2.1 contrast ratio, 1–21. */
export function contrastRatio(a: string | Rgb, b: string | Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100;
}

/** Black or white — whichever is more readable on `background`. */
export function autoTextOn(background: string, candidates: string[] = ['#FFFFFF', '#101828']): string {
  let best = candidates[0] ?? '#FFFFFF';
  let bestRatio = 0;
  for (const candidate of candidates) {
    const ratio = contrastRatio(background, candidate);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = candidate;
    }
  }
  return best;
}

/** Lighten (`amount` > 0) or darken (`amount` < 0) towards white/black by a 0–1 fraction. */
export function shade(color: string, amount: number): string {
  const rgb = parseColor(color);
  if (!rgb) return color;
  const target = amount >= 0 ? 255 : 0;
  const weight = Math.min(1, Math.abs(amount));
  return toHex({
    r: rgb.r + (target - rgb.r) * weight,
    g: rgb.g + (target - rgb.g) * weight,
    b: rgb.b + (target - rgb.b) * weight,
  });
}

/**
 * Move a colour toward black (light background) or white (dark background) until it reaches `min`
 * contrast ratio against `background`.
 *
 * This exists because an accent colour chosen for its looks is routinely unreadable as *text*: the
 * Salario green #18BF63 is about 1.9:1 on white, so a job title printed in it is decoration, not
 * information. Templates pass accent colours through here before using them for type, which is why
 * one palette can paint a green band *and* a readable green label.
 */
export function readableInk(color: string, background: string, min = 4.5): string {
  if (!parseColor(color)) return color;
  if (contrastRatio(color, background) >= min) return color;
  const towardWhite = relativeLuminance(background) < 0.35;
  let best = color;
  let bestRatio = contrastRatio(color, background);
  for (let step = 1; step <= 20; step += 1) {
    const candidate = shade(color, (towardWhite ? 1 : -1) * step * 0.05);
    const ratio = contrastRatio(candidate, background);
    if (ratio >= min) return candidate;
    if (ratio > bestRatio) {
      best = candidate;
      bestRatio = ratio;
    }
  }
  return best;
}

/** Mix two colours; `weight` is the share of `b`. */
export function mix(a: string, b: string, weight: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return a;
  const w = Math.max(0, Math.min(1, weight));
  return toHex({
    r: ca.r + (cb.r - ca.r) * w,
    g: ca.g + (cb.g - ca.g) * w,
    b: ca.b + (cb.b - ca.b) * w,
  });
}

/**
 * The full surface set a template paints with, derived from the four controls the user owns.
 *
 * Deriving — instead of asking for eight colours — is what keeps a custom palette from turning into
 * an unreadable card: every derived surface sits a known distance from its background.
 */
export interface CardSurfaces {
  palette: CardPalette;
  /** Panel/inset colour that reads as "slightly off the card body". */
  surface: string;
  /** Subtle hairline colour for table rules. */
  hairline: string;
  /** Muted label colour, lifted to at least 4.5:1 against the card body. */
  muted: string;
  /** Text colour that is legible on `primary`. */
  onPrimary: string;
  /** Subdued text that is still legible on the `primary` band. */
  onPrimaryMuted: string;
  /** The accent, darkened/lightened as needed so it can be used for type on the card body. */
  accentInk: string;
  /** The detail accent, treated the same way. */
  detailInk: string;
  /** True when the card body is dark, which flips several template decisions. */
  dark: boolean;
  /** Contrast of body text on the card background, reported to the user. */
  bodyContrast: number;
}

const DEFAULT_PALETTE: CardPalette = {
  primary: '#155EEF',
  background: '#FFFFFF',
  text: '#172B4D',
  detail: '#0B3BA8',
};

/** Normalise a palette, filling in anything missing or malformed with the documented defaults. */
export function normalizePalette(input: Partial<CardPalette> | undefined): CardPalette {
  return {
    primary: normalizeColor(input?.primary, DEFAULT_PALETTE.primary),
    background: normalizeColor(input?.background, DEFAULT_PALETTE.background),
    text: normalizeColor(input?.text, DEFAULT_PALETTE.text),
    detail: normalizeColor(input?.detail, DEFAULT_PALETTE.detail),
  };
}

export function surfacesFor(input: Partial<CardPalette> | undefined): CardSurfaces {
  const palette = normalizePalette(input);
  const dark = relativeLuminance(palette.background) < 0.35;
  const surface = dark ? mix(palette.background, '#FFFFFF', 0.08) : mix(palette.background, '#0F172A', 0.05);
  const hairline = dark ? mix(palette.background, '#FFFFFF', 0.22) : mix(palette.background, '#0F172A', 0.16);
  const muted = readableInk(mix(palette.text, palette.background, 0.42), palette.background, 4.5);
  const onPrimary = autoTextOn(palette.primary);
  const bodyContrast = contrastRatio(palette.text, palette.background);
  return {
    palette,
    surface,
    hairline,
    muted,
    onPrimary,
    onPrimaryMuted: readableInk(mix(onPrimary, palette.primary, 0.3), palette.primary, 4.5),
    accentInk: readableInk(palette.primary, palette.background, 4.5),
    detailInk: readableInk(palette.detail, palette.background, 4.5),
    dark,
    bodyContrast,
  };
}

export { DEFAULT_PALETTE };
