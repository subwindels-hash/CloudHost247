// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App';

function mockFetchOnce(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('/hosting catalog landing page', () => {
  it('shows a loading state before the catalog responds', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    render(
      <MemoryRouter initialEntries={['/hosting']}>
        <App />
      </MemoryRouter>
    );
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('renders real catalog products with correct available/coming-soon states, and still shows the static not-yet-catalogued list', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchOnce(200, {
        products: [
          { slug: 'cpanel-hosting', name: 'cPanel Hosting', description: 'Everyday hosting.', productType: 'hosting', displayOrder: 1, available: true },
          { slug: 'vps-hosting', name: 'VPS Hosting', description: 'Root access VPS.', productType: 'hosting', displayOrder: 2, available: false },
        ],
      })
    );

    render(
      <MemoryRouter initialEntries={['/hosting']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('cPanel Hosting')).toBeTruthy());
    expect(screen.getByText('VPS Hosting')).toBeTruthy();
    // Available product links through to its dedicated page.
    expect(screen.getByRole('link', { name: /View details/ }).getAttribute('href')).toBe('/hosting/cpanel');
    // Unavailable (draft) product shows "Coming soon", not a fabricated link.
    expect(screen.getByText('Coming soon')).toBeTruthy();
    // The known real-but-not-yet-catalogued service lines are still listed honestly.
    expect(screen.getByText('Shared Hosting')).toBeTruthy();
  });

  it('shows an empty-catalog hint (not a blank page) when the API returns zero products', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(200, { products: [] }));

    render(
      <MemoryRouter initialEntries={['/hosting']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText(/No hosting categories have been added/)).toBeTruthy());
    // Static fallback content still renders so the page is never actually empty.
    expect(screen.getByText('Shared Hosting')).toBeTruthy();
  });

  it('shows a visible error banner, not a blank page, when the catalog API fails', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(500, { error: 'INTERNAL', message: 'Something broke on the server' }));

    render(
      <MemoryRouter initialEntries={['/hosting']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText('Something broke on the server')).toBeTruthy();
  });
});
