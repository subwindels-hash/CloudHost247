// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HomePage from '../../src/pages/HomePage';
import LanguageSwitcher from '../../src/components/LanguageSwitcher';
import { isMarketingSurface } from '../../src/layout/Layout';
import App from '../../src/App';
import { LocaleProvider } from '../../src/i18n/LocaleProvider';
import { CurrencyProvider } from '../../src/currency/CurrencyProvider';
import { clearSession, setSession } from '../../src/lib/auth';

/**
 * The Hostinger-style homepage is a composition of real data-driven sections, so this suite
 * checks the page actually renders (no missing context / crash), that pricing tabs really switch
 * the catalogue request, and that the marketing-only theme is scoped to public routes.
 */

function plan(slug: string, name: string, amount: number) {
  return {
    slug,
    name,
    description: `Demo ${name} plan`,
    billingModel: 'recurring',
    displayOrder: 0,
    pricing: [{ billingPeriod: 'monthly', currency: 'USD', amount, setupFee: null }],
    features: [
      { name: 'SSD storage', value: '20 GB', displayOrder: 0 },
      { name: 'Free SSL', value: 'Included', displayOrder: 1 },
    ],
  };
}

const CATALOGUES: Record<string, unknown> = {
  'web-hosting': {
    product: { slug: 'web-hosting', name: 'Web Hosting' },
    plans: [plan('starter', 'Starter', 2.99), plan('business', 'Business', 4.99), plan('pro', 'Pro', 8.99)],
  },
  'vps-hosting': {
    product: { slug: 'vps-hosting', name: 'VPS Hosting' },
    plans: [plan('kvm-1', 'KVM 1', 6.99), plan('kvm-2', 'KVM 2', 12.99)],
  },
  'cloud-hosting': {
    product: { slug: 'cloud-hosting', name: 'Cloud Hosting' },
    plans: [plan('cloud-2', 'Cloud 2', 14.99)],
  },
};

function stubFetch() {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    const path = String(url);
    let body: unknown = null;
    if (path.includes('/api/auth/me')) {
      body = { user: { id: 'u1', email: 'ada@example.com', fullName: 'Ada Lovelace', role: 'customer' } };
    } else if (path.includes('/api/tools/catalog')) body = { count: 75 };
    else {
      const match = Object.entries(CATALOGUES).find(([slug]) => path.includes(`/api/v1/catalog/products/${slug}/plans`));
      if (match) body = match[1];
    }
    if (body === null) {
      return Promise.resolve({ ok: false, status: 404, headers: { get: () => 'application/json' }, json: async () => ({ error: 'NOT_FOUND' }), text: async () => '{"error":"NOT_FOUND"}' });
    }
    return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <LocaleProvider>
        <CurrencyProvider>
          <HomePage />
        </CurrencyProvider>
      </LocaleProvider>
    </MemoryRouter>
  );
}

