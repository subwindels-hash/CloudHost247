import type { createCanvas as CreateCanvasFn } from '@napi-rs/canvas';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { Gunzip, Unzip, UnzipInflate, UnzipPassThrough, gzipSync, zipSync } from 'fflate';
import type sharpType from 'sharp';

let cachedSharp: typeof sharpType | null = null;
let cachedCreateCanvas: typeof CreateCanvasFn | null = null;

function getSharp(): typeof sharpType {
  if (!cachedSharp) {
    try {
      // Lazy-loaded so native libvips bindings do not spawn thread pools or fail process startup on
      // restricted shared-hosting environments when File Tools image jobs are never invoked.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const loaded = require('sharp') as typeof sharpType | { default?: typeof sharpType };
      cachedSharp = (typeof loaded === 'function' ? loaded : loaded.default) as typeof sharpType;
    } catch (err) {
      throw new FileProcessingError(
        `Server-side image processing is unavailable in this environment (${err instanceof Error ? err.message : 'native module unavailable'}). Use the browser-local tool instead.`,
      );
    }
  }
  return cachedSharp;
}

function getCreateCanvas(): typeof CreateCanvasFn {
  if (!cachedCreateCanvas) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const loaded = require('@napi-rs/canvas') as { createCanvas: typeof CreateCanvasFn };
      cachedCreateCanvas = loaded.createCanvas;
    } catch (err) {
      throw new FileProcessingError(
        `Server-side PDF rasterization is unavailable in this environment (${err instanceof Error ? err.message : 'native canvas module unavailable'}). Use the browser-local tool instead.`,
      );
    }
  }
  return cachedCreateCanvas;
}

export const API_MAX_FILE_BYTES = 8 * 1024 * 1024;
export const API_MAX_TOTAL_INPUT_BYTES = 16 * 1024 * 1024;
export const API_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
export const API_MAX_BATCH_FILES = 20;
export const API_MAX_PDF_PAGES = 25;
const API_MAX_ZIP_ENTRIES = 100;
const API_MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const API_MAX_IMAGE_PIXELS = 32_000_000;
const API_MAX_PDF_PIXELS = 80_000_000;
const API_MAX_TEXT_CHARS = 1_000_000;

export type FileApiOperation =
  | 'image.convert' | 'image.compress' | 'image.resize' | 'image.crop' | 'image.rotate'
  | 'gif.compress'
  | 'pdf.merge' | 'pdf.extract' | 'pdf.remove' | 'pdf.rotate' | 'pdf.reorder' | 'pdf.crop' | 'pdf.resize' | 'pdf.flatten' | 'pdf.compress'
  | 'document.to-pdf' | 'document.extract-text'
  | 'archive.create-zip' | 'archive.extract-zip' | 'archive.gzip' | 'archive.gunzip';

export interface ApiInputFile {
  fileName: string;
  dataBase64: string;
  contentType?: string;
}

export interface ApiJobRequest {
  operation: FileApiOperation;
  files: ApiInputFile[];
  options: Record<string, unknown>;
}

export interface ApiOutputFile {
  fileName: string;
  contentType: string;
  data: Uint8Array;
}

export class FileProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileProcessingError';
  }
}

function readString(options: Record<string, unknown>, key: string, fallback = ''): string {
  const value = options[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') throw new FileProcessingError(`Option “${key}” must be text.`);
  return value;
}

function readNumber(options: Record<string, unknown>, key: string, fallback: number, min: number, max: number, integer = false): number {
  const raw = options[key];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new FileProcessingError(`Option “${key}” must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}.`);
  }
  return value;
}

function readBoolean(options: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = options[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') throw new FileProcessingError(`Option “${key}” must be true or false.`);
  return value;
}

function outputName(inputName: string, extension: string, suffix = ''): string {
  const base = safeBaseName(inputName).replace(/\.[^.]+$/, '') || 'file';
  const cleanSuffix = suffix ? `-${suffix.replace(/[^a-z0-9-]/gi, '-').slice(0, 40)}` : '';
  return `${base}${cleanSuffix}.${extension.replace(/^\./, '')}`;
}

function safeBaseName(value: string): string {
  const name = value.replace(/\\/g, '/').split('/').pop() ?? '';
  return name.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '-').replace(/[^\p{L}\p{N}._ -]+/gu, '-').trim().replace(/^[. -]+|[. -]+$/g, '').slice(0, 120);
}

