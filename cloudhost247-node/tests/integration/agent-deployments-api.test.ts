import { createHash, createHmac, randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { signAuthToken } from '../../src/lib/jwt';
import { hashPassword } from '../../src/lib/password';
import { createServer, storeCredential } from '../../src/db/servers';
import { getKeyRing } from '../../src/lib/keyring';
import { enqueueDeployment } from '../../src/db/deployments';

/**
 * Phase 6 wire protocol tests: the deployment API's customer surface (list/detail/cancel/SSE
 * auth) and the inbound agent API's HMAC authentication (bad signature, replayed nonce,
 * timestamp skew, valid report) — the exact contract src/deployments/agent-protocol.ts and
 * server-agent/src/auth.js implement together.
 */
describe('deployment API + agent inbound API', () => {
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

  const AGENT_SECRET = 's'.repeat(48);

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
    await db.query(
      `INSERT INTO users (id, email, password_hash, full_name, role) VALUES ($1,$2,$3,$4,$5)`,
      [userId, email, await hashPassword('correct-horse-battery'), 'Test User', role]
    );
    return { userId, token: signAuthToken(env, { sub: userId, role, email }) };
  }

  async function makeAgentServer() {
    const server = await createServer(db, {
      name: 'agent-server',
      hostname: 'agent.example.com',
      serverType: 'VPS',
      cpuCores: 4,
      memoryMb: 8192,
      storageMb: 102_400,
      dockerEnabled: true,
      kubernetesEnabled: false,
      cpanelEnabled: false,
    });
    await storeCredential(db, getKeyRing(), server.id, 'agent_secret', AGENT_SECRET);
    await db.query(
      `UPDATE servers SET agent_id = $2, metadata = jsonb_set(coalesce(metadata,'{}'::jsonb),'{agent_url}','"http://10.0.0.5:8787"'), status = 'active' WHERE id = $1`,
      [server.id, 'agent-test-1']
    );
    return server;
  }

  function signedAgentHeaders(agentId: string, method: string, path: string, body: string, overrides: Record<string, string> = {}) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = createHash('sha256').update(randomUUID()).digest('hex').slice(0, 32);
    const bodySha = createHash('sha256').update(body).digest('hex');
    const canonical = [agentId, timestamp, nonce, method, path, bodySha].join('\n');
    const signature = createHmac('sha256', AGENT_SECRET).update(canonical).digest('hex');
    return {
      'x-ch247-agent-id': agentId,
      'x-ch247-timestamp': timestamp,
      'x-ch247-nonce': nonce,
      'x-ch247-signature': signature,
      ...overrides,
    };
  }

  async function seedInstallation(serverId: string, customerId: string, project: string) {
    const appId = randomUUID();
    await db.query(
      `INSERT INTO applications (id, slug, name, description, status) VALUES ($1,$2,$3,$4,'published')`,
      [appId, `app-${project}`, `App ${project}`, 'A test application']
    );
    const versionId = randomUUID();
    // A minimal valid manifest — the engine re-validates stored manifests before running.
    const manifest = {
      id: `app-${project}`,
      name: `App ${project}`,
      category: 'productivity',
      description: 'A test application',
      deployment: { engine: 'docker-compose' },
      supportedHostingTypes: ['docker', 'vps'],
      requirements: { cpu: 1, memory: 512, storage: 5120 },
      services: { app: { image: 'nginx:alpine', port: 80 } },
      environment: { required: [], optional: [] },
      versions: [{ version: '1.0.0', image: 'nginx:alpine' }],
    };
    await db.query(
      `INSERT INTO application_versions (id, application_id, version, status, manifest) VALUES ($1,$2,'1.0.0','published',$3)`,
      [versionId, appId, JSON.stringify(manifest)]
    );
    const installationId = randomUUID();
    await db.query(
      `INSERT INTO application_installations (id, customer_id, application_id, application_version_id, server_id, name, status, container_project)
       VALUES ($1,$2,$3,$4,$5,$6,'healthy',$7)`,
      [installationId, customerId, appId, versionId, serverId, `App ${project}`, project]
    );
    return installationId;
  }

  // --- Agent inbound API --------------------------------------------------------------------------

  it('pings with a valid signature and reports metrics + health', async () => {
    const server = await makeAgentServer();
    const pingBody = '';
    const ping = await app().inject({
      method: 'GET',
      url: '/api/v1/agent/ping',
      headers: signedAgentHeaders('agent-test-1', 'GET', '/api/v1/agent/ping', pingBody),
    });
    expect(ping.statusCode).toBe(200);
    expect((ping.json() as { ok: boolean }).ok).toBe(true);

    const reportBody = JSON.stringify({
      cpuPercent: 12.5,
      memoryUsedMb: 2048,
      memoryTotalMb: 8192,
      diskUsedMb: 10_240,
      diskTotalMb: 102_400,
      agentVersion: '1.0.0',
    });
    const report = await app().inject({
      method: 'POST',
      url: '/api/v1/agent/report',
      headers: { 'content-type': 'application/json', ...signedAgentHeaders('agent-test-1', 'POST', '/api/v1/agent/report', reportBody) },
      payload: reportBody,
    });
    expect(report.statusCode).toBe(200);
    const stored = await db.query(`SELECT cpu_percent, memory_used_mb FROM server_metrics ORDER BY captured_at DESC LIMIT 1`);
    expect(Number(stored.rows[0].cpu_percent)).toBeCloseTo(12.5, 1);
    expect(stored.rows[0].memory_used_mb).toBe(2048);

    // Health report flips an installation's health status (flat project+healthy body).
    const installationId = await seedInstallation(server.id, (await createUser('health-owner@example.com')).userId, 'cxxxxxxx-instyyyy');
    const healthBody = JSON.stringify({ project: 'cxxxxxxx-instyyyy', healthy: false, detail: 'probe failed' });
    const health = await app().inject({
      method: 'POST',
      url: '/api/v1/agent/health',
      headers: { 'content-type': 'application/json', ...signedAgentHeaders('agent-test-1', 'POST', '/api/v1/agent/health', healthBody) },
      payload: healthBody,
    });
    expect(health.statusCode).toBe(200);
    const installationRow = (
      await db.query<{ health_status: string }>(`SELECT health_status FROM application_installations WHERE id = $1`, [installationId])
    ).rows[0];
    expect(installationRow.health_status).toBe('unhealthy');
  });

  it('rejects a bad signature, a replayed nonce, and a stale timestamp — all 401', async () => {
    await makeAgentServer();
    const body = JSON.stringify({ cpuPercent: 1, agentVersion: '1.0.0' });

    const badSignature = await app().inject({
      method: 'POST',
      url: '/api/v1/agent/report',
      headers: {
        'content-type': 'application/json',
        ...signedAgentHeaders('agent-test-1', 'POST', '/api/v1/agent/report', body, { 'x-ch247-signature': 'f'.repeat(64) }),
      },
      payload: body,
    });
    expect(badSignature.statusCode).toBe(401);

    // Valid once…
    const headers = signedAgentHeaders('agent-test-1', 'POST', '/api/v1/agent/report', body);
    const first = await app().inject({
      method: 'POST',
      url: '/api/v1/agent/report',
      headers: { 'content-type': 'application/json', ...headers },
      payload: body,
    });
    expect(first.statusCode).toBe(200);
    // …then replaying the same nonce+signature is rejected.
    const replay = await app().inject({
      method: 'POST',
      url: '/api/v1/agent/report',
      headers: { 'content-type': 'application/json', ...headers },
      payload: body,
    });
    expect(replay.statusCode).toBe(401);

    const stale = await app().inject({
      method: 'POST',
      url: '/api/v1/agent/report',
      headers: {
        'content-type': 'application/json',
        ...signedAgentHeaders('agent-test-1', 'POST', '/api/v1/agent/report', body, {
          'x-ch247-timestamp': String(Math.floor(Date.now() / 1000) - 3600),
        }),
      },
      payload: body,
    });
    expect(stale.statusCode).toBe(401);

    // Unknown agent id — generic 401 (no oracle about which agents exist).
    const unknown = await app().inject({
      method: 'GET',
      url: '/api/v1/agent/ping',
      headers: signedAgentHeaders('agent-does-not-exist', 'GET', '/api/v1/agent/ping', ''),
    });
    expect(unknown.statusCode).toBe(401);

    // Unsigned requests never even parse.
    const unsigned = await app().inject({ method: 'GET', url: '/api/v1/agent/ping' });
    expect(unsigned.statusCode).toBe(401);
  });

  // --- Deployment API ------------------------------------------------------------------------------

  it('lists, details, and cancels deployments with ownership checks', async () => {
    const server = await makeAgentServer();
    const owner = await createUser('owner@example.com');
    const stranger = await createUser('stranger@example.com');

    const installationId = await seedInstallation(server.id, owner.userId, 'cxxxxxxx-instyyyy');

    const { deployment } = await enqueueDeployment(db, {
      installationId,
      serverId: server.id,
      action: 'restart',
      idempotencyKey: `restart:${installationId}:1`,
      requestedBy: owner.userId,
    });

    // Owner sees it; a stranger gets an indistinguishable 404.
    const mine = await app().inject({
      method: 'GET',
      url: `/api/v1/deployments/${deployment.id}`,
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(mine.statusCode).toBe(200);
    const detail = mine.json() as { deployment: { action: string }; steps: unknown[]; events: unknown[] };
    expect(detail.deployment.action).toBe('restart');

    const foreign = await app().inject({
      method: 'GET',
      url: `/api/v1/deployments/${deployment.id}`,
      headers: { authorization: `Bearer ${stranger.token}` },
    });
    expect(foreign.statusCode).toBe(404);

    // Queued deployments can be cancelled by their requester.
    const cancel = await app().inject({
      method: 'POST',
      url: `/api/v1/deployments/${deployment.id}/cancel`,
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(cancel.statusCode).toBe(200);
    const cancelled = (await db.query(`SELECT status FROM deployments WHERE id = $1`, [deployment.id])).rows[0];
    expect(cancelled.status).toBe('cancelled');

    // Cancelling again → 409 (no longer queued).
    const reCancel = await app().inject({
      method: 'POST',
      url: `/api/v1/deployments/${deployment.id}/cancel`,
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(reCancel.statusCode).toBe(409);

    // A running deployment cannot be cancelled.
    const { deployment: running } = await enqueueDeployment(db, {
      installationId,
      serverId: server.id,
      action: 'restart',
      idempotencyKey: `restart:${installationId}:2`,
      requestedBy: owner.userId,
    });
    await db.query(`UPDATE deployments SET status = 'running' WHERE id = $1`, [running.id]);
    const runningCancel = await app().inject({
      method: 'POST',
      url: `/api/v1/deployments/${running.id}/cancel`,
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(runningCancel.statusCode).toBe(409);
  });

  it('SSE stream: 401 without a token, 200 with a valid query token', async () => {
    const server = await makeAgentServer();
    const owner = await createUser('sse@example.com');
    const installationId = await seedInstallation(server.id, owner.userId, 'cxxxxxxx-instzzzz');
    const { deployment } = await enqueueDeployment(db, {
      installationId,
      serverId: server.id,
      action: 'restart',
      idempotencyKey: `restart:${installationId}:sse`,
      requestedBy: owner.userId,
    });

    const unauthenticated = await app().inject({ method: 'GET', url: `/api/v1/deployments/${deployment.id}/events` });
    expect(unauthenticated.statusCode).toBe(401);

    const badToken = await app().inject({
      method: 'GET',
      url: `/api/v1/deployments/${deployment.id}/events?token=not-a-jwt`,
    });
    expect(badToken.statusCode).toBe(401);

    // Terminal deployment: the stream opens, emits state + done, and closes.
    await db.query(`UPDATE deployments SET status = 'succeeded', completed_at = now() WHERE id = $1`, [deployment.id]);
    const stream = await app().inject({
      method: 'GET',
      url: `/api/v1/deployments/${deployment.id}/events?token=${encodeURIComponent(owner.token)}`,
    });
    expect(stream.statusCode).toBe(200);
    expect(stream.headers['content-type']).toContain('text/event-stream');
    expect(stream.body).toContain('event: done');
    expect(stream.body).toContain('event: state');
  });
});
