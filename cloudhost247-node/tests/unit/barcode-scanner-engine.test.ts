/**
 * Barcode Scanner: which decoder a browser is given (`frontend/src/lib/scan-engine.ts`).
 *
 * The loader is run here as it is, under Node: it needs `fetch`, `WebAssembly` and nothing of a
 * page. The library and its binary are the real ones, so "the full decoder" below is the full
 * decoder, started the way the page starts it. What stands in for the network is `fetch`, which
 * answers with the installed binary, or with whatever a test says a bad network would answer.
 *
 * Whether a real browser lets the page do this under the site's security policy is a question for a
 * real browser: e2e/barcode-scanner.spec.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PNG } from 'pngjs';

import { renderSymbolPng } from '../../src/tools/design-studio/barcode/encoder';
import { symbologyById } from '../../src/tools/design-studio/barcode/symbologies';
import type { ScanPixels } from '../../src/tools/scanner/formats';

type Loader = typeof import('../../frontend/src/lib/scan-engine');

const BINARY = readFileSync(createRequire(__filename).resolve('zxing-wasm/reader/zxing_reader.wasm'));
const binaryResponse = (): Response => new Response(new Uint8Array(BINARY), { status: 200, headers: { 'content-type': 'application/wasm' } });

async function pixels(id: string): Promise<ScanPixels> {
  const symbology = symbologyById(id);
  if (!symbology) throw new Error(`No barcode type ${id}.`);
  const { png } = await renderSymbolPng({ symbology, data: symbology.sample, dpi: 300, quietZone: true, background: '#ffffff' });
  const image = PNG.sync.read(Buffer.from(png));
  return { data: new Uint8Array(image.data), width: image.width, height: image.height };
}

const noPause = async (): Promise<void> => undefined;

/** The loader keeps the decoder it was given for the life of the page; each test is a new page. */
async function freshLoader(): Promise<Loader> {
  vi.resetModules();
  return import('../../frontend/src/lib/scan-engine');
}

