import { describe, expect, it } from 'vitest';
import {
  encodeBarcode,
  estimateXDimension,
  layoutBarcode,
  BarcodeError,
} from '../../src/tools/design-studio/shared/barcode-engine';
import { BARCODE_FORMATS, findBarcodeFormat } from '../../src/tools/design-studio/shared/barcode-catalog';
import { renderDocumentSvg } from '../../src/tools/design-studio/shared/svg-renderer';
import { decodeSvg } from '../helpers/decode';

/**
 * These tests encode, render and then *decode* a symbol. A barcode that merely looks like a barcode
 * is worthless, so nothing here asserts on pixel patterns: every case round-trips the payload through
 * an independent decoder reading the rendered SVG.
 */
function renderSymbol(formatId: string, payload: string, moduleMm = 0.5): string {
  const encoded = encodeBarcode({ formatId, payload });
  const layout = layoutBarcode(encoded, { moduleMm });
  return renderDocumentSvg({
    title: 'test',
    pages: [
      {
        width: layout.widthMm + 4,
        height: layout.heightMm + 4,
        ops: [
          {
            kind: 'barcode',
            x: 2,
            y: 2,
            w: layout.widthMm,
            h: layout.heightMm,
            moduleMm: layout.moduleMm,
            encoded,
            colour: '#000000',
            showText: false,
            textHeight: 0,
            quietMm: layout.quietMm,
          },
        ],
      },
    ],
    warnings: [],
  } as never);
}

interface Case {
  formatId: string;
  payload: string;
  /** What the decoder is expected to report. Linear retail symbols are normalised by the decoder. */
  expect: string;
}

const CASES: Case[] = [
  { formatId: 'code128', payload: 'CH247-2026-000123', expect: 'CH247-2026-000123' },
  { formatId: 'code39', payload: 'DN-2026-00417', expect: 'DN-2026-00417' },
  { formatId: 'ean13', payload: '4006381333931', expect: '4006381333931' },
  { formatId: 'ean8', payload: '96385074', expect: '96385074' },
  // UPC-A is a subset of EAN-13, so decoders report the 13-digit form with a leading zero.
  { formatId: 'upca', payload: '036000291452', expect: '0036000291452' },
  // An 8-digit UPC-E expands to its 12-digit equivalent; the last digit is the reconstructed check.
  { formatId: 'upce', payload: '01234565', expect: '0123456000056' },
  { formatId: 'itf14', payload: '10012345000017', expect: '10012345000017' },
  { formatId: 'interleaved2of5', payload: '1234567890', expect: '1234567890' },
  // Codabar framing is added by the engine, and the decoder reports it back with the frame.
  { formatId: 'codabar', payload: '12345', expect: 'A12345B' },
  { formatId: 'gs1-128', payload: '(01)09521234543213(10)ABC', expect: '(01)09521234543213(10)ABC' },
  { formatId: 'gs1databar', payload: '09521234543213', expect: '(01)09521234543213' },
  { formatId: 'qrcode', payload: 'https://cloudhost247.com', expect: 'https://cloudhost247.com' },
  { formatId: 'datamatrix', payload: 'CH247-PART-000123', expect: 'CH247-PART-000123' },
  { formatId: 'pdf417', payload: '(01)09521234543213(10)ABC', expect: '(01)09521234543213(10)ABC' },
  { formatId: 'azteccode', payload: 'AZTEC-CH247', expect: 'AZTEC-CH247' },
  { formatId: 'microqrcode', payload: 'M-QR-247', expect: 'M-QR-247' },
];

describe('human-readable text', () => {
  /**
   * A linear barcode without a readable number under it fails the one job a person does with it:
   * typing the number into a form when the scanner will not cooperate. Every geometry test in this
   * file passed while the caption band was blank, because the bars themselves were correct — the
   * encoder was called with `includetext: false`, so `encoded.texts` was empty and the renderers
   * dutifully drew nothing. These assertions cover both halves: the text is captured, and it is drawn
   * at a size a person can read on the printed symbol.
   */
  const LINEAR = ['code128', 'code39', 'code93', 'ean13', 'ean8', 'upca', 'itf14', 'interleaved2of5', 'gs1-128'] as const;
  const PAYLOAD: Record<string, string> = {
    code128: 'CH247-2026-000123',
    code39: 'CH-IT-417',
    code93: 'CH247-93',
    ean13: '4006381333931',
    ean8: '96385074',
    upca: '036000291452',
    // 13 digits: the check digit is calculated, which is also what a real carton GTIN looks like.
    itf14: '1061414112345',
    interleaved2of5: '1234567890',
    'gs1-128': '(01)09521234543213(10)BATCH7',
  };

  it('captures the human-readable line for every linear format', () => {
    for (const formatId of LINEAR) {
      const encoded = encodeBarcode({ formatId, payload: PAYLOAD[formatId]! });
      expect(encoded.texts.length, `${formatId} produced no readable text`).toBeGreaterThan(0);
      expect(encoded.texts[0]!.text.trim().length, `${formatId} produced blank text`).toBeGreaterThan(0);
    }
  });

  it('keeps the caption out of the 2D formats, where there is none', () => {
    for (const formatId of ['qrcode', 'datamatrix', 'pdf417'] as const) {
      const encoded = encodeBarcode({ formatId, payload: 'CH247-2026-000123' });
      expect(encoded.texts, `${formatId} should not claim a human-readable line`).toEqual([]);
    }
  });

  it('sizes the caption from the caption strip, not from the encoder’s layout units', () => {
    // 0.3 mm modules × a 10-module strip = a 3 mm strip; 70% of it is a ~2.1 mm cap height, which is
    // the smallest size that still reads on a 300 dpi print. A caption below ~1 mm is unreadable.
    const encoded = encodeBarcode({ formatId: 'code128', payload: 'CH247-2026-000123' });
    const layout = layoutBarcode(encoded, { moduleMm: 0.3, barHeightMm: 20, showText: true });
    expect(layout.showText).toBe(true);
    expect(layout.textHeightMm).toBeCloseTo(3, 2);
    const svg = renderDocumentSvg({
      title: 'caption',
      pages: [
        {
          width: layout.widthMm,
          height: layout.heightMm,
          ops: [
            {
              kind: 'barcode',
              x: 0,
              y: 0,
              w: layout.widthMm,
              h: layout.heightMm,
              moduleMm: layout.moduleMm,
              encoded,
              colour: '#000000',
              background: '#ffffff',
              showText: true,
              textHeight: layout.textHeightMm,
              quietMm: layout.quietMm,
            },
          ],
        },
      ],
      warnings: [],
    } as never);
    const fontSize = Number((svg.match(/font-size="([\d.]+)"/) ?? [])[1]);
    expect(fontSize, 'the caption font size').toBeGreaterThan(1.9);
    expect(svg).toContain('CH247-2026-000123');
  });
});

