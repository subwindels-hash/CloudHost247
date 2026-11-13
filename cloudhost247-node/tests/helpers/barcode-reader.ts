/**
 * An independent barcode decoder for the test suite (zxing-cpp compiled to WebAssembly).
 *
 * The Design Studio never ships a decoder: its job is to draw symbols, and the evidence that a
 * drawn symbol carries its payload has to come from code that shares nothing with the encoder.
 * This is that code. The same library is the Barcode Scanner page's full decoder
 * (`frontend/src/lib/scan-engine.ts`), which is the one place production code loads it; a test
 * asserts that no server module and no Design Studio module does. It stays a devDependency: the
 * frontend build bundles it, and the server never needs it at run time.
 *
 * In Node the library cannot fetch its own `.wasm` file, so the binary is read from the installed
 * package and handed over once.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { prepareZXingModule, readBarcodes, type ReaderOptions, type ReadResult } from 'zxing-wasm/reader';
import { PNG } from 'pngjs';

let prepared: Promise<unknown> | null = null;

function prepare(): Promise<unknown> {
  if (!prepared) {
    // The package only exports its entry points, so the binary is located relative to one of them.
    const require = createRequire(__filename);
    const entry = require.resolve('zxing-wasm/reader');
    let directory = dirname(entry);
    let wasmPath = join(directory, 'zxing_reader.wasm');
    for (let depth = 0; depth < 4; depth += 1) {
      try {
        readFileSync(wasmPath);
        break;
      } catch {
        directory = dirname(directory);
        wasmPath = join(directory, 'reader', 'zxing_reader.wasm');
      }
    }
    const wasmBinary = readFileSync(wasmPath);
    prepared = Promise.resolve(
      prepareZXingModule({
        overrides: { wasmBinary: wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength) as ArrayBuffer },
        fireImmediately: true,
      })
    );
  }
  return prepared;
}

export type { ReaderOptions };

export interface DecodedSymbol {
  format: string;
  text: string;
  /** False when the decoder found the symbol but its checksum or structure did not verify. */
  valid: boolean;
  error: string;
}

export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Every symbol the decoder finds in an RGBA image. */
export async function decodePixels(pixels: Pixels, options: ReaderOptions = {}): Promise<DecodedSymbol[]> {
  await prepare();
  // The reader's type names the browser's ImageData; it only reads width, height and data.
  const results = await readBarcodes(pixels as unknown as Parameters<typeof readBarcodes>[0], {
    tryHarder: true,
    tryRotate: true,
    tryInvert: false,
    tryDownscale: false,
    maxNumberOfSymbols: 32,
    returnErrors: true,
    ...options,
  });
  return results.map((result) => ({ format: String(result.format), text: result.text, valid: result.isValid, error: result.error ?? '' }));
}

/**
 * Decode a PNG file's pixels.
 *
 * Transparent pixels are composited onto white first: a transparent barcode image ends up on
 * paper, and a decoder that looked only at the colour channels would see solid black.
 */
export async function decodePng(png: Uint8Array, options: ReaderOptions = {}): Promise<DecodedSymbol[]> {
  const image = PNG.sync.read(Buffer.from(png));
  const data = new Uint8ClampedArray(image.data);
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = (data[offset + 3] as number) / 255;
    data[offset] = Math.round((data[offset] as number) * alpha + 255 * (1 - alpha));
    data[offset + 1] = Math.round((data[offset + 1] as number) * alpha + 255 * (1 - alpha));
    data[offset + 2] = Math.round((data[offset + 2] as number) * alpha + 255 * (1 - alpha));
    data[offset + 3] = 255;
  }
  return decodePixels({ width: image.width, height: image.height, data }, options);
}

/**
 * The library's reading function, started from the installed binary, taking whatever options the
 * caller gives. This is what the scanner page hands its full decoder in a browser; the scanner's
 * tests hand it the same thing here.
 */
export async function libraryReader(): Promise<(pixels: { data: Uint8ClampedArray | Uint8Array; width: number; height: number }, options: ReaderOptions) => Promise<ReadResult[]>> {
  await prepare();
  return (pixels, options) => readBarcodes(pixels as unknown as Parameters<typeof readBarcodes>[0], options);
}
