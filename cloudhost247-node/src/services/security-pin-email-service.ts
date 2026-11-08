/**
 * Durable delivery of Security PIN mail.
 *
 * Two kinds of mail exist, and they are deliberately handled differently:
 *
 *   * **Verification codes** are time-critical and must never be stored in plaintext. They are
 *     queued in their own table (`pin_verification_email_queue`, migration 0085) holding only an
 *     AES-GCM *envelope* of the code; the worker decrypts in memory immediately before sending. If
 *     the queue row outlives its code — expired, already used, or superseded by a resend — it is
 *     cancelled rather than delivered late, because a stale code is worse than no code.
 *   * **Rotation notices** carry no secret and are ordinary notifications, so they go through
 *     `user_notifications` + `notification_outbox`, the platform's existing durable pipeline. That
 *     means they appear in the customer's notification centre too, and honour the same retry and
 *     configuration semantics as every other notification.
 *
 * Nothing here logs a code or a PIN.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';
import { securityPinVerificationCodeEmail } from '../lib/pin-email-templates';

const CODE_ENVELOPE_PREFIX = 'pinv1';
const BACKOFF_MINUTES = [1, 5, 15, 60, 240];

/**
 * Encrypts a verification code for the short trip through the mail queue.
 *
 * The code is never written to Postgres in plaintext, not even temporarily: the queue row holds
 * `pinv1:<iv>:<tag>:<ciphertext>` under an AES-256-GCM key derived from the PIN key, so a database
 * snapshot taken while a code is in flight still contains no usable code. The worker decrypts only
 * in memory, immediately before handing the text to the mail transport.
 */
