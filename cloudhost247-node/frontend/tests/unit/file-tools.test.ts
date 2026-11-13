// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { unzipSync, zipSync } from 'fflate';
import { convertDocumentToDocx, convertDocumentToPdf, convertLocalMedia, convertTextDocumentToPdf, createCompressedZipArchive, editPdfFile, extractDocumentText, extractZipArchive, mergePdfFiles, parsePageOrder, processGzipFile } from '../../src/lib/file-tools';

const pdfjsMocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  globalWorkerOptions: { workerSrc: '' },
}));
vi.mock('pdfjs-dist', () => ({ getDocument: pdfjsMocks.getDocument, GlobalWorkerOptions: pdfjsMocks.globalWorkerOptions }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/pdf.worker.min.mjs' }));

function mockPdfText(pages: Array<Array<{ str: string; hasEOL: boolean }>>) {
  const source = {
    numPages: pages.length,
    getPage: vi.fn(async (pageNumber: number) => ({
      getTextContent: vi.fn(async () => ({ items: pages[pageNumber - 1] ?? [] })),
      cleanup: vi.fn(),
    })),
    destroy: vi.fn(async () => undefined),
  };
  pdfjsMocks.getDocument.mockReturnValue({ promise: Promise.resolve(source), destroy: vi.fn(async () => undefined) });
}

async function makePdf(name: string, sizes: Array<[number, number]>) {
  const document = await PDFDocument.create();
  sizes.forEach((size) => document.addPage(size));
  const bytes = await document.save();
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new File([buffer], name, { type: 'application/pdf' });
}

async function makeTextPdf(name: string, text: string) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([612, 792]);
  page.drawText(text, { x: 48, y: 744, size: 12, font });
  const bytes = await document.save();
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new File([buffer], name, { type: 'application/pdf' });
}

async function openResult(file: File) {
  return PDFDocument.load(new Uint8Array(await file.arrayBuffer()));
}

afterEach(() => {
  vi.restoreAllMocks();
  pdfjsMocks.getDocument.mockReset();
});

describe('local PDF file tools', () => {
  it('merges selected PDFs in order and retains their pages', async () => {
    const first = await makePdf('first.pdf', [[300, 400], [200, 250]]);
    const second = await makePdf('second.pdf', [[500, 700]]);
    const result = await mergePdfFiles([first, second]);
    const merged = await PDFDocument.load(new Uint8Array(await result.blob.arrayBuffer()));
    expect(result.pageCount).toBe(3);
    expect(merged.getPageCount()).toBe(3);
    expect(result.fileName).toBe('merged-pdfs.pdf');
  });

  it('extracts, removes and rotates a selected page range', async () => {
    const original = await makePdf('brief.pdf', [[300, 400], [200, 250], [500, 700]]);
    const extracted = await editPdfFile(original, 'extract', '1, 3');
    const extractedDoc = await PDFDocument.load(new Uint8Array(await extracted.blob.arrayBuffer()));
    expect(extractedDoc.getPageCount()).toBe(2);

    const removed = await editPdfFile(original, 'remove', '2');
    const removedDoc = await PDFDocument.load(new Uint8Array(await removed.blob.arrayBuffer()));
    expect(removedDoc.getPageCount()).toBe(2);

    const rotated = await editPdfFile(original, 'rotate', '2', 90);
    const rotatedDoc = await PDFDocument.load(new Uint8Array(await rotated.blob.arrayBuffer()));
    expect(rotatedDoc.getPage(0).getRotation().angle).toBe(0);
    expect(rotatedDoc.getPage(1).getRotation().angle).toBe(90);
  });

  it('reorders pages and rejects an incomplete or duplicated order', async () => {
    const original = await makePdf('pages.pdf', [[300, 400], [200, 250], [500, 700]]);
    const result = await editPdfFile(original, 'reorder', '', 90, '3, 1, 2');
    const reordered = await openResult(new File([await result.blob.arrayBuffer()], result.fileName, { type: 'application/pdf' }));
    expect(reordered.getPage(0).getWidth()).toBe(500);
    expect(reordered.getPage(1).getWidth()).toBe(300);
    expect(reordered.getPage(2).getWidth()).toBe(200);
    expect(() => parsePageOrder('1, 1, 3', 3)).toThrow(/exactly once/i);
  });

  it('requires at least two PDFs to merge and keeps at least one page when removing', async () => {
    const onePage = await makePdf('one.pdf', [[300, 400]]);
    await expect(mergePdfFiles([onePage])).rejects.toThrow(/at least two/i);
    await expect(editPdfFile(onePage, 'remove', '1')).rejects.toThrow(/at least one page/i);
  });

  it('extracts a ZIP in-browser, flattens directory paths, and disambiguates duplicate names', async () => {
    const bytes = zipSync({ 'one/readme.txt': new TextEncoder().encode('first'), 'two/readme.txt': new TextEncoder().encode('second') });
    const archive = new File([bytes], 'notes.zip', { type: 'application/zip' });
    const entries = await extractZipArchive(archive);
    expect(entries.map((entry) => entry.fileName)).toEqual(['readme.txt', 'readme (2).txt']);
    expect(await entries[0]!.blob.text()).toBe('first');
    expect(await entries[1]!.blob.text()).toBe('second');
  });

  it('creates a DEFLATE-compressed ZIP and can extract its file in-browser', async () => {
    const source = new File(['The same sentence will be compressed repeatedly. '.repeat(20)], 'notes.txt', { type: 'text/plain' });
    const compressed = await createCompressedZipArchive([source]);
    const extracted = await extractZipArchive(new File([compressed], 'compressed.zip', { type: 'application/zip' }));
    expect(extracted).toHaveLength(1);
    expect(extracted[0]!.fileName).toBe('notes.txt');
    expect(await extracted[0]!.blob.text()).toBe(await source.text());
    expect(compressed.size).toBeLessThan(source.size);
  });

  it('rejects ZIP paths that attempt directory traversal', async () => {
    const bytes = zipSync({ '../escape.txt': new TextEncoder().encode('no') });
    await expect(extractZipArchive(new File([bytes], 'unsafe.zip'))).rejects.toThrow(/unsafe file path/i);
  });

  it('compresses and expands GZIP files locally while retaining a safe file name', async () => {
    const source = new File(['gzip content'], 'notes.txt', { type: 'text/plain' });
    const compressed = await processGzipFile(source, 'compress');
    expect(compressed.fileName).toBe('notes.txt.gz');
    const expanded = await processGzipFile(new File([compressed.blob], compressed.fileName), 'extract');
    expect(expanded.fileName).toBe('notes.txt');
    expect(await expanded.blob.text()).toBe('gzip content');
  });

  it('creates a paginated PDF from plain text entirely in memory', async () => {
    const source = new File(['Hello from CloudHost247\nA second line.'], 'notes.txt', { type: 'text/plain' });
    const result = await convertTextDocumentToPdf(source);
    const pdf = await PDFDocument.load(new Uint8Array(await result.blob.arrayBuffer()));
    expect(result.fileName).toBe('notes.pdf');
    expect(pdf.getPageCount()).toBe(1);
  });

  it('converts Word documents to a printable PDF locally', async () => {
    const documentXml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Word conversion works</w:t></w:r></w:p></w:body></w:document>';
    const docxBytes = zipSync({ 'word/document.xml': new TextEncoder().encode(documentXml) });
    const result = await convertDocumentToPdf(new File([docxBytes], 'letter.docx'));
    const pdf = await PDFDocument.load(new Uint8Array(await result.blob.arrayBuffer()));
    expect(result.fileName).toBe('letter.pdf');
    expect(result.blob.type).toBe('application/pdf');
    expect(pdf.getPageCount()).toBe(1);
  });

  it('exports selectable PDF text as a valid editable DOCX and reports scanned PDFs clearly', async () => {
    mockPdfText([[{ str: 'PDF export & <Word>', hasEOL: true }, { str: 'Second paragraph', hasEOL: true }]]);
    const source = await makeTextPdf('letter.pdf', 'PDF export & <Word>');
    const result = await convertDocumentToDocx(source);
    const archive = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
    const documentXml = new TextDecoder().decode(archive['word/document.xml']);
    expect(result.fileName).toBe('letter.docx');
    expect(result.blob.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(documentXml).toContain('PDF export &amp; &lt;Word&gt;');
    expect(documentXml).toContain('Second paragraph');
    const roundTrip = await extractDocumentText(new File([await result.blob.arrayBuffer()], result.fileName));
    expect(await roundTrip.blob.text()).toBe('PDF export & <Word>\nSecond paragraph');
    mockPdfText([[]]);
    await expect(convertDocumentToDocx(await makePdf('scan.pdf', [[612, 792]]))).rejects.toThrow(/OCR/i);
  });

  it('extracts text from DOCX and HTML inputs without running document scripts', async () => {
    const documentXml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello document</w:t></w:r></w:p><w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p></w:body></w:document>';
    const docxBytes = zipSync({ 'word/document.xml': new TextEncoder().encode(documentXml) });
    const docx = await extractDocumentText(new File([docxBytes], 'memo.docx'));
    expect(await docx.blob.text()).toBe('Hello document\nSecond paragraph');
    const html = await extractDocumentText(new File(['<h1>Safe title</h1><script>window.alert(1)</script><p>Body text</p>'], 'safe.html', { type: 'text/html' }));
    expect(await html.blob.text()).toContain('Safe title');
    expect(await html.blob.text()).toContain('Body text');
    expect(await html.blob.text()).not.toContain('window.alert');
  });

  it('extracts EPUB chapter text in reading order', async () => {
    const epub = zipSync({
      'OEBPS/book.opf': new TextEncoder().encode('<package xmlns="http://www.idpf.org/2007/opf"><manifest><item id="chapter-1" href="chapter.xhtml" media-type="application/xhtml+xml" /></manifest><spine><itemref idref="chapter-1" /></spine></package>'),
      'OEBPS/chapter.xhtml': new TextEncoder().encode('<html><body><h1>First chapter</h1><p>Readable ebook text.</p></body></html>'),
    });
    const result = await extractDocumentText(new File([epub], 'book.epub'));
    expect(await result.blob.text()).toContain('First chapter');
    expect(await result.blob.text()).toContain('Readable ebook text.');
  });

  it('rejects unsupported local media before attempting browser codec loading', async () => {
    await expect(convertLocalMedia(new File(['x'], 'movie.exe'), 'video', 'mp4')).rejects.toThrow(/supported video file/i);
  });
});
