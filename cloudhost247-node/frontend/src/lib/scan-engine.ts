/**
 * Barcode Scanner: the decoder this browser gets, fetched when the visitor first asks to scan.
 *
 * Two decoders exist (see `src/tools/scanner/formats.ts`). The full one is zxing-cpp compiled to
 * WebAssembly: about 50 kB of JavaScript and a 0.9 MB binary, both served by this site. The basic
 * one is ZXing in JavaScript, 0.4 MB. A browser is given the full one if it will run it and the
 * basic one if it will not, and never both.
 *
 * "Will not" covers a browser without WebAssembly, one where a security setting forbids it (Edge's
 * enhanced security mode and iOS Lockdown Mode both do), one too old to know the
 * `'wasm-unsafe-eval'` that this site's Content-Security-Policy grants, a network that will not
 * deliver a .wasm file, and a device without the memory to start it.
 */
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import type { ScanHit, ScanPixels } from '../../../src/tools/scanner/formats';
import { scanFrame, scanStill, type CppRead } from './scan-cpp';

export type ScanEngineKind = 'full' | 'basic';

export interface ScanEngine {
  kind: ScanEngineKind;
  /**
   * One camera frame. `sideways` asks for the frame to be searched turned a quarter turn: the
   * caller alternates it, and the basic decoder searches one way per frame. The full decoder
   * searches both ways every time and ignores it.
   */
  frame(pixels: ScanPixels, sideways: boolean): Promise<ScanHit | null>;
  /** One still picture, searched as hard as the decoder can. `pause` is awaited between passes, so the screen can update. */
  still(pixels: ScanPixels, pause: () => Promise<void>): Promise<ScanHit | null>;
}

/**
 * Whether this page may run WebAssembly, found out without fetching anything: the smallest module
 * there is, its eight-byte header, is compiled. Where WebAssembly is missing there is no object to
 * ask; where it is forbidden the attempt throws.
 */
export function webAssemblyAllowed(): boolean {
  try {
    if (typeof WebAssembly !== 'object' || typeof WebAssembly.Module !== 'function' || typeof WebAssembly.instantiate !== 'function') return false;
    new WebAssembly.Module(Uint8Array.of(0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00));
    return true;
  } catch {
    return false;
  }
}

async function loadFull(): Promise<ScanEngine> {
  // The binary is fetched here and handed over. Left to itself the library asks a public CDN for
  // it, which this site's policy refuses, and which would tell a third party who is scanning.
  const [library, binary] = await Promise.all([
    import('zxing-wasm/reader'),
    fetch(wasmUrl, { credentials: 'same-origin' }).then((response) => {
      if (!response.ok) throw new Error(`The decoder was not delivered (HTTP ${response.status}).`);
      return response.arrayBuffer();
    }),
  ]);
  try {
    await library.prepareZXingModule({ overrides: { wasmBinary: binary }, fireImmediately: true });
  } catch (error) {
    // The library keeps a start that failed; forget it, so nothing later waits on it.
    library.purgeZXingModule();
    throw error;
  }
  // The library names the browser's ImageData; it reads width, height and data.
  const read: CppRead = (pixels, options) => library.readBarcodes(pixels as unknown as ImageData, options);
  // One read of nothing, so a decoder that started but cannot work is found out here, where the
  // basic one can still take its place, and not in the middle of somebody's scan.
  await read({ data: new Uint8ClampedArray(16 * 16 * 4).fill(255), width: 16, height: 16 }, { formats: ['QRCode'], maxNumberOfSymbols: 1 });
  return {
    kind: 'full',
    frame: (pixels) => scanFrame(read, pixels),
    still: (pixels, pause) => scanStill(read, pixels, pause),
  };
}

async function loadBasic(): Promise<ScanEngine> {
  const decoder = await import('../../../src/tools/scanner/decode');
  return {
    kind: 'basic',
    frame: async (pixels, sideways) => decoder.scanPixels(pixels, 'quick', sideways),
    still: async (pixels, pause) => {
      // One pass at a time: an exhaustive search of a picture that holds no barcode takes a second or two.
      for (const pass of decoder.scanPasses(pixels)) {
        await pause();
        const hit = pass();
        if (hit) return hit;
      }
      return null;
    },
  };
}

async function load(): Promise<ScanEngine> {
  if (webAssemblyAllowed()) {
    try {
      return await loadFull();
    } catch {
      // Whatever stopped it, the basic decoder asks less of the browser.
    }
  }
  return loadBasic();
}

let engine: Promise<ScanEngine> | null = null;

/**
 * The decoder, fetched once. A fetch that fails altogether is forgotten here, so that the next
 * attempt asks again. That helps only in browsers that ask the network again: Chromium remembers a
 * script that failed to load until the page is refreshed, which is why the page's message says to
 * refresh.
 */
export function loadScanEngine(): Promise<ScanEngine> {
  engine ??= load().catch((error: unknown) => {
    engine = null;
    throw error;
  });
  return engine;
}
