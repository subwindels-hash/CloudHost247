// @vitest-environment jsdom
/**
 * The Design Studio pages: Barcode Generator, Online Label Printing, VDA 4902 labels, Shipping
 * Labels and QR Code Business Cards.
 *
 * The API double below is the real thing in miniature: a POST to /api/tools/<slug> is answered by
 * the handler the server registers for that slug, wrapped in the envelope the server sends. So what
 * the page builds from its form is what the handler actually reads, and what the page shows is what
 * the handler actually returned. A hand-written response would only prove the page agrees with the
 * test.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import DesignStudioPage from '../../src/pages/tools/DesignStudioPage';
import ToolPage from '../../src/pages/ToolPage';
import StudioResult, { isStudioResult, type StudioResultView } from '../../src/components/tools/StudioResult';
import { buildToolInput, toolForm } from '../../src/lib/tools-api';
import { TOOL_CATALOG } from '../../../src/tools/catalog';
import { ToolError } from '../../../src/tools/core/errors';
import { handlerFor } from '../../../src/tools/handlers';
import { STUDIO_TOOL_SLUGS, type StudioSlug } from '../../../src/tools/design-studio/definitions';
import { STUDIO_FORMS, buildStudioInput, studioDefaults, studioExample, studioFields, visibleStudioFields } from '../../../src/tools/design-studio/forms';

const catalog = { success: true, categories: [], tools: TOOL_CATALOG.map((tool) => ({ ...tool, notes: tool.notes ?? [], status: 'ACTIVE', statusMessage: null })), count: TOOL_CATALOG.length, masterEnabled: true, anonymousAccess: true };

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

/** Answers the catalogue, and runs the registered handler for a tool the way the server does. */
function serveTools(): { fetch: Mock; calls: Call[]; runs: () => Call[]; results: StudioResultView[] } {
  const calls: Call[] = [];
  const results: StudioResultView[] = [];
  const respond = (status: number, value: unknown) => ({ ok: status >= 200 && status < 300, status, statusText: '', headers: new Headers({ 'content-type': 'application/json' }), text: async () => JSON.stringify(value) });
  const fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const path = String(url);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ method, path, body });
    if (method === 'GET' && path.startsWith('/api/tools/catalog')) return respond(200, catalog);
    const match = /^\/api\/tools\/([a-z0-9-]+)$/.exec(path);
    const slug = match?.[1];
    const handler = slug ? handlerFor(slug) : undefined;
    if (method !== 'POST' || !slug || !handler) return respond(404, { success: false, code: 'NOT_FOUND', message: `Nothing answers ${method} ${path}.` });
    try {
      const data = (await handler(body ?? {}, {} as never)) as StudioResultView;
      results.push(data);
      // The envelope of src/tools/core/executor.ts, field for field.
      return respond(200, { success: true, tool: slug, status: 'ACTIVE', generatedAt: '2026-11-11T00:00:00.000Z', data, meta: { durationMs: 1, cached: false, sources: [], warnings: [] } });
    } catch (error) {
      if (error instanceof ToolError) return respond(error.statusCode, { success: false, code: error.code, message: error.message, retryable: false, tool: slug });
      throw error;
    }
  });
  return { fetch, calls, runs: () => calls.filter((call) => call.method === 'POST'), results };
}

function renderStudio(slug: StudioSlug) {
  return render(
    <MemoryRouter initialEntries={[`/tools/${slug}`]}>
      <DesignStudioPage slug={slug} />
    </MemoryRouter>
  );
}

const nameOf = (slug: string): string => TOOL_CATALOG.find((tool) => tool.slug === slug)?.name ?? slug;

/**
 * The picker a chooser field renders: a radio group named by the field, holding every choice the
 * shared form offers. These helpers are how a visitor changes the barcode type or the template.
 */
function picker(label: string, root: HTMLElement = document.body): HTMLElement {
  return within(root).getByRole('group', { name: label });
}

function chooseType(label: string, value: string): void {
  const input = picker(label).querySelector<HTMLInputElement>(`input[value="${value}"]`);
  if (!input) throw new Error(`${label} has no ${value} choice.`);
  fireEvent.click(input);
}

