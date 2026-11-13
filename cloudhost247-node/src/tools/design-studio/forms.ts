/**
 * Design Studio forms.
 *
 * One description of each tool's inputs, built from the same registries the server validates
 * against (symbologies, templates, stock sizes). The studio page renders it with sections, examples
 * and help that follows the selected template or barcode type; the Tools Center's generic tool page
 * and the embedded build render the flattened form. Either way the field names are the request
 * field names, so a form can never ask for something the API does not read.
 *
 * Pure data and pure functions: safe to import in the browser.
 */

import { SYMBOLOGIES, SYMBOLOGY_GROUPS, optionField, symbologyById, type Symbology } from './barcode/symbologies';
import {
  QR_CODE_TYPES,
  QR_CONTACT_FORMATS,
  QR_KINDS,
  QR_LIMITS,
  QR_MAP_FORMATS,
  QR_SOCIAL_PLATFORMS,
  QR_WIFI_SECURITY,
  CARD_CODES,
  CARD_FIELDS,
  CARD_LAYOUTS,
  CARD_PAYLOADS,
  CARD_SHEETS,
  CARD_SIZES,
  CUSTOM_STOCK_ID,
  CUSTOM_STOCK_LIMITS,
  LABEL_STOCKS,
  LABEL_TEMPLATES,
  SHIPPING_BARCODES,
  SHIPPING_FIELDS,
  SHIPPING_PACKAGE_LIMIT,
  SHIPPING_SHEETS,
  SHIPPING_SIZES,
  STUDIO_SLUGS,
  VDA_FIELDS,
  VDA_FORMATS,
  VDA_LABEL_TYPES,
  VDA_LANGUAGES,
  labelFieldUsage,
  labelStocksFor,
  shippingSheetsFor,
  type LabelTemplate,
  type StudioSlug,
} from './definitions';
import { LABEL_SHEETS } from './shared/sheets';

export interface StudioOption {
  value: string;
  label: string;
  /** Options sharing a group are shown under one heading. */
  group?: string;
}

/** What changes about a field when another field (the template, the barcode type) changes. */
export interface StudioFieldVariant {
  label?: string;
  help?: string;
  placeholder?: string;
  sample?: string;
  required?: boolean;
  maxLength?: number;
  /** Restrict a select to these option values. */
  options?: string[];
  defaultValue?: string;
  /** Position among the section's fields while this variant applies. */
  order?: number;
  /**
   * Examples that depend on a second field as well. A product label's example number has to suit
   * the barcode type chosen: thirteen digits are an EAN-13 but not a UPC-A.
   */
  sampleBy?: { field: string; by: Record<string, string> };
}

export interface StudioField {
  name: string;
  label: string;
  /** `date` holds year-month-day and `time` hours:minutes; a browser shows its own picker for each. */
  type: 'text' | 'textarea' | 'number' | 'decimal' | 'select' | 'checkbox' | 'color' | 'date' | 'time';
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: StudioOption[];
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
  rows?: number;
  defaultValue?: string | number | boolean;
  /** The value "Fill with an example" puts in the field. */
  sample?: string | boolean;
  /** Shown only while another field has one of these values. */
  showWhen?: { field: string; equals: string[] };
  variants?: { field: string; by: Record<string, StudioFieldVariant> };
  /** Takes half a row where the form is wide enough. */
  half?: boolean;
}

export interface StudioSection {
  id: string;
  title: string;
  description?: string;
  fields: StudioField[];
}

export interface StudioForm {
  slug: StudioSlug;
  /** Short name used on the tool switcher. */
  shortName: string;
  submitLabel: string;
  /** One or two sentences above the form: what the tool makes and how it is used. */
  intro: string;
  sections: StudioSection[];
}

export type StudioValues = Record<string, string | boolean>;

const option = (value: string, label: string, group?: string): StudioOption => ({ value, label, ...(group ? { group } : {}) });

/* ------------------------------------------------------------------ */
/* Barcode Generator                                                   */
/* ------------------------------------------------------------------ */

const groupLabel = (id: string): string => SYMBOLOGY_GROUPS.find((group) => group.id === id)?.label ?? id;

function symbologyIds(predicate: (symbology: Symbology) => boolean): string[] {
  return SYMBOLOGIES.filter(predicate).map((symbology) => symbology.id);
}

function symbologyOptionFields(): StudioField[] {
  const fields = new Map<string, StudioField>();
  for (const symbology of SYMBOLOGIES) {
    for (const entry of symbology.options ?? []) {
      const name = optionField(entry);
      const existing = fields.get(name);
      if (existing) {
        existing.showWhen?.equals.push(symbology.id);
        continue;
      }
      const base = { name, label: entry.label, showWhen: { field: 'symbology', equals: [symbology.id] }, half: true, ...(entry.help ? { help: entry.help } : {}) };
      if (entry.type === 'boolean') fields.set(name, { ...base, type: 'checkbox', defaultValue: entry.default === true });
      else if (entry.type === 'integer') fields.set(name, { ...base, type: 'number', defaultValue: Number(entry.default), ...(entry.min !== undefined ? { min: entry.min } : {}), ...(entry.max !== undefined ? { max: entry.max } : {}) });
      else fields.set(name, { ...base, type: 'select', defaultValue: String(entry.default), options: (entry.choices ?? []).map((choice) => option(choice.value, choice.label)) });
    }
  }
  return [...fields.values()];
}

