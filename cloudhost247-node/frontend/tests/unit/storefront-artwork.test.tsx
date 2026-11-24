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
      expect(container.querySelectorAll('.service-showcase__tiles li')).toHaveLength(3);
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
