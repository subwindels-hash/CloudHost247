import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { seedAgentRegistry } from '../../src/ai-os/registry/seed';
import { getAgentBySlug } from '../../src/ai-os/repositories/registry-repo';
import { prepareOrchestratedTask } from '../../src/ai-os/runtime/task-orchestrator';
import { readonlyRetryRefusal, READ_ONLY_RETRY_TASK_TYPES } from '../../src/ai-os/runtime/read-only-retry';
import { gatedToolCall, runTask } from '../../src/ai-os/runtime/executor';
import { AGENT_HANDLERS } from '../../src/ai-os/agents/handlers';
import { insertRun } from '../../src/ai-os/repositories/tasks-repo';
import { getTask } from '../../src/ai-os/repositories/tasks-repo';
import { signAuthToken } from '../../src/lib/jwt';
import { lookupLaunchOrderability } from '../../src/whmcs/agent-orderability';
import type { RunHandles } from '../../src/ai-os/runtime/executor';
import type { Queryable } from '../../src/db/types';

vi.mock('../../src/whmcs/agent-orderability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/whmcs/agent-orderability')>();
  return { ...actual, lookupLaunchOrderability: vi.fn() };
});
const fakeLookup = vi.mocked(lookupLaunchOrderability);

const env = loadEnv({
  NODE_ENV: 'test', DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
  JWT_SECRET: 'r'.repeat(40), AI_WEBSITE_LAUNCH_ENABLED: 'true', LOG_LEVEL: 'silent',
});

function verdict(serviceKey = 'hosting-wordpress') {
  return {
    serviceKey, state: 'orderable' as const, orderable: true, reasonCode: 'ORDERABLE' as const,
    reason: 'Available', currency: 'USD', productId: '42', productName: 'Test Plan',
    cycles: [{ cycle: 'monthly' as const, price: '9.00', setupFee: '0.00', currency: 'USD', cartUrl: 'https://billing.example.test/cart.php?a=add&pid=42' }],
  };
}

