/**
 * One IP detector, two surfaces.
 *
 * The menu bar shows the visitor's address twice over: the header widget
 * (`/api/v1/visitor/ip`) and the Tools → IP Tools → "What Is My IP" page
 * (`/api/tools/my-ip`). They used to resolve the address by different rules — the header through a
 * deployment-verified boundary, the tool through Fastify's globally-trusted `request.ip` — so the
 * same visit could be told two different things, and the tool would name the reverse proxy's own
 * address as the visitor's.
 *
 * These run through the real `buildApp` on an embedded Postgres, not mocks, so they cover the
 * routing, the tool registry and the executor envelope as well as the resolver.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { buildApp } from '../../src/app';
import { loadEnv, type Env } from '../../src/config/env';

process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/cloudhost247';
process.env.JWT_SECRET ??= 'f'.repeat(32);
process.env.CREDENTIAL_ENCRYPTION_KEY ??= 'a'.repeat(64);

const TRUSTED_EDGE = '10.0.0.1';
const VISITOR = '102.89.234.5';

function envWith(mode: 'off' | 'direct' | 'trusted-proxy', proxies?: string): Env {
  return loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
    JWT_SECRET: 'f'.repeat(32),
    SERVER_AGENT_SHARED_SECRET: 's'.repeat(32),
    CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64),
    VISITOR_IP_MODE: mode,
    ...(proxies ? { VISITOR_IP_TRUSTED_PROXIES: proxies } : {}),
  } as NodeJS.ProcessEnv);
}

describe('the header detector and the my-ip tool agree', () => {
  let db: PGlite;
  let client: PgliteClient;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    db = new PGlite();
    client = new PgliteClient(db);
    await migrateUp(client, { allowProduction: true });
  });

  afterEach(async () => {
    if (app) await app.close();
    await db.close();
  });

  async function bothSurfaces(mode: 'off' | 'direct' | 'trusted-proxy', request: {
    remoteAddress: string;
    headers?: Record<string, string>;
    proxies?: string;
  }) {
    app = buildApp(envWith(mode, request.proxies), { serveFrontend: false, pool: client as never });
    const header = await app.inject({ url: '/api/v1/visitor/ip', remoteAddress: request.remoteAddress, headers: request.headers });
    const tool = await app.inject({ url: '/api/tools/my-ip', remoteAddress: request.remoteAddress, headers: request.headers });
    return { header, tool };
  }

  it('reports the same verified address on both surfaces when the boundary confirms one', async () => {
    const { header, tool } = await bothSurfaces('trusted-proxy', {
      remoteAddress: TRUSTED_EDGE,
      headers: { 'x-forwarded-for': VISITOR },
      proxies: TRUSTED_EDGE,
    });

    expect(header.statusCode).toBe(200);
    expect(header.json()).toMatchObject({ ip: VISITOR, reason: 'detected' });

    expect(tool.statusCode).toBe(200);
    const body = tool.json() as { success: boolean; data: Record<string, unknown> };
    expect(body.success).toBe(true);
    expect(body.data['detectedAddress']).toBe(VISITOR);
    expect(body.data['ipv4']).toBe(VISITOR);
    expect(body.data['detection']).toMatchObject({ status: 'detected', reason: 'detected' });
  });

  it('reports nothing on either surface for a caller who states their own address', async () => {
    const { header, tool } = await bothSurfaces('trusted-proxy', {
      // The peer is not the configured edge, so its forwarding header is caller-supplied.
      remoteAddress: '203.0.113.9',
      headers: { 'x-forwarded-for': '8.8.8.8' },
      proxies: TRUSTED_EDGE,
    });

    expect(header.json()).toMatchObject({ ip: null, reason: 'unverified' });
    const data = (tool.json() as { data: Record<string, unknown> }).data;
    expect(data['detectedAddress']).toBeNull();
    expect(data['detection']).toMatchObject({ status: 'unavailable', reason: 'unverified' });
    // The caller's own value is still visible in the two diagnostic fields that are explicitly
    // labelled as received-not-verified. It must never reach a field that answers the question.
    expect(data['ipv4']).toBeNull();
    expect(data['ipv6']).toBeNull();
    expect(data['forwardedFor']).toEqual(['8.8.8.8']);
    const answerFields = Object.entries(data).filter(([key]) => !['forwardedFor', 'headers', 'detection'].includes(key));
    expect(JSON.stringify(answerFields)).not.toContain('8.8.8.8');
  });

  /**
   * The reproduced defect: with detection off, the header said "unavailable" while the tool answered
   * `127.0.0.1` — the server's own loopback, presented as the visitor's public IP.
   */
  it('never answers with the server’s own address when detection is off', async () => {
    const { header, tool } = await bothSurfaces('off', { remoteAddress: '127.0.0.1' });

    expect(header.json()).toMatchObject({ ip: null, reason: 'disabled' });
    const data = (tool.json() as { data: Record<string, unknown> }).data;
    expect(data['detectedAddress']).toBeNull();
    expect(data['ipv4']).toBeNull();
    expect(data['ipv6']).toBeNull();
    expect(data['detection']).toMatchObject({ status: 'unavailable', reason: 'disabled' });
    expect(JSON.stringify(data)).not.toContain('127.0.0.1');
  });

  it('keeps the tool out of shared caches, because its answer is per-visitor', async () => {
    const { tool } = await bothSurfaces('trusted-proxy', {
      remoteAddress: TRUSTED_EDGE,
      headers: { 'x-forwarded-for': VISITOR },
      proxies: TRUSTED_EDGE,
    });
    const cacheControl = String(tool.headers['cache-control'] ?? '');
    expect(cacheControl).toContain('no-store');
    expect(cacheControl).not.toMatch(/\bpublic\b/i);
    expect(cacheControl).not.toMatch(/s-maxage/i);
  });

  it('withholds the caller’s credentials from the echoed header list', async () => {
    // Only a cookie is sent here: any `authorization` header makes the executor try to
    // authenticate it, and a deliberately bogus token would fail the request with 401 before the
    // tool ever ran. The bearer-token case is asserted at unit level in tests/unit/tools-my-ip.test.ts.
    const { tool } = await bothSurfaces('trusted-proxy', {
      remoteAddress: TRUSTED_EDGE,
      headers: {
        'x-forwarded-for': VISITOR,
        cookie: 'cloudhost247_session=do-not-repeat-me',
      },
      proxies: TRUSTED_EDGE,
    });
    expect(tool.statusCode).toBe(200);
    const body = JSON.stringify(tool.json());
    expect(body).not.toContain('do-not-repeat-me');
    expect(body).toContain('«redacted»');
  });
});
