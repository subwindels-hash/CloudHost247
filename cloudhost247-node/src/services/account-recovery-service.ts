/**
 * Account recovery — what happens when a customer cannot complete email verification.
 *
 * The rule this module exists to enforce: **recovery never bypasses verification and never exposes
 * the Security PIN.** A recovery request is a claim, not a credential. It:
 *
 *   - records who is asking, from which address/phone and why, and gives the customer a short
 *     reference to quote;
 *   - creates an in-app notification *and* an email to the address on the account, so the real
 *     owner learns that someone is trying to recover their account even if they never see the
 *     request itself (this is the single most effective anti-takeover measure available);
 *   - is resolved by support after out-of-band identity verification, and approval only revokes
 *     compromised verification material and forces a fresh email verification — it does not mint a
 *     session, does not reveal/rotate-on-demand the PIN, and does not change the registered email
 *     address (that requires additional verification, see `requestEmailChangeReminder`).
 *
 * Everything is audited through the existing auth_audit_log vocabulary added by migration 0085.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';
import { withTransaction } from '../db/transaction';
import type { UserRecord } from '../db/users';
import { recordAuthEvent } from '../db/users';

export type RecoveryReason = 'cannot_access_email' | 'email_compromised' | 'lost_device' | 'other';
export type RecoveryStatus = 'OPEN' | 'IDENTITY_VERIFIED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface RecoveryRequestRow {
  id: string;
  user_id: string;
  reference: string;
  reason: RecoveryReason;
  contact_email: string | null;
  contact_phone: string | null;
  details: string | null;
  status: RecoveryStatus;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  updated_at: string;
}

/** Reference codes avoid look-alike characters (0/O, 1/I/L) because they are read aloud to staff. */
const REFERENCE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateRecoveryReference(): string {
  const bytes = randomBytes(10);
  let reference = '';
  for (let index = 0; index < 10; index += 1) {
    reference += REFERENCE_ALPHABET[bytes[index]! % REFERENCE_ALPHABET.length];
  }
  return reference;
}

