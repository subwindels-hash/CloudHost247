import { MAX_CONVERTER_FILE_BYTES, MAX_CONVERTER_FILES, MAX_ZIP_ARCHIVE_BYTES, fitOutputDimensions, getSourceKind, rasterizeImageFile, safeOutputFileName, type ConvertedOutput } from './file-converter';

export const MAX_ANIMATION_FRAMES = 120;
export const MAX_ANIMATION_DIMENSION = 480;
export const MAX_ANIMATION_SECONDS = 30;
const MAX_VIDEO_GIF_SECONDS = 10;
const MAX_VIDEO_GIF_FPS = 12;

type RasterFrame = { pixels: Uint8ClampedArray<ArrayBuffer>; delayMs: number };
type ImageDecoderTrackLike = { frameCount?: number; animated?: boolean };
type DecodedImageLike = CanvasImageSource & {
  width: number;
  height: number;
  displayWidth?: number;
  displayHeight?: number;
  duration?: number;
  timestamp?: number;
  close?: () => void;
};
type ImageDecoderLike = {
  tracks: { ready: Promise<void>; selectedTrack: ImageDecoderTrackLike | null };
  decode(options: { frameIndex: number; completeFramesOnly?: boolean }): Promise<{ image: DecodedImageLike }>;
  close(): void;
};
type ImageDecoderConstructor = new (options: { data: ArrayBuffer; type: string; preferAnimation?: boolean }) => ImageDecoderLike;

function outputName(inputName: string, extension: string, suffix = ''): string {
  const base = safeOutputFileName(inputName, 'png').replace(/\.png$/i, '');
  return `${base}${suffix ? `-${suffix}` : ''}.${extension}`;
}

function copyPixels(pixels: Uint8ClampedArray): Uint8ClampedArray<ArrayBuffer> {
  const copy = new Uint8ClampedArray(new ArrayBuffer(pixels.byteLength));
  copy.set(pixels);
  return copy;
}

function imageDataFromFrame(frame: RasterFrame, width: number, height: number): ImageData {
  return new ImageData(copyPixels(frame.pixels), width, height);
}

function frameFromSource(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
  delayMs: number,
): RasterFrame {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('This browser could not prepare an animation frame.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = Math.max(1, Math.round(sourceWidth * scale));
  const drawHeight = Math.max(1, Math.round(sourceHeight * scale));
  context.drawImage(source, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  const pixels = context.getImageData(0, 0, width, height).data;
  const copy = new Uint8ClampedArray(new ArrayBuffer(pixels.byteLength));
  copy.set(pixels);
  canvas.width = 0;
  canvas.height = 0;
  return { pixels: copy, delayMs: Math.max(20, Math.min(2000, Math.round(delayMs))) };
}

async function encodeGif(frames: readonly RasterFrame[], width: number, height: number, onProgress?: (done: number, total: number) => void): Promise<Blob> {
  if (frames.length < 1 || frames.length > MAX_ANIMATION_FRAMES) throw new Error(`GIF output is limited to ${MAX_ANIMATION_FRAMES} frames.`);
  const { applyPalette, GIFEncoder, quantize } = await import('gifenc');
  const gif = GIFEncoder({ initialCapacity: 64 * 1024 });
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index]!;
    const palette = quantize(frame.pixels, 256, { format: 'rgb565' });
    const indexed = applyPalette(frame.pixels, palette, 'rgb565');
    gif.writeFrame(indexed, width, height, { palette, delay: frame.delayMs, repeat: 0, dispose: 2 });
    onProgress?.(index + 1, frames.length);
  }
  gif.finish();
  const bytes = new Uint8Array(gif.bytes());
  if (bytes.byteLength > MAX_ZIP_ARCHIVE_BYTES) throw new Error('GIF output exceeded the 250 MiB browser safety limit.');
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type: 'image/gif' });
}

function checkAnimationFile(file: File): void {
  if (file.size <= 0 || file.size > MAX_CONVERTER_FILE_BYTES) throw new Error('Animation inputs are limited to 25 MiB per file.');
}

