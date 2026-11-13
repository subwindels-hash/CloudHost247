// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    const artwork = screen.getByRole('img');
    expect(artwork.getAttribute('src')).toBe(`/media/cloudhost247/storefronts/${slug}.svg`);
    expect(artwork.getAttribute('alt')).toContain('conceptual illustration');
    expect(artwork.hasAttribute('data-showcase-depth')).toBe(true);
    expect(container.querySelector('section')?.contains(artwork)).toBe(true);
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
    if (slug === 'proxy-services') {
      expect(screen.queryByTestId('published-plans')).toBeNull();
      expect(screen.getByText('Proxy services are coming soon.')).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Contact sales →' }).getAttribute('href')).toBe('/contact');
    } else {
      expect(screen.getByTestId('published-plans')).toBeTruthy();
    }
  });
});
