/**
 * Shipping Label Generator.
 *
 * A carrier-neutral parcel label: sender, recipient, shipment details and a barcode, one label per
 * package, at the 4 × 6 inch and A6 sizes label printers take.
 *
 * It deliberately carries no carrier's name, logo or routing code. A carrier label is issued by the
 * carrier against a booking; this one is for your own dispatch, for marketplaces that accept a plain
 * address label, and for pallets and cartons identified by your own reference or by an SSCC.
 *
 * The SSCC option draws a GS1-128 symbol with a 0.5 mm module and 32 mm bars and gives every package
 * its own serial number with a correct check digit. Nothing here assigns a company prefix or claims
 * that the label as a whole meets a trading partner's logistic label specification.
 */

import { invalidInput } from '../../core/errors';
import type { ToolInput } from '../../handlers/kit';
import type { StudioSurface } from '../render/draw-ops';
import { SANS_METRICS } from '../render/text-metrics';
import { buildVectorPdf, type PdfPageSpec } from '../render/pdf-vector';
import { surfaceToSvg } from '../render/svg';
import { SHIPPING_BARCODES, SHIPPING_FIELDS, SHIPPING_PACKAGE_LIMIT, SHIPPING_SHEETS, SHIPPING_SIZES, type ShippingBarcode, type ShippingSize } from '../definitions';
import { LabelCanvas, type Box, type StackItem } from '../shared/compose';
import { nextSscc, resolveSscc } from '../shared/gs1';
import { imposeOnSheet, onePerPage } from '../shared/impose';
import { choiceOf, fieldText, flag, refusable, wholeNumber } from '../shared/input';
import { binaryFile, fileStem, mmText, previewOf, sheetPreview, sizeText, textFile, type StudioFact, type StudioResult } from '../shared/result';
import { labelSheet } from '../shared/sheets';

const CAP = SANS_METRICS.capHeight;
const CAPTION = 2.1;
const GREY = '#333333';

export interface ShippingData {
  values: Record<string, string>;
  barcode: ShippingBarcode;
  /** What the main barcode encodes on this package, or '' for none. */
  barcodeData: string;
  /** The line printed under the main barcode. */
  barcodeText: string;
  postcodeBarcode: boolean;
  packageIndex: number;
  packageCount: number;
}

export interface ShippingArtwork {
  surface: StudioSurface;
  notices: string[];
  /** Every barcode on the label, in drawing order, with what it is for. */
  symbols: Array<{ role: 'Postal code barcode' | 'Reference barcode' | 'SSCC barcode'; name: string; moduleMm: number; data: string }>;
}

function caption(canvas: LabelCanvas, text: string, x: number, top: number): void {
  canvas.text(text, x, top + CAPTION * CAP, { size: CAPTION, weight: '700', color: GREY });
}

