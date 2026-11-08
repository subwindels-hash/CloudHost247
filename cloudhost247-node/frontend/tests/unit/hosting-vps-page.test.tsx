// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App';

function mockFetchOnce(status: number, body: unknown) {
  return vi.fn().mockImplementation((path: string) => {
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    });
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('/hosting/vps plans & pricing', () => {
  it('requests the vps-hosting catalog slug and renders its real plans', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        product: { slug: 'vps-hosting', name: 'VPS Hosting', description: null, productType: 'hosting', displayOrder: 1, available: true },
        plans: [
          {
            slug: 'vps-1',
            name: 'VPS 1',
            description: '1 vCPU, 2 GB RAM.',
            billingModel: 'recurring',
            displayOrder: 1,
            pricing: [{ billingPeriod: 'monthly', currency: 'USD', amount: 12, setupFee: 0 }],
            features: [],
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/hosting/vps']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('VPS 1')).toBeTruthy());
    expect(screen.getByText(/\$12\.00/)).toBeTruthy();
    // Match on the path, not the whole URL: catalogue requests carry an explicit `?lang=` so an
    // HTTP cache cannot serve one language to another visitor, and pinning the bare path here only
    // asserted that localisation had not been added.
    const requestedPlanUrls = fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes('/plans'));
    expect(requestedPlanUrls).toHaveLength(1);
    const requestedUrl = new URL(requestedPlanUrls[0]!, 'https://example.test');
    expect(requestedUrl.pathname).toBe('/api/v1/catalog/products/vps-hosting/plans');
    expect(requestedUrl.searchParams.get('lang')).toBeTruthy();
  });

  it('shows the empty-plans notice honestly when the product is available but has no published plans', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchOnce(200, {
        product: { slug: 'vps-hosting', name: 'VPS Hosting', description: null, productType: 'hosting', displayOrder: 1, available: true },
        plans: [],
      })
    );

    render(
      <MemoryRouter initialEntries={['/hosting/vps']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText(/No plans have been published for this service yet/)).toBeTruthy());
  });
});
