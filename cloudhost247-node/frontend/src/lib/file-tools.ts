import { AsyncZipDeflate, Gunzip, Unzip, UnzipInflate, UnzipPassThrough, Zip, gzipSync, zipSync } from 'fflate';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import {
  MAX_CONVERTER_FILES,
  MAX_CONVERTER_FILE_BYTES,
  MAX_OUTPUT_DIMENSION,
  MAX_OUTPUT_PIXELS,
  MAX_PDF_PAGES,
  MAX_ZIP_ARCHIVE_BYTES,
  fitOutputDimensions,
  outputExtension,
  parsePdfPageSelection,
  safeOutputFileName,
  type ConvertedOutput,
  type OutputFormat,
} from './file-converter';

export const FILE_TOOL_MAX_TOTAL_BYTES = MAX_CONVERTER_FILES * MAX_CONVERTER_FILE_BYTES;

export type PdfOperation = 'merge' | 'extract' | 'remove' | 'rotate' | 'reorder' | 'flatten' | 'crop' | 'resize' | 'protect' | 'unlock';
export type PdfEditOperation = Exclude<PdfOperation, 'merge' | 'protect' | 'unlock'>;

export interface PdfToolResult {
  fileName: string;
  blob: Blob;
  pageCount: number;
}

function assertPdfFile(file: File): void {
  if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
    throw new Error(`“${file.name}” is not a PDF file.`);
  }
  if (file.size > MAX_CONVERTER_FILE_BYTES) {
    throw new Error(`“${file.name}” is larger than the ${Math.round(MAX_CONVERTER_FILE_BYTES / 1024 / 1024)} MiB local file limit.`);
  }
}

function pdfBlob(bytes: Uint8Array): Blob {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type: 'application/pdf' });
}

function validatePdfPassword(password: string, field: string): void {
  if (!password || password.length > 128 || /[\u0000\r\n]/.test(password)) {
    throw new Error(`${field} must contain 1 to 128 characters and cannot include line breaks.`);
  }
}

async function runQpdf(file: File, args: string[], outputName: string): Promise<Uint8Array> {
  assertPdfFile(file);
  const [{ createQpdfRunner }] = await Promise.all([import('qpdf-run')]);
  const runner = await createQpdfRunner({
    workerUrl: new URL('qpdf-run/worker', import.meta.url),
    qpdfJsUrl: new URL('qpdf-run/qpdf.js', import.meta.url),
    wasmUrl: new URL('qpdf-run/qpdf.wasm', import.meta.url),
    timeoutMs: 120_000,
  });
  try {
    const result = await runner.runOne({
      input: new Uint8Array(await file.arrayBuffer()),
      inputName: 'input.pdf',
      outputName,
      args,
    });
    if (result.byteLength > MAX_ZIP_ARCHIVE_BYTES) throw new Error('PDF output exceeded the 250 MiB browser safety limit.');
    if (result.byteLength < 5 || new TextDecoder().decode(result.subarray(0, 5)) !== '%PDF-') throw new Error('The PDF security operation returned invalid output.');
    return result;
  } finally {
    await runner.destroy();
  }
}

/** Encrypt a PDF locally with AES-256 and a user/owner password. */
export async function protectPdfFile(file: File, userPassword: string, ownerPassword: string): Promise<ConvertedOutput> {
  validatePdfPassword(userPassword, 'User password');
  validatePdfPassword(ownerPassword, 'Owner password');
  const outputName = safeOutputFileName(file.name, 'pdf', 'protected');
  const bytes = await runQpdf(file, ['--encrypt', userPassword, ownerPassword, '256', '--', 'input.pdf', outputName], outputName);
  return { fileName: outputName, blob: pdfBlob(bytes) };
}

/** Decrypt a PDF only when the supplied user or owner password is valid. */
export async function unlockPdfFile(file: File, password: string): Promise<ConvertedOutput> {
  validatePdfPassword(password, 'PDF password');
  const outputName = safeOutputFileName(file.name, 'pdf', 'unlocked');
  const bytes = await runQpdf(file, [`--password=${password}`, '--decrypt', '--', 'input.pdf', outputName], outputName);
  return { fileName: outputName, blob: pdfBlob(bytes) };
}

async function loadPdf(file: File): Promise<PDFDocument> {
  assertPdfFile(file);
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()), {
      updateMetadata: false,
      throwOnInvalidObject: true,
    });
  } catch {
    throw new Error(`Could not read “${file.name}”. It may be damaged or password-protected.`);
  }
  if (document.getPageCount() < 1) throw new Error(`“${file.name}” has no pages.`);
  if (document.getPageCount() > MAX_PDF_PAGES) {
    throw new Error(`“${file.name}” has more than ${MAX_PDF_PAGES} pages, the local limit.`);
  }
  return document;
}

async function savePdf(document: PDFDocument, fileName: string): Promise<PdfToolResult> {
  const pageCount = document.getPageCount();
  const bytes = await document.save({ useObjectStreams: true, addDefaultPage: false });
  if (bytes.byteLength > MAX_ZIP_ARCHIVE_BYTES) throw new Error('PDF output exceeded the 250 MiB browser safety limit.');
  return { fileName, blob: pdfBlob(bytes), pageCount };
}

/** Merge PDFs in the order selected. All pages stay in the browser; no form fields are uploaded. */
export async function mergePdfFiles(files: readonly File[]): Promise<PdfToolResult> {
  if (files.length < 2) throw new Error('Choose at least two PDFs to merge.');
  if (files.length > MAX_CONVERTER_FILES) throw new Error(`Choose no more than ${MAX_CONVERTER_FILES} PDFs at a time.`);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > FILE_TOOL_MAX_TOTAL_BYTES) throw new Error('The combined PDFs exceed the local batch-size limit.');

  const output = await PDFDocument.create();
  let totalPages = 0;
  for (const file of files) {
    const source = await loadPdf(file);
    totalPages += source.getPageCount();
    if (totalPages > MAX_PDF_PAGES) {
      throw new Error(`Merged PDFs can contain up to ${MAX_PDF_PAGES} pages in this browser tool.`);
    }
    const pages = await output.copyPages(source, source.getPageIndices());
    pages.forEach((page) => output.addPage(page));
  }
  return savePdf(output, safeOutputFileName('merged-pdfs', 'pdf'));
}