describe('the decoder a browser is given', () => {
  let fetched: string[];

  beforeEach(() => {
    fetched = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('zxing-wasm/reader');
    vi.doUnmock('../../src/tools/scanner/decode');
  });

  const network = (answer: (url: string) => Response | Promise<Response>): void => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        fetched.push(String(input));
        return answer(String(input));
      })
    );
  };

  it('is the full decoder where WebAssembly runs: one file fetched, from this site, and all the types read', async () => {
    network(binaryResponse);
    const { loadScanEngine, webAssemblyAllowed } = await freshLoader();
    expect(webAssemblyAllowed()).toBe(true);
    const engine = await loadScanEngine();
    expect(engine.kind).toBe('full');
    // The binary is asked for by a path on this site: no host, and so no third party.
    expect(fetched).toHaveLength(1);
    expect(fetched[0]).toMatch(/^\/[^/].*\/zxing_reader\.wasm$/);

    expect(await engine.still(await pixels('code128'), noPause)).toEqual({ format: 'code_128', formatName: 'Code 128', text: 'CH247-000123' });
    expect(await engine.still(await pixels('upce'), noPause)).toEqual({ format: 'upc_e', formatName: 'UPC-E', text: '01234558' });
    expect(await engine.still(await pixels('microqr'), noPause)).toEqual({ format: 'micro_qr_code', formatName: 'Micro QR Code', text: '12345678' });
    // A camera frame is searched both ways up whatever the caller's alternation says.
    const sideways = await pixels('code128');
    expect((await engine.frame(sideways, false))?.text).toBe('CH247-000123');
    expect((await engine.frame(sideways, true))?.text).toBe('CH247-000123');
    // Asked again, it is the same decoder: nothing more is fetched.
    expect(await loadScanEngine()).toBe(engine);
    expect(fetched).toHaveLength(1);
  });

  it('is the basic decoder where the binary is not delivered, and the page is told which it got', async () => {
    for (const answer of [
      () => new Response('Not found', { status: 404 }),
      () => Promise.reject(new TypeError('Failed to fetch')),
      // A server that answers every unknown address with its home page.
      () => new Response('<!doctype html><title>CloudHost247</title>', { status: 200, headers: { 'content-type': 'text/html' } }),
      // A download cut short.
      () => new Response(new Uint8Array(BINARY.subarray(0, 5000)), { status: 200, headers: { 'content-type': 'application/wasm' } }),
    ]) {
      network(answer);
      const { loadScanEngine } = await freshLoader();
      const engine = await loadScanEngine();
      expect(engine.kind).toBe('basic');
      expect(fetched.at(-1)).toMatch(/zxing_reader\.wasm$/);
      expect(await engine.still(await pixels('code128'), noPause)).toEqual({ format: 'code_128', formatName: 'Code 128', text: 'CH247-000123' });
      // The types that need the full decoder are not read, and nothing is made up in their place.
      expect(await engine.still(await pixels('upce'), noPause)).toBeNull();
    }
  }, 60_000);

  it('is the basic decoder where WebAssembly is missing or forbidden, without fetching the binary', async () => {
    const forbidden = {
      ...WebAssembly,
      // What a browser does under a policy that does not allow WebAssembly to be compiled.
      Module: function Module(): never {
        throw new Error("Refused to compile or instantiate WebAssembly module because 'unsafe-eval' is not an allowed source of script");
      },
    };
    for (const stand of [undefined, forbidden]) {
      network(binaryResponse);
      vi.stubGlobal('WebAssembly', stand);
      const { loadScanEngine, webAssemblyAllowed } = await freshLoader();
      expect(webAssemblyAllowed()).toBe(false);
      const engine = await loadScanEngine();
      expect(engine.kind).toBe('basic');
      expect(fetched).toEqual([]);
      vi.unstubAllGlobals();
    }
  });

  it('gives the basic decoder its frames one way up at a time, and its still pictures a pass at a time', async () => {
    network(() => new Response('Not found', { status: 404 }));
    const { loadScanEngine } = await freshLoader();
    const engine = await loadScanEngine();
    expect(engine.kind).toBe('basic');
    const upright = await pixels('code128');
    expect((await engine.frame(upright, false))?.text).toBe('CH247-000123');
    expect(await engine.frame(upright, true)).toBeNull();
    // The screen is given a turn before every pass: once for a barcode the first pass reads, and
    // once for each pass over a picture that holds none.
    let pauses = 0;
    const pause = async (): Promise<void> => {
      pauses += 1;
    };
    expect((await engine.still(upright, pause))?.text).toBe('CH247-000123');
    expect(pauses).toBe(1);
    const blank: ScanPixels = { data: new Uint8Array(300 * 200 * 4).fill(255), width: 300, height: 200 };
    expect(await engine.still(blank, pause)).toBeNull();
    expect(pauses).toBeGreaterThanOrEqual(7);
  });

  it('is the basic decoder where the full one starts and then cannot read', async () => {
    network(binaryResponse);
    vi.doMock('zxing-wasm/reader', async (original) => ({
      ...(await original<typeof import('zxing-wasm/reader')>()),
      readBarcodes: async () => {
        throw new Error('Failed to allocate 1024 bytes in WASM memory');
      },
    }));
    const { loadScanEngine } = await freshLoader();
    const engine = await loadScanEngine();
    expect(engine.kind).toBe('basic');
    expect((await engine.still(await pixels('code128'), noPause))?.text).toBe('CH247-000123');
  });

  it('fails, and asks again the next time, where neither decoder can be fetched', async () => {
    network(() => Promise.reject(new TypeError('Failed to fetch')));
    let attempts = 0;
    vi.doMock('../../src/tools/scanner/decode', () => {
      attempts += 1;
      throw new Error('Failed to fetch dynamically imported module');
    });
    const { loadScanEngine } = await freshLoader();
    await expect(loadScanEngine()).rejects.toThrow();
    expect(attempts).toBe(1);
    // A failure is not kept as the answer.
    await expect(loadScanEngine()).rejects.toThrow();
    expect(attempts).toBe(2);
    expect(fetched).toHaveLength(2);
  });
});
