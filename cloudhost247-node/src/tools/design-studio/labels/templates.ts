/**
 * Label Designer — system templates.
 *
 * The templates are *data*: a label size, a sheet grid and a list of elements. They are built by the
 * same functions the editor uses, so a template cannot express a layout the editor could not have
 * produced — which is what keeps "template" and "saved document" one concept rather than two.
 *
 * Two rules shape the contents:
 *
 *  1. **Nothing claims a standard it has not been checked against.** The address, product, asset and
 *     parcel labels are described by what they contain ("recipient block, 4 lines, 3 mm") — not by
 *     an ISO or GS1 number. The VDA templates live in the VDA module, which documents its
 *     specification and its limits.
 *  2. **Every template prints at its stated size.** Sizes come from real label stock (a 70 × 40 mm
 *     sheet, a 99.1 × 38.1 mm address label, a 50 × 25 mm thermal label), and the layout is checked by
 *     the test suite at those dimensions — not eyeballed in a browser at some other zoom.
 */

import { createElement, defaultLabelDocument, type LabelCategory, type LabelDocument, type LabelElement } from './model';

export interface LabelTemplate {
  id: string;
  name: string;
  category: LabelCategory;
  /** One line for the picker. */
  blurb: string;
  /** What the template is for and what a user should change. */
  description: string;
  /** Keywords for search. */
  keywords: string[];
  /** Build a fresh document. A function, not an object: each call returns a new id space. */
  build: () => LabelDocument;
}

function element(overrides: Partial<LabelElement> & { kind: LabelElement['kind'] }): LabelElement {
  return createElement(overrides.kind, overrides as never);
}

const SANS = { family: 'sans' as const, colour: '#10171d', align: 'left' as const, wrap: true, lineHeight: 1.28 };

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