const SHEET_OPTIONS: StudioOption[] = LABEL_SHEETS.map((sheet) => option(sheet.id, sheet.label, sheet.page.id === 'a4' ? 'A4 sheets' : 'US Letter sheets'));

const barcodeForm: StudioForm = {
  slug: STUDIO_SLUGS.barcode,
  shortName: 'Barcode Generator',
  submitLabel: 'Generate barcode',
  intro: 'Choose a barcode type, enter the data and download it as SVG, PNG or PDF. The vector files print at exactly the bar width you set.',
  sections: [
    {
      id: 'barcode',
      title: 'Barcode',
      fields: [
        {
          name: 'symbology',
          label: 'Barcode type',
          type: 'select',
          defaultValue: 'code128',
          options: SYMBOLOGIES.map((symbology) => option(symbology.id, symbology.name, groupLabel(symbology.group))),
          variants: { field: 'symbology', by: Object.fromEntries(SYMBOLOGIES.map((symbology) => [symbology.id, { help: symbology.summary }])) },
        },
        { name: 'series', label: 'Numbered series: count up instead of typing each value', type: 'checkbox', defaultValue: false },
        { name: 'seriesPrefix', label: 'Text before the number', type: 'text', maxLength: 40, half: true, placeholder: 'CH-', showWhen: { field: 'series', equals: ['true'] } },
        { name: 'seriesSuffix', label: 'Text after the number', type: 'text', maxLength: 40, half: true, showWhen: { field: 'series', equals: ['true'] } },
        { name: 'seriesStart', label: 'First number', type: 'number', min: 0, max: 999_999_999_999, defaultValue: 1, half: true, showWhen: { field: 'series', equals: ['true'] } },
        { name: 'seriesCount', label: 'How many', type: 'number', min: 1, max: 50, defaultValue: 10, half: true, help: 'Up to 50 barcodes in one go.', showWhen: { field: 'series', equals: ['true'] } },
        { name: 'seriesStep', label: 'Count up by', type: 'number', min: 1, max: 1_000_000, defaultValue: 1, half: true, showWhen: { field: 'series', equals: ['true'] } },
        { name: 'seriesDigits', label: 'Digits', type: 'number', min: 0, max: 20, defaultValue: 0, half: true, help: 'Pads the number with leading zeros: 4 turns 7 into 0007. Leave at 0 for no padding.', showWhen: { field: 'series', equals: ['true'] } },
        {
          name: 'data',
          label: 'Data to encode',
          type: 'textarea',
          rows: 3,
          required: true,
          showWhen: { field: 'series', equals: ['false'] },
          sample: symbologyById('code128')?.sample ?? '',
          variants: {
            field: 'symbology',
            by: Object.fromEntries(SYMBOLOGIES.map((symbology) => [symbology.id, { help: symbology.hint, placeholder: symbology.sample, sample: symbology.sample }])),
          },
        },
        { name: 'batch', label: 'Batch: make one barcode per line (up to 50 lines)', type: 'checkbox', defaultValue: false, showWhen: { field: 'series', equals: ['false'] } },
        ...symbologyOptionFields(),
      ],
    },
    {
      id: 'appearance',
      title: 'Size and appearance',
      fields: [
        {
          name: 'moduleMm',
          label: 'Module width (mm)',
          type: 'decimal',
          min: 0.05,
          max: 5,
          step: 0.01,
          half: true,
          help: 'The width of the narrowest bar, or of one cell in a 2D code. Leave empty for the usual size.',
          showWhen: { field: 'symbology', equals: symbologyIds((symbology) => symbology.sizing.mode === 'module') },
          variants: {
            field: 'symbology',
            by: Object.fromEntries(SYMBOLOGIES.filter((symbology) => symbology.sizing.mode === 'module').map((symbology) => [symbology.id, { placeholder: symbology.sizing.mode === 'module' ? String(symbology.sizing.defaultModuleMm) : '' }])),
          },
        },
        {
          name: 'barHeightMm',
          label: 'Bar height (mm)',
          type: 'decimal',
          min: 1,
          max: 100,
          step: 0.5,
          half: true,
          help: 'Leave empty for the usual height.',
          showWhen: { field: 'symbology', equals: symbologyIds((symbology) => symbology.barHeight !== undefined) },
          variants: {
            field: 'symbology',
            by: Object.fromEntries(SYMBOLOGIES.filter((symbology) => symbology.barHeight).map((symbology) => [symbology.id, { placeholder: String(symbology.barHeight?.defaultMm ?? '') }])),
          },
        },
        { name: 'showText', label: 'Print the human-readable text', type: 'checkbox', defaultValue: true, half: true, showWhen: { field: 'symbology', equals: symbologyIds((symbology) => symbology.text) } },
        { name: 'quietZone', label: 'Include the quiet zone', type: 'checkbox', defaultValue: true, half: true, help: 'The clear margin scanners need around the symbol.' },
        { name: 'rotation', label: 'Rotation', type: 'select', defaultValue: '0', half: true, options: [option('0', 'None'), option('90', '90° clockwise'), option('180', '180°'), option('270', '270° clockwise')] },
        { name: 'dpi', label: 'PNG resolution', type: 'select', defaultValue: '300', half: true, options: [option('203', '203 dpi (thermal printers)'), option('300', '300 dpi'), option('600', '600 dpi'), option('1200', '1200 dpi')] },
        { name: 'color', label: 'Bar colour', type: 'color', defaultValue: '#000000', half: true },
        { name: 'background', label: 'Background colour', type: 'color', defaultValue: '#ffffff', half: true },
        { name: 'transparent', label: 'Transparent background', type: 'checkbox', defaultValue: false },
      ],
    },
    {
      id: 'print',
      title: 'PDF layout',
      fields: [
        { name: 'sheet', label: 'Paper', type: 'select', defaultValue: 'none', options: [option('none', 'One barcode per page, at its exact size'), ...SHEET_OPTIONS] },
        { name: 'copies', label: 'Copies of each barcode', type: 'number', min: 1, max: 500, defaultValue: 1, half: true, showWhen: { field: 'sheet', equals: LABEL_SHEETS.map((sheet) => sheet.id) } },
      ],
    },
  ],
};

