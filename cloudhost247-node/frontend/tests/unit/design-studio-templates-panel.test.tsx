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
    revision: 3,
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
    expect(screen.queryByRole('button', { name: /save as new/i })).toBeNull();
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
    await waitFor(() => expect(screen.getByRole('button', { name: /save as new/i })).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/name for a new template/i), { target: { value: 'Ada despatch' } });
    fireEvent.click(screen.getByRole('button', { name: /save as new/i }));

    await waitFor(() => expect(screen.getByText(/Saved as a new template “Ada despatch”/)).toBeTruthy());
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
    fireEvent.click(screen.getByRole('button', { name: /save as new/i }));

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
    const save = await screen.findByRole('button', { name: /save as new/i });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/nothing to save yet/i)).toBeTruthy();
  });
});

/**
 * The template lifecycle: load → edit → save over, or branch with save-as-new.
 *
 * The assertions are about what reaches the wire, because the guarantees live there. An overwrite that
 * forgets `expectedRevision` still "works" in a single tab and silently discards another tab's save;
 * a rename that sends a document still "works" until the day it is called with a stale one. Both are
 * invisible in a passing happy-path test, so both are asserted on the request body.
 */
describe('saved template lifecycle', () => {
  const loadedDocument = { templateId: 'address-70x40', values: { recipient: 'Ada' } };
  const currentDocument = { templateId: 'address-70x40', values: { recipient: 'Ada Obi' } };

  it('does not offer to save over a template it has not loaded', async () => {
    localStorage.setItem(TOKEN_KEY, 'test-token');
    stubApi({ 'GET design-studio/templates?kind=label': { templates: [summary()], count: 1 } });
    renderPanel();
    await waitFor(() => expect(screen.getByText('Despatch')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /save over/i })).toBeNull();
    expect(screen.getByText(/will not\s+overwrite a template it has not shown you/i)).toBeTruthy();
  });

  it('asks before replacing, naming the template and the version it will become', async () => {
    const calls = stubApi({
      'GET design-studio/templates?kind=label': { templates: [summary()], count: 1 },
      'GET design-studio/templates/tpl-1': { template: { ...summary(), document: loadedDocument } },
    });
    renderPanel();
    await waitFor(() => expect(screen.getByText('Despatch')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^load$/i }));

    const saveOver = await screen.findByRole('button', { name: /save over “Despatch”/i });
    // Loading alone writes nothing.
    expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(0);
    fireEvent.click(saveOver);

    expect(screen.getByText(/Replace the saved contents of/i)).toBeTruthy();
    expect(document.body.textContent).toContain('version 4');
    // Still nothing until the operator confirms.
    expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(0);
  });

  it('sends the loaded revision so a stale tab cannot silently win', async () => {
    const calls = stubApi({
      'GET design-studio/templates?kind=label': { templates: [summary()], count: 1 },
      'GET design-studio/templates/tpl-1': { template: { ...summary(), document: loadedDocument } },
      'PUT design-studio/templates/tpl-1': { template: { ...summary(), revision: 4, document: currentDocument } },
    });
    renderPanel({ document: currentDocument });
    await waitFor(() => expect(screen.getByText('Despatch')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^load$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /save over “Despatch”/i }));
    fireEvent.click(screen.getByRole('button', { name: /replace “Despatch”/i }));

    await waitFor(() => expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(1));
    const put = calls.find((call) => call.method === 'PUT');
    // The id is the loaded one — an overwrite never creates a second template.
    expect(put?.url).toContain('/tpl-1');
    expect(put?.body).toMatchObject({ expectedRevision: 3, document: currentDocument });
    // And the name is not part of an overwrite: renaming is a separate, non-destructive verb.
    expect(put?.body).not.toHaveProperty('name');
  });

  it('says a conflicting overwrite changed nothing, and reloads the list', async () => {
    stubApi({
      'GET design-studio/templates?kind=label': { templates: [summary()], count: 1 },
      'GET design-studio/templates/tpl-1': { template: { ...summary(), document: loadedDocument } },
      'PUT design-studio/templates/tpl-1': {
        status: 409,
        body: { success: false, code: 'CONFLICT', message: '“Despatch” was changed in another tab or device after you loaded it (it is now revision 5; you had 3). Reload it and try again — nothing was overwritten.' },
      },
    });
    renderPanel({ document: currentDocument });
    await waitFor(() => expect(screen.getByText('Despatch')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^load$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /save over “Despatch”/i }));
    fireEvent.click(screen.getByRole('button', { name: /replace “Despatch”/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('nothing was overwritten');
    // The panel is no longer editing the stale copy, so a second click cannot repeat the mistake.
    expect(screen.queryByRole('button', { name: /save over/i })).toBeNull();
  });

  it('renames without sending a document, and says the layout was not changed', async () => {
    const calls = stubApi({
      'GET design-studio/templates?kind=label': { templates: [summary()], count: 1 },
      'PATCH design-studio/templates/tpl-1': { template: { ...summary(), name: 'Despatch 2026' } },
    });
    renderPanel();
    await waitFor(() => expect(screen.getByText('Despatch')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^rename$/i }));

    const input = screen.getByLabelText(/new name for despatch/i);
    fireEvent.change(input, { target: { value: 'Despatch 2026' } });
    fireEvent.click(screen.getByRole('button', { name: /save name/i }));

    await waitFor(() => expect(screen.getByText(/Renamed to “Despatch 2026”/)).toBeTruthy());
    expect(screen.getByText(/Its layout was not changed/i)).toBeTruthy();
    const patch = calls.find((call) => call.method === 'PATCH');
    expect(patch?.url).toContain('/tpl-1');
    // A rename that carried the document would be an overwrite wearing a different verb.
    expect(patch?.body).toEqual({ name: 'Despatch 2026' });
  });

  it('reports a rename collision as advice and leaves the row in edit mode', async () => {
    stubApi({
      'GET design-studio/templates?kind=label': { templates: [summary(), summary({ id: 'tpl-2', name: 'Returns' })], count: 2 },
      'PATCH design-studio/templates/tpl-1': {
        status: 409,
        body: { success: false, code: 'CONFLICT', message: 'You already have a label template called “Returns”. Rename this one or update the existing template.' },
      },
    });
    renderPanel();
    await waitFor(() => expect(screen.getByText('Despatch')).toBeTruthy());
    fireEvent.click(screen.getAllByRole('button', { name: /^rename$/i })[0] as HTMLElement);
    fireEvent.change(screen.getByLabelText(/new name for despatch/i), { target: { value: 'Returns' } });
    fireEvent.click(screen.getByRole('button', { name: /save name/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Rename this one or update the existing template');
    // The edit box is still open with the rejected name, so the operator can correct it rather than retype.
    expect((screen.getByLabelText(/new name for despatch/i) as HTMLInputElement).value).toBe('Returns');
  });

  it('keeps saving a new copy available alongside an overwrite', async () => {
    const calls = stubApi({
      'GET design-studio/templates?kind=label': { templates: [summary()], count: 1 },
      'GET design-studio/templates/tpl-1': { template: { ...summary(), document: loadedDocument } },
      'POST design-studio/templates': { template: { ...summary({ id: 'tpl-9', name: 'Despatch variant' }), document: currentDocument } },
    });
    renderPanel({ document: currentDocument });
    await waitFor(() => expect(screen.getByText('Despatch')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^load$/i }));
    await screen.findByRole('button', { name: /save over “Despatch”/i });

    fireEvent.change(screen.getByLabelText(/name for a new template/i), { target: { value: 'Despatch variant' } });
    fireEvent.click(screen.getByRole('button', { name: /save as new/i }));

    await waitFor(() => expect(screen.getByText(/Saved as a new template “Despatch variant”/)).toBeTruthy());
    // A branch is a POST, not a PUT: the original keeps its contents and its id.
    expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(0);
    const post = calls.find((call) => call.method === 'POST');
    expect(post?.body).toMatchObject({ kind: 'label', name: 'Despatch variant' });
  });

  it('stops offering an overwrite once the loaded template is deleted', async () => {
    stubApi({
      'GET design-studio/templates?kind=label': { templates: [summary()], count: 1 },
      'GET design-studio/templates/tpl-1': { template: { ...summary(), document: loadedDocument } },
      'DELETE design-studio/templates/tpl-1': { deleted: true },
    });
    renderPanel({ document: currentDocument });
    await waitFor(() => expect(screen.getByText('Despatch')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^load$/i }));
    await screen.findByRole('button', { name: /save over “Despatch”/i });

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    fireEvent.click(screen.getByRole('button', { name: /delete “Despatch”/i }));

    await waitFor(() => expect(screen.getByText('Template deleted.')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /save over/i })).toBeNull();
  });
});