/** Extract, remove, rotate or reorder pages in one PDF without sending it to the server. */
export async function editPdfFile(
  file: File,
  operation: PdfEditOperation,
  selection = '',
  rotation: 90 | 180 | 270 = 90,
  order = '',
  geometry: { x: number; y: number; width: number; height: number } = { x: 0, y: 0, width: 0, height: 0 },
): Promise<PdfToolResult> {
  const source = await loadPdf(file);
  const pageCount = source.getPageCount();
  let output: PDFDocument;
  let outputName = safeOutputFileName(file.name, 'pdf', `edited`);

  if (operation === 'extract') {
    const pages = parsePdfPageSelection(selection, pageCount).map((page) => page - 1);
    output = await PDFDocument.create();
    (await output.copyPages(source, pages)).forEach((page) => output.addPage(page));
    outputName = safeOutputFileName(file.name, 'pdf', 'pages');
  } else if (operation === 'remove') {
    const removed = new Set(parsePdfPageSelection(selection, pageCount).map((page) => page - 1));
    if (removed.size >= pageCount) throw new Error('Keep at least one page in the PDF.');
    for (const index of [...removed].sort((a, b) => b - a)) source.removePage(index);
    output = source;
    outputName = safeOutputFileName(file.name, 'pdf', 'pages-removed');
  } else if (operation === 'rotate') {
    const indices = parsePdfPageSelection(selection, pageCount).map((page) => page - 1);
    for (const index of indices) {
      const page = source.getPage(index);
      page.setRotation(degrees((page.getRotation().angle + rotation) % 360));
    }
    output = source;
    outputName = safeOutputFileName(file.name, 'pdf', `rotated-${rotation}`);
  } else if (operation === 'reorder') {
    const pageOrder = parsePageOrder(order, pageCount).map((page) => page - 1);
    output = await PDFDocument.create();
    (await output.copyPages(source, pageOrder)).forEach((page) => output.addPage(page));
    outputName = safeOutputFileName(file.name, 'pdf', 'reordered');
  } else if (operation === 'flatten') {
    const form = source.getForm();
    if (form.getFields().length) form.flatten();
    output = source;
    outputName = safeOutputFileName(file.name, 'pdf', 'flattened');
  } else if (operation === 'crop') {
    const x = Number(geometry.x);
    const y = Number(geometry.y);
    const width = Number(geometry.width);
    const height = Number(geometry.height);
    if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0) {
      throw new Error('Enter valid PDF crop coordinates and dimensions in points.');
    }
    const indices = parsePdfPageSelection(selection, pageCount).map((page) => page - 1);
    for (const index of indices) {
      const page = source.getPage(index);
      const media = page.getMediaBox();
      if (x + width > media.width || y + height > media.height) {
        throw new Error(`Crop bounds must fit inside every selected page (${media.width.toFixed(0)} by ${media.height.toFixed(0)} points).`);
      }
      page.setCropBox(media.x + x, media.y + y, width, height);
    }
    output = source;
    outputName = safeOutputFileName(file.name, 'pdf', 'cropped');
  } else {
    const targetWidth = Number(geometry.width);
    const targetHeight = Number(geometry.height);
    if (![targetWidth, targetHeight].every((value) => Number.isFinite(value) && value >= 72 && value <= 14400)) {
      throw new Error('Page dimensions must be between 72 and 14,400 points.');
    }
    const indices = parsePdfPageSelection(selection, pageCount).map((page) => page - 1);
    for (const index of indices) {
      const page = source.getPage(index);
      page.scale(targetWidth / page.getWidth(), targetHeight / page.getHeight());
    }
    output = source;
    outputName = safeOutputFileName(file.name, 'pdf', 'resized');
  }
  return savePdf(output, outputName);
}

export function parsePageOrder(order: string, totalPages: number): number[] {
  const normalized = order.trim();
  if (!normalized) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const parts = normalized.split(',').map((part) => part.trim());
  if (parts.some((part) => !/^\d+$/.test(part))) {
    throw new Error(`List every page once, such as ${Array.from({ length: totalPages }, (_, index) => totalPages - index).join(', ')}.`);
  }
  const pages = parts.map(Number);
  if (
    pages.length !== totalPages ||
    pages.some((page) => !Number.isSafeInteger(page) || page < 1 || page > totalPages) ||
    new Set(pages).size !== totalPages
  ) {
    throw new Error(`Reordering needs each page from 1 to ${totalPages} exactly once.`);
  }
  return pages;
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The browser could not encode this PDF page.'));
    }, 'image/jpeg', quality);
  });
}

/**
 * PDF compression is performed locally by rasterizing pages and rebuilding a lightweight PDF.
 * This reduces image-heavy PDFs but intentionally flattens searchable text, forms and links.
 */