/** The one action that produces the artwork, in the form itself. */
function submitButton(slug: StudioSlug): HTMLElement {
  const form = document.querySelector('.studio-form');
  if (!form) throw new Error('The form is not on screen.');
  return within(form as HTMLElement).getByRole('button', { name: STUDIO_FORMS[slug].submitLabel });
}

/** The value the picker currently holds, read from the checked radio. */
function pickedType(label: string): string | null {
  const checked = within(picker(label)).getAllByRole('radio', { checked: true })[0] as HTMLInputElement | undefined;
  return checked?.value ?? null;
}

/** What a browser would have saved: the anchor's file name and the Blob behind its address. */
const saved: Array<{ name: string; target: string; blob: Blob | undefined }> = [];
const blobs = new Map<string, Blob>();

beforeEach(() => {
  saved.length = 0;
  blobs.clear();
  let next = 0;
  // jsdom implements neither of these.
  URL.createObjectURL = vi.fn((blob: Blob) => {
    next += 1;
    const address = `blob:test/${next}`;
    blobs.set(address, blob);
    return address;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
    saved.push({ name: this.download, target: this.target, blob: blobs.get(this.getAttribute('href') ?? '') });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

async function bytesOf(blob: Blob | undefined): Promise<Uint8Array> {
  if (!blob) throw new Error('Nothing was saved.');
  return new Uint8Array(await blob.arrayBuffer());
}

describe.each(STUDIO_TOOL_SLUGS.map((slug) => ({ slug })))('$slug page', ({ slug }) => {
  const form = STUDIO_FORMS[slug];

  it('shows a labelled form, asks the server for nothing until told to, and then shows what the server drew', async () => {
    const api = serveTools();
    vi.stubGlobal('fetch', api.fetch);
    const { container } = renderStudio(slug);

    // The heading is the catalogue name, once the catalogue has loaded.
    await screen.findByRole('heading', { level: 1, name: nameOf(slug) });

    // The five tools are one click apart, and the current one is marked.
    const switcher = screen.getByRole('navigation', { name: 'Barcode and label tools' });
    const links = within(switcher).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(STUDIO_TOOL_SLUGS.map((entry) => `/tools/${entry}`));
    expect(links.map((link) => link.textContent)).toEqual(STUDIO_TOOL_SLUGS.map(nameOf));
    expect(links.filter((link) => link.getAttribute('aria-current') === 'page').map((link) => link.getAttribute('href'))).toEqual([`/tools/${slug}`]);

    // Every field on screen is reachable by its label, and is the field the shared form describes.
    const start = studioDefaults(form);
    const visible = form.sections.flatMap((section) => visibleStudioFields(form, section, start));
    expect(visible.length).toBeGreaterThan(3);
    for (const field of visible) {
      if (field.chooser) {
        // A picker, not a dropdown: every choice the shared form offers is a radio button.
        const group = picker(field.label, container);
        expect(within(group).getAllByRole('radio'), field.name).toHaveLength(field.options?.length ?? 0);
        continue;
      }
      const control = container.querySelector(`#studio-${slug}-${field.name}`);
      expect(control, field.name).not.toBeNull();
      expect(container.querySelector(`label[for="studio-${slug}-${field.name}"]`)?.textContent, field.name).toContain(field.label);
    }
    // Fields the current choices do not use are not rendered at all.
    const hidden = studioFields(form).filter((field) => !visible.some((entry) => entry.name === field.name));
    for (const field of hidden) expect(container.querySelector(`#studio-${slug}-${field.name}`), field.name).toBeNull();

    // Loading the page is not a tool run: only the catalogue was requested.
    expect(api.runs()).toEqual([]);
    expect(screen.getByText(/will appear here with the download buttons/)).toBeTruthy();
    expect(screen.getByText('Processed on our server to draw the artwork, then discarded. Nothing you enter is stored.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Show me an example' }));

    // One request, carrying exactly the example the shared form defines.
    await waitFor(() => expect(api.results).toHaveLength(1));
    expect(api.runs()).toEqual([{ method: 'POST', path: `/api/tools/${slug}`, body: JSON.parse(JSON.stringify(buildStudioInput(form, studioExample(form, start)))) }]);
    const result = api.results[0] as StudioResultView;
    expect(isStudioResult(result)).toBe(true);

    // The previews are the server's drawings, shown as images.
    const images = await waitFor(() => {
      const found = Array.from(container.querySelectorAll<HTMLImageElement>('.studio-preview img'));
      expect(found).toHaveLength(result.previews.length);
      return found;
    });
    expect(result.previews.length).toBeGreaterThan(0);
    images.forEach((image, index) => {
      const preview = result.previews[index];
      expect(image.getAttribute('src')).toBe(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(preview?.svg ?? '')}`);
      expect(image.getAttribute('alt')).toContain(preview?.title ?? '');
    });
    // No part of a drawing is injected into the page as markup.
    expect(container.querySelector('.studio-result svg')).toBeNull();

    // Every file the server returned has a button, the PDF first among them.
    const downloads = within(screen.getByRole('region', { name: 'Downloads' }));
    for (const file of result.files) expect(downloads.getByRole('button', { name: file.label }), file.label).toBeTruthy();
    expect(result.files.some((file) => file.mime === 'application/pdf')).toBe(true);

    // The facts and the notices are the server's, word for word and in order.
    const facts = Array.from(container.querySelectorAll('.studio-facts > div')).map((row) => ({ label: row.querySelector('dt')?.textContent, value: row.querySelector('dd')?.textContent }));
    expect(facts).toEqual(result.facts);
    const notices = Array.from(within(screen.getByRole('region', { name: 'Before you print' })).getAllByRole('listitem')).map((item) => item.textContent);
    expect(notices).toEqual(result.notices);

    // The form now holds the example, so what is on screen is what was drawn.
    const example = studioExample(form, start);
    for (const field of form.sections.flatMap((section) => visibleStudioFields(form, section, example))) {
      if (field.chooser) {
        expect(pickedType(field.label), field.name).toBe(String(example[field.name] ?? ''));
        continue;
      }
      const control = container.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`#studio-${slug}-${field.name}`);
      if (!control) throw new Error(`${field.name} is not on screen.`);
      if (field.type === 'checkbox') expect((control as HTMLInputElement).checked, field.name).toBe(example[field.name] === true);
      else expect(control.value, field.name).toBe(String(example[field.name] ?? ''));
    }

    // The browser remembers which tool was used, and nothing that was entered.
    expect(localStorage.getItem('ch247_recent_tools')).toBe(JSON.stringify([slug]));
    expect(Object.keys(localStorage)).toEqual(['ch247_recent_tools']);
  });

  it('saves the print file the server returned, under a plain file name', async () => {
    const api = serveTools();
    vi.stubGlobal('fetch', api.fetch);
    renderStudio(slug);
    await screen.findByRole('heading', { level: 1, name: nameOf(slug) });
    fireEvent.click(screen.getByRole('button', { name: 'Show me an example' }));
    await waitFor(() => expect(api.results).toHaveLength(1));
    const result = api.results[0] as StudioResultView;
    const pdf = result.files.find((file) => file.mime === 'application/pdf');
    if (!pdf) throw new Error('The example returned no PDF.');

    fireEvent.click(await screen.findByRole('button', { name: pdf.label }));
    expect(saved).toHaveLength(1);
    expect(saved[0]?.name).toBe(pdf.name);
    expect(saved[0]?.name).toMatch(/^[A-Za-z0-9._-]+\.pdf$/);
    expect(saved[0]?.blob?.type).toBe('application/pdf');
    const bytes = await bytesOf(saved[0]?.blob);
    // The very bytes the server sent: a PDF, of the size it declared.
    expect(bytes.length).toBe(pdf.bytes);
    expect(Buffer.from(bytes).toString('base64')).toBe(pdf.base64);
    expect(new TextDecoder('latin1').decode(bytes.slice(0, 5))).toBe('%PDF-');

    // "Open to print" opens the same file in a new tab instead of saving it.
    fireEvent.click(screen.getByRole('button', { name: 'Open to print' }));
    expect(saved).toHaveLength(2);
    expect(saved[1]).toMatchObject({ name: '', target: '_blank' });
    expect((await bytesOf(saved[1]?.blob)).length).toBe(pdf.bytes);

    // A picture of the preview is offered only where the server did not already return a PNG.
    const serverPng = result.files.some((file) => file.mime === 'image/png' || file.mime === 'application/zip');
    expect(screen.queryByRole('button', { name: 'Save as PNG image (300 dpi)' }) === null).toBe(serverPng);
    // The two tools whose artwork is a single symbol return a pixel-exact PNG themselves.
    expect(serverPng).toBe(slug === 'barcode-generator' || slug === 'qr-code-maker');
  });
});

describe('Design Studio form behaviour', () => {
  it('shows a refusal in the server’s words and keeps what was typed', async () => {
    const api = serveTools();
    vi.stubGlobal('fetch', api.fetch);
    renderStudio('barcode-generator');
    await screen.findByRole('heading', { level: 1, name: 'Barcode Generator' });

    chooseType('Barcode type', 'ean13');
    const data = screen.getByLabelText(/^Data to encode/) as HTMLTextAreaElement;
    fireEvent.change(data, { target: { value: 'NOT-A-NUMBER' } });
    fireEvent.click(submitButton('barcode-generator'));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('That could not be generated.');
    expect(alert.textContent).toContain('That is not valid EAN-13 data. Expected: 12 digits (the check digit is added) or 13 digits including it.');
    // The refusal does not repeat the entry, and the entry is still in the form to correct.
    expect(alert.textContent).not.toContain('NOT-A-NUMBER');
    expect(data.value).toBe('NOT-A-NUMBER');
    expect(api.runs().map((call) => call.body)).toEqual([expect.objectContaining({ symbology: 'ean13', data: 'NOT-A-NUMBER' })]);
    expect(document.querySelector('.studio-preview')).toBeNull();
    // A refused request is not a use of the tool worth remembering.
    expect(localStorage.getItem('ch247_recent_tools')).toBeNull();
    // Nothing next to the refusal offers to replace what was typed with an example.
    expect(screen.queryByRole('button', { name: 'Show me an example' })).toBeNull();

    // Correcting the entry replaces the refusal with the artwork.
    fireEvent.change(data, { target: { value: '952012345678' } });
    fireEvent.click(submitButton('barcode-generator'));
    await waitFor(() => expect(document.querySelector('.studio-preview img')).not.toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('9520123456788 (check digit 8 added)')).toBeTruthy();
  });

  it('never leaves artwork on screen that the form no longer describes', async () => {
    const api = serveTools();
    vi.stubGlobal('fetch', api.fetch);
    renderStudio('barcode-generator');
    await screen.findByRole('heading', { level: 1, name: 'Barcode Generator' });
    const submit = STUDIO_FORMS['barcode-generator'].submitLabel;
    const changed = (): string | null => document.querySelector('.studio-changed')?.textContent ?? null;
    const drawnData = (): string | null | undefined => Array.from(document.querySelectorAll('.studio-facts > div')).find((row) => row.querySelector('dt')?.textContent === 'Your data')?.querySelector('dd')?.textContent;

    const data = screen.getByLabelText(/^Data to encode/) as HTMLTextAreaElement;
    fireEvent.change(data, { target: { value: 'FIRST-0001' } });
    fireEvent.click(submitButton('barcode-generator'));
    await waitFor(() => expect(drawnData()).toBe('FIRST-0001'));
    // Freshly drawn: the artwork is what the form says.
    expect(changed()).toBeNull();

    // An edit that has not been sent: the old artwork stays, and is marked as older than the form.
    fireEvent.change(data, { target: { value: 'SECOND-0002' } });
    expect(changed()).toBe(`You have changed the details since this was drawn. Press ${submit} to update the preview and the files.`);
    expect(drawnData()).toBe('FIRST-0001');
    expect(api.runs()).toHaveLength(1);
    // Putting the entry back makes the artwork current again; nothing was sent to find that out.
    fireEvent.change(data, { target: { value: 'FIRST-0001' } });
    expect(changed()).toBeNull();
    expect(api.runs()).toHaveLength(1);

    // Sending the edit replaces the artwork and removes the mark.
    fireEvent.change(data, { target: { value: 'SECOND-0002' } });
    fireEvent.click(submitButton('barcode-generator'));
    await waitFor(() => expect(drawnData()).toBe('SECOND-0002'));
    expect(changed()).toBeNull();

    // An edit the server refuses: the earlier artwork and its files go, so the PDF of
    // SECOND-0002 cannot be saved under a message about a different entry.
    chooseType('Barcode type', 'ean13');
    expect(changed()).not.toBeNull();
    fireEvent.click(submitButton('barcode-generator'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('That is not valid EAN-13 data.');
    expect(document.querySelector('.studio-preview')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Downloads' })).toBeNull();
    expect(changed()).toBeNull();
    expect(data.value).toBe('SECOND-0002');
  });

  it('removes the artwork when the request does not reach the server', async () => {
    const api = serveTools();
    let online = true;
    const fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (!online && (init?.method ?? 'GET') === 'POST') throw new TypeError('Failed to fetch');
      return api.fetch(url, init);
    });
    vi.stubGlobal('fetch', fetch);
    renderStudio('label-designer');
    await screen.findByRole('heading', { level: 1, name: 'Online Label Printing' });
    fireEvent.click(screen.getByRole('button', { name: 'Show me an example' }));
    await waitFor(() => expect(document.querySelector('.studio-preview img')).not.toBeNull());

    online = false;
    fireEvent.change(document.querySelector('#studio-label-designer-code') as HTMLInputElement, { target: { value: 'CH-000999' } });
    fireEvent.click(submitButton('label-designer'));
    const alert = await screen.findByRole('alert');
    // In plain words, not the browser's "Failed to fetch".
    expect(alert.textContent).toBe('That could not be generated.The request did not reach our server. Check your connection and try again.');
    expect(document.querySelector('.studio-preview')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Downloads' })).toBeNull();
    // What was typed is kept, and the button works again once the connection is back.
    expect((document.querySelector('#studio-label-designer-code') as HTMLInputElement).value).toBe('CH-000999');
    online = true;
    fireEvent.click(submitButton('label-designer'));
    await waitFor(() => expect(document.querySelector('.studio-preview img')).not.toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(api.runs().map((call) => call.body?.code)).toEqual(['CH-000123', 'CH-000999']);
  });

  it('follows the barcode type: its options appear, the others go, and only what is on screen is sent', async () => {
    const api = serveTools();
    vi.stubGlobal('fetch', api.fetch);
    const { container } = renderStudio('barcode-generator');
    await screen.findByRole('heading', { level: 1, name: 'Barcode Generator' });
    const has = (name: string): boolean => container.querySelector(`#studio-barcode-generator-${name}`) !== null;

    // Code 128 is a linear code: a bar height, no error correction level.
    expect(has('barHeightMm')).toBe(true);
    expect(has('eclevel')).toBe(false);

    chooseType('Barcode type', 'qrcode');
    expect(has('barHeightMm')).toBe(false);
    expect(has('eclevel')).toBe(true);

    fireEvent.change(screen.getByLabelText(/^Data to encode/), { target: { value: 'https://cloudhost247.com' } });
    fireEvent.change(container.querySelector('#studio-barcode-generator-eclevel') as HTMLSelectElement, { target: { value: 'H' } });
    fireEvent.click(submitButton('barcode-generator'));
    await waitFor(() => expect(api.results).toHaveLength(1));
    const sent = api.runs()[0]?.body ?? {};
    expect(sent).toMatchObject({ symbology: 'qrcode', data: 'https://cloudhost247.com', eclevel: 'H' });
    expect(sent).not.toHaveProperty('barHeightMm');
    const facts = Array.from(container.querySelectorAll('.studio-facts > div')).map((row) => `${row.querySelector('dt')?.textContent}: ${row.querySelector('dd')?.textContent}`);
    expect(facts).toContain('Barcode type: QR Code');
    expect(facts).toContain('Your data: https://cloudhost247.com');
  });

  it('follows the label template: its fields and example replace the previous ones, typed text stays', async () => {
    const api = serveTools();
    vi.stubGlobal('fetch', api.fetch);
    const { container } = renderStudio('label-designer');
    await screen.findByRole('heading', { level: 1, name: 'Online Label Printing' });
    const field = (name: string) => container.querySelector<HTMLInputElement | HTMLSelectElement>(`#studio-label-designer-${name}`);

    fireEvent.click(screen.getByRole('button', { name: 'Fill with an example' }));
    await waitFor(() => expect(api.results).toHaveLength(1));
    expect(field('code')?.value).toBe('CH-000123');
    expect(field('symbology')?.value).toBe('code128');
    expect(field('name')).toBeNull();

    // The product label has a name and a price, takes a retail barcode, and brings its own example.
    chooseType('Template', 'product-label');
    expect(field('name')?.value).toBe('Arabica Coffee Beans');
    expect(field('price')?.value).toBe('NGN 4,500');
    expect(field('code')?.value).toBe('9520123456788');
    expect(field('symbology')?.value).toBe('ean13');
    expect(field('heading')).toBeNull();
    // Changing a choice does not run the tool; the visitor does.
    expect(api.runs()).toHaveLength(1);

    // Once the visitor has typed something, a further change of template leaves it alone.
    fireEvent.change(field('code') as HTMLInputElement, { target: { value: 'MY-OWN-7' } });
    chooseType('Template', 'shelf-label');
    expect(field('code')?.value).toBe('MY-OWN-7');

    // "Clear" empties what was typed and keeps the choices that shape the form.
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(field('code')?.value).toBe('');
    expect(pickedType('Template')).toBe('shelf-label');
    expect(container.querySelector('.studio-preview')).toBeNull();
  });

  it('says so when the catalogue cannot be loaded, and still lets the tool run', async () => {
    const api = serveTools();
    const fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).startsWith('/api/tools/catalog')) {
        return { ok: false, status: 503, statusText: '', headers: new Headers({ 'content-type': 'application/json' }), text: async () => JSON.stringify({ code: 'SERVICE_UNAVAILABLE', message: 'The catalogue is not available.' }) };
      }
      return api.fetch(url, init);
    });
    vi.stubGlobal('fetch', fetch);
    renderStudio('qr-business-card-designer');
    // Without the catalogue the page falls back to the name the shared form carries.
    await screen.findByRole('heading', { level: 1, name: STUDIO_FORMS['qr-business-card-designer'].shortName });
    expect((await screen.findByRole('status')).textContent).toContain('The tool catalogue could not be loaded (The catalogue is not available.). You can still try the tool.');
    fireEvent.click(screen.getByRole('button', { name: 'Show me an example' }));
    await waitFor(() => expect(document.querySelector('.studio-preview img')).not.toBeNull());
  });

  it('does not offer a tool an administrator has switched off', async () => {
    const api = serveTools();
    const disabled = { ...catalog, tools: catalog.tools.map((tool) => (tool.slug === 'shipping-label-generator' ? { ...tool, status: 'DISABLED', statusMessage: 'Shipping labels are switched off for maintenance.' } : tool)) };
    const fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).startsWith('/api/tools/catalog')) return { ok: true, status: 200, statusText: '', headers: new Headers({ 'content-type': 'application/json' }), text: async () => JSON.stringify(disabled) };
      return api.fetch(url, init);
    });
    vi.stubGlobal('fetch', fetch);
    renderStudio('shipping-label-generator');
    await screen.findByText('Shipping labels are switched off for maintenance.');
    expect((submitButton('shipping-label-generator') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Show me an example' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Fill with an example' }));
    expect(api.runs()).toEqual([]);
  });
});

