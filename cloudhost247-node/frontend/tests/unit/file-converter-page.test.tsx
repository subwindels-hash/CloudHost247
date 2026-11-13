// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import FileConverterPage from '../../src/pages/FileConverterPage';

afterEach(() => cleanup());

function renderConverter() {
  return render(<MemoryRouter><FileConverterPage /></MemoryRouter>);
}

describe('File Converter page', () => {
  it('explains its local processing model and shows the supported formats', () => {
    renderConverter();
    expect(screen.getByRole('heading', { level: 1, name: 'File Converter' })).toBeTruthy();
    expect(screen.getByText(/selected file bytes are not sent to CloudHost247/i)).toBeTruthy();
    expect(screen.getByText(/PNG, JPG\/JFIF, WebP, GIF, BMP, AVIF, HEIC\/HEIF, SVG or PDF/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose files' })).toBeTruthy();
  });

  it('rejects unsupported files with a clear message instead of silently queueing them', () => {
    renderConverter();
    const input = screen.getByLabelText('Choose images and PDFs') as HTMLInputElement;
    const textFile = new File(['not an image'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [textFile] } });
    expect(screen.getByRole('alert').textContent).toMatch(/choose an image.*or a PDF/i);
    expect(screen.queryByRole('list', { name: 'Files in conversion queue' })).toBeNull();
  });

  it('queues supported files and selects an output format that can convert them', () => {
    renderConverter();
    const input = screen.getByLabelText('Choose images and PDFs') as HTMLInputElement;
    const image = new File(['fake image bytes'], 'avatar.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [image] } });

    expect(screen.getByText('avatar.png')).toBeTruthy();
    const output = screen.getByLabelText('Convert to') as HTMLSelectElement;
    expect(Array.from(output.options).map((option) => option.value)).toEqual(['png', 'jpeg', 'webp', 'pdf', 'svg']);
    expect(screen.getByRole('button', { name: 'Convert files' })).toBeTruthy();
  });

  it('keeps PDF-to-PDF out of the target list and advertises separate page downloads', () => {
    renderConverter();
    const input = screen.getByLabelText('Choose images and PDFs') as HTMLInputElement;
    const pdf = new File(['%PDF'], 'brief.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [pdf] } });

    const output = screen.getByLabelText('Convert to') as HTMLSelectElement;
    expect(Array.from(output.options).map((option) => option.value)).toEqual(['png', 'jpeg', 'webp']);
    expect(screen.getByText(/PDF pages export as separate PNG files/i)).toBeTruthy();
    expect(screen.getByLabelText('PDF page resolution')).toBeTruthy();
  });
});


describe('File Converter advanced controls', () => {
  it('offers rotate, flip, and crop settings for the current batch', () => {
    renderConverter();
    const input = screen.getByLabelText('Choose images and PDFs') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['image'], 'photo.png', { type: 'image/png' })] } });
    const advanced = screen.getByText('Advanced settings').closest('details')!;
    fireEvent.click(advanced.querySelector('summary')!);

    expect(screen.getByLabelText('Rotate clockwise')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Flip horizontally' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Flip vertically' })).toBeTruthy();
    expect(screen.getByLabelText('Left (%)')).toBeTruthy();
    expect(screen.getByLabelText('Top (%)')).toBeTruthy();
    expect(screen.getByLabelText('Width (%)')).toBeTruthy();
    expect(screen.getByLabelText('Height (%)')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Left (%)'), { target: { value: '10' } });
    expect((screen.getByLabelText('Width (%)') as HTMLInputElement).value).toBe('90');
  });

  it('offers a reorderable multi-image PDF and explains queue page order', () => {
    renderConverter();
    const input = screen.getByLabelText('Choose images and PDFs') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [
      new File(['first'], 'first.png', { type: 'image/png' }),
      new File(['second'], 'second.png', { type: 'image/png' }),
    ] } });
    fireEvent.change(screen.getByLabelText('Convert to'), { target: { value: 'pdf' } });

    const combine = screen.getByRole('checkbox', { name: 'Combine queued images into one multi-page PDF' });
    fireEvent.click(combine);
    expect(screen.getByText(/one PDF, in the order shown below/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Move second.png up' }));
    const queue = screen.getByRole('list', { name: 'Files in conversion queue' });
    const names = Array.from(queue.querySelectorAll('.fc-file-info__top strong')).map((node) => node.textContent);
    expect(names).toEqual(['second.png', 'first.png']);
  });

  it('accepts PDF page ranges and blocks malformed selections', () => {
    renderConverter();
    const input = screen.getByLabelText('Choose images and PDFs') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['%PDF'], 'brief.pdf', { type: 'application/pdf' })] } });
    const advanced = screen.getByText('Advanced settings').closest('details')!;
    fireEvent.click(advanced.querySelector('summary')!);
    const pages = screen.getByLabelText(/PDF pages to export/) as HTMLInputElement;
    fireEvent.change(pages, { target: { value: '1-3, 5' } });
    expect(pages.getAttribute('aria-invalid')).toBe('false');
    fireEvent.change(pages, { target: { value: '0' } });
    expect(screen.getByRole('alert').textContent).toMatch(/page numbers from 1 to 25/i);
    expect(screen.getByRole('button', { name: 'Convert files' })).toHaveProperty('disabled', true);
  });
});
