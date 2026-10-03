/**
 * Tools Center — monitoring (spec §85 SSL expiry, §86 DNS change, §87 e-mail configuration).
 *
 * A monitor is a saved question, re-asked by the worker sweep. Every evaluation produces a real
 * measurement (a TLS connection, a DNS query, SPF/DMARC lookups) plus a previous/current value pair,
 * and writes an event row when the answer changes or a threshold is crossed. The sweep in
 * `src/worker/tools-sweep.ts` turns those events into notifications through the platform's existing
 * notification service — there is no second notification stack here.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../../db/types';
import { invalidInput, ToolError } from '../core/errors';
import { normalizeDomain, parentZone } from '../dns/common';
import { matchExpected, type MatchMode } from '../dns/records';
import { dmarcCheck, spfCheck } from '../dns/email-auth';
import { sslCheck } from '../security/ssl';

export type MonitorKind = 'SSL_EXPIRY' | 'DNS_RECORD' | 'EMAIL_CONFIG';
export type MonitorStatus = 'OK' | 'WARNING' | 'CHANGED' | 'EXPIRED' | 'ERROR' | 'UNKNOWN';

export interface MonitorRow {
  id: string;
  user_id: string;
  kind: MonitorKind;
  target: string;
  record_type: string | null;
  expected_value: string | null;
  match_mode: MatchMode;
  enabled: boolean;
  last_checked_at: string | null;
  last_status: MonitorStatus;
  last_value: string | null;
  last_detail: string | null;
  notified: Record<string, boolean>;
  created_at: string;
  updated_at: string;
}

export interface MonitorEventRow {
  id: string;
  monitor_id: string;
  status: MonitorStatus;
  previous_value: string | null;
  current_value: string | null;
  detail: string;
  notified_at: string | null;
  created_at: string;
}

const SSL_THRESHOLDS = [30, 14, 7, 3, 1];
const MAX_MONITORS_PER_USER = 25;

export interface CreateMonitorInput {
  kind: MonitorKind;
  target: string;
  recordType?: string;
  expectedValue?: string;
  matchMode?: MatchMode;
}

export async function createMonitor(db: Queryable, userId: string, input: CreateMonitorInput): Promise<MonitorRow> {
  const { rows: countRows } = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM tool_monitors WHERE user_id = $1`, [userId]);
  if (Number.parseInt(countRows[0]?.count ?? '0', 10) >= MAX_MONITORS_PER_USER) {
    throw invalidInput(`You already have ${MAX_MONITORS_PER_USER} monitors. Delete one before adding another.`);
  }

  const kind = input.kind;
  if (!['SSL_EXPIRY', 'DNS_RECORD', 'EMAIL_CONFIG'].includes(kind)) throw invalidInput('Choose a monitor kind: SSL_EXPIRY, DNS_RECORD or EMAIL_CONFIG.');

  let target = input.target.trim().toLowerCase();
  if (kind === 'SSL_EXPIRY') {
    target = target.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const host = target.includes(':') ? target.slice(0, target.lastIndexOf(':')) : target;
    const port = target.includes(':') ? Number(target.slice(target.lastIndexOf(':') + 1)) : 443;
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw invalidInput('The port in the target must be between 1 and 65535.');
    target = port === 443 ? host : `${host}:${port}`;
  } else {
    target = normalizeDomain(target);
  }

  const recordType = kind === 'DNS_RECORD' ? (input.recordType ?? 'A').toUpperCase() : null;
  const allowedTypes = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA', 'CAA', 'SRV'];
  if (kind === 'DNS_RECORD' && !allowedTypes.includes(recordType ?? '')) {
    throw invalidInput(`DNS monitors support these record types: ${allowedTypes.join(', ')}.`);
  }
  if (kind === 'DNS_RECORD' && (input.expectedValue ?? '').trim().length === 0) {
    throw invalidInput('A DNS monitor needs an expected value to compare against.');
  }
  if (kind === 'EMAIL_CONFIG' && !target.includes('.')) throw invalidInput('Enter the domain whose e-mail configuration should be monitored.');

  const matchMode: MatchMode = input.matchMode ?? 'exact';
  const { rows } = await db.query<MonitorRow>(
    `INSERT INTO tool_monitors (id, user_id, kind, target, record_type, expected_value, match_mode)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [randomUUID(), userId, kind, target.slice(0, 255), recordType, input.expectedValue?.trim() ?? null, matchMode]
  );
  const row = rows[0];
  if (!row) throw new ToolError('INTERNAL_ERROR', 'The monitor could not be created.');
  return row;
}

export async function listMonitors(db: Queryable, userId: string): Promise<MonitorRow[]> {
  const { rows } = await db.query<MonitorRow>(`SELECT * FROM tool_monitors WHERE user_id = $1 ORDER BY created_at DESC`, [userId]);
  return rows;
}

export async function updateMonitor(
  db: Queryable,
  userId: string,
  monitorId: string,
  patch: { enabled?: boolean; expectedValue?: string | null; matchMode?: MatchMode }
): Promise<MonitorRow | null> {
  const fields: string[] = [];
  const params: unknown[] = [userId, monitorId];
  if (patch.enabled !== undefined) {
    params.push(patch.enabled);
    fields.push(`enabled = $${params.length}`);
  }
  if (patch.expectedValue !== undefined) {
    params.push(patch.expectedValue);
    fields.push(`expected_value = $${params.length}`);
  }
  if (patch.matchMode !== undefined) {
    params.push(patch.matchMode);
    fields.push(`match_mode = $${params.length}`);
  }
  if (fields.length === 0) throw invalidInput('Nothing to update: provide enabled, expectedValue or matchMode.');
  const { rows } = await db.query<MonitorRow>(`UPDATE tool_monitors SET ${fields.join(', ')}, updated_at = now() WHERE user_id = $1 AND id = $2 RETURNING *`, params);
  return rows[0] ?? null;
}

export async function deleteMonitor(db: Queryable, userId: string, monitorId: string): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(`DELETE FROM tool_monitors WHERE user_id = $1 AND id = $2 RETURNING id`, [userId, monitorId]);
  return rows.length > 0;
}

export async function listMonitorEvents(db: Queryable, userId: string, monitorId?: string, limit = 50): Promise<MonitorEventRow[]> {
  const params: unknown[] = [userId];
  let filter = '';
  if (monitorId) {
    params.push(monitorId);
    filter = `AND e.monitor_id = $${params.length}`;
  }
  const { rows } = await db.query<MonitorEventRow>(
    `SELECT e.* FROM tool_monitor_events e JOIN tool_monitors m ON m.id = e.monitor_id
      WHERE m.user_id = $1 ${filter} ORDER BY e.created_at DESC LIMIT ${Math.min(Math.max(limit, 1), 200)}`,
    params
  );
  return rows;
}

export interface MonitorEvaluation {
  status: MonitorStatus;
  value: string | null;
  detail: string;
  /** Threshold keys crossed on this run (SSL monitors); the worker uses them to notify once each. */
  crossedThresholds: number[];
  evidence: Record<string, unknown>;
}

