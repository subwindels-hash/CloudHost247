// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App';
import { clearSession, getToken } from '../../src/lib/auth';

afterEach(() => {
  cleanup();
  clearSession();
  vi.unstubAllGlobals();
});

beforeEach(() => localStorage.clear());

/**
 * Registration had no test at all: the page could lose its confirm-password check, its
 * terms acknowledgement or its labels and nothing in the suite would notice. These cover the
 * three client-side rules the page is responsible for, plus the happy path that still calls the
 * one registration endpoint with exactly the three fields the server accepts.
 */
/**
 * The app shell loads a few read-only resources on mount, so "no request was made" has to mean
 * "no registration request was made" rather than "fetch was never called".
 */
function registrationCalls(mock: ReturnType<typeof vi.fn>) {
  return mock.mock.calls.filter(([url]) => url === '/api/auth/register');
}

function emptyResponse() {
  return { ok: false, status: 404, json: async () => ({}) };
}

describe('Registration page', () => {
  function renderRegister() {
    render(
      <MemoryRouter initialEntries={['/register']}>
        <App />
      </MemoryRouter>
    );
  }

  it('labels every field and does not submit until the password is confirmed', async () => {
    const fetchMock = vi.fn(async () => emptyResponse());
    vi.stubGlobal('fetch', fetchMock);
    renderRegister();

    await userEvent.type(await screen.findByLabelText('Full name'), 'Ada Lovelace');
    await userEvent.type(screen.getByLabelText('Email address'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-battery');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'correct-horse-batterY');
    await userEvent.click(screen.getByRole('button', { name: 'Register' }));

    expect(await screen.findByText('The two passwords do not match.')).toBeTruthy();
    expect(registrationCalls(fetchMock)).toHaveLength(0);
  });

  it('requires the terms acknowledgement before creating the account', async () => {
    const fetchMock = vi.fn(async () => emptyResponse());
    vi.stubGlobal('fetch', fetchMock);
    renderRegister();

    await userEvent.type(await screen.findByLabelText('Full name'), 'Ada Lovelace');
    await userEvent.type(screen.getByLabelText('Email address'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-battery');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'correct-horse-battery');
    await userEvent.click(screen.getByRole('button', { name: 'Register' }));

    expect(
      await screen.findByText('Accept the terms of service and privacy policy to continue.')
    ).toBeTruthy();
    expect(registrationCalls(fetchMock)).toHaveLength(0);
  });

  it('rejects a short password before it reaches the API', async () => {
    const fetchMock = vi.fn(async () => emptyResponse());
    vi.stubGlobal('fetch', fetchMock);
    renderRegister();

    await userEvent.type(await screen.findByLabelText('Full name'), 'Ada Lovelace');
    await userEvent.type(screen.getByLabelText('Email address'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'short');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'short');
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Register' }));

    expect(await screen.findByText('Use at least 10 characters.')).toBeTruthy();
    expect(registrationCalls(fetchMock)).toHaveLength(0);
  });

  it('posts the three accepted fields and stores the session on success', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url !== '/api/auth/register') return emptyResponse();
      expect(url).toBe('/api/auth/register');
      expect(JSON.parse(String(init?.body))).toEqual({
        fullName: 'Ada Lovelace',
        email: 'ada@example.com',
        password: 'correct-horse-battery',
      });
      return {
        ok: true,
        status: 201,
        json: async () => ({
          token: 'register-session-token',
          user: { id: 'u1', email: 'ada@example.com', fullName: 'Ada Lovelace', role: 'customer' },
          emailVerification: { queued: true },
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    renderRegister();

    await userEvent.type(await screen.findByLabelText('Full name'), 'Ada Lovelace');
    await userEvent.type(screen.getByLabelText('Email address'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-battery');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'correct-horse-battery');
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Register' }));

    await waitFor(() => expect(getToken()).toBe('register-session-token'));
    expect(registrationCalls(fetchMock)).toHaveLength(1);
  });
});