async function readAnimatedImage(file: File, maxDimension = MAX_ANIMATION_DIMENSION, onProgress?: (done: number, total: number) => void): Promise<{ frames: RasterFrame[]; width: number; height: number }> {
  checkAnimationFile(file);
  const Decoder = (globalThis as unknown as { ImageDecoder?: ImageDecoderConstructor }).ImageDecoder;
  if (!Decoder) throw new Error('Animated image decoding is not available in this browser. Try a current Chromium-based browser.');
  const type = file.type || (/\.gif$/i.test(file.name) ? 'image/gif' : 'image/png');
  const decoder = new Decoder({ data: await file.arrayBuffer(), type, preferAnimation: true });
  try {
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack;
    const frameCount = track?.frameCount ?? 0;
    if (frameCount < 2) throw new Error('This file does not contain multiple animation frames.');
    const step = Math.max(1, Math.ceil(frameCount / MAX_ANIMATION_FRAMES));
    const selectedIndices = Array.from({ length: Math.ceil(frameCount / step) }, (_, index) => index * step);
    const first = (await decoder.decode({ frameIndex: selectedIndices[0]!, completeFramesOnly: true })).image;
    const firstWidth = first.displayWidth || first.width;
    const firstHeight = first.displayHeight || first.height;
    const dimensions = fitOutputDimensions(firstWidth, firstHeight, maxDimension, maxDimension);
    const frames: RasterFrame[] = [];
    try {
      frames.push(frameFromSource(first, firstWidth, firstHeight, dimensions.width, dimensions.height, (first.duration ?? 100_000) / 1000 * step));
    } finally {
      first.close?.();
    }
    onProgress?.(1, selectedIndices.length);
    for (let index = 1; index < selectedIndices.length; index += 1) {
      const image = (await decoder.decode({ frameIndex: selectedIndices[index]!, completeFramesOnly: true })).image;
      const sourceWidth = image.displayWidth || image.width;
      const sourceHeight = image.displayHeight || image.height;
      try {
        frames.push(frameFromSource(image, sourceWidth, sourceHeight, dimensions.width, dimensions.height, (image.duration ?? 100_000) / 1000 * step));
      } finally {
        image.close?.();
      }
      onProgress?.(index + 1, selectedIndices.length);
    }
    const totalDuration = frames.reduce((total, frame) => total + frame.delayMs, 0);
    if (totalDuration > MAX_ANIMATION_SECONDS * 1000) throw new Error(`Animation output is limited to ${MAX_ANIMATION_SECONDS} seconds.`);
    return { frames, width: dimensions.width, height: dimensions.height };
  } finally {
    decoder.close();
  }
}

/** Build a looping GIF from a selected sequence of local still images. */
export async function createGifFromImages(files: readonly File[], delayMs = 200, onProgress?: (done: number, total: number) => void): Promise<ConvertedOutput> {
  if (files.length < 2) throw new Error('Choose at least two images to make an animation.');
  if (files.length > MAX_CONVERTER_FILES || files.length > MAX_ANIMATION_FRAMES) throw new Error(`Choose up to ${Math.min(MAX_CONVERTER_FILES, MAX_ANIMATION_FRAMES)} images.`);
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_ZIP_ARCHIVE_BYTES) throw new Error('Combined image inputs are limited to 250 MiB.');
  if (files.some((file) => getSourceKind(file) !== 'image')) throw new Error('Choose supported still images for the GIF maker.');
  const firstCanvas = await rasterizeImageFile(files[0]!, MAX_ANIMATION_DIMENSION, MAX_ANIMATION_DIMENSION, '#ffffff');
  const width = firstCanvas.width;
  const height = firstCanvas.height;
  const frames: RasterFrame[] = [];
  try {
    const firstContext = firstCanvas.getContext('2d', { willReadFrequently: true });
    if (!firstContext) throw new Error('This browser could not prepare the first frame.');
    frames.push({ pixels: copyPixels(firstContext.getImageData(0, 0, width, height).data), delayMs: Math.max(20, Math.min(2000, delayMs)) });
  } finally {
    firstCanvas.width = 0;
    firstCanvas.height = 0;
  }
  onProgress?.(1, files.length);
  for (let index = 1; index < files.length; index += 1) {
    const canvas = await rasterizeImageFile(files[index]!, MAX_ANIMATION_DIMENSION, MAX_ANIMATION_DIMENSION, '#ffffff');
    try {
      frames.push(frameFromSource(canvas, canvas.width, canvas.height, width, height, delayMs));
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
    onProgress?.(index + 1, files.length);
  }
  return { fileName: outputName('animated-images', 'gif'), blob: await encodeGif(frames, width, height, onProgress) };
}

/** Convert GIF or APNG frames into an optimized, size-capped GIF. */
export async function convertAnimatedImageToGif(file: File, onProgress?: (done: number, total: number) => void): Promise<ConvertedOutput> {
  const { frames, width, height } = await readAnimatedImage(file, MAX_ANIMATION_DIMENSION, onProgress);
  return { fileName: outputName(file.name, 'gif', 'converted'), blob: await encodeGif(frames, width, height, onProgress) };
}

