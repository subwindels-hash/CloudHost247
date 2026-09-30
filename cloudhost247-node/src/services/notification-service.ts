import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';
import type { CustomerServerDetailRow } from '../db/server-provisioning';

/**
 * Creates the in-app notification first (durable), then optionally delivers the same non-secret
 * message to an operator-configured email webhook. Missing email configuration is explicit in the
 * outbox; it never rolls back an already-ready server or pretends an email was sent.
 */
export async function notifyServerReady(
  db: Queryable,
  server: CustomerServerDetailRow,
  source: NodeJS.ProcessEnv = process.env,
  type: 'SERVER_READY'|'SERVER_REINSTALLED' = 'SERVER_READY'
): Promise<void> {
  const notificationId = randomUUID();
  const title = type==='SERVER_REINSTALLED'?'Your CloudHost247 server reinstall is complete':'Your CloudHost247 server is ready';
  const message = [
    `Server: ${server.name}`,
    `Operating system: ${server.os_display_name ?? 'Unknown'}`,
    `IP address: ${server.ip_address ?? 'Available in the dashboard'}`,
    `Region: ${server.region_name ?? '—'}`,
    'Your server is now available from your CloudHost247 dashboard.',
  ].join('\n');
  const inserted=await db.query<{id:string}>(
    `INSERT INTO user_notifications (id,user_id,type,title,message,resource_type,resource_id)
     VALUES ($1,$2,$6,$3,$4,'server',$5)
     ON CONFLICT (user_id,type,resource_type,resource_id) WHERE resource_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [notificationId,server.customer_id,title,message,server.id,type]
  );
  if(!inserted.rows[0])return;

  const outboxId = randomUUID();
  const url = source.NOTIFICATION_EMAIL_WEBHOOK_URL;
  const token = source.NOTIFICATION_EMAIL_WEBHOOK_TOKEN;
  if (!url || !token) {
    await db.query(
      `INSERT INTO notification_outbox (id,notification_id,channel,status,last_error)
       VALUES ($1,$2,'EMAIL','CONFIGURATION_REQUIRED','Email delivery webhook is not configured')`,
      [outboxId,notificationId]
    );
    return;
  }

  await db.query(
    `INSERT INTO notification_outbox (id,notification_id,channel,status,attempts)
     VALUES ($1,$2,'EMAIL','PENDING',1)`, [outboxId,notificationId]
  );
  try {
    const user = await db.query<{ email: string; full_name: string }>(
      `SELECT email,full_name FROM users WHERE id=$1`, [server.customer_id]
    );
    const recipient = user.rows[0];
    if (!recipient) throw new Error('Notification recipient no longer exists');
    const response = await fetch(url,{
      method: 'POST',
      headers: { 'Content-Type': 'application/json',Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to: recipient.email,name: recipient.full_name,template: type==='SERVER_REINSTALLED'?'server_reinstalled':'server_ready',subject: title,text: message }),
    });
    if (!response.ok) throw new Error(`Email webhook returned HTTP ${response.status}`);
    await db.query(
      `UPDATE notification_outbox SET status='DELIVERED',delivered_at=now(),updated_at=now() WHERE id=$1`, [outboxId]
    );
  } catch (error) {
    await db.query(
      `UPDATE notification_outbox SET status='FAILED',last_error=$2,updated_at=now() WHERE id=$1`,
      [outboxId,(error as Error).message.slice(0,500)]
    );
  }
}

/**
 * Confirms a completed termination. In-app only and idempotent through the notification unique
 * index, so a redelivered DELETE job cannot notify the customer twice. The message never claims
 * data can be recovered — by this point the provider resource is gone.
 */
export async function notifyServerTerminated(db: Queryable, server: CustomerServerDetailRow): Promise<void> {
  if (!server.customer_id) return;
  const message = [
    `Server: ${server.name}`,
    `Hostname: ${server.hostname}`,
    'The server has been destroyed at the infrastructure provider and billing for it has stopped.',
    'Its data cannot be recovered. Your invoices and account history are unchanged.',
  ].join('\n');
  await db.query(
    `INSERT INTO user_notifications (id,user_id,type,title,message,resource_type,resource_id)
     VALUES ($1,$2,'SERVER_TERMINATED',$3,$4,'server',$5)
     ON CONFLICT (user_id,type,resource_type,resource_id) WHERE resource_id IS NOT NULL DO NOTHING`,
    [randomUUID(),server.customer_id,'Your CloudHost247 server has been terminated',message,server.id]
  );
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
