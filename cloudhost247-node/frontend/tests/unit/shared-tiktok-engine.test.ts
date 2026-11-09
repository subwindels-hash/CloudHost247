// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error package has no bundled declarations
import { JSDOM } from 'jsdom';

const source = readFileSync(resolve(__dirname, '../../../../shared/site/tiktok.js'), 'utf8');
const PIXEL = 'C4A7B2D9E1F0A3B5C6D7';
const bootstrap = (marketing = false) => ({
  configuration: { enabled: true, pixelId: PIXEL, revision: 1, testMode: false, testEventCode: null, remarketingEnabled: true, enabledEvents: ['PageView', 'ViewContent', 'AddToCart', 'CompletePayment'], diagnostic: 'configured' },
  consent: { marketingGranted: marketing, decided: marketing, preferences: { essential: true, analytics: false, marketing }, csrfToken: 'csrf-private', policyVersion: 1 },
});

describe('shared TikTok browser runtime', () => {
  let dom: InstanceType<typeof JSDOM>; let requests: Array<{ url: string; init: any }>; let response: any;
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://cloudhost247.com/', runScripts: 'outside-only' });
    dom.window.sessionStorage.clear();
    requests = []; response = bootstrap();
    dom.window.eval(source);
    (dom.window as any).fetch = vi.fn(async (url: string, init: any) => {
      requests.push({ url, init });
      return { ok: true, json: async () => response };
    });
  });
  afterEach(() => dom.window.close());
  const engine = () => (dom.window as any).CloudHost247TikTok;
  const ttqCalls = () => (((dom.window as any).ttq ?? []) as any[]).filter(Array.isArray);
  const init = async () => { await engine().initialize({ apiBase: '/api/v1/marketing' }); await engine().ready(); };

  it('does not load the TikTok library or fire PageView before consent', async () => {
    await init();
    expect(dom.window.document.getElementById('ch247-tiktok-pixel-sdk')).toBeNull();
    expect(ttqCalls()).toHaveLength(0);
    expect(engine().track('ViewContent', { content_ids: ['x'] }, 'view:12345678')).toBe(false);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain('/tiktok/bootstrap');
  });

  it('loads the official library once, fires one PageView per path, and deduplicates event IDs', async () => {
    response = bootstrap(true);
    await init(); await engine().initialize({ apiBase: '/api/v1/marketing' });
    const script = dom.window.document.getElementById('ch247-tiktok-pixel-sdk');
    expect(script?.getAttribute('src')).toBe(`https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${PIXEL}&lib=ttq`);
    expect(dom.window.document.querySelectorAll('#ch247-tiktok-pixel-sdk')).toHaveLength(1);
    expect(ttqCalls().filter(c => c[0] === 'page')).toHaveLength(1);
    engine().pageView('/hosting'); engine().pageView('/hosting');
    expect(ttqCalls().filter(c => c[0] === 'page')).toHaveLength(2);
    engine().track('AddToCart', { content_ids: ['plan-1'], value: 12, currency: 'NGN' }, 'cart:line-1234');
    engine().track('AddToCart', { content_ids: ['plan-1'], value: 12, currency: 'NGN' }, 'cart:line-1234');
    const cart = ttqCalls().filter(c => c[0] === 'track' && c[1] === 'AddToCart');
    expect(cart).toHaveLength(1);
    expect(cart[0][2]).toMatchObject({ currency: 'NGN', value: 12 });
    expect(cart[0][3]).toEqual({ event_id: 'cart:line-1234' });
    // Browser dispatch is recorded server-side with the same event_id for Events API dedup.
    const recorded = requests.filter(r => r.url.includes('/tiktok/browser-events') && r.init.body.includes('cart:line-1234'));
    expect(recorded).toHaveLength(1);
    expect(JSON.parse(recorded[0].init.body).events[0].eventId).toBe('cart:line-1234');
  });

  it('refuses unverified CompletePayment and unsupported events; verified receipts fire once', async () => {
    response = bootstrap(true);
    await init();
    expect(engine().track('CompletePayment', { value: 1, currency: 'NGN' }, 'purchase:fake-123')).toBe(false);
    expect(engine().track('Purchase', {}, 'purchase:fake-123')).toBe(false);
    const receipt = { verified: true, status: 'successful', eventName: 'CompletePayment', eventId: 'purchase:pay-1234', customData: { value: 1500, currency: 'NGN', content_ids: ['p1'], contents: [{ id: 'p1', quantity: 1 }], content_type: 'product' } };
    expect(engine().trackPurchase(receipt)).toBe(true);
    expect(engine().trackPurchase(receipt)).toBe(false);
    const payments = ttqCalls().filter(c => c[0] === 'track' && c[1] === 'CompletePayment');
    expect(payments).toHaveLength(1);
    expect(payments[0][3]).toEqual({ event_id: 'purchase:pay-1234' });
  });

  it('stops tracking when consent is withdrawn (bootstrap refresh fails closed)', async () => {
    response = bootstrap(true);
    await init();
    response = bootstrap(false);
    await engine().refresh();
    expect(engine().track('ViewContent', { content_ids: ['x'] }, 'view:after-withdraw')).toBe(false);
    expect(engine().snapshot().ready).toBe(false);
  });
});
