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

describe('/hosting/cpanel plans & pricing', () => {
  it('renders real plan names, published prices, and features from the live catalog', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchOnce(200, {
        product: { slug: 'cpanel-hosting', name: 'cPanel Hosting', description: null, productType: 'hosting', displayOrder: 1, available: true },
        plans: [
          {
            slug: 'starter',
            name: 'Starter',
            description: 'For small sites.',
            billingModel: 'recurring',
            displayOrder: 1,
            pricing: [{ billingPeriod: 'monthly', currency: 'USD', amount: 4.99, setupFee: null }],
            features: [{ name: 'Storage', value: '10 GB', displayOrder: 1 }],
          },
        ],
      })
    );

    render(
      <MemoryRouter initialEntries={['/hosting/cpanel']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('Starter')).toBeTruthy());
    expect(screen.getByText(/\$4\.99/)).toBeTruthy();
    expect(screen.getByText(/Storage/)).toBeTruthy();
  });

  it('shows an honest "not in the catalog yet" notice (not a fake plan list) on a 404', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(404, { error: 'NOT_FOUND', message: 'No product was found with that identifier' }));

    render(
      <MemoryRouter initialEntries={['/hosting/cpanel']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText(/haven't been added to this platform's live catalog yet/)).toBeTruthy());
  });

  it('shows a plan honestly as unpublished-pricing rather than inventing a price', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchOnce(200, {
        product: { slug: 'cpanel-hosting', name: 'cPanel Hosting', description: null, productType: 'hosting', displayOrder: 1, available: true },
        plans: [
          {
            slug: 'starter',
            name: 'Starter',
            description: null,
            billingModel: 'recurring',
            displayOrder: 1,
            pricing: [],
            features: [],
          },
        ],
      })
    );

    render(
      <MemoryRouter initialEntries={['/hosting/cpanel']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText(/Pricing hasn't been published for this plan yet/)).toBeTruthy());
  });

  it('shows a "being finalized" notice for a draft (unavailable) product instead of empty plans', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchOnce(200, {
        product: { slug: 'cpanel-hosting', name: 'cPanel Hosting', description: null, productType: 'hosting', displayOrder: 1, available: false },
        plans: [],
      })
    );

    render(
      <MemoryRouter initialEntries={['/hosting/cpanel']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText(/being finalized in our catalog/)).toBeTruthy());
  });

  it('shows a visible error banner on a server failure', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(500, { error: 'INTERNAL', message: 'Database unavailable' }));

    render(
      <MemoryRouter initialEntries={['/hosting/cpanel']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText('Database unavailable')).toBeTruthy();
  });
});
