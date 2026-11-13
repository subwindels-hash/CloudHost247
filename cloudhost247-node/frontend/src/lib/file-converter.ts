/**
 * Private, browser-local image and PDF conversion helpers.
 *
 * File contents are never sent to the CloudHost247 API. Images are decoded into a canvas in the
 * visitor's browser; PDFs are rendered by PDF.js in a local worker. Keep this module independent
 * from the React page so its format rules and PDF writer can be tested without a DOM.
 */

import { Zip, ZipPassThrough } from 'fflate';

export const MAX_CONVERTER_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_CONVERTER_FILES = 20;
export const MAX_PDF_PAGES = 25;
export const MAX_OUTPUT_DIMENSION = 8192;
export const MAX_OUTPUT_PIXELS = 32_000_000;
export const MAX_ZIP_ARCHIVE_BYTES = 250 * 1024 * 1024;

export type SourceKind = 'image' | 'pdf';
export type RasterOutputFormat = 'png' | 'jpeg' | 'webp';
export type OutputFormat = RasterOutputFormat | 'pdf' | 'svg';
export type RotationDegrees = 0 | 90 | 180 | 270;

export interface CropPercentages {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ConversionSettings {
  quality: number;
  resize: boolean;
  maxWidth: number;
  maxHeight: number;
  dpi: number;
  suffix: string;
  rotation: RotationDegrees;
  flipHorizontal: boolean;
  flipVertical: boolean;
  crop: CropPercentages;
  pdfPages: string;
  combineImagesToPdf: boolean;
}

export interface JpegPdfPage {
  jpeg: Uint8Array;
  pixelWidth: number;
  pixelHeight: number;
}

export interface ConvertedOutput {
  fileName: string;
  blob: Blob;
}

export const OUTPUT_FORMAT_LABELS: Record<OutputFormat, string> = {
  png: 'PNG',
  jpeg: 'JPEG',
  webp: 'WebP',
  pdf: 'PDF',
  svg: 'SVG (embedded image)',
};

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'jfif', 'webp', 'gif', 'bmp', 'avif', 'heic', 'heif', 'svg']);
const IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jfif',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/avif',
  'image/heic',
  'image/heif',
  'image/svg+xml',
]);
const IMAGE_OUTPUT_FORMATS: OutputFormat[] = ['png', 'jpeg', 'webp'];
const ALL_OUTPUT_FORMATS: OutputFormat[] = ['png', 'jpeg', 'webp', 'pdf', 'svg'];

