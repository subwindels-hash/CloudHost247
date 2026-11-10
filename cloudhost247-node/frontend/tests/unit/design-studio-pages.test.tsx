// @vitest-environment jsdom
/**
 * Design Studio pages.
 *
 * These five pages exist because the catalogue links point at them: a catalogue entry whose `path`
 * resolves through the `/tools/*` catch-all renders the generic form for a tool whose form *is* the
 * page. The tests therefore focus on the things that make the pages safe to link:
 *
 *  1. every page renders its own heading and fetches the tool it claims (not a sibling);
 *  2. a server failure is shown with the server's own code and message, never a generic apology;
 *  3. a blocked document disables export — printing a label built from invalid data is the failure
 *     mode the whole issue-list exists to prevent;
 *  4. the pages make no claim of compliance or certification without denying it (the VDA page in
 *     particular must not read as a certified label generator).
 *
 * The responses below are trimmed versions of real envelopes: the document, the preview SVG, the
 * geometry and the issue list are all present, because a stub that omits them would let the preview
 * or the export row break without a test noticing.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BarcodeGeneratorPage from '../../src/pages/tools/BarcodeGeneratorPage';
import LabelDesignerPage from '../../src/pages/tools/LabelDesignerPage';
import Vda4902LabelPage from '../../src/pages/tools/Vda4902LabelPage';
import ShippingLabelGeneratorPage from '../../src/pages/tools/ShippingLabelGeneratorPage';
import QrBusinessCardPage from '../../src/pages/tools/QrBusinessCardPage';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="70mm" height="40mm" viewBox="0 0 70 40"><rect width="70" height="40" fill="#fff"/></svg>';

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    tool: 'barcode-generator',
    status: 'ACTIVE',
    generatedAt: '2026-11-09T10:00:00.000Z',
    data: {
      document: { title: 'Document', pages: [{ width: 70, height: 40 }] },
      svg: SVG,
      preview: SVG,
      issues: [],
      blocked: false,
      summary: ['Symbol: Code 128'],
      sizeMm: { width: 70, height: 40 },
      sizePx: { width: 264, height: 151 },
      meta: { payload: 'CH247-2026-000123', formatName: 'Code 128', moduleMm: 0.35 },
      pdf: 'JVBERi0xLjQK',
      pdfBase64: true,
    },
    meta: { durationMs: 12, cached: false, sources: [], warnings: [] },
    ...overrides,
  };
}

/** Answer by path: the pages make several differently-shaped calls. */
function stubApi(handlers: Record<string, unknown | ((body: Record<string, unknown>) => unknown)>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const key = Object.keys(handlers).find((path) => url.includes(path));
    const handler = key ? handlers[key] : undefined;
    const payload = typeof handler === 'function' ? (handler as (body: Record<string, unknown>) => unknown)(body) : handler;
    if (payload === undefined) throw new Error(`Unstubbed request: ${url}`);
    return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) } as unknown as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPage(page: JSX.Element) {
  return render(<MemoryRouter>{page}</MemoryRouter>);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Barcode Generator page', () => {
  it('runs the barcode tool and shows the encoded value and printed size', async () => {
    const fetchMock = stubApi({ '/api/tools/barcode-generator': envelope() });
    renderPage(<BarcodeGeneratorPage />);

    expect(screen.getByRole('heading', { level: 1, name: /barcode generator/i })).toBeTruthy();
    // The payload is already in the textarea, so waiting for *that* text proves nothing — wait for the
    // export row, which only exists once a document came back.
    await waitFor(() => expect(screen.getByRole('button', { name: /download pdf/i })).toBeTruthy());
    // The geometry line is built from two numbers, so it is several text nodes — match on the
    // normalised content rather than a single text node.
    expect(document.body.textContent).toMatch(/70\s*×\s*40\s*mm/);
    expect(document.body.textContent).toContain('Code 128');

    // The request carried the form values, not an empty body.
    const call = fetchMock.mock.calls.find((entry) => String(entry[0]).includes('/api/tools/barcode-generator'));
    expect(call).toBeTruthy();
    const sent = JSON.parse(String((call?.[1] as RequestInit).body)) as Record<string, unknown>;
    expect(sent).toMatchObject({ formatId: 'code128', payload: 'CH247-2026-000123' });
  });

  it('shows the server code and message when the payload cannot be encoded', async () => {
    stubApi({
      '/api/tools/barcode-generator': {
        success: false,
        tool: 'barcode-generator',
        code: 'INVALID_INPUT',
        message: '"payload" is not valid for EAN-13: it needs 12 or 13 digits.',
        retryable: false,
      },
    });
    renderPage(<BarcodeGeneratorPage />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('INVALID_INPUT');
    expect(alert.textContent).toContain('12 or 13 digits');
    // No document → no export controls pretending there is something to export.
    expect(screen.queryByRole('button', { name: /download pdf/i })).toBeNull();
  });

  it('offers PDF, SVG, PNG and print once a document exists', async () => {
    stubApi({ '/api/tools/barcode-generator': envelope() });
    renderPage(<BarcodeGeneratorPage />);

    await waitFor(() => expect(screen.getByRole('button', { name: /download pdf/i })).toBeTruthy());
    expect(screen.getByRole('button', { name: /download svg/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /download png/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^print$/i })).toBeTruthy();
  });
});

