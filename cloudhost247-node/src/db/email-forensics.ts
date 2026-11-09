/**
 * Data access layer for the Email Trace & Forensics Analyzer.
 *
 * Every row is tenant-scoped via `user_id` (references `users(id)`). Every read accepts an
 * explicit scope and treats an empty scope as "matches nothing" — so a customer can never read
 * another customer's analysis. Cross-tenant admin reads use an unrestricted scope only after
 * passing requireRole(['admin', 'super_admin']).
 *
 * No raw email bodies or attachments are stored — only header-derived evidence. All SQL is
 * parameterized; nothing is built inline from caller input.
 */

import { randomUUID } from 'node:crypto';
import type { Queryable } from './types';
import type {
  AuthResultInsert,
  EmailForensicsResult,
  IpCandidateInsert,
  RouteHopInsert,
} from '../email-forensics/types';

/** Tenant scope passed to every read. Empty customerIds = closed scope (matches nothing). */
export interface EmailForensicsScope {
  userIds?: string[];
}

export interface AnalysisFilters extends EmailForensicsScope {
  status?: 'pending' | 'complete' | 'failed';
  limit?: number;
  offset?: number;
}

/** One stored analysis row. */
export interface AnalysisRow {
  id: string;
  user_id: string;
  analysis_reference: string;
  original_filename: string | null;
  message_id: string | null;
  subject: string | null;
  sender: string | null;
  sender_domain: string | null;
  recipient: string | null;
  received_at: Date | null;
  analysis_status: 'pending' | 'complete' | 'failed';
  created_at: Date;
  expires_at: Date;
}

const MAX_LIMIT = 100;

function clampLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit) || limit < 1) return 20;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

function buildWhere(filters: AnalysisFilters, scope: EmailForensicsScope): { clause: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  const push = (sql: (index: number) => string, value: unknown) => {
    params.push(value);
    clauses.push(sql(params.length));
  };

  if (filters.status) push((i) => `analysis_status = $${i}`, filters.status);

  // Tenant scope — always applied. An empty array deliberately produces `false` (matches nothing),
  // never unrestricted access.
  if (scope.userIds) {
    if (scope.userIds.length === 0) {
      clauses.push('false');
    } else {
      const placeholders = scope.userIds.map((id) => {
        params.push(id);
        return `$${params.length}`;
      });
      clauses.push(`user_id IN (${placeholders.join(', ')})`);
    }
  }

  return { clause: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

/**
 * Insert a new analysis row with `pending` status. Returns the row.
 */
export async function createAnalysis(
  db: Queryable,
  input: {
    userId: string;
    analysisReference: string;
    originalFilename: string | null;
    messageId: string | null;
    subject: string | null;
    sender: string | null;
    senderDomain: string | null;
    recipient: string | null;
    receivedAt: Date | null;
    expiresAt: Date;
  }
): Promise<AnalysisRow> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO email_forensic_analyses
      (id, user_id, analysis_reference, original_filename, message_id, subject, sender,
       sender_domain, recipient, received_at, analysis_status, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11)
     RETURNING id, user_id, analysis_reference, original_filename, message_id, subject, sender,
               sender_domain, recipient, received_at, analysis_status, created_at, expires_at`,
    [
      id,
      input.userId,
      input.analysisReference,
      input.originalFilename,
      input.messageId,
      input.subject,
      input.sender,
      input.senderDomain,
      input.recipient,
      input.receivedAt,
      input.expiresAt,
    ]
  );
  const { rows } = await db.query<AnalysisRow>(
    `SELECT * FROM email_forensic_analyses WHERE id = $1`,
    [id]
  );
  const row = rows[0];
  if (!row) throw new Error('Analysis insert did not return a row');
  return row;
}

/** Mark an analysis complete (or failed). */
export async function updateAnalysisStatus(
  db: Queryable,
  id: string,
  status: 'complete' | 'failed'
): Promise<void> {
  await db.query(
    `UPDATE email_forensic_analyses SET analysis_status = $1 WHERE id = $2`,
    [status, id]
  );
}

/** Insert IP candidates for an analysis. */
export async function insertIpCandidates(db: Queryable, candidates: IpCandidateInsert[]): Promise<void> {
  if (candidates.length === 0) return;
  for (const c of candidates) {
    await db.query(
      `INSERT INTO email_forensic_ip_candidates
        (id, analysis_id, ip_address, ip_version, source_header, hop_number, address_class, trust_classification, confidence_level)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [randomUUID(), c.analysisId, c.ipAddress, c.ipVersion, c.sourceHeader, c.hopNumber ?? null, c.addressClass, c.trustClassification, c.confidenceLevel]
    );
  }
}