describe('operator read-only task retry (safe-retry specification)', () => {
  let db: PGlite;
  let app: ReturnType<typeof buildApp>;
  let admin: { userId: string; token: string };
  let staff: { userId: string; token: string };
  let launchAgentId: string;

  beforeAll(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
    await seedAgentRegistry(db);
    app = buildApp(env, { serveFrontend: false, pool: db });
    const user = async (role: string) => {
      const userId = randomUUID();
      await db.query(
        `INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'hash','Retry ${role}', $3)`,
        [userId, `${role}-${userId}@retry.test`, role],
      );
      return { userId, token: signAuthToken(env, { sub: userId, role, email: `${role}-${userId}@retry.test` }) };
    };
    admin = await user('admin');
    staff = await user('staff');
    const agent = await getAgentBySlug(db, 'website-launch-assistant');
    expect(agent).not.toBeNull();
    launchAgentId = agent!.id;
  });

  afterAll(async () => { await db.close(); });

  beforeEach(() => { fakeLookup.mockReset(); });

  async function queuedLaunchTask(overrides: { taskType?: string; agentId?: string; customerId?: string | null; requestedBy?: string | null; requestedByType?: 'staff' | 'customer' | 'system' } = {}) {
    const anonymous = 'requestedBy' in overrides && (overrides.requestedBy === null || overrides.requestedBy === undefined);
    const entryPoint = overrides.requestedByType === 'customer' ? 'customer.account_assistant'
      : anonymous || overrides.requestedByType === 'system' ? 'customer.website_launch' : 'admin.task';
    return (await prepareOrchestratedTask(db, {
      agentId: overrides.agentId ?? launchAgentId,
      taskType: overrides.taskType ?? 'sales.website_launch',
      entryPoint: entryPoint as 'admin.task' | 'customer.website_launch' | 'customer.account_assistant',
      requestedByType: overrides.requestedByType ?? (anonymous ? 'system' : 'staff'),
      requestedBy: 'requestedBy' in overrides ? overrides.requestedBy ?? null : admin.userId,
      customerId: 'customerId' in overrides ? overrides.customerId ?? null : null,
      context: { serviceKey: 'hosting-wordpress' },
      idempotencyKey: `retry-test:${randomUUID()}`,
    })).task;
  }

  const post = (path: string, token: string, payload: unknown) =>
    app.inject({ method: 'POST', url: path, headers: { authorization: `Bearer ${token}` }, payload });

  it('grants the dedicated permission to admin/super_admin but not staff', async () => {
    const task = await queuedLaunchTask();
    const denied = await post(`/api/v1/admin/ai/tasks/${task.id}/retry`, staff.token, { confirmed: true });
    expect(denied.statusCode).toBe(403);
    expect(denied.body).toContain('ai.tasks.retry');
    expect((await getTask(db, task.id))?.status).toBe('queued');
  });

  it('retries a proven-never-claimed read-only task and audits the decision', async () => {
    fakeLookup.mockResolvedValue(verdict());
    const task = await queuedLaunchTask();
    const result = await post(`/api/v1/admin/ai/tasks/${task.id}/retry`, admin.token, { confirmed: true });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ runStatus: 'succeeded' });
    const finished = await getTask(db, task.id);
    expect(finished?.status).toBe('succeeded');
    expect((finished?.result as { verdict?: { orderable?: boolean } } | null)?.verdict?.orderable).toBe(true);

    const runs = await db.query(`SELECT id FROM ai_runs WHERE task_id = $1`, [task.id]);
    expect(runs.rows).toHaveLength(1);
    const calls = await db.query<{ tool: string }>(`SELECT tool FROM ai_tool_calls WHERE task_id = $1`, [task.id]);
    expect(calls.rows.map((c) => c.tool)).toEqual(['lookup_launch_orderability']);
    const audit = await db.query<{ actor_id: string; resource_id: string }>(
      `SELECT actor_id, resource_id FROM audit_logs WHERE action = 'ai.task.readonly_retry' AND resource_id = $1`, [task.id]);
    expect(audit.rows[0]?.actor_id).toBe(admin.userId);
  });

  it('does not allow a retry handler to dispatch a child outside the retry tool gate', async () => {
    const original = AGENT_HANDLERS['sales.website_launch']!;
    const key = `retry-child:${randomUUID()}`;
    const existingKey = `retry-child-existing:${randomUUID()}`;
    const cfo = (await getAgentBySlug(db, 'ai-cfo'))!;
    const existing = (await prepareOrchestratedTask(db, {
      agentId: cfo.id, taskType: 'board.department_digest', context: { reportType: 'daily' },
      entryPoint: 'board.child', requestedByType: 'board', requestedBy: admin.userId,
      idempotencyKey: existingKey,
    })).task;
    try {
      AGENT_HANDLERS['sales.website_launch'] = async (ctx) => {
        for (const childKey of [key, existingKey]) {
          const result = await ctx.runChildAgent('board.department_digest', { reportType: 'daily' },
            { agentSlug: 'ai-cfo', idempotencyKey: childKey });
          expect(result).toMatchObject({ status: 'refused', result: null });
        }
        return { summary: 'child dispatch refused' };
      };
      const task = await queuedLaunchTask();
      const response = await post(`/api/v1/admin/ai/tasks/${task.id}/retry`, admin.token, { confirmed: true });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ runStatus: 'succeeded' });
      const children = await db.query(`SELECT id FROM ai_tasks WHERE idempotency_key = $1`, [key]);
      expect(children.rows).toHaveLength(0);
      expect((await getTask(db, existing.id))?.status).toBe('queued');
      expect((await db.query(`SELECT id FROM ai_runs WHERE task_id = $1`, [existing.id])).rows).toHaveLength(0);
    } finally {
      AGENT_HANDLERS['sales.website_launch'] = original;
    }
  });

  it.each(['context', 'type', 'run history', 'schedule'] as const)(
    'refuses retry when %s changes between preflight and claim', async (change) => {
      const task = await queuedLaunchTask({ requestedBy: null });
      const collector = (await getAgentBySlug(db, 'collector'))!;
      const gated = {
        query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => db.query<T>(sql, params),
        transaction: async <T>(callback: (tx: Queryable) => Promise<T>) => db.transaction(async (tx) => callback({
          query: async <R = Record<string, unknown>>(sql: string, params?: unknown[]) => {
            if (sql.includes("UPDATE ai_tasks SET status = 'running'")) {
              if (change === 'context') await tx.query(`UPDATE ai_tasks SET context = $2::jsonb WHERE id = $1`, [task.id, JSON.stringify({ serviceKey: 'hosting-business' })]);
              if (change === 'type') await tx.query(`UPDATE ai_tasks SET agent_id = $2, task_type = 'billing.overdue_digest' WHERE id = $1`, [task.id, collector.id]);
              if (change === 'run history') await insertRun(tx, { taskId: task.id, agentId: task.agent_id, engine: 'test', model: 'test', input: {} });
              if (change === 'schedule') await tx.query(`UPDATE ai_tasks SET run_after = now() + interval '1 hour' WHERE id = $1`, [task.id]);
            }
            return tx.query<R>(sql, params);
          },
        })),
      };
      await expect(runTask(gated, task.id, { readOnlyRetry: true, retryExpectedTask: task, retryOperatorUserId: admin.userId })).rejects.toMatchObject({ code: 'RETRY_CLAIM_UNAVAILABLE' });
      expect((await getTask(db, task.id))?.status).toBe('queued');
      expect((await db.query(`SELECT id FROM ai_tool_calls WHERE task_id = $1`, [task.id])).rows).toHaveLength(0);
      expect(fakeLookup).not.toHaveBeenCalled();
    },
  );

  it('requires an audited snapshot and rechecks the server allowlist inside the executor', async () => {
    const task = await queuedLaunchTask({ requestedBy: null });
    await expect(runTask(db, task.id, { readOnlyRetry: true })).rejects.toMatchObject({ code: 'RETRY_CLAIM_UNAVAILABLE' });
    const agent = (await getAgentBySlug(db, 'collector'))!;
    await db.query(`UPDATE ai_tasks SET agent_id = $2, task_type = 'billing.overdue_digest' WHERE id = $1`, [task.id, agent.id]);
    await expect(runTask(db, task.id, { readOnlyRetry: true, retryExpectedTask: task })).rejects.toMatchObject({ code: 'RETRY_CLAIM_UNAVAILABLE' });
    expect((await getTask(db, task.id))?.status).toBe('queued');
  });

  it('returns forbidden when the operator is demoted after route authorization and audit', async () => {
    const operator = randomUUID();
    const email = `${operator}@retry.test`;
    await db.query(`INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'hash','Retry operator','admin')`, [operator, email]);
    const token = signAuthToken(env, { sub: operator, role: 'admin', email });
    const task = await queuedLaunchTask({ requestedBy: null });
    let demoted = false;
    const intercepted = {
      query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
        const result = await db.query<T>(sql, params);
        if (sql.includes('INSERT INTO audit_logs') && params?.[2] === 'ai.task.readonly_retry' && params?.[1] === operator) {
          await db.query(`UPDATE users SET role = 'staff' WHERE id = $1`, [operator]);
          demoted = true;
        }
        return result;
      },
      transaction: db.transaction.bind(db),
    };
    const testApp = buildApp(env, { serveFrontend: false, pool: intercepted });
    try {
      const response = await testApp.inject({ method: 'POST', url: `/api/v1/admin/ai/tasks/${task.id}/retry`, headers: { authorization: `Bearer ${token}` }, payload: { confirmed: true } });
      expect(demoted).toBe(true);
      expect(response.statusCode).toBe(403);
      expect((await getTask(db, task.id))?.status).toBe('queued');
      expect((await db.query(`SELECT id FROM ai_runs WHERE task_id = $1`, [task.id])).rows).toHaveLength(0);
      expect((await db.query(`SELECT id FROM audit_logs WHERE action = 'ai.task.readonly_retry' AND resource_id = $1`, [task.id])).rows).toHaveLength(1);
    } finally { await testApp.close(); }
  });

  it('requires a currently authorized retry operator at claim, distinct from the task requester', async () => {
    const task = await queuedLaunchTask({ requestedBy: null });
    const options = { readOnlyRetry: true, retryExpectedTask: task };
    await expect(runTask(db, task.id, options)).rejects.toMatchObject({ code: 'RETRY_OPERATOR_UNAUTHORIZED' });
    await expect(runTask(db, task.id, { ...options, retryOperatorUserId: staff.userId })).rejects.toMatchObject({ code: 'RETRY_OPERATOR_UNAUTHORIZED' });
    const suspended = randomUUID();
    await db.query(`INSERT INTO users (id,email,password_hash,full_name,role,status) VALUES ($1,$2,'hash','Suspended admin','admin','suspended')`, [suspended, `${suspended}@retry.test`]);
    await expect(runTask(db, task.id, { ...options, retryOperatorUserId: suspended })).rejects.toMatchObject({ code: 'RETRY_OPERATOR_UNAUTHORIZED' });
    expect((await getTask(db, task.id))?.status).toBe('queued');
    expect((await db.query(`SELECT id FROM ai_runs WHERE task_id = $1`, [task.id])).rows).toHaveLength(0);
  });

  it('refuses a task type that is not declared read-only in server code', async () => {
    const agent = (await getAgentBySlug(db, 'customer-cloud-assistant'))!;
    const customer = randomUUID();
    await db.query(
      `INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'hash','Retry Customer','customer')`,
      [customer, `${customer}@retry.test`],
    );
    const task = await queuedLaunchTask({
      taskType: 'customer.assistant_query', agentId: agent.id,
      requestedByType: 'customer', requestedBy: customer, customerId: customer,
    });
    const result = await post(`/api/v1/admin/ai/tasks/${task.id}/retry`, admin.token, { confirmed: true });
    expect(result.statusCode).toBe(409);
    expect(result.body).toContain('not declared read-only');
    expect((await getTask(db, task.id))?.status).toBe('queued');
  });

  it('refuses any task that was already claimed or has left the queued state', async () => {
    const claimed = await queuedLaunchTask();
    await insertRun(db, { taskId: claimed.id, agentId: launchAgentId, engine: 'test', model: 'test', input: {} });
    const withRun = await post(`/api/v1/admin/ai/tasks/${claimed.id}/retry`, admin.token, { confirmed: true });
    expect(withRun.statusCode).toBe(409);
    expect(withRun.body).toContain('already been claimed');
    expect((await getTask(db, claimed.id))?.status).toBe('queued'); // refusal never dispatches

    const failed = await queuedLaunchTask();
    await db.query(`UPDATE ai_tasks SET status = 'failed' WHERE id = $1`, [failed.id]);
    const finished = await post(`/api/v1/admin/ai/tasks/${failed.id}/retry`, admin.token, { confirmed: true });
    expect(finished.statusCode).toBe(409);
    expect(finished.body).toContain('queued task');
  });

  it('re-verifies the agent grant and actor/customer scope before dispatch', async () => {
    const disabledTask = await queuedLaunchTask();
    await db.query(`UPDATE ai_agents SET enabled = false WHERE id = $1`, [launchAgentId]);
    try {
      const denied = await post(`/api/v1/admin/ai/tasks/${disabledTask.id}/retry`, admin.token, { confirmed: true });
      expect(denied.statusCode).toBe(409);
      expect(denied.body).toContain('grant unavailable');
    } finally {
      await db.query(`UPDATE ai_agents SET enabled = true WHERE id = $1`, [launchAgentId]);
    }

    const customer = randomUUID();
    await db.query(
      `INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'hash','Retry Scope','customer')`,
      [customer, `${customer}@scope.test`],
    );
    const scoped = await queuedLaunchTask({
      requestedByType: 'customer', requestedBy: customer, customerId: customer,
    });
    await db.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [customer]);
    const out = await post(`/api/v1/admin/ai/tasks/${scoped.id}/retry`, admin.token, { confirmed: true });
    expect(out.statusCode).toBe(409);
    expect(out.body).toContain('not active');
  });

  it('requires an explicit confirmation, a real task and the dedicated permission', async () => {
    const task = await queuedLaunchTask();
    expect((await post(`/api/v1/admin/ai/tasks/${task.id}/retry`, admin.token, {})).statusCode).toBe(400);
    expect((await post(`/api/v1/admin/ai/tasks/${randomUUID()}/retry`, admin.token, { confirmed: true })).statusCode).toBe(404);
  });

  it('refuses any mutating tool inside a retry run while read-only tools still execute', async () => {
    fakeLookup.mockResolvedValue(verdict());
    const task = await queuedLaunchTask();
    const run = await insertRun(db, { taskId: task.id, agentId: launchAgentId, engine: 'test', model: 'test', input: {} });
    const agent = (await getAgentBySlug(db, 'website-launch-assistant'))!;
    const handles: RunHandles = {
      task, agent, runId: run.id, stepOrder: 0, pendingApprovals: [],
      actorUserId: admin.userId, customerScopeUserId: null, readOnlyRetry: true,
    };

    const mutating = await gatedToolCall(db, handles, 'send_notification', {
      userId: randomUUID(), subject: 'retry', body: 'must never send',
    });
    expect(mutating).toMatchObject({ status: 'denied', errorCode: 'READ_ONLY_RETRY_MUTATING_TOOL' });
    const sent = await db.query(`SELECT id FROM ai_tool_calls WHERE task_id = $1 AND tool = 'send_notification'`, [task.id]);
    expect(sent.rows).toHaveLength(0); // denied before any tool record or effect

    const readOnly = await gatedToolCall(db, handles, 'lookup_launch_orderability', { serviceKey: 'hosting-wordpress' });
    expect(readOnly.status).toBe('executed');
  });

  it('exposes only the declared read-only type set', () => {
    expect([...READ_ONLY_RETRY_TASK_TYPES]).toEqual(['sales.website_launch']);
    expect(READ_ONLY_RETRY_TASK_TYPES.has('customer.assistant_query')).toBe(false);
    expect(READ_ONLY_RETRY_TASK_TYPES.has('billing.overdue_digest')).toBe(false);
  });

  it('refuses at the module level with the same rules as the route', async () => {
    const task = await queuedLaunchTask();
    expect(await readonlyRetryRefusal(db, task)).toBeNull();
    await db.query(`UPDATE ai_tasks SET run_after = now() + interval '1 hour' WHERE id = $1`, [task.id]);
    const future = (await getTask(db, task.id))!;
    expect(await readonlyRetryRefusal(db, future)).toContain('scheduled run time');
    await db.query(`UPDATE ai_tasks SET run_after = now() WHERE id = $1`, [task.id]);
  });
});