/* ------------------------------------------------------------------ */
/* Online Label Printing                                               */
/* ------------------------------------------------------------------ */

const sheetStockIds = LABEL_STOCKS.filter((stock) => stock.sheet).map((stock) => stock.id);

const stockOptions: StudioOption[] = [
  ...LABEL_STOCKS.map((stock) => {
    const sheet = stock.sheet ? LABEL_SHEETS.find((entry) => entry.id === stock.sheet) : undefined;
    return option(stock.id, stock.label, sheet ? (sheet.page.id === 'a4' ? 'A4 sheets' : 'US Letter sheets') : 'Single labels (label printers)');
  }),
  option(CUSTOM_STOCK_ID, 'Custom size…', 'Single labels (label printers)'),
];

/**
 * Examples for a template's barcode field, for the barcode types its own example does not suit.
 * The registry's shape check decides: where the template's example is not a valid input for a
 * barcode type the template offers (a retail code with a fixed number of digits), the example is
 * that barcode type's own.
 */
function codeSamples(template: LabelTemplate, sample: string): Record<string, string> {
  const samples: Record<string, string> = {};
  for (const id of template.symbologies) {
    const symbology = symbologyById(id);
    if (symbology?.pattern && !new RegExp(symbology.pattern).test(sample)) samples[id] = symbology.sample;
  }
  return samples;
}

function labelContentFields(): StudioField[] {
  return labelFieldUsage().map((usage) => {
    const first = usage.fields[0];
    const labels = [...new Set(usage.fields.map((field) => field.label.replace(/ \(optional\)$/, '')))];
    return {
      name: usage.name,
      label: labels.length === 1 ? (first?.label ?? usage.name) : labels.join(' / '),
      type: first?.type ?? 'text',
      rows: 3,
      showWhen: { field: 'template', equals: usage.templates },
      variants: {
        field: 'template',
        by: Object.fromEntries(
          usage.templates.map((templateId, index) => {
            const field = usage.fields[index];
            const template = LABEL_TEMPLATES.find((entry) => entry.id === templateId);
            const bySymbology = template && template.codeField === usage.name ? codeSamples(template, field?.sample ?? '') : {};
            return [
              templateId,
              {
                label: field?.label ?? usage.name,
                sample: field?.sample ?? '',
                placeholder: (field?.sample ?? '').split('\n')[0] ?? '',
                required: field?.required === true,
                maxLength: field?.maxLength ?? 60,
                order: template?.fields.findIndex((entry) => entry.name === usage.name) ?? 0,
                ...(field?.help ? { help: field.help } : {}),
                ...(Object.keys(bySymbology).length > 0 ? { sampleBy: { field: 'symbology', by: bySymbology } } : {}),
              },
            ];
          })
        ),
      },
    } satisfies StudioField;
  });
}

const labelSymbologies = [...new Set(LABEL_TEMPLATES.flatMap((template) => template.symbologies))];