export async function compressPdfFile(
  file: File,
  options: { quality: number; dpi: number },
  onProgress?: (completed: number, total: number) => void,
): Promise<ConvertedOutput> {
  assertPdfFile(file);
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
  let source: Awaited<typeof loadingTask.promise> | null = null;
  try {
    source = await loadingTask.promise;
    if (source.numPages < 1) throw new Error('This PDF has no pages.');
    if (source.numPages > MAX_PDF_PAGES) throw new Error(`PDF compression supports up to ${MAX_PDF_PAGES} pages per file.`);
    const output = await PDFDocument.create();
    const requestedScale = Math.min(2.5, Math.max(0.5, options.dpi / 72));
    const quality = Math.min(0.95, Math.max(0.25, options.quality / 100));

    for (let pageNumber = 1; pageNumber <= source.numPages; pageNumber += 1) {
      onProgress?.(pageNumber, source.numPages);
      const page = await source.getPage(pageNumber);
      let canvas: HTMLCanvasElement | null = null;
      try {
        const baseViewport = page.getViewport({ scale: 1 });
        const requestedViewport = page.getViewport({ scale: requestedScale });
        const dimensions = fitOutputDimensions(
          requestedViewport.width,
          requestedViewport.height,
          MAX_OUTPUT_DIMENSION,
          MAX_OUTPUT_DIMENSION,
        );
        const renderScale = requestedScale * Math.min(
          dimensions.width / requestedViewport.width,
          dimensions.height / requestedViewport.height,
          Math.sqrt(MAX_OUTPUT_PIXELS / (requestedViewport.width * requestedViewport.height)),
        );
        const viewport = page.getViewport({ scale: renderScale });
        canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('This browser could not start the PDF compressor.');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: context, viewport }).promise;
        const jpeg = await canvasToBlob(canvas, quality);
        const embedded = await output.embedJpg(new Uint8Array(await jpeg.arrayBuffer()));
        const outputPage = output.addPage([baseViewport.width, baseViewport.height]);
        outputPage.drawImage(embedded, { x: 0, y: 0, width: baseViewport.width, height: baseViewport.height });
      } finally {
        page.cleanup();
        if (canvas) { canvas.width = 0; canvas.height = 0; }
      }
    }

    const bytes = await output.save({ useObjectStreams: true, addDefaultPage: false });
    return { fileName: safeOutputFileName(file.name, 'pdf', 'compressed'), blob: pdfBlob(bytes) };
  } catch (error) {
    if (error instanceof Error && /password|invalid password/i.test(error.message)) {
      throw new Error('Password-protected PDFs cannot be compressed in this browser tool.');
    }
    throw new Error(error instanceof Error ? error.message : 'The PDF could not be compressed.');
  } finally {
    if (source) await source.destroy().catch(() => undefined);
    else await loadingTask.destroy().catch(() => undefined);
  }
}

export function createImageCompressionSettings(quality: number, maxWidth = 4096, maxHeight = 4096) {
  return {
    quality,
    resize: true,
    maxWidth,
    maxHeight,
    dpi: 150,
    suffix: 'compressed',
    rotation: 0 as const,
    flipHorizontal: false,
    flipVertical: false,
    crop: { left: 0, top: 0, width: 100, height: 100 },
    pdfPages: '',
    combineImagesToPdf: false,
  };
}

export function imageCompressionOutputFormat(format: string): Exclude<OutputFormat, 'pdf'> {
  if (format === 'png' || format === 'jpeg' || format === 'webp') return format;
  return 'webp';
}

export function pdfOutputName(inputName: string, suffix = 'compressed'): string {
  return `${safeOutputFileName(inputName, 'pdf', suffix).replace(/\.[^.]+$/, '')}.${outputExtension('pdf')}`;
}

export type LocalMediaKind = 'audio' | 'video';
export type LocalMediaFormat = 'mp3' | 'wav' | 'flac' | 'ogg' | 'mp4' | 'webm';

const MEDIA_INPUT_EXTENSIONS: Record<LocalMediaKind, readonly string[]> = {
  audio: ['aac', 'flac', 'm4a', 'm4b', 'm4v', 'mkv', 'mov', 'mp3', 'mp4', 'oga', 'ogg', 'opus', 'm2ts', 'mts', 'ts', 'wav', 'wave', 'webm'],
  video: ['m4v', 'mkv', 'mov', 'mp4', 'm2ts', 'mts', 'ts', 'webm'],
};
const MAX_MEDIA_DURATION_SECONDS = 10 * 60;
const MEDIA_OUTPUT_CHUNK_BYTES = 4 * 1024 * 1024;

