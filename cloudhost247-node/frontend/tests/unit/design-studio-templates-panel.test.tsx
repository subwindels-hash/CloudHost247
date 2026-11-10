// @vitest-environment jsdom
/**
 * Saved templates — the panel and its client.
 *
 * Saving is the only part of Design Studio that persists anything, so the tests here are about the
 * three ways a persistence UI can be dishonest:
 *
 *  1. offering "Save" to someone who cannot save, so the only outcome is a 401;
 *  2. replacing the server's message ("you already have a template called …") with a generic one,
 *     leaving the operator to guess which of two similar templates to edit;
 *  3. deleting without asking, or deleting a *different* template from the one named.
 *
 * The API itself is covered by `tests/integration/design-studio-templates.test.ts`; this file stubs
 * `fetch`, so what it verifies is what the browser puts on the wire and what it shows afterwards.
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import SavedTemplatesPanel from '../../src/components/design-studio/SavedTemplatesPanel';
import { savedTemplates, signedIn } from '../../src/lib/design-studio-templates';

const TOKEN_KEY = 'ch247_token';

function summary(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tpl-1',
    kind: 'label',
    name: 'Despatch',
    summary: 'address-70x40',
    sourceTemplate: 'address-70x40',
    createdAt: '2026-11-01T09:00:00.000Z',
    updatedAt: '2026-11-08T09:00:00.000Z',
    ...overrides,
  };
}

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}

/** Answers by method + a URL substring; anything unstubbed throws so a surprise request fails. */
function stubApi(routes: Record<string, unknown>) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ url, method, body });
    // Keys read "GET design-studio/templates?kind=label": the verb, then a substring of the URL.
    const key = Object.keys(routes).find((route) => {
      const space = route.indexOf(' ');
      const [verb, match] = [route.slice(0, space), route.slice(space + 1)];
      return verb === method && url.includes(match);
    });
    const payload = key ? routes[key] : undefined;
    if (payload === undefined) throw new Error(`Unstubbed request: ${method} ${url}`);
    const bare = payload as { status?: number; body?: unknown };
    const status = typeof bare.status === 'number' ? bare.status : 200;
    const value = bare.body !== undefined ? bare.body : payload;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => value,
      text: async () => JSON.stringify(value),
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

