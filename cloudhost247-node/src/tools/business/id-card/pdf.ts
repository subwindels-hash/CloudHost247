/**
 * A minimal, correct PDF writer for badge output.
 *
 * Why not a PDF library: the card is a JPEG on a fixed-size page, twice. Pulling a megabyte of
 * general-purpose PDF machinery into the frontend bundle to place two images would slow every visit
 * to the tool, and the parts of PDF that library would use are the parts implemented here — a
 * catalog, a page tree, one image XObject per side (`DCTDecode`, so the JPEG is embedded byte-for-
 * byte rather than re-encoded) and the content stream that draws it at exactly ID-1 size.
 *
 * The writer is pure and byte-level predictable, which is what lets the test suite check the xref
 * offsets, the stream lengths and the MediaBox without a PDF viewer — a PDF whose cross-reference
 * table is wrong opens in some readers and not others, which is precisely the kind of "it worked
 * here" export this platform refuses to ship.
 *
 * Page geometry: 85.60 × 53.98 mm = 242.65 × 153.02 pt, the ISO/IEC 7810 ID-1 card, at 300 dpi the
 * embedded raster is 1011 × 638 px, so the print is true size when the reader is told "actual size".
 */

import { CARD_MM, mmToPoints } from './types';

export interface PdfJpeg {
  /** Complete JPEG file bytes (SOI … EOI), as produced by `canvas.toBlob('image/jpeg')`. */
  data: Uint8Array;
  width: number;
  height: number;
}

export interface PdfPage {
  image: PdfJpeg;
  /** Page size in points. Defaults to ID-1 at 100 %. */
  widthPt?: number;
  heightPt?: number;
  /** Page label, kept for the reader's outline. */
  label?: string;
}

export interface PdfDocumentInfo {
  title: string;
  subject?: string;
  author?: string;
  creator?: string;
}

const CARD_WIDTH_PT = mmToPoints(CARD_MM.width);
const CARD_HEIGHT_PT = mmToPoints(CARD_MM.height);

function isJpeg(data: Uint8Array): boolean {
  return data.length > 4 && data[0] === 0xff && data[1] === 0xd8 && data[data.length - 2] === 0xff && data[data.length - 1] === 0xd9;
}

/** Latin-1 encode: PDF syntax is bytes, and the header/trailer must not become multi-byte UTF-8. */
function bytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) out[index] = text.charCodeAt(index) & 0xff;
  return out;
}

function pdfString(text: string): string {
  // Parentheses and backslashes are the only characters that must be escaped in a PDF literal.
  return `(${text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')})`;
}

function formatPt(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}

/**
 * Build the PDF. One page per supplied face, in order.
 * Throws when an image is not a JPEG: a truncated or mislabelled stream would produce a file that
 * looks like a PDF and prints blank, which is the failure mode this module exists to avoid.
 */
