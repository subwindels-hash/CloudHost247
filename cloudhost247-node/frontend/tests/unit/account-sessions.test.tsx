// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App';
import { clearSession, setSession } from '../../src/lib/auth';
import type { AccountSession } from '../../src/lib/account-types';

/**
 * Phase 6 (security) — the Sessions card and the security-event history on /account.
 *
 * These pin the honest states rather than the happy path alone: a failed load must say it failed
 * (never render an empty list that reads as "you have no other sessions"), the revoke action must
 * call the real endpoint and report what happened, and an unmapped event type must render as
 * itself rather than being dressed up.
 */
const SIGNED_IN = { id: 'u1', email: 'ada@example.com', fullName: 'Ada Lovelace', role: 'customer' };

function session(overrides: Partial<AccountSession> = {}): AccountSession {
  return {
    id: 's1',
    userAgent: 'Chrome on macOS',
    ipAddress: '203.0.113.9',
    createdAt: '2026-11-22T10:00:00.000Z',
    lastSeenAt: '2026-11-22T10:05:00.000Z',
    expiresAt: '2066-11-22T10:00:00.000Z',
    revokedAt: null,
    revokedReason: null,
    current: true,
    ...overrides,
  };
}

interface MockOptions {
  sessions?: AccountSession[];
  sessionsStatus?: number;
  events?: Array<{ id: string; type: string; createdAt: string }>;
  eventsStatus?: number;
  revokeImpl?: (url: string, init?: RequestInit) => Promise<unknown>;
}

function stubFetch(options: MockOptions = {}) {
  const calls: Array<{ url: string; method: string }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';
      calls.push({ url, method });

      if (url.includes('/api/v1/account/security/sessions') && method === 'DELETE') {
        if (options.revokeImpl) return options.revokeImpl(url, init);
        return { ok: true, status: 200, json: async () => ({ revoked: true, sessionId: 's2', current: false }) };
      }
      if (url.includes('/api/v1/account/security/sessions/revoke-others')) {
        return { ok: true, status: 200, json: async () => ({ revoked: 1, keptCurrentSession: true }) };
      }
      if (url.includes('/api/v1/account/security/sessions')) {
        if (options.sessionsStatus) return { ok: false, status: options.sessionsStatus, json: async () => ({}) };
        return {
          ok: true,
          status: 200,
          json: async () => ({ sessions: options.sessions ?? [], recordedOnly: true }),
        };
      }
      if (url.includes('/api/v1/account/security/events')) {
        if (options.eventsStatus) return { ok: false, status: options.eventsStatus, json: async () => ({}) };
        return {
          ok: true,
          status: 200,
          json: async () => ({
            events: (options.events ?? []).map((event) => ({
              id: event.id,
              type: event.type,
              ipAddress: null,
              userAgent: null,
              metadata: {},
              createdAt: event.createdAt,
            })),
            limit: 20,
          }),
        };
      }
      if (url.includes('/api/v1/account/security-number')) {
        return { ok: true, status: 200, json: async () => ({ securityNumber: null }) };
      }
      if (url.includes('/api/v1/account/security')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            account: { username: 'ada', usernameChangedAt: null, customerId: '123456789', email: 'ada@example.com', emailVerified: true },
            securityPin: { set: true },
            securityNumber: { initialized: false },
          }),
        };
      }
      if (url.includes('/api/v1/auth/mfa/status')) {
        return { ok: true, status: 200, json: async () => ({ mfa: { enabled: false, recoveryCodesRemaining: 0 } }) };
      }
      if (url.includes('/api/v1/auth/passkeys')) {
        return { ok: true, status: 200, json: async () => ({ passkeys: [] }) };
      }
      if (url.includes('/api/v1/account/profile')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            user: {
              id: 'u1',
              email: 'ada@example.com',
              fullName: 'Ada Lovelace',
              role: 'customer',
              status: 'active',
              hasProfileImage: false,
            },
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          user: { id: 'u1', email: 'ada@example.com', fullName: 'Ada Lovelace', role: 'customer', status: 'active', emailVerified: true },
        }),
      };
    })
  );
  return calls;
}

beforeEach(() => {
  localStorage.clear();
  setSession('token', SIGNED_IN);
});

afterEach(() => {
  cleanup();
  clearSession();
  vi.unstubAllGlobals();
});

describe('/account — sessions and security events', () => {
  it('lists the recorded sessions, marking the one you are using now', async () => {
    stubFetch({
      sessions: [
        session({ id: 's1', userAgent: 'Chrome on macOS', current: true }),
        session({ id: 's2', userAgent: 'Safari on iPhone', current: false, ipAddress: null }),
      ],
    });

    render(
      <MemoryRouter initialEntries={['/account']}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByText('Chrome on macOS')).toBeTruthy();
    expect(screen.getByText('(this device)')).toBeTruthy();
    expect(screen.getByText('Safari on iPhone')).toBeTruthy();
    // Only offered when there is more than one session to revoke.
    expect(screen.getByRole('button', { name: 'Sign out every other device' })).toBeTruthy();
  });

  it('revokes a session through the real endpoint and reports the result', async () => {
    const calls = stubFetch({
      sessions: [session({ id: 's1', current: true }), session({ id: 's2', userAgent: 'Safari on iPhone', current: false })],
    });

    render(
      <MemoryRouter initialEntries={['/account']}>
        <App />
      </MemoryRouter>
    );

    const revoke = await screen.findAllByRole('button', { name: 'Revoke' });
    await userEvent.click(revoke[1]!);

    await waitFor(() => expect(screen.getByText(/session has been revoked/)).toBeTruthy());
    const deleteCall = calls.find((call) => call.method === 'DELETE');
    expect(deleteCall?.url).toContain('/api/v1/account/security/sessions/');
  });

  it('says when the session list could not be loaded instead of showing an empty list', async () => {
    stubFetch({ sessionsStatus: 500 });

    render(
      <MemoryRouter initialEntries={['/account']}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByText("Couldn't load your sessions right now.")).toBeTruthy();
    expect(screen.queryByText('No sessions have been recorded for your account yet.')).toBeNull();
  });

  it('shows the empty state only when the server really returned no sessions', async () => {
    stubFetch({ sessions: [] });

    render(
      <MemoryRouter initialEntries={['/account']}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByText('No sessions have been recorded for your account yet.')).toBeTruthy();
  });

  it('renders security events with human labels, and an unmapped type as itself', async () => {
    stubFetch({
      events: [
        { id: 'e1', type: 'login_success', createdAt: '2026-11-22T10:00:00.000Z' },
        { id: 'e2', type: 'something_new', createdAt: '2026-11-22T09:00:00.000Z' },
      ],
    });

    render(
      <MemoryRouter initialEntries={['/account']}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByText('Signed in')).toBeTruthy();
    // Not hidden, not relabelled into something it is not.
    expect(screen.getByText('something_new')).toBeTruthy();
  });
});