function safeMediaOutputName(fileName: string, extension: string): string {
  const base = fileName
    .replace(/[\\/]+/g, '-')
    .replace(/\.[^.]*$/, '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 100) || 'media';
  return `${base}-converted.${extension.replace(/^\.+/, '')}`;
}

/** Convert or compress common audio/video files with browser WebCodecs; no media bytes leave the device. */
export async function convertLocalMedia(
  file: File,
  kind: LocalMediaKind,
  format: LocalMediaFormat,
  options: {
    quality?: number;
    audioBitrate?: number;
    trimStart?: number;
    trimEnd?: number;
    crop?: { left: number; top: number; width: number; height: number };
  } = {},
  onProgress?: (fraction: number) => void,
): Promise<ConvertedOutput> {
  const mediaExtension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!MEDIA_INPUT_EXTENSIONS[kind].includes(mediaExtension)) {
    throw new Error(`Choose a supported ${kind} file (${MEDIA_INPUT_EXTENSIONS[kind].map((extension) => `.${extension}`).join(', ')}).`);
  }
  if (file.size > MAX_CONVERTER_FILE_BYTES) {
    throw new Error(`Media files must be no larger than ${Math.round(MAX_CONVERTER_FILE_BYTES / 1024 / 1024)} MiB.`);
  }
  if (kind === 'audio' && !['mp3', 'wav', 'flac', 'ogg'].includes(format)) throw new Error('Choose an audio output format.');
  if (kind === 'video' && !['mp4', 'webm'].includes(format)) throw new Error('Choose an MP4 or WebM video output format.');

  const {
    ALL_FORMATS,
    BlobSource,
    Conversion,
    FlacOutputFormat,
    Mp3OutputFormat,
    Mp4OutputFormat,
    OggOutputFormat,
    Output,
    Quality,
    StreamTarget,
    WavOutputFormat,
    WebMOutputFormat,
    canEncodeAudio,
    canEncodeVideo,
    Input,
  } = await import('mediabunny');

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  let output: InstanceType<typeof Output> | null = null;
  try {
    const videoTrack = kind === 'video' ? await input.getPrimaryVideoTrack() : null;
    const audioTrack = await input.getPrimaryAudioTrack();
    if (kind === 'video' && !videoTrack) throw new Error('No readable video track was found in this file.');
    if (!audioTrack && kind === 'audio') throw new Error('No readable audio track was found in this file.');

    const tracks = [videoTrack, audioTrack].filter((track) => track !== null);
    const duration = await input.getDurationFromMetadata(tracks) ?? await input.computeDuration(tracks);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('The media duration could not be read.');
    if (duration > MAX_MEDIA_DURATION_SECONDS) throw new Error('Browser media conversion is limited to 10 minutes per file.');
    const trimStart = options.trimStart ?? 0;
    const trimEnd = options.trimEnd ?? duration;
    if (!Number.isFinite(trimStart) || !Number.isFinite(trimEnd) || trimStart < 0 || trimEnd > duration || trimEnd <= trimStart) {
      throw new Error(`Choose a trim range within the ${duration.toFixed(2)} second duration.`);
    }
    if (kind === 'audio' && (trimStart > 0 || trimEnd < duration) && (format === 'mp4' || format === 'webm')) {
      throw new Error('Choose an audio output format.');
    }
    if (options.crop) {
      const { left, top, width, height } = options.crop;
      if (kind !== 'video' || ![left, top, width, height].every(Number.isFinite) || left < 0 || top < 0 || width <= 0 || height <= 0) {
        throw new Error('Enter a positive video crop rectangle in pixels.');
      }
      const sourceWidth = await videoTrack!.getDisplayWidth();
      const sourceHeight = await videoTrack!.getDisplayHeight();
      if (left + width > sourceWidth || top + height > sourceHeight) {
        throw new Error(`Crop rectangle must stay inside the ${sourceWidth} by ${sourceHeight} video frame.`);
      }
    }

    let outputFormat;
    let videoCodec: 'avc' | 'vp9' | null = null;
    let audioCodec: 'aac' | 'opus' | 'mp3' | 'flac' | 'pcm-s16' | null = null;
    if (kind === 'video') {
      if (format === 'mp4') {
        outputFormat = new Mp4OutputFormat();
        videoCodec = 'avc';
        audioCodec = audioTrack ? 'aac' : null;
      } else {
        outputFormat = new WebMOutputFormat();
        videoCodec = 'vp9';
        audioCodec = audioTrack ? 'opus' : null;
      }
    } else if (format === 'mp3') {
      outputFormat = new Mp3OutputFormat();
      audioCodec = 'mp3';
    } else if (format === 'flac') {
      outputFormat = new FlacOutputFormat();
      audioCodec = 'flac';
    } else if (format === 'ogg') {
      outputFormat = new OggOutputFormat();
      audioCodec = 'opus';
    } else {
      outputFormat = new WavOutputFormat();
      audioCodec = 'pcm-s16';
    }

    if (videoCodec && !(await canEncodeVideo(videoCodec))) {
      throw new Error(`This browser cannot encode ${videoCodec.toUpperCase()} video. Try WebM/VP9 or MP4/H.264 in a current browser.`);
    }
    if (audioCodec) {
      let audioSupported = await canEncodeAudio(audioCodec);
      if (!audioSupported && audioCodec === 'mp3') {
        const { registerMp3Encoder } = await import('@mediabunny/mp3-encoder');
        registerMp3Encoder();
        audioSupported = await canEncodeAudio(audioCodec);
      } else if (!audioSupported && audioCodec === 'flac') {
        const { registerFlacEncoder } = await import('@mediabunny/flac-encoder');
        registerFlacEncoder();
        audioSupported = await canEncodeAudio(audioCodec);
      }
      if (!audioSupported) {
        throw new Error(`This browser cannot encode ${audioCodec.toUpperCase()} audio. Try another output format or an updated browser.`);
      }
    }

    const writtenChunks = new Map<number, Uint8Array<ArrayBuffer>>();
    let maxWrittenPosition = 0;
    const writable = new WritableStream<{ type: 'write'; data: Uint8Array; position: number }>({
      write({ data, position }) {
        const end = position + data.byteLength;
        if (end > MAX_ZIP_ARCHIVE_BYTES) throw new Error('Media output exceeded the 250 MiB browser safety limit.');
        maxWrittenPosition = Math.max(maxWrittenPosition, end);
        let sourceOffset = 0;
        while (sourceOffset < data.byteLength) {
          const absolutePosition = position + sourceOffset;
          const chunkIndex = Math.floor(absolutePosition / MEDIA_OUTPUT_CHUNK_BYTES);
          const chunkOffset = absolutePosition % MEDIA_OUTPUT_CHUNK_BYTES;
          let chunk = writtenChunks.get(chunkIndex);
          if (!chunk) { chunk = new Uint8Array(MEDIA_OUTPUT_CHUNK_BYTES); writtenChunks.set(chunkIndex, chunk); }
          const length = Math.min(data.byteLength - sourceOffset, MEDIA_OUTPUT_CHUNK_BYTES - chunkOffset);
          chunk.set(data.subarray(sourceOffset, sourceOffset + length), chunkOffset);
          sourceOffset += length;
        }
      },
    });
    const target = new StreamTarget(writable, { chunked: true, chunkSize: MEDIA_OUTPUT_CHUNK_BYTES });
    target.onwrite = (_start, end) => {
      if (end > MAX_ZIP_ARCHIVE_BYTES) throw new Error('Media output exceeded the 250 MiB browser safety limit.');
    };
    output = new Output({ format: outputFormat, target });
    const videoDimensions = videoTrack
      ? fitOutputDimensions(await videoTrack.getDisplayWidth(), await videoTrack.getDisplayHeight(), MAX_OUTPUT_DIMENSION, MAX_OUTPUT_DIMENSION)
      : null;

    const conversion = await Conversion.init({
      input,
      output,
      tracks: 'primary',
      showWarnings: false,
      ...(trimStart > 0 || trimEnd < duration ? { trim: { start: trimStart, end: trimEnd } } : {}),
      ...(videoCodec && videoTrack ? {
        video: {
          codec: videoCodec,
          quality: new Quality({ quality: Math.min(0.95, Math.max(0.25, (options.quality ?? 65) / 100)) }),
          ...(videoDimensions ?? {}),
          fit: 'contain',
          ...(options.crop ? { crop: options.crop } : {}),
        },
        audio: audioTrack && audioCodec ? { codec: audioCodec, quality: new Quality({ bitrate: options.audioBitrate ?? 128_000 }) } : { discard: true },
      } : {
        video: { discard: true },
        audio: audioCodec === 'mp3' || audioCodec === 'opus'
          ? { codec: audioCodec, quality: new Quality({ bitrate: options.audioBitrate ?? 128_000 }) }
          : { codec: audioCodec!, sampleFormat: 's16' as const },
      }),
    });
    if (!conversion.isValid) {
      const reasons = conversion.discardedTracks.map(({ reason }) => reason).filter(Boolean).join(', ');
      throw new Error(reasons || 'The browser could not prepare a compatible output for this media.');
    }
    conversion.onProgress = (fraction) => onProgress?.(Math.max(0, Math.min(1, fraction)));
    await conversion.execute();
    if (maxWrittenPosition < 1) throw new Error('The browser did not produce a media output.');

    const parts: Uint8Array<ArrayBuffer>[] = [];
    const zeroChunk = new Uint8Array(new ArrayBuffer(MEDIA_OUTPUT_CHUNK_BYTES));
    const chunkCount = Math.ceil(maxWrittenPosition / MEDIA_OUTPUT_CHUNK_BYTES);
    for (let index = 0; index < chunkCount; index += 1) {
      const length = Math.min(MEDIA_OUTPUT_CHUNK_BYTES, maxWrittenPosition - index * MEDIA_OUTPUT_CHUNK_BYTES);
      parts.push((writtenChunks.get(index) ?? zeroChunk).subarray(0, length));
    }
    const extension = outputFormat.fileExtension;
    return {
      fileName: safeMediaOutputName(file.name, extension),
      blob: new Blob(parts, { type: await output.getMimeType() }),
    };
  } catch (error) {
    if (error instanceof Error && /250 MiB/.test(error.message)) throw error;
    if (error instanceof Error && /10 minutes|No readable|Choose a supported|MiB|output format|cannot encode/.test(error.message)) throw error;
    throw new Error(error instanceof Error ? `Browser media processing failed: ${error.message}` : 'Browser media processing failed.');
  } finally {
    input.dispose();
    if (output && output.state !== 'finalized' && output.state !== 'canceled') await output.cancel().catch(() => undefined);
  }
}

