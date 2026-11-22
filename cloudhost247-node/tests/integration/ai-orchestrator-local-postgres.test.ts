/**
 * Opt-in, disposable local PostgreSQL concurrency checks. This suite refuses TCP or any data
 * directory outside the repository's ignored .cache/local-postgres/data directory. It does not
 * read DATABASE_URL, and must never be pointed at staging or production.
 */
import path from 'node:path';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { buildApp } from '../../src/app';
import { loadEnv } from '../../src/config/env';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgClient } from '../../database/db-client';
import { getAppliedMigrations, listMigrationFiles, migrateUp, verify } from '../../database/migrate';
import type { DbClient } from '../../database/db-client';
import { beginLaunch, claimLaunchChoice, finishLaunch, latestLaunch, reconcileDelayedLaunch, stopLaunch } from '../../src/ai-os/workflows/launch-orchestrator';
import { seedAgentRegistry } from '../../src/ai-os/registry/seed';
import { getAgentBySlug } from '../../src/ai-os/repositories/registry-repo';
import { createTask, getTask, updateTaskStatus, insertRun, completeRun } from '../../src/ai-os/repositories/tasks-repo';
import { claimNextEvent, markEventProcessed, emitEvent, listEvents, insertWorkflowRun, checkpointWorkflowRun, completeWorkflowRun } from '../../src/ai-os/repositories/events-repo';
import { processPendingEvents } from '../../src/ai-os/workflows/engine';
import { listAcknowledgedIncompleteRuns, listHeldEventClaims, openAcknowledgedRunInvestigation, openHeldEventInvestigation } from '../../src/ai-os/workflows/event-investigations';
import { runTask, executeApprovedApproval } from '../../src/ai-os/runtime/executor';
import { AGENT_HANDLERS } from '../../src/ai-os/agents/handlers';
import { prepareOrchestratedTask } from '../../src/ai-os/runtime/task-orchestrator';
import { authorizeWorkflowCustomerScope } from '../../src/ai-os/workflows/customer-scope';
import { prepareWorkflowSteps } from '../../src/ai-os/workflows/workflow-contract';
import { listSuspectedInterruptedTasks, openTaskInvestigation } from '../../src/ai-os/runtime/task-reconciliation';
import { publishWhileAiActive, withConversationLock } from '../../src/ai-os/workflows/conversation-publication';
import { approvalReviewFingerprint } from '../../src/ai-os/runtime/approval-review';
import { decideAuthorizedApproval } from '../../src/ai-os/runtime/approval-decision';
import { createApproval, listDelayedApprovals } from '../../src/ai-os/repositories/approvals-repo';
import { executeToolImplementation } from '../../src/ai-os/tools/implementations';
import type { Queryable } from '../../src/db/types';

const root = path.resolve(process.cwd(), '..', '.cache/local-postgres');
const enabled = process.env.RUN_ISOLATED_AI_POSTGRES_TESTS === '1';

