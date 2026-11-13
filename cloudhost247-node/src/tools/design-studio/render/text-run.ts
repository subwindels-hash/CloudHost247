/**
 * One resolved line of text.
 *
 * Both studio renderers call `resolveTextRun()` rather than interpreting a text op themselves, so
 * the SVG preview and the PDF draw the same characters, in the same font, at the same size, across
 * the same width. That is the property that makes "the preview is the print" true for text.
 */

import type { DrawText, StudioOp } from './draw-ops';
import { fitText, fontFor, measureText, toWinAnsi, type StudioFont } from './text-metrics';

export interface TextRun {
  /** The characters that will be drawn (Windows-1252; anything else is already `?`). */
  text: string;
  /** One Windows-1252 byte per character. */
  codes: number[];
  font: StudioFont;
  size: number;
  /** Advance width of the run, including letter spacing. */
  width: number;
  /** Left edge of the run after the anchor is applied. */
  startX: number;
  /** Characters the standard fonts could not draw. */
  unsupported: string[];
  /** Characters drawn in a simpler form, as `original → drawn`. */
  simplified: string[];
  /** True when the value was cut because it could not fit its `maxWidth` at the smallest size. */
  truncated: boolean;
}

/** The smallest a `maxWidth`-constrained run may shrink to, as a fraction of its requested size. */
export const MIN_FIT_RATIO = 0.4;

export function resolveTextRun(op: DrawText): TextRun | null {
  const converted = toWinAnsi(op.text);
  if (converted.text.trim() === '') return null;
  const font = fontFor(op.family, op.weight);
  const spacing = op.letterSpacing ?? 0;

  let text = converted.text;
  let codes = converted.codes;
  let size = op.size;
  let truncated = false;

  if (op.maxWidth && op.maxWidth > 0) {
    const room = Math.max(0, op.maxWidth - spacing * text.length);
    const fitted = fitText(text, room, size, { font, minSize: size * MIN_FIT_RATIO });
    size = fitted.size;
    truncated = fitted.truncated;
    if (fitted.text !== text) {
      const again = toWinAnsi(fitted.text);
      text = again.text;
      codes = again.codes;
    }
  }

  const width = measureText(text, size, font) + spacing * text.length;
  const startX = op.anchor === 'middle' ? op.x - width / 2 : op.anchor === 'end' ? op.x - width : op.x;
  return { text, codes, font, size, width, startX, unsupported: converted.unsupported, simplified: converted.simplified, truncated };
}

export interface TextAudit {
  /** Distinct characters that were replaced because the output fonts cannot draw them. */
  unsupported: string[];
  /** Distinct characters drawn in a simpler form, as `original → drawn`. */
  simplified: string[];
  /** Values that were cut to fit, as they appear after cutting. */
  truncated: string[];
}

/** What the text on a surface lost on its way to the page, for the caller to report. */
export function auditText(ops: readonly StudioOp[]): TextAudit {
  const unsupported: string[] = [];
  const simplified: string[] = [];
  const truncated: string[] = [];
  for (const op of ops) {
    if (op.kind !== 'text') continue;
    const run = resolveTextRun(op);
    if (!run) continue;
    for (const char of run.unsupported) if (!unsupported.includes(char)) unsupported.push(char);
    for (const entry of run.simplified) if (!simplified.includes(entry)) simplified.push(entry);
    if (run.truncated) truncated.push(run.text);
  }
  return { unsupported, simplified, truncated };
}
