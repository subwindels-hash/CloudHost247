/**
 * Shipping Label Generator — the shipment record.
 *
 * ## What this is, and what it deliberately is not
 *
 * It is a **carrier-neutral** shipping label: a sender, a recipient, a shipment reference, weights,
 * pieces and the codes an operator asked for. It is *not* a carrier's own label — no UPS, DHL, FedEx,
 * Royal Mail, GIG or DHL-branded artwork, and no tracking number this tool invents. Those labels are
 * contracts: the carrier issues the tracking number, the carrier's own artwork encodes routing
 * (a UPS "1Z" number, a DHL licence plate, a FedEx routing barcode), and printing an imitation is
 * both useless — the scanner at the depot reads a format it did not expect — and a trademark
 * problem.
 *
 * So the rule this module enforces is simple and visible on the page:
 *
 *  * every value comes from the user (or their CSV);
 *  * a field named "tracking number" is whatever the user typed, and is labelled as *their*
 *    reference, not as a carrier's;
 *  * the codes generated are generic Code 128 / GS1-128 / QR over that data.
 *
 * ## Why GS1-128 is a separate, checked choice
 *
 * A GS1-128 symbol carries Application Identifier elements (`(00)` SSCC, `(01)` GTIN, `(10)` batch …)
 * and each one has a length and an allowed character set. Emitting a bare string in a GS1-128 symbol
 * produces a code that a GS1 scanner will reject or, worse, misread, so the GS1-128 option validates
 * the AI structure before anything is drawn. The plain Code 128 option exists for operators whose
 * carriers do not want a GS1 element string.
 */

import type { DataBinding, LabelDocument, LabelElement, LabelSheet, LabelValues } from '../labels/model';
import { createElement, defaultLabelDocument } from '../labels/model';

/** The codes a shipping label can carry. */
export type ShippingCodeKind = 'code128' | 'gs1-128' | 'qrcode' | 'datamatrix';

export interface ShippingTemplateMeta {
  id: string;
  name: string;
  /** Label size in millimetres — the stock it is meant for. */
  sizeMm: { width: number; height: number };
  blurb: string;
  description: string;
  codes: ShippingCodeKind[];
  keywords: string[];
}

/**
 * The shipment.
 *
 * `reference` and `trackingNumber` are different on purpose: the reference is the sender's own
 * consignment id (`CH247-2026-000123`), the tracking number is whatever the carrier gave the user.
 * Conflating them is how a support call starts.
 */
export interface ShipmentData {
  senderName: string;
  senderCompany: string;
  senderAddress: string;
  senderPhone: string;
  senderEmail: string;
  recipientName: string;
  recipientCompany: string;
  recipientAddress: string;
  recipientPhone: string;
  recipientEmail: string;
  reference: string;
  trackingNumber: string;
  carrier: string;
  service: string;
  weight: string;
  dimensions: string;
  pieces: string;
  declaredValue: string;
  shipDate: string;
  instructions: string;
  sscc: string;
  gtin: string;
  /** Extra data URL the QR points at (a tracking page the sender hosts). */
  trackingUrl: string;
}

export const DEFAULT_SHIPMENT: ShipmentData = {
  senderName: '',
  senderCompany: '',
  senderAddress: '',
  senderPhone: '',
  senderEmail: '',
  recipientName: '',
  recipientCompany: '',
  recipientAddress: '',
  recipientPhone: '',
  recipientEmail: '',
  reference: '',
  trackingNumber: '',
  carrier: '',
  service: '',
  weight: '',
  dimensions: '',
  pieces: '1 of 1',
  declaredValue: '',
  shipDate: '',
  instructions: '',
  sscc: '',
  gtin: '',
  trackingUrl: '',
};

/**
 * Field rules.
 *
 * `required` is what the label cannot print without. Everything else is optional and simply omitted
 * from both the label and the codes — an empty optional field is not an error, and no placeholder
 * text is printed in its place (a placeholder on a shipping label looks like data).
 */