const MAX_ARCHIVE_EXPANDED_BYTES = 250 * 1024 * 1024;
const MAX_ARCHIVE_FILES = 100;
const MAX_TEXT_DOCUMENT_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_PDF_PAGES = 100;

/** Create a DEFLATE-compressed ZIP locally; ZIP entry names are flattened and uniquified. */
export async function createCompressedZipArchive(
  files: readonly File[],
  onProgress?: (completed: number, total: number) => void,
): Promise<Blob> {
  if (files.length === 0) throw new Error('Choose at least one file to add to the ZIP.');
  if (files.length > MAX_CONVERTER_FILES) throw new Error(`Choose up to ${MAX_CONVERTER_FILES} files per ZIP.`);
  const inputBytes = files.reduce((total, file) => total + file.size, 0);
  if (files.some((file) => file.size > MAX_CONVERTER_FILE_BYTES)) throw new Error('Each ZIP input is limited to 25 MiB.');
  if (inputBytes > MAX_ARCHIVE_EXPANDED_BYTES) throw new Error('ZIP inputs are limited to 250 MiB combined.');

  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let outputBytes = 0;
  let failure: Error | null = null;
  let resolveFinished!: (blob: Blob) => void;
  let rejectFinished!: (error: Error) => void;
  const finished = new Promise<Blob>((resolve, reject) => { resolveFinished = resolve; rejectFinished = reject; });
  void finished.catch(() => undefined);
  const archive = new Zip((error, chunk, final) => {
    if (error) {
      failure = error instanceof Error ? error : new Error('Could not compress these files into a ZIP.');
      rejectFinished(failure);
      return;
    }
    outputBytes += chunk.byteLength;
    if (outputBytes > MAX_ZIP_ARCHIVE_BYTES) {
      failure = new Error('ZIP output exceeded the 250 MiB browser safety limit.');
      archive.terminate();
      rejectFinished(failure);
      return;
    }
    if (chunk.byteLength > 0) chunks.push(chunk);
    if (final) resolveFinished(new Blob(chunks, { type: 'application/zip' }));
  });

  const usedNames = new Set<string>();
  try {
    for (let index = 0; index < files.length; index += 1) {
      if (failure) throw failure;
      const file = files[index]!;
      const original = safeFlatFileName(file.name, 'file');
      const dot = original.lastIndexOf('.');
      const base = dot > 0 ? original.slice(0, dot) : original;
      const extension = dot > 0 ? original.slice(dot) : '';
      let name = original;
      let suffix = 2;
      while (usedNames.has(name.toLowerCase())) { name = `${base} (${suffix})${extension}`; suffix += 1; }
      usedNames.add(name.toLowerCase());

      const entry = new AsyncZipDeflate(name, { level: 6 });
      archive.add(entry);
      if (typeof file.stream === 'function') {
        const reader = file.stream().getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) { entry.push(new Uint8Array(0), true); break; }
            entry.push(value);
          }
        } finally {
          reader.releaseLock();
        }
      } else {
        entry.push(new Uint8Array(await file.arrayBuffer()), true);
      }
      onProgress?.(index + 1, files.length);
    }
    if (failure) throw failure;
    archive.end();
    return await finished;
  } catch (error) {
    archive.terminate();
    if (error instanceof Error && /250 MiB/.test(error.message)) throw error;
    throw new Error(error instanceof Error ? error.message : 'Could not create this ZIP archive.');
  }
}

function safeArchiveEntryName(rawName: string): string {
  const normalized = rawName.replace(/\\/g, '/').normalize('NFKC');
  const segments = normalized.split('/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized) || segments.includes('..')) {
    throw new Error('This ZIP contains an unsafe file path and was not extracted.');
  }
  const base = segments.at(-1)?.replace(/[\\/]/g, '-').replace(/[\u0000-\u001f\u007f]/g, '-').slice(0, 160) ?? '';
  if (!base || base === '.' || base === '..') throw new Error('This ZIP contains an invalid file name.');
  return base;
}

/**
 * Extract ZIP entries incrementally with strict entry and expanded-size limits. Paths are reduced
 * to safe basenames because downloads must never create directories or write to a filesystem.
 */
