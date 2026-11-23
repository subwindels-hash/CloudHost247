/**
 * Abuse reports (F13 — abuse reporting).
 *
 * A distinct intake from support tickets: a customer or external party reports a domain,
 * IP or service hosted on this platform (spam, phishing, copyright, illegal content,
 * security). Reports are stored for staff review; nothing is auto-delivered to any
 * abuse@ mailbox or external party.
 */
import type { Queryable } from './types';
import { randomUUID } from 'node:crypto';

export type AbuseReportCategory =
  | 'spam'
  | 'phishing'
  | 'copyright'
  | 'illegal_content'
  | 'security'
  | 'other';

export type AbuseReportStatus = 'received' | 'under_review' | 'actioned' | 'closed';

export type AbuseReportPriority = 'low' | 'normal' | 'high' | 'critical';

export interface AbuseReportRow {
  id: string;
  reporter_name: string | null;
  reporter_email: string | null;
  category: AbuseReportCategory;
  subject: string;
  body: string;
  target: string | null;
  status: AbuseReportStatus;
  priority: AbuseReportPriority;
  staff_notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateAbuseReportInput {
  reporter_name?: string | null;
  reporter_email?: string | null;
  category: AbuseReportCategory;
  subject: string;
  body: string;
  target?: string | null;
  priority?: AbuseReportPriority;
}

export interface ListAbuseReportsFilter {
  status?: AbuseReportStatus;
  category?: AbuseReportCategory;
  limit?: number;
  offset?: number;
}

export interface UpdateAbuseReportInput {
  status?: AbuseReportStatus;
  priority?: AbuseReportPriority;
  staff_notes?: string | null;
}

export async function createAbuseReport(db: Queryable, input: CreateAbuseReportInput): Promise<AbuseReportRow> {
  const id = randomUUID();
  const { rows } = await db.query<AbuseReportRow>(
    `INSERT INTO abuse_reports
       (id, reporter_name, reporter_email, category, subject, body, target, status, priority)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'received',$8)
     RETURNING id, reporter_name, reporter_email, category, subject, body, target, status, priority, staff_notes, created_at, updated_at`,
    [
      id,
      input.reporter_name ?? null,
      input.reporter_email ?? null,
      input.category,
      input.subject,
      input.body,
      input.target ?? null,
      input.priority ?? 'normal',
    ]
  );
  const report = rows[0];
  if (!report) throw new Error('Failed to create abuse report');
  return report;
}

export async function listAbuseReports(
  db: Queryable,
  filter: ListAbuseReportsFilter = {}
): Promise<AbuseReportRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.status) {
    params.push(filter.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filter.category) {
    params.push(filter.category);
    conditions.push(`category = $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(Math.max(Math.trunc(filter.limit ?? 50), 1), 100);
  const offset = Math.max(Math.trunc(filter.offset ?? 0), 0);

  const { rows } = await db.query<AbuseReportRow>(
    `SELECT id, reporter_name, reporter_email, category, subject, body, target, status, priority, staff_notes, created_at, updated_at
     FROM abuse_reports
     ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );
  return rows;
}

export async function countAbuseReports(
  db: Queryable,
  filter: ListAbuseReportsFilter = {}
): Promise<number> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.status) {
    params.push(filter.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filter.category) {
    params.push(filter.category);
    conditions.push(`category = $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM abuse_reports ${where}`,
    params
  );
  return Number(rows[0]?.count ?? '0');
}

export async function findAbuseReportById(db: Queryable, id: string): Promise<AbuseReportRow | null> {
  const { rows } = await db.query<AbuseReportRow>(
    `SELECT id, reporter_name, reporter_email, category, subject, body, target, status, priority, staff_notes, created_at, updated_at
     FROM abuse_reports
     WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function updateAbuseReport(
  db: Queryable,
  id: string,
  input: UpdateAbuseReportInput,
): Promise<AbuseReportRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.status !== undefined) {
    params.push(input.status);
    sets.push(`status = $${params.length}`);
  }
  if (input.priority !== undefined) {
    params.push(input.priority);
    sets.push(`priority = $${params.length}`);
  }
  if (input.staff_notes !== undefined) {
    params.push(input.staff_notes);
    sets.push(`staff_notes = $${params.length}`);
  }

  if (sets.length === 0) return findAbuseReportById(db, id);

  sets.push(`updated_at = now()`);

  const { rows } = await db.query<AbuseReportRow>(
    `UPDATE abuse_reports
     SET ${sets.join(', ')}
     WHERE id = $${params.length + 1}
     RETURNING id, reporter_name, reporter_email, category, subject, body, target, status, priority, staff_notes, created_at, updated_at`,
    [...params, id]
  );
  return rows[0] ?? null;
}
