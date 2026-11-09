import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { buildApp } from '../../src/app';
import { loadEnv, type Env } from '../../src/config/env';
import { signAuthToken } from '../../src/lib/jwt';
import { hashPassword } from '../../src/lib/password';
import { createServer } from '../../src/db/servers';
import { enqueueDeployment, findDeploymentById } from '../../src/db/deployments';
import { processNextJob } from '../../src/worker/handlers';
import { createInstallationRequest } from '../../src/services/installation-service';
import { loadManifestCatalog, validatedManifests } from '../../src/marketplace/manifest-loader';
import { importManifests } from '../../src/marketplace/import-service';
import { createCustomerDomain } from '../../src/db/customer-domains';
import {
  createChannel,
  refreshChannelHealth,
  recordMessage,
  getConversation,
  getCustomerConversation,
} from '../../src/inbox/inbox-service';
import type { DeploymentAdapter } from '../../src/deployments/adapters/types';

/**
 * Phase 9 — Cross-module integration, lifecycle & failure-path certification.
 *
 * Every test below is **integration evidence**: real cloudhost247-node code paths (deployment
 * engine, routes, services) exercising a real PostgreSQL-compatible database (PGlite, separate
 * schema per test). The only stand-in is the outermost provider transport (WHM/agent), replaced
 * through the engine's documented `adapterOverride` test seam — it is part of the system under
 * test, never presented as a provider response, and no fabricated response is treated as live
 * certification. No external provider, sandbox or live credential is touched from this
 * environment (egress allowlist); none of these tests claim sandbox or live-provider evidence.
 */

const ok = { ok: true, code: 'OK', message: 'ok' } as const;

function stubAdapter(fail: Set<string> = new Set()): DeploymentAdapter & { calls: string[] } {
  const calls: string[] = [];
  const op = (name: string) => {
    calls.push(name);
    return fail.has(name) ? { ok: false, code: 'PROVIDER_DOWN', message: 'provider unreachable' } : { ...ok };
  };
  return {
    kind: 'docker',
    calls,
    deployApplication: async (_ctx, input) => op(`deploy:${input.project}`),
    destroyApplication: async (_ctx, project) => op(`teardown:${project}`),
    startApplication: async (_ctx, project) => op(`start:${project}`),
    stopApplication: async (_ctx, project) => op(`stop:${project}`),
    restartApplication: async (_ctx, project) => op(`restart:${project}`),
    applicationStatus: async () => ({ ...ok, running: true, health: 'healthy' }),
    applicationLogs: async () => ({ ...ok, logs: '' }),
    runHealthcheck: async (_ctx, project) => ({
      ...op(`healthcheck:${project}`),
      running: !fail.has(`healthcheck:${project}`),
      health: fail.has(`healthcheck:${project}`) ? ('unhealthy' as const) : ('healthy' as const),
    }),
    runBackup: async () => ({ ...ok, archivePath: '/b/x.tar.gz', sizeBytes: 1, checksum: 'x' }),
    restoreBackup: async (_ctx, project) => op(`restore:${project}`),
    provisionHosting: async () => op('provisionHosting'),
    suspendHosting: async () => op('suspendHosting'),
    terminateHosting: async () => op('terminateHosting'),
  };
}

