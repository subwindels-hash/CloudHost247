/**
 * Durable email-verification and password-recovery actions.
 *
 * A recovery link is a bearer credential, so its plaintext is deliberately never inserted into
 * Postgres. Each link token is derived as an HMAC of a random action UUID, its purpose, and the
 * application JWT secret. The database persists only SHA-256(token); the outbox keeps the action
 * UUID and derives the link only in memory immediately before calling the configured mail relay.
 */
import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import { withTransaction } from '../db/transaction';
import { recordAuthEvent, updatePasswordHash, type UserRecord } from '../db/users';

const BACKOFF_MINUTES = [1, 5, 15, 60, 240];
const CONFIGURATION_RECHECK_MINUTES = 15;
const CLAIM_LEASE_MINUTES = 5;
const MAX_ISSUES_PER_HOUR = 3;

export type AuthActionPurpose = 'email_verification' | 'password_reset';

export interface AuthActionAuditContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuthActionIssueResult {
  issued: boolean;
  rateLimited: boolean;
}

interface ActionConfiguration {
  path: string;
  ttlMinutes: number;
  requestedEvent: 'email_verification_requested' | 'password_reset_requested';
}

function actionConfiguration(purpose: AuthActionPurpose): ActionConfiguration {
  switch (purpose) {
    case 'email_verification':
      return { path: 'verify-email', ttlMinutes: 24 * 60, requestedEvent: 'email_verification_requested' };
    case 'password_reset':
      return { path: 'reset-password', ttlMinutes: 30, requestedEvent: 'password_reset_requested' };
  }
}

/** A domain-separated, high-entropy bearer value which is never persisted in plaintext. */
export function deriveAuthActionToken(jwtSecret: string, purpose: AuthActionPurpose, actionId: string): string {
  return createHmac('sha256', jwtSecret).update(`cloudhost247:auth-action:v1:${purpose}:${actionId}`).digest('base64url');
}

export function hashAuthActionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function actionUrl(appUrl: string, path: string, token: string): string {
  const base = new URL(appUrl);
  // APP_URL may be hosted under a Passenger prefix. Preserve that prefix instead of assuming the
  // application is always mounted at '/'.
  base.pathname = `${base.pathname.replace(/\/$/, '')}/${path}`.replace(/\/+/g, '/');
  base.search = new URLSearchParams({ token }).toString();
  base.hash = '';
  return base.toString();
}

function emailContent(row: ClaimedAuthEmailRow, env: Pick<Env, 'APP_URL' | 'JWT_SECRET'>): { subject: string; text: string } {
  const token = deriveAuthActionToken(env.JWT_SECRET, row.email_type, row.token_id);
  const config = actionConfiguration(row.email_type);
  const url = actionUrl(env.APP_URL, config.path, token);
  const greeting = row.recipient_name ? `Hello ${row.recipient_name},` : 'Hello,';

  if (row.email_type === 'email_verification') {
    return {
      subject: 'Verify your CloudHost247 email address',
      text: `${greeting}\n\nVerify your email address to complete your CloudHost247 account setup:\n${url}\n\nThis link expires in 24 hours and can be used once. If you did not create this account, you can ignore this email.`,
    };
  }

  return {
    subject: 'Reset your CloudHost247 password',
    text: `${greeting}\n\nWe received a request to reset your CloudHost247 password. Choose a new password here:\n${url}\n\nThis link expires in 30 minutes and can be used once. If you did not request a password reset, you can ignore this email.`,
  };
}

/**
 * Creates one action and its delivery job atomically. Previous unused actions of the same kind
 * become unusable before the new row is added, so at most one email link can be redeemed.
 */
