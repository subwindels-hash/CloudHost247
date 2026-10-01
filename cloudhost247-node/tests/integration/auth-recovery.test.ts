import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { deriveAuthActionToken, deliverAuthEmailOutbox } from '../../src/services/auth-recovery-service';

/**
 * Real Postgres integration evidence for the security properties of account recovery:
 * - no usable action token is persisted;
 * - actions are finite-lived / single-use (the UPDATE ... RETURNING claim is atomic);
 * - reset requests do not enumerate accounts;
 * - a password reset stamps password_changed_at, invalidating old sessions; and
 * - the dedicated durable mail queue creates the link only at delivery time.
 */
describe('email verification and password recovery', () => {
  let db: PGlite;
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
    JWT_SECRET: 'a'.repeat(32),
    APP_URL: 'https://panel.example.test/customer',
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

  async function register(testApp: ReturnType<typeof app>, email = 'alice@example.com') {
    const response = await testApp.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email, password: 'correct-horse-battery', fullName: 'Alice Example' },
    });
    expect(response.statusCode).toBe(201);
    return response.json() as { token: string; user: { id: string }; emailVerification: { queued: boolean } };
  }

  it('queues a verification action with a hash only and accepts its derived link once', async () => {
    const testApp = app();
    const registration = await register(testApp);
    expect(registration.emailVerification.queued).toBe(true);

    const action = await db.query<{ id: string; token_hash: string; purpose: string; used_at: string | null }>(
      `SELECT id,token_hash,purpose,used_at FROM auth_action_tokens WHERE user_id=$1`,
      [registration.user.id]
    );
    expect(action.rows).toHaveLength(1);
    expect(action.rows[0]?.purpose).toBe('email_verification');
    const rawToken = deriveAuthActionToken(env.JWT_SECRET, 'email_verification', action.rows[0]!.id);
    // The bearer credential is neither the stored digest nor present in the dedicated outbox.
    expect(action.rows[0]?.token_hash).not.toBe(rawToken);
    const outbox = await db.query<Record<string, unknown>>(`SELECT * FROM auth_email_outbox WHERE token_id=$1`, [action.rows[0]!.id]);
    expect(outbox.rows).toHaveLength(1);
    expect(JSON.stringify(outbox.rows[0])).not.toContain(rawToken);

    const first = await testApp.inject({
      method: 'POST',
      url: '/api/auth/email-verification/confirm',
      payload: { token: rawToken },
    });
    expect(first.statusCode).toBe(200);
    const me = await testApp.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${registration.token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.emailVerified).toBe(true);

    const replay = await testApp.inject({
      method: 'POST',
      url: '/api/auth/email-verification/confirm',
      payload: { token: rawToken },
    });
    expect(replay.statusCode).toBe(400);
    await testApp.close();
  });

  it('does not enumerate a password-reset request and invalidates the old session after reset', async () => {
    const testApp = app();
    const registration = await register(testApp, 'reset@example.com');

    const unknown = await testApp.inject({
      method: 'POST',
      url: '/api/auth/password-reset/request',
      payload: { email: 'nobody@example.com' },
    });
    const known = await testApp.inject({
      method: 'POST',
      url: '/api/auth/password-reset/request',
      payload: { email: 'RESET@example.com' },
    });
    expect(unknown.statusCode).toBe(202);
    expect(known.statusCode).toBe(202);
    expect(known.json()).toEqual(unknown.json());

    const action = await db.query<{ id: string }>(
      `SELECT id FROM auth_action_tokens WHERE user_id=$1 AND purpose='password_reset' ORDER BY created_at DESC LIMIT 1`,
      [registration.user.id]
    );
    const resetToken = deriveAuthActionToken(env.JWT_SECRET, 'password_reset', action.rows[0]!.id);
    const completed = await testApp.inject({
      method: 'POST',
      url: '/api/auth/password-reset/confirm',
      payload: { token: resetToken, password: 'new-correct-horse-battery' },
    });
    expect(completed.statusCode).toBe(200);

    const staleSession = await testApp.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${registration.token}` },
    });
    expect(staleSession.statusCode).toBe(401);
    const login = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'reset@example.com', password: 'new-correct-horse-battery' },
    });
    expect(login.statusCode).toBe(200);

    const replay = await testApp.inject({
      method: 'POST',
      url: '/api/auth/password-reset/confirm',
      payload: { token: resetToken, password: 'another-correct-horse' },
    });
    expect(replay.statusCode).toBe(400);
    await testApp.close();
  });

  it('derives the email link only while delivering the queued action', async () => {
    const testApp = app();
    const registration = await register(testApp, 'delivery@example.com');
    const action = await db.query<{ id: string }>(
      `SELECT id FROM auth_action_tokens WHERE user_id=$1 AND purpose='email_verification'`,
      [registration.user.id]
    );
    const token = deriveAuthActionToken(env.JWT_SECRET, 'email_verification', action.rows[0]!.id);
    const fetchCalls: Array<{ url: string; body: string }> = [];

    const report = await deliverAuthEmailOutbox(db, {
      env,
      source: {
        NOTIFICATION_EMAIL_WEBHOOK_URL: 'https://mailer.example.test/hook',
        NOTIFICATION_EMAIL_WEBHOOK_TOKEN: 'mail-token-with-at-least-16-chars',
      },
      fetchImpl: async (url, init) => {
        fetchCalls.push({ url: String(url), body: String(init?.body) });
        return new Response(null, { status: 202 });
      },
    });
    expect(report).toMatchObject({ claimed: 1, delivered: 1 });
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.body).toContain(token);
    // APP_URL's Passenger prefix is retained in the generated link.
    expect(fetchCalls[0]?.body).toContain('https://panel.example.test/customer/verify-email?token=');

    const persisted = await db.query<Record<string, unknown>>(`SELECT * FROM auth_email_outbox`);
    expect(JSON.stringify(persisted.rows[0])).not.toContain(token);
    await testApp.close();
  });
});