describe('StudioResult', () => {
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="50mm" height="20mm" viewBox="0 0 50 20"><rect width="50" height="20" fill="#fff"/></svg>';
  const base: StudioResultView = {
    studio: true,
    title: 'Sample',
    previews: [{ title: 'Label', svg: SVG, widthMm: 50, heightMm: 20 }],
    files: [{ name: 'sample.pdf', mime: 'application/pdf', base64: Buffer.from('%PDF-1.6 sample').toString('base64'), bytes: 15, label: 'Download PDF', hint: 'The print file.' }],
    facts: [{ label: 'Size', value: '50 × 20 mm' }],
    notices: ['Print at 100%.'],
    count: 1,
  };

  it('recognises a studio result by its shape, and nothing else', () => {
    expect(isStudioResult(base)).toBe(true);
    expect(isStudioResult({ ...base, studio: false })).toBe(false);
    expect(isStudioResult({ studio: true })).toBe(false);
    expect(isStudioResult({ ...base, files: 'none' })).toBe(false);
    expect(isStudioResult(null)).toBe(false);
    expect(isStudioResult('studio')).toBe(false);
  });

  it('draws previews as images only, so a drawing cannot carry script into the page', () => {
    const hostile = '<svg xmlns="http://www.w3.org/2000/svg" onload="window.__studio_ran = 1"><script>window.__studio_ran = 2</script></svg>';
    const { container } = render(
      <StudioResult
        value={{
          ...base,
          previews: [
            { title: 'Label', svg: hostile, widthMm: 50, heightMm: 20 },
            // Not SVG at all, and one with no size: neither is shown.
            { title: 'Markup', svg: '<img src=x onerror="window.__studio_ran = 3">', widthMm: 50, heightMm: 20 },
            { title: 'Sizeless', svg: SVG, widthMm: 0, heightMm: 20 },
          ],
        }}
      />
    );
    const images = container.querySelectorAll('.studio-preview img');
    expect(images).toHaveLength(1);
    expect(images[0]?.getAttribute('src')).toBe(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(hostile)}`);
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect((window as unknown as { __studio_ran?: number }).__studio_ran).toBeUndefined();
    // The caption states the size the artwork prints at, and nothing about how large it looks here.
    expect(container.querySelector('figcaption')?.textContent).toBe('LabelActual size 50 × 20 mm');
    // The picture carries the artwork's proportions, which the stylesheet sizes its box from.
    expect((images[0] as HTMLImageElement).style.getPropertyValue('--studio-ratio')).toBe('2.5');
  });

  it('offers only file types it knows, and never saves under a path', async () => {
    render(
      <StudioResult
        value={{
          ...base,
          files: [
            { name: '../../etc/passwd.pdf', mime: 'application/pdf', base64: Buffer.from('%PDF-1.6 a').toString('base64'), bytes: 10, label: 'Download PDF' },
            { name: 'page.html', mime: 'text/html', base64: Buffer.from('<script>1</script>').toString('base64'), bytes: 18, label: 'Download page' },
            { name: 'run.js', mime: 'application/javascript', base64: Buffer.from('alert(1)').toString('base64'), bytes: 8, label: 'Download script' },
            { name: 'broken.svg', mime: 'image/svg+xml', base64: 'not base64 !!', bytes: 1, label: 'Download broken SVG' },
            { name: 'card.vcf', mime: 'text/vcard', base64: Buffer.from('BEGIN:VCARD\r\nEND:VCARD').toString('base64'), bytes: 22, label: 'Download contact' },
          ],
        }}
      />
    );
    const downloads = within(screen.getByRole('region', { name: 'Downloads' }));
    expect(downloads.queryByRole('button', { name: 'Download page' })).toBeNull();
    expect(downloads.queryByRole('button', { name: 'Download script' })).toBeNull();
    expect(downloads.queryByRole('button', { name: 'Download broken SVG' })).toBeNull();

    fireEvent.click(downloads.getByRole('button', { name: 'Download PDF' }));
    fireEvent.click(downloads.getByRole('button', { name: 'Download contact' }));
    expect(saved.map((entry) => entry.name)).toEqual(['etc-passwd.pdf', 'card.vcf']);
    expect(saved.map((entry) => entry.blob?.type)).toEqual(['application/pdf', 'text/vcard']);
    expect(new TextDecoder().decode(await bytesOf(saved[1]?.blob))).toBe('BEGIN:VCARD\r\nEND:VCARD');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says so, and leaves the other downloads alone, when the browser cannot make the PNG', async () => {
    // jsdom cannot decode an image or draw on a canvas: the same position as a browser that refuses.
    render(<StudioResult value={base} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save as PNG image (300 dpi)' }));
    expect((await screen.findByRole('alert')).textContent).toBe('This browser could not create the PNG. The SVG and PDF downloads are unaffected.');
    expect(saved).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    expect(saved.map((entry) => entry.name)).toEqual(['sample.pdf']);
    // A successful download clears the earlier message.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows nothing it was not given', () => {
    const { container } = render(<StudioResult value={{ ...base, previews: [], files: [], facts: [], notices: [] }} />);
    expect(container.querySelector('.studio-result')?.children).toHaveLength(0);
  });
});

describe('the general tool page, as the embedded build uses it', () => {
  function renderGeneral(slug: string) {
    return render(
      <MemoryRouter initialEntries={[`/tools/${slug}`]}>
        <ToolPage />
      </MemoryRouter>
    );
  }

  it.each(STUDIO_TOOL_SLUGS.map((slug) => ({ slug })))('$slug: describes the tool by the shared form, and shows its result as artwork, not JSON', async ({ slug }) => {
    const api = serveTools();
    vi.stubGlobal('fetch', api.fetch);
    const form = STUDIO_FORMS[slug];

    // The general page's description of the tool is the shared form, flattened: same names, same order.
    expect(toolForm(slug).fields.map((field) => field.name)).toEqual(studioFields(form).map((field) => field.name));
    // Its input builder, given the example as a form holds it, produces a request the tool accepts.
    const example = studioExample(form, studioDefaults(form));
    const input = buildToolInput(slug, example);
    const handler = handlerFor(slug);
    if (!handler) throw new Error(`No handler for ${slug}.`);
    const direct = (await handler(input, {} as never)) as StudioResultView;
    expect(isStudioResult(direct)).toBe(true);
    expect(direct.files.some((file) => file.mime === 'application/pdf')).toBe(true);

    const { container } = renderGeneral(slug);
    await screen.findByRole('heading', { level: 1, name: nameOf(slug) });
    // These tools are never cached, so no button offers to bypass a cache.
    expect(screen.queryByRole('button', { name: 'Run without cache' })).toBeNull();
    expect(screen.queryByText('Can I rely on a cached result?')).toBeNull();

    // Send the example through the page's own request editor.
    fireEvent.click(screen.getByLabelText('Advanced JSON input'));
    fireEvent.change(screen.getByLabelText('Request body'), { target: { value: JSON.stringify(input) } });
    fireEvent.click(screen.getByRole('button', { name: 'Run tool' }));
    await waitFor(() => expect(api.results).toHaveLength(1));
    expect(api.runs()).toEqual([{ method: 'POST', path: `/api/tools/${slug}`, body: JSON.parse(JSON.stringify(input)) }]);

    await waitFor(() => expect(container.querySelector('.studio-preview img')).not.toBeNull());
    const result = api.results[0] as StudioResultView;
    const pdf = result.files.find((file) => file.mime === 'application/pdf');
    if (!pdf) throw new Error('The example returned no PDF.');
    expect(screen.getByRole('button', { name: pdf.label })).toBeTruthy();
    // The response is mostly base64: it is not printed on the page, and nothing offers to keep
    // it as JSON, print the web page in place of the PDF, or copy it into a report or a ticket.
    expect(container.textContent).not.toContain(pdf.base64.slice(0, 60));
    for (const name of [/Download JSON/, /Print \/ PDF/, /report/i, /ticket/i]) expect(screen.queryByRole('button', { name }), String(name)).toBeNull();

    // The PDF saved from this page is the server's too.
    fireEvent.click(screen.getByRole('button', { name: pdf.label }));
    expect(saved.map((entry) => entry.name)).toEqual([pdf.name]);
    expect((await bytesOf(saved[0]?.blob)).length).toBe(pdf.bytes);
  });

  it('runs the barcode generator from its fields, with the defaults the shared form sets', async () => {
    const api = serveTools();
    vi.stubGlobal('fetch', api.fetch);
    const { container } = renderGeneral('barcode-generator');
    await screen.findByRole('heading', { level: 1, name: 'Barcode Generator' });

    fireEvent.change(screen.getByLabelText(/^Data to encode/), { target: { value: 'CH247-000123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run tool' }));
    await waitFor(() => expect(api.results).toHaveLength(1));
    expect(api.runs()[0]?.body).toMatchObject({ symbology: 'code128', data: 'CH247-000123' });
    await waitFor(() => expect(container.querySelector('.studio-preview img')).not.toBeNull());
    const facts = Array.from(container.querySelectorAll('.studio-facts > div')).map((row) => `${row.querySelector('dt')?.textContent}: ${row.querySelector('dd')?.textContent}`);
    expect(facts).toContain('Barcode type: Code 128');
    expect(facts).toContain('Size: 54.45 × 24.26 mm including the quiet zone');
  });

  it('keeps the cache control on tools that are cached', async () => {
    const api = serveTools();
    vi.stubGlobal('fetch', api.fetch);
    renderGeneral('qr-generator');
    await screen.findByRole('heading', { level: 1, name: nameOf('qr-generator') });
    expect(screen.getByRole('button', { name: 'Run without cache' })).toBeTruthy();
  });
});
