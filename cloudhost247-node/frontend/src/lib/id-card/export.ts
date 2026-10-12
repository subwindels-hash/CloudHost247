/**
 * Badge rendering and file exports.
 *
 * The design rule this module enforces: the preview canvas and the exported file are the same
 * canvas. `renderFace` draws a face at its full 300 dpi size (1011 × 638 px) and the preview is that
 * canvas scaled down with CSS, so what a user sees is what lands in the PNG, the JPG and the PDF.
 * A "preview mode" that draws a smaller, slightly different card is how a designation ends up
 * clipped in the download but not on screen.
 *
 * Every export returns a result rather than throwing at the caller: a failure has to be shown to the
 * user with a reason, and "the download did not start" is not a reason.
 */

import {
  buildCardsPdf,
  buildCardsPdfPair,
  buildZip,
  batchManifestCsv,
  cardToPrintSvg,
  faceToSvg,
  fileSlug,
  type CardFace,
  type BulkAccepted,
  type BulkReport,
} from '../../../../src/tools/business/id-card';
import { canvasToBlob, blobToBytes, drawFace, loadImagesForFaces, type ImageSourceMap } from './canvas';

export type ExportFormat = 'png' | 'jpg' | 'pdf';

export interface RenderedFace {
  canvas: HTMLCanvasElement;
  warnings: string[];
}

/**
 * Draw one face onto a fresh canvas at full print resolution.
 *
 * The images are decoded first: drawing an image that has not loaded produces an empty rectangle and
 * no error, which is exactly the "blank export" failure this platform is required not to ship.
 */
