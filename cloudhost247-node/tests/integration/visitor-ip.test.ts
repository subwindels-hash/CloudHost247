import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { registerVisitorIpRoute, resolveVisitorIp, trustedProxyAllowlistIsValid } from '../../src/routes/visitor-ip';

const base = { NODE_ENV: 'test', DATABASE_URL: 'postgresql://u:p@localhost/test', JWT_SECRET: 'a'.repeat(32) };

describe('visitor IP boundary', () => {
  it('supports direct IPv4, IPv6 and IPv4-mapped sockets without trusting headers', () => {
    expect(resolveVisitorIp('8.8.8.8', '1.1.1.1', 'direct')).toBe('8.8.8.8');
    expect(resolveVisitorIp('2606:4700:4700::1111', undefined, 'direct')).toBe('2606:4700:4700::1111');
    expect(resolveVisitorIp('::ffff:8.8.8.8', undefined, 'direct')).toBe('8.8.8.8');
  });
  it('is disabled by default, and never returns private or invalid peer addresses', () => {
    expect(resolveVisitorIp('8.8.8.8', undefined, 'off')).toBeNull();
    for (const address of ['127.0.0.1', '10.0.0.2', '::1', 'fd00::1', 'not an ip']) {
      expect(resolveVisitorIp(address, undefined, 'direct')).toBeNull();
    }
  });
  it('uses forwarded headers only for a configured trusted peer and walks the chain safely', () => {
    expect(resolveVisitorIp('10.0.0.5', '9.9.9.9, 8.8.8.8, 10.0.0.4', 'trusted-proxy', '10.0.0.0/24')).toBe('8.8.8.8');
    expect(resolveVisitorIp('8.8.8.8', '1.1.1.1', 'trusted-proxy', '10.0.0.0/24')).toBeNull();
    expect(resolveVisitorIp('10.0.0.5', '8.8.8.8', 'trusted-proxy')).toBeNull();
    expect(resolveVisitorIp('10.0.0.5', '8.8.8.8', 'trusted-proxy', '0.0.0.0/0')).toBeNull();
    expect(resolveVisitorIp('10.0.0.5', 'junk, 8.8.8.8', 'trusted-proxy', '10.0.0.5')).toBeNull();
    expect(resolveVisitorIp('10.0.0.5', '10.0.0.6', 'trusted-proxy', '10.0.0.0/24')).toBeNull();
    expect(resolveVisitorIp('::1', '2606:4700:4700::1111', 'trusted-proxy', '::1')).toBe('2606:4700:4700::1111');
  });
  it('sends only the current visitor address, with private no-store and unknown privacy status', async () => {
    const app = Fastify({ trustProxy: true });
    await registerVisitorIpRoute(app, loadEnv({ ...base, VISITOR_IP_MODE: 'trusted-proxy', VISITOR_IP_TRUSTED_PROXIES: '10.0.0.1' }));
    const first = await app.inject({ url: '/api/v1/visitor/ip', remoteAddress: '10.0.0.1', headers: { 'x-forwarded-for': '8.8.8.8' } });
    const second = await app.inject({ url: '/api/v1/visitor/ip', remoteAddress: '10.0.0.1', headers: { 'x-forwarded-for': '1.1.1.1' } });
    expect(first.json()).toEqual({ ip: '8.8.8.8', reason: 'detected', privacyStatus: 'unknown' });
    expect(second.json()).toEqual({ ip: '1.1.1.1', reason: 'detected', privacyStatus: 'unknown' });
    expect(first.headers['cache-control']).toMatch(/private.*no-store/);
    expect(first.headers['cross-origin-resource-policy']).toBe('same-origin');
    // The answer depends on a forwarding header, so an intermediary cache must key on it — the same
    // contract /api/v1/currency/geo-country is held to.
    expect(String(first.headers['vary'])).toContain('X-Forwarded-For');
    await app.close();
  });

  /**
   * The menu bar renders whatever reason it is given, so "no address" must never be a bare null:
   * the widget cannot otherwise tell a switched-off deployment from a broken network path, and says
   * "unavailable" for both.
   */
  it('names why nothing was detected, without disclosing the allowlist or the peer address', async () => {
    const app = Fastify({ trustProxy: true });
    await registerVisitorIpRoute(app, loadEnv({ ...base, VISITOR_IP_MODE: 'trusted-proxy', VISITOR_IP_TRUSTED_PROXIES: '10.0.0.1' }));

    // An untrusted peer that supplies its own forwarding header is the spoofing attempt.
    const untrusted = await app.inject({ url: '/api/v1/visitor/ip', remoteAddress: '203.0.113.9', headers: { 'x-forwarded-for': '8.8.8.8' } });
    expect(untrusted.json()).toMatchObject({ ip: null, reason: 'unverified' });

    // A trusted peer with no forwarding header at all.
    const noHeader = await app.inject({ url: '/api/v1/visitor/ip', remoteAddress: '10.0.0.1' });
    expect(noHeader.json()).toMatchObject({ ip: null, reason: 'unverified' });

    // A verified address that is not publicly routable is never presented as a visitor's IP.
    const notPublic = await app.inject({ url: '/api/v1/visitor/ip', remoteAddress: '10.0.0.1', headers: { 'x-forwarded-for': '192.168.1.5' } });
    expect(notPublic.json()).toMatchObject({ ip: null, reason: 'not_public' });

    for (const response of [untrusted, noHeader, notPublic]) {
      const body = JSON.stringify(response.json());
      expect(body).not.toContain('10.0.0.1');
      expect(body).not.toContain('203.0.113.9');
      expect(body).not.toMatch(/trusted.?prox/i);
    }
    await app.close();
  });

  it('reports "disabled" — not a network fault — when detection is switched off', async () => {
    const app = Fastify({ trustProxy: true });
    await registerVisitorIpRoute(app, loadEnv({ ...base }));
    const response = await app.inject({ url: '/api/v1/visitor/ip', remoteAddress: '8.8.8.8', headers: { 'x-forwarded-for': '8.8.8.8' } });
    expect(response.json()).toEqual({ ip: null, reason: 'disabled', privacyStatus: 'unknown' });
    await app.close();
  });
});

/**
 * `VISITOR_IP_TRUSTED_PROXIES` fails closed, so a typo silently disables the menu-bar detector
 * instead of crashing anything. `npm run env:check` is the only place that surfaces it, which makes
 * the allowlist parser part of the operator contract rather than an internal detail.
 */
describe('trusted proxy allowlist validation', () => {
  it('accepts specific peers and CIDRs, and rejects anything that would trust too much', () => {
    expect(trustedProxyAllowlistIsValid('203.0.113.7')).toBe(true);
    expect(trustedProxyAllowlistIsValid('203.0.113.7, 198.51.100.0/24, ::1')).toBe(true);
    expect(trustedProxyAllowlistIsValid(undefined)).toBe(false);
    expect(trustedProxyAllowlistIsValid('')).toBe(false);
    expect(trustedProxyAllowlistIsValid('0.0.0.0/0')).toBe(false);
    expect(trustedProxyAllowlistIsValid('::/0')).toBe(false);
    expect(trustedProxyAllowlistIsValid('not-an-ip')).toBe(false);
    expect(trustedProxyAllowlistIsValid('10.0.0.0/24,')).toBe(false);
    expect(trustedProxyAllowlistIsValid('10.0.0.0/33')).toBe(false);
  });
});