const labelForm: StudioForm = {
  slug: STUDIO_SLUGS.labels,
  shortName: 'Label Printing',
  submitLabel: 'Generate labels',
  intro: 'Pick a label template, fill in its fields and print on sheet labels or a label printer. The PDF places every label at true size.',
  sections: [
    {
      id: 'template',
      title: 'Template and labels',
      fields: [
        {
          name: 'template',
          label: 'Template',
          type: 'select',
          defaultValue: 'asset-tag',
          options: LABEL_TEMPLATES.map((template) => option(template.id, template.name)),
          variants: { field: 'template', by: Object.fromEntries(LABEL_TEMPLATES.map((template) => [template.id, { help: template.summary }])) },
        },
        {
          name: 'stock',
          label: 'Label stock',
          type: 'select',
          defaultValue: 'a4-3x7-63x38',
          options: stockOptions,
          help: 'Match the measurements printed on your label pack.',
          // Only stock a template's layout fits is offered, so choosing a template never leads to a
          // refusal for size. A custom size is always offered and is checked when it is entered.
          variants: {
            field: 'template',
            by: Object.fromEntries(LABEL_TEMPLATES.map((template) => [template.id, { options: [...labelStocksFor(template).map((stock) => stock.id), CUSTOM_STOCK_ID], defaultValue: template.defaultStock }])),
          },
        },
        { name: 'widthMm', label: 'Label width (mm)', type: 'decimal', min: CUSTOM_STOCK_LIMITS.minWidth, max: CUSTOM_STOCK_LIMITS.maxWidth, step: 0.1, half: true, required: true, showWhen: { field: 'stock', equals: [CUSTOM_STOCK_ID] } },
        { name: 'heightMm', label: 'Label height (mm)', type: 'decimal', min: CUSTOM_STOCK_LIMITS.minHeight, max: CUSTOM_STOCK_LIMITS.maxHeight, step: 0.1, half: true, required: true, showWhen: { field: 'stock', equals: [CUSTOM_STOCK_ID] } },
      ],
    },
    {
      id: 'content',
      title: 'Label content',
      fields: [
        ...labelContentFields(),
        {
          name: 'symbology',
          label: 'Barcode type',
          type: 'select',
          defaultValue: 'code128',
          options: labelSymbologies.map((id) => option(id, symbologyById(id)?.name ?? id)),
          showWhen: { field: 'template', equals: LABEL_TEMPLATES.filter((template) => template.symbologies.length > 0).map((template) => template.id) },
          variants: {
            field: 'template',
            by: Object.fromEntries(LABEL_TEMPLATES.filter((template) => template.symbologies.length > 0).map((template) => [template.id, { options: [...template.symbologies], defaultValue: template.symbologies[0] ?? 'code128' }])),
          },
        },
      ],
    },
    {
      id: 'print',
      title: 'Quantity and printing',
      fields: [
        { name: 'copies', label: 'Number of labels', type: 'number', min: 1, max: 300, defaultValue: 1, half: true },
        { name: 'startPosition', label: 'Start at position', type: 'number', min: 1, max: 65, defaultValue: 1, half: true, help: 'For a part-used sheet: 1 is the top-left label, counting across each row.', showWhen: { field: 'stock', equals: sheetStockIds } },
        {
          name: 'numbering',
          label: 'Number the labels: add 1 to the value on each label',
          type: 'checkbox',
          defaultValue: false,
          showWhen: { field: 'template', equals: LABEL_TEMPLATES.filter((template) => template.numbering).map((template) => template.id) },
        },
        { name: 'border', label: 'Draw a border around each label', type: 'checkbox', defaultValue: false, half: true },
        { name: 'outlines', label: 'Print position outlines (for a test on plain paper)', type: 'checkbox', defaultValue: false, half: true, showWhen: { field: 'stock', equals: sheetStockIds } },
      ],
    },
  ],
};

/* ------------------------------------------------------------------ */
/* VDA 4902                                                            */
/* ------------------------------------------------------------------ */

function vdaField(number: number, extra: Partial<StudioField> = {}): StudioField {
  const field = VDA_FIELDS.find((entry) => entry.number === number);
  if (!field) throw new Error(`VDA field ${number} is not defined.`);
  return {
    name: field.name,
    label: `(${field.number}) ${field.label}`,
    type: field.type,
    rows: 3,
    maxLength: field.maxLength,
    sample: field.sample,
    placeholder: field.sample.split('\n')[0] ?? '',
    ...(field.required ? { required: true } : {}),
    ...(field.identifier ? { help: `Barcode data identifier ${field.number === 15 ? 'S, M or G' : field.identifier}. Digits, capital letters, space and - . $ / + %` } : {}),
    ...extra,
  };
}

const vdaForm: StudioForm = {
  slug: STUDIO_SLUGS.vda,
  shortName: 'VDA 4902',
  submitLabel: 'Generate label',
  intro: 'Fill in the sixteen fields of the VDA 4902 transport label and print it at A5 or KLT size, with Code 39 barcodes on the identifying fields.',
  sections: [
    {
      id: 'label',
      title: 'Label',
      fields: [
        { name: 'format', label: 'Format', type: 'select', defaultValue: 'a5', options: VDA_FORMATS.map((entry) => option(entry.id, entry.label)) },
        { name: 'labelType', label: 'Label type', type: 'select', defaultValue: 'S', options: VDA_LABEL_TYPES.map((entry) => option(entry.id, entry.label)) },
        { name: 'language', label: 'Caption language', type: 'select', defaultValue: 'en', half: true, options: VDA_LANGUAGES.map((entry) => option(entry.id, entry.label)) },
      ],
    },
    { id: 'parties', title: 'Receiver and supplier', fields: [vdaField(1), vdaField(2), vdaField(4), vdaField(12, { half: true })] },
    { id: 'delivery', title: 'Delivery', fields: [vdaField(3, { half: true }), vdaField(13, { half: true }), vdaField(5, { half: true }), vdaField(6, { half: true }), vdaField(7, { half: true })] },
    { id: 'part', title: 'Part', fields: [vdaField(8), vdaField(9, { half: true }), vdaField(14, { half: true }), vdaField(10), vdaField(11, { half: true }), vdaField(16, { half: true })] },
    {
      id: 'package',
      title: 'Package and printing',
      fields: [
        vdaField(15, { half: true }),
        { name: 'copies', label: 'Number of labels', type: 'number', min: 1, max: 100, defaultValue: 1, half: true },
        { name: 'numbering', label: 'Give each label the next package number', type: 'checkbox', defaultValue: true },
        { name: 'sheet', label: 'Print on A4 sheets (two A5 or four KLT labels per sheet)', type: 'checkbox', defaultValue: false },
      ],
    },
  ],
};

/* ------------------------------------------------------------------ */
/* Shipping labels                                                     */
/* ------------------------------------------------------------------ */

function shippingFields(group: 'from' | 'to' | 'shipment'): StudioField[] {
  return SHIPPING_FIELDS.filter((field) => field.group === group).map((field) => ({
    name: field.name,
    label: field.label,
    type: field.type,
    rows: field.maxLines ?? 3,
    maxLength: field.maxLength,
    sample: field.sample,
    placeholder: field.sample.split('\n')[0] ?? '',
    ...(field.required ? { required: true } : {}),
    ...(field.help ? { help: field.help } : {}),
    ...(field.type === 'text' && !['toName', 'toCompany', 'fromName', 'note', 'reference'].includes(field.name) ? { half: true } : {}),
  }));
}

