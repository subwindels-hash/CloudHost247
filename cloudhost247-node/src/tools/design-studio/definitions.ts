/**
 * Design Studio definitions: the templates, stock sizes and field lists the tools offer.
 *
 * Pure data with no server dependencies. The API validates requests against these lists and the
 * browser renders its forms from the same lists, so a template the page offers is always one the
 * server can draw, with the same field names and the same limits.
 */

import { LABEL_SHEETS, fitsSheetPosition } from './shared/sheets';

/* ------------------------------------------------------------------ */
/* Tool slugs                                                          */
/* ------------------------------------------------------------------ */

export const STUDIO_SLUGS = {
  barcode: 'barcode-generator',
  labels: 'label-designer',
  vda: 'vda-4902-label-generator',
  shipping: 'shipping-label-generator',
  cards: 'qr-business-card-designer',
  qr: 'qr-code-maker',
} as const;

export type StudioSlug = (typeof STUDIO_SLUGS)[keyof typeof STUDIO_SLUGS];

export const STUDIO_TOOL_SLUGS: readonly StudioSlug[] = Object.values(STUDIO_SLUGS);

/* ------------------------------------------------------------------ */
/* Label stock                                                         */
/* ------------------------------------------------------------------ */

export interface LabelStock {
  id: string;
  label: string;
  /** One label, in millimetres. */
  width: number;
  height: number;
  /** Set when the labels come on a sheet; absent for roll and single labels. */
  sheet?: string;
}

const ROLL_STOCK: readonly LabelStock[] = [
  { id: 'roll-38x19', label: 'Single label · 38 × 19 mm', width: 38, height: 19 },
  { id: 'roll-51x25', label: 'Single label · 51 × 25 mm', width: 51, height: 25 },
  { id: 'roll-57x32', label: 'Single label · 57 × 32 mm', width: 57, height: 32 },
  { id: 'roll-76x51', label: 'Single label · 76 × 51 mm (3 × 2 in)', width: 76.2, height: 50.8 },
  { id: 'roll-100x50', label: 'Single label · 100 × 50 mm', width: 100, height: 50 },
  { id: 'roll-100x150', label: 'Single label · 100 × 150 mm', width: 100, height: 150 },
];

/** Every stock a label can be printed on: single labels first, then the sheet layouts. */
export const LABEL_STOCKS: readonly LabelStock[] = [
  ...ROLL_STOCK,
  ...LABEL_SHEETS.map((sheet) => ({ id: sheet.id, label: sheet.label, width: sheet.labelWidth, height: sheet.labelHeight, sheet: sheet.id })),
];

export const CUSTOM_STOCK_ID = 'custom';
export const CUSTOM_STOCK_LIMITS = { minWidth: 20, maxWidth: 210, minHeight: 10, maxHeight: 297 } as const;

export function labelStock(id: string): LabelStock | undefined {
  return LABEL_STOCKS.find((stock) => stock.id === id);
}

/* ------------------------------------------------------------------ */
/* Label templates                                                     */
/* ------------------------------------------------------------------ */

export interface TemplateField {
  name: string;
  label: string;
  type: 'text' | 'textarea';
  maxLength: number;
  required?: boolean;
  sample: string;
  help?: string;
}

export interface LabelTemplate {
  id: string;
  name: string;
  summary: string;
  fields: readonly TemplateField[];
  /** Barcode types the template can carry. Empty for a text-only label. */
  symbologies: readonly string[];
  /** The field whose value the barcode encodes, and which numbering increments. */
  codeField?: string;
  /** Whether "number the labels" makes sense for this template. */
  numbering: boolean;
  /** The smallest label the layout is drawn on. */
  minWidth: number;
  minHeight: number;
  defaultStock: string;
}

