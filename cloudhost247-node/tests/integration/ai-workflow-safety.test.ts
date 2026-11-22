import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { seedAgentRegistry } from '../../src/ai-os/registry/seed';
import { emitEvent, processPendingEvents } from '../../src/ai-os/workflows/engine';
import { getTask, updateTaskStatus } from '../../src/ai-os/repositories/tasks-repo';
import { createApproval } from '../../src/ai-os/repositories/approvals-repo';
import { prepareOrchestratedTask } from '../../src/ai-os/runtime/task-orchestrator';
import { getAgentBySlug } from '../../src/ai-os/repositories/registry-repo';
import { listEvents } from '../../src/ai-os/repositories/events-repo';
import { generateExecutiveBriefing, type RunTaskFn } from '../../src/ai-os/board/board-service';
import type { TaskStatus } from '../../src/ai-os/types';
import type { Queryable } from '../../src/db/types';

describe('AI workflow completion safety', () => {
  let db: PGlite;
  const twoSteps = [
    { agent_slug: 'collector', task_type: 'billing.overdue_digest' },
    { agent_slug: 'incident-commander', task_type: 'incident.correlate' },
  ];

  beforeAll(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
    await seedAgentRegistry(db);
  });

  afterAll(async () => { await db.close(); });

  async function setup(steps: unknown = twoSteps) {
    const id = randomUUID();
    const eventType = `test.${id}`;
    await db.query(
      `INSERT INTO ai_workflows (id, slug, name, event_type, definition) VALUES ($1,$2,$3,$4,$5)`,
      [id, `test-${id}`, 'test workflow', eventType, JSON.stringify(steps)]
    );
    const { event } = await emitEvent(db, { eventType, source: 'admin' });
    return { workflowId: id, eventId: event.id };
  }

  async function runs(workflowId: string) {
    const result = await db.query<{ status: string; steps: Array<{ status: string; taskId?: string; reused?: boolean }>; error: string | null }>(
      `SELECT status, steps, error FROM ai_workflow_runs WHERE workflow_id = $1 ORDER BY started_at`, [workflowId]
    );
    return result.rows;
  }

  function injectQueryFailure(fragment: string) {
    const wrap = (handle: Queryable): Queryable => ({
      query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
        if (sql.includes(fragment)) throw new Error('injected database failure');
        return handle.query<T>(sql, params);
      },
    });
    return { ...wrap(db), transaction: <T>(fn: (tx: Queryable) => Promise<T>) => db.transaction((tx) => fn(wrap(tx))) };
  }

  function runner(statuses: TaskStatus[], calls: string[]): RunTaskFn {
    return async (database, taskId) => {
      const status = statuses[calls.length] ?? 'succeeded';
      calls.push(taskId);
      await updateTaskStatus(database, taskId, status);
      const task = await getTask(database, taskId);
      if (!task) throw new Error('missing test task');
      return { task, runStatus: status, pendingApprovals: status === 'awaiting_approval' ? ['pending-test-approval'] : [] };
    };
  }

  it('does not replay an existing queued board task or use a revoked agent grant', async () => {
    const ceo = await getAgentBySlug(db, 'ai-ceo');
    expect(ceo).not.toBeNull();
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - 29);
    const periodEnd = end.toISOString().slice(0, 10);
    const periodStart = start.toISOString().slice(0, 10);
    const { task } = await prepareOrchestratedTask(db, {
      agentId: ceo!.id, taskType: 'board.executive_briefing',
      context: { reportType: 'monthly', periodStart, periodEnd },
      entryPoint: 'schedule.board.briefing',
      requestedBy: null, requestedByType: 'schedule', idempotencyKey: `briefing:monthly:${periodEnd}:schedule`,
    });
    let calls = 0;
    const shouldNotRun: RunTaskFn = async () => { calls += 1; throw new Error('must not replay'); };
    const queued = await generateExecutiveBriefing(db, 'monthly', null, shouldNotRun);
    expect(queued).toMatchObject({ taskId: task.id, report: null, runStatus: 'queued', created: false });
    await db.query(`UPDATE ai_agents SET enabled = false WHERE id = $1`, [ceo!.id]);
    try {
      const revoked = await generateExecutiveBriefing(db, 'monthly', null, shouldNotRun);
      expect(revoked).toMatchObject({ taskId: task.id, report: null, runStatus: 'refused', created: false });
      expect(calls).toBe(0);
    } finally { await db.query(`UPDATE ai_agents SET enabled = true WHERE id = $1`, [ceo!.id]); }
  });

  it('checkpoints the current task before dispatch and previous success before the next step', async () => {
    const { workflowId } = await setup();
    const calls: string[] = [];
    await processPendingEvents(db, async (database, taskId) => {
      const [run] = await runs(workflowId);
      expect(run?.status).toBe('running');
      expect(run?.steps.at(-1)).toMatchObject({ status: 'dispatching', taskId });
      if (calls.length === 1) expect(run?.steps[0]).toMatchObject({ status: 'succeeded', taskId: calls[0] });
      calls.push(taskId);
      await updateTaskStatus(database, taskId, 'succeeded');
      const task = await getTask(database, taskId);
      if (!task) throw new Error('missing test task');
      return { task, runStatus: 'succeeded', pendingApprovals: [] };
    });
    expect(calls).toHaveLength(2);
    expect((await runs(workflowId))[0]?.status).toBe('succeeded');
  });

  it('retains a non-expiring claim after workflow persistence failure without leaking its token', async () => {
    const { workflowId, eventId } = await setup([twoSteps[0]]);
    const failingDb = injectQueryFailure('INSERT INTO ai_workflow_runs');
    let calls = 0;
    const result = await processPendingEvents(failingDb, async () => { calls += 1; throw new Error('must not dispatch'); });
    expect(result).toEqual({ processed: 0, dispatched: 0 });
    const saved = await db.query<{ processed_at: string | null; dispatch_claim_token: string | null; dispatch_claimed_at: string | null }>(
      `SELECT processed_at, dispatch_claim_token, dispatch_claimed_at FROM ai_events WHERE id = $1`, [eventId]);
    expect(saved.rows[0]?.processed_at).toBeNull();
    expect(saved.rows[0]?.dispatch_claim_token).toBeTruthy();
    expect(saved.rows[0]?.dispatch_claimed_at).toBeTruthy();
    expect(await runs(workflowId)).toHaveLength(0);
    await db.query(`UPDATE ai_events SET dispatch_claimed_at = now() - interval '30 days' WHERE id = $1`, [eventId]);
    await processPendingEvents(db, async () => { calls += 1; throw new Error('must not replay'); });
    expect(calls).toBe(0);
    const publicEvent = (await listEvents(db, { limit: 500 })).find((e) => e.id === eventId);
    expect(publicEvent?.dispatch_claimed_at).toBeTruthy();
    expect(JSON.stringify(publicEvent)).not.toContain(saved.rows[0]?.dispatch_claim_token);
    expect(JSON.stringify(publicEvent)).not.toContain('dispatch_claim_token');
  });

  it('retains the event claim if final run persistence fails after task dispatch', async () => {
    const { workflowId, eventId } = await setup([twoSteps[0]]);
    const failingDb = injectQueryFailure('UPDATE ai_workflow_runs SET status =');
    const calls: string[] = [];
    const result = await processPendingEvents(failingDb, runner(['succeeded'], calls));
    expect(result).toEqual({ processed: 0, dispatched: 0 });
    expect(calls).toHaveLength(1);
    const [run] = await runs(workflowId);
    expect(run?.status).toBe('running');
    expect(run?.steps[0]).toMatchObject({ status: 'succeeded', taskId: calls[0] });
    const event = await db.query<{ processed_at: string | null; dispatch_claimed_at: string | null }>(
      `SELECT processed_at, dispatch_claimed_at FROM ai_events WHERE id = $1`, [eventId]);
    expect(event.rows[0]?.processed_at).toBeNull();
    expect(event.rows[0]?.dispatch_claimed_at).toBeTruthy();
    await processPendingEvents(db, runner(['succeeded'], calls));
    expect(calls).toHaveLength(1);
  });

  it('does not dispatch if the pre-dispatch checkpoint fails', async () => {
    const { workflowId, eventId } = await setup([twoSteps[0]]);
    const failingDb = injectQueryFailure('UPDATE ai_workflow_runs SET steps =');
    let calls = 0;
    await processPendingEvents(failingDb, async () => { calls += 1; throw new Error('must not dispatch'); });
    const [run] = await runs(workflowId);
    expect(calls).toBe(0);
    expect(run?.status).toBe('running');
    expect(run?.steps).toEqual([]);
    expect((await db.query(`SELECT id FROM ai_tasks WHERE idempotency_key = $1`, [`wf:test-${workflowId}:${eventId}:collector`])).rows).toHaveLength(0);
    const event = await db.query<{ processed_at: string | null; dispatch_claimed_at: string | null }>(`SELECT processed_at, dispatch_claimed_at FROM ai_events WHERE id = $1`, [eventId]);
    expect(event.rows[0]?.processed_at).toBeNull();
    expect(event.rows[0]?.dispatch_claimed_at).toBeTruthy();
  });

  it.each([
    { ...twoSteps[1], customer_from: 'missingCustomer' },
    { ...twoSteps[1], subject_from: 'badId', subject_type: 'server' },
    { ...twoSteps[1], input: { marker: '{{missingValue}}' } },
    { ...twoSteps[1], input_template: { ignored: 'unsafe' } },
  ])('preflights later malformed steps before any dispatch', async (invalidStep) => {
    const { workflowId, eventId } = await setup([twoSteps[0], invalidStep]);
    await db.query(`UPDATE ai_events SET payload = $2 WHERE id = $1`, [eventId, JSON.stringify({ badId: 'not-a-uuid', privateMarker: 'do-not-expose' })]);
    const calls: string[] = [];
    await processPendingEvents(db, runner(['succeeded'], calls), 1);
    expect(calls).toHaveLength(0);
    const [run] = await runs(workflowId);
    expect(run).toMatchObject({ status: 'failed', steps: [], error: 'Invalid workflow definition or event input' });
    expect(JSON.stringify(run)).not.toContain('do-not-expose');
    const event = (await db.query<{ processed_at: string | null; dispatch_claimed_at: string | null }>(`SELECT processed_at, dispatch_claimed_at FROM ai_events WHERE id = $1`, [eventId])).rows[0];
    expect(event?.processed_at).toBeNull();
    expect(event?.dispatch_claimed_at).toBeTruthy();
  });

  it('preflights every captured workflow before dispatching an earlier valid workflow', async () => {
    const eventType = `test.${randomUUID()}`, first = randomUUID(), invalid = randomUUID();
    await db.query(`INSERT INTO ai_workflows (id, slug, name, event_type, definition) VALUES
      ($1,$2,'valid',$3,$4), ($5,$6,'invalid',$3,$7)`,
      [first, `a-${first}`, eventType, JSON.stringify([twoSteps[0]]), invalid, `z-${invalid}`, JSON.stringify([{ ...twoSteps[1], customer_from: 'missingCustomer' }])]);
    const { event } = await emitEvent(db, { eventType, source: 'admin', payload: { secretMarker: 'do-not-log-this' } });
    const calls: string[] = [];
    expect(await processPendingEvents(db, runner(['succeeded'], calls), 1)).toEqual({ processed: 0, dispatched: 1 });
    expect(calls).toEqual([]);
    expect(await runs(first)).toHaveLength(0);
    expect(await runs(invalid)).toEqual([expect.objectContaining({ status: 'failed', steps: [], error: 'Invalid workflow definition or event input' })]);
    expect(JSON.stringify(await runs(invalid))).not.toContain('do-not-log-this');
    const held = (await db.query<{ processed_at: string | null; dispatch_claimed_at: string | null }>(`SELECT processed_at, dispatch_claimed_at FROM ai_events WHERE id = $1`, [event.id])).rows[0];
    expect(held?.processed_at).toBeNull();
    expect(held?.dispatch_claimed_at).toBeTruthy();
    await processPendingEvents(db, runner(['succeeded'], calls));
    expect(calls).toEqual([]);
  });

  it.each(['missing', 'ungranted', 'disabled'] as const)('does not dispatch earlier workflows when a later agent is %s', async (mode) => {
    const eventType = `test.${randomUUID()}`, first = randomUUID(), later = randomUUID();
    const agentSlug = mode === 'missing' ? 'missing-agent' : 'incident-commander';
    const taskType = mode === 'ungranted' ? 'ungranted.task' : 'incident.correlate';
    await db.query(`INSERT INTO ai_workflows (id, slug, name, event_type, definition) VALUES
      ($1,$2,'first',$3,$4), ($5,$6,'later',$3,$7)`,
      [first, `a-${first}`, eventType, JSON.stringify([twoSteps[0]]), later, `z-${later}`, JSON.stringify([{ agent_slug: agentSlug, task_type: taskType }])]);
    const { event } = await emitEvent(db, { eventType, source: 'admin' });
    if (mode === 'disabled') await db.query(`UPDATE ai_agents SET enabled = false WHERE slug = $1`, [agentSlug]);
    try {
      const calls: string[] = [];
      expect(await processPendingEvents(db, runner(['succeeded'], calls), 1)).toEqual({ processed: 0, dispatched: 1 });
      expect(calls).toHaveLength(0);
      expect(await runs(first)).toHaveLength(0);
      expect(await runs(later)).toEqual([expect.objectContaining({ status: 'failed', steps: [], error: 'Agent or task grant unavailable' })]);
      const held = (await db.query<{ processed_at: string | null; dispatch_claimed_at: string | null }>(`SELECT processed_at, dispatch_claimed_at FROM ai_events WHERE id = $1`, [event.id])).rows[0];
      expect(held?.processed_at).toBeNull();
      expect(held?.dispatch_claimed_at).toBeTruthy();
    } finally {
      if (mode === 'disabled') await db.query(`UPDATE ai_agents SET enabled = true WHERE slug = $1`, [agentSlug]);
    }
  });

  it('holds an event without dispatch if registry preflight cannot read the agent', async () => {
    const { workflowId, eventId } = await setup([twoSteps[0]]);
    const calls: string[] = [];
    const result = await processPendingEvents(injectQueryFailure('SELECT * FROM ai_agents WHERE slug = $1'), runner(['succeeded'], calls), 1);
    expect(result).toEqual({ processed: 0, dispatched: 0 });
    expect(calls).toEqual([]);
    expect(await runs(workflowId)).toEqual([]);
    const event = (await db.query<{ processed_at: string | null; dispatch_claimed_at: string | null }>(`SELECT processed_at, dispatch_claimed_at FROM ai_events WHERE id = $1`, [eventId])).rows[0];
    expect(event?.processed_at).toBeNull();
    expect(event?.dispatch_claimed_at).toBeTruthy();
    const audits = await db.query(`SELECT error_code, arguments FROM ai_audit_logs WHERE error_code = 'WORKFLOW_PREFLIGHT_ERROR' AND arguments->>'event' = $1`, [eventId]);
    expect(audits.rows).toHaveLength(1);
    expect(JSON.stringify(audits.rows)).not.toContain('injected database failure');
  });

  it('deduplicates fingerprinted events atomically inside the suppression window', async () => {
    const fingerprint = `dedupe.${randomUUID()}`;
    const first = await emitEvent(db, { eventType: 'test.dedupe', source: 'admin', fingerprint });
    expect(first.created).toBe(true);
    const second = await emitEvent(db, { eventType: 'test.dedupe', source: 'admin', fingerprint });
    expect(second.created).toBe(false);
    expect(second.event.id).toBe(first.event.id);
    const rows = await db.query<{ id: string }>(`SELECT id FROM ai_events WHERE fingerprint = $1`, [fingerprint]);
    expect(rows.rows).toHaveLength(1);

    // Concurrent-style emissions on the same handle serialize to one row as well.
    const [a, b] = await Promise.all([
      emitEvent(db, { eventType: 'test.dedupe', source: 'admin', fingerprint: `${fingerprint}.parallel` }),
      emitEvent(db, { eventType: 'test.dedupe', source: 'admin', fingerprint: `${fingerprint}.parallel` }),
    ]);
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
    const parallel = await db.query<{ id: string }>(`SELECT id FROM ai_events WHERE fingerprint = $1`, [`${fingerprint}.parallel`]);
    expect(parallel.rows).toHaveLength(1);

    // After the window expires the same fingerprint may legitimately fire again.
    await db.query(`UPDATE ai_events SET occurred_at = now() - interval '25 hours' WHERE id = $1`, [first.event.id]);
    const third = await emitEvent(db, { eventType: 'test.dedupe', source: 'admin', fingerprint });
    expect(third.created).toBe(true);
    expect(third.event.id).not.toBe(first.event.id);
    // Drain this test's events so later tests' bounded claims are not consumed by them.
    await db.query(`UPDATE ai_events SET processed_at = now() WHERE fingerprint IN ($1, $2)`,
      [fingerprint, `${fingerprint}.parallel`]);
  });

  it('dispatches all captured valid workflows in order after event-wide preflight', async () => {
    const eventType = `test.${randomUUID()}`, first = randomUUID(), second = randomUUID();
    await db.query(`INSERT INTO ai_workflows (id, slug, name, event_type, definition) VALUES
      ($1,$2,'first',$3,$4),($5,$6,'second',$3,$7)`,
      [first, `a-${first}`, eventType, JSON.stringify([twoSteps[0]]), second, `z-${second}`, JSON.stringify([twoSteps[1]])]);
    const { event } = await emitEvent(db, { eventType, source: 'admin' });
    const calls: string[] = [];
    expect(await processPendingEvents(db, runner(['succeeded', 'succeeded'], calls), 1)).toEqual({ processed: 1, dispatched: 2 });
    expect(calls).toHaveLength(2);
    expect((await runs(first))[0]?.status).toBe('succeeded');
    expect((await runs(second))[0]?.status).toBe('succeeded');
    expect((await db.query<{ processed_at: string | null }>(`SELECT processed_at FROM ai_events WHERE id = $1`, [event.id])).rows[0]?.processed_at).toBeTruthy();
  });

  it('rechecks a later agent after preflight and stops if its grant is revoked', async () => {
    const eventType = `test.${randomUUID()}`, first = randomUUID(), second = randomUUID();
    await db.query(`INSERT INTO ai_workflows (id, slug, name, event_type, definition) VALUES
      ($1,$2,'first',$3,$4),($5,$6,'second',$3,$7)`,
      [first, `a-${first}`, eventType, JSON.stringify([twoSteps[0]]), second, `z-${second}`, JSON.stringify([twoSteps[1]])]);
    const { event } = await emitEvent(db, { eventType, source: 'admin' });
    let calls = 0;
    try {
      await processPendingEvents(db, async (database, taskId) => {
        calls++;
        await updateTaskStatus(database, taskId, 'succeeded');
        await database.query(`UPDATE ai_agents SET enabled = false WHERE slug = 'incident-commander'`);
        return { task: (await getTask(database, taskId))!, runStatus: 'succeeded', pendingApprovals: [] };
      }, 1);
      expect(calls).toBe(1);
      expect((await runs(first))[0]?.status).toBe('succeeded');
      expect((await runs(second))[0]).toMatchObject({ status: 'failed', steps: [{ status: 'failed', error: 'Agent or task grant unavailable' }] });
      expect((await db.query<{ processed_at: string | null }>(`SELECT processed_at FROM ai_events WHERE id = $1`, [event.id])).rows[0]?.processed_at).toBeNull();
    } finally { await db.query(`UPDATE ai_agents SET enabled = true WHERE slug = 'incident-commander'`); }
  });

  it('succeeds only after every step succeeds', async () => {
    const { workflowId } = await setup();
    const calls: string[] = [];
    await processPendingEvents(db, runner(['succeeded', 'succeeded'], calls));
    const [run] = await runs(workflowId);
    expect(calls).toHaveLength(2);
    expect(run?.status).toBe('succeeded');
    expect(run?.steps.map((step) => step.status)).toEqual(['succeeded', 'succeeded']);
    expect(run?.error).toBeNull();
  });

  it.each(['awaiting_approval', 'running', 'queued', 'cancelled', 'failed'] as const)(
    'stops at %s instead of running the next step or claiming success',
    async (status) => {
      const { workflowId, eventId } = await setup();
      const calls: string[] = [];
      await processPendingEvents(db, runner([status], calls));
      const [run] = await runs(workflowId);
      expect(calls).toHaveLength(1);
      expect(run?.status).toBe(status === 'failed' ? 'failed' : 'partial');
      expect(run?.steps.map((step) => step.status)).toEqual([status]);
      expect(run?.error).toBeTruthy();
      const event = (await db.query<{ processed_at: string | null; dispatch_claimed_at: string | null }>(`SELECT processed_at, dispatch_claimed_at FROM ai_events WHERE id = $1`, [eventId])).rows[0];
      expect(event?.processed_at).toBeNull();
      expect(event?.dispatch_claimed_at).toBeTruthy();
    }
  );

  it('reports partial when a later step fails after an earlier success', async () => {
    const { workflowId } = await setup();
    const calls: string[] = [];
    await processPendingEvents(db, runner(['succeeded', 'failed'], calls));
    const [run] = await runs(workflowId);
    expect(calls).toHaveLength(2);
    expect(run?.status).toBe('partial');
    expect(run?.steps.map((step) => step.status)).toEqual(['succeeded', 'failed']);
  });

  it('fails closed when an agent is missing and never runs the following step', async () => {
    const { workflowId, eventId } = await setup([{ agent_slug: 'missing-agent', task_type: 'unsupported' }, twoSteps[0]]);
    const calls: string[] = [];
    await processPendingEvents(db, runner(['succeeded'], calls));
    const [run] = await runs(workflowId);
    expect(calls).toHaveLength(0);
    expect(run?.status).toBe('failed');
    expect(run?.steps).toEqual([]);
    expect(run?.error).toBe('Agent or task grant unavailable');
    expect((await db.query<{ processed_at: string | null }>(`SELECT processed_at FROM ai_events WHERE id = $1`, [eventId])).rows[0]?.processed_at).toBeNull();
  });

  it('marks an exception as unknown, preserves no exception text, and does not replay the queued task', async () => {
    const { workflowId, eventId } = await setup();
    let calls = 0;
    await processPendingEvents(db, async () => { calls += 1; throw new Error('secret-in-exception'); });
    const [first] = await runs(workflowId);
    expect(first?.status).toBe('partial');
    expect(first?.steps[0]?.status).toBe('outcome_unknown');
    expect(JSON.stringify(first)).not.toContain('secret-in-exception');

    // No manual claim reset: an automatic sweep must neither replay nor acknowledge uncertainty.
    const held = await db.query<{ processed_at: string | null; dispatch_claimed_at: string | null }>(`SELECT processed_at, dispatch_claimed_at FROM ai_events WHERE id = $1`, [eventId]);
    expect(held.rows[0]?.processed_at).toBeNull();
    expect(held.rows[0]?.dispatch_claimed_at).toBeTruthy();
    await processPendingEvents(db, async () => { calls += 1; throw new Error('must not run'); });
    expect(calls).toBe(1);
    expect(await runs(workflowId)).toHaveLength(1);
  });

  it.each(['awaiting_approval', 'failed', 'succeeded'] as const)(
    'handles duplicate delivery using the recorded %s state',
    async (status) => {
      const { workflowId, eventId } = await setup([twoSteps[0]]);
      const agent = await getAgentBySlug(db, 'collector');
      const prepared = await prepareOrchestratedTask(db, {
        agentId: agent!.id, taskType: 'billing.overdue_digest', requestedByType: 'workflow',
        entryPoint: 'workflow.event',
        idempotencyKey: `wf:test-${workflowId}:${eventId}:collector`,
      });
      await updateTaskStatus(db, prepared.task.id, status);
      const calls: string[] = [];
      await processPendingEvents(db, runner(['succeeded'], calls));
      const all = await runs(workflowId);
      expect(calls).toHaveLength(0);
      expect(all[0]?.steps[0]).toMatchObject({ status, reused: true });
      expect(all[0]?.status).toBe(status === 'succeeded' ? 'succeeded' : status === 'failed' ? 'failed' : 'partial');
      const event = (await db.query<{ processed_at: string | null; dispatch_claimed_at: string | null }>(`SELECT processed_at, dispatch_claimed_at FROM ai_events WHERE id = $1`, [eventId])).rows[0];
      if (status === 'succeeded') expect(event?.processed_at).toBeTruthy();
      else { expect(event?.processed_at).toBeNull(); expect(event?.dispatch_claimed_at).toBeTruthy(); }
    }
  );

  it('does not reuse a succeeded task when the workflow definition changes under the same key', async () => {
    const { workflowId, eventId } = await setup([{ ...twoSteps[0], input: { marker: 'original' } }]);
    const calls: string[] = [];
    await processPendingEvents(db, runner(['succeeded'], calls));
    expect((await runs(workflowId))[0]?.status).toBe('succeeded');
    await db.query(`UPDATE ai_workflows SET definition = $2 WHERE id = $1`, [workflowId, JSON.stringify([{ ...twoSteps[0], input: { marker: 'changed-secret' } }])]);
    await db.query(`UPDATE ai_events SET processed_at = NULL WHERE id = $1`, [eventId]);
    await processPendingEvents(db, runner(['succeeded'], calls));
    const second = (await runs(workflowId))[1];
    expect(calls).toHaveLength(1);
    expect(second?.status).toBe('running');
    expect(second?.steps).toEqual([]);
    const held = await db.query<{ processed_at: string | null; dispatch_claimed_at: string | null }>(`SELECT processed_at, dispatch_claimed_at FROM ai_events WHERE id = $1`, [eventId]);
    expect(held.rows[0]?.processed_at).toBeNull();
    expect(held.rows[0]?.dispatch_claimed_at).toBeTruthy();
    expect(JSON.stringify(second)).not.toContain('changed-secret');
  });

  it('does not reuse a successful task that has an approval record', async () => {
    const { workflowId, eventId } = await setup([twoSteps[0]]);
    const calls: string[] = [];
    await processPendingEvents(db, runner(['succeeded'], calls), 1);
    const task = (await getTask(db, calls[0]!))!;
    await createApproval(db, { agentId: task.agent_id, taskId: task.id, runId: null, tool: 'test', action: 'test', reason: 'test', evidence: [], riskLevel: 'high', arguments: {} });
    // Simulate historical reprocessing in the disposable test DB, not a recovery procedure.
    await db.query(`UPDATE ai_events SET processed_at = NULL WHERE id = $1`, [eventId]);
    await processPendingEvents(db, runner(['succeeded'], calls), 1);
    expect(calls).toHaveLength(1);
    const second = (await runs(workflowId))[1];
    expect(second?.status).toBe('partial');
    expect(second?.steps[0]).toMatchObject({ status: 'outcome_unknown', reused: true });
    const event = (await db.query<{ processed_at: string | null; dispatch_claimed_at: string | null }>(`SELECT processed_at, dispatch_claimed_at FROM ai_events WHERE id = $1`, [eventId])).rows[0];
    expect(event?.processed_at).toBeNull();
    expect(event?.dispatch_claimed_at).toBeTruthy();
  });

  it('does not reuse success after the agent has been disabled', async () => {
    const { workflowId, eventId } = await setup([twoSteps[0]]);
    const calls: string[] = [];
    await processPendingEvents(db, runner(['succeeded'], calls));
    await db.query(`UPDATE ai_agents SET enabled = false WHERE slug = 'collector'`);
    try {
      await db.query(`UPDATE ai_events SET processed_at = NULL WHERE id = $1`, [eventId]);
      await processPendingEvents(db, runner(['succeeded'], calls));
      const second = (await runs(workflowId))[1];
      expect(calls).toHaveLength(1);
      expect(second?.status).toBe('failed');
      expect(second?.steps).toEqual([]);
      expect(second?.error).toBe('Agent or task grant unavailable');
    } finally { await db.query(`UPDATE ai_agents SET enabled = true WHERE slug = 'collector'`); }
  });

  it('treats equivalent JSON key order as the same task and rejects changed scope', async () => {
    const agent = await getAgentBySlug(db, 'collector');
    expect(agent).not.toBeNull();
    const input = { agentId: agent!.id, taskType: 'billing.overdue_digest', requestedByType: 'workflow' as const, entryPoint: 'workflow.event' as const, idempotencyKey: `scope-test:${randomUUID()}`, context: { first: 1, second: 2 } };
    const first = await prepareOrchestratedTask(db, input);
    const second = await prepareOrchestratedTask(db, { ...input, context: { second: 2, first: 1 } });
    expect(second.created).toBe(false);
    expect(second.task.id).toBe(first.task.id);
    await expect(prepareOrchestratedTask(db, { ...input, subjectId: randomUUID() })).rejects.toMatchObject({ name: 'TaskIdentityConflict' });
    await expect(prepareOrchestratedTask(db, { ...input, taskType: 'different.task' })).rejects.toMatchObject({ name: 'TaskIdentityConflict' });
    expect((await getTask(db, first.task.id))?.status).toBe('queued');
  });

  it('retains the claim when an observed post-dispatch checkpoint fails', async () => {
    const { workflowId, eventId } = await setup([twoSteps[0]]);
    let checkpoints = 0;
    const injected = {
      query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
        if (sql.includes('UPDATE ai_workflow_runs SET steps =') && ++checkpoints === 2) throw new Error('injected checkpoint failure');
        return db.query<T>(sql, params);
      },
      transaction: <T>(fn: (tx: Queryable) => Promise<T>) => db.transaction((tx) => fn({
        query: async <U = Record<string, unknown>>(sql: string, params?: unknown[]) => {
          if (sql.includes('UPDATE ai_workflow_runs SET steps =') && ++checkpoints === 2) throw new Error('injected checkpoint failure');
          return tx.query<U>(sql, params);
        },
      })),
    };
    const calls: string[] = [];
    expect(await processPendingEvents(injected, runner(['succeeded'], calls), 1)).toEqual({ processed: 0, dispatched: 1 });
    expect(calls).toHaveLength(1);
    const run = (await runs(workflowId))[0];
    expect(run?.status).toBe('partial');
    expect(run?.steps).toHaveLength(1);
    expect(run?.steps[0]).toMatchObject({ status: 'outcome_unknown', taskId: calls[0] });
    const event = (await db.query<{ processed_at: string | null; dispatch_claimed_at: string | null }>(`SELECT processed_at, dispatch_claimed_at FROM ai_events WHERE id = $1`, [eventId])).rows[0];
    expect(event?.processed_at).toBeNull();
    expect(event?.dispatch_claimed_at).toBeTruthy();
  });

  it.each(['failed', 'cancelled', 'awaiting_approval'] as const)('holds the event and stops later workflows after %s', async (status) => {
    const { workflowId, eventId } = await setup([twoSteps[0]]);
    const eventType = (await db.query<{ event_type: string }>(`SELECT event_type FROM ai_events WHERE id = $1`, [eventId])).rows[0]!.event_type;
    const laterId = randomUUID();
    await db.query(`INSERT INTO ai_workflows (id, slug, name, event_type, definition) VALUES ($1,$2,'later',$3,$4)`,
      [laterId, `test-${workflowId}-later`, eventType, JSON.stringify([twoSteps[1]])]);
    const calls: string[] = [];
    expect(await processPendingEvents(db, runner([status], calls), 1)).toEqual({ processed: 0, dispatched: 1 });
    expect((await runs(workflowId))[0]?.steps[0]).toMatchObject({ status, taskId: calls[0] });
    expect(await runs(laterId)).toHaveLength(0);
    const event = (await db.query<{ processed_at: string | null; dispatch_claimed_at: string | null }>(`SELECT processed_at, dispatch_claimed_at FROM ai_events WHERE id = $1`, [eventId])).rows[0];
    expect(event?.processed_at).toBeNull();
    expect(event?.dispatch_claimed_at).toBeTruthy();
    // A later task state change (e.g. an approval decision) cannot resume the workflow.
    await updateTaskStatus(db, calls[0]!, 'succeeded');
    await processPendingEvents(db, runner(['succeeded'], calls), 1);
    expect(calls).toHaveLength(1);
    expect(await runs(laterId)).toHaveLength(0);
    expect((await db.query<{ processed_at: string | null }>(`SELECT processed_at FROM ai_events WHERE id = $1`, [eventId])).rows[0]?.processed_at).toBeNull();
  });

  it('does not dispatch a later workflow after an uncertain outcome', async () => {
    const { workflowId, eventId } = await setup([twoSteps[0]]);
    const eventType = (await db.query<{ event_type: string }>(`SELECT event_type FROM ai_events WHERE id = $1`, [eventId])).rows[0]!.event_type;
    const firstSlug = `test-${workflowId}`;
    const laterId = randomUUID();
    await db.query(`INSERT INTO ai_workflows (id, slug, name, event_type, definition) VALUES ($1,$2,'later',$3,$4)`,
      [laterId, `${firstSlug}-later`, eventType, JSON.stringify([twoSteps[1]])]);
    let calls = 0;
    expect(await processPendingEvents(db, async () => { calls += 1; throw new Error('unknown effect'); }, 1)).toEqual({ processed: 0, dispatched: 1 });
    expect(calls).toBe(1);
    expect(await runs(laterId)).toHaveLength(0);
    expect((await runs(workflowId))[0]?.steps[0]?.status).toBe('outcome_unknown');
    expect((await db.query<{ processed_at: string | null }>(`SELECT processed_at FROM ai_events WHERE id = $1`, [eventId])).rows[0]?.processed_at).toBeNull();
  });

  it.each(['wrong-task', 'conflicting-failure', 'unknown-status'] as const)('quarantines a %s runner observation', async (kind) => {
    const { workflowId, eventId } = await setup([twoSteps[0]]);
    let calls = 0;
    await processPendingEvents(db, async (database, taskId) => {
      calls += 1;
      const task = await getTask(database, taskId);
      if (!task) throw new Error('missing test task');
      return {
        task: kind === 'wrong-task' ? { ...task, id: randomUUID(), status: 'succeeded' } : task,
        runStatus: kind === 'wrong-task' ? 'succeeded' : kind === 'conflicting-failure' ? 'failed' : 'unrecognized',
        pendingApprovals: [],
      };
    }, 1);
    expect(calls).toBe(1);
    expect((await runs(workflowId))[0]?.steps[0]?.status).toBe('outcome_unknown');
    const event = (await db.query<{ processed_at: string | null; dispatch_claimed_at: string | null }>(`SELECT processed_at, dispatch_claimed_at FROM ai_events WHERE id = $1`, [eventId])).rows[0];
    expect(event?.processed_at).toBeNull();
    expect(event?.dispatch_claimed_at).toBeTruthy();
  });

  it.each(['unpersisted', 'changed-identity', 'approval-exists'] as const)('holds the event when success conflicts with persisted evidence: %s', async (kind) => {
    const { workflowId, eventId } = await setup();
    let calls = 0;
    await processPendingEvents(db, async (database, taskId) => {
      calls += 1;
      const prepared = (await getTask(database, taskId))!;
      if (kind !== 'unpersisted') await updateTaskStatus(database, taskId, 'succeeded');
      if (kind === 'changed-identity') await database.query(`UPDATE ai_tasks SET context = $2 WHERE id = $1`, [taskId, JSON.stringify({ changed: true })]);
      if (kind === 'approval-exists') await createApproval(database, { agentId: prepared.agent_id, taskId, runId: null, tool: 'test', action: 'test', reason: 'test', evidence: [], riskLevel: 'high', arguments: {} });
      return { task: { ...prepared, status: 'succeeded' }, runStatus: 'succeeded', pendingApprovals: [] };
    }, 1);
    expect(calls).toBe(1);
    const [run] = await runs(workflowId);
    expect(run?.status).toBe('partial');
    expect(run?.steps[0]).toMatchObject({ status: 'outcome_unknown' });
    const event = (await db.query<{ processed_at: string | null; dispatch_claimed_at: string | null }>(`SELECT processed_at, dispatch_claimed_at FROM ai_events WHERE id = $1`, [eventId])).rows[0];
    expect(event?.processed_at).toBeNull();
    expect(event?.dispatch_claimed_at).toBeTruthy();
    await processPendingEvents(db, async () => { throw new Error('must not replay'); }, 1);
    expect((await runs(workflowId))).toHaveLength(1);
  });

  it('rejects a success response that conflicts with pending approvals or task state', async () => {
    const { workflowId, eventId } = await setup();
    let calls = 0;
    await processPendingEvents(db, async (database, taskId) => {
      calls += 1;
      const task = await getTask(database, taskId);
      if (!task) throw new Error('missing test task');
      return { task, runStatus: 'succeeded', pendingApprovals: ['pending-test-approval'] };
    });
    const [run] = await runs(workflowId);
    expect(calls).toBe(1);
    expect(run?.status).toBe('partial');
    expect(run?.steps[0]?.status).toBe('outcome_unknown');
    const event = (await db.query<{ processed_at: string | null; dispatch_claimed_at: string | null }>(`SELECT processed_at, dispatch_claimed_at FROM ai_events WHERE id = $1`, [eventId])).rows[0];
    expect(event?.processed_at).toBeNull();
    expect(event?.dispatch_claimed_at).toBeTruthy();
  });

  it.each([[], [twoSteps[0], twoSteps[0]], [{ agent_slug: 'collector' }]])(
    'fails invalid definitions without executing a task',
    async (...definition) => {
      // it.each expands array rows into arguments; reconstruct the definition.
      const steps = definition.length === 0 ? [] : definition;
      const { workflowId, eventId } = await setup(steps);
      let calls = 0;
      await processPendingEvents(db, async () => { calls += 1; throw new Error('must not run'); });
      const [run] = await runs(workflowId);
      expect(calls).toBe(0);
      expect(run?.status).toBe('failed');
      expect((await db.query<{ processed_at: string | null }>(`SELECT processed_at FROM ai_events WHERE id = $1`, [eventId])).rows[0]?.processed_at).toBeNull();
    }
  );
});
