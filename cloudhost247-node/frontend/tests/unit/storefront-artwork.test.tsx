// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SERVICE_HERO_ASSETS } from '../../src/components/marketing/ServiceHeroVisual';
import RdpHostingPage from '../../src/pages/RdpHostingPage';
import SmmServicesPage from '../../src/pages/SmmServicesPage';
import NumberServicesPage from '../../src/pages/NumberServicesPage';
import GoogleWorkspacePage from '../../src/pages/GoogleWorkspacePage';
import Office365Page from '../../src/pages/Office365Page';
import DigitalProductsPage from '../../src/pages/DigitalProductsPage';
import ProxyServicesPage from '../../src/pages/ProxyServicesPage';
import SmtpHostingPage from '../../src/pages/SmtpHostingPage';

// This is a real component-render regression, not a live catalogue or provisioning test.
vi.mock('../../src/components/ProductPlansSection', () => ({ ProductPlansSection: () => <div data-testid="published-plans" /> }));
vi.mock('../../src/lib/usePageMeta', () => ({ usePageMeta: () => undefined }));
afterEach(cleanup);
describe('service-specific storefront hero components', () => {
  it.each([
    ['rdp-hosting', RdpHostingPage], ['smm-services', SmmServicesPage],
    ['number-services', NumberServicesPage], ['google-workspace', GoogleWorkspacePage],
    ['office-365', Office365Page], ['digital-products', DigitalProductsPage],
    ['proxy-services', ProxyServicesPage], ['smtp-hosting', SmtpHostingPage],
  ] as const)('renders %s artwork, its heading and the unchanged ordering boundary', (slug, Page) => {
    const { container } = render(<MemoryRouter><Page /></MemoryRouter>);
    const artwork = container.querySelector('.ch-service-art, .service-showcase__photo')!;
    const heroPhoto = slug === 'google-workspace' ? 'google-productivity-reference' : slug === 'office-365' ? 'team-collaboration' : null;
    if (heroPhoto) expect(artwork.getAttribute('src')).toBe(`/media/brands/${heroPhoto}.webp`);
    else {
      const route = slug === 'rdp-hosting' ? '/hosting/rdp' : `/${slug}`;
      const asset = SERVICE_HERO_ASSETS[route as keyof typeof SERVICE_HERO_ASSETS];
      expect(artwork.getAttribute('src')).toBe(asset.root + (asset.format === 'svg' ? '.svg' : '-960.webp'));
    }
    expect(artwork.getAttribute('alt')).toBeTruthy();
    if (!heroPhoto) {
      expect(container.querySelectorAll('.service-showcase__tiles li')).toHaveLength(slug === 'smm-services' ? 4 : 3);
      expect(screen.getByText(/Options vary by plan/)).toBeTruthy();
    }
    expect(container.querySelector('section')?.contains(artwork)).toBe(true);
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
    // Every service line renders its plans from the published catalog. Proxy Services used to be
    // the one exception (a hardcoded "coming soon" block); it now uses the same component as the
    // others, so an unpublished product gets the honest empty states inside ProductPlansSection
    // rather than a promise on the page itself.
    expect(screen.getByTestId('published-plans')).toBeTruthy();
    expect(screen.queryByText(/coming soon/i)).toBeNull();
  });
});

it('shows the local Google Workspace wordmark alongside the user-provided hero image', () => {
  render(<MemoryRouter><GoogleWorkspacePage /></MemoryRouter>);
  const logo = screen.getByRole('img', { name: 'Google Workspace' });
  expect(logo.getAttribute('src')).toBe('/media/brands/google-workspace.svg');
  expect(logo.closest('a')?.getAttribute('href')).toBe('https://workspace.google.com/');
  expect(screen.getByText(/CloudHost247 is an independent service provider/)).toBeTruthy();
});

it('shows the local Microsoft 365 logo with original app icons and the independence notice', () => {
  render(<MemoryRouter><Office365Page /></MemoryRouter>);
  const logo = screen.getByRole('img', { name: 'Microsoft 365' });
  expect(logo.getAttribute('src')).toBe('/media/brands/microsoft-365.svg');
  expect(logo.closest('a')?.getAttribute('href')).toBe('https://www.microsoft.com/microsoft-365');
  expect(screen.getByRole('img', { name: /Illustrative office scene/ })).toBeTruthy();
  for (const app of ['Word', 'Excel', 'PowerPoint', 'Outlook', 'Teams']) {
    expect(screen.getByRole('img', { name: `${app} logo` }).getAttribute('src')).toMatch(/^\/media\/brands\/microsoft-/);
  }
  expect(screen.getByText(/CloudHost247 is an independent service provider/)).toBeTruthy();
});

it('shows two people using phones on Number Services while preserving plans and provider caveats', () => {
  render(<MemoryRouter><NumberServicesPage /></MemoryRouter>);
  const image = screen.getByRole('img', { name: /woman making a phone call and a man looking at his phone/ });
  expect(image.getAttribute('src')).toBe('/media/cloudhost247/service-people/number-services-960.webp');
  expect(image.getAttribute('alt')).toContain('AI-generated');
  expect(screen.getByTestId('published-plans')).toBeTruthy();
  expect(screen.getByText(/capabilities depend on the country and provider/)).toBeTruthy();
});

it('shows the unique SMM creator image and labelled decorative engagement emoji with explicitly labelled example counts', () => {
  const { container } = render(<MemoryRouter><SmmServicesPage /></MemoryRouter>);
  const photo = screen.getByRole('img', { name: /smiling content creator using a smartphone/ });
  expect(photo.getAttribute('src')).toBe('/media/cloudhost247/service-people/smm-creator-960.webp');
  for (const label of ['Like', 'Comment', 'Share', 'Follow']) expect(screen.getByText(label)).toBeTruthy();
  const emojis = Array.from(container.querySelectorAll('.service-showcase__number'));
  expect(emojis.map(el => el.textContent)).toEqual(['❤️', '💬', '📤', '👥']);
  expect(emojis.every(el => el.getAttribute('aria-hidden') === 'true')).toBe(true);
  expect(container.querySelector('.service-showcase__tiles')?.querySelector('button, a')).toBeNull();
  expect(screen.getByText(/Example engagement — illustrative numbers, not actual results/)).toBeTruthy();
  for (const count of ['12.8K', '2.4K', '3.6K', '25.0K']) expect(screen.getByText(count)).toBeTruthy();
  expect(screen.getByTestId('published-plans')).toBeTruthy();
});