function decodeBase64File(file: ApiInputFile): { fileName: string; data: Uint8Array } {
  const fileName = safeBaseName(file.fileName);
  if (!fileName || fileName === '.' || fileName === '..') throw new FileProcessingError('Every input file needs a safe, non-empty file name.');
  if (!file.dataBase64 || file.dataBase64.length > Math.ceil(API_MAX_FILE_BYTES / 3) * 4 + 8 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.dataBase64)) {
    throw new FileProcessingError(`“${fileName}” is not valid Base64 or exceeds the ${API_MAX_FILE_BYTES / 1024 / 1024} MiB API file limit.`);
  }
  const buffer = Buffer.from(file.dataBase64, 'base64');
  if (buffer.byteLength === 0 || buffer.byteLength > API_MAX_FILE_BYTES || buffer.toString('base64').replace(/=+$/, '') !== file.dataBase64.replace(/=+$/, '')) {
    throw new FileProcessingError(`“${fileName}” is empty, invalid Base64, or exceeds the ${API_MAX_FILE_BYTES / 1024 / 1024} MiB API file limit.`);
  }
  return { fileName, data: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) };
}

function toOutput(fileName: string, contentType: string, data: Uint8Array): ApiOutputFile {
  if (data.byteLength === 0) throw new FileProcessingError('The operation produced an empty output.');
  if (data.byteLength > API_MAX_OUTPUT_BYTES) throw new FileProcessingError(`Output exceeded the ${API_MAX_OUTPUT_BYTES / 1024 / 1024} MiB API output limit.`);
  return { fileName, contentType, data };
}

function parsePageSelection(raw: string, pageCount: number): number[] {
  const selection = raw.trim();
  if (!selection) return Array.from({ length: pageCount }, (_, index) => index);
  const pages = new Set<number>();
  for (const part of selection.split(',').map((value) => value.trim())) {
    if (/^\d+$/.test(part)) {
      const page = Number(part);
      if (page < 1 || page > pageCount) throw new FileProcessingError(`Page selections must be between 1 and ${pageCount}.`);
      pages.add(page - 1);
    } else {
      const range = /^(\d+)\s*-\s*(\d+)$/.exec(part);
      if (!range) throw new FileProcessingError('Use page selections such as “1-3, 5”.');
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (start < 1 || end < start || end > pageCount) throw new FileProcessingError(`Page ranges must be between 1 and ${pageCount}.`);
      for (let page = start; page <= end; page += 1) pages.add(page - 1);
    }
  }
  if (!pages.size) throw new FileProcessingError('Select at least one page.');
  return [...pages].sort((a, b) => a - b);
}

async function loadPdf(data: Uint8Array): Promise<PDFDocument> {
  let pdf: PDFDocument;
  try { pdf = await PDFDocument.load(data, { updateMetadata: false, throwOnInvalidObject: true }); }
  catch { throw new FileProcessingError('Could not read the PDF. It may be damaged or password-protected.'); }
  if (pdf.getPageCount() < 1 || pdf.getPageCount() > API_MAX_PDF_PAGES) {
    throw new FileProcessingError(`PDF operations support 1 to ${API_MAX_PDF_PAGES} pages per input file.`);
  }
  return pdf;
}

async function savePdf(pdf: PDFDocument, name: string): Promise<ApiOutputFile> {
  const bytes = await pdf.save({ useObjectStreams: true, addDefaultPage: false });
  return toOutput(name, 'application/pdf', bytes);
}