export function drawShippingLabel(width: number, height: number, data: ShippingData): ShippingArtwork {
  const canvas = new LabelCanvas(width, height);
  const roles: ShippingArtwork['symbols'][number]['role'][] = [];
  const frame: Box = { x: 2.5, y: 2.5, w: width - 5, h: height - 5 };
  const pad = 2.5;
  const left = frame.x + pad;
  const inner = frame.w - 2 * pad;
  const right = left + inner;
  const value = (name: string): string => data.values[name] ?? '';
  const rule = (y: number, weight = 0.5): void => canvas.line(frame.x, y, frame.x + frame.w, y, weight);

  // Heights are fixed from the bottom up, and the recipient takes everything that is left: the
  // delivery address is the one part of the label that should be as large as it can be.
  const topHeight = 21;
  const infoHeight = 11;
  const noteHeight = value('note') === '' ? 0 : 8;
  const postcode = value('toPostcode');
  const postHeight = data.postcodeBarcode && postcode !== '' ? 18 : 0;
  const mainHeight = data.barcodeData === '' ? 0 : data.barcode === 'sscc' ? 42 : 32;

  let y = frame.y;

  // ----- Sender, package count and weight -----
  const split = left + inner * 0.64;
  caption(canvas, 'FROM', left, y + 1.5);
  canvas.stack(
    { x: left, y: y + 1.5 + CAPTION * CAP + 1.1, w: split - left - 2, h: topHeight - (1.5 + CAPTION * CAP + 1.1) - 1.2 },
    [
      { text: value('fromName'), size: 3, weight: '700' },
      { text: value('fromAddress'), size: 2.7, maxLines: 4, what: 'The sender address' },
    ],
    1,
    'left',
    'top'
  );
  canvas.line(split, y, split, y + topHeight, 0.3);
  const side: Box = { x: split + 2, y: y + 1.5, w: right - split - 2, h: topHeight - 3 };
  caption(canvas, 'PACKAGE', side.x, side.y);
  canvas.lineIn(`${data.packageIndex} of ${data.packageCount}`, { x: side.x, y: side.y + CAPTION * CAP + 1.2, w: side.w, h: 4.2 }, { size: 5.6, weight: '700' });
  if (value('weight') !== '') {
    const weightTop = side.y + CAPTION * CAP + 1.2 + 5.6 * CAP + 2.2;
    caption(canvas, 'WEIGHT', side.x, weightTop);
    canvas.lineIn(value('weight'), { x: side.x, y: weightTop + CAPTION * CAP + 1.1, w: side.w, h: 3 }, { size: 3.8, weight: '700' });
  }
  y += topHeight;
  rule(y);

  // ----- Recipient -----
  const recipientHeight = frame.y + frame.h - y - infoHeight - postHeight - mainHeight - noteHeight;
  caption(canvas, 'SHIP TO', left, y + 1.8);
  const cityLine = [postcode, value('toCity')].filter((part) => part !== '').join(' ');
  const items: StackItem[] = [
    { text: value('toName'), size: 5.4, weight: '700' },
    { text: value('toCompany'), size: 4.4 },
    { text: value('toAddress'), size: 4.4, maxLines: 3, what: 'The street address' },
    { text: cityLine, size: 5, weight: '700' },
    { text: value('toRegion'), size: 4.4 },
    { text: value('toCountry').toUpperCase(), size: 4.6, weight: '700' },
    { text: value('toPhone') === '' ? '' : `Tel. ${value('toPhone')}`, size: 3.2 },
  ];
  const recipientTop = y + 1.8 + CAPTION * CAP + 1.6;
  canvas.stack({ x: left + 5, y: recipientTop, w: inner - 7, h: y + recipientHeight - 1.8 - recipientTop }, items, 1.7, 'left', 'middle');
  y += recipientHeight;
  rule(y);

  // ----- Service, reference, date -----
  const cells: Array<[string, string]> = [
    ['SERVICE', value('service')],
    ['REFERENCE', value('reference')],
    ['DATE', value('date')],
  ];
  const cellWidth = frame.w / cells.length;
  cells.forEach(([label, text], index) => {
    const x = frame.x + index * cellWidth;
    if (index > 0) canvas.line(x, y, x, y + infoHeight, 0.3);
    caption(canvas, label, x + pad, y + 1.5);
    canvas.lineIn(text, { x: x + pad, y: y + 1.5 + CAPTION * CAP + 1.4, w: cellWidth - 2 * pad, h: 3 }, { size: 3.6, weight: '700' });
  });
  y += infoHeight;

  // ----- Postal code as a barcode -----
  if (postHeight > 0) {
    rule(y, 0.3);
    caption(canvas, 'POSTAL CODE', left, y + 1.5);
    const top = y + 1.5 + CAPTION * CAP + 1.2;
    const codeBox: Box = { x: left, y: top, w: inner * 0.58, h: y + postHeight - 1.4 - top };
    canvas.symbol({ symbology: 'code128', data: postcode.toUpperCase().replace(/\s+/g, ''), what: 'The postal code barcode', moduleMm: 0.4, align: 'left', valign: 'middle' }, codeBox);
    roles.push('Postal code barcode');
    const textBox: Box = { x: left + inner * 0.6, y, w: inner * 0.4, h: postHeight };
    const natural = canvas.measure(postcode, { size: 1, weight: '700' });
    const size = Math.min(8.5 / CAP, natural > 0 ? textBox.w / natural : 8);
    canvas.lineIn(postcode, textBox, { size, weight: '700', align: 'right', valign: 'middle' });
    y += postHeight;
  }

  // ----- Main barcode -----
  if (mainHeight > 0) {
    rule(y);
    const sscc = data.barcode === 'sscc';
    caption(canvas, sscc ? 'SSCC' : 'REFERENCE', left, y + 1.5);
    const top = y + 1.5 + CAPTION * CAP + 1.2;
    const textSize = 3.6;
    const textTop = y + mainHeight - 1.6 - textSize * CAP;
    canvas.symbol(
      sscc
        ? { symbology: 'sscc18', data: data.barcodeData, what: 'The SSCC barcode', moduleMm: 0.5, minModuleMm: 0.33, barHeightMm: 32, valign: 'top' }
        : { symbology: 'code128', data: data.barcodeData, what: 'The reference barcode', moduleMm: 0.4, maxBarHeightMm: 22, valign: 'top' },
      { x: left, y: top, w: inner, h: textTop - 1.2 - top }
    );
    roles.push(sscc ? 'SSCC barcode' : 'Reference barcode');
    canvas.lineIn(data.barcodeText, { x: left, y: textTop, w: inner, h: textSize * CAP }, { size: textSize, weight: '700', align: 'center' });
    y += mainHeight;
  }

  // ----- Handling note -----
  if (noteHeight > 0) {
    rule(y);
    canvas.lineIn(value('note').toUpperCase(), { x: left, y, w: inner, h: noteHeight }, { size: 4, weight: '700', align: 'center', valign: 'middle' });
  }

  canvas.frame(frame, 0.6);
  const { surface, notices } = canvas.finish();
  return {
    surface,
    notices,
    symbols: canvas.symbols.map((placed, index) => ({ role: roles[index] ?? 'Reference barcode', name: placed.symbologyName, moduleMm: placed.moduleMm, data: placed.data })),
  };
}

