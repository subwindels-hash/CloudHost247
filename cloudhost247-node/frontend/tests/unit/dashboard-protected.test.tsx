// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App';
import { clearSession, setSession } from '../../src/lib/auth';

/**
 * End-to-end (at the frontend routing level) proof that /dashboard is a real protected route
 * wired into the actual app router (App.tsx), not just a unit test of RequireAuth in isolation.
 */
describe('/dashboard end-to-end route protection', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('redirects a signed-out visitor navigating directly to /dashboard to /login', async () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <App />
      </MemoryRouter>
    );

    // The login form, not any dashboard content, is what actually renders.
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeTruthy();
  });

  it('shows real account data for a signed-in visitor, including real (empty) services/domains/tickets/installations', async () => {
    setSession('a-token', { id: 'u1', email: 'ada@example.com', fullName: 'Ada Lovelace', role: 'customer' });

    // Phase 4: the dashboard now also calls the real /api/v1/account/* endpoints, so the mock
    // must branch on URL rather than returning one fixed body for every call.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/auth/me')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ user: { id: 'u1', email: 'ada@example.com', fullName: 'Ada Lovelace', role: 'customer' } }),
          };
        }
        if (url.includes('/api/v1/account/services')) {
          return { ok: true, status: 200, json: async () => ({ services: [] }) };
        }
        if (url.includes('/api/v1/account/domains')) {
          return { ok: true, status: 200, json: async () => ({ domains: [] }) };
        }
        if (url.includes('/api/v1/account/tickets')) {
          return { ok: true, status: 200, json: async () => ({ tickets: [] }) };
        }
        // Phase 6: the dashboard also loads the customer's application installations.
        if (url.includes('/api/v1/app-installations')) {
          return { ok: true, status: 200, json: async () => ({ installations: [] }) };
        }
        throw new Error(`Unexpected fetch in test: ${url}`);
      })
    );

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText(/Welcome back, Ada Lovelace/)).toBeTruthy());
    // Billing is real since Phase 5 — the dashboard links to it instead of a placeholder.
    await waitFor(() => expect(screen.getByText(/Orders, invoices, and payment history live under Billing./i)).toBeTruthy());
    // Services/domains/tickets/installations are real, API-backed — an empty result renders an
    // honest "nothing added yet" state, never a "not migrated" placeholder and never fabricated data.
    await waitFor(() => expect(screen.getByText(/No services have been added to your account yet/i)).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/No domains have been added to your account yet/i)).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/You have no open support tickets/i)).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/No applications installed yet/i)).toBeTruthy());

    clearSession();
  });

  it('sends a signed-in visitor whose token has actually been revoked back to /login', async () => {
    setSession('a-revoked-token', { id: 'u1', email: 'ada@example.com', fullName: 'Ada Lovelace', role: 'customer' });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: 'UNAUTHORIZED', message: 'This session has been logged out' }),
      })
    );

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Log in' })).toBeTruthy());
  });
});
