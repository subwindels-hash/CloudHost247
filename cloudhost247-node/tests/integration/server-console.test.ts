import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { buildApp } from '../../src/app';
import { loadEnv } from '../../src/config/env';
import { createUser } from '../../src/db/users';
import { signAuthToken } from '../../src/lib/jwt';

const UBUNTU_2404 = '20000000-0000-0000-0000-000000000006';

/**
 * Console access is the one server action that cannot be queued: the session credential is only
 * useful in the browser that asked for it. It therefore has to carry the same guarantees the
 * queued actions get — ownership, declared capability, audit trail — while never fabricating a
 * session when the provider integration is absent.
 */
describe('serial console sessions', () => {
  let db: PGlite;
  const env = loadEnv({
    NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@localhost/test', JWT_SECRET: 'c'.repeat(32),
  } as NodeJS.ProcessEnv);

  const configuredProviderId = randomUUID();
  const unconfiguredProviderId = randomUUID();
  const regionId = randomUUID();
  let ownerToken = '';
  let strangerToken = '';
  let ownerId = '';
  const vultrProviderId = randomUUID();
  let vultrServerId = '';
  let consoleServerId = '';
  let noConsoleServerId = '';
  let unconfiguredServerId = '';
  let notCreatedServerId = '';

  beforeAll(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
    const owner = await createUser(db, {
      id: randomUUID(), email: `console-${randomUUID()}@example.com`, passwordHash: 'hash', fullName: 'Console Owner',
    });
    const stranger = await createUser(db, {
      id: randomUUID(), email: `stranger-${randomUUID()}@example.com`, passwordHash: 'hash', fullName: 'Stranger',
    });
    ownerId = owner.id;
    ownerToken = signAuthToken(env, { sub: owner.id, role: 'customer', email: owner.email });
    strangerToken = signAuthToken(env, { sub: stranger.id, role: 'customer', email: stranger.email });

    await db.query(
      `INSERT INTO infrastructure_providers(id,name,slug,provider_type,adapter,status,api_base_url,credential_env_prefix)
       VALUES($1,'Console bridge','console-bridge','OTHER','generic_http','ACTIVE','https://bridge.invalid','CONSOLE_TEST'),
             ($2,'Silent bridge','silent-bridge','OTHER','generic_http','ACTIVE','https://silent.invalid','SILENT_TEST')`,
      [configuredProviderId, unconfiguredProviderId]
    );
    // A real Vultr provider, used to prove the corrected capability end to end: the profile flag is
    // `console: true`, the server row carries the flag, and the route builds the real adapter.
    await db.query(
      `INSERT INTO infrastructure_providers(id,name,slug,provider_type,adapter,status,api_base_url,credential_env_prefix)
       VALUES($1,'Vultr console','vultr-console','VULTR','vultr','ACTIVE','https://api.vultr.test/v2','CONSOLE_VULTR')`,
      [vultrProviderId]
    );
    await db.query(
      `INSERT INTO infrastructure_regions(id,provider_id,code,name,status) VALUES($1,$2,'console-1','Console Region','ACTIVE')`,
      [regionId, configuredProviderId]
    );
    const imageId = randomUUID();
    await db.query(
      `INSERT INTO server_os_images(id,provider_id,operating_system_version_id,provider_image_id,architecture,region_id,status,verified_at)
       VALUES($1,$2,$3,'ubuntu-24.04','x86_64',$4,'ACTIVE',now())`,
      [imageId, configuredProviderId, UBUNTU_2404, regionId]
    );
    const vultrRegionId = randomUUID();
    await db.query(
      `INSERT INTO infrastructure_regions(id,provider_id,code,name,status) VALUES($1,$2,'vultr-1','Vultr Region','ACTIVE')`,
      [vultrRegionId, vultrProviderId]
    );
    const vultrImageId = randomUUID();
    await db.query(
      `INSERT INTO server_os_images(id,provider_id,operating_system_version_id,provider_image_id,architecture,region_id,status,verified_at)
       VALUES($1,$2,$3,'vultr-ubuntu-24.04','x86_64',$4,'ACTIVE',now())`,
      [vultrImageId, vultrProviderId, UBUNTU_2404, vultrRegionId]
    );

    consoleServerId = randomUUID();
    noConsoleServerId = randomUUID();
    unconfiguredServerId = randomUUID();
    notCreatedServerId = randomUUID();
    await db.query(
      `INSERT INTO servers(id,name,hostname,server_type,status,customer_id,provider_id,region_id,
         operating_system_version_id,os_image_id,architecture,provisioning_status,provider_server_id,capabilities)
       VALUES
         ($1,'console-vps','console.example.test','VPS','active',$5,$6,$7,$8,$9,'x86_64','READY','srv-101','{"console":true}'::jsonb),
         ($2,'plain-vps','plain.example.test','VPS','active',$5,$6,$7,$8,$9,'x86_64','READY','srv-102','{"console":false}'::jsonb),
         ($3,'silent-vps','silent.example.test','VPS','active',$5,$10,$7,$8,$9,'x86_64','READY','srv-103','{"console":true}'::jsonb),
         ($4,'pending-vps','pending.example.test','VPS','queued',$5,$6,$7,$8,$9,'x86_64','QUEUED',NULL,'{"console":true}'::jsonb)`,
      [consoleServerId, noConsoleServerId, unconfiguredServerId, notCreatedServerId,
        ownerId, configuredProviderId, regionId, UBUNTU_2404, imageId, unconfiguredProviderId]
    );
    vultrServerId = randomUUID();
    await db.query(
      `INSERT INTO servers(id,name,hostname,server_type,status,customer_id,provider_id,region_id,
         operating_system_version_id,os_image_id,architecture,provisioning_status,provider_server_id,capabilities)
       VALUES($1,'vultr-vps','vultr.example.test','VPS','active',$2,$3,$4,$5,$6,'x86_64','READY','vultr-inst-1','{"console":true}'::jsonb)`,
      [vultrServerId, ownerId, vultrProviderId, vultrRegionId, UBUNTU_2404, vultrImageId]
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CONSOLE_TEST_API_TOKEN;
    delete process.env.CONSOLE_VULTR_API_TOKEN;
  });

  afterAll(async () => { await db.close(); });

  it('hides another customer server behind a 404 instead of confirming it exists', async () => {
    const app = buildApp(env, { serveFrontend: false, pool: db });
    const response = await app.inject({
      method: 'POST', url: `/api/v1/servers/${consoleServerId}/console`,
      headers: { authorization: `Bearer ${strangerToken}` },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('refuses console access when the product does not declare the capability', async () => {
    const app = buildApp(env, { serveFrontend: false, pool: db });
    const response = await app.inject({
      method: 'POST', url: `/api/v1/servers/${noConsoleServerId}/console`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toMatch(/not supported/i);
    await app.close();
  });

  it('refuses a server that has not been created at the provider yet', async () => {
    const app = buildApp(env, { serveFrontend: false, pool: db });
    const response = await app.inject({
      method: 'POST', url: `/api/v1/servers/${notCreatedServerId}/console`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(response.statusCode).toBe(409);
    await app.close();
  });

  it('fails closed with 503 when the provider integration has no credentials', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const app = buildApp(env, { serveFrontend: false, pool: db });
    const response = await app.inject({
      method: 'POST', url: `/api/v1/servers/${unconfiguredServerId}/console`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toBe('SERVICE_UNAVAILABLE');
    // No credential, no call: the adapter never reaches the network and never invents a session.
    expect(fetchSpy).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns the provider session to the owner and audits the access without the credential', async () => {
    process.env.CONSOLE_TEST_API_TOKEN = 'test-token';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ url: 'https://bridge.invalid/console/abc', password: 'one-time-secret', type: 'vnc' }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )));
    const app = buildApp(env, { serveFrontend: false, pool: db });
    const response = await app.inject({
      method: 'POST', url: `/api/v1/servers/${consoleServerId}/console`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().console).toMatchObject({ url: 'https://bridge.invalid/console/abc', type: 'vnc' });

    const audit = await db.query<{ action: string; metadata: Record<string, unknown> }>(
      `SELECT action,metadata FROM audit_logs WHERE resource_id=$1 AND action='SERVER_CONSOLE_OPENED'`,
      [consoleServerId]
    );
    expect(audit.rows).toHaveLength(1);
    expect(JSON.stringify(audit.rows[0]?.metadata ?? {})).not.toMatch(/one-time-secret|console\/abc/);
    await app.close();
  });

  it('serves a Vultr KVM URL through the real adapter, read fresh on every request', async () => {
    // The whole A23 correction, end to end: the stored server capability says console, the route
    // builds the real Vultr adapter, and the adapter reads the instance's own `kvm` field. Two
    // requests are two provider reads, because Vultr rotates the URL and says not to cache it.
    process.env.CONSOLE_VULTR_API_TOKEN = 'vultr-token';
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify({
        instance: {
          id: 'vultr-inst-1', status: 'active', power_status: 'running',
          kvm: `https://my.vultr.test/subs/vps/novnc/api.php?data=${urls.length}`,
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const app = buildApp(env, { serveFrontend: false, pool: db });

    const first = await app.inject({
      method: 'POST', url: `/api/v1/servers/${vultrServerId}/console`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const second = await app.inject({
      method: 'POST', url: `/api/v1/servers/${vultrServerId}/console`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });

    expect(first.statusCode).toBe(200);
    expect(first.json().console).toEqual({ url: 'https://my.vultr.test/subs/vps/novnc/api.php?data=1', type: 'novnc' });
    expect(second.json().console).toEqual({ url: 'https://my.vultr.test/subs/vps/novnc/api.php?data=2', type: 'novnc' });
    expect(urls).toEqual([
      'https://api.vultr.test/v2/instances/vultr-inst-1',
      'https://api.vultr.test/v2/instances/vultr-inst-1',
    ]);

    // The audit trail records that access happened, never the credential.
    const audit = await db.query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM audit_logs WHERE resource_id=$1 AND action='SERVER_CONSOLE_OPENED'`,
      [vultrServerId]
    );
    expect(audit.rows).toHaveLength(2);
    expect(JSON.stringify(audit.rows)).not.toMatch(/novnc\/api\.php|my\.vultr\.test/);
    await app.close();
  });
});