export async function issueAuthAction(
  db: Queryable,
  env: Pick<Env, 'JWT_SECRET'>,
  user: UserRecord,
  purpose: AuthActionPurpose,
  audit: AuthActionAuditContext = {}
): Promise<AuthActionIssueResult> {
  const config = actionConfiguration(purpose);
  return withTransaction(db, async (tx) => {
    const recent = await tx.query<{ count: number | string }>(
      `SELECT count(*)::int AS count
         FROM auth_action_tokens
        WHERE user_id=$1 AND purpose=$2 AND created_at > now() - interval '1 hour'`,
      [user.id, purpose]
    );
    if (Number(recent.rows[0]?.count ?? 0) >= MAX_ISSUES_PER_HOUR) {
      return { issued: false, rateLimited: true };
    }

    // Expire/cancel prior live links before issuing a replacement. `used_at` doubles as the
    // terminal marker; the mail worker sees it and marks its old outbox item CANCELLED.
    await tx.query(
      `UPDATE auth_action_tokens
          SET used_at=now()
        WHERE user_id=$1 AND purpose=$2 AND used_at IS NULL`,
      [user.id, purpose]
    );

    const id = randomUUID();
    const tokenHash = hashAuthActionToken(deriveAuthActionToken(env.JWT_SECRET, purpose, id));
    const inserted = await tx.query<{ expires_at: string }>(
      `INSERT INTO auth_action_tokens (id,user_id,purpose,token_hash,expires_at)
       VALUES ($1,$2,$3,$4,now() + ($5 || ' minutes')::interval)
       RETURNING expires_at`,
      [id, user.id, purpose, tokenHash, String(config.ttlMinutes)]
    );
    if (!inserted.rows[0]) throw new Error('Failed to create account-recovery action');

    await tx.query(
      `INSERT INTO auth_email_outbox (
         id,user_id,token_id,email_type,recipient_email,recipient_name,status,attempts,next_attempt_at
       ) VALUES ($1,$2,$3,$4,$5,$6,'PENDING',0,now())`,
      [randomUUID(), user.id, id, purpose, user.email, user.full_name]
    );
    await recordAuthEvent(tx, {
      id: randomUUID(),
      userId: user.id,
      eventType: config.requestedEvent,
      ipAddress: audit.ipAddress ?? null,
      userAgent: audit.userAgent ?? null,
    });
    return { issued: true, rateLimited: false };
  });
}

async function consumeAction(
  db: Queryable,
  purpose: AuthActionPurpose,
  token: string
): Promise<string | null> {
  // A SHA-256 digest is performed even for malformed or nonsense tokens. There is no early
  // lookup by user/email, so callers receive the same invalid-link outcome for every failure.
  const hash = hashAuthActionToken(token);
  return withTransaction(db, async (tx) => {
    const claimed = await tx.query<{ user_id: string }>(
      `UPDATE auth_action_tokens
          SET used_at=now()
        WHERE token_hash=$1 AND purpose=$2 AND used_at IS NULL AND expires_at > now()
        RETURNING user_id`,
      [hash, purpose]
    );
    return claimed.rows[0]?.user_id ?? null;
  });
}

export async function confirmEmailVerification(
  db: Queryable,
  token: string,
  audit: AuthActionAuditContext = {}
): Promise<boolean> {
  const hash = hashAuthActionToken(token);
  return withTransaction(db, async (tx) => {
    const claimed = await tx.query<{ user_id: string }>(
      `UPDATE auth_action_tokens
          SET used_at=now()
        WHERE token_hash=$1 AND purpose='email_verification' AND used_at IS NULL AND expires_at > now()
        RETURNING user_id`,
      [hash]
    );
    const userId = claimed.rows[0]?.user_id;
    if (!userId) return false;
    await tx.query(
      `UPDATE users SET email_verified_at=coalesce(email_verified_at,now()),updated_at=now() WHERE id=$1`,
      [userId]
    );
    await recordAuthEvent(tx, {
      id: randomUUID(),
      userId,
      eventType: 'email_verified',
      ipAddress: audit.ipAddress ?? null,
      userAgent: audit.userAgent ?? null,
    });
    return true;
  });
}

