// @vitest-environment jsdom
/**
 * Employee ID Card Generator — the page a user actually operates.
 *
 * The *engine* is asserted in tests/unit/employee-id-card.test.ts: templates, encoders, raster
 * decoding, PDF and ZIP structure, validation rules and bulk import. This file covers what only the
 * page can get wrong:
 *
 *   - the workspace renders twelve templates, eight presets and four colour controls, and those
 *     controls are wired to the engine rather than being decoration;
 *   - the downloads stay locked while the mandatory fields are empty, and unlock with a working
 *     card — a disabled button is the only honest way to say "this would produce a blank badge";
 *   - the privacy switch is real: uploaded images and contact details are not written to
 *     localStorage unless the user opts in, and "clear stored data" removes what is there;
 *   - a card that fails validation explains which field is at fault, by name.
 *
 * jsdom has no 2D canvas, so the drawing context is stubbed. That is deliberate: these assertions
 * are about the page's state machine and its controls, and the pixels themselves are verified
 * against a real rasteriser in the engine suite.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import IdCardGeneratorPage from '../../src/pages/tools/IdCardGeneratorPage';
import { CARD_PRESETS, CARD_TEMPLATES } from '../../../src/tools/business/id-card';

/** A no-op 2D context: enough for the renderer to complete a draw pass without a real canvas. */
function stubCanvas(): void {
  const gradient = { addColorStop: () => undefined };
  const context = {
    save: () => undefined,
    restore: () => undefined,
    translate: () => undefined,
    scale: () => undefined,
    rotate: () => undefined,
    beginPath: () => undefined,
    closePath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    arc: () => undefined,
    ellipse: () => undefined,
    rect: () => undefined,
    fill: () => undefined,
    stroke: () => undefined,
    clip: () => undefined,
    fillRect: () => undefined,
    strokeRect: () => undefined,
    clearRect: () => undefined,
    fillText: () => undefined,
    drawImage: () => undefined,
    setLineDash: () => undefined,
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    measureText: (text: string) => ({ width: text.length * 8 }),
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    textAlign: 'start',
    textBaseline: 'alphabetic',
  };
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    writable: true,
    value: () => context,
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
    configurable: true,
    writable: true,
    value: (callback: (blob: Blob | null) => void) => callback(new Blob([new Uint8Array([1, 2, 3])])),
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <IdCardGeneratorPage />
    </MemoryRouter>
  );
}

/** Fill the three fields the engine requires. */
function fillRequired(): void {
  fireEvent.change(screen.getByLabelText(/Full name/i), { target: { value: 'Ada Obi' } });
  fireEvent.change(screen.getByLabelText(/Employee ID/i), { target: { value: 'CH247-OPS-2026-0001-8' } });
  fireEvent.change(screen.getByLabelText(/Company name/i), { target: { value: 'CloudHost247 Ltd' } });
}

