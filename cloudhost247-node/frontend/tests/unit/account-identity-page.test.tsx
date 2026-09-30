// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App';
import SupportModeBanner from '../../src/components/SupportModeBanner';
import { clearSession, clearSupportOrigin, getToken, setSession, setSupportOrigin } from '../../src/lib/auth';

const SIGNED_IN = { id: 'u1', email: 'ada@example.com', fullName: 'Ada Lovelace', role: 'customer' };

const ACCOUNT = {
  id: 'u1',
  email: 'ada@example.com',
  fullName: 'Ada Lovelace',
  role: 'customer',
  status: 'active',
  customerId: '048291',
  phone: '+2348000000000',
  addressLine1: null,
  city: 'Abuja',
  state: 'FCT',
  postalCode: null,
  country: 'NG',
  hasProfileImage: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const STATUS = {
  initialized: true,
  version: 3,
  createdAt: '2026-09-30T08:00:00.000Z',
  expiresAt: '2026-10-01T08:00:00.000Z',
  expired: false,
  secondsUntilExpiry: 3600,
  rotationHours: 24,
};

function json(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  clearSession();
  clearSupportOrigin();
  vi.unstubAllGlobals();
});

describe('/account — customer identity and Security Number', () => {
  function stubApi(overrides: (url: string, init?: RequestInit) => unknown | undefined = () => undefined) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const override = overrides(url, init);
        if (override) return override;
        if (url.endsWith('/api/v1/account')) return json({ user: ACCOUNT });
        if (url.includes('/security-number/status')) return json({ securityNumber: STATUS, rotated: false });
        if (url.includes('/api/auth/me')) return json({ user: ACCOUNT, supportSession: null });
        return json({});
      })
    );
  }

  it('shows the permanent Customer ID and the Security Number status, but never a value', async () => {
    setSession('token', SIGNED_IN);
    stubApi();

    render(
      <MemoryRouter initialEntries={['/account']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByTestId('customer-id').textContent).toBe('048291'));
    expect(screen.getByText('24 hours')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
    // Nothing that looks like a four-digit credential is rendered before an explicit reveal.
    expect(screen.queryByTestId('revealed-security-number')).toBeNull();
  });

  it('reveals a new Security Number only after the password is confirmed, and keeps it out of storage', async () => {
    setSession('token', SIGNED_IN);
    stubApi((url, init) =>
      url.includes('/security-number/reveal') && init?.method === 'POST'
        ? json({ securityNumber: { value: '7421', version: 4, expiresAt: STATUS.expiresAt, displayTtlSeconds: 120 } })
        : undefined
    );

    render(
      <MemoryRouter initialEntries={['/account']}>
        <App />
      </MemoryRouter>
    );

    await screen.findByTestId('customer-id');
    await userEvent.type(
      screen.getByLabelText('Confirm your password to see a new Security Number'),
      'correct-horse-battery'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Show my Security Number' }));

    await waitFor(() => expect(screen.getByTestId('revealed-security-number').textContent).toBe('7421'));
    expect(JSON.stringify(localStorage)).not.toContain('7421');
  });

  it('surfaces a failed step-up without logging the customer out', async () => {
    setSession('token', SIGNED_IN);
    stubApi((url, init) =>
      url.includes('/security-number/reveal') && init?.method === 'POST'
        ? json({ error: 'UNAUTHORIZED', message: 'Password is incorrect' }, 400)
        : undefined
    );

    render(
      <MemoryRouter initialEntries={['/account']}>
        <App />
      </MemoryRouter>
    );

    await screen.findByTestId('customer-id');
    await userEvent.type(screen.getByLabelText('Confirm your password to see a new Security Number'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Show my Security Number' }));

    await waitFor(() => expect(screen.getByText('Password is incorrect')).toBeTruthy());
    expect(getToken()).toBe('token');
  });
});

describe('support mode banner', () => {
  it('warns for the whole session and restores the administrator on exit', async () => {
    setSession('delegated-token', { id: 'u1', email: 'ada@example.com', fullName: 'Ada Lovelace', role: 'customer' });
    setSupportOrigin({
      token: 'admin-token',
      user: { id: 'a1', email: 'admin@example.com', fullName: 'Admin Person', role: 'admin' },
      sessionId: 's1',
      targetName: 'Ada Lovelace',
      targetCustomerId: '048291',
      expiresAt: '2026-09-30T12:00:00.000Z',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/auth/me')) {
          return json({
            user: ACCOUNT,
            supportSession: { id: 's1', originalAdminId: 'a1', expiresAt: '2026-09-30T12:00:00.000Z' },
          });
        }
        return json({});
      })
    );

    render(
      <MemoryRouter initialEntries={['/account']}>
        <SupportModeBanner />
      </MemoryRouter>
    );

    const banner = await screen.findByTestId('support-mode-banner');
    expect(banner.textContent).toContain('Support mode');
    expect(banner.textContent).toContain('Ada Lovelace');
    expect(banner.textContent).toContain('048291');

    await userEvent.click(screen.getByRole('button', { name: 'Exit support mode' }));

    // The administrator's own token is restored and the parked copy is cleared.
    await waitFor(() => expect(getToken()).toBe('admin-token'));
    expect(localStorage.getItem('ch247_support_origin')).toBeNull();
  });
});
