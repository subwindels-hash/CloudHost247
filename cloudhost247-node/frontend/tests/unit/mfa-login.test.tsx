// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App';
import { clearSession, getStoredUser, getToken } from '../../src/lib/auth';

afterEach(() => {
  cleanup();
  clearSession();
  vi.unstubAllGlobals();
});

beforeEach(() => localStorage.clear());

describe('MFA login continuation', () => {
  it('keeps the MFA continuation token out of session storage until the second factor succeeds', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/auth/login') {
        return { ok: true, status: 202, json: async () => ({ mfaRequired: true, mfaToken: 'M'.repeat(43) }) };
      }
      if (url === '/api/auth/mfa/login/verify') {
        expect(JSON.parse(String(init?.body))).toEqual({ mfaToken: 'M'.repeat(43), code: '123456' });
        return {
          ok: true,
          status: 200,
          json: async () => ({ token: 'final-session-token', user: { id: 'u1', email: 'mfa@example.com', fullName: 'Mfa User', role: 'customer' } }),
        };
      }
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>
    );

    await userEvent.type(screen.getByPlaceholderText('Email'), 'mfa@example.com');
    await userEvent.type(screen.getByPlaceholderText('Password'), 'correct-horse-battery');
    await userEvent.click(screen.getByRole('button', { name: 'Login' }));
    await screen.findByLabelText('Multi-factor authentication code');
    expect(getToken()).toBeNull();
    expect(JSON.stringify(localStorage)).not.toContain('M'.repeat(43));

    await userEvent.type(screen.getByLabelText('Multi-factor authentication code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify and log in' }));
    await waitFor(() => expect(getToken()).toBe('final-session-token'));
    expect(getStoredUser()?.email).toBe('mfa@example.com');
  });
});
