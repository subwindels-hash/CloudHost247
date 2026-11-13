// @vitest-environment jsdom
/**
 * Barcode Scanner: the list a scanning session keeps, and the page around it.
 *
 * jsdom has no camera and no canvas, so what a browser adds (the camera picture, reading a chosen
 * file) is exercised in Chromium by e2e/barcode-scanner.spec.ts. Here: the rules of the list, the
 * CSV file, what the page says when a browser cannot give it a camera, and which types it says it
 * reads in a browser that will not run WebAssembly.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import BarcodeScannerPage from '../../src/pages/tools/BarcodeScannerPage';
import { RESCAN_GAP_MS, addScan, csvCell, scanTotal, scansToCsv, scansToText, type ScanRecord } from '../../src/lib/scan-session';
import { toolForm } from '../../src/lib/tools-api';
import { TOOL_CATALOG } from '../../../src/tools/catalog';
import { BASIC_SCAN_FORMATS, SCAN_FORMATS, type ScanHit } from '../../../src/tools/scanner/formats';

const code128 = (text: string): ScanHit => ({ format: 'code_128', formatName: 'Code 128', text });
const qr = (text: string): ScanHit => ({ format: 'qr_code', formatName: 'QR Code', text });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the list a session keeps', () => {
  it('lists a barcode once while the camera keeps seeing it', () => {
    let records: ScanRecord[] = [];
    const first = addScan(records, code128('A-1'), 10_000, 'camera');
    expect(first.change).toBe('new');
    records = first.records;
    // The camera reports the same barcode several times a second.
    for (let frame = 1; frame <= 20; frame += 1) {
      const next = addScan(records, code128('A-1'), 10_000 + frame * 200, 'camera');
      expect(next.change, `frame ${frame}`).toBe('same');
      records = next.records;
    }
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ id: 1, formatName: 'Code 128', text: 'A-1', count: 1, firstSeen: 10_000, lastSeen: 14_000 });
    expect(scanTotal(records)).toBe(1);
  });

  it('counts a barcode again once it has been taken away and shown again', () => {
    let records = addScan([], code128('A-1'), 0, 'camera').records;
    // Still in view just inside the gap: the same scan. The gap is measured from when it was last seen.
    records = addScan(records, code128('A-1'), RESCAN_GAP_MS, 'camera').records;
    expect(records[0]?.count).toBe(1);
    const again = addScan(records, code128('A-1'), RESCAN_GAP_MS * 2 + 1, 'camera');
    expect(again.change).toBe('again');
    expect(again.record.count).toBe(2);
    expect(again.records).toHaveLength(1);
    expect(scanTotal(again.records)).toBe(2);
  });

  it('counts every picture chosen, because choosing one is deliberate', () => {
    let records = addScan([], code128('A-1'), 0, 'image').records;
    const again = addScan(records, code128('A-1'), 5, 'image');
    expect(again.change).toBe('again');
    records = again.records;
    expect(records[0]?.count).toBe(2);
  });

  it('keeps barcodes in the order first scanned, and tells apart the same text in different types', () => {
    let records: ScanRecord[] = [];
    for (const [index, hit] of [code128('A-1'), qr('A-1'), code128('B-2'), qr('https://example.com')].entries()) records = addScan(records, hit, index * 5_000, 'camera').records;
    expect(records.map((record) => [record.id, record.formatName, record.text])).toEqual([
      [1, 'Code 128', 'A-1'],
      [2, 'QR Code', 'A-1'],
      [3, 'Code 128', 'B-2'],
      [4, 'QR Code', 'https://example.com'],
    ]);
    expect(records[3]).toMatchObject({ kindLabel: 'Web address', caution: 'Check the address before you open it. A code can point anywhere.' });
    expect(records[0]).toMatchObject({ kindLabel: 'Text', caution: null });
    // The list given is never changed in place.
    const before = [...records];
    addScan(records, code128('C-3'), 99_000, 'camera');
    expect(records).toEqual(before);
  });
});

describe('the files a session gives', () => {
  const records: ScanRecord[] = [
    { id: 1, format: 'code_128', formatName: 'Code 128', text: 'CH247-000123', kindLabel: 'Text', caution: null, firstSeen: Date.UTC(2026, 10, 12, 9, 30, 0), lastSeen: 0, count: 2 },
    { id: 2, format: 'qr_code', formatName: 'QR Code', text: 'He said "hello", twice\nand left', kindLabel: 'Text', caution: null, firstSeen: Date.UTC(2026, 10, 12, 9, 31, 5), lastSeen: 0, count: 1 },
    { id: 3, format: 'data_matrix', formatName: 'Data Matrix', text: '\u001d0109521234543213', kindLabel: 'Text', caution: null, firstSeen: Date.UTC(2026, 10, 12, 9, 32, 0), lastSeen: 0, count: 1 },
  ];

  it('writes a CSV a spreadsheet opens: a byte order mark, quoted cells and CRLF rows', () => {
    expect(scansToCsv(records)).toBe(
      [
        '\uFEFF"Number","First scanned (UTC)","Type","Content","Kind","Times scanned"',
        '"1","2026-11-12T09:30:00.000Z","Code 128","CH247-000123","Text","2"',
        // A quotation mark is doubled; a line break stays inside its quoted cell.
        '"2","2026-11-12T09:31:05.000Z","QR Code","He said ""hello"", twice\nand left","Text","1"',
        // A control character is written as its picture, so the cell shows that it is there.
        '"3","2026-11-12T09:32:00.000Z","Data Matrix","\u241d0109521234543213","Text","1"',
        '',
      ].join('\r\n')
    );
    expect(scansToCsv([])).toBe('\uFEFF"Number","First scanned (UTC)","Type","Content","Kind","Times scanned"\r\n');
  });

  it('never lets scanned text run as a spreadsheet formula', () => {
    // A barcode is untrusted text, and each of these would be executed by a spreadsheet.
    for (const hostile of ['=HYPERLINK("https://evil.example","Click")', '+1+1', '-2+3+cmd|\' /C calc\'!A0', '@SUM(1+1)*cmd|\' /C calc\'!A0', '\t=1+1', '\r=1+1']) {
      const cell = csvCell(hostile);
      expect(cell.startsWith('"\''), hostile).toBe(true);
      expect(cell).toBe(`"'${hostile.replace(/"/g, '""')}"`);
    }
    // Ordinary content is not touched, including a formula sign that is not at the start.
    expect(csvCell('CH247-000123')).toBe('"CH247-000123"');
    expect(csvCell('1+1=2')).toBe('"1+1=2"');
    expect(csvCell('a@b.ng')).toBe('"a@b.ng"');
    // A phone number and a HIBC code begin with +; they are kept whole, as text.
    expect(csvCell('+2348035550142')).toBe('"\'+2348035550142"');
    const csv = scansToCsv([{ ...(records[0] as ScanRecord), text: '=cmd|\' /C calc\'!A0' }]);
    expect(csv).toContain('"\'=cmd|\' /C calc\'!A0"');
  });

  it('copies the contents exactly as scanned, one barcode per line', () => {
    expect(scansToText(records)).toBe('CH247-000123\nHe said "hello", twice\nand left\n\u001d0109521234543213');
    expect(scansToText([])).toBe('');
  });
});

describe('the page', () => {
  const catalog = (status = 'ACTIVE', statusMessage: string | null = null) => ({
    success: true,
    tools: TOOL_CATALOG.map((tool) => ({ ...tool, notes: tool.notes ?? [], status: tool.slug === 'barcode-scanner' ? status : 'ACTIVE', statusMessage: tool.slug === 'barcode-scanner' ? statusMessage : null })),
  });
  const respond = (value: unknown, status = 200) => ({ ok: status < 300, status, statusText: '', headers: new Headers({ 'content-type': 'application/json' }), text: async () => JSON.stringify(value) });

  function renderPage() {
    return render(
      <MemoryRouter initialEntries={['/tools/barcode-scanner']}>
        <BarcodeScannerPage />
      </MemoryRouter>
    );
  }

  it('offers the camera and a picture, lists what it reads, and asks the server for nothing but the catalogue', async () => {
    const fetch = vi.fn(async () => respond(catalog()));
    vi.stubGlobal('fetch', fetch);
    const { container } = renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Barcode Scanner' });
    expect(screen.getByRole('button', { name: 'Start camera' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose a picture' })).toBeTruthy();
    // The file control takes any picture; on a phone that includes the camera.
    const file = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(file?.accept).toBe('image/*');
    expect(file?.getAttribute('aria-label')).toBe('Picture of a barcode');

    const formats = within(await screen.findByRole('region', { name: 'What it reads' })).getAllByRole('listitem').slice(0, SCAN_FORMATS.length);
    expect(formats).toHaveLength(21);
    expect(formats.map((item) => item.querySelector('strong')?.textContent)).toEqual(SCAN_FORMATS.map((format) => format.name));
    // A limit on reading a type is said beside its name.
    expect(formats.map((item) => item.textContent)).toContain('MaxiCode from a clean, upright image only');
    expect(formats.map((item) => item.textContent)).toContain('UPC-E');
    // This is a browser that runs WebAssembly (Node does), so every type is offered and nothing is marked.
    expect(container.querySelector('.scanner-basic')).toBeNull();
    expect(container.querySelectorAll('.scanner-formats li.is-missing')).toHaveLength(0);
    // The catalogue's own notes follow, including what is not read.
    expect(await screen.findByText(/^Postal barcodes, Code 11, MSI, Pharmacode, DotCode and Han Xin are not read\. Nor is Codablock F/)).toBeTruthy();
    expect(screen.getByText(/^The last eight of those types, from UPC-E on, need WebAssembly in the browser\./)).toBeTruthy();

    expect(screen.getByText('Decoded in your browser. The camera picture and your pictures are not uploaded, and nothing a barcode contains is opened or followed.')).toBeTruthy();
    expect(screen.getByText('Nothing yet')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Download CSV' })).toBeNull();
    // One request: the catalogue. Nothing is posted anywhere.
    expect(fetch.mock.calls.map((call) => String((call as unknown[])[0]))).toEqual(['/api/tools/catalog']);
  });

  it('says what to do when the browser cannot give the page a camera', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(catalog())));
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Barcode Scanner' });
    // jsdom has no camera API at all, which is also what a page served without https gets.
    fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'This browser does not give this page a camera: that needs a secure (https) address and a browser with camera support. Choose a picture of the barcode instead.'
    );
    // The picture route is still offered.
    expect((screen.getByRole('button', { name: 'Choose a picture' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Start camera' })).toBeTruthy();
  });

  it('works without the catalogue, under its own name', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond({ code: 'SERVICE_UNAVAILABLE', message: 'down' }, 503)));
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Barcode Scanner' });
    expect((screen.getByRole('button', { name: 'Start camera' }) as HTMLButtonElement).disabled).toBe(false);
    // Without the catalogue's notes the page still says what it does not read.
    expect(screen.getByText('Postal barcodes, Code 11, MSI, Pharmacode, DotCode, Han Xin and Codablock F are not read.')).toBeTruthy();
  });

  it('says which types it does not read in a browser that will not run WebAssembly, before anything is scanned', async () => {
    const forbidden = {
      ...WebAssembly,
      // What a browser does where a policy or a security setting forbids compiling WebAssembly.
      Module: function Module(): never {
        throw new Error('Refused to compile or instantiate WebAssembly module');
      },
    };
    for (const stand of [undefined, forbidden]) {
      const fetch = vi.fn(async () => respond(catalog()));
      vi.stubGlobal('fetch', fetch);
      vi.stubGlobal('WebAssembly', stand);
      const { container, unmount } = renderPage();
      await screen.findByRole('heading', { level: 1, name: 'Barcode Scanner' });
      expect((await screen.findByRole('status')).textContent).toBe(
        'This browser did not start the scanner’s full decoder, which needs WebAssembly, so a smaller one is in use. It reads the first 13 types below and not the 8 marked “not in this browser”.'
      );
      const items = Array.from(container.querySelectorAll('.scanner-formats li'));
      expect(items).toHaveLength(21);
      // The thirteen it reads are as they were, and come first.
      expect(items.slice(0, 13).map((item) => item.querySelector('strong')?.textContent)).toEqual(BASIC_SCAN_FORMATS.map((format) => format.name));
      expect(items.slice(0, 13).some((item) => item.classList.contains('is-missing'))).toBe(false);
      // The other eight are still named, each marked in words and not by its look alone.
      expect(items.slice(13).map((item) => item.textContent)).toEqual(
        ['UPC-E', 'GS1 DataBar Limited', 'GS1 DataBar Expanded', 'Micro QR Code', 'rMQR Code', 'MicroPDF417', 'Telepen', 'MaxiCode'].map((name) => `${name} not in this browser`)
      );
      expect(items.slice(13).every((item) => item.classList.contains('is-missing'))).toBe(true);
      // Both ways of scanning are still offered, and nothing was fetched to find this out.
      expect((screen.getByRole('button', { name: 'Start camera' }) as HTMLButtonElement).disabled).toBe(false);
      expect((screen.getByRole('button', { name: 'Choose a picture' }) as HTMLButtonElement).disabled).toBe(false);
      expect(fetch.mock.calls.map((call) => String((call as unknown[])[0]))).toEqual(['/api/tools/catalog']);
      unmount();
      vi.unstubAllGlobals();
    }
  });

  it('does not offer a scanner an administrator has switched off', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(catalog('DISABLED', 'The scanner is switched off for maintenance.'))));
    renderPage();
    await screen.findByText('The scanner is switched off for maintenance.');
    expect((screen.getByRole('button', { name: 'Start camera' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Choose a picture' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('gives the general tool page and the API a form for an uploaded picture', () => {
    const form = toolForm('barcode-scanner');
    expect(form.method).toBe('POST');
    expect(form.fields.map((field) => [field.name, field.required])).toEqual([['image', true]]);
  });
});
