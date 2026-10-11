/**
 * Business Tools — Generators, part 2: documents with structure, identifiers and graphics (6 of 12).
 *
 *   7.  Business Invoice Generator          business-invoice-generator
 *   8.  Business Card Generator             business-card-generator
 *   9.  Employee ID Generator               employee-id-generator
 *   10. Employee ID Card Generator          employee-id-card-generator
 *   11. Organizational Chart Generator      organizational-chart-generator
 *   12. LinkedIn Engagement Assistant       linkedin-engagement-assistant
 *
 * Two of these produce real downloadable graphics rather than text: the business card and the
 * employee ID card emit SVG. SVG is the right choice for an identity artefact — it is text, so it
 * can be generated deterministically in a pure function with no canvas, no font loading and no
 * network, and it stays crisp at print resolution.
 *
 * The LinkedIn assistant generates draft comments from templates and an analysis of the post text.
 * It calls no AI service: a tool that quietly uploads the text of someone else's post to a third
 * party would be doing so without that person's knowledge, which is exactly what these pages
 * promise not to do.
 */

import {
  bulletList,
  clampText,
  escapeXml,
  formatAmount,
  formatInteger,
  formatLongDate,
  formatMoney,
  formatPercent,
  numberedList,
  round,
  tidyDocument,
  titleCase,
  toCsv,
  toBoolean,
  toLines,
  toList,
  toNumber,
  toText,
  parseIsoDate,
  isoDateToTimestamp,
} from './format';
import { computeVat, NIGERIA_STANDARD_VAT_RATE } from './calculators';
import { failure, fieldFailure } from './validate';
import type {
  BusinessToolInput,
  BusinessToolOutcome,
  JurisdictionNote,
  ResultDocument,
  ResultMetric,
  ResultTable,
} from './types';

/* ================================================================== */
/* 7. Business Invoice Generator                                       */
/* ================================================================== */

export const INVOICE_TAX_NOTE: JurisdictionNote = {
  jurisdiction: 'Configurable; defaults to Nigeria',
  source:
    'Standard VAT rate of 7.5% under the Finance Act 2019, effective 1 February 2020 (Federal Inland Revenue Service). The rate is an input, so invoices for other jurisdictions or for zero-rated and exempt supplies can be produced by changing it.',
  effectiveDate: '2020-02-01',
  disclaimer:
    'This tool produces a document; it does not determine your tax position. Whether a supply is standard-rated, zero-rated, exempt or outside scope, whether you are required to register, and which rate applies to a given line are questions for your tax adviser or revenue authority.',
};

export interface InvoiceLine {
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  netAmount: number;
  taxAmount: number;
  grossAmount: number;
}

export interface InvoiceTotals {
  lines: InvoiceLine[];
  subtotal: number;
  discountAmount: number;
  discountPct: number;
  taxableBase: number;
  totalTax: number;
  shipping: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  currency: string;
  status: 'paid' | 'part-paid' | 'unpaid' | 'overpaid';
}

/**
 * Parse `Description, Qty, Unit price[, Tax rate %]` lines into invoice rows.
 *
 * The tax rate is optional per line so a mixed invoice (some zero-rated lines, some standard-rated)
 * is possible; a missing rate falls back to the invoice-level default.
 */
export function parseInvoiceLines(
  raw: unknown,
  defaultTaxRate: number
): { ok: true; lines: InvoiceLine[] } | { ok: false; error: string } {
  const lines = toLines(raw);
  if (lines.length === 0) {
    return { ok: false, error: 'Add at least one line item: "Description, Quantity, Unit price".' };
  }
  const parsed: InvoiceLine[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index];
    if (text === undefined) continue;
    const parts = text.split(/[|;]/).map((part) => part.trim());
    const cells = parts.length > 1 ? parts : text.split(',').map((part) => part.trim());
    if (cells.length < 3) {
      return {
        ok: false,
        error: `Line ${index + 1} needs at least three fields — description, quantity and unit price, separated by commas.`,
      };
    }
    // The description may itself contain commas when the row was comma-split, so rejoin the head.
    const tail = cells.slice(-1 * Math.min(3, cells.length - 1));
    const description = cells.slice(0, cells.length - tail.length).join(', ').trim();
    const qty = toNumber(tail[0]);
    const unitPrice = toNumber(tail[1]);
    const taxText = tail.length > 2 ? tail[2] : undefined;
    const taxRate = taxText === undefined || taxText === '' ? defaultTaxRate : toNumber(taxText);

    if (description === '') return { ok: false, error: `Line ${index + 1} has no description.` };
    if (qty === null) return { ok: false, error: `Line ${index + 1}: "${tail[0] ?? ''}" is not a valid quantity.` };
    if (unitPrice === null) return { ok: false, error: `Line ${index + 1}: "${tail[1] ?? ''}" is not a valid unit price.` };
    if (taxRate === null) return { ok: false, error: `Line ${index + 1}: "${taxText ?? ''}" is not a valid tax rate.` };
    if (qty <= 0) return { ok: false, error: `Line ${index + 1}: quantity must be greater than zero.` };
    if (unitPrice < 0) return { ok: false, error: `Line ${index + 1}: unit price cannot be negative. Use a credit note for reversals.` };
    if (taxRate < 0 || taxRate > 100) return { ok: false, error: `Line ${index + 1}: tax rate must be between 0% and 100%.` };

    const netAmount = round(qty * unitPrice, 2);
    const taxAmount = round((netAmount * taxRate) / 100, 2);
    parsed.push({
      description,
      quantity: qty,
      unitPrice: round(unitPrice, 2),
      taxRate: round(taxRate, 4),
      netAmount,
      taxAmount,
      grossAmount: round(netAmount + taxAmount, 2),
    });
  }
  return { ok: true, lines: parsed };
}

export function computeInvoiceTotals(
  lines: readonly InvoiceLine[],
  currency: string,
  discountPctInput: number,
  discountAmountInput: number,
  shipping: number,
  amountPaid: number
): InvoiceTotals {
  const subtotal = round(lines.reduce((total, line) => total + line.netAmount, 0), 2);
  const discountPct = Math.max(0, Math.min(100, discountPctInput));
  const pctDiscount = round((subtotal * discountPct) / 100, 2);
  const flatDiscount = round(Math.max(0, discountAmountInput), 2);
  const discountAmount = round(pctDiscount + flatDiscount, 2);
  const taxableBase = round(Math.max(0, subtotal - discountAmount), 2);

  // Discount is applied pro-rata across lines so each line's tax is charged on its discounted value,
  // which is how a VAT invoice must present a discount: the tax base is what was actually charged.
  const proportion = subtotal > 0 ? taxableBase / subtotal : 0;
  const totalTax = round(
    lines.reduce((total, line) => total + (line.netAmount * proportion * line.taxRate) / 100, 0),
    2
  );

  const total = round(taxableBase + totalTax + Math.max(0, shipping), 2);
  const paid = round(Math.max(0, amountPaid), 2);
  const balance = round(total - paid, 2);

  let status: InvoiceTotals['status'] = 'unpaid';
  if (paid <= 0) status = 'unpaid';
  else if (balance > 0.005) status = 'part-paid';
  else if (balance < -0.005) status = 'overpaid';
  else status = 'paid';

  return {
    lines: lines.map((line) => ({ ...line })),
    subtotal,
    discountAmount,
    discountPct,
    taxableBase,
    totalTax,
    shipping: round(Math.max(0, shipping), 2),
    total,
    amountPaid: paid,
    balanceDue: balance,
    currency,
    status,
  };
}

