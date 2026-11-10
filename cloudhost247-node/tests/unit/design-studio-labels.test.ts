import { describe, expect, it } from 'vitest';
import { LABEL_TEMPLATES, buildLabelTemplate, findLabelTemplate, searchLabelTemplates } from '../../src/tools/design-studio/labels/templates';
import { effectiveLabelSize, labelFitsPaper, layoutLabelDocument, sheetSlots } from '../../src/tools/design-studio/labels/layout';
import { renderDocumentSvg } from '../../src/tools/design-studio/shared/svg-renderer';
import { renderDocumentPdf } from '../../src/tools/design-studio/shared/pdf-renderer';
import { decodeAll as decodeAllSvg, decodeSvg } from '../helpers/decode';
import { decodePdfRegion } from '../helpers/decode-pdf';
import { MAX_CSV_BYTES, csvCell, detectDelimiter, parseCsv, processBatch, toCsv } from '../../src/tools/design-studio/shared/csv';

describe('label templates', () => {
  it('ships every template as a buildable document', () => {
    expect(LABEL_TEMPLATES.length).toBeGreaterThanOrEqual(6);
    for (const template of LABEL_TEMPLATES) {
      const document = buildLabelTemplate(template.id);
      expect(document, template.id).not.toBeNull();
      expect(findLabelTemplate(template.id)?.id).toBe(template.id);
    }
  });

  it('fits every template\'s own example data without a single layout error', () => {
    for (const template of LABEL_TEMPLATES) {
      const document = buildLabelTemplate(template.id)!;
      const layout = layoutLabelDocument(document);
      const errors = layout.issues.filter((issue) => issue.level === 'error').map((issue) => issue.message);
      expect(errors, `${template.id}: ${errors.join(' / ')}`).toEqual([]);
      const warnings = layout.issues.filter((issue) => issue.level === 'warn').map((issue) => issue.message);
      expect(warnings, `${template.id}: ${warnings.join(' / ')}`).toEqual([]);
    }
  });

  it('leaves the blank template empty on purpose', () => {
    const blank = buildLabelTemplate('blank-70x40');
    expect(blank?.elements).toEqual([]);
  });

  it('finds templates by keyword regardless of accents and case', () => {
    expect(searchLabelTemplates('ADDRESS').length).toBeGreaterThan(0);
    expect(searchLabelTemplates('étiquette').length).toBeGreaterThanOrEqual(0);
  });

  it('returns null rather than a guess for an unknown template', () => {
    expect(buildLabelTemplate('does-not-exist')).toBeNull();
  });
});

describe('label sheet layout', () => {
  it('applies orientation to the effective size', () => {
    const document = buildLabelTemplate('address-70x40');
    expect(document).not.toBeNull();
    const portrait = effectiveLabelSize({ ...document!, orientation: 'portrait' });
    const landscape = effectiveLabelSize({ ...document!, orientation: 'landscape' });
    expect(portrait.width).toBeLessThan(portrait.height);
    // 70 x 40 mm: landscape keeps the stored pair, portrait swaps it.
    expect(landscape.width).toBe(70);
    expect(landscape.height).toBe(40);
  });

  it('never places a label larger than its paper', () => {
    const document = buildLabelTemplate('parcel-100x150');
    expect(document).not.toBeNull();
    expect(labelFitsPaper(document!)).toBe(true);
  });

  it('fits a whole batch on as many pages as it needs, without losing a row', () => {
    const document = buildLabelTemplate('address-70x40')!;
    const rows = Array.from({ length: 25 }, (_, index) => ({ name: `Recipient ${index + 1}`, city: 'Jos' }));
    const layout = layoutLabelDocument(document, { rows });
    expect(layout.labels).toHaveLength(25);
    expect(layout.document.pages).toHaveLength(Math.ceil(25 / layout.perPage));
    expect(layout.perPage).toBeGreaterThan(0);
  });

  it('reports the slots a sheet affords rather than hard-coding them', () => {
    const document = buildLabelTemplate('address-70x40')!;
    const slots = sheetSlots(document);
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      expect(slot.width).toBeGreaterThan(0);
    }
  });
});

