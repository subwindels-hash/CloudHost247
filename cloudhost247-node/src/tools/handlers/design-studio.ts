/**
 * Design Studio — HTTP handlers for the five generation tools.
 *
 * ## The shape of every response
 *
 * A design tool does not return one string: it returns a document the page can preview *and*
 * export. So every handler answers with the same envelope, whatever the tool:
 *
 * ```json
 * {
 *   "document":  { mode, widthMm, heightMm, ... },   // machine-readable model
 *   "svg":       "<svg …>",                          // the preview, and the SVG download
 *   "pdf":       "<base64>",                          // only when requested
 *   "png":       "<base64>",                          // only when requested
 *   "issues":    [{ level, field, message, hint }],   // errors block, warnings do not
 *   "summary":   ["…"],                              // the human-readable result panel
 *   "blocked":   false,
 *   "meta":      { … }                               // per-tool extras (payload, checks, layout)
 * }
 * ```
 *
 * ## Why generation is server-side
 *
 * The alternative — generate in the browser — would keep shipment and contact data out of the
 * request entirely. It is rejected for two concrete reasons: the encoder is BWIPP, which already
 * runs here and is the reason the symbols decode (see `design-studio/shared/barcode-engine.ts`), and
 * the print-accurate PDF needs `pdf-lib` at a known version. A second, browser-side implementation
 * would be a second set of bugs, and a mismatch between the preview and the printed PDF is exactly
 * the failure a print tool cannot have.
 *
 * What that costs is disclosed rather than hidden: none of these endpoints persists anything. The
 * bodies are processed in memory, nothing is logged (the route layer logs a slug and an outcome, not
 * a payload), and the results are never written to the report store — see
 * `NON_PERSISTABLE_TOOL_SLUGS` in `catalog.ts`.
 *
 * ## Limits
 *
 * Every handler clamps the fields it reads: a module width below 0.1 mm or above 5 mm, a label larger
 * than A2, more than 200 batch rows, a 2 MB CSV. A request that exceeds a limit is a 422 with the
 * limit in the message, not a silent truncation.
 */
import { invalidInput } from '../core/errors';
import type { ToolHandler } from './kit';
import { bool, maybeNum, maybeStr, oneOf, str, targetLabel } from './kit';
import { buildBarcodeDocument, barcodeSettingsFromInput, describeBarcode } from '../design-studio/barcode/generator';
import { BARCODE_FORMATS, findBarcodeFormat } from '../design-studio/shared/barcode-catalog';
import { renderDocumentSvg, renderPreviewSvg } from '../design-studio/shared/svg-renderer';
import { renderDocumentPdf } from '../design-studio/shared/pdf-renderer';
import type { DesignDocument } from '../design-studio/shared/draw-ops';
import { LABEL_TEMPLATES, buildLabelTemplate, searchLabelTemplates } from '../design-studio/labels/templates';
import { labelFitsPaper, layoutLabelDocument, layoutSingleLabelPage } from '../design-studio/labels/layout';
import type { LabelDocument } from '../design-studio/labels/model';
import { buildVdaLabel, describeVdaLabel } from '../design-studio/vda/generator';
import { vdaDataFromInput, DEFAULT_VDA_DATA, validateVdaData, type VdaData } from '../design-studio/vda/schema';
import { VDA_FIELDS, VDA_LIMITATIONS, VDA_SOURCES, VDA_SUPPORTED_VERSION } from '../design-studio/vda/spec';
import {
  SHIPPING_TEMPLATES,
  buildShippingTemplate,
  findShippingTemplate,
  shipmentValues,
  validateShipment,
  type ShipmentData,
  DEFAULT_SHIPMENT,
} from '../design-studio/shipping-labels/model';
import {
  CARD_FIELDS,
  CARD_TEMPLATES,
  DEFAULT_CONTACT,
  buildCardDocument,
  buildCardPayload,
  cardValues,
  findCardTemplate,
  validateContact,
  type CardContact,
  type CardPayloadFormat,
} from '../design-studio/business-cards/model';
import { parseCsv, processBatch, suggestMapping, toCsv, MAX_CSV_ROWS, csvTemplate } from '../design-studio/shared/csv';
import type { Issue } from '../design-studio/shared/validate';

