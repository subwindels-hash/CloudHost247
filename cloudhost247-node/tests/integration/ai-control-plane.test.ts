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
import { gatedToolCall } from '../../src/ai-os/runtime/executor';
import type { RunHandles } from '../../src/ai-os/runtime/executor';
import { createTask, insertRun } from '../../src/ai-os/repositories/tasks-repo';
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
    // Booting must NOT touch the database (a DB outage or an unapplied 0066 must not stop the
    // whole app from starting) — the registry is seeded lazily by the first AI request.
    const before = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ai_agents`);
    expect(before.rows[0]?.n).toBe(0);
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

    // Human approves → the sealed tool executes → real notification + outbox row.
    const decision = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/ai/approvals/${approvals[0]?.id}/decision`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { decision: 'approved', note: 'Customer-friendly reminder approved.' },
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
      payload: { decision: 'approved' },
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

    const { rows: runs } = await db.query<{ steps: string | Array<{ step: string; status: string }> }>(
      `SELECT wr.steps FROM ai_workflow_runs wr JOIN ai_workflows w ON w.id = wr.workflow_id WHERE w.slug = 'invoice-overdue-collections'`
    );
    expect(runs.length).toBe(1);
    const steps = typeof runs[0]!.steps === 'string' ? JSON.parse(runs[0]!.steps as unknown as string) as Array<{ step: string; status: string }> : runs[0]!.steps;
    expect(steps[0]?.step).toBe('collector');
    expect(['awaiting_approval', 'succeeded']).toContain(steps[0]?.status);

    // The event is marked processed (exactly-once dispatch).
    const { rows: events } = await db.query<{ processed_at: string | null }>(`SELECT processed_at FROM ai_events`);
    expect(events.every((e) => e.processed_at !== null)).toBe(true);

    // The collector task ran for the right customer.
    const { rows: tasks } = await db.query<{ requested_by_type: string; customer_id: string }>(
      `SELECT requested_by_type, customer_id FROM ai_tasks WHERE task_type = 'billing.overdue_digest'`
    );
    expect(tasks.length).toBeGreaterThanOrEqual(1);
    expect(tasks.some((t) => t.customer_id === customer.userId && t.requested_by_type === 'workflow')).toBe(true);
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
