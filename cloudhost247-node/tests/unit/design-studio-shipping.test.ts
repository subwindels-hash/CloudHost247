import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHIPMENT,
  SHIPPING_FIELDS,
  SHIPPING_TEMPLATES,
  buildGs1ElementString,
  buildShippingTemplate,
  exampleShipment,
  findShippingTemplate,
  isIsoDate,
  shipmentValues,
  validateShipment,
  type ShipmentData,
} from '../../src/tools/design-studio/shipping-labels/model';
import { layoutLabelDocument } from '../../src/tools/design-studio/labels/layout';
import { renderDocumentSvg } from '../../src/tools/design-studio/shared/svg-renderer';
import { renderDocumentPdf } from '../../src/tools/design-studio/shared/pdf-renderer';
import { decodeAll, decodeSvg } from '../helpers/decode';
import { decodePdfRegion } from '../helpers/decode-pdf';

const SHIPMENT: ShipmentData = {
  ...DEFAULT_SHIPMENT,
  senderName: 'CloudHost247 Ltd',
  senderCompany: 'CloudHost247 Ltd',
  senderAddress: '12 Rukuba Road\nJos North, Plateau 930101\nNigeria',
  senderPhone: '+234 800 000 0000',
  senderEmail: 'desk@cloudhost247.com',
  recipientName: 'Ada Obi',
  recipientCompany: 'Northgate Pharmacy',
  recipientAddress: '24 Zaria Road\nJos North, Plateau 930101\nNigeria',
  recipientPhone: '+234 801 111 1111',
  reference: 'CH247-2026-000123',
  trackingNumber: 'TRK-8891-0042',
  carrier: 'Carrier (you supply)',
  service: 'Standard',
  weight: '2.4 kg',
  dimensions: '30 × 20 × 12 cm',
  pieces: '1 of 1',
  declaredValue: '₦48,000',
  shipDate: '2026-11-09',
  instructions: 'Keep dry · Do not stack',
  sscc: '106141411234567897',
  trackingUrl: 'https://cloudhost247.com/track/CH247-2026-000123',
};

describe('shipment validation', () => {
  it('accepts a complete shipment', () => {
    expect(validateShipment(SHIPMENT)).toEqual([]);
  });

  it('requires the sender and recipient blocks', () => {
    const issues = validateShipment({ ...DEFAULT_SHIPMENT });
    const fields = issues.filter((issue) => issue.level === 'error').map((issue) => issue.field);
    expect(fields).toEqual(expect.arrayContaining(['senderName', 'senderAddress', 'recipientName', 'recipientAddress', 'reference']));
  });

  it('rejects a date that does not exist', () => {
    expect(isIsoDate('2026-02-31')).toBe(false);
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(validateShipment({ ...SHIPMENT, shipDate: '2026-02-31' }).some((issue) => issue.field === 'shipDate')).toBe(true);
  });

  it('rejects a malformed SSCC and accepts 18 digits', () => {
    expect(validateShipment({ ...SHIPMENT, sscc: '123' }).some((issue) => issue.field === 'sscc')).toBe(true);
    expect(validateShipment({ ...SHIPMENT, sscc: '106141411234567897' }).some((issue) => issue.field === 'sscc')).toBe(false);
  });

  it('requires an SSCC when the label carries a GS1-128 symbol', () => {
    const issues = validateShipment({ ...SHIPMENT, sscc: '' }, { code: 'gs1-128' });
    expect(issues.some((issue) => issue.field === 'sscc' && issue.level === 'error')).toBe(true);
  });

  it('warns, but does not fail, when there is no carrier tracking number', () => {
    const issues = validateShipment({ ...SHIPMENT, trackingNumber: '' });
    expect(issues.some((issue) => issue.field === 'trackingNumber' && issue.level === 'warn')).toBe(true);
    expect(issues.filter((issue) => issue.level === 'error')).toEqual([]);
  });

  it('documents every field with a label and a limit', () => {
    expect(SHIPPING_FIELDS.length).toBeGreaterThanOrEqual(20);
    for (const field of SHIPPING_FIELDS) {
      expect(field.maxLength).toBeGreaterThan(0);
      expect(field.label.length).toBeGreaterThan(2);
    }
  });
});

