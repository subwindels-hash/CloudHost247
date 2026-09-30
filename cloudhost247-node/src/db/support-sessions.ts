/**
 * Delegated "support mode" sessions (spec §32–§40).
 *
 * When an administrator switches into a customer account, we never touch the customer's
 * credentials and never reuse their session. Instead a separate, short-lived, individually
 * tracked delegated session is created here and referenced by the minted token, so that:
 *   - the acting administrator's identity is always recoverable (`admin_id`),
 *   - the session can be ended server-side at any moment (`ended_at`) — ending it kills the
 *     token immediately, because authentication re-reads this row on every request,
 *   - concurrent sessions (one admin, several customers) are distinct rows, each expiring on
 *     its own clock.
 */
import type { Queryable } from './types';

export interface SupportSessionRow {
  id: string;
  admin_id: string;
  customer_uuid: string;
  customer_id: string | null;
  reason: string | null;
  started_at: string;
  expires_at: string;
  ended_at: string | null;
  ended_reason: string | null;
  ip_address: string | null;
  user_agent: string | null;
}

export async function createSupportSession(
  db: Queryable,
  input: {
    id: string;
    adminId: string;
    customerUuid: string;
    customerId: string | null;
    reason?: string | null;
    expiresAt: Date;
    ipAddress?: string | null;
    userAgent?: string | null;
  }
): Promise<SupportSessionRow> {
  const { rows } = await db.query<SupportSessionRow>(
    `INSERT INTO admin_support_sessions
       (id, admin_id, customer_uuid, customer_id, reason, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      input.id,
      input.adminId,
      input.customerUuid,
      input.customerId,
      input.reason ?? null,
      input.expiresAt,
      input.ipAddress ?? null,
      input.userAgent ?? null,
    ]
  );
  const row = rows[0];
  if (!row) throw new Error('Failed to create support session');
  return row;
}

export async function findSupportSessionById(db: Queryable, id: string): Promise<SupportSessionRow | null> {
  const { rows } = await db.query<SupportSessionRow>('SELECT * FROM admin_support_sessions WHERE id = $1 LIMIT 1', [id]);
  return rows[0] ?? null;
}

export function isSupportSessionActive(row: SupportSessionRow, now: Date = new Date()): boolean {
  return row.ended_at === null && new Date(row.expires_at).getTime() > now.getTime();
}

export async function endSupportSession(
  db: Queryable,
  id: string,
  reason: 'admin_exit' | 'expired' | 'revoked'
): Promise<SupportSessionRow | null> {
  const { rows } = await db.query<SupportSessionRow>(
    `UPDATE admin_support_sessions
        SET ended_at = now(), ended_reason = $2
      WHERE id = $1 AND ended_at IS NULL
      RETURNING *`,
    [id, reason]
  );
  return rows[0] ?? null;
}

/** Worker sweep: closes out sessions that ran past their expiry so the audit record says
 * "expired" rather than leaving an open-looking row forever. */
export async function expireStaleSupportSessions(db: Queryable): Promise<SupportSessionRow[]> {
  const { rows } = await db.query<SupportSessionRow>(
    `UPDATE admin_support_sessions
        SET ended_at = now(), ended_reason = 'expired'
      WHERE ended_at IS NULL AND expires_at <= now()
      RETURNING *`
  );
  return rows;
}

export async function listSupportSessions(
  db: Queryable,
  filter: { adminId?: string; customerUuid?: string; activeOnly?: boolean; limit?: number } = {}
): Promise<SupportSessionRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.adminId) {
    params.push(filter.adminId);
    conditions.push(`admin_id = $${params.length}`);
  }
  if (filter.customerUuid) {
    params.push(filter.customerUuid);
    conditions.push(`customer_uuid = $${params.length}`);
  }
  if (filter.activeOnly) {
    conditions.push(`ended_at IS NULL AND expires_at > now()`);
  }
  params.push(Math.min(Math.max(filter.limit ?? 50, 1), 200));
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await db.query<SupportSessionRow>(
    `SELECT * FROM admin_support_sessions ${where} ORDER BY started_at DESC LIMIT $${params.length}`,
    params
  );
  return rows;
}