export async function runShippingLabel(input: ToolInput): Promise<StudioResult> {
  const sizeId = choiceOf(input, 'size', 'Label size', SHIPPING_SIZES.map((entry) => entry.id), '4x6') as ShippingSize;
  const size = SHIPPING_SIZES.find((entry) => entry.id === sizeId) ?? SHIPPING_SIZES[0];
  const barcode = choiceOf(input, 'barcode', 'Barcode', SHIPPING_BARCODES.map((entry) => entry.id), 'reference') as ShippingBarcode;
  const sheetId = choiceOf(input, 'sheet', 'Paper', SHIPPING_SHEETS.map((entry) => entry.id), 'none');
  const packages = wholeNumber(input, 'packages', 'Number of packages', { min: 1, max: SHIPPING_PACKAGE_LIMIT, fallback: 1 });
  const postcodeBarcode = flag(input, 'postcodeBarcode', false);

  const values: Record<string, string> = {};
  for (const field of SHIPPING_FIELDS) {
    values[field.name] = fieldText(input, {
      name: field.name,
      label: field.label,
      maxLength: field.maxLength,
      multiline: field.type === 'textarea',
      ...(field.required ? { required: true } : {}),
      ...(field.maxLines !== undefined ? { maxLines: field.maxLines } : {}),
    });
  }

  let firstSscc: string | null = null;
  if (barcode === 'sscc') {
    const raw = fieldText(input, { name: 'sscc', label: 'SSCC', maxLength: 30, required: true });
    const resolved = resolveSscc(raw);
    if (!resolved.ok) throw invalidInput(resolved.message);
    firstSscc = resolved.sscc;
    if (nextSscc(firstSscc, packages - 1) === null) throw invalidInput('The SSCC serial number runs out before the last package. Start from a lower number.');
  } else if (barcode !== 'none' && (values.reference ?? '') === '') {
    throw invalidInput('Enter a reference or order number to print as the barcode, or choose “No barcode”.');
  }

  const artworks: ShippingArtwork[] = [];
  for (let index = 1; index <= packages; index += 1) {
    let barcodeData = '';
    let barcodeText = '';
    if (barcode === 'sscc' && firstSscc) {
      const sscc = nextSscc(firstSscc, index - 1) as string;
      barcodeData = `(00)${sscc}`;
      barcodeText = `(00) ${sscc}`;
    } else if (barcode === 'reference') {
      barcodeData = values.reference ?? '';
      barcodeText = barcodeData;
    } else if (barcode === 'reference-package') {
      barcodeData = `${values.reference ?? ''}-${index}`;
      barcodeText = barcodeData;
    }
    const data: ShippingData = { values, barcode, barcodeData, barcodeText, postcodeBarcode, packageIndex: index, packageCount: packages };
    artworks.push(refusable(() => drawShippingLabel(size.width, size.height, data)));
  }
  const surfaces = artworks.map((artwork) => artwork.surface);
  const first = artworks[0] as ShippingArtwork;

  let pages: PdfPageSpec[];
  let sheets = 0;
  if (sheetId !== 'none') {
    const layout = labelSheet(sheetId);
    if (!layout) throw invalidInput('That sheet layout is not available.');
    const imposed = refusable(() => imposeOnSheet(surfaces, layout));
    pages = imposed.pages;
    sheets = imposed.sheets;
  } else {
    pages = refusable(() => onePerPage(surfaces));
  }
  const pdf = buildVectorPdf(pages, { title: 'Shipping label | CloudHost247', subject: `Shipping label, ${sizeText(size.width, size.height)}` });
  const stem = fileStem(`shipping-label-${sizeId}`, 'shipping-label');

  const notices: string[] = [
    'This is a carrier-neutral label. It does not replace a label issued by a carrier for a booked shipment, and it carries no carrier routing code.',
  ];
  if (barcode === 'sscc') {
    notices.push('Each package has its own SSCC with a calculated check digit. Use a serial range you have allocated under your own GS1 company prefix; whether the label meets a trading partner’s logistic label specification is for you to confirm.');
  }
  if (postcodeBarcode && (values.toPostcode ?? '') !== '') {
    notices.push('The postal code barcode is a plain Code 128 of the postal code for your own sorting. It is not a postal operator’s routing barcode.');
  }
  notices.push(sheetId === 'none' ? 'Each PDF page is exactly one label. Print at 100% / “Actual size”.' : 'Print at 100% / “Actual size” with page scaling off, then cut the labels apart.');
  const seen = new Set(notices);
  for (const artwork of artworks) {
    for (const notice of artwork.notices) {
      if (!seen.has(notice)) {
        seen.add(notice);
        notices.push(notice);
      }
    }
  }

  const facts: StudioFact[] = [
    { label: 'Label size', value: size.label },
    { label: 'Packages', value: sheetId === 'none' ? `${packages}` : `${packages} on ${sheets} ${sheets === 1 ? 'sheet' : 'sheets'}` },
    // Each package has its own SSCC or its own numbered reference, so that fact names the package
    // it describes. The postal code barcode is the same on all of them.
    ...first.symbols.map((symbol) => ({
      label: `${symbol.role}${packages > 1 && symbol.role !== 'Postal code barcode' && barcode !== 'reference' ? ' on package 1' : ''}`,
      value: `${symbol.name}, ${mmText(symbol.moduleMm)} mm module, encodes “${symbol.data}”`,
    })),
  ];
  if (barcode === 'sscc' && firstSscc && packages > 1) {
    facts.push({ label: 'SSCC range', value: `${firstSscc} to ${nextSscc(firstSscc, packages - 1) ?? ''}` });
  }

  const previews = [previewOf(first.surface, packages > 1 ? `Package 1 of ${packages}` : 'Label')];
  const firstPage = pages[0];
  if (sheetId !== 'none' && firstPage) previews.push(sheetPreview(firstPage, sheets > 1 ? `Sheet 1 of ${sheets}` : 'Sheet'));

  return {
    studio: true,
    title: 'Shipping label',
    previews,
    files: [
      binaryFile(`${stem}.pdf`, 'application/pdf', pdf.bytes, sheetId !== 'none' ? `Download PDF (${sheets} ${sheets === 1 ? 'sheet' : 'sheets'})` : packages === 1 ? 'Download PDF' : `Download PDF (${packages} labels)`, 'The print file. Vector, at true size.'),
      textFile(`${stem}.svg`, 'image/svg+xml', surfaceToSvg(first.surface, { title: 'Shipping label' }), 'Download SVG (first label)', 'Vector artwork of the first label.'),
    ],
    facts,
    notices,
    count: packages,
  };
}