/** Re-asks the monitor's question. Never invents a value: a failed check is ERROR with the reason. */
export async function evaluateMonitor(db: Queryable, monitor: MonitorRow): Promise<MonitorEvaluation> {
  switch (monitor.kind) {
    case 'SSL_EXPIRY': {
      const [host, portText] = monitor.target.includes(':') ? [monitor.target.slice(0, monitor.target.lastIndexOf(':')), monitor.target.slice(monitor.target.lastIndexOf(':') + 1)] : [monitor.target, '443'];
      const result = await sslCheck({ host, port: Number(portText) || 443 }).catch((error: unknown) => {
        throw error instanceof ToolError ? error : new ToolError('PROVIDER_ERROR', `The TLS check failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      });
      const days = result.expiry.daysRemaining;
      const crossed = days === null ? [] : SSL_THRESHOLDS.filter((threshold) => days <= threshold);
      const status: MonitorStatus = result.status === 'EXPIRED' ? 'EXPIRED' : days !== null && days <= 30 ? 'WARNING' : 'OK';
      return {
        status,
        value: days === null ? null : `${days} days`,
        detail: days === null ? result.statusDetail : `${result.statusDetail} Expires ${result.expiry.validTo ?? 'at an unknown time'}.`,
        crossedThresholds: crossed,
        evidence: { issuer: result.chain[0]?.issuer.CN ?? null, validTo: result.expiry.validTo, protocol: result.connection.protocol },
      };
    }
    case 'DNS_RECORD': {
      const recordType = monitor.record_type ?? 'A';
      const { queryType, pickResolver } = await import('../dns/common');
      const resolver = await pickResolver(db);
      const answer = await queryType(resolver, monitor.target, recordType);
      const values = answer.records.map((record) => record.display).sort();
      const expected = monitor.expected_value ?? '';
      const match = matchExpected(values.join(' | '), expected, monitor.match_mode);
      const status: MonitorStatus = match.matched ? 'OK' : 'CHANGED';
      return {
        status,
        value: values.join(' | ') || '(no records)',
        detail: values.length === 0
          ? `${resolver.name} returned no ${recordType} records for ${monitor.target}.`
          : match.matched
            ? `The ${recordType} records still match the expectation (${match.detail}).`
            : `The ${recordType} records changed: expected "${expected}" but found "${values.join(' | ')}" (${match.detail}).`,
        crossedThresholds: [],
        evidence: { resolver: resolver.name, rcode: answer.meta.rcode, records: values },
      };
    }
    case 'EMAIL_CONFIG': {
      const domain = monitor.target;
      const spf = await spfCheck(db, { domain });
      const dmarc = await dmarcCheck(db, { domain });
      const problems: string[] = [];
      if (spf.status === 'ERROR') problems.push(`SPF: ${spf.summary}`);
      if (dmarc.status === 'ERROR' || dmarc.status === 'NOT_FOUND') problems.push(`DMARC: ${dmarc.summary}`);
      const status: MonitorStatus = problems.length > 0 ? 'WARNING' : spf.status === 'WARNING' || dmarc.status === 'WARNING' ? 'WARNING' : 'OK';
      return {
        status,
        value: `SPF:${spf.status} DMARC:${dmarc.status}`,
        detail: problems.length > 0 ? problems.join(' ') : `SPF and DMARC are present and consistent. ${spf.summary} ${dmarc.summary}`,
        crossedThresholds: [],
        evidence: { spf: spf.status, dmarc: dmarc.status, zone: parentZone(domain) },
      };
    }
    default:
      throw invalidInput(`"${String(monitor.kind)}" is not a supported monitor kind.`);
  }
}

export interface MonitorSweepResult {
  checked: number;
  changed: number;
  errors: number;
  notifications: Array<{ monitorId: string; userId: string; title: string; body: string; severity: 'info' | 'warning' | 'error' }>;
}

/**
 * Evaluates one monitor and writes an event when the answer changed or a threshold was crossed.
 * Returns the notification the sweep should send (if any). The caller owns delivery.
 */
export async function applyMonitorEvaluation(
  db: Queryable,
  monitor: MonitorRow,
  evaluation: MonitorEvaluation
): Promise<MonitorSweepResult['notifications'][number] | null> {
  const previousValue = monitor.last_value;
  const changed = previousValue !== evaluation.value || monitor.last_status !== evaluation.status;
  const newThresholds = evaluation.crossedThresholds.filter((threshold) => !monitor.notified[String(threshold)]);
  const shouldRecord = changed || newThresholds.length > 0;

  if (shouldRecord) {
    await db.query(
      `INSERT INTO tool_monitor_events (id, monitor_id, status, previous_value, current_value, detail)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [randomUUID(), monitor.id, evaluation.status, previousValue, evaluation.value, evaluation.detail]
    );
  }

  if (newThresholds.length > 0) {
    const notified = { ...monitor.notified };
    for (const threshold of newThresholds) notified[String(threshold)] = true;
    await db.query(`UPDATE tool_monitors SET notified = $3::jsonb WHERE id = $1 AND user_id = $2`, [monitor.id, monitor.user_id, JSON.stringify(notified)]);
  }

  await db.query(
    `UPDATE tool_monitors SET last_checked_at = now(), last_status = $3, last_value = $4, last_detail = $5, updated_at = now()
      WHERE id = $1 AND user_id = $2`,
    [monitor.id, monitor.user_id, evaluation.status, evaluation.value, evaluation.detail.slice(0, 2000)]
  );

  if (!shouldRecord) return null;

  const severity: 'info' | 'warning' | 'error' = evaluation.status === 'ERROR' || evaluation.status === 'EXPIRED' ? 'error' : evaluation.status === 'OK' ? 'info' : 'warning';
  const title =
    monitor.kind === 'SSL_EXPIRY'
      ? `Certificate monitor: ${monitor.target} is ${evaluation.status.toLowerCase()}`
      : monitor.kind === 'DNS_RECORD'
        ? `DNS monitor: ${monitor.target} ${monitor.record_type ?? ''} ${evaluation.status === 'CHANGED' ? 'changed' : 'is OK'}`
        : `E-mail configuration monitor: ${monitor.target} is ${evaluation.status.toLowerCase()}`;

  return {
    monitorId: monitor.id,
    userId: monitor.user_id,
    title,
    body: evaluation.detail,
    severity,
  };
}

export async function dueMonitors(db: Queryable, limit = 25, staleMinutes = 60): Promise<MonitorRow[]> {
  const { rows } = await db.query<MonitorRow>(
    `SELECT * FROM tool_monitors
      WHERE enabled = true AND (last_checked_at IS NULL OR last_checked_at < now() - ($1 || ' minutes')::interval)
      ORDER BY last_checked_at ASC NULLS FIRST LIMIT $2`,
    [String(staleMinutes), Math.min(Math.max(limit, 1), 200)]
  );
  return rows;
}
