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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CONSOLE_TEST_API_TOKEN;
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
});
