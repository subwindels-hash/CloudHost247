import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { buildApp } from '../../src/app';
import { loadEnv } from '../../src/config/env';
import { createUser } from '../../src/db/users';
import { signAuthToken } from '../../src/lib/jwt';
import { HetznerProviderAdapter } from '../../src/infrastructure/providers/hetzner-adapter';
import { ProxmoxProviderAdapter } from '../../src/infrastructure/providers/proxmox-adapter';
import type { InfrastructureProviderRow } from '../../src/db/infrastructure-providers';
import { ProviderError } from '../../src/infrastructure/providers/types';

/**
 * Rescue mode boots a server from the provider's own rescue system so a customer can repair a
 * machine that will not boot. Two things must hold: only providers that really offer rescue may
 * expose it, and the one-time root password the provider generates must reach the customer's
 * browser without ever being written to the database, the audit trail or a log line.
 */
describe('rescue mode', () => {
  let db: PGlite;
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://test:test@localhost/test',
    JWT_SECRET: 'i'.repeat(32),
  } as NodeJS.ProcessEnv);

  const RESCUE_PASSWORD = 'x7Qp-provider-generated-secret';
  let ownerId = '';
  let ownerToken = '';

  async function seedServer(options: { adapter: string; capabilities: Record<string, boolean>; providerStatus?: string }) {
    const providerId = randomUUID();
    const serverId = randomUUID();
    await db.query(
      `INSERT INTO infrastructure_providers(id,name,slug,provider_type,adapter,status) VALUES($1,'Rescue provider',$2,'OTHER',$3,$4)`,
      [providerId, `rescue-${providerId}`, options.adapter, options.providerStatus ?? 'ACTIVE']
    );
    await db.query(
      `INSERT INTO servers(id,name,hostname,server_type,status,customer_id,provider_id,provider_server_id,operating_system_version_id,architecture,provisioning_status,capabilities,metadata)
       VALUES($1,'rescue-vps','rescue.example.test','VPS','active',$2,$3,'provider-77','20000000-0000-0000-0000-000000000006','x86_64','READY',$4,$5)`,
      [serverId, ownerId, providerId, JSON.stringify(options.capabilities), JSON.stringify({ providerPlan: { providerServerType: 'cx22' } })]
    );
    return { providerId, serverId };
  }

  beforeAll(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
    const owner = await createUser(db, {
      id: randomUUID(), email: `rescue-${randomUUID()}@example.com`, passwordHash: 'hash', fullName: 'Rescue Owner',
    });
    ownerId = owner.id;
    ownerToken = signAuthToken(env, { sub: owner.id, role: 'customer', email: owner.email });
  });

  afterAll(async () => { await db.close(); });

  it('refuses rescue on a server whose template does not grant it', async () => {
    const { serverId } = await seedServer({ adapter: 'hetzner', capabilities: { start: true, stop: true } });
    const app = buildApp(env, { serveFrontend: false, pool: db });
    const response = await app.inject({
      method: 'POST', url: `/api/v1/servers/${serverId}/rescue`,
      headers: { authorization: `Bearer ${ownerToken}` }, payload: { confirmation: 'RESCUE' },
    });
    expect(response.statusCode).toBe(400);
    expect((await db.query<{ status: string }>(`SELECT status FROM servers WHERE id=$1`, [serverId])).rows[0]?.status).toBe('active');
    await app.close();
  });

  it('does not expose another customer\'s server, even with a valid session', async () => {
    const { serverId } = await seedServer({ adapter: 'hetzner', capabilities: { rescue: true } });
    const intruder = await createUser(db, {
      id: randomUUID(), email: `intruder-${randomUUID()}@example.com`, passwordHash: 'hash', fullName: 'Intruder',
    });
    const app = buildApp(env, { serveFrontend: false, pool: db });
    const response = await app.inject({
      method: 'POST', url: `/api/v1/servers/${serverId}/rescue`,
      headers: { authorization: `Bearer ${signAuthToken(env, { sub: intruder.id, role: 'customer', email: intruder.email })}` },
      payload: { confirmation: 'RESCUE' },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('reports a provider that has no rescue system instead of pretending', async () => {
    const { serverId } = await seedServer({ adapter: 'proxmox', capabilities: { rescue: true } });
    const app = buildApp(env, { serveFrontend: false, pool: db });
    const response = await app.inject({
      method: 'POST', url: `/api/v1/servers/${serverId}/rescue`,
      headers: { authorization: `Bearer ${ownerToken}` }, payload: { confirmation: 'RESCUE' },
    });
    // Proxmox has no rescue API: the adapter refuses, and nothing about the server changes.
    expect([400, 502, 503]).toContain(response.statusCode);
    expect((await db.query<{ status: string }>(`SELECT status FROM servers WHERE id=$1`, [serverId])).rows[0]?.status).toBe('active');
    await app.close();
  });

  it('hands the one-time password to the caller and stores it nowhere', async () => {
    const { serverId } = await seedServer({ adapter: 'hetzner', capabilities: { rescue: true } });
    const app = buildApp(env, { serveFrontend: false, pool: db });
    const calls: string[] = [];
    // Stand in for the Hetzner API at the transport boundary, so the adapter's real request
    // sequence (enable_rescue then reset) is what gets exercised.
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      const body = url.includes('enable_rescue')
        ? { root_password: RESCUE_PASSWORD, action: { id: 1, status: 'success' } }
        : { action: { id: 2, status: 'success' } };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof globalThis.fetch;
    process.env.HETZNER_API_TOKEN = 'test-token';

    try {
      const response = await app.inject({
        method: 'POST', url: `/api/v1/servers/${serverId}/rescue`,
        headers: { authorization: `Bearer ${ownerToken}` }, payload: { confirmation: 'RESCUE' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().rescue).toMatchObject({ type: 'linux64', username: 'root', password: RESCUE_PASSWORD, rebooted: true });
      expect(calls.some((url) => url.includes('/actions/enable_rescue'))).toBe(true);
      expect(calls.some((url) => url.includes('/actions/reset'))).toBe(true);
    } finally {
      globalThis.fetch = original;
      delete process.env.HETZNER_API_TOKEN;
    }

    // The credential must exist nowhere in our own storage.
    const server = (await db.query<{ status: string; metadata: Record<string, unknown> }>(
      `SELECT status,metadata FROM servers WHERE id=$1`, [serverId]
    )).rows[0]!;
    expect(server.status).toBe('maintenance');
    expect(JSON.stringify(server.metadata)).not.toContain(RESCUE_PASSWORD);
    expect((server.metadata.rescue as { type?: string } | undefined)?.type).toBe('linux64');

    const audits = await db.query<{ action: string; metadata: Record<string, unknown> }>(
      `SELECT action,metadata FROM audit_logs WHERE resource_id=$1`, [serverId]
    );
    expect(audits.rows.map((row) => row.action)).toContain('SERVER_RESCUE_ENTERED');
    expect(JSON.stringify(audits.rows)).not.toContain(RESCUE_PASSWORD);

    const anywhere = await db.query<{ count: number }>(
      `SELECT count(*)::int count FROM provisioning_jobs WHERE server_id=$1`, [serverId]
    );
    expect(anywhere.rows[0]?.count).toBe(0);
    await app.close();
  });

  it('returns the server to its installed operating system when rescue is left', async () => {
    const { serverId } = await seedServer({ adapter: 'hetzner', capabilities: { rescue: true } });
    await db.query(
      `UPDATE servers SET status='maintenance', metadata = metadata || $2::jsonb WHERE id=$1`,
      [serverId, JSON.stringify({ rescue: { enteredAt: new Date().toISOString(), type: 'linux64' } })]
    );
    const app = buildApp(env, { serveFrontend: false, pool: db });
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ action: { id: 3, status: 'success' } }), { status: 200, headers: { 'content-type': 'application/json' } })
    ) as typeof globalThis.fetch;
    process.env.HETZNER_API_TOKEN = 'test-token';
    try {
      const response = await app.inject({
        method: 'DELETE', url: `/api/v1/servers/${serverId}/rescue`, headers: { authorization: `Bearer ${ownerToken}` },
      });
      expect(response.statusCode).toBe(200);
    } finally {
      globalThis.fetch = original;
      delete process.env.HETZNER_API_TOKEN;
    }
    const server = (await db.query<{ status: string; metadata: Record<string, unknown> }>(
      `SELECT status,metadata FROM servers WHERE id=$1`, [serverId]
    )).rows[0]!;
    expect(server.status).toBe('active');
    expect(server.metadata.rescue).toBeUndefined();
    await app.close();
  });

  it('every adapter without a rescue API refuses it as a non-retryable unsupported operation', async () => {
    const row = { id: randomUUID(), adapter: 'proxmox', name: 'P', slug: 'p', provider_type: 'PROXMOX', status: 'ACTIVE' } as unknown as InfrastructureProviderRow;
    const proxmox = new ProxmoxProviderAdapter(row, { PROXMOX_API_TOKEN: 't', PROXMOX_API_URL: 'https://pve.example.test' } as NodeJS.ProcessEnv);
    await expect(proxmox.enableRescue('1', { architecture: 'x86_64' })).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION', retryable: false });
    await expect(proxmox.disableRescue('1')).rejects.toBeInstanceOf(ProviderError);

    // Hetzner, which does offer one, must not be caught by the same refusal.
    const hetznerRow = { id: randomUUID(), adapter: 'hetzner', name: 'H', slug: 'h', provider_type: 'HETZNER', status: 'ACTIVE' } as unknown as InfrastructureProviderRow;
    const hetzner = new HetznerProviderAdapter(hetznerRow, { HETZNER_API_TOKEN: 't' } as NodeJS.ProcessEnv);
    expect(typeof hetzner.enableRescue).toBe('function');
  });
});