export const LABEL_TEMPLATES: readonly LabelTemplate[] = [
  {
    id: 'asset-tag',
    name: 'Asset tag',
    summary: 'An owner line, a barcode and the asset number. For equipment, furniture and IT inventory.',
    fields: [
      { name: 'heading', label: 'Owner or heading', type: 'text', maxLength: 40, sample: 'Property of CloudHost247' },
      { name: 'code', label: 'Asset number', type: 'text', maxLength: 30, required: true, sample: 'CH-000123', help: 'Encoded in the barcode and printed beneath it.' },
      { name: 'detail', label: 'Description (optional)', type: 'text', maxLength: 40, sample: 'IT Department · Laptop' },
    ],
    symbologies: ['code128', 'code39', 'qrcode', 'datamatrix'],
    codeField: 'code',
    numbering: true,
    minWidth: 30,
    minHeight: 15,
    defaultStock: 'a4-3x7-63x38',
  },
  {
    id: 'product-label',
    name: 'Product label',
    summary: 'Product name, variant, price and a retail or internal barcode.',
    fields: [
      { name: 'name', label: 'Product name', type: 'text', maxLength: 60, required: true, sample: 'Arabica Coffee Beans' },
      { name: 'detail', label: 'Variant or size (optional)', type: 'text', maxLength: 60, sample: 'Medium roast · 500 g' },
      { name: 'price', label: 'Price (optional)', type: 'text', maxLength: 16, sample: 'NGN 4,500' },
      // 952 is the GS1 prefix set aside for demonstrations, so the example is nobody's product.
      { name: 'code', label: 'Barcode number', type: 'text', maxLength: 30, required: true, sample: '9520123456788', help: 'EAN-13 takes 12 or 13 digits, UPC-A 11 or 12, EAN-8 7 or 8. A missing check digit is calculated.' },
    ],
    symbologies: ['ean13', 'upca', 'ean8', 'code128', 'qrcode'],
    codeField: 'code',
    numbering: false,
    minWidth: 38,
    minHeight: 25,
    defaultStock: 'a4-3x7-63x38',
  },
  {
    id: 'qr-label',
    name: 'QR code label',
    summary: 'A 2D code with a title and a few lines of text. For links, manuals and equipment records.',
    fields: [
      { name: 'content', label: 'Code content', type: 'textarea', maxLength: 300, required: true, sample: 'https://cloudhost247.com/support', help: 'A web address or any text. This is what a phone reads.' },
      { name: 'heading', label: 'Title (optional)', type: 'text', maxLength: 40, sample: 'Need help?' },
      { name: 'text', label: 'Text (optional)', type: 'textarea', maxLength: 120, sample: 'Scan for support\nand documentation.' },
    ],
    symbologies: ['qrcode', 'datamatrix', 'aztec'],
    codeField: 'content',
    numbering: false,
    minWidth: 25,
    minHeight: 15,
    defaultStock: 'a4-3x7-63x38',
  },
  {
    id: 'part-serial',
    name: 'Part and serial number label',
    summary: 'Two captioned barcodes on one label: a part number and a serial number.',
    fields: [
      { name: 'heading', label: 'Heading (optional)', type: 'text', maxLength: 40, sample: 'CloudHost247 Hardware' },
      { name: 'part', label: 'Part number', type: 'text', maxLength: 24, required: true, sample: 'PN-48213-B' },
      { name: 'code', label: 'Serial number', type: 'text', maxLength: 24, required: true, sample: 'SN-0004501', help: 'Numbering increments this value.' },
    ],
    symbologies: ['code128', 'code39'],
    codeField: 'code',
    numbering: true,
    minWidth: 50,
    minHeight: 30,
    defaultStock: 'a4-2x7-99x38',
  },
  {
    id: 'shelf-label',
    name: 'Shelf or bin location label',
    summary: 'A large location code with its barcode, readable from the aisle.',
    fields: [
      { name: 'code', label: 'Location code', type: 'text', maxLength: 16, required: true, sample: 'A-12-03' },
      { name: 'detail', label: 'Description (optional)', type: 'text', maxLength: 40, sample: 'Aisle A · Bay 12 · Level 3' },
    ],
    symbologies: ['code128', 'code39', 'qrcode'],
    codeField: 'code',
    numbering: true,
    minWidth: 38,
    minHeight: 19,
    defaultStock: 'a4-2x7-99x38',
  },
  {
    id: 'address-label',
    name: 'Address label',
    summary: 'A recipient address with an optional sender line. Text only.',
    fields: [
      { name: 'name', label: 'Name', type: 'text', maxLength: 50, required: true, sample: 'Amina Yusuf' },
      { name: 'address', label: 'Address', type: 'textarea', maxLength: 240, required: true, sample: '14 Ahmadu Bello Way\nJos 930001\nPlateau State\nNIGERIA', help: 'One line of the address per line, up to six lines.' },
      { name: 'sender', label: 'Sender line (optional)', type: 'text', maxLength: 80, sample: 'From: CloudHost247 · 2 Marina Road · Lagos' },
    ],
    symbologies: [],
    numbering: false,
    minWidth: 50,
    minHeight: 25,
    defaultStock: 'a4-3x7-63x38',
  },
];

