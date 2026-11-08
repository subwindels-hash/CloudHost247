// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Footer from '../../src/layout/Footer';
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

  it('shows Sign In and Create Account, but no account controls, when logged out', () => {
    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>
    );

    const logo = screen.getByRole('link', { name: 'CloudHost247 — home' }).querySelector('img');
    expect(logo?.getAttribute('src')).toContain('cloudhost247-official.webp');
    expect(screen.getByRole('link', { name: 'Sign In' })).toBeTruthy();
    // Create Account is the sixth utility control and must be visible to a signed-out visitor:
    // docs/UTILITY-ROW.md and scripts/check-chrome-benchmark.mjs both count it on that line, and
    // without it the header offers no route into registration at all.
    expect(screen.getByRole('link', { name: 'Create Account' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Dashboard' })).toBeNull();
    expect(screen.queryByText('Log out')).toBeNull();
  });

  it('toggles the mobile menu and closes it with Escape', async () => {
    render(<MemoryRouter><Header /></MemoryRouter>);
    const toggle = screen.getByRole('button', { name: 'Menu' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await userEvent.keyboard('{Escape}');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
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

  it('places the branded payment strip and VAT note before the copyright', () => {
    const { container } = render(<MemoryRouter><Footer /></MemoryRouter>);
    const band = container.querySelector('.hg-footer-brandband');
    const copyright = container.querySelector('.hg-footer__bottom');
    expect(band?.nextElementSibling).toBe(copyright);
    expect(within(band as HTMLElement).getByRole('img', { name: 'CloudHost247' }).tagName.toLowerCase()).toBe('svg');
    for (const card of ['Visa', 'Mastercard', 'Verve', 'American Express', 'Discover', 'JCB', 'Diners Club']) {
      expect(within(band as HTMLElement).getByRole('img', { name: card }).tagName.toLowerCase()).toBe('svg');
    }
    expect(within(band as HTMLElement).getByRole('img', { name: 'Mastercard' }).nextElementSibling?.getAttribute('aria-label')).toBe('Verve');
    expect(within(band as HTMLElement).getByRole('img', { name: 'American Express' }).textContent).toBe('AMEX');
    expect(within(band as HTMLElement).getByText('Prices are listed without VAT')).toBeTruthy();
    expect(within(band as HTMLElement).getByRole('link', { name: 'Share CloudHost247 on LinkedIn' }).getAttribute('href')).toContain('linkedin.com/sharing');
  });

  it('places the Language and Currency switchers in the header menu bar and not in the footer', () => {
    const { container } = render(
      <MemoryRouter>
        <Header />
        <Footer />
      </MemoryRouter>
    );

    const menuBar = container.querySelector<HTMLElement>('#ch247-primary-nav');
    expect(menuBar).toBeTruthy();
    expect(within(menuBar!).getByRole('button', { name: 'Language: English' })).toBeTruthy();
    expect(within(menuBar!).queryByText(/This product includes GeoLite2 data created by WIL/)).toBeNull();
    expect(within(container.querySelector('footer')!).getByText(/This product includes GeoLite2 data created by WIL/).textContent).toBe('This product includes GeoLite2 data created by WIL®.');
    expect(within(menuBar!).getByRole('button', { name: /^Display currency: USD/ })).toBeTruthy();

    const footer = container.querySelector<HTMLElement>('footer.ch247-footer');
    expect(footer).toBeTruthy();
    expect(within(footer!).queryByRole('button', { name: /Language:/i })).toBeNull();
    expect(within(footer!).queryByRole('button', { name: /Display currency:/i })).toBeNull();
  });
});
