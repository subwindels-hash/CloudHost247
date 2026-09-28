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

  it('redirects a signed-out visitor navigating directly to /dashboard to /login', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <App />
      </MemoryRouter>
    );

    // The login form, not any dashboard content, is what actually renders.
    expect(screen.getByRole('heading', { name: 'Log in' })).toBeTruthy();
  });

  it('shows real account data for a signed-in visitor', async () => {
    setSession('a-token', { id: 'u1', email: 'ada@example.com', fullName: 'Ada Lovelace', role: 'customer' });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ user: { id: 'u1', email: 'ada@example.com', fullName: 'Ada Lovelace', role: 'customer' } }),
      })
    );

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText(/Welcome back, Ada Lovelace/)).toBeTruthy());
    // No fabricated billing/services/orders data — only honest "not migrated yet" notices.
    expect(screen.getAllByText(/hasn't been migrated to this platform yet/i).length).toBeGreaterThan(0);

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