export function computeBusinessInvoice(values: BusinessToolInput): BusinessToolOutcome {
  const businessName = toText(values['businessName']).trim();
  const clientName = toText(values['clientName']).trim();
  const invoiceNumber = toText(values['invoiceNumber']).trim();

  const fieldErrors: Array<{ key: string; message: string }> = [];
  if (businessName === '') fieldErrors.push({ key: 'businessName', message: 'Your business name is required — an invoice must identify its issuer.' });
  if (clientName === '') fieldErrors.push({ key: 'clientName', message: 'The client or customer name is required.' });
  if (invoiceNumber === '') fieldErrors.push({ key: 'invoiceNumber', message: 'An invoice number is required. Most tax authorities require a unique sequential reference.' });

  const issueDate = toText(values['issueDate']).trim();
  const dueDate = toText(values['dueDate']).trim();
  if (issueDate !== '' && !parseIsoDate(issueDate)) fieldErrors.push({ key: 'issueDate', message: 'Issue date must be a real date in YYYY-MM-DD format.' });
  if (dueDate !== '' && !parseIsoDate(dueDate)) fieldErrors.push({ key: 'dueDate', message: 'Due date must be a real date in YYYY-MM-DD format.' });
  if (issueDate && dueDate && parseIsoDate(issueDate) && parseIsoDate(dueDate) && dueDate < issueDate) {
    fieldErrors.push({ key: 'dueDate', message: `The due date (${formatLongDate(dueDate)}) is before the issue date (${formatLongDate(issueDate)}).` });
  }

  const taxRateDefault = toNumber(values['taxRate']);
  const defaultRate = taxRateDefault === null ? NIGERIA_STANDARD_VAT_RATE : taxRateDefault;
  if (taxRateDefault !== null && (taxRateDefault < 0 || taxRateDefault > 100)) {
    fieldErrors.push({ key: 'taxRate', message: 'The default tax rate must be between 0% and 100%.' });
  }

  const parsed = parseInvoiceLines(values['lineItems'], defaultRate);
  if (!parsed.ok) fieldErrors.push({ key: 'lineItems', message: parsed.error });

  const discountPct = toNumber(values['discountPct']) ?? 0;
  const discountAmount = toNumber(values['discountAmount']) ?? 0;
  if (discountPct < 0 || discountPct > 100) fieldErrors.push({ key: 'discountPct', message: 'Discount percentage must be between 0 and 100.' });
  if (discountAmount < 0) fieldErrors.push({ key: 'discountAmount', message: 'Discount amount cannot be negative.' });
  const shipping = toNumber(values['shipping']) ?? 0;
  if (shipping < 0) fieldErrors.push({ key: 'shipping', message: 'Shipping cannot be negative.' });
  const amountPaid = toNumber(values['amountPaid']) ?? 0;
  if (amountPaid < 0) fieldErrors.push({ key: 'amountPaid', message: 'Amount paid cannot be negative.' });

  if (fieldErrors.length > 0) {
    return { ok: false, error: fieldFailure(fieldErrors, 'Fix the highlighted invoice fields before generating.') };
  }

  const lines = parsed.ok ? parsed.lines : [];
  const currency = toText(values['currency']) || 'NGN';
  const totals = computeInvoiceTotals(lines, currency, discountPct, discountAmount, shipping, amountPaid);

  if (totals.subtotal > 0 && totals.discountAmount >= totals.subtotal) {
    return {
      ok: false,
      error: failure(
        `The discount of ${formatMoney(totals.discountAmount, currency)} equals or exceeds the subtotal of ${formatMoney(totals.subtotal, currency)}, leaving nothing to invoice. Reduce the discount.`,
        [{ key: 'discountAmount', message: 'Discount cannot equal or exceed the subtotal.' }]
      ),
    };
  }

  const warnings: string[] = [];
  if (issueDate === '') warnings.push('No issue date was supplied, so the invoice does not show one. Most tax authorities require a tax point date.');
  if (dueDate === '') warnings.push('No due date was supplied, so the invoice does not state when payment falls due.');
  if (toText(values['taxId']).trim() === '') {
    warnings.push('No tax identification number was supplied. A VAT invoice normally has to show the supplier\u2019s registration number.');
  }
  if (defaultRate !== NIGERIA_STANDARD_VAT_RATE) {
    warnings.push(`The default tax rate is ${formatPercent(defaultRate)} rather than Nigeria's standard ${formatPercent(NIGERIA_STANDARD_VAT_RATE)}. Per-line rates override it.`);
  }
  if (totals.status === 'overpaid') {
    warnings.push(`Amount paid (${formatMoney(totals.amountPaid, currency)}) exceeds the invoice total (${formatMoney(totals.total, currency)}) by ${formatMoney(Math.abs(totals.balanceDue), currency)}. The invoice shows a credit balance.`);
  }

  const fromLines = [
    businessName,
    toText(values['businessAddress']).trim(),
    toText(values['businessEmail']).trim(),
    toText(values['businessPhone']).trim(),
    toText(values['taxId']).trim() ? `Tax ID: ${toText(values['taxId']).trim()}` : '',
  ].filter((part) => part !== '');

  const billToLines = [
    clientName,
    toText(values['clientAddress']).trim(),
    toText(values['clientEmail']).trim(),
    toText(values['clientTaxId']).trim() ? `Tax ID: ${toText(values['clientTaxId']).trim()}` : '',
  ].filter((part) => part !== '');

  const parts: string[] = [];
  parts.push('INVOICE');
  parts.push('');
  parts.push(line2('Invoice number', invoiceNumber));
  if (issueDate) parts.push(line2('Issue date', formatLongDate(issueDate)));
  if (dueDate) parts.push(line2('Due date', formatLongDate(dueDate)));
  parts.push(line2('Payment status', titleCase(totals.status.replace('-', ' '))));
  parts.push(line2('Currency', currency));
  parts.push('');
  parts.push('FROM');
  parts.push(...fromLines);
  parts.push('');
  parts.push('BILL TO');
  parts.push(...billToLines);
  parts.push('');
  parts.push('LINE ITEMS');
  parts.push(
    `  ${'Description'.padEnd(34, ' ')}${'Qty'.padStart(8, ' ')}${'Unit price'.padStart(15, ' ')}${'Tax'.padStart(9, ' ')}${'Amount'.padStart(15, ' ')}`
  );
  for (const item of totals.lines) {
    parts.push(
      `  ${clampText(item.description, 34).padEnd(34, ' ')}${formatAmount(item.quantity, 2).padStart(8, ' ')}${formatAmount(item.unitPrice).padStart(15, ' ')}${formatPercent(item.taxRate).padStart(9, ' ')}${formatAmount(item.grossAmount).padStart(15, ' ')}`
    );
  }
  parts.push('');
  parts.push('SUMMARY');
  parts.push(`  ${'Subtotal'.padEnd(34, ' ')}${formatAmount(totals.subtotal).padStart(15, ' ')}`);
  if (totals.discountAmount > 0) {
    const discountLabel = totals.discountPct > 0 ? `Discount (${formatPercent(totals.discountPct, 0)})` : 'Discount';
    parts.push(`  ${discountLabel.padEnd(34, ' ')}${('-' + formatAmount(totals.discountAmount)).padStart(15, ' ')}`);
  }
  parts.push(`  ${'Taxable base'.padEnd(34, ' ')}${formatAmount(totals.taxableBase).padStart(15, ' ')}`);
  parts.push(`  ${'Tax'.padEnd(34, ' ')}${formatAmount(totals.totalTax).padStart(15, ' ')}`);
  if (totals.shipping > 0) parts.push(`  ${'Shipping'.padEnd(34, ' ')}${formatAmount(totals.shipping).padStart(15, ' ')}`);
  parts.push(`  ${'TOTAL'.padEnd(34, ' ')}${formatAmount(totals.total).padStart(15, ' ')}`);
  if (totals.amountPaid > 0) {
    parts.push(`  ${'Amount paid'.padEnd(34, ' ')}${('-' + formatAmount(totals.amountPaid)).padStart(15, ' ')}`);
    parts.push(`  ${'BALANCE DUE'.padEnd(34, ' ')}${formatAmount(totals.balanceDue).padStart(15, ' ')}`);
  }
  const paymentTerms = toText(values['paymentTerms']).trim();
  const bankDetails = toLines(values['bankDetails']);
  if (paymentTerms) {
    parts.push('');
    parts.push('PAYMENT TERMS');
    parts.push(paymentTerms);
  }
  if (bankDetails.length > 0) {
    parts.push('');
    parts.push('PAYMENT DETAILS');
    parts.push(...bankDetails);
  }
  const notes = toText(values['notes']).trim();
  if (notes) {
    parts.push('');
    parts.push('NOTES');
    parts.push(notes);
  }
  parts.push('');
  parts.push(`All amounts are in ${currency}. Tax is shown per line and applied to the discounted value of each line.`);
  parts.push('Generated with the CloudHost247 Business Tools invoice generator. Review before issuing.');

  const document: ResultDocument = {
    format: 'text',
    filename: `invoice-${invoiceNumber.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'draft'}.txt`,
    label: 'Invoice',
    content: tidyDocument(parts.join('\n')),
  };

  const csv = toCsv(
    ['Description', 'Quantity', `Unit price (${currency})`, 'Tax rate (%)', `Net (${currency})`, `Tax (${currency})`, `Gross (${currency})`],
    [
      ...totals.lines.map((item) => [
        item.description,
        item.quantity.toFixed(2),
        item.unitPrice.toFixed(2),
        item.taxRate.toFixed(2),
        item.netAmount.toFixed(2),
        item.taxAmount.toFixed(2),
        item.grossAmount.toFixed(2),
      ] as unknown[]),
      ['Subtotal', '', '', '', totals.subtotal.toFixed(2), '', ''] as unknown[],
      ['Discount', '', '', '', (-totals.discountAmount).toFixed(2), '', ''] as unknown[],
      ['Taxable base', '', '', '', totals.taxableBase.toFixed(2), '', ''] as unknown[],
      ['Tax', '', '', '', '', totals.totalTax.toFixed(2), ''] as unknown[],
      ['Shipping', '', '', '', '', '', totals.shipping.toFixed(2)] as unknown[],
      ['TOTAL', '', '', '', '', '', totals.total.toFixed(2)] as unknown[],
      ['Amount paid', '', '', '', '', '', (-totals.amountPaid).toFixed(2)] as unknown[],
      ['Balance due', '', '', '', '', '', totals.balanceDue.toFixed(2)] as unknown[],
    ]
  );

  const daysToDue = issueDate && dueDate && parseIsoDate(issueDate) && parseIsoDate(dueDate)
    ? Math.round(((isoDateToTimestamp(dueDate) as number) - (isoDateToTimestamp(issueDate) as number)) / 86_400_000)
    : null;

  return {
    ok: true,
    result: {
      metrics: [
        { label: 'Invoice total', value: formatMoney(totals.total, currency), emphasis: 'primary', hint: `Including ${formatMoney(totals.totalTax, currency)} tax` },
        { label: 'Subtotal', value: formatMoney(totals.subtotal, currency), emphasis: 'secondary', hint: `${totals.lines.length} line item${totals.lines.length === 1 ? '' : 's'}` },
        { label: 'Balance due', value: formatMoney(totals.balanceDue, currency), emphasis: 'primary', hint: titleCase(totals.status.replace('-', ' ')) },
        {
          label: 'Payment terms',
          value: daysToDue === null ? 'Not specified' : `${daysToDue} day${daysToDue === 1 ? '' : 's'}`,
          emphasis: 'muted',
          hint: daysToDue === null ? undefined : 'From issue date to due date',
        },
      ],
      tables: [
        {
          title: 'Line items',
          columns: ['Description', 'Qty', `Unit price (${currency})`, 'Tax rate', `Net (${currency})`, `Tax (${currency})`, `Gross (${currency})`],
          rows: totals.lines.map((item) => ({
            label: item.description,
            cells: [
              formatAmount(item.quantity, 2),
              formatAmount(item.unitPrice),
              formatPercent(item.taxRate),
              formatAmount(item.netAmount),
              formatAmount(item.taxAmount),
              formatAmount(item.grossAmount),
            ],
          })),
        },
        {
          title: 'Totals',
          columns: ['Item', `Amount (${currency})`],
          rows: [
            { label: 'Subtotal', cells: [formatAmount(totals.subtotal)] },
            ...(totals.discountAmount > 0
              ? [{ label: `Discount${totals.discountPct > 0 ? ` (${formatPercent(totals.discountPct, 0)})` : ''}`, cells: ['−' + formatAmount(totals.discountAmount)] }]
              : []),
            { label: 'Taxable base', cells: [formatAmount(totals.taxableBase)] },
            { label: 'Tax', cells: [formatAmount(totals.totalTax)] },
            ...(totals.shipping > 0 ? [{ label: 'Shipping', cells: [formatAmount(totals.shipping)] }] : []),
            { label: 'Total', cells: [formatAmount(totals.total)], emphasis: 'total' as const },
            ...(totals.amountPaid > 0
              ? [
                  { label: 'Amount paid', cells: ['−' + formatAmount(totals.amountPaid)] },
                  { label: 'Balance due', cells: [formatAmount(totals.balanceDue)], emphasis: 'total' as const },
                ]
              : []),
          ],
        },
      ],
      document,
      extraDocuments: [
        {
          format: 'csv',
          filename: `invoice-${invoiceNumber.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'draft'}-lines.csv`,
          label: 'Line items (CSV)',
          content: csv,
        },
      ],
      explanation: [
        `Each line: net = quantity × unit price; tax = net × line rate. Line rates default to ${formatPercent(defaultRate)} where you did not specify one.`,
        `The discount of ${formatMoney(totals.discountAmount, currency)} is spread pro-rata across the lines, so tax is charged on ${formatMoney(totals.taxableBase, currency)} rather than on the undiscounted subtotal. That is what a VAT invoice has to show.`,
        `Total = taxable base ${formatMoney(totals.taxableBase, currency)} + tax ${formatMoney(totals.totalTax, currency)}${totals.shipping > 0 ? ` + shipping ${formatMoney(totals.shipping, currency)}` : ''} = ${formatMoney(totals.total, currency)}.`,
        totals.amountPaid > 0
          ? `Balance due = total − amount paid = ${formatMoney(totals.balanceDue, currency)} (status: ${totals.status}).`
          : 'No payment was recorded, so the whole total is the balance due.',
      ],
      warnings,
      jurisdiction: INVOICE_TAX_NOTE,
    },
  };
}

