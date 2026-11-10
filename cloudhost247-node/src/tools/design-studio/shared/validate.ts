/**
 * Design Studio — input validation.
 *
 * Every rule returns a list of `Issue`s instead of throwing, so a form can show all the problems at
 * once (an operator fixing a VDA label should not discover the second missing field after fixing
 * the first), and the same list is what the API turns into a 400 with a reason.
 *
 * Violations of a hard requirement are `error`; out-of-spec advisories are `warn`. The distinction
 * matters: an X-dimension below the practical floor must not silently block a user who is printing
 * an internal shelf label, but it must be said out loud, because the same file sent to a retail
 * partner may come back rejected.
 */

export type IssueLevel = 'error' | 'warn';

export interface Issue {
  level: IssueLevel;
  /** Dotted path to the offending field, e.g. `recipient.postalCode` or `elements.3.text`. */
  field: string;
  message: string;
  /** What to do about it. */
  hint?: string;
}

export function error(field: string, message: string, hint?: string): Issue {
  return { level: 'error', field, message, ...(hint ? { hint } : {}) };
}

export function warn(field: string, message: string, hint?: string): Issue {
  return { level: 'warn', field, message, ...(hint ? { hint } : {}) };
}

export function hasErrors(issues: readonly Issue[]): boolean {
  return issues.some((issue) => issue.level === 'error');
}