export interface ShippingFieldRule {
  key: keyof ShipmentData;
  label: string;
  required: boolean;
  maxLength: number;
  /** Shown under the input. */
  hint?: string;
  /** Rejects a value that would not scan or would not route. */
  pattern?: { regex: RegExp; message: string };
}

export const SHIPPING_FIELDS: readonly ShippingFieldRule[] = [
  { key: 'senderName', label: 'Sender name', required: true, maxLength: 60 },
  { key: 'senderCompany', label: 'Sender company', required: false, maxLength: 60 },
  { key: 'senderAddress', label: 'Sender address', required: true, maxLength: 240, hint: 'One line per address line.' },
  { key: 'senderPhone', label: 'Sender phone', required: false, maxLength: 32 },
  { key: 'senderEmail', label: 'Sender email', required: false, maxLength: 120 },
  { key: 'recipientName', label: 'Recipient name', required: true, maxLength: 60 },
  { key: 'recipientCompany', label: 'Recipient company', required: false, maxLength: 60 },
  { key: 'recipientAddress', label: 'Recipient address', required: true, maxLength: 240, hint: 'One line per address line.' },
  { key: 'recipientPhone', label: 'Recipient phone', required: false, maxLength: 32 },
  { key: 'recipientEmail', label: 'Recipient email', required: false, maxLength: 120 },
  {
    key: 'reference',
    label: 'Your reference',
    required: true,
    maxLength: 40,
    hint: 'Your own consignment number. This is the value printed in the Code 128 symbol.',
    pattern: { regex: /^[\x20-\x7e]+$/, message: 'Use printable ASCII only — the Code 128 symbol cannot encode anything else.' },
  },
  { key: 'trackingNumber', label: 'Carrier tracking number', required: false, maxLength: 40, hint: 'Only if your carrier gave you one. This tool does not invent one.' },
  { key: 'carrier', label: 'Carrier', required: false, maxLength: 40 },
  { key: 'service', label: 'Service', required: false, maxLength: 40 },
  { key: 'weight', label: 'Weight', required: false, maxLength: 20 },
  { key: 'dimensions', label: 'Dimensions', required: false, maxLength: 24, hint: 'L × W × H, with units.' },
  { key: 'pieces', label: 'Pieces', required: false, maxLength: 16, hint: 'For example “2 of 3”.' },
  { key: 'declaredValue', label: 'Declared value', required: false, maxLength: 24 },
  { key: 'shipDate', label: 'Ship date', required: false, maxLength: 10, hint: 'YYYY-MM-DD.' },
  { key: 'instructions', label: 'Handling instructions', required: false, maxLength: 120 },
  { key: 'sscc', label: 'SSCC', required: false, maxLength: 20, hint: '18-digit Serial Shipping Container Code, if you have one.' },
  { key: 'gtin', label: 'GTIN', required: false, maxLength: 14, hint: 'Used only when the label carries a GS1-128 symbol.' },
  { key: 'trackingUrl', label: 'Tracking page URL', required: false, maxLength: 300, hint: 'Encoded in the QR code when present.' },
];

/* ------------------------------------------------------------------ */
/* The label value map                                                 */
/* ------------------------------------------------------------------ */

/** Flatten a shipment into the key/value pairs a label binding reads. */
export function shipmentValues(shipment: ShipmentData): LabelValues {
  const values: LabelValues = {};
  for (const [key, value] of Object.entries(shipment)) {
    values[key] = String(value ?? '');
  }
  // The QR falls back to the tracking URL, then to the reference: a code that says "nothing here"
  // is worse than a code that says which consignment it is.
  values.qr = shipment.trackingUrl || shipment.reference || '';
  // A GS1-128 symbol carries AI element strings, not a bare value, so the label binds this computed
  // key rather than the raw SSCC. Binding the SSCC directly is what makes a GS1 symbol unreadable.
  values.gs1code = buildGs1ElementString(shipment).value;
  return values;
}

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

