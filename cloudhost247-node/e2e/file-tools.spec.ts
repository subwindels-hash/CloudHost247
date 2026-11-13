import { expect, test } from '@playwright/test';
import { createCanvas } from '@napi-rs/canvas';
import { unzipSync, zipSync } from 'fflate';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';

const { GIFEncoder, applyPalette, quantize } = require('gifenc') as {
  GIFEncoder: (options?: Record<string, unknown>) => { writeFrame(pixels: Uint8Array, width: number, height: number, options?: Record<string, unknown>): void; finish(): void; bytes(): Uint8Array };
  applyPalette: (rgba: Uint8Array, palette: readonly (readonly number[])[], format?: string) => Uint8Array;
  quantize: (rgba: Uint8Array, colors: number, options?: Record<string, unknown>) => readonly (readonly number[])[];
};

function createTwoFrameGif(): Buffer {
  const encoder = GIFEncoder({ initialCapacity: 256 });
  for (let frame = 0; frame < 2; frame += 1) {
    const rgba = new Uint8Array(4 * 4 * 4);
    for (let pixel = 0; pixel < 16; pixel += 1) {
      rgba[pixel * 4] = frame ? 20 : 240;
      rgba[pixel * 4 + 1] = frame ? 220 : 40;
      rgba[pixel * 4 + 2] = 30;
      rgba[pixel * 4 + 3] = 255;
    }
    const palette = quantize(rgba, 16);
    encoder.writeFrame(applyPalette(rgba, palette), 4, 4, { palette, delay: 120, repeat: 0, dispose: 2 });
  }
  encoder.finish();
  return Buffer.from(encoder.bytes());
}

function createSineWaveWav(): Buffer {
  const sampleRate = 44_100;
  const sampleCount = sampleRate;
  const dataBytes = sampleCount * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * index / sampleRate) * 12_000), 44 + index * 2);
  }
  return wav;
}