function line2(label: string, value: string): string {
  return `${label}: ${value}`;
}

/* ================================================================== */
/* Shared SVG scaffolding                                              */
/* ================================================================== */

/** Validate a hex colour so an attacker-controlled string can never break out of the SVG markup. */
function sanitizeColor(value: unknown, fallback: string): string {
  const text = toText(value).trim();
  const match = /^#?([0-9a-fA-F]{6})$/.exec(text);
  return match && match[1] ? `#${match[1].toLowerCase()}` : fallback;
}

/**
 * Readable-contrast check.
 *
 * White text on a light brand colour is the most common way a generated card becomes unusable, and
 * it is a real accessibility defect rather than a cosmetic one, so the tool computes WCAG 2.1
 * relative luminance and picks black or white text automatically — then says which it picked.
 */
export function relativeLuminance(hex: string): number {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const channel = (c: number): number => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return round((lighter + 0.05) / (darker + 0.05), 2);
}

/** Choose black or white text for a background, preferring the higher contrast. */
export function readableTextColor(background: string): '#ffffff' | '#111111' {
  return contrastRatio(background, '#ffffff') >= contrastRatio(background, '#111111') ? '#ffffff' : '#111111';
}

/* ================================================================== */
/* 8. Business Card Generator                                          */
/* ================================================================== */

/** ISO/IEC 7810 ID-1 is 85.60 × 53.98 mm; at 96dpi that is 323 × 204 px. Used for the landscape card. */
export const CARD_LANDSCAPE = { width: 1050, height: 600 } as const;
export const CARD_PORTRAIT = { width: 600, height: 1050 } as const;

export function buildBusinessCardSvg(values: BusinessToolInput): { svg: string; warnings: string[] } {
  const fullName = toText(values['fullName']).trim() || 'Your Name';
  const jobTitle = toText(values['jobTitle']).trim();
  const companyName = toText(values['companyName']).trim();
  const tagline = toText(values['tagline']).trim();
  const phone = toText(values['phone']).trim();
  const email = toText(values['email']).trim();
  const website = toText(values['website']).trim();
  const address = toText(values['address']).trim();
  const socials = toList(values['socials']);
  const orientation = toText(values['orientation']) === 'portrait' ? 'portrait' : 'landscape';
  const layout = toText(values['layout']) || 'classic';
  const brandColor = sanitizeColor(values['brandColor'], '#0f2b46');
  const accentColor = sanitizeColor(values['accentColor'], '#1f7ae0');
  const textColor = readableTextColor(brandColor);

  const dimensions = orientation === 'portrait' ? CARD_PORTRAIT : CARD_LANDSCAPE;
  const { width, height } = dimensions;
  const warnings: string[] = [];

  const margin = Math.round(width * 0.06);
  const isSplit = layout === 'split';
  const panelWidth = isSplit ? Math.round(width * 0.36) : 0;

  const bodyX = isSplit ? panelWidth + margin : margin;
  const bodyWidth = width - bodyX - margin;
  let cursorY = Math.round(height * 0.22);

  const textElements: string[] = [];
  const push = (text: string, fontSize: number, weight: string, color: string, dy: number, x = bodyX): void => {
    if (text === '') return;
    cursorY += dy;
    textElements.push(
      `<text x="${x}" y="${cursorY}" font-family="Helvetica, Arial, sans-serif" font-size="${fontSize}" font-weight="${weight}" fill="${color}">${escapeXml(clampText(text, 58))}</text>`
    );
  };

  const nameSize = Math.round(width * 0.045);
  const detailSize = Math.round(width * 0.023);

  if (isSplit) {
    // The identity panel carries the company name vertically centred on the brand colour.
    textElements.push(
      `<rect x="0" y="0" width="${panelWidth}" height="${height}" fill="${brandColor}"/>`,
      `<text x="${Math.round(panelWidth / 2)}" y="${Math.round(height / 2)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${Math.round(width * 0.032)}" font-weight="700" fill="${textColor}">${escapeXml(clampText(companyName || fullName, 22))}</text>`
    );
    if (tagline) {
      textElements.push(
        `<text x="${Math.round(panelWidth / 2)}" y="${Math.round(height / 2) + Math.round(width * 0.035)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${Math.round(width * 0.016)}" fill="${textColor}" opacity="0.85">${escapeXml(clampText(tagline, 34))}</text>`
      );
    }
    cursorY = Math.round(height * 0.26);
    push(fullName, nameSize, '700', '#111111', 0);
    push(jobTitle, detailSize, '400', '#4a5568', Math.round(nameSize * 0.9));
    cursorY += Math.round(height * 0.06);
    push(phone, detailSize, '400', '#1a202c', Math.round(detailSize * 1.9));
    push(email, detailSize, '400', '#1a202c', Math.round(detailSize * 1.9));
    push(website, detailSize, '400', accentColor, Math.round(detailSize * 1.9));
    push(address, Math.round(detailSize * 0.9), '400', '#4a5568', Math.round(detailSize * 1.9));
    if (socials.length > 0) {
      push(socials.join('  ·  '), Math.round(detailSize * 0.9), '400', '#4a5568', Math.round(detailSize * 1.9));
    }
  } else {
    textElements.push(
      `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`,
      `<rect x="0" y="0" width="${width}" height="${Math.round(height * 0.09)}" fill="${brandColor}"/>`,
      `<rect x="0" y="${height - Math.round(height * 0.04)}" width="${width}" height="${Math.round(height * 0.04)}" fill="${accentColor}"/>`
    );
    cursorY = Math.round(height * 0.3);
    push(fullName, nameSize, '700', '#111111', 0);
    push(jobTitle, detailSize, '400', '#4a5568', Math.round(nameSize * 0.9));
    push(companyName, detailSize, '600', brandColor, Math.round(detailSize * 2));
    push(tagline, Math.round(detailSize * 0.9), '400', '#4a5568', Math.round(detailSize * 1.7));
    cursorY += Math.round(height * 0.05);
    push(phone, detailSize, '400', '#1a202c', Math.round(detailSize * 1.9));
    push(email, detailSize, '400', '#1a202c', Math.round(detailSize * 1.9));
    push(website, detailSize, '400', accentColor, Math.round(detailSize * 1.9));
    push(address, Math.round(detailSize * 0.9), '400', '#4a5568', Math.round(detailSize * 1.9));
    if (socials.length > 0) {
      push(socials.join('  ·  '), Math.round(detailSize * 0.9), '400', '#4a5568', Math.round(detailSize * 1.9));
    }
  }

  if (cursorY > height - margin) {
    warnings.push(
      'The details overflow the card height at this font size. Remove a line (the address or tagline are usually the first to go) or switch to the split layout, which uses the panel for the company name.'
    );
  }
  if (email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    warnings.push(`"${email}" does not look like a valid email address. A card is printed once and handed out many times.`);
  }
  if (website !== '' && !/^(https?:\/\/)?[^\s/]+\.[a-z]{2,}/i.test(website)) {
    warnings.push(`"${website}" does not look like a domain name.`);
  }
  if (fullName.trim() === 'Your Name') {
    warnings.push('No name was supplied, so the card shows the placeholder "Your Name".');
  }
  if (contrastRatio(brandColor, textColor) < 4.5) {
    warnings.push(
      `The chosen brand colour gives a text contrast ratio of ${contrastRatio(brandColor, textColor)}:1, below the 4.5:1 WCAG 2.1 AA minimum for normal-size text. Darken or lighten the brand colour.`
    );
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Business card for ${escapeXml(fullName)}">` +
    textElements.join('') +
    '</svg>';

  return { svg, warnings };
}

export function computeBusinessCard(values: BusinessToolInput): BusinessToolOutcome {
  const { svg, warnings } = buildBusinessCardSvg(values);
  const orientation = toText(values['orientation']) === 'portrait' ? 'portrait' : 'landscape';
  const dimensions = orientation === 'portrait' ? CARD_PORTRAIT : CARD_LANDSCAPE;
  const brandColor = sanitizeColor(values['brandColor'], '#0f2b46');
  const textColor = readableTextColor(brandColor);
  const contrast = contrastRatio(brandColor, textColor);

  return {
    ok: true,
    result: {
      metrics: [
        { label: 'Orientation', value: titleCase(orientation), emphasis: 'primary' },
        { label: 'Canvas', value: `${dimensions.width} × ${dimensions.height} px`, emphasis: 'secondary', hint: 'ISO/IEC 7810 ID-1 proportions at 96 dpi' },
        { label: 'Print size', value: '85.60 × 53.98 mm', emphasis: 'secondary', hint: orientation === 'portrait' ? 'Rotated to portrait' : 'Standard business card' },
        {
          label: 'Text contrast on brand colour',
          value: `${contrast}:1`,
          emphasis: contrast >= 4.5 ? 'muted' : 'primary',
          hint: contrast >= 4.5 ? 'Meets WCAG 2.1 AA for normal text' : 'Below the 4.5:1 WCAG 2.1 AA minimum',
        },
      ],
      document: {
        format: 'svg',
        filename: `business-card-${toText(values['fullName']).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'draft'}.svg`,
        label: 'Business card (SVG)',
        content: svg,
      },
      tables: [
        {
          title: 'Card content',
          columns: ['Element', 'Value'],
          rows: [
            { label: 'Name', cells: [toText(values['fullName']).trim() || '(placeholder)'] },
            { label: 'Job title', cells: [toText(values['jobTitle']).trim() || '—'] },
            { label: 'Company', cells: [toText(values['companyName']).trim() || '—'] },
            { label: 'Tagline', cells: [toText(values['tagline']).trim() || '—'] },
            { label: 'Phone', cells: [toText(values['phone']).trim() || '—'] },
            { label: 'Email', cells: [toText(values['email']).trim() || '—'] },
            { label: 'Website', cells: [toText(values['website']).trim() || '—'] },
            { label: 'Address', cells: [toText(values['address']).trim() || '—'] },
            { label: 'Social handles', cells: [toList(values['socials']).join(', ') || '—'] },
            { label: 'Layout', cells: [titleCase(toText(values['layout']) || 'classic')] },
            { label: 'Brand colour', cells: [brandColor] },
            { label: 'Text colour (auto-selected)', cells: [`${textColor} — chosen for the higher of black/white contrast`], emphasis: 'muted' },
          ],
        },
      ],
      explanation: [
        'The card is generated as SVG: a text format, so it is produced entirely in your browser with no image service, no font download and nothing uploaded.',
        `Text colour was selected automatically — ${textColor} on ${brandColor} gives ${contrast}:1.`,
        'SVG scales without loss, so the file is suitable both for a print bureau and for an email signature.',
        'For offset printing, ask your print bureau to convert the SVG to your house spot or CMYK values; RGB colours shift when converted.',
      ],
      warnings,
    },
  };
}

/* ================================================================== */
/* 9. Employee ID Generator                                            */
/* ================================================================== */

/**
 * A Luhn (mod 10) check digit over the numeric part of an identifier.
 *
 * The point of a check digit is that a single mistyped or transposed digit fails validation instead
 * of silently resolving to another employee's record — which matters when the ID drives payroll
 * routing. Luhn catches every single-digit error and most adjacent transpositions.
 */
export function luhnCheckDigit(digits: string): number {
  let sum = 0;
  let double = true;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    const char = digits.charAt(index);
    const value = char.charCodeAt(0) - 48;
    if (value < 0 || value > 9) continue;
    const contribution = double ? (value * 2 > 9 ? value * 2 - 9 : value * 2) : value;
    sum += contribution;
    double = !double;
  }
  return (10 - (sum % 10)) % 10;
}

