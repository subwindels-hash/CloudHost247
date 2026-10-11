/**
 * Browser-side export actions for the Business Tools workspace.
 *
 * All three actions are local. `copy` uses the Clipboard API, `download` builds an object URL from
 * a string the visitor has just generated in their own tab, and `print` hands the current document
 * to the browser's print dialog. Nothing is uploaded anywhere, which is the whole point of running
 * these calculations client-side: a generated payslip, contract or invoice never has to leave the
 * machine it was written on.
 *
 * Each function reports success and failure honestly rather than resolving optimistically, because
 * a "Copied!" toast on a clipboard write the browser refused is a lie the visitor acts on.
 */

import type { BusinessToolResult, ResultDocument } from '../../../src/tools/business';

const MIME_TYPES: Record<ResultDocument['format'], string> = {
  text: 'text/plain;charset=utf-8',
  markdown: 'text/markdown;charset=utf-8',
  csv: 'text/csv;charset=utf-8',
  svg: 'image/svg+xml;charset=utf-8',
  json: 'application/json;charset=utf-8',
};

export function mimeTypeFor(format: ResultDocument['format']): string {
  return MIME_TYPES[format];
}

/**
 * Copy text to the clipboard.
 *
 * Falls back to a hidden textarea plus `execCommand('copy')` because the async Clipboard API is
 * unavailable in insecure contexts and in some embedded browsers, and a copy button that only works
 * on https is a copy button that appears broken to a visitor testing on a LAN address.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy path; a rejected promise here is usually a permissions policy.
    }
  }
  if (typeof document === 'undefined') return false;
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/** Trigger a browser download of a generated document. Returns false if it could not be started. */
export function downloadDocument(document: ResultDocument): boolean {
  if (typeof window === 'undefined' || !window.document) return false;
  try {
    const blob = new Blob([document.content], { type: mimeTypeFor(document.format) });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = document.filename;
    anchor.rel = 'noopener';
    window.document.body.appendChild(anchor);
    anchor.click();
    window.document.body.removeChild(anchor);
    // Revoking on the next tick: some browsers have not started the download yet when click() returns.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}

/**
 * Open the browser print dialog for the result panel.
 *
 * `window.print()` prints the whole document, so the stylesheet hides the input panel, the controls
 * and the export buttons under `@media print` — see `business-tools.css`. That keeps this function
 * free of any DOM cloning, which would otherwise have to be kept in step with the markup by hand.
 */
export function printResult(): boolean {
  if (typeof window === 'undefined' || typeof window.print !== 'function') return false;
  try {
    window.print();
    return true;
  } catch {
    return false;
  }
}

/**
 * Flatten a result into plain text for the clipboard.
 *
 * A visitor copying a result usually wants to paste it into an email or a spreadsheet, so metrics
 * and tables are rendered as readable `label: value` lines rather than as markup.
 */
export function resultToPlainText(
  result: Pick<BusinessToolResult, 'metrics' | 'tables' | 'explanation' | 'warnings'>
): string {
  const lines: string[] = [];
  for (const metric of result.metrics ?? []) {
    lines.push(`${metric.label}: ${metric.value}${metric.hint ? ` (${metric.hint})` : ''}`);
  }
  for (const table of result.tables ?? []) {
    if (lines.length > 0) lines.push('');
    lines.push(table.title.toUpperCase());
    lines.push(table.columns.join('\t'));
    for (const row of table.rows) {
      lines.push([row.label, ...row.cells].join('\t'));
    }
    if (table.caption) {
      lines.push('');
      lines.push(table.caption);
    }
  }
  if (result.explanation && result.explanation.length > 0) {
    lines.push('', 'HOW THIS WAS CALCULATED');
    for (const item of result.explanation) lines.push(`- ${item}`);
  }
  if (result.warnings && result.warnings.length > 0) {
    lines.push('', 'ADVISORIES');
    for (const item of result.warnings) lines.push(`- ${item}`);
  }
  return lines.join('\n');
}
