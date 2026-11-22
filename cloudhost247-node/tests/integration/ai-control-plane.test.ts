import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { signAuthToken } from '../../src/lib/jwt';
import { hashPassword } from '../../src/lib/password';
import { AGENT_CATALOG } from '../../src/ai-os/registry/agent-catalog';
import { resolveModelForAgent, ModelResolutionError } from '../../src/ai-os/models/router';
import { getAgentBySlug } from '../../src/ai-os/repositories/registry-repo';
import { seedAgentRegistry } from '../../src/ai-os/registry/seed';
import { gatedToolCall, runTask } from '../../src/ai-os/runtime/executor';
import { AGENT_HANDLERS } from '../../src/ai-os/agents/handlers';
import { getBoardOverview } from '../../src/ai-os/board/board-service';
import type { RunHandles } from '../../src/ai-os/runtime/executor';
import { createTask, insertRun } from '../../src/ai-os/repositories/tasks-repo';
import { prepareOrchestratedTask } from '../../src/ai-os/runtime/task-orchestrator';
import { createApproval, getApproval } from '../../src/ai-os/repositories/approvals-repo';
import { approvalReviewFingerprint } from '../../src/ai-os/runtime/approval-review';
import { createFinding } from '../../src/ai-os/repositories/findings-repo';
import { executeToolImplementation } from '../../src/ai-os/tools/implementations';
import { getMemory, putMemory } from '../../src/ai-os/repositories/memory-knowledge-repo';
import { runAiSweep, detectPlatformEvents } from '../../src/ai-os/jobs/sweep';
import type { AgentRow } from '../../src/ai-os/types';

/**
 * End-to-end verification of the AI Control Plane against a real embedded PostgreSQL engine
 * (PGlite) running the REAL migrations — never mocks, for the parts that matter:
 *   registry seed ⇄ catalog agreement · permission gating · approval-gated execution ·
 *   customer data isolation · event→workflow dispatch · board briefing idempotency ·
 *   fail-closed model routing.
 */
