// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App';
import { clearSession, getToken, setSession } from '../../src/lib/auth';

const SIGNED_IN = { id: 'u1', email: 'ada@example.com', fullName: 'Ada Lovelace', role: 'customer' };

function meResponse(fullName = 'Ada Lovelace') {
  return { ok: true, status: 200, json: async () => ({ user: { id: 'u1', email: 'ada@example.com', fullName, role: 'customer', status: 'active' } }) };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  clearSession();
  vi.unstubAllGlobals();
});

describe('/account — self-service profile edit and password change', () => {
  it('edits and saves the full name', async () => {
    setSession('token', SIGNED_IN);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/v1/account/profile') && init?.method === 'PATCH') {
          return { ok: true, status: 200, json: async () => ({ user: { id: 'u1', email: 'ada@example.com', fullName: 'Ada L.', role: 'customer', status: 'active' } }) };
        }
        return meResponse();
      })
    );

    render(
      <MemoryRouter initialEntries={['/account']}>
        <App />
      </MemoryRouter>
    );

    const nameInput = await screen.findByDisplayValue('Ada Lovelace');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Ada L.');
    await userEvent.click(screen.getByRole('button', { name: 'Save name' }));

    await waitFor(() => expect(screen.getByText('Your name has been updated.')).toBeTruthy());
  });

  it('shows a real error when the current password is wrong, and does not claim success', async () => {
    setSession('token', SIGNED_IN);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/v1/account/password')) {
          // Deliberately 400, not 401 — see src/routes/account.ts: a wrong currentPassword must
          // never be treated by apiFetch as "this session's token itself is dead" (which would
          // otherwise silently log the customer out of the whole app for a simple typo).
          return { ok: false, status: 400, json: async () => ({ error: 'VALIDATION_ERROR', message: 'Current password is incorrect' }) };
        }
        return meResponse();
      })
    );

    render(
      <MemoryRouter initialEntries={['/account']}>
        <App />
      </MemoryRouter>
    );

    await screen.findByDisplayValue('Ada Lovelace');
    await userEvent.type(screen.getByLabelText('Current password'), 'wrong-password');
    await userEvent.type(screen.getByLabelText('New password (min 10 characters)'), 'brand-new-password');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));

    await waitFor(() => expect(screen.getByText('Current password is incorrect')).toBeTruthy());
    // Regression guard for a real bug found during Phase 4 development: a wrong current password
    // must never be treated as "this session's token is dead" — the customer must stay logged in
    // and stay on /account, not get silently bounced to /login (see src/routes/account.ts and
    // frontend/src/lib/api.ts for the full explanation).
    expect(getToken()).toBe('token');
    expect(screen.queryByRole('heading', { name: 'Log in' })).toBeNull();
  });

  it('shows a success message (and the session-invalidation notice) on a real password change', async () => {
    setSession('token', SIGNED_IN);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/v1/account/password')) {
          return { ok: true, status: 204, json: async () => undefined };
        }
        return meResponse();
      })
    );

    render(
      <MemoryRouter initialEntries={['/account']}>
        <App />
      </MemoryRouter>
    );

    await screen.findByDisplayValue('Ada Lovelace');
    await userEvent.type(screen.getByLabelText('Current password'), 'correct-password');
    await userEvent.type(screen.getByLabelText('New password (min 10 characters)'), 'brand-new-password');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));

    await waitFor(() => expect(screen.getByText(/Your password has been changed/)).toBeTruthy());
  });
});
