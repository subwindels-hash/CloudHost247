import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { hashPassword } from '../../src/lib/password';

/**
 * Phase 6 (security) — the account's own session inventory and authentication event history.
 *
 * Driven end-to-end against a real embedded PostgreSQL engine with the real migrations, so the
 * revocation path is exercised as it actually behaves: revoking writes the token's `jti` to
 * `revoked_tokens`, and `authenticate()` rejects that token on the very next request. Nothing here
 * mocks the database.
 *
 * What these tests deliberately pin:
 *   - the inventory is scoped to the caller (another account's session id is a 404, not a leak);
 *   - revocation is effective immediately, not at some later sweep;
 *   - an unfamiliar sign-in is announced once per new browser, and never for the first sign-in;
 *   - a delegated support session can neither read nor revoke the customer's sessions.
 */
const SECRET = 'k'.repeat(32);
const PASSWORD = 'correct-horse-battery';

describe('account security — sessions and security events', () => {
  let db: PGlite;
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
    JWT_SECRET: SECRET,
  } as NodeJS.ProcessEnv);

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
  });

  afterEach(async () => {
    await db.close();
  });

  function app() {
    return buildApp(env, { serveFrontend: false, pool: db });
  }

  function bearer(token: string | undefined) {
    return { authorization: `Bearer ${token}` };
  }

  async function register(email: string, userAgent = 'AgentA') {
    return app().inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: { 'user-agent': userAgent },
      payload: { email, password: PASSWORD, fullName: 'Test Person' },
    });
  }

  async function registerOk(email: string, userAgent = 'AgentA') {
    const res = await register(email, userAgent);
    expect(res.statusCode, res.body).toBe(201);
    return res.json() as { user: { id: string }; token: string };
  }

  async function login(email: string, userAgent: string) {
    return app().inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'user-agent': userAgent },
      payload: { email, password: PASSWORD },
    });
  }

  async function sessions(token: string, query = '') {
    return app().inject({
      method: 'GET',
      url: `/api/v1/account/security/sessions${query}`,
      headers: bearer(token),
    });
  }

  async function notificationCount(): Promise<number> {
    const { rows } = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM user_notifications');
    return Number(rows[0]?.count ?? '0');
  }

  it('records a session on registration and lists it as the current one', async () => {
    const { token } = await registerOk('first@example.com', 'AgentA');

    const res = await sessions(token);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as {
      sessions: Array<{ id: string; userAgent: string | null; current: boolean; revokedAt: string | null }>;
      recordedOnly: boolean;
    };
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0]!.userAgent).toBe('AgentA');
    expect(body.sessions[0]!.current).toBe(true);
    expect(body.sessions[0]!.revokedAt).toBeNull();
    // Said out loud rather than left to be assumed.
    expect(body.recordedOnly).toBe(true);

    // The first recorded sign-in is never announced as an unfamiliar one.
    expect(await notificationCount()).toBe(0);
  });

  it('announces a sign-in from an unfamiliar browser once, and not again from that same browser', async () => {
    await registerOk('second@example.com', 'AgentA');

    const first = await login('second@example.com', 'AgentB');
    expect(first.statusCode, first.body).toBe(200);
    expect(await notificationCount()).toBe(1);

    const { rows } = await db.query<{ type: string; resource_type: string; title: string; message: string }>(
      'SELECT type, resource_type, title, message FROM user_notifications LIMIT 1'
    );
    expect(rows[0]!.type).toBe('SECURITY_LOGIN_NEW_DEVICE');
    expect(rows[0]!.resource_type).toBe('auth_session');
    expect(rows[0]!.title).toBe('New sign-in to your account');
    // The alert states what was recorded; it does not claim the sign-in was unauthorized.
    expect(rows[0]!.message).toContain('had not used before');
    expect(rows[0]!.message).not.toContain('unauthorized');

    // The same browser signing in again is now familiar: no second alert.
    const second = await login('second@example.com', 'AgentB');
    expect(second.statusCode, second.body).toBe(200);
    expect(await notificationCount()).toBe(1);

    // A browser the account has used before is familiar too.
    const third = await login('second@example.com', 'AgentA');
    expect(third.statusCode, third.body).toBe(200);
    expect(await notificationCount()).toBe(1);
  });

  it('revoking a session ends it on the next request and stamps the row', async () => {
    const owner = await registerOk('owner@example.com', 'AgentA');
    const other = await login('owner@example.com', 'AgentB');
    const otherToken = (other.json() as { token: string }).token;

    const listed = await sessions(owner.token);
    const target = (listed.json() as { sessions: Array<{ id: string; current: boolean }> }).sessions.find(
      (s) => !s.current
    );
    expect(target, 'the second login should appear as a non-current session').toBeDefined();

    const revoked = await app().inject({
      method: 'DELETE',
      url: `/api/v1/account/security/sessions/${target!.id}`,
      headers: bearer(owner.token),
    });
    expect(revoked.statusCode, revoked.body).toBe(200);
    expect(revoked.json()).toMatchObject({ revoked: true, current: false });

    // Effective immediately: the revoked token is rejected by the next authenticated call.
    const afterRevoke = await sessions(otherToken);
    expect(afterRevoke.statusCode).toBe(401);

    // Gone from the active list, still legible (and labelled) in the full list.
    const active = await sessions(owner.token);
    expect((active.json() as { sessions: unknown[] }).sessions).toHaveLength(1);

    const all = await sessions(owner.token, '?includeRevoked=true');
    const row = (all.json() as { sessions: Array<{ id: string; revokedAt: string | null; revokedReason: string | null }> })
      .sessions.find((s) => s.id === target!.id);
    expect(row).toBeDefined();
    expect(row!.revokedAt).not.toBeNull();
    expect(row!.revokedReason).toBe('customer_revoked');

    // The revocation is in the account's security event history.
    const events = await app().inject({
      method: 'GET',
      url: '/api/v1/account/security/events',
      headers: bearer(owner.token),
    });
    expect(events.statusCode, events.body).toBe(200);
    const types = (events.json() as { events: Array<{ type: string }> }).events.map((e) => e.type);
    expect(types).toContain('auth_session_revoked');
  });

  it("treats another account's session id as not found and changes nothing", async () => {
    const mine = await registerOk('mine@example.com');
    const theirs = await registerOk('theirs@example.com');

    const theirList = await sessions(theirs.token);
    const theirSession = (theirList.json() as { sessions: Array<{ id: string }> }).sessions[0]!;

    const res = await app().inject({
      method: 'DELETE',
      url: `/api/v1/account/security/sessions/${theirSession.id}`,
      headers: bearer(mine.token),
    });
    // Same answer as "no such session": a guessed id must not become an existence oracle.
    expect(res.statusCode).toBe(404);

    // Their session still works.
    expect((await sessions(theirs.token)).statusCode).toBe(200);
  });

  it('revoke-others kills every other session but keeps the caller', async () => {
    const owner = await registerOk('others@example.com', 'AgentA');
    const b = await login('others@example.com', 'AgentB');
    const c = await login('others@example.com', 'AgentC');
    const tokenB = (b.json() as { token: string }).token;
    const tokenC = (c.json() as { token: string }).token;

    const res = await app().inject({
      method: 'POST',
      url: '/api/v1/account/security/sessions/revoke-others',
      headers: bearer(owner.token),
      payload: {},
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ revoked: 2, keptCurrentSession: true });

    expect((await sessions(tokenB)).statusCode).toBe(401);
    expect((await sessions(tokenC)).statusCode).toBe(401);
    expect((await sessions(owner.token)).statusCode).toBe(200);
  });

  it('logout stamps the session revoked instead of leaving it looking active', async () => {
    const { token } = await registerOk('logout@example.com');

    const out = await app().inject({ method: 'POST', url: '/api/auth/logout', headers: bearer(token) });
    expect(out.statusCode, out.body).toBe(204);

    // The token is dead, and the row says why rather than still reading as an active device.
    expect((await sessions(token)).statusCode).toBe(401);
    const { rows } = await db.query<{ revoked_reason: string | null }>(
      'SELECT revoked_reason FROM auth_sessions LIMIT 1'
    );
    expect(rows[0]!.revoked_reason).toBe('logout');
  });

  it('refuses every route to an unauthenticated caller', async () => {
    const routes: Array<{ method: 'GET' | 'POST' | 'DELETE'; url: string }> = [
      { method: 'GET', url: '/api/v1/account/security/sessions' },
      { method: 'GET', url: '/api/v1/account/security/events' },
      { method: 'POST', url: '/api/v1/account/security/sessions/revoke-others' },
      { method: 'DELETE', url: `/api/v1/account/security/sessions/${randomUUID()}` },
    ];
    for (const route of routes) {
      const res = await app().inject({ method: route.method, url: route.url, payload: {} });
      expect(res.statusCode, `${route.method} ${route.url}`).toBe(401);
    }
  });

  it('reports only the calling account\'s own security events', async () => {
    const a = await registerOk('events-a@example.com');
    await registerOk('events-b@example.com');
    await login('events-a@example.com', 'AgentB');

    const res = await app().inject({
      method: 'GET',
      url: '/api/v1/account/security/events',
      headers: bearer(a.token),
    });
    expect(res.statusCode, res.body).toBe(200);
    const events = (res.json() as { events: Array<{ id: string; type: string }> }).events;
    expect(events.length).toBeGreaterThan(0);

    const { rows } = await db.query<{ id: string; user_id: string }>(
      'SELECT id, user_id FROM auth_audit_log'
    );
    const mine = new Set(rows.filter((r) => r.user_id === a.user.id).map((r) => r.id));
    for (const event of events) {
      expect(mine.has(event.id), `event ${event.id} belongs to another account`).toBe(true);
    }
  });

  it('blocks a delegated support session from enumerating or revoking the customer\'s sessions', async () => {
    const customer = await registerOk('delegate-test@example.com');
    await db.query(`UPDATE users SET email_verified_at = now() WHERE id = $1`, [customer.user.id]);

    const staffEmail = `admin-${randomUUID()}@example.com`;
    const staffId = randomUUID();
    await db.query(
      `INSERT INTO users (id, email, password_hash, full_name, role, username, customer_id)
       VALUES ($1,$2,$3,$4,'admin',$5,$6)`,
      [staffId, staffEmail, await hashPassword(PASSWORD), 'Staff', `admin${staffId.slice(0, 8)}`, `6${String(Date.now()).slice(-8)}`]
    );
    const staffLogin = await app().inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: staffEmail, password: PASSWORD },
    });
    expect(staffLogin.statusCode, staffLogin.body).toBe(200);

    const delegated = await app().inject({
      method: 'POST',
      url: `/api/v1/admin/customers/${customer.user.id}/switch`,
      headers: bearer((staffLogin.json() as { token: string }).token),
      payload: { reason: 'customer asked about their sessions' },
    });
    expect(delegated.statusCode, delegated.body).toBe(201);
    const delegatedToken = (delegated.json() as { token: string }).token;

    const list = await app().inject({
      method: 'GET',
      url: '/api/v1/account/security/sessions',
      headers: bearer(delegatedToken),
    });
    expect(list.statusCode, list.body).toBe(403);

    const revokeOthers = await app().inject({
      method: 'POST',
      url: '/api/v1/account/security/sessions/revoke-others',
      headers: bearer(delegatedToken),
      payload: {},
    });
    expect(revokeOthers.statusCode, revokeOthers.body).toBe(403);

    // The customer's own session is untouched.
    expect((await sessions(customer.token)).statusCode).toBe(200);
  });
});