/** Base64 for the binary exports. `Uint8Array` → standard base64, no data-URL prefix. */
function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/**
 * Which exports the client asked for.
 *
 * The SVG is always produced: it is the preview, and it is the only export that has to be correct for
 * the page to be usable. PNG/PDF cost real work, so they are opt-in per request.
 */
function exportOptions(input: Record<string, unknown>): { pdf: boolean; png: boolean; pngScale: number } {
  return {
    pdf: bool(input, 'pdf', false) || bool(input, 'includePdf', false),
    png: bool(input, 'png', false) || bool(input, 'includePng', false),
    // 300 dpi is the print default; the clamp keeps a huge sheet from allocating gigabytes.
    pngScale: Math.min(4, Math.max(0.5, maybeNum(input, 'pngScale', { min: 0.5, max: 4 }) ?? 1)),
  };
}

interface DocumentEnvelope {
  document: DesignDocument;
  issues: Issue[];
  blocked: boolean;
  summary: string[];
  meta?: Record<string, unknown>;
}

/**
 * Render a document into the common response envelope.
 *
 * PNG is rendered by rasterising the SVG at the requested scale, because the PDF/SVG are the
 * authoritative artefacts: a PNG produced any other way could differ from the print. The client is
 * told the pixel size so a download button can label it ("PNG, 1240 × 700 px at 300 dpi").
 */
async function envelope(input: Record<string, unknown>, built: DocumentEnvelope): Promise<Record<string, unknown>> {
  const exports = exportOptions(input);
  const svg = renderDocumentSvg(built.document);
  const page = built.document.pages[0];
  const widthMm = page?.width ?? 0;
  const heightMm = page?.height ?? 0;
  const response: Record<string, unknown> = {
    document: built.document,
    svg,
    // The preview is the first page only and drops the print metadata, so the page can embed it
    // without shipping the whole multi-page document to the browser twice.
    preview: page ? renderPreviewSvg(page) : svg,
    issues: built.issues,
    blocked: built.blocked,
    summary: built.summary,
    sizeMm: { width: widthMm, height: heightMm },
    sizePx: { width: Math.round(widthMm * 3.7795), height: Math.round(heightMm * 3.7795) },
    meta: built.meta ?? {},
  };
  if (exports.pdf) {
    response.pdf = toBase64(await renderDocumentPdf(built.document));
    response.pdfBase64 = true;
  }
  if (exports.png) {
    // The browser rasterises the SVG for the PNG download; the server tells it the pixel size and
    // the scale so the file it produces is the same sheet at the requested resolution.
    response.pngScale = exports.pngScale;
    response.pngPx = {
      width: Math.round(widthMm * 3.7795 * exports.pngScale),
      height: Math.round(heightMm * 3.7795 * exports.pngScale),
    };
  }
  return response;
}

/* ------------------------------------------------------------------ */
/* 1. Barcode Generator                                                */
/* ------------------------------------------------------------------ */

const barcodeGenerator: ToolHandler = async (input) => {
  const settings = barcodeSettingsFromInput(input);
  const result = buildBarcodeDocument(settings);
  const response = await envelope({ ...input, pdf: bool(input, 'pdf', true) }, {
    document: result.document,
    issues: result.issues,
    blocked: result.blocked,
    summary: describeBarcode(result),
    meta: {
      formatId: settings.formatId,
      formatName: findBarcodeFormat(settings.formatId)?.name ?? settings.formatId,
      payload: result.encoded.payload,
      xDimensionMm: result.encoded.xDimension * settings.moduleMm,
      moduleMm: settings.moduleMm,
      sizeMm: result.sizeMm,
      sizePx300: result.sizePx,
      formats: BARCODE_FORMATS.map((format) => ({
        id: format.id,
        name: format.name,
        family: format.family,
        useCase: format.useCase,
      })),
    },
  });
  return response;
};

/* ------------------------------------------------------------------ */
/* 2. Label Designer                                                   */
/* ------------------------------------------------------------------ */