function renderPanel(props: Partial<React.ComponentProps<typeof SavedTemplatesPanel>> = {}) {
  return render(
    <MemoryRouter>
      <SavedTemplatesPanel kind="label" document={{ templateId: 'address-70x40', values: { recipient: 'Ada' } }} onLoad={() => {}} {...props} />
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.setItem(TOKEN_KEY, 'test-token');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('saved template client', () => {
  it('reports the signed-in state from the stored token, without a request', () => {
    expect(signedIn()).toBe(true);
    localStorage.removeItem(TOKEN_KEY);
    expect(signedIn()).toBe(false);
  });

  it('refuses to call the API anonymously and says why, rather than letting the request become a 401', async () => {
    localStorage.removeItem(TOKEN_KEY);
    const calls = stubApi({});
    const result = await savedTemplates.list('label');
    expect(result.ok).toBe(false);
    expect(result.needsAuth).toBe(true);
    expect(result.error).toMatch(/sign in/i);
    expect(calls).toHaveLength(0);
  });

  it('marks a 401 from a stale token as needing sign-in', async () => {
    stubApi({
      'GET design-studio/templates': { status: 401, body: { success: false, code: 'UNAUTHORIZED', message: 'Your session has expired.' } },
    });
    const result = await savedTemplates.list();
    expect(result.ok).toBe(false);
    expect(result.needsAuth).toBe(true);
    expect(result.error).toContain('session has expired');
  });
});

describe('saved templates panel', () => {
  it('invites a visitor who is not signed in to sign in, instead of offering a save that cannot work', () => {
    localStorage.clear();
    stubApi({});
    renderPanel();
    expect(screen.getByText(/needs an account/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /save this template/i })).toBeNull();
  });

  it('lists only what the studio asked for and shows the saved date', async () => {
    const calls = stubApi({
      'GET design-studio/templates?kind=label': { templates: [summary()], count: 1 },
    });
    renderPanel();
    await waitFor(() => expect(screen.getByText('Despatch')).toBeTruthy());
    expect(calls[0]?.url).toContain('kind=label');
    expect(calls[0]?.url).not.toContain('kind=card');
  });

  it('posts the document the page handed it, verbatim', async () => {
    const document = { templateId: 'address-70x40', values: { recipient: 'Ada' } };
    const calls = stubApi({
      'GET design-studio/templates?kind=label': { templates: [], count: 0 },
      'POST design-studio/templates': { template: { ...summary(), name: 'Ada despatch', document } },
    });
    renderPanel({ document });
    await waitFor(() => expect(screen.getByRole('button', { name: /save this template/i })).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Ada despatch' } });
    fireEvent.click(screen.getByRole('button', { name: /save this template/i }));

    await waitFor(() => expect(screen.getByText(/Saved “Ada despatch”/)).toBeTruthy());
    const post = calls.find((call) => call.method === 'POST');
    expect(post?.body).toMatchObject({ kind: 'label', name: 'Ada despatch', document });
  });

  it('shows the server’s duplicate-name advice verbatim, not a generic failure', async () => {
    stubApi({
      'GET design-studio/templates?kind=label': { templates: [summary()], count: 1 },
      'POST design-studio/templates': {
        status: 422,
        body: { success: false, code: 'VALIDATION_ERROR', message: 'You already have a label template called “Despatch”. Rename this one or update the existing template.' },
      },
    });
    renderPanel();
    await waitFor(() => expect(screen.getByText('Despatch')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /save this template/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Rename this one or update the existing template');
  });

  it('asks before deleting, and names the template it is about to delete', async () => {
    const calls = stubApi({
      'GET design-studio/templates?kind=label': { templates: [summary(), summary({ id: 'tpl-2', name: 'Returns' })], count: 2 },
      'DELETE design-studio/templates/tpl-2': { deleted: true },
    });
    renderPanel();
    await waitFor(() => expect(screen.getByText('Returns')).toBeTruthy());

    fireEvent.click(screen.getAllByRole('button', { name: /^delete$/i })[1] as HTMLElement);
    // Nothing was sent just by asking.
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);

    const confirm = screen.getByRole('button', { name: /delete “Returns”/i });
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.getByText('Template deleted.')).toBeTruthy());
    const deletes = calls.filter((call) => call.method === 'DELETE');
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.url).toContain('/tpl-2');
  });

  it('keeps the template when the operator backs out of the confirmation', async () => {
    const calls = stubApi({
      'GET design-studio/templates?kind=label': { templates: [summary()], count: 1 },
    });
    renderPanel();
    await waitFor(() => expect(screen.getByText('Despatch')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    fireEvent.click(screen.getByRole('button', { name: /keep it/i }));
    expect(screen.queryByRole('button', { name: /delete “Despatch”/i })).toBeNull();
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);
  });

  it('hands a loaded document back to the page that owns the editor', async () => {
    const document = { templateId: 'product-50x30', values: { sku: 'A-1' } };
    const onLoad = vi.fn();
    stubApi({
      'GET design-studio/templates?kind=label': { templates: [summary()], count: 1 },
      'GET design-studio/templates/tpl-1': { template: { ...summary(), document } },
    });
    renderPanel({ onLoad });
    await waitFor(() => expect(screen.getByText('Despatch')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /load/i }));
    await waitFor(() => expect(onLoad).toHaveBeenCalledWith(document));
    expect(screen.getByText(/Loaded “Despatch”/)).toBeTruthy();
  });

  it('refuses a template the page can no longer place, and leaves the editor untouched', async () => {
    // A template saved against a layout this build has dropped. Applying it would print the stored
    // elements on a different layout — a label that looks finished and is wrong.
    const document = { templateId: 'retired-90x60', values: { recipient: 'Ada' } };
    const onLoad = vi.fn();
    stubApi({
      'GET design-studio/templates?kind=label': { templates: [summary()], count: 1 },
      'GET design-studio/templates/tpl-1': { template: { ...summary(), document } },
    });
    renderPanel({
      onLoad,
      validateLoad: (candidate) => (candidate.templateId === 'retired-90x60' ? 'That layout is no longer offered. Nothing was changed.' : null),
    });
    await waitFor(() => expect(screen.getByText('Despatch')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /load/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('no longer offered');
    expect(onLoad).not.toHaveBeenCalled();
    expect(screen.queryByText(/Loaded “Despatch”/)).toBeNull();
  });

  it('says there is nothing to save when the page has not generated a document', async () => {
    stubApi({ 'GET design-studio/templates?kind=label': { templates: [], count: 0 } });
    renderPanel({ document: null });
    const save = await screen.findByRole('button', { name: /save this template/i });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/nothing to save yet/i)).toBeTruthy();
  });
});