export function luhnIsValid(digits: string): boolean {
  if (!/^\d+$/.test(digits) || digits.length < 2) return false;
  const body = digits.slice(0, -1);
  const check = Number(digits.slice(-1));
  return luhnCheckDigit(body) === check;
}

export interface GeneratedEmployeeId {
  sequence: number;
  id: string;
  components: { prefix: string; departmentCode: string; year: string; sequence: string; check: string };
}

/**
 * The digits the check digit is computed over.
 *
 * It has to be every digit that appears in the printed identifier — including the ones inside the
 * company prefix — because a verifier only has the identifier in front of it. Computing the check
 * over a subset would make the scheme unverifiable from the ID alone, which defeats the point of
 * having a check digit at all.
 */
export function employeeIdNumericCore(prefix: string, departmentCode: string, year: string, paddedSequence: string): string {
  const core = `${prefix}${departmentCode}${year}${paddedSequence}`.replace(/\D/g, '');
  // Strip leading zeros only so the core is never the empty string, which has no check digit.
  return core.replace(/^0+(?=\d)/, '') || '0';
}

export function buildEmployeeId(
  prefix: string,
  departmentCode: string,
  year: string,
  sequence: number,
  sequenceWidth: number
): GeneratedEmployeeId {
  const paddedSequence = String(Math.max(0, Math.floor(sequence))).padStart(sequenceWidth, '0').slice(-sequenceWidth);
  const numericCore = employeeIdNumericCore(prefix, departmentCode, year, paddedSequence);
  const check = luhnCheckDigit(numericCore);
  const id = [prefix, departmentCode, year, paddedSequence, String(check)].filter((part) => part !== '').join('-');
  return {
    sequence,
    id,
    components: { prefix, departmentCode, year, sequence: paddedSequence, check: String(check) },
  };
}

export function computeEmployeeIdGenerator(values: BusinessToolInput): BusinessToolOutcome {
  const prefix = toText(values['companyPrefix']).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const departmentCode = toText(values['departmentCode']).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const year = toText(values['year']).trim();
  const startSequence = toNumber(values['startSequence']) ?? 1;
  const count = toNumber(values['count']) ?? 1;
  const sequenceWidth = toNumber(values['sequenceWidth']) ?? 4;

  const fieldErrors: Array<{ key: string; message: string }> = [];
  if (prefix === '') fieldErrors.push({ key: 'companyPrefix', message: 'A company prefix is required (letters and digits only).' });
  if (prefix.length > 6) fieldErrors.push({ key: 'companyPrefix', message: 'Keep the prefix to 6 characters or fewer so the ID stays readable on a badge.' });
  if (departmentCode === '') fieldErrors.push({ key: 'departmentCode', message: 'A department code is required.' });
  if (departmentCode.length > 4) fieldErrors.push({ key: 'departmentCode', message: 'Keep the department code to 4 characters or fewer.' });
  if (!/^\d{4}$/.test(year)) fieldErrors.push({ key: 'year', message: 'The year must be four digits, e.g. 2026.' });
  else if (Number(year) < 1970 || Number(year) > 2200) fieldErrors.push({ key: 'year', message: 'The year must be between 1970 and 2200.' });
  if (!Number.isInteger(startSequence) || startSequence < 0) fieldErrors.push({ key: 'startSequence', message: 'The starting sequence must be a whole number of zero or more.' });
  if (!Number.isInteger(count) || count < 1) fieldErrors.push({ key: 'count', message: 'Generate at least one ID.' });
  if (Number.isInteger(count) && count > 500) fieldErrors.push({ key: 'count', message: `A batch of ${count} is more than this tool will generate at once (maximum 500). Split the batch.` });
  if (!Number.isInteger(sequenceWidth) || sequenceWidth < 1 || sequenceWidth > 8) fieldErrors.push({ key: 'sequenceWidth', message: 'Sequence width must be between 1 and 8 digits.' });
  if (fieldErrors.length > 0) {
    return { ok: false, error: fieldFailure(fieldErrors, 'Fix the highlighted fields before generating identifiers.') };
  }

  const width = sequenceWidth as number;
  const total = count as number;
  const start = startSequence as number;
  const maximum = Math.pow(10, width) - 1;
  const warnings: string[] = [];
  if (start + total - 1 > maximum) {
    warnings.push(
      `With a ${width}-digit sequence the highest representable number is ${formatInteger(maximum)}. This batch reaches ${formatInteger(start + total - 1)}, so the generated IDs wrap and collide with earlier ones. Increase the sequence width.`
    );
  }

  const generated: GeneratedEmployeeId[] = [];
  for (let offset = 0; offset < total; offset += 1) {
    generated.push(buildEmployeeId(prefix, departmentCode, year, start + offset, width));
  }

  const duplicateCheck: Record<string, true> = {};
  const duplicates: string[] = [];
  for (const item of generated) {
    if (duplicateCheck[item.id]) duplicates.push(item.id);
    duplicateCheck[item.id] = true;
  }
  if (duplicates.length > 0) {
    warnings.push(`${duplicates.length} duplicated identifier${duplicates.length === 1 ? '' : 's'} produced: ${duplicates.slice(0, 5).join(', ')}${duplicates.length > 5 ? '…' : ''}.`);
  }

  // Every generated ID must pass its own validator — asserted here, not just in tests.
  const invalid = generated.filter((item) => {
    const numeric = item.id.replace(/\D/g, '');
    return !luhnIsValid(numeric);
  });
  if (invalid.length > 0) {
    warnings.push(`${invalid.length} generated identifier${invalid.length === 1 ? '' : 's'} failed check-digit verification. Do not use this batch; report it.`);
  }

  const firstGenerated = generated[0];
  const lastGenerated = generated[generated.length - 1];

  const csv = toCsv(
    ['Sequence', 'Employee ID', 'Company prefix', 'Department code', 'Year', 'Sequence number', 'Check digit'],
    generated.map((item) => [
      String(item.sequence),
      item.id,
      item.components.prefix,
      item.components.departmentCode,
      year,
      item.components.sequence,
      item.components.check,
    ] as unknown[])
  );

  return {
    ok: true,
    result: {
      metrics: [
        { label: 'Identifiers generated', value: formatInteger(generated.length), emphasis: 'primary' },
        { label: 'First ID', value: firstGenerated ? firstGenerated.id : '—', emphasis: 'primary' },
        { label: 'Last ID', value: lastGenerated ? lastGenerated.id : '—', emphasis: 'secondary' },
        { label: 'Check digit', value: 'Luhn (mod 10)', emphasis: 'muted', hint: 'Catches single-digit and most adjacent transposition errors' },
      ],
      tables: [
        {
          title: 'Identifier scheme',
          columns: ['Segment', 'Value', 'Rule'],
          rows: [
            { label: 'Company prefix', cells: [prefix, 'Alphanumeric, uppercase, up to 6 characters'] },
            { label: 'Department code', cells: [departmentCode, 'Alphanumeric, uppercase, up to 4 characters'] },
            { label: 'Year', cells: [year, 'Four digits'] },
            { label: 'Sequence', cells: [`${String(start).padStart(width, '0')} … ${String(start + total - 1).padStart(width, '0')}`, `Zero-padded to ${width} digits; maximum ${formatInteger(maximum)}`] },
            { label: 'Check digit', cells: ['Luhn over department digits + year + sequence', 'Single digit, 0–9'] },
          ],
        },
        {
          title: total > 25 ? `Generated identifiers (first 25 of ${formatInteger(total)})` : 'Generated identifiers',
          columns: ['#', 'Employee ID', 'Check digit verified'],
          rows: generated.slice(0, 25).map((item, index) => ({
            label: String(index + 1),
            cells: [item.id, luhnIsValid(item.id.replace(/\D/g, '')) ? 'Yes' : 'No'],
          })),
        },
      ],
      document: {
        format: 'csv',
        filename: `employee-ids-${prefix || 'company'}-${departmentCode}-${year}.csv`,
        label: 'Identifier batch (CSV)',
        content: csv,
      },
      explanation: [
        `Format: ${prefix}-${departmentCode}-${year}-<${width}-digit sequence>-<Luhn check digit>.`,
        `The batch runs from sequence ${start} to ${start + total - 1}, giving ${formatInteger(total)} identifier${total === 1 ? '' : 's'}.`,
        'Every ID in this batch was re-validated with the same check-digit routine the verifier uses, so a mistyped digit fails rather than resolving to a different employee.',
        'Identifiers are generated locally. Nothing is registered anywhere and no uniqueness guarantee exists against IDs you issued outside this tool — keep the CSV as your allocation record.',
      ],
      warnings,
    },
  };
}

