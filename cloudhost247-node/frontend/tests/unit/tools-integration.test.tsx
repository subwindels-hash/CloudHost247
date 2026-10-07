// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ToolPage from '../../src/pages/ToolPage';
import {
  ToolsNavigationProvider,
  ToolsFooter,
  ToolsMegaMenu,
} from '../../src/components/tools/ToolsNavigation';
import {
  TOOL_CATALOG,
  NON_RUNNABLE_TOOL_SLUGS,
} from '../../../src/tools/catalog';
import { apiFetch } from '../../src/lib/api';
const catalog = {
  tools: TOOL_CATALOG.map((t) => ({
    ...t,
    notes: t.notes ?? [],
    status: 'ACTIVE',
  })),
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  document.getElementById('ch247-tools-root')?.remove();
});
describe('every production tools route', () => {
  it.each(TOOL_CATALOG.filter((t) => !NON_RUNNABLE_TOOL_SLUGS.has(t.slug)))(
    '$path resolves to the actual labeled form',
    async (tool) => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => catalog,
          })
      );
      render(
        <MemoryRouter initialEntries={[tool.path]}>
          <ToolPage />
        </MemoryRouter>
      );
      await screen.findByRole('heading', { level: 1, name: tool.name });
      const button = screen.getByRole('button', { name: 'Run tool' });
      expect((button as HTMLButtonElement).disabled).toBe(tool.authRequired);
      expect(screen.getByLabelText('Advanced JSON input')).toBeTruthy();
      // Head metadata is installed in a passive effect after the heading commits.
      // Wait for that contract, not a scheduler-dependent immediate observation.
      await waitFor(() =>
        expect(
          document.head.querySelector('link[rel=canonical]')?.getAttribute('href')
        ).toContain(tool.path)
      );
    }
  );
  it('renders loading and network failure instead of an empty successful result', async () => {
    let reject!: (error: Error) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        new Promise((_resolve, r) => {
          reject = r;
        })
      )
    );
    render(
      <MemoryRouter initialEntries={['/tools/dns-lookup']}>
        <ToolPage />
      </MemoryRouter>
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Loading…' })
    ).toBeTruthy();
    reject(new Error('Network unavailable'));
    await screen.findByRole('heading', {
      level: 1,
      name: 'The tool catalogue could not be loaded',
    });
    expect(screen.getByRole('alert').textContent).toContain(
      'Network unavailable'
    );
  });
  it('keeps public navigation and footer limited to the runtime projection', async () => {
    const tool = catalog.tools.find((t) => t.slug === 'dns-lookup')!;
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ tools: [tool] }),
        })
    );
    render(
      <MemoryRouter>
        <ToolsNavigationProvider>
          <ToolsMegaMenu />
          <ToolsFooter />
        </ToolsNavigationProvider>
      </MemoryRouter>
    );
    const details = document.querySelector('details')!;
    details.open = true;
    await waitFor(() =>
      expect(screen.getAllByRole('link', { name: 'DNS Lookup' }).length).toBe(2)
    );
    expect(screen.queryByRole('link', { name: 'Domain WHOIS' })).toBeNull();
    const summary = screen.getByText('Tools', { selector: 'summary' });
    details.open = true;
    fireEvent.keyDown(summary, { key: 'Escape' });
    expect(details.open).toBe(false);
    expect(screen.getAllByRole('link', { name: /All Tools/ })).toHaveLength(3);
  });
  it('uses the configured same-origin embed mount without forwarding Node credentials', async () => {
    const root = document.createElement('div');
    root.id = 'ch247-tools-root';
    root.dataset.apiBase = '/platform';
    document.body.append(root);
    localStorage.setItem('ch247_token', 'must-not-leave-embedded-context');
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal('fetch', fetch);
    await apiFetch('/api/tools/catalog');
    expect(fetch.mock.calls[0]?.[0]).toBe('/platform/api/tools/catalog');
    expect(fetch.mock.calls[0]?.[1].headers.Authorization).toBeUndefined();
  });
});
