import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';
import type { CustomerServerDetailRow } from '../db/server-provisioning';
import { enqueueNotificationEmail } from './notification-outbox-service';

export interface NotificationInput {
  userId: string;
  type: string;
  title: string;
  message: string;
  resourceType?: string | null;
  resourceId?: string | null;
}

/**
 * Writes the durable in-app notification and queues its email copy.
 *
 * The insert is idempotent through the partial unique index on
 * (user_id, type, resource_type, resource_id), so a redelivered job re-notifies nobody — and
 * because the outbox row is only queued when the insert actually created a notification, it
 * cannot send a duplicate email either. Delivery itself happens in the outbox sweep: no HTTP
 * call is made on the path that is finishing a customer's server.
 */
export async function createNotification(db: Queryable, input: NotificationInput): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO user_notifications (id,user_id,type,title,message,resource_type,resource_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (user_id,type,resource_type,resource_id) WHERE resource_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [randomUUID(),input.userId,input.type,input.title,input.message,input.resourceType ?? null,input.resourceId ?? null]
  );
  const id = rows[0]?.id;
  if (!id) return null;
  await enqueueNotificationEmail(db, id);
  return id;
}

/** Announces a server that has passed every health gate, or a completed reinstall. */
export async function notifyServerReady(
  db: Queryable,
  server: CustomerServerDetailRow,
  type: 'SERVER_READY'|'SERVER_REINSTALLED' = 'SERVER_READY'
): Promise<void> {
  if (!server.customer_id) return;
  await createNotification(db, {
    userId: server.customer_id,
    type,
    title: type === 'SERVER_REINSTALLED'
      ? 'Your CloudHost247 server reinstall is complete'
      : 'Your CloudHost247 server is ready',
    message: [
      `Server: ${server.name}`,
      `Operating system: ${server.os_display_name ?? 'Unknown'}`,
      `IP address: ${server.ip_address ?? 'Available in the dashboard'}`,
      `Region: ${server.region_name ?? '—'}`,
      'Your server is now available from your CloudHost247 dashboard.',
    ].join('\n'),
    resourceType: 'server',
    resourceId: server.id,
  });
}

/**
 * Confirms a completed termination. In-app only and idempotent through the notification unique
 * index, so a redelivered DELETE job cannot notify the customer twice. The message never claims
 * data can be recovered — by this point the provider resource is gone.
 */
export async function notifyServerTerminated(db: Queryable, server: CustomerServerDetailRow): Promise<void> {
  if (!server.customer_id) return;
  await createNotification(db, {
    userId: server.customer_id,
    type: 'SERVER_TERMINATED',
    title: 'Your CloudHost247 server has been terminated',
    message: [
      `Server: ${server.name}`,
      `Hostname: ${server.hostname}`,
      'The server has been destroyed at the infrastructure provider and billing for it has stopped.',
      'Its data cannot be recovered. Your invoices and account history are unchanged.',
    ].join('\n'),
    resourceType: 'server',
    resourceId: server.id,
  });
}

export async function listNotifications(db: Queryable, userId: string) {
  const { rows } = await db.query(
    `SELECT * FROM user_notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`, [userId]
  );
  return rows;
}

export async function countUnreadNotifications(db: Queryable, userId: string): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    `SELECT count(*)::text count FROM user_notifications WHERE user_id=$1 AND read_at IS NULL`, [userId]
  );
  return Number(rows[0]?.count ?? '0');
}

/**
 * Marks one notification read. Scoped by user id so a customer can never touch — or discover the
 * existence of — another customer's notification.
 */
export async function markNotificationRead(db: Queryable, userId: string, notificationId: string): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE user_notifications SET read_at=COALESCE(read_at,now()) WHERE id=$1 AND user_id=$2 RETURNING id`,
    [notificationId, userId]
  );
  return Boolean(rows[0]);
}

export async function markAllNotificationsRead(db: Queryable, userId: string): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE user_notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL RETURNING id`, [userId]
  );
  return rows.length;
}
