// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

    // The three groups from the reference layout.
    expect(await screen.findByText('Find a Domain')).toBeTruthy();
    expect(await screen.findByText('Domain Investing')).toBeTruthy();
    expect(await screen.findByText('Domain Tools and Services')).toBeTruthy();

    // The nine services.
    expect(await screen.findByText('Search for Domain Names')).toBeTruthy();
    expect(await screen.findByText('Transfer Domain Names')).toBeTruthy();
    expect(await screen.findByText('gTLD Domain Extensions')).toBeTruthy();
    expect(await screen.findByText('Auctions for Domain Names')).toBeTruthy();
    expect(await screen.findByText('Appraise Domain Name Value')).toBeTruthy();
    expect(await screen.findByText('Discount Domain Club')).toBeTruthy();
    expect(await screen.findByText('Find a Domain Owner (WHOIS/RDAP)')).toBeTruthy();
    expect(await screen.findByText('Bulk Domain Search')).toBeTruthy();
    expect(await screen.findByText('Domain Broker Service')).toBeTruthy();
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