/** Coerce a document coming from the editor. Only known fields survive; sizes are clamped. */
function labelDocumentFromInput(input: Record<string, unknown>): { document: LabelDocument; templateId: string } {
  const templateId = maybeStr(input, 'templateId', { max: 60 }) ?? 'blank-70x40';
  const base = buildLabelTemplate(templateId);
  if (!base) throw invalidInput(`"templateId" must be one of: ${LABEL_TEMPLATES.map((template) => template.id).join(', ')}.`);
  if (input.document && typeof input.document === 'object') {
    // A saved document is applied over its template so a template update cannot leave a stale id.
    const patch = input.document as Record<string, unknown>;
    if (typeof patch.name === 'string') base.name = patch.name.slice(0, 120);
    if (typeof patch.widthMm === 'number') base.widthMm = Math.min(420, Math.max(10, patch.widthMm));
    if (typeof patch.heightMm === 'number') base.heightMm = Math.min(594, Math.max(10, patch.heightMm));
    if (patch.orientation === 'portrait' || patch.orientation === 'landscape') base.orientation = patch.orientation;
    if (Array.isArray(patch.elements)) base.elements = patch.elements as LabelDocument['elements'];
    if (patch.values && typeof patch.values === 'object') base.values = patch.values as LabelDocument['values'];
    if (patch.style && typeof patch.style === 'object') base.style = { ...base.style, ...(patch.style as LabelDocument['style']) };
    if (patch.sheet && typeof patch.sheet === 'object') base.sheet = { ...base.sheet, ...(patch.sheet as LabelDocument['sheet']) };
  }
  return { document: base, templateId };
}

const labelDesigner: ToolHandler = async (input) => {
  const action = oneOf(input, 'action', ['templates', 'preview', 'validate', 'csv'] as const, { default: 'preview' });

  if (action === 'templates') {
    const results = searchLabelTemplates(maybeStr(input, 'q', { max: 80 }) ?? '');
    return {
      templates: results.map((template) => ({
        id: template.id,
        name: template.name,
        category: template.category,
        blurb: template.blurb,
        description: template.description,
        keywords: template.keywords,
        document: buildLabelTemplate(template.id),
      })),
      count: results.length,
    };
  }

  const { document } = labelDocumentFromInput(input);
  const fits = labelFitsPaper(document);

  if (action === 'csv') {
    // Column mapping and batch reporting. Rows are never dropped: every row comes back with a
    // verdict, and rejected rows are re-emitted as a CSV the operator can fix and re-import.
    const csvText = str(input, 'csv', { required: true, max: 2 * 1024 * 1024, trim: false });
    const parsed = parseCsv(csvText);
    const keys = document.elements
      .filter((element) => element.kind === 'field' || element.kind === 'barcode' || element.kind === 'symbol')
      .map((element) => (element as { binding?: { key?: string } }).binding?.key)
      .filter((key): key is string => typeof key === 'string');
    const suggestion = suggestMapping(keys, parsed.headers);
    const mapping = input.mapping && typeof input.mapping === 'object' ? (input.mapping as Record<string, string>) : suggestion.mapping;
    const batch = processBatch(parsed, mapping, (values) => {
      const issues: Issue[] = [];
      for (const key of keys) {
        if (!(key in mapping)) continue;
        if (!String(values[key] ?? '').trim()) {
          issues.push({ level: 'warn', field: key, message: `No value for “${key}” — that element will print empty on this label.` });
        }
      }
      return { issues };
    });
    const rejected = batch.results.filter((row) => !row.accepted);
    return {
      action,
      headers: parsed.headers,
      mapping,
      suggestion,
      rows: batch.results.map((row) => ({ line: row.line, values: row.values, accepted: row.accepted, issues: row.issues })),
      accepted: batch.accepted,
      rejected: batch.rejected,
      warnings: batch.warnings,
      capped: parsed.rows.length >= MAX_CSV_ROWS,
      rejectedCsv: rejected.length > 0 ? toCsv(['Line', 'Error', ...parsed.headers], rejected.map((row) => [
        row.line,
        row.issues.filter((issue) => issue.level === 'error').map((issue) => issue.message).join(' '),
        ...parsed.headers.map((header) => row.row[header] ?? ''),
      ])) : null,
      templateCsv: csvTemplate(keys),
    };
  }

  const rows = Array.isArray(input.rows)
    ? (input.rows as Array<Record<string, string>>).slice(0, MAX_CSV_ROWS)
    : [];
  const layout = rows.length > 0
    ? layoutLabelDocument(document, { rows })
    : bool(input, 'singlePage', false)
      ? layoutSingleLabelPage(document)
      : layoutLabelDocument(document);
  const issues: Issue[] = [...layout.issues];
  if (!fits) {
    issues.push({
      level: 'warn',
      field: 'sheet',
      message: 'The label is larger than the sheet it is assigned to. Choose a larger sheet, or print one label per page.',
    });
  }
  return envelope(input, {
    document: layout.document,
    issues,
    blocked: issues.some((issue) => issue.level === 'error'),
    summary: [
      `Label: ${layout.labelSize.width} × ${layout.labelSize.height} mm`,
      `Sheet: ${layout.paper.width} × ${layout.paper.height} mm, ${layout.perPage} label(s) per page`,
      `Labels in this run: ${layout.labels.length}`,
      `Pages: ${layout.document.pages.length}`,
    ],
    meta: {
      action,
      labelSize: layout.labelSize,
      paper: layout.paper,
      perPage: layout.perPage,
      labels: layout.labels.map((label) => ({ rowIndex: label.rowIndex, slot: label.slot, issues: label.issues })),
      templateId: document.templateId ?? null,
    },
  });
};

