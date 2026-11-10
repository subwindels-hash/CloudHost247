/**
 * Test-only helper: rasterise a page of a generated PDF with MuPDF and decode it.
 *
 * Separate from `decode.ts` because MuPDF is an ESM-only module and is only needed by the tests that
 * prove the PDF export is print-accurate, not by the SVG tests.
 */
import { decodePng, type DecodedSymbol } from './decode';
import type { ReaderOptions } from 'zxing-wasm/reader';

interface Region {
  /** Fractions of the page, 0..1, measured from the top-left. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Render one page of a PDF to PNG at `scale` device pixels per PDF point. */
export async function rasterisePdfPage(pdf: Uint8Array, pageIndex = 0, scale = 8): Promise<Buffer> {
  const mupdf = await import('mupdf');
  const doc = mupdf.Document.openDocument(pdf, 'application/pdf');
  const page = doc.loadPage(pageIndex);
  return Buffer.from(page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false).asPNG());
}

/**
 * Crop a fraction of a PNG and re-encode it, so a single symbol can be decoded without the rest of
 * the page confusing the binarizer (a shipping label carries a Code 128, a QR and a DataMatrix).
 */
export async function cropPng(png: Buffer, region: Region): Promise<Buffer> {
  const { PNG } = await import('pngjs');
  const image = PNG.sync.read(png);
  const left = Math.floor(region.x0 * image.width);
  const top = Math.floor(region.y0 * image.height);
  const width = Math.max(1, Math.floor((region.x1 - region.x0) * image.width));
  const height = Math.max(1, Math.floor((region.y1 - region.y0) * image.height));
  const out = new PNG({ width, height });
  PNG.bitblt(image, out, left, top, width, height, 0, 0);
  return PNG.sync.write(out);
}

/** Decode a region of a rendered PDF page. */
export async function decodePdfRegion(
  pdf: Uint8Array,
  region: Region,
  options: ReaderOptions = {},
  scale = 8
): Promise<DecodedSymbol[]> {
  const page = await rasterisePdfPage(pdf, 0, scale);
  return decodePng(await cropPng(page, region), options);
}