const shippingForm: StudioForm = {
  slug: STUDIO_SLUGS.shipping,
  shortName: 'Shipping Labels',
  submitLabel: 'Generate labels',
  intro: 'Make carrier-neutral parcel labels with sender, recipient and a reference or SSCC barcode, one label per package, for label printers or plain sheets.',
  sections: [
    {
      id: 'label',
      title: 'Label',
      fields: [
        { name: 'size', label: 'Label size', type: 'select', defaultValue: '4x6', options: SHIPPING_SIZES.map((entry) => option(entry.id, entry.label)) },
        {
          name: 'sheet',
          label: 'Paper',
          type: 'select',
          defaultValue: 'none',
          options: SHIPPING_SHEETS.map((entry) => option(entry.id, entry.label)),
          // A label is never scaled to fit a sheet, so each size is offered only the sheets it fits.
          variants: { field: 'size', by: Object.fromEntries(SHIPPING_SIZES.map((size) => [size.id, { options: shippingSheetsFor(size.id), defaultValue: 'none' }])) },
        },
      ],
    },
    { id: 'from', title: 'From', fields: shippingFields('from') },
    { id: 'to', title: 'Ship to', fields: shippingFields('to') },
    {
      id: 'shipment',
      title: 'Shipment',
      fields: [...shippingFields('shipment'), { name: 'packages', label: 'Number of packages', type: 'number', min: 1, max: SHIPPING_PACKAGE_LIMIT, defaultValue: 1, half: true, help: 'One label is made for each package.' }],
    },
    {
      id: 'barcode',
      title: 'Barcode',
      fields: [
        { name: 'barcode', label: 'Main barcode', type: 'select', defaultValue: 'reference', options: SHIPPING_BARCODES.map((entry) => option(entry.id, entry.label)) },
        {
          name: 'sscc',
          label: 'First SSCC',
          type: 'text',
          maxLength: 30,
          required: true,
          sample: '09528765432101234',
          placeholder: '09528765432101234',
          help: '17 digits (the check digit is calculated) or all 18. Each further package gets the next number.',
          showWhen: { field: 'barcode', equals: ['sscc'] },
        },
        { name: 'postcodeBarcode', label: 'Also print the postal code as a barcode', type: 'checkbox', defaultValue: false },
      ],
    },
  ],
};

/* ------------------------------------------------------------------ */
/* Business cards                                                      */
/* ------------------------------------------------------------------ */

function cardFields(names: string[]): StudioField[] {
  return CARD_FIELDS.filter((field) => names.includes(field.name)).map((field) => ({
    name: field.name,
    label: field.label,
    type: 'text' as const,
    maxLength: field.maxLength,
    sample: field.sample,
    placeholder: field.sample,
    half: !['street', 'email', 'website'].includes(field.name),
    ...(field.required ? { required: true } : {}),
  }));
}

const cardForm: StudioForm = {
  slug: STUDIO_SLUGS.cards,
  shortName: 'QR Business Cards',
  submitLabel: 'Generate card',
  intro: 'Design a business card with a QR Code or Data Matrix that saves your contact details to a phone, and download it print-ready.',
  sections: [
    { id: 'person', title: 'Name and role', fields: cardFields(['firstName', 'lastName', 'jobTitle', 'organization']) },
    { id: 'contact', title: 'Contact', fields: cardFields(['email', 'phone', 'mobile', 'website']) },
    { id: 'address', title: 'Address', fields: cardFields(['street', 'city', 'region', 'postalCode', 'country']) },
    {
      id: 'design',
      title: 'Design',
      fields: [
        { name: 'layout', label: 'Layout', type: 'select', defaultValue: 'classic', options: CARD_LAYOUTS.map((entry) => option(entry.id, entry.label)) },
        { name: 'size', label: 'Card size', type: 'select', defaultValue: 'eu', options: CARD_SIZES.map((entry) => option(entry.id, entry.label)) },
        { name: 'accent', label: 'Accent colour', type: 'color', defaultValue: '#0f4c81', half: true },
        { name: 'code', label: 'Code type', type: 'select', defaultValue: 'qrcode', half: true, options: CARD_CODES.map((entry) => option(entry.id, entry.label)) },
        { name: 'payload', label: 'Contact format', type: 'select', defaultValue: 'vcard', options: CARD_PAYLOADS.map((entry) => option(entry.id, entry.label)) },
        {
          name: 'eclevel',
          label: 'QR error correction',
          type: 'select',
          defaultValue: 'M',
          half: true,
          options: [option('L', 'L: largest modules'), option('M', 'M: balanced'), option('Q', 'Q: more robust'), option('H', 'H: most robust, densest')],
          showWhen: { field: 'code', equals: ['qrcode'] },
        },
        { name: 'sheet', label: 'Paper', type: 'select', defaultValue: 'none', options: CARD_SHEETS.map((entry) => option(entry.id, entry.label)) },
      ],
    },
  ],
};

/* ------------------------------------------------------------------ */
/* QR Code Maker                                                       */
/* ------------------------------------------------------------------ */

/** A field of one kind of code: shown only while that kind is chosen. */
const forKind = (kind: string, field: StudioField): StudioField => ({ ...field, showWhen: { field: 'kind', equals: [kind] } });

