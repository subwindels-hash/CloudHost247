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
  customerId: '048291437',
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

    await waitFor(() => expect(screen.getByTestId('customer-id').textContent).toBe('048291437'));
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
      targetCustomerId: '048291437',
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
    expect(banner.textContent).toContain('048291437');

    await userEvent.click(screen.getByRole('button', { name: 'Exit support mode' }));

    // The administrator's own token is restored and the parked copy is cleared.
    await waitFor(() => expect(getToken()).toBe('admin-token'));
    expect(localStorage.getItem('ch247_support_origin')).toBeNull();
  });
});

/**
 * The Security PIN gate: the value is only ever obtained through a six-digit email code, and only
 * once per challenge. These tests pin down the three properties that matter to a customer-facing
 * page: nothing is shown before verification, the reveal is transient, and a failure is reported
 * without pretending otherwise.
 */
describe('/account — rotating Security PIN gate', () => {
  const ACCOUNT_PAYLOAD = {
    id: 'u1',
    email: 'ada@example.com',
    fullName: 'Ada Lovelace',
    role: 'customer',
    status: 'active',
    customerId: '048291437',
    username: 'ada.l',
    emailVerified: true,
    phone: null,
    addressLine1: null,
    city: null,
    state: null,
    postalCode: null,
    country: 'NG',
    hasProfileImage: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  const SECURITY = {
    account: {
      username: 'ada.l',
      usernameChangedAt: null,
      customerId: '048291437',
      email: 'ada@example.com',
      emailVerified: true,
    },
    securityPin: {
      maskedValue: '••••',
      set: true,
      version: 7,
      lastRotatedAt: '2026-11-08T06:00:00.000Z',
      nextRotationAt: '2026-11-09T06:00:00.000Z',
      secondsUntilRotation: 82_000,
      rotationHours: 24,
      revealDisplayTtlSeconds: 30,
      verificationCodeTtlMinutes: 10,
      resendCooldownSeconds: 3,
      maxAttempts: 5,
      canView: true,
      viewRequiresEmailVerification: true,
      emailVerificationConfigured: true,
    },
    securityNumber: STATUS,
  };

  function stub(overrides: (url: string, init?: RequestInit) => unknown | undefined = () => undefined) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const override = overrides(url, init);
        if (override) return override;
        if (url.endsWith('/api/v1/account/security')) return json(SECURITY);
        if (url.endsWith('/api/v1/account')) return json({ user: ACCOUNT_PAYLOAD });
        if (url.includes('/security-number/status')) return json({ securityNumber: STATUS, rotated: false });
        if (url.includes('/api/auth/me')) return json({ user: ACCOUNT_PAYLOAD, supportSession: null });
        return json({});
      })
    );
  }

  function renderAccount() {
    render(
      <MemoryRouter initialEntries={['/account']}>
        <App />
      </MemoryRouter>
    );
  }

  it('shows only a mask until an email code has been verified', async () => {
    setSession('token', SIGNED_IN);
    stub();
    renderAccount();

    await waitFor(() => expect(screen.getByTestId('security-pin-masked').textContent).toBe('••••'));
    expect(screen.queryByTestId('revealed-security-pin')).toBeNull();
    // The value slot is a mask and nothing else — no digits at all, so no partial PIN either.
    expect(screen.getByTestId('security-pin-masked').textContent).toBe('••••');
    expect(screen.getByTestId('security-pin-masked').textContent).not.toMatch(/\d/);
  });

  it('walks view → verify → reveal, then hides the value without storing it', async () => {
    setSession('token', SIGNED_IN);
    stub((url, init) => {
      if (url.endsWith('/security-pin/view') && init?.method === 'POST') {
        return json({
          challenge: {
            challengeToken: 'challenge-1',
            maskedEmail: 'a••@example.com',
            expiresAt: '2026-11-08T07:10:00.000Z',
            codeTtlMinutes: 10,
            resendAvailableInSeconds: 3,
            maxAttempts: 5,
            maxResends: 3,
          },
          message: 'An email with your 6-digit code has been sent to your registered email address.',
        });
      }
      if (url.endsWith('/security-pin/verify') && init?.method === 'POST') {
        return json({ verified: true, message: 'Verified. You can now reveal your Security PIN.' });
      }
      if (url.endsWith('/security-pin/reveal') && init?.method === 'POST') {
        return json({
          securityPin: {
            value: '8042',
            version: 7,
            expiresAt: '2026-11-09T06:00:00.000Z',
            displayTtlSeconds: 30,
          },
        });
      }
      return undefined;
    });
    renderAccount();

    await screen.findByTestId('security-pin-masked');
    await userEvent.click(screen.getByTestId('request-security-pin'));

    const code = await screen.findByLabelText(/Six-digit code sent to/);
    await userEvent.type(code, '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify and show my PIN' }));

    await waitFor(() => expect(screen.getByTestId('revealed-security-pin').textContent).toBe('8042'));
    // The value is transient UI state: it is never written to storage.
    expect(JSON.stringify(localStorage)).not.toContain('8042');

    await userEvent.click(screen.getByRole('button', { name: 'Hide it now' }));
    await waitFor(() => expect(screen.queryByTestId('revealed-security-pin')).toBeNull());
  });

  it('reports a wrong code honestly and keeps the challenge open', async () => {
    setSession('token', SIGNED_IN);
    stub((url, init) => {
      if (url.endsWith('/security-pin/view') && init?.method === 'POST') {
        return json({
          challenge: {
            challengeToken: 'challenge-2',
            maskedEmail: 'a••@example.com',
            expiresAt: '2026-11-08T07:10:00.000Z',
            codeTtlMinutes: 10,
            resendAvailableInSeconds: 3,
            maxAttempts: 5,
            maxResends: 3,
          },
          message: 'Code sent.',
        });
      }
      if (url.endsWith('/security-pin/verify') && init?.method === 'POST') {
        return json(
          { error: 'VERIFICATION_CODE_INVALID', message: 'That code is not correct. 4 attempts remaining.' },
          400
        );
      }
      return undefined;
    });
    renderAccount();

    await screen.findByTestId('security-pin-masked');
    await userEvent.click(screen.getByTestId('request-security-pin'));
    await userEvent.type(await screen.findByLabelText(/Six-digit code/), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Verify and show my PIN' }));

    expect(await screen.findByText(/That code is not correct/)).toBeTruthy();
    expect(screen.queryByTestId('revealed-security-pin')).toBeNull();
    // The form is still there, so the customer can correct a typo instead of starting over.
    expect(screen.getByLabelText(/Six-digit code/)).toBeTruthy();
  });

  it('keeps the gate shut, with an explanation, when the email is unverified', async () => {
    setSession('token', SIGNED_IN);
    stub((url) => {
      if (url.endsWith('/api/v1/account/security')) {
        return json({
          ...SECURITY,
          account: { ...SECURITY.account, emailVerified: false },
          securityPin: { ...SECURITY.securityPin, canView: false },
        });
      }
      if (url.endsWith('/api/v1/account')) {
        return json({ user: { ...ACCOUNT_PAYLOAD, emailVerified: false } });
      }
      return undefined;
    });
    renderAccount();

    await screen.findByTestId('security-pin-masked');
    expect(screen.getByText(/Verify your email address above before you can view your Security PIN/)).toBeTruthy();
    expect((screen.getByTestId('request-security-pin') as HTMLButtonElement).disabled).toBe(true);
  });
});