export function getSourceKind(file: Pick<File, 'name' | 'type'>): SourceKind | null {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const mime = file.type.toLowerCase().split(';')[0]?.trim() ?? '';
  if (extension === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (IMAGE_EXTENSIONS.has(extension) || IMAGE_MIME_TYPES.has(mime)) return 'image';
  return null;
}

/** Formats that work for every source in the current batch. */
export function getAvailableOutputFormats(sourceKinds: readonly SourceKind[]): OutputFormat[] {
  if (sourceKinds.length === 0) return [...ALL_OUTPUT_FORMATS];
  return sourceKinds.includes('pdf') ? [...IMAGE_OUTPUT_FORMATS] : [...ALL_OUTPUT_FORMATS];
}

/** Parse a human-friendly PDF page selector such as "1-3, 5" (blank or "all" means every page). */
export function parsePdfPageSelection(selection: string, totalPages: number): number[] {
  if (!Number.isInteger(totalPages) || totalPages < 1 || totalPages > MAX_PDF_PAGES) {
    throw new Error(`PDFs must contain between 1 and ${MAX_PDF_PAGES} pages.`);
  }
  const trimmed = selection.trim();
  if (!trimmed || trimmed.toLowerCase() === 'all') {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const selected = new Set<number>();
  for (const rawPart of trimmed.split(',')) {
    const part = rawPart.trim();
    if (!part) throw new Error('Enter pages like 1-3, 5, or leave blank for all pages.');
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    const single = part.match(/^(\d+)$/);
    if (!range && !single) throw new Error('Enter pages like 1-3, 5, or leave blank for all pages.');
    const first = Number(range?.[1] ?? single?.[1]);
    const last = Number(range?.[2] ?? single?.[1]);
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first || last > totalPages) {
      throw new Error(`Choose page numbers from 1 to ${totalPages}; ranges must go from low to high.`);
    }
    for (let page = first; page <= last; page += 1) selected.add(page);
    if (selected.size > MAX_PDF_PAGES) {
      throw new Error(`You can export up to ${MAX_PDF_PAGES} PDF pages at a time.`);
    }
  }
  return [...selected].sort((left, right) => left - right);
}

export function outputExtension(format: OutputFormat): string {
  return format === 'jpeg' ? 'jpg' : format;
}

export function outputMimeType(format: RasterOutputFormat): string {
  switch (format) {
    case 'png': return 'image/png';
    case 'jpeg': return 'image/jpeg';
    case 'webp': return 'image/webp';
  }
}

export function safeOutputFileName(originalName: string, format: OutputFormat, suffix = ''): string {
  const base = originalName
    .replace(/[\\/]+/g, '-')
    .replace(/\.[^.]*$/, '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 100) || 'converted-file';
  const cleanSuffix = suffix
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return `${base}${cleanSuffix ? `-${cleanSuffix}` : ''}.${outputExtension(format)}`;
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown size';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

/** Keep the original aspect ratio, never upscale, and cap canvas allocation even in original-size mode. */
export function fitOutputDimensions(
  width: number,
  height: number,
  maxWidth?: number,
  maxHeight?: number,
): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('The file has invalid image dimensions.');
  }
  const requestedWidth = Number.isFinite(maxWidth) && maxWidth! > 0 ? maxWidth! : width;
  const requestedHeight = Number.isFinite(maxHeight) && maxHeight! > 0 ? maxHeight! : height;
  let scale = Math.min(
    1,
    requestedWidth / width,
    requestedHeight / height,
    MAX_OUTPUT_DIMENSION / width,
    MAX_OUTPUT_DIMENSION / height,
    Math.sqrt(MAX_OUTPUT_PIXELS / (width * height)),
  );
  if (!Number.isFinite(scale) || scale <= 0) scale = 1;
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

export function fitResizeDimensions(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  allowUpscale: boolean,
): { width: number; height: number } {
  if (![sourceWidth, sourceHeight, targetWidth, targetHeight].every(Number.isFinite)
    || sourceWidth < 1 || sourceHeight < 1 || targetWidth < 1 || targetHeight < 1) {
    throw new Error('Enter valid image and target dimensions.');
  }
  const maxScale = allowUpscale ? 4 : 1;
  const scale = Math.min(
    targetWidth / sourceWidth,
    targetHeight / sourceHeight,
    maxScale,
    MAX_OUTPUT_DIMENSION / sourceWidth,
    MAX_OUTPUT_DIMENSION / sourceHeight,
    Math.sqrt(MAX_OUTPUT_PIXELS / (sourceWidth * sourceHeight)),
  );
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('The requested output dimensions are too large.');
  return { width: Math.max(1, Math.floor(sourceWidth * scale)), height: Math.max(1, Math.floor(sourceHeight * scale)) };
}

function ascii(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function joinBytes(parts: readonly Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((total, part) => total + part.byteLength, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function indirectObject(id: number, content: readonly Uint8Array[]): Uint8Array {
  return joinBytes([ascii(`${id} 0 obj\n`), ...content, ascii('\nendobj\n')]);
}

function validateJpegPdfPage(page: JpegPdfPage): void {
  if (page.jpeg.byteLength < 4 || page.jpeg[0] !== 0xff || page.jpeg[1] !== 0xd8) {
    throw new Error('The browser did not produce a valid JPEG image for the PDF.');
  }
  if (!Number.isFinite(page.pixelWidth) || !Number.isFinite(page.pixelHeight) || page.pixelWidth < 1 || page.pixelHeight < 1) {
    throw new Error('The image has invalid dimensions and cannot be placed in a PDF.');
  }
}

/** Wraps one or more canvas-encoded JPEG images into an A4 PDF without a server renderer. */
export function jpegImagesToPdf(pages: readonly JpegPdfPage[]): Uint8Array {
  if (pages.length < 1 || pages.length > MAX_PDF_PAGES) {
    throw new Error(`A combined PDF must contain between 1 and ${MAX_PDF_PAGES} pages.`);
  }
  pages.forEach(validateJpegPdfPage);

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 30;
  const objects: Uint8Array[] = [
    indirectObject(1, [ascii('<< /Type /Catalog /Pages 2 0 R >>')]),
    indirectObject(2, [ascii(
      `<< /Type /Pages /Kids [${pages.map((_, index) => `${3 + index * 3} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    )]),
  ];

  pages.forEach((page, index) => {
    const pageId = 3 + index * 3;
    const imageId = pageId + 1;
    const contentId = pageId + 2;
    const resource = `Im${index}`;
    const imageWidth = page.pixelWidth * 0.75;
    const imageHeight = page.pixelHeight * 0.75;
    const scale = Math.min(1, (pageWidth - margin * 2) / imageWidth, (pageHeight - margin * 2) / imageHeight);
    const drawWidth = imageWidth * scale;
    const drawHeight = imageHeight * scale;
    const x = (pageWidth - drawWidth) / 2;
    const y = (pageHeight - drawHeight) / 2;
    const content = ascii(
      `q\n${drawWidth.toFixed(3)} 0 0 ${drawHeight.toFixed(3)} ${x.toFixed(3)} ${y.toFixed(3)} cm\n/${resource} Do\nQ`,
    );

    objects.push(
      indirectObject(pageId, [ascii(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] `
        + `/Resources << /XObject << /${resource} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
      )]),
      indirectObject(imageId, [
        ascii(`<< /Type /XObject /Subtype /Image /Width ${Math.floor(page.pixelWidth)} /Height ${Math.floor(page.pixelHeight)} `
          + `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.byteLength} >>\nstream\n`),
        page.jpeg,
        ascii('\nendstream'),
      ]),
      indirectObject(contentId, [ascii(`<< /Length ${content.byteLength} >>\nstream\n`), content, ascii('\nendstream')]),
    );
  });

  const header = ascii('%PDF-1.4\n%CH247 local image conversion\n');
  const fileParts: Uint8Array[] = [header];
  const offsets = [0];
  let byteOffset = header.byteLength;
  for (const object of objects) {
    offsets.push(byteOffset);
    fileParts.push(object);
    byteOffset += object.byteLength;
  }
  const xrefOffset = byteOffset;
  const xref = ascii(
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    + offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
    + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );
  fileParts.push(xref);
  return joinBytes(fileParts);
}

export function jpegImageToPdf(jpeg: Uint8Array, pixelWidth: number, pixelHeight: number): Uint8Array {
  return jpegImagesToPdf([{ jpeg, pixelWidth, pixelHeight }]);
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob || blob.size === 0) {
        reject(new Error('Your browser could not encode this file. Try another output format.'));
        return;
      }
      if (blob.type !== mime) {
        reject(new Error(`This browser cannot create ${mime.replace('image/', '').toUpperCase()} files. Choose PNG or JPEG instead.`));
        return;
      }
      resolve(blob);
    }, mime, quality);
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read the image data.'));
    reader.onerror = () => reject(new Error('Could not read the image data.'));
    reader.readAsDataURL(blob);
  });
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  close(): void;
}

