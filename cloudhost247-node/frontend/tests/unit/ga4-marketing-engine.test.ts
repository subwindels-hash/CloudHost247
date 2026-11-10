// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error jsdom declarations are not in frontend tsconfig
import { JSDOM } from 'jsdom';
const source = readFileSync(resolve(__dirname, '../../../../shared/site/marketing.js'), 'utf8');
const bootstrap = (analytics: boolean, enabled = true) => ({
  configuration: { enabled: false, pixelId: null, revision: 1 },
  analytics: { enabled, measurementId: enabled ? 'G-1234567890' : null, testMode: true, revision: 1 },
  consent: { decided: true, policyVersion: 1, marketingGranted: false, expiresAt: '2099-01-01T00:00:00.000Z', preferences: { essential: true, analytics, marketing: false }, analyticsRevision: 1, csrfToken: 'csrf' },
});
describe('GA4 page view privacy', () => {
  let dom: InstanceType<typeof JSDOM>; let response: ReturnType<typeof bootstrap>; let w: any;
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://example.com/', runScripts: 'outside-only' });
    dom.window.eval(source); response = bootstrap(false);
    const location = { origin: 'https://example.com', hostname: 'example.com', pathname: '/', search: '', hash: '', reload: vi.fn() };
    w = { location, sessionStorage: dom.window.sessionStorage, localStorage: dom.window.localStorage, addEventListener: dom.window.addEventListener.bind(dom.window) };
    (dom.window as any).fetch = vi.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith('/bootstrap') ? response : { consent: response.consent } }));
  });
  afterEach(() => dom.window.close());
  const engine = () => (dom.window as any).CloudHost247Marketing;
  async function init() { await engine().initialize({ window: w }); }
  function commands() { return (w.dataLayer || []).map((entry: IArguments) => Array.from(entry)); }
  it('loads nothing before analytics consent, including rejected and disabled settings', async () => {
    await init(); expect(dom.window.document.getElementById('ch247-ga4-sdk')).toBeNull();
    expect(commands()).toHaveLength(0); engine().pageView('/hosting'); expect(commands()).toHaveLength(0);
    response = bootstrap(true, false); await engine().refresh(); expect(commands()).toHaveLength(0);
  });
  it('starts after an analytics-only preference is saved', async () => {
    await init(); response = bootstrap(true);
    await engine().savePreferences({ essential: true, analytics: true, marketing: false });
    expect(dom.window.document.getElementById('ch247-ga4-sdk')).not.toBeNull();
    expect(commands().filter((c: any[]) => c[0] === 'event')).toHaveLength(1);
  });
  it('rejects stale bootstrap grants after withdrawal', async () => {
    response = bootstrap(true); await init();
    let resolveBootstrap!: (value: unknown) => void;
    (dom.window as any).fetch = vi.fn((url: string) => url.endsWith('/bootstrap') ? new Promise(resolve => { resolveBootstrap = resolve; }) : Promise.resolve({ ok: true, json: async () => ({ consent: bootstrap(false).consent }) }));
    const pending = engine().refresh(); await engine().withdrawConsent();
    resolveBootstrap({ ok: true, json: async () => bootstrap(true) }); await pending;
    expect(w['ga-disable-G-1234567890']).toBe(true);
    expect(engine().snapshot().consent.preferences.analytics).toBe(false);
  });
  it('requests the official gtag client ID only after consent and enabled purchase capture', async () => {
    response = bootstrap(true); (response.analytics as any).purchaseCapture = true; await init();
    const sdk = dom.window.document.getElementById('ch247-ga4-sdk')!; sdk.dispatchEvent(new dom.window.Event('load'));
    const get = commands().find((entry: any[]) => entry[0] === 'get');
    expect(get.slice(0, 3)).toEqual(['get', 'G-1234567890', 'client_id']);
    get[3]('123.456'); await vi.waitFor(() => expect((dom.window.fetch as any).mock.calls.some((call: any[]) => call[0].endsWith('/ga4-client-id'))).toBe(true));
    const request = (dom.window.fetch as any).mock.calls.find((call: any[]) => call[0].endsWith('/ga4-client-id'));
    expect(JSON.parse(request[1].body)).toEqual({clientId:'123.456',revision:1,consentRevision:1}); expect(request[1].headers['X-Consent-CSRF']).toBe('csrf');
  });
  it('never captures missing, malformed or stale client IDs after withdrawal', async () => {
    response = bootstrap(true); (response.analytics as any).purchaseCapture = true; await init();
    dom.window.document.getElementById('ch247-ga4-sdk')!.dispatchEvent(new dom.window.Event('load'));
    const get = commands().find((entry: any[]) => entry[0] === 'get');
    await engine().withdrawConsent(); get[3]('123.456');
    expect((dom.window.fetch as any).mock.calls.some((call: any[]) => call[0].endsWith('/ga4-client-id'))).toBe(false);
  });
  it('does not request a client ID when server delivery is not configured', async () => {
    response = bootstrap(true); await init(); dom.window.document.getElementById('ch247-ga4-sdk')!.dispatchEvent(new dom.window.Event('load'));
    expect(commands().some((entry: any[]) => entry[0] === 'get')).toBe(false);
  });
  it('sends explicit page views after analytics-only consent without duplicate initialization', async () => {
    response = bootstrap(true); await init(); await init();
    expect(dom.window.document.querySelectorAll('#ch247-ga4-sdk')).toHaveLength(1);
    expect(commands().filter((c: any[]) => c[0] === 'config')).toHaveLength(1);
    expect(commands().filter((c: any[]) => c[0] === 'event')).toHaveLength(1);
    expect(commands().find((c: any[]) => c[0] === 'config')[2]).toMatchObject({ send_page_view: false, allow_google_signals: false });
    w.location.pathname = '/hosting'; engine().pageView('/hosting'); engine().pageView('/hosting'); w.location.pathname = '/'; engine().pageView('/');
    expect(commands().filter((c: any[]) => c[0] === 'event')).toHaveLength(3);
    expect(JSON.stringify(commands())).not.toContain('email');
  });
  it('dispatches contact without accepting personal data only on the contact route with analytics consent', async () => {
    await init(); w.location.pathname = '/contact';
    expect(engine().trackAnalyticsContact({ email: 'private@example.com', password: 'secret' })).toBe(false);
    response = bootstrap(true); await engine().refresh();
    expect(engine().trackAnalyticsContact({ email: 'private@example.com', password: 'secret' })).toBe(true);
    const event = commands().find((c: any[]) => c[0] === 'event' && c[1] === 'contact');
    expect(event[2]).toEqual({ send_to: 'G-1234567890', page_location: 'https://example.com/contact', page_title: 'CloudHost247', page_referrer: '', debug_mode: true });
    expect(JSON.stringify(event)).not.toContain('private@example.com'); expect(JSON.stringify(event)).not.toContain('secret');
    w.location.search = '?email=private@example.com'; expect(engine().trackAnalyticsContact()).toBe(false);
    w.location.search = ''; w.location.pathname = '/account'; expect(engine().trackAnalyticsContact()).toBe(false);
    w.location.pathname = '/contact'; response = bootstrap(false); await engine().withdrawConsent();
    expect(engine().trackAnalyticsContact()).toBe(false);
  });
  it('sends only fixed catalog IDs for supported item pages, once per visit', async () => {
    w.location.pathname = '/web-hosting'; await init();
    expect(engine().trackAnalyticsItem('web-hosting')).toBe(false);
    response = bootstrap(true); await engine().refresh();
    expect(engine().trackAnalyticsItem('web-hosting')).toBe(true);
    expect(engine().trackAnalyticsItem('web-hosting')).toBe(false);
    expect(engine().trackAnalyticsItem('private@example.com')).toBe(false);
    const event = commands().find((c: any[]) => c[0] === 'event' && c[1] === 'view_item');
    expect(event[2].items).toEqual([{ item_id: 'web-hosting' }]);
    expect(event[2]).not.toHaveProperty('value'); expect(event[2]).not.toHaveProperty('currency');
    w.location.pathname = '/vps-hosting'; engine().pageView('/vps-hosting');
    expect(engine().trackAnalyticsItem('web-hosting')).toBe(false);
    expect(engine().trackAnalyticsItem('vps-hosting')).toBe(true);
    w.location.pathname = '/web-hosting'; engine().pageView('/web-hosting');
    expect(engine().trackAnalyticsItem('web-hosting')).toBe(true);
    expect(JSON.stringify(commands())).not.toContain('private@example.com');
    response = bootstrap(false); await engine().withdrawConsent();
    expect(engine().trackAnalyticsItem('web-hosting')).toBe(false);
  });
  it.each([['/hosting/web-hosting', 'web-hosting'], ['/hosting/vps', 'vps-hosting'], ['/hosting/dedicated', 'dedicated-server']])('tracks the canonical catalog page %s', async (path, id) => {
    w.location.pathname = path; response = bootstrap(true); await init();
    expect(engine().trackAnalyticsItem(id)).toBe(true);
  });
  it.each([
    ['/hosting/cpanel', 'cpanel-hosting'], ['/hosting/business', 'business-hosting'],
    ['/hosting/wordpress', 'wordpress-hosting'], ['/hosting/reseller', 'reseller-hosting'],
    ['/hosting/windows', 'windows-hosting'], ['/hosting/email', 'email-hosting'],
    ['/hosting/ssl', 'ssl-certificate'], ['/cloud/public', 'public-cloud'], ['/cloud/private', 'private-cloud'],
  ])('tracks a fixed matching product on %s without values or arbitrary fields', async (path, id) => {
    w.location.pathname = path; response = bootstrap(true); await init();
    expect(engine().trackAnalyticsItem(id)).toBe(true); expect(engine().trackAnalyticsItem(id)).toBe(false);
    const event = commands().find((entry: any[]) => entry[1] === 'view_item');
    expect(event[2].items).toEqual([{ item_id: id }]);
    expect(event[2]).not.toHaveProperty('value'); expect(event[2]).not.toHaveProperty('currency');
    expect(engine().trackAnalyticsItem('private@example.com')).toBe(false);
    w.location.search = '?email=private@example.com'; expect(engine().trackAnalyticsItem(id)).toBe(false);
    expect(JSON.stringify(commands())).not.toContain('private@example.com');
  });
  it('does not allow a product ID on another product route', async () => {
    w.location.pathname = '/hosting/business'; response = bootstrap(true); await init();
    expect(engine().trackAnalyticsItem('public-cloud')).toBe(false);
    expect(engine().trackAnalyticsItem('business-hosting')).toBe(true);
  });
  it('tracks a filtered hosting list and successful selection without arbitrary fields', async () => {
    w.location.pathname = '/hosting'; await init();
    expect(engine().trackAnalyticsCatalog(['web-hosting'])).toBe(false);
    response = bootstrap(true); await engine().refresh();
    expect(engine().trackAnalyticsCatalog(['web-hosting', 'private@example.com', 'vps-hosting', 'web-hosting'])).toBe(true);
    expect(engine().trackAnalyticsCatalog(['web-hosting'])).toBe(false);
    expect(engine().trackAnalyticsSelect('web-hosting')).toBe(true);
    expect(engine().trackAnalyticsSelect('private@example.com')).toBe(false);
    const list = commands().find((c: any[]) => c[1] === 'view_item_list');
    expect(list[2].items).toEqual([{ item_id: 'web-hosting' }, { item_id: 'vps-hosting' }]);
    expect(list[2].item_list_id).toBe('hosting-catalog');
    expect(commands().find((c: any[]) => c[1] === 'select_item')[2].items).toEqual([{ item_id: 'web-hosting' }]);
    expect(JSON.stringify(commands())).not.toContain('private@example.com');
    response = bootstrap(false); await engine().withdrawConsent();
    expect(engine().trackAnalyticsSelect('web-hosting')).toBe(false);
  });
  it.each([['/pricing', 'pricing-catalog'], ['/offers', 'offers-catalog']])('tracks a filtered list and selection on %s', async (path, listId) => {
    w.location.pathname = path; await init();
    expect(engine().trackAnalyticsCatalog(['web-hosting'])).toBe(false);
    response = bootstrap(true); await engine().refresh();
    expect(engine().trackAnalyticsCatalog(['web-hosting', 'private@example.com'])).toBe(true);
    expect(engine().trackAnalyticsCatalog(['web-hosting'])).toBe(false);
    expect(engine().trackAnalyticsSelect('web-hosting')).toBe(true);
    const list = commands().find((entry: any[]) => entry[1] === 'view_item_list');
    const selection = commands().find((entry: any[]) => entry[1] === 'select_item');
    expect(list[2]).toMatchObject({ item_list_id: listId, page_location: 'https://example.com' + path, items: [{ item_id: 'web-hosting' }] });
    expect(selection[2]).toMatchObject({ item_list_id: listId, items: [{ item_id: 'web-hosting' }] });
    expect(JSON.stringify(commands())).not.toContain('private@example.com');
    w.location.hash = '#private'; expect(engine().trackAnalyticsSelect('web-hosting')).toBe(false);
    w.location.hash = ''; response = bootstrap(false); await engine().withdrawConsent();
    expect(engine().trackAnalyticsSelect('web-hosting')).toBe(false);
  });
  it('records a separate list once per visit across catalogue pages', async () => {
    w.location.pathname = '/hosting'; response = bootstrap(true); await init();
    expect(engine().trackAnalyticsCatalog(['web-hosting'])).toBe(true);
    w.location.pathname = '/pricing';
    expect(engine().trackAnalyticsCatalog(['web-hosting'])).toBe(true);
    expect(engine().trackAnalyticsCatalog(['web-hosting'])).toBe(false);
    w.location.pathname = '/hosting';
    expect(engine().trackAnalyticsCatalog(['web-hosting'])).toBe(true);
    expect(commands().filter((entry: any[]) => entry[1] === 'view_item_list').map((entry: any[]) => entry[2].item_list_id)).toEqual(['hosting-catalog', 'pricing-catalog', 'hosting-catalog']);
  });
  it('tracks only coarse WHMCS catalogue categories after consent and actual selection', async () => {
    w.location.pathname = '/cloudhost247-hosting.php';
    dom.window.document.body.innerHTML = `<div data-ch247-ga-whmcs-catalog>
      <article data-ch247-ga-whmcs-kind="hosting"><a data-ch247-ga-whmcs-select href="#">Private plan private@example.com</a></article>
      <article data-ch247-ga-whmcs-kind="hosting"><a data-ch247-ga-whmcs-select href="#">Another plan</a></article>
      <article data-ch247-ga-whmcs-kind="vps"><a data-ch247-ga-whmcs-select href="#">VPS</a></article>
      <article data-ch247-ga-whmcs-kind="private@example.com"><a data-ch247-ga-whmcs-select href="#">Unknown</a></article>
    </div>`;
    dom.window.document.addEventListener('click', (e: Event) => e.preventDefault());
    await init(); const links = dom.window.document.querySelectorAll('[data-ch247-ga-whmcs-select]');
    links[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(commands()).toHaveLength(0);
    response = bootstrap(true); await engine().refresh();
    const list = commands().find((entry: any[]) => entry[1] === 'view_item_list');
    expect(list[2]).toMatchObject({ item_list_id: 'whmcs-public-catalog', items: [{ item_id: 'whmcs-hosting' }, { item_id: 'whmcs-vps' }] });
    await engine().refresh(); expect(commands().filter((entry: any[]) => entry[1] === 'view_item_list')).toHaveLength(1);
    links[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    links[3].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    const selections = commands().filter((entry: any[]) => entry[1] === 'select_item');
    expect(selections).toHaveLength(1); expect(selections[0][2].items).toEqual([{ item_id: 'whmcs-hosting' }]);
    expect(JSON.stringify(commands())).not.toContain('private@example.com'); expect(JSON.stringify(commands())).not.toContain('Private plan');
    w.location.search = '?type=vps'; links[2].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(commands().filter((entry: any[]) => entry[1] === 'select_item')).toHaveLength(1);
    w.location.search = ''; response = bootstrap(false); await engine().withdrawConsent();
    links[2].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(commands().filter((entry: any[]) => entry[1] === 'select_item')).toHaveLength(1);
  });
  it('does not report a WHMCS list or selection without a successful marked catalogue', async () => {
    w.location.pathname = '/cloudhost247-hosting.php';
    dom.window.document.body.innerHTML = '<article data-ch247-ga-whmcs-kind="vps"><a data-ch247-ga-whmcs-select href="#">VPS</a></article>';
    dom.window.document.addEventListener('click', (e: Event) => e.preventDefault()); response = bootstrap(true); await init();
    dom.window.document.querySelector('a')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(commands().filter((entry: any[]) => entry[1] === 'select_item' || entry[1] === 'view_item_list')).toHaveLength(0);
  });
  it('ignores a WHMCS selection marker outside the displayed catalogue', async () => {
    w.location.pathname = '/cloudhost247-hosting.php';
    dom.window.document.body.innerHTML = '<div data-ch247-ga-whmcs-catalog><article data-ch247-ga-whmcs-kind="hosting"><a data-ch247-ga-whmcs-select href="#">Plan</a></article></div><article data-ch247-ga-whmcs-kind="vps"><a data-ch247-ga-whmcs-select href="#">Outside</a></article>';
    dom.window.document.addEventListener('click', (e: Event) => e.preventDefault()); response = bootstrap(true); await init();
    dom.window.document.querySelectorAll('a')[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(commands().filter((entry: any[]) => entry[1] === 'select_item')).toHaveLength(0);
  });
  it('does not use WHMCS catalogue markers on other public pages', async () => {
    w.location.pathname = '/hosting';
    dom.window.document.body.innerHTML = '<div data-ch247-ga-whmcs-catalog><article data-ch247-ga-whmcs-kind="vps"><a data-ch247-ga-whmcs-select href="#">Plan</a></article></div>';
    dom.window.document.addEventListener('click', (e: Event) => e.preventDefault()); response = bootstrap(true); await init();
    dom.window.document.querySelector('a')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(commands().filter((entry: any[]) => entry[1] === 'select_item' || entry[1] === 'view_item_list')).toHaveLength(0);
  });
  it('marks only the canonical WHMCS available catalogue for coarse category tracking', () => {
    const template = readFileSync(resolve(__dirname, '../../../../templates/cloudhost247/cloudhost247-product-catalog.tpl'), 'utf8');
    expect(template).toContain('{if $ch247Products}<div class="ch-plan-grid"{if !$ch247CatalogError} data-ch247-ga-whmcs-catalog{/if}>');
    expect(template).toContain('data-ch247-ga-whmcs-kind="{$product.kind|escape}"');
    expect(template).toContain('data-ch247-ga-whmcs-select href="{$product.cart_url|escape}"');
  });
  it('records only a redacted search action, never the supplied query', async () => {
    w.location.pathname = '/search'; await init();
    expect(engine().trackAnalyticsSearch('private@example.com')).toBe(false);
    response = bootstrap(true); await engine().refresh();
    expect(engine().trackAnalyticsSearch('private@example.com')).toBe(true);
    const event = commands().find((c: any[]) => c[0] === 'event' && c[1] === 'search');
    expect(event[2].search_term).toBe('[not collected]');
    expect(JSON.stringify(event)).not.toContain('private@example.com');
    w.location.search = '?q=private@example.com'; expect(engine().trackAnalyticsSearch()).toBe(false);
    w.location.search = ''; response = bootstrap(false); await engine().withdrawConsent(); expect(engine().trackAnalyticsSearch()).toBe(false);
  });
  it('omits debug_mode entirely when test mode is disabled', async () => {
    response = bootstrap(true); response.analytics.testMode = false; await init();
    expect(commands().find((c: any[]) => c[0] === 'config')[2]).not.toHaveProperty('debug_mode');
    expect(commands().find((c: any[]) => c[0] === 'event')[2]).not.toHaveProperty('debug_mode');
  });
  it('withdraws immediately and prevents further dispatch; disabled config also stops it', async () => {
    response = bootstrap(true); await init(); response = bootstrap(false);
    await engine().withdrawConsent(); const count = commands().length;
    expect(w['ga-disable-G-1234567890']).toBe(true); expect(w.location.reload).toHaveBeenCalled();
    engine().pageView('/hosting'); expect(commands()).toHaveLength(count);
  });
  it('stops immediately while a withdrawal request is still pending', async () => {
    response = bootstrap(true); await init();
    (dom.window as any).fetch = vi.fn(() => new Promise(() => {}));
    void engine().withdrawConsent();
    await Promise.resolve();
    expect(w['ga-disable-G-1234567890']).toBe(true);
  });
  it.each(['load', 'error'])('does not resume tracking if the SDK fires %s while withdrawal is pending', async (eventName) => {
    w.location.pathname = '/search'; response = bootstrap(true); await init();
    (dom.window as any).fetch = vi.fn(() => new Promise(() => {}));
    void engine().withdrawConsent(); await Promise.resolve();
    dom.window.document.getElementById('ch247-ga4-sdk').dispatchEvent(new dom.window.Event(eventName));
    expect(engine().snapshot().analytics.status).toBe('stopped');
    const before = commands().length;
    expect(engine().trackAnalyticsSearch()).toBe(false); expect(commands()).toHaveLength(before);
  });
  it.each(['2000-01-01T00:00:00.000Z', 'invalid', ''])('does not load for an expired or invalid consent expiry %s', async expiresAt => {
    response = bootstrap(true); response.consent.expiresAt = expiresAt; await init();
    expect(commands()).toHaveLength(0); expect(dom.window.document.getElementById('ch247-ga4-sdk')).toBeNull();
  });
  it('does not load when the consent expiry is missing', async () => {
    response = bootstrap(true); delete (response.consent as Partial<typeof response.consent>).expiresAt; await init();
    expect(commands()).toHaveLength(0); expect(dom.window.document.getElementById('ch247-ga4-sdk')).toBeNull();
  });
  it('unloads on navigation when consent expires before a delayed timer runs', async () => {
    let now = Date.parse('2030-01-01T00:00:00.000Z'); vi.spyOn(dom.window.Date, 'now').mockImplementation(() => now);
    response = bootstrap(true); response.consent.expiresAt = '2030-01-01T00:00:10.000Z'; await init();
    now += 10000; w.location.pathname = '/hosting'; engine().pageView('/hosting');
    expect(w['ga-disable-G-1234567890']).toBe(true); expect(w.location.reload).toHaveBeenCalledOnce();
    expect(commands().filter((entry: any[]) => entry[1] === 'page_view')).toHaveLength(1);
  });
  it('stops dispatch at expiration even before the periodic refresh', async () => {
    let now = Date.parse('2030-01-01T00:00:00.000Z'); vi.spyOn(dom.window.Date, 'now').mockImplementation(() => now);
    w.location.pathname = '/search'; response = bootstrap(true); response.consent.expiresAt = '2030-01-01T00:00:10.000Z';
    let callback!: () => void;
    w.setTimeout = vi.fn((fn: () => void) => { callback = fn; return 1; }); w.clearTimeout = vi.fn();
    await init(); expect(w.setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 10000);
    now += 10000;
    expect(engine().trackAnalyticsSearch()).toBe(false);
    callback(); expect(w['ga-disable-G-1234567890']).toBe(true); expect(w.location.reload).toHaveBeenCalledOnce();
    expect(engine().snapshot().analytics.status).toBe('stopped');
  });
  it('updates the expiry timer after a refreshed consent expiration', async () => {
    let now = Date.parse('2030-01-01T00:00:00.000Z'); vi.spyOn(dom.window.Date, 'now').mockImplementation(() => now);
    response = bootstrap(true); response.consent.expiresAt = '2030-01-01T00:00:10.000Z';
    w.setTimeout = vi.fn(() => 7); w.clearTimeout = vi.fn(); await init();
    response = bootstrap(true); response.consent.expiresAt = '2030-01-01T00:00:20.000Z'; await engine().refresh();
    expect(w.clearTimeout).toHaveBeenCalledWith(7);
    expect(w.setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 20000);
  });
  it('stops before a refresh when a background tab becomes visible after consent expiry', async () => {
    let now = Date.parse('2030-01-01T00:00:00.000Z'); vi.spyOn(dom.window.Date, 'now').mockImplementation(() => now);
    response = bootstrap(true); response.consent.expiresAt = '2030-01-01T00:00:10.000Z'; await init();
    now += 10000;
    Object.defineProperty(dom.window.document, 'visibilityState', { configurable: true, value: 'visible' });
    dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
    expect(w['ga-disable-G-1234567890']).toBe(true); expect(w.location.reload).toHaveBeenCalledOnce();
  });
  it('unloads an expired SDK when a delayed bootstrap returns', async () => {
    let now = Date.parse('2030-01-01T00:00:00.000Z'); vi.spyOn(dom.window.Date, 'now').mockImplementation(() => now);
    response = bootstrap(true); response.consent.expiresAt = '2030-01-01T00:00:10.000Z'; await init();
    now += 10000; response = bootstrap(false); await engine().refresh();
    expect(w['ga-disable-G-1234567890']).toBe(true); expect(w.location.reload).toHaveBeenCalledOnce();
  });
  it('clamps long expiry timers and reschedules while the preference remains valid', async () => {
    let now = Date.parse('2030-01-01T00:00:00.000Z'); vi.spyOn(dom.window.Date, 'now').mockImplementation(() => now);
    response = bootstrap(true); response.consent.expiresAt = '2031-01-01T00:00:00.000Z';
    let callback!: () => void; w.setTimeout = vi.fn((fn: () => void) => { callback = fn; return 7; }); w.clearTimeout = vi.fn();
    await init(); expect(w.setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 2147483647);
    const calls = w.setTimeout.mock.calls.length; now += 2147483647; callback();
    expect(w.setTimeout).toHaveBeenCalledTimes(calls + 1); expect(w.location.reload).not.toHaveBeenCalled();
  });
  it('stops if a refreshed administrator configuration disables tracking', async () => {
    response = bootstrap(true); await init(); response = bootstrap(true, false); await engine().refresh();
    expect(w['ga-disable-G-1234567890']).toBe(true); expect(w.location.reload).toHaveBeenCalled();
  });
  it('fails closed while frozen in bfcache and reloads before restoring tracking', async () => {
    response = bootstrap(true); await init();
    dom.window.dispatchEvent(new dom.window.PageTransitionEvent('pagehide', { persisted: true }));
    expect(w['ga-disable-G-1234567890']).toBe(true);
    expect(engine().trackAnalyticsSearch()).toBe(false);
    dom.window.dispatchEvent(new dom.window.PageTransitionEvent('pageshow', { persisted: true }));
    expect(w.location.reload).toHaveBeenCalledOnce();
  });
  it('resumes configuration checks after restoring an untracked bfcache page', async () => {
    w.setInterval = vi.fn(() => 7); w.clearInterval = vi.fn(); await init();
    expect(w.setInterval).toHaveBeenCalledTimes(1);
    dom.window.dispatchEvent(new dom.window.PageTransitionEvent('pagehide', { persisted: true }));
    expect(w.clearInterval).toHaveBeenCalledWith(7);
    dom.window.dispatchEvent(new dom.window.PageTransitionEvent('pageshow', { persisted: true }));
    expect(w.setInterval).toHaveBeenCalledTimes(2);
  });
  it.each(['web-hosting', 'vps-hosting', 'dedicated-server', 'cpanel-hosting', 'business-hosting', 'wordpress-hosting', 'reseller-hosting', 'windows-hosting', 'email-hosting', 'ssl-certificate', 'public-cloud', 'private-cloud'])('tracks only the fixed matching service-plan product %s', async slug => {
    w.location.pathname = '/service-plans/catalog/' + slug; response = bootstrap(true); await init();
    expect(engine().trackAnalyticsItem('private@example.com')).toBe(false);
    expect(engine().trackAnalyticsItem(slug)).toBe(true);
    expect(engine().trackAnalyticsItem(slug)).toBe(false);
    const item = commands().find((entry: any[]) => entry[1] === 'view_item');
    expect(item[2].items).toEqual([{ item_id: slug }]);
    expect(item[2]).not.toHaveProperty('value'); expect(item[2]).not.toHaveProperty('currency');
    w.location.search = '?email=private@example.com'; expect(engine().trackAnalyticsItem(slug)).toBe(false);
    expect(JSON.stringify(commands())).not.toContain('private@example.com');
  });
  it.each(['website_builder', 'ai_builder', 'online_store', 'marketing', 'inbox', 'logo_maker'])('tracks fixed platform category %s only on its own route', async kind => {
    w.location.pathname = '/service-plans/platform/' + kind; await init();
    expect(engine().trackAnalyticsItem('platform:' + kind)).toBe(false);
    response = bootstrap(true); await engine().refresh();
    expect(engine().trackAnalyticsItem('platform:' + kind)).toBe(true);
    expect(engine().trackAnalyticsItem('platform:' + kind)).toBe(false);
    expect(engine().trackAnalyticsItem('platform:private@example.com')).toBe(false);
    const event = commands().find((entry: any[]) => entry[1] === 'view_item');
    expect(event[2].items).toEqual([{ item_id: 'platform:' + kind }]);
    expect(event[2]).not.toHaveProperty('value'); expect(event[2]).not.toHaveProperty('currency');
    w.location.hash = '#private'; expect(engine().trackAnalyticsItem('platform:' + kind)).toBe(false);
    w.location.hash = ''; response = bootstrap(false); await engine().withdrawConsent();
    expect(engine().trackAnalyticsItem('platform:' + kind)).toBe(false);
    expect(JSON.stringify(commands())).not.toContain('private@example.com');
  });
  it('never sends a stale platform category on a different platform route', async () => {
    w.location.pathname = '/service-plans/platform/website_builder'; response = bootstrap(true); await init();
    w.location.pathname = '/service-plans/platform/ai_builder';
    expect(engine().trackAnalyticsItem('platform:website_builder')).toBe(false);
    expect(engine().trackAnalyticsItem('platform:ai_builder')).toBe(true);
  });
  it('restricts service-plan lists and selections to known fixed IDs', async () => {
    w.location.pathname = '/service-plans'; await init();
    expect(engine().trackAnalyticsCatalog(['web-hosting'])).toBe(false);
    response = bootstrap(true); await engine().refresh();
    expect(engine().trackAnalyticsCatalog(['web-hosting', 'unknown', 'web-hosting', 'private@example.com'])).toBe(true);
    expect(engine().trackAnalyticsCatalog(['vps-hosting'])).toBe(false);
    expect(engine().trackAnalyticsSelect('unknown')).toBe(false);
    expect(engine().trackAnalyticsSelect('web-hosting')).toBe(true);
    const events = commands().filter((entry: any[]) => entry[1] === 'view_item_list' || entry[1] === 'select_item');
    expect(events).toHaveLength(2);
    for (const event of events) { expect(event[2].item_list_id).toBe('service-plans-catalog'); expect(event[2].items).toEqual([{ item_id: 'web-hosting' }]); }
    w.location.hash = '#secret'; expect(engine().trackAnalyticsSelect('web-hosting')).toBe(false);
    w.location.hash = ''; await engine().withdrawConsent(); expect(engine().trackAnalyticsSelect('web-hosting')).toBe(false);
    expect(JSON.stringify(events)).not.toContain('private@example.com');
  });
  it.each(['/service-plans/catalog/unknown', '/service-plans/catalog/private@example.com', '/service-plans/platform/unknown'])('does not initialize on unreviewed service-plan path %s', async path => {
    w.location.pathname = path; response = bootstrap(true); await init();
    expect(commands()).toHaveLength(0); expect(dom.window.document.getElementById('ch247-ga4-sdk')).toBeNull();
  });
  it('covers the reviewed public SPA, legal and WHMCS registry routes without sending private parameters', async () => {
    const root = resolve(__dirname, '../../../..');
    const readJson = (path: string) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
    const families = ['hosting', 'cloud', 'developers', 'platforms', 'products', 'resources'];
    const spa = families.flatMap(family => readJson(`shared/site/content/${family}.json`).pages.map((page: {route: string}) => page.route));
    const legal = readJson('shared/site/registry.json').legal.map((page: {spa: string}) => page.spa);
    const php = Object.keys(readJson('modules/addons/cloudhost247_theme/resources/site.json').pages).map(path => '/' + path);
    const paths = [...new Set<string>([...spa, ...legal, ...php, '/legal'])];
    response = bootstrap(true); await init();
    for (const path of paths) {
      const before = commands().filter((entry: any[]) => entry[1] === 'page_view').length;
      w.location.pathname = path; engine().pageView(path);
      const after = commands().filter((entry: any[]) => entry[1] === 'page_view');
      expect(after.length, path).toBe(before + 1); expect(after[after.length - 1][2].page_location).toBe('https://example.com' + path);
    }
    const views = commands().filter((entry: any[]) => entry[1] === 'page_view');
    expect(views).toHaveLength(paths.length + 1);
    for (const view of views) {
      expect(view[2].page_location).toMatch(/^https:\/\/example\.com\/[a-z0-9./-]*$/);
      expect(view[2]).toMatchObject({ page_referrer: '', page_title: 'CloudHost247' });
    }
  });
  it.each(['/dashboard', '/cart', '/checkout', '/clientarea.php', '/cart.php', '/reset-password', '/cloud/anything@example.com', '/cloudhost247-page.php', '/site-search.php'])('keeps private, dynamic or unreviewed path %s excluded', async path => {
    w.location.pathname = path; response = bootstrap(true); await init();
    expect(dom.window.document.getElementById('ch247-ga4-sdk')).toBeNull();
    expect(commands()).toHaveLength(0);
  });
  it('does not initialize on sensitive routes or URLs with query parameters', async () => {
    w.location.pathname = '/account/private@example.com'; response = bootstrap(true); await init();
    expect(commands()).toHaveLength(0); expect(dom.window.document.getElementById('ch247-ga4-sdk')).toBeNull();
    w.location.pathname = '/'; w.location.search = '?email=private@example.com'; engine().pageView('/');
    expect(commands()).toHaveLength(0);
  });
  it('disables and unloads on navigation to a private path', async () => {
    response = bootstrap(true); await init(); w.location.pathname = '/account/private@example.com'; engine().pageView(w.location.pathname);
    expect(w['ga-disable-G-1234567890']).toBe(true); expect(w.location.reload).toHaveBeenCalled();
    expect(JSON.stringify(commands())).not.toContain('private@example.com');
  });
  it('does not initialize on a private page from a stale public-route callback', async () => {
    w.location.pathname = '/account/private@example.com'; response = bootstrap(true); await init();
    engine().pageView('/hosting');
    expect(commands()).toHaveLength(0);
    expect(dom.window.document.getElementById('ch247-ga4-sdk')).toBeNull();
  });
  it('stops on private navigation even if the pending callback refers to a public route', async () => {
    response = bootstrap(true); await init(); const before = commands().length;
    w.location.pathname = '/account/private@example.com'; engine().pageView('/hosting');
    expect(commands()).toHaveLength(before); expect(w['ga-disable-G-1234567890']).toBe(true);
    expect(w.location.reload).toHaveBeenCalledOnce();
  });
  it('ignores a stale private-route callback when the current page is public', async () => {
    response = bootstrap(true); await init(); const before = commands().length;
    engine().pageView('/account/private@example.com');
    expect(commands()).toHaveLength(before); expect(w.location.reload).not.toHaveBeenCalled();
    expect(w['ga-disable-G-1234567890']).toBe(false);
  });
  it('fails closed if a Google tag or GTM is already present', async () => {
    const script = dom.window.document.createElement('script'); script.src = 'https://www.googletagmanager.com/gtm.js?id=GTM-123'; dom.window.document.head.appendChild(script);
    response = bootstrap(true); await init();
    expect(commands()).toHaveLength(0); expect(engine().snapshot().analytics.status).toBe('duplicate_warning');
  });
});

describe('Smarty-style public page initialization', () => {
  it.each([
    ['canonical', '../../../../templates/cloudhost247/js/marketing.js'],
    ['legacy', '../../../../templates/cloudhost247_legacy/js/marketing.js'],
  ])('initializes the %s theme through its same-origin Node mount after consent', async (_theme, path) => {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://example.com/business-hosting.php', runScripts: 'outside-only' });
    const script = dom.window.document.createElement('script');
    script.setAttribute('data-marketing-api', '/platform/api/v1/marketing');
    Object.defineProperty(dom.window.document, 'currentScript', { configurable: true, value: script });
    const fetch = vi.fn(async () => ({ ok: true, json: async () => bootstrap(true) }));
    (dom.window as any).fetch = fetch;
    dom.window.eval(readFileSync(resolve(__dirname, path), 'utf8'));
    const engine = (dom.window as any).CloudHost247Marketing;
    await engine.ready();
    expect(fetch).toHaveBeenCalledWith('/platform/api/v1/marketing/bootstrap', expect.objectContaining({ credentials: 'same-origin' }));
    const commands = ((dom.window as any).dataLayer || []).map((entry: IArguments) => Array.from(entry));
    expect(commands.find((entry: any[]) => entry[1] === 'page_view')[2].page_location).toBe('https://example.com/business-hosting.php');
    expect(dom.window.document.getElementById('ch247-ga4-sdk')).toBeTruthy();
    dom.window.close();
  });
  it.each([
    '../../../../templates/cloudhost247/includes/marketing.tpl',
    '../../../../templates/cloudhost247_legacy/footer.tpl',
  ])('keeps the theme script versioned and guarded by the same-origin platform mount', path => {
    const template = readFileSync(resolve(__dirname, path), 'utf8');
    expect(template).toContain('{if $ch247Site.platform}');
    expect(template).toMatch(/js\/marketing\.js\?v=\d{8}(?:\.\d+)?/);
    expect(template).toContain('data-marketing-api="{$ch247Site.platform|escape}/api/v1/marketing"');
    expect(template).toContain('data-visitor-intelligence-api="{$ch247Site.platform|escape}/api/v1/visitor-intelligence"');
    expect(template).toContain('if !$adminLoggedIn && !$adminMasqueradingAsClient');
  });
  it('does not initialize from a cross-origin mount', () => {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://example.com/business-hosting.php', runScripts: 'outside-only' });
    const script = dom.window.document.createElement('script'); script.setAttribute('data-marketing-api', '//attacker.example/api');
    Object.defineProperty(dom.window.document, 'currentScript', { configurable: true, value: script });
    const fetch = vi.fn(); (dom.window as any).fetch = fetch; dom.window.eval(source);
    expect(fetch).not.toHaveBeenCalled(); expect(dom.window.document.getElementById('ch247-ga4-sdk')).toBeNull();
    dom.window.close();
  });
});
