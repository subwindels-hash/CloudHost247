import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { __private__ as mfaPrivate } from '../../src/services/totp-mfa-service';
import { updatePasswordHash } from '../../src/db/users';

/** Real-Postgres coverage for the entire password → MFA challenge → session path. It also proves
 * that the setup secret, recovery values and challenge bearer token never land in plaintext. */
describe('TOTP multi-factor authentication', () => {
  let db: PGlite;
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
    JWT_SECRET: 'm'.repeat(32),
    CREDENTIAL_ENCRYPTION_KEY: 'b'.repeat(64),
  } as NodeJS.ProcessEnv);

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
  });
  afterEach(async () => db.close());

  it('enrolls encrypted TOTP, gates login, supports one-use recovery, and allows step-up disable', async () => {
    const app = buildApp(env, { serveFrontend: false, pool: db });
    const registration = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'mfa@example.com', password: 'correct-horse-battery', fullName: 'Mfa Example' },
    });
    expect(registration.statusCode).toBe(201);
    const initial = registration.json() as { token: string; user: { id: string } };

    const begun = await app.inject({
      method: 'POST',
      url: '/api/auth/mfa/totp/enroll',
      headers: { authorization: `Bearer ${initial.token}` },
      payload: { password: 'correct-horse-battery' },
    });
    expect(begun.statusCode).toBe(200);
    const enrollment = begun.json() as { secret: string; otpauthUrl: string };
    expect(enrollment.otpauthUrl).toContain(`secret=${enrollment.secret}`);

    const savedTotp = await db.query<{ secret_encrypted: string }>(`SELECT secret_encrypted FROM user_mfa_totp WHERE user_id=$1`, [initial.user.id]);
    expect(savedTotp.rows[0]?.secret_encrypted).not.toContain(enrollment.secret);

    const currentStep = Math.floor(Date.now() / 1000 / 30);
    const confirmed = await app.inject({
      method: 'POST',
      url: '/api/auth/mfa/totp/confirm',
      headers: { authorization: `Bearer ${initial.token}` },
      payload: { code: mfaPrivate.totpAt(enrollment.secret, currentStep) },
    });
    expect(confirmed.statusCode).toBe(200);
    const recoveryCodes = (confirmed.json() as { recoveryCodes: string[] }).recoveryCodes;
    expect(recoveryCodes).toHaveLength(10);
    const persistedRecovery = await db.query<Record<string, unknown>>(`SELECT * FROM user_mfa_recovery_codes WHERE user_id=$1`, [initial.user.id]);
    expect(JSON.stringify(persistedRecovery.rows)).not.toContain(recoveryCodes[0]!);

    const passwordLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'mfa@example.com', password: 'correct-horse-battery' },
    });
    expect(passwordLogin.statusCode).toBe(202);
    const challenge = passwordLogin.json() as { mfaRequired: boolean; mfaToken: string; token?: string };
    expect(challenge.mfaRequired).toBe(true);
    expect(challenge.token).toBeUndefined();
    const storedChallenge = await db.query<Record<string, unknown>>(`SELECT * FROM auth_mfa_login_challenges`);
    expect(JSON.stringify(storedChallenge.rows[0])).not.toContain(challenge.mfaToken);

    // The confirmation consumed this step, so authenticate with the accepted +1 skew window to
    // prove replay prevention without sleeping for a 30-second TOTP period.
    const totpLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/mfa/login/verify',
      payload: { mfaToken: challenge.mfaToken, code: mfaPrivate.totpAt(enrollment.secret, currentStep + 1) },
    });
    expect(totpLogin.statusCode).toBe(200);
    const authenticated = totpLogin.json() as { token: string };
    expect(typeof authenticated.token).toBe('string');

    const reusedChallenge = await app.inject({
      method: 'POST',
      url: '/api/auth/mfa/login/verify',
      payload: { mfaToken: challenge.mfaToken, code: recoveryCodes[0] },
    });
    expect(reusedChallenge.statusCode).toBe(401);

    const recoveryChallenge = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'mfa@example.com', password: 'correct-horse-battery' },
    });
    const recoveryLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/mfa/login/verify',
      payload: { mfaToken: recoveryChallenge.json().mfaToken, code: recoveryCodes[0] },
    });
    expect(recoveryLogin.statusCode).toBe(200);

    // A password change/reset increments auth_session_version. Its outstanding challenge must be
    // unusable—even though the TOTP/recovery factor itself is still valid—and must not burn the
    // recovery code supplied to that stale challenge.
    const staleAfterPasswordChange = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'mfa@example.com', password: 'correct-horse-battery' },
    });
    const unchangedHash = await db.query<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id=$1`, [initial.user.id]);
    await updatePasswordHash(db, initial.user.id, unchangedHash.rows[0]!.password_hash);
    const invalidated = await app.inject({
      method: 'POST',
      url: '/api/auth/mfa/login/verify',
      payload: { mfaToken: staleAfterPasswordChange.json().mfaToken, code: recoveryCodes[1] },
    });
    expect(invalidated.statusCode).toBe(401);

    const freshAfterPasswordChange = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'mfa@example.com', password: 'correct-horse-battery' },
    });
    const freshMfaLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/mfa/login/verify',
      payload: { mfaToken: freshAfterPasswordChange.json().mfaToken, code: recoveryCodes[1] },
    });
    expect(freshMfaLogin.statusCode).toBe(200);
    const freshAuthenticated = freshMfaLogin.json() as { token: string };

    const status = await app.inject({
      method: 'GET',
      url: '/api/auth/mfa/status',
      headers: { authorization: `Bearer ${freshAuthenticated.token}` },
    });
    expect(status.json().mfa).toEqual({ enabled: true, recoveryCodesRemaining: 8 });

    const disabled = await app.inject({
      method: 'POST',
      url: '/api/auth/mfa/disable',
      headers: { authorization: `Bearer ${freshAuthenticated.token}` },
      payload: { password: 'correct-horse-battery', code: recoveryCodes[2] },
    });
    expect(disabled.statusCode).toBe(200);

    const regularLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'mfa@example.com', password: 'correct-horse-battery' },
    });
    expect(regularLogin.statusCode).toBe(200);
    expect(regularLogin.json().mfaRequired).toBeUndefined();
    await app.close();
  });
});
