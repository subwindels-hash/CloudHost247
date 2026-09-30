import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { buildApp } from '../../src/app';
import { loadEnv } from '../../src/config/env';
import { createUser } from '../../src/db/users';
import { signAuthToken } from '../../src/lib/jwt';

/**
 * The notification centre must only ever show a customer their own notices, and marking one as
 * read must be impossible across accounts — a 404 is returned rather than confirming that
 * another customer's notification exists.
 */
describe('customer notification centre', () => {
  let db: PGlite;
  const env = loadEnv({
    NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@localhost/test', JWT_SECRET: 'i'.repeat(32),
  } as NodeJS.ProcessEnv);
  let ownerToken = '';
  let otherToken = '';
  let ownerNotificationId = '';

  beforeAll(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
    const owner = await createUser(db, {
      id: randomUUID(), email: `owner-${randomUUID()}@example.com`, passwordHash: 'hash', fullName: 'Owner',
    });
    const other = await createUser(db, {
      id: randomUUID(), email: `other-${randomUUID()}@example.com`, passwordHash: 'hash', fullName: 'Other',
    });
    ownerToken = signAuthToken(env, { sub: owner.id, role: 'customer', email: owner.email });
    otherToken = signAuthToken(env, { sub: other.id, role: 'customer', email: other.email });

    ownerNotificationId = randomUUID();
    await db.query(
      `INSERT INTO user_notifications(id,user_id,type,title,message) VALUES
        ($1,$2,'SERVER_READY','Your server is ready','Server: web-1'),
        ($3,$4,'OS_EOL','Ubuntu 18.04 LTS has reached end of life','Server: legacy-1')`,
      [ownerNotificationId, owner.id, randomUUID(), other.id]
    );
  });

  afterAll(async () => { await db.close(); });

  it('requires authentication', async () => {
    const app = buildApp(env, { serveFrontend: false, pool: db });
    expect((await app.inject({ method: 'GET', url: '/api/v1/notifications' })).statusCode).toBe(401);
    await app.close();
  });

  it('returns only the signed-in customer notifications with an unread count', async () => {
    const app = buildApp(env, { serveFrontend: false, pool: db });
    const response = await app.inject({
      method: 'GET', url: '/api/v1/notifications', headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.notifications).toHaveLength(1);
    expect(body.notifications[0].title).toBe('Your server is ready');
    expect(body.unread).toBe(1);
    await app.close();
  });

  it('refuses to mark another customer notification as read', async () => {
    const app = buildApp(env, { serveFrontend: false, pool: db });
    const response = await app.inject({
      method: 'POST', url: `/api/v1/notifications/${ownerNotificationId}/read`,
      headers: { authorization: `Bearer ${otherToken}` }, payload: {},
    });
    expect(response.statusCode).toBe(404);
    const stored = await db.query<{ read_at: string | null }>(
      `SELECT read_at FROM user_notifications WHERE id=$1`, [ownerNotificationId]
    );
    expect(stored.rows[0]?.read_at).toBeNull();
    await app.close();
  });

  it('marks the owner notification read and clears the unread count', async () => {
    const app = buildApp(env, { serveFrontend: false, pool: db });
    const read = await app.inject({
      method: 'POST', url: `/api/v1/notifications/${ownerNotificationId}/read`,
      headers: { authorization: `Bearer ${ownerToken}` }, payload: {},
    });
    expect(read.statusCode).toBe(200);
    const after = await app.inject({
      method: 'GET', url: '/api/v1/notifications', headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(after.json().unread).toBe(0);

    const readAll = await app.inject({
      method: 'POST', url: '/api/v1/notifications/read-all',
      headers: { authorization: `Bearer ${ownerToken}` }, payload: {},
    });
    expect(readAll.json()).toEqual({ read: 0 });
    await app.close();
  });
});
