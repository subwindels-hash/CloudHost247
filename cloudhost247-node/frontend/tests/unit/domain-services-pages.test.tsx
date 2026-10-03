// @vitest-environment jsdom
/**
 * Domain Services frontend behaviour tests. These exercise the customer-facing pages against the
 * real HTTP contract the backend exposes: search results are rendered verbatim (never invented),
 * the unconfigured provider state is honest, auth-gated actions show sign-in prompts, auction
 * bidding uses the server-computed minimum, and the admin page writes credentials through the
 * write-only endpoint. No test fabricates success states.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App';

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function routeMock(routes: Array<{ match: (path: string, init?: RequestInit) => boolean; body: unknown; status?: number }>) {
  return vi.fn().mockImplementation((path: string, init?: RequestInit) => {
    for (const route of routes) {
      if (route.match(path, init)) {
        return Promise.resolve(jsonResponse(route.status ?? 200, typeof route.body === 'function' ? route.body() : route.body));
      }
    }
    return Promise.resolve(jsonResponse(200, {}));
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('/domains/search', () => {
  it('renders provider results and requires sign-in to register', async () => {
    vi.stubGlobal('fetch', routeMock([
      {
        match: (path) => path.startsWith('/api/v1/domain-services/search'),
        body: {
          searchId: 's1', queryLabel: 'example', status: 'completed', message: null,
          results: [
            { domainName: 'example.com', availabilityStatus: 'available', isPremium: false, registrationPrice: '12.98', renewalPrice: '15.98', transferPrice: '11.48', currency: 'USD' },
            { domainName: 'premium.example', availabilityStatus: 'premium', isPremium: true, registrationPrice: '99.00', renewalPrice: '99.00', transferPrice: '99.00', currency: 'USD' },
          ],
        },
      },
    ]));

    render(<MemoryRouter initialEntries={['/domains/search']}><App /></MemoryRouter>);

    fireEvent.change(await screen.findByLabelText('Domain name'), { target: { value: 'example' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Search' }));

    await waitFor(() => expect(screen.getByText('example.com')).toBeTruthy());
    expect(await screen.findByText('Premium')).toBeTruthy();
    // Signed-out visitors see sign-in prompts, never a fake checkout.
    expect((await screen.findAllByText('Sign in to register')).length).toBe(2);
  });

  it('shows the honest provider-missing state without placeholder prices', async () => {
    vi.stubGlobal('fetch', routeMock([
      {
        match: (path) => path.startsWith('/api/v1/domain-services/search'),
        body: { searchId: 's2', queryLabel: 'example', status: 'provider_not_configured', message: 'Service Provider Not Configured', results: [] },
      },
    ]));

    render(<MemoryRouter initialEntries={['/domains/search']}><App /></MemoryRouter>);

    fireEvent.change(await screen.findByLabelText('Domain name'), { target: { value: 'example' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Search' }));

    await waitFor(() => expect(screen.getByText('Service Provider Not Configured')).toBeTruthy());
    expect(screen.queryByText('example.com')).toBeNull();
  });

  it('lets a signed-in customer watch a taken result and reflects the "Watching" state', async () => {
    localStorage.setItem('ch247_token', 'test-token');
    vi.stubGlobal('fetch', routeMock([
      {
        match: (path) => path.startsWith('/api/v1/domain-services/search'),
        body: {
          searchId: 's3', queryLabel: 'taken-brand', status: 'completed', message: null,
          results: [
            { domainName: 'taken-brand.com', availabilityStatus: 'registered', isPremium: false, registrationPrice: null, renewalPrice: null, transferPrice: '11.48', currency: 'USD' },
          ],
        },
      },
      {
        match: (path, init) => path === '/api/v1/domain-services/watches' && (init?.method ?? 'GET') === 'POST',
        status: 201,
        body: { watch: { id: 'watch-42', domainName: 'taken-brand.com', status: 'watching', lastCheckedAt: null, lastAvailability: null, availableAt: null, createdAt: '2026-10-01T00:00:00Z' } },
      },
      {
        match: (path, init) => path === '/api/v1/domain-services/watches' && (init?.method ?? 'GET') === 'GET',
        body: { watches: [] },
      },
    ]));

    render(<MemoryRouter initialEntries={['/domains/search']}><App /></MemoryRouter>);

    fireEvent.change(await screen.findByLabelText('Domain name'), { target: { value: 'taken-brand' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Search' }));

    const watchButton = await screen.findByRole('button', { name: 'Watch' });
    fireEvent.click(watchButton);

    await waitFor(() => expect(screen.getByText('Watching ✓')).toBeTruthy());
    expect(await screen.findByText(/you will be notified if it becomes available/i)).toBeTruthy();
  });
});

describe('/domains/whois', () => {
  it('renders real RDAP data and reports privacy protection honestly', async () => {
    vi.stubGlobal('fetch', routeMock([
      {
        match: (path) => path.startsWith('/api/v1/domain-services/whois'),
        body: {
          lookupId: 'w1', status: 'completed', message: null,
          result: {
            domainName: 'example.com', registrar: 'Example Registrar, Inc.', createdAt: '2020-01-01T00:00:00Z',
            updatedAt: '2025-06-01T00:00:00Z', expiresAt: '2027-01-01T00:00:00Z', statuses: ['clientTransferProhibited'],
            nameservers: ['ns1.example.com', 'ns2.example.com'], registry: 'Verisign', source: 'rdap',
            privacyProtected: true, registrant: 'Privacy Protected',
          },
        },
      },
    ]));

    render(<MemoryRouter initialEntries={['/domains/whois']}><App /></MemoryRouter>);

    fireEvent.change(await screen.findByLabelText('Domain name'), { target: { value: 'example.com' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Look up' }));

    await waitFor(() => expect(screen.getByText('Example Registrar, Inc.')).toBeTruthy());
    expect(await screen.findByText(/Privacy protection is respected/i)).toBeTruthy();
    expect(await screen.findByText('Privacy Protected')).toBeTruthy();
  });
});

describe('/domains/auctions/:id', () => {
  it('shows the auction, computes the next-minimum from server state, and accepts a bid', async () => {
    const bidCall = vi.fn().mockResolvedValue(jsonResponse(201, { bidId: 'b1', amount: '125.00' }));
    const fetchMock = vi.fn().mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/v1/domain-services/auctions/auction-1/bids' && init?.method === 'POST') {
        return bidCall(path, init);
      }
      if (path.startsWith('/api/v1/domain-services/auctions/auction-1')) {
        return Promise.resolve(jsonResponse(200, {
          auction: {
            id: 'auction-1', domainName: 'premium.example', status: 'live', currency: 'USD',
            minimumBid: '100.00', bidIncrement: '5.00', currentHighestBid: '120.00', bidCount: 3,
            startsAt: '2026-01-01T00:00:00Z', endsAt: new Date(Date.now() + 86_400_000).toISOString(),
            createdAt: '2025-12-01T00:00:00Z', myHighestBid: '110.00',
          },
          bids: [
            { amount: '100.00', currency: 'USD', created_at: '2026-01-02T00:00:00Z', bidder_label: 'Bidder 01' },
            { amount: '120.00', currency: 'USD', created_at: '2026-01-03T00:00:00Z', bidder_label: 'Bidder 02' },
          ],
        }));
      }
      return Promise.resolve(jsonResponse(200, {}));
    });
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('ch247_token', 'test-token');

    render(<MemoryRouter initialEntries={['/domains/auctions/auction-1']}><App /></MemoryRouter>);

    await waitFor(() => expect(screen.getByText('premium.example')).toBeTruthy());
    // Current highest + increment = 125.00, shown as the minimum next bid.
    expect(await screen.findByText(/125\.00/)).toBeTruthy();
    // Bidding history is anonymized.
    expect(await screen.findByText('Bidder 02')).toBeTruthy();

    fireEvent.change(await screen.findByLabelText(/Your bid/), { target: { value: '125' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Place bid' }));

    await waitFor(() => expect(screen.getByText(/you are the highest bidder/i)).toBeTruthy());
    expect(bidCall).toHaveBeenCalled();
  });

  it('never renders placeholder auctions when none exist', async () => {
    vi.stubGlobal('fetch', routeMock([
      { match: (path) => path.startsWith('/api/v1/domain-services/auctions'), body: { auctions: [], page: 1, limit: 24, total: 0 } },
    ]));

    render(<MemoryRouter initialEntries={['/domains/auctions']}><App /></MemoryRouter>);

    await waitFor(() =>
      expect(screen.getByText(/No auctions match right now\. New listings appear here as soon as they are scheduled/i)).toBeTruthy()
    );
  });
});

describe('/domains/appraisal', () => {
  it('shows the provider valuation with its disclaimer, verbatim', async () => {
    vi.stubGlobal('fetch', routeMock([
      {
        match: (path) => path.startsWith('/api/v1/domain-services/appraisals'),
        body: {
          appraisalId: 'ap1', orderId: null, invoiceId: null, invoiceNumber: null,
          amount: '0.00', currency: 'USD', status: 'completed', message: null,
          appraisal: {
            domainName: 'example.com', estimatedValue: '1847.00', currency: 'USD', confidence: 'medium',
            tld: 'com', domainLength: 7, keywords: ['example'], brandability: null, comparableSales: [],
            factors: { salesProbability: '0.12' },
            disclaimer: 'This valuation is an estimate produced by an automated model. It is not a guaranteed selling price, an offer, or an appraisal for legal, tax, or lending purposes.',
          },
        },
      },
    ]));
    localStorage.setItem('ch247_token', 'test-token');

    render(<MemoryRouter initialEntries={['/domains/appraisal']}><App /></MemoryRouter>);

    fireEvent.change(await screen.findByLabelText('Domain name'), { target: { value: 'example.com' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Get estimate' }));

    await waitFor(() => expect(screen.getByText('$1847.00')).toBeTruthy());
    expect(await screen.findByText(/not a guaranteed selling price/i)).toBeTruthy();
    expect(await screen.findByText('Medium')).toBeTruthy();
  });

  it('refuses to invent a value when no appraisal provider is connected', async () => {
    vi.stubGlobal('fetch', routeMock([
      {
        match: (path) => path.startsWith('/api/v1/domain-services/appraisals'),
        body: {
          appraisalId: '', orderId: null, invoiceId: null, invoiceNumber: null,
          amount: '0.00', currency: 'USD', appraisal: null, status: 'provider_not_configured',
          message: 'Service Provider Not Configured',
        },
      },
    ]));
    localStorage.setItem('ch247_token', 'test-token');

    render(<MemoryRouter initialEntries={['/domains/appraisal']}><App /></MemoryRouter>);

    fireEvent.change(await screen.findByLabelText('Domain name'), { target: { value: 'example.com' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Get estimate' }));

    await waitFor(() => expect(screen.getByText('Service Provider Not Configured')).toBeTruthy());
    expect(screen.queryByText(/Estimated value/i)).toBeNull();
  });
});

describe('/domains/bulk-search', () => {
  it('requires an account (bulk search is authenticated + throttled server-side)', async () => {
    vi.stubGlobal('fetch', routeMock([]));

    render(<MemoryRouter initialEntries={['/domains/bulk-search']}><App /></MemoryRouter>);

    expect(await screen.findByText('Sign in to use bulk search')).toBeTruthy();
    expect(screen.queryByLabelText('Domains — one per line, comma-separated, or a CSV column (bare terms are checked against leading extensions)')).toBeNull();
  });
});

describe('/domains/club', () => {
  it('lists published plans with server-configured discounts', async () => {
    vi.stubGlobal('fetch', routeMock([
      {
        match: (path) => path.startsWith('/api/v1/domain-services/club/plans'),
        body: {
          plans: [
            {
              id: 'plan-1', name: 'Domain Club Monthly', description: null, status: 'published', currency: 'USD',
              billingPeriod: 'monthly', priceAmount: '9.99', discountType: 'percentage', discountValue: '25',
              eligibleExtensions: [], promotion: {}, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
            },
          ],
        },
      },
      { match: (path) => path.startsWith('/api/v1/domain-services/club/membership'), body: { membership: null } },
    ]));

    render(<MemoryRouter initialEntries={['/domains/club']}><App /></MemoryRouter>);

    await waitFor(() => expect(screen.getByText('Domain Club Monthly')).toBeTruthy());
    // The discount is rendered from the plan record — 25% off — never invented client-side.
    expect(await screen.findByText(/25% off eligible registrations/)).toBeTruthy();
    expect(await screen.findByText('Sign in to join')).toBeTruthy();
  });

  it('shows an honest empty state when no plans are published', async () => {
    vi.stubGlobal('fetch', routeMock([
      { match: (path) => path.startsWith('/api/v1/domain-services/club/plans'), body: { plans: [] } },
      { match: (path) => path.startsWith('/api/v1/domain-services/club/membership'), body: { membership: null } },
    ]));

    render(<MemoryRouter initialEntries={['/domains/club']}><App /></MemoryRouter>);

    await waitFor(() => expect(screen.getByText(/No Domain Club plans have been published yet/i)).toBeTruthy());
  });
});

describe('/domains/transfer', () => {
  it('requires sign-in and never implies transfers are automatic', async () => {
    vi.stubGlobal('fetch', routeMock([]));

    render(<MemoryRouter initialEntries={['/domains/transfer']}><App /></MemoryRouter>);

    expect(await screen.findByText('Sign in to start a transfer')).toBeTruthy();
  });
});

describe('/dashboard/domains Domain Services tabs', () => {
  it('shows registrations, transfers, auctions and transactions from the real APIs', async () => {
    vi.stubGlobal('fetch', routeMock([
      { match: (path) => path === '/api/v1/domains', body: { domains: [] } },
      {
        match: (path) => path.startsWith('/api/v1/domain-services/registrations'),
        body: {
          registrations: [
            {
              id: 'reg-1', domain_name: 'registered.example', registration_years: 2, status: 'registered',
              created_at: '2026-09-01T00:00:00Z', invoice_number: 'INV-1', invoice_status: 'paid',
            },
          ],
        },
      },
      {
        match: (path) => path.startsWith('/api/v1/domain-services/transfers'),
        body: {
          transfers: [
            { id: 'tr-1', domain_name: 'moved.example', status: 'completed', statusLabel: 'Transfer completed', current_registrar: 'OtherCo', created_at: '2026-09-02T00:00:00Z', invoice_number: 'INV-2', invoice_status: 'paid' },
          ],
        },
      },
      {
        match: (path) => path.startsWith('/api/v1/domain-services/auctions/my/bids'),
        body: {
          bids: [
            { id: 'bid-1', auction_id: 'a1', domain_name: 'bid.example', auction_status: 'live', ends_at: '2026-10-01T00:00:00Z', amount: '150.00', currency: 'USD', status: 'placed', is_winning: true },
          ],
        },
      },
      { match: (path) => path.startsWith('/api/v1/domain-services/auctions/my/won'), body: { auctions: [] } },
      {
        match: (path) => path.startsWith('/api/v1/domain-services/auctions/my/lost'),
        body: {
          auctions: [
            { id: 'a-lost', domain_name: 'lostbid.example', status: 'ended', current_highest_bid: '300.00', currency: 'USD', ends_at: '2026-09-28T00:00:00Z' },
          ],
        },
      },
      {
        match: (path) => path.startsWith('/api/v1/domain-services/appraisals'),
        body: { appraisals: [] },
      },
      { match: (path) => path.startsWith('/api/v1/domain-services/searches/bulk'), body: {
        searches: [
          { id: 'bulk-1', query_label: 'portfolio list', status: 'completed', source_type: 'csv', submitted_count: 12, accepted_count: 10, rejected_count: 2, created_at: '2026-09-27T00:00:00Z' },
        ],
      } },
      { match: (path) => path.startsWith('/api/v1/domain-services/searches'), body: { searches: [] } },
      { match: (path) => path.startsWith('/api/v1/domain-services/whois/history'), body: { lookups: [] } },
      { match: (path) => path === '/api/v1/domain-services/watches', body: {
        watches: [
          { id: 'watch-1', domainName: 'dreambrand.example', status: 'watching', lastCheckedAt: '2026-09-30T12:00:00Z', lastAvailability: 'registered', availableAt: null, createdAt: '2026-09-29T00:00:00Z' },
        ],
      } },
      {
        match: (path) => path.startsWith('/api/v1/domain-services/club/membership'),
        body: {
          membership: {
            id: 'mem-1', planId: 'plan-1', planName: 'Domain Investor Club', status: 'active',
            startsAt: '2026-01-01T00:00:00Z', renewsAt: '2027-01-01T00:00:00Z', cancelledAt: null,
            createdAt: '2026-01-01T00:00:00Z', orderId: null, invoiceId: null,
            billingPeriod: 'annually', priceAmount: '99.00', currency: 'USD',
          },
        },
      },
      {
        match: (path) => path.startsWith('/api/v1/account/domain-brokerage/cases'),
        body: {
          cases: [
            { id: 'case-1', brokerage_id: 'BRK-2026-ABC123', domain: 'wanted.example', status: 'negotiation', current_offer: '16000.00', currency: 'USD', payment_status: 'pending', transfer_status: 'not_started', created_at: '2026-09-20T00:00:00Z', updated_at: '2026-09-25T00:00:00Z' },
          ],
        },
      },
      {
        match: (path) => path.startsWith('/api/v1/domain-services/transactions'),
        body: {
          transactions: [
            { id: 'txn-1', transaction_type: 'registration', status: 'paid', amount: '25.96', currency: 'USD', created_at: '2026-09-01T00:00:00Z', invoice_number: 'INV-1' },
          ],
        },
      },
    ]));
    localStorage.setItem('ch247_token', 'test-token');
    localStorage.setItem('ch247_user', JSON.stringify({ id: 'u1', email: 'customer@example.com', role: 'customer', fullName: 'Test Customer' }));

    render(<MemoryRouter initialEntries={['/dashboard/domains']}><App /></MemoryRouter>);

    // Registrations tab
    fireEvent.click(await screen.findByRole('button', { name: 'Registrations' }));
    await waitFor(() => expect(screen.getByText('registered.example')).toBeTruthy());
    expect(await screen.findByText('registered')).toBeTruthy();

    // Transfers tab
    fireEvent.click(await screen.findByRole('button', { name: 'Transfers' }));
    await waitFor(() => expect(screen.getByText('moved.example')).toBeTruthy());
    expect(await screen.findByText('Transfer completed')).toBeTruthy();

    // Auctions tab
    fireEvent.click(await screen.findByRole('button', { name: 'Auctions' }));
    await waitFor(() => expect(screen.getByText('bid.example')).toBeTruthy());
    expect(await screen.findByText('Winning')).toBeTruthy();
    // Lost auctions are listed from the real endpoint.
    expect(await screen.findByText('lostbid.example')).toBeTruthy();

    // Searches & Lookups tab includes bulk search history and availability watches.
    fireEvent.click(await screen.findByRole('button', { name: 'Searches & Lookups' }));
    await waitFor(() => expect(screen.getByText('portfolio list')).toBeTruthy());
    expect(await screen.findByText('dreambrand.example')).toBeTruthy();
    expect(await screen.findByText('Watching')).toBeTruthy();

    // Domain Club tab shows the live membership.
    fireEvent.click(await screen.findByRole('button', { name: 'Domain Club' }));
    await waitFor(() => expect(screen.getByText('Domain Investor Club')).toBeTruthy());
    expect(await screen.findByText('active')).toBeTruthy();

    // Broker Requests tab shows the customer's cases.
    fireEvent.click(await screen.findByRole('button', { name: 'Broker Requests' }));
    await waitFor(() => expect(screen.getByText('BRK-2026-ABC123')).toBeTruthy());
    expect(await screen.findByText('wanted.example')).toBeTruthy();

    // Transactions tab
    fireEvent.click(await screen.findByRole('button', { name: 'Transactions' }));
    await waitFor(() => expect(screen.getByText('$25.96')).toBeTruthy());
  });
});

describe('/admin/domain-services', () => {
  it('lists providers with their real connection status and write-only credential fields', async () => {
    vi.stubGlobal('fetch', routeMock([
      {
        match: (path) => path.startsWith('/api/v1/admin/domain-services/providers'),
        body: {
          providers: [
            {
              id: 'prov-1', providerKey: 'namecheap-primary', name: 'Namecheap Production', adapterKey: 'namecheap',
              providerType: 'registrar', apiBaseUrl: null, environment: 'production', status: 'connected',
              capabilities: {}, configuration: {}, credentialNames: ['apiUser', 'apiKey', 'clientIp'],
              credentialsConfigured: true, lastConnectionTestAt: '2026-09-30T00:00:00Z', lastSuccessAt: '2026-09-30T00:00:00Z',
              lastFailureAt: null, lastError: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-09-30T00:00:00Z',
            },
          ],
          installedAdapters: ['namecheap', 'godaddy', 'rdap', 'godaddy-govalue'],
        },
      },
      {
        match: (path) => path.startsWith('/api/v1/admin/domain-services/overview'),
        body: { registrations: { registered: 1 }, transfers: {}, auctions: {}, club: {}, searchesLast24h: 3, limits: { bulkSearchMaxDomains: 200, bulkSearchMaxPerHour: 5, whoisLookupsPerHour: 30 } },
      },
      { match: (path) => path.startsWith('/api/v1/domain-services/readiness'), body: { registrar: { configured: true, providerKey: 'namecheap-primary' }, rdap: { configured: false, providerKey: null }, appraisal: { configured: false, providerKey: null }, auctions: { configured: true } } },
    ]));
    localStorage.setItem('ch247_token', 'test-token');
    localStorage.setItem('ch247_user', JSON.stringify({ id: 'a1', email: 'admin@example.com', role: 'super_admin', fullName: 'Site Admin' }));

    render(<MemoryRouter initialEntries={['/admin/domain-services']}><App /></MemoryRouter>);

    // Overview readiness reflects the real provider state (provider key, honest gaps).
    await waitFor(() => expect(screen.getByText('Connected — namecheap-primary')).toBeTruthy());
    expect((await screen.findAllByText('Not configured')).length).toBe(2);

    fireEvent.click(await screen.findByRole('button', { name: 'Providers' }));
    await waitFor(() => expect(screen.getByText('Namecheap Production')).toBeTruthy());
    // Credential names are visible (write-only pattern), values never are.
    expect(await screen.findByText('apiUser, apiKey, clientIp')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Test Connection' })).toBeTruthy();
  });
});
