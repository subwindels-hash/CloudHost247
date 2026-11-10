/**
 * Test-only decoding harness.
 *
 * We do not trust a visual inspection of a barcode: the only proof that a symbol is correct is that
 * an independent decoder reads the payload back out of the rendered pixels. The pipeline is
 *
 *   DesignDocument/EncodedBarcode -> our SVG renderer -> @resvg raster -> zxing-wasm decoder
 *
 * `@resvg/resvg-js` is a native SVG rasteriser (no browser), and `zxing-wasm` is the ZXing-C++ port
 * compiled to WebAssembly, which knows the 1D symbologies (`UPC-E`, `ITF`, `Codabar`) and the 2D ones
 * (`MicroQRCode`, `Aztec`, `PDF417`) that the pure-JS `@zxing/library` build does not reliably decode.
 *
 * Nothing in `src/` imports this file; it exists for tests and scripts only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { prepareZXingModule, readBarcodes, type ReaderOptions } from 'zxing-wasm/reader';

let prepared = false;

function prepare(): void {
  if (prepared) return;
  // Loading the wasm binary directly keeps the tests offline: `locateFile` would try to fetch it.
  const wasm = path.join(process.cwd(), 'node_modules/zxing-wasm/dist/reader/zxing_reader.wasm');
  prepareZXingModule({ overrides: { wasmBinary: fs.readFileSync(wasm) as unknown as ArrayBuffer } });
  prepared = true;
}

export interface DecodedSymbol {
  format: string;
  text: string;
}

/** Rasterise an SVG string to PNG at a given pixel width (1 CSS px per pixel). */
export function rasterise(svg: string, widthPx = 2400): Buffer {
  return new Resvg(svg, { fitTo: { mode: 'width', value: widthPx } }).render().asPng();
}

/** Decode every symbol that `zxing-wasm` can find in a PNG buffer. */
export async function decodePng(png: Buffer, options: ReaderOptions = {}): Promise<DecodedSymbol[]> {
  prepare();
  const results = await readBarcodes(new Blob([new Uint8Array(png)], { type: 'image/png' }), {
    tryHarder: true,
    tryRotate: true,
    ...options,
  });
  return results
    .filter((entry) => entry.isValid !== false && entry.text)
    .map((entry) => ({ format: entry.format, text: entry.text }));
}

/** Decode every symbol in an SVG (a label can carry a QR *and* a Code 128). */
export async function decodeAll(svg: string, widthPx = 2400, options: ReaderOptions = {}): Promise<DecodedSymbol[]> {
  return decodePng(rasterise(svg, widthPx), options);
}

/** Convenience: rasterise an SVG and return the first decoded payload, or `null`. */
export async function decodeSvg(svg: string, widthPx = 2400, options: ReaderOptions = {}): Promise<DecodedSymbol | null> {
  const found = await decodePng(rasterise(svg, widthPx), options);
  return found[0] ?? null;
}