export const LABEL_TEMPLATES: readonly LabelTemplate[] = [
  {
    id: 'address-70x40',
    name: 'Address label — 70 × 40 mm',
    category: 'address',
    blurb: 'Recipient block with a Code 128 tracking barcode and a QR code.',
    description:
      'The everyday parcel label: sender line, four-line recipient block, a Code 128 tracking barcode and a QR code pointing at a tracking URL. Works on 70 × 40 mm thermal stock and on an A4 sheet at 2 × 4.',
    keywords: ['address', 'parcel', 'postage', 'shipping', 'thermal', '70x40'],
    build: () =>
      defaultLabelDocument({
        name: 'Address label — 70 × 40 mm',
        category: 'address',
        widthMm: 70,
        heightMm: 40,
        orientation: 'landscape',
        templateId: 'address-70x40',
        style: { background: '#ffffff', border: { colour: '#c9c6bd', width: 0.25, radius: 1.5 }, paddingMm: 3 },
        sheet: { paperId: 'a4', columns: 3, rows: 7, marginMm: 4.7, gutterMm: 2.5 },
        values: {
          sender: 'CloudHost247 Ltd · 12 Rukuba Road, Jos',
          recipient: 'Ada Obi\n24 Zaria Road\nJos North, Plateau 930101\nNigeria',
          tracking: 'CH247-2026-000123',
          trackingUrl: 'https://cloudhost247.com/track/CH247-2026-000123',
        },
        elements: [
          element({
            kind: 'field', id: 'sender', name: 'Sender line', binding: { key: 'sender', fallback: 'Sender' },
            x: 0, y: 0, width: 52, height: 3.2,
            style: { ...SANS, size: 2.2, colour: '#5a6577', wrap: false },
          }),
          element({
            kind: 'field', id: 'recipient', name: 'Recipient block', binding: { key: 'recipient', fallback: 'Recipient name' },
            x: 0, y: 4.2, width: 53, height: 15.2,
            style: { ...SANS, size: 2.9, lineHeight: 1.3 },
          }),
          element({
            kind: 'symbol', id: 'qr', name: 'Tracking QR', binding: { key: 'trackingUrl' }, symbol: 'qrcode', errorCorrection: 'M',
            x: 53, y: 0, width: 13, height: 13, colour: '#000000',
          }),
          // The 200-module example payload needs 50 mm of bars at 0.25 mm/module (the retail
          // minimum), plus a 2.5 mm quiet zone each side and a 2 mm human-readable line.
          element({
            kind: 'barcode', id: 'tracking', name: 'Tracking barcode', binding: { key: 'tracking' },
            formatId: 'code128', moduleMm: 0.25, showText: true, colour: '#000000',
            x: 0, y: 20, width: 64, height: 14,
          }),
        ],
      }),
  },
  {
    id: 'product-50x30',
    name: 'Product label — 50 × 30 mm',
    category: 'product',
    blurb: 'SKU, product name, price and an EAN-13 barcode.',
    description:
      'A retail-style product label with a title, SKU, price and EAN-13. Enter 12 digits and the check digit is calculated; the page tells you the value that will be printed.',
    keywords: ['product', 'retail', 'sku', 'price', 'ean13', 'barcode', '50x30'],
    build: () =>
      defaultLabelDocument({
        name: 'Product label — 50 × 30 mm',
        category: 'product',
        widthMm: 50,
        heightMm: 30,
        orientation: 'landscape',
        templateId: 'product-50x30',
        style: { background: '#ffffff', border: { colour: '#d9d6cf', width: 0.2, radius: 1 }, paddingMm: 2.5 },
        sheet: { paperId: 'label-a4-3x8', columns: 3, rows: 8, marginMm: 7, gutterMm: 2.5 },
        values: { title: 'Yam flour 1 kg', sku: 'SKU-10042', price: '₦4,500', gtin: '400638133393' },
        elements: [
          element({
            kind: 'text', id: 'title', name: 'Product name', text: 'Product name',
            x: 0, y: 0, width: 45, height: 5,
            style: { ...SANS, size: 3.4, family: 'sans-bold', wrap: false },
          }),
          element({
            kind: 'field', id: 'sku', name: 'SKU', binding: { key: 'sku' },
            x: 0, y: 5.4, width: 25, height: 3.2,
            style: { ...SANS, size: 2.6, family: 'mono', wrap: false },
          }),
          element({
            kind: 'field', id: 'price', name: 'Price', binding: { key: 'price' },
            x: 27, y: 5.4, width: 18, height: 3.2,
            style: { ...SANS, size: 3, family: 'sans-bold', align: 'right', wrap: false },
          }),
          element({
            kind: 'barcode', id: 'gtin', name: 'EAN-13', binding: { key: 'gtin' },
            formatId: 'ean13', moduleMm: 0.3, showText: true, colour: '#000000',
            x: 2, y: 11, width: 41, height: 12,
          }),
        ],
      }),
  },
  {
    id: 'asset-tag-60x25',
    name: 'Asset tag — 60 × 25 mm',
    category: 'asset',
    blurb: 'Asset number, description and a Code 39 tag for durable equipment.',
    description: 'For IT and facilities asset tagging. Code 39 is deliberately used: it is readable by the broadest range of older handheld scanners, which is what asset audits tend to use.',
    keywords: ['asset', 'equipment', 'inventory', 'tag', 'code39', '60x25'],
    build: () =>
      defaultLabelDocument({
        name: 'Asset tag — 60 × 25 mm',
        category: 'asset',
        widthMm: 60,
        heightMm: 25,
        orientation: 'landscape',
        templateId: 'asset-tag-60x25',
        style: { background: '#ffffff', border: { colour: '#10171d', width: 0.4, radius: 1 }, paddingMm: 2.5 },
        sheet: { paperId: 'a4', columns: 3, rows: 10, marginMm: 6, gutterMm: 2 },
        values: { asset: 'CH-IT-417', description: 'Dell Latitude 5440 · Finance', owner: 'IT Operations' },
        elements: [
          element({
            kind: 'field', id: 'asset', name: 'Asset number', binding: { key: 'asset' },
            x: 0, y: 0, width: 55, height: 5,
            style: { ...SANS, size: 4, family: 'sans-bold', wrap: false },
          }),
          element({
            kind: 'field', id: 'description', name: 'Description', binding: { key: 'description' },
            x: 0, y: 5.4, width: 55, height: 4,
            style: { ...SANS, size: 2.4, wrap: false },
          }),
          element({
            kind: 'field', id: 'owner', name: 'Owner', binding: { key: 'owner' },
            x: 0, y: 9.4, width: 30, height: 3,
            style: { ...SANS, size: 2, colour: '#5a6577', wrap: false },
          }),
          // Code 39 spends ~19 modules per character, so it is the wide symbology: this payload is
          // 191 modules, i.e. 47.8 mm of bars at 0.25 mm/module plus a 2.5 mm quiet zone each side.
          element({
            kind: 'barcode', id: 'code', name: 'Asset barcode', binding: { key: 'asset' },
            formatId: 'code39', moduleMm: 0.25, showText: false, colour: '#000000',
            x: 0, y: 12.8, width: 54, height: 8,
          }),
        ],
      }),
  },
  {
    id: 'parcel-100x150',
    name: 'Parcel label — 100 × 150 mm',
    category: 'shipping',
    blurb: 'Full-size carrier-neutral parcel label with sender and recipient blocks.',
    description:
      'A 100 × 150 mm thermal parcel label with sender/recipient blocks, package details and two codes: a Code 128 reference and a QR code. Carrier-neutral by design — see the Shipping Label tool for a layout with a tracking number you supply.',
    keywords: ['parcel', 'carrier', 'shipment', '100x150', 'thermal', 'logistics'],
    build: () =>
      defaultLabelDocument({
        name: 'Parcel label — 100 × 150 mm',
        category: 'shipping',
        widthMm: 100,
        heightMm: 150,
        orientation: 'portrait',
        templateId: 'parcel-100x150',
        style: { background: '#ffffff', border: { colour: '#10171d', width: 0.5, radius: 2 }, paddingMm: 5 },
        sheet: { paperId: 'label-100x150', columns: 1, rows: 1, marginMm: 0, gutterMm: 0 },
        values: {
          senderName: 'CloudHost247 Ltd',
          senderAddress: '12 Rukuba Road\nJos North, Plateau 930101\nNigeria\n+234 800 000 0000',
          recipientName: 'Ada Obi',
          recipientAddress: '24 Zaria Road\nJos North, Plateau 930101\nNigeria\n+234 801 111 1111',
          reference: 'CH247-2026-000123',
          weight: '2.4 kg',
          packages: '1 of 1',
        },
        elements: [
          element({
            kind: 'text', id: 'fromLabel', name: 'From label', text: 'FROM',
            x: 0, y: 0, width: 20, height: 3, style: { ...SANS, size: 2.6, family: 'sans-bold', wrap: false },
          }),
          element({
            kind: 'field', id: 'senderName', name: 'Sender name', binding: { key: 'senderName' },
            x: 0, y: 3.5, width: 90, height: 4, style: { ...SANS, size: 3.2, family: 'sans-bold', wrap: false },
          }),
          element({
            kind: 'field', id: 'senderAddress', name: 'Sender address', binding: { key: 'senderAddress' },
            x: 0, y: 7.5, width: 90, height: 15, style: { ...SANS, size: 2.8 },
          }),
          element({ kind: 'line', id: 'rule1', name: 'Divider', x: 0, y: 24, width: 90, height: 0, colour: '#10171d', thickness: 0.4 }),
          element({
            kind: 'text', id: 'toLabel', name: 'To label', text: 'TO',
            x: 0, y: 27, width: 20, height: 3, style: { ...SANS, size: 2.6, family: 'sans-bold', wrap: false },
          }),
          element({
            kind: 'field', id: 'recipientName', name: 'Recipient name', binding: { key: 'recipientName' },
            x: 0, y: 30.5, width: 65, height: 6, style: { ...SANS, size: 5, family: 'sans-bold', wrap: false },
          }),
          element({
            kind: 'field', id: 'recipientAddress', name: 'Recipient address', binding: { key: 'recipientAddress' },
            x: 0, y: 37.5, width: 65, height: 22, style: { ...SANS, size: 3.4 },
          }),
          element({
            kind: 'symbol', id: 'qr', name: 'Reference QR', binding: { key: 'reference' }, symbol: 'qrcode', errorCorrection: 'M',
            x: 68, y: 29, width: 22, height: 22, colour: '#000000',
          }),
          element({
            kind: 'field', id: 'weight', name: 'Weight', binding: { key: 'weight' },
            x: 0, y: 62, width: 40, height: 4, style: { ...SANS, size: 3, family: 'sans-bold', wrap: false },
          }),
          element({
            kind: 'field', id: 'packages', name: 'Package count', binding: { key: 'packages' },
            x: 45, y: 62, width: 45, height: 4, style: { ...SANS, size: 3, align: 'right', wrap: false },
          }),
          // 0.4 mm/module: 200 modules = 80 mm of bars, plus a 4 mm quiet zone each side and the
          // human-readable line, so the element needs 88 x 30.4 mm.
          element({
            kind: 'barcode', id: 'ref', name: 'Reference barcode', binding: { key: 'reference' },
            formatId: 'code128', moduleMm: 0.4, showText: true, colour: '#000000',
            x: 0, y: 74, width: 90, height: 30.4,
          }),
        ],
      }),
  },
  {
    id: 'inventory-shelf-40x20',
    name: 'Shelf label — 40 × 20 mm',
    category: 'product',
    blurb: 'Compact shelf-edge label: location, item and a QR code.',
    description: 'For warehouse and shop shelves. The QR code holds the location code, so a phone camera can confirm a pick without a scanner.',
    keywords: ['shelf', 'warehouse', 'inventory', 'location', '40x20'],
    build: () =>
      defaultLabelDocument({
        name: 'Shelf label — 40 × 20 mm',
        category: 'product',
        widthMm: 40,
        heightMm: 20,
        orientation: 'landscape',
        templateId: 'inventory-shelf-40x20',
        style: { background: '#ffffff', border: { colour: '#c9c6bd', width: 0.2, radius: 0.8 }, paddingMm: 2 },
        sheet: { paperId: 'a4', columns: 4, rows: 12, marginMm: 6, gutterMm: 2 },
        values: { location: 'A-04-02', item: 'Cat 6 patch cable 2 m', code: 'A-04-02' },
        elements: [
          element({
            kind: 'field', id: 'location', name: 'Location', binding: { key: 'location' },
            x: 0, y: 0, width: 28, height: 5, style: { ...SANS, size: 4.2, family: 'sans-bold', wrap: false },
          }),
          element({
            kind: 'field', id: 'item', name: 'Item', binding: { key: 'item' },
            x: 0, y: 5.5, width: 28, height: 6, style: { ...SANS, size: 2.2, lineHeight: 1.25 },
          }),
          element({
            kind: 'symbol', id: 'qr', name: 'Location QR', binding: { key: 'code' }, symbol: 'qrcode', errorCorrection: 'M',
            x: 29, y: 2, width: 9, height: 9, colour: '#000000',
          }),
        ],
      }),
  },
  {
    id: 'blank-70x40',
    name: 'Blank label — 70 × 40 mm',
    category: 'custom',
    blurb: 'Empty 70 × 40 mm label with a border, ready for your own elements.',
    description: 'Start from nothing: the sheet, size and border are set, and the element palette is on the left.',
    keywords: ['blank', 'custom', 'empty', 'start'],
    build: () =>
      defaultLabelDocument({
        name: 'Blank label — 70 × 40 mm',
        category: 'custom',
        widthMm: 70,
        heightMm: 40,
        sheet: { paperId: 'a4', columns: 3, rows: 7, marginMm: 4.7, gutterMm: 2.5 },
        values: {},
        elements: [],
      }),
  },
];

export function findLabelTemplate(id: string): LabelTemplate | undefined {
  return LABEL_TEMPLATES.find((template) => template.id === id);
}

export function buildLabelTemplate(id: string): LabelDocument | null {
  const template = findLabelTemplate(id);
  return template ? template.build() : null;
}

/** Search templates by name, description and keyword, case/diacritic-insensitively. */
export function searchLabelTemplates(query: string, category?: LabelCategory | 'all'): LabelTemplate[] {
  const terms = query
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/\s+/)
    .filter(Boolean);
  return LABEL_TEMPLATES.filter((template) => {
    if (category && category !== 'all' && template.category !== category) return false;
    if (terms.length === 0) return true;
    const haystack = [template.name, template.blurb, template.description, ...template.keywords].join(' ').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return terms.every((term) => haystack.includes(term));
  });
}
