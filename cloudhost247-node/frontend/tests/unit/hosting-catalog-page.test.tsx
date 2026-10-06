// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App';

/**
 * `/hosting` — the hosting hub.
 *
 * The hub is a marketing page whose "Live pricing" section is rendered from `GET /api/v1/catalog`,
 * so the honesty contract this file pins is the important part: prices and plans are never
 * invented, an unconfigured catalogue produces an explicit empty state, and an API failure
 * produces a visible error rather than a blank section.
 *
 * Queries are scoped to the page body because the footer legitimately links to the same
 * destinations with the same labels.
 */

function mockFetchOnce(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

async function renderHosting() {
  render(
    <MemoryRouter initialEntries={['/hosting']}>
      <App />
    </MemoryRouter>
  );
  return within(await screen.findByRole('main'));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('/hosting — hosting hub with live catalogue', () => {
  it('renders the hub content even before the catalogue responds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    const page = await renderHosting();
    expect(await page.findByRole('heading', { name: /Hosting for the site you actually run/i })).toBeTruthy();
    // The catalogue section shows a real loading state rather than an empty box.
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  });

  it('renders the configured products, and only offers plans that are really available', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchOnce(200, {
        products: [
          { slug: 'cpanel-hosting', name: 'cPanel Hosting', description: 'Everyday hosting.', productType: 'hosting', displayOrder: 1, available: true },
          { slug: 'vps-hosting', name: 'VPS Hosting', description: 'Root access VPS.', productType: 'hosting', displayOrder: 2, available: false },
        ],
      })
    );

    const page = await renderHosting();

    expect(await page.findByText('cPanel Hosting')).toBeTruthy();
    expect(page.getByText('VPS Hosting')).toBeTruthy();
    expect(page.getByText('Everyday hosting.')).toBeTruthy();

    // An available product offers its plans; an unavailable one is labelled, not linked.
    expect(page.getByRole('button', { name: /View plans/ })).toBeTruthy();
    expect(page.getByText('Not configured for this deployment')).toBeTruthy();
  });

  it('shows plans and prices only from the API when a product is expanded', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1;
        const body = call === 1
          ? { products: [{ slug: 'cpanel-hosting', name: 'cPanel Hosting', description: 'Everyday hosting.', productType: 'hosting', displayOrder: 1, available: true }] }
          : {
              product: { slug: 'cpanel-hosting', name: 'cPanel Hosting', description: null, productType: 'hosting', displayOrder: 1, available: true, plans: [] },
              plans: [
                {
                  slug: 'starter',
                  name: 'Starter',
                  description: 'One website.',
                  billingModel: 'recurring',
                  displayOrder: 1,
                  pricing: [{ billingPeriod: 'monthly', currency: 'USD', amount: 9.5, setupFee: null }],
                  features: [{ name: 'Websites', value: '1', displayOrder: 1 }],
                },
              ],
            };
        return { ok: true, status: 200, json: async () => body };
      })
    );

    const page = await renderHosting();
    const button = await page.findByRole('button', { name: /View plans/ });
    button.click();

    expect(await page.findByText('Starter')).toBeTruthy();
    expect(page.getByText(/9\.50/)).toBeTruthy();
    expect(page.getByText(/Websites/)).toBeTruthy();
  });

  it('shows an explicit empty state — never a placeholder price — when the catalogue is empty', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(200, { products: [] }));
    const page = await renderHosting();
    await waitFor(() => expect(page.getByText(/No products are published in this catalogue yet/i)).toBeTruthy());
    // The hub is still a complete page: the marketing content does not depend on the catalogue.
    expect(page.getByText('Which hosting is which')).toBeTruthy();
  });

  it('shows a visible error banner, not a blank page, when the catalog API fails', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(500, { error: 'INTERNAL', message: 'Something broke on the server' }));
    await renderHosting();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText('Something broke on the server')).toBeTruthy();
  });
});
