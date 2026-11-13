/**
 * QR Code Business Cards.
 *
 * A business card whose 2D code holds the same contact the card prints, as a vCard or a MeCard, so
 * scanning it saves the person to a phone's contacts. The card is drawn as vector artwork at its
 * real size and delivered as a print-ready PDF: a single card, or a sheet of cards with cut marks.
 *
 * The code is always black on white, whatever the accent colour, because that is what cameras read
 * most reliably. Its module width is as large as the layout allows and never below 0.3 mm; contact
 * details too long to fit at that size are refused with advice instead of being printed too fine
 * to scan.
 */

import { invalidInput } from '../../core/errors';
import type { ToolInput } from '../../handlers/kit';
import type { StudioSurface } from '../render/draw-ops';
import { buildVectorPdf, type PdfPageSpec } from '../render/pdf-vector';
import { surfaceToSvg } from '../render/svg';
import { BarcodeError } from '../barcode/encoder';
import { CARD_CODES, CARD_FIELDS, CARD_LAYOUTS, CARD_PAYLOADS, CARD_SHEETS, CARD_SIZES, type CardLayout, type CardSize } from '../definitions';
import { LabelCanvas, inset, type Box, type PlacedSymbol, type StackItem } from '../shared/compose';
import { buildContactVCard, buildMeCard, contactLines, emptyContact, fullName, type ContactFields } from '../shared/contact';
import { imposeOnSheet, onePerPage } from '../shared/impose';
import { choiceOf, fieldText, hexColour, refusable } from '../shared/input';
import { binaryFile, fileStem, luminance, mmText, previewOf, sheetPreview, sizeText, textFile, type StudioFact, type StudioFile, type StudioResult } from '../shared/result';
import { centredGrid, pageSize } from '../shared/sheets';

const MARGIN = 5;
const MIN_MODULE = 0.3;
const INK = '#111111';
const SOFT_INK = '#2b2b2b';
export const DEFAULT_ACCENT = '#0f4c81';

export interface CardDesign {
  width: number;
  height: number;
  layout: CardLayout;
  accent: string;
  symbology: 'qrcode' | 'datamatrix';
  eclevel: string;
  payload: string;
  contact: ContactFields;
}

export interface CardArtwork {
  front: StudioSurface;
  back: StudioSurface | null;
  notices: string[];
  code: PlacedSymbol;
}

/** Text drawn in the accent colour must stay readable on white; a pale accent falls back to grey. */
function accentInk(accent: string): string {
  return luminance(accent) > 0.4 ? '#3a3a3a' : accent;
}

/** Text drawn on top of the accent colour. */
function onAccent(accent: string): string {
  return luminance(accent) > 0.45 ? '#111111' : '#ffffff';
}

function identityItems(design: CardDesign, scale = 1): StackItem[] {
  const { contact } = design;
  return [
    { text: fullName(contact), size: 4.6 * scale, weight: '700', color: INK },
    { text: contact.jobTitle, size: 2.9 * scale, color: accentInk(design.accent) },
    { text: contact.organization, size: 3 * scale, weight: '700', color: INK },
  ];
}

function detailItems(design: CardDesign): StackItem[] {
  return contactLines(design.contact).map((line) => ({ text: line, size: 2.45, color: SOFT_INK }));
}

function placeCode(canvas: LabelCanvas, design: CardDesign, box: Box, align: 'left' | 'center' | 'right' = 'center'): PlacedSymbol {
  return canvas.symbol(
    {
      symbology: design.symbology,
      data: design.payload,
      // The payload is a finished vCard or MeCard: its CRLF line ends are part of the format.
      verbatim: true,
      what: 'The contact code',
      moduleMm: 1.2,
      minModuleMm: MIN_MODULE,
      reportsOwnSize: true,
      align,
      valign: 'middle',
      ...(design.symbology === 'qrcode' ? { options: { eclevel: design.eclevel } } : {}),
    },
    box
  );
}

function drawClassic(design: CardDesign): { canvas: LabelCanvas; code: PlacedSymbol } {
  const { width: w, height: h } = design;
  const canvas = new LabelCanvas(w, h);
  const bar = 1.8;
  canvas.rect({ x: 0, y: 0, w, h: bar }, { fill: design.accent });
  const side = Math.min(h - 2 * MARGIN - bar, w * 0.37);
  const code = placeCode(canvas, design, { x: w - MARGIN - side, y: bar + (h - bar - side) / 2, w: side, h: side }, 'right');
  const textWidth = code.box.x - 2.5 - MARGIN;
  canvas.stack({ x: MARGIN, y: MARGIN + bar, w: textWidth, h: h * 0.44 - MARGIN - bar }, identityItems(design), 1.5, 'left', 'top');
  canvas.stack({ x: MARGIN, y: h * 0.47, w: textWidth, h: h - MARGIN - h * 0.47 }, detailItems(design), 1.15, 'left', 'bottom');
  return { canvas, code };
}

