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

describe('/domains marketing page', () => {
  it('always states registration/search is not connected, regardless of catalog contents', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(200, { products: [] }));

    render(
      <MemoryRouter initialEntries={['/domains']}>
        <App />
      </MemoryRouter>
    );

    expect(screen.getByText(/aren't connected on this platform yet/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/No domain products have been configured/)).toBeTruthy());
  });

  it('lists a real domain-type catalog product when one exists, without implying live registration works', async () => {
    const fetchMock = vi.fn().mockImplementation((path: string) => {
      if (path.startsWith('/api/v1/catalog/products?type=domain')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            products: [
              { slug: 'domain-registration', name: 'Domain Registration', description: 'Register a new domain.', productType: 'domain', displayOrder: 1, available: true },
            ],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          product: { slug: 'domain-registration', name: 'Domain Registration', description: null, productType: 'domain', displayOrder: 1, available: true },
          plans: [],
        }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/domains']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('Domain Registration')).toBeTruthy());
    expect(screen.getByText(/aren't connected on this platform yet/)).toBeTruthy();
  });

  it('shows a visible error banner rather than a blank page on catalog failure', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(500, { error: 'INTERNAL', message: 'Catalog lookup failed' }));

    render(
      <MemoryRouter initialEntries={['/domains']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText('Catalog lookup failed')).toBeTruthy();
  });
});