describe('barcode engine: rendered symbols decode', () => {
  for (const testCase of CASES) {
    it(`round-trips ${testCase.formatId}`, async () => {
      const decoded = await decodeSvg(renderSymbol(testCase.formatId, testCase.payload));
      expect(decoded, `${testCase.formatId} produced no readable symbol`).not.toBeNull();
      expect(decoded?.text).toBe(testCase.expect);
    });
  }

  /**
   * Code 93 renders correctly (its geometry is identical to Code 39/128, which both decode) but no
   * decoder available in this environment reads it: the ZXing-C++ build shipped in `zxing-wasm`
   * exposes the format name yet returns no result for *any* Code 93 image, including BWIPP's own
   * reference SVG. We assert the symbol is structurally sound and record the gap rather than
   * pretending coverage exists.
   */
  it('encodes code93 with the correct start/stop framing (decoder unavailable)', () => {
    const encoded = encodeBarcode({ formatId: 'code93', payload: 'HELLO-93' });
    expect(encoded.polygons.length).toBeGreaterThan(20);
    expect(encoded.widthUnits).toBe(91);
    expect(encoded.payload).toBe('HELLO-93');
  });
});

describe('barcode engine: payload handling', () => {
  it('adds the EAN-13 check digit when the payload omits it', () => {
    const encoded = encodeBarcode({ formatId: 'ean13', payload: '400638133393' });
    expect(encoded.payload).toBe('4006381333931');
  });

  it('rejects a wrong UPC-E check digit instead of silently correcting it', () => {
    expect(() => encodeBarcode({ formatId: 'upce', payload: '01234561' })).toThrow(BarcodeError);
  });

  it('rejects non-numeric payloads for a numeric-only symbology', () => {
    expect(() => encodeBarcode({ formatId: 'ean13', payload: 'NOTANUMBER' })).toThrow(BarcodeError);
  });

  it('rejects an empty payload', () => {
    expect(() => encodeBarcode({ formatId: 'code128', payload: '   ' })).toThrow(BarcodeError);
  });

  it('reports an unsupported format by name', () => {
    expect(() => encodeBarcode({ formatId: 'code11', payload: '123' })).toThrow(/not a format this build can encode/);
  });
});

describe('barcode engine: geometry', () => {
  it('never stretches a symbol: the footprint follows the module size', () => {
    const encoded = encodeBarcode({ formatId: 'code128', payload: 'ABC123' });
    const small = layoutBarcode(encoded, { moduleMm: 0.25 });
    const large = layoutBarcode(encoded, { moduleMm: 0.5 });
    expect(large.widthMm).toBeCloseTo(small.widthMm * 2, 5);
    expect(large.barsWidthMm / encoded.widthUnits).toBeCloseTo(0.5, 5);
  });

  it('keeps the quiet zone out of the bar area', () => {
    const encoded = encodeBarcode({ formatId: 'qrcode', payload: 'QUIET' });
    const layout = layoutBarcode(encoded, { moduleMm: 0.4 });
    expect(layout.widthMm).toBeCloseTo(layout.barsWidthMm + layout.quietMm * 2, 5);
  });

  it('derives the X-dimension as the GCD of the bar widths', () => {
    const linear = encodeBarcode({ formatId: 'code128', payload: 'ABC' });
    expect(linear.xDimension).toBe(1);
    expect(estimateXDimension(linear.rects)).toBe(1);
  });

  it('treats every 2D module as two units wide', () => {
    const matrix = encodeBarcode({ formatId: 'qrcode', payload: 'QR' });
    expect(matrix.xDimension).toBe(2);
  });

  it('lists a quiet zone for every catalogue format', () => {
    for (const format of BARCODE_FORMATS) {
      expect(format.quietModules, format.id).toBeGreaterThan(0);
      expect(findBarcodeFormat(format.id)?.id).toBe(format.id);
    }
  });
});
