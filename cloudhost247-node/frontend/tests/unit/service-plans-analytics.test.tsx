// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CatalogServicePlansPage, PlatformServicePlansPage, ServicePlansIndex } from '../../src/pages/ServicePlansPage';
import { trackAnalyticsCatalog, trackAnalyticsItem, trackAnalyticsSelect } from '../../src/lib/marketing';
const { resource, snapshot } = vi.hoisted(() => ({ resource: vi.fn(), snapshot: vi.fn() }));
vi.mock('../../src/lib/useApiResource', () => ({ useApiResource: resource }));
vi.mock('../../src/lib/marketing', () => ({ trackMarketing: vi.fn(), trackAnalyticsCatalog: vi.fn(), trackAnalyticsItem: vi.fn(), trackAnalyticsSelect: vi.fn(), useMarketing: snapshot }));
vi.mock('../../src/lib/usePageMeta', () => ({ usePageMeta: vi.fn() }));
vi.mock('../../src/components/ApproxAmount', () => ({ ApproxAmount: () => null }));
const ready = { analytics: { initialized: 'G-1234567890' }, consent: { decided: true, preferences: { analytics: true } } };
const product = { slug: 'web-hosting', name: 'Hosting', available: true, productType: 'hosting' };
const products = [product, { slug: 'vps-hosting', name: 'VPS', available: false }, { slug: 'unknown', name: 'Unknown', available: true }];
function index() { return render(<MemoryRouter><ServicePlansIndex /></MemoryRouter>); }
function detail(path = '/service-plans/catalog/web-hosting') {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/service-plans/catalog/:slug" element={<CatalogServicePlansPage />} /></Routes></MemoryRouter>);
}
describe('service plan catalogue analytics boundaries', () => {
  beforeEach(() => { vi.clearAllMocks(); resource.mockReset(); snapshot.mockReturnValue(ready); });
  afterEach(cleanup);
  it('tracks available list entries and selections only after successful load', () => {
    resource.mockReturnValue({ status: 'success', data: { products } }); index();
    expect(trackAnalyticsCatalog).toHaveBeenCalledWith(['web-hosting', 'unknown']);
    fireEvent.click(screen.getAllByText('View plans')[0]);
    expect(trackAnalyticsSelect).toHaveBeenCalledWith('web-hosting');
  });
  it('does not track an unavailable selection', () => {
    resource.mockReturnValue({ status: 'success', data: { products } }); index();
    fireEvent.click(screen.getAllByText('View plans')[1]);
    expect(trackAnalyticsSelect).not.toHaveBeenCalled();
  });
  it.each([{ status: 'loading' }, { status: 'error', message: 'failed' }])('does not track a failed or loading catalogue', result => {
    resource.mockReturnValue(result); index(); expect(trackAnalyticsCatalog).not.toHaveBeenCalled();
  });
  it('waits until analytics initializes before reporting a loaded catalogue', () => {
    resource.mockReturnValue({ status: 'success', data: { products } }); snapshot.mockReturnValue({ analytics: { initialized: null }, consent: null });
    const { rerender } = index(); expect(trackAnalyticsCatalog).not.toHaveBeenCalled(); snapshot.mockReturnValue(ready);
    rerender(<MemoryRouter><ServicePlansIndex /></MemoryRouter>); expect(trackAnalyticsCatalog).toHaveBeenCalledWith(['web-hosting', 'unknown']);
  });
  it('tracks a matching available service after a successful load', () => {
    resource.mockReturnValue({ status: 'success', data: { product, plans: [] } }); detail();
    expect(trackAnalyticsItem).toHaveBeenCalledWith('web-hosting');
  });
  it.each([
    { status: 'loading' }, { status: 'error', message: 'failed' },
    { status: 'success', data: { product: { ...product, available: false }, plans: [] } },
    { status: 'success', data: { product: { ...product, slug: 'vps-hosting' }, plans: [] } },
  ])('does not track failed, unavailable or stale/mismatched service data', result => {
    resource.mockReturnValue(result); detail(); expect(trackAnalyticsItem).not.toHaveBeenCalled();
  });
});

const platformPlan = { id: 'private-plan-id', service_kind: 'website_builder', status: 'published', code: 'tier', name: 'Private name', description: null, price_amount: '10', currency: 'USD', billing_period: 'monthly', features: [] };
function platform(kind = 'website_builder') {
  return render(<MemoryRouter initialEntries={[`/service-plans/platform/${kind}`]}><Routes><Route path="/service-plans/platform/:kind" element={<PlatformServicePlansPage />} /></Routes></MemoryRouter>);
}
describe('platform plan analytics boundaries', () => {
  beforeEach(() => { vi.clearAllMocks(); resource.mockReset(); snapshot.mockReturnValue(ready); });
  afterEach(cleanup);
  it.each(['website_builder', 'ai_builder', 'online_store', 'marketing', 'inbox', 'logo_maker'])('tracks the published %s category only, not a plan', kind => {
    resource.mockReturnValue({ status: 'success', data: { plans: [{ ...platformPlan, service_kind: kind }] } }); platform(kind);
    expect(trackAnalyticsItem).toHaveBeenCalledOnce(); expect(trackAnalyticsItem).toHaveBeenCalledWith(`platform:${kind}`);
  });
  it.each([
    { status: 'loading' }, { status: 'error', message: 'failed' },
    { status: 'success', data: { plans: [] } },
    { status: 'success', data: { plans: [{ ...platformPlan, service_kind: 'ai_builder' }] } },
    { status: 'success', data: { plans: [{ ...platformPlan, status: 'draft' }] } },
    { status: 'success', data: { plans: [{ ...platformPlan, status: 'archived' }] } },
  ])('does not track failed, empty, unmatched or unpublished plans', result => {
    resource.mockReturnValue(result); platform(); expect(trackAnalyticsItem).not.toHaveBeenCalled();
  });
  it('does not accept an unrecognized category even if it appears in a response', () => {
    resource.mockReturnValue({ status: 'success', data: { plans: [{ ...platformPlan, service_kind: 'unknown' }] } }); platform('unknown');
    expect(trackAnalyticsItem).not.toHaveBeenCalled();
  });
  it('waits for analytics initialization after plans load', () => {
    resource.mockReturnValue({ status: 'success', data: { plans: [platformPlan] } });
    snapshot.mockReturnValue({ analytics: { initialized: null }, consent: null });
    const { rerender } = platform(); expect(trackAnalyticsItem).not.toHaveBeenCalled(); snapshot.mockReturnValue(ready);
    rerender(<MemoryRouter initialEntries={['/service-plans/platform/website_builder']}><Routes><Route path="/service-plans/platform/:kind" element={<PlatformServicePlansPage />} /></Routes></MemoryRouter>);
    expect(trackAnalyticsItem).toHaveBeenCalledWith('platform:website_builder');
  });
});
