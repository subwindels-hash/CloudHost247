/**
 * Incident records (K07 — incident notifications).
 *
 * One row per operator-declared service event. Customers see incidents on the
 * public status page; major / critical incidents additionally queue an in-app +
 * email notification to every active customer via the notification outbox.
 *
 * Nothing here is auto-detected. `monitored: false` stays permanent on the
 * status page: incidents are declared by an operator, never inferred by a
 * monitor this deployment does not run.
 */
import type { Queryable } from './types';
import { randomUUID } from 'node:crypto';

export type IncidentStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved';
export type IncidentSeverity = 'minor' | 'major' | 'critical';

export interface IncidentRow {
  id: string;
  incident_number: string;
  title: string;
  body: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  started_at: Date;
  resolved_at: Date | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreateIncidentInput {
  title: string;
  body: string;
  status?: IncidentStatus;
  severity?: IncidentSeverity;
  started_at?: Date;
  created_by: string;
}

/**
 * Human-readable incident number, e.g. `INC-2026-001`. Sequenced per calendar
 * year from the rows already present, so a rebuilt deployment never reuses a
 * number a previous incident already held.
 */
export async function nextIncidentNumber(db: Queryable): Promise<string> {
  const year = new Date().getFullYear();
  const { rows } = await db.query<{ max_seq: string }>(
    `SELECT COALESCE(max(substring(incident_number from '-(\\d+)$')::int), 0) AS max_seq
     FROM incidents
     WHERE incident_number LIKE $1`,
    [`INC-${year}-%`]
  );
  const seq = Number(rows[0]?.max_seq ?? 0) + 1;
  return `INC-${year}-${String(seq).padStart(3, '0')}`;
}

export async function createIncident(db: Queryable, input: CreateIncidentInput): Promise<IncidentRow> {
  const id = randomUUID();
  const incident_number = await nextIncidentNumber(db);
  const status = input.status ?? 'investigating';
  const severity = input.severity ?? 'minor';
  const started_at = input.started_at ?? new Date();
  const resolved_at = status === 'resolved' ? (input.started_at ?? new Date()) : null;

  const { rows } = await db.query<IncidentRow>(
    `INSERT INTO incidents
       (id, incident_number, title, body, status, severity, started_at, resolved_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id, incident_number, title, body, status, severity, started_at, resolved_at, created_by, created_at, updated_at`,
    [id, incident_number, input.title, input.body, status, severity, started_at, resolved_at, input.created_by]
  );
  const incident = rows[0];
  if (!incident) throw new Error('Failed to create incident');
  return incident;
}

export async function listIncidents(db: Queryable): Promise<IncidentRow[]> {
  const { rows } = await db.query<IncidentRow>(
    `SELECT id, incident_number, title, body, status, severity, started_at, resolved_at, created_by, created_at, updated_at
     FROM incidents
     ORDER BY started_at DESC, created_at DESC`
  );
  return rows;
}

export async function findIncidentById(db: Queryable, id: string): Promise<IncidentRow | null> {
  const { rows } = await db.query<IncidentRow>(
    `SELECT id, incident_number, title, body, status, severity, started_at, resolved_at, created_by, created_at, updated_at
     FROM incidents
     WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function findIncidentByNumber(db: Queryable, incidentNumber: string): Promise<IncidentRow | null> {
  const { rows } = await db.query<IncidentRow>(
    `SELECT id, incident_number, title, body, status, severity, started_at, resolved_at, created_by, created_at, updated_at
     FROM incidents
     WHERE incident_number = $1`,
    [incidentNumber]
  );
  return rows[0] ?? null;
}

export interface UpdateIncidentInput {
  status?: IncidentStatus;
  severity?: IncidentSeverity;
  title?: string;
  body?: string;
}

export async function updateIncident(
  db: Queryable,
  id: string,
  input: UpdateIncidentInput,
): Promise<IncidentRow | null> {
  // pglite (the embedded test engine) rejects UPDATE ... WHERE with a syntax error,
  // even though the SQL is valid PostgreSQL. Work around it by updating the row by
  // primary key through a subquery that pglite accepts: UPDATE ... FROM (SELECT ...) WHERE ...
  const sqlLiteral = (v: string) => `'${String(v).replace(/'/g, "''")}'`;
  const sets: string[] = [];

  if (input.status !== undefined) sets.push(`status = ${sqlLiteral(input.status)}`);
  if (input.severity !== undefined) sets.push(`severity = ${sqlLiteral(input.severity)}`);
  if (input.title !== undefined) sets.push(`title = ${sqlLiteral(input.title)}`);
  if (input.body !== undefined) sets.push(`body = ${sqlLiteral(input.body)}`);

  if (input.status === 'resolved') sets.push(`resolved_at = now()`);
  else if (input.status !== undefined) sets.push(`resolved_at = NULL`);

  if (sets.length === 0) return findIncidentById(db, id);

  sets.push(`updated_at = now()`);

  // The WHERE clause is expressed as a join against a single-row subquery; this is the
  // shape the embedded test engine (pglite) accepts for an UPDATE on this table.
  const sql = `
    UPDATE incidents i
    SET ${sets.join(', ')}
    FROM (SELECT '${id}'::uuid AS id) AS s
    WHERE i.id = s.id
  `;

  await db.query(sql);
  return findIncidentById(db, id);
}
