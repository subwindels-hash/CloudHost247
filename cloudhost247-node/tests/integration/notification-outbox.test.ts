import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { createUser } from '../../src/db/users';
import { buildApp } from '../../src/app';
import { loadEnv } from '../../src/config/env';
import { signAuthToken } from '../../src/lib/jwt';
import { createNotification } from '../../src/services/notification-service';
import { deliverNotificationOutbox, summarizeNotificationOutbox } from '../../src/services/notification-outbox-service';

const CONFIGURED: NodeJS.ProcessEnv = {
  NOTIFICATION_EMAIL_WEBHOOK_URL: 'https://mail.invalid/send',
  NOTIFICATION_EMAIL_WEBHOOK_TOKEN: 'x'.repeat(24),
} as NodeJS.ProcessEnv;

function jsonResponse(status: number): Response {
  return new Response(status === 204 ? null : JSON.stringify({ ok: status < 400 }), { status });
}

/**
 * Email is queued, never sent inline: a dead mail webhook must not stall the worker that is
 * finishing a customer's server, and a single inline attempt used to lose the email whenever the
 * webhook was briefly down or simply not configured yet.
 */
describe('notification email outbox', () => {
  let db: PGlite;
  let userId = '';

  async function queueNotification(type: string): Promise<string> {
    const resourceId = randomUUID();
    const id = await createNotification(db, {
      userId, type, title: `${type} title`, message: 'Server: web-1\nAll good.',
      resourceType: 'server', resourceId,
    });
    expect(id).toBeTruthy();
    return id!;
  }

  async function outboxRow(notificationId: string) {
    const { rows } = await db.query<{ id: string; status: string; attempts: number; last_error: string | null; next_attempt_at: string; delivered_at: string | null }>(
      `SELECT id,status,attempts,last_error,next_attempt_at,delivered_at FROM notification_outbox WHERE notification_id=$1`,
      [notificationId]
    );
    return rows[0]!;
  }

  /** Makes a claimed row due again, standing in for the passage of time between sweeps. */
  async function makeDue(notificationId: string): Promise<void> {
    await db.query(`UPDATE notification_outbox SET next_attempt_at=now() - interval '1 minute' WHERE notification_id=$1`, [notificationId]);
  }

  beforeAll(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
    const user = await createUser(db, {
      id: randomUUID(), email: `outbox-${randomUUID()}@example.com`, passwordHash: 'hash', fullName: 'Outbox Customer',
    });
    userId = user.id;
  });

  afterAll(async () => { await db.close(); });

  it('queues an email row alongside every in-app notification, without sending anything inline', async () => {
    const fetchSpy = vi.fn();
    const notificationId = await queueNotification('SERVER_READY');
    const row = await outboxRow(notificationId);
    expect(row).toMatchObject({ status: 'PENDING', attempts: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('parks an unconfigured integration without burning attempts, then delivers the backlog once configured', async () => {
    const notificationId = await queueNotification('SERVER_REINSTALLED');
    const fetchSpy = vi.fn();

    const unconfigured = await deliverNotificationOutbox(db, { source: {} as NodeJS.ProcessEnv, fetchImpl: fetchSpy as unknown as typeof fetch });
    expect(unconfigured.configurationRequired).toBeGreaterThanOrEqual(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    const parked = await outboxRow(notificationId);
    expect(parked).toMatchObject({ status: 'CONFIGURATION_REQUIRED', attempts: 0 });
    expect(parked.last_error).toMatch(/not configured/i);

    // The operator sets the variables; the queued backlog is delivered rather than lost.
    await makeDue(notificationId);
    const send = vi.fn(async () => jsonResponse(200));
    const delivered = await deliverNotificationOutbox(db, { source: CONFIGURED, fetchImpl: send as unknown as typeof fetch });
    expect(delivered.delivered).toBeGreaterThanOrEqual(1);
    const after = await outboxRow(notificationId);
    expect(after.status).toBe('DELIVERED');
    expect(after.delivered_at).toBeTruthy();

    const [, init] = send.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body));
    expect(payload.to).toMatch(/outbox-/);
    expect(JSON.stringify(payload)).not.toContain(CONFIGURED.NOTIFICATION_EMAIL_WEBHOOK_TOKEN);
  });

  it('retries a transient failure with backoff and stops re-sending a delivered row', async () => {
    const notificationId = await queueNotification('OS_EOL_WARNING');
    const failing = vi.fn(async () => jsonResponse(503));
    const first = await deliverNotificationOutbox(db, { source: CONFIGURED, fetchImpl: failing as unknown as typeof fetch });
    expect(first.retrying).toBeGreaterThanOrEqual(1);
    const retrying = await outboxRow(notificationId);
    expect(retrying).toMatchObject({ status: 'PENDING', attempts: 1 });
    expect(new Date(retrying.next_attempt_at).getTime()).toBeGreaterThan(Date.now());

    // Not due yet: the sweep must leave it alone rather than hammering the webhook.
    const early = vi.fn(async () => jsonResponse(200));
    await deliverNotificationOutbox(db, { source: CONFIGURED, fetchImpl: early as unknown as typeof fetch });
    expect(early).not.toHaveBeenCalled();

    await makeDue(notificationId);
    const recovered = vi.fn(async () => jsonResponse(200));
    await deliverNotificationOutbox(db, { source: CONFIGURED, fetchImpl: recovered as unknown as typeof fetch });
    expect((await outboxRow(notificationId)).status).toBe('DELIVERED');

    const again = vi.fn(async () => jsonResponse(200));
    await deliverNotificationOutbox(db, { source: CONFIGURED, fetchImpl: again as unknown as typeof fetch });
    expect(again).not.toHaveBeenCalled();
  });

  it('treats a rejected credential as a configuration problem, not a delivery failure', async () => {
    const notificationId = await queueNotification('SERVER_TERMINATED');
    const rejected = vi.fn(async () => jsonResponse(401));
    await deliverNotificationOutbox(db, { source: CONFIGURED, fetchImpl: rejected as unknown as typeof fetch });
    const row = await outboxRow(notificationId);
    expect(row.status).toBe('CONFIGURATION_REQUIRED');
    expect(row.last_error).toMatch(/credentials/i);
  });

  it('fails a rejected payload permanently instead of retrying forever', async () => {
    const notificationId = await queueNotification('OS_EOL');
    const rejected = vi.fn(async () => jsonResponse(422));
    await deliverNotificationOutbox(db, { source: CONFIGURED, fetchImpl: rejected as unknown as typeof fetch });
    expect(await outboxRow(notificationId)).toMatchObject({ status: 'FAILED', attempts: 1 });

    const after = vi.fn(async () => jsonResponse(200));
    await deliverNotificationOutbox(db, { source: CONFIGURED, fetchImpl: after as unknown as typeof fetch });
    expect(after).not.toHaveBeenCalled();
  });

  it('gives up after the attempt budget and reports the backlog to operators', async () => {
    const notificationId = await queueNotification('SERVER_READY_BUDGET');
    await db.query(`UPDATE notification_outbox SET max_attempts=2 WHERE notification_id=$1`, [notificationId]);
    const down = vi.fn(async () => { throw new Error('connect ECONNREFUSED'); });

    await deliverNotificationOutbox(db, { source: CONFIGURED, fetchImpl: down as unknown as typeof fetch });
    expect(await outboxRow(notificationId)).toMatchObject({ status: 'PENDING', attempts: 1 });
    await makeDue(notificationId);
    await deliverNotificationOutbox(db, { source: CONFIGURED, fetchImpl: down as unknown as typeof fetch });
    const exhausted = await outboxRow(notificationId);
    expect(exhausted).toMatchObject({ status: 'FAILED', attempts: 2 });
    expect(exhausted.last_error).toMatch(/ECONNREFUSED/);

    const summary = await summarizeNotificationOutbox(db);
    expect(summary.find((row) => row.status === 'FAILED')?.count).toBeGreaterThanOrEqual(1);
    expect(summary.every((row) => row.channel === 'EMAIL')).toBe(true);
  });

  it('exposes delivery health to operators only', async () => {
    const env = loadEnv({
      NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@localhost/test', JWT_SECRET: 'o'.repeat(32),
    } as NodeJS.ProcessEnv);
    const staff = await createUser(db, {
      id: randomUUID(), email: `ops-${randomUUID()}@example.com`, passwordHash: 'hash', fullName: 'Operator',
    });
    await db.query(`UPDATE users SET role='admin' WHERE id=$1`, [staff.id]);
    const customerToken = signAuthToken(env, { sub: userId, role: 'customer', email: 'customer@example.test' });
    const adminToken = signAuthToken(env, { sub: staff.id, role: 'admin', email: staff.email });
    const app = buildApp(env, { serveFrontend: false, pool: db });

    expect((await app.inject({
      method: 'GET', url: '/api/v1/admin/notification-outbox', headers: { authorization: `Bearer ${customerToken}` },
    })).statusCode).toBe(403);

    const response = await app.inject({
      method: 'GET', url: '/api/v1/admin/notification-outbox', headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Array.isArray(body.summary)).toBe(true);
    // Failures are surfaced, not swallowed: the exhausted row from the previous case is listed.
    expect(body.problems.some((row: { status: string }) => row.status === 'FAILED')).toBe(true);
    expect(JSON.stringify(body)).not.toContain('NOTIFICATION_EMAIL_WEBHOOK_TOKEN');
    await app.close();
  });
});