describe('the client cannot overwrite without naming a version', () => {
  it('sends expectedRevision on every overwrite it makes', async () => {
    // The API refuses this request without the revision, so a client that forgets cannot corrupt
    // anything — but it would be broken for every customer. This asserts the wire format directly.
    const calls = stubApi({
      'GET design-studio/templates?kind=label': { templates: [summary({ revision: 7 })], count: 1 },
      'GET design-studio/templates/tpl-1': { template: { ...summary({ revision: 7 }), document: { templateId: 'address-70x40', values: {} } } },
      'PUT design-studio/templates/tpl-1': { template: summary({ revision: 8 }) },
    });
    renderPanel({ document: { templateId: 'address-70x40', values: { recipient: 'Bola' } } });
    await waitFor(() => expect(screen.getByText('Despatch')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^load$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /save over “Despatch”/i }));
    fireEvent.click(screen.getByRole('button', { name: /replace “Despatch”/i }));

    await waitFor(() => expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(1));
    const put = calls.find((call) => call.method === 'PUT');
    // The version the list served is the version that goes back — not a guess, not 1.
    expect(put?.body).toMatchObject({ expectedRevision: 7 });
    expect(put?.body).not.toHaveProperty('force');
    expect(screen.getByText(/now version 8/i)).toBeTruthy();
  });

  it('refuses to load a template that came back without a version number', async () => {
    const onLoad = vi.fn();
    stubApi({
      'GET design-studio/templates?kind=label': { templates: [summary()], count: 1 },
      // A mis-served response, a proxy rewriting the payload, a future schema change…
      'GET design-studio/templates/tpl-1': { template: { ...summary({ revision: undefined }), document: { templateId: 'address-70x40' } } },
    });
    renderPanel({ onLoad });
    await waitFor(() => expect(screen.getByText('Despatch')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^load$/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/version number/i);
    // Nothing was applied and nothing can be saved over: the editor would otherwise look loaded while
    // "save over" silently acted on nothing.
    expect(onLoad).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /save over/i })).toBeNull();
  });
});
