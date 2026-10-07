// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ToolsCenterPage from '../../src/pages/ToolsCenterPage';
import ToolPage from '../../src/pages/ToolPage';
import { apiFetch, ApiRequestError } from '../../src/lib/api';
import { fetchNavigation } from '../../src/lib/platform-api';
import AiSupportWidget from '../../src/components/AiSupportWidget';
import { TOOL_CATALOG } from '../../../src/tools/catalog';

/**
 * The Tools Center in the two states that used to be dead ends.
 *
 * 1. The platform database is unreachable. The catalogue is static, so the server still returns it
 *    (see tests/integration/tools-degraded.test.ts) with `degraded: true`. The page must show the
 *    real tools plus the stated reason — not a red box that leaves the reader guessing.
 * 2. The API is not reachable at all (an SPA fallback or static server answered the path with
 *    index.html). `JSON.parse` used to leak `Unexpected token '<', "<!doctype "... is not valid
 *    JSON` straight into the customer's page; that message is asserted absent below.
 */

const DEGRADED_REASON =
  'Tool settings could not be read because the platform database is unreachable. Tools cannot run until it is restored — see docs/website-rebuild/LIVE-SITE-DEPLOYMENT.md §0 and `npm run db:doctor`.';

const degradedCatalog = {
  success: true,
  masterEnabled: true,
  anonymousAccess: true,
  degraded: true,
  degradedReason: DEGRADED_REASON,
  categories: [{ slug: 'dns', label: 'DNS', toolCount: 3 }],
  tools: TOOL_CATALOG.slice(0, 6).map((tool) => ({
    ...tool,
    notes: tool.notes ?? [],
    status: 'SERVICE_UNAVAILABLE',
    statusMessage: DEGRADED_REASON,
  })),
  count: 6,
};

function mockJsonOnce(body: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => body,
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  document.getElementById('ch247-tools-root')?.remove();
});

describe('Tools Center when operator policy is unreadable', () => {
  it('shows the real tools and the stated reason', async () => {
    // catalog() resolves; dashboard() fails (its own catch turns it into null).
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () =>
          String(url).includes('/dashboard') ? { success: true } : degradedCatalog,
      })),
    );

    render(
      <MemoryRouter>
        <ToolsCenterPage />
      </MemoryRouter>,
    );

    // The reason is on the page, once, and names the actual cause.
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('database is unreachable');

    // The tools themselves are still listed — the catalogue is static and always available.
    expect(screen.getByText(degradedCatalog.tools[0].name)).toBeTruthy();
    // And the generic dead-end copy is gone, because the catalogue did load.
    expect(screen.queryByText(/Tools are temporarily unavailable/)).toBeNull();
  });
});

describe('the API answering with HTML instead of JSON', () => {
  it('reports what happened instead of leaking the JSON parser error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        json: async () => {
          throw new SyntaxError('Unexpected token \'<\', "<!doctype "... is not valid JSON');
        },
      }),
    );

    await expect(apiFetch('/api/tools/catalog')).rejects.toBeInstanceOf(ApiRequestError);
    await expect(apiFetch('/api/tools/catalog')).rejects.toThrow(/returned an HTML page/i);
  });

  it('never shows that parser error to a customer on a tool page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        json: async () => {
          throw new SyntaxError('Unexpected token \'<\', "<!doctype "... is not valid JSON');
        },
      }),
    );

    render(
      <MemoryRouter initialEntries={['/tools/dns-lookup']}>
        <ToolPage />
      </MemoryRouter>,
    );

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toMatch(/Unexpected token/);
    expect(alert.textContent).not.toMatch(/is not valid JSON/);
    expect(alert.textContent).toMatch(/not the API|did not return JSON/i);
    // The old fallback blamed the tool and then claimed the page did not exist. Neither is true
    // here: the API was never reached, so nothing about this tool is known or broken.
    expect(screen.queryByText(/Tools temporarily unavailable/)).toBeNull();
    expect(screen.queryByText(/There is no tool registered under/)).toBeNull();
    expect(screen.getByText(/catalogue could not be loaded/)).toBeTruthy();
  });

  /**
   * The Tools Center is the one page that used to say "Tools are temporarily unavailable" for a
   * request that never reached the API. That sentence is false in that state — the catalogue is a
   * static document — so it must be replaced by the actual condition, while genuine API failures
   * keep the familiar copy.
   */
  it('does not tell the reader the tools are unavailable when the API was never reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        json: async () => {
          throw new SyntaxError("Unexpected token '<', \"<!doctype \"... is not valid JSON");
        },
      }),
    );

    render(
      <MemoryRouter>
        <ToolsCenterPage />
      </MemoryRouter>,
    );

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/HTML page/i);
    expect(alert.textContent).not.toMatch(/Unexpected token/);
    expect(alert.textContent).not.toMatch(/Tools are temporarily unavailable/);
    expect(alert.textContent).toMatch(/The tools themselves are fine/i);
  });

  it('keeps the familiar copy for a genuine API failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ error: 'INTERNAL_ERROR', message: 'An unexpected error occurred' }),
      }),
    );

    render(
      <MemoryRouter>
        <ToolsCenterPage />
      </MemoryRouter>,
    );

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Tools are temporarily unavailable/);
    expect(alert.textContent).toMatch(/An unexpected error occurred/);
  });

  it('leaves a genuine JSON error message untouched', async () => {
    mockJsonOnce({ error: 'NOT_FOUND', message: 'Resource not found' }, false, 404);
    await expect(apiFetch('/api/tools/nope')).rejects.toThrow(/Resource not found/);
  });

  /**
   * A non-2xx that is HTML is the other half of the same bug: the old code fell back to
   * `res.statusText`, which is empty over HTTP/2, so the reader got "Request failed" — technically
   * not the parser error, still nothing they can act on.
   */
  it('describes an HTML error page on a failed request too', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: '',
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        json: async () => {
          throw new SyntaxError("Unexpected token '<', \"<!doctype \"... is not valid JSON");
        },
      }),
    );

    await expect(apiFetch('/api/tools/catalog')).rejects.toThrow(/HTML page/i);
    await expect(apiFetch('/api/tools/catalog')).rejects.not.toThrow(/Request failed/);
  });
});

describe('every other surface that talks to the same API', () => {
  /**
   * The mega-menu fetch is rendered on every page. It threw the raw parser error into
   * `CatalogErrorBanner` whenever the API path answered with the SPA's index.html.
   */
  it('names the real problem when the navigation endpoint answers with HTML', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
        json: async () => {
          throw new SyntaxError("Unexpected token '<', \"<!doctype \"... is not valid JSON");
        },
      }),
    );

    await expect(fetchNavigation()).rejects.toThrow(/HTML page/i);
    await expect(fetchNavigation()).rejects.not.toThrow(/Unexpected token/);
  });

  /**
   * The AI support widget sits on every page and prints `error.message` verbatim, so the parser
   * error used to be shown to customers inside the support panel itself — the one place they go
   * when something is broken.
   */
  it('shows a readable message in the AI support widget', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        json: async () => {
          throw new SyntaxError("Unexpected token '<', \"<!doctype \"... is not valid JSON");
        },
      }),
    );

    render(<AiSupportWidget />);
    fireEvent.click(screen.getByRole('button', { name: /AI Support/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Start conversation/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toMatch(/Unexpected token/);
    expect(alert.textContent).not.toMatch(/is not valid JSON/);
    expect(alert.textContent).toMatch(/HTML page/i);
  });
});