function drawBand(design: CardDesign): { canvas: LabelCanvas; code: PlacedSymbol } {
  const { width: w, height: h } = design;
  const canvas = new LabelCanvas(w, h);
  const panel = w * 0.42;
  canvas.rect({ x: 0, y: 0, w: panel, h }, { fill: design.accent });
  const tile = Math.min(panel - 5, h - 13);
  const tileBox: Box = { x: (panel - tile) / 2, y: (h - tile) / 2 - 2, w: tile, h: tile };
  canvas.rect(tileBox, { fill: '#ffffff', radius: 1.2 });
  const code = placeCode(canvas, design, inset(tileBox, 0.4));
  canvas.lineIn('Scan to save contact', { x: 2, y: tileBox.y + tile + 2, w: panel - 4, h: 2 }, { size: 2.2, color: onAccent(design.accent), align: 'center' });
  const left = panel + 4.5;
  const textWidth = w - MARGIN - left;
  canvas.stack({ x: left, y: MARGIN + 0.5, w: textWidth, h: h * 0.44 - MARGIN }, identityItems(design, 0.95), 1.5, 'left', 'top');
  canvas.stack({ x: left, y: h * 0.47, w: textWidth, h: h - MARGIN - h * 0.47 }, detailItems(design), 1.15, 'left', 'bottom');
  return { canvas, code };
}

function drawDuplex(design: CardDesign): { canvas: LabelCanvas; back: LabelCanvas; code: PlacedSymbol } {
  const { width: w, height: h } = design;
  const canvas = new LabelCanvas(w, h);
  const middle = h * 0.47;
  canvas.stack({ x: MARGIN, y: MARGIN, w: w - 2 * MARGIN, h: middle - 2.2 - MARGIN }, identityItems(design, 1.08), 1.6, 'center', 'bottom');
  canvas.rect({ x: w / 2 - 7, y: middle - 0.25, w: 14, h: 0.5 }, { fill: design.accent });
  canvas.stack({ x: MARGIN, y: middle + 2.6, w: w - 2 * MARGIN, h: h - MARGIN - middle - 2.6 }, detailItems(design), 1.15, 'center', 'top');

  const back = new LabelCanvas(w, h, design.accent);
  const tile = Math.min(h - 15, w * 0.5);
  const tileBox: Box = { x: (w - tile) / 2, y: (h - tile - 5.5) / 2, w: tile, h: tile };
  back.rect(tileBox, { fill: '#ffffff', radius: 1.5 });
  const code = placeCode(back, design, inset(tileBox, 0.6));
  back.lineIn('Scan to add me to your contacts', { x: MARGIN, y: tileBox.y + tile + 2.4, w: w - 2 * MARGIN, h: 2.4 }, { size: 2.6, color: onAccent(design.accent), align: 'center' });
  return { canvas, back, code };
}

