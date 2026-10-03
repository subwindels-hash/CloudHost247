// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App';
import { clearSession, setSession } from '../../src/lib/auth';

function mockFetchOnce(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
}

const SIGNED_IN = { id: 'u1', email: 'ada@example.com', fullName: 'Ada Lovelace', role: 'customer' };

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  clearSession();
  vi.unstubAllGlobals();
});

describe('/services — customer\'s own passive service records', () => {
  it('redirects a signed-out visitor to /login', async () => {
    render(
      <MemoryRouter initialEntries={['/services']}>
        <App />
      </MemoryRouter>
    );
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeTruthy();
  });

  it('shows an honest empty state when the account has no services', async () => {
    setSession('token', SIGNED_IN);
    vi.stubGlobal('fetch', mockFetchOnce(200, { services: [] }));

    render(
      <MemoryRouter initialEntries={['/services']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText(/No services have been added to your account yet/)).toBeTruthy());
  });

  it('renders real service records from the API, including resolved product/plan names', async () => {
    setSession('token', SIGNED_IN);
    vi.stubGlobal(
      'fetch',
      mockFetchOnce(200, {
        services: [
          {
            id: 's1',
            label: 'My cPanel account',
            status: 'active',
            productSlug: 'cpanel-hosting',
            productName: 'cPanel Hosting',
            planSlug: 'plan-a',
            planName: 'Plan A',
            externalReference: null,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      })
    );

    render(
      <MemoryRouter initialEntries={['/services']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('My cPanel account')).toBeTruthy());
    expect(await screen.findByText('cPanel Hosting — Plan A')).toBeTruthy();
    expect(await screen.findByText('active')).toBeTruthy();
  });

  it('shows a visible error banner, not a blank page, when the API fails', async () => {
    setSession('token', SIGNED_IN);
    vi.stubGlobal('fetch', mockFetchOnce(500, { error: 'INTERNAL', message: 'Something broke' }));

    render(
      <MemoryRouter initialEntries={['/services']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(await screen.findByText('Something broke')).toBeTruthy();
  });
});

describe('/account/domains — customer\'s own passive domain records', () => {
  it('shows an honest empty state when the account has no domains', async () => {
    setSession('token', SIGNED_IN);
    vi.stubGlobal('fetch', mockFetchOnce(200, { domains: [] }));

    render(
      <MemoryRouter initialEntries={['/account/domains']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText(/No domains have been added to your account yet/)).toBeTruthy());
  });

  it('renders real domain records from the API', async () => {
    setSession('token', SIGNED_IN);
    vi.stubGlobal(
      'fetch',
      mockFetchOnce(200, {
        domains: [
          {
            id: 'd1',
            domainName: 'example.com',
            registrar: 'Example Registrar',
            status: 'active',
            expiresAt: '2027-01-01',
            externalReference: null,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      })
    );

    render(
      <MemoryRouter initialEntries={['/account/domains']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('example.com')).toBeTruthy());
    expect(await screen.findByText('Example Registrar')).toBeTruthy();
  });
});
