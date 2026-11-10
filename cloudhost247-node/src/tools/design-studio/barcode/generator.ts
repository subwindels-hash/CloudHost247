/**
 * Barcode Generator — settings to document.
 *
 * The Barcode Generator page and the API both call `buildBarcodeDocument`. That function is the
 * whole tool: it validates the input, encodes the symbol, works out the physical footprint and
 * emits a one-page document. The page adds the form, the preview and the download buttons; the API
 * adds the envelope. Neither re-implements any of it.
 *
 * Every claim the page makes about the output — the X-dimension, the printed size, whether the
 * symbol will scan at that size — is computed here from the geometry, not written into the copy.
 */

import {
  BarcodeError,
  encodeBarcode,
  layoutBarcode,
  validateBarcodePayload,
  type EncodedBarcode,
} from '../shared/barcode-engine';
import { findBarcodeFormat } from '../shared/barcode-catalog';
import type { DesignDocument } from '../shared/draw-ops';
import type { Issue } from '../shared/validate';
import { checkBarcodeContrast, error, normaliseHexColour, round, warn } from '../shared/validate';
import { mmToPixels } from '../shared/units';

export type ErrorCorrection = 'L' | 'M' | 'Q' | 'H';

export interface BarcodeSettings {
  formatId: string;
  payload: string;
  /** Physical width of one narrow bar / module, in millimetres. */
  moduleMm: number;
  /** Bar height in millimetres (linear formats). */
  barHeightMm: number;
  showText: boolean;
  foreground: string;
  background: string;
  /** QR error correction; ignored by formats that do not use it. */
  errorCorrection: ErrorCorrection;
  /** Aztec error-correction percentage (5–95). */
  aztecEccPercent: number;
  /** PDF417 data columns (1–30). */
  pdfColumns: number;
  /** Extra padding around the symbol, in millimetres. */
  paddingMm: number;
}

export const DEFAULT_BARCODE_SETTINGS: BarcodeSettings = {
  formatId: 'code128',
  payload: 'CH247-2026-000123',
  moduleMm: 0.35,
  barHeightMm: 20,
  showText: true,
  foreground: '#10171d',
  background: '#ffffff',
  errorCorrection: 'M',
  aztecEccPercent: 23,
  pdfColumns: 0,
  paddingMm: 2,
};

export interface BarcodeDocumentResult {
  document: DesignDocument;
  encoded: EncodedBarcode;
  settings: BarcodeSettings;
  issues: Issue[];
  /** Printed footprint of the page, in millimetres. */
  sizeMm: { width: number; height: number };
  /** Pixel size at 300 dpi, for the PNG export. */
  sizePx: { width: number; height: number };
  /** True when an error-level issue means the document must not be exported. */
  blocked: boolean;
}

/** Coerce untrusted input (a form, a JSON body) into settings without throwing. */
export function barcodeSettingsFromInput(input: Record<string, unknown>): BarcodeSettings {
  const text = (value: unknown, fallback: string): string => (typeof value === 'string' && value.trim() !== '' ? value : fallback);
  const number = (value: unknown, fallback: number): number => {
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const flag = (value: unknown, fallback: boolean): boolean => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return /^(true|1|yes|on)$/i.test(value);
    return fallback;
  };
  const ecc = text(input.errorCorrection, DEFAULT_BARCODE_SETTINGS.errorCorrection).toUpperCase();
  return {
    formatId: text(input.formatId ?? input.format ?? input.type, DEFAULT_BARCODE_SETTINGS.formatId),
    payload: typeof input.payload === 'string' ? input.payload : typeof input.data === 'string' ? input.data : typeof input.text === 'string' ? input.text : DEFAULT_BARCODE_SETTINGS.payload,
    moduleMm: number(input.moduleMm ?? input.scale, DEFAULT_BARCODE_SETTINGS.moduleMm),
    barHeightMm: number(input.barHeightMm ?? input.height, DEFAULT_BARCODE_SETTINGS.barHeightMm),
    showText: flag(input.showText ?? input.humanReadable, DEFAULT_BARCODE_SETTINGS.showText),
    foreground: normaliseHexColour(text(input.foreground ?? input.barColor ?? input.dark, DEFAULT_BARCODE_SETTINGS.foreground)) ?? DEFAULT_BARCODE_SETTINGS.foreground,
    background: normaliseHexColour(text(input.background ?? input.light, DEFAULT_BARCODE_SETTINGS.background)) ?? DEFAULT_BARCODE_SETTINGS.background,
    errorCorrection: (['L', 'M', 'Q', 'H'].includes(ecc) ? ecc : DEFAULT_BARCODE_SETTINGS.errorCorrection) as ErrorCorrection,
    aztecEccPercent: Math.min(95, Math.max(5, Math.round(number(input.aztecEccPercent, DEFAULT_BARCODE_SETTINGS.aztecEccPercent)))),
    pdfColumns: Math.min(30, Math.max(0, Math.round(number(input.pdfColumns, DEFAULT_BARCODE_SETTINGS.pdfColumns)))),
    paddingMm: Math.min(50, Math.max(0, number(input.paddingMm, DEFAULT_BARCODE_SETTINGS.paddingMm))),
  };
}

/**
 * Validate settings and build the barcode page.
 *
 * Errors block: a page built from an invalid payload would print a symbol that says something else,
 * or nothing at all. Warnings are returned alongside a usable document, because "your module size
 * is small" is advice, not a failure.
 */
