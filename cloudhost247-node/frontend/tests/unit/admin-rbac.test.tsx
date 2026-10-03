// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App';
import { clearSession, setSession } from '../../src/lib/auth';

function mockFetchOnce(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  clearSession();
  vi.unstubAllGlobals();
});

describe('/admin — frontend RBAC gate (UX only, server re-verifies independently)', () => {
  it('a plain customer account sees "not available", never the customer directory UI', async () => {
    setSession('token', { id: 'u1', email: 'ada@example.com', fullName: 'Ada Lovelace', role: 'customer' });
    vi.stubGlobal('fetch', mockFetchOnce(200, { customers: [], total: 0 }));

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <App />
      </MemoryRouter>
    );

    expect(screen.getByText(/only available to CloudHost247 staff accounts/)).toBeTruthy();
    expect(screen.queryByText('Admin — Customers')).toBeNull();
  });

  it('does not show the Admin nav link to a plain customer', () => {
    setSession('token', { id: 'u1', email: 'ada@example.com', fullName: 'Ada Lovelace', role: 'customer' });
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <App />
      </MemoryRouter>
    );
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull();
  });

  it('shows the Admin nav link, and the real customer directory, to an admin account', async () => {
    setSession('token', { id: 'staff1', email: 'staff@example.com', fullName: 'Staff Member', role: 'admin' });
    vi.stubGlobal(
      'fetch',
      mockFetchOnce(200, {
        customers: [{ id: 'u1', email: 'ada@example.com', fullName: 'Ada Lovelace', role: 'customer', status: 'active', createdAt: '2026-01-01T00:00:00.000Z' }],
        total: 1,
      })
    );

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Admin — Customers' })).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy());
  });

  it('shows a visible error banner if the directory API rejects the request (e.g. a stale/incorrect local role)', async () => {
    setSession('token', { id: 'staff1', email: 'staff@example.com', fullName: 'Staff Member', role: 'admin' });
    vi.stubGlobal('fetch', mockFetchOnce(403, { error: 'FORBIDDEN', message: 'Insufficient permissions for this action' }));

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(await screen.findByText(/does not have permission to view the customer directory/)).toBeTruthy();
  });
});
