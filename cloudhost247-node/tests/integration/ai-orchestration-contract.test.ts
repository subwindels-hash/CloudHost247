import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { seedAgentRegistry } from '../../src/ai-os/registry/seed';
import { getAgentBySlug } from '../../src/ai-os/repositories/registry-repo';
import type { CreateTaskInput } from '../../src/ai-os/repositories/tasks-repo';
import { prepareOrchestratedTask, TaskIdentityConflict } from '../../src/ai-os/runtime/task-orchestrator';
import {
  AgentGrantError,
  assertEntryPointContract,
  isOrchestrationEntryPoint,
  ORCHESTRATION_ENTRY_POINTS,
  OrchestrationContractError,
} from '../../src/ai-os/runtime/orchestration-contract';
import { generateExecutiveBriefing, type RunTaskFn } from '../../src/ai-os/board/board-service';
import type { TaskRow } from '../../src/ai-os/types';

describe('central authorized orchestration entry-point contract', () => {
  let db: PGlite;
  let staff: string;
  let collectorId: string;

  beforeAll(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
    await seedAgentRegistry(db);
    staff = randomUUID();
    await db.query(
      `INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'hash','Contract Staff','staff')`,
      [staff, `${staff}@contract.test`],
    );
    const collector = await getAgentBySlug(db, 'collector');
    expect(collector).not.toBeNull();
    collectorId = collector!.id;
  });

  afterAll(async () => { await db.close(); });

  const base = (partial: Partial<CreateTaskInput> & Pick<CreateTaskInput, 'entryPoint'>): CreateTaskInput => ({
    agentId: '00000000-0000-4000-8000-000000000009',
    taskType: 'billing.overdue_digest',
    ...partial,
  });

  it('recognizes exactly the documented entry-point set', () => {
    expect([...ORCHESTRATION_ENTRY_POINTS]).toEqual([
      'admin.task', 'admin.copilot', 'admin.board.briefing',
      'schedule.scan', 'schedule.board.briefing',
      'workflow.event', 'customer.account_assistant', 'customer.website_launch', 'board.child',
    ]);
    expect(isOrchestrationEntryPoint('admin.task')).toBe(true);
    expect(isOrchestrationEntryPoint('evil.entry')).toBe(false);
    expect(isOrchestrationEntryPoint(42)).toBe(false);
  });

  it('fails closed when a declared scope does not match its entry point', () => {
    const actor = '00000000-0000-4000-8000-000000000001';
    const other = '00000000-0000-4000-8000-000000000002';
    const invalid: CreateTaskInput[] = [
      base({ entryPoint: 'nonsense.entry' as never, requestedByType: 'staff', requestedBy: actor }),
      base({ entryPoint: 'admin.task', requestedByType: 'customer', requestedBy: actor }),
      base({ entryPoint: 'admin.task', requestedByType: 'staff', requestedBy: null }),
      base({ entryPoint: 'admin.copilot', requestedByType: 'staff', requestedBy: actor, customerId: actor }),
      base({ entryPoint: 'admin.board.briefing', requestedByType: 'staff', requestedBy: actor, customerId: actor }),
      base({ entryPoint: 'schedule.scan', requestedByType: 'schedule', requestedBy: actor }),
      base({ entryPoint: 'schedule.scan', requestedByType: 'staff', requestedBy: actor }),
      base({ entryPoint: 'schedule.board.briefing', requestedByType: 'staff', requestedBy: actor }),
      base({ entryPoint: 'workflow.event', requestedByType: 'workflow', requestedBy: actor }),
      base({ entryPoint: 'workflow.event', requestedByType: 'staff', requestedBy: actor }),
      base({ entryPoint: 'customer.account_assistant', requestedByType: 'customer', requestedBy: actor, customerId: other }),
      base({ entryPoint: 'customer.account_assistant', requestedByType: 'staff', requestedBy: actor }),
      base({ entryPoint: 'customer.website_launch', requestedByType: 'system', requestedBy: actor }),
      base({ entryPoint: 'customer.website_launch', requestedByType: 'system', customerId: actor }),
      base({ entryPoint: 'customer.website_launch', requestedByType: 'customer', requestedBy: actor, customerId: other }),
      base({ entryPoint: 'board.child', requestedByType: 'staff', requestedBy: actor }),
      base({ entryPoint: 'board.child', requestedByType: 'board', customerId: actor }),
      base({ entryPoint: 'board.child', requestedByType: 'customer', requestedBy: actor, customerId: other }),
    ];
    for (const input of invalid) {
      expect(() => assertEntryPointContract(input), JSON.stringify({ ...input, agentId: undefined })).toThrow(OrchestrationContractError);
    }
  });

  it('accepts every documented scope shape for its entry point', () => {
    const actor = '00000000-0000-4000-8000-000000000001';
    const valid: CreateTaskInput[] = [
      base({ entryPoint: 'admin.task', requestedByType: 'staff', requestedBy: actor }),
      base({ entryPoint: 'admin.task', requestedByType: 'staff', requestedBy: actor, customerId: actor }),
      base({ entryPoint: 'admin.copilot', requestedByType: 'staff', requestedBy: actor }),
      base({ entryPoint: 'admin.board.briefing', requestedByType: 'staff', requestedBy: actor }),
      base({ entryPoint: 'schedule.scan', requestedByType: 'schedule', requestedBy: null }),
      base({ entryPoint: 'schedule.board.briefing', requestedByType: 'schedule', requestedBy: null }),
      base({ entryPoint: 'workflow.event', requestedByType: 'workflow', requestedBy: null, customerId: actor }),
      base({ entryPoint: 'workflow.event', requestedByType: 'workflow', requestedBy: null }),
      base({ entryPoint: 'customer.account_assistant', requestedByType: 'customer', requestedBy: actor, customerId: actor }),
      base({ entryPoint: 'customer.website_launch', requestedByType: 'customer', requestedBy: actor, customerId: actor }),
      base({ entryPoint: 'customer.website_launch', requestedByType: 'system', requestedBy: null, customerId: null }),
      base({ entryPoint: 'board.child', requestedByType: 'board', requestedBy: null }),
      base({ entryPoint: 'board.child', requestedByType: 'customer', requestedBy: actor, customerId: actor }),
    ];
    for (const input of valid) expect(() => assertEntryPointContract(input)).not.toThrow();
  });

  it('persists the declaring entry point with the created task', async () => {
    const { task, created } = await prepareOrchestratedTask(db, {
      agentId: collectorId,
      taskType: 'billing.overdue_digest',
      entryPoint: 'admin.task',
      requestedByType: 'staff',
      requestedBy: staff,
      context: { probe: randomUUID() },
      idempotencyKey: `contract-provenance:${randomUUID()}`,
    });
    expect(created).toBe(true);
    expect(task.entry_point).toBe('admin.task');
    const { rows } = await db.query<{ entry_point: string | null }>(`SELECT entry_point FROM ai_tasks WHERE id = $1`, [task.id]);
    expect(rows[0]?.entry_point).toBe('admin.task');
  });

  it('treats an idempotency key reused across entry points as a conflict', async () => {
    const key = `contract-cross-entry:${randomUUID()}`;
    const shared = { agentId: collectorId, taskType: 'billing.overdue_digest', requestedByType: 'staff' as const, requestedBy: staff, idempotencyKey: key };
    const first = await prepareOrchestratedTask(db, { ...shared, entryPoint: 'admin.task' });
    expect(first.created).toBe(true);
    await expect(
      prepareOrchestratedTask(db, { ...shared, entryPoint: 'admin.copilot' }),
    ).rejects.toMatchObject({ name: TaskIdentityConflict.name });
    const { rows } = await db.query<{ entry_point: string }>(`SELECT entry_point FROM ai_tasks WHERE idempotency_key = $1`, [key]);
    expect(rows).toHaveLength(1);
    expect(rows[0].entry_point).toBe('admin.task');
  });

  it('admission-checks the agent grant before creating a row (disabled agent)', async () => {
    await db.query(`UPDATE ai_agents SET enabled = false WHERE id = $1`, [collectorId]);
    const before = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM ai_tasks WHERE agent_id = $1`, [collectorId]);
    try {
      await expect(prepareOrchestratedTask(db, {
        agentId: collectorId, taskType: 'billing.overdue_digest', entryPoint: 'admin.task',
        requestedByType: 'staff', requestedBy: staff, idempotencyKey: `contract-disabled:${randomUUID()}`,
      })).rejects.toMatchObject({ name: 'AgentGrantError', statusCode: 409 });
    } finally {
      await db.query(`UPDATE ai_agents SET enabled = true WHERE id = $1`, [collectorId]);
    }
    const after = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM ai_tasks WHERE agent_id = $1`, [collectorId]);
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  it('admission-checks the agent grant before creating a row (undeclared type / missing agent)', async () => {
    const before = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM ai_tasks`);
    await expect(prepareOrchestratedTask(db, {
      agentId: collectorId, taskType: 'not.a.declared.type', entryPoint: 'admin.task',
      requestedByType: 'staff', requestedBy: staff, idempotencyKey: `contract-undeclared:${randomUUID()}`,
    })).rejects.toBeInstanceOf(AgentGrantError);
    await expect(prepareOrchestratedTask(db, {
      agentId: randomUUID(), taskType: 'billing.overdue_digest', entryPoint: 'schedule.scan',
      requestedByType: 'schedule', requestedBy: null, idempotencyKey: `contract-missing-agent:${randomUUID()}`,
    })).rejects.toBeInstanceOf(AgentGrantError);
    const after = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM ai_tasks`);
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  it('still fails a reused key with the precise identity mismatch even when the grant changed', async () => {
    // Reuse must report recorded state (TaskIdentityConflict), not the newer grant state:
    // the executor and callers recheck grants when acting on a reused task.
    const key = `contract-reuse-order:${randomUUID()}`;
    const input = {
      agentId: collectorId, taskType: 'billing.overdue_digest', entryPoint: 'workflow.event' as const,
      requestedByType: 'workflow' as const, requestedBy: null, idempotencyKey: key, context: { a: 1 },
    };
    expect((await prepareOrchestratedTask(db, input)).created).toBe(true);
    await expect(prepareOrchestratedTask(db, { ...input, taskType: 'different.task' }))
      .rejects.toMatchObject({ name: TaskIdentityConflict.name });
    await expect(prepareOrchestratedTask(db, { ...input, entryPoint: 'schedule.scan' as const, requestedByType: 'schedule' as const }))
      .rejects.toMatchObject({ name: TaskIdentityConflict.name });
  });

  it('derives admin versus schedule provenance for executive briefings', async () => {
    const stub: RunTaskFn = async () => ({ task: {} as TaskRow, runStatus: 'queued', pendingApprovals: [] });
    await generateExecutiveBriefing(db, 'daily', staff, stub);
    const admin = await db.query<{ entry_point: string | null }>(
      `SELECT entry_point FROM ai_tasks WHERE task_type = 'board.executive_briefing' AND requested_by = $1`, [staff]);
    expect(admin.rows.map((r) => r.entry_point)).toEqual(['admin.board.briefing']);

    await generateExecutiveBriefing(db, 'weekly', null, stub);
    const scheduled = await db.query<{ entry_point: string | null }>(
      `SELECT entry_point FROM ai_tasks WHERE task_type = 'board.executive_briefing' AND requested_by IS NULL`);
    expect(scheduled.rows.map((r) => r.entry_point)).toEqual(['schedule.board.briefing']);
  });

  it('enforces known entry points in the database and allows legacy NULL provenance', async () => {
    const id = randomUUID();
    await db.query(
      `INSERT INTO ai_tasks (id, agent_id, task_type, context, priority, requested_by_type, entry_point)
       VALUES ($1,$2,'billing.overdue_digest','{}','normal','schedule',NULL)`,
      [id, collectorId],
    );
    await expect(db.query(`UPDATE ai_tasks SET entry_point = 'bogus.entry' WHERE id = $1`, [id]))
      .rejects.toMatchObject({ code: '23514' });
    await db.query(`UPDATE ai_tasks SET entry_point = 'schedule.scan' WHERE id = $1`, [id]);
    const { rows } = await db.query<{ entry_point: string }>(`SELECT entry_point FROM ai_tasks WHERE id = $1`, [id]);
    expect(rows[0].entry_point).toBe('schedule.scan');
  });
});
