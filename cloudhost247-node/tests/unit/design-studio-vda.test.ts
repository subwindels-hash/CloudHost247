import { describe, expect, it } from 'vitest';
import { buildVdaLabel } from '../../src/tools/design-studio/vda/generator';
import { DEFAULT_VDA_DATA, buildVda2dPayload, buildVdaLinearValue, validateVdaData, toVdaDate } from '../../src/tools/design-studio/vda/schema';
import { VDA_FIELDS, VDA_LIMITATIONS, VDA_SUPPORTED_VERSION } from '../../src/tools/design-studio/vda/spec';
import { renderDocumentPdf } from '../../src/tools/design-studio/shared/pdf-renderer';
import { renderDocumentSvg } from '../../src/tools/design-studio/shared/svg-renderer';
import { decodeSvg } from '../helpers/decode';
import { decodePdfRegion } from '../helpers/decode-pdf';

const FILLED = {
  ...DEFAULT_VDA_DATA,
  receiver: 'ANDREAS STIHL AG & Co. KG',
  plant: 'D5',
  supplier: 'CloudHost247 Manufacturing Ltd',
  supplierNumber: '987654',
  deliveryNote: 'DN-2026-00417',
  deliveryNoteDate: '2026-11-09',
  partNumber: '1234-567-89',
  partDescription: 'Sealing ring 42 mm',
  quantity: '1200',
  unit: 'PCE',
  purchaseOrder: 'PO-77123',
  deliveryDate: '2026-11-12',
  batch: 'LOT-8891',
};

describe('VDA 4902 captions', () => {
  /**
   * A caption that ends in an ellipsis is a caption a goods-in clerk cannot use, and it looks like a
   * rendering fault rather than a deliberate abbreviation.
   *
   * The captions are measured in the *upper-case* form they print in, so capitals (which are wider)
   * are counted; a caption that still does not fit at 85% of the caption size drops to one language
   * instead of being cut. This test reads every caption op out of the rendered label and asserts none
   * of them was ellipsized in either format, with German captions on and off.
   */
  function captionTexts(german: boolean, format: 'master' | 'klt'): string[] {
    const result = buildVdaLabel({ ...FILLED, germanCaptions: german, format });
    const texts: string[] = [];
    for (const page of result.document.pages) {
      for (const op of page.ops) {
        if (op.kind === 'text' && /^\d+\s{2}/.test(op.text)) texts.push(op.text);
      }
    }
    return texts;
  }

  it('never truncates a field caption in either language or either format', () => {
    for (const german of [true, false]) {
      for (const format of ['master', 'klt'] as const) {
        const captions = captionTexts(german, format);
        expect(captions.length, `${format}/german=${german} printed no captions`).toBeGreaterThan(8);
        const truncated = captions.filter((caption) => caption.includes('…') || caption.endsWith('...'));
        expect(truncated, `${format}/german=${german} truncated: ${truncated.join(' | ')}`).toEqual([]);
      }
    }
  });

  it('names each field in full when only one language fits', () => {
    // Field 5's bilingual caption cannot fit its column; the fallback must be a whole field name.
    const captions = captionTexts(true, 'master');
    const delivery = captions.find((caption) => caption.startsWith('5  '));
    expect(delivery).toBeTruthy();
    expect(delivery).toMatch(/DELIVERY NOTE NUMBER|LIEFERSCHEIN-NR\.?/);
  });
});

describe('VDA 4902 specification record', () => {
  it('pins the implemented version', () => {
    expect(VDA_SUPPORTED_VERSION).toBe('4');
  });

  it('documents every field with a caption and a rule', () => {
    expect(VDA_FIELDS).toHaveLength(15);
    for (const field of VDA_FIELDS) {
      expect(field.no).toBeGreaterThan(0);
      expect(field.label.length).toBeGreaterThan(2);
      expect(field.german.length).toBeGreaterThan(2);
      expect(typeof field.required).toBe('boolean');
    }
  });

  it('states its limitations instead of implying certification', () => {
    expect(VDA_LIMITATIONS.length).toBeGreaterThanOrEqual(5);
    expect(VDA_LIMITATIONS.join(' ')).toMatch(/not.{0,20}certif/i);
  });
});