const qrForm: StudioForm = {
  slug: STUDIO_SLUGS.qr,
  shortName: 'QR Code Maker',
  submitLabel: 'Make QR code',
  intro: 'Choose what the code should do when a phone scans it, fill in the details and download it as PNG, SVG or PDF. The code holds the content itself, so it never expires and nothing is tracked.',
  sections: [
    {
      id: 'kind',
      title: 'What the code does',
      fields: [{ name: 'kind', label: 'When someone scans it', type: 'select', defaultValue: 'url', options: QR_KINDS.map((entry) => option(entry.id, entry.label)) }],
    },
    {
      id: 'content',
      title: 'Details',
      fields: [
        forKind('url', { name: 'url', label: 'Web address', type: 'text', required: true, maxLength: QR_LIMITS.url, sample: 'https://cloudhost247.com', placeholder: 'https://example.com' }),
        forKind('text', { name: 'text', label: 'Text', type: 'textarea', rows: 4, required: true, maxLength: QR_LIMITS.text, sample: 'Thank you for visiting. Opening hours: Monday to Saturday, 8:00 to 18:00.' }),

        forKind('wifi', { name: 'ssid', label: 'Network name', type: 'text', required: true, maxLength: QR_LIMITS.ssid, sample: 'CloudHost247 Guest', help: 'Exactly as the router shows it, including capital letters.' }),
        forKind('wifi', { name: 'wifiSecurity', label: 'Security', type: 'select', defaultValue: 'WPA', half: true, options: QR_WIFI_SECURITY.map((entry) => option(entry.id, entry.label)) }),
        forKind('wifi', { name: 'wifiPassword', label: 'Password', type: 'text', maxLength: 64, half: true, sample: 'welcome-2026', help: 'Leave empty for an open network.' }),
        forKind('wifi', { name: 'wifiHidden', label: 'The network does not show its name (hidden network)', type: 'checkbox', defaultValue: false }),

        ...cardFields(['firstName', 'lastName', 'jobTitle', 'organization', 'email', 'phone', 'mobile', 'website', 'street', 'city', 'region', 'postalCode', 'country']).map((field) => forKind('contact', field)),
        forKind('contact', { name: 'contactFormat', label: 'Contact format', type: 'select', defaultValue: 'vcard', options: QR_CONTACT_FORMATS.map((entry) => option(entry.id, entry.label)) }),

        forKind('email', { name: 'emailTo', label: 'Send to', type: 'text', required: true, maxLength: 254, sample: 'support@cloudhost247.com', placeholder: 'name@example.com' }),
        forKind('email', { name: 'emailSubject', label: 'Subject', type: 'text', maxLength: QR_LIMITS.subject, sample: 'Question about hosting' }),
        forKind('email', { name: 'emailBody', label: 'Message', type: 'textarea', rows: 3, maxLength: QR_LIMITS.message, sample: 'Hello, I would like to know more about your plans.' }),

        forKind('phone', { name: 'phoneNumber', label: 'Phone number', type: 'text', required: true, maxLength: 40, sample: '+234 803 555 0142', placeholder: '+234 803 555 0142', help: 'Include the country code so the code works for visitors from abroad.' }),

        forKind('sms', { name: 'smsNumber', label: 'Phone number', type: 'text', required: true, maxLength: 40, sample: '+234 803 555 0142', placeholder: '+234 803 555 0142' }),
        forKind('sms', { name: 'smsMessage', label: 'Message', type: 'textarea', rows: 3, maxLength: QR_LIMITS.message, sample: 'Please call me back.' }),

        forKind('whatsapp', { name: 'whatsappNumber', label: 'WhatsApp number', type: 'text', required: true, maxLength: 40, sample: '+234 803 555 0142', placeholder: '+234 803 555 0142', help: 'In international format: the country code, then the number without its leading 0.' }),
        forKind('whatsapp', { name: 'whatsappMessage', label: 'Message to start with', type: 'textarea', rows: 3, maxLength: QR_LIMITS.message, sample: 'Hello, I scanned your code.' }),

        forKind('event', { name: 'eventTitle', label: 'Event name', type: 'text', required: true, maxLength: QR_LIMITS.eventTitle, sample: 'Customer open day' }),
        forKind('event', { name: 'eventStart', label: 'Start date', type: 'date', required: true, half: true, sample: '2026-12-12', placeholder: '2026-12-12' }),
        forKind('event', { name: 'eventStartTime', label: 'Start time', type: 'time', half: true, sample: '10:00', placeholder: '10:00', help: 'Leave empty for an all-day event.' }),
        forKind('event', { name: 'eventEnd', label: 'End date', type: 'date', half: true, sample: '2026-12-12', placeholder: '2026-12-12' }),
        forKind('event', { name: 'eventEndTime', label: 'End time', type: 'time', half: true, sample: '16:00', placeholder: '16:00' }),
        forKind('event', { name: 'eventPlace', label: 'Place', type: 'text', maxLength: QR_LIMITS.eventPlace, sample: '14 Ahmadu Bello Way, Jos' }),
        forKind('event', { name: 'eventNotes', label: 'Notes', type: 'textarea', rows: 2, maxLength: QR_LIMITS.eventNotes, sample: 'Refreshments provided.' }),

        forKind('location', { name: 'latitude', label: 'Latitude', type: 'decimal', required: true, min: -90, max: 90, step: 0.000001, half: true, sample: '9.896527', placeholder: '9.896527' }),
        forKind('location', { name: 'longitude', label: 'Longitude', type: 'decimal', required: true, min: -180, max: 180, step: 0.000001, half: true, sample: '8.858331', placeholder: '8.858331' }),
        forKind('location', { name: 'mapFormat', label: 'Format', type: 'select', defaultValue: 'link', options: QR_MAP_FORMATS.map((entry) => option(entry.id, entry.label)) }),

        forKind('social', { name: 'platform', label: 'Platform', type: 'select', defaultValue: 'facebook', half: true, options: QR_SOCIAL_PLATFORMS.map((entry) => option(entry.id, entry.label)) }),
        forKind('social', { name: 'handle', label: 'Profile name', type: 'text', required: true, maxLength: QR_LIMITS.handle + 1, half: true, sample: 'cloudhost247', placeholder: 'yourname', help: 'The name in the address of your profile page, with or without the @.' }),

        forKind('payment', { name: 'payeeName', label: 'Pay to (account holder)', type: 'text', required: true, maxLength: QR_LIMITS.payeeName, sample: 'Example Trading GmbH' }),
        forKind('payment', { name: 'iban', label: 'IBAN', type: 'text', required: true, maxLength: 42, sample: 'DE89 3704 0044 0532 0130 00', placeholder: 'DE89 3704 0044 0532 0130 00' }),
        forKind('payment', { name: 'bic', label: 'BIC', type: 'text', maxLength: 11, half: true, sample: 'COBADEFFXXX', help: 'Optional for payments inside the SEPA area.' }),
        forKind('payment', { name: 'amount', label: 'Amount in euros', type: 'decimal', min: 0.01, max: 999999999.99, step: 0.01, half: true, sample: '49.90', help: 'Leave empty to let the payer enter it.' }),
        forKind('payment', { name: 'paymentText', label: 'Message to the payee', type: 'text', maxLength: QR_LIMITS.paymentText, sample: 'Invoice 2026-0042' }),
        forKind('payment', { name: 'paymentReference', label: 'Payment reference', type: 'text', maxLength: QR_LIMITS.paymentReference, help: 'A structured reference such as RF18 5390 0754 7034. Use this or the message, not both.' }),
      ],
    },
    {
      id: 'code',
      title: 'Code',
      fields: [
        {
          name: 'codeType',
          label: 'Code type',
          type: 'select',
          defaultValue: 'qrcode',
          half: true,
          options: QR_CODE_TYPES.map((entry) => option(entry.id, entry.label)),
          help: 'QR Code is what phone cameras read without an app.',
          // A SEPA payment code is a QR Code by its standard.
          variants: { field: 'kind', by: { payment: { options: ['qrcode'], defaultValue: 'qrcode' } } },
        },
        {
          name: 'eclevel',
          label: 'Error correction',
          type: 'select',
          defaultValue: 'M',
          half: true,
          options: [option('L', 'L: largest squares'), option('M', 'M: balanced'), option('Q', 'Q: more robust'), option('H', 'H: most robust, densest')],
          help: 'Higher levels survive more damage and make the code denser.',
          showWhen: { field: 'codeType', equals: ['qrcode'] },
        },
        { name: 'moduleMm', label: 'Size of one square (mm)', type: 'decimal', min: 0.25, max: 3, step: 0.01, half: true, placeholder: '0.5', help: 'Leave empty for 0.5 mm. The result states the size of the whole code.' },
        { name: 'dpi', label: 'PNG resolution', type: 'select', defaultValue: '300', half: true, options: [option('203', '203 dpi (thermal printers)'), option('300', '300 dpi'), option('600', '600 dpi'), option('1200', '1200 dpi')] },
        { name: 'color', label: 'Code colour', type: 'color', defaultValue: '#000000', half: true },
        { name: 'background', label: 'Background colour', type: 'color', defaultValue: '#ffffff', half: true },
        { name: 'transparent', label: 'Transparent background', type: 'checkbox', defaultValue: false },
      ],
    },
  ],
};

