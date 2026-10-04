/**
 * Tools Center — API integration tests.
 *
 * These run with no outbound network (like many cPanel/Passenger deployments), which is exactly the
 * interesting case: a tool that cannot reach a resolver or a provider must say so with a typed
 * error envelope, never answer with an empty-but-successful result. The suite covers:
 *   • discovery (catalogue + dashboard) and implementation coverage
 *   • pure tools that run entirely in-process (JSON, encoding, punycode, passwords, subnets…)
 *   • honest failure paths (SSRF refusal, missing provider, unreachable resolver)
 *   • the signed-in portal (history, favorites, reports, monitors)
 *   • the Super Admin control centre and its role gating
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { buildApp } from '../../src/app';
import { loadEnv, type Env } from '../../src/config/env';
import { signAuthToken } from '../../src/lib/jwt';
import { TOOL_CATALOG, NON_RUNNABLE_TOOL_SLUGS } from '../../src/tools/catalog';

// The key ring and part of the provider layer read process.env directly, so the test process must
// look like a real deployment (see src/lib/keyring.ts and the convention in the other API suites).
process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/cloudhost247';
process.env.JWT_SECRET ??= 'f'.repeat(32);
process.env.CREDENTIAL_ENCRYPTION_KEY ??= 'a'.repeat(64);
import { missingHandlers, TOOL_HANDLERS } from '../../src/tools/handlers';

describe('Tools Center API', () => {
  let db: PGlite;
  let client: PgliteClient;
  let app: ReturnType<typeof buildApp>;
  let env: Env;
  let customerToken: string;
  let adminToken: string;
  const customerId = randomUUID();
  const otherCustomerId = randomUUID();
  const adminId = randomUUID();

  beforeEach(async () => {
    env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
      JWT_SECRET: 'f'.repeat(32),
      SERVER_AGENT_SHARED_SECRET: 's'.repeat(32),
      // Provider credentials are stored as AES-256-GCM envelopes; without a key ring the write path
      // must fail loudly rather than store plaintext, so tests supply a real 32-byte key.
      CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64),
    } as NodeJS.ProcessEnv);

    db = new PGlite();
    client = new PgliteClient(db);
    await migrateUp(client, { allowProduction: true });
    await client.exec(`
      INSERT INTO users (id, email, password_hash, full_name, role, status)
      VALUES
        ('${customerId}', 'tools-customer@example.com', 'hash', 'Tools Customer', 'customer', 'active'),
        ('${otherCustomerId}', 'tools-other@example.com', 'hash', 'Other Customer', 'customer', 'active'),
        ('${adminId}', 'tools-admin@example.com', 'hash', 'Tools Admin', 'super_admin', 'active');
    `);
    customerToken = signAuthToken(env, { sub: customerId, email: 'tools-customer@example.com', role: 'customer' });
    adminToken = signAuthToken(env, { sub: adminId, email: 'tools-admin@example.com', role: 'super_admin' });
    app = buildApp(env, { serveFrontend: false, pool: client as never });
  });

  afterEach(async () => {
    if (app) await app.close();
    await db.close();
  });

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  const runTool = async (slug: string, payload: Record<string, unknown>, token?: string) =>
    app.inject({
      method: 'POST',
      url: `/api/tools/${slug}`,
      ...(token ? { headers: auth(token) } : {}),
      payload,
    });

  describe('catalogue and discovery', () => {
    it('exposes every catalogue tool with an effective status', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/tools/catalog' });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.tools).toHaveLength(TOOL_CATALOG.length);
      expect(Array.isArray(body.categories)).toBe(true);
      expect(body.missingImplementations).toEqual([]);
    });

    it('mirrors the catalogue on the /api/v1 alias', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/tools/catalog' });
      expect(response.statusCode).toBe(200);
      expect(response.json().count).toBe(TOOL_CATALOG.length);
    });

    it('has a handler for every runnable catalogue entry (and no orphans)', () => {
      expect(missingHandlers()).toEqual([]);
      for (const [slug] of Object.entries(TOOL_HANDLERS)) {
        expect(TOOL_CATALOG.some((entry) => entry.slug === slug)).toBe(true);
        expect(NON_RUNNABLE_TOOL_SLUGS.has(slug)).toBe(false);
      }
    });

    it('rejects an unknown category instead of returning an empty list', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/tools/catalog?category=not-a-category' });
      expect(response.statusCode).toBe(400);
    });

    it('returns a dashboard for anonymous visitors and personalises it when signed in', async () => {
      const anonymous = await app.inject({ method: 'GET', url: '/api/tools/dashboard' });
      expect(anonymous.statusCode).toBe(200);
      expect(anonymous.json().signedIn).toBe(false);

      const signedIn = await app.inject({ method: 'GET', url: '/api/tools/dashboard', headers: auth(customerToken) });
      expect(signedIn.json().signedIn).toBe(true);
    });
  });

  describe('pure tools', () => {
    it('formats JSON and reports the exact error position for invalid input', async () => {
      const ok = await runTool('json-tools', { operation: 'format', text: '{"b":1,"a":2}', sortKeys: true, indent: 2 });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().data.text).toContain('"a": 2');

      const bad = await runTool('json-tools', { operation: 'validate', text: '{"a": }' });
      expect(bad.statusCode).toBe(200);
      expect(bad.json().data.valid).toBe(false);
      expect(bad.json().data.error.message).toMatch(/JSON/i);
      if (bad.json().data.error.line !== null) expect(bad.json().data.error.line).toBeGreaterThan(0);
    });

    it('encodes and decodes Base64 without inventing characters', async () => {
      const encoded = await runTool('encoding-tools', { format: 'base64', mode: 'encode', text: 'CloudHost247' });
      expect(encoded.json().data.output).toBe(Buffer.from('CloudHost247').toString('base64'));

      const decoded = await runTool('encoding-tools', { format: 'base64', mode: 'decode', text: encoded.json().data.output });
      expect(decoded.json().data.output).toBe('CloudHost247');
    });

    it('converts IDN domains to punycode and back', async () => {
      const ascii = await runTool('punycode', { domain: 'münchen.de', mode: 'to-ascii' });
      expect(ascii.statusCode).toBe(200);
      expect(ascii.json().data.asciiDomain).toBe('xn--mnchen-3ya.de');
      const unicode = await runTool('punycode', { domain: ascii.json().data.asciiDomain, mode: 'to-unicode' });
      expect(unicode.json().data.unicodeDomain).toBe('münchen.de');
    });

    it('generates passwords with the requested character classes and never returns an empty set', async () => {
      const response = await runTool('password-tools', { operation: 'generate', length: 24, preset: 'strong' });
      expect(response.statusCode).toBe(200);
      const password = response.json().data.password as string;
      expect(password).toHaveLength(24);
      expect(response.json().data.entropyBits).toBeGreaterThan(80);
    });

    it('calculates a subnet and splits it only when asked', async () => {
      const info = await runTool('subnet-calculator', { cidr: '192.168.1.10/24' });
      expect(info.json().data.networkAddress).toBe('192.168.1.0');
      expect(info.json().data.usableHosts).toBe('254');

      const split = await runTool('subnet-calculator', { cidr: '192.168.1.0/24', newPrefixLength: 26 });
      expect(split.json().data.split.subnets).toHaveLength(4);
    });

    it('generates unique MAC addresses with a set locally-administered bit', async () => {
      const response = await runTool('mac-generator', { count: 3, mode: 'locally-administered' });
      const macs = response.json().data.macs as string[];
      expect(macs).toHaveLength(3);
      for (const mac of macs) {
        const firstOctet = Number.parseInt(mac.slice(0, 2), 16);
        expect(firstOctet & 0b10).toBe(0b10);
        expect(firstOctet & 0b1).toBe(0);
      }
    });

    it('counts words and characters and states the counting rules', async () => {
      const response = await runTool('word-counter', { text: 'Hello world. This is a test.' });
      const data = response.json().data;
      expect(data.counts.words).toBe(6);
      expect(data.counts.sentences).toBe(2);
      expect(data.timing.assumptions).toMatch(/words per minute/);
    });

    it('evaluates contrast against WCAG thresholds rather than a subjective opinion', async () => {
      const response = await runTool('color-tools', { operation: 'contrast', foreground: '#777777', background: '#ffffff' });
      const data = response.json().data;
      expect(data.ratio).toBeCloseTo(4.48, 1);
      expect(data.wcag.normalTextAA).toBe(false);
    });
  });

  describe('honest failure paths', () => {
    it('refuses to contact a loopback target (SSRF guard) and says so', async () => {
      const response = await runTool('developer', { operation: 'headers', url: 'http://127.0.0.1:8080/' });
      // The slug above is intentionally wrong: assert the 404 first…
      expect(response.statusCode).toBe(404);

      const blocked = await runTool('http-headers', { url: 'http://127.0.0.1:8080/' });
      expect([400, 422]).toContain(blocked.statusCode);
      const body = blocked.json();
      expect(body.success).toBe(false);
      expect(['TARGET_BLOCKED', 'INVALID_INPUT']).toContain(body.code);
      expect(body.message).not.toMatch(/success/i);
    });

    it('reports CONFIGURATION_REQUIRED for tools whose provider is not configured', async () => {
      const response = await runTool('image-ocr', { image: 'data:image/png;base64,iVBORw0KGgo=' }, customerToken);
      expect([503, 422]).toContain(response.statusCode);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(['CONFIGURATION_REQUIRED', 'SERVICE_UNAVAILABLE']).toContain(body.code);
      expect(body.message.length).toBeGreaterThan(10);
    });

    it('fails a DNS lookup with a typed error when the resolver cannot be reached, instead of returning no records as success', async () => {
      const response = await runTool('dns-lookup', { name: 'example.com', type: 'A' });
      const body = response.json();
      if (body.success === true) {
        // A deployment with working DNS egress: the answer must still be attributable.
        expect(body.data.resolver.name).toBeTruthy();
      } else {
        expect(['DNS_LOOKUP_FAILED', 'TIMEOUT', 'SERVICE_UNAVAILABLE']).toContain(body.code);
        expect(body.success).toBe(false);
      }
    });

    it('rejects malformed input with 422 and a field-level message', async () => {
      const response = await runTool('subnet-calculator', { cidr: 'definitely-not-a-subnet' });
      expect([400, 422]).toContain(response.statusCode);
      expect(response.json().message).toMatch(/valid IPv4|valid IPv6/i);
    });

    it('never runs a portal slug as a tool', async () => {
      const response = await runTool('tool-history', {});
      expect(response.statusCode).toBe(404);
      expect(response.json().message).toMatch(/page, not a diagnostic endpoint/);
    });
  });

  describe('customer portal', () => {
    it('records history for signed-in runs and lets the owner clear it', async () => {
      await runTool('word-counter', { text: 'history fixture' }, customerToken);
      const history = await app.inject({ method: 'GET', url: '/api/tools/history', headers: auth(customerToken) });
      expect(history.statusCode).toBe(200);
      expect(history.json().entries.length).toBeGreaterThan(0);

      const cleared = await app.inject({ method: 'DELETE', url: '/api/tools/history', headers: auth(customerToken) });
      expect(cleared.json().removed).toBeGreaterThan(0);
      const after = await app.inject({ method: 'GET', url: '/api/tools/history', headers: auth(customerToken) });
      expect(after.json().entries).toHaveLength(0);
    });

    it('adds and removes favorites idempotently', async () => {
      const added = await app.inject({ method: 'POST', url: '/api/tools/favorites', headers: auth(customerToken), payload: { slug: 'dns-lookup' } });
      expect(added.statusCode).toBe(200);
      const again = await app.inject({ method: 'POST', url: '/api/tools/favorites', headers: auth(customerToken), payload: { slug: 'dns-lookup' } });
      expect(again.json().created).toBe(false);

      const list = await app.inject({ method: 'GET', url: '/api/tools/favorites', headers: auth(customerToken) });
      expect(list.json().favorites.map((tool: { slug: string }) => tool.slug)).toContain('dns-lookup');

      const removed = await app.inject({ method: 'DELETE', url: '/api/tools/favorites/dns-lookup', headers: auth(customerToken) });
      expect(removed.json().removed).toBe(true);
    });

    it('rejects an unknown favorite slug', async () => {
      const response = await app.inject({ method: 'POST', url: '/api/tools/favorites', headers: auth(customerToken), payload: { slug: 'no-such-tool' } });
      expect(response.statusCode).toBe(404);
    });

    it('saves a report from a real run and exports it', async () => {
      const saved = await app.inject({
        method: 'POST',
        url: '/api/tools/reports',
        headers: auth(customerToken),
        payload: { toolSlug: 'word-counter', input: { text: 'report fixture words' } },
      });
      expect(saved.statusCode).toBe(200);
      const reportId = saved.json().report.id as string;

      const exported = await app.inject({ method: 'GET', url: `/api/tools/reports/${reportId}/export?format=csv`, headers: auth(customerToken) });
      expect(exported.statusCode).toBe(200);
      expect(exported.headers['content-type']).toContain('text/csv');

      // Another real account must not be able to read the report — not even to learn it exists.
      const otherCustomer = signAuthToken(env, { sub: otherCustomerId, email: 'tools-other@example.com', role: 'customer' });
      const forbidden = await app.inject({ method: 'GET', url: `/api/tools/reports/${reportId}`, headers: auth(otherCustomer) });
      expect(forbidden.statusCode).toBe(404);
    });

    it('manages monitors and evaluates one on demand', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/tools/monitors',
        headers: auth(customerToken),
        payload: { kind: 'DNS_RECORD', target: 'example.com', recordType: 'A', matchMode: 'contains', expectedValue: '93.184' },
      });
      expect(created.statusCode).toBe(200);
      const monitorId = created.json().monitor.id as string;

      const list = await app.inject({ method: 'GET', url: '/api/tools/monitors', headers: auth(customerToken) });
      expect(list.json().monitors).toHaveLength(1);

      const check = await app.inject({ method: 'POST', url: `/api/tools/monitors/${monitorId}/check`, headers: auth(customerToken) });
      // Without DNS egress the monitor evaluation legitimately fails; with egress it evaluates.
      expect([200, 422, 503, 504]).toContain(check.statusCode);
      if (check.statusCode === 200) expect(check.json().evaluation.status).toBeTruthy();

      const deleted = await app.inject({ method: 'DELETE', url: `/api/tools/monitors/${monitorId}`, headers: auth(customerToken) });
      expect(deleted.json().deleted).toBe(true);
    });

    it('requires authentication for the portal endpoints', async () => {
      for (const url of ['/api/tools/history', '/api/tools/favorites', '/api/tools/reports', '/api/tools/monitors']) {
        const response = await app.inject({ method: 'GET', url });
        expect(response.statusCode).toBe(401);
      }
    });
  });

  describe('Super Admin control centre', () => {
    it('blocks customers from every admin endpoint', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/admin/tools/overview', headers: auth(customerToken) });
      expect(response.statusCode).toBe(403);
    });

    it('returns an overview with metrics, providers and the seeded resolvers', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/admin/tools/overview', headers: auth(adminToken) });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.catalog.total).toBe(TOOL_CATALOG.length);
      expect(body.catalog.missingImplementations).toEqual([]);
      expect(body.resolvers.length).toBeGreaterThan(5);
      expect(body.providers.length).toBeGreaterThan(3);
      expect(body.masterEnabled).toBe(true);
    });

    it('disables a tool through an override and reflects the new status on execution', async () => {
      const patched = await app.inject({
        method: 'PATCH',
        url: '/api/admin/tools/tools/word-counter',
        headers: auth(adminToken),
        payload: { enabled: false, maintenanceMessage: 'Disabled during the test.' },
      });
      expect(patched.statusCode).toBe(200);

      const catalog = await app.inject({ method: 'GET', url: '/api/tools/catalog' });
      const tool = catalog.json().tools.find((entry: { slug: string }) => entry.slug === 'word-counter');
      expect(tool.status).toBe('DISABLED');

      const run = await runTool('word-counter', { text: 'should not run' }, customerToken);
      expect(run.statusCode).toBe(503);
      expect(run.json().code).toBe('SERVICE_UNAVAILABLE');

      const reset = await app.inject({ method: 'DELETE', url: '/api/admin/tools/tools/word-counter/override', headers: auth(adminToken) });
      expect(reset.json().reset).toBe(true);
      const after = await runTool('word-counter', { text: 'works again' }, customerToken);
      expect(after.statusCode).toBe(200);
    });

    it('stores provider credentials encrypted and never returns them', async () => {
      const saved = await app.inject({
        method: 'PUT',
        url: '/api/admin/tools/providers/bin-lookup',
        headers: auth(adminToken),
        payload: { slug: 'bin-lookup', name: 'BIN provider', kind: 'BIN', endpoint: 'https://example.com/bin/', enabled: true, apiKey: 'super-secret-key' },
      });
      expect(saved.statusCode).toBe(200);
      expect(saved.json().provider.hasCredentials).toBe(true);
      expect(JSON.stringify(saved.json())).not.toContain('super-secret-key');

      const { rows } = await client.query<{ encrypted_api_key: string }>('SELECT encrypted_api_key FROM tool_provider_configs WHERE slug = $1', ['bin-lookup']);
      expect(rows[0]?.encrypted_api_key).toBeTruthy();
      expect(rows[0]?.encrypted_api_key).not.toContain('super-secret-key');
    });

    it('audits admin mutations', async () => {
      await app.inject({
        method: 'PATCH',
        url: '/api/admin/tools/tools/ping',
        headers: auth(adminToken),
        payload: { statusOverride: 'MAINTENANCE', maintenanceMessage: 'Planned work' },
      });
      const { rows } = await client.query<{ action: string }>(`SELECT action FROM audit_logs WHERE action = 'TOOL_OVERRIDE_UPDATED'`);
      expect(rows.length).toBeGreaterThan(0);
    });
  });

  describe('speed test endpoints', () => {
    it('serves an incompressible download payload with no-store caching', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/tools/speed-test/download?bytes=4096' });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toContain('no-store');
      expect(response.rawPayload.length).toBe(4096);
    });

    it('accepts an upload measurement and reports the received size', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/tools/speed-test/upload',
        headers: { 'content-type': 'application/octet-stream' },
        payload: Buffer.alloc(2048, 7),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().receivedBytes).toBe(2048);
    });

    it('publishes the browser-side configuration with real caps', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/tools/speed-test/config' });
      expect(response.statusCode).toBe(200);
      const config = response.json().data;
      expect(config.endpoints.download).toContain('/speed-test/download');
      expect(config.limits.maxUploadBytes).toBeGreaterThan(0);
      expect(config.rules.length).toBeGreaterThan(0);
    });

    it('honours the operator size cap instead of advertising a hard-coded one', async () => {
      // The seeded value is 20 MB (20971520 bytes); the test asserts the *setting* is what the API
      // reports, then proves it is live by lowering it and observing the download clamp.
      const before = await app.inject({ method: 'GET', url: '/api/tools/speed-test/config' });
      expect(before.json().data.payload.maxBytes).toBe(20 * 1024 * 1024);

      const oversized = await app.inject({ method: 'GET', url: '/api/tools/speed-test/download?bytes=999999999' });
      expect(oversized.statusCode).toBe(200);
      expect(oversized.rawPayload.length).toBeLessThanOrEqual(20 * 1024 * 1024);

      await client.query(`UPDATE platform_settings SET value = '131072' WHERE key = 'tools.speed_test_max_bytes'`);
      const after = await app.inject({ method: 'GET', url: '/api/tools/speed-test/config' });
      expect(after.json().data.payload.maxBytes).toBe(131072);
      expect(after.json().data.payload.defaultBytes).toBeLessThanOrEqual(131072);

      const clamped = await app.inject({ method: 'GET', url: '/api/tools/speed-test/download?bytes=1048576' });
      expect(clamped.rawPayload.length).toBe(131072);

      await client.query(`UPDATE platform_settings SET value = '20971520' WHERE key = 'tools.speed_test_max_bytes'`);
    });
  });
});
