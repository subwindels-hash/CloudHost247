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

export async function listNotifications(db: Queryable, userId: string) {
  const { rows } = await db.query(
    `SELECT * FROM user_notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`, [userId]
  );
  return rows;
}
