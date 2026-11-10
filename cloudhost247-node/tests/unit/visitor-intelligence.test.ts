import { describe, expect, it } from 'vitest';
import { sanitizePagePath, sanitizeReferrerHost } from '../../src/routes/visitor-intelligence';
import { classifyClient, isAutomatedAgent, resolveApproximateGeo } from '../../src/visitor-intelligence/geo';
import { isVisitorSessionExpired, resolveDateWindow } from '../../src/visitor-intelligence/service';

const NOW = new Date('2026-11-09T12:00:00.000Z');

describe('Visitor Intelligence input privacy', () => {
  it('strips query strings/fragments and replaces likely identifiers embedded in paths', () => {
    expect(sanitizePagePath('/hosting/pro?email=person%40example.test&token=secret#pricing')).toBe('/hosting/pro');
    expect(sanitizePagePath('/invoices/12345678-1234-4234-8234-123456789012')).toBe('/invoices/:id');
    expect(sanitizePagePath('/contact/person%40example.test')).toBe('/contact/:id');
    expect(sanitizePagePath('/contact/person%2540example.test')).toBe('/contact/:id');
    expect(sanitizePagePath('/domains/example-customer.com/health')).toBe('/domains/:id/health');
    expect(sanitizePagePath('/lookup/8.8.8.8')).toBe('/lookup/:id');
    expect(sanitizePagePath('/client/cus_7n2B4F9dQq')).toBe('/client/:id');
    expect(sanitizePagePath('/catalog/this-segment-is-fine')).toBe('/catalog/this-segment-is-fine');
  });

  it('rejects non-origin paths and excludes administration, APIs and health endpoints', () => {
    for (const path of ['https://example.test/page', '//example.test/page', 'admin', '/admin', '/admin/users', '/api/v1/private', '/health/live', '/ready']) {
      expect(() => sanitizePagePath(path)).toThrow();
    }
  });

  it('redacts encoded query-like path data and rejects encoded route escapes', () => {
    expect(sanitizePagePath('/reset/password%3Ftoken%3Dsecret')).toBe('/reset/:id');
    expect(sanitizePagePath('/reset/password%253Ftoken%253Dsecret')).toBe('/reset/:id');
    expect(sanitizePagePath('/reset/token%2526email%253Dperson%2540example.test')).toBe('/reset/:id');
    expect(() => sanitizePagePath('/public/%2e%2e/admin')).toThrow(/dot segments/);
    expect(() => sanitizePagePath('/public/%252e%252e/admin')).toThrow(/dot segments/);
    expect(() => sanitizePagePath('/public/%2e%2e%2fadmin')).toThrow(/dot segments/);
    expect(() => sanitizePagePath('/%61dmin/users')).toThrow(/not collected/);
    expect(() => sanitizePagePath('/admin%2Fusers')).toThrow(/not collected/);
    expect(() => sanitizePagePath('/%2561dmin%252fusers')).toThrow(/not collected/);
    expect(() => sanitizePagePath('/admin%2Fusers%ZZ')).toThrow(/not collected/);
    expect(() => sanitizePagePath('/api%252fv1/private')).toThrow(/not collected/);
    expect(() => sanitizePagePath('/health%5Clive')).toThrow(/not collected/);
    expect(sanitizePagePath('/catalog/hello%20world')).toBe('/catalog/hello%20world');
  });

  it('stores only a valid external referrer hostname and suppresses same-site referrals', () => {
    expect(sanitizeReferrerHost('https://accounts.customer-123.example.test/story?email=person%40example.test', 'www.cloudhost247.com')).toBe('example.test');
    expect(sanitizeReferrerHost('https://www.cloudhost247.com/page', 'cloudhost247.com')).toBeNull();
    expect(sanitizeReferrerHost('https://8.8.8.8/path', 'cloudhost247.com')).toBeNull();
    expect(sanitizeReferrerHost('javascript:alert(1)', 'cloudhost247.com')).toBeNull();
    expect(sanitizeReferrerHost('https://user:password@example.test/path', 'cloudhost247.com')).toBe('example.test');
  });
});

describe('coarse client and geography classification', () => {
  it('classifies a coarse device/browser/OS family without exposing raw User-Agent text', () => {
    const profile = classifyClient('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
    expect(profile).toEqual({ deviceCategory: 'mobile', browserFamily: 'Safari', osFamily: 'iOS' });
    expect(profile).not.toHaveProperty('userAgent');
  });

  it('identifies common crawlers, synthetic monitoring and command-line probes', () => {
    for (const userAgent of ['Googlebot/2.1', 'Lighthouse', 'UptimeRobot/2.0', 'Prometheus blackbox', 'curl/8.7.1']) {
      expect(isAutomatedAgent(userAgent)).toBe(true);
    }
    expect(isAutomatedAgent('Mozilla/5.0 Chrome/128.0 Safari/537.36')).toBe(false);
    expect(isAutomatedAgent(undefined)).toBe(false);
  });

  it('never returns the input address as GeoIP output and rounds coordinates to a coarse estimate', () => {
    const location = resolveApproximateGeo('8.8.8.8');
    expect(location).not.toHaveProperty('ip');
    expect(JSON.stringify(location)).not.toContain('8.8.8.8');
    if (location.latitude !== null) expect(location.latitude * 10).toBeCloseTo(Math.round(location.latitude * 10), 8);
    if (location.longitude !== null) expect(location.longitude * 10).toBeCloseTo(Math.round(location.longitude * 10), 8);
  });
});

describe('Visitor Intelligence session expiry', () => {
  it('expires at exactly 30 minutes and keeps sessions younger than the boundary', () => {
    const now = new Date('2026-11-09T12:00:00.000Z');
    expect(isVisitorSessionExpired(new Date(now.getTime() - 30 * 60 * 1000), now)).toBe(true);
    expect(isVisitorSessionExpired(new Date(now.getTime() - 30 * 60 * 1000 + 1), now)).toBe(false);
    expect(isVisitorSessionExpired(new Date(now.getTime() - 30 * 60 * 1000 - 1), now)).toBe(true);
  });
});

describe('Visitor Intelligence date windows', () => {
  it('uses UTC day boundaries and bounded custom ranges', () => {
    expect(resolveDateWindow({ range: 'today' }, NOW)).toMatchObject({ from: new Date('2026-11-09T00:00:00.000Z'), to: new Date('2026-11-10T00:00:00.000Z') });
    expect(resolveDateWindow({ range: '7d' }, NOW)).toMatchObject({ from: new Date('2026-11-03T00:00:00.000Z'), to: new Date('2026-11-10T00:00:00.000Z') });
    expect(() => resolveDateWindow({ range: 'custom', from: '2025-01-01', to: '2026-11-09' }, NOW)).toThrow(/366 days/);
    expect(() => resolveDateWindow({ range: 'custom', from: '2026-11-10', to: '2026-11-09' }, NOW)).toThrow(/valid custom/);
  });
});
