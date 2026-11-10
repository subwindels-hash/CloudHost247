/**
 * Design Studio — the browser-side contract for the five tools.
 *
 * The server does the encoding (`src/tools/handlers/design-studio.ts`); this module owns the
 * presentation-side concerns:
 *
 *  · the response envelope type every tool returns;
 *  · turning an SVG/PDF response into a download (Blob URLs, revoked after use);
 *  · rasterising the SVG to PNG *in the browser*, because the SVG already *is* the print artefact —
 *    re-rendering it here guarantees the PNG matches the PDF rather than being a second drawing of
 *    the same data;
 *  · the issue list model the pages render.
 */
import { toolsApi } from './tools-api';

export type IssueLevel = 'error' | 'warn' | 'info';

export interface StudioIssue {
  level: IssueLevel;
  field?: string;
  message: string;
  hint?: string;
}

/** The response envelope shared by all five endpoints. */
export interface StudioResponse {
  document: {
    title?: string;
    pages: Array<{ width: number; height: number; label?: string }>;
    warnings?: string[];
    /** Present for label/card documents: the element list, so a page can show what will print. */
    elements?: Array<Record<string, unknown>>;
  };
  svg: string;
  preview: string;
  issues: StudioIssue[];
  blocked: boolean;
  summary: string[];
  sizeMm: { width: number; height: number };
  sizePx: { width: number; height: number };
  meta: Record<string, unknown>;
  pdf?: string;
  pdfBase64?: boolean;
  pngScale?: number;
  pngPx?: { width: number; height: number };
}

/**
 * Run a tool whose response is *not* the document envelope — the `templates`/`spec`/`payload`
 * listing actions return their own payload. Kept separate from `runStudio` so a listing can never be
 * mistaken for a generated document (which would render an empty preview).
 */
export async function runListing<T>(slug: StudioSlug, input: Record<string, unknown>, signal?: AbortSignal): Promise<{ ok: boolean; data?: T; error?: { code: string; message: string } }> {
  const envelope = await toolsApi.run<T>(slug, input, signal);
  if (envelope.success) return { ok: true, data: envelope.data };
  return { ok: false, error: { code: envelope.code ?? 'UNKNOWN', message: envelope.message ?? 'The tool could not run.' } };
}

export type StudioSlug =
  | 'barcode-generator'
  | 'label-designer'
  | 'vda-4902-label-generator'
  | 'shipping-label-generator'
  | 'qr-business-card-designer';

export interface StudioRunResult {
  ok: boolean;
  data?: StudioResponse;
  error?: { code: string; message: string };
}

/**
 * Run a tool.
 *
 * A failure keeps the server's own code and message: "CONFIGURATION_REQUIRED" and "INVALID_INPUT"
 * need different advice, and flattening both into "something went wrong" is what makes a form
 * frustrating to use.
 */
export async function runStudio(slug: StudioSlug, input: Record<string, unknown>, signal?: AbortSignal): Promise<StudioRunResult> {
  const envelope = await toolsApi.run<StudioResponse>(slug, input, signal);
  if (envelope.success) return { ok: true, data: envelope.data };
  return { ok: false, error: { code: envelope.code ?? 'UNKNOWN', message: envelope.message ?? 'The tool could not run.' } };
}

/** Split issues for the UI: errors block export, warnings print next to the preview. */
export function splitIssues(issues: StudioIssue[]): { errors: StudioIssue[]; warnings: StudioIssue[] } {
  return {
    errors: issues.filter((issue) => issue.level === 'error'),
    warnings: issues.filter((issue) => issue.level === 'warn'),
  };
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking on the next tick keeps Safari from cancelling the download.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Download any text payload (a CSV report, a spec listing) as a named file. */
export function downloadFile(text: string, mime: string, filename: string): void {
  download(new Blob([text], { type: `${mime};charset=utf-8` }), filename);
}

export function downloadSvg(svg: string, filename: string): void {
  download(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), filename);
}

export function downloadPdf(base64: string, filename: string): void {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  download(new Blob([bytes], { type: 'application/pdf' }), filename);
}

/**
 * Rasterise the SVG to PNG in the browser.
 *
 * An `<img>` over the SVG Blob is the only rasteriser available without shipping a second renderer,
 * and it draws the same geometry the PDF does, so the PNG cannot drift from print. The pixel size
 * comes from the document's millimetre size and the requested DPI — never from the browser's zoom,
 * which would make the export resolution depend on the operator's screen.
 */
export async function renderPng(svg: string, sizeMm: { width: number; height: number }, dpi = 300): Promise<Blob> {
  const width = Math.max(1, Math.round((sizeMm.width / 25.4) * dpi));
  const height = Math.max(1, Math.round((sizeMm.height / 25.4) * dpi));
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('The browser could not rasterise this document.'));
      element.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser has no 2D canvas context.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('The PNG could not be produced.'))), 'image/png');
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function downloadPng(svg: string, sizeMm: { width: number; height: number }, filename: string, dpi = 300): Promise<void> {
  download(await renderPng(svg, sizeMm, dpi), filename);
}

/** Print a document by opening a hidden iframe with only that SVG in it. */
export function printSvg(svg: string, title: string, sizeMm: { width: number; height: number }): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) {
    frame.remove();
    return;
  }
  // The @page rule is the whole point: without it the browser prints at its own default margins and
  // a 70 mm label lands in the middle of an A4 sheet at an arbitrary scale.
  doc.open();
  doc.write(
    `<!doctype html><html><head><title>${title.replace(/[<>&]/g, '')}</title>` +
      `<style>@page{size:${sizeMm.width}mm ${sizeMm.height}mm;margin:0}html,body{margin:0;padding:0}svg{display:block}</style>` +
      `</head><body>${svg}</body></html>`
  );
  doc.close();
  const finish = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 1000);
  };
  if (doc.readyState === 'complete') finish();
  else frame.onload = finish;
}

/** Copy text to the clipboard, with a fallback for browsers that refuse the async API. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', 'true');
      area.style.position = 'absolute';
      area.style.left = '-9999px';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** A filename stem from a tool slug and a value, stripped of anything a file system dislikes. */
export function fileStem(slug: string, detail?: string): string {
  const base = detail && detail.trim() ? detail.trim().slice(0, 48) : slug;
  return base.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || slug;
}