export interface CreateRecoveryInput {
  user: Pick<UserRecord, 'id' | 'email'>;
  reason: RecoveryReason;
  contactEmail?: string | null;
  contactPhone?: string | null;
  details?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface CreatedRecovery {
  request: RecoveryRequestRow;
  /** True when an open request already existed and was returned instead of a duplicate. */
  existing: boolean;
}

/**
 * Opens (or returns) the single open recovery request for an account. Idempotent by design: a
 * customer who clicks twice gets the same reference instead of a queue of competing claims, and the
 * unique partial index in migration 0085 makes that true even under a race.
 */
export async function createRecoveryRequest(db: Queryable, input: CreateRecoveryInput): Promise<CreatedRecovery> {
  return withTransaction(db, async (tx) => {
    const existing = await tx.query<RecoveryRequestRow>(
      `SELECT * FROM account_recovery_requests
        WHERE user_id = $1 AND status IN ('OPEN', 'IDENTITY_VERIFIED')
        ORDER BY created_at DESC LIMIT 1`,
      [input.user.id]
    );
    if (existing.rows[0]) return { request: existing.rows[0], existing: true };

    const id = randomUUID();
    const { rows } = await tx.query<RecoveryRequestRow>(
      `INSERT INTO account_recovery_requests
         (id, user_id, reference, reason, contact_email, contact_phone, details, status, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'OPEN',$8,$9)
       RETURNING *`,
      [
        id,
        input.user.id,
        generateRecoveryReference(),
        input.reason,
        input.contactEmail ?? null,
        input.contactPhone ?? null,
        input.details?.slice(0, 2000) ?? null,
        input.ipAddress ?? null,
        input.userAgent ?? null,
      ]
    );
    const request = rows[0];
    if (!request) throw new Error('Failed to create the account recovery request');

    await recordAuthEvent(tx, {
      id: randomUUID(),
      userId: input.user.id,
      eventType: 'account_recovery_requested',
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      metadata: { reference: request.reference, reason: input.reason },
    });
    return { request, existing: false };
  });
}

export async function listRecoveryRequestsForUser(db: Queryable, userId: string): Promise<RecoveryRequestRow[]> {
  const { rows } = await db.query<RecoveryRequestRow>(
    `SELECT * FROM account_recovery_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [userId]
  );
  return rows;
}

export async function listRecoveryRequests(db: Queryable, filter: { status?: RecoveryStatus; limit?: number } = {}): Promise<
  Array<RecoveryRequestRow & { user_email: string; username: string | null; customer_id: string | null }>
> {
  const params: unknown[] = [];
  let where = '';
  if (filter.status) {
    params.push(filter.status);
    where = `WHERE r.status = $${params.length}`;
  }
  params.push(filter.limit ?? 50);
  const { rows } = await db.query<RecoveryRequestRow & { user_email: string; username: string | null; customer_id: string | null }>(
    `SELECT r.*, u.email AS user_email, u.username, u.customer_id
       FROM account_recovery_requests r
       JOIN users u ON u.id = r.user_id
       ${where}
      ORDER BY r.created_at DESC
      LIMIT $${params.length}`,
    params
  );
  return rows;
}

export async function findRecoveryRequest(db: Queryable, id: string): Promise<RecoveryRequestRow | null> {
  const { rows } = await db.query<RecoveryRequestRow>(`SELECT * FROM account_recovery_requests WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function transitionRecoveryRequest(
  db: Queryable,
  input: {
    id: string;
    status: Extract<RecoveryStatus, 'IDENTITY_VERIFIED' | 'APPROVED' | 'REJECTED' | 'CANCELLED'>;
    actorId: string | null;
    note?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  }
): Promise<RecoveryRequestRow | null> {
  return withTransaction(db, async (tx) => {
    const terminal = input.status === 'APPROVED' || input.status === 'REJECTED' || input.status === 'CANCELLED';
    const { rows } = await tx.query<RecoveryRequestRow>(
      `UPDATE account_recovery_requests
          SET status = $2,
              resolution_note = coalesce($3, resolution_note),
              resolved_by = CASE WHEN $4 THEN $5 ELSE resolved_by END,
              resolved_at = CASE WHEN $4 THEN now() ELSE resolved_at END,
              updated_at = now()
        WHERE id = $1 AND status IN ('OPEN', 'IDENTITY_VERIFIED')
        RETURNING *`,
      [input.id, input.status, input.note ?? null, terminal, input.actorId]
    );
    const request = rows[0];
    if (!request) return null;

    if (input.status === 'APPROVED') {
      // Approval *revokes* and *forces re-verification*; it never discloses or resets the PIN.
      await tx.query(
        `UPDATE users SET email_verified_at = NULL, updated_at = now() WHERE id = $1`,
        [request.user_id]
      );
      // Any challenge opened before the recovery must not survive it.
      await tx.query(
        `UPDATE security_pin_verification_challenges
            SET consumed_at = now(), consumed_reason = 'cancelled', updated_at = now()
          WHERE user_id = $1 AND consumed_at IS NULL`,
        [request.user_id]
      );
    }

    await recordAuthEvent(tx, {
      id: randomUUID(),
      userId: request.user_id,
      eventType:
        input.status === 'APPROVED'
          ? 'account_recovery_approved'
          : input.status === 'REJECTED'
            ? 'account_recovery_rejected'
            : input.status === 'CANCELLED'
              ? 'account_recovery_cancelled'
              : 'account_recovery_identity_verified',
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      metadata: { reference: request.reference, status: input.status, actorId: input.actorId },
    });
    return request;
  });
}

/**
 * What a customer (or anyone reading the account) should be told after a recovery is approved.
 * Deliberately contains no secret and no link: the customer must still complete a fresh email
 * verification before the PIN can be viewed, which is the whole point of forcing it.
 */
export function recoveryApprovedMessage(): string {
  return [
    'Your account recovery request has been approved after identity verification.',
    'Your email address must be verified again before you can view your Security PIN.',
    'Your Security PIN itself was not revealed, reset, or sent to anyone.',
    'If you did not request this, contact support immediately and change your password.',
  ].join(' ');
}
