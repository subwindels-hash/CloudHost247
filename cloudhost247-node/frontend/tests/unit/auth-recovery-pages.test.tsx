// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => localStorage.clear());

describe('public account recovery pages', () => {
  it('shows the same neutral completion view after requesting a reset', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 202, json: async () => ({ message: 'accepted' }) }));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter initialEntries={['/forgot-password']}>
        <App />
      </MemoryRouter>
    );

    await userEvent.type(await screen.findByLabelText('Email address'), 'customer@example.com');
    await userEvent.click(await screen.findByRole('button', { name: 'Send reset link' }));
    await waitFor(() => expect(screen.getByText(/If an active account matches that email address/i)).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/password-reset/request',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ email: 'customer@example.com' }) })
    );
  });

  it('consumes a reset token then removes it from the visible route before showing login', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ message: 'Password reset complete.' }) })));
    render(
      <MemoryRouter initialEntries={['/reset-password?token=abcdefghijklmnopqrstuvwxyz1234567890_ABCDE']}>
        <App />
      </MemoryRouter>
    );

    await userEvent.type(await screen.findByLabelText('New password'), 'new-correct-horse-battery');
    await userEvent.type(await screen.findByLabelText('Confirm new password'), 'new-correct-horse-battery');
    await userEvent.click(await screen.findByRole('button', { name: 'Reset password' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Log in' })).toBeTruthy());
    expect(await screen.findByText('Password reset complete.')).toBeTruthy();
  });
});