/* ------------------------------------------------------------------ */
/* Registry and helpers                                                */
/* ------------------------------------------------------------------ */

export const STUDIO_FORMS: Record<StudioSlug, StudioForm> = {
  [STUDIO_SLUGS.barcode]: barcodeForm,
  [STUDIO_SLUGS.labels]: labelForm,
  [STUDIO_SLUGS.vda]: vdaForm,
  [STUDIO_SLUGS.shipping]: shippingForm,
  [STUDIO_SLUGS.cards]: cardForm,
  [STUDIO_SLUGS.qr]: qrForm,
};

export function studioForm(slug: string): StudioForm | undefined {
  return (STUDIO_FORMS as Record<string, StudioForm | undefined>)[slug];
}

export function studioFields(form: StudioForm): StudioField[] {
  return form.sections.flatMap((section) => section.fields);
}

function controllingValue(form: StudioForm, values: StudioValues, name: string): string {
  const raw = values[name];
  if (raw !== undefined && raw !== '') return String(raw);
  const controller = studioFields(form).find((field) => field.name === name);
  return controller?.defaultValue === undefined ? '' : String(controller.defaultValue);
}

export function isStudioFieldVisible(form: StudioForm, field: StudioField, values: StudioValues): boolean {
  if (!field.showWhen) return true;
  return field.showWhen.equals.includes(controllingValue(form, values, field.showWhen.field));
}

