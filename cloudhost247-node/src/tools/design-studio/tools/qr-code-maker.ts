/**
 * QR Code Maker.
 *
 * A 2D code that makes a phone do something when it is scanned: open a page, join a Wi-Fi network,
 * save a contact, start a message, add an event, open a map or set up a bank transfer. The person
 * fills in ordinary fields; `shared/qr-content.ts` writes the payload format phones recognise.
 *
 * The files are the Barcode Generator's: SVG and PDF as vectors at the module width asked for, and a
 * PNG whose modules are whole pixels at the resolution it declares. The result states what the code
 * carries, so it can be checked before it is printed. Nothing is stored, and nothing is tracked:
 * the code holds the content itself, not a link through this site, so it works for as long as the
 * content does.
 */

import { invalidInput } from '../../core/errors';
import type { ToolInput } from '../../handlers/kit';
import type { StudioSurface } from '../render/draw-ops';
import { buildVectorPdf } from '../render/pdf-vector';
import { pngDimensions, setPngDpi } from '../render/png-meta';
import { surfaceToSvg } from '../render/svg';
import { BarcodeError, encodeSymbol, renderSymbolPng, translateOps, type EncodeRequest } from '../barcode/encoder';
import { symbologyById, type Symbology } from '../barcode/symbologies';
import { QR_CODE_TYPES, QR_KINDS, type QrKind } from '../definitions';
import { onePerPage } from '../shared/impose';
import { choiceOf, decimalNumber, flag, hexColour, refusable, wholeNumber } from '../shared/input';
import { buildQrContent, qrKindOf } from '../shared/qr-content';
import { binaryFile, contrastNotice, mmText, previewOf, sizeText, textFile, type StudioFact, type StudioFile, type StudioResult } from '../shared/result';

/** How much of a payload a result shows. The whole of it is in the code; this is for checking by eye. */
const SHOWN_LIMIT = 400;

const kindOf = (id: QrKind) => QR_KINDS.find((entry) => entry.id === id) ?? QR_KINDS[0];

/** The history label: what kind of code was made, never what it contains. */
export function qrCodeTarget(input: ToolInput): string {
  try {
    return `QR code for ${kindOf(qrKindOf(input)).noun}`;
  } catch {
    return 'QR code';
  }
}

