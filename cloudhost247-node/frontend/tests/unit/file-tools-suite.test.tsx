// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import FileToolsSuitePage from '../../src/pages/FileToolsSuitePage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderSuite(initialPath = '/tools/file-tools') {
  return render(<MemoryRouter initialEntries={[initialPath]}><FileToolsSuitePage /></MemoryRouter>);
}

describe('File Tools suite', () => {
  it('provides Convert, Compress, Tools, API and Pricing sections', () => {
    renderSuite();
    expect(screen.getByRole('heading', { level: 1, name: 'File Tools' })).toBeTruthy();
    for (const label of ['Overview', 'Convert', 'Compress', 'Tools', 'API', 'Pricing']) {
      expect(screen.getByRole('tab', { name: label })).toBeTruthy();
    }
    expect(screen.getByRole('link', { name: /Open image & PDF converter/ })).toHaveProperty('href', expect.stringContaining('/tools/file-converter'));
    expect(screen.getByText(/No Dropbox\/Drive\/OneDrive imports/i)).toBeTruthy();
  });

  it('shows direct launch buttons for all individual tools across every category', () => {
    renderSuite();
    expect(screen.getByRole('heading', { name: 'Every tool, one click away' })).toBeTruthy();
    expect(screen.getByText('33 tools')).toBeTruthy();
    expect(document.querySelectorAll('.ft-quick-button')).toHaveLength(33);
    for (const label of ['Compress images', 'Reorder PDF pages', 'Convert or compress audio', 'Convert video to GIF', 'Convert Word to PDF', 'Convert PDF to Word', 'Extract document text', 'Create a ZIP archive', 'Expand a GZIP file', 'Convert dates and timestamps', 'Build a REST API job']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
  });

  it('opens the chosen PDF operation from its quick launch button', () => {
    renderSuite();
    fireEvent.click(screen.getByRole('button', { name: 'Rotate PDF pages' }));
    expect(screen.getByRole('tab', { name: 'Tools' }).getAttribute('aria-selected')).toBe('true');
    expect((screen.getByLabelText('PDF action') as HTMLSelectElement).value).toBe('rotate');
  });

  it('opens both Word and PDF conversions in the matching output mode', () => {
    const documentPanel = () => screen.getByRole('heading', { name: 'Convert Word documents and PDFs' }).closest('section')!;
    const documentOutput = () => within(documentPanel()).getByRole('combobox') as HTMLSelectElement;
    const documentInput = () => documentPanel().querySelector('input[type="file"]') as HTMLInputElement;
    renderSuite();
    fireEvent.click(screen.getByRole('button', { name: 'Convert Word to PDF' }));
    expect(documentOutput().value).toBe('pdf');
    fireEvent.change(documentInput(), { target: { files: [new File(['word content'], 'letter.docx')] } });
    expect(documentOutput().value).toBe('pdf');
    cleanup();

    renderSuite();
    fireEvent.click(screen.getByRole('button', { name: 'Convert PDF to Word' }));
    expect(documentOutput().value).toBe('docx');
    fireEvent.change(documentInput(), { target: { files: [new File(['pdf bytes'], 'letter.pdf', { type: 'application/pdf' })] } });
    expect(documentOutput().value).toBe('docx');
  });

  it('opens exact animation, document, archive, and GZIP modes from quick launch', () => {
    renderSuite();
    fireEvent.click(screen.getByRole('button', { name: 'Convert video to GIF' }));
    expect((screen.getByLabelText('Animation tool') as HTMLSelectElement).value).toBe('video-to-gif');
    cleanup();

    renderSuite();
    fireEvent.click(screen.getByRole('button', { name: 'Extract document text' }));
    const documentPanel = screen.getByRole('heading', { name: 'Convert Word documents and PDFs' }).closest('section');
    expect((documentPanel?.querySelector('select') as HTMLSelectElement).value).toBe('txt');
    cleanup();

    renderSuite();
    fireEvent.click(screen.getByRole('button', { name: 'Create a ZIP archive' }));
    expect((screen.getByLabelText('Archive action') as HTMLSelectElement).value).toBe('create');
    cleanup();

    renderSuite();
    fireEvent.click(screen.getByRole('button', { name: 'Expand a GZIP file' }));
    expect((screen.getByLabelText('GZIP action') as HTMLSelectElement).value).toBe('extract');
  });

  it('exposes local image and PDF compressors with a clear flattened-PDF warning', () => {
    renderSuite();
    fireEvent.click(screen.getByRole('tab', { name: 'Compress' }));
    expect(screen.getByRole('heading', { name: 'Shrink images in your browser' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Reduce PDF size locally' })).toBeTruthy();
    expect(screen.getByText(/flattens text, links, form fields, and existing signatures/i)).toBeTruthy();
    expect(screen.getAllByLabelText(/Image quality/)).toHaveLength(2);
  });

  it('offers PDF page operations and a browser-local image color picker', () => {
    renderSuite();
    fireEvent.click(screen.getByRole('tab', { name: 'Tools' }));
    expect(screen.getByRole('heading', { name: 'Merge and organize pages' })).toBeTruthy();
    expect(screen.getByLabelText('PDF action')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Sample a pixel color' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('PDF action'), { target: { value: 'extract' } });
    expect(screen.getByLabelText(/Page range/)).toBeTruthy();
  });

  it('adds local audio, video, document, archive, unit, and time families', () => {
    renderSuite();
    fireEvent.click(screen.getByRole('tab', { name: 'Convert' }));
    expect(screen.getByRole('heading', { name: 'Convert and compress audio' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Convert and compress video' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Convert Word documents and PDFs' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Tools' }));
    expect(screen.getByRole('heading', { name: 'Create or extract ZIP files' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Compress or expand a .gz file' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Convert units and timestamps' })).toBeTruthy();
    expect(screen.getByText(/1 Metres \(m\) = 0\.001 Kilometres \(km\)/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'speed' } });
    expect(screen.getByText(/1 Metres per second \(m\/s\) = 3\.6 Kilometres per hour \(km\/h\)/)).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Pressure' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Unix timestamp/), { target: { value: '1735689600' } });
    expect(screen.getByText(/2025-01-01T00:00:00\.000Z/)).toBeTruthy();
  });

  it('loads API capabilities, exposes a real job builder, and explains transient server uploads', async () => {
    const payload = { success: true, processing: 'browser-local with optional ephemeral REST API jobs', browserToolsUploadFileContents: false, api: { acceptsFileContents: true } };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    renderSuite();
    fireEvent.click(screen.getByRole('tab', { name: 'API' }));
    expect(await screen.findByText(/Live capabilities response/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/file-tools/capabilities');
    expect(screen.getByRole('heading', { name: 'Build and run a File Tools API job' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: /Operation/ })).toBeTruthy();
    expect(screen.getByText(/upload Base64 file contents to this server/i)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Asynchronous jobs & specific endpoints' })).toBeTruthy();
    expect(screen.getByText('/api/v1/file-tools/compress/pdf')).toBeTruthy();
  });

  it('publishes honest free-local pricing instead of inventing a paid API tier', () => {
    renderSuite();
    fireEvent.click(screen.getByRole('tab', { name: 'Pricing' }));
    expect(screen.getByRole('heading', { name: 'File tools are free to use' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'No paid API plan yet' })).toBeTruthy();
    expect(screen.getByText(/Up to 20 files per batch/)).toBeTruthy();
    expect(screen.getByText(/25 MiB maximum per file/i)).toBeTruthy();
  });
});