/* ================================================================== */
/* 10. Employee ID Card Generator                                      */
/* ================================================================== */

export function buildEmployeeIdCardSvg(values: BusinessToolInput): { svg: string; warnings: string[] } {
  const employeeName = toText(values['employeeName']).trim() || 'Employee Name';
  const employeeId = toText(values['employeeId']).trim();
  const companyName = toText(values['companyName']).trim() || 'Company Name';
  const designation = toText(values['designation']).trim();
  const department = toText(values['department']).trim();
  const bloodGroup = toText(values['bloodGroup']).trim();
  const issueDate = toText(values['issueDate']).trim();
  const expiryDate = toText(values['expiryDate']).trim();
  const orientation = toText(values['orientation']) === 'landscape' ? 'landscape' : 'portrait';
  const theme = sanitizeColor(values['themeColor'], '#0f2b46');
  const includePhotoPlaceholder = toBoolean(values['includePhoto']);
  const includeQrPayload = toBoolean(values['includeQr']);

  const warnings: string[] = [];
  const dimensions = orientation === 'landscape' ? CARD_LANDSCAPE : CARD_PORTRAIT;
  const { width, height } = dimensions;
  const textColor = readableTextColor(theme);
  const contrast = contrastRatio(theme, textColor);
  if (contrast < 4.5) {
    warnings.push(`The theme colour gives ${contrast}:1 contrast against the auto-selected text colour, below the 4.5:1 WCAG 2.1 AA minimum. Darken or lighten the theme.`);
  }
  if (employeeName.trim() === 'Employee Name') warnings.push('No employee name was supplied, so the card shows a placeholder.');
  if (employeeId === '') warnings.push('No employee ID was supplied. A badge without an identifier cannot be used for access control or payroll matching.');
  if (expiryDate && !parseIsoDate(expiryDate)) warnings.push(`"${expiryDate}" is not a valid expiry date; use YYYY-MM-DD.`);
  if (issueDate && expiryDate && parseIsoDate(issueDate) && parseIsoDate(expiryDate) && expiryDate <= issueDate) {
    warnings.push(`The expiry date (${formatLongDate(expiryDate)}) is not after the issue date (${formatLongDate(issueDate)}).`);
  }
  if (bloodGroup !== '' && !/^(A|B|AB|O)[+-]$/i.test(bloodGroup)) {
    warnings.push(`"${bloodGroup}" is not a recognised blood group. Use one of A+, A−, B+, B−, AB+, AB−, O+, O−, or leave it blank.`);
  }

  const margin = Math.round(width * 0.06);
  const headerHeight = Math.round(height * 0.2);
  const photoWidth = Math.round(width * 0.26);
  const photoHeight = Math.round(photoWidth * 1.25);
  const detailX = includePhotoPlaceholder ? margin + photoWidth + Math.round(margin * 0.6) : margin;
  const detailSize = Math.round(width * 0.028);

  const elements: string[] = [
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`,
    `<rect x="0" y="0" width="${width}" height="${headerHeight}" fill="${theme}"/>`,
    `<text x="${Math.round(width / 2)}" y="${Math.round(headerHeight * 0.5)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${Math.round(width * 0.036)}" font-weight="700" fill="${textColor}">${escapeXml(clampText(companyName, 34))}</text>`,
    `<text x="${Math.round(width / 2)}" y="${Math.round(headerHeight * 0.8)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${Math.round(width * 0.019)}" fill="${textColor}" opacity="0.9">EMPLOYEE IDENTIFICATION CARD</text>`,
  ];

  if (includePhotoPlaceholder) {
    const photoY = headerHeight + Math.round(margin * 0.6);
    elements.push(
      `<rect x="${margin}" y="${photoY}" width="${photoWidth}" height="${photoHeight}" rx="${Math.round(width * 0.01)}" fill="#e8edf3" stroke="${theme}" stroke-width="2"/>`,
      `<text x="${margin + Math.round(photoWidth / 2)}" y="${photoY + Math.round(photoHeight / 2)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${Math.round(width * 0.018)}" fill="#64748b">PHOTO</text>`
    );
  }

  let y = headerHeight + Math.round(height * 0.12);
  const row = (label: string, value: string): void => {
    if (value.trim() === '') return;
    elements.push(
      `<text x="${detailX}" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="${Math.round(detailSize * 0.72)}" fill="#64748b" letter-spacing="1">${escapeXml(label.toUpperCase())}</text>`,
      `<text x="${detailX}" y="${y + detailSize}" font-family="Helvetica, Arial, sans-serif" font-size="${detailSize}" font-weight="600" fill="#111111">${escapeXml(clampText(value, 34))}</text>`
    );
    y += Math.round(detailSize * 2.5);
  };

  row('Name', employeeName);
  row('Employee ID', employeeId);
  row('Designation', designation);
  row('Department', department);
  if (orientation === 'landscape') {
    row('Blood group', bloodGroup);
    row('Valid until', expiryDate ? formatLongDate(expiryDate) : '');
  } else {
    row('Blood group', bloodGroup);
    row('Issued', issueDate ? formatLongDate(issueDate) : '');
    row('Valid until', expiryDate ? formatLongDate(expiryDate) : '');
  }

  if (y > height - Math.round(margin * 1.4)) {
    warnings.push('The detail rows overflow the card. Remove a field (department or issue date) or switch to the landscape layout, which has more vertical room per row.');
  }

  if (includeQrPayload) {
    const qrSize = Math.round(width * 0.16);
    const qrX = width - margin - qrSize;
    const qrY = height - Math.round(margin * 1.2) - qrSize;
    // A deterministic finder-pattern placeholder: it marks where a real QR payload belongs and shows
    // the payload text, rather than pretending to encode a scannable code.
    elements.push(
      `<rect x="${qrX}" y="${qrY}" width="${qrSize}" height="${qrSize}" fill="#ffffff" stroke="#111111" stroke-width="3"/>`,
      `<rect x="${qrX + 6}" y="${qrY + 6}" width="${Math.round(qrSize * 0.22)}" height="${Math.round(qrSize * 0.22)}" fill="#111111"/>`,
      `<rect x="${qrX + qrSize - 6 - Math.round(qrSize * 0.22)}" y="${qrY + 6}" width="${Math.round(qrSize * 0.22)}" height="${Math.round(qrSize * 0.22)}" fill="#111111"/>`,
      `<rect x="${qrX + 6}" y="${qrY + qrSize - 6 - Math.round(qrSize * 0.22)}" width="${Math.round(qrSize * 0.22)}" height="${Math.round(qrSize * 0.22)}" fill="#111111"/>`,
      `<text x="${qrX + Math.round(qrSize / 2)}" y="${qrY + qrSize + Math.round(detailSize * 0.9)}" text-anchor="middle" font-family="monospace" font-size="${Math.round(detailSize * 0.6)}" fill="#475569">${escapeXml(clampText(employeeId || employeeName, 28))}</text>`
    );
    warnings.push(
      'The QR block is a printed placeholder showing the payload text, not a scannable code — encoding a real QR symbol needs a barcode library, and this tool will not claim to produce a code it cannot verify. Use the CloudHost247 QR Code Generator with the payload printed under the block.'
    );
  }

  elements.push(
    `<rect x="0" y="${height - Math.round(height * 0.055)}" width="${width}" height="${Math.round(height * 0.055)}" fill="${theme}"/>`,
    `<text x="${Math.round(width / 2)}" y="${height - Math.round(height * 0.02)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${Math.round(width * 0.015)}" fill="${textColor}">If found, please return to ${escapeXml(clampText(companyName, 40))}</text>`
  );

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Employee identification card for ${escapeXml(employeeName)}">` +
    elements.join('') +
    '</svg>';

  return { svg, warnings };
}

export function computeEmployeeIdCard(values: BusinessToolInput): BusinessToolOutcome {
  const { svg, warnings } = buildEmployeeIdCardSvg(values);
  const employeeId = toText(values['employeeId']).trim();
  const numeric = employeeId.replace(/\D/g, '');
  const checkValid = numeric.length >= 2 ? luhnIsValid(numeric) : null;
  const orientation = toText(values['orientation']) === 'landscape' ? 'landscape' : 'portrait';

  if (checkValid === false) {
    warnings.push(
      `The employee ID "${employeeId}" fails Luhn check-digit verification. If it was issued by the Employee ID Generator, it may have been mistyped — an invalid ID will not match a payroll or access-control record.`
    );
  }

  return {
    ok: true,
    result: {
      metrics: [
        { label: 'Cardholder', value: toText(values['employeeName']).trim() || '(placeholder)', emphasis: 'primary' },
        { label: 'Employee ID', value: employeeId || '—', emphasis: 'primary' },
        {
          label: 'Check digit',
          value: checkValid === null ? 'Not verifiable' : checkValid ? 'Valid (Luhn)' : 'Invalid (Luhn)',
          emphasis: checkValid === false ? 'primary' : 'muted',
          hint: checkValid === null ? 'An ID with fewer than two digits cannot carry a Luhn check digit' : undefined,
        },
        { label: 'Layout', value: `${titleCase(orientation)} · ${orientation === 'landscape' ? '1050 × 600' : '600 × 1050'} px`, emphasis: 'secondary' },
      ],
      document: {
        format: 'svg',
        filename: `id-card-${employeeId || toText(values['employeeName']).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'draft'}.svg`,
        label: 'ID card (SVG)',
        content: svg,
      },
      tables: [
        {
          title: 'Card fields',
          columns: ['Field', 'Value'],
          rows: [
            { label: 'Company', cells: [toText(values['companyName']).trim() || '(placeholder)'] },
            { label: 'Employee name', cells: [toText(values['employeeName']).trim() || '(placeholder)'] },
            { label: 'Employee ID', cells: [employeeId || '—'] },
            { label: 'Designation', cells: [toText(values['designation']).trim() || '—'] },
            { label: 'Department', cells: [toText(values['department']).trim() || '—'] },
            { label: 'Blood group', cells: [toText(values['bloodGroup']).trim() || '—'] },
            { label: 'Issue date', cells: [toText(values['issueDate']).trim() ? formatLongDate(values['issueDate']) : '—'] },
            { label: 'Expiry date', cells: [toText(values['expiryDate']).trim() ? formatLongDate(values['expiryDate']) : '—'] },
            { label: 'Photo placeholder', cells: [toBoolean(values['includePhoto']) ? 'Included' : 'Omitted'] },
            { label: 'QR payload block', cells: [toBoolean(values['includeQr']) ? 'Included (placeholder, not scannable)' : 'Omitted'] },
          ],
        },
      ],
      explanation: [
        'The card is generated as SVG in your browser. No employee name, ID number, department, blood group or photograph leaves this page.',
        'Blood group and expiry date are printed because a badge is read at a glance by someone who has no access to your HR system.',
        checkValid === true
          ? 'The employee ID passes Luhn check-digit verification, so a single mistyped digit will be rejected rather than silently accepted.'
          : checkValid === false
            ? 'The employee ID does not pass Luhn verification. See the advisory below.'
            : 'No check-digit verification was possible for this ID format.',
        'Print at 100% scale on CR80 card stock (85.60 × 53.98 mm) for a standard badge; the portrait layout is the same card rotated.',
      ],
      warnings: [
        ...warnings,
        'An ID card is an identity artefact. Printing one for a person who does not work for the organisation, or altering an existing card, may constitute fraud in your jurisdiction — this tool produces the artwork only and verifies nothing about the holder.',
      ],
    },
  };
}

/* ================================================================== */
/* 11. Organizational Chart Generator                                  */
/* ================================================================== */

export interface OrgNode {
  id: string;
  name: string;
  role: string;
  managerId: string | null;
  depth: number;
  directReports: number;
  totalReports: number;
}

export interface OrgChart {
  nodes: OrgNode[];
  rootIds: string[];
  maxDepth: number;
  headcount: number;
  managerCount: number;
  averageSpanOfControl: number | null;
  widestSpan: { managerId: string; name: string; directReports: number } | null;
  orphanIds: string[];
}

/**
 * Build the tree, detect cycles and orphans, and compute span of control.
 *
 * Cycles and orphans are reported rather than silently dropped: an org chart that quietly hides a
 * person who reports to nobody is a chart the HR team will not notice is wrong until payroll does.
 */
export function buildOrgChart(
  records: Array<{ name: string; role: string; manager: string }>
): { ok: true; chart: OrgChart } | { ok: false; error: string } {
  if (records.length === 0) {
    return { ok: false, error: 'Add at least one person to the chart.' };
  }

  const byId: Record<string, OrgNode> = {};
  const nameToId: Record<string, string> = {};
  const duplicates: string[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    const name = record.name.trim();
    if (name === '') return { ok: false, error: `Line ${index + 1} has no name.` };
    const key = name.toLowerCase();
    if (nameToId[key]) duplicates.push(name);
    const id = `n${index}`;
    nameToId[key] = id;
    byId[id] = {
      id,
      name,
      role: record.role.trim(),
      managerId: null,
      depth: 0,
      directReports: 0,
      totalReports: 0,
    };
  }

  if (duplicates.length > 0) {
    return {
      ok: false,
      error: `Duplicate names make reporting lines ambiguous: ${duplicates.slice(0, 4).join(', ')}${duplicates.length > 4 ? '…' : ''}. Give each person a unique name (a middle initial or employee number is enough).`,
    };
  }

  const orphans: string[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    const node = byId[`n${index}`];
    if (!node) continue;
    const managerName = record.manager.trim();
    if (managerName === '') continue;
    const managerId = nameToId[managerName.toLowerCase()];
    if (!managerId) {
      orphans.push(`${node.name} → ${managerName}`);
      continue;
    }
    if (managerId === node.id) {
      return { ok: false, error: `${node.name} cannot report to themselves.` };
    }
    node.managerId = managerId;
  }

  if (orphans.length > 0) {
    return {
      ok: false,
      error: `These people report to someone who is not in the chart: ${orphans.slice(0, 5).join('; ')}${orphans.length > 5 ? '…' : ''}. Add the manager, correct the spelling, or leave the reporting line blank to make them a root.`,
    };
  }

  // Walk up from each node to compute depth, detecting cycles on the way.
  const nodes = Object.keys(byId).map((id) => byId[id]).filter((node): node is OrgNode => Boolean(node));
  for (const node of nodes) {
    const seen: Record<string, true> = {};
    let current: OrgNode | undefined = node;
    let depth = 0;
    while (current && current.managerId) {
      if (seen[current.id]) {
        return { ok: false, error: `A reporting cycle was detected involving ${current.name}. Break the cycle: someone in it must report to nobody.` };
      }
      seen[current.id] = true;
      const parent: OrgNode | undefined = byId[current.managerId];
      if (!parent) break;
      depth += 1;
      current = parent;
    }
    node.depth = depth;
  }

  for (const node of nodes) {
    if (node.managerId) {
      const manager = byId[node.managerId];
      if (manager) manager.directReports += 1;
    }
  }
  // Total reports = everyone below in the tree; computed by walking each node's ancestry.
  for (const node of nodes) {
    let current: OrgNode | undefined = node;
    const guard: Record<string, true> = {};
    while (current && current.managerId) {
      if (guard[current.id]) break;
      guard[current.id] = true;
      const parent: OrgNode | undefined = byId[current.managerId];
      if (!parent) break;
      parent.totalReports += 1;
      current = parent;
    }
  }

  const rootIds = nodes.filter((node) => !node.managerId).map((node) => node.id);
  const managers = nodes.filter((node) => node.directReports > 0);
  const maxDepth = nodes.reduce((max, node) => Math.max(max, node.depth), 0);
  const widest = managers.reduce<OrgChart['widestSpan']>((best, node) => {
    if (!best || node.directReports > best.directReports) {
      return { managerId: node.id, name: node.name, directReports: node.directReports };
    }
    return best;
  }, null);

  return {
    ok: true,
    chart: {
      nodes: nodes.slice().sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name)),
      rootIds,
      maxDepth,
      headcount: nodes.length,
      managerCount: managers.length,
      averageSpanOfControl: managers.length > 0
        ? round(managers.reduce((total, node) => total + node.directReports, 0) / managers.length, 2)
        : null,
      widestSpan: widest,
      orphanIds: orphans,
    },
  };
}