export function buildCardsPdf(pages: PdfPage[], info: PdfDocumentInfo): Uint8Array {
  if (pages.length === 0) throw new Error('A PDF needs at least one page.');
  pages.forEach((page, index) => {
    if (!isJpeg(page.image.data)) {
      throw new Error(`Page ${index + 1} is not a complete JPEG image, so a print-ready PDF cannot be built from it.`);
    }
    if (page.image.width <= 0 || page.image.height <= 0) {
      throw new Error(`Page ${index + 1} has no pixel dimensions.`);
    }
  });

  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (value: Uint8Array): void => {
    chunks.push(value);
    length += value.length;
  };
  const pushText = (value: string): void => push(bytes(value));
  /** Records the byte offset of the next object so the xref table is exact. */
  const beginObject = (): void => {
    offsets.push(length);
  };

  pushText('%PDF-1.4\n');
  // A binary comment marks the file as binary for tools that sniff line endings.
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const objectCount = 2 + pages.length * 3;
  const pageObjectIds = pages.map((_, index) => 3 + index * 3);
  const imageObjectIds = pages.map((_, index) => 4 + index * 3);
  const contentObjectIds = pages.map((_, index) => 5 + index * 3);

  beginObject();
  pushText('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  beginObject();
  pushText(
    `2 0 obj\n<< /Type /Pages /Count ${pages.length} /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] >>\nendobj\n`
  );

  pages.forEach((page, index) => {
    const widthPt = page.widthPt ?? CARD_WIDTH_PT;
    const heightPt = page.heightPt ?? CARD_HEIGHT_PT;
    beginObject();
    pushText(
      `${pageObjectIds[index]} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${formatPt(widthPt)} ${formatPt(heightPt)}] ` +
        `/Resources << /XObject << /Im0 ${imageObjectIds[index]} 0 R >> >> /Contents ${contentObjectIds[index]} 0 R >>\nendobj\n`
    );

    beginObject();
    pushText(
      `${imageObjectIds[index]} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.image.width} /Height ${page.image.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.image.data.length} >>\nstream\n`
    );
    push(page.image.data);
    pushText('\nendstream\nendobj\n');

    // `cm` maps the unit square onto the page, so the image fills the card exactly.
    const content = `q\n${formatPt(widthPt)} 0 0 ${formatPt(heightPt)} 0 0 cm\n/Im0 Do\nQ\n`;
    beginObject();
    pushText(`${contentObjectIds[index]} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);
  });

  const infoId = objectCount + 1;
  beginObject();
  pushText(
    `${infoId} 0 obj\n<< /Title ${pdfString(info.title)}` +
      (info.subject ? ` /Subject ${pdfString(info.subject)}` : '') +
      (info.author ? ` /Author ${pdfString(info.author)}` : '') +
      (info.creator ? ` /Creator ${pdfString(info.creator)}` : '') +
      ` /Producer ${pdfString('CloudHost247 Employee ID Card Generator')} >>\nendobj\n`
  );

  const xrefOffset = length;
  const total = infoId + 1;
  let xref = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (const offset of offsets) xref += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  pushText(xref);
  pushText(`trailer\n<< /Size ${total} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const output = new Uint8Array(length);
  let cursor = 0;
  for (const chunk of chunks) {
    output.set(chunk, cursor);
    cursor += chunk.length;
  }
  return output;
}

/**
 * Front and back on one sheet, stacked with a cut gap, sized to the pair.
 *
 * Some card printers expect a single-page job; others want one page per side. Both are offered
 * rather than guessing, because sending the wrong one wastes a sheet of CR80 blanks.
 */
export function buildCardsPdfPair(front: PdfJpeg, back: PdfJpeg, info: PdfDocumentInfo, options: { gapPt?: number } = {}): Uint8Array {
  const gap = options.gapPt ?? 18;
  const widthPt = CARD_WIDTH_PT;
  const heightPt = CARD_HEIGHT_PT * 2 + gap;
  // Two images on one page means two XObjects, which the page tree above does not model, so the
  // pair sheet is built as a single page whose content stream draws both images.
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (value: Uint8Array): void => {
    chunks.push(value);
    length += value.length;
  };
  const pushText = (value: string): void => push(bytes(value));
  const beginObject = (): void => {
    offsets.push(length);
  };

  for (const image of [front, back]) {
    if (!isJpeg(image.data)) throw new Error('Both sides must be complete JPEG images to build a print sheet.');
  }

  pushText('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  beginObject();
  pushText('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  beginObject();
  pushText('2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n');
  beginObject();
  pushText(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${formatPt(widthPt)} ${formatPt(heightPt)}] ` +
      `/Resources << /XObject << /ImF 4 0 R /ImB 5 0 R >> >> /Contents 6 0 R >>\nendobj\n`
  );
  beginObject();
  pushText(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${front.width} /Height ${front.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${front.data.length} >>\nstream\n`
  );
  push(front.data);
  pushText('\nendstream\nendobj\n');
  beginObject();
  pushText(
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${back.width} /Height ${back.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${back.data.length} >>\nstream\n`
  );
  push(back.data);
  pushText('\nendstream\nendobj\n');

  const content =
    `q\n${formatPt(widthPt)} 0 0 ${formatPt(CARD_HEIGHT_PT)} 0 ${formatPt(CARD_HEIGHT_PT + gap)} cm\n/ImF Do\nQ\n` +
    `q\n${formatPt(widthPt)} 0 0 ${formatPt(CARD_HEIGHT_PT)} 0 0 cm\n/ImB Do\nQ\n`;
  beginObject();
  pushText(`6 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);

  beginObject();
  pushText(
    `7 0 obj\n<< /Title ${pdfString(info.title)}` +
      (info.subject ? ` /Subject ${pdfString(info.subject)}` : '') +
      (info.author ? ` /Author ${pdfString(info.author)}` : '') +
      ` /Producer ${pdfString('CloudHost247 Employee ID Card Generator')} >>\nendobj\n`
  );

  const xrefOffset = length;
  let xref = 'xref\n0 8\n0000000000 65535 f \n';
  for (const offset of offsets) xref += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  pushText(xref);
  pushText(`trailer\n<< /Size 8 /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const output = new Uint8Array(length);
  let cursor = 0;
  for (const chunk of chunks) {
    output.set(chunk, cursor);
    cursor += chunk.length;
  }
  return output;
}

/** Page size in millimetres, for the label shown next to the download button. */
export function pdfCardPageSize(): { widthMm: number; heightMm: number; widthPt: number; heightPt: number } {
  return { widthMm: CARD_MM.width, heightMm: CARD_MM.height, widthPt: CARD_WIDTH_PT, heightPt: CARD_HEIGHT_PT };
}