export function drawCard(design: CardDesign): CardArtwork {
  const notices: string[] = [];
  const collect = (canvas: LabelCanvas): StudioSurface => {
    const finished = canvas.finish();
    for (const notice of finished.notices) if (!notices.includes(notice)) notices.push(notice);
    return finished.surface;
  };
  if (design.layout === 'duplex') {
    const drawn = drawDuplex(design);
    return { front: collect(drawn.canvas), back: collect(drawn.back), notices, code: drawn.code };
  }
  const drawn = design.layout === 'band' ? drawBand(design) : drawClassic(design);
  return { front: collect(drawn.canvas), back: null, notices, code: drawn.code };
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function runBusinessCard(input: ToolInput): Promise<StudioResult> {
  const sizeId = choiceOf(input, 'size', 'Card size', CARD_SIZES.map((entry) => entry.id), 'eu') as CardSize;
  const size = CARD_SIZES.find((entry) => entry.id === sizeId) ?? CARD_SIZES[0];
  const layout = choiceOf(input, 'layout', 'Layout', CARD_LAYOUTS.map((entry) => entry.id), 'classic') as CardLayout;
  const symbology = choiceOf(input, 'code', 'Code type', CARD_CODES.map((entry) => entry.id), 'qrcode') as 'qrcode' | 'datamatrix';
  const format = choiceOf(input, 'payload', 'Contact format', CARD_PAYLOADS.map((entry) => entry.id), 'vcard');
  const eclevel = choiceOf(input, 'eclevel', 'Error correction', ['L', 'M', 'Q', 'H'], 'M');
  const sheetId = choiceOf(input, 'sheet', 'Paper', CARD_SHEETS.map((entry) => entry.id), 'none');
  const accent = hexColour(input, 'accent', 'Accent colour', DEFAULT_ACCENT);

  const contact = emptyContact();
  for (const field of CARD_FIELDS) {
    (contact as unknown as Record<string, string>)[field.name] = fieldText(input, { name: field.name, label: field.label, maxLength: field.maxLength, ...(field.required ? { required: true } : {}) });
  }
  if (contact.email !== '' && !looksLikeEmail(contact.email)) throw invalidInput('Email does not look like an email address.');

  const payload = format === 'mecard' ? buildMeCard(contact) : buildContactVCard(contact);
  const design: CardDesign = { width: size.width, height: size.height, layout, accent, symbology, eclevel, payload, contact };

  let artwork: CardArtwork;
  try {
    artwork = drawCard(design);
  } catch (error) {
    if (error instanceof BarcodeError && error.reason === 'size') {
      throw invalidInput(
        'The contact details are too long for a code that scans reliably at this size. Remove a field, choose MeCard or a lower error correction level, or use the two-sided layout, which has room for a larger code.',
        { reason: 'CODE_TOO_DENSE' }
      );
    }
    if (error instanceof BarcodeError) throw invalidInput(error.message, { reason: error.reason });
    throw error;
  }

  // ----- Print file -----
  const sides: StudioSurface[] = artwork.back ? [artwork.front, artwork.back] : [artwork.front];
  let pages: PdfPageSpec[];
  let perSheet = 0;
  let sheetLabel = '';
  if (sheetId !== 'none') {
    const page = pageSize(sheetId);
    const grid = page ? centredGrid(page, size.width, size.height, 0, 8) : null;
    if (!page || !grid) throw invalidInput('That paper size cannot hold a card of this size.');
    perSheet = grid.columns * grid.rows;
    sheetLabel = `${page.label}, ${grid.columns} × ${grid.rows}`;
    pages = sides.flatMap((surface) => refusable(() => imposeOnSheet(Array.from({ length: perSheet }, () => surface), grid, { cropMarks: true })).pages);
  } else {
    pages = refusable(() => onePerPage(sides));
  }
  const name = fullName(contact);
  const pdf = buildVectorPdf(pages, { title: 'Business card | CloudHost247', subject: `Business card, ${sizeText(size.width, size.height)}` });
  const stem = fileStem(`business-card-${name}`, 'business-card');

  const files: StudioFile[] = [
    binaryFile(
      `${stem}.pdf`,
      'application/pdf',
      pdf.bytes,
      sheetId !== 'none' ? `Download PDF (${perSheet} cards per sheet)` : artwork.back ? 'Download PDF (front and back)' : 'Download PDF',
      sheetId !== 'none' ? 'Cards with cut marks, ready for card stock.' : 'One page per side at the exact card size, as print shops ask for.'
    ),
    textFile(`${stem}-front.svg`, 'image/svg+xml', surfaceToSvg(artwork.front, { title: `Business card, front: ${name}` }), artwork.back ? 'Download SVG (front)' : 'Download SVG', 'Vector artwork for other design software.'),
  ];
  if (artwork.back) files.push(textFile(`${stem}-back.svg`, 'image/svg+xml', surfaceToSvg(artwork.back, { title: `Business card, back: ${name}` }), 'Download SVG (back)'));
  files.push(textFile(`${stem}.vcf`, 'text/vcard', `${buildContactVCard(contact)}\r\n`, 'Download vCard (.vcf)', 'The same contact as a file, to attach to email or import.'));

  const notices: string[] = [];
  if (artwork.code.moduleMm < 0.38) {
    notices.push(`The code’s modules are ${mmText(artwork.code.moduleMm)} mm. Phones read that at close range; for an easier scan remove a field, choose MeCard, or lower the error correction.`);
  }
  if (layout !== 'classic') notices.push('The accent colour runs to the cut line without bleed. For professional printing, ask your printer whether they need bleed added.');
  if (sheetId !== 'none') {
    notices.push('Print at 100% / “Actual size” with page scaling off, then cut along the marks.');
    if (artwork.back) notices.push('Page 1 holds the fronts and page 2 the backs. Print double-sided, flipping on the long edge.');
  } else if (artwork.back) {
    notices.push('Page 1 is the front and page 2 is the back.');
  }
  notices.push('Scan the code with a phone before you print a batch.');
  for (const notice of artwork.notices) if (!notices.includes(notice)) notices.push(notice);
  for (const message of pdf.skippedImages) notices.push(message);

  const facts: StudioFact[] = [
    { label: 'Card size', value: size.label },
    { label: 'Layout', value: CARD_LAYOUTS.find((entry) => entry.id === layout)?.label ?? layout },
    { label: 'Code', value: `${artwork.code.symbologyName}, ${mmText(artwork.code.moduleMm)} mm module, ${sizeText(artwork.code.box.w, artwork.code.box.h)} with its quiet zone` },
    { label: 'Contact format', value: `${format === 'mecard' ? 'MeCard' : 'vCard 3.0'}, ${Buffer.byteLength(payload, 'utf8')} bytes` },
    ...(sheetId !== 'none' ? [{ label: 'Sheet', value: `${sheetLabel}: ${perSheet} cards` }] : []),
  ];

  const previews = [previewOf(artwork.front, artwork.back ? 'Front' : 'Card')];
  if (artwork.back) previews.push(previewOf(artwork.back, 'Back'));
  const firstPage = pages[0];
  if (sheetId !== 'none' && firstPage) previews.push(sheetPreview(firstPage, artwork.back ? 'Sheet (fronts)' : 'Sheet'));

  return { studio: true, title: 'Business card', previews, files, facts, notices, count: sheetId !== 'none' ? perSheet : 1 };
}
