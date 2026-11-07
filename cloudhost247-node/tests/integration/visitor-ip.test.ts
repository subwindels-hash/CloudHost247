import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { registerVisitorIpRoute, resolveVisitorIp } from '../../src/routes/visitor-ip';

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
    expect(first.json()).toEqual({ ip: '8.8.8.8', privacyStatus: 'unknown' });
    expect(second.json()).toEqual({ ip: '1.1.1.1', privacyStatus: 'unknown' });
    expect(first.headers['cache-control']).toMatch(/private.*no-store/);
    expect(first.headers['cross-origin-resource-policy']).toBe('same-origin');
    await app.close();
  });
});