/* ------------------------------------------------------------------ */
/* 3. VDA 4902                                                         */
/* ------------------------------------------------------------------ */

/** Read the VDA fields from the request, ignoring anything unknown. */
function vdaDataFromRequest(input: Record<string, unknown>): VdaData {
  const data = input.data && typeof input.data === 'object' ? (input.data as Record<string, unknown>) : input;
  return vdaDataFromInput(data);
}

const vdaGenerator: ToolHandler = async (input) => {
  const action = oneOf(input, 'action', ['spec', 'preview'] as const, { default: 'preview' });
  if (action === 'spec') {
    return {
      version: VDA_SUPPORTED_VERSION,
      fields: VDA_FIELDS,
      limitations: VDA_LIMITATIONS,
      sources: VDA_SOURCES,
      defaults: DEFAULT_VDA_DATA,
    };
  }
  const data = vdaDataFromRequest(input);
  const result = buildVdaLabel(data);
  // The generator's own issues plus a second validation pass, so a caller that passes a hand-built
  // payload gets the same field-level report the page shows.
  const validation = validateVdaData(data);
  const issues: Issue[] = [...result.issues, ...validation.filter((issue) => !result.issues.some((existing) => existing.field === issue.field && existing.message === issue.message))];
  return envelope({ ...input, pdf: bool(input, 'pdf', true) }, {
    document: result.document,
    issues,
    blocked: result.blocked,
    summary: describeVdaLabel(result),
    meta: {
      formatId: result.formatId,
      sizeMm: result.sizeMm,
      payload2d: result.payload2d,
      linearValue: result.linearValue,
      version: VDA_SUPPORTED_VERSION,
      limitations: VDA_LIMITATIONS,
      fields: VDA_FIELDS.map((field) => ({ no: field.no, key: field.key, label: field.label, required: field.required })),
    },
  });
};

/* ------------------------------------------------------------------ */
/* 4. Shipping labels                                                  */
/* ------------------------------------------------------------------ */

function shipmentFromRequest(input: Record<string, unknown>): ShipmentData {
  const source = input.shipment && typeof input.shipment === 'object' ? (input.shipment as Record<string, unknown>) : input;
  const shipment: ShipmentData = { ...DEFAULT_SHIPMENT };
  for (const key of Object.keys(DEFAULT_SHIPMENT) as Array<keyof ShipmentData>) {
    const value = source[key];
    if (typeof value === 'string') shipment[key] = value.slice(0, 400);
  }
  return shipment;
}