describe('Hostinger-style public homepage', () => {
  beforeEach(() => {
    localStorage.clear();
    stubFetch();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('renders the full funnel: hero, capability strip, pricing, AI prompt, showcase, FAQ and CTA', async () => {
    const { container } = renderHome();

    expect(container.querySelector('.hg-page')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: /Your idea, online/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Choose the plan that fits/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Tell CloudHost247 what you want to create/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Questions, answered honestly/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Now's the time/i })).toBeTruthy();
    expect(screen.getByRole('search', { name: /domain name/i })).toBeTruthy();
    expect(screen.getAllByRole('tab').length).toBeGreaterThanOrEqual(6);
    expect(container.querySelectorAll('.hg-faq details').length).toBe(7);

    await waitFor(() => expect(screen.getByText('Starter')).toBeTruthy());
    expect(screen.getByText('75 free online tools')).toBeTruthy();
  });

  it('places the assistant feature showcase directly after the project tools section', () => {
    const { container } = renderHome();
    const heading = screen.getByRole('heading', { name: /More control over what you build/ });
    expect(heading.closest('section')?.nextElementSibling).toBe(container.querySelector('.assistant-showcase'));
  });

  it('shows the assurance strip after pricing, then the illustrative gallery with a real templates link', () => {
    const { container } = renderHome();
    const pricing = container.querySelector('#pricing');
    const assurance = container.querySelector('.assurance');
    const gallery = container.querySelector('.creation-showcase');
    // The five service promises sit between the plans and the gallery, not above the prices.
    expect(pricing?.nextElementSibling).toBe(assurance);
    expect(assurance?.nextElementSibling).toBe(gallery);
    expect(screen.getByRole('heading', { name: /See what you can create/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Explore templates/i }).getAttribute('href')).toBe('/websites/templates');
    expect(gallery?.querySelectorAll('.creation-card').length).toBe(10);
    expect(screen.getByText(/Illustrative concepts for inspiration/)).toBeTruthy();
  });

  it('updates translated homepage copy immediately when the language changes', async () => {
    render(<MemoryRouter><LocaleProvider><CurrencyProvider><LanguageSwitcher /><HomePage /></CurrencyProvider></LocaleProvider></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Language: English' }));
    fireEvent.click(screen.getByRole('button', { name: 'Français' }));
    expect(screen.getByRole('heading', { level: 1, name: /Votre idée, en ligne/ })).toBeTruthy();
    expect(screen.getByRole('search', { name: 'Rechercher un nom de domaine' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Voir les offres' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Choisissez l’offre adaptée à votre projet' })).toBeTruthy();
    await waitFor(() => expect(screen.getAllByRole('link', { name: 'Choisir cette offre' }).length).toBeGreaterThan(0));
    expect(localStorage.getItem('ch247.locale')).toBe('fr');
  });

  it('pricing tabs fetch a different catalogue product and render its published prices', async () => {
    const fetchMock = stubFetch();
    renderHome();

    await waitFor(() => expect(screen.getByText('Starter')).toBeTruthy());

    fireEvent.click(screen.getByRole('tab', { name: 'VPS hosting' }));
    await waitFor(() => expect(screen.getByText('KVM 1')).toBeTruthy());
    expect(screen.queryByText('Starter')).toBeNull();
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('vps-hosting/plans'))).toBe(true);

    fireEvent.click(screen.getByRole('tab', { name: 'Cloud hosting' }));
    await waitFor(() => expect(screen.getByText('Cloud 2')).toBeTruthy());
  });

  it('activates the marketing chrome on the real home route', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <LocaleProvider>
          <CurrencyProvider>
            <App />
          </CurrencyProvider>
        </LocaleProvider>
      </MemoryRouter>
    );
    await waitFor(() => expect(container.querySelector('.hg-shell')).toBeTruthy());
    expect(container.querySelector('.ch247-header')).toBeTruthy();
    expect(container.querySelector('.ch-announce')).toBeTruthy();
  });

  it('renders the registry-driven product pages under the same marketing chrome', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/hosting/web-hosting']}>
        <LocaleProvider>
          <CurrencyProvider>
            <App />
          </CurrencyProvider>
        </LocaleProvider>
      </MemoryRouter>
    );
    await waitFor(() => expect(container.querySelector('.hg-shell .ch-ds')).toBeTruthy());
    expect(container.querySelector('.hg-shell .ch247-footer')).toBeTruthy();
  });

  it('applies the same palette to the client area with an hPanel-style account overview', async () => {
    setSession('a-token', { id: 'u1', email: 'ada@example.com', fullName: 'Ada Lovelace', role: 'customer' });
    const { container } = render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <LocaleProvider>
          <CurrencyProvider>
            <App />
          </CurrencyProvider>
        </LocaleProvider>
      </MemoryRouter>
    );

    await waitFor(() => expect(container.querySelector('.hg-theme.hg-app')).toBeTruthy());
    expect(container.querySelector('.hg-shell')).toBeNull();
    await waitFor(() =>
      expect(container.querySelector('.hg-account-hero h1')?.textContent).toContain('Welcome back, Ada Lovelace')
    );
    expect(container.querySelectorAll('.hg-quick__item').length).toBe(4);
    expect(container.querySelector('.ch247-service-grid')).toBeTruthy();
    clearSession();
  });

  it('scopes the Hostinger theme to public routes only', () => {
    expect(isMarketingSurface('/')).toBe(true);
    expect(isMarketingSurface('/hosting/web-hosting')).toBe(true);
    expect(isMarketingSurface('/domains')).toBe(true);
    expect(isMarketingSurface('/legal/privacy-policy')).toBe(true);
    expect(isMarketingSurface('/dashboard')).toBe(false);
    expect(isMarketingSurface('/tools')).toBe(false);
    expect(isMarketingSurface('/account')).toBe(false);
    expect(isMarketingSurface('/websites/builder')).toBe(false);
  });
});