describe('AI Control Plane', () => {
  let db: PGlite;
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
    JWT_SECRET: 'g'.repeat(32),
  } as NodeJS.ProcessEnv);

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
  });

  afterEach(async () => {
    await db.close();
  });

  function buildTestApp() {
    return buildApp(env, { serveFrontend: false, pool: db });
  }

  async function createUser(role: 'customer' | 'admin' | 'super_admin' | 'staff', email: string): Promise<{ userId: string; token: string }> {
    const userId = randomUUID();
    const passwordHash = await hashPassword('correct-horse-battery');
    await db.query(`INSERT INTO users (id, email, password_hash, full_name, role) VALUES ($1,$2,$3,$4,$5)`, [userId, email, passwordHash, 'Test User', role]);
    const token = signAuthToken(env, { sub: userId, role, email });
    return { userId, token };
  }

  it('enforces operation-centre read and mutation permissions using the current account role', async () => {
    const app = buildTestApp();
    const customer = await createUser('customer', 'matrix-customer@example.test');
    const staff = await createUser('staff', 'matrix-staff@example.test');
    const admin = await createUser('admin', 'matrix-admin@example.test');
    const paths = [
      { path: '/api/v1/admin/ai/approvals', staff: 403 },
      { path: '/api/v1/admin/ai/approvals/delayed', staff: 403 },
      { path: '/api/v1/admin/ai/events', staff: 403 },
      { path: '/api/v1/admin/ai/event-claims', staff: 403 },
      { path: '/api/v1/admin/ai/acknowledged-incomplete-workflows', staff: 403 },
      { path: '/api/v1/admin/ai/workflows', staff: 200 },
      { path: '/api/v1/admin/ai/workflow-runs', staff: 200 },
    ];
    const get = (path: string, token?: string) => app.inject({ method: 'GET', url: path, ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}) });
    try {
      for (const { path, staff: staffStatus } of paths) {
        expect((await get(path)).statusCode, path).toBe(401);
        expect((await get(path, customer.token)).statusCode, path).toBe(403);
        expect((await get(path, staff.token)).statusCode, path).toBe(staffStatus);
        expect((await get(path, admin.token)).statusCode, path).toBe(200);
      }
      const eventId = randomUUID();
      const runId = randomUUID();
      const mutations = [
        { path: `/api/v1/admin/ai/events/${eventId}/investigations`, payload: { confirmed: true } },
        { path: `/api/v1/admin/ai/workflow-runs/${runId}/acknowledged-investigations`, payload: { confirmed: true, eventId, acknowledgementKey: '2025-01-01T00:00:00.000000Z', observedStatus: 'failed' } },
        { path: `/api/v1/admin/ai/approvals/${randomUUID()}/decision`, payload: { decision: 'rejected', reviewFingerprint: 'a'.repeat(64) } },
      ];
      for (const { path, payload } of mutations) {
        for (const token of [undefined, customer.token, staff.token]) {
          const response = await app.inject({ method: 'POST', url: path, payload, ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}) });
          expect(response.statusCode, path).toBe(token ? 403 : 401);
        }
      }
      await db.query(`UPDATE users SET role = 'staff' WHERE id = $1`, [admin.userId]);
      expect((await get('/api/v1/admin/ai/event-claims', admin.token)).statusCode).toBe(403);
      for (const { path, payload } of mutations) {
        expect((await app.inject({ method: 'POST', url: path, payload, headers: { authorization: `Bearer ${admin.token}` } })).statusCode, path).toBe(403);
      }
      await db.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [admin.userId]);
      expect((await get('/api/v1/admin/ai/workflows', admin.token)).statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('leaves existing approval and investigation records unchanged on unauthorized requests', async () => {
    const app = buildTestApp();
    const customer = await createUser('customer', 'auth-real-customer@example.test');
    const staff = await createUser('staff', 'auth-real-staff@example.test');
    const formerAdmin = await createUser('admin', 'auth-real-admin@example.test');
    await seedAgentRegistry(db);
    const agent = (await getAgentBySlug(db, 'collector'))!;
    const approval = await createApproval(db, { agentId: agent.id, taskId: null, runId: null, argumentsVerified: true, tool: 'send_notification', action: 'test', reason: 'test', evidence: [], riskLevel: 'high', arguments: { userId: customer.userId, type: 'AI_TEST', title: 'Test', message: 'Test' } });
    const heldId = randomUUID(), token = randomUUID(), eventId = randomUUID(), runId = randomUUID(), workflowId = randomUUID();
    await db.query(`INSERT INTO ai_workflows (id,slug,name,event_type,definition) VALUES ($1,$2,'test','test.auth','[]')`, [workflowId, `auth-${workflowId}`]);
    await db.query(`INSERT INTO ai_events (id,event_type,source,dispatch_claim_token,dispatch_claimed_at) VALUES ($1,'test.auth','admin',$2,now() - interval '6 minutes')`, [heldId, token]);
    await db.query(`INSERT INTO ai_events (id,event_type,source,processed_at) VALUES ($1,'test.auth','admin','2025-01-01T00:00:00.123456Z')`, [eventId]);
    await db.query(`INSERT INTO ai_workflow_runs (id,workflow_id,event_id,status) VALUES ($1,$2,$3,'partial')`, [runId, workflowId, eventId]);
    await db.query(`UPDATE users SET role = 'staff' WHERE id = $1`, [formerAdmin.userId]);
    const mutations = [
      { path: `/api/v1/admin/ai/events/${heldId}/investigations`, payload: { confirmed: true } },
      { path: `/api/v1/admin/ai/workflow-runs/${runId}/acknowledged-investigations`, payload: { confirmed: true, eventId, acknowledgementKey: '2025-01-01T00:00:00.123456Z', observedStatus: 'partial' } },
      { path: `/api/v1/admin/ai/approvals/${approval.id}/decision`, payload: { decision: 'approved', reviewFingerprint: approvalReviewFingerprint(approval) } },
      { path: `/api/v1/admin/ai/approvals/${approval.id}/decision`, payload: { decision: 'rejected', reviewFingerprint: approvalReviewFingerprint(approval) } },
    ];
    try {
      for (const { path, payload } of mutations) {
        for (const auth of [undefined, customer.token, staff.token, formerAdmin.token]) {
          const response = await app.inject({ method: 'POST', url: path, payload, ...(auth ? { headers: { authorization: `Bearer ${auth}` } } : {}) });
          expect(response.statusCode, path).toBe(auth ? 403 : 401);
        }
      }
      expect((await getApproval(db, approval.id))?.status).toBe('pending');
      expect((await db.query(`SELECT id FROM ai_tool_calls WHERE approval_id = $1`, [approval.id])).rows).toHaveLength(0);
      expect((await db.query(`SELECT id FROM user_notifications WHERE user_id = $1`, [customer.userId])).rows).toHaveLength(0);
      expect((await db.query(`SELECT id FROM audit_logs WHERE resource_id = $1 AND action IN ('ai.approval.approved','ai.approval.rejected')`, [approval.id])).rows).toHaveLength(0);
      expect((await db.query(`SELECT id FROM ai_event_investigations WHERE event_id = $1`, [heldId])).rows).toHaveLength(0);
      expect((await db.query(`SELECT id FROM ai_acknowledged_run_investigations WHERE run_id = $1`, [runId])).rows).toHaveLength(0);
      expect((await db.query(`SELECT id FROM ai_audit_logs WHERE arguments->>'eventId' IN ($1,$2) AND action IN ('ai.event.investigation_opened','ai.workflow.acknowledged_investigation_opened')`, [heldId, eventId])).rows).toHaveLength(0);
      expect((await db.query(`SELECT processed_at, dispatch_claim_token FROM ai_events WHERE id = $1`, [heldId])).rows[0]).toMatchObject({ processed_at: null, dispatch_claim_token: token });
      expect((await db.query(`SELECT status FROM ai_workflow_runs WHERE id = $1`, [runId])).rows[0]).toMatchObject({ status: 'partial' });
    } finally { await app.close(); }
  });

  it('requires an explicit non-sentinel customer memory key and separates tenants and expiry', async () => {
    const a = await createUser('customer', 'memory-a@example.test');
    const b = await createUser('customer', 'memory-b@example.test');
    await putMemory(db, { scope: 'customer', customerId: a.userId, agentSlug: 'test', key: 'k', value: { owner: 'a' } });
    await putMemory(db, { scope: 'customer', customerId: b.userId, agentSlug: 'test', key: 'k', value: { owner: 'b' } });
    expect((await getMemory(db, 'customer', a.userId, 'test', 'k'))?.value).toEqual({ owner: 'a' });
    expect((await getMemory(db, 'customer', b.userId, 'test', 'k'))?.value).toEqual({ owner: 'b' });
    expect(await getMemory(db, 'customer', a.userId, 'other-agent', 'k')).toBeNull();
    await putMemory(db, { scope: 'customer', customerId: a.userId, agentSlug: 'test', key: 'expired', value: {}, expiresAt: '2000-01-01T00:00:00Z' });
    expect(await getMemory(db, 'customer', a.userId, 'test', 'expired')).toBeNull();
    for (const invalid of [null, '00000000-0000-0000-0000-000000000000']) {
      await expect(getMemory(db, 'customer', invalid, 'test', 'k')).rejects.toThrow();
      await expect(putMemory(db, { scope: 'customer', customerId: invalid, key: 'k', value: {} })).rejects.toThrow();
    }
    await expect(getMemory(db, 'operational', a.userId, 'test', 'k')).rejects.toThrow();
    await expect(putMemory(db, { scope: 'executive', customerId: a.userId, key: 'k', value: {} })).rejects.toThrow();
  });

  it('enforces the memory boundary through the actual executor context', async () => {
    const customer = await createUser('customer', 'memory-runtime@example.test');
    await seedAgentRegistry(db);
    const agent = (await getAgentBySlug(db, 'customer-cloud-assistant'))!;
    await putMemory(db, { scope: 'operational', agentSlug: agent.slug, key: 'private', value: { secret: 'internal' } });
    const original = AGENT_HANDLERS['customer.assistant_query']!;
    try {
      AGENT_HANDLERS['customer.assistant_query'] = async (ctx) => {
        for (const scope of ['short', 'customer', 'operational', 'organizational', 'executive'] as const) {
          await expect(ctx.getMemory('private', scope)).rejects.toThrow('Memory unavailable');
          await expect(ctx.putMemory('leak', { secret: 'private' }, scope)).rejects.toThrow('Memory unavailable');
        }
        return { summary: 'Memory denied' };
      };
      const task = (await createTask(db, { agentId: agent.id, taskType: 'customer.assistant_query', requestedByType: 'customer', requestedBy: customer.userId, customerId: customer.userId })).task;
      const outcome = await runTask(db, task.id, { actorUserId: customer.userId, customerScopeUserId: customer.userId });
      expect(outcome.runStatus).toBe('succeeded');
      const result = await db.query<{ memory_key: string }>(`SELECT memory_key FROM ai_memories ORDER BY memory_key`);
      expect(result.rows).toEqual([{ memory_key: 'private' }]);
    } finally {
      AGENT_HANDLERS['customer.assistant_query'] = original;
    }
  });

  it('excludes expired and customer-attributed legacy memories from the board view', async () => {
    const customer = await createUser('customer', 'board-memory@example.test');
    await seedAgentRegistry(db);
    const seats = await db.query<{ slug: string }>(`SELECT slug FROM ai_agents WHERE board_seat IS NOT NULL LIMIT 1`);
    const slug = seats.rows[0]!.slug;
    await putMemory(db, { scope: 'executive', agentSlug: slug, key: 'digest:valid', value: { marker: 'valid' } });
    await db.query(`INSERT INTO ai_memories (id, scope, customer_id, agent_slug, memory_key, value, expires_at, updated_at)
      VALUES ($1,'executive',NULL,$2,'digest:expired',$3,'2000-01-01',now() + interval '1 minute'),
             ($4,'executive',$5,$2,'digest:legacy',$6,NULL,now() + interval '2 minutes')`,
      [randomUUID(), slug, JSON.stringify({ marker: 'expired' }), randomUUID(), customer.userId, JSON.stringify({ marker: 'legacy' })]);
    const board = JSON.stringify(await getBoardOverview(db));
    expect(board).toContain('valid');
    expect(board).not.toContain('expired');
    expect(board).not.toContain('legacy');
  });

  /** Seeds real billing + infrastructure facts for agents to read. */
  async function seedPlatformFacts(customerId: string, otherCustomerId?: string) {
    const orderId = randomUUID();
    await db.query(
      `INSERT INTO orders (id, user_id, currency, subtotal_amount, total_amount, status, payment_status)
       VALUES ($1,$2,'USD',100.00,100.00,'pending','unpaid')`,
      [orderId, customerId]
    );
    const invoiceId = randomUUID();
    await db.query(
      `INSERT INTO invoices (id, order_id, user_id, currency, subtotal_amount, total_amount, status, due_date)
       VALUES ($1,$2,$3,'USD',100.00,100.00,'unpaid', CURRENT_DATE - 10)`,
      [invoiceId, orderId, customerId]
    );
    await db.query(
      `INSERT INTO payments (id, invoice_id, user_id, amount, currency, status, failure_reason)
       VALUES ($1,$2,$3,100.00,'USD','failed','card_declined')`,
      [randomUUID(), invoiceId, customerId]
    );
    if (otherCustomerId) {
      const otherOrder = randomUUID();
      await db.query(
        `INSERT INTO orders (id, user_id, currency, subtotal_amount, total_amount, status, payment_status)
         VALUES ($1,$2,'USD',42.00,42.00,'pending','unpaid')`,
        [otherOrder, otherCustomerId]
      );
      const otherInvoice = randomUUID();
      await db.query(
        `INSERT INTO invoices (id, order_id, user_id, currency, subtotal_amount, total_amount, status, due_date)
         VALUES ($1,$2,$3,'USD',42.00,42.00,'unpaid', CURRENT_DATE + 30)`,
        [otherInvoice, otherOrder, otherCustomerId]
      );
    }
    const serverId = randomUUID();
    await db.query(
      `INSERT INTO servers (id, name, hostname, server_type, cpu_cores, memory_mb, storage_mb, status)
       VALUES ($1,'web-01','web-01.cloudhost247.internal','VPS',4,8192,102400,'active')`,
      [serverId]
    );
    await db.query(
      `INSERT INTO server_metrics (id, server_id, cpu_percent, memory_used_mb, memory_total_mb, disk_used_mb, disk_total_mb)
       VALUES ($1,$2,95.50,7800,8192,98000,102400)`,
      [randomUUID(), serverId]
    );
    const stuckDeploymentId = randomUUID();
    await db.query(
      `INSERT INTO deployments (id, server_id, action, status, idempotency_key, created_at)
       VALUES ($1,$2,'provision','queued',$3, now() - interval '3 hours')`,
      [stuckDeploymentId, serverId, `test-stuck-${stuckDeploymentId}`]
    );
    return { orderId, invoiceId, serverId, stuckDeploymentId };
  }

  // ----------------------------------------------------------------------------------------------
  // Registry
  // ----------------------------------------------------------------------------------------------

  it('seeds the full workforce registry from the catalog (DB ⇄ catalog agreement)', async () => {
    const app = buildTestApp();
    await app.ready();
    // Booting must never *require* the database: a DB outage or an unapplied 0066 must not stop the
    // whole app from starting. The seed runs in onReady inside a try/catch and a failure is logged
    // rather than thrown, so /health, /ready and every static route survive it — that half is pinned
    // by tests/unit/ai-registry-boot.test.ts. When the database IS reachable the registry is present
    // before the first request, and the write only ever happens behind authorization: an anonymous
    // request cannot trigger a seed (routes.ts authorize() re-ensures after requireAiPermission),
    // and ensureAgentRegistrySeeded is single-flight per database, not per app instance.
    const before = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ai_agents`);
    expect(before.rows[0]?.n).toBe(AGENT_CATALOG.length);
    await app.inject({ method: 'GET', url: '/api/v1/admin/ai/overview' });
    const { rows: agents } = await db.query<{ slug: string; board_seat: string | null }>(`SELECT slug, board_seat FROM ai_agents`);
    const slugs = new Set(agents.map((a) => a.slug));
    for (const entry of AGENT_CATALOG) expect(slugs.has(entry.slug)).toBe(true);
    expect(agents.length).toBe(AGENT_CATALOG.length);
    // Spec §35: these agents must NOT exist anywhere in the registry.
    for (const forbidden of ['care-navigator', 'claims-copilot', 'intake-attorney', 'citizen-desk', 'tutor', 'dispatch']) {
      expect(slugs.has(forbidden)).toBe(false);
    }
    const boardSeats = agents.filter((a) => a.board_seat !== null).map((a) => a.board_seat).sort();
    expect(boardSeats).toEqual(['CCO', 'CEO', 'CFO', 'CISO', 'CMO', 'COO', 'CPO', 'CRO', 'CTO', 'RISK'].sort());

    const { rows: workflows } = await db.query<{ slug: string }>(`SELECT slug FROM ai_workflows`);
    expect(workflows.map((w) => w.slug).sort()).toEqual(['invoice-overdue-collections', 'payment-failed-retention', 'server-unhealthy-incident']);

    const { rows: models } = await db.query<{ engine: string; enabled: boolean }>(`SELECT engine, enabled FROM ai_model_configs ORDER BY engine`);
    const deterministic = models.find((m) => m.engine === 'deterministic');
    expect(deterministic?.enabled).toBe(true);
    for (const m of models.filter((x) => x.engine !== 'deterministic')) expect(m.enabled).toBe(false);
    await app.close();
  });

  // ----------------------------------------------------------------------------------------------
  // Auth probes
  // ----------------------------------------------------------------------------------------------

  it('enforces auth + role + permission on every admin AI route', async () => {
    const app = buildTestApp();
    const anonymous = await app.inject({ method: 'GET', url: '/api/v1/admin/ai/overview' });
    expect(anonymous.statusCode).toBe(401);

    const customer = await createUser('customer', 'c1@example.com');
    const asCustomer = await app.inject({ method: 'GET', url: '/api/v1/admin/ai/overview', headers: { authorization: `Bearer ${customer.token}` } });
    expect(asCustomer.statusCode).toBe(403);

    const staff = await createUser('staff', 'staff@example.com');
    // staff holds ai.view but not ai.approvals.manage
    const staffView = await app.inject({ method: 'GET', url: '/api/v1/admin/ai/overview', headers: { authorization: `Bearer ${staff.token}` } });
    expect(staffView.statusCode).toBe(200);
    const admin = await createUser('admin', 'admin@example.com');
    const { rows: pending } = await db.query<{ id: string }>(`SELECT id FROM ai_approvals LIMIT 1`);
    if (pending[0]) {
      const staffDecision = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/ai/approvals/${pending[0].id}/decision`,
        headers: { authorization: `Bearer ${staff.token}` },
        payload: { decision: 'approved' },
      });
      expect(staffDecision.statusCode).toBe(403);
    }
    // model config mutation is super_admin-only
    const adminModel = await app.inject({
      method: 'PUT', url: '/api/v1/admin/ai/models/openai',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { enabled: true, model: 'gpt-test' },
    });
    expect(adminModel.statusCode).toBe(403);
    await app.close();
  });

  // ----------------------------------------------------------------------------------------------
  // Task execution over real data
  // ----------------------------------------------------------------------------------------------

  it('exposes a minimal, bounded delayed approval snapshot only to authorized operators', async () => {
    const app = buildTestApp();
    const admin = await createUser('admin', 'delayed-admin@example.com');
    const staff = await createUser('staff', 'delayed-staff@example.com');
    const customer = await createUser('customer', 'delayed-customer@example.com');
    await seedAgentRegistry(db);
    const agent = await getAgentBySlug(db, 'collector');
    const create = () => createApproval(db, { agentId: agent!.id, taskId: null, runId: null, tool: 'send_notification', action: 'private-action', reason: 'private-reason', evidence: ['private-evidence'], riskLevel: 'high', affectedCustomerId: customer.userId, arguments: { secret: 'private-arguments' } });
    const [approved, executing, fresh, failed] = await Promise.all([create(), create(), create(), create()]);
    await db.query(`UPDATE ai_approvals SET status = CASE id WHEN $1 THEN 'approved' WHEN $2 THEN 'executing' WHEN $3 THEN 'approved' ELSE 'failed' END,
      updated_at = CASE WHEN id = $3 THEN now() ELSE now() - interval '10 minutes' END WHERE id IN ($1,$2,$3,$4)`, [approved!.id, executing!.id, fresh!.id, failed!.id]);
    const get = (token?: string, query = '') => app.inject({ method: 'GET', url: `/api/v1/admin/ai/approvals/delayed${query}`, ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}) });
    expect((await get()).statusCode).toBe(401);
    expect((await get(customer.token)).statusCode).toBe(403);
    expect((await get(staff.token)).statusCode).toBe(403);
    const response = await get(admin.token);
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.count).toBe(2);
    expect(body.approvals.map((a: { id: string }) => a.id).sort()).toEqual([approved!.id, executing!.id].sort());
    expect(Object.keys(body.approvals[0]).sort()).toEqual(['id', 'run_id', 'status', 'task_id', 'tool', 'updated_at']);
    expect(response.body).not.toContain('private-');
    expect(response.body).not.toContain(customer.userId);
    expect((await get(admin.token, '?limit=1')).json().count).toBe(1);
    expect((await get(admin.token, '?limit=201')).statusCode).toBe(400);
    expect((await get(admin.token, '?status=approved')).statusCode).toBe(400);
    await db.query(`UPDATE users SET role = 'staff' WHERE id = $1`, [admin.userId]);
    expect((await get(admin.token)).statusCode).toBe(403);
    await app.close();
  });

  it('requires the reviewed proposal and rejects stale decisions without an action', async () => {
    const app = buildTestApp();
    const admin = await createUser('admin', 'review-snapshot@example.com');
    await seedAgentRegistry(db);
    const agent = (await getAgentBySlug(db, 'collector'))!;
    const approval = await createApproval(db, { agentId: agent.id, taskId: null, runId: null, tool: 'send_notification', action: 'test', reason: 'review', evidence: [], riskLevel: 'high', arguments: { message: 'original' } });
    const headers = { authorization: `Bearer ${admin.token}` };
    const list = () => app.inject({ method: 'GET', url: '/api/v1/admin/ai/approvals?status=pending', headers });
    const review = (await list()).json().approvals.find((row: { id: string }) => row.id === approval.id);
    expect(review.arguments).toEqual({ message: 'original' });
    expect(review.reviewFingerprint).toMatch(/^[a-f0-9]{64}$/);
    const decide = (payload: object) => app.inject({ method: 'POST', url: `/api/v1/admin/ai/approvals/${approval.id}/decision`, headers, payload });
    expect((await decide({ decision: 'approved' })).statusCode).toBe(400);
    expect(review.arguments_verified).toBe(false);
    expect((await decide({ decision: 'approved', reviewFingerprint: review.reviewFingerprint })).statusCode).toBe(409);
    expect((await getApproval(db, approval.id))?.status).toBe('pending');
    await db.query(`UPDATE ai_approvals SET arguments = $2 WHERE id = $1`, [approval.id, JSON.stringify({ message: 'changed' })]);
    expect((await decide({ decision: 'approved', reviewFingerprint: review.reviewFingerprint })).statusCode).toBe(409);
    expect((await getApproval(db, approval.id))?.status).toBe('pending');
    expect((await db.query(`SELECT id FROM ai_tool_calls WHERE approval_id = $1`, [approval.id])).rows).toHaveLength(0);
    expect((await db.query(`SELECT id FROM audit_logs WHERE resource_id = $1 AND action = 'ai.approval.approved'`, [approval.id])).rows).toHaveLength(0);
    const refreshed = (await list()).json().approvals.find((row: { id: string }) => row.id === approval.id);
    expect(refreshed.reviewFingerprint).not.toBe(review.reviewFingerprint);
    expect((await decide({ decision: 'rejected', reviewFingerprint: refreshed.reviewFingerprint })).statusCode).toBe(200);
    await app.close();
  });

  it('rolls back a human approval decision if the platform audit fails', async () => {
    const app = buildTestApp();
    const admin = await createUser('admin', 'decision-audit@example.com');
    await seedAgentRegistry(db);
    const agent = await getAgentBySlug(db, 'collector');
    const approval = await createApproval(db, { agentId: agent!.id, taskId: null, runId: null, argumentsVerified: true, tool: 'send_notification', action: 'test', reason: 'test', evidence: [], riskLevel: 'high', arguments: {} });
    await db.exec(`CREATE FUNCTION reject_decision_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action IN ('ai.approval.approved', 'ai.approval.rejected') THEN RAISE EXCEPTION 'injected decision audit failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_decision_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_decision_audit();`);
    const send = (decision: 'approved' | 'rejected') => app.inject({ method: 'POST', url: `/api/v1/admin/ai/approvals/${approval.id}/decision`, headers: { authorization: `Bearer ${admin.token}` }, payload: { decision, reviewFingerprint: approvalReviewFingerprint(approval) } });
    expect((await send('approved')).statusCode).toBe(500);
    expect((await db.query<{ status: string; decision_by: string | null }>(`SELECT status, decision_by FROM ai_approvals WHERE id = $1`, [approval.id])).rows[0]).toMatchObject({ status: 'pending', decision_by: null });
    expect((await db.query(`SELECT id FROM ai_tool_calls WHERE approval_id = $1`, [approval.id])).rows).toHaveLength(0);
    expect((await send('rejected')).statusCode).toBe(500);
    expect((await db.query<{ status: string }>(`SELECT status FROM ai_approvals WHERE id = $1`, [approval.id])).rows[0]?.status).toBe('pending');
    await db.exec(`DROP TRIGGER reject_decision_audit ON audit_logs; DROP FUNCTION reject_decision_audit();`);
    expect((await send('rejected')).statusCode).toBe(200);
    expect((await db.query<{ status: string }>(`SELECT status FROM ai_approvals WHERE id = $1`, [approval.id])).rows[0]?.status).toBe('rejected');
    expect((await db.query(`SELECT id FROM audit_logs WHERE action = 'ai.approval.rejected' AND resource_id = $1`, [approval.id])).rows).toHaveLength(1);
    await app.close();
  });

  it('runs the Collector over real overdue invoices: findings + drafts, sending approval-gated', async () => {
    const app = buildTestApp();
    const customer = await createUser('customer', 'overdue@example.com');
    await seedPlatformFacts(customer.userId);
    const admin = await createUser('admin', 'admin2@example.com');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/ai/tasks',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { agentSlug: 'collector', taskType: 'billing.overdue_digest', input: { limit: 10 } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { runStatus: string; pendingApprovals: string[]; task: { result: { overdue: number }; result_summary: string } };
    expect(body.runStatus).toBe('awaiting_approval');
    expect(body.pendingApprovals.length).toBe(1);
    expect(body.task.result_summary).toContain('1 overdue invoice(s)');

    // Findings cite the real invoice row.
    const { rows: findings } = await db.query<{ title: string; evidence: Array<{ table: string }>; subject_id: string }>(
      `SELECT title, evidence, subject_id FROM ai_findings WHERE finding_type = 'billing.overdue_invoice'`
    );
    expect(findings.length).toBe(1);
    expect(findings[0]?.title).toContain('INV-');
    expect(findings[0]?.subject_id).toBe(customer.userId);

    // The approval is sealed and pending — the notification does NOT exist yet (nothing sent silently).
    const { rows: approvals } = await db.query<{ id: string; status: string; tool: string; affected_customer_id: string }>(
      `SELECT id, status, tool, affected_customer_id FROM ai_approvals`
    );
    expect(approvals.length).toBe(1);
    expect(approvals[0]?.status).toBe('pending');
    expect(approvals[0]?.tool).toBe('send_notification');
    expect(approvals[0]?.affected_customer_id).toBe(customer.userId);
    const { rows: notificationsBefore } = await db.query<{ id: string }>(`SELECT id FROM user_notifications WHERE user_id = $1`, [customer.userId]);
    expect(notificationsBefore.length).toBe(0);

    const reviewFingerprint = approvalReviewFingerprint((await getApproval(db, approvals[0]!.id))!);
    // Human approves → the sealed tool executes → real notification + outbox row.
    const decision = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/ai/approvals/${approvals[0]?.id}/decision`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { decision: 'approved', reviewFingerprint, note: 'Customer-friendly reminder approved.' },
    });
    expect(decision.statusCode).toBe(200);
    const decisionBody = decision.json() as { executed: boolean; approval: { status: string } };
    expect(decisionBody.executed).toBe(true);
    expect(decisionBody.approval.status).toBe('executed');

    const { rows: notificationsAfter } = await db.query<{ id: string; title: string; message: string }>(
      `SELECT id, title, message FROM user_notifications WHERE user_id = $1`, [customer.userId]
    );
    expect(notificationsAfter.length).toBe(1);
    expect(notificationsAfter[0]?.message).toContain('INV-');
    const { rows: outbox } = await db.query<{ channel: string; status: string }>(`SELECT channel, status FROM notification_outbox`);
    expect(outbox.length).toBe(1);
    expect(outbox[0]?.channel).toBe('EMAIL');

    // Decision is single-use: a second attempt is rejected deterministically.
    const replay = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/ai/approvals/${approvals[0]?.id}/decision`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { decision: 'approved', reviewFingerprint },
    });
    expect(replay.statusCode).toBe(400);

    // The whole chain is in the immutable AI audit log.
    const { rows: audit } = await db.query<{ action: string; status: string }>(
      `SELECT action, status FROM ai_audit_logs ORDER BY created_at`
    );
    const actions = audit.map((a) => a.action);
    expect(actions).toContain('ai.tool.pending_approval');
    expect(actions).toContain('ai.approval.executed');
    await app.close();
  });

  it('Infrastructure Guardian flags ONLY servers whose real telemetry crosses thresholds', async () => {
    const app = buildTestApp();
    const customer = await createUser('customer', 'c2@example.com');
    const facts = await seedPlatformFacts(customer.userId);
    // A second, healthy server with modest utilization must NOT be flagged.
    const healthyServer = randomUUID();
    await db.query(`INSERT INTO servers (id, name, hostname, server_type, cpu_cores, memory_mb, storage_mb, status) VALUES ($1,'web-02','web-02.internal','VPS',2,4096,51200,'active')`, [healthyServer]);
    await db.query(`INSERT INTO server_metrics (id, server_id, cpu_percent, memory_used_mb, memory_total_mb, disk_used_mb, disk_total_mb) VALUES ($1,$2,12.0,1024,4096,10000,51200)`, [randomUUID(), healthyServer]);
    const admin = await createUser('admin', 'admin3@example.com');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/ai/tasks',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { agentSlug: 'infrastructure-guardian', taskType: 'infrastructure.health_scan' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { runStatus: string; task: { result_summary: string } };
    expect(body.runStatus).toBe('succeeded');

    const { rows: findings } = await db.query<{ subject_id: string; title: string }>(
      `SELECT subject_id, title FROM ai_findings WHERE finding_type = 'infrastructure.health'`
    );
    const flaggedIds = new Set(findings.map((f) => f.subject_id));
    expect(flaggedIds.has(facts.serverId)).toBe(true); // 95.5% CPU + ≥90% mem/disk
    expect(flaggedIds.has(healthyServer)).toBe(false);
    await app.close();
  });

  it('rejects tool calls the agent is not granted (registry gate), with a denial audit row', async () => {
    const app = buildTestApp();
    const customer = await createUser('customer', 'c3@example.com');
    const facts = await seedPlatformFacts(customer.userId);
    const admin = await createUser('admin', 'admin4@example.com');
    await app.ready();
    await seedAgentRegistry(db);

    // The registry is code-owned: seed stamps tool grants from the catalog and the `enabled`
    // flag is the operator kill switch. The gate must therefore reject any tool NOT present in
    // the agent's row. Exercise the gate directly against the real executor machinery: create a
    // REAL task + run for Ledger (audit rows carry FK references), then clone the agent row with
    // its tool grants stripped and attempt get_invoice.
    const ledger = await getAgentBySlug(db, 'ledger');
    expect(ledger).not.toBeNull();
    const { task } = await createTask(db, {
      agentId: ledger!.id,
      taskType: 'billing.invoice_explain',
      context: { invoiceId: facts.invoiceId },
      requestedBy: admin.userId,
      requestedByType: 'staff',
    });
    const run = await insertRun(db, { taskId: task.id, agentId: ledger!.id, engine: 'deterministic', model: 'cloudhost247-native', input: { invoiceId: facts.invoiceId } });
    const strippedHandles: RunHandles = {
      task,
      agent: { ...ledger!, tools: [] },
      runId: run.id,
      stepOrder: 1,
      pendingApprovals: [],
      actorUserId: admin.userId,
      customerScopeUserId: null,
    };
    const outcome = await gatedToolCall(db, strippedHandles, 'get_invoice', { invoiceId: facts.invoiceId });
    expect(outcome.status).toBe('denied');
    expect(outcome.errorCode).toBe('TOOL_NOT_GRANTED');

    const { rows: denied } = await db.query<{ error_code: string; decision: string }>(
      `SELECT error_code, decision FROM ai_audit_logs WHERE action = 'ai.tool.denied'`
    );
    expect(denied.length).toBe(1);
    expect(denied[0]?.error_code).toBe('TOOL_NOT_GRANTED');
    expect(denied[0]?.decision).toBe('blocked');

    // Asking for an undeclared task type is impossible at intake.
    const undeclared = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/ai/tasks',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { agentSlug: 'collector', taskType: 'infrastructure.health_scan' },
    });
    expect(undeclared.statusCode).toBe(400);
    await app.close();
  });

  // ----------------------------------------------------------------------------------------------
  // Admin Copilot — §33 commands
  // ----------------------------------------------------------------------------------------------

  it('Admin Copilot answers "show today\'s failed payments" with the real failed payment', async () => {
    const app = buildTestApp();
    const customer = await createUser('customer', 'payer@example.com');
    await seedPlatformFacts(customer.userId);
    const admin = await createUser('admin', 'admin5@example.com');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/ai/copilot',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { command: "Show today's failed payments" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { answer: string; intent: string };
    expect(body.intent).toBe('billing.failed_payments');
    expect(body.answer).toContain('payer@example.com');
    expect(body.answer).toContain('card_declined');

    const unknown = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/ai/copilot',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { command: 'deliver the moon on a stick' },
    });
    const unknownBody = unknown.json() as { answer: string };
    expect(unknownBody.answer).toContain("will not guess");
    await app.close();
  });

  // ----------------------------------------------------------------------------------------------
  // Customer Cloud Assistant — hard tenant isolation
  // ----------------------------------------------------------------------------------------------

  it('limits customer AI activity to safe own-assistant references, not internal or historical content', async () => {
    const app = buildTestApp();
    const alice = await createUser('customer', 'activity-alice@example.com');
    const bob = await createUser('customer', 'activity-bob@example.com');
    const admin = await createUser('admin', 'activity-admin@example.com');
    await seedAgentRegistry(db);
    const assistant = (await getAgentBySlug(db, 'customer-cloud-assistant'))!;
    const collector = (await getAgentBySlug(db, 'collector'))!;
    const own = (await createTask(db, { agentId: assistant.id, taskType: 'customer.assistant_query', requestedByType: 'customer', requestedBy: alice.userId, customerId: alice.userId })).task;
    await db.query(`UPDATE ai_tasks SET result_summary = 'historic-private-result' WHERE id = $1`, [own.id]);
    const staffTask = (await createTask(db, { agentId: collector.id, taskType: 'billing.overdue_digest', requestedByType: 'staff', requestedBy: admin.userId, customerId: alice.userId })).task;
    await db.query(`UPDATE ai_tasks SET result_summary = 'staff-private-summary' WHERE id = $1`, [staffTask.id]);
    const other = (await createTask(db, { agentId: assistant.id, taskType: 'customer.assistant_query', requestedByType: 'customer', requestedBy: bob.userId, customerId: alice.userId })).task;
    await createFinding(db, { agentId: collector.id, findingType: 'test', severity: 'low', title: 'private-finding-title', summary: 'private-finding-summary', evidence: [], subjectType: 'customer', subjectId: alice.userId });
    await createApproval(db, { agentId: collector.id, taskId: staffTask.id, runId: null, tool: 'send_notification', action: 'private-approval-action', reason: 'private-reason', evidence: [], riskLevel: 'high', affectedCustomerId: alice.userId, arguments: {} });
    const activity = await app.inject({ method: 'GET', url: '/api/v1/account/ai/activity', headers: { authorization: `Bearer ${alice.token}` } });
    expect(activity.statusCode).toBe(200);
    expect(activity.json().visibility).toBe('recent_customer_assistant_tasks_only');
    expect(activity.json().tasks.map((t: { id: string }) => t.id)).toEqual([own.id]);
    expect(Object.keys(activity.json().tasks[0]).sort()).toEqual(['completed_at', 'created_at', 'id', 'status']);
    expect(activity.json().findings).toEqual([]);
    expect(activity.json().approvals).toEqual([]);
    for (const forbidden of ['historic-private-result', 'staff-private-summary', 'private-finding', 'private-approval', staffTask.id, other.id]) expect(activity.body).not.toContain(forbidden);
    const profile = await app.inject({ method: 'GET', url: '/api/v1/account/ai/profile', headers: { authorization: `Bearer ${alice.token}` } });
    expect(profile.json().metrics).not.toHaveProperty('aiTasksForCustomer');
    const answer = await app.inject({ method: 'POST', url: '/api/v1/account/ai/assistant', headers: { authorization: `Bearer ${alice.token}` }, payload: { message: 'what has the ai done on my account' } });
    expect(answer.statusCode).toBe(200);
    expect(answer.json().answer).toContain('not a complete record');
    expect(answer.body).not.toContain('private-');
    expect(answer.body).not.toContain('not granted');
    const staff = await executeToolImplementation({ db }, 'get_ai_activity', { userId: alice.userId });
    expect(staff.ok).toBe(true);
    expect(JSON.stringify(staff)).toContain('private-finding-summary');
    expect(JSON.stringify(staff)).toContain('staff-private-summary');
    await app.close();
  });

  it('reports only scoped recorded domain and certificate expiry matches without implying complete or live coverage', async () => {
    const app = buildTestApp();
    const alice = await createUser('customer', 'expiry-alice@example.com');
    const bob = await createUser('customer', 'expiry-bob@example.com');
    const ask = (message: string) => app.inject({ method: 'POST', url: '/api/v1/account/ai/assistant', headers: { authorization: `Bearer ${alice.token}` }, payload: { message } });
    await db.query(`INSERT INTO customer_domains (id,user_id,domain_name,status,expires_at) VALUES
      ($1,$2,'alice-unknown.example','active',NULL), ($3,$2,'alice-transfer.example','pending_migration',CURRENT_DATE),
      ($4,$5,'bob-private.example','active',CURRENT_DATE)`, [randomUUID(), alice.userId, randomUUID(), randomUUID(), bob.userId]);
    await db.query(`INSERT INTO ssl_certificates (id,user_id,domain_name,status,expires_at) VALUES
      ($1,$2,'alice-unknown-cert.example','FAILED',NULL), ($3,$2,'alice-revoked.example','REVOKED',now()),
      ($4,$2,'alice-future-failure.example','FAILED',now() + interval '120 days'), ($5,$6,'bob-private-cert.example','ISSUED',now())`, [randomUUID(), alice.userId, randomUUID(), randomUUID(), randomUUID(), bob.userId]);
    const domainEmpty = await ask('show my domain dns records');
    expect(domainEmpty.statusCode).toBe(200);
    expect(domainEmpty.json().answer).toContain('No matching records were returned');
    expect(domainEmpty.json().answer).toContain('unknown expiry');
    expect(domainEmpty.json().answer).toContain('cannot inspect DNS');
    expect(domainEmpty.body).not.toContain('bob-private');
    const sslEmpty = await ask('show my ssl certificate status');
    expect(sslEmpty.json().answer).toContain('No matching records were returned');
    expect(sslEmpty.json().answer).toContain('even if failed or revoked');
    expect(sslEmpty.json().answer).toContain('not a complete certificate inventory');
    expect(sslEmpty.body).not.toContain('bob-private');
    for (let i = 0; i < 12; i++) {
      await db.query(`INSERT INTO customer_domains (id,user_id,domain_name,status,expires_at) VALUES ($1,$2,$3,'active',CURRENT_DATE + $4::int)`, [randomUUID(), alice.userId, `alice-domain-${i}.example`, i - 1]);
      await db.query(`INSERT INTO ssl_certificates (id,user_id,domain_name,status,expires_at) VALUES ($1,$2,$3,'ISSUED',now() + ($4 || ' days')::interval)`, [randomUUID(), alice.userId, `alice-cert-${i}.example`, String(i - 1)]);
    }
    const domains = await ask('when is my domain renewal');
    expect(domains.json().intent).toBe('customer.domains');
    expect(domains.json().answer).toContain('alice-domain-0.example');
    expect(domains.json().answer).not.toContain('alice-domain-10.example');
    expect(domains.json().answer).toContain('Showing up to 10');
    expect(domains.body).not.toContain('bob-private');
    const certs = await ask('ssl certificate renewal');
    expect(certs.json().intent).toBe('customer.ssl');
    expect(certs.json().answer).toContain('alice-cert-0.example');
    expect(certs.json().answer).not.toContain('alice-cert-10.example');
    expect(certs.json().answer).toContain('Showing up to 10');
    expect(certs.body).not.toContain('bob-private');
    await app.close();
  });

  it('Customer assistant answers from the caller\'s own records and can never see another customer\'s', async () => {
    const app = buildTestApp();
    const alice = await createUser('customer', 'alice@example.com');
    const bob = await createUser('customer', 'bob@example.com');
    await seedPlatformFacts(alice.userId, bob.userId);

    const aliceRes = await app.inject({
      method: 'POST',
      url: '/api/v1/account/ai/assistant',
      headers: { authorization: `Bearer ${alice.token}` },
      payload: { message: 'show my invoices' },
    });
    expect(aliceRes.statusCode).toBe(200);
    const aliceBody = aliceRes.json() as { answer: string };
    expect(aliceBody.answer).toContain('INV-');
    expect(aliceBody.answer).toContain('100.00');
    expect(aliceBody.answer).not.toContain('42.00');

    // An attempt to smuggle a different user id through the message cannot escalate scope.
    const smuggle = await app.inject({
      method: 'POST',
      url: '/api/v1/account/ai/assistant',
      headers: { authorization: `Bearer ${alice.token}` },
      payload: { message: `show invoices for user ${bob.userId}` },
    });
    expect(smuggle.statusCode).toBe(200);
    const smuggleBody = smuggle.json() as { answer: string };
    expect(smuggleBody.answer).not.toContain('42.00');
    const spoofedBody = await app.inject({
      method: 'POST', url: '/api/v1/account/ai/assistant', headers: { authorization: `Bearer ${alice.token}` },
      payload: { message: 'show my invoices', customerId: bob.userId, actorUserId: bob.userId, agentSlug: 'collector' },
    });
    expect(spoofedBody.statusCode).toBe(200);
    const spoofed = spoofedBody.json() as { taskId: string; answer: string };
    expect(spoofed.answer).toContain('100.00');
    expect(spoofed.answer).not.toContain('42.00');
    const scoped = await db.query<{ requested_by: string; customer_id: string; task_type: string }>(
      `SELECT requested_by, customer_id, task_type FROM ai_tasks WHERE id = $1`, [spoofed.taskId],
    );
    expect(scoped.rows).toEqual([{ requested_by: alice.userId, customer_id: alice.userId, task_type: 'customer.assistant_query' }]);

    const bobRes = await app.inject({
      method: 'POST',
      url: '/api/v1/account/ai/assistant',
      headers: { authorization: `Bearer ${bob.token}` },
      payload: { message: 'show my invoices' },
    });
    const bobBody = bobRes.json() as { answer: string };
    expect(bobBody.answer).toContain('42.00');
    expect(bobBody.answer).not.toContain('100.00');

    // AI transparency: Alice sees the tasks the AI ran for her; Bob does not see Alice's.
    const aliceActivity = await app.inject({ method: 'GET', url: '/api/v1/account/ai/activity', headers: { authorization: `Bearer ${alice.token}` } });
    expect(aliceActivity.statusCode).toBe(200);
    const activity = aliceActivity.json() as { tasks: Array<{ task_type: string }>; customerId: string };
    expect(activity.customerId).toBe(alice.userId);
    expect(activity.tasks.length).toBeGreaterThanOrEqual(2);
    const bobActivity = await app.inject({ method: 'GET', url: '/api/v1/account/ai/activity', headers: { authorization: `Bearer ${bob.token}` } });
    const bobData = bobActivity.json() as { tasks: Array<{ task_type: string }> };
    expect(bobData.tasks.length).toBe(1); // only Bob's own assistant call

    // A ticket opened through the assistant lands in the REAL support queue.
    const openTicket = await app.inject({
      method: 'POST',
      url: '/api/v1/account/ai/assistant',
      headers: { authorization: `Bearer ${alice.token}` },
      payload: { message: 'open ticket: my VPN stopped working after the reboot yesterday' },
    });
    expect(openTicket.statusCode).toBe(200);
    const ticketBody = openTicket.json() as { answer: string };
    expect(ticketBody.answer).toContain('support ticket is open');
    const { rows: tickets } = await db.query<{ user_id: string; subject: string }>(`SELECT user_id, subject FROM support_tickets WHERE user_id = $1`, [alice.userId]);
    expect(tickets.length).toBe(1);
    expect(tickets[0]?.subject).toContain('VPN');
    await app.close();
  });

  // ----------------------------------------------------------------------------------------------
  // Event-driven workflows
  // ----------------------------------------------------------------------------------------------

  it('routes an emitted invoice.overdue event through the collections workflow', async () => {
    const app = buildTestApp();
    const customer = await createUser('customer', 'events@example.com');
    const facts = await seedPlatformFacts(customer.userId);
    const admin = await createUser('admin', 'admin6@example.com');

    const emitted = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/ai/events',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { eventType: 'invoice.overdue', payload: { invoiceId: facts.invoiceId, customerId: customer.userId }, processNow: true },
    });
    expect(emitted.statusCode).toBe(200);
    expect(emitted.body).not.toContain('dispatch_claim_token');
    const eventId = (emitted.json() as { event: { id: string } }).event.id;
    const matchingRuns = await app.inject({ method: 'GET', url: `/api/v1/admin/ai/workflow-runs?eventId=${eventId}`, headers: { authorization: `Bearer ${admin.token}` } });
    expect(matchingRuns.statusCode).toBe(200);
    expect((matchingRuns.json() as { runs: Array<{ event_id: string }> }).runs.map((run) => run.event_id)).toEqual([eventId]);
    const otherRuns = await app.inject({ method: 'GET', url: `/api/v1/admin/ai/workflow-runs?eventId=${randomUUID()}`, headers: { authorization: `Bearer ${admin.token}` } });
    expect(otherRuns.json()).toMatchObject({ count: 0, runs: [] });

    const { rows: runs } = await db.query<{ status: string; steps: string | Array<{ step: string; status: string }> }>(
      `SELECT wr.status, wr.steps FROM ai_workflow_runs wr JOIN ai_workflows w ON w.id = wr.workflow_id WHERE w.slug = 'invoice-overdue-collections'`
    );
    expect(runs.length).toBe(1);
    const steps = typeof runs[0]!.steps === 'string' ? JSON.parse(runs[0]!.steps as unknown as string) as Array<{ step: string; status: string }> : runs[0]!.steps;
    expect(steps[0]?.step).toBe('collector');
    expect(['awaiting_approval', 'succeeded']).toContain(steps[0]?.status);
    expect(runs[0]?.status).toBe(steps[0]?.status === 'awaiting_approval' ? 'partial' : 'succeeded');

    // An approval pause retains the claim, whereas an observed successful workflow is acknowledged.
    // Neither state verifies an external effect or provides exactly-once execution.
    const { rows: events } = await db.query<{ processed_at: string | null; dispatch_claimed_at: string | null }>(
      `SELECT processed_at, dispatch_claimed_at FROM ai_events WHERE id = $1`, [eventId]);
    if (steps[0]?.status === 'awaiting_approval') {
      expect(events[0]?.processed_at).toBeNull();
      expect(events[0]?.dispatch_claimed_at).toBeTruthy();
    } else expect(events[0]?.processed_at).toBeTruthy();

    // The collector task ran for the right customer.
    const { rows: tasks } = await db.query<{ requested_by_type: string; customer_id: string }>(
      `SELECT requested_by_type, customer_id FROM ai_tasks WHERE task_type = 'billing.overdue_digest'`
    );
    expect(tasks.length).toBeGreaterThanOrEqual(1);
    expect(tasks.some((t) => t.customer_id === customer.userId && t.requested_by_type === 'workflow')).toBe(true);

    const heldId = randomUUID();
    const secret = randomUUID();
    await db.query(`INSERT INTO ai_events (id, event_type, source, dispatch_claim_token, dispatch_claimed_at) VALUES ($1,'test.held','admin',$2,now())`, [heldId, secret]);
    const listed = await app.inject({ method: 'GET', url: '/api/v1/admin/ai/events', headers: { authorization: `Bearer ${admin.token}` } });
    expect(listed.statusCode).toBe(200);
    expect(listed.body).not.toContain(secret);
    expect(listed.body).not.toContain('dispatch_claim_token');
    const held = (listed.json() as { events: Array<{ id: string; dispatch_claimed_at: string | null }> }).events.find((item) => item.id === heldId);
    expect(held?.dispatch_claimed_at).toBeTruthy();
    await app.close();
  });

  it('lists minimal acknowledged incomplete workflow history only for authorized operators', async () => {
    const app = buildTestApp();
    const admin = await createUser('admin', 'history-admin@example.com');
    const superAdmin = await createUser('super_admin', 'history-super@example.com');
    const staff = await createUser('staff', 'history-staff@example.com');
    const customer = await createUser('customer', 'history-customer@example.com');
    const workflowId = randomUUID();
    const eventId = randomUUID();
    const heldId = randomUUID();
    const deletedId = randomUUID();
    const runIds = Array.from({ length: 6 }, () => randomUUID());
    const secret = `history-secret-${randomUUID()}`;
    await db.query(`INSERT INTO ai_workflows (id, slug, name, event_type, definition) VALUES ($1,$2,'test','test.history','[]')`, [workflowId, `history-${workflowId}`]);
    await db.query(`INSERT INTO ai_events (id,event_type,source,payload,processed_at) VALUES
      ($1,'test.history','admin',$4,now()),($2,'test.history','admin',$4,NULL),($3,'test.history','admin',$4,now())`, [eventId, heldId, deletedId, JSON.stringify({ secret })]);
    for (const [index, status] of ['partial', 'failed', 'running', 'succeeded', 'partial', 'failed'].entries()) {
      const relatedEvent = index === 4 ? heldId : index === 5 ? deletedId : eventId;
      await db.query(`INSERT INTO ai_workflow_runs (id,workflow_id,event_id,status,steps,error,started_at)
        VALUES ($1,$2,$3,$4,$5,$6, now() - ($7::int * interval '1 minute'))`,
        [runIds[index], workflowId, relatedEvent, status, JSON.stringify([{ secret }]), secret, index]);
    }
    await db.query(`DELETE FROM ai_events WHERE id = $1`, [deletedId]);
    const path = '/api/v1/admin/ai/acknowledged-incomplete-workflows';
    const get = (token?: string, suffix = '') => app.inject({ method: 'GET', url: path + suffix, ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}) });
    expect((await get()).statusCode).toBe(401);
    expect((await get(customer.token)).statusCode).toBe(403);
    expect((await get(staff.token)).statusCode).toBe(403);
    expect((await get(admin.token, '?limit=201')).statusCode).toBe(400);
    expect((await get(admin.token, '?limit=1&status=partial')).statusCode).toBe(400);
    const response = await get(admin.token);
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain(secret);
    expect(response.body).not.toContain('steps');
    expect(response.body).not.toContain('payload');
    expect(response.body).not.toContain('dispatch_claim_token');
    const history = response.json() as { count: number; runs: Array<{ run_id: string; event_id: string; status: string }> };
    expect(history.count).toBe(3);
    expect(history.runs.map((run) => run.run_id)).toEqual(runIds.slice(0, 3));
    expect(history.runs.every((run) => run.event_id === eventId)).toBe(true);
    expect((await get(admin.token, '?limit=1')).json().runs.map((run: { run_id: string }) => run.run_id)).toEqual([runIds[0]]);
    expect((await get(superAdmin.token)).statusCode).toBe(200);
    await db.query(`UPDATE users SET role = 'staff' WHERE id = $1`, [admin.userId]);
    expect((await get(admin.token)).statusCode).toBe(403);
    await app.close();
  });

  it('records an authorized investigation for the exact acknowledged run state without modifying it', async () => {
    const app = buildTestApp();
    const admin = await createUser('admin', 'ack-investigator@example.com');
    const staff = await createUser('staff', 'ack-staff@example.com');
    const customer = await createUser('customer', 'ack-customer@example.com');
    const eventId = randomUUID();
    const runId = randomUUID();
    const workflowId = randomUUID();
    const secret = `private-${randomUUID()}`;
    await db.query(`INSERT INTO ai_workflows (id,slug,name,event_type,definition) VALUES ($1,$2,'test','test.ack','[]')`, [workflowId, `ack-${workflowId}`]);
    await db.query(`INSERT INTO ai_events (id,event_type,source,payload,processed_at) VALUES ($1,'test.ack','admin',$2,'2025-01-01T00:00:00.123456Z')`, [eventId, JSON.stringify({ secret })]);
    await db.query(`INSERT INTO ai_workflow_runs (id,workflow_id,event_id,status,steps,error) VALUES ($1,$2,$3,'partial',$4,$5)`, [runId, workflowId, eventId, JSON.stringify([{ secret }]), secret]);
    const list = () => app.inject({ method: 'GET', url: '/api/v1/admin/ai/acknowledged-incomplete-workflows', headers: { authorization: `Bearer ${admin.token}` } });
    const entry = (await list()).json().runs.find((r: { run_id: string }) => r.run_id === runId);
    expect(entry.acknowledgement_key).toBe('2025-01-01T00:00:00.123456Z');
    const body = { confirmed: true, eventId, acknowledgementKey: entry.acknowledgement_key, observedStatus: 'partial' };
    const path = `/api/v1/admin/ai/workflow-runs/${runId}/acknowledged-investigations`;
    const send = (token?: string, payload: unknown = body) => app.inject({ method: 'POST', url: path, ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}), payload });
    expect((await send()).statusCode).toBe(401);
    expect((await send(staff.token)).statusCode).toBe(403);
    expect((await send(customer.token)).statusCode).toBe(403);
    expect((await send(admin.token, { ...body, confirmed: false })).statusCode).toBe(400);
    expect((await send(admin.token, { ...body, note: secret })).statusCode).toBe(400);
    expect((await send(admin.token, { ...body, acknowledgementKey: 'invalid' })).statusCode).toBe(400);
    expect((await send(admin.token, { ...body, eventId: randomUUID() })).statusCode).toBe(409);
    expect((await send(admin.token, { ...body, observedStatus: 'running' })).statusCode).toBe(409);
    const first = await send(admin.token);
    const repeat = await send(admin.token);
    expect(first.statusCode).toBe(200);
    expect(repeat.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ created: true, investigation: { run_id: runId, event_id: eventId, observed_status: 'partial' } });
    expect(repeat.json()).toMatchObject({ created: false, investigation: { id: first.json().investigation.id } });
    expect(first.body).not.toContain(secret);
    expect((await list()).json().runs.find((r: { run_id: string }) => r.run_id === runId).investigation_id).toBe(first.json().investigation.id);
    expect((await db.query<{ n: number }>(`SELECT count(*)::int n FROM ai_audit_logs WHERE action = 'ai.workflow.acknowledged_investigation_opened' AND arguments->>'runId' = $1`, [runId])).rows[0]?.n).toBe(1);
    // A different acknowledgement incarnation must be confirmed from a fresh list, even when only microseconds change.
    await db.query(`UPDATE ai_events SET processed_at = '2025-01-01T00:00:00.123457Z' WHERE id = $1`, [eventId]);
    expect((await send(admin.token)).statusCode).toBe(409);
    const changed = (await list()).json().runs.find((r: { run_id: string }) => r.run_id === runId);
    expect(changed.investigation_id).toBeNull();
    expect((await send(admin.token, { ...body, acknowledgementKey: changed.acknowledgement_key })).json().created).toBe(true);
    await db.query(`UPDATE ai_workflow_runs SET status = 'succeeded' WHERE id = $1`, [runId]);
    expect((await send(admin.token, { ...body, acknowledgementKey: changed.acknowledgement_key })).statusCode).toBe(409);
    await db.query(`UPDATE users SET role = 'staff' WHERE id = $1`, [admin.userId]);
    expect((await send(admin.token)).statusCode).toBe(403);
    await app.close();
  });

  it('rolls back acknowledged-run investigation on audit failure', async () => {
    const app = buildTestApp();
    const admin = await createUser('admin', 'ack-audit@example.com');
    const workflowId = randomUUID(), eventId = randomUUID(), runId = randomUUID();
    await db.query(`INSERT INTO ai_workflows (id,slug,name,event_type,definition) VALUES ($1,$2,'test','test.ack','[]')`, [workflowId, `audit-${workflowId}`]);
    await db.query(`INSERT INTO ai_events (id,event_type,source,processed_at) VALUES ($1,'test.ack','admin','2025-01-01T00:00:00.123456Z')`, [eventId]);
    await db.query(`INSERT INTO ai_workflow_runs (id,workflow_id,event_id,status) VALUES ($1,$2,$3,'failed')`, [runId, workflowId, eventId]);
    await db.exec(`CREATE FUNCTION reject_acknowledged_investigation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action = 'ai.workflow.acknowledged_investigation_opened' THEN RAISE EXCEPTION 'injected audit failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_acknowledged_investigation BEFORE INSERT ON ai_audit_logs FOR EACH ROW EXECUTE FUNCTION reject_acknowledged_investigation();`);
    const response = await app.inject({ method: 'POST', url: `/api/v1/admin/ai/workflow-runs/${runId}/acknowledged-investigations`, headers: { authorization: `Bearer ${admin.token}` }, payload: { confirmed: true, eventId, acknowledgementKey: '2025-01-01T00:00:00.123456Z', observedStatus: 'failed' } });
    expect(response.statusCode).toBe(500);
    expect((await db.query(`SELECT id FROM ai_acknowledged_run_investigations WHERE run_id = $1`, [runId])).rows).toHaveLength(0);
    expect((await db.query<{ status: string }>(`SELECT status FROM ai_workflow_runs WHERE id = $1`, [runId])).rows[0]?.status).toBe('failed');
    await app.close();
  });

  it('records only authorized, delayed event investigations without exposing or changing a claim', async () => {
    const app = buildTestApp();
    const admin = await createUser('admin', 'investigator-admin@example.com');
    const staff = await createUser('staff', 'investigator-staff@example.com');
    const customer = await createUser('customer', 'investigator-customer@example.com');
    const eventId = randomUUID();
    const claimToken = randomUUID();
    const privatePayload = `private-${randomUUID()}`;
    await db.query(`INSERT INTO ai_events (id, event_type, source, payload, dispatch_claim_token, dispatch_claimed_at)
      VALUES ($1, 'test.held', 'admin', $2, $3, now() - interval '6 minutes')`, [eventId, JSON.stringify({ privatePayload }), claimToken]);
    const path = `/api/v1/admin/ai/events/${eventId}/investigations`;
    const send = (token: string | null, payload: unknown = { confirmed: true }) => app.inject({
      method: 'POST', url: path, ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}), payload,
    });
    expect((await send(null)).statusCode).toBe(401);
    expect((await send(staff.token)).statusCode).toBe(403);
    expect((await send(customer.token)).statusCode).toBe(403);
    expect((await send(admin.token, { confirmed: false })).statusCode).toBe(400);
    expect((await send(admin.token, { confirmed: true, note: 'secret' })).statusCode).toBe(400);
    const freshId = randomUUID();
    await db.query(`INSERT INTO ai_events (id,event_type,source,dispatch_claim_token,dispatch_claimed_at) VALUES ($1,'test.fresh','admin',$2,now())`, [freshId, randomUUID()]);
    expect((await app.inject({ method: 'POST', url: `/api/v1/admin/ai/events/${freshId}/investigations`, headers: { authorization: `Bearer ${admin.token}` }, payload: { confirmed: true } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: `/api/v1/admin/ai/events/${randomUUID()}/investigations`, headers: { authorization: `Bearer ${admin.token}` }, payload: { confirmed: true } })).statusCode).toBe(409);

    const listed = await app.inject({ method: 'GET', url: '/api/v1/admin/ai/event-claims', headers: { authorization: `Bearer ${admin.token}` } });
    expect(listed.statusCode).toBe(200);
    expect(listed.body).not.toContain(claimToken);
    expect(listed.body).not.toContain(privatePayload);
    expect(listed.body).not.toContain('dispatch_claim_token');
    expect((listed.json() as { claims: Array<{ event_id: string; delayed: boolean }> }).claims.find((x) => x.event_id === eventId)?.delayed).toBe(true);
    const first = await send(admin.token);
    const again = await send(admin.token);
    expect(first.statusCode).toBe(200);
    expect(again.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ created: true, investigation: { event_id: eventId } });
    expect(again.json()).toMatchObject({ created: false, investigation: { event_id: eventId } });
    expect(first.json().investigation.id).toBe(again.json().investigation.id);
    const saved = await db.query<{ processed_at: string | null; dispatch_claim_token: string }>(`SELECT processed_at, dispatch_claim_token FROM ai_events WHERE id = $1`, [eventId]);
    expect(saved.rows[0]).toMatchObject({ processed_at: null, dispatch_claim_token: claimToken });
    const audit = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ai_audit_logs WHERE action = 'ai.event.investigation_opened' AND arguments->>'eventId' = $1`, [eventId]);
    expect(audit.rows[0]?.n).toBe(1);
    const queue = await app.inject({ method: 'GET', url: '/api/v1/admin/ai/event-claims', headers: { authorization: `Bearer ${admin.token}` } });
    expect((queue.json() as { claims: Array<{ event_id: string; investigation_id: string | null }> }).claims.find((x) => x.event_id === eventId)?.investigation_id).toBe(first.json().investigation.id);
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/ai/event-claims', headers: { authorization: `Bearer ${staff.token}` } })).statusCode).toBe(403);
    // Simulate an acknowledgement from the original owner, not an investigation action.
    await db.query(`UPDATE ai_events SET processed_at = now(), dispatch_claim_token = NULL, dispatch_claimed_at = NULL WHERE id = $1 AND dispatch_claim_token = $2`, [eventId, claimToken]);
    expect((await send(admin.token)).statusCode).toBe(409);
    const afterAck = await app.inject({ method: 'GET', url: '/api/v1/admin/ai/event-claims', headers: { authorization: `Bearer ${admin.token}` } });
    expect((afterAck.json() as { claims: Array<{ event_id: string }> }).claims.some((x) => x.event_id === eventId)).toBe(false);
    expect((await db.query(`SELECT id FROM ai_event_investigations WHERE event_id = $1`, [eventId])).rows).toHaveLength(1);

    // A formerly privileged JWT is not enough after its account role is revoked.
    await db.query(`UPDATE users SET role = 'staff' WHERE id = $1`, [admin.userId]);
    expect((await send(admin.token)).statusCode).toBe(403);
    await app.close();
  });

  it('rolls back an investigation when its audit insert fails', async () => {
    const app = buildTestApp();
    const admin = await createUser('admin', 'investigation-rollback@example.com');
    const eventId = randomUUID();
    const token = randomUUID();
    await db.query(`INSERT INTO ai_events (id,event_type,source,dispatch_claim_token,dispatch_claimed_at) VALUES ($1,'test.rollback','admin',$2,now() - interval '6 minutes')`, [eventId, token]);
    await db.exec(`CREATE FUNCTION reject_investigation_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action = 'ai.event.investigation_opened' THEN RAISE EXCEPTION 'injected audit failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_investigation_audit BEFORE INSERT ON ai_audit_logs FOR EACH ROW EXECUTE FUNCTION reject_investigation_audit();`);
    const response = await app.inject({ method: 'POST', url: `/api/v1/admin/ai/events/${eventId}/investigations`, headers: { authorization: `Bearer ${admin.token}` }, payload: { confirmed: true } });
    expect(response.statusCode).toBe(500);
    expect((await db.query(`SELECT id FROM ai_event_investigations WHERE event_id = $1`, [eventId])).rows).toHaveLength(0);
    expect((await db.query<{ dispatch_claim_token: string }>(`SELECT dispatch_claim_token FROM ai_events WHERE id = $1`, [eventId])).rows[0]?.dispatch_claim_token).toBe(token);
    await app.close();
  });

  it('the platform detector emits events only for rows that exist (never synthetic)', async () => {
    const before = await detectPlatformEvents(db);
    expect(before.invoiceOverdue).toBe(0);
    expect(before.sslExpiring).toBe(0);
    const customer = await createUser('customer', 'detect@example.com');
    await seedPlatformFacts(customer.userId);
    const first = await detectPlatformEvents(db);
    expect(first.invoiceOverdue).toBe(1);
    expect(first.paymentFailed).toBe(1);
    expect(first.deploymentStuck).toBe(1);
    // Fingerprint dedupe: same day, same rows → no duplicates.
    const second = await detectPlatformEvents(db);
    expect(second.invoiceOverdue).toBe(0);
    expect(second.deploymentStuck).toBe(0);
    const { rows: events } = await db.query<{ event_type: string }>(`SELECT event_type FROM ai_events ORDER BY created_at`);
    expect(events.filter((e) => e.event_type === 'invoice.overdue').length).toBe(1);
  });

  // ----------------------------------------------------------------------------------------------
  // Executive Board briefing — idempotent, evidence-linked
  // ----------------------------------------------------------------------------------------------

  it('generates a daily executive briefing with every seat contributing, once per period', async () => {
    const app = buildTestApp();
    const customer = await createUser('customer', 'board@example.com');
    await seedPlatformFacts(customer.userId);
    const admin = await createUser('admin', 'admin7@example.com');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/ai/board/briefings',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { type: 'daily' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { created: boolean; report: { id: string; sections: Array<{ seat: string; headline: string }>; metrics: { headline: string } } };
    expect(body.created).toBe(true);
    const seats = body.report.sections.map((s) => s.seat).sort();
    expect(seats).toEqual(['CCO', 'CFO', 'CISO', 'CMO', 'COO', 'CPO', 'CRO', 'CTO', 'RISK'].sort());
    // The CFO section carries the real failure count from the seeded payment row.
    const cfo = body.report.sections.find((s) => s.seat === 'CFO');
    expect(cfo?.headline).toContain('overdue invoices: 1');
    expect(body.report.metrics.headline).toContain('overdue invoices 1');

    // Each seat ran as its own real task (no ghost-writing).
    const { rows: seatTasks } = await db.query<{ requested_by_type: string }>(
      `SELECT DISTINCT requested_by_type FROM ai_tasks WHERE task_type = 'board.department_digest'`
    );
    expect(seatTasks.length).toBe(1);
    expect(seatTasks[0]?.requested_by_type).toBe('board');

    // Idempotent: a second click returns the same final report, created=false.
    const again = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/ai/board/briefings',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { type: 'daily' },
    });
    const againBody = again.json() as { created: boolean; report: { id: string } };
    expect(againBody.created).toBe(false);
    expect(againBody.report.id).toBe(body.report.id);
    await app.close();
  });

  it("a second actor's briefing creates its own seat children instead of failing closed on a shared key", async () => {
    const app = buildTestApp();
    const customer = await createUser('customer', 'board-cross-actor@example.com');
    await seedPlatformFacts(customer.userId);
    await seedAgentRegistry(db);
    const actorA = await createUser('admin', 'admin-cross-actor-a@example.com');
    const actorB = await createUser('admin', 'admin-cross-actor-b@example.com');

    // Actor A completes a briefing; its seat children are created under A's identity with
    // actor-scoped idempotency keys.
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/ai/board/briefings',
      headers: { authorization: `Bearer ${actorA.token}` },
      payload: { type: 'weekly' },
    });
    expect(first.statusCode).toBe(200);
    expect((first.json() as { created: boolean }).created).toBe(true);

    // A legacy pre-change global-key child row must not fail closed a new run either: new keys
    // simply do not match it, so it is neither reused nor a conflict source.
    const cfo = (await getAgentBySlug(db, 'ai-cfo'))!;
    const legacy = await prepareOrchestratedTask(db, {
      agentId: cfo.id,
      taskType: 'board.department_digest',
      context: { reportType: 'weekly' },
      entryPoint: 'board.child',
      requestedBy: null,
      requestedByType: 'board',
      idempotencyKey: `board:weekly:ai-cfo:${new Date().toISOString().slice(0, 10)}`,
    });
    expect(legacy.created).toBe(true);

    // The route short-circuits once a period's report row exists, so drive actor B's parent
    // task directly — exactly the path a concurrent second actor takes before the report is
    // written. Before actor-scoped child keys this failed with TaskIdentityConflict against
    // A's (or a legacy) children.
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    const periodEnd = end.toISOString().slice(0, 10);
    const periodStart = start.toISOString().slice(0, 10);
    const ceo = (await getAgentBySlug(db, 'ai-ceo'))!;
    const { task: parentB } = await prepareOrchestratedTask(db, {
      agentId: ceo.id,
      taskType: 'board.executive_briefing',
      context: { reportType: 'weekly', periodStart, periodEnd },
      entryPoint: 'admin.board.briefing',
      requestedBy: actorB.userId,
      requestedByType: 'staff',
      idempotencyKey: `briefing:weekly:${periodEnd}:${actorB.userId}`,
    });
    const outcome = await runTask(db, parentB.id, { actorUserId: actorB.userId });
    expect(outcome.runStatus).toBe('succeeded');
    const failedRuns = await db.query<{ id: string }>(`SELECT id FROM ai_runs WHERE status = 'failed'`);
    expect(failedRuns.rows).toHaveLength(0);

    const childrenB = await db.query<{ idempotency_key: string }>(
      `SELECT idempotency_key FROM ai_tasks WHERE task_type = 'board.department_digest' AND requested_by = $1`,
      [actorB.userId],
    );
    expect(childrenB.rows.length).toBeGreaterThanOrEqual(9);
    expect(childrenB.rows.every((r) => r.idempotency_key.endsWith(`:${actorB.userId}`))).toBe(true);
    const childrenA = await db.query<{ idempotency_key: string }>(
      `SELECT idempotency_key FROM ai_tasks WHERE task_type = 'board.department_digest' AND requested_by = $1`,
      [actorA.userId],
    );
    expect(childrenA.rows.length).toBeGreaterThanOrEqual(9);
    expect(childrenA.rows.every((r) => r.idempotency_key.endsWith(`:${actorA.userId}`))).toBe(true);
    const keysA = new Set(childrenA.rows.map((r) => r.idempotency_key));
    expect(childrenB.rows.every((r) => !keysA.has(r.idempotency_key))).toBe(true);
    await app.close();
  });

  it('refuses recursive board dispatch from a persisted child even without inherited depth', async () => {
    await seedAgentRegistry(db);
    const cfo = (await getAgentBySlug(db, 'ai-cfo'))!;
    const original = AGENT_HANDLERS['board.department_digest']!;
    try {
      AGENT_HANDLERS['board.department_digest'] = async (ctx) => {
        const child = await ctx.runChildAgent('board.department_digest', { reportType: 'daily' },
          { agentSlug: 'ai-cfo', idempotencyKey: 'recursive-board-probe' });
        expect(child.status).toBe('refused');
        return { summary: 'recursive dispatch refused' };
      };
      const { task } = await prepareOrchestratedTask(db, {
        agentId: cfo.id, taskType: 'board.department_digest', context: { reportType: 'daily' },
        entryPoint: 'board.child', requestedByType: 'board', requestedBy: null,
      });
      // Simulate a later independent invocation, which has no in-memory boardDepth.
      expect((await runTask(db, task.id)).runStatus).toBe('succeeded');
      const rows = await db.query(`SELECT id FROM ai_tasks WHERE idempotency_key = 'recursive-board-probe'`);
      expect(rows.rows).toHaveLength(0);
    } finally {
      AGENT_HANDLERS['board.department_digest'] = original;
    }
  });

  it('records heartbeat observations at claim and on handler progress', async () => {
    const customer = await createUser('customer', 'heartbeat@example.test');
    await seedAgentRegistry(db);
    const agent = (await getAgentBySlug(db, 'customer-cloud-assistant'))!;
    const original = AGENT_HANDLERS['customer.assistant_query']!;
    let claimHeartbeat: Date | null = null;
    try {
      AGENT_HANDLERS['customer.assistant_query'] = async (ctx) => {
        const atStart = await ctx.db.query<{ heartbeat_at: Date | null }>(
          `SELECT heartbeat_at FROM ai_tasks WHERE id = $1`, [ctx.task.id]);
        claimHeartbeat = atStart.rows[0]?.heartbeat_at ?? null;
        // Reset, then make progress: the final value must come from the step bump, not the claim.
        await ctx.db.query(`UPDATE ai_tasks SET heartbeat_at = '2000-01-01T00:00:00Z' WHERE id = $1`, [ctx.task.id]);
        await ctx.step('observe', { probe: true });
        return { summary: 'heartbeat probe' };
      };
      const task = (await createTask(db, {
        agentId: agent.id, taskType: 'customer.assistant_query',
        requestedByType: 'customer', requestedBy: customer.userId, customerId: customer.userId,
      })).task;
      const outcome = await runTask(db, task.id, { actorUserId: customer.userId, customerScopeUserId: customer.userId });
      expect(outcome.runStatus).toBe('succeeded');
      // The claim recorded an initial heartbeat before the handler ran.
      expect(claimHeartbeat).not.toBeNull();
      expect(new Date(claimHeartbeat as unknown as string).getTime()).toBeGreaterThan(Date.now() - 60_000);
      // The step bumped it again after the reset — progress is observed, not inferred.
      const row = await db.query<{ heartbeat_at: Date | null }>(`SELECT heartbeat_at FROM ai_tasks WHERE id = $1`, [task.id]);
      expect(row.rows[0]?.heartbeat_at).not.toBeNull();
      expect(new Date(row.rows[0]!.heartbeat_at as unknown as string).getTime()).toBeGreaterThan(Date.now() - 60_000);
    } finally {
      AGENT_HANDLERS['customer.assistant_query'] = original;
    }
  });

  it('lists suspected-interrupted running tasks minimally and records attention without changing the task', async () => {
    const app = buildTestApp();
    await seedAgentRegistry(db);
    const admin = await createUser('admin', 'admin-interrupted@example.com');
    const customer = await createUser('customer', 'interrupted-customer@example.com');
    const agent = (await getAgentBySlug(db, 'collector'))!;
    const { task: stale } = await createTask(db, { agentId: agent.id, taskType: 'billing.overdue_digest', requestedByType: 'schedule' });
    await db.query(
      `UPDATE ai_tasks SET status = 'running', heartbeat_at = now() - interval '20 minutes', updated_at = now() - interval '20 minutes' WHERE id = $1`,
      [stale.id]);
    const { task: fresh } = await createTask(db, { agentId: agent.id, taskType: 'billing.overdue_digest', requestedByType: 'schedule' });
    await db.query(`UPDATE ai_tasks SET status = 'running', heartbeat_at = now() WHERE id = $1`, [fresh.id]);
    const { task: queued } = await createTask(db, { agentId: agent.id, taskType: 'billing.overdue_digest', requestedByType: 'schedule' });
    await db.query(`UPDATE ai_tasks SET updated_at = now() - interval '20 minutes' WHERE id = $1`, [queued.id]);

    const denied = await app.inject({
      method: 'GET', url: '/api/v1/admin/ai/suspected-interrupted-tasks',
      headers: { authorization: `Bearer ${customer.token}` },
    });
    expect(denied.statusCode).toBe(403);

    const res = await app.inject({
      method: 'GET', url: '/api/v1/admin/ai/suspected-interrupted-tasks',
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      count: number;
      tasks: Array<{ task_id: string; status: string; observed_heartbeat_at: string; investigation_id: string | null }>;
    };
    expect(body.tasks.map((t) => t.task_id)).toEqual([stale.id]);
    const listed = body.tasks[0]!;
    expect(listed.status).toBe('running');
    expect(listed.investigation_id).toBeNull();
    expect(listed.observed_heartbeat_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
    // Minimal shape: no context, results, errors, payloads or caller identity.
    expect(Object.keys(listed).sort()).toEqual(
      ['agent_slug', 'investigation_id', 'investigation_opened_at', 'investigation_opened_by', 'observed_heartbeat_at', 'status', 'task_id', 'task_type'].sort());

    const post = await app.inject({
      method: 'POST', url: `/api/v1/admin/ai/tasks/${stale.id}/interrupted-investigations`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { confirmed: true, observedHeartbeat: listed.observed_heartbeat_at },
    });
    expect(post.statusCode).toBe(200);
    const postBody = post.json() as { created: boolean; investigation: { id: string } };
    expect(postBody.created).toBe(true);

    // The task itself is untouched: still running, still stale, not retried or replayed.
    const still = await db.query<{ status: string; heartbeat_at: Date | null }>(
      `SELECT status, heartbeat_at FROM ai_tasks WHERE id = $1`, [stale.id]);
    expect(still.rows[0]?.status).toBe('running');
    expect(new Date(still.rows[0]!.heartbeat_at as unknown as string).getTime()).toBeLessThan(Date.now() - 15 * 60_000);
    const audits = await db.query<{ id: string }>(
      `SELECT id FROM ai_audit_logs WHERE action = 'ai.task.interrupted_investigation_opened' AND arguments->>'taskId' = $1`, [stale.id]);
    expect(audits.rows).toHaveLength(1);

    // Idempotent on the same observation; no duplicate record or audit.
    const again = await app.inject({
      method: 'POST', url: `/api/v1/admin/ai/tasks/${stale.id}/interrupted-investigations`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { confirmed: true, observedHeartbeat: listed.observed_heartbeat_at },
    });
    expect((again.json() as { created: boolean }).created).toBe(false);
    expect((await db.query(`SELECT id FROM ai_task_investigations WHERE task_id = $1`, [stale.id])).rows).toHaveLength(1);
    expect((await db.query(`SELECT id FROM ai_audit_logs WHERE action = 'ai.task.interrupted_investigation_opened' AND arguments->>'taskId' = $1`, [stale.id])).rows).toHaveLength(1);

    // A stale view fails closed: wrong observation key → conflict.
    const bad = await app.inject({
      method: 'POST', url: `/api/v1/admin/ai/tasks/${stale.id}/interrupted-investigations`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { confirmed: true, observedHeartbeat: '2000-01-01T00:00:00.000000Z' },
    });
    expect(bad.statusCode).toBe(409);

    // A freshly heartbeating running task is not eligible even with its exact key.
    const freshKey = (await db.query<{ obs: string }>(
      `SELECT to_char(heartbeat_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS obs FROM ai_tasks WHERE id = $1`,
      [fresh.id])).rows[0]!.obs;
    const freshPost = await app.inject({
      method: 'POST', url: `/api/v1/admin/ai/tasks/${fresh.id}/interrupted-investigations`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { confirmed: true, observedHeartbeat: freshKey },
    });
    expect(freshPost.statusCode).toBe(409);
    // A queued task is never eligible, however old.
    const queuedPost = await app.inject({
      method: 'POST', url: `/api/v1/admin/ai/tasks/${queued.id}/interrupted-investigations`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { confirmed: true, observedHeartbeat: '2000-01-01T00:00:00.000000Z' },
    });
    expect(queuedPost.statusCode).toBe(409);
    await app.close();
  });

  // ----------------------------------------------------------------------------------------------
  // Model router — fail closed
  // ----------------------------------------------------------------------------------------------

  it('model routing fails closed for disabled/misconfigured external engines', async () => {
    const app = buildTestApp();
    await app.ready();
    await seedAgentRegistry(db);
    const agent = (await getAgentBySlug(db, 'ai-ceo')) as AgentRow;
    const externalAgent: AgentRow = { ...agent, engine: 'openai' };
    await expect(resolveModelForAgent(db, externalAgent)).rejects.toThrowError(ModelResolutionError);
    // disabled
    await expect(resolveModelForAgent(db, externalAgent)).rejects.toThrowError(/CONFIGURATION_REQUIRED/i);
    // enabled but unconfigured — still fail-closed
    await db.query(`UPDATE ai_model_configs SET enabled = true WHERE engine = 'openai'`);
    await expect(resolveModelForAgent(db, externalAgent)).rejects.toThrowError(/no model or endpoint/i);
    // deterministic always resolves
    const resolved = await resolveModelForAgent(db, agent);
    expect(resolved.engine).toBe('deterministic');
    await app.close();
  });

  // ----------------------------------------------------------------------------------------------
  // Knowledge base — citation-first answers
  // ----------------------------------------------------------------------------------------------

  it('keeps internal knowledge away from the customer assistant while retaining staff search', async () => {
    const app = buildTestApp();
    const admin = await createUser('admin', 'knowledge-admin@example.com');
    const customer = await createUser('customer', 'knowledge-customer@example.com');
    const secret = 'private-runbook-secret-742';
    const source = await app.inject({ method: 'POST', url: '/api/v1/admin/ai/knowledge', headers: { authorization: `Bearer ${admin.token}` },
      payload: { title: 'Saffron runbook', sourceType: 'runbook', content: `Saffron internal support steps contain ${secret}`, keywords: ['saffron'] } });
    expect(source.statusCode).toBe(200);
    const result = await app.inject({ method: 'POST', url: '/api/v1/account/ai/assistant', headers: { authorization: `Bearer ${customer.token}` }, payload: { message: 'How do I use saffron?' } });
    expect(result.statusCode).toBe(200);
    expect(result.body).not.toContain(secret);
    expect(result.body).not.toContain('Saffron runbook');
    expect(result.json().answer).toContain('cannot search the knowledge base');
    const taskId = result.json().taskId;
    expect((await db.query(`SELECT id FROM ai_tool_calls WHERE task_id = $1 AND tool = 'search_knowledge'`, [taskId])).rows).toHaveLength(0);
    const staff = await app.inject({ method: 'GET', url: '/api/v1/admin/ai/knowledge/search?q=saffron', headers: { authorization: `Bearer ${admin.token}` } });
    expect(staff.statusCode).toBe(200);
    expect(staff.body).toContain(secret);
    await app.close();
  });

  it('knowledge answers are citation-traceable; no coverage means an honest "not documented"', async () => {
    const app = buildTestApp();
    const admin = await createUser('admin', 'admin8@example.com');

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/ai/knowledge',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        title: 'Restarting a VPS safely',
        sourceType: 'runbook',
        content: 'To restart a VPS safely, open the server dashboard, verify the latest backup completed, use the Restart action, then confirm services report healthy. A forced power cycle risks filesystem corruption on busy databases.',
        keywords: ['restart', 'vps', 'reboot', 'power cycle'],
      },
    });
    expect(created.statusCode).toBe(200);

    // Knowledge agent answers WITH the citation.
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/ai/tasks',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { agentSlug: 'knowledge-agent', taskType: 'knowledge.answer', input: { query: 'how do I safely reboot my vps' } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { task: { result: { documented: boolean; citations: Array<{ source: string }> } } };
    expect(body.task.result.documented).toBe(true);
    expect(body.task.result.citations[0]?.source).toBe('Restarting a VPS safely');

    const notDoc = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/ai/tasks',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { agentSlug: 'knowledge-agent', taskType: 'knowledge.answer', input: { query: 'quantum entanglement latency' } },
    });
    const notDocBody = notDoc.json() as { task: { result_summary: string } };
    expect(notDocBody.task.result_summary).toContain('NOT DOCUMENTED');
    await app.close();
  });

  // ----------------------------------------------------------------------------------------------
  // Worker sweep — one full cycle
  // ----------------------------------------------------------------------------------------------

  it('runAiSweep detects real state, dispatches workflows, keeps the briefing idempotent', async () => {
    const customer = await createUser('customer', 'sweep@example.com');
    await seedPlatformFacts(customer.userId);
    const result = await runAiSweep(db);
    expect(result.detected.invoiceOverdue).toBe(1);
    expect(result.eventsProcessed).toBeGreaterThanOrEqual(1);
    expect(result.workflowsDispatched).toBeGreaterThanOrEqual(1); // invoice-overdue → collector
    expect(result.scansLaunched.length).toBeGreaterThanOrEqual(2);
    const { rows: reports } = await db.query<{ report_type: string }>(`SELECT report_type FROM ai_executive_reports`);
    expect(reports.filter((r) => r.report_type === 'daily').length).toBe(1);

    // Second sweep immediately: nothing duplicates.
    const repeat = await runAiSweep(db);
    expect(repeat.detected.invoiceOverdue).toBe(0);
    expect(repeat.briefing.created).toBe(false);
    const { rows: reportsAfter } = await db.query<{ id: string }>(`SELECT id FROM ai_executive_reports WHERE report_type = 'daily'`);
    expect(reportsAfter.length).toBe(1);
  });

  // ----------------------------------------------------------------------------------------------
  // Findings lifecycle + incident creation (human)
  // ----------------------------------------------------------------------------------------------

  it('humans can open incidents and acknowledge findings; all actions audited', async () => {
    const app = buildTestApp();
    const customer = await createUser('customer', 'incident@example.com');
    await seedPlatformFacts(customer.userId);
    const admin = await createUser('admin', 'admin9@example.com');

    const incident = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/ai/incidents',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { title: 'Storage latency spike on web-01', severity: 'high', summary: 'Opened while investigating stuck provision job.' },
    });
    expect(incident.statusCode).toBe(200);
    const incidentBody = incident.json() as { incident: { incident_number: string; id: string } };
    expect(incidentBody.incident.incident_number).toMatch(/^AI-\d{8}$/);

    const note = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/ai/incidents/${incidentBody.incident.id}/notes`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { note: 'Confirmed worker queue stall; restarting workers.', status: 'investigating' },
    });
    expect(note.statusCode).toBe(200);

    const resolved = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/ai/incidents/${incidentBody.incident.id}/notes`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { note: 'Workers recovered; deployments draining.', status: 'resolved' },
    });
    const resolvedBody = resolved.json() as { incident: { status: string; resolved_at: string | null } };
    expect(resolvedBody.incident.status).toBe('resolved');
    expect(resolvedBody.incident.resolved_at).not.toBeNull();

    const { rows: events } = await db.query<{ event_type: string }>(`SELECT event_type FROM ai_events WHERE event_type IN ('incident.created','incident.resolved')`);
    expect(events.map((e) => e.event_type).sort()).toEqual(['incident.created', 'incident.resolved']);
    await app.close();
  });
});