export async function completePasswordReset(
  db: Queryable,
  token: string,
  passwordHash: string,
  audit: AuthActionAuditContext = {}
): Promise<boolean> {
  const hash = hashAuthActionToken(token);
  return withTransaction(db, async (tx) => {
    const claimed = await tx.query<{ user_id: string }>(
      `UPDATE auth_action_tokens
          SET used_at=now()
        WHERE token_hash=$1 AND purpose='password_reset' AND used_at IS NULL AND expires_at > now()
        RETURNING user_id`,
      [hash]
    );
    const userId = claimed.rows[0]?.user_id;
    if (!userId) return false;
    const user = await updatePasswordHash(tx, userId, passwordHash);
    if (!user) throw new Error('Password-reset action belongs to a missing user');
    await recordAuthEvent(tx, {
      id: randomUUID(),
      userId,
      eventType: 'password_reset_completed',
      ipAddress: audit.ipAddress ?? null,
      userAgent: audit.userAgent ?? null,
    });
    return true;
  });
}

export interface AuthEmailOutboxDeliveryOptions {
  env: Pick<Env, 'APP_URL' | 'JWT_SECRET'>;
  source?: Pick<NodeJS.ProcessEnv, 'NOTIFICATION_EMAIL_WEBHOOK_URL' | 'NOTIFICATION_EMAIL_WEBHOOK_TOKEN'>;
  limit?: number;
  fetchImpl?: typeof fetch;
}

export interface AuthEmailOutboxDeliveryReport {
  claimed: number;
  delivered: number;
  retrying: number;
  failed: number;
  configurationRequired: number;
  cancelled: number;
}

interface ClaimedAuthEmailRow {
  id: string;
  token_id: string;
  email_type: AuthActionPurpose;
  recipient_email: string;
  recipient_name: string | null;
  attempts: number;
  max_attempts: number;
  token_hash: string | null;
  token_expires_at: string;
  token_used_at: string | null;
}

function backoffMinutes(attempts: number): number {
  return BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length - 1)] ?? 240;
}

async function rescheduleAuthEmail(
  db: Queryable,
  id: string,
  minutes: number,
  status: 'PENDING' | 'CONFIGURATION_REQUIRED',
  error: string | null
): Promise<void> {
  await db.query(
    `UPDATE auth_email_outbox
        SET status=$2,next_attempt_at=now() + ($3 || ' minutes')::interval,last_error=$4,updated_at=now()
      WHERE id=$1`,
    [id, status, String(minutes), error?.slice(0, 500) ?? null]
  );
}

/**
 * Sends due verification/recovery mail through the already-configured operator webhook. This is
 * intentionally separate from notification_outbox: recovery mail is security-sensitive and has
 * no matching in-app notification row. It never logs or persists the raw link token.
 */
