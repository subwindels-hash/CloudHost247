/** Human Decision Inbox persistence (spec §21). */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../../db/types';
import type { ApprovalRow } from '../types';

export interface CreateApprovalInput {
  agentId: string;
  taskId: string | null;
  runId: string | null;
  tool: string;
  action: string;
  reason: string;
  evidence: unknown[];
  riskLevel: string;
  affectedCustomerId?: string | null;
  affectedResource?: string | null;
  arguments: Record<string, unknown>;
  expiresInHours?: number;
}

export async function createApproval(db: Queryable, input: CreateApprovalInput): Promise<ApprovalRow> {
  const hours = Math.min(Math.max(input.expiresInHours ?? 72, 1), 24 * 30);
  const { rows } = await db.query<ApprovalRow>(
    `INSERT INTO ai_approvals (id, agent_id, task_id, run_id, tool, action, reason, evidence, risk_level,
                               affected_customer_id, affected_resource, arguments, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now() + ($13 || ' hours')::interval)
     RETURNING *`,
    [
      randomUUID(),
      input.agentId,
      input.taskId,
      input.runId,
      input.tool,
      input.action,
      input.reason,
      JSON.stringify(input.evidence ?? []),
      input.riskLevel,
      input.affectedCustomerId ?? null,
      input.affectedResource ?? null,
      JSON.stringify(input.arguments ?? {}),
      String(hours),
    ]
  );
  if (!rows[0]) throw new Error('ai_approvals: insert returned no row');
  return rows[0];
}

export async function getApproval(db: Queryable, id: string): Promise<ApprovalRow | null> {
  const { rows } = await db.query<ApprovalRow>(`SELECT * FROM ai_approvals WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function listApprovals(
  db: Queryable,
  opts: { status?: string; customerId?: string; limit?: number; offset?: number } = {}
): Promise<Array<ApprovalRow & { agent_slug: string; agent_name: string }>> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (opts.status) {
    params.push(opts.status);
    conditions.push(`ap.status = $${params.length}`);
  }
  if (opts.customerId) {
    params.push(opts.customerId);
    conditions.push(`ap.affected_customer_id = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(Math.min(Math.max(opts.limit ?? 50, 1), 200));
  const limitPos = params.length;
  params.push(Math.max(opts.offset ?? 0, 0));
  const { rows } = await db.query<ApprovalRow & { agent_slug: string; agent_name: string }>(
    `SELECT ap.*, a.slug AS agent_slug, a.name AS agent_name
     FROM ai_approvals ap JOIN ai_agents a ON a.id = ap.agent_id
     ${where}
     ORDER BY CASE ap.status WHEN 'pending' THEN 0 ELSE 1 END, ap.created_at DESC
     LIMIT $${limitPos} OFFSET $${params.length}`,
    params
  );
  return rows;
}

export async function countPendingApprovals(db: Queryable): Promise<number> {
  const { rows } = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM ai_approvals WHERE status = 'pending'`);
  return Number(rows[0]?.count ?? 0);
}

/**
 * Atomic decision claim: only a row still 'pending' can transition to 'approved'/'rejected',
 * so two administrators can never decide the same approval twice (the second gets null back).
 */
export async function decideApproval(
  db: Queryable,
  id: string,
  decision: 'approved' | 'rejected',
  decidedBy: string,
  note: string | null
): Promise<ApprovalRow | null> {
  const { rows } = await db.query<ApprovalRow>(
    `UPDATE ai_approvals SET status = $2, decision_by = $3, decision_at = now(), decision_note = $4, updated_at = now()
     WHERE id = $1 AND status = 'pending' AND expires_at > now()
     RETURNING *`,
    [id, decision, decidedBy, note]
  );
  return rows[0] ?? null;
}

export async function markApprovalExecuted(db: Queryable, id: string, success: boolean, result: unknown): Promise<void> {
  await db.query(
    `UPDATE ai_approvals SET status = $2, executed_at = now(), execution_result = $3, updated_at = now() WHERE id = $1`,
    [id, success ? 'executed' : 'failed', result === undefined ? null : JSON.stringify(result)]
  );
}

export async function expireStaleApprovals(db: Queryable): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE ai_approvals SET status = 'expired', updated_at = now() WHERE status = 'pending' AND expires_at <= now() RETURNING id`
  );
  return rows.length;
}
