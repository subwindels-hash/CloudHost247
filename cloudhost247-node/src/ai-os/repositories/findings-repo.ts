/** Findings (agent exchange format) + AI incidents persistence. */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../../db/types';
import type { FindingRow, IncidentRow } from '../types';

export interface CreateFindingInput {
  agentId: string;
  runId?: string | null;
  taskId?: string | null;
  findingType: string;
  severity: string;
  title: string;
  summary: string;
  evidence: unknown[];
  subjectType?: string | null;
  subjectId?: string | null;
  recommendation?: string | null;
  /** Dedupe: skip creating an identical OPEN finding (same agent+type+subject+title). */
  dedupeOpen?: boolean;
}

export async function createFinding(db: Queryable, input: CreateFindingInput): Promise<{ finding: FindingRow; created: boolean }> {
  if (input.dedupeOpen !== false) {
    const { rows: existing } = await db.query<FindingRow>(
      `SELECT * FROM ai_findings
       WHERE agent_id = $1 AND finding_type = $2 AND title = $3 AND status = 'open'
         AND subject_type IS NOT DISTINCT FROM $4 AND subject_id IS NOT DISTINCT FROM $5
       ORDER BY created_at DESC LIMIT 1`,
      [input.agentId, input.findingType, input.title, input.subjectType ?? null, input.subjectId ?? null]
    );
    if (existing[0]) return { finding: existing[0], created: false };
  }
  const { rows } = await db.query<FindingRow>(
    `INSERT INTO ai_findings (id, agent_id, run_id, task_id, finding_type, severity, title, summary,
                              evidence, subject_type, subject_id, recommendation)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      randomUUID(),
      input.agentId,
      input.runId ?? null,
      input.taskId ?? null,
      input.findingType,
      input.severity,
      input.title,
      input.summary,
      JSON.stringify(input.evidence ?? []),
      input.subjectType ?? null,
      input.subjectId ?? null,
      input.recommendation ?? null,
    ]
  );
  if (!rows[0]) throw new Error('ai_findings: insert returned no row');
  return { finding: rows[0], created: true };
}

export async function listFindings(
  db: Queryable,
  opts: { status?: string; agentId?: string; severity?: string; limit?: number } = {}
): Promise<Array<FindingRow & { agent_slug: string; agent_name: string }>> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (opts.status) {
    params.push(opts.status);
    conditions.push(`f.status = $${params.length}`);
  }
  if (opts.agentId) {
    params.push(opts.agentId);
    conditions.push(`f.agent_id = $${params.length}`);
  }
  if (opts.severity) {
    params.push(opts.severity);
    conditions.push(`f.severity = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(Math.min(Math.max(opts.limit ?? 50, 1), 200));
  const { rows } = await db.query<FindingRow & { agent_slug: string; agent_name: string }>(
    `SELECT f.*, a.slug AS agent_slug, a.name AS agent_name
     FROM ai_findings f JOIN ai_agents a ON a.id = f.agent_id
     ${where}
     ORDER BY f.created_at DESC LIMIT $${params.length}`,
    params
  );
  return rows;
}

export async function getFinding(db: Queryable, id: string): Promise<FindingRow | null> {
  const { rows } = await db.query<FindingRow>(`SELECT * FROM ai_findings WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function updateFindingStatus(db: Queryable, id: string, status: 'acknowledged' | 'resolved' | 'dismissed'): Promise<FindingRow | null> {
  const { rows } = await db.query<FindingRow>(
    `UPDATE ai_findings SET status = $2, updated_at = now() WHERE id = $1 AND status <> $2 RETURNING *`,
    [id, status]
  );
  return rows[0] ?? null;
}

export async function listOpenFindingsByTypes(db: Queryable, types: string[], limit = 50): Promise<FindingRow[]> {
  const { rows } = await db.query<FindingRow>(
    `SELECT * FROM ai_findings WHERE status = 'open' AND finding_type = ANY($1) ORDER BY created_at DESC LIMIT $2`,
    [types, Math.min(Math.max(limit, 1), 200)]
  );
  return rows;
}

// ----------------------------------------------------------------------------------------------
// Incidents

export interface CreateIncidentInput {
  severity: string;
  title: string;
  summary: string;
  affected: unknown[];
  commanderAgentId?: string | null;
  openedBy?: string | null;
  openedByType: 'agent' | 'staff' | 'system';
  timelineNote: string;
}

export async function createIncident(db: Queryable, input: CreateIncidentInput): Promise<IncidentRow> {
  const { rows } = await db.query<IncidentRow>(
    // $8 serves the typed varchar column; $10 mirrors the same value for the variadic
    // jsonb_build_object (PGlite rejects one parameter deduced as two types across contexts).
    `INSERT INTO ai_incidents (id, severity, title, summary, affected, commander_agent_id, opened_by, opened_by_type, timeline)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
             jsonb_build_array(jsonb_build_object('at', now()::text, 'note', $9::text, 'by', $10::text)))
     RETURNING *`,
    [
      randomUUID(),
      input.severity,
      input.title,
      input.summary,
      JSON.stringify(input.affected ?? []),
      input.commanderAgentId ?? null,
      input.openedBy ?? null,
      input.openedByType,
      input.timelineNote,
      input.openedByType,
    ]
  );
  if (!rows[0]) throw new Error('ai_incidents: insert returned no row');
  return rows[0];
}

export async function getIncident(db: Queryable, id: string): Promise<IncidentRow | null> {
  const { rows } = await db.query<IncidentRow>(`SELECT * FROM ai_incidents WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

/** One open/investigating incident per title — the commander correlates instead of duplicating. */
export async function findOpenIncidentByTitle(db: Queryable, title: string): Promise<IncidentRow | null> {
  const { rows } = await db.query<IncidentRow>(
    `SELECT * FROM ai_incidents WHERE title = $1 AND status IN ('open','investigating') ORDER BY created_at DESC LIMIT 1`,
    [title]
  );
  return rows[0] ?? null;
}

export async function listIncidents(db: Queryable, opts: { status?: string; limit?: number } = {}): Promise<IncidentRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (opts.status) {
    params.push(opts.status);
    conditions.push(`status = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(Math.min(Math.max(opts.limit ?? 50, 1), 200));
  const { rows } = await db.query<IncidentRow>(
    `SELECT * FROM ai_incidents ${where}
     ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'investigating' THEN 1 WHEN 'mitigated' THEN 2 ELSE 3 END, created_at DESC
     LIMIT $${params.length}`,
    params
  );
  return rows;
}

export async function appendIncidentTimeline(db: Queryable, id: string, note: string, by: string, newStatus?: string): Promise<IncidentRow | null> {
  const { rows } = await db.query<IncidentRow>(
    `UPDATE ai_incidents SET
       timeline = timeline || jsonb_build_array(jsonb_build_object('at', now()::text, 'note', $2::text, 'by', $3::text)),
       status = COALESCE($4::varchar, status),
       resolved_at = CASE WHEN $4::varchar = 'resolved' THEN now() ELSE resolved_at END,
       updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, note, by, newStatus ?? null]
  );
  return rows[0] ?? null;
}
