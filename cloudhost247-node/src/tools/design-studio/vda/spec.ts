/**
 * VDA-4902 — what this module implements, and what it does not.
 *
 * ## Why this file exists
 *
 * A label generator that renders something resembling a German automotive goods tag and calls it
 * "VDA 4902" is a liability: a supplier that prints it, ships a pallet to a plant and has the goods
 * rejected at goods-in has lost money and a delivery window. So the specification is written down
 * here, field by field, with the source it came from and its limitations attached — the same
 * discipline `docs/tools/README.md` imposes on the diagnostic tools ("a tool never invents a
 * result").
 *
 * ## What is implemented
 *
 * * **VDA Recommendation 4902, version 4 (September 1994) — the two published label sizes:**
 *   * the *master / main goods tag* at **210 × 148 mm** (A5), and
 *   * the *KLT label* (small load carrier) at **210 × 74 mm**.
 * * The field set those two sizes carry (1–15 on the master tag; the short form on the KLT label),
 *   the printed language of each field, and which fields are mandatory.
 * * The **PDF417** 2D code that version 4 introduced, carrying the shipping data (supplier, customer,
 *   delivery note, part number, quantity, dates) in the field-identifier form used by the GTL
 *   (Global Transport Label) structure that the recommendation's 2D content follows.
 * * A **Code 39** symbol for the delivery-note number, which is what the version-4 label carries as
 *   its linear code (`Code 39` is called out in supplier requirements that reference 4902, e.g. the
 *   Daimler Truck AKL fault handbook's reference to a "barcoded (Code 39) goods tag").
 *
 * ## What is NOT implemented, and why
 *
 * * **No certification.** Nothing here has been audited by the VDA, by a customer's logistics
 *   department, or by any third party. Resemblance to the standard is not compliance.
 * * **No 4902 version 3 / pre-1994 layouts.** The version number is a parameter with one supported
 *   value (`4`); asking for another is refused rather than drawn as "close enough".
 * * **No mixed-load or master-plus-single combinations beyond the two sizes above.** The mixed load
 *   label (field 8 carrying "Mischladung"/mixed load text) is supported as a *flag* that prints the
 *   marker; the layout is the master tag.
 * * **No ODETTE / VDA 4913 EDI transmission.** This module generates a printable label, not an EDI
 *   message.
 * * **No customer-specific additions.** Several vehicle manufacturers add fields or change
 *   dimensions in their own logistics manuals. Those manuals govern; a label that satisfies 4902 but
 *   not the plant's supplement is still rejected at goods-in.
 *
 * ## Verification status
 *
 * * **Implemented** — field definitions, the two sizes, PDF417 + Code 39 generation, validation.
 * * **Tested** — field validation, dimensional correctness (page size is asserted to the millimetre
 *   in the test suite), and the barcode payloads are decoded back out of the generated PDF.
 * * **Externally verified** — against the published field list and the two label sizes; see
 *   `VDA_SOURCES` below.
 * * **Certified** — *no.*
 */

export interface VdaSource {
  label: string;
  url: string;
  /** What this source was used for. */
  used: string;
  /** When the value was last checked against the source. */
  checked: string;
}

/**
 * The sources the field list and dimensions were taken from.
 *
 * Two independent documents agree on the sizes and the field numbering, and both are public: a
 * supplier's published supplement to 4902 (STIHL clearing centre) and a customer logistics standard
 * that quotes 4902 version 4. Neither publishes the 1994 VDA document itself, which is sold by the
 * VDA — so the *authoritative* text has not been read for this implementation, only sources that
 * quote it. That distinction is stated on the page rather than hidden.
 */
export const VDA_SOURCES: readonly VdaSource[] = [
  {
    label: 'VDA 4902 supplement (STIHL clearing centre, 2007) — field list and the two label sizes',
    url: 'https://www.stihl-clearingcenter.com/media/I_Supplementation_VDA4902_EN_2007_09_11.pdf',
    used: 'Fields 1–15 for the 210 × 148 mm master tag and the 210 × 74 mm KLT label; PDF417 for the 2D content; A5 as the standard goods tag.',
    checked: '2026-11-09',
  },
  {
    label: 'Vitesco Technologies TST N 3 9800.03 — marking of goods (VDA 4902 version 4, master 210 × 148 mm, KLT 210 × 74 mm)',
    url: 'https://www.vitesco-technologies.com/getmedia/b39840bf-e82a-4f2e-a1c1-3c5658da2742/TST-N-3-9800-03-000-03-Requirements-on-marking-of-goods.pdf',
    used: 'Confirmation of the two sizes, of the version number (4, September 1994) and of the mixed-load marker in field 8.',
    checked: '2026-11-09',
  },
  {
    label: 'Daimler Truck AG AKL fault description manual (2024) — Code 39 barcode height rules that reference 4902',
    url: 'https://docmaster.supplier.daimlertruck.com/DMPublic/en/doc/ALD12000341.2024-11.EN.pdf',
    used: 'Barcode height guidance (≈13 mm on the 148 mm tag, 6 mm on the KLT label) and the 3:1 narrow:wide ratio convention for Code 39.',
    checked: '2026-11-09',
  },
];