export const SHIPPING_TEMPLATES: readonly ShippingTemplateMeta[] = [
  {
    id: 'thermal-100x150',
    name: 'Thermal parcel — 100 × 150 mm',
    sizeMm: { width: 100, height: 150 },
    blurb: 'Courier-style parcel label: sender block, large recipient block, Code 128 reference and a QR code.',
    description:
      'The 100 × 150 mm thermal stock most couriers and e-commerce sellers use. Sender in the top band, recipient in a large block, your reference as a Code 128 symbol and a QR code for the tracking page. Carrier-neutral: there is no carrier logo and no carrier barcode artwork.',
    codes: ['code128', 'qrcode'],
    keywords: ['thermal', 'parcel', 'courier', '100x150', 'ecommerce'],
  },
  {
    id: 'thermal-100x150-gs1',
    name: 'Thermal parcel with GS1-128 — 100 × 150 mm',
    sizeMm: { width: 100, height: 150 },
    blurb: 'The parcel layout with a GS1-128 element string (SSCC and reference) instead of plain Code 128.',
    description:
      'For warehouses that scan GS1 Application Identifiers. The code validates its element string: an 18-digit SSCC is required for AI (00), and the reference becomes AI (10) batch/lot data. If the elements are incomplete the label prints the problem instead of an unscannable symbol.',
    codes: ['gs1-128', 'qrcode'],
    keywords: ['gs1', 'gs1-128', 'sscc', 'warehouse', 'compliance'],
  },
  {
    id: 'address-70x40',
    name: 'Address sticker — 70 × 40 mm',
    sizeMm: { width: 70, height: 40 },
    blurb: 'Compact address sticker with a Code 128 reference, for small parcels and envelopes.',
    description:
      'The small sticker: recipient block, sender line and a Code 128 symbol across the bottom. Prints one per page or on an A4 sheet at 2 × 6.',
    codes: ['code128'],
    keywords: ['address', 'sticker', 'small', '70x40', 'envelope'],
  },
  {
    id: 'a6-105x148',
    name: 'Packing slip — A6 (105 × 148 mm)',
    sizeMm: { width: 105, height: 148 },
    blurb: 'Half-letter packing slip with sender, recipient, contents summary and two codes.',
    description:
      'A6 paper slip for inside the parcel: addresses, references, pieces and handling instructions, with both a Code 128 and a QR code so either scanner in the warehouse can read it.',
    codes: ['code128', 'qrcode'],
    keywords: ['packing', 'slip', 'a6', 'insert', 'paper'],
  },
];

export function findShippingTemplate(id: string): ShippingTemplateMeta | undefined {
  return SHIPPING_TEMPLATES.find((template) => template.id === id);
}

export const DEFAULT_SHIPPING_TEMPLATE = 'thermal-100x150';

const SANS = { family: 'sans' as const, colour: '#10171d', align: 'left' as const, wrap: true, lineHeight: 1.26 };

function element(overrides: Partial<LabelElement> & { kind: LabelElement['kind'] }): LabelElement {
  return createElement(overrides.kind, overrides as never);
}

/** A field element bound to the shipment key, printing nothing when the value is empty. */
function field(
  key: keyof ShipmentData,
  name: string,
  box: { x: number; y: number; width: number; height: number },
  style: Record<string, unknown>
): LabelElement {
  return element({
    kind: 'field',
    id: `f-${key}`,
    name,
    binding: { key, fallback: '' } as DataBinding,
    placeholder: '',
    ...box,
    style: { ...SANS, ...style } as never,
  });
}

function barcode(
  key: keyof ShipmentData | 'gs1code',
  formatId: string,
  moduleMm: number,
  box: { x: number; y: number; width: number; height: number },
  showText: boolean
): LabelElement {
  return element({
    kind: 'barcode',
    id: `bc-${key}`,
    name: formatId === 'gs1-128' ? 'GS1-128 symbol' : 'Reference barcode',
    binding: { key, fallback: '' } as DataBinding,
    formatId,
    moduleMm,
    showText,
    colour: '#000000',
    ...box,
  });
}

