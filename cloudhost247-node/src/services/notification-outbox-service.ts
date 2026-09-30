/**
 * Notification email delivery.
 *
 * In-app notifications are durable and written in the same flow as the event that caused them.
 * The email copy is deliberately decoupled: it is queued in `notification_outbox` and delivered
 * by this sweep, never inline in the provisioning job. Two reasons:
 *
 *  - a slow or dead email webhook must not hold a worker that is finishing a customer's server;
 *  - a single inline attempt silently lost the email whenever the webhook was briefly down or
 *    had not been configured yet.
 *
 * Failure handling mirrors the provisioning rules: transient problems (timeouts, 429, 5xx) are
 * retried with backoff up to `max_attempts`; a missing or rejected credential is a configuration
 * problem that parks the row as CONFIGURATION_REQUIRED — retried for free once the operator fixes
 * it, never counted against the attempt budget — and a genuine 4xx is terminal.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';

/** Minutes to wait before attempt n+1. The last value repeats for any further attempts. */
const BACKOFF_MINUTES = [1, 5, 15, 60, 240];
/** How long an unconfigured integration is left alone before the sweep looks again. */
const CONFIGURATION_RECHECK_MINUTES = 15;
/** Lease window: a claimed row is pushed this far into the future so no second worker takes it. */
const CLAIM_LEASE_MINUTES = 5;

export interface OutboxDeliveryOptions {
  source?: NodeJS.ProcessEnv;
  now?: Date;
  limit?: number;
  fetchImpl?: typeof fetch;
}

export interface OutboxDeliveryReport {
  claimed: number;
  delivered: number;
  retrying: number;
  failed: number;
  configurationRequired: number;
}

interface ClaimedRow {
  id: string;
  attempts: number;
  max_attempts: number;
  notification_type: string;
  title: string;
  message: string;
  email: string | null;
  full_name: string | null;
}

/** Queues the email copy of an in-app notification. Never throws: email is best effort. */
export async function enqueueNotificationEmail(db: Queryable, notificationId: string): Promise<void> {
  await db.query(
    `INSERT INTO notification_outbox (id,notification_id,channel,status,attempts,next_attempt_at)
     VALUES ($1,$2,'EMAIL','PENDING',0,now())`,
    [randomUUID(), notificationId]
  );
}

function backoffMinutes(attempts: number): number {
  return BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length - 1)] ?? 240;
}

async function reschedule(db: Queryable, id: string, minutes: number, status: string, error: string | null): Promise<void> {
  await db.query(
    `UPDATE notification_outbox
        SET status=$2,next_attempt_at=now() + ($3 || ' minutes')::interval,last_error=$4,updated_at=now()
      WHERE id=$1`,
    [id, status, String(minutes), error?.slice(0, 500) ?? null]
  );
}

/**
 * Delivers every due outbox row. Safe to run concurrently: rows are claimed by pushing their next
 * attempt into the future before the HTTP call, so two workers never send the same email.
 */