describe('VDA 4902 data handling', () => {
  it('formats the VDA date as YYMMDD', () => {
    expect(toVdaDate('2026-11-09')).toBe('261109');
  });

  it('builds the 2D payload with the 4902 header and trailer', () => {
    const built = buildVda2dPayload(FILLED);
    expect(built.payload.startsWith('[)>RTD4902')).toBe(true);
    expect(built.payload).toContain('\r');
    expect(built.payload.endsWith('[)<RSV4902')).toBe(true);
    // Field identifiers: 16K delivery note, P part number, Q quantity, L supplier.
    expect(built.payload).toContain('16K:DN-2026-00417');
    expect(built.payload).toContain('P:1234-567-89');
    expect(built.included).toContain('deliveryNote');
    expect(built.omitted).toEqual([]);
  });

  it('lists only the values it actually encoded', () => {
    const built = buildVda2dPayload({ ...FILLED, quantity: '' });
    expect(built.included).not.toContain('quantity');
    expect(built.payload).not.toContain('Q:');
  });

  it('reports an unparseable date instead of dropping it silently', () => {
    const built = buildVda2dPayload({ ...FILLED, deliveryNoteDate: 'not-a-date' });
    expect(built.omitted.join(' ')).toContain('deliveryNoteDate');
    expect(built.payload).not.toContain('D:');
  });

  it('uses a Code 39 safe alphabet for the linear symbol', () => {
    const value = buildVdaLinearValue(FILLED);
    expect(value).toMatch(/^[0-9A-Z\-. $/+%]+$/);
    expect(value).toContain('DN-2026-00417');
  });

  it('rejects an impossible date', () => {
    const issues = validateVdaData({ ...FILLED, deliveryNoteDate: '2026-02-31' });
    expect(issues.some((issue) => issue.field === 'deliveryNoteDate')).toBe(true);
  });

  it('refuses a version it does not implement', () => {
    const issues = validateVdaData({ ...FILLED, version: '3' });
    expect(issues.length).toBeGreaterThan(0);
  });
});

describe('VDA 4902 layout', () => {
  it('lays the master label out on 210 x 148 mm', () => {
    const label = buildVdaLabel({ ...FILLED, format: 'master' });
    expect(label.sizeMm).toEqual({ width: 210, height: 148 });
    expect(label.blocked).toBe(false);
  });

  it('lays the KLT label out on 210 x 74 mm', () => {
    const label = buildVdaLabel({ ...FILLED, format: 'klt' });
    expect(label.sizeMm).toEqual({ width: 210, height: 74 });
  });

  it('prints placeholders and no symbols when the data is invalid', () => {
    const label = buildVdaLabel({ ...FILLED, format: 'master', deliveryNote: '', deliveryNoteDate: 'nope' } as never);
    expect(label.blocked).toBe(true);
    const symbolOps = label.document.pages[0]?.ops.filter((op) => op.kind === 'barcode' || op.kind === 'symbol') ?? [];
    expect(symbolOps).toHaveLength(0);
  });
});

describe('VDA 4902 renders decodable symbols', () => {
  it('decodes the Code 39 delivery-note symbol from the SVG', async () => {
    const label = buildVdaLabel({ ...FILLED, format: 'master' });
    const decoded = await decodeSvg(renderDocumentSvg(label.document), 2400);
    expect(decoded?.text).toContain('DN-2026-00417');
  });

  it('decodes the Code 39 symbol and the PDF417 block from the PDF', async () => {
    const label = buildVdaLabel({ ...FILLED, format: 'master' });
    const pdf = new Uint8Array(await renderDocumentPdf(label.document));
    // The symbol band sits in the bottom band of the label.
    const linear = await decodePdfRegion(pdf, { x0: 0, y0: 0.74, x1: 0.45, y1: 1 }, {}, 10);
    expect(linear.map((entry) => entry.text).join(' ')).toContain('DN-2026-00417');
    const matrix = await decodePdfRegion(pdf, { x0: 0.45, y0: 0.72, x1: 1, y1: 1 }, { formats: ['PDF417'] }, 10);
    expect(matrix[0]?.text).toContain('[)>RTD4902');
  });
});