/** The only version this build renders. */
export const VDA_SUPPORTED_VERSION = '4';

/** Label formats published by version 4. */
export type VdaFormat = 'master' | 'klt';

export interface VdaFormatSpec {
  id: VdaFormat;
  name: string;
  widthMm: number;
  heightMm: number;
  description: string;
  /** Fields that appear on this format, in the printed order. */
  fields: number[];
  /** Minimum Code 39 bar height, in millimetres. */
  barcodeHeightMm: number;
}

export const VDA_FORMATS: readonly VdaFormatSpec[] = [
  {
    id: 'master',
    name: 'Master goods tag (210 × 148 mm)',
    widthMm: 210,
    heightMm: 148,
    description:
      'The A5 main goods tag used on packages and loading units. Carries the full field set and the PDF417 code.',
    fields: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    barcodeHeightMm: 13,
  },
  {
    id: 'klt',
    name: 'KLT label (210 × 74 mm)',
    widthMm: 210,
    heightMm: 74,
    description:
      'The small-load-carrier label for returnable containers in the VDA 4500 system. The receiver block is abbreviated and fields 12–15 are not printed.',
    fields: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    barcodeHeightMm: 6,
  },
];

export function vdaFormat(id: string): VdaFormatSpec | undefined {
  return VDA_FORMATS.find((format) => format.id === id);
}

/** What a field means, whether it is required, and what prints when it is empty. */
export interface VdaFieldSpec {
  /** The field number printed on the label (1–15 as published). */
  no: number;
  key: string;
  /** English label as printed. */
  label: string;
  /** The German label as published, because many plants read the German term. */
  german: string;
  required: boolean;
  /** Printed width, in characters at the template's font size — used by validation. */
  maxLength: number;
  /** Data type, for validation. */
  type: 'text' | 'number' | 'date' | 'integer';
  /** Which formats print it. */
  formats: VdaFormat[];
  /** Guidance shown in the form. */
  help: string;
  /** Two-letter ISO language copies the published layouts also carry; not printed by default. */
  note?: string;
}

/**
 * The field set.
 *
 * Order and numbering follow the published master tag: the receiver and plant at the top, then the
 * supplier block, then the delivery data, then the part/quantity block. The German column is
 * reproduced because a mismatch between the German term on a customer's sample and the English term
 * on ours is exactly how a supplier mis-fills a field.
 */
export const VDA_FIELDS: readonly VdaFieldSpec[] = [
  {
    no: 1, key: 'receiver', label: 'Goods receiver', german: 'Warenempfänger', required: true, maxLength: 60, type: 'text',
    formats: ['master', 'klt'], help: 'The customer company the goods are delivered to, exactly as it appears on the call-off.',
  },
  {
    no: 2, key: 'plant', label: 'Delivery plant', german: 'Lieferwerk / Abladestelle', required: true, maxLength: 40, type: 'text',
    formats: ['master', 'klt'], help: 'The plant or unloading point from the call-off data (e.g. “Plant D5”). Never leave this as the head-office address.',
  },
  {
    no: 3, key: 'supplier', label: 'Supplier', german: 'Lieferant', required: true, maxLength: 60, type: 'text',
    formats: ['master', 'klt'], help: 'Your company name as registered with the customer.',
  },
  {
    no: 4, key: 'supplierNumber', label: 'Supplier number', german: 'Lieferantennummer', required: true, maxLength: 20, type: 'text',
    formats: ['master', 'klt'], help: 'The customer-assigned supplier number. It is not your VAT number and not your own internal code.',
  },
  {
    no: 5, key: 'deliveryNote', label: 'Delivery note number', german: 'Lieferschein-Nr.', required: true, maxLength: 20, type: 'text',
    formats: ['master', 'klt'], help: 'The delivery note (despatch note) number. This is the number the receiving plant books against, and the value carried by the Code 39 symbol.',
  },
  {
    no: 6, key: 'deliveryNoteDate', label: 'Delivery note date', german: 'Lieferschein-Datum', required: true, maxLength: 10, type: 'date',
    formats: ['master', 'klt'], help: 'Date on the delivery note (YYYY-MM-DD).',
  },
  {
    no: 7, key: 'customerNumber', label: 'Customer number', german: 'Kundennummer', required: false, maxLength: 20, type: 'text',
    formats: ['master', 'klt'], help: 'The customer number, when it differs from the supplier number (i.e. your customer’s internal account code).',
  },
  {
    no: 8, key: 'partNumber', label: 'Part number', german: 'Sach-Nr. Kunde', required: true, maxLength: 35, type: 'text',
    formats: ['master', 'klt'], help: 'The customer’s part number exactly as issued. A mixed load unit prints “MIXED LOAD / Mischladung” in this field on the master tag.',
  },
  {
    no: 9, key: 'partDescription', label: 'Part description', german: 'Benennung', required: false, maxLength: 50, type: 'text',
    formats: ['master', 'klt'], help: 'The part name or short description, for people reading the label without a scanner.',
  },
  {
    no: 10, key: 'quantity', label: 'Quantity', german: 'Menge', required: true, maxLength: 12, type: 'number',
    formats: ['master', 'klt'], help: 'The quantity on this package or loading unit, in the unit of measure the customer specifies (usually pieces).',
  },
  {
    no: 11, key: 'unit', label: 'Unit of measure', german: 'Mengeneinheit', required: false, maxLength: 3, type: 'text',
    formats: ['master', 'klt'], help: 'The unit code for the quantity (e.g. PCE, KGM, LTR). Empty means pieces.',
  },
  {
    no: 12, key: 'purchaseOrder', label: 'Purchase order', german: 'Bestell-Nr.', required: false, maxLength: 20, type: 'text',
    formats: ['master'], help: 'The customer purchase order number, if it is not already implied by the call-off.',
  },
  {
    no: 13, key: 'deliveryDate', label: 'Delivery date', german: 'Liefertermin', required: false, maxLength: 10, type: 'date',
    formats: ['master'], help: 'The agreed delivery date (YYYY-MM-DD).',
  },
  {
    no: 14, key: 'batch', label: 'Batch / lot number', german: 'Charge / Los', required: false, maxLength: 20, type: 'text',
    formats: ['master'], help: 'Batch or lot number when the part is produced in batches.',
  },
  {
    no: 15, key: 'serial', label: 'Serial number', german: 'Serien-Nr.', required: false, maxLength: 20, type: 'text',
    formats: ['master'], help: 'Serial number where the part is serialised.',
  },
];

