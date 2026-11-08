// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CatalogServicePlansPage, PlatformServicePlansPage, ServicePlansIndex } from '../../src/pages/ServicePlansPage';

const { resource } = vi.hoisted(() => ({ resource: vi.fn() }));
vi.mock('../../src/lib/useApiResource', () => ({ useApiResource: resource }));
vi.mock('../../src/lib/usePageMeta', () => ({ usePageMeta: vi.fn() }));
vi.mock('../../src/components/ApproxAmount', () => ({ ApproxAmount: () => null }));

afterEach(() => { cleanup(); resource.mockReset(); });
function page(path: string, pattern: string, element: React.ReactNode) {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path={pattern} element={element} /></Routes></MemoryRouter>);
}

describe('service plans', () => {
  it('links every published catalog service and platform category to its own page', () => {
    resource.mockReturnValue({ status: 'success', data: { products: [{ slug: 'web-hosting', name: 'Web hosting', description: null, available: true }] } });
    page('/service-plans', '/service-plans', <ServicePlansIndex />);
    expect(screen.getByText('Web hosting')).toBeTruthy();
    const links = screen.getAllByRole('link', { name: 'View plans' });
    expect(links[0].getAttribute('href')).toBe('/service-plans/catalog/web-hosting');
    expect(links.some((link) => link.getAttribute('href') === '/service-plans/platform/website_builder')).toBe(true);
  });
  it('renders published product prices and links to the existing cart', () => {
    resource.mockReturnValue({ status: 'success', data: { product: { name: 'Web hosting', available: true }, plans: [{ slug: 'basic', name: 'Basic', description: null, features: [], pricing: [{ billingPeriod: 'monthly', currency: 'USD', amount: 10, setupFee: null }] }] } });
    page('/service-plans/catalog/web-hosting', '/service-plans/catalog/:slug', <CatalogServicePlansPage />);
    expect(screen.getByRole('heading', { name: 'Web hosting plans' })).toBeTruthy();
    expect(screen.getByText(/\$10\.00/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Choose monthly' }).getAttribute('href')).toBe('/cart?product=web-hosting&plan=basic&period=monthly');
  });
  it('does not offer unsupported currency checkout', () => {
    resource.mockReturnValue({ status: 'success', data: { product: { name: 'Hosting', available: true }, plans: [{ slug: 'basic', name: 'Basic', features: [], pricing: [{ billingPeriod: 'monthly', currency: 'GBP', amount: 10, setupFee: null }] }] } });
    page('/service-plans/catalog/hosting', '/service-plans/catalog/:slug', <CatalogServicePlansPage />);
    expect(screen.queryByRole('link', { name: 'Choose monthly' })).toBeNull();
    expect(screen.getByText(/Online checkout is not available/)).toBeTruthy();
  });
  it('renders platform plans only for the selected service', () => {
    resource.mockReturnValue({ status: 'success', data: { plans: [
      { id: '1', service_kind: 'website_builder', code: 'starter', name: 'Starter', description: null, billing_period: 'monthly', price_amount: '12', currency: 'USD', features: [] },
      { id: '2', service_kind: 'inbox', code: 'mail', name: 'Mail', description: null, billing_period: 'monthly', price_amount: '5', currency: 'USD', features: [] },
    ] } });
    page('/service-plans/platform/website_builder', '/service-plans/platform/:kind', <PlatformServicePlansPage />);
    expect(screen.getByText('Starter')).toBeTruthy();
    expect(screen.queryByText('Mail')).toBeNull();
    expect(screen.getByRole('link', { name: 'Choose plan' }).getAttribute('href')).toBe('/cart?add=website_builder%3Astarter');
  });
  it('shows a truthful empty state instead of invented plans', () => {
    resource.mockReturnValue({ status: 'success', data: { product: { name: 'Email', available: true }, plans: [] } });
    page('/service-plans/catalog/email', '/service-plans/catalog/:slug', <CatalogServicePlansPage />);
    expect(screen.getByText('No plans have been published for this service yet.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Choose/ })).toBeNull();
  });
  it('shows an API error instead of treating it as an empty catalogue', () => {
    resource.mockReturnValue({ status: 'error', message: 'Catalogue unavailable' });
    page('/service-plans', '/service-plans', <ServicePlansIndex />);
    expect(screen.getByText('Catalogue unavailable')).toBeTruthy();
    expect(screen.queryByText('No services have been published in the catalogue yet.')).toBeNull();
  });
});