async function processImage(operation: 'image.convert' | 'image.compress' | 'image.resize' | 'image.crop' | 'image.rotate' | 'gif.compress', file: { fileName: string; data: Uint8Array }, options: Record<string, unknown>): Promise<ApiOutputFile> {
  const isGif = operation === 'gif.compress';
  const input = Buffer.from(file.data);
  const sharp = getSharp();
  let image = sharp(input, { animated: isGif, failOn: 'error', limitInputPixels: API_MAX_IMAGE_PIXELS, sequentialRead: true });
  const metadata = await image.metadata().catch(() => null);
  if (!metadata?.width || !metadata.height || metadata.width * metadata.height > API_MAX_IMAGE_PIXELS) throw new FileProcessingError('Could not read this image or its pixel dimensions exceed the API safety limit.');
  if (isGif && (metadata.format !== 'gif' || (metadata.pages ?? 1) > 120)) throw new FileProcessingError('GIF compression accepts animated GIFs of up to 120 frames.');

  if (operation === 'image.rotate') {
    const rotation = readNumber(options, 'rotation', 90, 0, 270, true);
    if (![0, 90, 180, 270].includes(rotation)) throw new FileProcessingError('Image rotation must be 0, 90, 180, or 270 degrees.');
    if (rotation) image = image.rotate(rotation);
  } else {
    image = image.rotate();
  }
  if (readBoolean(options, 'flip')) image = image.flip();
  if (readBoolean(options, 'flop')) image = image.flop();

  if (operation === 'image.crop') {
    const left = readNumber(options, 'left', 0, 0, metadata.width - 1, true);
    const top = readNumber(options, 'top', 0, 0, metadata.height - 1, true);
    const width = readNumber(options, 'width', metadata.width - left, 1, metadata.width, true);
    const height = readNumber(options, 'height', metadata.height - top, 1, metadata.height, true);
    if (left + width > metadata.width || top + height > metadata.height) throw new FileProcessingError('Crop bounds must fit within the source image.');
    image = image.extract({ left, top, width, height });
  }

  if (operation === 'image.resize' || options.width !== undefined || options.height !== undefined) {
    const width = readNumber(options, 'width', metadata.width, 1, 8192, true);
    const height = readNumber(options, 'height', metadata.height, 1, 8192, true);
    image = image.resize({ width, height, fit: 'inside', withoutEnlargement: !readBoolean(options, 'allowUpscale') });
  }

  if (isGif) {
    image = image.resize({ width: readNumber(options, 'width', 360, 1, 480, true), withoutEnlargement: true, fit: 'inside' });
    const data = await image.gif({ effort: 7, colors: readNumber(options, 'colors', 128, 16, 256, true), dither: 0.7 }).toBuffer();
    return toOutput(outputName(file.fileName, 'gif', 'compressed'), 'image/gif', new Uint8Array(data));
  }

  const requestedFormat = readString(options, 'format', operation === 'image.compress' ? 'webp' : (metadata.format ?? 'png'));
  const format = requestedFormat.toLowerCase().replace(/^image\//, '').replace('jpg', 'jpeg');
  const quality = readNumber(options, 'quality', operation === 'image.compress' ? 76 : 88, 20, 100, true);
  let data: Buffer;
  let extension: string;
  let mime: string;
  if (format === 'jpeg' || format === 'jpg') { data = await image.jpeg({ quality, mozjpeg: true }).toBuffer(); extension = 'jpg'; mime = 'image/jpeg'; }
  else if (format === 'webp') { data = await image.webp({ quality, effort: 5 }).toBuffer(); extension = 'webp'; mime = 'image/webp'; }
  else if (format === 'avif') { data = await image.avif({ quality, effort: 5 }).toBuffer(); extension = 'avif'; mime = 'image/avif'; }
  else if (format === 'png') { data = await image.png({ compressionLevel: 9, palette: false }).toBuffer(); extension = 'png'; mime = 'image/png'; }
  else if (format === 'tiff') { data = await image.tiff({ quality }).toBuffer(); extension = 'tiff'; mime = 'image/tiff'; }
  else throw new FileProcessingError('Image API output supports JPEG, PNG, WebP, AVIF, and TIFF.');
  const suffix = operation === 'image.compress' ? 'compressed' : operation === 'image.resize' ? 'resized' : operation === 'image.crop' ? 'cropped' : operation === 'image.rotate' ? 'rotated' : 'converted';
  return toOutput(outputName(file.fileName, extension, suffix), mime, new Uint8Array(data));
}

async function processPdf(operation: Exclude<FileApiOperation, 'image.convert' | 'image.compress' | 'image.resize' | 'image.crop' | 'image.rotate' | 'gif.compress' | 'document.to-pdf' | 'document.extract-text' | 'archive.create-zip' | 'archive.extract-zip' | 'archive.gzip' | 'archive.gunzip'>, files: Array<{ fileName: string; data: Uint8Array }>, options: Record<string, unknown>): Promise<ApiOutputFile> {
  if (operation === 'pdf.merge') {
    if (files.length < 2) throw new FileProcessingError('Choose at least two PDFs to merge.');
    const output = await PDFDocument.create();
    let pagesTotal = 0;
    for (const file of files) {
      const source = await loadPdf(file.data);
      pagesTotal += source.getPageCount();
      if (pagesTotal > 100) throw new FileProcessingError('A merged output is limited to 100 pages.');
      (await output.copyPages(source, source.getPageIndices())).forEach((page) => output.addPage(page));
    }
    return savePdf(output, outputName('merged-pdfs.pdf', 'pdf'));
  }

  if (operation === 'pdf.compress') return compressPdf(files[0]!, options);
  const source = await loadPdf(files[0]!.data);
  const pageCount = source.getPageCount();
  const name = files[0]!.fileName;

  if (operation === 'pdf.extract') {
    const indices = parsePageSelection(readString(options, 'pages'), pageCount);
    const output = await PDFDocument.create();
    (await output.copyPages(source, indices)).forEach((page) => output.addPage(page));
    return savePdf(output, outputName(name, 'pdf', 'pages'));
  }
  if (operation === 'pdf.remove') {
    const removed = new Set(parsePageSelection(readString(options, 'pages'), pageCount));
    if (removed.size >= pageCount) throw new FileProcessingError('Keep at least one page in the PDF.');
    for (const page of [...removed].sort((a, b) => b - a)) source.removePage(page);
    return savePdf(source, outputName(name, 'pdf', 'pages-removed'));
  }
  if (operation === 'pdf.rotate') {
    const rotation = readNumber(options, 'rotation', 90, 90, 270, true);
    if (![90, 180, 270].includes(rotation)) throw new FileProcessingError('PDF rotation must be 90, 180, or 270 degrees.');
    for (const index of parsePageSelection(readString(options, 'pages'), pageCount)) {
      const page = source.getPage(index);
      page.setRotation(degrees((page.getRotation().angle + rotation) % 360));
    }
    return savePdf(source, outputName(name, 'pdf', 'rotated'));
  }
  if (operation === 'pdf.reorder') {
    const raw = readString(options, 'order');
    const pageOrder = raw.split(',').map((part) => Number(part.trim()) - 1);
    if (pageOrder.length !== pageCount || pageOrder.some((page) => !Number.isInteger(page) || page < 0 || page >= pageCount) || new Set(pageOrder).size !== pageCount) {
      throw new FileProcessingError(`Page order must list each page from 1 to ${pageCount} exactly once.`);
    }
    const output = await PDFDocument.create();
    (await output.copyPages(source, pageOrder)).forEach((page) => output.addPage(page));
    return savePdf(output, outputName(name, 'pdf', 'reordered'));
  }
  if (operation === 'pdf.flatten') {
    const form = source.getForm();
    if (form.getFields().length) form.flatten();
    return savePdf(source, outputName(name, 'pdf', 'flattened'));
  }
  if (operation === 'pdf.crop') {
    const x = readNumber(options, 'x', 0, 0, 14400);
    const y = readNumber(options, 'y', 0, 0, 14400);
    const width = readNumber(options, 'width', 500, 1, 14400);
    const height = readNumber(options, 'height', 700, 1, 14400);
    for (const index of parsePageSelection(readString(options, 'pages'), pageCount)) {
      const page = source.getPage(index);
      const media = page.getMediaBox();
      if (x + width > media.width || y + height > media.height) throw new FileProcessingError('Crop bounds must fit within every selected page.');
      page.setCropBox(media.x + x, media.y + y, width, height);
    }
    return savePdf(source, outputName(name, 'pdf', 'cropped'));
  }
  if (operation === 'pdf.resize') {
    const width = readNumber(options, 'width', 612, 72, 14400);
    const height = readNumber(options, 'height', 792, 72, 14400);
    for (const index of parsePageSelection(readString(options, 'pages'), pageCount)) {
      const page = source.getPage(index);
      page.scale(width / page.getWidth(), height / page.getHeight());
    }
    return savePdf(source, outputName(name, 'pdf', 'resized'));
  }
  throw new FileProcessingError('This PDF operation is not supported.');
}

async function compressPdf(file: { fileName: string; data: Uint8Array }, options: Record<string, unknown>): Promise<ApiOutputFile> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(file.data), isEvalSupported: false, useSystemFonts: true, disableFontFace: true });
  let document: Awaited<typeof task.promise> | null = null;
  try {
    document = await task.promise;
    if (document.numPages < 1 || document.numPages > API_MAX_PDF_PAGES) throw new FileProcessingError(`PDF compression supports up to ${API_MAX_PDF_PAGES} pages.`);
    const dpi = readNumber(options, 'dpi', 110, 72, 160, true);
    const quality = readNumber(options, 'quality', 65, 25, 95, true) / 100;
    const scale = dpi / 72;
    const output = await PDFDocument.create();
    let renderedPixels = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const width = Math.ceil(viewport.width);
      const height = Math.ceil(viewport.height);
      renderedPixels += width * height;
      if (width < 1 || height < 1 || width * height > 32_000_000 || renderedPixels > API_MAX_PDF_PIXELS) throw new FileProcessingError('PDF compression exceeded the rasterization pixel limit. Try fewer pages or a lower DPI.');
      const createCanvas = getCreateCanvas();
      const canvas = createCanvas(width, height);
      const context = canvas.getContext('2d');
      await page.render({ canvasContext: context as never, viewport }).promise;
      const jpeg = canvas.toBuffer('image/jpeg', quality);
      const image = await output.embedJpg(jpeg);
      const outputPage = output.addPage([viewport.width / scale, viewport.height / scale]);
      outputPage.drawImage(image, { x: 0, y: 0, width: outputPage.getWidth(), height: outputPage.getHeight() });
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
    }
    const bytes = await output.save({ useObjectStreams: true, addDefaultPage: false });
    return toOutput(outputName(file.fileName, 'pdf', 'compressed'), 'application/pdf', bytes);
  } finally {
    await document?.destroy();
    await task.destroy();
  }
}

