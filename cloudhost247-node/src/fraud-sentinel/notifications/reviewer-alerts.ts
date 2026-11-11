/**
 * Reviewer notifications for newly raised fraud alerts.
 *
 * Delivery rides the EXISTING notification pipeline (`createNotification` → `user_notifications` +
 * `notification_outbox` → the platform's configured email bridge). No second mailer, no new transport,
 * and no HTTP call on the scan path.
 *
 * Three properties are load-bearing:
 *
 *  1. IDEMPOTENT. `createNotification` conflicts on (user_id, type, resource_type, resource_id), so a
 *     re-run scan cannot notify the same reviewer twice about the same alert, and the count returned
 *     here is the number of notifications actually created — never the number attempted.
 *
 *  2. ONLY ADMINS ARE NOTIFIED. The recipient list is `fraud_sentinel.notify_reviewer_roles`
 *     (super_admin, admin by default). A customer is never told that a fraud rule fired on their
 *     account: the alert text names the rules and the score, and handing that to the subject of an
 *     investigation would help them evade it. The customer-facing notification templates elsewhere in
 *     this codebase are for billing, not for fraud.
 *
 *  3. THE WORDING CLAIMS NOTHING. The message says a pattern was detected and points at the alert for
 *     its evidence. It never says fraud was confirmed, and it repeats the advisory boundary, because a
 *     notification read on a phone is the place most likely to be mistaken for a verdict.
 */
import type { Queryable } from '../../db/types';
import { createNotification } from '../../services/notification-service';
import type { FsSettings } from '../utils/settings';

export const FRAUD_ALERT_NOTIFICATION_TYPE = 'FRAUD_SENTINEL_ALERT';
export const FRAUD_ALERT_RESOURCE_TYPE = 'fraud_sentinel_alert';

export interface AlertNotificationInput {
  alertId: string;
  alertNumber: string;
  title: string;
  explanation: string;
  riskLevel: string;
}

/** Active users holding one of the configured reviewer roles. */
export async function listReviewerIds(db: Queryable, roles: readonly string[]): Promise<string[]> {
  if (roles.length === 0) return [];
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM users WHERE role = ANY($1::varchar[]) AND status = 'active' ORDER BY id`,
    [[...roles]]
  );
  return rows.map((row) => String(row.id));
}

function buildMessage(alert: AlertNotificationInput): string {
  return [
    `Fraud Sentinel raised ${alert.alertNumber} (${alert.riskLevel.toUpperCase()} risk).`,
    '',
    alert.title,
    '',
    alert.explanation,
    '',
    'This is a detection, not a confirmed finding: the score is derived from recorded platform activity and the alert lists the rows behind it. ' +
      'Fraud Sentinel is advisory and has taken no action on any payment, order, balance, entitlement or account status. ' +
      'Review the evidence and decide the response through the existing authorized workflow.',
  ].join('\n');
}

/**
 * Notifies every configured reviewer about one alert.
 *
 * @returns how many notifications were actually created (0 when they all already existed).
 */
export async function notifyReviewersOfAlert(
  db: Queryable,
  alert: AlertNotificationInput,
  settings: FsSettings
): Promise<number> {
  const reviewerIds = await listReviewerIds(db, settings.notifyReviewerRoles);
  let sent = 0;
  for (const reviewerId of reviewerIds) {
    const notificationId = await createNotification(db, {
      userId: reviewerId,
      type: FRAUD_ALERT_NOTIFICATION_TYPE,
      title: `Fraud alert ${alert.alertNumber} — ${alert.riskLevel.toUpperCase()} risk`,
      message: buildMessage(alert),
      resourceType: FRAUD_ALERT_RESOURCE_TYPE,
      resourceId: alert.alertId,
    });
    if (notificationId) sent += 1;
  }
  return sent;
}
