import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { seedAgentRegistry } from '../../src/ai-os/registry/seed';
import { getAgentBySlug } from '../../src/ai-os/repositories/registry-repo';
import { createTask, insertRun, completeRun, updateTaskStatus } from '../../src/ai-os/repositories/tasks-repo';
import { createApproval, decideApproval, getApproval, claimApprovalExecution } from '../../src/ai-os/repositories/approvals-repo';
import { executeApprovedApproval, gatedToolCall, runTask, type RunHandles } from '../../src/ai-os/runtime/executor';
import { approvalReviewFingerprint } from '../../src/ai-os/runtime/approval-review';
import { executeToolImplementation } from '../../src/ai-os/tools/implementations';

describe('approval execution safety', () => {
  let db: PGlite;
  let admin: string;
  let alice: string;
  let bob: string;

  async function user(role: string) {
    const id = randomUUID();
    await db.query(`INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'test-hash','Test User',$3)`, [id, `${id}@example.test`, role]);
    return id;
  }
  beforeAll(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
    await seedAgentRegistry(db);
    admin = await user('admin');
    alice = await user('customer');
    bob = await user('customer');
  });
  afterAll(async () => { await db.close(); });

  async function prepare(options: { customer?: boolean; ownerArg?: string; affectedCustomer?: string | null } = {}) {
    const isCustomer = options.customer === true;
    const agent = await getAgentBySlug(db, isCustomer ? 'customer-cloud-assistant' : 'collector');
    if (!agent) throw new Error('agent missing');
    const { task } = await createTask(db, {
      agentId: agent.id, taskType: isCustomer ? 'customer.assistant_query' : 'billing.overdue_digest',
      requestedByType: isCustomer ? 'customer' : 'staff', requestedBy: isCustomer ? alice : admin,
      customerId: isCustomer ? alice : null,
    });
    const run = await insertRun(db, { taskId: task.id, agentId: agent.id, engine: 'deterministic', model: 'native', input: {} });
    await completeRun(db, run.id, 'awaiting_approval');
    await updateTaskStatus(db, task.id, 'awaiting_approval');
    const approval = await createApproval(db, {
      agentId: agent.id, taskId: task.id, runId: run.id,
      argumentsVerified: true, tool: isCustomer ? 'create_ticket' : 'send_notification', action: 'test', reason: 'test', evidence: [], riskLevel: 'high',
      affectedCustomerId: options.affectedCustomer === undefined ? alice : options.affectedCustomer,
      arguments: isCustomer
        ? { userId: options.ownerArg ?? alice, subject: 'Test support', body: 'Need help' }
        : { userId: alice, type: 'AI_TEST', title: 'Test', message: 'Test message' },
    });
    await decideApproval(db, approval.id, 'approved', admin, null);
    return { task, run, approval, agent };
  }

  it('refuses lossy or placeholder approval arguments without storing them', async () => {
    const agent = (await getAgentBySlug(db, 'collector'))!;
    const { task } = await createTask(db, { agentId: agent.id, taskType: 'billing.overdue_digest', requestedByType: 'staff', requestedBy: admin });
    const run = await insertRun(db, { taskId: task.id, agentId: agent.id, engine: 'deterministic', model: 'native', input: {} });
    const handles: RunHandles = { task, agent, runId: run.id, stepOrder: 0, pendingApprovals: [], actorUserId: admin, customerScopeUserId: null };
    const base = { userId: alice, type: 'AI_TEST', title: 'Test', message: 'OK' };
    for (const args of [
      { ...base, message: 'sensitive-marker-'.repeat(150) },
      { ...base, message: 'x'.repeat(10001) },
      { ...base, title: ' Test ' },
      { ...base, extra: 'not-reviewed' },
      { ...base, message: '[redacted]' },
      { ...base, message: 'text…[truncated]' },
    ]) {
      expect(await gatedToolCall(db, handles, 'send_notification', args)).toMatchObject({ status: 'denied', errorCode: 'APPROVAL_ARGUMENTS_NOT_PRESERVABLE' });
    }
    expect(handles.pendingApprovals).toEqual([]);
    expect((await db.query(`SELECT id FROM ai_approvals WHERE task_id = $1`, [task.id])).rows).toHaveLength(0);
    const audit = await db.query<{ arguments: unknown }>(`SELECT arguments FROM ai_audit_logs WHERE task_id = $1 AND error_code = 'APPROVAL_ARGUMENTS_NOT_PRESERVABLE'`, [task.id]);
    expect(audit.rows).toHaveLength(6);
    expect(JSON.stringify(audit.rows)).not.toContain('sensitive-marker');
    const ok = await gatedToolCall(db, handles, 'send_notification', base);
    expect(ok.status).toBe('pending_approval');
    const saved = await getApproval(db, ok.approvalId!);
    expect(saved?.arguments_verified).toBe(true);
    expect(saved?.arguments).toEqual(base);
  });

  it('does not execute legacy unverified approval arguments', async () => {
    const { approval } = await prepare();
    await db.query(`UPDATE ai_approvals SET arguments_verified = false WHERE id = $1`, [approval.id]);
    const legacy = (await getApproval(db, approval.id))!;
    const outcome = await executeApprovedApproval(db, legacy.id, admin, approvalReviewFingerprint(legacy));
    expect(outcome).toMatchObject({ ok: false, approvalStatus: 'failed', error: 'Approval arguments lack preservation evidence' });
    expect((await db.query(`SELECT id FROM ai_tool_calls WHERE approval_id = $1`, [legacy.id])).rows).toHaveLength(0);
  });

  it('denies execution if the reviewed proposal changes after the decision', async () => {
    const { approval } = await prepare();
    await db.query(`UPDATE ai_approvals SET arguments = $2 WHERE id = $1`, [approval.id, JSON.stringify({ userId: bob, type: 'AI_TEST', title: 'Changed', message: 'Changed' })]);
    const outcome = await executeApprovedApproval(db, approval.id, admin, approvalReviewFingerprint(approval));
    expect(outcome).toMatchObject({ ok: false, approvalStatus: 'failed', error: 'Approval changed after review' });
    expect((await db.query(`SELECT id FROM ai_tool_calls WHERE approval_id = $1`, [approval.id])).rows).toHaveLength(0);
    expect((await db.query(`SELECT id FROM user_notifications WHERE user_id = $1 AND title = 'Changed'`, [bob])).rows).toHaveLength(0);
  });

  it('denies internal knowledge search for a customer even with a stale agent grant or direct scoped call', async () => {
    const agent = await getAgentBySlug(db, 'customer-cloud-assistant');
    if (!agent) throw new Error('agent missing');
    const { task } = await createTask(db, { agentId: agent.id, taskType: 'customer.assistant_query', requestedByType: 'customer', requestedBy: alice, customerId: alice });
    const run = await insertRun(db, { taskId: task.id, agentId: agent.id, engine: 'deterministic', model: 'native', input: {} });
    const handles: RunHandles = { task, agent: { ...agent, tools: [...agent.tools, 'search_knowledge'], permissions: [...agent.permissions, 'ai.knowledge.read'] }, runId: run.id, stepOrder: 0, pendingApprovals: [], actorUserId: alice, customerScopeUserId: alice };
    const outcome = await gatedToolCall(db, handles, 'search_knowledge', { query: 'private runbook' });
    expect(outcome).toMatchObject({ status: 'denied', errorCode: 'NOT_CUSTOMER_USABLE' });
    expect(await executeToolImplementation({ db, customerScopeUserId: alice }, 'search_knowledge', { query: 'private runbook' })).toMatchObject({ ok: false, code: 'NOT_CUSTOMER_USABLE' });
    expect((await db.query(`SELECT id FROM ai_tool_calls WHERE task_id = $1 AND tool = 'search_knowledge'`, [task.id])).rows).toHaveLength(0);
  });

  it('validates and scopes tool arguments before creating an approval', async () => {
    const agent = await getAgentBySlug(db, 'customer-cloud-assistant');
    if (!agent) throw new Error('agent missing');
    const { task } = await createTask(db, { agentId: agent.id, taskType: 'customer.assistant_query', requestedByType: 'customer', requestedBy: alice, customerId: alice });
    const run = await insertRun(db, { taskId: task.id, agentId: agent.id, engine: 'deterministic', model: 'native', input: {} });
    const handles: RunHandles = { task, agent: { ...agent, approval_policy: 'strict' }, runId: run.id, stepOrder: 0, pendingApprovals: [], actorUserId: alice, customerScopeUserId: alice };
    const invalid = await gatedToolCall(db, handles, 'create_ticket', { userId: 'bad', subject: 'Test', body: 'Test' });
    expect(invalid.errorCode).toBe('INVALID_ARGUMENTS');
    const mismatch = await gatedToolCall(db, handles, 'create_ticket', { userId: bob, subject: 'Test', body: 'Test' });
    expect(mismatch.errorCode).toBe('CUSTOMER_SCOPE_MISMATCH');
    const count = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM ai_approvals WHERE task_id = $1`, [task.id]);
    expect(count.rows[0]?.count).toBe('0');
  });

  it('derives customer scope from the persisted task and rejects mismatched scope', async () => {
    const agent = await getAgentBySlug(db, 'customer-cloud-assistant');
    if (!agent) throw new Error('agent missing');
    const make = () => createTask(db, { agentId: agent.id, taskType: 'customer.assistant_query', context: { message: 'show my invoices' }, requestedByType: 'customer', requestedBy: alice, customerId: alice });
    const { task } = await make();
    const result = await runTask(db, task.id);
    expect(result.runStatus).toBe('succeeded');
    const calls = await db.query<{ arguments: { userId: string } }>(`SELECT arguments FROM ai_tool_calls WHERE task_id = $1 AND tool = 'list_invoices'`, [task.id]);
    expect(calls.rows[0]?.arguments.userId).toBe(alice);
    const other = await make();
    await expect(runTask(db, other.task.id, { customerScopeUserId: bob })).rejects.toMatchObject({ code: 'CUSTOMER_SCOPE_INVALID' });
    expect((await db.query<{ status: string }>(`SELECT status FROM ai_tasks WHERE id = $1`, [other.task.id])).rows[0]?.status).toBe('queued');
    await expect(runTask(db, other.task.id, { actorUserId: bob })).rejects.toMatchObject({ code: 'CUSTOMER_SCOPE_INVALID' });
    expect((await db.query(`SELECT id FROM ai_runs WHERE task_id = $1`, [other.task.id])).rows).toHaveLength(0);
    const missing = await createTask(db, { agentId: agent.id, taskType: 'customer.assistant_query', requestedByType: 'customer' });
    await expect(runTask(db, missing.task.id)).rejects.toMatchObject({ code: 'CUSTOMER_SCOPE_INVALID' });
    expect((await db.query<{ status: string }>(`SELECT status FROM ai_tasks WHERE id = $1`, [missing.task.id])).rows[0]?.status).toBe('queued');
    // A mismatched actor must not receive even an already-completed task's result/context.
    const rejected = await runTask(db, task.id, { actorUserId: bob, customerScopeUserId: bob }).then(() => null, (error: Error & { code: string }) => error);
    expect(rejected).toMatchObject({ code: 'CUSTOMER_SCOPE_INVALID', message: 'Task scope is invalid' });
    expect(JSON.stringify(rejected)).not.toContain('show my invoices');
    expect((await db.query<{ n: number }>(`SELECT count(*)::int n FROM ai_audit_logs WHERE action = 'ai.run.blocked' AND error_code = 'CUSTOMER_SCOPE_INVALID' AND task_id = $1`, [other.task.id])).rows[0]?.n).toBe(2);
    expect((await runTask(db, other.task.id, { actorUserId: alice, customerScopeUserId: alice })).runStatus).toBe('succeeded');
  });

  it('refuses a suspended customer before claiming a task or returning its completed state', async () => {
    const agent = await getAgentBySlug(db, 'customer-cloud-assistant');
    if (!agent) throw new Error('agent missing');
    const owner = await user('customer');
    const { task } = await createTask(db, { agentId: agent.id, taskType: 'customer.assistant_query', context: { message: 'show my invoices' }, requestedByType: 'customer', requestedBy: owner, customerId: owner });
    await db.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [owner]);
    await expect(runTask(db, task.id, { actorUserId: owner, customerScopeUserId: owner })).rejects.toMatchObject({ code: 'CUSTOMER_SCOPE_INVALID' });
    expect((await db.query<{ status: string }>(`SELECT status FROM ai_tasks WHERE id = $1`, [task.id])).rows[0]?.status).toBe('queued');
    expect((await db.query(`SELECT id FROM ai_runs WHERE task_id = $1`, [task.id])).rows).toHaveLength(0);
    await db.query(`UPDATE users SET status = 'active' WHERE id = $1`, [owner]);
    expect((await runTask(db, task.id, { actorUserId: owner, customerScopeUserId: owner })).runStatus).toBe('succeeded');
    await db.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [owner]);
    await expect(runTask(db, task.id, { actorUserId: owner, customerScopeUserId: owner })).rejects.toMatchObject({ code: 'CUSTOMER_SCOPE_INVALID' });
  });

  it('rejects an impersonated staff actor without claiming or returning the task', async () => {
    const agent = await getAgentBySlug(db, 'collector');
    if (!agent) throw new Error('agent missing');
    const { task } = await createTask(db, { agentId: agent.id, taskType: 'billing.overdue_digest', requestedByType: 'staff', requestedBy: admin });
    await expect(runTask(db, task.id, { actorUserId: bob })).rejects.toMatchObject({ code: 'CUSTOMER_SCOPE_INVALID' });
    expect((await db.query<{ status: string }>(`SELECT status FROM ai_tasks WHERE id = $1`, [task.id])).rows[0]?.status).toBe('queued');
    expect((await db.query(`SELECT id FROM ai_runs WHERE task_id = $1`, [task.id])).rows).toHaveLength(0);
  });

  it('atomically claims a queued task so concurrent callers cannot run the handler twice', async () => {
    const agent = await getAgentBySlug(db, 'customer-cloud-assistant');
    if (!agent) throw new Error('agent missing');
    const { task } = await createTask(db, { agentId: agent.id, taskType: 'customer.assistant_query', context: { message: 'show my invoices' }, requestedByType: 'customer', requestedBy: alice, customerId: alice });
    await Promise.all([runTask(db, task.id), runTask(db, task.id)]);
    const runs = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM ai_runs WHERE task_id = $1`, [task.id]);
    expect(runs.rows[0]?.count).toBe('1');
    const calls = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM ai_tool_calls WHERE task_id = $1 AND tool = 'list_invoices'`, [task.id]);
    expect(calls.rows[0]?.count).toBe('1');
  });

  it('rejects a task type not granted to the agent even when a task row exists', async () => {
    const agent = await getAgentBySlug(db, 'collector');
    if (!agent) throw new Error('agent missing');
    const { task } = await createTask(db, { agentId: agent.id, taskType: 'customer.profile', requestedByType: 'staff', requestedBy: admin });
    const result = await runTask(db, task.id, { actorUserId: admin });
    expect(result.runStatus).toBe('failed');
    expect(result.task.error_code).toBe('TASK_NOT_GRANTED');
  });

  it('claims concurrent executions once and creates at most one notification', async () => {
    const { approval } = await prepare();
    const [one, two] = await Promise.all([executeApprovedApproval(db, approval.id, admin, approvalReviewFingerprint(approval)), executeApprovedApproval(db, approval.id, admin, approvalReviewFingerprint(approval))]);
    expect([one.ok, two.ok].filter(Boolean)).toHaveLength(1);
    expect((await getApproval(db, approval.id))?.status).toBe('executed');
    const calls = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM ai_tool_calls WHERE approval_id = $1 AND success = true`, [approval.id]);
    expect(calls.rows[0]?.count).toBe('1');
  });

  it('keeps a claimed interrupted action from being automatically replayed', async () => {
    const { approval } = await prepare();
    expect((await claimApprovalExecution(db, approval.id, admin))?.status).toBe('executing');
    const outcome = await executeApprovedApproval(db, approval.id, admin, approvalReviewFingerprint(approval));
    expect(outcome.ok).toBe(false);
    expect((await getApproval(db, approval.id))?.status).toBe('executing');
    const calls = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM ai_tool_calls WHERE approval_id = $1`, [approval.id]);
    expect(calls.rows[0]?.count).toBe('0');
  });

  it('denies an action if the agent was disabled before execution', async () => {
    const { approval, agent } = await prepare();
    await db.query(`UPDATE ai_agents SET enabled = false WHERE id = $1`, [agent.id]);
    try {
      const outcome = await executeApprovedApproval(db, approval.id, admin, approvalReviewFingerprint(approval));
      expect(outcome.ok).toBe(false);
      expect((await getApproval(db, approval.id))?.status).toBe('failed');
    } finally { await db.query(`UPDATE ai_agents SET enabled = true WHERE id = $1`, [agent.id]); }
  });

  it('denies when the approver no longer has the role', async () => {
    const approver = await user('admin');
    const { approval } = await prepare();
    await db.query(`UPDATE ai_approvals SET decision_by = $2 WHERE id = $1`, [approval.id, approver]);
    await db.query(`UPDATE users SET role = 'customer' WHERE id = $1`, [approver]);
    const outcome = await executeApprovedApproval(db, approval.id, approver, approvalReviewFingerprint(approval));
    expect(outcome.ok).toBe(false);
    expect((await getApproval(db, approval.id))?.status).toBe('failed');
  });

  it('denies an approval whose tool grant was revoked', async () => {
    const { approval, agent } = await prepare();
    await db.query(`UPDATE ai_agents SET tools = '[]'::jsonb WHERE id = $1`, [agent.id]);
    try {
      const outcome = await executeApprovedApproval(db, approval.id, admin, approvalReviewFingerprint(approval));
      expect(outcome.ok).toBe(false);
      expect((await getApproval(db, approval.id))?.status).toBe('failed');
    } finally { await db.query(`UPDATE ai_agents SET tools = $2 WHERE id = $1`, [agent.id, JSON.stringify(agent.tools)]); }
  });

  it('denies a customer-originated approval if the customer is suspended', async () => {
    const { approval } = await prepare({ customer: true });
    const before = (await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM support_tickets`)).rows[0]?.count;
    await db.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [alice]);
    try {
      const outcome = await executeApprovedApproval(db, approval.id, admin, approvalReviewFingerprint(approval));
      expect(outcome).toMatchObject({ ok: false, approvalStatus: 'failed', error: 'Customer account is unavailable' });
      expect((await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM support_tickets`)).rows[0]?.count).toBe(before);
      expect((await db.query(`SELECT id FROM ai_tool_calls WHERE approval_id = $1`, [approval.id])).rows).toHaveLength(0);
      expect((await db.query(`SELECT id FROM ai_audit_logs WHERE approval_id = $1 AND action = 'ai.approval.execution_denied'`, [approval.id])).rows).toHaveLength(1);
    } finally { await db.query(`UPDATE users SET status = 'active' WHERE id = $1`, [alice]); }
    expect((await executeApprovedApproval(db, approval.id, admin, approvalReviewFingerprint(approval))).ok).toBe(false);
  });

  it('leaves the claim executing if auditing an authorization denial fails', async () => {
    const { approval, agent } = await prepare();
    await db.query(`UPDATE ai_agents SET enabled = false WHERE id = $1`, [agent.id]);
    await db.exec(`CREATE FUNCTION fail_approval_denial_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action = 'ai.approval.execution_denied' THEN RAISE EXCEPTION 'injected denial audit failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_approval_denial_audit BEFORE INSERT ON ai_audit_logs FOR EACH ROW EXECUTE FUNCTION fail_approval_denial_audit();`);
    try {
      await expect(executeApprovedApproval(db, approval.id, admin, approvalReviewFingerprint(approval))).rejects.toThrow('injected denial audit failure');
      expect((await getApproval(db, approval.id))?.status).toBe('executing');
      expect((await db.query(`SELECT id FROM ai_tool_calls WHERE approval_id = $1`, [approval.id])).rows).toHaveLength(0);
    } finally {
      await db.exec(`DROP TRIGGER fail_approval_denial_audit ON ai_audit_logs; DROP FUNCTION fail_approval_denial_audit();`);
      await db.query(`UPDATE ai_agents SET enabled = true WHERE id = $1`, [agent.id]);
    }
    expect((await executeApprovedApproval(db, approval.id, admin, approvalReviewFingerprint(approval))).ok).toBe(false);
    expect((await getApproval(db, approval.id))?.status).toBe('executing');
  });

  it('executes a customer-originated ticket only in the original customer scope', async () => {
    const { approval } = await prepare({ customer: true });
    const outcome = await executeApprovedApproval(db, approval.id, admin, approvalReviewFingerprint(approval));
    expect(outcome.ok).toBe(true);
    const tickets = await db.query<{ user_id: string }>(`SELECT user_id FROM support_tickets WHERE subject = 'Test support'`);
    expect(tickets.rows).toHaveLength(1);
    expect(tickets.rows[0]?.user_id).toBe(alice);
  });

  it('does not replay a tool effect when final approval auditing fails', async () => {
    const { approval } = await prepare({ customer: true });
    const before = Number((await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM support_tickets`)).rows[0]?.count);
    await db.exec(`CREATE FUNCTION fail_approval_final_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action = 'ai.approval.executed' THEN RAISE EXCEPTION 'injected final audit failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_approval_final_audit BEFORE INSERT ON ai_audit_logs FOR EACH ROW EXECUTE FUNCTION fail_approval_final_audit();`);
    try {
      await expect(executeApprovedApproval(db, approval.id, admin, approvalReviewFingerprint(approval))).rejects.toThrow('injected final audit failure');
      expect((await getApproval(db, approval.id))?.status).toBe('executing');
      expect(Number((await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM support_tickets`)).rows[0]?.count)).toBe(before + 1);
    } finally { await db.exec(`DROP TRIGGER fail_approval_final_audit ON ai_audit_logs; DROP FUNCTION fail_approval_final_audit();`); }
    expect((await executeApprovedApproval(db, approval.id, admin, approvalReviewFingerprint(approval))).ok).toBe(false);
    expect((await getApproval(db, approval.id))?.status).toBe('executing');
    expect(Number((await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM support_tickets`)).rows[0]?.count)).toBe(before + 1);
  });

  it('rejects sealed arguments naming a different customer rather than silently changing them', async () => {
    const { approval } = await prepare({ customer: true, ownerArg: bob });
    const before = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM support_tickets`);
    const outcome = await executeApprovedApproval(db, approval.id, admin, approvalReviewFingerprint(approval));
    const after = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM support_tickets`);
    expect(outcome.ok).toBe(false);
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });

  it('fails closed when the affected customer does not match customer scope', async () => {
    const { approval } = await prepare({ customer: true, affectedCustomer: bob });
    const before = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM support_tickets`);
    const outcome = await executeApprovedApproval(db, approval.id, admin, approvalReviewFingerprint(approval));
    const after = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM support_tickets`);
    expect(outcome.ok).toBe(false);
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });

  it('does not claim an expired approval or allow a different approver to claim it', async () => {
    const { approval } = await prepare();
    const other = await user('admin');
    expect((await executeApprovedApproval(db, approval.id, other, approvalReviewFingerprint(approval))).ok).toBe(false);
    expect((await getApproval(db, approval.id))?.status).toBe('approved');
    await db.query(`UPDATE ai_approvals SET expires_at = now() - interval '1 second' WHERE id = $1`, [approval.id]);
    expect((await executeApprovedApproval(db, approval.id, admin, approvalReviewFingerprint(approval))).ok).toBe(false);
    expect((await getApproval(db, approval.id))?.status).toBe('approved');
  });

  it('does not replay an awaiting-approval task as a fresh run', async () => {
    const { task, approval } = await prepare();
    const result = await runTask(db, task.id, { actorUserId: admin });
    expect(result.runStatus).toBe('awaiting_approval');
    const approvals = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM ai_approvals WHERE task_id = $1`, [task.id]);
    expect(approvals.rows[0]?.count).toBe('1');
    expect((await getApproval(db, approval.id))?.status).toBe('approved');
  });
});
