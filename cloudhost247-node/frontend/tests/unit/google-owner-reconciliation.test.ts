// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error jsdom has no bundled declarations
import { JSDOM } from 'jsdom';

const source = readFileSync(resolve(__dirname, '../../../../shared/site/marketing.js'), 'utf8');

describe('GA4 and Ads shared owner with separate purposes', () => {
  let dom: InstanceType<typeof JSDOM>; let w: any; let response: any; let engine: any;
  const commands = () => (w.dataLayer || []).map((x: IArguments) => Array.from(x));
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://example.com/', runScripts: 'outside-only' });
    dom.window.eval(source);
    w = { location: { origin: 'https://example.com', hostname: 'example.com', pathname: '/', search: '', hash: '', reload: vi.fn() }, sessionStorage: dom.window.sessionStorage, localStorage: dom.window.localStorage, addEventListener: dom.window.addEventListener.bind(dom.window) };
    response = {
      configuration: { enabled: false, pixelId: null, revision: 1 },
      analytics: { enabled: true, measurementId: 'G-1234567890', testMode: false, revision: 1, purchaseCapture: false },
      googleAds: { enabled: true, destination: 'AW-123456789', remarketingEnabled: true, actions: { purchase: { label: 'Purchase_01' }, lead: { label: 'Lead_01' } } },
      consent: { decided: true, policyVersion: 1, expiresAt: '2099-01-01T00:00:00.000Z', marketingGranted: false, preferences: { essential: true, analytics: false, marketing: false }, csrfToken: 'csrf', analyticsRevision: 1 },
    };
    (dom.window as any).fetch = vi.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith('/bootstrap') ? response : { consent: response.consent } }));
    engine = (dom.window as any).CloudHost247Marketing;
  });
  afterEach(() => dom.window.close());
  it.each([[false,false], [true,false], [false,true], [true,true]])('honors analytics=%s marketing=%s independently', async (analytics, marketing) => {
    response.consent.preferences.analytics = analytics; response.consent.preferences.marketing = marketing; response.consent.marketingGranted = marketing;
    await engine.initialize({ window: w });
    const config = commands().filter((x: any[]) => x[0] === 'config').map((x: any[]) => x[1]);
    expect(config.includes('G-1234567890')).toBe(analytics);
    expect(config.includes('AW-123456789')).toBe(marketing);
    expect(dom.window.document.querySelectorAll('script[src*="googletagmanager.com/gtag/js"]')).toHaveLength(analytics || marketing ? 1 : 0);
    expect(commands().some((x: any[]) => x[0] === 'get' && x[2] === 'client_id')).toBe(false);
    expect(commands().some((x: any[]) => x[0] === 'event' && x[1] === 'purchase')).toBe(false);
    if (analytics) expect(commands().some((x: any[]) => x[0] === 'event' && x[1] === 'page_view' && x[2].send_to === 'G-1234567890')).toBe(true);
    if (marketing) expect(commands().some((x: any[]) => x[0] === 'event' && x[1] === 'page_view' && x[2].send_to === 'AW-123456789')).toBe(true);
  });
  it('reuses an Ads-first tag when analytics is subsequently granted, and disables GA4 on withdrawal', async () => {
    response.consent.marketingGranted = true; response.consent.preferences.marketing = true; await engine.initialize({ window: w });
    response.consent.preferences.analytics = true; await engine.refresh();
    expect(dom.window.document.querySelectorAll('script[src*="googletagmanager.com/gtag/js"]')).toHaveLength(1);
    expect(commands().filter((x: any[]) => x[0] === 'config' && x[1] === 'G-1234567890')).toHaveLength(1);
    response.consent.preferences.analytics = false; await engine.savePreferences(response.consent.preferences);
    expect(w['ga-disable-G-1234567890']).toBe(true);
    expect(w.location.reload).toHaveBeenCalled();
  });
  it('routes a verified purchase only to the configured Ads action, never as GA4 purchase', async () => {
    response.consent.marketingGranted = true; response.consent.preferences.marketing = true; response.consent.preferences.analytics = true;
    await engine.initialize({ window: w });
    expect(engine.trackPurchase({ verified: true, status: 'successful', eventId: 'purchase:payment-123', customData: { value: 84500, currency: 'NGN', content_ids: ['plan'], content_type: 'product' } })).toBe(true);
    const events = commands().filter((x: any[]) => x[0] === 'event');
    expect(events.some((x: any[]) => x[1] === 'conversion' && x[2].send_to === 'AW-123456789/Purchase_01')).toBe(true);
    expect(events.some((x: any[]) => x[1] === 'purchase' || (x[1] === 'conversion' && x[2].send_to === 'G-1234567890'))).toBe(false);
    expect(commands().some((x: any[]) => x[0] === 'get' && x[2] === 'client_id')).toBe(false);
  });
  it('requires a current, decided analytics choice for the shared Google consent update', async () => {
    response.consent.marketingGranted = true; response.consent.preferences.marketing = true; response.consent.preferences.analytics = true;
    response.consent.expiresAt = '2000-01-01T00:00:00.000Z'; await engine.initialize({ window: w });
    expect(commands().some((x: any[]) => x[0] === 'config' && x[1] === 'G-1234567890')).toBe(false);
    expect(commands().some((x: any[]) => x[0] === 'consent' && x[1] === 'update' && x[2].analytics_storage === 'denied')).toBe(true);
  });
  it('does not load GA4 with an unowned Google tag', async () => {
    const external = dom.window.document.createElement('script'); external.src = 'https://www.googletagmanager.com/gtm.js?id=GTM-EXTERNAL'; dom.window.document.head.append(external);
    response.consent.preferences.analytics = true; await engine.initialize({ window: w });
    expect(commands().some((x: any[]) => x[0] === 'config' && x[1] === 'G-1234567890')).toBe(false);
    expect(engine.snapshot().analytics.status).toBe('duplicate_warning');
  });
});