function decodeXml(value: string): string {
  return value.replace(/&#x([\da-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, number: string) => String.fromCodePoint(Number(number)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function plainFromMarkup(markup: string): string {
  return decodeXml(markup.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?\s*>|<\/(?:p|div|li|h[1-6]|tr|section|article)>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/[\t\u00a0 ]+/g, ' ').replace(/\n[\t ]*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function safeArchivePath(raw: string): string {
  const normalized = raw.replace(/\\/g, '/').normalize('NFKC');
  const parts = normalized.split('/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized) || parts.includes('..') || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new FileProcessingError('This archive contains an unsafe path and was not processed.');
  }
  const clean = parts.filter((part) => part && part !== '.').map((part) => part.slice(0, 160)).join('/');
  if (!clean || clean.length > 240) throw new FileProcessingError('This archive contains an invalid path.');
  return clean;
}

async function extractZipSafely(data: Uint8Array): Promise<Map<string, Uint8Array>> {
  const archive = new Unzip();
  archive.register(UnzipInflate);
  archive.register(UnzipPassThrough);
  const entries = new Map<string, Uint8Array>();
  const pending: Array<Promise<void>> = [];
  let totalBytes = 0;
  let entryCount = 0;
  let failure: Error | null = null;
  archive.onfile = (entry) => {
    if (entry.name.endsWith('/')) return;
    entryCount += 1;
    if (entryCount > API_MAX_ZIP_ENTRIES) {
      failure = new FileProcessingError(`ZIP extraction is limited to ${API_MAX_ZIP_ENTRIES} entries.`);
      entry.terminate();
      return;
    }
    let name: string;
    try { name = safeArchivePath(entry.name); }
    catch (error) { failure = error instanceof Error ? error : new FileProcessingError('This archive contains an unsafe path.'); entry.terminate(); return; }
    if (entries.has(name)) { failure = new FileProcessingError('This ZIP contains duplicate entry names.'); entry.terminate(); return; }
    if (typeof entry.originalSize === 'number' && (entry.originalSize > API_MAX_ARCHIVE_BYTES || totalBytes + entry.originalSize > API_MAX_ARCHIVE_BYTES)) {
      failure = new FileProcessingError('ZIP expansion exceeds the 32 MiB API safety limit.');
      entry.terminate();
      return;
    }
    let entryBytes = 0;
    const chunks: Uint8Array[] = [];
    const completed = new Promise<void>((resolve, reject) => {
      entry.ondata = (error, chunk, final) => {
        if (error) { reject(new FileProcessingError('The ZIP contains a damaged or unsupported entry.')); return; }
        entryBytes += chunk.byteLength;
        totalBytes += chunk.byteLength;
        if (entryBytes > API_MAX_ARCHIVE_BYTES || totalBytes > API_MAX_ARCHIVE_BYTES) {
          failure = new FileProcessingError('ZIP expansion stopped at the 32 MiB API safety limit.');
          entry.terminate();
          reject(failure);
          return;
        }
        if (chunk.byteLength) chunks.push(chunk);
        if (final) {
          const data = new Uint8Array(entryBytes);
          let offset = 0;
          for (const part of chunks) { data.set(part, offset); offset += part.byteLength; }
          entries.set(name, data);
          resolve();
        }
      };
    });
    pending.push(completed);
    try { entry.start(); }
    catch { failure = new FileProcessingError('The ZIP uses a compression method that is not supported.'); entry.terminate(); }
  };
  try { archive.push(data, true); }
  catch { throw new FileProcessingError('Could not read this ZIP archive.'); }
  try { await Promise.all(pending); }
  catch (error) { throw error instanceof Error ? error : new FileProcessingError('Could not extract the ZIP archive.'); }
  if (failure) throw failure;
  if (!entryCount || entries.size !== entryCount) throw new FileProcessingError('The ZIP archive contains no files or is incomplete.');
  return entries;
}

function gzipToBytes(data: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    const inflater = new Gunzip((chunk, final) => {
      total += chunk.byteLength;
      if (total > API_MAX_OUTPUT_BYTES) { reject(new FileProcessingError('GZIP expansion exceeded the 64 MiB API output limit.')); return; }
      if (chunk.byteLength) chunks.push(chunk);
      if (final) {
        const output = new Uint8Array(total);
        let offset = 0;
        for (const part of chunks) { output.set(part, offset); offset += part.byteLength; }
        resolve(output);
      }
    });
    try { inflater.push(data, true); }
    catch { reject(new FileProcessingError('Could not decompress this GZIP file.')); }
  });
}

function decodeZipText(data: Uint8Array): Promise<Map<string, Uint8Array>> {
  return extractZipSafely(data);
}

async function extractDocumentText(file: { fileName: string; data: Uint8Array }): Promise<string> {
  const extension = file.fileName.split('.').pop()?.toLowerCase() ?? '';
  if (extension === 'pdf') {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = getDocument({ data: new Uint8Array(file.data), isEvalSupported: false, useSystemFonts: true });
    try {
      const document = await task.promise;
      if (document.numPages > API_MAX_PDF_PAGES) throw new FileProcessingError(`Text extraction supports up to ${API_MAX_PDF_PAGES} PDF pages.`);
      const sections: string[] = [];
      for (let index = 1; index <= document.numPages; index += 1) {
        const page = await document.getPage(index);
        const content = await page.getTextContent();
        sections.push(content.items.map((item) => 'str' in item ? item.str : '').join(' '));
        page.cleanup();
      }
      return sections.join('\n\n');
    } finally { await task.destroy(); }
  }
  if (extension === 'txt' || extension === 'md' || extension === 'markdown' || extension === 'csv' || extension === 'json' || extension === 'log' || extension === 'text') {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(file.data);
    if (extension === 'json') { try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; } }
    return text;
  }
  if (extension === 'html' || extension === 'htm') return plainFromMarkup(new TextDecoder('utf-8', { fatal: false }).decode(file.data));
  if (extension !== 'docx' && extension !== 'odt' && extension !== 'epub') throw new FileProcessingError('Supported document text inputs are PDF, TXT, Markdown, CSV, JSON, HTML, DOCX, ODT, and EPUB.');

  const entries = await decodeZipText(file.data);
  const xmlText = (key: string): string => {
    const data = entries.get(key);
    if (!data) throw new FileProcessingError(`The ${extension.toUpperCase()} file is missing a required document entry.`);
    return new TextDecoder('utf-8', { fatal: false }).decode(data);
  };
  let text = '';
  if (extension === 'docx') {
    const xml = xmlText('word/document.xml');
    text = [...xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)].map((paragraph) => [...(paragraph[1] ?? '').matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((part) => decodeXml(part[1] ?? '')).join('')).join('\n');
  } else if (extension === 'odt') {
    const xml = xmlText('content.xml');
    text = [...xml.matchAll(/<(?:text:p|text:h)(?:\s[^>]*)?>([\s\S]*?)<\/(?:text:p|text:h)>/g)].map((paragraph) => plainFromMarkup(paragraph[1] ?? '')).join('\n');
  } else {
    const container = xmlText('META-INF/container.xml');
    const rootPath = /<rootfile\b[^>]*\bfull-path=["']([^"']+)["']/i.exec(container)?.[1];
    if (!rootPath) throw new FileProcessingError('The EPUB package manifest could not be found.');
    const opf = xmlText(safeArchivePath(decodeXml(rootPath)));
    const rootDirectory = rootPath.includes('/') ? rootPath.slice(0, rootPath.lastIndexOf('/') + 1) : '';
    const manifest = new Map<string, string>();
    for (const item of opf.matchAll(/<item\b[^>]*\bid=["']([^"']+)["'][^>]*\bhref=["']([^"']+)["'][^>]*>/gi)) {
      const href = decodeXml(item[2] ?? '').split('#')[0] ?? '';
      const path = safeArchivePath(`${rootDirectory}${href}`);
      manifest.set(item[1]!, path);
    }
    const ordered = [...opf.matchAll(/<itemref\b[^>]*\bidref=["']([^"']+)["'][^>]*>/gi)].map((match) => manifest.get(match[1]!)).filter((value): value is string => Boolean(value));
    if (!ordered.length) throw new FileProcessingError('The EPUB spine is empty or unsupported.');
    text = ordered.map((path) => plainFromMarkup(new TextDecoder('utf-8', { fatal: false }).decode(entries.get(path) ?? new Uint8Array()))).filter(Boolean).join('\n\n');
  }
  return text;
}