export function labelTemplate(id: string): LabelTemplate | undefined {
  return LABEL_TEMPLATES.find((template) => template.id === id);
}

/**
 * The stocks a template can be drawn on: every one at least as large as the layout's minimum.
 * The form offers these (plus a custom size); the API refuses the others with `LABEL_TOO_SMALL`.
 */
export function labelStocksFor(template: LabelTemplate): LabelStock[] {
  return LABEL_STOCKS.filter((stock) => stock.width >= template.minWidth - 0.01 && stock.height >= template.minHeight - 0.01);
}

/** Every distinct field name used by a label template, with the templates that use it. */
export function labelFieldUsage(): Array<{ name: string; templates: string[]; fields: TemplateField[] }> {
  const usage = new Map<string, { name: string; templates: string[]; fields: TemplateField[] }>();
  for (const template of LABEL_TEMPLATES) {
    for (const field of template.fields) {
      const entry = usage.get(field.name) ?? { name: field.name, templates: [], fields: [] };
      entry.templates.push(template.id);
      entry.fields.push(field);
      usage.set(field.name, entry);
    }
  }
  return [...usage.values()];
}

/* ------------------------------------------------------------------ */
/* VDA 4902                                                            */
/* ------------------------------------------------------------------ */

export type VdaLanguage = 'en' | 'de' | 'fr' | 'es' | 'pt';

export const VDA_LANGUAGES: ReadonlyArray<{ id: VdaLanguage; label: string }> = [
  { id: 'en', label: 'English' },
  { id: 'de', label: 'Deutsch' },
  { id: 'fr', label: 'Français' },
  { id: 'es', label: 'Español' },
  { id: 'pt', label: 'Português' },
];

export const VDA_FORMATS = [
  { id: 'a5', label: 'A5 landscape · 210 × 148 mm', width: 210, height: 148, sheet: 'a4-1x2-210x148' },
  { id: 'klt', label: 'KLT (small load carrier) · 210 × 74 mm', width: 210, height: 74, sheet: 'a4-1x4-210x74' },
] as const;

export type VdaFormat = (typeof VDA_FORMATS)[number]['id'];

/** The identifier printed and encoded before the package number says what the label is attached to. */
export const VDA_LABEL_TYPES = [
  { id: 'S', label: 'Single package (S)' },
  { id: 'M', label: 'Master label, one part number on the load unit (M)' },
  { id: 'G', label: 'Mixed load unit (G)' },
] as const;

export type VdaLabelType = (typeof VDA_LABEL_TYPES)[number]['id'];

export interface VdaField {
  /** Field number on the label, 1 to 16. */
  number: number;
  name: string;
  /** Data identifier encoded before the value, for the fields that carry a barcode. */
  identifier?: string;
  type: 'text' | 'textarea';
  maxLength: number;
  sample: string;
  /** Fields a receiving plant will normally insist on. Reported when empty, never silently skipped. */
  expected: boolean;
  /** The label cannot be drawn without this value. */
  required?: boolean;
  captions: Record<VdaLanguage, string>;
  /** Form label, in English. */
  label: string;
}

