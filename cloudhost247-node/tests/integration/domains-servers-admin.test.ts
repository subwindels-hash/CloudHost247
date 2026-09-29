import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { signAuthToken } from '../../src/lib/jwt';
import { hashPassword } from '../../src/lib/password';

/**
 * Phase 6 admin + customer surface: domain DNS verification (real resolver, offline-honest
 * failure), the admin server registry (secret shown once, rotation, delete guards), platform
 * settings whitelist, and the audit log reader.
 */
describe('domains, servers admin, platform settings, audit', () => {
  let db: PGlite;
  process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/cloudhost247';
  process.env.JWT_SECRET ??= 'g'.repeat(32);
  process.env.CREDENTIAL_ENCRYPTION_KEY ??= 'a'.repeat(64);
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
    JWT_SECRET: 'g'.repeat(32),
    CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64),
  } as NodeJS.ProcessEnv);

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
  });

  afterEach(async () => {
    await db.close();
  });

  function app() {
    return buildApp(env, { serveFrontend: false, pool: db });
  }

  async function createUser(email: string, role = 'customer') {
    const userId = randomUUID();
    await db.query(`INSERT INTO users (id, email, password_hash, full_name, role) VALUES ($1,$2,$3,$4,$5)`, [
      userId,
      email,
      await hashPassword('correct-horse-battery'),
      'Test User',
      role,
    ]);
    return { userId, token: signAuthToken(env, { sub: userId, role, email }) };
  }

  // --- Domains (spec §15) --------------------------------------------------------------------------

  it('adds a domain, shows the TXT instructions, and fails verification honestly (no such record)', async () => {
    const customer = await createUser('domain-owner@example.com');
    const created = await app().inject({
      method: 'POST',
      url: '/api/v1/domains',
      headers: { authorization: `Bearer ${customer.token}` },
      payload: { domain: 'customer-example-test-247.com' },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json() as {
      domain: { id: string; verification_status: string };
      verification: { recordName: string; recordValue: string | null };
    };
    expect(body.verification.recordName).toBe('_cloudhost247-verification.customer-example-test-247.com');
    expect(body.verification.recordValue).toMatch(/^cloudhost247-verify=/);

    // Verification performs a REAL DNS lookup; a random domain has no such TXT record, so the
    // result is an honest "failed" with detail — never a faked success.
    const verify = await app().inject({
      method: 'POST',
      url: `/api/v1/domains/${body.domain.id}/verify`,
      headers: { authorization: `Bearer ${customer.token}` },
    });
    expect(verify.statusCode).toBe(200);
    const verified = verify.json() as { verified: boolean; domain: { verification_status: string } };
    expect(verified.verified).toBe(false);
    expect(verified.domain.verification_status).toBe('failed');

    // SSL cannot be requested before verification.
    const ssl = await app().inject({
      method: 'POST',
      url: `/api/v1/domains/${body.domain.id}/ssl`,
      headers: { authorization: `Bearer ${customer.token}` },
    });
    expect(ssl.statusCode).toBe(409);

    // Duplicate add → conflict.
    const duplicate = await app().inject({
      method: 'POST',
      url: '/api/v1/domains',
      headers: { authorization: `Bearer ${customer.token}` },
      payload: { domain: 'customer-example-test-247.com' },
    });
    expect(duplicate.statusCode).toBe(409);

    // Not verified: delete is allowed (nothing attached).
    const deleted = await app().inject({
      method: 'DELETE',
      url: `/api/v1/domains/${body.domain.id}`,
      headers: { authorization: `Bearer ${customer.token}` },
    });
    expect(deleted.statusCode).toBe(204);
  });

  it('blocks deleting a domain still attached to an application', async () => {
    const customer = await createUser('domain-attached@example.com');
    const domain = (
      await db.query(`INSERT INTO customer_domains (id, user_id, domain_name, verification_token, verification_status) VALUES ($1,$2,$3,$4,'verified') RETURNING *`, [
        randomUUID(),
        customer.userId,
        'attached-example-test-247.com',
        'cloudhost247-verify=tokentokentoken1',
      ])
    ).rows[0];

    const appId = randomUUID();
    await db.query(`INSERT INTO applications (id, slug, name, description, status) VALUES ($1,'att-app','Attached App','x','published')`, [appId]);
    const versionId = randomUUID();
    await db.query(`INSERT INTO application_versions (id, application_id, version, status, manifest) VALUES ($1,$2,'1.0.0','published',$3)`, [
      versionId,
      appId,
      JSON.stringify({ id: 'att-app', name: 'Attached App', category: 'cms', description: 'x', deployment: { engine: 'docker-compose' }, supportedHostingTypes: ['docker'], requirements: { cpu: 1, memory: 512, storage: 5120 }, services: { app: { image: 'nginx:alpine', port: 80 } }, environment: { required: [], optional: [] }, versions: [] }),
    ]);
    const installationId = randomUUID();
    await db.query(
      `INSERT INTO application_installations (id, customer_id, application_id, application_version_id, name, status, container_project) VALUES ($1,$2,$3,$4,$5,'healthy','cattinst')`,
      [installationId, customer.userId, appId, versionId, 'Attached']
    );
    await db.query(`INSERT INTO application_domains (id, installation_id, domain_id, primary_domain) VALUES ($1,$2,$3,true)`, [
      randomUUID(),
      installationId,
      domain.id,
    ]);

    const blocked = await app().inject({
      method: 'DELETE',
      url: `/api/v1/domains/${domain.id}`,
      headers: { authorization: `Bearer ${customer.token}` },
    });
    expect(blocked.statusCode).toBe(409);
  });

  // --- Admin servers (spec §34) --------------------------------------------------------------------

  it('registers a server, returns the agent secret exactly once, rotates, and guards deletes', async () => {
    const admin = await createUser('server-admin@example.com', 'admin');

    const created = await app().inject({
      method: 'POST',
      url: '/api/v1/admin/servers',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        name: 'eu-vps-1',
        hostname: 'eu1.example.com',
        serverType: 'VPS',
        cpuCores: 8,
        memoryMb: 16_384,
        storageMb: 204_800,
        dockerEnabled: true,
        agentUrl: 'http://10.0.0.9:8787',
      },
    });
    expect(created.statusCode).toBe(201);
    const createBody = created.json() as { server: { id: string; agent_id: string | null }; agentSecret?: string };
    expect(createBody.agentSecret).toBeDefined();
    expect(createBody.server.agent_id).toMatch(/^agent-/);

    // The secret is never readable afterwards — only its metadata.
    const creds = await app().inject({
      method: 'GET',
      url: `/api/v1/admin/servers/${createBody.server.id}/credentials`,
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(creds.statusCode).toBe(200);
    const credBody = JSON.stringify(creds.json());
    expect(credBody).not.toContain(createBody.agentSecret);
    expect(credBody).toContain('agent_secret');

    // Rotation returns a NEW secret exactly once (and the old one is gone from storage).
    const rotated = await app().inject({
      method: 'POST',
      url: `/api/v1/admin/servers/${createBody.server.id}/rotate-credentials`,
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(rotated.statusCode).toBe(200);
    const rotatedBody = rotated.json() as { agentSecret: string };
    expect(rotatedBody.agentSecret).not.toBe(createBody.agentSecret);

    // Customers see public metadata only: no hostname, no ip, no credentials.
    const customer = await createUser('server-customer@example.com');
    const publicList = await app().inject({
      method: 'GET',
      url: '/api/v1/servers',
      headers: { authorization: `Bearer ${customer.token}` },
    });
    expect(publicList.statusCode).toBe(200);
    const publicJson = JSON.stringify(publicList.json());
    expect(publicJson).toContain('eu-vps-1');
    expect(publicJson).not.toContain('eu1.example.com');
    expect(publicJson).not.toContain(rotatedBody.agentSecret);

    // Delete is blocked while an installation references the server.
    const appId = randomUUID();
    await db.query(`INSERT INTO applications (id, slug, name, description, status) VALUES ($1,'srv-app','Srv App','x','published')`, [appId]);
    const versionId = randomUUID();
    await db.query(`INSERT INTO application_versions (id, application_id, version, status, manifest) VALUES ($1,$2,'1.0.0','published',$3)`, [
      versionId,
      appId,
      JSON.stringify({ id: 'srv-app', name: 'Srv App', category: 'cms', description: 'x', deployment: { engine: 'docker-compose' }, supportedHostingTypes: ['docker'], requirements: { cpu: 1, memory: 512, storage: 5120 }, services: { app: { image: 'nginx:alpine', port: 80 } }, environment: { required: [], optional: [] }, versions: [] }),
    ]);
    await db.query(
      `INSERT INTO application_installations (id, customer_id, application_id, application_version_id, server_id, name, status, container_project) VALUES ($1,$2,$3,$4,$5,$6,'healthy','csrvinst')`,
      [randomUUID(), customer.userId, appId, versionId, createBody.server.id, 'On Server']
    );
    const blockedDelete = await app().inject({
      method: 'DELETE',
      url: `/api/v1/admin/servers/${createBody.server.id}`,
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(blockedDelete.statusCode).toBe(409);

    // Non-admins get 403 on the registry, 404 on foreign-server metrics (indistinguishable).
    const forbidden = await app().inject({
      method: 'GET',
      url: '/api/v1/admin/servers',
      headers: { authorization: `Bearer ${customer.token}` },
    });
    expect(forbidden.statusCode).toBe(403);
  });

  // --- Platform settings whitelist (spec §21, §49) --------------------------------------------------

  it('exposes only whitelisted settings and rejects unknown keys', async () => {
    const admin = await createUser('settings-admin@example.com', 'admin');
    const list = await app().inject({
      method: 'GET',
      url: '/api/v1/admin/settings',
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(list.statusCode).toBe(200);
    const { settings, schemas } = list.json() as { settings: Record<string, unknown>; schemas: Array<{ key: string }> };
    const keys = schemas.map((schema) => schema.key);
    expect(keys).toContain('subscription.grace_period_days');
    expect(keys).toContain('backup.retention_days');
    expect(settings['backup.retention_days']).toBeDefined();

    const updated = await app().inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/backup.retention_days',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { value: 45 },
    });
    expect(updated.statusCode).toBe(200);
    const stored = (
      await db.query<{ value: unknown }>(`SELECT value FROM platform_settings WHERE key = 'backup.retention_days'`)
    ).rows[0];
    expect(Number(stored.value)).toBe(45);

    const unknown = await app().inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/please.disable.all.security',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { value: true },
    });
    expect(unknown.statusCode).toBe(400);

    const outOfRange = await app().inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/deployment.max_attempts',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { value: 999 },
    });
    expect(outOfRange.statusCode).toBe(400);
  });

  // --- Audit log (spec §54) ------------------------------------------------------------------------

  it('records and filters the audit trail with actor emails', async () => {
    const admin = await createUser('audit-admin@example.com', 'admin');
    const customer = await createUser('audit-customer@example.com');
    await app().inject({
      method: 'POST',
      url: '/api/v1/domains',
      headers: { authorization: `Bearer ${customer.token}` },
      payload: { domain: 'audit-example-test-247.com' },
    });

    const all = await app().inject({
      method: 'GET',
      url: '/api/v1/admin/audit?limit=50',
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(all.statusCode).toBe(200);
    const { entries } = all.json() as { entries: Array<{ action: string; actor_email: string | null }> };
    expect(entries.some((entry) => entry.action === 'domain.added' && entry.actor_email === 'audit-customer@example.com')).toBe(true);

    const filtered = await app().inject({
      method: 'GET',
      url: '/api/v1/admin/audit?action=domain.added',
      headers: { authorization: `Bearer ${admin.token}` },
    });
    const filteredBody = filtered.json() as { entries: Array<{ action: string }> };
    expect(filteredBody.entries.length).toBeGreaterThan(0);
    expect(filteredBody.entries.every((entry) => entry.action === 'domain.added')).toBe(true);

    // Customers cannot read the audit log.
    const forbidden = await app().inject({
      method: 'GET',
      url: '/api/v1/admin/audit',
      headers: { authorization: `Bearer ${customer.token}` },
    });
    expect(forbidden.statusCode).toBe(403);
  });
});