export async function deliverAuthEmailOutbox(
  db: Queryable,
  options: AuthEmailOutboxDeliveryOptions
): Promise<AuthEmailOutboxDeliveryReport> {
  const source = options.source ?? process.env;
  const doFetch = options.fetchImpl ?? fetch;
  const limit = options.limit ?? 25;
  const report: AuthEmailOutboxDeliveryReport = {
    claimed: 0,
    delivered: 0,
    retrying: 0,
    failed: 0,
    configurationRequired: 0,
    cancelled: 0,
  };

  const claimed = await db.query<ClaimedAuthEmailRow>(
    `UPDATE auth_email_outbox o
        SET next_attempt_at=now() + ($2 || ' minutes')::interval,updated_at=now()
       FROM (
         SELECT id FROM auth_email_outbox
          WHERE status IN ('PENDING','CONFIGURATION_REQUIRED') AND next_attempt_at <= now()
          ORDER BY next_attempt_at
          LIMIT $1
          FOR UPDATE SKIP LOCKED
       ) due
      WHERE o.id=due.id
      RETURNING o.id,o.token_id,o.email_type,o.recipient_email,o.recipient_name,o.attempts,o.max_attempts,
        (SELECT token_hash FROM auth_action_tokens t WHERE t.id=o.token_id) token_hash,
        (SELECT expires_at FROM auth_action_tokens t WHERE t.id=o.token_id) token_expires_at,
        (SELECT used_at FROM auth_action_tokens t WHERE t.id=o.token_id) token_used_at`,
    [limit, String(CLAIM_LEASE_MINUTES)]
  );
  report.claimed = claimed.rows.length;

  const url = source.NOTIFICATION_EMAIL_WEBHOOK_URL;
  const webhookToken = source.NOTIFICATION_EMAIL_WEBHOOK_TOKEN;
  for (const row of claimed.rows) {
    // Do not deliver a link already superseded, redeemed, or expired while it waited in the
    // queue. The CANCELLED record is deliberate operator-visible evidence, not a silent delete.
    if (row.token_used_at || !row.token_expires_at || new Date(row.token_expires_at).getTime() <= Date.now()) {
      await db.query(
        `UPDATE auth_email_outbox SET status='CANCELLED',last_error=$2,updated_at=now() WHERE id=$1`,
        [row.id, 'Authentication action expired, was superseded, or was already consumed']
      );
      report.cancelled += 1;
      continue;
    }
    // A JWT signing-key rotation intentionally invalidates outstanding action links. Do not
    // derive and send a different, non-redeemable token under the new key; retain a visible
    // cancellation record instead.
    const currentlyDerivedHash = hashAuthActionToken(deriveAuthActionToken(options.env.JWT_SECRET, row.email_type, row.token_id));
    if (!row.token_hash || row.token_hash !== currentlyDerivedHash) {
      await db.query(
        `UPDATE auth_email_outbox SET status='CANCELLED',last_error=$2,updated_at=now() WHERE id=$1`,
        [row.id, 'Authentication action was invalidated by signing-key rotation']
      );
      report.cancelled += 1;
      continue;
    }
    if (!url || !webhookToken) {
      await rescheduleAuthEmail(
        db,
        row.id,
        CONFIGURATION_RECHECK_MINUTES,
        'CONFIGURATION_REQUIRED',
        'Email delivery webhook is not configured'
      );
      report.configurationRequired += 1;
      continue;
    }

    const attempts = row.attempts + 1;
    try {
      const content = emailContent(row, options.env);
      const response = await doFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${webhookToken}` },
        body: JSON.stringify({
          to: row.recipient_email,
          name: row.recipient_name,
          template: `auth_${row.email_type}`,
          subject: content.subject,
          text: content.text,
        }),
      });
      if (response.ok) {
        await db.query(
          `UPDATE auth_email_outbox
              SET status='DELIVERED',attempts=$2,delivered_at=now(),last_error=NULL,updated_at=now()
            WHERE id=$1`,
          [row.id, attempts]
        );
        report.delivered += 1;
        continue;
      }
      await db.query(`UPDATE auth_email_outbox SET attempts=$2 WHERE id=$1`, [row.id, attempts]);
      if (response.status === 401 || response.status === 403) {
        await rescheduleAuthEmail(
          db,
          row.id,
          CONFIGURATION_RECHECK_MINUTES,
          'CONFIGURATION_REQUIRED',
          `Email webhook rejected our credentials (HTTP ${response.status})`
        );
        report.configurationRequired += 1;
        continue;
      }
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      if (!retryable || attempts >= row.max_attempts) {
        await db.query(
          `UPDATE auth_email_outbox SET status='FAILED',last_error=$2,updated_at=now() WHERE id=$1`,
          [row.id, `Email webhook returned HTTP ${response.status}`]
        );
        report.failed += 1;
        continue;
      }
      await rescheduleAuthEmail(
        db,
        row.id,
        backoffMinutes(attempts),
        'PENDING',
        `Email webhook returned HTTP ${response.status}`
      );
      report.retrying += 1;
    } catch (error) {
      await db.query(`UPDATE auth_email_outbox SET attempts=$2 WHERE id=$1`, [row.id, attempts]);
      const message = error instanceof Error ? error.message : 'Email webhook request failed';
      if (attempts >= row.max_attempts) {
        await db.query(
          `UPDATE auth_email_outbox SET status='FAILED',last_error=$2,updated_at=now() WHERE id=$1`,
          [row.id, message.slice(0, 500)]
        );
        report.failed += 1;
        continue;
      }
      await rescheduleAuthEmail(db, row.id, backoffMinutes(attempts), 'PENDING', message);
      report.retrying += 1;
    }
  }
  return report;
}

/** Kept for focused tests and internal callers that need one generic consumption primitive. */
export const __private__ = { consumeAction, actionUrl, emailContent };