export const VDA_FIELDS: readonly VdaField[] = [
  {
    number: 1, name: 'receiver', type: 'textarea', maxLength: 90, expected: true, label: 'Receiver (short address)',
    sample: 'Example Automotive GmbH\nWerk 2\n12345 Musterstadt',
    captions: { en: 'Receiver (short address)', de: 'Warenempfänger (Kurzadresse)', fr: 'Destinataire (adresse abrégée)', es: 'Destinatario (dirección abreviada)', pt: 'Destinatário (endereço abreviado)' },
  },
  {
    number: 2, name: 'dock', type: 'text', maxLength: 60, expected: true, label: 'Unloading point, storage location, usage code',
    sample: 'Tor 14 - LG 07 - M3',
    captions: { en: 'Unloading point - Storage location - Usage code', de: 'Abladestelle - Lagerort - Verwendungsschlüssel', fr: 'Point de déchargement - Lieu de stockage - Code d’utilisation', es: 'Punto de descarga - Almacén - Código de uso', pt: 'Ponto de descarga - Armazém - Código de utilização' },
  },
  {
    number: 3, name: 'deliveryNote', identifier: 'N', type: 'text', maxLength: 12, expected: true, label: 'Delivery note number',
    sample: '12345678',
    captions: { en: 'Delivery note no. (N)', de: 'Lieferschein-Nr. (N)', fr: 'N° de bordereau de livraison (N)', es: 'N.º de albarán (N)', pt: 'N.º da guia de remessa (N)' },
  },
  {
    number: 4, name: 'supplierAddress', type: 'textarea', maxLength: 110, expected: true, label: 'Supplier address (short name, plant, postcode, city)',
    sample: 'Plateau Components Ltd\nPlant 1, 930001 Jos',
    captions: { en: 'Supplier address (short name, plant, postcode, city)', de: 'Lieferantenanschrift (Kurzname, Werk, PLZ, Ort)', fr: 'Adresse du fournisseur (nom abrégé, usine, code postal, ville)', es: 'Dirección del proveedor (nombre abreviado, planta, C.P., ciudad)', pt: 'Endereço do fornecedor (nome abreviado, fábrica, C.P., cidade)' },
  },
  {
    number: 5, name: 'netWeight', type: 'text', maxLength: 12, expected: false, label: 'Net weight',
    sample: '450 kg',
    captions: { en: 'Net weight', de: 'Gewicht netto', fr: 'Poids net', es: 'Peso neto', pt: 'Peso líquido' },
  },
  {
    number: 6, name: 'grossWeight', type: 'text', maxLength: 12, expected: false, label: 'Gross weight',
    sample: '480 kg',
    captions: { en: 'Gross weight', de: 'Gewicht brutto', fr: 'Poids brut', es: 'Peso bruto', pt: 'Peso bruto' },
  },
  {
    number: 7, name: 'packages', type: 'text', maxLength: 6, expected: false, label: 'Number of packages',
    sample: '12',
    captions: { en: 'Number of packages', de: 'Anzahl Packstücke', fr: 'Nombre de colis', es: 'Número de bultos', pt: 'Número de volumes' },
  },
  {
    number: 8, name: 'partNumber', identifier: 'P', type: 'text', maxLength: 22, expected: true, required: true, label: 'Customer part number',
    sample: 'A 123 456 78 90',
    captions: { en: 'Customer part no. (P)', de: 'Sach-Nr. Kunde (P)', fr: 'Référence client (P)', es: 'Referencia cliente (P)', pt: 'Referência cliente (P)' },
  },
  {
    number: 9, name: 'quantity', identifier: 'Q', type: 'text', maxLength: 12, expected: true, required: true, label: 'Quantity',
    sample: '1200',
    captions: { en: 'Quantity (Q)', de: 'Füllmenge (Q)', fr: 'Quantité (Q)', es: 'Cantidad (Q)', pt: 'Quantidade (Q)' },
  },
  {
    number: 10, name: 'description', type: 'text', maxLength: 60, expected: true, label: 'Description of delivery or service',
    sample: 'Bracket, left, zinc plated',
    captions: { en: 'Description of delivery, service', de: 'Bezeichnung Lieferung, Leistung', fr: 'Désignation livraison, prestation', es: 'Denominación suministro, servicio', pt: 'Designação fornecimento, serviço' },
  },
  {
    number: 11, name: 'supplierPartNumber', identifier: '30S', type: 'text', maxLength: 22, expected: false, label: 'Supplier part number',
    sample: 'PC-48213-B',
    captions: { en: 'Supplier part no. (30S)', de: 'Sach-Nr. Lieferant (30S)', fr: 'Référence fournisseur (30S)', es: 'Referencia proveedor (30S)', pt: 'Referência fornecedor (30S)' },
  },
  {
    number: 12, name: 'supplierNumber', identifier: 'V', type: 'text', maxLength: 12, expected: true, label: 'Supplier number',
    sample: '123456789',
    captions: { en: 'Supplier no. (V)', de: 'Lieferanten-Nr. (V)', fr: 'N° fournisseur (V)', es: 'N.º de proveedor (V)', pt: 'N.º do fornecedor (V)' },
  },
  {
    number: 13, name: 'date', type: 'text', maxLength: 20, expected: true, label: 'Date',
    sample: 'D 2026-11-11',
    captions: { en: 'Date', de: 'Datum', fr: 'Date', es: 'Fecha', pt: 'Data' },
  },
  {
    number: 14, name: 'changeLevel', type: 'text', maxLength: 16, expected: false, label: 'Engineering change level',
    sample: '03',
    captions: { en: 'Engineering change level', de: 'Änderungsstand Konstruktion', fr: 'Indice de modification', es: 'Nivel de modificación', pt: 'Nível de alteração' },
  },
  {
    number: 15, name: 'packageNumber', identifier: 'S', type: 'text', maxLength: 12, expected: true, required: true, label: 'Package number',
    sample: '100200301',
    captions: { en: 'Package no.', de: 'Packstück-Nr.', fr: 'N° de colis', es: 'N.º de bulto', pt: 'N.º do volume' },
  },
  {
    number: 16, name: 'batchNumber', identifier: 'H', type: 'text', maxLength: 17, expected: false, label: 'Batch number',
    sample: 'CH2611A',
    captions: { en: 'Batch no. (H)', de: 'Chargen-Nr. (H)', fr: 'N° de lot (H)', es: 'N.º de lote (H)', pt: 'N.º do lote (H)' },
  },
];