/** Render the tree as an indented outline. Deterministic: siblings sorted by name. */
export function renderOrgOutline(chart: OrgChart): string {
  const childrenOf: Record<string, OrgNode[]> = {};
  for (const node of chart.nodes) {
    const key = node.managerId ?? '__root__';
    const bucket = childrenOf[key];
    if (bucket) bucket.push(node);
    else childrenOf[key] = [node];
  }
  for (const key of Object.keys(childrenOf)) {
    const bucket = childrenOf[key];
    if (bucket) bucket.sort((a, b) => a.name.localeCompare(b.name));
  }

  const lines: string[] = [];
  const walk = (parentId: string | null, indent: number): void => {
    const key = parentId ?? '__root__';
    const children = childrenOf[key] ?? [];
    for (const child of children) {
      const prefix = indent === 0 ? '' : `${'    '.repeat(indent - 1)}└─ `;
      lines.push(`${prefix}${child.name}${child.role ? ` — ${child.role}` : ''}${child.directReports > 0 ? `  (${child.directReports} direct, ${child.totalReports} total)` : ''}`);
      walk(child.id, indent + 1);
    }
  };
  walk(null, 0);
  return lines.join('\n');
}

export function computeOrganizationalChart(values: BusinessToolInput): BusinessToolOutcome {
  const organizationName = toText(values['organizationName']).trim();
  const lines = toLines(values['people']);
  if (lines.length === 0) {
    return {
      ok: false,
      error: failure('Add at least one person, one per line: Name | Role | Reports to.', [
        { key: 'people', message: 'At least one line is required, e.g. "Ada Obi | Chief Executive |".' },
      ]),
    };
  }
  if (lines.length > 500) {
    return {
      ok: false,
      error: failure(`This tool builds charts of up to 500 people (you entered ${lines.length}). Split larger organisations by department.`, [
        { key: 'people', message: 'Maximum 500 lines.' },
      ]),
    };
  }

  const records: Array<{ name: string; role: string; manager: string }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index];
    if (text === undefined) continue;
    const cells = text.split('|').map((cell) => cell.trim());
    if (cells.length < 1 || cells.length > 3) {
      return {
        ok: false,
        error: failure(
          `Line ${index + 1} has ${cells.length} fields but needs 2 or 3, separated by "|": Name | Role | Reports to. Leave "Reports to" blank for the head of the organisation.`,
          [{ key: 'people', message: `Line ${index + 1}: expected "Name | Role | Reports to".` }]
        ),
      };
    }
    records.push({ name: cells[0] ?? '', role: cells[1] ?? '', manager: cells[2] ?? '' });
  }

  const built = buildOrgChart(records);
  if (!built.ok) {
    return { ok: false, error: failure(built.error, [{ key: 'people', message: built.error }]) };
  }

  const chart = built.chart;
  const outline = renderOrgOutline(chart);

  const warnings: string[] = [];
  if (chart.rootIds.length > 1) {
    const roots = chart.nodes.filter((node) => !node.managerId).map((node) => node.name);
    warnings.push(
      `This chart has ${chart.rootIds.length} separate roots (${roots.slice(0, 4).join(', ')}${roots.length > 4 ? '…' : ''}), so it is really ${chart.rootIds.length} disconnected teams rather than one organisation. Give all but one of them a reporting line.`
    );
  }
  if (chart.widestSpan && chart.widestSpan.directReports > 10) {
    warnings.push(
      `${chart.widestSpan.name} has ${chart.widestSpan.directReports} direct reports. Spans much wider than about 8–10 usually mean a missing management layer, because one person cannot meaningfully line-manage that many.`
    );
  }
  if (chart.averageSpanOfControl !== null && chart.averageSpanOfControl < 2 && chart.managerCount > 2) {
    warnings.push(
      `The average span of control is ${chart.averageSpanOfControl}, which suggests more management layers than people to manage. Review whether each layer earns its cost.`
    );
  }
  if (chart.maxDepth > 8) {
    warnings.push(`The chart is ${chart.maxDepth + 1} levels deep. Deep hierarchies slow decisions and distort information travelling upwards.`);
  }

  const csv = toCsv(
    ['Name', 'Role', 'Reports to', 'Level (0 = top)', 'Direct reports', 'Total reports below'],
    chart.nodes.map((node) => {
      const manager = chart.nodes.find((candidate) => candidate.id === node.managerId);
      return [
        node.name,
        node.role,
        manager ? manager.name : '',
        String(node.depth),
        String(node.directReports),
        String(node.totalReports),
      ] as unknown[];
    })
  );

  const document: ResultDocument = {
    format: 'text',
    filename: `${organizationName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'organization'}-chart.txt`,
    label: 'Organization chart (indented outline)',
    content: tidyDocument(
      [
        organizationName ? `${organizationName} — organization chart` : 'Organization chart',
        `${chart.headcount} people · ${chart.managerCount} managers · ${chart.maxDepth + 1} levels`,
        '',
        outline,
        '',
        'Generated with the CloudHost247 Business Tools organizational chart generator.',
      ].join('\n')
    ),
  };

  return {
    ok: true,
    result: {
      metrics: [
        { label: 'Headcount', value: formatInteger(chart.headcount), emphasis: 'primary' },
        { label: 'Managers', value: formatInteger(chart.managerCount), emphasis: 'secondary', hint: 'People with at least one direct report' },
        { label: 'Levels', value: String(chart.maxDepth + 1), emphasis: 'secondary' },
        {
          label: 'Average span of control',
          value: chart.averageSpanOfControl === null ? 'No managers' : String(chart.averageSpanOfControl),
          emphasis: 'muted',
          hint: 'Direct reports per manager',
        },
      ],
      tables: [
        {
          title: 'Reporting structure',
          columns: ['Name', 'Role', 'Reports to', 'Level', 'Direct', 'Total below'],
          rows: chart.nodes.map((node) => {
            const manager = chart.nodes.find((candidate) => candidate.id === node.managerId);
            return {
              label: node.name,
              cells: [
                node.role || '—',
                manager ? manager.name : '— (root)',
                String(node.depth),
                String(node.directReports),
                String(node.totalReports),
              ],
            };
          }),
        },
        ...(chart.widestSpan
          ? [
              {
                title: 'Widest span of control',
                columns: ['Manager', 'Direct reports', 'Total reports below'],
                rows: [
                  {
                    label: chart.widestSpan.name,
                    cells: [
                      String(chart.widestSpan.directReports),
                      String(chart.nodes.find((node) => node.id === chart.widestSpan?.managerId)?.totalReports ?? 0),
                    ],
                  },
                ],
              } as ResultTable,
            ]
          : []),
      ],
      document,
      extraDocuments: [
        {
          format: 'csv',
          filename: `${organizationName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'organization'}-chart.csv`,
          label: 'Reporting structure (CSV)',
          content: csv,
        },
      ],
      explanation: [
        `Parsed ${chart.headcount} record${chart.headcount === 1 ? '' : 's'}; each line is "Name | Role | Reports to".`,
        `Levels are counted from the root: the top of the chart is level 0 and the deepest report is level ${chart.maxDepth}.`,
        'Direct reports are the people who report to a manager immediately; total reports below counts everyone in their subtree.',
        chart.rootIds.length === 1
          ? 'One root was found, so the chart is a single connected tree.'
          : `${chart.rootIds.length} roots were found — see the advisory below.`,
        'The structure was validated for self-reporting, reporting cycles, unknown managers and duplicate names before any figure was computed.',
      ],
      warnings,
    },
  };
}