function wrapText(text: string, font: Awaited<ReturnType<PDFDocument['embedFont']>>, fontSize: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r/g, '').split('\n')) {
    if (!paragraph) { lines.push(''); continue; }
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, fontSize) <= maxWidth) line = next;
      else if (!line) {
        let fragment = '';
        for (const char of word) {
          const candidate = fragment + char;
          if (font.widthOfTextAtSize(candidate, fontSize) > maxWidth && fragment) { lines.push(fragment); fragment = char; }
          else fragment = candidate;
        }
        line = fragment;
      } else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
  }
  return lines;
}

async function textToPdf(file: { fileName: string; data: Uint8Array }): Promise<ApiOutputFile> {
  const extension = file.fileName.split('.').pop()?.toLowerCase() ?? '';
  if (['pdf', 'docx', 'odt', 'epub'].includes(extension)) throw new FileProcessingError('PDF output accepts text, Markdown, CSV, JSON, or HTML input.');
  const text = extension === 'html' || extension === 'htm'
    ? plainFromMarkup(new TextDecoder('utf-8', { fatal: false }).decode(file.data))
    : new TextDecoder('utf-8', { fatal: false }).decode(file.data);
  if (text.length > API_MAX_TEXT_CHARS) throw new FileProcessingError('Text-to-PDF input is limited to one million characters.');
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontSize = 10;
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 40;
  const lineHeight = 13;
  const lines = wrapText(text, font, fontSize, pageWidth - margin * 2);
  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;
  let pageCount = 1;
  for (const line of lines) {
    if (y < margin) {
      if (pageCount >= API_MAX_PDF_PAGES) throw new FileProcessingError(`Text-to-PDF output is limited to ${API_MAX_PDF_PAGES} pages.`);
      page = pdf.addPage([pageWidth, pageHeight]);
      pageCount += 1;
      y = pageHeight - margin;
    }
    if (line) page.drawText(line, { x: margin, y, size: fontSize, font, maxWidth: pageWidth - margin * 2 });
    y -= lineHeight;
  }
  return savePdf(pdf, outputName(file.fileName, 'pdf'));
}