/** Characters Code 39 can carry, which is the symbology these labels use. */
export const CODE39_PATTERN = /^[0-9A-Z \-.$/+%]*$/;

/* ------------------------------------------------------------------ */
/* Shipping labels                                                     */
/* ------------------------------------------------------------------ */

export const SHIPPING_SIZES = [
  { id: '4x6', label: '4 × 6 in (101.6 × 152.4 mm)', width: 101.6, height: 152.4 },
  { id: 'a6', label: 'A6 (105 × 148 mm)', width: 105, height: 148 },
  { id: '100x150', label: '100 × 150 mm', width: 100, height: 150 },
] as const;

export type ShippingSize = (typeof SHIPPING_SIZES)[number]['id'];

export const SHIPPING_BARCODES = [
  { id: 'reference', label: 'Reference number (Code 128), the same on every package' },
  { id: 'reference-package', label: 'Reference number plus the package number (Code 128)' },
  { id: 'sscc', label: 'SSCC-18 logistic unit number (GS1-128), one per package' },
  { id: 'none', label: 'No barcode' },
] as const;

export type ShippingBarcode = (typeof SHIPPING_BARCODES)[number]['id'];

export const SHIPPING_SHEETS = [
  { id: 'none', label: 'One label per page (label printers)' },
  { id: 'a4-2x2-105x148', label: 'A4 sheet, four A6 labels' },
  { id: 'letter-2x1-4x6', label: 'Letter sheet, two 4 × 6 in labels' },
] as const;

/**
 * The papers a shipping label of this size can be printed on: single pages always, and every sheet
 * whose positions hold the label at its true size. A label is never scaled to fit a sheet, so the
 * form offers only these and the API refuses any other pairing with `LABEL_EXCEEDS_CELL`.
 */
export function shippingSheetsFor(sizeId: string): string[] {
  const size = SHIPPING_SIZES.find((entry) => entry.id === sizeId);
  return SHIPPING_SHEETS.filter((entry) => {
    if (entry.id === 'none') return true;
    const sheet = LABEL_SHEETS.find((candidate) => candidate.id === entry.id);
    return size !== undefined && sheet !== undefined && fitsSheetPosition(sheet, size.width, size.height);
  }).map((entry) => entry.id);
}

export const SHIPPING_PACKAGE_LIMIT = 50;

export interface ShippingField {
  name: string;
  label: string;
  group: 'from' | 'to' | 'shipment';
  type: 'text' | 'textarea';
  maxLength: number;
  maxLines?: number;
  required?: boolean;
  sample: string;
  help?: string;
}