async function extractZipEntries(file: File): Promise<ConvertedOutput[]> {
  if (!/\.(zip|docx|odt|epub)$/i.test(file.name)) throw new Error('Choose a ZIP, DOCX, ODT, or EPUB file.');
  if (file.size > MAX_CONVERTER_FILE_BYTES) throw new Error('ZIP files must be no larger than 25 MiB.');
  const archive = new Unzip();
  archive.register(UnzipInflate);
  archive.register(UnzipPassThrough);
  const outputs: ConvertedOutput[] = [];
  const usedNames = new Set<string>();
  let filesSeen = 0;
  let expandedBytes = 0;
  let failure: Error | null = null;

  archive.onfile = (entry) => {
    if (entry.name.endsWith('/')) return;
    filesSeen += 1;
    if (filesSeen > MAX_ARCHIVE_FILES) {
      failure = new Error(`ZIP extraction is limited to ${MAX_ARCHIVE_FILES} files.`);
      entry.terminate();
      return;
    }
    if (typeof entry.originalSize === 'number' && entry.originalSize > MAX_ARCHIVE_EXPANDED_BYTES) {
      failure = new Error('This ZIP expands beyond the 250 MiB browser safety limit.');
      entry.terminate();
      return;
    }

    let name: string;
    try {
      name = safeArchiveEntryName(entry.name);
    } catch (error) {
      failure = error instanceof Error ? error : new Error('This ZIP contains an unsafe file path.');
      entry.terminate();
      return;
    }
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : '';
    let uniqueName = name;
    let suffix = 2;
    while (usedNames.has(uniqueName.toLocaleLowerCase())) {
      uniqueName = `${base} (${suffix})${extension}`;
      suffix += 1;
    }
    usedNames.add(uniqueName.toLocaleLowerCase());

    const chunks: Uint8Array[] = [];
    let entryBytes = 0;
    entry.ondata = (error, data, final) => {
      if (error) {
        failure = new Error('The ZIP contains a damaged or unsupported entry.');
        return;
      }
      entryBytes += data.byteLength;
      expandedBytes += data.byteLength;
      if (entryBytes > MAX_ARCHIVE_EXPANDED_BYTES || expandedBytes > MAX_ARCHIVE_EXPANDED_BYTES) {
        failure = new Error('ZIP extraction stopped at the 250 MiB expanded-size safety limit.');
        entry.terminate();
        return;
      }
      if (data.byteLength > 0) chunks.push(data);
      if (final && !failure) {
        const buffer = new ArrayBuffer(entryBytes);
        const target = new Uint8Array(buffer);
        let offset = 0;
        for (const chunk of chunks) { target.set(chunk, offset); offset += chunk.byteLength; }
        outputs.push({ fileName: uniqueName, blob: new Blob([buffer]) });
      }
    };
    try {
      entry.start();
    } catch {
      failure = new Error('This ZIP uses a compression method that is not supported in the browser.');
      entry.terminate();
    }
  };

  try {
    archive.push(new Uint8Array(await file.arrayBuffer()), true);
  } catch {
    throw new Error('This ZIP archive could not be read.');
  }
  if (failure) throw failure;
  if (filesSeen === 0) throw new Error('This ZIP archive contains no extractable files.');
  if (outputs.length !== filesSeen) throw new Error('This ZIP archive is incomplete or damaged.');
  return outputs;
}

/** Extract a ZIP entirely in-browser; no archive entries are written to the filesystem. */
export async function extractZipArchive(file: File): Promise<ConvertedOutput[]> {
  if (!file.name.toLowerCase().endsWith('.zip')) throw new Error('Choose a .zip archive.');
  return extractZipEntries(file);
}

function safeFlatFileName(fileName: string, fallback: string): string {
  const safe = fileName
    .replace(/[\\/]+/g, '-')
    .normalize('NFKC')
    .replace(/[\\/]+/g, '-')
    .replace(/[\u0000-\u001f\u007f]/g, '-')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 150);
  return safe || fallback;
}

/** GZIP or expand one file locally, enforcing the shared expanded-output safety cap. */
export async function processGzipFile(file: File, operation: 'compress' | 'extract'): Promise<ConvertedOutput> {
  if (file.size > MAX_CONVERTER_FILE_BYTES) throw new Error('GZIP input files are limited to 25 MiB.');
  if (operation === 'extract' && !/\.(gz|gzip)$/i.test(file.name)) throw new Error('Choose a .gz or .gzip file to extract.');
  if (operation === 'compress') {
    const data = new Uint8Array(await file.arrayBuffer());
    const compressed = gzipSync(data, { level: 6 });
    if (compressed.byteLength > MAX_ZIP_ARCHIVE_BYTES) throw new Error('GZIP output exceeded the 250 MiB safety limit.');
    return { fileName: `${safeFlatFileName(file.name, 'file')}.gz`, blob: new Blob([compressed], { type: 'application/gzip' }) };
  }

  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let totalBytes = 0;
  const gunzip = new Gunzip();
  gunzip.ondata = (chunk) => {
    totalBytes += chunk.byteLength;
    if (totalBytes > MAX_ARCHIVE_EXPANDED_BYTES) throw new Error('GZIP extraction stopped at the 250 MiB expanded-size safety limit.');
    if (chunk.byteLength > 0) chunks.push(chunk);
  };
  try {
    gunzip.push(new Uint8Array(await file.arrayBuffer()), true);
  } catch (error) {
    if (error instanceof Error && /250 MiB/.test(error.message)) throw error;
    throw new Error('This GZIP file is damaged or could not be expanded.');
  }
  if (totalBytes === 0) throw new Error('This GZIP file is empty or contains no data.');
  const name = safeFlatFileName(file.name.replace(/\.(gz|gzip)$/i, ''), 'decompressed-file');
  return { fileName: name, blob: new Blob(chunks, { type: 'application/octet-stream' }) };
}

