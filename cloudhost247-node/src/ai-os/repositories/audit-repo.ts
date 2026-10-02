/** Immutable AI audit trail + evaluations + executive reports + observability aggregates. */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../../db/types';
import type { ExecutiveReportRow } from '../types';

export interface AiAuditEntry {
  agentId?: string | null;
  userId?: string | null;
  taskId?: string | null;
  runId?: string | null;
  approvalId?: string | null;
  action: string;
  tool?: string | null;
  arguments?: unknown;
  result?: unknown;
  decision?: 'approved' | 'rejected' | 'expired' | 'auto' | 'blocked' | null;
  model?: string | null;
  status?: 'ok' | 'denied' | 'error' | 'pending_approval';
  riskLevel?: string | null;
  durationMs?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

/** Append-only audit write. Callers must pass ALREADY-REDACTED arguments/results
 *  (runtime/executor.ts applies redactForStorage before persisting anything). */
export async function recordAiAudit(db: Queryable, entry: AiAuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO ai_audit_logs (id, agent_id, user_id, task_id, run_id, approval_id, action, tool,
                                arguments, result, decision, model, status, risk_level, duration_ms, error_code, error_message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [
      randomUUID(),
      entry.agentId ?? null,
      entry.userId ?? null,
      entry.taskId ?? null,
      entry.runId ?? null,
      entry.approvalId ?? null,
      entry.action,
      entry.tool ?? null,
      entry.arguments === undefined ? null : JSON.stringify(entry.arguments),
      entry.result === undefined ? null : JSON.stringify(entry.result),
      entry.decision ?? null,
      entry.model ?? null,
      entry.status ?? 'ok',
      entry.riskLevel ?? null,
      entry.durationMs ?? null,
      entry.errorCode ?? null,
      entry.errorMessage === undefined || entry.errorMessage === null ? null : String(entry.errorMessage).slice(0, 2000),
    ]
  );
}

export async function listAiAudit(
  db: Queryable,
  opts: { agentId?: string; action?: string; limit?: number; offset?: number } = {}
): Promise<Array<Record<string, unknown>>> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (opts.agentId) {
    params.push(opts.agentId);
    conditions.push(`l.agent_id = $${params.length}`);
  }
  if (opts.action) {
    params.push(opts.action);
    conditions.push(`l.action = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(Math.min(Math.max(opts.limit ?? 100, 1), 500));
  const limitPos = params.length;
  params.push(Math.max(opts.offset ?? 0, 0));
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT l.*, a.slug AS agent_slug, a.name AS agent_name
     FROM ai_audit_logs l LEFT JOIN ai_agents a ON a.id = l.agent_id
     ${where} ORDER BY l.created_at DESC LIMIT $${limitPos} OFFSET $${params.length}`,
    params
  );
  return rows;
}

// ----------------------------------------------------------------------------------------------
// Evaluations

export async function insertEvaluation(
  db: Queryable,
  input: { agentId: string; runId?: string | null; metric: string; value: number; raterId?: string | null; notes?: string | null }
): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO ai_evaluations (id, agent_id, run_id, metric, value, rater_id, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, input.agentId, input.runId ?? null, input.metric, input.value, input.raterId ?? null, input.notes ?? null]
  );
  return id;
}

