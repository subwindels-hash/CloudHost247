// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MarketingPage from '../../src/pages/marketing/MarketingPage';
import { ProductPlansSection } from '../../src/components/ProductPlansSection';
import { trackAnalyticsItem } from '../../src/lib/marketing';
const { resource, snapshot } = vi.hoisted(() => ({ resource: vi.fn(), snapshot: vi.fn() }));
vi.mock('../../src/lib/useApiResource', () => ({ useApiResource: resource }));
vi.mock('../../src/lib/marketing', () => ({ trackMarketing: vi.fn(), trackAnalyticsItem: vi.fn(), useMarketing: snapshot }));
vi.mock('../../src/components/ApproxAmount', () => ({ ApproxAmount: () => null }));
const ready = { analytics: { initialized: 'G-1234567890' }, consent: { decided: true, preferences: { analytics: true } } };
const product = { slug: 'web-hosting', name: 'Example', productType: 'hosting', available: true };
describe('catalog view analytics success boundary', () => {
  beforeEach(() => { resource.mockReset(); snapshot.mockReset(); vi.mocked(trackAnalyticsItem).mockReset(); snapshot.mockReturnValue(ready); });
  afterEach(cleanup);
  it('tracks an available matching product after successful catalog loading', () => {
    resource.mockReturnValue({ status: 'success', data: { product, plans: [] } });
    render(<ProductPlansSection slug="web-hosting" />);
    expect(trackAnalyticsItem).toHaveBeenCalledOnce();
    expect(trackAnalyticsItem).toHaveBeenCalledWith('web-hosting');
  });
  it.each([{ status: 'loading' }, { status: 'error', message: 'failure' }, { status: 'success', data: { product: { ...product, available: false }, plans: [] } }, { status: 'success', data: { product: { ...product, slug: 'other' }, plans: [] } }])('does not send a view for unavailable, failed or mismatched catalog data', (result) => {
    resource.mockReturnValue(result); render(<ProductPlansSection slug="web-hosting" />); expect(trackAnalyticsItem).not.toHaveBeenCalled();
  });
  it.each([
    ['/hosting/web-hosting', 'web-hosting'], ['/hosting/vps', 'vps-hosting'], ['/hosting/dedicated', 'dedicated-server'],
    ['/hosting/cpanel', 'cpanel-hosting'], ['/hosting/business', 'business-hosting'],
    ['/hosting/wordpress', 'wordpress-hosting'], ['/hosting/reseller', 'reseller-hosting'],
    ['/hosting/windows', 'windows-hosting'], ['/hosting/email', 'email-hosting'],
    ['/hosting/ssl', 'ssl-certificate'], ['/cloud/public', 'public-cloud'], ['/cloud/private', 'private-cloud'],
  ])('wires the actual product page %s to its matching catalog ID', (path, slug) => {
    resource.mockReturnValue({ status: 'success', data: { product: { ...product, slug }, plans: [] } });
    render(<MemoryRouter initialEntries={[path]}><MarketingPage /></MemoryRouter>);
    expect(trackAnalyticsItem).toHaveBeenCalledOnce();
    expect(trackAnalyticsItem).toHaveBeenCalledWith(slug);
  });
  it('waits for the analytics engine to initialize', () => {
    resource.mockReturnValue({ status: 'success', data: { product, plans: [] } });
    snapshot.mockReturnValue({ analytics: { initialized: null }, consent: null });
    const { rerender } = render(<ProductPlansSection slug="web-hosting" />);
    expect(trackAnalyticsItem).not.toHaveBeenCalled(); snapshot.mockReturnValue(ready);
    rerender(<ProductPlansSection slug="web-hosting" />); expect(trackAnalyticsItem).toHaveBeenCalledOnce();
  });
});