function textSafeName(fileName: string, extension: 'docx' | 'pdf' | 'txt'): string {
  const base = fileName
    .replace(/[\\/]+/g, '-')
    .replace(/\.[^.]*$/, '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 100) || 'document';
  return `${base}.${extension}`;
}

function docxBlob(bytes: Uint8Array): Blob {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function createTextDocx(fileName: string, raw: string): ConvertedOutput {
  const text = cleanExtractedText(raw);
  if (!text) {
    const scannedPdfNote = fileName.toLowerCase().endsWith('.pdf') ? ' Scanned or image-only PDFs require OCR, which is not offered.' : '';
    throw new Error(`No extractable text was found.${scannedPdfNote}`);
  }
  if (text.length > MAX_TEXT_DOCUMENT_BYTES) throw new Error('Word document text is limited to 5 MiB.');

  const paragraphs = text.split('\n').map((line) => {
    if (!line) return '<w:p/>';
    const segments = line.split('\t');
    const runs = segments.map((segment, index) => {
      const textRun = segment ? `<w:r><w:t xml:space="preserve">${escapeXmlText(segment)}</w:t></w:r>` : '';
      const tabRun = index < segments.length - 1 ? '<w:r><w:tab/></w:r>' : '';
      return textRun + tabRun;
    }).join('');
    return `<w:p>${runs}</w:p>`;
  }).join('');
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
  const rootRelationships = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
  const encoder = new TextEncoder();
  const archive = zipSync({
    '[Content_Types].xml': encoder.encode(contentTypes),
    '_rels/.rels': encoder.encode(rootRelationships),
    'word/document.xml': encoder.encode(documentXml),
  }, { level: 6 });
  if (archive.byteLength > MAX_ZIP_ARCHIVE_BYTES) throw new Error('Word output exceeded the 250 MiB browser safety limit.');
  return { fileName: textSafeName(fileName, 'docx'), blob: docxBlob(archive) };
}

async function createTextPdf(fileName: string, raw: string): Promise<ConvertedOutput> {
  const text = raw.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ');
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const fontSize = 10;
  const lineHeight = 14;
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 44;
  const maxWidth = pageWidth - margin * 2;
  const supportedText = text.replace(/[^\u0000-\u00ff]/gu, '?');
  const wrapped: string[] = [];
  const addWrappedLine = (line: string) => {
    wrapped.push(line);
    if (wrapped.length > MAX_TEXT_PDF_PAGES * 54) throw new Error(`Text-to-PDF is limited to ${MAX_TEXT_PDF_PAGES} pages.`);
  };
  for (const line of supportedText.split('\n')) {
    if (!line) { addWrappedLine(''); continue; }
    let current = '';
    for (const word of line.split(/\s+/)) {
      if (!word) continue;
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) addWrappedLine(current);
      let fragment = '';
      for (const character of word) {
        if (fragment && font.widthOfTextAtSize(fragment + character, fontSize) > maxWidth) {
          addWrappedLine(fragment);
          fragment = character;
        } else fragment += character;
      }
      current = fragment;
    }
    addWrappedLine(current);
  }

  let page = document.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;
  let pages = 1;
  for (const line of wrapped) {
    if (y < margin) {
      pages += 1;
      if (pages > MAX_TEXT_PDF_PAGES) throw new Error(`Text-to-PDF is limited to ${MAX_TEXT_PDF_PAGES} pages.`);
      page = document.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
    if (line) page.drawText(line, { x: margin, y, size: fontSize, font });
    y -= lineHeight;
  }
  const bytes = await document.save({ useObjectStreams: true, addDefaultPage: false });
  return { fileName: textSafeName(fileName, 'pdf'), blob: pdfBlob(bytes) };
}

/** Convert plain text, Markdown, JSON, or CSV to a paginated PDF without a server. */
export async function convertTextDocumentToPdf(file: File): Promise<ConvertedOutput> {
  const supported = /\.(txt|md|markdown|csv|json|log)$/i.test(file.name) || file.type.startsWith('text/');
  if (!supported) throw new Error('Choose a text, Markdown, CSV, JSON, or log file.');
  if (file.size > MAX_TEXT_DOCUMENT_BYTES) throw new Error('Text documents are limited to 5 MiB.');
  return createTextPdf(file.name, await file.text());
}

/** Extract selectable text from a small PDF into a local .txt download. */
export async function extractPdfText(file: File): Promise<ConvertedOutput> {
  assertPdfFile(file);
  const [{ getDocument, GlobalWorkerOptions }, workerModule] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  GlobalWorkerOptions.workerSrc = workerModule.default;
  const loadingTask = getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, useSystemFonts: true });
  let source: Awaited<typeof loadingTask.promise> | null = null;
  try {
    source = await loadingTask.promise;
    if (source.numPages > MAX_PDF_PAGES) throw new Error(`PDF text extraction supports up to ${MAX_PDF_PAGES} pages.`);
    const pages: string[] = [];
    let textBytes = 0;
    for (let pageNumber = 1; pageNumber <= source.numPages; pageNumber += 1) {
      const page = await source.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const pageText = cleanExtractedText(content.items.map((item) => {
          if (!('str' in item) || !item.str) return '';
          return `${item.str}${item.hasEOL ? '\n' : ' '}`;
        }).join('').replace(/ {2,}/g, ' '));
        textBytes += pageText.length + 2;
        if (textBytes > MAX_TEXT_DOCUMENT_BYTES) throw new Error('PDF text extraction is limited to 5 MiB of text.');
        pages.push(pageText);
      } finally {
        page.cleanup();
      }
    }
    return { fileName: textSafeName(file.name, 'txt'), blob: new Blob([pages.join('\n\n')], { type: 'text/plain;charset=utf-8' }) };
  } finally {
    if (source) await source.destroy().catch(() => undefined);
    else await loadingTask.destroy().catch(() => undefined);
  }
}

function cleanExtractedText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function htmlToPlainText(markup: string): string {
  const document = new DOMParser().parseFromString(markup, 'text/html');
  document.querySelectorAll('script,style,noscript,template,svg').forEach((node) => node.remove());
  document.querySelectorAll('br').forEach((node) => node.replaceWith(document.createTextNode('\n')));
  document.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6,section,article,tr,blockquote').forEach((node) => {
    node.prepend(document.createTextNode('\n'));
  });
  return cleanExtractedText(document.body.textContent ?? '');
}