const shippingLabelGenerator: ToolHandler = async (input) => {
  const action = oneOf(input, 'action', ['templates', 'preview'] as const, { default: 'preview' });
  if (action === 'templates') {
    return { templates: SHIPPING_TEMPLATES, defaultTemplate: 'thermal-100x150' };
  }
  const templateId = maybeStr(input, 'templateId', { max: 40 }) ?? 'thermal-100x150';
  const template = findShippingTemplate(templateId);
  if (!template) throw invalidInput(`"templateId" must be one of: ${SHIPPING_TEMPLATES.map((entry) => entry.id).join(', ')}.`);

  const shipment = shipmentFromRequest(input);
  const code = oneOf(input, 'code', ['code128', 'gs1-128', 'qrcode', 'datamatrix'] as const, { default: template.codes[0] ?? 'code128' });
  const shipmentIssues = validateShipment(shipment, { code });

  const base = buildShippingTemplate(templateId)!;
  base.values = { ...base.values, ...shipmentValues(shipment) };
  const layout = layoutLabelDocument(base);
  const issues: Issue[] = [
    ...shipmentIssues.map((issue) => ({ level: issue.level, field: issue.field, message: issue.message, hint: issue.hint })),
    ...layout.issues,
  ];
  return envelope({ ...input, pdf: bool(input, 'pdf', true) }, {
    document: layout.document,
    issues,
    blocked: issues.some((issue) => issue.level === 'error'),
    summary: [
      `Template: ${template.name}`,
      `Label: ${layout.labelSize.width} × ${layout.labelSize.height} mm`,
      `Reference: ${shipment.reference || '(missing)'}`,
      `Tracking number: ${shipment.trackingNumber || '(not supplied — the carrier assigns it)'}`,
      `Code: ${code}`,
    ],
    meta: {
      templateId,
      code,
      codeOptions: template.codes,
      trackingNumberSupplied: shipment.trackingNumber.trim() !== '',
      // Stated on every response, not just in the docs: this tool cannot issue a carrier's label.
      carrierNotice:
        'This is a carrier-neutral label. It does not carry carrier artwork or a carrier-issued tracking number, and it is not accepted by a carrier as its own label.',
    },
  });
};

/* ------------------------------------------------------------------ */
/* 5. QR Business Card                                                 */
/* ------------------------------------------------------------------ */

function contactFromRequest(input: Record<string, unknown>): CardContact {
  const source = input.contact && typeof input.contact === 'object' ? (input.contact as Record<string, unknown>) : input;
  const contact: CardContact = { ...DEFAULT_CONTACT };
  for (const key of Object.keys(DEFAULT_CONTACT) as Array<keyof CardContact>) {
    const value = source[key];
    if (typeof value === 'string') {
      if (key === 'logoDataUrl') {
        // A logo is a raster data URL only. SVG is refused outright: an SVG can carry script, and
        // this value is embedded straight into the rendered document.
        if (/^data:image\/(png|jpeg|webp|gif);base64,/i.test(value)) contact.logoDataUrl = value;
      } else {
        contact[key] = value.slice(0, 300);
      }
    }
  }
  return contact;
}

