import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import {
  createZipArchive,
  fitOutputDimensions,
  formatFileSize,
  getAvailableOutputFormats,
  getSourceKind,
  getTransformedDimensions,
  jpegImageToPdf,
  jpegImagesToPdf,
  MAX_OUTPUT_DIMENSION,
  outputExtension,
  outputMimeType,
  parsePdfPageSelection,
  safeOutputFileName,
  type ConversionSettings,
} from '../../src/lib/file-converter';

describe('browser file converter rules', () => {
  it('recognizes supported image and PDF sources without trusting filename alone for unknown types', () => {
    expect(getSourceKind({ name: 'portrait.JPEG', type: 'image/jpeg' } as File)).toBe('image');
    expect(getSourceKind({ name: 'report', type: 'application/pdf' } as File)).toBe('pdf');
    expect(getSourceKind({ name: 'report.PDF', type: 'application/octet-stream' } as File)).toBe('pdf');
    expect(getSourceKind({ name: 'archive.zip', type: 'application/zip' } as File)).toBeNull();
    expect(getSourceKind({ name: 'photo.jfif', type: 'application/octet-stream' } as File)).toBe('image');
    expect(getSourceKind({ name: 'photo.HEIC', type: 'application/octet-stream' } as File)).toBe('image');
    expect(getSourceKind({ name: 'diagram.svg', type: 'image/svg+xml' } as File)).toBe('image');
  });

  it('labels binary file sizes accurately with IEC units', () => {
    expect(formatFileSize(25 * 1024 * 1024)).toBe('25 MiB');
    expect(formatFileSize(1024)).toBe('1.0 KiB');
  });

  it('only offers output formats that are valid for every file in a mixed batch', () => {
    expect(getAvailableOutputFormats([])).toEqual(['png', 'jpeg', 'webp', 'pdf', 'svg']);
    expect(getAvailableOutputFormats(['image'])).toEqual(['png', 'jpeg', 'webp', 'pdf', 'svg']);
    expect(getAvailableOutputFormats(['pdf'])).toEqual(['png', 'jpeg', 'webp']);
    expect(getAvailableOutputFormats(['image', 'pdf'])).toEqual(['png', 'jpeg', 'webp']);
  });

  it('keeps image aspect ratio and never upscales or allocates a huge canvas', () => {
    expect(fitOutputDimensions(2400, 1600, 1200, 1200)).toEqual({ width: 1200, height: 800 });
    expect(fitOutputDimensions(640, 480, 1920, 1920)).toEqual({ width: 640, height: 480 });
    const large = fitOutputDimensions(16_000, 12_000);
    expect(large.width).toBeLessThanOrEqual(MAX_OUTPUT_DIMENSION);
    expect(large.height).toBeLessThanOrEqual(MAX_OUTPUT_DIMENSION);
    expect(large.width * large.height).toBeLessThanOrEqual(32_000_000);
    expect(() => fitOutputDimensions(0, 200)).toThrow(/invalid image dimensions/i);
  });

  it('creates safe deterministic output names and uses a conventional .jpg extension', () => {
    expect(outputExtension('jpeg')).toBe('jpg');
    expect(outputExtension('svg')).toBe('svg');
    expect(outputMimeType('png')).toBe('image/png');
    expect(safeOutputFileName('../holiday photo.final.png', 'webp', 'optimized')).toBe('holiday-photo.final-optimized.webp');
    expect(safeOutputFileName('💾.jpg', 'jpeg')).toBe('converted-file.jpg');
  });

  it('writes a valid single-page PDF wrapper with correct cross-reference offsets', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const bytes = jpegImageToPdf(jpeg, 640, 480);
    const source = new TextDecoder().decode(bytes);
    expect(source.startsWith('%PDF-1.4')).toBe(true);
    expect(source).toContain('/Subtype /Image');
    expect(source).toContain('/Filter /DCTDecode');
    expect(source).toContain('/Count 1');

    const xrefOffset = Number(source.match(/startxref\n(\d+)/)?.[1]);
    expect(new TextDecoder().decode(bytes.slice(xrefOffset, xrefOffset + 4))).toBe('xref');
    expect(() => jpegImageToPdf(new Uint8Array([1, 2, 3]), 10, 10)).toThrow(/valid JPEG/i);
  });
});

describe('extended file converter features', () => {
  const settings: ConversionSettings = {
    quality: 88,
    resize: false,
    maxWidth: 1920,
    maxHeight: 1920,
    dpi: 144,
    suffix: '',
    rotation: 90,
    flipHorizontal: false,
    flipVertical: false,
    crop: { left: 10, top: 20, width: 50, height: 50 },
    pdfPages: '',
    combineImagesToPdf: false,
  };

  it('parses PDF page ranges, sorts them, and rejects invalid or out-of-range selections', () => {
    expect(parsePdfPageSelection('', 5)).toEqual([1, 2, 3, 4, 5]);
    expect(parsePdfPageSelection('1-3, 5, 3', 6)).toEqual([1, 2, 3, 5]);
    expect(parsePdfPageSelection('all', 2)).toEqual([1, 2]);
    expect(() => parsePdfPageSelection('0,2', 5)).toThrow(/page numbers from 1 to 5/i);
    expect(() => parsePdfPageSelection('4-2', 5)).toThrow(/ranges must go from low to high/i);
    expect(() => parsePdfPageSelection('1,,3', 5)).toThrow(/enter pages like/i);
    expect(() => parsePdfPageSelection('1-3', 26)).toThrow(/between 1 and 25 pages/i);
  });

  it('computes crop and rotation dimensions before applying the output size limit', () => {
    expect(getTransformedDimensions(400, 200, settings)).toEqual({ width: 100, height: 200 });
    expect(() => getTransformedDimensions(400, 200, {
      ...settings,
      crop: { left: 60, top: 0, width: 50, height: 100 },
    })).toThrow(/crop position and size/i);
  });

  it('writes a multi-page image PDF with one page object and image resource per input', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const bytes = jpegImagesToPdf([
      { jpeg, pixelWidth: 640, pixelHeight: 480 },
      { jpeg, pixelWidth: 320, pixelHeight: 240 },
    ]);
    const source = new TextDecoder().decode(bytes);
    expect(source).toContain('/Kids [3 0 R 6 0 R] /Count 2');
    expect(source).toContain('/Im0 4 0 R');
    expect(source).toContain('/Im1 7 0 R');
    const xrefOffset = Number(source.match(/startxref\n(\d+)/)?.[1]);
    expect(new TextDecoder().decode(bytes.slice(xrefOffset, xrefOffset + 4))).toBe('xref');
    expect(() => jpegImagesToPdf([])).toThrow(/between 1 and 25 pages/i);
  });

  it('creates a streaming ZIP and makes duplicate output names unique', async () => {
    const archive = await createZipArchive([
      { fileName: 'same.png', blob: new Blob(['first image']) },
      { fileName: 'same.png', blob: new Blob(['second image']) },
    ]);
    const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));
    expect(archive.type).toBe('application/zip');
    expect(Object.keys(files).sort()).toEqual(['same (2).png', 'same.png']);
    expect(new TextDecoder().decode(files['same.png'])).toBe('first image');
    expect(new TextDecoder().decode(files['same (2).png'])).toBe('second image');
    await expect(createZipArchive([])).rejects.toThrow(/convert at least one file/i);
  });
});
