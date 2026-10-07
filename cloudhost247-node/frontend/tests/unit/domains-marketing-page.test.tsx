// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  localStorage.clear();
});

describe('/domains Domain Services hub', () => {
  it('renders all nine service cards in the three reference groups', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(200, {}));

    render(
      <MemoryRouter initialEntries={['/domains']}>
        <App />
      </MemoryRouter>
    );

    // Scoped to the page body: the footer links to the same destinations with the same labels,
    // so an unscoped query is ambiguous by design rather than by accident.
    const page = within(await screen.findByRole('main'));

    // The three groups from the reference layout.
    expect(await page.findByText('Find a Domain')).toBeTruthy();
    expect(await page.findByText('Domain Investing')).toBeTruthy();
    expect(await page.findByText('Domain Tools and Services')).toBeTruthy();

    // The nine services.
    for (const service of [
      'Search for Domain Names',
      'Transfer Domain Names',
      'gTLD Domain Extensions',
      'Auctions for Domain Names',
      'Appraise Domain Name Value',
      'Discount Domain Club',
      'Find a Domain Owner (WHOIS/RDAP)',
      'Bulk Domain Search',
      'Domain Broker Service',
    ]) {
      expect(await page.findByText(service), `missing service card: ${service}`).toBeTruthy();
    }
  });

  it('performs a real provider-backed search and renders live availability + prices', async () => {
    const fetchMock = vi.fn().mockImplementation((path: string) => {
      if (path.startsWith('/api/v1/domain-services/search')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            searchId: 'search-1',
            queryLabel: 'example',
            status: 'completed',
            message: null,
            results: [
              {
                domainName: 'example.com',
                availabilityStatus: 'available',
                isPremium: false,
                registrationPrice: '12.98',
                renewalPrice: '15.98',
                transferPrice: '11.48',
                currency: 'USD',
              },
              {
                domainName: 'example.io',
                availabilityStatus: 'registered',
                isPremium: false,
                registrationPrice: null,
                renewalPrice: null,
                transferPrice: null,
                currency: null,
              },
            ],
          }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/domains']}>
        <App />
      </MemoryRouter>
    );

    const input = await screen.findByLabelText('Domain name to search');
    fireEvent.change(input, { target: { value: 'example' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Search' }));

    await waitFor(() => expect(screen.getByText('example.com')).toBeTruthy());
    expect(await screen.findByText('example.io')).toBeTruthy();
    expect(await screen.findByText('Available')).toBeTruthy();
    expect(await screen.findByText('Registered')).toBeTruthy();
    // Prices come from the provider response, verbatim.
    expect((await screen.findAllByText('$12.98')).length).toBeGreaterThan(0);
  });

  it('shows the honest Service Provider Not Configured state — never placeholder availability', async () => {
    const fetchMock = vi.fn().mockImplementation((path: string) => {
      if (path.startsWith('/api/v1/domain-services/search')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            searchId: 'search-2',
            queryLabel: 'example',
            status: 'provider_not_configured',
            message: 'Service Provider Not Configured',
            results: [],
          }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/domains']}>
        <App />
      </MemoryRouter>
    );

    fireEvent.change(await screen.findByLabelText('Domain name to search'), { target: { value: 'example' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Search' }));

    await waitFor(() => expect(screen.getByText('Service Provider Not Configured')).toBeTruthy());
    // No fabricated results are ever shown in this state.
    expect(screen.queryByText('Available')).toBeNull();
  });

  it('shows a visible error banner rather than a blank page when the search API fails', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(500, { error: 'INTERNAL', message: 'Search failed' }));

    render(
      <MemoryRouter initialEntries={['/domains']}>
        <App />
      </MemoryRouter>
    );

    fireEvent.change(await screen.findByLabelText('Domain name to search'), { target: { value: 'example' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Search' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(await screen.findByText('Search failed')).toBeTruthy();
  });
});