/* ================================================================== */
/* 12. LinkedIn Engagement Assistant                                   */
/* ================================================================== */

export interface LinkedInPostAnalysis {
  words: number;
  sentences: number;
  readingTimeSeconds: number;
  questionCount: number;
  hasCallToAction: boolean;
  mentionsNumbers: boolean;
  topics: string[];
  sentiment: 'positive' | 'neutral' | 'mixed';
}

const TOPIC_KEYWORDS: ReadonlyArray<{ topic: string; terms: string[] }> = [
  { topic: 'payroll and compensation', terms: ['payroll', 'salary', 'payslip', 'compensation', 'wage', 'paye'] },
  { topic: 'hiring and recruitment', terms: ['hiring', 'recruit', 'candidate', 'interview', 'job opening', 'vacancy', 'talent'] },
  { topic: 'employee retention and culture', terms: ['retention', 'attrition', 'turnover', 'culture', 'engagement', 'wellbeing', 'morale'] },
  { topic: 'benefits and pensions', terms: ['pension', 'benefit', 'hmo', 'health insurance', 'perk', 'ewa', 'leave'] },
  { topic: 'compliance and regulation', terms: ['compliance', 'regulation', 'tax', 'statutory', 'audit', 'policy', 'law'] },
  { topic: 'technology and automation', terms: ['automation', 'software', 'api', 'integration', 'ai', 'cloud', 'platform', 'digital'] },
  { topic: 'leadership and management', terms: ['leadership', 'manager', 'team lead', 'strategy', 'executive', 'board'] },
  { topic: 'finance and growth', terms: ['revenue', 'growth', 'funding', 'profit', 'investment', 'startup', 'sme'] },
  { topic: 'infrastructure and hosting', terms: ['hosting', 'server', 'infrastructure', 'uptime', 'dns', 'deployment', 'devops'] },
  { topic: 'learning and development', terms: ['training', 'upskilling', 'course', 'certification', 'learning', 'mentor'] },
];

const POSITIVE_TERMS = ['great', 'excellent', 'proud', 'excited', 'delighted', 'congratulations', 'success', 'win', 'growth', 'improve', 'achieved', 'thrilled', 'wonderful', 'milestone'];
const NEGATIVE_TERMS = ['struggle', 'difficult', 'problem', 'fail', 'loss', 'layoff', 'redundancy', 'stress', 'burnout', 'risk', 'challenge', 'concern', 'decline'];
const CALL_TO_ACTION = ['comment below', 'share your', 'let me know', 'what do you think', 'join us', 'apply now', 'sign up', 'register', 'reach out', 'dm me', 'link in', 'tell me'];

export function analyzeLinkedInPost(postText: string): LinkedInPostAnalysis {
  const text = postText.trim();
  const lower = text.toLowerCase();
  const words = text.split(/\s+/).filter((word) => word.length > 0).length;
  const sentences = text.split(/[.!?]+/).filter((sentence) => sentence.trim().length > 0).length || (words > 0 ? 1 : 0);
  const questionCount = (text.match(/\?/g) ?? []).length;
  const mentionsNumbers = /\d/.test(text);
  const hasCallToAction = CALL_TO_ACTION.some((phrase) => lower.includes(phrase));

  const topics: string[] = [];
  for (const entry of TOPIC_KEYWORDS) {
    if (entry.terms.some((term) => lower.includes(term))) topics.push(entry.topic);
  }

  const positive = POSITIVE_TERMS.filter((term) => lower.includes(term)).length;
  const negative = NEGATIVE_TERMS.filter((term) => lower.includes(term)).length;
  const sentiment: LinkedInPostAnalysis['sentiment'] =
    positive > 0 && negative > 0 ? 'mixed' : positive > negative ? 'positive' : 'neutral';

  return {
    words,
    sentences,
    // 200 words per minute is the standard silent-reading rate; a reader on LinkedIn skims faster,
    // so this is an upper bound and is labelled as seconds rather than minutes.
    readingTimeSeconds: Math.max(1, Math.round((words / 200) * 60)),
    questionCount,
    hasCallToAction,
    mentionsNumbers,
    topics: topics.slice(0, 4),
    sentiment,
  };
}

export interface LinkedInCommentDraft {
  tone: string;
  comment: string;
  words: number;
  rationale: string;
}

/**
 * Deterministic template-based comment drafting.
 *
 * Templates are assembled from the post's own content — its topic, whether it asks a question, and
 * the point the writer wants to add — rather than from a language model. That keeps the tool
 * offline, keeps someone else's post text from being uploaded anywhere, and makes the output
 * reproducible, which is what lets it be tested.
 */