export function sealCode(code: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [CODE_ENVELOPE_PREFIX, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

export function openSealedCode(envelope: string, key: Buffer): string | null {
  const [prefix, ivPart, tagPart, dataPart] = String(envelope ?? '').split(':');
  if (prefix !== CODE_ENVELOPE_PREFIX || !ivPart || !tagPart || !dataPart) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Dedicated key for the queue envelope, separated from the PIN hash key by domain separation. */
export function deriveCodeKey(pinKey: Buffer): Buffer {
  return createHmac('sha256', pinKey).update('cloudhost247:security-pin:code-envelope:v1').digest();
}

/**
 * Queues the verification code mail. One row per challenge (`challenge_id` is unique), so a resend
 * replaces the pending row's envelope via `ON CONFLICT … DO UPDATE` rather than stacking codes —
 * two codes in flight for one challenge would be a way to keep an older code alive.
 *
 * Nothing in the row is a usable code: `code_envelope` is the AES-GCM sealed value.
 */
export async function queueVerificationCodeEmail(
  db: Queryable,
  input: {
    challengeId: string;
    userId: string;
    email: string;
    name?: string | null;
    codeEnvelope: string;
    ttlMinutes: number;
    /** When the code stops being valid; the drain refuses to deliver past it. */
    expiresAt: string;
  }
): Promise<{ queued: boolean; outboxId: string }> {
  const outboxId = randomUUID();
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO pin_verification_email_queue
       (id, challenge_id, user_id, recipient_email, recipient_name, code_envelope, ttl_minutes, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (challenge_id) DO UPDATE
       SET code_envelope = EXCLUDED.code_envelope,
           ttl_minutes = EXCLUDED.ttl_minutes,
           expires_at = EXCLUDED.expires_at,
           recipient_email = EXCLUDED.recipient_email,
           recipient_name = EXCLUDED.recipient_name,
           status = 'PENDING',
           attempts = 0,
           next_attempt_at = now(),
           last_error = NULL,
           delivered_at = NULL,
           updated_at = now()
     RETURNING id`,
    [
      outboxId,
      input.challengeId,
      input.userId,
      input.email,
      input.name ?? null,
      input.codeEnvelope,
      input.ttlMinutes,
      input.expiresAt,
    ]
  );
  return { queued: rows.length > 0, outboxId: rows[0]?.id ?? outboxId };
}

export interface PinEmailDeliveryReport {
  claimed: number;
  delivered: number;
  retrying: number;
  failed: number;
  cancelled: number;
  configurationRequired: number;
}

interface ClaimedPinEmailRow {
  id: string;
  attempts: number;
  max_attempts: number;
  code_envelope: string;
  recipient_email: string;
  recipient_name: string | null;
  expires_at: string;
  consumed_at: string | null;
  verified_at: string | null;
  ttl_minutes: number;
  customer_id: string | null;
}

function backoffMinutes(attempts: number): number {
  return BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length - 1)] ?? 240;
}

export interface PinEmailDeliveryOptions {
  source?: NodeJS.ProcessEnv;
  limit?: number;
  fetchImpl?: typeof fetch;
  pinKey?: Buffer;
}

/**
 * Drains due verification-code mail. Same claim-lease discipline as the other outboxes: a claimed
 * row's next attempt is pushed into the future before the HTTP call, so concurrent workers cannot
 * send the same code twice, and a row whose code has expired or been consumed is cancelled instead
 * of being delivered late.
 */
export async function deliverPinVerificationEmails(
  db: Queryable,
  options: PinEmailDeliveryOptions = {}
): Promise<PinEmailDeliveryReport> {
  const source = options.source ?? process.env;
  const doFetch = options.fetchImpl ?? fetch;
  const report: PinEmailDeliveryReport = {
    claimed: 0,
    delivered: 0,
    retrying: 0,
    failed: 0,
    cancelled: 0,
    configurationRequired: 0,
  };
  const limit = options.limit ?? 25;

  const { rows } = await db.query<ClaimedPinEmailRow>(
    `UPDATE pin_verification_email_queue q
        SET next_attempt_at = now() + interval '5 minutes', updated_at = now()
       FROM (
         SELECT id FROM pin_verification_email_queue
          WHERE status IN ('PENDING','CONFIGURATION_REQUIRED') AND next_attempt_at <= now()
          ORDER BY next_attempt_at
          LIMIT $1
          FOR UPDATE SKIP LOCKED
       ) due
      WHERE q.id = due.id
      RETURNING q.id, q.attempts, q.max_attempts, q.code_envelope, q.recipient_email, q.recipient_name,
        q.expires_at, q.ttl_minutes,
        -- Liveness comes from the challenge, not the queue: the queue row only knows when *it* was
        -- written, while the challenge is what gets consumed by a correct code, a newer challenge,
        -- or an account recovery. Reading these from the queue itself would fail at parse time
        -- (the columns do not exist there), which is how a drain can silently never run.
        (SELECT c.consumed_at FROM security_pin_verification_challenges c WHERE c.id = q.challenge_id) consumed_at,
        (SELECT c.verified_at FROM security_pin_verification_challenges c WHERE c.id = q.challenge_id) verified_at,
        (SELECT customer_id FROM users u WHERE u.id = q.user_id) customer_id`,
    [limit]
  );
  report.claimed = rows.length;
  if (rows.length === 0) return report;

  const url = source.NOTIFICATION_EMAIL_WEBHOOK_URL;
  const token = source.NOTIFICATION_EMAIL_WEBHOOK_TOKEN;
  const key = options.pinKey;

  for (const row of rows) {
    if (row.consumed_at || row.verified_at || new Date(row.expires_at).getTime() <= Date.now()) {
      await db.query(
        `UPDATE pin_verification_email_queue SET status='CANCELLED', last_error=$2, updated_at=now() WHERE id=$1`,
        [row.id, 'Verification code expired or was superseded before delivery']
      );
      report.cancelled += 1;
      continue;
    }
    if (!url || !token) {
      await db.query(
        `UPDATE pin_verification_email_queue
            SET status='CONFIGURATION_REQUIRED', next_attempt_at=now() + interval '15 minutes',
                last_error='Email delivery webhook is not configured', updated_at=now()
          WHERE id=$1`,
        [row.id]
      );
      report.configurationRequired += 1;
      continue;
    }
    if (!key) {
      await db.query(
        `UPDATE pin_verification_email_queue
            SET status='CONFIGURATION_REQUIRED', next_attempt_at=now() + interval '15 minutes',
                last_error='Security PIN key is not configured', updated_at=now()
          WHERE id=$1`,
        [row.id]
      );
      report.configurationRequired += 1;
      continue;
    }

    const code = openSealedCode(row.code_envelope, deriveCodeKey(key));
    if (!code) {
      await db.query(
        `UPDATE pin_verification_email_queue SET status='FAILED', last_error=$2, updated_at=now() WHERE id=$1`,
        [row.id, 'Stored verification code could not be decrypted (key changed?)']
      );
      report.failed += 1;
      continue;
    }

    const attempts = row.attempts + 1;
    try {
      const content = securityPinVerificationCodeEmail({
        name: row.recipient_name,
        email: row.recipient_email,
        code,
        ttlMinutes: row.ttl_minutes,
        customerId: row.customer_id,
      });
      const response = await doFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          to: row.recipient_email,
          name: row.recipient_name,
          template: 'security_pin_verification_code',
          subject: content.subject,
          text: content.text,
        }),
      });
      if (response.ok) {
        await db.query(
          `UPDATE pin_verification_email_queue
              SET status='DELIVERED', attempts=$2, delivered_at=now(), last_error=NULL, updated_at=now()
            WHERE id=$1`,
          [row.id, attempts]
        );
        report.delivered += 1;
        continue;
      }
      await db.query(`UPDATE pin_verification_email_queue SET attempts=$2 WHERE id=$1`, [row.id, attempts]);
      if (response.status === 401 || response.status === 403) {
        await db.query(
          `UPDATE pin_verification_email_queue
              SET status='CONFIGURATION_REQUIRED', next_attempt_at=now() + interval '15 minutes',
                  last_error=$2, updated_at=now()
            WHERE id=$1`,
          [row.id, `Email transport rejected our credentials (HTTP ${response.status})`]
        );
        report.configurationRequired += 1;
        continue;
      }
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      if (!retryable || attempts >= row.max_attempts) {
        await db.query(
          `UPDATE pin_verification_email_queue SET status='FAILED', last_error=$2, updated_at=now() WHERE id=$1`,
          [row.id, `Email transport returned HTTP ${response.status}`]
        );
        report.failed += 1;
        continue;
      }
      await db.query(
        `UPDATE pin_verification_email_queue
            SET next_attempt_at=now() + ($2 || ' minutes')::interval, last_error=$3, updated_at=now()
          WHERE id=$1`,
        [row.id, String(backoffMinutes(attempts)), `Email transport returned HTTP ${response.status}`]
      );
      report.retrying += 1;
    } catch (error) {
      await db.query(`UPDATE pin_verification_email_queue SET attempts=$2 WHERE id=$1`, [row.id, attempts]);
      const message = error instanceof Error ? error.message : 'Email transport request failed';
      if (attempts >= row.max_attempts) {
        await db.query(
          `UPDATE pin_verification_email_queue SET status='FAILED', last_error=$2, updated_at=now() WHERE id=$1`,
          [row.id, message.slice(0, 500)]
        );
        report.failed += 1;
        continue;
      }
      await db.query(
        `UPDATE pin_verification_email_queue
            SET next_attempt_at=now() + ($2 || ' minutes')::interval, last_error=$3, updated_at=now()
          WHERE id=$1`,
        [row.id, String(backoffMinutes(attempts)), message.slice(0, 500)]
      );
      report.retrying += 1;
    }
  }
  return report;
}