function isSvgFile(file: Pick<File, 'name' | 'type'>): boolean {
  return file.name.toLowerCase().endsWith('.svg') || file.type.toLowerCase().split(';')[0]?.trim() === 'image/svg+xml';
}

function isHeicFile(file: Pick<File, 'name' | 'type'>): boolean {
  return /\.(heic|heif)$/i.test(file.name) || /^image\/(heic|heif)/i.test(file.type);
}

async function makeSafeSvgBlob(file: File): Promise<Blob> {
  if (file.size > MAX_CONVERTER_FILE_BYTES) throw new Error('SVG images are limited to 25 MiB.');
  const source = await file.text();
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('This SVG contains unsupported XML declarations.');
  const document = new DOMParser().parseFromString(source, 'image/svg+xml');
  const root = document.documentElement;
  if (root.localName.toLowerCase() !== 'svg' || document.querySelector('parsererror')) {
    throw new Error('This SVG file is not valid XML.');
  }
  document.querySelectorAll('script,foreignObject,iframe,object,embed,link,audio,video').forEach((node) => node.remove());
  for (const element of Array.from(document.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith('on')) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (name === 'href' || name === 'xlink:href') {
        if (!value.startsWith('#') && !/^data:image\/(png|jpe?g|webp);base64,/i.test(value)) element.removeAttribute(attribute.name);
        continue;
      }
      if (name === 'style' && /url\s*\(|expression\s*\(|@import/i.test(value)) element.removeAttribute(attribute.name);
    }
  }
  document.querySelectorAll('style').forEach((node) => node.remove());
  return new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' });
}

async function decodeImage(file: File): Promise<DecodedImage> {
  let sourceBlob: Blob = file;
  if (isSvgFile(file)) {
    sourceBlob = await makeSafeSvgBlob(file);
  } else if (isHeicFile(file)) {
    try {
      const { default: heic2any } = await import('heic2any');
      const converted = await heic2any({ blob: file, toType: 'image/png' });
      sourceBlob = Array.isArray(converted) ? converted[0] ?? new Blob() : converted;
      if (sourceBlob.size === 0) throw new Error('The HEIC decoder returned an empty image.');
    } catch (error) {
      throw new Error(error instanceof Error ? `Could not decode this HEIC/HEIF image: ${error.message}` : 'Could not decode this HEIC/HEIF image.');
    }
  }

  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(sourceBlob);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      // Fall through to the browser's HTMLImageElement decoder for older/mobile browsers.
    }
  }

  const url = URL.createObjectURL(sourceBlob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('This browser could not decode that image format.'));
      element.src = url;
    });
    return {
      source: image,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      close: () => undefined,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function getCropPixels(sourceWidth: number, sourceHeight: number, crop: CropPercentages) {
  if (![sourceWidth, sourceHeight, crop.left, crop.top, crop.width, crop.height].every(Number.isFinite)
    || sourceWidth < 1 || sourceHeight < 1
    || crop.left < 0 || crop.top < 0 || crop.width <= 0 || crop.height <= 0
    || crop.left + crop.width > 100 || crop.top + crop.height > 100) {
    throw new Error('Crop position and size must stay inside the image.');
  }
  const x = Math.min(sourceWidth - 1, Math.floor(sourceWidth * crop.left / 100));
  const y = Math.min(sourceHeight - 1, Math.floor(sourceHeight * crop.top / 100));
  const width = Math.max(1, Math.min(sourceWidth - x, Math.round(sourceWidth * crop.width / 100)));
  const height = Math.max(1, Math.min(sourceHeight - y, Math.round(sourceHeight * crop.height / 100)));
  return { x, y, width, height };
}

export function getTransformedDimensions(
  sourceWidth: number,
  sourceHeight: number,
  settings: ConversionSettings,
): { width: number; height: number } {
  const crop = getCropPixels(sourceWidth, sourceHeight, settings.crop);
  const swapsDimensions = settings.rotation === 90 || settings.rotation === 270;
  const width = swapsDimensions ? crop.height : crop.width;
  const height = swapsDimensions ? crop.width : crop.height;
  return fitOutputDimensions(
    width,
    height,
    settings.resize ? settings.maxWidth : undefined,
    settings.resize ? settings.maxHeight : undefined,
  );
}

function createTransformedCanvas(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  settings: ConversionSettings,
  fillWhite: boolean,
): HTMLCanvasElement {
  const crop = getCropPixels(sourceWidth, sourceHeight, settings.crop);
  const dimensions = getTransformedDimensions(sourceWidth, sourceHeight, settings);
  const orientedWidth = settings.rotation === 90 || settings.rotation === 270 ? crop.height : crop.width;
  const orientedHeight = settings.rotation === 90 || settings.rotation === 270 ? crop.width : crop.height;
  const canvas = document.createElement('canvas');
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser could not start the image converter.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  if (fillWhite) {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.translate(canvas.width / 2, canvas.height / 2);
  context.scale(
    dimensions.width / orientedWidth * (settings.flipHorizontal ? -1 : 1),
    dimensions.height / orientedHeight * (settings.flipVertical ? -1 : 1),
  );
  context.rotate(settings.rotation * Math.PI / 180);
  context.drawImage(
    source,
    crop.x, crop.y, crop.width, crop.height,
    -crop.width / 2, -crop.height / 2, crop.width, crop.height,
  );
  return canvas;
}

async function createImageCanvas(file: File, settings: ConversionSettings, fillWhite: boolean): Promise<HTMLCanvasElement> {
  const decoded = await decodeImage(file);
  try {
    return createTransformedCanvas(decoded.source, decoded.width, decoded.height, settings, fillWhite);
  } finally {
    decoded.close();
  }
}

export async function rasterizeImageFile(
  file: File,
  maxWidth = 640,
  maxHeight = 640,
  background: string | null = '#ffffff',
): Promise<HTMLCanvasElement> {
  if (getSourceKind(file) !== 'image') throw new Error('Choose a supported image file.');
  if (file.size > MAX_CONVERTER_FILE_BYTES) throw new Error('Images are limited to 25 MiB per file.');
  const decoded = await decodeImage(file);
  try {
    const dimensions = fitOutputDimensions(decoded.width, decoded.height, maxWidth, maxHeight);
    const canvas = document.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser could not prepare the image.');
    if (background) {
      context.fillStyle = background;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    decoded.close();
  }
}

function pdfBlobFromBytes(bytes: Uint8Array): Blob {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type: 'application/pdf' });
}

export async function convertImageToJpegPdfPage(file: File, settings: ConversionSettings): Promise<JpegPdfPage> {
  if (getSourceKind(file) !== 'image') throw new Error('Choose a supported image file.');
  const canvas = await createImageCanvas(file, settings, true);
  try {
    const jpeg = await canvasToBlob(canvas, 'image/jpeg', Math.min(1, Math.max(0.1, settings.quality / 100)));
    return {
      jpeg: new Uint8Array(await jpeg.arrayBuffer()),
      pixelWidth: canvas.width,
      pixelHeight: canvas.height,
    };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export function createMultipagePdfOutput(pages: readonly JpegPdfPage[], suffix = ''): ConvertedOutput {
  const bytes = jpegImagesToPdf(pages);
  return {
    fileName: safeOutputFileName('combined-images', 'pdf', suffix),
    blob: pdfBlobFromBytes(bytes),
  };
}

export async function convertImageFile(
  file: File,
  format: OutputFormat,
  settings: ConversionSettings,
): Promise<ConvertedOutput> {
  if (getSourceKind(file) !== 'image') throw new Error('Choose a supported image file.');
  const canvas = await createImageCanvas(file, settings, format === 'jpeg' || format === 'pdf');
  try {
    if (format === 'pdf') {
      const jpeg = await canvasToBlob(canvas, 'image/jpeg', Math.min(1, Math.max(0.1, settings.quality / 100)));
      const bytes = jpegImageToPdf(new Uint8Array(await jpeg.arrayBuffer()), canvas.width, canvas.height);
      return {
        fileName: safeOutputFileName(file.name, 'pdf', settings.suffix),
        blob: pdfBlobFromBytes(bytes),
      };
    }
    if (format === 'svg') {
      const png = await canvasToBlob(canvas, 'image/png');
      const dataUrl = await blobToDataUrl(png);
      const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}"><image width="${canvas.width}" height="${canvas.height}" href="${dataUrl}" /></svg>`;
      const blob = new Blob([markup], { type: 'image/svg+xml' });
      if (blob.size > MAX_ZIP_ARCHIVE_BYTES) throw new Error('SVG output exceeded the 250 MiB browser safety limit.');
      return { fileName: safeOutputFileName(file.name, 'svg', settings.suffix), blob };
    }

    const mime = outputMimeType(format);
    const quality = format === 'png' ? undefined : Math.min(1, Math.max(0.1, settings.quality / 100));
    const blob = await canvasToBlob(canvas, mime, quality);
    return { fileName: safeOutputFileName(file.name, format, settings.suffix), blob };
  } catch (error) {
    if (error instanceof Error && /decode|browser|could not|invalid/i.test(error.message)) throw error;
    throw new Error(error instanceof Error ? error.message : 'The image conversion failed.');
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export async function resizeImageFile(
  file: File,
  targetWidth: number,
  targetHeight: number,
  format: RasterOutputFormat = 'webp',
  quality = 90,
  allowUpscale = true,
): Promise<ConvertedOutput> {
  if (getSourceKind(file) !== 'image') throw new Error('Choose a supported image file.');
  if (file.size > MAX_CONVERTER_FILE_BYTES) throw new Error('Images are limited to 25 MiB per file.');
  const decoded = await decodeImage(file);
  let canvas: HTMLCanvasElement | null = null;
  try {
    const dimensions = fitResizeDimensions(decoded.width, decoded.height, targetWidth, targetHeight, allowUpscale);
    canvas = document.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser could not start the image resizer.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
    const mime = outputMimeType(format);
    const blob = await canvasToBlob(canvas, mime, format === 'png' ? undefined : Math.min(1, Math.max(0.1, quality / 100)));
    return { fileName: safeOutputFileName(file.name, format, 'resized'), blob };
  } finally {
    decoded.close();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}

export async function convertPdfFile(
  file: File,
  format: RasterOutputFormat,
  settings: ConversionSettings,
  onProgress?: (pageNumber: number, selectedIndex: number, selectedTotal: number) => void,
): Promise<ConvertedOutput[]> {
  if (getSourceKind(file) !== 'pdf') throw new Error('Choose a PDF file.');
  const [{ getDocument, GlobalWorkerOptions }, workerModule] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  GlobalWorkerOptions.workerSrc = workerModule.default;

  const loadingTask = getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    isEvalSupported: false,
    useSystemFonts: true,
  });
  let documentProxy: Awaited<typeof loadingTask.promise> | null = null;
  try {
    documentProxy = await loadingTask.promise;
    if (documentProxy.numPages < 1) throw new Error('This PDF does not contain any pages.');
    if (documentProxy.numPages > MAX_PDF_PAGES) {
      throw new Error(`This local converter supports PDFs up to ${MAX_PDF_PAGES} pages per file.`);
    }
    const selectedPages = parsePdfPageSelection(settings.pdfPages, documentProxy.numPages);
    const outputs: ConvertedOutput[] = [];
    const mime = outputMimeType(format);
    const quality = format === 'png' ? undefined : Math.min(1, Math.max(0.1, settings.quality / 100));
    const baseName = safeOutputFileName(file.name, format, settings.suffix).replace(/\.[^.]+$/, '');
    const dpiScale = Math.min(3, Math.max(1, settings.dpi / 72));

    for (let selectedIndex = 0; selectedIndex < selectedPages.length; selectedIndex += 1) {
      const pageNumber = selectedPages[selectedIndex]!;
      onProgress?.(pageNumber, selectedIndex + 1, selectedPages.length);
      const page = await documentProxy.getPage(pageNumber);
      let sourceCanvas: HTMLCanvasElement | null = null;
      let outputCanvas: HTMLCanvasElement | null = null;
      try {
        const baseViewport = page.getViewport({ scale: dpiScale });
        const renderDimensions = fitOutputDimensions(
          baseViewport.width,
          baseViewport.height,
          settings.resize ? settings.maxWidth : undefined,
          settings.resize ? settings.maxHeight : undefined,
        );
        const renderScale = Math.min(
          renderDimensions.width / baseViewport.width,
          renderDimensions.height / baseViewport.height,
        );
        const viewport = page.getViewport({ scale: dpiScale * renderScale });
        sourceCanvas = document.createElement('canvas');
        sourceCanvas.width = Math.max(1, Math.floor(viewport.width));
        sourceCanvas.height = Math.max(1, Math.floor(viewport.height));
        const sourceContext = sourceCanvas.getContext('2d');
        if (!sourceContext) throw new Error('This browser could not start the PDF page renderer.');
        sourceContext.fillStyle = '#ffffff';
        sourceContext.fillRect(0, 0, sourceCanvas.width, sourceCanvas.height);
        await page.render({ canvasContext: sourceContext, viewport }).promise;
        outputCanvas = createTransformedCanvas(sourceCanvas, sourceCanvas.width, sourceCanvas.height, settings, true);
        const blob = await canvasToBlob(outputCanvas, mime, quality);
        const pageSuffix = documentProxy.numPages > 1 ? `-page-${String(pageNumber).padStart(2, '0')}` : '';
        outputs.push({
          fileName: `${baseName}${pageSuffix}.${outputExtension(format)}`,
          blob,
        });
      } finally {
        page.cleanup();
        if (sourceCanvas) { sourceCanvas.width = 0; sourceCanvas.height = 0; }
        if (outputCanvas) { outputCanvas.width = 0; outputCanvas.height = 0; }
      }
    }
    return outputs;
  } catch (error) {
    await loadingTask.destroy().catch(() => undefined);
    throw new Error(error instanceof Error ? error.message : 'The PDF conversion failed.');
  } finally {
    if (documentProxy) await documentProxy.destroy().catch(() => undefined);
  }
}

function safeArchiveName(fileName: string): string {
  const baseName = fileName.split(/[\\/]/).pop() ?? '';
  const clean = baseName.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '-').slice(0, 180);
  return clean || 'converted-file';
}

function uniqueArchiveNames(outputs: readonly ConvertedOutput[]): string[] {
  const seen = new Set<string>();
  return outputs.map((output) => {
    const name = safeArchiveName(output.fileName);
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : '';
    let candidate = name;
    let suffix = 2;
    while (seen.has(candidate.toLocaleLowerCase())) {
      candidate = `${base} (${suffix})${extension}`;
      suffix += 1;
    }
    seen.add(candidate.toLocaleLowerCase());
    return candidate;
  });
}

/** Streams already-compressed results into a local ZIP without recompressing image/PDF data. */
export async function createZipArchive(
  outputs: readonly ConvertedOutput[],
  onProgress?: (completed: number, total: number) => void,
): Promise<Blob> {
  if (outputs.length === 0) throw new Error('Convert at least one file before creating a ZIP.');
  const sourceBytes = outputs.reduce((total, output) => total + output.blob.size, 0);
  if (sourceBytes > MAX_ZIP_ARCHIVE_BYTES) {
    throw new Error(`For browser memory safety, ZIP downloads are limited to ${formatFileSize(MAX_ZIP_ARCHIVE_BYTES)}. Download some files individually.`);
  }

  const chunks: Uint8Array[] = [];
  let resolveFinished!: () => void;
  let rejectFinished!: (error: unknown) => void;
  const finished = new Promise<void>((resolve, reject) => {
    resolveFinished = resolve;
    rejectFinished = reject;
  });
  void finished.catch(() => undefined);
  const archive = new Zip((error, chunk, final) => {
    if (error) {
      rejectFinished(error);
      return;
    }
    if (chunk.byteLength > 0) chunks.push(chunk);
    if (final) resolveFinished();
  });

  try {
    const names = uniqueArchiveNames(outputs);
    for (let index = 0; index < outputs.length; index += 1) {
      const output = outputs[index]!;
      const entry = new ZipPassThrough(names[index]!);
      archive.add(entry);
      onProgress?.(index + 1, outputs.length);
      if (typeof output.blob.stream === 'function') {
        const reader = output.blob.stream().getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              entry.push(new Uint8Array(0), true);
              break;
            }
            entry.push(value);
          }
        } finally {
          reader.releaseLock();
        }
      } else {
        entry.push(new Uint8Array(await output.blob.arrayBuffer()), true);
      }
    }
    archive.end();
    await finished;
    return new Blob(chunks.map((chunk) => chunk as unknown as BlobPart), { type: 'application/zip' });
  } catch (error) {
    archive.terminate();
    rejectFinished(error);
    throw error instanceof Error ? error : new Error('The ZIP archive could not be created.');
  }
}