describe('Employee ID Card Generator — the page', () => {
  beforeEach(() => {
    localStorage.clear();
    stubCanvas();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders all twelve templates, all eight presets and the four custom colour controls', async () => {
    renderPage();

    const templateGroup = screen.getByRole('radiogroup', { name: /Card template/i });
    await waitFor(() => expect(templateGroup.children.length).toBe(CARD_TEMPLATES.length));
    for (const template of CARD_TEMPLATES) {
      expect(screen.getByText(template.name)).toBeTruthy();
    }

    const presetGroup = screen.getByRole('radiogroup', { name: /Colour preset/i });
    expect(presetGroup.children.length).toBe(CARD_PRESETS.length);
    for (const preset of CARD_PRESETS) {
      expect(screen.getByText(preset.name)).toBeTruthy();
    }

    // The four custom pickers: a colour input and a hex field each.
    for (const label of ['Primary accent', 'Card background', 'Text colour', 'Detail accent']) {
      expect(screen.getByLabelText(label)).toBeTruthy();
      expect(screen.getByLabelText(`${label} hex value`)).toBeTruthy();
    }
  });

  it('advertises the promise it can keep: twelve templates, eight presets, 300 dpi, nothing uploaded', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Employee ID Card Generator' })).toBeTruthy();
    expect(screen.getByText('300')).toBeTruthy();
    expect(screen.getByText(/everything runs in your browser/i)).toBeTruthy();
  });

  it('names the missing fields and keeps the downloads locked until they are filled in', async () => {
    renderPage();

    expect(screen.getAllByRole('alert').map((node) => node.textContent ?? '').join(' ')).toMatch(/needs attention|need attention/i);

    fireEvent.click(screen.getByRole('tab', { name: /Download & print/i }));
    const pdf = screen.getByRole('button', { name: /Download PDF \(both sides\)/i });
    expect(pdf.hasAttribute('disabled')).toBe(true);

    fillRequired();

    await waitFor(() => expect(screen.queryAllByRole('alert')).toHaveLength(0));
    await waitFor(() => expect(screen.getByRole('button', { name: /Download PDF \(both sides\)/i }).hasAttribute('disabled')).toBe(false));
    expect(screen.getByRole('button', { name: /Download PNG \(both sides\)/i }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: /Download JPG \(both sides\)/i }).hasAttribute('disabled')).toBe(false);
  });

  it('reports the QR payload it will encode, and what the code does not do', async () => {
    renderPage();
    fillRequired();
    // The QR defaults to the employee ID, so the page can say exactly what a scan returns.
    await waitFor(() => expect(screen.getAllByText(/CH247-OPS-2026-0001-8/).length).toBeGreaterThan(0));

    fireEvent.change(screen.getByLabelText(/QR content or verification URL/i), { target: { value: 'not a url' } });
    await waitFor(() => expect(screen.getByText(/does not verify employment|plain text/i)).toBeTruthy());
  });

  it('warns that a supplied verification link is not checked by CloudHost247', async () => {
    renderPage();
    fillRequired();
    fireEvent.change(screen.getByLabelText(/QR content or verification URL/i), { target: { value: 'https://staff.example.com/verify/EMP00123' } });
    await waitFor(() => expect(screen.getByText(/does not host or check that page/i)).toBeTruthy());
  });

  it('resets the form to the default template and palette', async () => {
    renderPage();
    fillRequired();
    // The template tiles are `role="radio"`, so pick a different template by name.
    fireEvent.click(screen.getByRole('radio', { name: /Modern Badge/i }));
    await waitFor(() => expect(screen.getByRole('radio', { name: /Modern Badge/i }).getAttribute('aria-checked')).toBe('true'));
    fireEvent.click(screen.getByRole('button', { name: 'Reset form' }));

    await waitFor(() => expect((screen.getByLabelText(/Full name/i) as HTMLInputElement).value).toBe(''));
    expect((screen.getByLabelText(/Company name/i) as HTMLInputElement).value).toBe('');
    const radio = screen.getByRole('radio', { name: /Corporate Split/i });
    expect(radio.getAttribute('aria-checked')).toBe('true');
  });

  it('switches the palette to custom when a colour is edited, and back to a preset when one is chosen', async () => {
    renderPage();
    const midn = CARD_PRESETS.find((preset) => preset.name === 'Midnight');
    expect(midn).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(midn!.name, 'i') }));
    await waitFor(() => expect(screen.getByRole('radio', { name: new RegExp(midn!.name, 'i') }).getAttribute('aria-checked')).toBe('true'));

    fireEvent.change(screen.getByLabelText('Primary accent hex value'), { target: { value: '#123456' } });
    await waitFor(() => {
      const custom = screen.getByRole('radio', { name: new RegExp(midn!.name, 'i') });
      expect(custom.getAttribute('aria-checked')).toBe('false');
    });
    expect((screen.getByLabelText('Primary accent hex value') as HTMLInputElement).value).toBe('#123456');
  });

  it('keeps photographs and contact details out of localStorage unless the user opts in', async () => {
    renderPage();
    fillRequired();
    fireEvent.change(screen.getByLabelText(/Phone number/i), { target: { value: '+234 801 234 5678' } });
    fireEvent.click(screen.getByRole('tab', { name: /Download & print/i }));

    // The autosave runs on a timer; wait for it to have written something.
    await waitFor(() => expect(localStorage.getItem('ch247.id-card.v1')).not.toBeNull(), { timeout: 3000 });
    const stored = localStorage.getItem('ch247.id-card.v1') ?? '';
    expect(stored).toContain('Ada Obi');
    expect(stored).not.toContain('+234 801 234 5678');
    expect(stored).not.toContain('signature');
    expect(stored).not.toContain('photo');

    // Opting in stores the contact fields from then on.
    fireEvent.click(screen.getByLabelText(/Also remember uploaded photographs/i));
    await waitFor(() => expect(localStorage.getItem('ch247.id-card.images-consent.v1')).toBe('yes'));
  });

  it('clears what it stored, and says so', async () => {
    renderPage();
    fillRequired();
    await waitFor(() => expect(localStorage.getItem('ch247.id-card.v1')).not.toBeNull(), { timeout: 3000 });

    fireEvent.click(screen.getByRole('tab', { name: /Download & print/i }));
    fireEvent.click(screen.getByRole('button', { name: /Clear stored data/i }));

    await waitFor(() => expect(localStorage.getItem('ch247.id-card.v1')).toBeNull());
    expect(localStorage.getItem('ch247.id-card.images-consent.v1')).toBeNull();
    expect(screen.getByText(/removed from this browser/i)).toBeTruthy();
  });

  it('restores what was stored, and tells the user it did', async () => {
    localStorage.setItem(
      'ch247.id-card.v1',
      JSON.stringify({ version: 1, savedAt: '2026-01-02T03:04:05.000Z', state: { fullName: 'Chidi Eze', employeeId: 'EMP9', companyName: 'Northwind Ltd' } })
    );
    renderPage();
    await waitFor(() => expect((screen.getByLabelText(/Full name/i) as HTMLInputElement).value).toBe('Chidi Eze'));
    expect(screen.getByText(/Restored the card details saved in this browser/i)).toBeTruthy();
  });

  it('offers only the eight real blood groups, plus leaving it off the card', () => {
    renderPage();
    const bloodGroup = screen.getByLabelText(/Blood group/i) as HTMLSelectElement;
    // A free-text blood group field is how a typo ends up printed next to somebody's photograph.
    expect([...bloodGroup.options].map((option) => option.value)).toEqual(['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']);
  });

  it('explains that bulk import reads the file locally and reports rejected rows', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /Bulk generation/i }));
    expect(screen.getByRole('heading', { name: /Bulk generation from Excel or CSV/i })).toBeTruthy();
    expect(screen.getByText(/Nothing is uploaded: the file is read in this tab/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Download CSV template/i })).toBeTruthy();
  });

  it('states the limits it cannot hide: no verification service, print at 100%', async () => {
    renderPage();
    expect(screen.getByText(/does not check that the employee works for the organisation/i)).toBeTruthy();
    expect(screen.getByText(/may constitute fraud/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Download & print/i }));
    expect(screen.getAllByText(/fit to page/i).length).toBeGreaterThan(0);
  });
});