test.describe('File Tools browser-local workflows', () => {
  test('converts Word DOCX to PDF and selectable PDF text to DOCX locally', async ({ page }) => {
    const apiFilePosts: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/')) apiFilePosts.push(request.url());
    });

    await page.goto('/tools/file-tools');
    await page.getByRole('tab', { name: 'Convert' }).click();
    const wordXml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Word to PDF works</w:t></w:r></w:p></w:body></w:document>';
    await page.getByLabel(/Choose a document or ebook/).setInputFiles({
      name: 'word-source.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from(zipSync({ 'word/document.xml': new TextEncoder().encode(wordXml) })),
    });
    await page.getByRole('button', { name: 'Convert to PDF' }).click();
    await expect(page.getByText('word-source.pdf', { exact: true })).toBeVisible();
    const wordPdfDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const wordPdfDownload = await wordPdfDownloadPromise;
    expect(wordPdfDownload.suggestedFilename()).toBe('word-source.pdf');
    const wordPdfStream = await wordPdfDownload.createReadStream();
    const wordPdfChunks: Buffer[] = [];
    for await (const chunk of wordPdfStream!) wordPdfChunks.push(Buffer.from(chunk));
    expect(Buffer.concat(wordPdfChunks).subarray(0, 5).toString('latin1')).toBe('%PDF-');

    const sourcePdf = await PDFDocument.create();
    const font = await sourcePdf.embedFont(StandardFonts.Helvetica);
    sourcePdf.addPage([612, 792]).drawText('Editable text from a PDF', { x: 48, y: 744, font, size: 12 });
    await page.getByLabel(/Choose a document or ebook/).setInputFiles({
      name: 'letter.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(await sourcePdf.save()),
    });
    await page.getByRole('button', { name: 'Convert to Word' }).click();
    await expect(page.getByText('letter.docx', { exact: true })).toBeVisible();
    const docxDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const docxDownload = await docxDownloadPromise;
    expect(docxDownload.suggestedFilename()).toBe('letter.docx');
    const docxStream = await docxDownload.createReadStream();
    const docxChunks: Buffer[] = [];
    for await (const chunk of docxStream!) docxChunks.push(Buffer.from(chunk));
    const docxEntries = unzipSync(new Uint8Array(Buffer.concat(docxChunks)));
    const documentXml = new TextDecoder().decode(docxEntries['word/document.xml']);
    expect(documentXml).toContain('Editable text from a PDF');
    expect(apiFilePosts).toEqual([]);
  });

  test('converts a text file to PDF and extracts ZIP content without uploading files', async ({ page }) => {
    const apiFilePosts: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/')) {
        apiFilePosts.push(request.url());
      }
    });

    const pageResponse = await page.goto('/tools/file-tools');
    expect(pageResponse?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: 'File Tools' })).toBeVisible();

    await page.getByRole('tab', { name: 'Convert' }).click();
    await page.getByLabel(/Choose a document or ebook/).setInputFiles({
      name: 'browser-local.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('This text is converted to PDF in the browser.'),
    });
    await page.getByRole('button', { name: 'Convert to PDF' }).click();
    await expect(page.getByText('browser-local.pdf', { exact: true })).toBeVisible();
    const pdfDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const pdfDownload = await pdfDownloadPromise;
    expect(pdfDownload.suggestedFilename()).toBe('browser-local.pdf');
    const pdfStream = await pdfDownload.createReadStream();
    const pdfChunks: Buffer[] = [];
    for await (const chunk of pdfStream!) pdfChunks.push(Buffer.from(chunk));
    expect(Buffer.concat(pdfChunks).subarray(0, 5).toString('latin1')).toBe('%PDF-');

    await page.getByRole('tab', { name: 'Tools' }).click();
    const archive = zipSync({ 'inside/local.txt': new TextEncoder().encode('also local') });
    await page.getByLabel(/Choose one ZIP archive/).setInputFiles({
      name: 'browser-local.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from(archive),
    });
    await page.getByRole('button', { name: 'Extract ZIP', exact: true }).click();
    await expect(page.getByText('local.txt', { exact: true })).toBeVisible();

    await page.getByLabel('Archive action').selectOption('create');
    await page.getByLabel(/Choose files to add to ZIP/).setInputFiles([
      { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('alpha '.repeat(200)) },
      { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('second file') },
    ]);
    await page.getByRole('button', { name: 'Create ZIP', exact: true }).click();
    await expect(page.getByText('cloudhost247-archive.zip', { exact: true })).toBeVisible();
    const zipDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download ZIP', exact: true }).click();
    const zipDownload = await zipDownloadPromise;
    expect(zipDownload.suggestedFilename()).toBe('cloudhost247-archive.zip');
    const zipStream = await zipDownload.createReadStream();
    const zipChunks: Buffer[] = [];
    for await (const chunk of zipStream!) zipChunks.push(Buffer.from(chunk));
    const zipBytes = Buffer.concat(zipChunks);
    expect(zipBytes.readUInt32LE(0)).toBe(0x04034b50);
    expect(zipBytes.readUInt16LE(8)).toBe(8); // ZIP method 8 is DEFLATE.
    const entries = unzipSync(new Uint8Array(zipBytes));
    expect(Object.keys(entries).sort()).toEqual(['notes (2).txt', 'notes.txt']);
    expect(new TextDecoder().decode(entries['notes.txt'])).toBe('alpha '.repeat(200));
    expect(new TextDecoder().decode(entries['notes (2).txt'])).toBe('second file');
    expect(apiFilePosts).toEqual([]);
  });

  test('transcodes an audio file to MP3 locally, with no server upload', async ({ page }) => {
    const apiFilePosts: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/')) {
        apiFilePosts.push(request.url());
      }
    });

    await page.goto('/tools/file-tools');
    await page.getByRole('tab', { name: 'Convert' }).click();
    await page.getByLabel(/Choose one audio file/).setInputFiles({
      name: 'tone.wav',
      mimeType: 'audio/wav',
      buffer: createSineWaveWav(),
    });
    await page.getByRole('button', { name: 'Convert audio', exact: true }).click();
    await expect(page.getByText('tone-converted.mp3', { exact: true })).toBeVisible({ timeout: 30_000 });
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('tone-converted.mp3');
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    const mp3Bytes = Buffer.concat(chunks);
    expect(mp3Bytes.byteLength).toBeGreaterThan(100);
    expect(mp3Bytes[0]).toBe(0xff);
    expect((mp3Bytes[1] ?? 0) & 0xe0).toBe(0xe0); // MPEG audio frame sync.
    expect(apiFilePosts).toEqual([]);
  });

  test('builds a REST image-compression job and downloads the transient result', async ({ page }) => {
    await page.goto('/tools/file-tools');
    await page.getByRole('tab', { name: 'API' }).click();
    const canvas = createCanvas(8, 8);
    const context = canvas.getContext('2d');
    context.fillStyle = '#d97706';
    context.fillRect(0, 0, 8, 8);
    await page.getByLabel('Choose one input file').setInputFiles({
      name: 'api-pixel.png',
      mimeType: 'image/png',
      buffer: canvas.toBuffer('image/png'),
    });
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Run compress image' }).click();
    await expect(page.getByText(/Complete\. The download has started/)).toBeVisible({ timeout: 30_000 });
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('api-pixel-compressed.webp');
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
    expect(bytes.subarray(8, 12).toString()).toBe('WEBP');
  });

  test('protects and unlocks a PDF in the browser with qpdf WebAssembly', async ({ page }) => {
    const source = await PDFDocument.create();
    source.addPage([200, 200]).drawText('Private document');
    const sourceBytes = Buffer.from(await source.save());
    const password = 'local-PDF-secret-2026';
    await page.goto('/tools/file-tools');
    await page.getByRole('tab', { name: 'Tools' }).click();
    await page.getByLabel('PDF action').selectOption('protect');
    await page.getByLabel(/Choose one PDF/).setInputFiles({ name: 'private.pdf', mimeType: 'application/pdf', buffer: sourceBytes });
    await page.getByRole('textbox', { name: 'Open password', exact: true }).fill(password);
    await page.getByRole('button', { name: 'Protect PDF' }).click();
    await expect(page.getByText('private-protected.pdf', { exact: true })).toBeVisible({ timeout: 60_000 });
    const protectedDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download PDF' }).click();
    const protectedDownload = await protectedDownloadPromise;
    const protectedStream = await protectedDownload.createReadStream();
    const protectedChunks: Buffer[] = [];
    for await (const chunk of protectedStream!) protectedChunks.push(Buffer.from(chunk));
    const encryptedBytes = Buffer.concat(protectedChunks);
    expect(encryptedBytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    await page.getByLabel('PDF action').selectOption('unlock');
    await page.getByLabel(/Choose one PDF/).setInputFiles({ name: 'private-protected.pdf', mimeType: 'application/pdf', buffer: encryptedBytes });
    await page.getByLabel('Current PDF password').fill(password);
    await page.getByRole('button', { name: 'Unlock PDF' }).click();
    await expect(page.getByText('private-protected-unlocked.pdf', { exact: true })).toBeVisible({ timeout: 60_000 });
    const unlockedDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download PDF' }).click();
    const unlockedDownload = await unlockedDownloadPromise;
    const unlockedStream = await unlockedDownload.createReadStream();
    const unlockedChunks: Buffer[] = [];
    for await (const chunk of unlockedStream!) unlockedChunks.push(Buffer.from(chunk));
    const unlocked = await PDFDocument.load(Buffer.concat(unlockedChunks));
    expect(unlocked.getPageCount()).toBe(1);
  });

  test('compresses an animated GIF and keeps multiple frames', async ({ page }) => {
    await page.goto('/tools/file-tools');
    if (!(await page.evaluate(() => typeof (globalThis as { ImageDecoder?: unknown }).ImageDecoder === 'function'))) {
      test.skip(true, 'This browser does not support WebCodecs ImageDecoder.');
    }
    await page.getByRole('tab', { name: 'Compress' }).click();
    await page.getByLabel(/Choose one animation/).setInputFiles({ name: 'two-frame.gif', mimeType: 'image/gif', buffer: createTwoFrameGif() });
    await page.getByRole('button', { name: 'Compress an animated GIF' }).click();
    await expect(page.getByText('two-frame-compressed.gif', { exact: true })).toBeVisible({ timeout: 30_000 });
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    const metadata = await sharp(Buffer.concat(chunks), { animated: true }).metadata();
    expect(metadata.format).toBe('gif');
    expect(metadata.pages).toBeGreaterThan(1);
  });
});
