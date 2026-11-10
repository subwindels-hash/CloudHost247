// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error jsdom is a transitive test dependency and ships no declarations here.
import { JSDOM } from 'jsdom';

const source = readFileSync(resolve(__dirname, '../../../../shared/site/visitor-intelligence.js'), 'utf8');
const consent = (analytics: boolean) => ({
  decided: true,
  policyVersion: 1,
  preferences: { essential: true, analytics, marketing: false },
  expiresAt: '2099-01-01T00:00:00.000Z',
  csrfToken: 'csrf-secret-from-consent-runtime',
});

let dom: InstanceType<typeof JSDOM>;
let requests: Array<{ url: string; init: any }>;
let snapshot: any;
let listeners: Set<(value: any) => void>;

function setup(options: { analytics?: boolean; enabled?: boolean; role?: string } = {}) {
  dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://cloudhost247.com/hosting', runScripts: 'outside-only' });
  const w = dom.window as any;
  w.localStorage.clear();
  if (options.role) w.localStorage.setItem('ch247_user', JSON.stringify({ role: options.role }));
  requests = [];
  snapshot = { ready: true, consent: consent(options.analytics === true) };
  listeners = new Set();
  const marketing = {
    ready: () => Promise.resolve(marketing),
    subscribe: (listener: (value: any) => void) => { listeners.add(listener); listener(snapshot); return () => listeners.delete(listener); },
  };
  w.CloudHost247Marketing = marketing;
  w.fetch = vi.fn(async (url: string, init: any = {}) => {
    requests.push({ url, init });
    if (url.endsWith('/status')) return { ok: true, status: 200, json: async () => ({ enabled: options.enabled !== false, idleAfterSeconds: 120 }) };
    return { ok: true, status: 202, json: async () => ({ accepted: true }) };
  });
  w.eval(source);
  return w.CloudHost247VisitorIntelligence as {
    start: (options?: { apiBase?: string; autoPageView?: boolean }) => unknown;
    pageView: (path: string) => boolean;
    stop: () => void;
    isEnabled: () => boolean;
  };
}

async function settle() {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
}

beforeEach(() => vi.useRealTimers());
afterEach(() => { if (dom) { try { (dom.window as any).CloudHost247VisitorIntelligence?.stop(); } catch { /* closed fixture */ } dom.window.close(); } vi.restoreAllMocks(); });