export function vdaField(key: string): VdaFieldSpec | undefined {
  return VDA_FIELDS.find((field) => field.key === key);
}

export function fieldsForFormat(format: VdaFormat): VdaFieldSpec[] {
  return VDA_FIELDS.filter((field) => field.formats.includes(format));
}

/**
 * The limitations stated on the tool page and in the API response.
 *
 * These are not fine print: a supplier must know that a generated label has not been validated
 * against their customer's supplement before a pallet leaves the yard.
 */
export const VDA_LIMITATIONS: readonly string[] = [
  'This tool has not been certified by the VDA or by any vehicle manufacturer. A label that resembles VDA 4902 is not thereby a compliant label.',
  'The VDA 4902 document itself (version 4, September 1994) is sold by the VDA and was not read for this implementation. Sizes, the version number and the field list were taken from public documents that quote it — see the sources list.',
  'Many vehicle manufacturers publish supplementary requirements (extra fields, changed positions, plant-specific codes). Those supplements govern; a label that satisfies 4902 alone can still be rejected at goods-in.',
  'Only the two version-4 sizes are rendered: the 210 × 148 mm master tag and the 210 × 74 mm KLT label. Versions 1–3 and custom sizes are refused rather than approximated.',
  'The PDF417 code carries the fields you enter, in the GTL-style identifier form described in this tool. Whether a specific plant accepts that content must be confirmed with the plant.',
  'No EDI message (VDA 4913 delivery note, VDA 4905 call-off) is produced. This is a printable label generator.',
];

/** Header the 2D content is preceded by, per the version-4 2D structure ("PDF Header and Trailer"). */
export const VDA_2D_HEADER = '[)>RTD4902';
/** Trailer, identical in form to the header's close. */
export const VDA_2D_TRAILER = '[)<RSV4902';

/**
 * Field identifiers used inside the PDF417 payload.
 *
 * The version-4 2D content carries the label data "in coded form" with each field preceded by an
 * identifier (the published example is `P` for the customer part number, `Q` for quantity, `K` for
 * order number, `16K` for the delivery note in the VDA 4913 style). The table below is what this
 * tool emits; it is documented so a receiving system can be checked against it, and it says plainly
 * that it is *this tool's* encoding of the published identifiers, not a proof of conformance.
 */
export const VDA_2D_IDENTIFIERS: Readonly<Record<string, { id: string; label: string }>> = {
  supplier: { id: 'L', label: 'Supplier number' },
  deliveryNote: { id: '16K', label: 'Delivery note number' },
  deliveryNoteDate: { id: 'D', label: 'Delivery note date (YYMMDD)' },
  customerNumber: { id: 'C', label: 'Customer number' },
  partNumber: { id: 'P', label: 'Customer part number' },
  quantity: { id: 'Q', label: 'Quantity' },
  unit: { id: 'U', label: 'Unit of measure' },
  plant: { id: 'W', label: 'Delivery plant' },
  purchaseOrder: { id: 'K', label: 'Order number' },
  deliveryDate: { id: 'T', label: 'Delivery date (YYMMDD)' },
  batch: { id: 'H', label: 'Batch / lot' },
  serial: { id: 'S', label: 'Serial number' },
};