function qr(key: keyof ShipmentData | 'qr', box: { x: number; y: number; width: number; height: number }): LabelElement {
  return element({
    kind: 'symbol',
    id: `qr-${key}`,
    name: 'Tracking QR',
    binding: { key, fallback: '' } as DataBinding,
    symbol: 'qrcode',
    errorCorrection: 'M',
    colour: '#000000',
    ...box,
  });
}

const SHEET_ONE: LabelSheet = { paperId: 'label-100x150', columns: 1, rows: 1, marginMm: 0, gutterMm: 0 };
const SHEET_A6: LabelSheet = { paperId: 'a6', columns: 1, rows: 1, marginMm: 0, gutterMm: 0 };
const SHEET_A4_70: LabelSheet = { paperId: 'a4', columns: 2, rows: 6, marginMm: 8, gutterMm: 3 };

/**
 * Build the label document for a template.
 *
 * Every box is sized against the symbol it holds: a 200-module Code 128 at 0.3 mm/module needs
 * 60 mm of bars plus quiet zones, so a shipping template never promises a barcode in a box that
 * cannot hold it. The tests assert that each template's own example data lays out with zero errors.
 */
export function buildShippingTemplate(id: string = DEFAULT_SHIPPING_TEMPLATE): LabelDocument | null {
  const meta = findShippingTemplate(id);
  if (!meta) return null;

  if (id === 'address-70x40') {
    return defaultLabelDocument({
      name: meta.name,
      category: 'shipping',
      widthMm: 70,
      heightMm: 40,
      orientation: 'landscape',
      templateId: id,
      style: { background: '#ffffff', border: { colour: '#c9c6bd', width: 0.25, radius: 1.5 }, paddingMm: 3 },
      sheet: SHEET_A4_70,
      values: exampleShipment(),
      elements: [
        field('senderName', 'Sender', { x: 0, y: 0, width: 52, height: 3 }, { size: 2.1, colour: '#5a6577', wrap: false }),
        field('recipientName', 'Recipient', { x: 0, y: 3.6, width: 52, height: 6 }, { size: 3.4, family: 'sans-bold', wrap: false }),
        // The address is the one block that must never be clipped: a three-line address at 2.6 mm needs
        // 9.8 mm, so the box is 10 (it ends at 19.8, clearing the Code 128 that starts at 20).
        field('recipientAddress', 'Recipient address', { x: 0, y: 9.8, width: 52, height: 10 }, { size: 2.6 }),
        field('pieces', 'Pieces', { x: 53, y: 3.6, width: 11, height: 5 }, { size: 2.6, align: 'right' }),
        // A carrier name in an 11 mm column wraps to three lines; 6 mm held two and clipped the third.
        // Truncating a carrier name is not an option (it is the company the parcel is entrusted to), so
        // the box takes the height instead — it still clears the barcode at y 20.
        field('carrier', 'Carrier', { x: 53, y: 8.6, width: 11, height: 9 }, { size: 2.2, align: 'right', colour: '#5a6577' }),
        // 200 modules at 0.25 mm = 50 mm of bars, 2.5 mm quiet each side, 2 mm HRI.
        barcode('reference', 'code128', 0.25, { x: 0, y: 20, width: 64, height: 14 }, true),
      ],
    });
  }

  if (id === 'a6-105x148') {
    return defaultLabelDocument({
      name: meta.name,
      category: 'shipping',
      widthMm: 105,
      heightMm: 148,
      orientation: 'portrait',
      templateId: id,
      style: { background: '#ffffff', border: { colour: '#c9c6bd', width: 0.3, radius: 1 }, paddingMm: 6 },
      sheet: SHEET_A6,
      values: exampleShipment(),
      elements: [
        element({ kind: 'text', id: 'title', name: 'Title', text: 'PACKING SLIP', x: 0, y: 0, width: 60, height: 6, style: { ...SANS, size: 4.2, family: 'sans-bold' } as never }),
        field('reference', 'Reference', { x: 60, y: 0, width: 33, height: 5 }, { size: 2.8, align: 'right', family: 'mono' }),
        element({ kind: 'line', id: 'rule1', name: 'Divider', x: 0, y: 7.5, width: 93, height: 0, colour: '#10171d', thickness: 0.4 } as never),
        element({ kind: 'text', id: 'fromLabel', name: 'From label', text: 'FROM', x: 0, y: 9.5, width: 20, height: 3, style: { ...SANS, size: 2.2, colour: '#5a6577' } as never }),
        field('senderCompany', 'Sender company', { x: 0, y: 13, width: 44, height: 5 }, { size: 2.8, family: 'sans-bold' }),
        field('senderAddress', 'Sender address', { x: 0, y: 18.5, width: 44, height: 14 }, { size: 2.5 }),
        element({ kind: 'text', id: 'toLabel', name: 'To label', text: 'TO', x: 0, y: 35, width: 20, height: 3, style: { ...SANS, size: 2.2, colour: '#5a6577' } as never }),
        field('recipientName', 'Recipient name', { x: 0, y: 38.5, width: 60, height: 6 }, { size: 3.6, family: 'sans-bold' }),
        field('recipientAddress', 'Recipient address', { x: 0, y: 45, width: 60, height: 16 }, { size: 2.8 }),
        qr('qr', { x: 68, y: 36, width: 25, height: 25 }),
        field('pieces', 'Pieces', { x: 0, y: 64, width: 30, height: 4 }, { size: 2.6 }),
        field('weight', 'Weight', { x: 32, y: 64, width: 26, height: 4 }, { size: 2.6 }),
        field('dimensions', 'Dimensions', { x: 60, y: 64, width: 33, height: 4 }, { size: 2.6 }),
        field('instructions', 'Instructions', { x: 0, y: 70, width: 93, height: 5 }, { size: 2.4, colour: '#5a6577' }),
        // Reference band: 93 mm of usable width is enough for 200 modules at 0.4 mm (80 mm of bars).
        barcode('reference', 'code128', 0.4, { x: 0, y: 78, width: 93, height: 16 }, true),
        field('carrier', 'Carrier', { x: 0, y: 98, width: 45, height: 5 }, { size: 2.4, colour: '#5a6577' }),
        field('shipDate', 'Ship date', { x: 46, y: 98, width: 47, height: 5 }, { size: 2.4, align: 'right', colour: '#5a6577' }),
      ],
    });
  }

  // Both 100 × 150 mm templates share the layout; only the linear symbology differs.
  const gs1 = id === 'thermal-100x150-gs1';
  return defaultLabelDocument({
    name: meta.name,
    category: 'shipping',
    widthMm: 100,
    heightMm: 150,
    orientation: 'portrait',
    templateId: id,
    style: { background: '#ffffff', border: { colour: '#10171d', width: 0.6, radius: 2 }, paddingMm: 5 },
    sheet: SHEET_ONE,
    values: exampleShipment(gs1),
    elements: [
      element({ kind: 'text', id: 'fromLabel', name: 'From label', text: 'FROM', x: 0, y: 0, width: 20, height: 2.6, style: { ...SANS, size: 1.9, colour: '#5a6577' } as never }),
      field('senderName', 'Sender name', { x: 0, y: 3, width: 58, height: 4 }, { size: 2.6, family: 'sans-bold', wrap: false }),
      field('senderAddress', 'Sender address', { x: 0, y: 7.4, width: 58, height: 9 }, { size: 2.3 }),
      field('senderPhone', 'Sender phone', { x: 0, y: 16.8, width: 58, height: 3 }, { size: 2.1, colour: '#5a6577' }),
      element({ kind: 'line', id: 'rule1', name: 'Divider', x: 0, y: 20.4, width: 90, height: 0, colour: '#10171d', thickness: 0.6 } as never),
      element({ kind: 'text', id: 'toLabel', name: 'To label', text: 'TO', x: 0, y: 22.4, width: 20, height: 2.8, style: { ...SANS, size: 1.9, colour: '#5a6577' } as never }),
      field('recipientName', 'Recipient name', { x: 0, y: 25.6, width: 66, height: 7 }, { size: 4.6, family: 'sans-bold', wrap: false }),
      field('recipientCompany', 'Recipient company', { x: 0, y: 33, width: 66, height: 4 }, { size: 2.6 }),
      field('recipientAddress', 'Recipient address', { x: 0, y: 37.4, width: 66, height: 17 }, { size: 2.8 }),
      field('recipientPhone', 'Recipient phone', { x: 0, y: 54.8, width: 66, height: 4 }, { size: 2.3, colour: '#5a6577' }),
      qr('qr', { x: 70, y: 25.6, width: 20, height: 20 }),
      element({ kind: 'line', id: 'rule2', name: 'Divider', x: 0, y: 60.4, width: 90, height: 0, colour: '#10171d', thickness: 0.6 } as never),
      field('reference', 'Reference', { x: 0, y: 62.4, width: 50, height: 5 }, { size: 3.2, family: 'mono', wrap: false }),
      field('trackingNumber', 'Tracking number', { x: 52, y: 62.4, width: 38, height: 5 }, { size: 2.4, align: 'right', wrap: false }),
      field('pieces', 'Pieces', { x: 0, y: 68, width: 24, height: 4 }, { size: 2.4 }),
      field('weight', 'Weight', { x: 26, y: 68, width: 24, height: 4 }, { size: 2.4 }),
      field('dimensions', 'Dimensions', { x: 52, y: 68, width: 38, height: 4 }, { size: 2.4, align: 'right' }),
      field('service', 'Service', { x: 0, y: 72.6, width: 45, height: 4 }, { size: 2.2, colour: '#5a6577' }),
      field('carrier', 'Carrier', { x: 47, y: 72.6, width: 43, height: 4 }, { size: 2.2, align: 'right', colour: '#5a6577' }),
      field('instructions', 'Instructions', { x: 0, y: 77.4, width: 90, height: 5 }, { size: 2.4, colour: '#5a6577' }),
      // A GS1-128 element string is much longer than a plain payload: `(00)` + 18 digits + `(10)` +
      // the reference is 343 modules, i.e. 82.3 mm of bars at 0.24 mm/module plus a 2.4 mm quiet zone
      // each side = 87.1 mm. At 0.3 mm it would need 109 mm and overflow the 90 mm column, which the
      // layout engine reports as an error rather than squashing the symbol.
      barcode(gs1 ? 'gs1code' : 'reference', gs1 ? 'gs1-128' : 'code128', gs1 ? 0.24 : 0.4, { x: 0, y: 84, width: 90, height: gs1 ? 22 : 18 }, true),
      field('shipDate', 'Ship date', { x: 0, y: 105, width: 45, height: 4 }, { size: 2.2, colour: '#5a6577' }),
      field('declaredValue', 'Declared value', { x: 47, y: 105, width: 43, height: 4 }, { size: 2.2, align: 'right', colour: '#5a6577' }),
    ],
  });
}