function createZip(files: Array<{ fileName: string; data: Uint8Array }>): ApiOutputFile {
  if (!files.length) throw new FileProcessingError('Choose at least one file to add to the ZIP.');
  const content: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  for (const file of files) {
    const name = safeBaseName(file.fileName);
    if (!name) throw new FileProcessingError('ZIP inputs require safe file names.');
    let unique = name;
    let suffix = 2;
    while (used.has(unique.toLowerCase())) {
      const dot = name.lastIndexOf('.');
      unique = `${dot > 0 ? name.slice(0, dot) : name} (${suffix++})${dot > 0 ? name.slice(dot) : ''}`;
    }
    used.add(unique.toLowerCase());
    content[unique] = file.data;
  }
  const bytes = zipSync(content, { level: 6 });
  return toOutput('files.zip', 'application/zip', bytes);
}

export async function processFileApiJob(request: ApiJobRequest): Promise<ApiOutputFile> {
  if (!request.files.length || request.files.length > API_MAX_BATCH_FILES) throw new FileProcessingError(`A job needs 1 to ${API_MAX_BATCH_FILES} input files.`);
  const files = request.files.map(decodeBase64File);
  const totalBytes = files.reduce((sum, file) => sum + file.data.byteLength, 0);
  if (totalBytes > API_MAX_TOTAL_INPUT_BYTES) throw new FileProcessingError(`Combined input is limited to ${API_MAX_TOTAL_INPUT_BYTES / 1024 / 1024} MiB per job.`);
  const singleInputOperations: FileApiOperation[] = ['image.convert', 'image.compress', 'image.resize', 'image.crop', 'image.rotate', 'gif.compress', 'pdf.extract', 'pdf.remove', 'pdf.rotate', 'pdf.reorder', 'pdf.crop', 'pdf.resize', 'pdf.flatten', 'pdf.compress', 'document.to-pdf', 'document.extract-text', 'archive.extract-zip', 'archive.gzip', 'archive.gunzip'];
  if (singleInputOperations.includes(request.operation) && files.length !== 1) throw new FileProcessingError(`${request.operation} accepts exactly one input file.`);
  if (request.operation === 'pdf.merge' && (files.length < 2 || files.length > 20)) throw new FileProcessingError('PDF merge accepts 2 to 20 PDFs.');
  if (request.operation === 'archive.create-zip' && files.length > 20) throw new FileProcessingError('ZIP creation accepts up to 20 files.');
  const options = request.options ?? {};
  const imageOperations = ['image.convert', 'image.compress', 'image.resize', 'image.crop', 'image.rotate', 'gif.compress'] as const;
  if ((imageOperations as readonly string[]).includes(request.operation)) return processImage(request.operation as typeof imageOperations[number], files[0]!, options);
  if (request.operation.startsWith('pdf.')) return processPdf(request.operation as Exclude<FileApiOperation, 'image.convert' | 'image.compress' | 'image.resize' | 'image.crop' | 'image.rotate' | 'gif.compress' | 'document.to-pdf' | 'document.extract-text' | 'archive.create-zip' | 'archive.extract-zip' | 'archive.gzip' | 'archive.gunzip'>, files, options);
  if (request.operation === 'document.to-pdf') return textToPdf(files[0]!);
  if (request.operation === 'document.extract-text') {
    const text = await extractDocumentText(files[0]!);
    if (text.length > API_MAX_TEXT_CHARS) throw new FileProcessingError('Extracted text exceeded the one million character API limit.');
    return toOutput(outputName(files[0]!.fileName, 'txt', 'extracted'), 'text/plain; charset=utf-8', new TextEncoder().encode(text));
  }
  if (request.operation === 'archive.create-zip') return createZip(files);
  if (request.operation === 'archive.extract-zip') {
    const entries = await extractZipSafely(files[0]!.data);
    const payload: Record<string, Uint8Array> = {};
    for (const [path, data] of entries) payload[path] = data;
    return toOutput(outputName(files[0]!.fileName, 'zip', 'extracted'), 'application/zip', zipSync(payload, { level: 6 }));
  }
  if (request.operation === 'archive.gzip') {
    const level = readNumber(options, 'level', 6, 1, 9, true) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
    const output = gzipSync(files[0]!.data, { level });
    return toOutput(outputName(files[0]!.fileName, 'gz'), 'application/gzip', output);
  }
  if (request.operation === 'archive.gunzip') {
    const output = await gzipToBytes(files[0]!.data);
    const cleanName = files[0]!.fileName.toLowerCase().endsWith('.gz') ? files[0]!.fileName.slice(0, -3) || 'decompressed' : files[0]!.fileName;
    return toOutput(safeBaseName(cleanName), 'application/octet-stream', output);
  }
  throw new FileProcessingError('This file operation is not supported by the REST API.');
}