describe.skipIf(!enabled)('AI orchestration on disposable local PostgreSQL', () => {
  let pool: Pool;
  beforeAll(async () => {
    pool = new Pool({ host: path.join(root, 'socket'), port: 56432, user: 'ai_local_test', database: 'postgres', max: 8 });
    const check = await pool.query<{ data_dir: string; listen: string; address: string | null; db: string; username: string }>(
      `SELECT current_setting('data_directory') AS data_dir, current_setting('listen_addresses') AS listen,
              inet_server_addr()::text AS address, current_database() AS db, current_user AS username`
    );
    const server = check.rows[0];
    if (!server || server.data_dir !== path.join(root, 'data') || server.listen !== '' || server.address !== null || server.db !== 'postgres' || server.username !== 'ai_local_test') {
      throw new Error('Refusing to run: not the designated socket-only disposable test cluster');
    }
    const client = await pool.connect();
    try { await migrateUp(new PgClient(client), { isProduction: false }); }
    finally { client.release(); }
    await seedAgentRegistry(pool);
  }, 120_000);
  afterAll(async () => { await pool?.end(); });

  async function conversation() {
    const id = randomUUID();
    await pool.query(`INSERT INTO ai_support_conversations (id, access_token_hash) VALUES ($1,$2)`, [id, randomUUID()]);
    return id;
  }

  it('marks pre-existing approvals unverified when the local argument migration is applied', async () => {
    const client = await pool.connect();
    const schema = `approval_upgrade_${randomUUID().replaceAll('-', '')}`;
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      await client.query(`CREATE TABLE ai_approvals (id uuid PRIMARY KEY)`);
      const legacy = randomUUID();
      await client.query(`INSERT INTO ai_approvals (id) VALUES ($1)`, [legacy]);
      await client.query(readFileSync(path.join(process.cwd(), 'database/migrations/0114_ai_approval_argument_integrity.sql'), 'utf8'));
      const row = (await client.query<{ arguments_verified: boolean }>(`SELECT arguments_verified FROM ai_approvals WHERE id = $1`, [legacy])).rows[0];
      expect(row?.arguments_verified).toBe(false);
      await client.query(`INSERT INTO ai_approvals (id) VALUES ($1)`, [randomUUID()]);
      expect((await client.query(`SELECT id FROM ai_approvals WHERE arguments_verified = true`)).rows).toHaveLength(0);
    } finally {
      await client.query('RESET search_path');
      await client.query(`DROP SCHEMA ${schema} CASCADE`);
      client.release();
    }
  });

  it('preflights a later missing scope value before any PostgreSQL task dispatch', async () => {
    const workflowId = randomUUID();
    const eventType = `preflight.${randomUUID()}`;
    const definition = [{ agent_slug: 'collector', task_type: 'billing.overdue_digest' }, { agent_slug: 'incident-commander', task_type: 'incident.correlate', customer_from: 'missingCustomer' }];
    await pool.query(`INSERT INTO ai_workflows (id, slug, name, event_type, definition) VALUES ($1,$2,'preflight',$3,$4)`, [workflowId, `preflight-${workflowId}`, eventType, JSON.stringify(definition)]);
    const { event } = await emitEvent(pool, { eventType, source: 'admin' });
    await pool.query(`UPDATE ai_events SET occurred_at = '1000-01-01' WHERE id = $1`, [event.id]);
    let calls = 0;
    const result = await processPendingEvents(pool, async () => { calls += 1; throw new Error('unexpected'); }, 1);
    expect(result).toEqual({ processed: 0, dispatched: 1 });
    expect(calls).toBe(0);
    const run = (await pool.query<{ status: string; steps: unknown[] }>(`SELECT status, steps FROM ai_workflow_runs WHERE workflow_id = $1`, [workflowId])).rows[0];
    expect(run).toEqual({ status: 'failed', steps: [] });
    const held = (await pool.query<{ processed_at: Date | null; dispatch_claimed_at: Date | null }>(`SELECT processed_at, dispatch_claimed_at FROM ai_events WHERE id = $1`, [event.id])).rows[0];
    expect(held?.processed_at).toBeNull();
    expect(held?.dispatch_claimed_at).toBeTruthy();
  });

  it('preflights all captured workflows before any dispatch on PostgreSQL', async () => {
    const first = randomUUID(), invalid = randomUUID(), eventType = `preflight.${randomUUID()}`;
    await pool.query(`INSERT INTO ai_workflows (id, slug, name, event_type, definition) VALUES
      ($1,$2,'valid',$3,$4),($5,$6,'invalid',$3,$7)`,
      [first, `a-${first}`, eventType, JSON.stringify([{ agent_slug: 'collector', task_type: 'billing.overdue_digest' }]), invalid, `z-${invalid}`, JSON.stringify([{ agent_slug: 'incident-commander', task_type: 'incident.correlate', customer_from: 'missingCustomer' }])]);
    const { event } = await emitEvent(pool, { eventType, source: 'admin' });
    await pool.query(`UPDATE ai_events SET occurred_at = '1000-01-01' WHERE id = $1`, [event.id]);
    let calls = 0;
    expect(await processPendingEvents(pool, async () => { calls++; throw new Error('unexpected'); }, 1)).toEqual({ processed: 0, dispatched: 1 });
    expect(calls).toBe(0);
    expect((await pool.query(`SELECT id FROM ai_workflow_runs WHERE workflow_id = $1`, [first])).rows).toHaveLength(0);
    expect((await pool.query(`SELECT status, steps FROM ai_workflow_runs WHERE workflow_id = $1`, [invalid])).rows).toEqual([{ status: 'failed', steps: [] }]);
    const held = (await pool.query<{ processed_at: Date | null; dispatch_claimed_at: Date | null }>(`SELECT processed_at, dispatch_claimed_at FROM ai_events WHERE id = $1`, [event.id])).rows[0];
    expect(held?.processed_at).toBeNull();
    expect(held?.dispatch_claimed_at).toBeTruthy();
  });

  it('holds an event before dispatch if a later captured workflow lacks an agent grant on PostgreSQL', async () => {
    const first = randomUUID(), later = randomUUID(), eventType = `preflight.${randomUUID()}`;
    await pool.query(`INSERT INTO ai_workflows (id, slug, name, event_type, definition) VALUES
      ($1,$2,'valid',$3,$4),($5,$6,'ungranted',$3,$7)`,
      [first, `a-${first}`, eventType, JSON.stringify([{ agent_slug: 'collector', task_type: 'billing.overdue_digest' }]), later, `z-${later}`, JSON.stringify([{ agent_slug: 'incident-commander', task_type: 'ungranted.task' }])]);
    const { event } = await emitEvent(pool, { eventType, source: 'admin' });
    await pool.query(`UPDATE ai_events SET occurred_at = '1000-01-01' WHERE id = $1`, [event.id]);
    let calls = 0;
    expect(await processPendingEvents(pool, async () => { calls++; throw new Error('unexpected'); }, 1)).toEqual({ processed: 0, dispatched: 1 });
    expect(calls).toBe(0);
    expect((await pool.query(`SELECT id FROM ai_workflow_runs WHERE workflow_id = $1`, [first])).rows).toHaveLength(0);
    expect((await pool.query(`SELECT status, steps, error FROM ai_workflow_runs WHERE workflow_id = $1`, [later])).rows).toEqual([{ status: 'failed', steps: [], error: 'Agent or task grant unavailable' }]);
    const held = (await pool.query<{ processed_at: Date | null; dispatch_claimed_at: Date | null }>(`SELECT processed_at, dispatch_claimed_at FROM ai_events WHERE id = $1`, [event.id])).rows[0];
    expect(held?.processed_at).toBeNull();
    expect(held?.dispatch_claimed_at).toBeTruthy();
  });

  it('verifies persisted task evidence before a success checkpoint on PostgreSQL', async () => {
    for (const mode of ['success', 'unpersisted', 'approval'] as const) {
      const workflowId = randomUUID();
      const eventType = `phase6.${randomUUID()}`;
      await pool.query(`INSERT INTO ai_workflows (id, slug, name, event_type, definition) VALUES ($1,$2,'phase6',$3,$4)`,
        [workflowId, `phase6-${workflowId}`, eventType, JSON.stringify([{ agent_slug: 'collector', task_type: 'billing.overdue_digest' }])]);
      const { event } = await emitEvent(pool, { eventType, source: 'admin' });
      await pool.query(`UPDATE ai_events SET occurred_at = '1000-01-01' WHERE id = $1`, [event.id]);
      const result = await processPendingEvents(pool, async (db, taskId) => {
        const task = (await getTask(db, taskId))!;
        if (mode !== 'unpersisted') await updateTaskStatus(db, taskId, 'succeeded');
        if (mode === 'approval') await createApproval(db, { agentId: task.agent_id, taskId, runId: null, tool: 'test', action: 'test', reason: 'test', evidence: [], riskLevel: 'high', arguments: {} });
        return { task: { ...task, status: 'succeeded' }, runStatus: 'succeeded', pendingApprovals: [] };
      }, 1);
      expect(result.processed).toBe(mode === 'success' ? 1 : 0);
      const run = (await pool.query<{ status: string; steps: Array<{ status: string }> }>(`SELECT status, steps FROM ai_workflow_runs WHERE workflow_id = $1`, [workflowId])).rows[0];
      expect(run?.steps[0]?.status).toBe(mode === 'success' ? 'succeeded' : 'outcome_unknown');
      const saved = (await pool.query<{ processed_at: Date | null; dispatch_claimed_at: Date | null }>(`SELECT processed_at, dispatch_claimed_at FROM ai_events WHERE id = $1`, [event.id])).rows[0];
      if (mode === 'success') expect(saved?.processed_at).toBeTruthy();
      else { expect(saved?.processed_at).toBeNull(); expect(saved?.dispatch_claimed_at).toBeTruthy(); }
    }
  });

  it('rolls back historical 0048 data and bookkeeping together after an injected failure', async () => {
    const conn = await pool.connect();
    const schema = `migration_test_${randomUUID().replaceAll('-', '')}`;
    const dir = mkdtempSync(path.join(root, 'migration-case-'));
    const filename = '0048_operating_system_logo_assets.sql';
    try {
      writeFileSync(path.join(dir, filename), readFileSync(path.join(process.cwd(), 'database/migrations', filename)));
      await conn.query(`CREATE SCHEMA ${schema}`);
      await conn.query(`SET search_path TO ${schema}`);
      await conn.query(`CREATE TABLE operating_systems (slug text PRIMARY KEY, logo_url text, updated_at timestamptz)`);
      await conn.query(`INSERT INTO operating_systems (slug) VALUES ('alpine-linux')`);
      const real = new PgClient(conn);
      const injected: DbClient = {
        exec: (sql) => real.exec(sql),
        query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
          if (sql.startsWith('INSERT INTO schema_migrations')) throw new Error('injected bookkeeping failure');
          return real.query<T>(sql, params);
        },
      };
      await expect(migrateUp(injected, { isProduction: false }, dir)).rejects.toThrow('injected bookkeeping failure');
      const afterFailure = await conn.query<{ logo_url: string | null }>(`SELECT logo_url FROM operating_systems WHERE slug = 'alpine-linux'`);
      expect(afterFailure.rows[0]?.logo_url).toBeNull();
      expect(await getAppliedMigrations(real)).toEqual([]);
      expect((await migrateUp(real, { isProduction: false }, dir)).applied).toEqual([filename]);
      expect((await conn.query<{ logo_url: string }>(`SELECT logo_url FROM operating_systems WHERE slug = 'alpine-linux'`)).rows[0]?.logo_url).toBe('/os-logos/alpine.svg');
      expect((await getAppliedMigrations(real))[0]?.checksum).toBe(listMigrationFiles(dir)[0]?.checksum);
      expect((await verify(real, dir)).ok).toBe(true);
      expect((await migrateUp(real, { isProduction: false }, dir)).applied).toEqual([]);
    } finally {
      await conn.query('RESET search_path');
      conn.release();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('quarantines legacy unprocessed events with runs during a real PostgreSQL upgrade', async () => {
    const conn = await pool.connect();
    const schema = `claim_upgrade_${randomUUID().replaceAll('-', '')}`;
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    let transactionOpen = false;
    try {
      await conn.query(`CREATE SCHEMA ${schema}`);
      await conn.query(`SET search_path TO ${schema}`);
      await conn.query(`CREATE TABLE ai_events (id uuid PRIMARY KEY, processed_at timestamptz, occurred_at timestamptz NOT NULL DEFAULT now())`);
      await conn.query(`CREATE TABLE ai_workflow_runs (event_id uuid, started_at timestamptz NOT NULL DEFAULT now())`);
      await conn.query(`INSERT INTO ai_events (id, processed_at) VALUES ($1,NULL),($2,NULL),($3,now())`, ids);
      await conn.query(`INSERT INTO ai_workflow_runs (event_id) VALUES ($1),($2)`, [ids[0], ids[2]]);
      await conn.query('BEGIN');
      transactionOpen = true;
      await conn.query(readFileSync(path.join(process.cwd(), 'database/migrations/0110_ai_event_dispatch_claim.sql'), 'utf8'));
      await conn.query('COMMIT');
      transactionOpen = false;
      const { rows } = await conn.query<{ id: string; claimed: boolean }>(`SELECT id, dispatch_claim_token IS NOT NULL AS claimed FROM ai_events`);
      const claimed = new Map(rows.map((row) => [row.id, row.claimed]));
      expect(claimed.get(ids[0]!)).toBe(true);
      expect(claimed.get(ids[1]!)).toBe(false);
      expect(claimed.get(ids[2]!)).toBe(false);
    } finally {
      if (transactionOpen) await conn.query('ROLLBACK').catch(() => undefined);
      await conn.query('RESET search_path');
      await conn.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      conn.release();
    }
  });

  it('serializes concurrent starts and choice claims on separate pool connections', async () => {
    const id = await conversation();
    const starts = await Promise.all(Array.from({ length: 6 }, () => beginLaunch(pool, id, null)));
    expect(new Set(starts.map((w) => w.id)).size).toBe(1);
    const claims = await Promise.all([
      claimLaunchChoice(pool, id, 'hosting-wordpress', null),
      claimLaunchChoice(pool, id, 'hosting-business', null),
      claimLaunchChoice(pool, id, 'hosting-web-hosting', null),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect((await latestLaunch(pool, id))?.status).toBe('checking');
    const audit = await pool.query<{ n: number }>(`SELECT count(*)::int n FROM ai_audit_logs WHERE action = 'ai.launch.transition' AND arguments->>'workflowId' = $1`, [starts[0]!.id]);
    expect(audit.rows[0]?.n).toBe(2);
  });

  it('holds the workflow row through publication and commits transition, audit and message together', async () => {
    const id = await conversation();
    const workflow = await beginLaunch(pool, id, null);
    await claimLaunchChoice(pool, id, 'hosting-wordpress', null);
    let entered!: () => void;
    let release!: () => void;
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    const releasePromise = new Promise<void>((resolve) => { release = resolve; });
    const messageId = randomUUID();
    const completion = finishLaunch(pool, workflow.id, id, 'options_ready', null, async (tx) => {
      await tx.query(`INSERT INTO ai_support_messages (id, conversation_id, author_type, body) VALUES ($1,$2,'AI','verified locally')`, [messageId, id]);
      entered();
      await releasePromise;
      return messageId;
    });
    try {
      await enteredPromise;
      const other = await pool.connect();
      try {
        await other.query(`SET lock_timeout = '150ms'`);
        await expect(other.query(`UPDATE ai_launch_workflows SET status = 'cancelled' WHERE id = $1`, [workflow.id])).rejects.toMatchObject({ code: '55P03' });
      } finally { await other.query('RESET lock_timeout'); other.release(); }
    } finally { release(); }
    const finished = await completion;
    expect(finished?.response).toBe(messageId);
    expect(await stopLaunch(pool, id, 'cancelled', null)).toBeNull();
    expect((await latestLaunch(pool, id))?.status).toBe('options_ready');
    expect((await pool.query(`SELECT id FROM ai_support_messages WHERE id = $1`, [messageId])).rows).toHaveLength(1);
    expect((await pool.query(`SELECT id FROM ai_audit_logs WHERE action = 'ai.launch.transition' AND arguments->>'workflowId' = $1 AND result->>'status' = 'options_ready'`, [workflow.id])).rows).toHaveLength(1);
  });

  it('rolls back a publication failure and never publishes after a committed stop', async () => {
    const id = await conversation();
    const workflow = await beginLaunch(pool, id, null);
    await claimLaunchChoice(pool, id, 'hosting-business', null);
    const messageId = randomUUID();
    await expect(finishLaunch(pool, workflow.id, id, 'options_ready', null, async (tx) => {
      await tx.query(`INSERT INTO ai_support_messages (id, conversation_id, author_type, body) VALUES ($1,$2,'AI','rolled back')`, [messageId, id]);
      throw new Error('simulated failure');
    })).rejects.toThrow('simulated failure');
    expect((await latestLaunch(pool, id))?.status).toBe('checking');
    expect((await pool.query(`SELECT id FROM ai_support_messages WHERE id = $1`, [messageId])).rows).toHaveLength(0);
    await stopLaunch(pool, id, 'cancelled', null);
    let called = false;
    expect(await finishLaunch(pool, workflow.id, id, 'options_ready', null, async () => { called = true; })).toBeNull();
    expect(called).toBe(false);
  });

  it('scopes domain and certificate expiry lookups to the customer on PostgreSQL', async () => {
    const alice = randomUUID(); const bob = randomUUID();
    await pool.query(`INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'hash','Alice','customer'), ($3,$4,'hash','Bob','customer')`, [alice, `${alice}@example.test`, bob, `${bob}@example.test`]);
    await pool.query(`INSERT INTO customer_domains (id,user_id,domain_name,status,expires_at) VALUES
      ($1,$2,'alice-phase3.example','active',CURRENT_DATE), ($3,$4,'bob-phase3.example','active',CURRENT_DATE),
      ($5,$2,'alice-unknown-phase3.example','active',NULL)`, [randomUUID(), alice, randomUUID(), bob, randomUUID()]);
    await pool.query(`INSERT INTO ssl_certificates (id,user_id,domain_name,status,expires_at) VALUES
      ($1,$2,'alice-cert-phase3.example','ISSUED',now()), ($3,$4,'bob-cert-phase3.example','ISSUED',now()),
      ($5,$2,'alice-failed-phase3.example','FAILED',NULL)`, [randomUUID(), alice, randomUUID(), bob, randomUUID()]);
    for (const tool of ['list_expiring_domains', 'list_expiring_ssl']) {
      const result = await executeToolImplementation({ db: pool, customerScopeUserId: alice }, tool, { userId: bob, days: 90 });
      expect(result.ok).toBe(true);
      const text = JSON.stringify(result);
      expect(text).toContain(tool === 'list_expiring_domains' ? 'alice-phase3.example' : 'alice-cert-phase3.example');
      expect(text).not.toContain('bob-phase3.example');
      expect(text).not.toContain('bob-cert-phase3.example');
      expect(text).not.toContain('alice-unknown-phase3.example');
      expect(text).not.toContain('alice-failed-phase3.example');
    }
  });

  it('limits customer activity to own assistant task metadata on PostgreSQL', async () => {
    const alice = randomUUID(); const bob = randomUUID();
    await pool.query(`INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'hash','Alice','customer'), ($3,$4,'hash','Bob','customer')`, [alice, `${alice}@example.test`, bob, `${bob}@example.test`]);
    const assistant = (await getAgentBySlug(pool, 'customer-cloud-assistant'))!;
    const collector = (await getAgentBySlug(pool, 'collector'))!;
    const own = (await createTask(pool, { agentId: assistant.id, taskType: 'customer.assistant_query', requestedByType: 'customer', requestedBy: alice, customerId: alice })).task;
    const mismatch = (await createTask(pool, { agentId: assistant.id, taskType: 'customer.assistant_query', requestedByType: 'customer', requestedBy: bob, customerId: alice })).task;
    const internal = (await createTask(pool, { agentId: collector.id, taskType: 'billing.overdue_digest', requestedByType: 'system', customerId: alice })).task;
    await pool.query(`UPDATE ai_tasks SET result_summary = 'private-sentinel' WHERE id IN ($1,$2,$3)`, [own.id, mismatch.id, internal.id]);
    const result = await executeToolImplementation({ db: pool, customerScopeUserId: alice }, 'get_ai_activity', { userId: bob });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unexpected failure');
    const data = result.data as { customerId: string; tasks: Array<{ id: string }> };
    expect(data.customerId).toBe(alice);
    expect(data.tasks.map((t) => t.id)).toEqual([own.id]);
    expect(JSON.stringify(result)).not.toContain('private-sentinel');
    expect(JSON.stringify(result)).not.toContain(internal.id);
    expect(JSON.stringify(result)).not.toContain(mismatch.id);
  });

  it('lists delayed approval references without changing or recovering them on PostgreSQL', async () => {
    const agent = await getAgentBySlug(pool, 'collector');
    const make = () => createApproval(pool, { agentId: agent!.id, taskId: null, runId: null, tool: 'send_notification', action: 'test', reason: 'secret-reason', evidence: ['secret-evidence'], riskLevel: 'high', arguments: { secret: 'secret-arguments' } });
    const approved = await make();
    const executing = await make();
    const fresh = await make();
    await pool.query(`UPDATE ai_approvals SET status = CASE id WHEN $1 THEN 'approved' WHEN $2 THEN 'executing' ELSE 'approved' END,
      updated_at = CASE WHEN id = $3 THEN now() ELSE now() - interval '10 minutes' END WHERE id IN ($1,$2,$3)`, [approved.id, executing.id, fresh.id]);
    const rows = await listDelayedApprovals(pool, 200);
    expect(rows.find((r) => r.id === approved.id)?.status).toBe('approved');
    expect(rows.find((r) => r.id === executing.id)?.status).toBe('executing');
    expect(rows.some((r) => r.id === fresh.id)).toBe(false);
    expect(JSON.stringify(rows)).not.toContain('secret-');
    expect((await pool.query<{ status: string }>(`SELECT status FROM ai_approvals WHERE id = $1`, [executing.id])).rows[0]?.status).toBe('executing');
    await pool.query(`UPDATE ai_approvals SET status = 'failed' WHERE id IN ($1,$2,$3)`, [approved.id, executing.id, fresh.id]);
    expect((await listDelayedApprovals(pool, 200)).some((r) => r.id === approved.id || r.id === executing.id)).toBe(false);
  });

  it('denies investigation writes when operator revocation wins the PostgreSQL row lock', async () => {
    const operator = randomUUID(), heldId = randomUUID(), eventId = randomUUID(), runId = randomUUID(), workflowId = randomUUID();
    await pool.query(`INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'hash','Local admin','admin')`, [operator, `${operator}@example.test`]);
    await pool.query(`INSERT INTO ai_workflows (id,slug,name,event_type,definition) VALUES ($1,$2,'test','test.auth','[]')`, [workflowId, `auth-${workflowId}`]);
    await pool.query(`INSERT INTO ai_events (id,event_type,source,dispatch_claim_token,dispatch_claimed_at) VALUES ($1,'test.auth','admin',$2,now() - interval '6 minutes')`, [heldId, randomUUID()]);
    await pool.query(`INSERT INTO ai_events (id,event_type,source,processed_at) VALUES ($1,'test.auth','admin','2025-01-01T00:00:00.123456Z')`, [eventId]);
    await pool.query(`INSERT INTO ai_workflow_runs (id,workflow_id,event_id,status) VALUES ($1,$2,$3,'partial')`, [runId, workflowId, eventId]);
    const client = await pool.connect();
    let pending: Array<Promise<unknown>> = [];
    let committed = false;
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE users SET role = 'staff' WHERE id = $1`, [operator]);
      pending = [
        openHeldEventInvestigation(pool, heldId, operator),
        openAcknowledgedRunInvestigation(pool, runId, eventId, '2025-01-01T00:00:00.123456Z', 'partial', operator),
      ];
      // Attach handlers before the commit can unblock either request.
      const results = Promise.allSettled(pending);
      await client.query('COMMIT');
      committed = true;
      const settled = await results;
      for (const result of settled) {
        expect(result.status).toBe('rejected');
        if (result.status === 'rejected') expect(result.reason).toMatchObject({ statusCode: 403 });
      }
      expect((await pool.query(`SELECT id FROM ai_event_investigations WHERE event_id = $1`, [heldId])).rows).toHaveLength(0);
      expect((await pool.query(`SELECT id FROM ai_acknowledged_run_investigations WHERE run_id = $1`, [runId])).rows).toHaveLength(0);
      expect((await pool.query(`SELECT id FROM ai_audit_logs WHERE arguments->>'eventId' IN ($1,$2) AND action IN ('ai.event.investigation_opened','ai.workflow.acknowledged_investigation_opened')`, [heldId, eventId])).rows).toHaveLength(0);
    } finally {
      if (!committed) await client.query('ROLLBACK').catch(() => undefined);
      client.release();
      await Promise.allSettled(pending);
    }
  });

  it('rejects a stale approval review when a concurrent proposal edit wins the row lock', async () => {
    const operator = randomUUID();
    await pool.query(`INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'hash','Local admin','admin')`, [operator, `${operator}@example.test`]);
    const agent = (await getAgentBySlug(pool, 'collector'))!;
    const approval = await createApproval(pool, { agentId: agent.id, taskId: null, runId: null, argumentsVerified: true, tool: 'send_notification', action: 'test', reason: 'test', evidence: [], riskLevel: 'high', arguments: { message: 'original' } });
    const client = await pool.connect();
    let pending: ReturnType<typeof decideAuthorizedApproval> | undefined;
    let committed = false;
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE ai_approvals SET arguments = $2 WHERE id = $1`, [approval.id, JSON.stringify({ message: 'changed' })]);
      pending = decideAuthorizedApproval(pool, { id: approval.id, decision: 'approved', actorId: operator, note: null, reviewFingerprint: approvalReviewFingerprint(approval), auditContext: {} });
      void pending.catch(() => undefined); // attach before COMMIT can unblock and reject the decision
      await client.query('COMMIT');
      committed = true;
      await expect(pending).rejects.toMatchObject({ statusCode: 409 });
      expect((await pool.query<{ status: string }>(`SELECT status FROM ai_approvals WHERE id = $1`, [approval.id])).rows[0]?.status).toBe('pending');
      expect((await pool.query(`SELECT id FROM audit_logs WHERE resource_id = $1 AND action = 'ai.approval.approved'`, [approval.id])).rows).toHaveLength(0);
      expect((await pool.query(`SELECT id FROM ai_tool_calls WHERE approval_id = $1`, [approval.id])).rows).toHaveLength(0);
    } finally {
      if (!committed) await client.query('ROLLBACK').catch(() => undefined);
      client.release();
      await pending?.catch(() => undefined);
    }
  });

  it('commits exactly one of competing approval decisions with its audit on PostgreSQL', async () => {
    const operator = randomUUID();
    await pool.query(`INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'hash','Local admin','admin')`, [operator, `${operator}@example.test`]);
    const agent = await getAgentBySlug(pool, 'collector');
    const approval = await createApproval(pool, { agentId: agent!.id, taskId: null, runId: null, argumentsVerified: true, tool: 'send_notification', action: 'test', reason: 'test', evidence: [], riskLevel: 'high', arguments: {} });
    const decisions = await Promise.all(Array.from({ length: 6 }, (_, i) => decideAuthorizedApproval(pool, { id: approval.id, decision: i % 2 ? 'rejected' : 'approved', actorId: operator, note: null, reviewFingerprint: approvalReviewFingerprint(approval), auditContext: {} })));
    const winners = decisions.filter(Boolean);
    expect(winners).toHaveLength(1);
    const stored = (await pool.query<{ status: string }>(`SELECT status FROM ai_approvals WHERE id = $1`, [approval.id])).rows[0];
    expect(stored?.status).toBe(winners[0]?.status);
    const audit = (await pool.query<{ action: string }>(`SELECT action FROM audit_logs WHERE resource_type = 'ai_approval' AND resource_id = $1`, [approval.id])).rows;
    expect(audit).toEqual([{ action: `ai.approval.${stored?.status}` }]);
    const intents = (await pool.query<{ status: string; attempts: number }>(`SELECT status, attempts FROM ai_effect_outbox WHERE approval_id = $1`, [approval.id])).rows;
    expect(intents).toEqual(stored?.status === 'approved' ? [{ status: 'pending', attempts: 0 }] : []);
    expect((await pool.query(`SELECT id FROM ai_tool_calls WHERE approval_id = $1`, [approval.id])).rows).toHaveLength(0);
  });

  it('pairs concurrent approval and outbox claims on real PostgreSQL', async () => {
    const operator = randomUUID(), customer = randomUUID();
    await pool.query(`INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'hash','Admin','admin'),($3,$4,'hash','Customer','customer')`,
      [operator, `${operator}@example.test`, customer, `${customer}@example.test`]);
    const agent = (await getAgentBySlug(pool, 'collector'))!;
    const { task } = await createTask(pool, { agentId: agent.id, taskType: 'billing.overdue_digest', requestedByType: 'staff', requestedBy: operator });
    const run = await insertRun(pool, { taskId: task.id, agentId: agent.id, engine: 'deterministic', model: 'native', input: {} });
    await completeRun(pool, run.id, 'awaiting_approval');
    await updateTaskStatus(pool, task.id, 'awaiting_approval');
    const approval = await createApproval(pool, {
      agentId: agent.id, taskId: task.id, runId: run.id, argumentsVerified: true,
      tool: 'send_notification', action: 'test', reason: 'test', evidence: [], riskLevel: 'high',
      affectedCustomerId: customer, arguments: { userId: customer, type: 'AI_TEST', title: 'Outbox concurrency', message: 'Test' },
    });
    const fingerprint = approvalReviewFingerprint(approval);
    expect(await decideAuthorizedApproval(pool, { id: approval.id, decision: 'approved', actorId: operator, note: null, reviewFingerprint: fingerprint, auditContext: {} })).not.toBeNull();
    const results = await Promise.all(Array.from({ length: 5 }, () => executeApprovedApproval(pool, approval.id, operator, fingerprint)));
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect((await pool.query(`SELECT status, attempts FROM ai_effect_outbox WHERE approval_id = $1`, [approval.id])).rows).toEqual([{ status: 'succeeded', attempts: 1 }]);
    expect((await pool.query(`SELECT id FROM ai_tool_calls WHERE approval_id = $1 AND success = true`, [approval.id])).rows).toHaveLength(1);
    expect((await pool.query(`SELECT id FROM user_notifications WHERE user_id = $1 AND title = 'Outbox concurrency'`, [customer])).rows).toHaveLength(1);
  });

  it('rejects an approval decision when role revocation wins the lock race', async () => {
    const operator = randomUUID();
    await pool.query(`INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'hash','Local admin','admin')`, [operator, `${operator}@example.test`]);
    const agent = await getAgentBySlug(pool, 'collector');
    const approval = await createApproval(pool, { agentId: agent!.id, taskId: null, runId: null, argumentsVerified: true, tool: 'send_notification', action: 'test', reason: 'test', evidence: [], riskLevel: 'high', arguments: {} });
    const client = await pool.connect();
    let decision: ReturnType<typeof decideAuthorizedApproval> | undefined;
    let committed = false;
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE users SET role = 'staff' WHERE id = $1`, [operator]);
      decision = decideAuthorizedApproval(pool, { id: approval.id, decision: 'approved', actorId: operator, note: null, reviewFingerprint: approvalReviewFingerprint(approval), auditContext: {} });
      // Attach the rejection expectation immediately so a rejection that lands during COMMIT
      // cannot surface as an unhandled promise rejection.
      const rejected = expect(decision).rejects.toMatchObject({ statusCode: 403 });
      await client.query('COMMIT');
      committed = true;
      await rejected;
      expect((await pool.query<{ status: string }>(`SELECT status FROM ai_approvals WHERE id = $1`, [approval.id])).rows[0]?.status).toBe('pending');
      expect((await pool.query(`SELECT id FROM audit_logs WHERE resource_type = 'ai_approval' AND resource_id = $1`, [approval.id])).rows).toHaveLength(0);
    } finally {
      if (!committed) await client.query('ROLLBACK').catch(() => undefined);
      client.release();
      await decision?.catch(() => undefined);
    }
  });

  it('does not infer rollback after a lost approval decision COMMIT acknowledgement', async () => {
    const operator = randomUUID();
    await pool.query(`INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'hash','Local admin','admin')`, [operator, `${operator}@example.test`]);
    const agent = await getAgentBySlug(pool, 'collector');
    const approval = await createApproval(pool, { agentId: agent!.id, taskId: null, runId: null, argumentsVerified: true, tool: 'send_notification', action: 'test', reason: 'test', evidence: [], riskLevel: 'high', arguments: {} });
    const injected = {
      query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => pool.query(sql, params) as Promise<{ rows: T[] }>,
      connect: async () => {
        const client = await pool.connect();
        return { query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
          const result = await client.query(sql, params);
          if (sql === 'COMMIT') throw new Error('simulated lost commit acknowledgement');
          return result as { rows: T[] };
        }, release: () => client.release() };
      },
    };
    await expect(decideAuthorizedApproval(injected, { id: approval.id, decision: 'approved', actorId: operator, note: null, reviewFingerprint: approvalReviewFingerprint(approval), auditContext: {} })).rejects.toThrow('simulated lost commit acknowledgement');
    expect((await pool.query<{ status: string }>(`SELECT status FROM ai_approvals WHERE id = $1`, [approval.id])).rows[0]?.status).toBe('approved');
    expect((await pool.query(`SELECT id FROM audit_logs WHERE action = 'ai.approval.approved' AND resource_id = $1`, [approval.id])).rows).toHaveLength(1);
    expect((await pool.query(`SELECT status, attempts FROM ai_effect_outbox WHERE approval_id = $1`, [approval.id])).rows).toEqual([{ status: 'pending', attempts: 0 }]);
    expect((await pool.query(`SELECT id FROM ai_tool_calls WHERE approval_id = $1`, [approval.id])).rows).toHaveLength(0);
    expect(await decideAuthorizedApproval(pool, { id: approval.id, decision: 'approved', actorId: operator, note: null, reviewFingerprint: approvalReviewFingerprint(approval), auditContext: {} })).toBeNull();
  });

  it('allows one delayed reconciliation across separate connections and fences late publication', async () => {
    const id = await conversation();
    const workflow = await beginLaunch(pool, id, null);
    await claimLaunchChoice(pool, id, 'hosting-business', null);
    await pool.query(`UPDATE ai_launch_workflows SET updated_at = now() - interval '6 minutes' WHERE id = $1`, [workflow.id]);
    const operator = randomUUID();
    await pool.query(`INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'hash','Local admin','admin')`, [operator, `${operator}@example.test`]);
    const reconciliations = await Promise.all(Array.from({ length: 4 }, () => reconcileDelayedLaunch(pool, id, workflow.id, operator)));
    expect(reconciliations.filter(Boolean)).toHaveLength(1);
    expect((await latestLaunch(pool, id))?.status).toBe('needs_support');
    let published = false;
    expect(await finishLaunch(pool, workflow.id, id, 'options_ready', null, async () => { published = true; })).toBeNull();
    expect(published).toBe(false);
    const audit = await pool.query<{ n: number }>(`SELECT count(*)::int n FROM ai_audit_logs WHERE action = 'ai.launch.operator_reconciled' AND arguments->>'workflowId' = $1`, [workflow.id]);
    expect(audit.rows[0]?.n).toBe(1);
  });

  it('serializes parallel investigations, preserves the claim and binds the exact database timestamp', async () => {
    const operator = randomUUID();
    await pool.query(`INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'hash','Local admin','admin')`, [operator, `${operator}@example.test`]);
    const { event } = await emitEvent(pool, { eventType: `investigate.${randomUUID()}`, source: 'admin', payload: { private: 'do-not-list' } });
    const token = randomUUID();
    await pool.query(`UPDATE ai_events SET dispatch_claim_token = $2,
      dispatch_claimed_at = LEAST(now() - interval '6 minutes', COALESCE((SELECT MIN(dispatch_claimed_at) - interval '1 day' FROM ai_events WHERE processed_at IS NULL AND dispatch_claim_token IS NOT NULL), now() - interval '6 minutes')) WHERE id = $1`, [event.id, token]);
    const results = await Promise.all(Array.from({ length: 6 }, () => openHeldEventInvestigation(pool, event.id, operator)));
    expect(results.filter((result) => result?.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result?.investigation.id)).size).toBe(1);
    const { rows } = await pool.query<{ same_timestamp: boolean; processed_at: string | null; dispatch_claim_token: string }>(
      `SELECT i.claim_observed_at = e.dispatch_claimed_at AS same_timestamp, e.processed_at, e.dispatch_claim_token
       FROM ai_event_investigations i JOIN ai_events e ON e.id = i.event_id WHERE e.id = $1`, [event.id]);
    expect(rows[0]).toMatchObject({ same_timestamp: true, processed_at: null, dispatch_claim_token: token });
    const claims = await listHeldEventClaims(pool, 200);
    const entry = claims.find((value) => value.event_id === event.id);
    expect(entry?.investigation_id).toBe(results[0]?.investigation.id);
    expect(JSON.stringify(entry)).not.toContain(token);
    expect(JSON.stringify(entry)).not.toContain('do-not-list');
    expect((await pool.query<{ n: number }>(`SELECT count(*)::int n FROM ai_audit_logs WHERE action = 'ai.event.investigation_opened' AND arguments->>'eventId' = $1`, [event.id])).rows[0]?.n).toBe(1);
    await pool.query(`UPDATE users SET role = 'staff' WHERE id = $1`, [operator]);
    await expect(openHeldEventInvestigation(pool, event.id, operator)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('serializes investigation with event acknowledgement without cancelling a worker', async () => {
    const operator = randomUUID();
    await pool.query(`INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'hash','Local admin','admin')`, [operator, `${operator}@example.test`]);
    const { event } = await emitEvent(pool, { eventType: `ackrace.${randomUUID()}`, source: 'admin' });
    const token = randomUUID();
    await pool.query(`UPDATE ai_events SET dispatch_claim_token = $2, dispatch_claimed_at = now() - interval '6 minutes' WHERE id = $1`, [event.id, token]);
    const [investigation] = await Promise.all([
      openHeldEventInvestigation(pool, event.id, operator),
      markEventProcessed(pool, { event, token }),
    ]);
    const state = await pool.query<{ processed_at: string | null; dispatch_claim_token: string | null }>(`SELECT processed_at, dispatch_claim_token FROM ai_events WHERE id = $1`, [event.id]);
    expect(state.rows[0]?.processed_at).toBeTruthy();
    expect(state.rows[0]?.dispatch_claim_token).toBeNull();
    const records = await pool.query(`SELECT id FROM ai_event_investigations WHERE event_id = $1`, [event.id]);
    expect(records.rows).toHaveLength(investigation ? 1 : 0);
    expect((await listHeldEventClaims(pool, 200)).some((item) => item.event_id === event.id)).toBe(false);
  });

  it('serializes acknowledged-run investigation and binds the exact event acknowledgement', async () => {
    const operator = randomUUID(), workflowId = randomUUID(), eventId = randomUUID(), runId = randomUUID();
    const secret = `ack-private-${randomUUID()}`;
    await pool.query(`INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'hash','Local admin','admin')`, [operator, `${operator}@example.test`]);
    await pool.query(`INSERT INTO ai_workflows (id,slug,name,event_type,definition) VALUES ($1,$2,'test','test.ack','[]')`, [workflowId, `ack-${workflowId}`]);
    await pool.query(`INSERT INTO ai_events (id,event_type,source,payload,processed_at) VALUES ($1,'test.ack','admin',$2,'2025-01-01T00:00:00.123456Z')`, [eventId, JSON.stringify({ secret })]);
    await pool.query(`INSERT INTO ai_workflow_runs (id,workflow_id,event_id,status,steps,error) VALUES ($1,$2,$3,'running',$4,$5)`, [runId, workflowId, eventId, JSON.stringify([{ secret }]), secret]);
    const key = '2025-01-01T00:00:00.123456Z';
    const attempts = await Promise.all(Array.from({ length: 6 }, () => openAcknowledgedRunInvestigation(pool, runId, eventId, key, 'running', operator)));
    expect(attempts.filter((r) => r?.created)).toHaveLength(1);
    expect(new Set(attempts.map((r) => r?.investigation.id)).size).toBe(1);
    expect((await pool.query<{ equal: boolean }>(`SELECT i.acknowledged_at = e.processed_at AS equal FROM ai_acknowledged_run_investigations i JOIN ai_events e ON e.id = i.event_id WHERE i.run_id = $1`, [runId])).rows[0]?.equal).toBe(true);
    expect((await pool.query<{ n: number }>(`SELECT count(*)::int n FROM ai_audit_logs WHERE action = 'ai.workflow.acknowledged_investigation_opened' AND arguments->>'runId' = $1`, [runId])).rows[0]?.n).toBe(1);
    expect(JSON.stringify(attempts)).not.toContain(secret);
    await expect(pool.query(`DELETE FROM ai_events WHERE id = $1`, [eventId])).rejects.toMatchObject({ code: '23001' });
    await expect(pool.query(`DELETE FROM ai_workflow_runs WHERE id = $1`, [runId])).rejects.toMatchObject({ code: '23001' });
    const visible = (await listAcknowledgedIncompleteRuns(pool, 200)).find((r) => r.run_id === runId);
    expect(visible?.investigation_id).toBe(attempts[0]?.investigation.id);
    await pool.query(`UPDATE ai_workflow_runs SET status = 'partial' WHERE id = $1`, [runId]);
    expect(await openAcknowledgedRunInvestigation(pool, runId, eventId, key, 'running', operator)).toBeNull();
    expect((await openAcknowledgedRunInvestigation(pool, runId, eventId, key, 'partial', operator))?.created).toBe(false);
    await pool.query(`UPDATE ai_events SET processed_at = '2025-01-01T00:00:00.123457Z' WHERE id = $1`, [eventId]);
    expect(await openAcknowledgedRunInvestigation(pool, runId, eventId, key, 'partial', operator)).toBeNull();
    expect((await listAcknowledgedIncompleteRuns(pool, 200)).find((r) => r.run_id === runId)?.investigation_id).toBeNull();
    await pool.query(`UPDATE users SET role = 'staff' WHERE id = $1`, [operator]);
    await expect(openAcknowledgedRunInvestigation(pool, runId, eventId, '2025-01-01T00:00:00.123457Z', 'partial', operator)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('rejects a confirmed run investigation if completion wins the row-lock race', async () => {
    const operator = randomUUID(), workflowId = randomUUID(), eventId = randomUUID(), runId = randomUUID();
    await pool.query(`INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'hash','Local admin','admin')`, [operator, `${operator}@example.test`]);
    await pool.query(`INSERT INTO ai_workflows (id,slug,name,event_type,definition) VALUES ($1,$2,'test','test.race','[]')`, [workflowId, `race-${workflowId}`]);
    await pool.query(`INSERT INTO ai_events (id,event_type,source,processed_at) VALUES ($1,'test.race','admin','2025-01-01T00:00:00.123456Z')`, [eventId]);
    await pool.query(`INSERT INTO ai_workflow_runs (id,workflow_id,event_id,status) VALUES ($1,$2,$3,'running')`, [runId, workflowId, eventId]);
    const client = await pool.connect();
    let pending: ReturnType<typeof openAcknowledgedRunInvestigation> | undefined;
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE ai_workflow_runs SET status = 'succeeded' WHERE id = $1`, [runId]);
      pending = openAcknowledgedRunInvestigation(pool, runId, eventId, '2025-01-01T00:00:00.123456Z', 'running', operator);
      await client.query('COMMIT');
      expect(await pending).toBeNull();
      expect((await pool.query(`SELECT id FROM ai_acknowledged_run_investigations WHERE run_id = $1`, [runId])).rows).toHaveLength(0);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
      await pending?.catch(() => undefined);
    }
  });

  it('shows acknowledged incomplete runs with minimal fields on real PostgreSQL', async () => {
    const eventType = `history.${randomUUID()}`;
    const workflowId = randomUUID();
    const secret = `history-private-${randomUUID()}`;
    await pool.query(`INSERT INTO ai_workflows (id,slug,name,event_type,definition) VALUES ($1,$2,'history',$3,'[]')`, [workflowId, `history-${workflowId}`, eventType]);
    const { event } = await emitEvent(pool, { eventType, source: 'admin', payload: { secret } });
    await pool.query(`UPDATE ai_events SET occurred_at = '1000-01-01' WHERE id = $1`, [event.id]);
    const claim = await claimNextEvent(pool);
    expect(claim?.event.id).toBe(event.id);
    const run = await insertWorkflowRun(pool, workflowId, claim!);
    await completeWorkflowRun(pool, run.id, claim!, 'partial', [{ secret }], secret);
    expect((await listAcknowledgedIncompleteRuns(pool, 200)).some((r) => r.run_id === run.id)).toBe(false);
    await markEventProcessed(pool, claim!);
    const history = await listAcknowledgedIncompleteRuns(pool, 200);
    expect(history.find((r) => r.run_id === run.id)).toMatchObject({ event_id: event.id, status: 'partial' });
    expect(JSON.stringify(history)).not.toContain(secret);
    expect(JSON.stringify(history)).not.toContain(claim!.token);
    const index = await pool.query(`SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'ai_workflow_runs_incomplete_recent_idx'`);
    expect(index.rows).toHaveLength(1);
  });

  it('claims an event once across connections and fences wrong-owner acknowledgements and checkpoints', async () => {
    const eventType = `claim.${randomUUID()}`;
    const { event } = await emitEvent(pool, { eventType, source: 'admin' });
    await pool.query(`UPDATE ai_events SET occurred_at = '1000-01-01' WHERE id = $1`, [event.id]);
    const attempts = await Promise.all(Array.from({ length: 6 }, () => claimNextEvent(pool)));
    const winners = attempts.filter((value) => value?.event.id === event.id);
    expect(winners).toHaveLength(1);
    const claim = winners[0]!;
    const workflowId = randomUUID();
    await pool.query(`INSERT INTO ai_workflows (id, slug, name, event_type, definition) VALUES ($1,$2,'test',$3,'[]')`, [workflowId, `claim-${workflowId}`, eventType]);
    const run = await insertWorkflowRun(pool, workflowId, claim);
    const wrongClaim = { ...claim, token: randomUUID() };
    await expect(markEventProcessed(pool, wrongClaim)).rejects.toThrow('Event claim unavailable');
    await expect(checkpointWorkflowRun(pool, run.id, wrongClaim, [])).rejects.toThrow('Workflow checkpoint unavailable');
    await expect(completeWorkflowRun(pool, run.id, wrongClaim, 'succeeded', [], null)).rejects.toThrow('Workflow completion unavailable');
    const listed = (await listEvents(pool, { eventType })).find((item) => item.id === event.id);
    expect(listed).toBeDefined();
    expect(JSON.stringify(listed)).not.toContain(claim.token);
    await checkpointWorkflowRun(pool, run.id, claim, [{ status: 'dispatching' }]);
    await completeWorkflowRun(pool, run.id, claim, 'partial', [], 'test');
    await markEventProcessed(pool, claim);
    expect((await pool.query<{ processed_at: string | null }>(`SELECT processed_at FROM ai_events WHERE id = $1`, [event.id])).rows[0]?.processed_at).toBeTruthy();
    expect(attempts.filter((value) => value && value.event.id !== event.id)).toHaveLength(0);
  });

  it.each(['checkpoint', 'commit-acknowledgement'] as const)('retains claim on %s failure around transactional preparation', async (failure) => {
    const eventType = `prepare.${randomUUID()}`;
    const workflowId = randomUUID();
    const slug = `prepare-${workflowId}`;
    await pool.query(`INSERT INTO ai_workflows (id, slug, name, event_type, definition) VALUES ($1,$2,'test',$3,$4)`,
      [workflowId, slug, eventType, JSON.stringify([{ agent_slug: 'collector', task_type: 'billing.overdue_digest' }])]);
    const { event } = await emitEvent(pool, { eventType, source: 'admin' });
    await pool.query(`UPDATE ai_events SET occurred_at = '1000-01-01' WHERE id = $1`, [event.id]);
    const injected = {
      query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => pool.query(sql, params) as Promise<{ rows: T[] }>,
      connect: async () => {
        const client = await pool.connect();
        return {
          query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
            if (failure === 'checkpoint' && sql.includes('UPDATE ai_workflow_runs SET steps =')) throw new Error('injected checkpoint failure');
            const result = await client.query(sql, params);
            if (failure === 'commit-acknowledgement' && sql === 'COMMIT') throw new Error('simulated lost commit acknowledgement');
            return result as { rows: T[] };
          },
          release: () => client.release(),
        };
      },
    } satisfies Queryable;
    let calls = 0;
    expect(await processPendingEvents(injected, async () => { calls += 1; throw new Error('must not dispatch'); }, 1)).toEqual({ processed: 0, dispatched: 0 });
    const taskRows = await pool.query<{ id: string }>(`SELECT id FROM ai_tasks WHERE idempotency_key = $1`, [`wf:${slug}:${event.id}:collector`]);
    const run = (await pool.query<{ status: string; steps: Array<{ taskId: string; status: string }> }>(`SELECT status, steps FROM ai_workflow_runs WHERE workflow_id = $1`, [workflowId])).rows[0];
    expect(run?.status).toBe('running');
    if (failure === 'checkpoint') {
      expect(taskRows.rows).toHaveLength(0);
      expect(run?.steps).toEqual([]);
    } else {
      expect(taskRows.rows).toHaveLength(1);
      expect(run?.steps[0]).toMatchObject({ taskId: taskRows.rows[0]?.id, status: 'dispatching' });
    }
    const saved = (await pool.query<{ processed_at: string | null; dispatch_claimed_at: string | null }>(`SELECT processed_at, dispatch_claimed_at FROM ai_events WHERE id = $1`, [event.id])).rows[0];
    expect(saved?.processed_at).toBeNull();
    expect(saved?.dispatch_claimed_at).toBeTruthy();
    await processPendingEvents(pool, async () => { calls += 1; throw new Error('must not replay'); }, 1);
    expect(calls).toBe(0);
  });

  it('rolls back task preparation if a worker is killed before its checkpoint commits', async () => {
    const eventType = `prepare-crash.${randomUUID()}`;
    const workflowId = randomUUID();
    const slug = `prepare-crash-${workflowId}`;
    await pool.query(`INSERT INTO ai_workflows (id, slug, name, event_type, definition) VALUES ($1,$2,'test',$3,$4)`,
      [workflowId, slug, eventType, JSON.stringify([{ agent_slug: 'collector', task_type: 'billing.overdue_digest' }])]);
    const { event } = await emitEvent(pool, { eventType, source: 'admin' });
    await pool.query(`UPDATE ai_events SET occurred_at = '1000-01-01' WHERE id = $1`, [event.id]);
    const script = `
      const {Pool} = require('pg');
      const {processPendingEvents} = require('./src/ai-os/workflows/engine.ts');
      const pool = new Pool({host: ${JSON.stringify(path.join(root, 'socket'))}, port: 56432, user: 'ai_local_test', database: 'postgres'});
      const injected = { query: (sql, args) => pool.query(sql, args), connect: async () => {
        const client = await pool.connect();
        return { query: async (sql, args) => {
          if (sql.includes('UPDATE ai_workflow_runs SET steps =')) { console.log('checkpoint'); await new Promise(() => {}); }
          return client.query(sql, args);
        }, release: () => client.release() };
      }};
      processPendingEvents(injected, async () => { throw new Error('must not dispatch'); }, 1)
        .catch((error) => { console.error(error); process.exit(1); });
    `;
    const child = spawn(process.execPath, ['--require', 'tsx/cjs', '-e', script], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
    const lines = createInterface({ input: child.stdout });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const firstLine = await Promise.race([
        once(lines, 'line').then(([line]) => String(line)),
        once(child, 'exit').then(() => { throw new Error('worker exited before checkpoint'); }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('worker timed out')), 10_000); }),
      ]);
      expect(firstLine).toBe('checkpoint');
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
      // Acquiring the event row lock also waits for the disconnected worker's transaction rollback.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT id FROM ai_events WHERE id = $1 FOR UPDATE`, [event.id]);
        expect((await client.query(`SELECT id FROM ai_tasks WHERE idempotency_key = $1`, [`wf:${slug}:${event.id}:collector`])).rows).toHaveLength(0);
        const run = (await client.query<{ status: string; steps: unknown[] }>(`SELECT status, steps FROM ai_workflow_runs WHERE workflow_id = $1`, [workflowId])).rows[0];
        expect(run).toMatchObject({ status: 'running', steps: [] });
        await client.query('COMMIT');
      } finally { client.release(); }
      const saved = (await pool.query<{ processed_at: string | null; dispatch_claimed_at: string | null }>(`SELECT processed_at, dispatch_claimed_at FROM ai_events WHERE id = $1`, [event.id])).rows[0];
      expect(saved?.processed_at).toBeNull();
      expect(saved?.dispatch_claimed_at).toBeTruthy();
      let calls = 0;
      await processPendingEvents(pool, async () => { calls += 1; throw new Error('must not replay'); }, 1);
      expect(calls).toBe(0);
    } finally {
      if (timer) clearTimeout(timer);
      lines.close();
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  }, 20_000);

  it('retains a dispatch checkpoint after a worker is killed in flight and does not replay it', async () => {
    const eventType = `crash.${randomUUID()}`;
    const workflowId = randomUUID();
    await pool.query(`INSERT INTO ai_workflows (id, slug, name, event_type, definition) VALUES ($1,$2,'test',$3,$4)`,
      [workflowId, `crash-${workflowId}`, eventType, JSON.stringify([{ agent_slug: 'collector', task_type: 'billing.overdue_digest' }])]);
    const { event } = await emitEvent(pool, { eventType, source: 'admin' });
    await pool.query(`UPDATE ai_events SET occurred_at = '1000-01-01' WHERE id = $1`, [event.id]);
    const script = `
      const {Pool} = require('pg');
      const {processPendingEvents} = require('./src/ai-os/workflows/engine.ts');
      const pool = new Pool({host: ${JSON.stringify(path.join(root, 'socket'))}, port: 56432, user: 'ai_local_test', database: 'postgres'});
      processPendingEvents(pool, async (_db, taskId) => { console.log(taskId); await new Promise(() => {}); }, 1)
        .catch((error) => { console.error(error); process.exit(1); });
    `;
    const child = spawn(process.execPath, ['--require', 'tsx/cjs', '-e', script], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
    const lines = createInterface({ input: child.stdout });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const firstLine = await Promise.race([
        once(lines, 'line').then(([line]) => String(line)),
        once(child, 'exit').then(() => { throw new Error('claim worker exited before claiming'); }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('claim worker timed out')), 10_000); }),
      ]);
      expect(firstLine).toMatch(/^[0-9a-f-]{36}$/);
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
      const saved = await pool.query<{ processed_at: string | null; dispatch_claimed_at: string | null }>(
        `SELECT processed_at, dispatch_claimed_at FROM ai_events WHERE id = $1`, [event.id]);
      expect(saved.rows[0]?.processed_at).toBeNull();
      expect(saved.rows[0]?.dispatch_claimed_at).toBeTruthy();
      const runs = await pool.query<{ status: string; steps: Array<{ status: string; taskId: string }> }>(
        `SELECT status, steps FROM ai_workflow_runs WHERE workflow_id = $1 AND event_id = $2`, [workflowId, event.id]);
      expect(runs.rows).toHaveLength(1);
      expect(runs.rows[0]?.status).toBe('running');
      expect(runs.rows[0]?.steps[0]).toMatchObject({ status: 'dispatching', taskId: firstLine });
      let calls = 0;
      await processPendingEvents(pool, async () => { calls += 1; throw new Error('must not replay'); }, 1);
      expect(calls).toBe(0);
      expect((await pool.query<{ processed_at: string | null }>(`SELECT processed_at FROM ai_events WHERE id = $1`, [event.id])).rows[0]?.processed_at).toBeNull();
    } finally {
      if (timer) clearTimeout(timer);
      lines.close();
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  }, 20_000);

  it.each(['failed', 'cancelled', 'awaiting_approval'] as const)('retains a %s event and does not dispatch later workflows across sweeps', async (status) => {
    const eventType = `incomplete.${randomUUID()}`;
    const firstId = randomUUID();
    const laterId = randomUUID();
    await pool.query(`INSERT INTO ai_workflows (id, slug, name, event_type, definition) VALUES
      ($1,$2,'first',$3,$4), ($5,$6,'later',$3,$4)`,
      [firstId, `a-${firstId}`, eventType, JSON.stringify([{ agent_slug: 'collector', task_type: 'billing.overdue_digest' }]), laterId, `z-${laterId}`]);
    const { event } = await emitEvent(pool, { eventType, source: 'admin' });
    await pool.query(`UPDATE ai_events SET occurred_at = '1000-01-01' WHERE id = $1`, [event.id]);
    let calls = 0;
    let taskId = '';
    const result = await processPendingEvents(pool, async (db, id) => {
      calls += 1;
      taskId = id;
      await updateTaskStatus(db, id, status);
      const task = await getTask(db, id);
      if (!task) throw new Error('missing test task');
      return { task, runStatus: status, pendingApprovals: status === 'awaiting_approval' ? ['test-approval'] : [] };
    }, 1);
    expect(result).toEqual({ processed: 0, dispatched: 1 });
    const run = (await pool.query<{ status: string; steps: unknown[] }>(`SELECT status, steps FROM ai_workflow_runs WHERE workflow_id = $1`, [firstId])).rows[0];
    expect(run?.steps).toMatchObject([{ status, taskId }]);
    expect((await pool.query(`SELECT id FROM ai_workflow_runs WHERE workflow_id = $1`, [laterId])).rows).toHaveLength(0);
    await updateTaskStatus(pool, taskId, 'succeeded');
    await Promise.all(Array.from({ length: 3 }, () => processPendingEvents(pool, async () => { calls += 1; throw new Error('must not replay'); }, 1)));
    expect(calls).toBe(1);
    const held = (await pool.query<{ processed_at: string | null; dispatch_claimed_at: Date | null }>(`SELECT processed_at, dispatch_claimed_at FROM ai_events WHERE id = $1`, [event.id])).rows[0];
    expect(held?.processed_at).toBeNull();
    expect(held?.dispatch_claimed_at).toBeTruthy();
    expect((await pool.query(`SELECT id FROM ai_workflow_runs WHERE workflow_id = $1`, [laterId])).rows).toHaveLength(0);
  });

  it('keeps an uncertain returned outcome claimed, blocks later workflows and makes it investigable', async () => {
    const eventType = `uncertain.${randomUUID()}`;
    const workflowId = randomUUID();
    const laterId = randomUUID();
    await pool.query(`INSERT INTO ai_workflows (id, slug, name, event_type, definition) VALUES
      ($1,$2,'first',$3,$4), ($5,$6,'later',$3,$4)`,
      [workflowId, `a-${workflowId}`, eventType, JSON.stringify([{ agent_slug: 'collector', task_type: 'billing.overdue_digest' }]), laterId, `z-${laterId}`]);
    const { event } = await emitEvent(pool, { eventType, source: 'admin' });
    await pool.query(`UPDATE ai_events SET occurred_at = '1000-01-01' WHERE id = $1`, [event.id]);
    let calls = 0;
    const result = await processPendingEvents(pool, async () => { calls += 1; throw new Error('private provider response'); }, 1);
    expect(result).toEqual({ processed: 0, dispatched: 1 });
    const run = (await pool.query<{ status: string; steps: unknown[] }>(`SELECT status, steps FROM ai_workflow_runs WHERE workflow_id = $1`, [workflowId])).rows[0];
    expect(run).toMatchObject({ status: 'partial', steps: [{ status: 'outcome_unknown' }] });
    expect(JSON.stringify(run)).not.toContain('private provider response');
    expect((await pool.query(`SELECT id FROM ai_workflow_runs WHERE workflow_id = $1`, [laterId])).rows).toHaveLength(0);
    await Promise.all(Array.from({ length: 3 }, () => processPendingEvents(pool, async () => { calls += 1; throw new Error('must not replay'); }, 1)));
    expect(calls).toBe(1);
    const saved = (await pool.query<{ processed_at: string | null; dispatch_claimed_at: Date | null }>(`SELECT processed_at, dispatch_claimed_at FROM ai_events WHERE id = $1`, [event.id])).rows[0];
    expect(saved?.processed_at).toBeNull();
    expect(saved?.dispatch_claimed_at).toBeTruthy();
    await pool.query(`UPDATE ai_events SET dispatch_claimed_at = LEAST(now() - interval '6 minutes',
      COALESCE((SELECT MIN(dispatch_claimed_at) - interval '1 day' FROM ai_events WHERE processed_at IS NULL AND dispatch_claim_token IS NOT NULL), now() - interval '6 minutes')) WHERE id = $1`, [event.id]);
    const operator = randomUUID();
    await pool.query(`INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'hash','Local admin','admin')`, [operator, `${operator}@example.test`]);
    expect((await listHeldEventClaims(pool, 200)).find((claim) => claim.event_id === event.id)?.delayed).toBe(true);
    expect((await openHeldEventInvestigation(pool, event.id, operator))?.created).toBe(true);
    expect((await pool.query<{ processed_at: string | null }>(`SELECT processed_at FROM ai_events WHERE id = $1`, [event.id])).rows[0]?.processed_at).toBeNull();
  });

  it('does not dispatch the same event concurrently while its first runner is in flight', async () => {
    const eventType = `parallel.${randomUUID()}`;
    const workflowId = randomUUID();
    await pool.query(`INSERT INTO ai_workflows (id, slug, name, event_type, definition) VALUES ($1,$2,'test',$3,$4)`,
      [workflowId, `parallel-${workflowId}`, eventType, JSON.stringify([{ agent_slug: 'collector', task_type: 'billing.overdue_digest' }])]);
    const { event } = await emitEvent(pool, { eventType, source: 'admin' });
    await pool.query(`UPDATE ai_events SET occurred_at = '1000-01-01' WHERE id = $1`, [event.id]);
    let entered!: () => void;
    let release!: () => void;
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    const releasePromise = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    const first = processPendingEvents(pool, async (db, taskId) => {
      calls += 1;
      entered();
      await releasePromise;
      await updateTaskStatus(db, taskId, 'succeeded');
      const task = await getTask(db, taskId);
      if (!task) throw new Error('missing task');
      return { task, runStatus: 'succeeded', pendingApprovals: [] };
    }, 1);
    try {
      await enteredPromise;
      const other = await processPendingEvents(pool, async () => { calls += 1; throw new Error('duplicate dispatch'); }, 1);
      expect(other.dispatched).toBe(0);
      expect(calls).toBe(1);
      expect((await pool.query<{ processed_at: string | null }>(`SELECT processed_at FROM ai_events WHERE id = $1`, [event.id])).rows[0]?.processed_at).toBeNull();
    } finally { release(); }
    expect(await first).toEqual({ processed: 1, dispatched: 1 });
    expect(calls).toBe(1);
    const runs = await pool.query<{ status: string }>(`SELECT status FROM ai_workflow_runs WHERE workflow_id = $1 AND event_id = $2`, [workflowId, event.id]);
    expect(runs.rows.map((row) => row.status)).toEqual(['succeeded']);
  });

  it('creates one shared task for parallel matching requests and rejects a different customer scope', async () => {
    const agent = await getAgentBySlug(pool, 'customer-cloud-assistant');
    expect(agent).not.toBeNull();
    const users = [randomUUID(), randomUUID()];
    for (const id of users) await pool.query(`INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'hash','Local test','customer')`, [id, `${id}@example.test`]);
    const input = { agentId: agent!.id, taskType: 'customer.assistant_query', context: { message: 'show my invoices' }, entryPoint: 'customer.account_assistant' as const, requestedByType: 'customer' as const, requestedBy: users[0], customerId: users[0], idempotencyKey: `pg-identity:${randomUUID()}` };
    const requests = await Promise.all(Array.from({ length: 6 }, () => prepareOrchestratedTask(pool, input)));
    expect(requests.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(requests.map((result) => result.task.id)).size).toBe(1);
    await expect(prepareOrchestratedTask(pool, { ...input, requestedBy: users[1], customerId: users[1] })).rejects.toMatchObject({ name: 'TaskIdentityConflict' });
    expect((await pool.query(`SELECT id FROM ai_tasks WHERE idempotency_key = $1`, [input.idempotencyKey])).rows).toHaveLength(1);
  });

  it.each(['owner', 'suspended'] as const)('fails closed if customer %s changes between scope check and task claim', async (change) => {
    const alice = randomUUID(), bob = randomUUID();
    for (const id of [alice, bob]) await pool.query(`INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'hash','Local test','customer')`, [id, `${id}@example.test`]);
    const agent = await getAgentBySlug(pool, 'customer-cloud-assistant');
    expect(agent).not.toBeNull();
    const { task } = await createTask(pool, { agentId: agent!.id, taskType: 'customer.assistant_query', context: { message: 'show my invoices' }, requestedByType: 'customer', requestedBy: alice, customerId: alice });
    let entered!: () => void, release!: () => void;
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    const releasePromise = new Promise<void>((resolve) => { release = resolve; });
    const gated = {
      query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => pool.query(sql, params) as Promise<{ rows: T[] }>,
      connect: async () => {
        const client = await pool.connect();
        return { query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
          // Pause after the initial scope read but before the transactional user lock.
          if (sql.includes('FOR SHARE') && sql.includes('FROM users')) { entered(); await releasePromise; }
          return client.query(sql, params) as Promise<{ rows: T[] }>;
        }, release: () => client.release() };
      },
    };
    const pending = runTask(gated, task.id, { actorUserId: alice, customerScopeUserId: alice });
    try {
      await enteredPromise;
      if (change === 'owner') await pool.query(`UPDATE ai_tasks SET requested_by = $2, customer_id = $2 WHERE id = $1`, [task.id, bob]);
      else await pool.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [alice]);
    } finally { release(); }
    await expect(pending).rejects.toMatchObject({ code: 'CUSTOMER_SCOPE_INVALID', message: 'Task scope is invalid' });
    expect((await pool.query<{ status: string }>(`SELECT status FROM ai_tasks WHERE id = $1`, [task.id])).rows[0]?.status).toBe('queued');
    expect((await pool.query(`SELECT id FROM ai_runs WHERE task_id = $1`, [task.id])).rows).toHaveLength(0);
  });

  it('does not let a mismatched customer consume or read the legitimate task during concurrent execution', async () => {
    const alice = randomUUID(), bob = randomUUID();
    for (const id of [alice, bob]) await pool.query(`INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'hash','Local test','customer')`, [id, `${id}@example.test`]);
    const agent = await getAgentBySlug(pool, 'customer-cloud-assistant');
    const { task } = await createTask(pool, { agentId: agent!.id, taskType: 'customer.assistant_query', context: { message: 'show my invoices' }, requestedByType: 'customer', requestedBy: alice, customerId: alice });
    const [victim, attacker] = await Promise.allSettled([
      runTask(pool, task.id, { actorUserId: alice, customerScopeUserId: alice }),
      runTask(pool, task.id, { actorUserId: bob, customerScopeUserId: bob }),
    ]);
    expect(victim.status).toBe('fulfilled');
    if (victim.status === 'fulfilled') expect(victim.value.runStatus).toBe('succeeded');
    expect(attacker.status).toBe('rejected');
    if (attacker.status === 'rejected') expect(attacker.reason).toMatchObject({ code: 'CUSTOMER_SCOPE_INVALID', message: 'Task scope is invalid' });
    expect((await pool.query<{ n: number }>(`SELECT count(*)::int n FROM ai_runs WHERE task_id = $1`, [task.id])).rows[0]?.n).toBe(1);
    await expect(runTask(pool, task.id, { actorUserId: bob, customerScopeUserId: bob })).rejects.toMatchObject({ code: 'CUSTOMER_SCOPE_INVALID' });
  });

  it('claims one queued customer task once across concurrent executors', async () => {
    const userId = randomUUID();
    await pool.query(`INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'hash','Local test','customer')`, [userId, `${userId}@example.test`]);
    const agent = await getAgentBySlug(pool, 'customer-cloud-assistant');
    expect(agent).not.toBeNull();
    const { task } = await createTask(pool, { agentId: agent!.id, taskType: 'customer.assistant_query', context: { message: 'show my invoices' }, requestedByType: 'customer', requestedBy: userId, customerId: userId });
    const runs = await Promise.all(Array.from({ length: 4 }, () => runTask(pool, task.id, { actorUserId: userId, customerScopeUserId: userId })));
    expect(runs.some((run) => run.runStatus === 'succeeded')).toBe(true);
    const stored = await pool.query<{ n: number }>(`SELECT count(*)::int n FROM ai_runs WHERE task_id = $1`, [task.id]);
    expect(stored.rows[0]?.n).toBe(1);
  });

  it('serializes concurrent fingerprinted event emission to a single row on PostgreSQL', async () => {
    const fingerprint = `concurrent.${randomUUID()}`;
    const results = await Promise.all(
      Array.from({ length: 5 }, () => emitEvent(pool, { eventType: 'test.concurrent', source: 'admin', fingerprint })),
    );
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.event.id)).size).toBe(1);
    expect((await pool.query(`SELECT id FROM ai_events WHERE fingerprint = $1`, [fingerprint])).rows).toHaveLength(1);
    // Drain this test's event: the cluster persists across suite runs, and a leftover
    // unprocessed event would be claimed by later parallel-claim tests.
    await pool.query(`UPDATE ai_events SET processed_at = now() WHERE fingerprint = $1`, [fingerprint]);
  });

  it('records one task investigation and audit for concurrent identical submissions on PostgreSQL', async () => {
    const operator = randomUUID();
    await pool.query(`INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'hash','Local admin','admin')`, [operator, `${operator}@example.test`]);
    const agent = await getAgentBySlug(pool, 'collector');
    expect(agent).not.toBeNull();
    const { task } = await createTask(pool, { agentId: agent!.id, taskType: 'billing.overdue_digest', requestedByType: 'schedule' });
    await pool.query(`UPDATE ai_tasks SET status = 'running', heartbeat_at = now() - interval '20 minutes' WHERE id = $1`, [task.id]);
    const observed = (await pool.query<{ obs: string }>(
      `SELECT to_char(COALESCE(heartbeat_at, updated_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS obs FROM ai_tasks WHERE id = $1`,
      [task.id])).rows[0]!.obs;
    const [first, second] = await Promise.all([
      openTaskInvestigation(pool, task.id, observed, operator),
      openTaskInvestigation(pool, task.id, observed, operator),
    ]);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect([first!.created, second!.created].sort()).toEqual([false, true]);
    expect((await pool.query(`SELECT id FROM ai_task_investigations WHERE task_id = $1`, [task.id])).rows).toHaveLength(1);
    expect((await pool.query(`SELECT id FROM ai_audit_logs WHERE action = 'ai.task.interrupted_investigation_opened' AND arguments->>'taskId' = $1`, [task.id])).rows).toHaveLength(1);
    // The task itself is untouched: still running with its stale observation.
    const row = await pool.query<{ status: string; heartbeat_at: Date }>(`SELECT status, heartbeat_at FROM ai_tasks WHERE id = $1`, [task.id]);
    expect(row.rows[0]?.status).toBe('running');
    expect(row.rows[0]!.heartbeat_at.getTime()).toBeLessThan(Date.now() - 15 * 60_000);
    // Visible through the bounded list with the investigation mirrored.
    const listed = await listSuspectedInterruptedTasks(pool, 200);
    const mine = listed.find((entry) => entry.task_id === task.id);
    expect(mine?.investigation_id).toBeTruthy();
    expect(mine?.observed_heartbeat_at).toBe(observed);
  });

  it('serializes concurrent cancel and result publication across PostgreSQL connections', async () => {
    const conversationId = await conversation();
    const workflow = await beginLaunch(pool, conversationId, null);
    await claimLaunchChoice(pool, conversationId, 'hosting-wordpress', null);
    const messageId = randomUUID();
    const [stopped, completed] = await Promise.all([
      stopLaunch(pool, conversationId, 'cancelled', null),
      finishLaunch(pool, workflow.id, conversationId, 'options_ready', null,
        (tx) => tx.query(`INSERT INTO ai_support_messages (id, conversation_id, author_type, body, intent) VALUES ($1,$2,'AI','options','website_launch_options')`, [messageId, conversationId])),
    ]);
    expect([stopped !== null, completed !== null].filter(Boolean)).toHaveLength(1);
    const final = (await pool.query<{ status: string }>(`SELECT status FROM ai_launch_workflows WHERE id = $1`, [workflow.id])).rows[0];
    const messages = await pool.query(`SELECT id FROM ai_support_messages WHERE conversation_id = $1 AND intent = 'website_launch_options'`, [conversationId]);
    if (final?.status === 'cancelled') {
      expect(completed).toBeNull();
      expect(messages.rows).toHaveLength(0);
    } else {
      expect(final?.status).toBe('options_ready');
      expect(stopped).toBeNull();
      expect(messages.rows).toHaveLength(1);
    }
  });

  it('refuses an administrative claim when requester demotion wins the PostgreSQL row lock', async () => {
    const actor = randomUUID();
    await pool.query(`INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'hash','Admin','admin')`, [actor, `${actor}@example.test`]);
    const agent = (await getAgentBySlug(pool, 'collector'))!;
    const { task } = await prepareOrchestratedTask(pool, { agentId: agent.id, taskType: 'billing.overdue_digest', entryPoint: 'admin.task', requestedByType: 'staff', requestedBy: actor });
    const revoker = await pool.connect();
    let committed = false;
    let attempt: Promise<unknown> | undefined;
    try {
      await revoker.query('BEGIN');
      await revoker.query(`UPDATE users SET role = 'staff' WHERE id = $1`, [actor]);
      attempt = runTask(pool, task.id, { actorUserId: actor });
      // Attach rejection before releasing the database lock.
      const rejected = expect(attempt).rejects.toMatchObject({ code: 'REQUESTER_AUTHORIZATION_UNAVAILABLE' });
      await revoker.query('COMMIT');
      committed = true;
      await rejected;
      expect((await getTask(pool, task.id))?.status).toBe('queued');
      expect((await pool.query(`SELECT id FROM ai_runs WHERE task_id = $1`, [task.id])).rows).toHaveLength(0);
      expect((await pool.query(`SELECT id FROM ai_tool_calls WHERE task_id = $1`, [task.id])).rows).toHaveLength(0);
    } finally {
      if (!committed) await revoker.query('ROLLBACK').catch(() => undefined);
      revoker.release();
      await attempt?.catch(() => undefined);
    }
  });

  it('refuses an audited retry when a concurrent task context change wins the row lock', async () => {
    const operator = randomUUID();
    await pool.query(`INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'hash','Retry operator','admin')`, [operator, `${operator}@example.test`]);
    const agent = (await getAgentBySlug(pool, 'website-launch-assistant'))!;
    const { task } = await prepareOrchestratedTask(pool, {
      agentId: agent.id, taskType: 'sales.website_launch', context: { serviceKey: 'hosting-wordpress' },
      entryPoint: 'customer.website_launch', requestedByType: 'system', requestedBy: null,
    });
    const updater = await pool.connect();
    let signal!: () => void;
    const claimAttempted = new Promise<void>((resolve) => { signal = resolve; });
    const observed = {
      query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => pool.query(sql, params) as Promise<{ rows: T[] }>,
      connect: async () => {
        const client = await pool.connect();
        return { query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
          if (sql.includes("UPDATE ai_tasks SET status = 'running'")) signal();
          return client.query(sql, params) as Promise<{ rows: T[] }>;
        }, release: () => client.release() };
      },
    };
    let committed = false;
    let attempt: Promise<unknown> | undefined;
    try {
      await updater.query('BEGIN');
      await updater.query(`UPDATE ai_tasks SET context = $2::jsonb WHERE id = $1`, [task.id, JSON.stringify({ serviceKey: 'hosting-business' })]);
      attempt = runTask(observed, task.id, { readOnlyRetry: true, retryExpectedTask: task, retryOperatorUserId: operator });
      const refused = expect(attempt).rejects.toMatchObject({ code: 'RETRY_CLAIM_UNAVAILABLE' });
      await claimAttempted;
      await updater.query('COMMIT');
      committed = true;
      await refused;
      expect((await getTask(pool, task.id))?.status).toBe('queued');
      expect((await pool.query(`SELECT id FROM ai_runs WHERE task_id = $1`, [task.id])).rows).toHaveLength(0);
    } finally {
      if (!committed) await updater.query('ROLLBACK').catch(() => undefined);
      updater.release();
      await attempt?.catch(() => undefined);
    }
  });

  it('permits at most one simultaneous retry claim against the same audited snapshot', async () => {
    const operator = randomUUID();
    await pool.query(`INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'hash','Retry operator','admin')`, [operator, `${operator}@example.test`]);
    const agent = (await getAgentBySlug(pool, 'website-launch-assistant'))!;
    const { task } = await prepareOrchestratedTask(pool, {
      agentId: agent.id, taskType: 'sales.website_launch', context: { serviceKey: 'hosting-wordpress' },
      entryPoint: 'customer.website_launch', requestedByType: 'system', requestedBy: null,
    });
    const original = AGENT_HANDLERS['sales.website_launch']!;
    let calls = 0;
    try {
      AGENT_HANDLERS['sales.website_launch'] = async () => { calls++; return { summary: 'retry probe' }; };
      const results = await Promise.allSettled(Array.from({ length: 4 }, () => runTask(pool, task.id, { readOnlyRetry: true, retryExpectedTask: task, retryOperatorUserId: operator })));
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected').every((r) => r.reason.code === 'RETRY_CLAIM_UNAVAILABLE')).toBe(true);
      expect(calls).toBe(1);
      expect((await pool.query(`SELECT id FROM ai_runs WHERE task_id = $1`, [task.id])).rows).toHaveLength(1);
    } finally { AGENT_HANDLERS['sales.website_launch'] = original; }
  });

  it('refuses retry if operator demotion wins the PostgreSQL row lock', async () => {
    const operator = randomUUID();
    await pool.query(`INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'hash','Retry operator','admin')`, [operator, `${operator}@example.test`]);
    const agent = (await getAgentBySlug(pool, 'website-launch-assistant'))!;
    const { task } = await prepareOrchestratedTask(pool, { agentId: agent.id, taskType: 'sales.website_launch', context: { serviceKey: 'hosting-wordpress' }, entryPoint: 'customer.website_launch', requestedByType: 'system', requestedBy: null });
    const revoker = await pool.connect();
    let signal!: () => void;
    const lockAttempted = new Promise<void>((resolve) => { signal = resolve; });
    const observed = {
      query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => pool.query(sql, params) as Promise<{ rows: T[] }>,
      connect: async () => {
        const client = await pool.connect();
        return { query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
          if (sql.includes('FOR SHARE') && sql.includes('FROM users')) signal();
          return client.query(sql, params) as Promise<{ rows: T[] }>;
        }, release: () => client.release() };
      },
    };
    let committed = false;
    let attempt: Promise<unknown> | undefined;
    try {
      await revoker.query('BEGIN');
      await revoker.query(`UPDATE users SET role = 'staff' WHERE id = $1`, [operator]);
      attempt = runTask(observed, task.id, { readOnlyRetry: true, retryExpectedTask: task, retryOperatorUserId: operator });
      const refused = expect(attempt).rejects.toMatchObject({ code: 'RETRY_OPERATOR_UNAUTHORIZED' });
      await lockAttempted;
      await revoker.query('COMMIT');
      committed = true;
      await refused;
      expect((await getTask(pool, task.id))?.status).toBe('queued');
      expect((await pool.query(`SELECT id FROM ai_runs WHERE task_id = $1`, [task.id])).rows).toHaveLength(0);
      expect((await pool.query(`SELECT id FROM ai_tool_calls WHERE task_id = $1`, [task.id])).rows).toHaveLength(0);
    } finally {
      if (!committed) await revoker.query('ROLLBACK').catch(() => undefined);
      revoker.release();
      await attempt?.catch(() => undefined);
    }
  });

  it('does not execute or replay a retry after a lost claim COMMIT acknowledgement', async () => {
    const operator = randomUUID();
    await pool.query(`INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'hash','Retry operator','admin')`, [operator, `${operator}@example.test`]);
    const agent = (await getAgentBySlug(pool, 'website-launch-assistant'))!;
    const { task } = await prepareOrchestratedTask(pool, { agentId: agent.id, taskType: 'sales.website_launch', context: { serviceKey: 'hosting-wordpress' }, entryPoint: 'customer.website_launch', requestedByType: 'system', requestedBy: null });
    const uncertain = {
      query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => pool.query(sql, params) as Promise<{ rows: T[] }>,
      connect: async () => {
        const client = await pool.connect();
        return { query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
          const result = await client.query(sql, params);
          if (sql === 'COMMIT') throw new Error('lost retry claim acknowledgement');
          return result as { rows: T[] };
        }, release: () => client.release() };
      },
    };
    const options = { readOnlyRetry: true, retryExpectedTask: task, retryOperatorUserId: operator };
    await expect(runTask(uncertain, task.id, options)).rejects.toThrow('lost retry claim acknowledgement');
    expect((await getTask(pool, task.id))?.status).toBe('running');
    expect((await pool.query(`SELECT id FROM ai_runs WHERE task_id = $1`, [task.id])).rows).toHaveLength(0);
    await expect(runTask(pool, task.id, options)).rejects.toMatchObject({ code: 'RETRY_CLAIM_UNAVAILABLE' });
    expect((await pool.query(`SELECT id FROM ai_tool_calls WHERE task_id = $1`, [task.id])).rows).toHaveLength(0);
  });

  it('holds the retry operator lock until the claim commits', async () => {
    const operator = randomUUID();
    await pool.query(`INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'hash','Retry operator','admin')`, [operator, `${operator}@example.test`]);
    const agent = (await getAgentBySlug(pool, 'website-launch-assistant'))!;
    const { task } = await prepareOrchestratedTask(pool, { agentId: agent.id, taskType: 'sales.website_launch', context: { serviceKey: 'hosting-wordpress' }, entryPoint: 'customer.website_launch', requestedByType: 'system', requestedBy: null });
    let claimed!: () => void, releaseClaim!: () => void;
    const reachedClaim = new Promise<void>((resolve) => { claimed = resolve; });
    const continueClaim = new Promise<void>((resolve) => { releaseClaim = resolve; });
    const observed = {
      query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => pool.query(sql, params) as Promise<{ rows: T[] }>,
      connect: async () => {
        const client = await pool.connect();
        return { query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
          const result = await client.query(sql, params);
          if (sql.includes("UPDATE ai_tasks SET status = 'running'")) { claimed(); await continueClaim; }
          return result as { rows: T[] };
        }, release: () => client.release() };
      },
    };
    const original = AGENT_HANDLERS['sales.website_launch']!;
    AGENT_HANDLERS['sales.website_launch'] = async () => ({ summary: 'retry lock probe' });
    const contender = await pool.connect();
    const attempt = runTask(observed, task.id, { readOnlyRetry: true, retryExpectedTask: task, retryOperatorUserId: operator });
    try {
      await reachedClaim;
      await contender.query('BEGIN');
      await contender.query(`SET LOCAL lock_timeout = '100ms'`);
      await expect(contender.query(`UPDATE users SET role = 'staff' WHERE id = $1`, [operator])).rejects.toMatchObject({ code: '55P03' });
      await contender.query('ROLLBACK');
    } finally {
      releaseClaim();
      await contender.query('ROLLBACK').catch(() => undefined);
      contender.release();
      try { await attempt; } finally { AGENT_HANDLERS['sales.website_launch'] = original; }
    }
    expect((await pool.query(`SELECT id FROM ai_runs WHERE task_id = $1`, [task.id])).rows).toHaveLength(1);
  });

  it('refuses a customer claim when suspension wins the user row lock', async () => {
    const customer = randomUUID();
    await pool.query(`INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'hash','Customer','customer')`, [customer, `${customer}@example.test`]);
    const agent = (await getAgentBySlug(pool, 'customer-cloud-assistant'))!;
    const { task } = await prepareOrchestratedTask(pool, { agentId: agent.id, taskType: 'customer.assistant_query', entryPoint: 'customer.account_assistant', requestedByType: 'customer', requestedBy: customer, customerId: customer });
    const revoker = await pool.connect();
    let signal!: () => void;
    const lockAttempted = new Promise<void>((resolve) => { signal = resolve; });
    const observed = {
      query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => pool.query(sql, params) as Promise<{ rows: T[] }>,
      connect: async () => {
        const client = await pool.connect();
        return { query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
          if (sql.includes('FOR SHARE') && sql.includes('FROM users')) signal();
          return client.query(sql, params) as Promise<{ rows: T[] }>;
        }, release: () => client.release() };
      },
    };
    let committed = false;
    let attempt: Promise<unknown> | undefined;
    try {
      await revoker.query('BEGIN');
      await revoker.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [customer]);
      attempt = runTask(observed, task.id, { actorUserId: customer, customerScopeUserId: customer });
      const rejected = expect(attempt).rejects.toMatchObject({ code: 'CUSTOMER_SCOPE_INVALID' });
      await lockAttempted;
      await revoker.query('COMMIT');
      committed = true;
      await rejected;
      expect((await getTask(pool, task.id))?.status).toBe('queued');
      expect((await pool.query(`SELECT id FROM ai_runs WHERE task_id = $1`, [task.id])).rows).toHaveLength(0);
      expect((await pool.query(`SELECT id FROM ai_tool_calls WHERE task_id = $1`, [task.id])).rows).toHaveLength(0);
    } finally {
      if (!committed) await revoker.query('ROLLBACK').catch(() => undefined);
      revoker.release();
      await attempt?.catch(() => undefined);
    }
  });

  it('holds the customer status lock through the claim transaction', async () => {
    const customer = randomUUID();
    await pool.query(`INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'hash','Customer','customer')`, [customer, `${customer}@example.test`]);
    const agent = (await getAgentBySlug(pool, 'customer-cloud-assistant'))!;
    const { task } = await prepareOrchestratedTask(pool, { agentId: agent.id, taskType: 'customer.assistant_query', entryPoint: 'customer.account_assistant', requestedByType: 'customer', requestedBy: customer, customerId: customer });
    let claimed!: () => void, releaseClaim!: () => void;
    const reachedClaim = new Promise<void>((resolve) => { claimed = resolve; });
    const continueClaim = new Promise<void>((resolve) => { releaseClaim = resolve; });
    const observed = {
      query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => pool.query(sql, params) as Promise<{ rows: T[] }>,
      connect: async () => {
        const client = await pool.connect();
        return { query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
          const result = await client.query(sql, params);
          if (sql.includes("UPDATE ai_tasks SET status = 'running'")) { claimed(); await continueClaim; }
          return result as { rows: T[] };
        }, release: () => client.release() };
      },
    };
    const contender = await pool.connect();
    const attempt = runTask(observed, task.id, { actorUserId: customer, customerScopeUserId: customer });
    try {
      await reachedClaim;
      await contender.query('BEGIN');
      await contender.query(`SET LOCAL lock_timeout = '100ms'`);
      await expect(contender.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [customer])).rejects.toMatchObject({ code: '55P03' });
      await contender.query('ROLLBACK');
    } finally {
      releaseClaim();
      await contender.query('ROLLBACK').catch(() => undefined);
      contender.release();
      await attempt;
    }
    expect((await pool.query(`SELECT id FROM ai_runs WHERE task_id = $1`, [task.id])).rows).toHaveLength(1);
  });

  it('does not execute after a lost customer-claim COMMIT acknowledgement', async () => {
    const customer = randomUUID();
    await pool.query(`INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'hash','Customer','customer')`, [customer, `${customer}@example.test`]);
    const agent = (await getAgentBySlug(pool, 'customer-cloud-assistant'))!;
    const { task } = await prepareOrchestratedTask(pool, { agentId: agent.id, taskType: 'customer.assistant_query', entryPoint: 'customer.account_assistant', requestedByType: 'customer', requestedBy: customer, customerId: customer });
    const uncertain = {
      query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => pool.query(sql, params) as Promise<{ rows: T[] }>,
      connect: async () => {
        const client = await pool.connect();
        return { query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
          const result = await client.query(sql, params);
          if (sql === 'COMMIT') throw new Error('lost customer claim acknowledgement');
          return result as { rows: T[] };
        }, release: () => client.release() };
      },
    };
    await expect(runTask(uncertain, task.id, { actorUserId: customer, customerScopeUserId: customer })).rejects.toThrow('lost customer claim acknowledgement');
    expect((await getTask(pool, task.id))?.status).toBe('running');
    expect((await pool.query(`SELECT id FROM ai_runs WHERE task_id = $1`, [task.id])).rows).toHaveLength(0);
    expect((await runTask(pool, task.id, { actorUserId: customer, customerScopeUserId: customer })).runStatus).toBe('running');
    expect((await pool.query(`SELECT id FROM ai_tool_calls WHERE task_id = $1`, [task.id])).rows).toHaveLength(0);
  });

  it('does not execute after a lost administrative-claim COMMIT acknowledgement', async () => {
    const actor = randomUUID();
    await pool.query(`INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'hash','Admin','admin')`, [actor, `${actor}@example.test`]);
    const agent = (await getAgentBySlug(pool, 'collector'))!;
    const { task } = await prepareOrchestratedTask(pool, { agentId: agent.id, taskType: 'billing.overdue_digest', entryPoint: 'admin.task', requestedByType: 'staff', requestedBy: actor });
    const uncertain = {
      query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => pool.query(sql, params) as Promise<{ rows: T[] }>,
      connect: async () => {
        const client = await pool.connect();
        return { query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
          const result = await client.query(sql, params);
          if (sql === 'COMMIT') throw new Error('lost claim acknowledgement');
          return result as { rows: T[] };
        }, release: () => client.release() };
      },
    };
    await expect(runTask(uncertain, task.id, { actorUserId: actor })).rejects.toThrow('lost claim acknowledgement');
    expect((await getTask(pool, task.id))?.status).toBe('running');
    expect((await pool.query(`SELECT id FROM ai_runs WHERE task_id = $1`, [task.id])).rows).toHaveLength(0);
    expect((await pool.query(`SELECT id FROM ai_tool_calls WHERE task_id = $1`, [task.id])).rows).toHaveLength(0);
    // A second call observes the held claim, and does not dispatch it again.
    expect((await runTask(pool, task.id, { actorUserId: actor })).runStatus).toBe('running');
    expect((await pool.query(`SELECT id FROM ai_runs WHERE task_id = $1`, [task.id])).rows).toHaveLength(0);
  });

  it('locks the resource and customer while a workflow customer binding is prepared', async () => {
    const alice = randomUUID(), bob = randomUUID(), order = randomUUID(), invoice = randomUUID();
    await pool.query(`INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'hash','Alice','customer'),($3,$4,'hash','Bob','customer')`, [alice, `${alice}@example.test`, bob, `${bob}@example.test`]);
    await pool.query(`INSERT INTO orders (id,user_id,currency,subtotal_amount,total_amount,status,payment_status) VALUES ($1,$2,'USD',10,10,'pending','unpaid')`, [order, alice]);
    await pool.query(`INSERT INTO invoices (id,order_id,user_id,currency,subtotal_amount,total_amount,status,due_date) VALUES ($1,$2,$3,'USD',10,10,'unpaid',CURRENT_DATE - 1)`, [invoice, order, alice]);
    const { event } = await emitEvent(pool, { eventType: 'invoice.overdue', source: 'admin', payload: { invoiceId: invoice, customerId: alice } });
    const steps = prepareWorkflowSteps([{ agent_slug: 'collector', task_type: 'billing.overdue_digest', customer_from: 'customerId' }], event.payload);
    const owner = await pool.connect(), contender = await pool.connect();
    try {
      await owner.query('BEGIN');
      expect(await authorizeWorkflowCustomerScope(owner, event, steps, true)).toBe(true);
      await contender.query('BEGIN');
      await contender.query(`SET LOCAL lock_timeout = '100ms'`);
      await expect(contender.query(`UPDATE invoices SET due_date = CURRENT_DATE WHERE id = $1`, [invoice])).rejects.toMatchObject({ code: '55P03' });
      await contender.query('ROLLBACK');
      await owner.query('COMMIT');
      await pool.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [alice]);
      expect(await authorizeWorkflowCustomerScope(pool, event, steps)).toBe(false);
    } finally {
      await owner.query('ROLLBACK').catch(() => undefined);
      await contender.query('ROLLBACK').catch(() => undefined);
      owner.release(); contender.release();
      await pool.query(`UPDATE ai_events SET processed_at = now() WHERE id = $1`, [event.id]);
    }
  });

  it('deduplicates parallel keyed customer intake on real PostgreSQL connections', async () => {
    const id = randomUUID(), requestId = randomUUID(), token = randomUUID();
    await pool.query(`INSERT INTO ai_support_conversations (id, access_token_hash, status) VALUES ($1,$2,'WAITING_FOR_HUMAN')`,
      [id, createHash('sha256').update(token).digest('hex')]);
    const app = buildApp(loadEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://user:pass@localhost/test', JWT_SECRET: 'x'.repeat(32), LOG_LEVEL: 'silent' }), { serveFrontend: false, pool });
    try {
      const invoke = () => app.inject({ method: 'POST', url: `/api/v1/ai-support/conversations/${id}/messages`, headers: { 'x-ai-conversation-token': token }, payload: { requestId, message: 'Parallel intake' } });
      const responses = await Promise.all(Array.from({ length: 5 }, invoke));
      expect(responses.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200]);
      expect(responses.filter((r) => r.json().duplicate === true)).toHaveLength(4);
      expect((await pool.query(`SELECT id FROM ai_support_messages WHERE conversation_id = $1 AND author_type = 'CUSTOMER'`, [id])).rows).toHaveLength(1);
      expect((await pool.query(`SELECT request_id FROM ai_support_message_requests WHERE conversation_id = $1`, [id])).rows).toEqual([{ request_id: requestId }]);
      // Deleting an intake message alone must not silently remove its dedupe fence.
      await expect(pool.query(`DELETE FROM ai_support_messages WHERE conversation_id = $1 AND author_type = 'CUSTOMER'`, [id])).rejects.toMatchObject({ code: '23503' });
      // Whole-conversation retention deletion removes both the fence and its transcript.
      await pool.query(`DELETE FROM ai_support_conversations WHERE id = $1`, [id]);
      expect((await pool.query(`SELECT request_id FROM ai_support_message_requests WHERE conversation_id = $1`, [id])).rows).toHaveLength(0);
      expect((await pool.query(`SELECT id FROM ai_support_messages WHERE conversation_id = $1`, [id])).rows).toHaveLength(0);
    } finally { await app.close(); }
  });

  it('holds the conversation row lock across parallel publications on PostgreSQL', async () => {
    const conversationId = await conversation();
    let writerInserted!: () => void;
    const inserted = new Promise<void>((resolve) => { writerInserted = resolve; });
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const writer = withConversationLock(pool, conversationId, async (tx) => {
      await tx.query(`INSERT INTO ai_support_messages (id, conversation_id, author_type, body) VALUES ($1,$2,'CUSTOMER','m1')`, [randomUUID(), conversationId]);
      writerInserted();
      await pause(400); // hold the lock so the reader must block
    });
    await inserted;
    let readerSaw: number | null = null;
    const reader = withConversationLock(pool, conversationId, async (tx) => {
      const seen = await tx.query<{ n: string }>(`SELECT count(*)::text AS n FROM ai_support_messages WHERE conversation_id = $1`, [conversationId]);
      readerSaw = Number(seen.rows[0]!.n);
    });
    await pause(150);
    expect(readerSaw).toBeNull(); // blocked while the writer holds the conversation lock
    await writer;
    await reader;
    expect(readerSaw).toBe(1); // observed the writer's committed message, never a dirty read
    expect((await pool.query(`SELECT id FROM ai_support_messages WHERE conversation_id = $1`, [conversationId])).rows).toHaveLength(1);

    // After a takeover, publication is suppressed without running its insert.
    await pool.query(`UPDATE ai_support_conversations SET status = 'WAITING_FOR_HUMAN' WHERE id = $1`, [conversationId]);
    let ran = false;
    const suppressed = await publishWhileAiActive(pool, conversationId, async () => { ran = true; return 'x'; });
    expect(suppressed).toBeNull();
    expect(ran).toBe(false);
  });
});
