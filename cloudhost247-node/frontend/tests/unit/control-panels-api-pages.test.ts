import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchControlPanel, fetchControlPanelsPage, type ControlPanelPage } from '../../src/lib/control-panels-api';
import { ApiRequestError } from '../../src/lib/api';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('../../src/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/api')>()),
  apiFetch,
}));

beforeEach(() => { apiFetch.mockReset(); });

describe('paged public catalogue client', () => {
  it('requests only the selected page and forwards search, filters, and cancellation', async () => {
    const page: ControlPanelPage = {
      controlPanels: [], total: 0,
      categoryCounts: { ALL: 0, OPERATING_SYSTEM: 0, SERVER_PANEL: 0, APPLICATION_DEPLOYMENT_PLATFORM: 0, SERVER_MANAGEMENT: 0 },
    };
    apiFetch.mockResolvedValue(page);
    const signal = new AbortController().signal;
    expect(await fetchControlPanelsPage({ offset: 24, limit: 24, search: ' Galaxy ', category: 'APPLICATION_DEPLOYMENT_PLATFORM', license: 'FREE', signal })).toBe(page);
    expect(apiFetch).toHaveBeenCalledExactlyOnceWith(
      '/api/v1/control-panels/catalog?offset=24&limit=24&category=APPLICATION_DEPLOYMENT_PLATFORM&license=FREE&search=Galaxy',
      { signal },
    );
  });

  it('loads the full static directory only on API failure, then filters before slicing', async () => {
    apiFetch.mockRejectedValue(new Error('Network unavailable'));
    const first = await fetchControlPanelsPage({ offset: 0, limit: 24 });
    expect(first.controlPanels).toHaveLength(24);
    expect(first.total).toBe(1_092);
    expect(first.categoryCounts.ALL).toBe(1_092);
    expect(first.controlPanels[0].hasPublishedMarketplaceApp).toBeUndefined();
    const end = await fetchControlPanelsPage({ offset: 1_080, limit: 24 });
    expect(end.controlPanels).toHaveLength(12);
    const search = await fetchControlPanelsPage({ offset: 0, limit: 24, search: ' Galaxy ', category: 'APPLICATION_DEPLOYMENT_PLATFORM', license: 'FREE' });
    expect(search.total).toBe(1);
    expect(search.controlPanels.map((p) => p.slug)).toEqual(['galaxy']);
    expect(apiFetch).toHaveBeenCalledTimes(3);
  });

  it('finds the correct product independently after splitting the malformed merged name', async () => {
    apiFetch.mockRejectedValue(new Error('Network unavailable'));
    const fasten = await fetchControlPanelsPage({ offset: 0, limit: 24, search: 'Fasten Health' });
    expect(fasten.controlPanels.map(x => [x.id, x.name])).toEqual([['app-fasten-healthfazer-ai-agents', 'Fasten Health']]);
    const fazer = await fetchControlPanelsPage({ offset: 0, limit: 24, search: 'fazer.ai' });
    expect(fazer.controlPanels.map(x => [x.slug, x.name])).toEqual([['fazerai-agents', 'fazer.ai agents']]);
  });

  it('does not fall back to a full import when the request is cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    apiFetch.mockRejectedValue(new Error('Aborted'));
    await expect(fetchControlPanelsPage({ offset: 0, limit: 24, signal: controller.signal })).rejects.toThrow('Aborted');
  });
});

describe('control-panel detail fallback', () => {
  it('keeps directory entries informational and does not invent a free plan', async () => {
    apiFetch.mockRejectedValue(new ApiRequestError(404, 'NOT_FOUND', 'Not configured'));
    const detail = await fetchControlPanel('wordpress');
    expect(detail.catalogSource).toBe('directory');
    expect(detail.planCount).toBe(0);
    expect(detail.startingPrice).toBeNull();
    expect(detail.hasPublishedMarketplaceApp).toBeUndefined();
    expect(detail.plans).toEqual([]);
  });

  it('does not mask an API outage as a directory listing', async () => {
    const failure = new ApiRequestError(503, 'SERVICE_UNAVAILABLE', 'API is unavailable', true);
    apiFetch.mockRejectedValue(failure);
    await expect(fetchControlPanel('wordpress')).rejects.toBe(failure);
  });
});