/** Insert route hops for an analysis. */
export async function insertRouteHops(db: Queryable, hops: RouteHopInsert[]): Promise<void> {
  if (hops.length === 0) return;
  for (const h of hops) {
    await db.query(
      `INSERT INTO email_forensic_route_hops
        (id, analysis_id, hop_number, hostname, ip_address, received_timestamp, tls_information, header_source, trust_classification, anomaly_flag)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [randomUUID(), h.analysisId, h.hopNumber, h.hostname, h.ipAddress, h.receivedTimestamp ?? null, h.tlsInformation, h.headerSource, h.trustClassification, h.anomalyFlag ?? null]
    );
  }
}

/** Insert authentication results for an analysis. */
export async function insertAuthResults(db: Queryable, results: AuthResultInsert[]): Promise<void> {
  if (results.length === 0) return;
  for (const r of results) {
    await db.query(
      `INSERT INTO email_forensic_auth_results
        (id, analysis_id, authentication_type, reported_result, independently_verified, explanation)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [randomUUID(), r.analysisId, r.authenticationType, r.reportedResult ?? null, r.independentlyVerified, r.explanation ?? null]
    );
  }
}

/** List analyses for a scope, newest first, with total count. */
export async function listAnalyses(
  db: Queryable,
  filters: AnalysisFilters,
  scope: EmailForensicsScope
): Promise<{ analyses: AnalysisRow[]; total: number; limit: number; offset: number }> {
  const limit = clampLimit(filters.limit);
  const offset = filters.offset && filters.offset > 0 ? Math.floor(filters.offset) : 0;
  const { clause, params } = buildWhere(filters, scope);

  const countResult = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM email_forensic_analyses ${clause}`,
    params
  );

  const pagedParams = [...params, limit, offset];
  const { rows } = await db.query<AnalysisRow>(
    `SELECT * FROM email_forensic_analyses ${clause}
     ORDER BY created_at DESC
     LIMIT $${pagedParams.length - 1} OFFSET $${pagedParams.length}`,
    pagedParams
  );

  return { analyses: rows, total: Number(countResult.rows[0]?.count ?? 0), limit, offset };
}

/**
 * Find one analysis by id within a scope. Returns null when it does not exist *or* is outside
 * the scope — callers turn both into 404 so the existence of another customer's analysis is
 * never confirmed.
 */
export async function findAnalysis(
  db: Queryable,
  id: string,
  scope: EmailForensicsScope
): Promise<AnalysisRow | null> {
  const params: unknown[] = [id];
  let clause = 'WHERE id = $1';
  if (scope.userIds) {
    if (scope.userIds.length === 0) {
      clause = 'WHERE false';
    } else {
      params.push(...scope.userIds);
      const placeholders = scope.userIds.map((_v, i) => `$${i + 2}`).join(', ');
      clause = `WHERE id = $1 AND user_id IN (${placeholders})`;
    }
  }
  const { rows } = await db.query<AnalysisRow>(
    `SELECT * FROM email_forensic_analyses ${clause}`,
    params
  );
  return rows[0] ?? null;
}

/** Delete one analysis within a scope (cascades to candidates/hops/auth rows). Returns true if deleted. */
export async function deleteAnalysis(db: Queryable, id: string, scope: EmailForensicsScope): Promise<boolean> {
  const params: unknown[] = [id];
  let clause = 'WHERE id = $1';
  if (scope.userIds) {
    if (scope.userIds.length === 0) {
      clause = 'WHERE false';
    } else {
      params.push(...scope.userIds);
      const placeholders = scope.userIds.map((_v, i) => `$${i + 2}`).join(', ');
      clause = `WHERE id = $1 AND user_id IN (${placeholders})`;
    }
  }
  const { rows } = await db.query<{ id: string }>(
    `DELETE FROM email_forensic_analyses ${clause} RETURNING id`,
    params
  );
  return rows.length > 0;
}

/** List IP candidates for an analysis. */
export async function listIpCandidates(db: Queryable, analysisId: string): Promise<IpCandidateInsert[] & { id: string }[]> {
  const { rows } = await db.query<IpCandidateInsert & { id: string }>(
    `SELECT id, analysis_id AS "analysisId", ip_address AS "ipAddress", ip_version AS "ipVersion",
            source_header AS "sourceHeader", hop_number AS "hopNumber", address_class AS "addressClass",
            trust_classification AS "trustClassification", confidence_level AS "confidenceLevel"
     FROM email_forensic_ip_candidates WHERE analysis_id = $1 ORDER BY id`,
    [analysisId]
  );
  return rows;
}

/** List route hops for an analysis. */
export async function listRouteHops(db: Queryable, analysisId: string): Promise<RouteHopInsert[] & { id: string }[]> {
  const { rows } = await db.query<RouteHopInsert & { id: string }>(
    `SELECT id, analysis_id AS "analysisId", hop_number AS "hopNumber", hostname, ip_address AS "ipAddress",
            received_timestamp AS "receivedTimestamp", tls_information AS "tlsInformation",
            header_source AS "headerSource", trust_classification AS "trustClassification", anomaly_flag AS "anomalyFlag"
     FROM email_forensic_route_hops WHERE analysis_id = $1 ORDER BY hop_number`,
    [analysisId]
  );
  return rows;
}

/** List auth results for an analysis. */
export async function listAuthResults(db: Queryable, analysisId: string): Promise<AuthResultInsert[] & { id: string }[]> {
  const { rows } = await db.query<AuthResultInsert & { id: string }>(
    `SELECT id, analysis_id AS "analysisId", authentication_type AS "authenticationType",
            reported_result AS "reportedResult", independently_verified AS "independentlyVerified", explanation
     FROM email_forensic_auth_results WHERE analysis_id = $1 ORDER BY authentication_type`,
    [analysisId]
  );
  return rows;
}

/** Upsert a local IP intelligence database version row. */
export async function upsertDatabaseVersion(
  db: Queryable,
  input: {
    databaseProvider: string;
    databaseName: string;
    version: string | null;
    lastUpdatedAt: Date | null;
    status: string;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO email_forensic_database_versions
      (id, database_provider, database_name, version, last_updated_at, status)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (database_provider) DO UPDATE SET
       database_name = EXCLUDED.database_name,
       version = EXCLUDED.version,
       last_updated_at = EXCLUDED.last_updated_at,
       status = EXCLUDED.status,
       created_at = email_forensic_database_versions.created_at`,
    [randomUUID(), input.databaseProvider, input.databaseName, input.version, input.lastUpdatedAt, input.status]
  );
}

/** List database versions. */
export async function listDatabaseVersions(db: Queryable): Promise<Array<{
  id: string; databaseProvider: string; databaseName: string; version: string | null;
  lastUpdatedAt: Date | null; status: string;
}>> {
  const { rows } = await db.query<{
    id: string; database_provider: string; database_name: string; version: string | null;
    last_updated_at: Date | null; status: string;
  }>(`SELECT * FROM email_forensic_database_versions ORDER BY database_provider`);
  return rows.map((r) => ({
    id: r.id, databaseProvider: r.database_provider, databaseName: r.database_name, version: r.version,
    lastUpdatedAt: r.last_updated_at, status: r.status,
  }));
}

/** Record a forensics audit log entry. */
export async function writeAuditLog(
  db: Queryable,
  input: { userId: string | null; analysisId: string | null; action: string; metadata: Record<string, unknown> }
): Promise<void> {
  await db.query(
    `INSERT INTO email_forensic_audit_logs (id, user_id, analysis_id, action, metadata)
     VALUES ($1,$2,$3,$4,$5)`,
    [randomUUID(), input.userId ?? null, input.analysisId ?? null, input.action, JSON.stringify(input.metadata)]
  );
}