/** Re-encode an animated GIF with a smaller canvas and capped per-frame palette. */
export async function compressAnimatedGif(file: File, onProgress?: (done: number, total: number) => void): Promise<ConvertedOutput> {
  if (!/\.gif$/i.test(file.name) && file.type !== 'image/gif') throw new Error('Choose an animated GIF file.');
  const { frames, width, height } = await readAnimatedImage(file, 360, onProgress);
  return { fileName: outputName(file.name, 'gif', 'compressed'), blob: await encodeGif(frames, width, height, onProgress) };
}

/** Extract a short local video segment into a looping GIF; source codec support varies by browser. */
export async function convertVideoToGif(
  file: File,
  options: { startSeconds?: number; endSeconds?: number; fps?: number } = {},
  onProgress?: (done: number, total: number) => void,
): Promise<ConvertedOutput> {
  checkAnimationFile(file);
  const { Input, BlobSource, ALL_FORMATS, CanvasSink } = await import('mediabunny');
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('No readable video track was found in this file.');
    const duration = await input.getDurationFromMetadata([track]) ?? await input.computeDuration([track]);
    const start = options.startSeconds ?? 0;
    const end = options.endSeconds ?? Math.min(duration, MAX_VIDEO_GIF_SECONDS);
    const fps = options.fps ?? 10;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > duration || end <= start || end - start > MAX_VIDEO_GIF_SECONDS) {
      throw new Error(`Choose a video segment between 0 and ${Math.min(duration, MAX_VIDEO_GIF_SECONDS).toFixed(2)} seconds.`);
    }
    if (!Number.isInteger(fps) || fps < 1 || fps > MAX_VIDEO_GIF_FPS) throw new Error(`GIF frame rate must be between 1 and ${MAX_VIDEO_GIF_FPS} fps.`);
    const count = Math.min(MAX_ANIMATION_FRAMES, Math.max(1, Math.floor((end - start) * fps)));
    const timestamps = Array.from({ length: count }, (_, index) => start + index / fps);
    const sink = new CanvasSink(track, { width: MAX_ANIMATION_DIMENSION, fit: 'contain', alpha: false, poolSize: 1 });
    const frames: RasterFrame[] = [];
    let width = 0;
    let height = 0;
    let index = 0;
    for await (const wrapped of sink.canvasesAtTimestamps(timestamps)) {
      if (!wrapped) continue;
      if (width === 0 || height === 0) {
        const dimensions = fitOutputDimensions(wrapped.canvas.width, wrapped.canvas.height, MAX_ANIMATION_DIMENSION, MAX_ANIMATION_DIMENSION);
        width = dimensions.width;
        height = dimensions.height;
      }
      frames.push(frameFromSource(wrapped.canvas, wrapped.canvas.width, wrapped.canvas.height, width, height, 1000 / fps));
      index += 1;
      onProgress?.(index, count);
    }
    if (!frames.length) throw new Error('No video frames could be decoded. Try a browser-supported MP4, MOV, MKV, MPEG-TS or WebM file.');
    return { fileName: outputName(file.name, 'gif', 'animated'), blob: await encodeGif(frames, width, height) };
  } finally {
    input.dispose();
  }
}