/** A field with the variant for the current form state folded in. */
export function resolveStudioField(form: StudioForm, field: StudioField, values: StudioValues): StudioField {
  if (!field.variants) return field;
  const variant = field.variants.by[controllingValue(form, values, field.variants.field)];
  if (!variant) return field;
  const { options: allowed, defaultValue, order: _order, sampleBy, ...rest } = variant;
  const sample = sampleBy?.by[controllingValue(form, values, sampleBy.field)];
  return {
    ...field,
    ...rest,
    ...(sample !== undefined ? { sample, placeholder: sample.split('\n')[0] ?? '' } : {}),
    ...(defaultValue !== undefined ? { defaultValue } : {}),
    ...(allowed && field.options ? { options: field.options.filter((entry) => allowed.includes(entry.value)) } : {}),
  };
}

/** A section's visible fields for the current state, resolved and in display order. */
export function visibleStudioFields(form: StudioForm, section: StudioSection, values: StudioValues): StudioField[] {
  return section.fields
    .map((field, index) => {
      const variant = field.variants?.by[controllingValue(form, values, field.variants.field)];
      return { field, index, order: variant?.order };
    })
    .filter((entry) => isStudioFieldVisible(form, entry.field, values))
    .sort((a, b) => {
      // Fields that carry an explicit order (a template's own content fields) come first, in that
      // order; everything else keeps its place in the section.
      if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
      if (a.order !== undefined) return -1;
      if (b.order !== undefined) return 1;
      return a.index - b.index;
    })
    .map((entry) => resolveStudioField(form, entry.field, values));
}

/** The form's starting state: every default, nothing else. */
export function studioDefaults(form: StudioForm): StudioValues {
  const values: StudioValues = {};
  for (const field of studioFields(form)) {
    if (field.type === 'checkbox') values[field.name] = field.defaultValue === true;
    else values[field.name] = field.defaultValue === undefined ? '' : String(field.defaultValue);
  }
  return values;
}

/**
 * Example content for the visible fields, keeping every choice the user has already made (template,
 * barcode type, sizes). Fields without an example are left as they are.
 */
export function studioExample(form: StudioForm, values: StudioValues): StudioValues {
  const next: StudioValues = { ...values };
  for (const field of studioFields(form)) {
    if (!isStudioFieldVisible(form, field, next)) continue;
    const resolved = resolveStudioField(form, field, next);
    if (resolved.sample !== undefined && resolved.type !== 'select') next[field.name] = resolved.sample;
  }
  return next;
}

/**
 * True while the form holds nothing but example content: at least one field shows its example and no
 * field shows anything else. Used to decide whether a change of template should bring its own
 * example with it or leave the user's work alone.
 */
export function isStudioExample(form: StudioForm, values: StudioValues): boolean {
  let examples = 0;
  for (const field of studioFields(form)) {
    if (!isStudioFieldVisible(form, field, values) || field.type === 'select' || field.type === 'checkbox') continue;
    const resolved = resolveStudioField(form, field, values);
    if (resolved.sample === undefined) continue;
    const current = values[field.name] ?? '';
    if (current === '') continue;
    if (current !== resolved.sample) return false;
    examples += 1;
  }
  return examples > 0;
}

/**
 * The state after one field changes.
 *
 * Changing the template or the barcode type changes what other fields mean, so three things follow
 * the change:
 *
 *  - a select whose current choice is no longer offered moves to the new default;
 *  - a select still on the old choice's default moves to the new choice's default, so picking the
 *    product label brings EAN-13 with it instead of keeping the asset tag's Code 128;
 *  - example content is replaced by the example for the new choice.
 *
 * A choice the user made that is still offered, and anything the user typed, are left alone.
 */
export function applyStudioChange(form: StudioForm, values: StudioValues, name: string, value: string | boolean): StudioValues {
  const wasExample = isStudioExample(form, values);
  const previous = controllingValue(form, values, name);
  const next: StudioValues = { ...values, [name]: value };
  let controls = false;
  for (const field of studioFields(form)) {
    if (!field.variants || field.name === name) continue;
    // A field whose example depends on the changed field (the barcode type) follows it too.
    if (Object.values(field.variants.by).some((variant) => variant.sampleBy?.field === name)) controls = true;
    if (field.variants.field !== name) continue;
    controls = true;
    if (field.type !== 'select') continue;
    const before = field.variants.by[previous];
    const after = field.variants.by[String(value)];
    const current = String(next[field.name] ?? '');
    if (after?.options && !after.options.includes(current)) {
      next[field.name] = after.defaultValue ?? after.options[0] ?? '';
    } else if (after?.defaultValue !== undefined && before?.defaultValue !== undefined && current === before.defaultValue) {
      next[field.name] = after.defaultValue;
    }
  }
  return controls && wasExample ? studioExample(form, next) : next;
}

/** The request body for the current state: visible fields only, numbers as numbers. */
export function buildStudioInput(form: StudioForm, values: StudioValues): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const field of studioFields(form)) {
    if (!isStudioFieldVisible(form, field, values)) continue;
    const value = values[field.name];
    if (field.type === 'checkbox') {
      input[field.name] = value === true;
      continue;
    }
    if (value === undefined || value === '') continue;
    if (field.type === 'number' || field.type === 'decimal') {
      const parsed = Number(String(value).replace(',', '.'));
      input[field.name] = Number.isFinite(parsed) ? parsed : value;
      continue;
    }
    input[field.name] = value;
  }
  return input;
}