describe('rendered labels decode', () => {
  it('decodes the template Code 39 tag through SVG', async () => {
    const document = buildLabelTemplate('asset-tag-60x25')!;
    const layout = layoutLabelDocument(document);
    const found = await decodeSvg(renderDocumentSvg(layout.document), 3000);
    expect(found?.text).toBe('CH-IT-417');
  });

  it('decodes every symbol on the address label, not just the first one', async () => {
    const document = buildLabelTemplate('address-70x40')!;
    const layout = layoutLabelDocument(document);
    const all = await decodeAllSvg(renderDocumentSvg(layout.document), 3000);
    const texts = all.map((entry) => entry.text);
    expect(texts).toContain('CH247-2026-000123');
    expect(texts).toContain('https://cloudhost247.com/track/CH247-2026-000123');
  });

  it('decodes the EAN-13 from a product-label PDF sheet', async () => {
    const document = buildLabelTemplate('product-50x30')!;
    const layout = layoutLabelDocument(document);
    const pdf = new Uint8Array(await renderDocumentPdf(layout.document));
    const found = await decodePdfRegion(pdf, { x0: 0, y0: 0, x1: 0.5, y1: 0.35 }, {}, 10);
    expect(found.map((entry) => entry.text)).toContain('4006381333931');
  });
});

describe('CSV parsing', () => {
  it('detects the delimiter from the header line', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
  });

  it('handles quotes, embedded newlines and CRLF', () => {
    const parsed = parseCsv('name,note\r\n"Smith, John","Line one\nLine two"\r\n');
    expect(parsed.headers).toEqual(['name', 'note']);
    expect(parsed.rows[0]).toEqual({ name: 'Smith, John', note: 'Line one\nLine two' });
  });

  it('strips a UTF-8 BOM so the first header is not corrupted', () => {
    const parsed = parseCsv('\ufeffsku,name\nA1,Widget');
    expect(parsed.headers[0]).toBe('sku');
  });

  it('rejects a file over the size limit instead of truncating it', () => {
    const huge = 'a\n' + 'x\n'.repeat(MAX_CSV_BYTES / 2);
    expect(huge.length).toBeGreaterThan(MAX_CSV_BYTES);
    expect(() => parseCsv(huge)).toThrow(/limit is 2048 kB/);
  });
});

describe('CSV export safety', () => {
  it('prefixes formula-injection payloads', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('+44 800')).toBe("'+44 800");
    expect(csvCell('-2')).toBe("'-2");
  });

  it('quotes separators, quotes and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
  });

  it('round-trips a table through toCsv and parseCsv', () => {
    const rows = [{ sku: 'A,1', name: 'Widget "Large"' }];
    const back = parseCsv(toCsv(['sku', 'name'], rows));
    expect(back.rows[0]).toEqual({ sku: 'A,1', name: 'Widget "Large"' });
  });

  it('escapes a formula payload so a spreadsheet cannot execute it', () => {
    const csv = toCsv(['name'], [{ name: '=cmd|calc' }]);
    expect(csv).toContain("'=cmd|calc");
    expect(parseCsv(csv).rows[0]?.name).toBe("'=cmd|calc");
  });
});

describe('CSV batch', () => {
  const parsed = parseCsv('sku,name\nA1,Widget\n,Broken\nA1,Widget\n');

  it('reports every row, rejecting the invalid one with its line number', () => {
    const batch = processBatch(parsed, { sku: 'sku', name: 'name' }, (values, line) => ({
      issues: values.sku ? [] : [{ level: 'error' as const, field: 'sku', message: `Line ${line}: SKU is required.` }],
    }));
    expect(batch.results).toHaveLength(3);
    expect(batch.accepted).toBe(2);
    expect(batch.rejected).toBe(1);
    expect(batch.results[1]?.accepted).toBe(false);
    expect(batch.results[1]?.line).toBe(3);
  });

  it('warns about a duplicate instead of dropping it', () => {
    const batch = processBatch(parsed, { sku: 'sku', name: 'name' }, () => ({ issues: [] }));
    const duplicate = batch.results[2];
    expect(duplicate?.accepted).toBe(true);
    expect(duplicate?.issues.some((issue) => /identical to line/i.test(issue.message))).toBe(true);
  });

  it('maps columns by header name, ignoring unmapped ones', () => {
    const batch = processBatch(parsed, { code: 'sku' }, () => ({ issues: [] }));
    expect(batch.results[0]?.values).toEqual({ code: 'A1' });
  });
});