export async function deliverNotificationOutbox(
  db: Queryable,
  options: OutboxDeliveryOptions = {}
): Promise<OutboxDeliveryReport> {
  const source = options.source ?? process.env;
  const doFetch = options.fetchImpl ?? fetch;
  const limit = options.limit ?? 25;
  const report: OutboxDeliveryReport = { claimed: 0, delivered: 0, retrying: 0, failed: 0, configurationRequired: 0 };

  const claimed = await db.query<ClaimedRow>(
    `UPDATE notification_outbox o
        SET next_attempt_at=now() + ($2 || ' minutes')::interval,updated_at=now()
       FROM (
         SELECT id FROM notification_outbox
          WHERE channel='EMAIL' AND status IN ('PENDING','CONFIGURATION_REQUIRED') AND next_attempt_at <= now()
          ORDER BY next_attempt_at
          LIMIT $1
          FOR UPDATE SKIP LOCKED
       ) due
      WHERE o.id=due.id
      RETURNING o.id,o.attempts,o.max_attempts,
        (SELECT type FROM user_notifications n WHERE n.id=o.notification_id) notification_type,
        (SELECT title FROM user_notifications n WHERE n.id=o.notification_id) title,
        (SELECT message FROM user_notifications n WHERE n.id=o.notification_id) message,
        (SELECT u.email FROM user_notifications n JOIN users u ON u.id=n.user_id WHERE n.id=o.notification_id) email,
        (SELECT u.full_name FROM user_notifications n JOIN users u ON u.id=n.user_id WHERE n.id=o.notification_id) full_name`,
    [limit, String(CLAIM_LEASE_MINUTES)]
  );
  report.claimed = claimed.rows.length;
  if (claimed.rows.length === 0) return report;

  const url = source.NOTIFICATION_EMAIL_WEBHOOK_URL;
  const token = source.NOTIFICATION_EMAIL_WEBHOOK_TOKEN;

  for (const row of claimed.rows) {
    // Fail closed on configuration: no endpoint means nothing was sent, and saying otherwise
    // would be a lie. The row waits, it is not burned.
    if (!url || !token) {
      await reschedule(db, row.id, CONFIGURATION_RECHECK_MINUTES, 'CONFIGURATION_REQUIRED', 'Email delivery webhook is not configured');
      report.configurationRequired += 1;
      continue;
    }
    if (!row.email) {
      await db.query(
        `UPDATE notification_outbox SET status='FAILED',last_error=$2,updated_at=now() WHERE id=$1`,
        [row.id, 'Notification recipient no longer exists']
      );
      report.failed += 1;
      continue;
    }

    const attempts = row.attempts + 1;
    try {
      const response = await doFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          to: row.email,
          name: row.full_name,
          template: row.notification_type.toLowerCase(),
          subject: row.title,
          text: row.message,
        }),
      });
      if (response.ok) {
        await db.query(
          `UPDATE notification_outbox SET status='DELIVERED',attempts=$2,delivered_at=now(),last_error=NULL,updated_at=now() WHERE id=$1`,
          [row.id, attempts]
        );
        report.delivered += 1;
        continue;
      }
      await db.query(`UPDATE notification_outbox SET attempts=$2 WHERE id=$1`, [row.id, attempts]);
      // A rejected credential is the operator's to fix; retrying it on a schedule would only
      // burn the attempt budget on a request that cannot succeed until they do.
      if (response.status === 401 || response.status === 403) {
        await reschedule(db, row.id, CONFIGURATION_RECHECK_MINUTES, 'CONFIGURATION_REQUIRED', `Email webhook rejected our credentials (HTTP ${response.status})`);
        report.configurationRequired += 1;
        continue;
      }
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      if (!retryable || attempts >= row.max_attempts) {
        await db.query(
          `UPDATE notification_outbox SET status='FAILED',last_error=$2,updated_at=now() WHERE id=$1`,
          [row.id, `Email webhook returned HTTP ${response.status}`]
        );
        report.failed += 1;
        continue;
      }
      await reschedule(db, row.id, backoffMinutes(attempts), 'PENDING', `Email webhook returned HTTP ${response.status}`);
      report.retrying += 1;
    } catch (error) {
      await db.query(`UPDATE notification_outbox SET attempts=$2 WHERE id=$1`, [row.id, attempts]);
      const message = (error as Error).message;
      if (attempts >= row.max_attempts) {
        await db.query(
          `UPDATE notification_outbox SET status='FAILED',last_error=$2,updated_at=now() WHERE id=$1`,
          [row.id, message.slice(0, 500)]
        );
        report.failed += 1;
        continue;
      }
      await reschedule(db, row.id, backoffMinutes(attempts), 'PENDING', message);
      report.retrying += 1;
    }
  }
  return report;
}

export interface OutboxSummaryRow {
  status: string;
  channel: string;
  count: number;
  oldest_created_at: string | null;
}

/** Operator visibility: how much mail is queued, stuck or permanently failed. */
export async function summarizeNotificationOutbox(db: Queryable): Promise<OutboxSummaryRow[]> {
  const { rows } = await db.query<OutboxSummaryRow>(
    `SELECT status,channel,count(*)::int count,min(created_at) oldest_created_at
       FROM notification_outbox GROUP BY status,channel ORDER BY status,channel`
  );
  return rows;
}

/** The most recent problem rows, so an operator can see why mail is not going out. */
export async function listFailedNotificationDeliveries(db: Queryable, limit = 50) {
  const { rows } = await db.query(
    `SELECT o.id,o.status,o.channel,o.attempts,o.max_attempts,o.last_error,o.next_attempt_at,o.created_at,
            n.type notification_type,n.title
       FROM notification_outbox o
       JOIN user_notifications n ON n.id=o.notification_id
      WHERE o.status IN ('FAILED','CONFIGURATION_REQUIRED')
      ORDER BY o.updated_at DESC
      LIMIT $1`,
    [Math.min(limit, 200)]
  );
  return rows;
}