describe('GS1-128 element string', () => {
  it('builds (00) and (10) elements from the SSCC and the reference', () => {
    const built = buildGs1ElementString(SHIPMENT);
    expect(built.value).toBe('(00)106141411234567897(10)CH247-2026-000123');
    expect(built.included).toContain('(00) SSCC');
  });

  it('reports the elements it could not include', () => {
    const built = buildGs1ElementString({ ...SHIPMENT, sscc: '' });
    expect(built.omitted).toContain('(00) SSCC');
    expect(built.value).not.toContain('(00)');
  });

  it('truncates the reference to the 20 characters AI (10) allows', () => {
    const built = buildGs1ElementString({ ...SHIPMENT, reference: 'R'.repeat(30) });
    expect(built.value).toContain(`(10)${'R'.repeat(20)}`);
  });
});

describe('shipping templates', () => {
  it('ships four carrier-neutral templates', () => {
    expect(SHIPPING_TEMPLATES.length).toBeGreaterThanOrEqual(4);
    for (const template of SHIPPING_TEMPLATES) {
      expect(findShippingTemplate(template.id)?.id).toBe(template.id);
      // No template may claim a carrier brand: the tool cannot issue a carrier's label.
      expect(template.name.toLowerCase()).not.toMatch(/ups|dhl|fedex|royal mail/);
    }
  });

  it('lays every template out with no errors', () => {
    for (const template of SHIPPING_TEMPLATES) {
      const layout = layoutLabelDocument(buildShippingTemplate(template.id)!);
      const errors = layout.issues.filter((issue) => issue.level === 'error').map((issue) => issue.message);
      expect(errors, `${template.id}: ${errors.join(' / ')}`).toEqual([]);
    }
  });

  it('prints each template at its stated stock size', () => {
    for (const template of SHIPPING_TEMPLATES) {
      const document = buildShippingTemplate(template.id)!;
      expect(document.widthMm, template.id).toBeCloseTo(template.sizeMm.width, 1);
      expect(document.heightMm, template.id).toBeCloseTo(template.sizeMm.height, 1);
    }
  });

  it('exposes the shipment to the label bindings', () => {
    const values = shipmentValues(SHIPMENT);
    expect(values.reference).toBe('CH247-2026-000123');
    expect(values.qr).toBe('https://cloudhost247.com/track/CH247-2026-000123');
    expect(values.gs1code).toBe('(00)106141411234567897(10)CH247-2026-000123');
  });

  it('falls back to the reference when no tracking URL is given', () => {
    expect(shipmentValues({ ...SHIPMENT, trackingUrl: '' }).qr).toBe('CH247-2026-000123');
  });

  it('uses the example shipment for previews', () => {
    expect(exampleShipment().reference).toBe('CH247-2026-000123');
    expect(exampleShipment(true).sscc).toHaveLength(18);
  });
});

describe('shipping labels decode', () => {
  it('decodes both codes on the thermal parcel label', async () => {
    const layout = layoutLabelDocument(buildShippingTemplate('thermal-100x150')!);
    const found = await decodeAll(renderDocumentSvg(layout.document), 3000);
    const texts = found.map((entry) => entry.text);
    expect(texts).toContain('CH247-2026-000123');
    expect(texts).toContain('https://cloudhost247.com/track/CH247-2026-000123');
  });

  it('decodes the GS1-128 element string, not the bare SSCC', async () => {
    const layout = layoutLabelDocument(buildShippingTemplate('thermal-100x150-gs1')!);
    const found = await decodeAll(renderDocumentSvg(layout.document), 3000);
    const texts = found.map((entry) => entry.text);
    expect(texts.some((text) => text.includes('(00)106141411234567897'))).toBe(true);
  });

  it('decodes the reference from a PDF export', async () => {
    const layout = layoutLabelDocument(buildShippingTemplate('address-70x40')!);
    const pdf = new Uint8Array(await renderDocumentPdf(layout.document));
    // Crop to the first label's slot, derived from the layout rather than guessed: a 70 x 40 mm
    // label on an A4 sheet occupies a small corner of the page, and a full-page decode at print
    // resolution gives the binariser too few pixels per module.
    const slot = layout.labels[0]?.slot;
    expect(slot).toBeDefined();
    const page = layout.document.pages[0]!;
    const region = {
      x0: slot!.x / page.width,
      y0: slot!.y / page.height,
      x1: (slot!.x + slot!.width) / page.width,
      y1: (slot!.y + slot!.height) / page.height,
    };
    const found = await decodePdfRegion(pdf, region, {}, 14);
    expect(found.map((entry) => entry.text)).toContain('CH247-2026-000123');
  });
});