export const SHIPPING_FIELDS: readonly ShippingField[] = [
  { name: 'fromName', label: 'Sender name', group: 'from', type: 'text', maxLength: 50, sample: 'CloudHost247 Fulfilment' },
  { name: 'fromAddress', label: 'Sender address', group: 'from', type: 'textarea', maxLength: 160, maxLines: 4, sample: '2 Marina Road\nLagos Island\nLagos 101221\nNIGERIA', help: 'Up to four lines.' },
  { name: 'toName', label: 'Recipient name', group: 'to', type: 'text', maxLength: 50, required: true, sample: 'Amina Yusuf' },
  { name: 'toCompany', label: 'Company', group: 'to', type: 'text', maxLength: 50, sample: 'Plateau Components Ltd' },
  { name: 'toAddress', label: 'Street address', group: 'to', type: 'textarea', maxLength: 160, maxLines: 3, required: true, sample: '14 Ahmadu Bello Way\nSuite 5', help: 'Up to three lines.' },
  { name: 'toCity', label: 'City', group: 'to', type: 'text', maxLength: 40, required: true, sample: 'Jos' },
  { name: 'toRegion', label: 'State or region', group: 'to', type: 'text', maxLength: 40, sample: 'Plateau State' },
  { name: 'toPostcode', label: 'Postal code', group: 'to', type: 'text', maxLength: 12, sample: '930001' },
  { name: 'toCountry', label: 'Country', group: 'to', type: 'text', maxLength: 40, sample: 'Nigeria' },
  { name: 'toPhone', label: 'Phone', group: 'to', type: 'text', maxLength: 30, sample: '+234 803 555 0142' },
  { name: 'service', label: 'Service', group: 'shipment', type: 'text', maxLength: 24, sample: 'Standard' },
  { name: 'reference', label: 'Reference or order number', group: 'shipment', type: 'text', maxLength: 30, sample: 'ORD-2026-001542' },
  { name: 'date', label: 'Ship date', group: 'shipment', type: 'text', maxLength: 20, sample: '11 Nov 2026' },
  { name: 'weight', label: 'Weight', group: 'shipment', type: 'text', maxLength: 12, sample: '2.5 kg' },
  { name: 'note', label: 'Handling note', group: 'shipment', type: 'text', maxLength: 40, sample: 'Fragile - handle with care' },
];

/* ------------------------------------------------------------------ */
/* Business cards                                                      */
/* ------------------------------------------------------------------ */

export const CARD_SIZES = [
  { id: 'eu', label: '85 × 55 mm (Europe, Africa, most of the world)', width: 85, height: 55 },
  { id: 'us', label: '3.5 × 2 in / 88.9 × 50.8 mm (US, Canada)', width: 88.9, height: 50.8 },
  { id: 'jp', label: '91 × 55 mm (Japan)', width: 91, height: 55 },
] as const;

export type CardSize = (typeof CARD_SIZES)[number]['id'];

export const CARD_LAYOUTS = [
  { id: 'classic', label: 'Classic: details on the left, code on the right', sides: 1 },
  { id: 'band', label: 'Colour band: code on a coloured panel', sides: 1 },
  { id: 'duplex', label: 'Two-sided: details on the front, large code on the back', sides: 2 },
] as const;

export type CardLayout = (typeof CARD_LAYOUTS)[number]['id'];

export const CARD_CODES = [
  { id: 'qrcode', label: 'QR Code' },
  { id: 'datamatrix', label: 'Data Matrix' },
] as const;

export const CARD_PAYLOADS = [
  { id: 'vcard', label: 'vCard 3.0: the full contact, read by every phone' },
  { id: 'mecard', label: 'MeCard: more compact, a smaller code' },
] as const;

export const CARD_SHEETS = [
  { id: 'none', label: 'Single card (one page per side, at card size)' },
  { id: 'a4', label: 'A4 sheet with cut marks' },
  { id: 'letter', label: 'US Letter sheet with cut marks' },
] as const;

export interface CardField {
  name: string;
  label: string;
  maxLength: number;
  required?: boolean;
  sample: string;
}

export const CARD_FIELDS: readonly CardField[] = [
  { name: 'firstName', label: 'First name', maxLength: 40, required: true, sample: 'Amina' },
  { name: 'lastName', label: 'Last name', maxLength: 40, sample: 'Yusuf' },
  { name: 'jobTitle', label: 'Job title', maxLength: 60, sample: 'Solutions Architect' },
  { name: 'organization', label: 'Company', maxLength: 60, sample: 'CloudHost247' },
  { name: 'email', label: 'Email', maxLength: 80, sample: 'amina.yusuf@cloudhost247.com' },
  { name: 'phone', label: 'Phone (work)', maxLength: 30, sample: '+234 803 555 0142' },
  { name: 'mobile', label: 'Mobile', maxLength: 30, sample: '+234 809 555 0177' },
  { name: 'website', label: 'Website', maxLength: 80, sample: 'https://cloudhost247.com' },
  { name: 'street', label: 'Street address', maxLength: 80, sample: '14 Ahmadu Bello Way' },
  { name: 'city', label: 'City', maxLength: 40, sample: 'Jos' },
  { name: 'region', label: 'State or region', maxLength: 40, sample: 'Plateau State' },
  { name: 'postalCode', label: 'Postal code', maxLength: 16, sample: '930001' },
  { name: 'country', label: 'Country', maxLength: 40, sample: 'Nigeria' },
];