export async function listEvaluations(db: Queryable, agentId?: string, limit = 100): Promise<Array<Record<string, unknown>>> {
  const params: unknown[] = [];
  let where = '';
  if (agentId) {
    params.push(agentId);
    where = `WHERE e.agent_id = $1`;
  }
  params.push(Math.min(Math.max(limit, 1), 500));
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT e.*, a.slug AS agent_slug, a.name AS agent_name
     FROM ai_evaluations e JOIN ai_agents a ON a.id = e.agent_id
     ${where} ORDER BY e.created_at DESC LIMIT $${params.length}`,
    params
  );
  return rows;
}

// ----------------------------------------------------------------------------------------------
// Executive reports

export async function getExecutiveReport(
  db: Queryable,
  reportType: string,
  periodStart: string,
  periodEnd: string
): Promise<ExecutiveReportRow | null> {
  const { rows } = await db.query<ExecutiveReportRow>(
    `SELECT * FROM ai_executive_reports WHERE report_type = $1 AND period_start = $2 AND period_end = $3 AND status = 'final'
     ORDER BY created_at DESC LIMIT 1`,
    [reportType, periodStart, periodEnd]
  );
  return rows[0] ?? null;
}

export async function insertExecutiveReport(
  db: Queryable,
  input: {
    reportType: string;
    periodStart: string;
    periodEnd: string;
    sections: unknown[];
    metrics: Record<string, unknown>;
    findings: unknown[];
    generatedByAgentId: string | null;
  }
): Promise<ExecutiveReportRow> {
  const { rows } = await db.query<ExecutiveReportRow>(
    `INSERT INTO ai_executive_reports (id, report_type, period_start, period_end, sections, metrics, findings, generated_by_agent_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (report_type, period_start, period_end) WHERE status = 'final' DO NOTHING
     RETURNING *`,
    [
      randomUUID(),
      input.reportType,
      input.periodStart,
      input.periodEnd,
      JSON.stringify(input.sections),
      JSON.stringify(input.metrics),
      JSON.stringify(input.findings),
      input.generatedByAgentId,
    ]
  );
  if (rows[0]) return rows[0];
  const existing = await getExecutiveReport(db, input.reportType, input.periodStart, input.periodEnd);
  if (existing) return existing;
  throw new Error('ai_executive_reports: insert conflict path found no row');
}

export async function listExecutiveReports(db: Queryable, limit = 30): Promise<ExecutiveReportRow[]> {
  const { rows } = await db.query<ExecutiveReportRow>(
    `SELECT * FROM ai_executive_reports ORDER BY period_start DESC, created_at DESC LIMIT $1`,
    [Math.min(Math.max(limit, 1), 100)]
  );
  return rows;
}

export async function getExecutiveReportById(db: Queryable, id: string): Promise<ExecutiveReportRow | null> {
  const { rows } = await db.query<ExecutiveReportRow>(`SELECT * FROM ai_executive_reports WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

// ----------------------------------------------------------------------------------------------
// Observability aggregates (spec §30) — computed live from the execution tables.

export interface ObservabilitySummary {
  totals: {
    agents: number;
    enabledAgents: number;
    tasks: number;
    runs: number;
    toolCalls: number;
    failedRuns: number;
    findingsOpen: number;
    approvalsPending: number;
    eventsUnprocessed: number;
    incidentsOpen: number;
    knowledgeSources: number;
    knowledgeChunks: number;
  };
  perAgent: Array<{
    agentId: string;
    slug: string;
    name: string;
    category: string;
    runs: number;
    succeeded: number;
    failed: number;
    awaitingApproval: number;
    toolCalls: number;
    failedToolCalls: number;
    avgDurationMs: number | null;
    findings: number;
    pendingApprovals: number;
  }>;
  recentErrors: Array<{ id: string; agent: string; action: string; errorCode: string | null; createdAt: string }>;
}

export async function getObservabilitySummary(db: Queryable): Promise<ObservabilitySummary> {
  const totalsRows = await db.query<{
    agents: string; enabled_agents: string; tasks: string; runs: string; tool_calls: string;
    failed_runs: string; findings_open: string; approvals_pending: string; events_unprocessed: string;
    incidents_open: string; knowledge_sources: string; knowledge_chunks: string;
  }>(
    `SELECT
       (SELECT count(*)::text FROM ai_agents) AS agents,
       (SELECT count(*)::text FROM ai_agents WHERE enabled) AS enabled_agents,
       (SELECT count(*)::text FROM ai_tasks) AS tasks,
       (SELECT count(*)::text FROM ai_runs) AS runs,
       (SELECT count(*)::text FROM ai_tool_calls) AS tool_calls,
       (SELECT count(*)::text FROM ai_runs WHERE status = 'failed') AS failed_runs,
       (SELECT count(*)::text FROM ai_findings WHERE status = 'open') AS findings_open,
       (SELECT count(*)::text FROM ai_approvals WHERE status = 'pending') AS approvals_pending,
       (SELECT count(*)::text FROM ai_events WHERE processed_at IS NULL) AS events_unprocessed,
       (SELECT count(*)::text FROM ai_incidents WHERE status IN ('open','investigating')) AS incidents_open,
       (SELECT count(*)::text FROM ai_knowledge_sources WHERE status = 'active') AS knowledge_sources,
       (SELECT count(*)::text FROM ai_knowledge_chunks) AS knowledge_chunks`
  );
  const t = totalsRows.rows[0] ?? ({} as Record<string, string>);

  const perAgent = await db.query<{
    agent_id: string; slug: string; name: string; category: string;
    runs: string; succeeded: string; failed: string; awaiting_approval: string;
    tool_calls: string; failed_tool_calls: string; avg_duration_ms: string | null;
    findings: string; pending_approvals: string;
  }>(
    `SELECT a.id AS agent_id, a.slug, a.name, a.category,
       (SELECT count(*)::text FROM ai_runs r WHERE r.agent_id = a.id) AS runs,
       (SELECT count(*)::text FROM ai_runs r WHERE r.agent_id = a.id AND r.status = 'succeeded') AS succeeded,
       (SELECT count(*)::text FROM ai_runs r WHERE r.agent_id = a.id AND r.status = 'failed') AS failed,
       (SELECT count(*)::text FROM ai_runs r WHERE r.agent_id = a.id AND r.status = 'awaiting_approval') AS awaiting_approval,
       (SELECT count(*)::text FROM ai_tool_calls tc WHERE tc.agent_id = a.id) AS tool_calls,
       (SELECT count(*)::text FROM ai_tool_calls tc WHERE tc.agent_id = a.id AND NOT tc.success) AS failed_tool_calls,
       (SELECT round(avg(r.duration_ms))::text FROM ai_runs r WHERE r.agent_id = a.id AND r.duration_ms IS NOT NULL) AS avg_duration_ms,
       (SELECT count(*)::text FROM ai_findings f WHERE f.agent_id = a.id) AS findings,
       (SELECT count(*)::text FROM ai_approvals ap WHERE ap.agent_id = a.id AND ap.status = 'pending') AS pending_approvals
     FROM ai_agents a
     ORDER BY a.category, a.name`
  );

  const recentErrors = await db.query<{ id: string; agent: string | null; action: string; error_code: string | null; created_at: string }>(
    `SELECT l.id, a.slug AS agent, l.action, l.error_code, l.created_at::text
     FROM ai_audit_logs l LEFT JOIN ai_agents a ON a.id = l.agent_id
     WHERE l.status = 'error' OR l.error_code IS NOT NULL
     ORDER BY l.created_at DESC LIMIT 20`
  );

  return {
    totals: {
      agents: Number(t.agents ?? 0),
      enabledAgents: Number(t.enabled_agents ?? 0),
      tasks: Number(t.tasks ?? 0),
      runs: Number(t.runs ?? 0),
      toolCalls: Number(t.tool_calls ?? 0),
      failedRuns: Number(t.failed_runs ?? 0),
      findingsOpen: Number(t.findings_open ?? 0),
      approvalsPending: Number(t.approvals_pending ?? 0),
      eventsUnprocessed: Number(t.events_unprocessed ?? 0),
      incidentsOpen: Number(t.incidents_open ?? 0),
      knowledgeSources: Number(t.knowledge_sources ?? 0),
      knowledgeChunks: Number(t.knowledge_chunks ?? 0),
    },
    perAgent: perAgent.rows.map((r) => ({
      agentId: r.agent_id,
      slug: r.slug,
      name: r.name,
      category: r.category,
      runs: Number(r.runs),
      succeeded: Number(r.succeeded),
      failed: Number(r.failed),
      awaitingApproval: Number(r.awaiting_approval),
      toolCalls: Number(r.tool_calls),
      failedToolCalls: Number(r.failed_tool_calls),
      avgDurationMs: r.avg_duration_ms === null ? null : Number(r.avg_duration_ms),
      findings: Number(r.findings),
      pendingApprovals: Number(r.pending_approvals),
    })),
    recentErrors: recentErrors.rows.map((r) => ({
      id: r.id,
      agent: r.agent ?? 'unknown',
      action: r.action,
      errorCode: r.error_code,
      createdAt: r.created_at,
    })),
  };
}
