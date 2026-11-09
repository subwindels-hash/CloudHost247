// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MarketingPage, { Catalog } from '../../src/pages/marketing/MarketingPage';
import { trackAnalyticsCatalog, trackAnalyticsSelect } from '../../src/lib/marketing';
const { resource, snapshot } = vi.hoisted(() => ({ resource: vi.fn(), snapshot: vi.fn() }));
vi.mock('../../src/lib/useApiResource', () => ({ useApiResource: resource }));
vi.mock('../../src/lib/marketing', () => ({ trackAnalyticsCatalog: vi.fn(), trackAnalyticsSelect: vi.fn(), trackMarketing: vi.fn(), trackAnalyticsItem: vi.fn(), useMarketing: snapshot }));
vi.mock('../../src/lib/usePageMeta', () => ({ usePageMeta: vi.fn() }));
vi.mock('../../src/components/ApproxAmount', () => ({ ApproxAmount: () => null }));
const ready = { analytics: { initialized: 'G-1234567890' }, consent: { decided: true, preferences: { analytics: true } } };
const list = [{ slug: 'web-hosting', name: 'Hosting', available: true }, { slug: 'vps-hosting', name: 'VPS', available: false }];
describe('hosting catalogue analytics', () => {
  beforeEach(() => { vi.clearAllMocks(); resource.mockReset(); snapshot.mockReturnValue(ready); });
  afterEach(cleanup);
  function show() { return render(<MemoryRouter><Catalog section={{ heading: 'Plans' } as never} /></MemoryRouter>); }
  it('tracks the successful displayed list and an actual selection, not closing the selection', () => {
    resource.mockImplementation((path: string) => path === '/api/v1/catalog' ? { status: 'success', data: { products: list } } : { status: 'loading' });
    show(); expect(trackAnalyticsCatalog).toHaveBeenCalledWith(['web-hosting', 'vps-hosting']);
    fireEvent.click(screen.getByRole('button', { name: 'View plans' })); expect(trackAnalyticsSelect).toHaveBeenCalledOnce(); expect(trackAnalyticsSelect).toHaveBeenCalledWith('web-hosting');
    fireEvent.click(screen.getByRole('button', { name: 'Hide plans' })); expect(trackAnalyticsSelect).toHaveBeenCalledOnce();
  });
  it.each(['/hosting', '/pricing', '/offers'])('hooks the actual catalogue on %s', path => {
    resource.mockImplementation((url: string) => url === '/api/v1/catalog' ? { status: 'success', data: { products: list } } : { status: 'loading' });
    render(<MemoryRouter initialEntries={[path]}><MarketingPage /></MemoryRouter>);
    expect(trackAnalyticsCatalog).toHaveBeenCalledWith(['web-hosting', 'vps-hosting']);
    fireEvent.click(screen.getByRole('button', { name: 'View plans' }));
    expect(trackAnalyticsSelect).toHaveBeenCalledWith('web-hosting');
  });
  it('does not report lists for failed or loading requests', () => {
    resource.mockReturnValue({ status: 'loading' }); show(); expect(trackAnalyticsCatalog).not.toHaveBeenCalled();
  });
});