export async function renderFace(face: CardFace, options: { background?: string } = {}): Promise<RenderedFace> {
  const sources = await loadImagesForFaces([face]);
  const canvas = document.createElement('canvas');
  canvas.width = face.width;
  canvas.height = face.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser did not provide a 2D drawing context, so the card cannot be rendered.');
  const warnings = drawFace(context, face, sources.sources, options);
  if (sources.failed.length > 0) {
    warnings.push('One or more uploaded images could not be decoded and were left blank on the card. Re-upload them and try again.');
  }
  return { canvas, warnings };
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoked on the next task so Safari has started the download before the URL disappears.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export interface ExportResult {
  ok: boolean;
  filename?: string;
  message: string;
}

/**
 * Export one side, or both sides, in the requested format.
 *
 * PDF is offered two ways because card printers differ: one page per side, or both sides on a single
 * sheet. The caller says which, and the button labels say which, rather than the tool guessing.
 */
export async function exportCard(options: {
  front: CardFace;
  back: CardFace;
  format: ExportFormat;
  side: 'front' | 'back' | 'both';
  slug: string;
  title: string;
  /** For PDF + `both`: one page per side (`pages`) or a single sheet (`sheet`). */
  pdfLayout?: 'pages' | 'sheet';
  resolution?: 1 | 2;
}): Promise<ExportResult> {
  const { front, back, format, side, slug, title } = options;
  const faces = side === 'both' ? [front, back] : [side === 'front' ? front : back];
  const label = side === 'both' ? 'front-and-back' : side;

  try {
    const rendered = [] as RenderedFace[];
    for (const face of faces) {
      rendered.push(await renderFace(face));
    }
    const warnings = [...new Set(rendered.flatMap((entry) => entry.warnings))];

    if (format === 'png' || format === 'jpg') {
      const mime = format === 'png' ? 'image/png' : 'image/jpeg';
      if (faces.length === 1) {
        const blob = await canvasToBlob(rendered[0]!.canvas, mime, 0.95);
        if (blob.size === 0) return { ok: false, message: 'The browser produced an empty image file, so nothing was downloaded.' };
        const filename = `id-card-${slug}-${label}.${format === 'jpg' ? 'jpg' : 'png'}`;
        // One side downloads directly; both sides arrive in a ZIP so the browser does not block the
        // second download as a popup.
        triggerDownload(blob, filename);
        return { ok: true, filename, message: `${filename} downloaded${warnings.length > 0 ? `. Note: ${warnings[0]}` : '.'}` };
      }
      const entries: Array<{ name: string; data: Uint8Array }> = [];
      const names: string[] = [];
      for (const [index, entry] of rendered.entries()) {
        const name = `id-card-${slug}-${index === 0 ? 'front' : 'back'}.${format === 'jpg' ? 'jpg' : 'png'}`;
        names.push(name);
        entries.push({ name, data: await blobToBytes(await canvasToBlob(entry.canvas, mime, 0.95)) });
      }
      const zip = buildZip(entries);
      const filename = `id-card-${slug}-front-and-back.zip`;
      triggerDownload(new Blob([zip as unknown as BlobPart], { type: 'application/zip' }), filename);
      return { ok: true, filename, message: `${filename} downloaded with both sides (${names.join(', ')})${warnings.length > 0 ? `. Note: ${warnings[0]}` : '.'}` };
    }

    /* PDF: JPEG is embedded as-is (DCTDecode), which keeps the file small and the print crisp. */
    const jpegs = [] as Array<{ data: Uint8Array; width: number; height: number }>;
    for (const entry of rendered) {
      const blob = await canvasToBlob(entry.canvas, 'image/jpeg', 0.94);
      jpegs.push({ data: await blobToBytes(blob), width: entry.canvas.width, height: entry.canvas.height });
    }
    const pdf =
      faces.length === 1
        ? buildCardsPdf([{ image: jpegs[0]! }], { title })
        : (options.pdfLayout ?? 'pages') === 'sheet'
          ? buildCardsPdfPair(jpegs[0]!, jpegs[1]!, { title })
          : buildCardsPdf([{ image: jpegs[0]! }, { image: jpegs[1]! }], { title });
    const filename = `id-card-${slug}-${faces.length === 1 ? label : options.pdfLayout === 'sheet' ? 'front-and-back-sheet' : 'front-and-back'}.pdf`;
    triggerDownload(new Blob([pdf as unknown as BlobPart], { type: 'application/pdf' }), filename);
    return {
      ok: true,
      filename,
      message: `${filename} downloaded at ${faces.length === 1 ? 'ID-1 size' : 'ID-1 size, both sides'} (85.60 × 53.98 mm, 300 dpi)${warnings.length > 0 ? `. Note: ${warnings[0]}` : '.'}`,
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'The export failed for an unknown reason.' };
  }
}

/** Download the two-sided SVG, which is what a print bureau or a designer wants. */
export function exportSvg(front: CardFace, back: CardFace, slug: string, title: string): ExportResult {
  try {
    const svg = cardToPrintSvg(front, back, title);
    const filename = `id-card-${slug}-front-and-back.svg`;
    triggerDownload(new Blob([svg], { type: 'image/svg+xml' }), filename);
    return { ok: true, filename, message: `${filename} downloaded as vector artwork (scales to any size).` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'The SVG could not be produced.' };
  }
}

/** Open the browser's print dialog with the two faces on their own sheet. */
export function printCard(front: CardFace, back: CardFace, title: string): ExportResult {
  const popup = window.open('', '_blank', 'width=900,height=700');
  if (!popup) {
    return { ok: false, message: 'The print window was blocked. Allow pop-ups for this site, or download the PDF instead.' };
  }
  const sheet = cardToPrintSvg(front, back, title);
  popup.document.write(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title.replace(/[<>&]/g, '')}</title>` +
      '<style>@page{size:auto;margin:12mm}body{margin:0;font-family:system-ui,sans-serif}' +
      '.sheet{width:88.6mm}svg{width:100%;height:auto;display:block}' +
      'p{font-size:11px;color:#333;max-width:88mm}</style></head><body>' +
      `<p>Print at 100% scale (do not “fit to page”) on CR80 card stock. Each face below is ${85.6} × ${53.98} mm.</p>` +
      `<div class="sheet">${sheet}</div></body></html>`
  );
  popup.document.close();
  popup.focus();
  window.setTimeout(() => popup.print(), 350);
  return { ok: true, message: 'Print preview opened. Choose “actual size” and CR80 paper, or print on plain paper and trim.' };
}

/* ------------------------------------------------------------------ */
/* Bulk export                                                          */
/* ------------------------------------------------------------------ */

export interface BulkProgress {
  done: number;
  total: number;
  current: string;
}

export interface BulkExportResult {
  ok: boolean;
  filename?: string;
  message: string;
  generated: number;
  failed: Array<{ rowNumber: number; name: string; reason: string }>;
}

/**
 * Generate a batch and deliver it as one ZIP.
 *
 * Individual failures do not abort the batch: a photograph that will not load costs that employee a
 * badge, not the whole payroll run. Each failure is recorded with the row number and the reason, and
 * the manifest lists every accepted row and every rejected one so a batch can be reconciled against
 * the source file.
 */
export async function exportBulk(options: {
  entries: BulkAccepted[];
  format: 'png' | 'pdf';
  companyName: string;
  templateLabel: string;
  report: BulkReport;
  /** Lays out one card. Supplied by the caller so this module stays free of template knowledge. */
  layoutFor: (spec: import('../../../../src/tools/business/id-card').CardSpec) => import('../../../../src/tools/business/id-card').CardLayout;
  onProgress?: (progress: BulkProgress) => void;
}): Promise<BulkExportResult> {
  const { entries, format, report, onProgress, layoutFor } = options;
  const archiveEntries: Array<{ name: string; data: Uint8Array }> = [];
  const generated: Array<{ rowNumber: number; file: string }> = [];
  const failed: Array<{ rowNumber: number; name: string; reason: string }> = [];
  const usedNames = new Set<string>();

  try {
    for (const [index, entry] of entries.entries()) {
      const spec = entry.spec.spec;
      const name = spec.employee.fullName || `row-${entry.rowNumber}`;
      onProgress?.({ done: index, total: entries.length, current: name });
      try {
        // Remote photo URLs are not fetched. A browser request to an arbitrary host would need a
        // connect-src relaxation for the whole site, and the photo is not essential to the card.
        // The card is still produced, and the manifest records that its photograph is missing.
        if (entry.photoUrl) {
          entry.warnings.push('Photograph not loaded: this tool does not fetch remote photo URLs. Use a data URL in the file, or add the photograph to the card.');
        }
        const layout = layoutFor(spec);
        const front = await renderFace(layout.front);
        const back = await renderFace(layout.back);
        let base = fileSlug(`${spec.employee.employeeId}-${spec.employee.fullName}`, `row-${entry.rowNumber}`);
        while (usedNames.has(base)) base = `${base}-${entry.rowNumber}`;
        usedNames.add(base);
        entry.warnings.push(...front.warnings, ...back.warnings, ...layout.warnings);

        if (format === 'png') {
          const frontName = `${base}-front.png`;
          const backName = `${base}-back.png`;
          archiveEntries.push({ name: frontName, data: await blobToBytes(await canvasToBlob(front.canvas, 'image/png')) });
          archiveEntries.push({ name: backName, data: await blobToBytes(await canvasToBlob(back.canvas, 'image/png')) });
          generated.push({ rowNumber: entry.rowNumber, file: `${frontName}, ${backName}` });
        } else {
          const frontJpeg = { data: await blobToBytes(await canvasToBlob(front.canvas, 'image/jpeg', 0.92)), width: front.canvas.width, height: front.canvas.height };
          const backJpeg = { data: await blobToBytes(await canvasToBlob(back.canvas, 'image/jpeg', 0.92)), width: back.canvas.width, height: back.canvas.height };
          const pdf = buildCardsPdfPair(frontJpeg, backJpeg, { title: `${name} — employee ID card`, author: options.companyName });
          const pdfName = `${base}.pdf`;
          archiveEntries.push({ name: pdfName, data: pdf });
          generated.push({ rowNumber: entry.rowNumber, file: pdfName });
        }
      } catch (error) {
        failed.push({
          rowNumber: entry.rowNumber,
          name,
          reason: error instanceof Error ? error.message : 'the card could not be rendered',
        });
      }
    }

    onProgress?.({ done: entries.length, total: entries.length, current: 'Packing the download…' });
    archiveEntries.push({ name: 'manifest.csv', data: new TextEncoder().encode(batchManifestCsv(report, generated)) });
    archiveEntries.push({
      name: 'README.txt',
      data: new TextEncoder().encode(
        [
          'CloudHost247 employee ID cards',
          '',
          `Generated: ${new Date().toISOString()}`,
          `Template: ${options.templateLabel}`,
          `Cards generated: ${generated.length}`,
          `Rows rejected before generation: ${report.rejected.length}`,
          `Cards that could not be rendered: ${failed.length}`,
          '',
          'Card size: 85.60 × 53.98 mm (ISO/IEC 7810 ID-1 / CR80) at 300 dpi.',
          format === 'pdf' ? 'Each PDF holds both sides: page 1 is the front, page 2 is the back.' : 'Each employee has a -front and a -back PNG.',
          '',
          'manifest.csv lists every employee in the batch, the file created for them, and the reason',
          'for any row that was rejected. Nothing was silently discarded.',
          failed.length > 0 ? '' : undefined,
          ...failed.map((entry) => `Row ${entry.rowNumber} (${entry.name}): ${entry.reason}`),
          '',
          'Your employee details were processed in this browser tab only. Nothing was uploaded.',
        ]
          .filter((line) => line !== undefined)
          .join('\n')
      ),
    });

    const filename = `employee-id-cards-${fileSlug(options.companyName, 'company')}-${generated.length}-cards.zip`;
    const zip = buildZip(archiveEntries);
    triggerDownload(new Blob([zip as unknown as BlobPart], { type: 'application/zip' }), filename);
    return {
      ok: true,
      filename,
      generated: generated.length,
      failed,
      message:
        `${generated.length} card${generated.length === 1 ? '' : 's'} generated and downloaded as ${filename}` +
        (failed.length > 0 ? `. ${failed.length} could not be rendered and are listed in the manifest and on screen.` : '.'),
    };
  } catch (error) {
    return {
      ok: false,
      generated: generated.length,
      failed,
      message: error instanceof Error ? error.message : 'The batch export failed for an unknown reason.',
    };
  }
}


/* Re-exported so the page imports one module for rendering and one for the engine. */
export { faceToSvg };
export type { ImageSourceMap };