describe('shared first-party Visitor Intelligence browser runtime', () => {
  it('fails closed before analytics consent: no status call, IDs, storage or pageview', async () => {
    const tracker = setup({ analytics: false, enabled: true });
    tracker.start({ apiBase: '/api/v1/visitor-intelligence', autoPageView: false });
    tracker.pageView('/hosting');
    await settle();
    expect(requests).toHaveLength(0);
    expect(dom.window.localStorage.getItem('ch247.visitor-intelligence.v1')).toBeNull();
    tracker.pageView('/hosting?email=private%40example.test');
    expect(requests).toHaveLength(0);
  });

  it('waits for operator enablement, then sends a consent-CSRF-bound sanitized anonymous pageview', async () => {
    const tracker = setup({ analytics: true, enabled: true });
    (dom.window as any).localStorage.setItem('ch247_token', 'normal-app-session-token');
    tracker.start({ apiBase: '/api/v1/visitor-intelligence', autoPageView: false });
    tracker.pageView('/hosting/pro?email=private%40example.test&token=do-not-store#plans');
    await settle();
    const status = requests.find((request) => request.url.endsWith('/status'));
    const pageview = requests.find((request) => request.url.endsWith('/pageview'));
    expect(status).toBeDefined();
    expect(pageview).toBeDefined();
    const payload = JSON.parse(pageview!.init.body);
    expect(payload).toMatchObject({ pagePath: '/hosting/pro', referrerHost: null });
    expect(payload.visitorId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(payload.sessionId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(payload.tabId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(pageview!.init.headers['X-Consent-CSRF']).toBe('csrf-secret-from-consent-runtime');
    expect(pageview!.init.headers.Authorization).toBe('Bearer normal-app-session-token');
    expect(JSON.stringify(payload)).not.toMatch(/private|do-not-store|csrf-secret/);
    expect(JSON.stringify(JSON.parse((dom.window as any).localStorage.getItem('ch247.visitor-intelligence.v1')))).not.toContain('csrf-secret-from-consent-runtime');
    expect(tracker.isEnabled()).toBe(true);
    tracker.pageView('/hosting/pro');
    await settle();
    expect(requests.filter((request) => request.url.endsWith('/pageview'))).toHaveLength(1);
  });

  it('does not collect encoded administrative or internal route aliases', async () => {
    const tracker = setup({ analytics: true, enabled: true });
    tracker.start({ apiBase: '/api/v1/visitor-intelligence', autoPageView: false });
    tracker.pageView('/admin%2Fusers');
    tracker.pageView('/%2561dmin%252fusers');
    tracker.pageView('/api%2fv1/private');
    await settle();
    expect(requests.filter((request) => request.url.endsWith('/pageview'))).toHaveLength(0);
    expect(dom.window.localStorage.getItem('ch247.visitor-intelligence.v1')).toBeNull();
  });

  it('does not create identifiers when the operator setting is disabled', async () => {
    const tracker = setup({ analytics: true, enabled: false });
    tracker.start({ apiBase: '/api/v1/visitor-intelligence', autoPageView: false });
    tracker.pageView('/hosting');
    await settle();
    expect(requests.map((request) => request.url)).toEqual(['/api/v1/visitor-intelligence/status']);
    expect(dom.window.localStorage.getItem('ch247.visitor-intelligence.v1')).toBeNull();
    expect(tracker.isEnabled()).toBe(false);
  });

  it('renews an idle session and tab identity when a sleeping tab wakes', async () => {
    let now = Date.now();
    const tracker = setup({ analytics: true, enabled: true });
    vi.spyOn(dom.window.Date, 'now').mockImplementation(() => now);
    tracker.start({ apiBase: '/api/v1/visitor-intelligence', autoPageView: false });
    tracker.pageView('/hosting');
    await settle();

    const initialPageview = requests.find((request) => request.url.endsWith('/pageview'));
    expect(initialPageview).toBeDefined();
    const initial = JSON.parse(initialPageview!.init.body);

    now += 31 * 60 * 1000;
    dom.window.dispatchEvent(new dom.window.Event('focus'));
    await settle();

    const pageviews = requests.filter((request) => request.url.endsWith('/pageview'));
    expect(pageviews).toHaveLength(2);
    const renewed = JSON.parse(pageviews[1]!.init.body);
    expect(renewed.visitorId).toBe(initial.visitorId);
    expect(renewed.sessionId).not.toBe(initial.sessionId);
    expect(renewed.tabId).not.toBe(initial.tabId);
  });

  it('renews the session when a tab wakes at exactly the 30-minute boundary', async () => {
    let now = Date.now();
    const tracker = setup({ analytics: true, enabled: true });
    vi.spyOn(dom.window.Date, 'now').mockImplementation(() => now);
    tracker.start({ apiBase: '/api/v1/visitor-intelligence', autoPageView: false });
    tracker.pageView('/hosting');
    await settle();
    const initial = JSON.parse(requests.find((request) => request.url.endsWith('/pageview'))!.init.body);

    now += 30 * 60 * 1000;
    dom.window.dispatchEvent(new dom.window.Event('focus'));
    await settle();

    const pageviews = requests.filter((request) => request.url.endsWith('/pageview'));
    expect(pageviews).toHaveLength(2);
    expect(JSON.parse(pageviews[1]!.init.body).sessionId).not.toBe(initial.sessionId);
  });

  it('clears anonymous browser identity immediately when analytics consent is withdrawn', async () => {
    const tracker = setup({ analytics: true, enabled: true });
    tracker.start({ apiBase: '/api/v1/visitor-intelligence', autoPageView: false });
    tracker.pageView('/hosting');
    await settle();
    expect(dom.window.localStorage.getItem('ch247.visitor-intelligence.v1')).not.toBeNull();
    const pageviewCount = requests.filter((request) => request.url.endsWith('/pageview')).length;
    snapshot = { ready: true, consent: consent(false) };
    listeners.forEach((listener) => listener(snapshot));
    expect(dom.window.localStorage.getItem('ch247.visitor-intelligence.v1')).toBeNull();
    expect(tracker.isEnabled()).toBe(false);
    expect(tracker.pageView('/after-withdrawal')).toBe(false);
    await settle();
    expect(requests.filter((request) => request.url.endsWith('/pageview'))).toHaveLength(pageviewCount);
  });

  it('does not collect staff browsing even when the browser has analytics consent', async () => {
    const tracker = setup({ analytics: true, enabled: true, role: 'admin' });
    tracker.start({ apiBase: '/api/v1/visitor-intelligence', autoPageView: false });
    tracker.pageView('/hosting');
    await settle();
    expect(requests).toHaveLength(0);
    expect(dom.window.localStorage.getItem('ch247.visitor-intelligence.v1')).toBeNull();
  });

  it('does not collect support-mode browsing in a delegated customer session', async () => {
    const tracker = setup({ analytics: true, enabled: true });
    dom.window.localStorage.setItem('ch247_support_origin', JSON.stringify({ token: 'staff-session', user: { role: 'admin' } }));
    tracker.start({ apiBase: '/api/v1/visitor-intelligence', autoPageView: false });
    tracker.pageView('/hosting');
    await settle();
    expect(requests).toHaveLength(0);
    expect(dom.window.localStorage.getItem('ch247.visitor-intelligence.v1')).toBeNull();
  });
});