describe('Phase 9 — cross-module lifecycle & failure paths [integration]', () => {
  let db: PGlite;
  let client: PgliteClient;
  const options = (adapter: DeploymentAdapter) => ({ simulationMode: true, kubernetesEnabled: false, adapterOverride: adapter });

  beforeEach(async () => {
    process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/cloudhost247';
    process.env.JWT_SECRET ??= 'g'.repeat(32);
    process.env.CREDENTIAL_ENCRYPTION_KEY ??= 'a'.repeat(64);
    db = new PGlite();
    client = new PgliteClient(db);
    await migrateUp(client, { isProduction: false });
  });

  afterEach(async () => {
    await db.close();
  });

  async function seedCustomer() {
    const userId = randomUUID();
    await db.query(`INSERT INTO users (id, email, password_hash, full_name, role) VALUES ($1,$2,$3,$4,'customer')`, [
      userId,
      `p9-${randomUUID().slice(0, 8)}@example.com`,
      await hashPassword('correct-horse-battery'),
      'Phase Nine',
    ]);
    return userId;
  }

  async function seedPublishedApp(slug: string) {
    const manifest = validatedManifests(loadManifestCatalog('manifests')).find((m) => m.id === slug);
    if (!manifest) throw new Error(`manifest ${slug} missing`);
    await importManifests(db, [manifest]);
    const app = (await db.query<{ id: string }>(`SELECT id FROM applications WHERE slug = $1`, [slug])).rows[0];
    const version = (await db.query<{ id: string }>(`SELECT id FROM application_versions WHERE application_id = $1`, [app.id])).rows[0];
    await db.query(`UPDATE application_versions SET status = 'published' WHERE id = $1`, [version.id]);
    await db.query(`UPDATE applications SET status = 'published' WHERE id = $1`, [app.id]);
    return { app, version, manifest };
  }

  async function seedServer() {
    return createServer(db, {
      name: `p9-server-${randomUUID().slice(0, 6)}`,
      hostname: 'p9.example.com',
      serverType: 'VPS',
      cpuCores: 16,
      memoryMb: 32_768,
      storageMb: 409_600,
      dockerEnabled: true,
      kubernetesEnabled: false,
      cpanelEnabled: false,
    });
  }

  /** Seed an order row in the given payment state and link it to the installation (the linkage the engine re-verifies). */
  async function linkOrder(userId: string, installationId: string, paymentStatus: 'paid' | 'unpaid') {
    const orderId = randomUUID();
    await db.query(
      `INSERT INTO orders (id, user_id, currency, subtotal_amount, total_amount, status, payment_status)
       VALUES ($1,$2,'USD',10,10,'pending',$3)`,
      [orderId, userId, paymentStatus]
    );
    await db.query(`UPDATE application_installations SET order_id = $2, updated_at = now() WHERE id = $1`, [installationId, orderId]);
    return orderId;
  }

  it('[integrity: deploy×billing] a failed deploy rolls back, fails the installation, and never settles or refunds billing on its own', async () => {
    const userId = await seedCustomer();
    const { app } = await seedPublishedApp('uptime-kuma');
    const server = await seedServer();
    const request = await createInstallationRequest(db, userId, { applicationIdOrSlug: app.id, serverId: server.id });
    const orderId = await linkOrder(userId, request.installationId, 'paid');

    const adapter = stubAdapter(new Set(['deploy:'.concat('')].map((p) => p.slice(0, -1)))); // fail any deploy:* call
    adapter.calls.length = 0;
    // fail-set keyed by call-name prefix — implement by failing any deploy call:
    const failing = stubAdapter(new Set(['deploy:x']));
    failing.deployApplication = async (_ctx: never, input: { project: string }) => {
      failing.calls.push(`deploy:${input.project}`);
      return { ok: false, code: 'PROVIDER_DOWN', message: 'provider unreachable' };
    };

    await enqueueDeployment(db, {
      installationId: request.installationId,
      serverId: server.id,
      action: 'install',
      idempotencyKey: `p9-fail:${request.installationId}`,
      requestedBy: userId,
    });
    const claimed = await processNextJob({ db, options: options(failing), workerId: 'p9-w1' });
    expect(claimed).not.toBeNull();
    const finished = await findDeploymentById(db, claimed!.id);
    // The queue retries with backoff, so the row may legitimately be 'queued' again — but the
    // failure must already be recorded verbatim and must never be smoothed into a success.
    expect(['queued', 'failed', 'rolled_back']).toContain(finished?.status);
    expect(finished?.error_code).toBe('PROVIDER_DOWN');
    expect(finished?.error_message).toContain('provider unreachable');

    const inst = (
      await db.query<{ status: string; health_status: string | null }>(
        `SELECT status, health_status FROM application_installations WHERE id = $1`,
        [request.installationId]
      )
    ).rows[0];
    expect(inst.status).toBe('failed');
    expect(inst.health_status).not.toBe('healthy');

    const order = (await db.query<{ payment_status: string; status: string }>(`SELECT payment_status, status FROM orders WHERE id = $1`, [orderId]))
      .rows[0];
    expect(order.payment_status).toBe('paid'); // truth: they paid; no fabricated refund/cancel
    expect(order.status).toBe('pending');

    const failedSteps = (
      await db.query<{ error: string | null }>(
        `SELECT error FROM deployment_steps WHERE deployment_id = $1 AND status = 'failed'`,
        [claimed!.id]
      )
    ).rows;
    expect(failedSteps.length).toBeGreaterThanOrEqual(1);

    // The provider failure was recorded verbatim, not smoothed into a success narrative.
    const events = (await db.query<{ message: string }>(`SELECT message FROM deployment_events WHERE deployment_id = $1`, [claimed!.id])).rows;
    expect(events.some((e) => /provider unreachable|PROVIDER_DOWN|STEP_FAILED/.test(e.message))).toBe(true);
  });

  it('[integrity: deploy×billing] an unpaid order is refused at validation — no adapter call is ever attempted', async () => {
    const userId = await seedCustomer();
    const { app } = await seedPublishedApp('uptime-kuma');
    const server = await seedServer();
    const request = await createInstallationRequest(db, userId, { applicationIdOrSlug: app.id, serverId: server.id });
    const orderId = await linkOrder(userId, request.installationId, 'unpaid');

    const adapter = stubAdapter();
    await enqueueDeployment(db, {
      installationId: request.installationId,
      serverId: server.id,
      action: 'install',
      idempotencyKey: `p9-unpaid:${request.installationId}`,
      requestedBy: userId,
    });
    const claimed = await processNextJob({ db, options: options(adapter), workerId: 'p9-w2' });
    const finished = await findDeploymentById(db, claimed!.id);
    expect(['queued', 'failed']).toContain(finished?.status);
    expect(finished?.error_code).toBe('ORDER_NOT_PAID');
    expect(adapter.calls).toHaveLength(0); // nothing remote was attempted
    const order = (await db.query<{ payment_status: string }>(`SELECT payment_status FROM orders WHERE id = $1`, [orderId])).rows[0];
    expect(order.payment_status).toBe('unpaid');
  });

  it('[integrity: deploy×ssl] a requested SSL certificate goes pending on deploy — never issued — until the solver confirms it', async () => {
    const userId = await seedCustomer();
    const { app } = await seedPublishedApp('uptime-kuma');
    const server = await seedServer();
    const request = await createInstallationRequest(db, userId, { applicationIdOrSlug: app.id, serverId: server.id, domain: 'p9-secure.example.com' });

    const domain = await createCustomerDomain(db, {
      id: randomUUID(),
      userId,
      domainName: 'p9-secure.example.com',
      createdBy: userId,
      createdByUser: true,
    });
    await db.query(
      `INSERT INTO application_domains (id, installation_id, domain_id, primary_domain) VALUES ($1,$2,$3,true)`,
      [randomUUID(), request.installationId, domain.id]
    );

    const adapter = stubAdapter();
    await enqueueDeployment(db, {
      installationId: request.installationId,
      serverId: server.id,
      action: 'install',
      idempotencyKey: `p9-ssl:${request.installationId}`,
      requestedBy: userId,
    });
    const claimed = await processNextJob({ db, options: options(adapter), workerId: 'p9-w3' });
    expect(claimed).not.toBeNull();
    const finished = await findDeploymentById(db, claimed!.id);
    expect(finished?.status).toBe('succeeded');

    const row = (await db.query<{ ssl_status: string }>(`SELECT ssl_status FROM customer_domains WHERE id = $1`, [domain.id])).rows[0];
    expect(row.ssl_status).toBe('pending'); // issued would be fabricated before the resolver ran
  });

  it('[integrity: inbox×email-relay] a channel whose relay dependency is absent reports not_configured — never connected', async () => {
    const channel = await createChannel(
      db,
      { kind: 'email', name: `p9-mailbox-${randomUUID().slice(0, 6)}`, config: { address: 'ops@example.com' } },
      { emailTransportConfigured: false }
    );
    expect(channel.status).toBe('not_configured');
    expect(channel.last_error_code).toBe('NOT_CONFIGURED');
    expect(channel.last_error_message).toBeTruthy();

    const connected = await refreshChannelHealth(db, channel.id, { emailTransportConfigured: true });
    expect(connected.status).toBe('connected');
  });

  it('[integrity: inbox×authz] internal notes never leak into the customer view; foreign conversations are invisible', async () => {
    const customerId = await seedCustomer();
    const inbound = await recordMessage(db, {
      channelKind: 'support',
      contactEmail: 'customer@example.com',
      contactName: 'Customer',
      userId: customerId,
      body: 'I need help with my server',
      direction: 'inbound',
    });
    await recordMessage(db, {
      channelKind: 'support',
      conversationId: inbound.conversationId,
      direction: 'outbound',
      visibility: 'internal',
      body: 'INTERNAL: fraud-risk discussion',
    });
    const staffView = await getConversation(db, inbound.conversationId, 'staff');
    expect(staffView.messages.some((m: { visibility: string }) => m.visibility === 'internal')).toBe(true);

    const customerView = await getCustomerConversation(db, customerId, inbound.conversationId);
    expect(customerView.messages.every((m: { visibility: string }) => m.visibility === 'public')).toBe(true);

    await expect(getCustomerConversation(db, randomUUID(), inbound.conversationId)).rejects.toThrow(/No conversation was found/);
  });

  describe('[integrity: ssl×ca lifecycle honesty]', () => {
    let app2: ReturnType<typeof buildApp>;
    let env: Env;
    let userToken: string;
    const sslUserId = randomUUID();

    function selfSignedPem(): { pem: string; validTo: string } {
      const dir = mkdtempSync(join(tmpdir(), 'p9-ssl-'));
      try {
        const keyPath = join(dir, 'key.pem');
        const certPath = join(dir, 'cert.pem');
        execFileSync(
          'openssl',
          ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', keyPath, '-out', certPath, '-days', '365', '-nodes', '-subj', '/CN=p9-ssl-fixture.example'],
          { stdio: 'pipe' }
        );
        const pem = readFileSync(certPath, 'utf8');
        const enddateOut = execFileSync('openssl', ['x509', '-in', certPath, '-noout', '-enddate'], { encoding: 'utf8' });
        const validTo = new Date(enddateOut.trim().replace('notAfter=', '')).toISOString();
        return { pem, validTo };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }

    beforeEach(async () => {
      env = loadEnv({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
        JWT_SECRET: 'f'.repeat(32),
        SERVER_AGENT_SHARED_SECRET: 's'.repeat(32),
      } as NodeJS.ProcessEnv);
      await client.exec(
        `INSERT INTO users (id, email, password_hash, full_name, role, status) VALUES ('${sslUserId}', 'p9ssl-${randomUUID().slice(0, 6)}@example.com', 'hash', 'P9 SSL', 'customer', 'active') ON CONFLICT (id) DO NOTHING`
      );
      app2 = buildApp(env, { serveFrontend: false, pool: client as never });
      userToken = signAuthToken(env, { sub: sslUserId, email: 'p9ssl@example.com', role: 'customer' });
    });

    afterEach(async () => {
      await app2.close();
    });

    it('renewal of a PENDING certificate is refused (409) — issuance cannot be fabricated', async () => {
      const create = await app2.inject({
        method: 'POST',
        url: '/api/v1/ssl/certificates',
        headers: { authorization: `Bearer ${userToken}` },
        payload: { domainName: 'p9-pending.example.com', challengeType: 'HTTP_01' },
      });
      expect(create.statusCode).toBe(201);
      const cert = JSON.parse(create.payload).certificate;
      expect(cert.status).toBe('PENDING');

      const renew = await app2.inject({
        method: 'POST',
        url: `/api/v1/ssl/certificates/${cert.id}/renew`,
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(renew.statusCode).toBe(409);
    });

    it('a pasted certificate is parsed: expiry from the cert itself, CUSTOM provenance, renewal marks VALIDATING without moving expiry', async () => {
      const { pem, validTo } = selfSignedPem();
      const create = await app2.inject({
        method: 'POST',
        url: '/api/v1/ssl/certificates',
        headers: { authorization: `Bearer ${userToken}` },
        payload: { domainName: 'p9-pasted.example.com', certificatePem: pem },
      });
      expect(create.statusCode).toBe(201);
      const cert = JSON.parse(create.payload).certificate;
      expect(cert.status).toBe('ISSUED');
      expect(cert.issuer).toBe('CUSTOM');
      expect(new Date(cert.expires_at).toISOString()).toBe(validTo);

      const renew = await app2.inject({
        method: 'POST',
        url: `/api/v1/ssl/certificates/${cert.id}/renew`,
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(renew.statusCode).toBe(200);
      const renewed = JSON.parse(renew.payload).certificate;
      expect(renewed.status).toBe('VALIDATING');
      expect(new Date(renewed.expires_at).toISOString()).toBe(validTo); // issuance has not happened; expiry may not move

      const revoke = await app2.inject({
        method: 'POST',
        url: `/api/v1/ssl/certificates/${cert.id}/revoke`,
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(revoke.statusCode).toBe(200);
      expect(JSON.parse(revoke.payload).certificate.status).toBe('REVOKED');

      const renewRevoked = await app2.inject({
        method: 'POST',
        url: `/api/v1/ssl/certificates/${cert.id}/renew`,
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(renewRevoked.statusCode).toBe(409);
    });

    it('a malformed certificate blob is rejected and never stored as issued', async () => {
      const create = await app2.inject({
        method: 'POST',
        url: '/api/v1/ssl/certificates',
        headers: { authorization: `Bearer ${userToken}` },
        payload: { domainName: 'p9-bad.example.com', certificatePem: '-----BEGIN CERTIFICATE-----\nbm90IGEgY2VydA==\n-----END CERTIFICATE-----\n' },
      });
      expect(create.statusCode).toBe(400);
      const { rows } = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ssl_certificates WHERE domain_name = 'p9-bad.example.com'`);
      expect(rows[0].n).toBe(0);
    });
  });
});