/* ------------------------------------------------------------------ */
/* QR Code Maker                                                       */
/* ------------------------------------------------------------------ */

/**
 * What a code can be made to do when a phone scans it. `noun` completes "a QR code for ..." and is
 * the only thing about a request that reaches the history label: never the content.
 */
export const QR_KINDS = [
  { id: 'url', label: 'Open a website', noun: 'a website link' },
  { id: 'text', label: 'Show text', noun: 'text' },
  { id: 'wifi', label: 'Join a Wi-Fi network', noun: 'a Wi-Fi network' },
  { id: 'contact', label: 'Save a contact', noun: 'a contact' },
  { id: 'email', label: 'Write an email', noun: 'an email' },
  { id: 'phone', label: 'Call a phone number', noun: 'a phone number' },
  { id: 'sms', label: 'Send a text message (SMS)', noun: 'a text message' },
  { id: 'whatsapp', label: 'Open a WhatsApp chat', noun: 'a WhatsApp chat' },
  { id: 'event', label: 'Add a calendar event', noun: 'a calendar event' },
  { id: 'location', label: 'Show a place on the map', noun: 'a map location' },
  { id: 'social', label: 'Open a social media profile', noun: 'a social media profile' },
  { id: 'payment', label: 'Pay by SEPA bank transfer (EPC QR code)', noun: 'a SEPA payment' },
] as const;

export type QrKind = (typeof QR_KINDS)[number]['id'];

/** The 2D codes a phone camera reads. A SEPA payment code is a QR Code by its standard. */
export const QR_CODE_TYPES = [
  { id: 'qrcode', label: 'QR Code' },
  { id: 'datamatrix', label: 'Data Matrix' },
  { id: 'aztec', label: 'Aztec Code' },
] as const;

export const QR_WIFI_SECURITY = [
  { id: 'WPA', label: 'WPA, WPA2 or WPA3 (password)' },
  { id: 'WEP', label: 'WEP (old routers)' },
  { id: 'nopass', label: 'None (open network)' },
] as const;

export const QR_CONTACT_FORMATS = [
  { id: 'vcard', label: 'vCard 3.0: the full contact, read by every phone' },
  { id: 'mecard', label: 'MeCard: more compact, a smaller code' },
] as const;

export const QR_MAP_FORMATS = [
  { id: 'link', label: 'Map link: a web address, opens wherever a browser does' },
  { id: 'geo', label: 'geo: coordinates, handed to the phone’s maps app' },
] as const;

/** Profile addresses: `{handle}` is replaced by the name as typed, without a leading @. */
export const QR_SOCIAL_PLATFORMS = [
  { id: 'facebook', label: 'Facebook', url: 'https://www.facebook.com/{handle}' },
  { id: 'instagram', label: 'Instagram', url: 'https://www.instagram.com/{handle}' },
  { id: 'x', label: 'X (Twitter)', url: 'https://x.com/{handle}' },
  { id: 'tiktok', label: 'TikTok', url: 'https://www.tiktok.com/@{handle}' },
  { id: 'youtube', label: 'YouTube', url: 'https://www.youtube.com/@{handle}' },
  { id: 'linkedin', label: 'LinkedIn (person)', url: 'https://www.linkedin.com/in/{handle}' },
  { id: 'linkedin-company', label: 'LinkedIn (company)', url: 'https://www.linkedin.com/company/{handle}' },
  { id: 'telegram', label: 'Telegram', url: 'https://t.me/{handle}' },
] as const;

/** Limits shared by the form and the server, so the page never offers what the API refuses. */
export const QR_LIMITS = {
  url: 1000,
  text: 1500,
  ssid: 32,
  wifiPassword: 63,
  subject: 120,
  message: 500,
  eventTitle: 120,
  eventPlace: 120,
  eventNotes: 400,
  handle: 60,
  payeeName: 70,
  paymentReference: 35,
  paymentText: 140,
  /** The largest EPC QR payload, in bytes of UTF-8. */
  paymentBytes: 331,
} as const;