export async function runQrCodeMaker(input: ToolInput): Promise<StudioResult> {
  const content = buildQrContent(input);
  const kind = kindOf(content.kind);

  const requestedType = choiceOf(input, 'codeType', 'Code type', QR_CODE_TYPES.map((entry) => entry.id), 'qrcode');
  if (content.fixed && requestedType !== content.fixed.symbology) {
    throw invalidInput('A SEPA payment code is a QR Code by its standard. Choose QR Code as the code type.');
  }
  const symbology = symbologyById(requestedType) as Symbology;
  const requestedLevel = choiceOf(input, 'eclevel', 'Error correction', ['L', 'M', 'Q', 'H'], 'M');
  const eclevel = content.fixed?.eclevel ?? requestedLevel;

  const moduleMm = decimalNumber(input, 'moduleMm', 'Size of one square', { min: 0.05, max: 5 });
  const dpi = wholeNumber(input, 'dpi', 'Resolution', { min: 72, max: 1200, fallback: 300 });
  const color = hexColour(input, 'color', 'Code colour', '#000000');
  const transparent = flag(input, 'transparent', false);
  const background = transparent ? null : hexColour(input, 'background', 'Background colour', '#ffffff');

  const request: EncodeRequest = {
    symbology,
    data: content.payload,
    // The payload is a format: a vCard's CRLF line ends and a password's spaces are part of it.
    verbatim: true,
    color,
    ...(symbology.id === 'qrcode' ? { options: { eclevel } } : {}),
    ...(moduleMm !== undefined ? { moduleMm } : {}),
  };

  let surface: StudioSurface;
  let usedModuleMm: number;
  let png: Uint8Array;
  let pngModuleMm: number;
  let pixelsPerModule: number;
  try {
    const symbol = encodeSymbol(request);
    const quiet = symbol.quietMm;
    surface = { width: symbol.width + 2 * quiet, height: symbol.height + 2 * quiet, ops: translateOps(symbol.ops, quiet, quiet), ...(background ? { background } : {}) };
    usedModuleMm = symbol.moduleMm;
    const bitmap = await renderSymbolPng({ ...request, dpi, quietZone: true, ...(background ? { background } : {}) });
    png = setPngDpi(bitmap.png, dpi);
    pngModuleMm = bitmap.moduleMm;
    pixelsPerModule = bitmap.pixelsPerModule;
  } catch (error) {
    if (error instanceof BarcodeError) {
      // The encoder's own message names the barcode type and never the data; say what to do about it.
      throw invalidInput(
        error.reason === 'data' ? `This is more than a ${symbology.name} can hold, or it has characters the code cannot carry. Shorten the content${symbology.id === 'qrcode' ? ' or lower the error correction' : ''}.` : error.message,
        { reason: error.reason }
      );
    }
    throw error;
  }

  const title = `${symbology.name} for ${kind.noun}`;
  const stem = `${symbology.id === 'qrcode' ? 'qr-code' : symbology.id === 'datamatrix' ? 'data-matrix' : 'aztec-code'}-${content.kind}`;
  const pdf = buildVectorPdf(refusable(() => onePerPage([surface])), { title: `${title} | CloudHost247 QR Code Maker`, subject: title });

  const files: StudioFile[] = [
    binaryFile(`${stem}-${dpi}dpi.png`, 'image/png', png, `Download PNG (${dpi} dpi)`, 'For screens, documents and messages. Place it at 100% of its size; resizing blurs the squares.'),
    textFile(`${stem}.svg`, 'image/svg+xml', surfaceToSvg(surface, { title }), 'Download SVG', 'Vector. Scales without loss; best for print and artwork.'),
    binaryFile(`${stem}.pdf`, 'application/pdf', pdf.bytes, 'Download PDF', 'One page, exactly the size of the code. Print at 100% / “Actual size”.'),
    ...(content.vcard ? [textFile('contact.vcf', 'text/vcard', `${content.vcard}\r\n`, 'Download vCard (.vcf)', 'The same contact as a file, to attach to email or import.')] : []),
  ];

  const notices: string[] = [...content.notices];
  if (content.fixed && requestedLevel !== content.fixed.eclevel) notices.push('A SEPA payment code uses error correction level M, so that level was used instead of the one selected.');
  if (moduleMm !== undefined && symbology.sizing.mode === 'module' && Math.abs(moduleMm - usedModuleMm) > 1e-9) {
    notices.push(`The size of one square was set to ${mmText(usedModuleMm)} mm: ${symbology.name} is offered between ${mmText(symbology.sizing.minModuleMm)} and ${mmText(symbology.sizing.maxModuleMm)} mm here.`);
  }
  if (Math.abs(pngModuleMm - usedModuleMm) > 0.005) {
    notices.push(`The PNG uses ${pixelsPerModule} ${pixelsPerModule === 1 ? 'pixel' : 'pixels'} per square, which is ${mmText(pngModuleMm)} mm at ${dpi} dpi. A bitmap square must be a whole number of pixels; the SVG and PDF are exactly ${mmText(usedModuleMm)} mm.`);
  }
  if (usedModuleMm < 0.33) notices.push(`One square of this code is ${mmText(usedModuleMm)} mm wide. Print it at 300 dpi or finer and scan a printed copy before you rely on it.`);
  const contrast = contrastNotice(color, background ?? '#ffffff');
  if (contrast) notices.push(contrast);
  if (transparent) notices.push('The background is transparent. Place the code on a plain, light surface with clear space around it.');
  notices.push('Scan the code with a phone before you print or publish it.');
  for (const message of pdf.skippedImages) notices.push(message);

  const dimensions = pngDimensions(png);
  const shown = content.shown.replace(/\r?\n/g, ' ↵ ');
  const facts: StudioFact[] = [
    { label: 'Code type', value: symbology.name },
    { label: 'When scanned', value: kind.label },
    { label: 'The code carries', value: shown.length > SHOWN_LIMIT ? `${shown.slice(0, SHOWN_LIMIT - 1)}…` : shown },
    { label: 'Content length', value: `${new TextEncoder().encode(content.payload).length} bytes` },
    ...(symbology.id === 'qrcode' ? [{ label: 'Error correction', value: eclevel }] : []),
    { label: 'Size', value: `${sizeText(surface.width, surface.height)} including the quiet zone` },
    { label: 'Size of one square (SVG, PDF)', value: `${mmText(usedModuleMm)} mm` },
    ...(dimensions ? [{ label: 'PNG', value: `${dimensions.width} × ${dimensions.height} px at ${dpi} dpi` }] : []),
    // Tied to the registry, so this line cannot outlive the evidence for it.
    ...(symbology.verification === 'decode' ? [{ label: 'Verification', value: 'This code type is read back by an independent decoder in our automated tests.' }] : []),
  ];

  return { studio: true, title, previews: [previewOf(surface, symbology.name)], files, facts, notices, count: 1 };
}
