// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// JSDOM is a transitive Vitest dependency; the frontend tsconfig does not include DOM typings.
// @ts-expect-error package has no bundled declarations
import { JSDOM } from 'jsdom';

const source = readFileSync(resolve(__dirname, '../../../../shared/site/marketing.js'), 'utf8');
const bootstrap = (marketing = false, decided = false) => ({
  configuration: { enabled: true, pixelId: '123456789012345', revision: 1, testMode: false, consentPolicy: 'global_opt_in' },
  googleAds: { enabled: false, destination: null, remarketingEnabled: false, actions: null, defaultCurrency: null, diagnostic: 'disabled' },
  consent: { marketingGranted: marketing, decided, preferences: { essential: true, analytics: false, marketing }, csrfToken: 'csrf-private', policyVersion: 1 },
});

describe('canonical shared browser marketing engine', () => {
  let dom: InstanceType<typeof JSDOM>; let calls: Array<any[]>; let googleCalls: Array<any[]>; let requests: Array<{ url: string; init: any }>; let response: any;
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://cloudhost247.com/', runScripts: 'outside-only' });
    dom.window.sessionStorage.clear();
    calls = []; googleCalls = []; requests = []; response = bootstrap();
    (dom.window as any).HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    (dom.window as any).HTMLDialogElement.prototype.close = function () { this.open = false; };
    dom.window.eval(source);
    const w = dom.window as any;
    w.fbq = (...args: any[]) => calls.push(args);
    w.gtag = (...args: any[]) => googleCalls.push(args);
    w.fetch = vi.fn(async (url: string, init: any) => {
      requests.push({ url, init });
      return { ok: true, json: async () => url.endsWith('/bootstrap') ? response : { consent: response.consent } };
    });
  });
  afterEach(() => dom.window.close());
  const engine = () => (dom.window as any).CloudHost247Marketing;
  const init = () => engine().initialize({ apiBase: '/api/v1/marketing', window: dom.window });
  it('does not initialize, inject SDK or send PageView before consent', async () => {
    await init();
    expect(calls).toEqual([]);
    expect(dom.window.document.getElementById('ch247-meta-pixel-sdk')).toBeNull();
    expect(engine().track('ViewContent', { content_ids: ['x'] }, 'view:12345678')).toBe(false);
    expect(requests).toHaveLength(1);
  });
  it('uses official async loader, one init, trackSingle and stable event IDs after opt-in', async () => {
    response = bootstrap(true, true); await init(); await init();
    expect(calls.filter(c => c[0] === 'init')).toHaveLength(1);
    expect(calls.filter(c => c[0] === 'trackSingle' && c[2] === 'PageView')).toHaveLength(1);
    expect(dom.window.document.querySelector('script[src="https://connect.facebook.net/en_US/fbevents.js"]')).not.toBeNull();
    engine().pageView('/hosting'); engine().pageView('/hosting');
    expect(calls.filter(c => c[2] === 'PageView')).toHaveLength(2);
    engine().track('AddToCart', { content_ids: ['plan-1'], value: 12, currency: 'NGN' }, 'cart:line-1234');
    engine().track('AddToCart', { content_ids: ['plan-1'], value: 12, currency: 'NGN' }, 'cart:line-1234');
    const cart = calls.filter(c => c[2] === 'AddToCart');
    expect(cart).toHaveLength(1); expect(cart[0][4]).toEqual({ eventID: 'cart:line-1234' });
  });
  it('withdrawal revokes consent, stops future calls and cannot be undone by a queued event', async () => {
    response = bootstrap(true, true); await init();
    engine().pageView('/queued');
    response.consent = bootstrap(false, true).consent;
    await engine().withdrawConsent();
    const count = calls.length;
    expect(calls[calls.length - 1]).toEqual(['consent','revoke']);
    expect(engine().track('Lead', {}, 'lead:12345678')).toBe(false);
    expect(engine().pageView('/after')).toBe(false);
    expect(calls).toHaveLength(count);
  });
  it('rejects client Purchase, sensitive fields, invalid money and domain mismatch', async () => {
    response = bootstrap(true, true); await init();
    expect(engine().track('Purchase', { value: 1, currency: 'USD' }, 'fake:12345678')).toBe(false);
    expect(engine().trackPurchase({ verified: false, status: 'successful', eventId: 'fake:12345678', customData: {} })).toBe(false);
    engine().track('Lead', { email: 'private@example.com', password: 'secret' }, 'lead:12345678');
    expect(JSON.stringify(calls)).not.toContain('private@example.com'); expect(JSON.stringify(calls)).not.toContain('secret');
    expect(engine().track('AddToCart', { value: 1, currency: 'usd' }, 'cart:12345678')).toBe(false);
    response.configuration.enabled = false; await engine().refresh();
    expect(engine().track('Lead', {}, 'lead:87654321')).toBe(false);
  });
  it('only emits a verified receipt Purchase and deduplicates refreshes in session storage', async () => {
    response = bootstrap(true, true); await init();
    const receipt = { verified: true, status: 'successful', eventId: 'purchase:payment-123', customData: { value: 1500, currency: 'NGN', content_ids: ['plan-1'] } };
    expect(engine().trackPurchase(receipt)).toBe(true); expect(engine().trackPurchase(receipt)).toBe(false);
    expect(requests.some(r => r.url.endsWith('/browser-events') && r.init.body.includes('Purchase'))).toBe(false);
  });
  it('ignores a stale bootstrap response that arrives after withdrawal', async () => {
    response = bootstrap(true, true); await init();
    let finishBootstrap!: (value: unknown) => void;
    (dom.window as any).fetch = vi.fn((url: string) => {
      if (url.endsWith('/bootstrap')) return new Promise(resolve => { finishBootstrap = resolve; });
      return Promise.resolve({ ok: true, json: async () => ({ consent: bootstrap(false, true).consent }) });
    });
    const pendingRefresh = engine().refresh();
    await engine().withdrawConsent();
    const afterWithdraw = calls.length;
    finishBootstrap({ ok: true, json: async () => bootstrap(true, true) });
    await pendingRefresh;
    expect(engine().snapshot().consent.marketingGranted).toBe(false);
    expect(engine().snapshot().initializedPixel).toBeNull();
    expect(calls).toHaveLength(afterWithdraw);
    expect(engine().track('Lead', {}, 'lead:stale123')).toBe(false);
  });
  it('fails closed in other tabs when the privacy choice changes, then refreshes server consent', async () => {
    response = bootstrap(true, true); await init();
    response = bootstrap(false, true);
    dom.window.dispatchEvent(new dom.window.StorageEvent('storage', { key: 'ch247.marketing-consent-changed.v1', newValue: String(Date.now()) }));
    // The local grant is revoked synchronously; no event may escape while the refresh is pending.
    expect(engine().snapshot().initializedPixel).toBeNull();
    expect(engine().track('Lead', {}, 'lead:othertab')).toBe(false);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(engine().snapshot().consent.marketingGranted).toBe(false);
    expect(calls[calls.length - 1]).toEqual(['consent', 'revoke']);
  });
  it('preserves legacy GA4 under analytics consent and holds GTM until both analytics and advertising consent', async () => {
    response = bootstrap(false, false); response.consent.preferences.analytics = true;
    await engine().initialize({ apiBase: '/api/v1/marketing', window: dom.window, ga4Id: 'G-TEST12345', gtmId: 'GTM-AB12CDE' });
    expect(dom.window.document.getElementById('ch247-google-tag')).not.toBeNull();
    expect(dom.window.document.getElementById('ch247-google-tag-manager')).toBeNull();
    expect(googleCalls.filter(c => c[0] === 'config' && c[1] === 'G-TEST12345')).toHaveLength(1);
    expect(googleCalls.some(c => c[0] === 'consent' && c[1] === 'update' && c[2].analytics_storage === 'granted' && c[2].ad_storage === 'denied')).toBe(true);
    expect(googleCalls.some(c => c[0] === 'event' && c[1] === 'page_view' && c[2].send_to === 'G-TEST12345')).toBe(true);
    response.consent = { ...response.consent, decided: true, marketingGranted: true, preferences: { essential: true, analytics: true, marketing: true } };
    await engine().acceptAll();
    expect(dom.window.document.getElementById('ch247-google-tag-manager')).not.toBeNull();
    expect(googleCalls.filter(c => c[0] === 'config' && c[1] === 'G-TEST12345')).toHaveLength(1);
  });
  it('loads the official Google tag only after advertising consent and applies Consent Mode v2 before configuration', async () => {
    response = bootstrap(false, false);
    response.googleAds = { enabled: true, destination: 'AW-123456789', remarketingEnabled: false, actions: { purchase: { label: 'Purchase_01' }, lead: { label: 'Lead_01' } }, defaultCurrency: '', diagnostic: 'configured' };
    await init();
    expect(dom.window.document.getElementById('ch247-google-tag')).toBeNull();
    expect(googleCalls).toEqual([]);
    response.consent.marketingGranted = true; response.consent.decided = true; response.consent.preferences.marketing = true;
    await engine().refresh();
    expect(dom.window.document.querySelector('script[src="https://www.googletagmanager.com/gtag/js?id=AW-123456789"]')).not.toBeNull();
    const defaultAt = googleCalls.findIndex(c => c[0] === 'consent' && c[1] === 'default');
    const configAt = googleCalls.findIndex(c => c[0] === 'config' && c[1] === 'AW-123456789');
    expect(defaultAt).toBeGreaterThanOrEqual(0); expect(defaultAt).toBeLessThan(configAt);
    expect(googleCalls[defaultAt][2]).toEqual({ ad_storage: 'denied', analytics_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
    expect(googleCalls.some(c => c[0] === 'consent' && c[1] === 'update' && c[2].ad_storage === 'granted')).toBe(true);
  });
  it('sends only configured conversions and preserves verified purchase ID, value and native currency', async () => {
    response = bootstrap(true, true);
    response.googleAds = { enabled: true, destination: 'AW-123456789', remarketingEnabled: false, actions: { purchase: { label: 'Purchase_01' }, lead: { label: 'Lead_01' } }, defaultCurrency: 'NGN', diagnostic: 'configured' };
    await init();
    const receipt = { verified: true, status: 'successful', eventId: 'purchase:payment-123', googleItems: [{ id: 'catalog:cloud:starter', name: 'Cloud Starter', quantity: 2 }], customData: { value: 84500, currency: 'NGN', content_ids: ['shared-plan'], content_type: 'product' } };
    expect(engine().trackPurchase(receipt)).toBe(true);
    expect(engine().trackPurchase(receipt)).toBe(false);
    const conversion = googleCalls.find(c => c[0] === 'event' && c[1] === 'conversion' && c[2].send_to === 'AW-123456789/Purchase_01');
    expect(conversion?.[2]).toMatchObject({ value: 84500, currency: 'NGN', transaction_id: 'purchase:payment-123', items: [{ id: 'catalog:cloud:starter', google_business_vertical: 'custom', quantity: 2, name: 'Cloud Starter' }] });
    engine().track('Lead', { content_name: 'Enquiry' }, 'lead:verified-123');
    expect(googleCalls.some(c => c[0] === 'event' && c[1] === 'conversion' && c[2].send_to === 'AW-123456789/Lead_01')).toBe(true);
    expect(googleCalls.some(c => c[0] === 'event' && c[1] === 'conversion' && c[2].send_to === 'AW-123456789/undefined')).toBe(false);
  });
  it('updates Google consent to denied on withdrawal and does not dispatch after withdrawal', async () => {
    response = bootstrap(true, true);
    response.googleAds = { enabled: true, destination: 'AW-123456789', remarketingEnabled: true, actions: { lead: { label: 'Lead_01' } }, defaultCurrency: '', diagnostic: 'configured' };
    await init();
    response.consent = bootstrap(false, true).consent;
    await engine().withdrawConsent();
    expect(googleCalls.some(c => c[0] === 'consent' && c[1] === 'update' && c[2].ad_storage === 'denied' && c[2].ad_user_data === 'denied' && c[2].ad_personalization === 'denied')).toBe(true);
    const before = googleCalls.length;
    expect(engine().track('Lead', {}, 'lead:withdrawn-123')).toBe(false);
    expect(googleCalls).toHaveLength(before);
  });
  it('keeps the "Your privacy choices" cookie banner disabled by default while still allowing manual Cookie settings', async () => {
    await init();
    const banner = dom.window.document.querySelector('.ch247-cookie-banner') as HTMLElement;
    expect(banner).not.toBeNull();
    expect(banner.hidden).toBe(true);
    expect(engine().snapshot().consent.marketingGranted).toBe(false);
    engine().openPreferences();
    expect((dom.window.document.querySelector('dialog') as HTMLDialogElement).open).toBe(true);
    expect(banner.hidden).toBe(true);
  });
  it('shows the cookie banner only when consentBannerEnabled is explicitly enabled and visitor has not decided', async () => {
    response.configuration.consentBannerEnabled = true;
    await init();
    const banner = dom.window.document.querySelector('.ch247-cookie-banner') as HTMLElement;
    expect(banner.hidden).toBe(false);
    response.consent = bootstrap(false, true).consent;
    await engine().rejectOptional();
    expect(banner.hidden).toBe(true);
  });
  it('fails closed on network errors and supports reopening preferences', async () => {
    (dom.window as any).fetch = vi.fn(async () => { throw new Error('offline'); });
    await init(); expect(engine().snapshot().ready).toBe(false);
    engine().openPreferences(); expect(dom.window.document.querySelector('dialog').open).toBe(true);
  });
});
