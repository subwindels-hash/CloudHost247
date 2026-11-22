import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { seedAgentRegistry } from '../../src/ai-os/registry/seed';
import { getAgentBySlug } from '../../src/ai-os/repositories/registry-repo';
import { createTask, insertRun, completeRun, updateTaskStatus } from '../../src/ai-os/repositories/tasks-repo';
import { createApproval, decideApproval, getApproval, claimApprovalExecution } from '../../src/ai-os/repositories/approvals-repo';
import { approvalEffectKey, claimEffectIntent, countStrandedEffects, getEffectIntent, listStrandedEffects, recordEffectIntent } from '../../src/ai-os/repositories/effect-outbox';
import { decideAuthorizedApproval } from '../../src/ai-os/runtime/approval-decision';
import { approvalReviewFingerprint } from '../../src/ai-os/runtime/approval-review';
import { executeApprovedApproval } from '../../src/ai-os/runtime/executor';
import { runAiSweep } from '../../src/ai-os/jobs/sweep';
import { withTransaction } from '../../src/db/transaction';
import { signAuthToken } from '../../src/lib/jwt';

const env = loadEnv({
  NODE_ENV: 'test', DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
  JWT_SECRET: 'o'.repeat(40), LOG_LEVEL: 'silent',
});

describe('external-effect outbox for approval executions', () => {
  let db: PGlite;
  let app: ReturnType<typeof buildApp>;
  let admin: { userId: string; token: string };
  let staff: { userId: string; token: string };
  let alice: string;

  async function user(role: string) {
    const userId = randomUUID();
    await db.query(
      `INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'hash','Outbox User',$3)`,
      [userId, `${userId}@outbox.test`, role],
    );
    return { userId, token: signAuthToken(env, { sub: userId, role, email: `${userId}@outbox.test` }) };
  }

  beforeAll(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
    await seedAgentRegistry(db);
    app = buildApp(env, { serveFrontend: false, pool: db });
    admin = await user('admin');
    staff = await user('staff');
    alice = randomUUID();
    await db.query(
      `INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'hash','Alice','customer')`,
      [alice, `${alice}@outbox.test`],
    );
  });
  afterAll(async () => { await db.close(); });

  /** Task + run + approval, optionally decided through the real transactional path (writes intent). */
  async function fixture(decide: 'authorized' | 'legacy' | 'none' = 'authorized') {
    const agent = (await getAgentBySlug(db, 'collector'))!;
    const { task } = await createTask(db, {
      agentId: agent.id, taskType: 'billing.overdue_digest',
      requestedByType: 'staff', requestedBy: admin.userId,
    });
    const run = await insertRun(db, { taskId: task.id, agentId: agent.id, engine: 'deterministic', model: 'native', input: {} });
    await completeRun(db, run.id, 'awaiting_approval');
    await updateTaskStatus(db, task.id, 'awaiting_approval');
    const approval = await createApproval(db, {
      agentId: agent.id, taskId: task.id, runId: run.id,
      argumentsVerified: true, tool: 'send_notification', action: 'test', reason: 'test', evidence: [],
      riskLevel: 'high', affectedCustomerId: alice,
      arguments: { userId: alice, type: 'AI_TEST', title: 'Test', message: 'Test message' },
    });
    if (decide === 'authorized') {
      const decided = await decideAuthorizedApproval(db, {
        id: approval.id, decision: 'approved', actorId: admin.userId, note: null,
        reviewFingerprint: approvalReviewFingerprint(approval), auditContext: {},
      });
      expect(decided).not.toBeNull();
    } else if (decide === 'legacy') {
      // Pre-0117 shape: decision without any outbox machinery.
      expect(await decideApproval(db, approval.id, 'approved', admin.userId, null)).not.toBeNull();
    }
    return { task, run, approval };
  }

  const intentFor = async (approvalId: string) => {
    const { rows } = await db.query<{ id: string }>(`SELECT id FROM ai_effect_outbox WHERE approval_id = $1`, [approvalId]);
    return rows[0] ? await getEffectIntent(db, rows[0].id) : null;
  };

  it('commits the effect intent atomically with an approved decision — and never for a rejection', async () => {
    const { approval } = await fixture('authorized');
    const intent = await intentFor(approval.id);
    expect(intent).toMatchObject({ effect_key: approvalEffectKey(approval.id), kind: 'approval_execution', status: 'pending', attempts: 0 });

    const rejected = await fixture('none');
    const denied = await decideAuthorizedApproval(db, {
      id: rejected.approval.id, decision: 'rejected', actorId: admin.userId, note: 'no',
      reviewFingerprint: approvalReviewFingerprint(rejected.approval), auditContext: {},
    });
    expect(denied).not.toBeNull();
    expect(await intentFor(rejected.approval.id)).toBeNull();
  });

  it('claims the intent with the execution claim and records the outcome atomically', async () => {
    const { approval } = await fixture('authorized');
    const outcome = await executeApprovedApproval(db, approval.id, admin.userId, approvalReviewFingerprint(approval));
    expect(outcome).toMatchObject({ ok: true, approvalStatus: 'executed' });
    const intent = await intentFor(approval.id);
    expect(intent).toMatchObject({ status: 'succeeded', attempts: 1 });
    expect(intent?.dispatched_at).not.toBeNull();
    expect(intent?.outcome_at).not.toBeNull();
    expect(intent?.outcome_error).toBeNull();
    const notifications = await db.query(`SELECT id FROM user_notifications WHERE user_id = $1 AND title = 'Test'`, [alice]);
    expect(notifications.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('closes the intent as failed when pre-effect reauthorization denies — no effect ran', async () => {
    const { approval } = await fixture('authorized');
    const outcome = await executeApprovedApproval(db, approval.id, admin.userId, 'f'.repeat(64));
    expect(outcome).toMatchObject({ ok: false, approvalStatus: 'failed' });
    const intent = await intentFor(approval.id);
    expect(intent).toMatchObject({ status: 'failed' });
    expect(intent?.outcome_error).toContain('changed after review');
    expect((await db.query(`SELECT id FROM ai_tool_calls WHERE approval_id = $1`, [approval.id])).rows).toHaveLength(0);
  });

  it('detects a decided-but-never-started intent without touching it', async () => {
    const { approval } = await fixture('authorized');
    await db.query(`UPDATE ai_effect_outbox SET created_at = now() - interval '10 minutes' WHERE approval_id = $1`, [approval.id]);
    const counts = await countStrandedEffects(db);
    expect(counts.pending).toBeGreaterThanOrEqual(1);
    const listed = await listStrandedEffects(db, { olderThanMinutes: 5 });
    const row = listed.find((r) => r.approval_id === approval.id);
    expect(row).toMatchObject({ status: 'pending' });
    // Detection changes nothing.
    expect((await getEffectIntent(db, row!.id))?.status).toBe('pending');
    expect((await getApproval(db, approval.id))?.status).toBe('approved');
  });

  it('detects a started intent with no recorded outcome (crash mid-execution)', async () => {
    const { approval } = await fixture('authorized');
    const claimed = await withTransaction(db, async (tx) => {
      const a = await claimApprovalExecution(tx, approval.id, admin.userId);
      const i = await claimEffectIntent(tx, approvalEffectKey(approval.id));
      return { approval: !!a, intent: i };
    });
    expect(claimed).toEqual({ approval: true, intent: true });
    await db.query(`UPDATE ai_effect_outbox SET dispatched_at = now() - interval '10 minutes' WHERE approval_id = $1`, [approval.id]);
    const counts = await countStrandedEffects(db);
    expect(counts.dispatched).toBeGreaterThanOrEqual(1);
    expect((await getApproval(db, approval.id))?.status).toBe('executing');
    expect(await intentFor(approval.id)).toMatchObject({ status: 'dispatched', attempts: 1 });
  });

  it('keeps pre-outbox approvals (no intent row) fully working', async () => {
    const { approval } = await fixture('legacy');
    expect(await intentFor(approval.id)).toBeNull();
    const outcome = await executeApprovedApproval(db, approval.id, admin.userId, approvalReviewFingerprint(approval));
    expect(outcome).toMatchObject({ ok: true, approvalStatus: 'executed' });
    expect(await intentFor(approval.id)).toBeNull(); // no row was invented for a legacy decision
    expect((await getApproval(db, approval.id))?.status).toBe('executed');
  });

  it('lists stranded intents for approval viewers only', async () => {
    const denied = await app.inject({ method: 'GET', url: '/api/v1/admin/ai/effect-outbox', headers: { authorization: `Bearer ${staff.token}` } });
    expect(denied.statusCode).toBe(403);
    const ok = await app.inject({ method: 'GET', url: '/api/v1/admin/ai/effect-outbox', headers: { authorization: `Bearer ${admin.token}` } });
    expect(ok.statusCode).toBe(200);
    const body = ok.json() as { count: number; intents: Array<{ status: string }>; note: string };
    expect(body.count).toBeGreaterThanOrEqual(2);
    expect(body.intents.every((i) => i.status === 'pending' || i.status === 'dispatched')).toBe(true);
    expect(body.note).toContain('replayed automatically');
  });

  it('allows only one concurrent approval execution and intent claim', async () => {
    const { approval } = await fixture('authorized');
    const fingerprint = approvalReviewFingerprint(approval);
    const results = await Promise.all([
      executeApprovedApproval(db, approval.id, admin.userId, fingerprint),
      executeApprovedApproval(db, approval.id, admin.userId, fingerprint),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await intentFor(approval.id)).toMatchObject({ status: 'succeeded', attempts: 1 });
    const calls = await db.query(`SELECT id FROM ai_tool_calls WHERE approval_id = $1 AND success = true`, [approval.id]);
    expect(calls.rows).toHaveLength(1);
  });

  it('never executes an approval whose existing intent is not pending', async () => {
    const { approval } = await fixture('authorized');
    await db.query(`UPDATE ai_effect_outbox SET status = 'needs_review' WHERE approval_id = $1`, [approval.id]);
    await expect(executeApprovedApproval(db, approval.id, admin.userId, approvalReviewFingerprint(approval)))
      .rejects.toThrow('Effect intent cannot be claimed');
    expect((await getApproval(db, approval.id))?.status).toBe('approved');
    expect((await intentFor(approval.id))?.status).toBe('needs_review');
    expect((await db.query(`SELECT id FROM ai_tool_calls WHERE approval_id = $1`, [approval.id])).rows).toHaveLength(0);
  });

  it('reports stranded intents from the sweep without changing them', async () => {
    const { approval } = await fixture('authorized');
    await db.query(`UPDATE ai_effect_outbox SET created_at = now() - interval '10 minutes' WHERE approval_id = $1`, [approval.id]);
    const before = await getEffectIntent(db, (await intentFor(approval.id))!.id);
    const result = await runAiSweep(db);
    expect(result.effectIntents.pending).toBeGreaterThanOrEqual(1);
    const after = await getEffectIntent(db, before!.id);
    expect(after).toMatchObject({ status: 'pending', attempts: 0 });
    expect((await getApproval(db, approval.id))?.status).toBe('approved');
  });

  it('rolls back the approval decision if the intent cannot be inserted', async () => {
    const { approval } = await fixture('none');
    await recordEffectIntent(db, { effectKey: approvalEffectKey(approval.id), kind: 'approval_execution', approvalId: approval.id });
    await expect(decideAuthorizedApproval(db, {
      id: approval.id, decision: 'approved', actorId: admin.userId, note: null,
      reviewFingerprint: approvalReviewFingerprint(approval), auditContext: {},
    })).rejects.toThrow();
    expect((await getApproval(db, approval.id))?.status).toBe('pending');
  });
});
