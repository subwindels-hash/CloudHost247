import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';

/**
 * Exercises the real authentication routes (register/login/me/logout) end-to-end against an
 * embedded, real Postgres engine (pglite) migrated with the actual committed migration files —
 * not mocks. This is the direct evidence for the "logout must actually invalidate the
 * session/token" requirement: it proves a token rejected by /api/auth/me after logout is rejected
 * because of server-side revocation (see database/migrations/0003_create_revoked_tokens.sql),
 * not just because the client happened to stop sending it.
 */
describe('authentication flow: register, login, me, logout', () => {
  let db: PGlite;
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
    JWT_SECRET: 'd'.repeat(32),
  } as NodeJS.ProcessEnv);

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
  });

  afterEach(async () => {
    await db.close();
  });

  function buildTestApp() {
    return buildApp(env, { serveFrontend: false, pool: db });
  }

  it('registers a new account and returns a usable token', async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'alice@example.com', password: 'correct-horse-battery', fullName: 'Alice Example' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user.email).toBe('alice@example.com');
    expect(typeof body.token).toBe('string');
    await app.close();
  });

  it('logs in and fetches the authenticated profile via /api/auth/me', async () => {
    const app = buildTestApp();
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'bob@example.com', password: 'correct-horse-battery', fullName: 'Bob Example' },
    });

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'bob@example.com', password: 'correct-horse-battery' },
    });
    expect(login.statusCode).toBe(200);
    const { token } = login.json();

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${token}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe('bob@example.com');

    await app.close();
  });

  it('rejects /api/auth/me with no token', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('logout actually invalidates the token: /api/auth/me fails afterwards with the same still-unexpired token', async () => {
    const app = buildTestApp();
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'carol@example.com', password: 'correct-horse-battery', fullName: 'Carol Example' },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'carol@example.com', password: 'correct-horse-battery' },
    });
    const { token } = login.json();

    // Works before logout.
    const meBefore = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${token}` } });
    expect(meBefore.statusCode).toBe(200);

    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { authorization: `Bearer ${token}` } });
    expect(logout.statusCode).toBe(204);

    // Same token, still cryptographically valid and unexpired — must now be rejected because the
    // server recorded its jti as revoked, not because the JWT itself expired.
    const meAfter = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${token}` } });
    expect(meAfter.statusCode).toBe(401);
    expect(meAfter.json().message).toMatch(/logged out|invalid|expired/i);

    await app.close();
  });

  it('logging out one session does not revoke a different token for the same user', async () => {
    const app = buildTestApp();
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'dave@example.com', password: 'correct-horse-battery', fullName: 'Dave Example' },
    });

    const loginA = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'dave@example.com', password: 'correct-horse-battery' },
    });
    const loginB = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'dave@example.com', password: 'correct-horse-battery' },
    });
    const tokenA = loginA.json().token as string;
    const tokenB = loginB.json().token as string;
    expect(tokenA).not.toBe(tokenB);

    const logoutA = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { authorization: `Bearer ${tokenA}` } });
    expect(logoutA.statusCode).toBe(204);

    const meA = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${tokenA}` } });
    expect(meA.statusCode).toBe(401);

    // A different device/tab's session (token B) is untouched.
    const meB = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${tokenB}` } });
    expect(meB.statusCode).toBe(200);

    await app.close();
  });

  it('logout requires a valid token (cannot be called anonymously)', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/api/auth/logout' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('calling logout twice with the same token is safe (idempotent, no 500)', async () => {
    const app = buildTestApp();
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'erin@example.com', password: 'correct-horse-battery', fullName: 'Erin Example' },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'erin@example.com', password: 'correct-horse-battery' },
    });
    const { token } = login.json();

    const first = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { authorization: `Bearer ${token}` } });
    expect(first.statusCode).toBe(204);

    // Second call with the same (now-revoked) token is rejected by authenticate() as 401, not a
    // 500 — the ON CONFLICT DO NOTHING in revokeToken() only matters for concurrent/duplicate
    // logout calls that reach the DB before the first one's revocation is visible.
    const second = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { authorization: `Bearer ${token}` } });
    expect(second.statusCode).toBe(401);

    await app.close();
  });
});