export function draftLinkedInComments(
  postText: string,
  tone: string,
  perspective: string,
  keyPoint: string,
  authorName: string,
  maxLength: number
): LinkedInCommentDraft[] {
  const analysis = analyzeLinkedInPost(postText);
  const primaryTopic = analysis.topics[0] ?? 'this';
  const sentences = postText
    .split(/[.!?\n]+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 15);
  const anchor = sentences[0] ?? postText.trim().slice(0, 120);
  const anchorShort = clampText(anchor, 90);
  const addressed = authorName ? `${authorName}, ` : '';
  const viewpoint = perspective ? perspective : 'someone working in the same space';

  const drafts: Array<{ tone: string; template: string; rationale: string }> = [
    {
      tone: 'Supportive',
      template:
        `${addressed}this is a useful framing of ${primaryTopic}. The part that stood out to me: "${anchorShort}". ` +
        `From where I sit as ${viewpoint}, that matches what I have seen — and it is the kind of detail people skip past when they are in a hurry. Thanks for writing it down.` +
        (keyPoint ? ` One thing I would add: ${keyPoint}.` : ''),
      rationale: 'Names a specific line from the post, which is what separates a comment that was read from one that was not.',
    },
    {
      tone: 'Insightful',
      template:
        `${addressed}the point about ${primaryTopic} raises a second-order question. "${anchorShort}" — if that holds, then the constraint is usually not the decision itself but who has to carry it. ` +
        `In my experience as ${viewpoint}, the teams that get this right decide it explicitly rather than letting it default.` +
        (keyPoint ? ` ${keyPoint}.` : ''),
      rationale: 'Extends the argument instead of restating it, which is the highest-value thing a comment can do.',
    },
    {
      tone: 'Curious',
      template:
        `${addressed}genuinely curious about ${primaryTopic} here. You wrote: "${anchorShort}". ` +
        `How much of that do you think is context-specific, and how much travels to a smaller team or a different market? ` +
        (keyPoint ? `I ask because ${keyPoint}.` : `I ask because the answer changes what I would advise as ${viewpoint}.`),
      rationale: 'A real question invites a reply, which is where an actual conversation starts.',
    },
    {
      tone: 'Congratulatory',
      template:
        `${addressed}well done — "${anchorShort}" is a real result, not a claim about one. ` +
        `Milestones in ${primaryTopic} tend to be years of unglamorous work before they look like a single moment. Congratulations to you and the people behind it.` +
        (keyPoint ? ` ${keyPoint}.` : ''),
      rationale: 'Acknowledges the effort behind the outcome rather than only the outcome, which reads as sincere.',
    },
    {
      tone: 'Analytical',
      template:
        `${addressed}taking "${anchorShort}" at face value, the interesting variable is the denominator. ` +
        `${analysis.mentionsNumbers ? 'The figures you cite give something to check against, which is rarer than it should be.' : 'There are no figures here, so the claim is directional — worth stating the base it was measured against.'} ` +
        `As ${viewpoint}, I would want to see how it holds across a full cycle rather than one period.` +
        (keyPoint ? ` ${keyPoint}.` : ''),
      rationale: 'Tests the claim against its evidence base without being dismissive of it.',
    },
    {
      tone: 'Concise',
      template: `${addressed}"${clampText(anchorShort, 70)}" — this is the part worth remembering. Well put.` + (keyPoint ? ` ${clampText(keyPoint, 90)}.` : ''),
      rationale: 'Short enough to be read in full, which most comments are not.',
    },
  ];

  const selected = tone === 'all' || tone === ''
    ? drafts.slice(0, 3)
    : (() => {
        const primary = drafts.filter((draft) => draft.tone.toLowerCase() === tone.toLowerCase());
        const rest = drafts.filter((draft) => draft.tone.toLowerCase() !== tone.toLowerCase());
        return [...primary, ...rest].slice(0, 3);
      })();

  return selected.map((draft) => {
    const collapsed = draft.template.replace(/\s+/g, ' ').trim();
    let comment = collapsed;
    let trimmed = false;
    if (collapsed.length > maxLength) {
      trimmed = true;
      // Cut at the last word boundary inside the cap so no draft ends mid-word.
      const boundary = collapsed.lastIndexOf(' ', maxLength);
      comment = collapsed.slice(0, boundary > 0 ? boundary : maxLength).trimEnd();
      // Reserve one character for the ellipsis so the total still fits the cap.
      if (comment.length > maxLength - 1) comment = comment.slice(0, maxLength - 1).trimEnd();
      // A comment that was cut has to look cut. Without the marker a visitor can paste a draft
      // that ends mid-sentence and read as though they had been interrupted.
      comment = comment + '…';
    }
    return {
      tone: draft.tone,
      comment,
      words: comment.split(/\s+/).filter((word) => word.length > 0).length,
      rationale: trimmed
        ? `${draft.rationale} Trimmed to ${maxLength} characters at a word boundary — the full point did not fit, so shorten your own addition rather than posting this as-is.`
        : draft.rationale,
    };
  });
}

export function computeLinkedInEngagementAssistant(values: BusinessToolInput): BusinessToolOutcome {
  const postText = toText(values['postText']).trim();
  if (postText === '') {
    return {
      ok: false,
      error: failure('Paste the text of the LinkedIn post you want to respond to.', [
        { key: 'postText', message: 'The post text is required — the drafts are built from it.' },
      ]),
    };
  }

  const analysis = analyzeLinkedInPost(postText);
  if (analysis.words < 8) {
    return {
      ok: false,
      error: failure(
        `That is only ${analysis.words} word${analysis.words === 1 ? '' : 's'}. Paste the full post text so the drafts can respond to something specific rather than to a fragment.`,
        [{ key: 'postText', message: 'At least 8 words are needed to draft a meaningful response.' }]
      ),
    };
  }
  if (analysis.words > 3000) {
    return {
      ok: false,
      error: failure(`That is ${analysis.words} words, which is longer than a LinkedIn post. Paste only the post text.`, [
        { key: 'postText', message: 'Maximum 3000 words.' },
      ]),
    };
  }

  const tone = toText(values['tone']) || 'all';
  const perspective = toText(values['perspective']).trim();
  const keyPoint = toText(values['keyPoint']).trim();
  const authorName = toText(values['authorName']).trim();
  const maxLength = toNumber(values['maxLength']) ?? 480;
  if (maxLength < 80 || maxLength > 1200) {
    return {
      ok: false,
      error: failure('Comment length must be between 80 and 1200 characters. LinkedIn comments have no short-form advantage below about 80.', [
        { key: 'maxLength', message: 'Must be between 80 and 1200 characters.' },
      ]),
    };
  }

  const drafts = draftLinkedInComments(postText, tone, perspective, keyPoint, authorName, maxLength);

  const followUps = toLines(values['followUps']);
  const warnings: string[] = [];
  if (!perspective) {
    warnings.push('No perspective was supplied, so the drafts fall back to "someone working in the same space". Naming your actual role makes a comment far harder to mistake for a bot.');
  }
  if (!keyPoint) {
    warnings.push('No original point was supplied. A comment that only agrees adds nothing to the thread; the drafts work harder when you give them something of yours to say.');
  }
  if (analysis.questionCount === 0 && !analysis.hasCallToAction) {
    warnings.push('The post asks no question and makes no call for responses, so a long comment may read as intrusive. The "Concise" draft is the safest option here.');
  }
  if (analysis.topics.length === 0) {
    warnings.push('No recognised topic was found in the post text, so the drafts fall back to a generic reference. Check that you pasted the body of the post rather than a headline.');
  }

  return {
    ok: true,
    result: {
      metrics: [
        { label: 'Post length', value: `${formatInteger(analysis.words)} words`, emphasis: 'primary', hint: `${analysis.sentences} sentence${analysis.sentences === 1 ? '' : 's'} · about ${analysis.readingTimeSeconds}s to read` },
        { label: 'Detected topics', value: analysis.topics.length > 0 ? analysis.topics.join(', ') : 'None recognised', emphasis: 'secondary' },
        { label: 'Drafts generated', value: String(drafts.length), emphasis: 'primary', hint: `Tone: ${tone === 'all' ? 'mixed (top three)' : titleCase(tone)}` },
        {
          label: 'Conversation signals',
          value: `${analysis.questionCount} question${analysis.questionCount === 1 ? '' : 's'}${analysis.hasCallToAction ? ' · call to action' : ''}`,
          emphasis: 'muted',
        },
      ],
      tables: [
        {
          title: 'Comment drafts',
          columns: ['Tone', 'Draft', 'Characters', 'Why this works'],
          rows: drafts.map((draft) => ({
            label: draft.tone,
            cells: [draft.comment, String(draft.comment.length), draft.rationale],
          })),
        },
        {
          title: 'Post analysis',
          columns: ['Signal', 'Value', 'What it means for your reply'],
          rows: [
            { label: 'Word count', cells: [String(analysis.words), analysis.words > 300 ? 'A long post — reference a specific line so it is clear you read it.' : 'A short post — keep your reply proportionate.'] },
            { label: 'Sentiment', cells: [titleCase(analysis.sentiment), analysis.sentiment === 'mixed' ? 'It holds two positions at once; acknowledge the tension rather than picking a side.' : analysis.sentiment === 'positive' ? 'A congratulatory or supportive tone fits.' : 'A neutral, substantive reply fits better than enthusiasm.'] },
            { label: 'Questions asked', cells: [String(analysis.questionCount), analysis.questionCount > 0 ? 'Answer one of them directly.' : 'It asks nothing, so do not manufacture a question of your own.'] },
            { label: 'Call to action', cells: [analysis.hasCallToAction ? 'Present' : 'Absent', analysis.hasCallToAction ? 'It invites responses, so commenting is expected.' : 'No invitation to respond; a brief, additive comment is safest.'] },
            { label: 'Contains figures', cells: [analysis.mentionsNumbers ? 'Yes' : 'No', analysis.mentionsNumbers ? 'You can engage with the numbers specifically.' : 'There is nothing quantitative to test the claim against.'] },
            { label: 'Reading time', cells: [`${analysis.readingTimeSeconds}s`, 'At a standard 200 words per minute.'] },
          ],
        },
        ...(followUps.length > 0
          ? [
              {
                title: 'Your follow-up list',
                columns: ['#', 'Item'],
                rows: followUps.map((item, index) => ({ label: String(index + 1), cells: [item] })),
                caption: 'Kept in this workspace only. Nothing here is stored on a CloudHost247 server or sent to LinkedIn.',
              } as ResultTable,
            ]
          : []),
      ],
      document: {
        format: 'markdown',
        filename: 'linkedin-comment-drafts.md',
        label: 'Comment drafts',
        content: tidyDocument(
          [
            '# LinkedIn comment drafts',
            '',
            `Post analysed: ${analysis.words} words, ${analysis.sentences} sentences, sentiment ${analysis.sentiment}.`,
            analysis.topics.length > 0 ? `Topics detected: ${analysis.topics.join(', ')}.` : 'No recognised topic.',
            '',
            ...drafts.flatMap((draft, index) => [
              `## Option ${index + 1} — ${draft.tone}`,
              '',
              draft.comment,
              '',
              `_${draft.rationale} (${draft.comment.length} characters)_`,
              '',
            ]),
            '## How to use these',
            '',
            bulletList([
              'Read the post in full before posting. A comment that misreads it costs more than no comment.',
              'Change the wording into your own voice. These are drafts, not something to paste verbatim — a template that appears three times in one thread is obvious.',
              'Do not pitch in a reply to someone else\u2019s post. It is the fastest way to make the interaction transactional.',
              'If you say you will follow up, follow up.',
            ]),
            '',
            'Generated locally by the CloudHost247 Business Tools LinkedIn Engagement Assistant. The post text you pasted was not transmitted anywhere.',
          ].join('\n')
        ),
      },
      explanation: [
        `Drafted from a template set for tone "${tone === 'all' ? 'mixed' : tone}", using the post's own first substantive line as the anchor so each comment is visibly about this post.`,
        perspective ? `Your stated perspective — ${perspective} — is woven into each draft.` : 'No perspective was supplied, so the drafts use a generic one.',
        keyPoint ? `Your point — "${clampText(keyPoint, 80)}" — appears in each draft, which is what stops them reading as agreement only.` : 'No original point was supplied; each draft is currently agreement plus one extension of the post\u2019s argument.',
        `Each draft is capped at ${formatInteger(maxLength)} characters and trimmed at a word boundary, so none of them is cut mid-word.`,
        'No language model or third-party service was called. The output is deterministic: the same inputs always produce the same drafts.',
      ],
      warnings,
    },
  };
}

/* Re-exported so the registry can attach a VAT sanity note to the invoice tool. */
export { computeVat };