/** The example shipment the shipping templates preview with. */
export function exampleShipment(gs1 = false): LabelValues {
  return shipmentValues({
    ...DEFAULT_SHIPMENT,
    senderName: 'CloudHost247 Ltd',
    senderCompany: 'CloudHost247 Ltd',
    senderAddress: '12 Rukuba Road\nJos North, Plateau 930101\nNigeria',
    senderPhone: '+234 800 000 0000',
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
    sscc: gs1 ? '106141411234567897' : '',
    gtin: '',
    trackingUrl: 'https://cloudhost247.com/track/CH247-2026-000123',
  });
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export interface ShippingIssue {
  level: 'error' | 'warn';
  field: string;
  message: string;
  hint?: string;
}

/** Validate a shipment record. Errors block the codes; warnings print. */
export function validateShipment(shipment: ShipmentData, options: { code?: ShippingCodeKind } = {}): ShippingIssue[] {
  const issues: ShippingIssue[] = [];
  for (const rule of SHIPPING_FIELDS) {
    const raw = String(shipment[rule.key] ?? '');
    const value = raw.trim();
    if (value === '') {
      if (rule.required) {
        issues.push({ level: 'error', field: rule.key, message: `${rule.label} is required.`, hint: rule.hint });
      }
      continue;
    }
    if (value.length > rule.maxLength) {
      issues.push({
        level: 'error',
        field: rule.key,
        message: `${rule.label} is ${value.length} characters; the maximum is ${rule.maxLength}.`,
      });
    }
    if (rule.pattern && !rule.pattern.regex.test(value)) {
      issues.push({ level: 'error', field: rule.key, message: `${rule.label}: ${rule.pattern.message}` });
    }
  }

  if (shipment.senderEmail.trim() !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(shipment.senderEmail.trim())) {
    issues.push({ level: 'error', field: 'senderEmail', message: 'Sender email is not a valid address.' });
  }
  if (shipment.recipientEmail.trim() !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(shipment.recipientEmail.trim())) {
    issues.push({ level: 'error', field: 'recipientEmail', message: 'Recipient email is not a valid address.' });
  }
  if (shipment.shipDate.trim() !== '' && !isIsoDate(shipment.shipDate.trim())) {
    issues.push({ level: 'error', field: 'shipDate', message: 'Ship date must be a real date in YYYY-MM-DD form.' });
  }
  if (shipment.sscc.trim() !== '' && !/^\d{18}$/.test(shipment.sscc.trim())) {
    issues.push({ level: 'error', field: 'sscc', message: 'An SSCC is exactly 18 digits (extension digit, 16-digit body, check digit).' });
  }
  if (shipment.gtin.trim() !== '' && !/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(shipment.gtin.trim())) {
    issues.push({ level: 'error', field: 'gtin', message: 'A GTIN is 8, 12, 13 or 14 digits.' });
  }
  if (shipment.trackingUrl.trim() !== '' && !/^https?:\/\/\S+$/i.test(shipment.trackingUrl.trim())) {
    issues.push({ level: 'error', field: 'trackingUrl', message: 'The tracking URL must start with http:// or https://.' });
  }

  if (options.code === 'gs1-128') {
    if (shipment.sscc.trim() === '') {
      issues.push({
        level: 'error',
        field: 'sscc',
        message: 'A GS1-128 shipping symbol needs an SSCC: AI (00) is what the warehouse scan is looking for.',
        hint: '18 digits. Leave it blank and choose plain Code 128 if you do not have one.',
      });
    }
  }

  // A tracking number the user typed is fine; a tracking number that looks generated is a warning,
  // because it is the one field on a shipping label that people assume is authoritative.
  if (shipment.trackingNumber.trim() === '') {
    issues.push({
      level: 'warn',
      field: 'trackingNumber',
      message: 'No carrier tracking number. The label prints your reference only — the carrier will assign a tracking number when you hand the parcel over.',
    });
  }

  return issues;
}

/** Real-date check that rejects 2026-02-31 the way `new Date` does not. */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map((part) => Number(part));
  if (!year || !month || !day) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Build the GS1-128 element string.
 *
 * Only the AIs this tool actually has data for are emitted, in a fixed order, and the result is
 * reported along with what was included so the page can show the operator the exact element string —
 * the same "never invent a result" rule the other tools follow.
 */
export function buildGs1ElementString(shipment: ShipmentData): { value: string; included: string[]; omitted: string[] } {
  const included: string[] = [];
  const omitted: string[] = [];
  let value = '';
  if (/^\d{18}$/.test(shipment.sscc.trim())) {
    value += `(00)${shipment.sscc.trim()}`;
    included.push('(00) SSCC');
  } else {
    omitted.push('(00) SSCC');
  }
  const reference = shipment.reference.trim();
  if (reference !== '') {
    // AI (10) is batch/lot, variable length, alphanumeric up to 20 characters.
    const batch = reference.slice(0, 20);
    value += `(10)${batch}`;
    included.push('(10) reference as batch/lot');
  } else {
    omitted.push('(10) reference');
  }
  if (/^\d{14}$/.test(shipment.gtin.trim())) {
    value += `(01)${shipment.gtin.trim()}`;
    included.push('(01) GTIN');
  }
  return { value, included, omitted };
}
