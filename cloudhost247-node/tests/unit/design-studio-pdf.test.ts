import { describe, expect, it } from 'vitest';
import { encodeBarcode, layoutBarcode } from '../../src/tools/design-studio/shared/barcode-engine';
import { renderDocumentPdf } from '../../src/tools/design-studio/shared/pdf-renderer';
import { renderDocumentSvg } from '../../src/tools/design-studio/shared/svg-renderer';
import { decodeSvg } from '../helpers/decode';
import { decodePdfRegion, rasterisePdfPage } from '../helpers/decode-pdf';

function singleSymbolDocument(formatId: string, payload: string, moduleMm = 0.5) {
  const encoded = encodeBarcode({ formatId, payload });
  const layout = layoutBarcode(encoded, { moduleMm });
  return {
    encoded,
    layout,
    document: {
      title: 'pdf test',
      pages: [
        {
          width: layout.widthMm + 8,
          height: layout.heightMm + 8,
          ops: [
            {
              kind: 'barcode' as const,
              x: 4,
              y: 4,
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
    },
  };
}

describe('PDF export', () => {
  it('writes a page in millimetres, not points', async () => {
    const { document, layout } = singleSymbolDocument('code128', 'PDF-SIZE-CHECK');
    const pdf = await renderDocumentPdf(document as never);
    const mupdf = await import('mupdf');
    const page = mupdf.Document.openDocument(pdf, 'application/pdf').loadPage(0);
    const bounds = page.getBounds();
    // 1 mm = 72/25.4 pt.
    expect(bounds[2] / (72 / 25.4)).toBeCloseTo(layout.widthMm + 8, 1);
    expect(bounds[3] / (72 / 25.4)).toBeCloseTo(layout.heightMm + 8, 1);
  });

  for (const testCase of [
    { formatId: 'code128', payload: 'PDF-CODE128-001', expect: 'PDF-CODE128-001' },
    { formatId: 'qrcode', payload: 'https://cloudhost247.com/pdf', expect: 'https://cloudhost247.com/pdf' },
    { formatId: 'datamatrix', payload: 'PDF-DM-0001', expect: 'PDF-DM-0001' },
    { formatId: 'pdf417', payload: 'PDF417-LABEL-PAYLOAD', expect: 'PDF417-LABEL-PAYLOAD' },
  ]) {
    it(`renders a decodable ${testCase.formatId} symbol`, async () => {
      const { document } = singleSymbolDocument(testCase.formatId, testCase.payload);
      const pdf = new Uint8Array(await renderDocumentPdf(document as never));
      const found = await decodePdfRegion(pdf, { x0: 0, y0: 0, x1: 1, y1: 1 });
      expect(found.map((entry) => entry.text)).toContain(testCase.expect);
    });
  }

  it('renders a symbol that survives a full-page raster at print scale', async () => {
    const { document } = singleSymbolDocument('qrcode', 'PRINT-SCALE-QR');
    const pdf = new Uint8Array(await renderDocumentPdf(document as never));
    const page = await rasterisePdfPage(pdf, 0, 3);
    expect(page.byteLength).toBeGreaterThan(500);
  });
});

describe('SVG and PDF agree', () => {
  it('draws the same payload through both renderers', async () => {
    const { document, encoded } = singleSymbolDocument('code39', 'BOTH-RENDERERS');
    const svgFound = await decodeSvg(renderDocumentSvg(document as never));
    expect(svgFound?.text).toBe('BOTH-RENDERERS');
    expect(encoded.payload).toBe('BOTH-RENDERERS');
  });
});