/* ------------------------------------------------------------------ */
/* Colours                                                             */
/* ------------------------------------------------------------------ */

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Accepts #rgb and #rrggbb, normalising to lower-case #rrggbb. Returns null when invalid. */
export function normaliseHexColour(value: string): string | null {
  const trimmed = (value ?? '').trim();
  if (!HEX.test(trimmed)) return null;
  if (trimmed.length === 4) {
    const [, r, g, b] = trimmed;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return trimmed.toLowerCase();
}

export function isHexColour(value: string): boolean {
  return normaliseHexColour(value) !== null;
}

function channel(hex: string, offset: number): number {
  return parseInt(hex.slice(offset, offset + 2), 16) / 255;
}

/** sRGB relative luminance per WCAG 2.1. */
export function relativeLuminance(hex: string): number {
  const normalised = normaliseHexColour(hex) ?? '#000000';
  const toLinear = (value: number): number => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const r = toLinear(channel(normalised, 1));
  const g = toLinear(channel(normalised, 3));
  const b = toLinear(channel(normalised, 5));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrastRatio(foreground: string, background: string): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Checks that a barcode's ink and background will scan.
 *
 * Scanners binarise the image, so what matters is not contrast ratio but whether the dark and light
 * areas land on different sides of the threshold. A dark-on-dark pair fails even when it "looks
 * fine" on a backlit screen; the rule of thumb used here is a contrast ratio of at least 7:1
 * (WCAG AAA for text, which is a reasonable proxy for print scanning) plus dark-bars-on-light.
 */
export function checkBarcodeContrast(ink: string, background: string, field = 'foreground'): Issue[] {
  const issues: Issue[] = [];
  const inkHex = normaliseHexColour(ink);
  const bgHex = normaliseHexColour(background);
  if (!inkHex) issues.push(error(field, `“${ink}” is not a colour. Use a hex value such as #10171d.`));
  if (!bgHex) issues.push(error('background', `“${background}” is not a colour. Use a hex value such as #ffffff.`));
  if (!inkHex || !bgHex) return issues;

  const ratio = contrastRatio(inkHex, bgHex);
  if (ratio < 3) {
    issues.push(
      error(field, `The barcode colour and its background are too similar to scan (contrast ${ratio.toFixed(1)}:1).`, 'Use dark bars on a light background, e.g. #000000 on #ffffff.')
    );
  } else if (ratio < 7) {
    issues.push(
      warn(field, `Contrast is only ${ratio.toFixed(1)}:1. Many scanners will read it, but print it and test with your own device before a large run.`, 'A 7:1 ratio or better is the safe target.')
    );
  }
  if (relativeLuminance(inkHex) > relativeLuminance(bgHex)) {
    issues.push(
      warn(field, 'The bars are lighter than the background (a “reverse” or “negative” barcode).', 'Most scanners do not read inverted codes. Invert the two colours unless the reader is known to support it.')
    );
  }
  return issues;
}

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

/** Control characters break PDF text and barcode payloads; strip them at the boundary. */
export function stripControlCharacters(value: string): string {
  // Explicit list rather than a range to keep the intent obvious: C0 controls, DEL, then C1.
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');
}

export function cleanText(value: string): string {
  return stripControlCharacters(String(value ?? '')).replace(/\r\n?/g, '\n').trim();
}

/** Truncate on a word boundary when possible, and always on a character boundary. */
export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return space > max * 0.6 ? `${cut.slice(0, space)}…` : `${cut}…`;
}

/* ------------------------------------------------------------------ */
/* Dimensions                                                          */
/* ------------------------------------------------------------------ */

export interface DimensionLimits {
  minMm: number;
  maxMm: number;
}

export const LABEL_LIMITS: DimensionLimits = { minMm: 10, maxMm: 500 };
export const ELEMENT_MIN_MM = 2;

export function checkDimension(field: string, mm: number, limits: DimensionLimits, label: string): Issue[] {
  if (!Number.isFinite(mm)) return [error(field, `${label} must be a number.`)];
  if (mm < limits.minMm) return [error(field, `${label} is ${round(mm)} mm; the minimum is ${limits.minMm} mm.`)];
  if (mm > limits.maxMm) return [error(field, `${label} is ${round(mm)} mm; the maximum is ${limits.maxMm} mm.`)];
  return [];
}

export function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * Ensures an element lies (at least partly) inside the label and warns when it overhangs.
 *
 * Overhang is a warning, not an error: bleeding a photograph off the edge of a card is a legitimate
 * design. Clipping a barcode is not, which is why the caller passes `critical: true` for
 * machine-readable elements.
 */
export function checkBounds(
  field: string,
  box: { x: number; y: number; width: number; height: number },
  bounds: { width: number; height: number },
  options: { critical?: boolean; name: string }
): Issue[] {
  const issues: Issue[] = [];
  const epsilon = 0.01;
  const outside =
    box.x < -epsilon ||
    box.y < -epsilon ||
    box.x + box.width > bounds.width + epsilon ||
    box.y + box.height > bounds.height + epsilon;
  if (!outside) return issues;
  const message = `${options.name} extends beyond the label edge (${round(box.x)}, ${round(box.y)} at ${round(box.width)} × ${round(box.height)} mm on a ${round(bounds.width)} × ${round(bounds.height)} mm label).`;
  if (options.critical) {
    issues.push(error(field, `${message} A barcode or QR code that runs off the page cannot be read.`, 'Move or resize it until it sits fully inside the label.'));
  } else {
    issues.push(warn(field, `${message} The overhanging part will not print.`));
  }
  return issues;
}

/* ------------------------------------------------------------------ */
/* Data URLs / uploads                                                 */
/* ------------------------------------------------------------------ */

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export interface DataUrlInfo {
  ok: boolean;
  mime?: string;
  bytes?: number;
  message?: string;
}

/**
 * Validates an uploaded image supplied as a data URL.
 *
 * Only raster formats are accepted. SVG is refused deliberately: an SVG can carry script, and this
 * value is rendered into an SVG document that a browser may open directly, which is exactly the
 * stored-XSS path a label tool must not open. The message says so instead of failing vaguely.
 */
export function inspectImageDataUrl(value: string): DataUrlInfo {
  const text = (value ?? '').trim();
  if (text === '') return { ok: true };
  const match = /^data:([a-z0-9.+/-]+);base64,([a-z0-9+/=\s]+)$/i.exec(text);
  if (!match) {
    return { ok: false, message: 'The image must be a base64 data URL (data:image/png;base64,…). Upload the file again.' };
  }
  const mime = (match[1] ?? '').toLowerCase();
  const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  if (!allowed.includes(mime)) {
    return {
      ok: false,
      mime,
      message: `“${mime}” images are not accepted. Use PNG, JPEG, WebP or GIF — SVG is refused because it can carry script.`,
    };
  }
  const base64 = (match[2] ?? '').replace(/\s+/g, '');
  const bytes = Math.floor((base64.length * 3) / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
  if (bytes > MAX_IMAGE_BYTES) {
    return { ok: false, mime, bytes, message: `The image is ${(bytes / 1024 / 1024).toFixed(1)} MB; the limit is 2 MB. Reduce it before uploading.` };
  }
  return { ok: true, mime, bytes };
}
