// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Header from '../../src/layout/Header';
import { clearSession, getToken, setSession } from '../../src/lib/auth';

/**
 * Authentication-aware navigation: the shared header must show exactly the right controls for
 * each auth state (see App.tsx / Header.tsx for the full nav contract), and "Log out" must be a
 * real action, not a decorative button — it calls the server-side logout endpoint (so the token is
 * actually invalidated, see database/migrations/0003_create_revoked_tokens.sql) and clears the
 * local session either way.
 */
describe('Header: authentication-aware navigation', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('shows Sign In / Create Account, and no account controls, when logged out', () => {
    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: 'Sign In' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Create Account' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Dashboard' })).toBeNull();
    expect(screen.queryByText('Log out')).toBeNull();
  });

  it('shows Dashboard, an account link, and Log out — and no Sign In/Create Account — when logged in', () => {
    setSession('fake-token', { id: 'u1', email: 'grace@example.com', fullName: 'Grace Hopper', role: 'customer' });

    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Grace' })).toBeTruthy(); // account link, labeled with first name
    expect(screen.getByText('Log out')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Sign In' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Create Account' })).toBeNull();

    clearSession();
  });

  it('clicking Log out calls POST /api/auth/logout and clears the local session even if it fails', async () => {
    setSession('fake-token', { id: 'u1', email: 'grace@example.com', fullName: 'Grace Hopper', role: 'customer' });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401, // simulates an already-expired token — logout must still clear locally
      json: async () => ({ error: 'UNAUTHORIZED', message: 'Invalid or expired token' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>
    );

    await userEvent.click(screen.getByText('Log out'));

    await waitFor(() => expect(getToken()).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({ method: 'POST' })
    );
  });
});

/**
 * Placement of the presentation controls: the language and display-currency switchers live in the
 * primary menu bar, as the bar's last item, not in the utility cluster with Sign In / Create
 * Account. They are choices about how the site is shown; the cluster is where actions live.
 */
describe('Header: the language and currency controls live in the menu bar', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('renders both controls inside the Primary navigation bar', () => {
    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>
    );

    const menuBar = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(menuBar).getByRole('button', { name: /Language: English/ })).toBeTruthy();
    expect(within(menuBar).getByRole('button', { name: /Display currency/ })).toBeTruthy();

    // …and the bar is the last thing the controls were rendered in, so they read as its final item.
    const bar = menuBar.querySelector('.ch247-platform-nav__bar');
    const controls = bar?.lastElementChild;
    expect(controls?.className).toContain('ch247-platform-nav__controls');
    expect(controls?.contains(within(menuBar).getByRole('button', { name: /Language: English/ }))).toBe(true);
    expect(controls?.contains(within(menuBar).getByRole('button', { name: /Display currency/ }))).toBe(true);
  });

  it('keeps the account actions out of the menu bar', () => {
    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>
    );

    const menuBar = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(menuBar).queryByRole('link', { name: 'Sign In' })).toBeNull();
    expect(within(menuBar).queryByRole('link', { name: 'Create Account' })).toBeNull();
    expect(
      within(menuBar).queryByRole('link', { name: 'Search CloudHost247' })
    ).toBeNull();
  });

  it('offers the same two controls in the mobile drawer, which replaces the bar below 1024px', () => {
    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>
    );

    // The drawer host is display: none on desktop but must still be rendered for phones, so both
    // placements exist in the DOM and each carries one copy of each control.
    const drawer = screen.getByRole('navigation', { name: 'Mobile' });
    const drawerControls = drawer.parentElement?.querySelector('.ch247-mobile-locale');
    expect(drawerControls).not.toBeNull();
    expect(within(drawerControls as HTMLElement).getByRole('button', { name: /Language: English/ })).toBeTruthy();
    expect(within(drawerControls as HTMLElement).getByRole('button', { name: /Display currency/ })).toBeTruthy();

    expect(screen.getAllByRole('button', { name: /Language: English/ })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /Display currency/ })).toHaveLength(2);
  });
});