export function buildBarcodeDocument(settings: BarcodeSettings): BarcodeDocumentResult {
  const issues: Issue[] = [];
  const format = findBarcodeFormat(settings.formatId);

  if (!format) {
    issues.push(
      error(
        'formatId',
        `“${settings.formatId}” is not a barcode format this build can encode.`,
        'Choose one of the formats listed in the picker — the tool only offers formats with a real encoder.'
      )
    );
  }

  if (settings.moduleMm < 0.08) issues.push(error('moduleMm', 'The module width must be at least 0.08 mm; below that no printer can resolve separate bars.'));
  if (settings.moduleMm > 5) issues.push(error('moduleMm', 'The module width must be at most 5 mm; a wider module makes the symbol impractically large.'));
  if (format?.family === 'linear' && (settings.barHeightMm < 3 || settings.barHeightMm > 200)) {
    issues.push(error('barHeightMm', 'Bar height must be between 3 mm and 200 mm.'));
  }
  issues.push(...checkBarcodeContrast(settings.foreground, settings.background));

  const validation = validateBarcodePayload(settings.formatId, settings.payload);
  for (const issue of validation.issues) {
    issues.push(issue.level === 'error' ? error('payload', issue.message) : warn('payload', issue.message));
  }

  if (issues.some((issue) => issue.level === 'error')) {
    // Return an empty-but-descriptive page so the caller can still render a preview frame with the
    // reason in it, rather than guessing at a symbol that would be wrong.
    return {
      document: {
        title: 'Barcode',
        pages: [{ width: 80, height: 40, ops: [], label: 'Invalid input' }],
        warnings: issues.filter((issue) => issue.level === 'error').map((issue) => issue.message),
      },
      encoded: emptyEncoded(settings),
      settings,
      issues,
      sizeMm: { width: 80, height: 40 },
      sizePx: { width: mmToPixels(80), height: mmToPixels(40) },
      blocked: true,
    };
  }

  let encoded: EncodedBarcode;
  try {
    encoded = encodeBarcode({
      formatId: settings.formatId,
      payload: settings.payload,
      errorCorrection: settings.formatId === 'azteccode' ? String(settings.aztecEccPercent) : settings.errorCorrection,
      columns: settings.pdfColumns > 0 ? settings.pdfColumns : undefined,
    });
  } catch (caught) {
    const message = caught instanceof BarcodeError ? caught.message : caught instanceof Error ? caught.message : 'The barcode could not be generated.';
    issues.push(error('payload', message));
    return {
      document: { title: 'Barcode', pages: [{ width: 80, height: 40, ops: [], label: 'Encoding failed' }], warnings: [message] },
      encoded: emptyEncoded(settings),
      settings,
      issues,
      sizeMm: { width: 80, height: 40 },
      sizePx: { width: mmToPixels(80), height: mmToPixels(40) },
      blocked: true,
    };
  }

  const layout = layoutBarcode(encoded, {
    moduleMm: settings.moduleMm,
    barHeightMm: settings.barHeightMm,
    showText: settings.showText && encoded.family === 'linear',
  });
  for (const note of layout.notes) issues.push(warn('moduleMm', note));

  // The page is the symbol plus the requested padding — the printed size is what the caller asked
  // for, not a guess. A page smaller than 5 mm is raised to 5 mm so a preview stays visible.
  const pageWidth = round(Math.max(5, layout.widthMm + settings.paddingMm * 2), 2);
  const pageHeight = round(Math.max(5, layout.heightMm + settings.paddingMm * 2), 2);
  const offsetX = round((pageWidth - layout.widthMm) / 2, 3);
  const offsetY = round((pageHeight - layout.heightMm) / 2, 3);

  const document: DesignDocument = {
    title: `${format?.name ?? 'Barcode'} — ${encoded.payload}`,
    subject: 'CloudHost247 Barcode Generator',
    creator: 'CloudHost247 Design Studio',
    pages: [
      {
        width: pageWidth,
        height: pageHeight,
        label: `${format?.name ?? 'Barcode'}`,
        ops: [
          ...(settings.paddingMm >= 0 && layout.widthMm < pageWidth
            ? []
            : []),
          {
            kind: 'barcode',
            x: offsetX,
            y: offsetY,
            w: layout.widthMm,
            h: layout.heightMm,
            moduleMm: layout.moduleMm,
            encoded,
            colour: settings.foreground,
            background: settings.background,
            textHeight: layout.textHeightMm,
            showText: layout.showText,
            quietMm: layout.quietMm,
          },
        ],
      },
    ],
    warnings: [],
  };

  return {
    document,
    encoded,
    settings,
    issues,
    sizeMm: { width: pageWidth, height: pageHeight },
    sizePx: { width: mmToPixels(pageWidth), height: mmToPixels(pageHeight) },
    blocked: false,
  };
}

function emptyEncoded(settings: BarcodeSettings): EncodedBarcode {
  const format = findBarcodeFormat(settings.formatId);
  return {
    formatId: settings.formatId,
    bcid: format?.bcid ?? '',
    family: format?.family ?? 'linear',
    payload: '',
    widthUnits: 1,
    heightUnits: 1,
    polygons: [],
    rects: [],
    texts: [],
    hasBearerBar: false,
    quietModules: format?.quietModules ?? 10,
    moduleMm: format?.minModuleMm ?? 0.3,
    xDimension: 1,
    notes: [],
  };
}

/**
 * A plain-text summary of what the page shows, used by the API response, the explain panel and the
 * "copy encoded data" action.
 */
export function describeBarcode(result: BarcodeDocumentResult): string[] {
  const format = findBarcodeFormat(result.settings.formatId);
  const lines = [
    `${format?.name ?? result.settings.formatId}: ${result.encoded.payload || '(not encoded)'}`,
    `Printed size: ${result.sizeMm.width} × ${result.sizeMm.height} mm`,
    `X-dimension: ${result.settings.moduleMm} mm per narrow ${format?.family === '2d' ? 'module' : 'bar'}`,
    `Quiet zone each side: ${result.encoded.quietModules} modules`,
  ];
  return lines;
}
