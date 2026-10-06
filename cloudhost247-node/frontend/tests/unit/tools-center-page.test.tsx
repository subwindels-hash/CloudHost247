// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App';

/**
 * The Tools Center is generated from the API catalogue, so these tests drive it through the real
 * routes and real fetch boundary: they assert what a customer sees for a working tool, for a tool
 * whose provider is not configured, and for a nested catalogue URL.
 */

function toolFixture(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'dns-lookup',
    name: 'DNS Lookup',
    category: 'dns',
    summary: 'Resolve a record and show every answer with its TTL.',
    description: 'Queries the resolver registry and reports each answer verbatim.',
    icon: 'search',
    path: '/tools/dns/lookup',
    apiPath: '/api/tools/dns-lookup',
    methods: ['GET'],
    authRequired: false,
    visibility: 'public',
    status: 'ACTIVE',
    statusMessage: null,
    providerKind: null,
    requiresOwnership: false,
    cacheSeconds: 60,
    keywords: ['dns', 'lookup'],
    notes: ['Answers are reported exactly as the resolver returned them.'],
    ...overrides,
  };
}

const CATALOG = {
  success: true,
  masterEnabled: true,
  anonymousAccess: true,
  count: 2,
  categories: [
    { slug: 'dns', label: 'DNS Tools', toolCount: 1 },
    { slug: 'security', label: 'Security Tools', toolCount: 1 },
  ],
  tools: [
    toolFixture(),
    toolFixture({
      slug: 'bin-checker',
      name: 'BIN Checker',
      category: 'security',
      summary: 'Identify the card scheme and issuing bank for an IIN.',
      path: '/tools/security/bin-checker',
      apiPath: '/api/tools/bin-checker',
      status: 'CONFIGURATION_REQUIRED',
      statusMessage: 'A BIN lookup provider must be configured by an administrator.',
      providerKind: 'BIN',
    }),
  ],
};

const DASHBOARD = {
  success: true,
  generatedAt: '2026-10-03T00:00:00.000Z',
  masterEnabled: true,
  anonymousAccess: true,
  signedIn: false,
  categories: CATALOG.categories,
  popular: [toolFixture({ runs: 12 })],
  recent: [],
  favorites: [],
  statusSummary: { ACTIVE: 1, CONFIGURATION_REQUIRED: 1 },
};

function mockApi(routes: Array<[string, unknown]>) {
  return vi.fn().mockImplementation((url: string) => {
    const match = routes.find(([path]) => String(url).includes(path));
    if (!match) return Promise.resolve({ ok: false, status: 404, json: async () => ({ error: 'NOT_FOUND', message: 'no route' }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => match[1] });
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('Tools Center', () => {
  it('lists every catalogued tool with its status and honest provider warning', async () => {
    vi.stubGlobal('fetch', mockApi([
      ['/api/tools/catalog', CATALOG],
      ['/api/tools/dashboard', DASHBOARD],
    ]));

    render(
      <MemoryRouter initialEntries={['/tools']}>
        <App />
      </MemoryRouter>
    );

    // The same tool appears in the catalogue grid and in the "popular" strip, so both are expected.
    await waitFor(() => expect(screen.getAllByText('DNS Lookup').length).toBeGreaterThan(0));
    expect(screen.queryByText('BIN Checker')).toBeNull();
    fireEvent.click(screen.getByLabelText('Show unavailable tools'));
    expect(screen.getAllByText('BIN Checker').length).toBeGreaterThan(0);
    // A tool that cannot run on this deployment says why, on the card, before it is clicked.
    expect(screen.getAllByText(/must be configured by an administrator/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Needs setup').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Available').length).toBeGreaterThan(0);
  });

  it('resolves a nested catalogue URL to the right tool page', async () => {
    vi.stubGlobal('fetch', mockApi([
      ['/api/tools/catalog', CATALOG],
      ['/api/tools/dashboard', DASHBOARD],
    ]));

    render(
      <MemoryRouter initialEntries={['/tools/dns/lookup']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'DNS Lookup' })).toBeTruthy());
    // The generated form for this tool, plus the actions that only make sense with a result.
    expect(screen.getByLabelText(/Domain or hostname/i)).toBeTruthy();
    expect(screen.getByText(/Run the tool to see its output here/i)).toBeTruthy();
  });

  it('renders a typed failure verbatim instead of a generic error', async () => {
    vi.stubGlobal('fetch', mockApi([
      ['/api/tools/catalog', CATALOG],
      ['/api/tools/dashboard', DASHBOARD],
      ['/api/tools/dns-lookup', {
        success: false,
        code: 'CONFIGURATION_REQUIRED',
        message: 'No DNS resolver is enabled on this deployment.',
        retryable: false,
        tool: 'dns-lookup',
      }],
    ]));

    render(
      <MemoryRouter initialEntries={['/tools/dns/lookup']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'DNS Lookup' })).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/Domain or hostname/i), {target:{value:'example.com'}});
    fireEvent.click(screen.getByRole('button', { name: /^Run tool$/i }));

    await waitFor(() => expect(screen.getByText('CONFIGURATION_REQUIRED')).toBeTruthy());
    expect(screen.getByText('No DNS resolver is enabled on this deployment.')).toBeTruthy();
  });
});