const businessCardDesigner: ToolHandler = async (input) => {
  const action = oneOf(input, 'action', ['templates', 'payload', 'preview'] as const, { default: 'preview' });
  if (action === 'templates') {
    return { templates: CARD_TEMPLATES, fields: CARD_FIELDS, defaultTemplate: 'classic-white' };
  }
  const contact = contactFromRequest(input);
  const payloadFormat = oneOf(input, 'payloadFormat', ['vcard', 'mecard'] as const, { default: 'vcard' }) as CardPayloadFormat;

  if (action === 'payload') {
    const payload = buildCardPayload(contact, payloadFormat);
    return {
      payload,
      issues: validateContact(contact, { format: payloadFormat }).map((issue) => ({ ...issue })),
    };
  }

  const templateId = maybeStr(input, 'templateId', { max: 40 }) ?? 'classic-white';
  const template = findCardTemplate(templateId);
  if (!template) throw invalidInput(`"templateId" must be one of: ${CARD_TEMPLATES.map((entry) => entry.id).join(', ')}.`);
  const side = oneOf(input, 'side', ['front', 'back', 'both'] as const, { default: 'both' });
  const contactIssues = validateContact(contact, { format: payloadFormat });

  const sides = side === 'both' ? (['front', 'back'] as const) : ([side] as const);
  const pages = sides.map((entry) => buildCardDocument(templateId, entry, contact)!);
  // Front and back are one printable document: the page can export them as one PDF with two pages.
  const document: DesignDocument = {
    title: `${template.name} — ${contact.firstName} ${contact.lastName}`.trim(),
    subject: 'QR business card generated by CloudHost247 Design Studio',
    creator: 'CloudHost247 Design Studio',
    pages: pages.flatMap((page, index) => pageDocumentPages(page, index, page.name)),
    warnings: contactIssues.filter((issue) => issue.level === 'warn').map((issue) => issue.message),
  };
  const cardValues_ = cardValues(contact, payloadFormat);
  const issues: Issue[] = contactIssues.map((issue) => ({ level: issue.level, field: issue.field, message: issue.message, hint: issue.hint }));
  for (const page of pages) issues.push(...layoutLabelDocument(page).issues);
  return envelope({ ...input, pdf: bool(input, 'pdf', true) }, {
    document,
    issues,
    blocked: issues.some((issue) => issue.level === 'error'),
    summary: [
      `Template: ${template.name} (${template.sizeMm.width} × ${template.sizeMm.height} mm)`,
      `Sides: ${sides.join(' + ')}`,
      `Payload: ${payloadFormat === 'vcard' ? 'vCard 3.0' : 'MeCard'}, ${(cardValues_.qr ?? '').length} characters`,
    ],
    meta: {
      templateId,
      side,
      payload: buildCardPayload(contact, payloadFormat),
      values: cardValues_,
      // Front/back are described explicitly so the page can offer two downloads without guessing.
      sides: sides.map((entry) => ({ side: entry, sizeMm: template.sizeMm })),
    },
  });
};

/** Turn a label document's single page into design-document pages (card documents are one page each). */
function pageDocumentPages(label: LabelDocument, index: number, name: string) {
  const layout = layoutLabelDocument({
    ...label,
    sheet: { ...label.sheet, paperId: 'custom', customWidth: label.widthMm, customHeight: label.heightMm, columns: 1, rows: 1, marginMm: 0, gutterMm: 0 },
  });
  return layout.document.pages.map((page) => ({ ...page, label: `${name} ${index + 1}` }));
}

export const designStudioHandlers: Record<string, ToolHandler> = {
  'barcode-generator': barcodeGenerator,
  'label-designer': labelDesigner,
  'vda-4902-label-generator': vdaGenerator,
  'shipping-label-generator': shippingLabelGenerator,
  'qr-business-card-designer': businessCardDesigner,
};

/**
 * Audit targets.
 *
 * Deliberately coarse: a tool-history row records that a label was generated, for which template and
 * with which reference — never the addresses, the contact details or the CSV. The whole point of
 * these tools is that the data does not outlive the request.
 */
export const designStudioTargets: Record<string, (input: Record<string, unknown>) => string | null> = {
  'barcode-generator': (input) => targetLabel(typeof input.payload === 'string' ? `${input.formatId ?? 'barcode'} ${input.payload.slice(0, 40)}` : null),
  'label-designer': (input) => targetLabel(typeof input.templateId === 'string' ? `label ${input.templateId}` : 'label'),
  'vda-4902-label-generator': (input) => {
    const data = input.data && typeof input.data === 'object' ? (input.data as Record<string, unknown>) : input;
    return targetLabel(typeof data.deliveryNote === 'string' ? `VDA 4902 ${data.deliveryNote.slice(0, 40)}` : 'VDA 4902 label');
  },
  'shipping-label-generator': (input) => targetLabel(typeof input.templateId === 'string' ? `shipping ${input.templateId}` : 'shipping label'),
  'qr-business-card-designer': (input) => targetLabel(typeof input.templateId === 'string' ? `card ${input.templateId}` : 'business card'),
};