/** Convert an animated GIF/APNG into a silent MP4; the browser must support H.264 encoding. */
export async function convertAnimatedImageToMp4(file: File, onProgress?: (done: number, total: number) => void): Promise<ConvertedOutput> {
  const { frames, width, height } = await readAnimatedImage(file, MAX_ANIMATION_DIMENSION, onProgress);
  const { Output, Mp4OutputFormat, BufferTarget, CanvasSource, Quality, canEncodeVideo } = await import('mediabunny');
  if (!(await canEncodeVideo('avc'))) throw new Error('This browser cannot encode H.264 video for MP4 output. Try a current Chromium-based browser.');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });
  const source = new CanvasSource(canvas, { codec: 'avc', quality: new Quality('medium') });
  output.addVideoTrack(source);
  try {
    await output.start();
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser could not create the video frames.');
    let timestamp = 0;
    for (let index = 0; index < frames.length; index += 1) {
      const frame = frames[index]!;
      context.putImageData(imageDataFromFrame(frame, width, height), 0, 0);
      const frameDuration = frame.delayMs / 1000;
      await source.add(timestamp, frameDuration);
      timestamp += frameDuration;
      onProgress?.(index + 1, frames.length);
    }
    source.close();
    await output.finalize();
    const buffer = target.buffer;
    if (!buffer || buffer.byteLength === 0 || buffer.byteLength > MAX_ZIP_ARCHIVE_BYTES) throw new Error('MP4 output exceeded the 250 MiB browser safety limit or was empty.');
    return { fileName: outputName(file.name, 'mp4', 'converted'), blob: new Blob([buffer], { type: 'video/mp4' }) };
  } catch (error) {
    await output.cancel().catch(() => undefined);
    throw error;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const result = new Uint8Array(12 + data.byteLength);
  const view = new DataView(result.buffer);
  view.setUint32(0, data.byteLength, false);
  result.set(typeBytes, 4);
  result.set(data, 8);
  view.setUint32(result.byteLength - 4, crc32(result.subarray(4, result.byteLength - 4)), false);
  return result;
}

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      crcTable[index] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function parsePngChunks(png: Uint8Array): Array<{ type: string; data: Uint8Array }> {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (signature.some((byte, index) => png[index] !== byte)) throw new Error('Could not encode an APNG frame.');
  const chunks: Array<{ type: string; data: Uint8Array }> = [];
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let offset = 8;
  while (offset + 12 <= png.byteLength) {
    const length = view.getUint32(offset, false);
    const type = new TextDecoder().decode(png.subarray(offset + 4, offset + 8));
    const end = offset + 12 + length;
    if (end > png.byteLength) throw new Error('PNG image data is incomplete.');
    chunks.push({ type, data: png.subarray(offset + 8, offset + 8 + length) });
    offset = end;
    if (type === 'IEND') break;
  }
  return chunks;
}

function u16(value: number): Uint8Array { const result = new Uint8Array(2); new DataView(result.buffer).setUint16(0, value, false); return result; }
function u32(value: number): Uint8Array { const result = new Uint8Array(4); new DataView(result.buffer).setUint32(0, value, false); return result; }
function concat(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
  return result;
}

async function encodePngFrame(frame: RasterFrame, width: number, height: number): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser could not encode an APNG frame.');
    context.putImageData(imageDataFromFrame(frame, width, height), 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Could not encode an APNG frame.')), 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** Write a standards-based animated PNG (APNG) from decoded GIF or APNG frames. */
export async function convertAnimatedImageToApng(file: File, onProgress?: (done: number, total: number) => void): Promise<ConvertedOutput> {
  const { frames, width, height } = await readAnimatedImage(file, MAX_ANIMATION_DIMENSION, onProgress);
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const pngFrames = await Promise.all(frames.map((frame) => encodePngFrame(frame, width, height)));
  const parsed = pngFrames.map(parsePngChunks);
  const firstChunks = parsed[0]!;
  const ihdr = firstChunks.find((chunk) => chunk.type === 'IHDR')?.data;
  if (!ihdr) throw new Error('Could not read APNG frame dimensions.');
  const ancillary = firstChunks.filter((chunk) => chunk.type !== 'IHDR' && chunk.type !== 'IDAT' && chunk.type !== 'IEND');
  const output: Uint8Array[] = [signature, pngChunk('IHDR', ihdr), ...ancillary.map((chunk) => pngChunk(chunk.type, chunk.data))];
  const animationControl = concat([u32(frames.length), u32(0)]);
  output.push(pngChunk('acTL', animationControl));
  let sequence = 0;
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index]!;
    const delay = Math.max(20, Math.min(2000, frame.delayMs));
    const frameControl = concat([u32(sequence++), u32(width), u32(height), u32(0), u32(0), u16(delay), u16(1000), new Uint8Array([0, 0])]);
    output.push(pngChunk('fcTL', frameControl));
    const idat = parsed[index]!.filter((chunk) => chunk.type === 'IDAT');
    if (!idat.length) throw new Error('APNG frame contained no image data.');
    if (index === 0) {
      output.push(...idat.map((chunk) => pngChunk('IDAT', chunk.data)));
    } else {
      for (const chunk of idat) output.push(pngChunk('fdAT', concat([u32(sequence++), chunk.data])));
    }
    onProgress?.(index + 1, frames.length);
  }
  output.push(pngChunk('IEND', new Uint8Array(0)));
  const bytes = concat(output);
  if (bytes.byteLength > MAX_ZIP_ARCHIVE_BYTES) throw new Error('APNG output exceeded the 250 MiB browser safety limit.');
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return { fileName: outputName(file.name, 'apng', 'animated'), blob: new Blob([buffer], { type: 'image/apng' }) };
}
