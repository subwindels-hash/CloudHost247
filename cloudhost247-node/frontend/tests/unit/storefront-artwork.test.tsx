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
    // Every service line renders its plans from the published catalog. Proxy Services used to be
    // the one exception (a hardcoded "coming soon" block); it now uses the same component as the
    // others, so an unpublished product gets the honest empty states inside ProductPlansSection
    // rather than a promise on the page itself.
    expect(screen.getByTestId('published-plans')).toBeTruthy();
    expect(screen.queryByText(/coming soon/i)).toBeNull();
  });
});
