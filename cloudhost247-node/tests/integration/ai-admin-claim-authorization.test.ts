import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { seedAgentRegistry } from '../../src/ai-os/registry/seed';
import { getAgentBySlug } from '../../src/ai-os/repositories/registry-repo';
import { createTask, getTask } from '../../src/ai-os/repositories/tasks-repo';
import { runTask } from '../../src/ai-os/runtime/executor';
import type { OrchestrationEntryPoint } from '../../src/ai-os/runtime/orchestration-contract';

describe('administrative task claim authorization', () => {
  let db: PGlite;
  let actor: string, agentId: string;
  beforeAll(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
    await seedAgentRegistry(db);
    actor = randomUUID();
    await db.query(`INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'hash','Admin','admin')`, [actor, `${actor}@claim.test`]);
    agentId = (await getAgentBySlug(db, 'collector'))!.id;
  });
  afterAll(async () => { await db.close(); });
  async function task(entryPoint: OrchestrationEntryPoint) {
    return (await createTask(db, { agentId, taskType: 'billing.overdue_digest', entryPoint, requestedByType: 'staff', requestedBy: actor })).task;
  }

  it.each(['admin.task', 'admin.copilot', 'admin.board.briefing'] as const)('denies a demoted actor before claiming %s', async (entryPoint) => {
    const created = await task(entryPoint);
    await db.query(`UPDATE users SET role = 'staff' WHERE id = $1`, [actor]);
    try {
      await expect(runTask(db, created.id, { actorUserId: actor })).rejects.toMatchObject({ code: 'REQUESTER_AUTHORIZATION_UNAVAILABLE' });
      expect((await getTask(db, created.id))?.status).toBe('queued');
      expect((await db.query(`SELECT id FROM ai_runs WHERE task_id = $1`, [created.id])).rows).toHaveLength(0);
      expect((await db.query(`SELECT id FROM ai_tool_calls WHERE task_id = $1`, [created.id])).rows).toHaveLength(0);
      expect((await db.query(`SELECT id FROM ai_audit_logs WHERE task_id = $1 AND error_code = 'REQUESTER_AUTHORIZATION_UNAVAILABLE'`, [created.id])).rows).toHaveLength(1);
    } finally { await db.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [actor]); }
  });

  it('denies a suspended requester before claiming', async () => {
    const created = await task('admin.task');
    await db.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [actor]);
    try {
      await expect(runTask(db, created.id, { actorUserId: actor })).rejects.toMatchObject({ code: 'REQUESTER_AUTHORIZATION_UNAVAILABLE' });
      expect((await getTask(db, created.id))?.status).toBe('queued');
      expect((await db.query(`SELECT id FROM ai_runs WHERE task_id = $1`, [created.id])).rows).toHaveLength(0);
    } finally { await db.query(`UPDATE users SET status = 'active' WHERE id = $1`, [actor]); }
  });

  it('permits a still-authorized original requester and maintains a single-winner claim', async () => {
    const created = await task('admin.task');
    const results = await Promise.all([runTask(db, created.id, { actorUserId: actor }), runTask(db, created.id, { actorUserId: actor })]);
    expect(results.some((r) => r.runStatus === 'succeeded')).toBe(true);
    expect((await db.query(`SELECT id FROM ai_runs WHERE task_id = $1`, [created.id])).rows).toHaveLength(1);
  });
});