describe('Label Designer page', () => {
  it('lists the templates the API serves and switches the field list with the template', async () => {
    stubApi({
      '/api/tools/label-designer': (body: Record<string, unknown>) => {
        if (body.action === 'templates') {
          return {
            success: true,
            data: {
              templates: [
                { id: 'address-70x40', name: 'Address label — 70 × 40 mm', category: 'address', blurb: 'Recipient block with a Code 128 barcode.' },
                { id: 'product-50x30', name: 'Product label — 50 × 30 mm', category: 'product', blurb: 'SKU, name, price and an EAN-13.' },
              ],
            },
          };
        }
        return envelope({ tool: 'label-designer' });
      },
    });
    renderPage(<LabelDesignerPage />);

    await waitFor(() => expect(screen.getByRole('button', { name: /Address label/i })).toBeTruthy());
    expect(screen.getByRole('button', { name: /Product label/i })).toBeTruthy();
    // The address template's bindings are the form.
    expect(screen.getByLabelText(/Recipient block/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Product label/i }));
    expect(screen.getByLabelText(/GTIN/i)).toBeTruthy();
    expect(screen.queryByLabelText(/Recipient block/i)).toBeNull();
  });

  it('previews one label by default and sends singlePage when the sheet view is chosen', async () => {
    const fetchMock = stubApi({
      '/api/tools/label-designer': (body: Record<string, unknown>) =>
        body.action === 'templates' ? { success: true, data: { templates: [] } } : envelope({ tool: 'label-designer' }),
    });
    renderPage(<LabelDesignerPage />);

    // A 70 × 40 mm label on an A4 page is a rectangle in the corner; the default has to be the label.
    await waitFor(() => {
      const preview = fetchMock.mock.calls.find((entry) => JSON.parse(String((entry[1] as RequestInit).body ?? '{}')).action === 'preview');
      expect(preview).toBeTruthy();
      expect(JSON.parse(String((preview?.[1] as RequestInit).body)).singlePage).toBe(true);
    });

    fireEvent.click(screen.getByRole('button', { name: /show the full sheet/i }));
    await waitFor(() => {
      const calls = fetchMock.mock.calls
        .map((entry) => JSON.parse(String((entry[1] as RequestInit).body ?? '{}')) as { action?: string; singlePage?: boolean })
        .filter((body) => body.action === 'preview');
      expect(calls.at(-1)?.singlePage).toBe(false);
    });
  });

  it('reports every CSV row with its line number and never claims a silently dropped row', async () => {
    stubApi({
      '/api/tools/label-designer': (body: Record<string, unknown>) => {
        if (body.action === 'templates') return { success: true, data: { templates: [] } };
        if (body.action === 'csv') {
          return {
            success: true,
            data: {
              headers: ['sku', 'gtin'],
              mapping: { sku: 'sku', gtin: 'gtin' },
              rows: [
                { line: 2, values: { sku: 'CH-1', gtin: '4006381333931' }, accepted: true, issues: [] },
                { line: 3, values: { sku: 'CH-2', gtin: '12345' }, accepted: false, issues: [{ level: 'error', message: 'EAN-13 needs 12 or 13 digits.' }] },
              ],
              accepted: 1,
              rejected: 1,
              warnings: [],
              rejectedCsv: 'Line,Error\n3,EAN-13 needs 12 or 13 digits.',
              templateCsv: 'sku,gtin\n',
            },
          };
        }
        return envelope({ tool: 'label-designer' });
      },
    });
    renderPage(<LabelDesignerPage />);

    await waitFor(() => expect(screen.getByRole('tab', { name: /CSV batch/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('tab', { name: /CSV batch/i }));
    fireEvent.change(screen.getByLabelText(/^CSV$/i), { target: { value: 'sku,gtin\nCH-1,4006381333931\nCH-2,12345' } });
    fireEvent.click(screen.getByRole('button', { name: /check the batch/i }));

    await waitFor(() => expect(screen.getByText(/EAN-13 needs 12 or 13 digits/i)).toBeTruthy());
    expect(screen.getByText(/1 label\(s\) will print, 1 row\(s\) rejected/i)).toBeTruthy();
    expect(screen.getByText(/No row is silently dropped/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /download rejected rows/i })).toBeTruthy();
  });
});

describe('VDA 4902 page', () => {
  it('renders the API limitations verbatim and never claims certification', async () => {
    const limitation = 'This tool has not been certified by the VDA or by any vehicle manufacturer.';
    stubApi({
      '/api/tools/vda-4902-label-generator': (body: Record<string, unknown>) => {
        if (body.action === 'spec') {
          return {
            success: true,
            data: {
              version: '4',
              fields: [
                { no: 1, key: 'receiver', label: 'Goods receiver', german: 'Warenempfänger', required: true, maxLength: 60, type: 'text', help: 'The customer company.', formats: ['master', 'klt'] },
              ],
              limitations: [limitation],
              sources: [],
            },
          };
        }
        return envelope({ tool: 'vda-4902-label-generator' });
      },
    });
    renderPage(<Vda4902LabelPage />);

    await waitFor(() => expect(screen.getByText(limitation)).toBeTruthy());
    expect(screen.getByRole('heading', { level: 1, name: /VDA 4902 Label Generator/i })).toBeTruthy();
    expect(screen.getByText(/Not certified/i)).toBeTruthy();

    /* A certification claim that is not also a denial is the one sentence this page must never
       produce. Splitting into sentences and requiring a negation in the same sentence is what makes
       "not certified by the VDA" pass while "certified for VDA 4902" would fail. */
    const sentences = (document.body.textContent ?? '').split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
    const claim = /certif|approv|accredited|guarantee/i;
    const negation = /\b(no|not|never|none|nothing|n't|cannot|unverified)\b/i;
    expect(sentences.filter((sentence) => claim.test(sentence) && !negation.test(sentence))).toEqual([]);
  });

  it('selects the KLT size and sends it in the data payload', async () => {
    const fetchMock = stubApi({
      '/api/tools/vda-4902-label-generator': (body: Record<string, unknown>) => {
        if (body.action === 'spec') return { success: true, data: { fields: [], limitations: [] } };
        return envelope({ tool: 'vda-4902-label-generator' });
      },
    });
    renderPage(<Vda4902LabelPage />);

    fireEvent.change(screen.getByLabelText(/Label size/i), { target: { value: 'klt' } });
    fireEvent.click(screen.getByRole('button', { name: /generate label/i }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((entry) => JSON.parse(String((entry[1] as RequestInit).body ?? '{}')).action === 'preview');
      expect(call).toBeTruthy();
      const sent = JSON.parse(String((call?.[1] as RequestInit).body)) as { data: { format: string } };
      expect(sent.data.format).toBe('klt');
    });
  });
});

describe('Shipping Label Generator page', () => {
  it('renders the carrier notice from the response rather than a hard-coded reassurance', async () => {
    const notice = 'This is a carrier-neutral label. It does not carry carrier artwork or a carrier-issued tracking number.';
    stubApi({
      '/api/tools/shipping-label-generator': (body: Record<string, unknown>) => {
        if (body.action === 'templates') {
          return { success: true, data: { templates: [{ id: 'thermal-100x150', name: 'Thermal parcel — 100 × 150 mm', sizeMm: { width: 100, height: 150 }, blurb: 'Courier-style parcel label.', description: '', codes: ['code128', 'qrcode'] }], defaultTemplate: 'thermal-100x150' } };
        }
        const base = envelope({ tool: 'shipping-label-generator' });
        return { ...base, data: { ...base.data, meta: { ...base.data.meta, carrierNotice: notice } } };
      },
    });
    renderPage(<ShippingLabelGeneratorPage />);

    fireEvent.click(await screen.findByRole('button', { name: /generate label/i }));
    await waitFor(() => expect(screen.getByText(notice)).toBeTruthy());
  });

  it('keeps the reference and the tracking number as separate inputs', async () => {
    stubApi({
      '/api/tools/shipping-label-generator': (body: Record<string, unknown>) =>
        body.action === 'templates' ? { success: true, data: { templates: [] } } : envelope({ tool: 'shipping-label-generator' }),
    });
    renderPage(<ShippingLabelGeneratorPage />);

    expect(screen.getByLabelText(/Your reference/i)).toBeTruthy();
    expect(screen.getByLabelText(/Tracking number \(optional\)/i)).toBeTruthy();
    // A tracking number is the carrier's to issue; the page must not imply otherwise.
    expect(screen.getByText(/Only a number your carrier actually issued/i)).toBeTruthy();
  });
});

describe('QR Business Card page', () => {
  it('shows the exact encoded vCard and blocks the card when the server reports an error', async () => {
    const payload = 'BEGIN:VCARD\nVERSION:3.0\nFN:Ada Obi\nTEL:+2348000000000\nEND:VCARD';
    stubApi({
      '/api/tools/qr-business-card-designer': (body: Record<string, unknown>) => {
        if (body.action === 'templates') return { success: true, data: { templates: [], fields: [] } };
        if (body.action === 'payload') return { success: true, data: { payload, issues: [] } };
        const base = envelope({ tool: 'qr-business-card-designer' });
        return { ...base, data: { ...base.data, blocked: true, issues: [{ level: 'error', field: 'email', message: 'Email is not a valid address.' }] } };
      },
    });
    renderPage(<QrBusinessCardPage />);

    await waitFor(() => expect(screen.getByText(/BEGIN:VCARD/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /generate card/i }));

    await waitFor(() => expect(screen.getByText(/Email is not a valid address/i)).toBeTruthy());
    const pdf = screen.getByRole('button', { name: /download pdf/i }) as HTMLButtonElement;
    expect(pdf.disabled).toBe(true);
    expect(screen.getByText(/Export is disabled while an error is listed/i)).toBeTruthy();
  });

  it('refuses an SVG logo in the browser before it can reach the document', async () => {
    stubApi({
      '/api/tools/qr-business-card-designer': (body: Record<string, unknown>) =>
        body.action === 'templates' ? { success: true, data: { templates: [], fields: [] } } : body.action === 'payload' ? { success: true, data: { payload: '' } } : envelope(),
    });
    renderPage(<QrBusinessCardPage />);

    const file = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'logo.svg', { type: 'image/svg+xml' });
    fireEvent.change(screen.getByLabelText(/Logo/i), { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText(/An SVG logo is refused/i)).toBeTruthy());
  });
});

/**
 * Every studio page that produces a layout offers to keep it.
 *
 * This is a wiring test, and it is worth having as one: the panel is a single component passed into
 * `StudioFrame` from four different pages, and the way it silently disappears is a page forgetting the
 * `extra` prop — no error, no failing assertion elsewhere, just a studio with no way to save. The
 * signed-out branch is used deliberately, so the assertion needs no API stub beyond the page's own
 * listing call and cannot pass by accident on a page that only renders signed in.
 */
describe('saved templates are reachable from every studio that makes a layout', () => {
  const pages: Array<[string, JSX.Element, string]> = [
    ['label designer', <LabelDesignerPage />, '/api/tools/label-designer'],
    ['shipping label generator', <ShippingLabelGeneratorPage />, '/api/tools/shipping-label-generator'],
    ['VDA 4902 label generator', <Vda4902LabelPage />, '/api/tools/vda-4902-label-generator'],
    ['QR business card designer', <QrBusinessCardPage />, '/api/tools/qr-business-card-designer'],
  ];

  for (const [name, page, path] of pages) {
    it(`offers saved templates on the ${name}`, async () => {
      localStorage.clear();
      stubApi({ [path]: { success: true, data: { templates: [], fields: [] } } });
      renderPage(page);
      await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: /saved templates/i })).toBeTruthy());
      // Signed out: it explains rather than offering a save that can only fail.
      expect(screen.getByText(/needs an account/i)).toBeTruthy();
      expect(screen.queryByRole('button', { name: /save this template/i })).toBeNull();
    });
  }
});
