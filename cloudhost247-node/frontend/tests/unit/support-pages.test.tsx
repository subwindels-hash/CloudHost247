// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App';
import { clearSession, setSession } from '../../src/lib/auth';

const SIGNED_IN = { id: 'u1', email: 'ada@example.com', fullName: 'Ada Lovelace', role: 'customer' };

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  clearSession();
  vi.unstubAllGlobals();
});

describe('/support — customer support tickets', () => {
  it('redirects a signed-out visitor to /login', async () => {
    render(
      <MemoryRouter initialEntries={['/support']}>
        <App />
      </MemoryRouter>
    );
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeTruthy();
  });

  it('shows an honest empty state, then opens a new ticket and shows it in the list', async () => {
    setSession('token', SIGNED_IN);

    let ticketsCreated = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/v1/account/tickets') && init?.method === 'POST') {
          ticketsCreated = true;
          return {
            ok: true,
            status: 201,
            json: async () => ({
              ticket: { id: 't1', subject: 'Help with DNS', status: 'open', priority: 'normal', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
            }),
          };
        }
        if (url.includes('/api/v1/account/tickets')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              tickets: ticketsCreated
                ? [{ id: 't1', subject: 'Help with DNS', status: 'open', priority: 'normal', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }]
                : [],
            }),
          };
        }
        throw new Error(`Unexpected fetch: ${url}`);
      })
    );

    render(
      <MemoryRouter initialEntries={['/support']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText(/haven't opened any support tickets yet/)).toBeTruthy());

    await userEvent.type(await screen.findByLabelText('Subject'), 'Help with DNS');
    await userEvent.type(await screen.findByLabelText('Message'), 'My DNS records are not resolving.');
    await userEvent.click(await screen.findByRole('button', { name: 'Open ticket' }));

    await waitFor(() => expect(screen.getByText('Help with DNS')).toBeTruthy());
    expect(await screen.findByText(/ticket has been opened/)).toBeTruthy();
  });

  it('/support/:id shows a real ticket thread', async () => {
    setSession('token', SIGNED_IN);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          ticket: {
            id: 't1',
            subject: 'Help with DNS',
            status: 'pending_staff',
            priority: 'normal',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            closedAt: null,
            messages: [
              { id: 'm1', authorRole: 'customer', body: 'My DNS records are not resolving.', createdAt: '2026-01-01T00:00:00.000Z', isSelf: true },
            ],
          },
        }),
      })
    );

    render(
      <MemoryRouter initialEntries={['/support/t1']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Help with DNS' })).toBeTruthy());
    expect(await screen.findByText('My DNS records are not resolving.')).toBeTruthy();
    expect(await screen.findByText('You')).toBeTruthy();
  });

  it('/support/:id shows an honest not-found message for another customer\'s ticket (404, not 403)', async () => {
    setSession('token', SIGNED_IN);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: 'NOT_FOUND', message: 'No ticket was found with that id' }),
      })
    );

    render(
      <MemoryRouter initialEntries={['/support/not-mine']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('No ticket was found with that id.')).toBeTruthy());
  });
});