function parseXmlDocument(markup: string, description: string): XMLDocument {
  const document = new DOMParser().parseFromString(markup, 'application/xml');
  if (document.getElementsByTagName('parsererror').length > 0) throw new Error(`The ${description} XML is malformed.`);
  return document;
}

function xmlParagraphText(markup: string, namespace: string, paragraphTag: string): string {
  const document = parseXmlDocument(markup, 'document');
  const paragraphs = Array.from(document.getElementsByTagNameNS(namespace, paragraphTag));
  if (!paragraphs.length) return cleanExtractedText(document.documentElement.textContent ?? '');
  return cleanExtractedText(paragraphs.map((paragraph) => paragraph.textContent ?? '').join('\n'));
}

function archiveEntry(entries: readonly ConvertedOutput[], name: string): ConvertedOutput | undefined {
  const leaf = name.replace(/\\/g, '/').split('/').pop()?.toLowerCase();
  return entries.find((entry) => entry.fileName.toLowerCase() === leaf || entry.fileName.toLowerCase().startsWith(`${leaf} (`));
}

async function readArchiveText(entry: ConvertedOutput, description: string): Promise<string> {
  if (entry.blob.size > MAX_TEXT_DOCUMENT_BYTES) throw new Error(`${description} text is limited to 5 MiB.`);
  return entry.blob.text();
}

async function extractEpubText(entries: readonly ConvertedOutput[]): Promise<string> {
  const opf = archiveEntry(entries, 'content.opf') ?? entries.find((entry) => entry.fileName.toLowerCase().endsWith('.opf'));
  if (!opf) throw new Error('This EPUB has no readable package manifest.');
  const packageXml = parseXmlDocument(await readArchiveText(opf, 'EPUB package'), 'EPUB package');
  const manifest = new Map<string, string>();
  for (const item of Array.from(packageXml.getElementsByTagName('item'))) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    const mediaType = item.getAttribute('media-type') ?? '';
    if (id && href && /xhtml|html/i.test(mediaType) && !/^(?:[a-z]+:|\/)/i.test(href) && !href.split('/').includes('..')) {
      manifest.set(id, href.split('/').pop()!.toLowerCase());
    }
  }
  const spine = Array.from(packageXml.getElementsByTagName('itemref'))
    .map((item) => manifest.get(item.getAttribute('idref') ?? ''))
    .filter((name): name is string => Boolean(name));
  const sections: string[] = [];
  let extractedCharacters = 0;
  for (const name of spine) {
    const chapter = archiveEntry(entries, name);
    if (!chapter) continue;
    const section = htmlToPlainText(await readArchiveText(chapter, 'EPUB chapter'));
    extractedCharacters += section.length + 2;
    if (extractedCharacters > MAX_TEXT_DOCUMENT_BYTES) throw new Error('EPUB text extraction is limited to 5 MiB of text.');
    sections.push(section);
  }
  if (!sections.length) throw new Error('No readable chapters were found in this EPUB.');
  return cleanExtractedText(sections.join('\n\n'));
}

/** Extract text from common document and ebook formats, always in the browser. Formatting is not retained. */
export async function extractDocumentText(file: File): Promise<ConvertedOutput> {
  if (file.size > MAX_CONVERTER_FILE_BYTES) throw new Error('Documents are limited to 25 MiB per file.');
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  let text: string;
  if (extension === 'pdf') return extractPdfText(file);
  if (['txt', 'md', 'markdown', 'csv', 'json', 'log'].includes(extension) || (!['html', 'htm'].includes(extension) && file.type.startsWith('text/'))) {
    if (file.size > MAX_TEXT_DOCUMENT_BYTES) throw new Error('Text documents are limited to 5 MiB.');
    text = cleanExtractedText(await file.text());
  } else if (['html', 'htm'].includes(extension)) {
    if (file.size > MAX_TEXT_DOCUMENT_BYTES) throw new Error('HTML documents are limited to 5 MiB.');
    text = htmlToPlainText(await file.text());
  } else if (['docx', 'odt', 'epub'].includes(extension)) {
    const entries = await extractZipEntries(file);
    if (extension === 'docx') {
      const documentXml = archiveEntry(entries, 'document.xml');
      if (!documentXml) throw new Error('This DOCX has no readable main document.');
      text = xmlParagraphText(await readArchiveText(documentXml, 'DOCX'), 'http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'p');
    } else if (extension === 'odt') {
      const contentXml = archiveEntry(entries, 'content.xml');
      if (!contentXml) throw new Error('This ODT has no readable content document.');
      text = xmlParagraphText(await readArchiveText(contentXml, 'ODT'), 'urn:oasis:names:tc:opendocument:xmlns:text:1.0', 'p');
    } else {
      text = await extractEpubText(entries);
    }
  } else {
    throw new Error('Supported document inputs: TXT, Markdown, CSV, JSON, HTML, DOCX, ODT, EPUB, and PDF.');
  }
  return { fileName: textSafeName(file.name, 'txt'), blob: new Blob([text], { type: 'text/plain;charset=utf-8' }) };
}

/** Export selectable document text to a simple, editable DOCX. Layout, images, and styling are not retained. */
export async function convertDocumentToDocx(file: File): Promise<ConvertedOutput> {
  const textResult = await extractDocumentText(file);
  return createTextDocx(file.name, await textResult.blob.text());
}

/** Convert text-based, HTML, DOCX, ODT, or EPUB documents to a simple paginated PDF. */
export async function convertDocumentToPdf(file: File): Promise<ConvertedOutput> {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (['txt', 'md', 'markdown', 'csv', 'json', 'log'].includes(extension) || (!['html', 'htm'].includes(extension) && file.type.startsWith('text/'))) {
    return convertTextDocumentToPdf(file);
  }
  if (extension === 'pdf') throw new Error('This file is already a PDF. Choose Extract text instead.');
  const textResult = await extractDocumentText(file);
  return createTextPdf(file.name, await textResult.blob.text());
}
