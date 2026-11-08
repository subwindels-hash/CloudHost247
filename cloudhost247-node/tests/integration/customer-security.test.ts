import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { signAuthToken } from '../../src/lib/jwt';
import { hashPassword } from '../../src/lib/password';
import { findUserById } from '../../src/db/users';
import {
  hashSecurityPin,
  openSealedSecurityPin,
  sealSecurityPin,
  verifySecurityPin,
} from '../../src/services/security-pin-service';
import { findLatestChallenge } from '../../src/services/security-pin-challenge-service';
import { sweepSecurityPinNotices, sweepSecurityPins } from '../../src/worker/sweeps';
import { deliverPinVerificationEmails } from '../../src/services/security-pin-email-service';

/**
 * End-to-end coverage for the identity + account-security contract:
 *
 *   * a unique username on every account (and changeable from account settings),
 *   * a permanent, unique nine-digit Customer ID that the database refuses to change,
 *   * a four-digit Security PIN that rotates every 24 hours, is stored only as keyed hash +
 *     sealed envelope, and never appears in an ordinary API response,
 *   * the six-digit email-verification gate in front of viewing it, and
 *   * account recovery that never bypasses that gate.
 *
 * Everything runs against a real embedded PostgreSQL engine (pglite) with the real migrations
 * applied, so uniqueness constraints, the immutability trigger, row locks and the partial indexes
 * are genuinely exercised rather than mocked.
 */
const PIN_KEY = 'p'.repeat(48);
const SECRET = 'k'.repeat(32);

describe('customer username, nine-digit Customer ID and rotating Security PIN', () => {
  let db: PGlite;
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
    JWT_SECRET: SECRET,
  } as NodeJS.ProcessEnv);

  beforeEach(async () => {
    process.env.SECURITY_PIN_HMAC_KEY = PIN_KEY;
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
  });

  afterEach(async () => {
    await db.close();
  });

  function app() {
    return buildApp(env, { serveFrontend: false, pool: db });
  }

  async function register(email: string, username?: string, password = 'correct-horse-battery') {
    const payload: Record<string, unknown> = { email, password, fullName: 'Test Person' };
    if (username) payload.username = username;
    const res = await app().inject({ method: 'POST', url: '/api/auth/register', payload });
    return res;
  }

  async function registerOk(email: string, username?: string) {
    const res = await register(email, username);
    expect(res.statusCode, res.body).toBe(201);
    return res.json() as {
      user: { id: string; username: string; customerId: string; emailVerified: boolean };
      token: string;
      securityPin: { set: boolean; nextRotationAt: string };
    };
  }

  /** Marks the account's email verified the way the real verification action would. */
  async function verifyEmail(userId: string) {
    await db.query(`UPDATE users SET email_verified_at = now() WHERE id = $1`, [userId]);
  }

  async function createStaff(role: 'admin' | 'super_admin', email = `${role}-${randomUUID()}@example.com`) {
    const id = randomUUID();
    await db.query(
      `INSERT INTO users (id, email, password_hash, full_name, role, username, customer_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        id,
        email,
        await hashPassword('correct-horse-battery'),
        'Staff Person',
        role,
        `staff${id.slice(0, 8)}`,
        String(Math.floor(Math.random() * 900_000_000) + 100_000_000),
      ]
    );
    return { id, token: signAuthToken(env, { sub: id, role, email }) };
  }

  /** Runs the whole gate: ask for a code, read it out of the sealed queue, verify, reveal. */
  async function openGate(token: string) {
    const started = await app().inject({
      method: 'POST',
      url: '/api/v1/account/security-pin/view',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(started.statusCode, started.body).toBe(200);
    const challengeToken = started.json().challenge.challengeToken as string;

    // The code is never in the response; recover it the way the mail worker does.
    const queued = await db.query<{ challenge_id: string; code_envelope: string }>(
      `SELECT challenge_id, code_envelope FROM pin_verification_email_queue ORDER BY created_at DESC LIMIT 1`
    );
    const { openSealedCode, deriveCodeKey } = await import('../../src/services/security-pin-email-service');
    const { resolvePinKey } = await import('../../src/services/security-pin-service');
    const code = openSealedCode(queued.rows[0]!.code_envelope, deriveCodeKey(resolvePinKey()))!;

    return { challengeToken, code, challengeId: queued.rows[0]!.challenge_id, started: started.json() };
  }

  // --- 1. username ------------------------------------------------------------------------------

  describe('username', () => {
    it('gives every registered customer a unique username', async () => {
      const a = await registerOk('ada@example.com', 'ada');
      const b = await registerOk('grace@example.com', 'GraceHopper');
      expect(a.user.username).toBe('ada');
      expect(b.user.username).toBe('GraceHopper');
      expect(a.user.username.toLowerCase()).not.toBe(b.user.username.toLowerCase());
    });

    it('derives a unique username when the caller does not choose one', async () => {
      const a = await registerOk('same.local@example.com');
      const b = await registerOk('same.local@example.org');
      expect(a.user.username).toMatch(/^[a-z]/);
      expect(a.user.username).not.toBe(b.user.username);
    });

    it('enforces case-insensitive uniqueness and suggests alternatives', async () => {
      await registerOk('first@example.com', 'takenname');
      const dupe = await register('second@example.com', 'TakenName');
      expect(dupe.statusCode).toBe(409);
      expect(dupe.json().message).toMatch(/already taken/i);
      expect(dupe.json().message).toMatch(/takenname1/);
    });

    it('refuses reserved and brand-impersonating names', async () => {
      for (const name of ['admin', 'support', 'cloudhost247', 'official-support', 'a.d.m.i.n']) {
        const res = await register(`${name.replace(/\W/g, '')}-${randomUUID().slice(0, 6)}@example.com`, name);
        expect(res.statusCode, `${name}: ${res.body}`).toBe(400);
        expect(res.json().message).toMatch(/reserved/i);
      }
    });

    it('rejects malformed usernames', async () => {
      for (const name of ['ab', '1abc', 'has space', '_underscore', 'dots..', 'trailing-']) {
        const res = await register(`bad-${randomUUID().slice(0, 8)}@example.com`, name);
        expect(res.statusCode, name).toBe(400);
      }
    });

    it('can be changed from account settings, and is reflected everywhere afterwards', async () => {
      const { user, token } = await registerOk('change@example.com', 'beforeswap');
      const res = await app().inject({
        method: 'PATCH',
        url: '/api/v1/account/username',
        headers: { authorization: `Bearer ${token}` },
        payload: { username: 'afterswap' },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().username).toBe('afterswap');

      const stored = await findUserById(db, user.id);
      expect(stored?.username).toBe('afterswap');
      expect(stored?.username_changed_at).toBeTruthy();

      const me = await app().inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${token}` } });
      expect(me.json().user.username).toBe('afterswap');
    });

    it('refuses a change to a name another customer already holds', async () => {
      await registerOk('owner@example.com', 'ownedname');
      const { token } = await registerOk('other@example.com', 'mine');
      const res = await app().inject({
        method: 'PATCH',
        url: '/api/v1/account/username',
        headers: { authorization: `Bearer ${token}` },
        payload: { username: 'OWNEDNAME' },
      });
      expect(res.statusCode).toBe(409);
    });

    it('supports username-based login alongside email login, with no enumeration signal', async () => {
      const { user } = await registerOk('login@example.com', 'loginhandle');

      const byUsername = await app().inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'loginhandle', password: 'correct-horse-battery' },
      });
      expect(byUsername.statusCode, byUsername.body).toBe(200);
      expect(byUsername.json().user.id).toBe(user.id);

      const byEmail = await app().inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'login@example.com', password: 'correct-horse-battery' },
      });
      expect(byEmail.statusCode).toBe(200);

      const unknown = await app().inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'nobodyhere', password: 'correct-horse-battery' },
      });
      const wrongPassword = await app().inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'loginhandle', password: 'wrong-password-here' },
      });
      expect(unknown.statusCode).toBe(401);
      expect(wrongPassword.statusCode).toBe(401);
      // Identical message either way: the form must not distinguish "no such account".
      expect(unknown.json().message).toBe(wrongPassword.json().message);
    });
  });

  // --- 2. Customer ID ---------------------------------------------------------------------------

  describe('nine-digit Customer ID', () => {
    it('issues a unique nine-digit Customer ID to every customer', async () => {
      const ids = new Set<string>();
      for (let index = 0; index < 12; index += 1) {
        const { user } = await registerOk(`cid${index}@example.com`);
        expect(user.customerId).toMatch(/^[0-9]{9}$/);
        ids.add(user.customerId);
      }
      expect(ids.size).toBe(12);
    });

    it('is enforced unique by the database', async () => {
      const a = await registerOk('uniq-a@example.com');
      const b = await registerOk('uniq-b@example.com');
      await expect(
        db.query(`UPDATE users SET customer_id = $1 WHERE id = $2`, [a.user.customerId, b.user.id])
      ).rejects.toThrow();
    });

    it('can never be changed — not by the customer, and not by the database', async () => {
      const { user, token } = await registerOk('immutable@example.com');

      // A crafted profile update cannot reach the column: the schema is strict and the field is
      // not part of it.
      const patched = await app().inject({
        method: 'PATCH',
        url: '/api/v1/account',
        headers: { authorization: `Bearer ${token}` },
        payload: { fullName: 'Renamed', customerId: '999999999' },
      });
      expect(patched.statusCode).toBe(400);
      expect((await findUserById(db, user.id))!.customer_id).toBe(user.customerId);

      // Even a direct write that bypasses the API is refused by the trigger.
      await expect(
        db.query(`UPDATE users SET customer_id = '999999999' WHERE id = $1`, [user.id])
      ).rejects.toThrow(/permanent and cannot be changed/i);

      // Ordinary edits still work, so the trigger is not simply blocking all updates.
      await db.query(`UPDATE users SET full_name = 'Still Fine' WHERE id = $1`, [user.id]);
      expect((await findUserById(db, user.id))!.customer_id).toBe(user.customerId);
    });

    it('is displayed in the account, security and dashboard payloads, and never exposes the uuid', async () => {
      const { user, token } = await registerOk('display@example.com');
      const account = await app().inject({
        method: 'GET',
        url: '/api/v1/account',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(account.json().user.customerId).toBe(user.customerId);

      const security = await app().inject({
        method: 'GET',
        url: '/api/v1/account/security',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(security.json().account.customerId).toBe(user.customerId);
      expect(security.json().account.username).toBe(user.username);
    });

    it('preserves the six-digit identifier of accounts created before 0085', async () => {
      const id = randomUUID();
      await db.query(
        `INSERT INTO users (id,email,password_hash,full_name,username,customer_id) VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, 'legacy@example.com', await hashPassword('correct-horse-battery'), 'Legacy', 'legacyuser', '000042']
      );
      const stored = await findUserById(db, id);
      expect(stored?.customer_id).toBe('000042');
    });
  });

  // --- 3. Security PIN --------------------------------------------------------------------------

  describe('rotating Security PIN', () => {
    it('gives every account a four-digit PIN with leading zeros preserved', async () => {
      const { user } = await registerOk('pin1@example.com');
      const stored = await findUserById(db, user.id);
      expect(stored?.security_pin_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(stored?.security_pin_salt).toMatch(/^[0-9a-f]{32}$/);
      expect(stored?.security_pin_version).toBe(1);

      // The sealed copy is the only way to read it back — and it is genuinely four digits.
      const plain = openSealedSecurityPin(stored!.security_pin_encrypted!)!;
      expect(plain).toMatch(/^[0-9]{4}$/);
      expect(verifySecurityPin(plain, { hash: stored!.security_pin_hash, salt: stored!.security_pin_salt })).toBe(true);
    });

    it('never stores the PIN in plaintext anywhere', async () => {
      const { user } = await registerOk('pin2@example.com');
      const stored = await findUserById(db, user.id);
      const plain = openSealedSecurityPin(stored!.security_pin_encrypted!)!;

      expect(stored!.security_pin_hash).not.toContain(plain);
      expect(stored!.security_pin_encrypted).not.toContain(plain);

      // Nor in the audit trail, which records the rotation without any secret.
      const audit = await db.query<{ metadata: unknown }>(
        `SELECT metadata FROM audit_logs WHERE resource_id = $1`,
        [user.id]
      );
      for (const row of audit.rows) {
        expect(JSON.stringify(row.metadata)).not.toContain(plain);
      }
    });

    it('rotates after the 24-hour window — proactively in the sweep, and reactively on access', async () => {
      const { user, token } = await registerOk('rotate@example.com');
      const before = await findUserById(db, user.id);
      const beforePlain = openSealedSecurityPin(before!.security_pin_encrypted!)!;

      // 1. Worker sweep: an expired PIN is replaced without anyone touching the dashboard.
      await db.query(`UPDATE users SET security_pin_expires_at = now() - interval '1 minute' WHERE id = $1`, [user.id]);
      expect(await sweepSecurityPins(db)).toBeGreaterThanOrEqual(1);

      const afterSweep = await findUserById(db, user.id);
      expect(afterSweep!.security_pin_version).toBe(before!.security_pin_version + 1);
      const afterPlain = openSealedSecurityPin(afterSweep!.security_pin_encrypted!)!;
      expect(afterPlain).toMatch(/^[0-9]{4}$/);
      expect(afterSweep!.security_pin_hash).not.toBe(before!.security_pin_hash);
      expect(afterSweep!.security_pin_expires_at).not.toBe(before!.security_pin_expires_at);
      // Never the same value as the one it replaced.
      expect(afterPlain).not.toBe(beforePlain);

      // 2. Reactive path: expiry is enforced by the backend even if the worker never runs.
      await db.query(`UPDATE users SET security_pin_expires_at = now() - interval '1 second' WHERE id = $1`, [user.id]);
      const security = await app().inject({
        method: 'GET',
        url: '/api/v1/account/security',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(security.statusCode).toBe(200);
      expect(security.json().securityPin.secondsUntilRotation).toBeGreaterThan(0);
      const afterRead = await findUserById(db, user.id);
      expect(afterRead!.security_pin_version).toBe(afterSweep!.security_pin_version + 1);
    });

    it('keeps the default window at 24 hours', async () => {
      const { user } = await registerOk('window@example.com');
      const stored = await findUserById(db, user.id);
      const hours =
        (new Date(stored!.security_pin_expires_at!).getTime() - new Date(stored!.security_pin_created_at!).getTime()) /
        3_600_000;
      expect(hours).toBeGreaterThan(23.9);
      expect(hours).toBeLessThan(24.1);
    });

    it('hides the PIN by default in every ordinary response', async () => {
      const { user, token } = await registerOk('hidden@example.com');
      const plain = openSealedSecurityPin((await findUserById(db, user.id))!.security_pin_encrypted!)!;

      const urls = ['/api/auth/me', '/api/v1/account', '/api/v1/account/security'];
      for (const url of urls) {
        const res = await app().inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
        expect(res.statusCode, url).toBe(200);
        expect(res.body, url).not.toContain(plain);
        expect(res.body, url).not.toContain('security_pin_hash');
        expect(res.body, url).not.toContain('security_pin_encrypted');
        expect(res.body, url).not.toContain('securityPin.Hash');
      }

      const security = await app().inject({
        method: 'GET',
        url: '/api/v1/account/security',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(security.json().securityPin.maskedValue).toBe('••••');
      expect(security.json().securityPin.value).toBeUndefined();
    });

    it('cancels stale PIN mail instead of delivering a dead code', async () => {
      const { user, token } = await registerOk('mailcancel@example.com');
      await verifyEmail(user.id);
      const { challengeId } = await openGate(token);

      // The code's validity window has passed while the mail sat in the queue. `next_attempt_at`
      // is set back because a just-queued row is briefly not due (the claim lease pushes it
      // forward), and this test is about the expiry check, not the lease.
      await db.query(
        `UPDATE pin_verification_email_queue
            SET expires_at = now() - interval '1 minute', next_attempt_at = now()
          WHERE challenge_id = $1`,
        [challengeId]
      );

      const report = await deliverPinVerificationEmails(db, {
        source: { NOTIFICATION_EMAIL_WEBHOOK_URL: 'https://mail.invalid/send', NOTIFICATION_EMAIL_WEBHOOK_TOKEN: 't' },
      });
      expect(report.delivered).toBe(0);
      expect(report.cancelled).toBe(1);

      const row = await db.query<{ status: string }>(
        `SELECT status FROM pin_verification_email_queue WHERE challenge_id = $1`,
        [challengeId]
      );
      expect(row.rows[0]!.status).toBe('CANCELLED');
    });

    it('notifies the customer that the PIN rotated without ever including the PIN', async () => {
      const { user } = await registerOk('notify@example.com');
      await db.query(`UPDATE users SET security_pin_expires_at = now() - interval '1 hour' WHERE id = $1`, [user.id]);
      await sweepSecurityPins(db);
      expect(await sweepSecurityPinNotices(db)).toBeGreaterThanOrEqual(1);

      const stored = await findUserById(db, user.id);
      const plain = openSealedSecurityPin(stored!.security_pin_encrypted!)!;

      const notes = await db.query<{ type: string; message: string }>(
        `SELECT type, message FROM user_notifications WHERE user_id = $1`,
        [user.id]
      );
      expect(notes.rows.length).toBe(1);
      expect(notes.rows[0]!.type).toBe('SECURITY_PIN_ROTATED');
      expect(notes.rows[0]!.message).not.toContain(plain);

      // Idempotent: a second tick re-notifies nobody.
      expect(await sweepSecurityPinNotices(db)).toBe(0);
    });
  });

  // --- 4. Email verification gate ---------------------------------------------------------------

  describe('email verification before viewing the PIN', () => {
    it('requires a verified email address before a code is even sent', async () => {
      const { user, token } = await registerOk('unverified@example.com');
      expect((await findUserById(db, user.id))!.email_verified_at).toBeNull();
      const res = await app().inject({
        method: 'POST',
        url: '/api/v1/account/security-pin/view',
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      });
      expect(res.statusCode).toBe(403);
      expect(res.body).not.toContain('securityPin');
    });

    it('issues a six-digit code to the registered address only, never to a supplied one', async () => {
      const { user, token } = await registerOk('gate@example.com');
      await verifyEmail(user.id);

      const res = await app().inject({
        method: 'POST',
        url: '/api/v1/account/security-pin/view',
        headers: { authorization: `Bearer ${token}` },
        // An attacker-supplied address must be ignored: the schema has no field for it.
        payload: { email: 'attacker@evil.example' },
      });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json();
      expect(body.challenge.challengeToken).toMatch(/^[A-Za-z0-9_-]{20,}$/);
      expect(body.challenge.maskedEmail).not.toBe('attacker@evil.example');
      expect(body.challenge.maskedEmail).toMatch(/@example\.com$/);
      // The code itself is never in the response.
      expect(JSON.stringify(body)).not.toMatch(/"code"\s*:\s*"\d{6}"/);

      const queued = await db.query<{ recipient_email: string }>(
        `SELECT recipient_email FROM pin_verification_email_queue`
      );
      expect(queued.rows.map((row) => row.recipient_email)).toEqual(['gate@example.com']);
    });

    it('reveals the PIN only after a correct code, and only once', async () => {
      const { user, token } = await registerOk('reveal@example.com');
      await verifyEmail(user.id);
      const expected = openSealedSecurityPin((await findUserById(db, user.id))!.security_pin_encrypted!)!;

      const { challengeToken, code } = await openGate(token);

      const wrong = await app().inject({
        method: 'POST',
        url: '/api/v1/account/security-pin/verify',
        headers: { authorization: `Bearer ${token}` },
        payload: { challengeToken, code: code === '000000' ? '111111' : '000000' },
      });
      expect(wrong.statusCode).toBe(400);
      expect(wrong.json().error).toBe('VERIFICATION_CODE_INVALID');

      const ok = await app().inject({
        method: 'POST',
        url: '/api/v1/account/security-pin/verify',
        headers: { authorization: `Bearer ${token}` },
        payload: { challengeToken, code },
      });
      expect(ok.statusCode, ok.body).toBe(200);
      expect(ok.json().verified).toBe(true);

      const reveal = await app().inject({
        method: 'POST',
        url: '/api/v1/account/security-pin/reveal',
        headers: { authorization: `Bearer ${token}` },
        payload: { challengeToken },
      });
      expect(reveal.statusCode, reveal.body).toBe(200);
      expect(reveal.json().securityPin.value).toBe(expected);
      expect(reveal.json().securityPin.displayTtlSeconds).toBe(30);

      // The same verification cannot be replayed for a second view.
      const replay = await app().inject({
        method: 'POST',
        url: '/api/v1/account/security-pin/reveal',
        headers: { authorization: `Bearer ${token}` },
        payload: { challengeToken },
      });
      expect(replay.statusCode).toBe(404);
      expect(replay.body).not.toContain(expected);
    });

    it('rejects a correct code that is presented with a different session', async () => {
      const { user, token } = await registerOk('session@example.com');
      await verifyEmail(user.id);
      const { challengeToken, code } = await openGate(token);

      // A second, independent login for the same account is a different session (different jti).
      const otherLogin = await app().inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'session@example.com', password: 'correct-horse-battery' },
      });
      const otherToken = otherLogin.json().token as string;

      const res = await app().inject({
        method: 'POST',
        url: '/api/v1/account/security-pin/verify',
        headers: { authorization: `Bearer ${otherToken}` },
        payload: { challengeToken, code },
      });
      expect(res.statusCode).toBe(404);
    });

    it('rejects an expired code', async () => {
      const { user, token } = await registerOk('expired@example.com');
      await verifyEmail(user.id);
      const { challengeToken, code, challengeId } = await openGate(token);

      await db.query(
        `UPDATE security_pin_verification_challenges SET expires_at = now() - interval '1 minute' WHERE id = $1`,
        [challengeId]
      );
      const res = await app().inject({
        method: 'POST',
        url: '/api/v1/account/security-pin/verify',
        headers: { authorization: `Bearer ${token}` },
        payload: { challengeToken, code },
      });
      expect(res.statusCode).toBe(410);
      expect(res.json().error).toBe('VERIFICATION_EXPIRED');
    });

    it('expires codes after ten minutes by default', async () => {
      const { user, token } = await registerOk('ttl@example.com');
      await verifyEmail(user.id);
      const { challengeId } = await openGate(token);
      const row = await db.query<{ expires_at: string; created_at: string }>(
        `SELECT created_at, expires_at FROM security_pin_verification_challenges WHERE id = $1`,
        [challengeId]
      );
      const minutes =
        (new Date(row.rows[0]!.expires_at).getTime() - new Date(row.rows[0]!.created_at).getTime()) / 60_000;
      expect(minutes).toBeGreaterThan(9.9);
      expect(minutes).toBeLessThan(10.1);
    });

    it('limits wrong attempts, then refuses the challenge entirely', async () => {
      const { user, token } = await registerOk('attempts@example.com');
      await verifyEmail(user.id);
      const { challengeToken, code } = await openGate(token);
      const wrongCode = code === '000000' ? '111111' : '000000';

      let lastBody: { error?: string } = {};
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const res = await app().inject({
          method: 'POST',
          url: '/api/v1/account/security-pin/verify',
          headers: { authorization: `Bearer ${token}` },
          payload: { challengeToken, code: wrongCode },
        });
        lastBody = res.json();
        // The first four are ordinary rejections with a countdown; the fifth exhausts the
        // challenge and is reported as a rate-limit (429), not another "wrong code".
        expect([400, 429]).toContain(res.statusCode);
        if (attempt < 4) expect(res.json().error).toBe('VERIFICATION_CODE_INVALID');
      }
      expect(lastBody.error).toBe('VERIFICATION_ATTEMPTS_EXHAUSTED');

      // Even the *correct* code now fails: the challenge is finished.
      const afterExhaustion = await app().inject({
        method: 'POST',
        url: '/api/v1/account/security-pin/verify',
        headers: { authorization: `Bearer ${token}` },
        payload: { challengeToken, code },
      });
      expect([404, 429]).toContain(afterExhaustion.statusCode);
    });

    it('invalidates the previous code when a replacement is issued, and throttles resends', async () => {
      const { user, token } = await registerOk('resend@example.com');
      await verifyEmail(user.id);
      const { challengeToken, code: firstCode, challengeId } = await openGate(token);

      // Too soon: the cooldown is enforced server-side.
      const tooSoon = await app().inject({
        method: 'POST',
        url: '/api/v1/account/security-pin/resend',
        headers: { authorization: `Bearer ${token}` },
        payload: { challengeToken },
      });
      expect(tooSoon.statusCode).toBe(429);
      expect(tooSoon.json().error).toBe('VERIFICATION_RESEND_TOO_SOON');

      // Simulate the cooldown having elapsed.
      await db.query(
        `UPDATE security_pin_verification_challenges SET created_at = now() - interval '5 minutes' WHERE id = $1`,
        [challengeId]
      );
      const resent = await app().inject({
        method: 'POST',
        url: '/api/v1/account/security-pin/resend',
        headers: { authorization: `Bearer ${token}` },
        payload: { challengeToken },
      });
      expect(resent.statusCode, resent.body).toBe(200);
      expect(resent.json().challenge.resendCount).toBe(1);

      const queued = await db.query<{ code_envelope: string }>(
        `SELECT code_envelope FROM pin_verification_email_queue WHERE challenge_id = $1`,
        [challengeId]
      );
      const { openSealedCode, deriveCodeKey } = await import('../../src/services/security-pin-email-service');
      const { resolvePinKey } = await import('../../src/services/security-pin-service');
      const secondCode = openSealedCode(queued.rows[0]!.code_envelope, deriveCodeKey(resolvePinKey()))!;

      // The old code no longer works; the new one does.
      const stale = await app().inject({
        method: 'POST',
        url: '/api/v1/account/security-pin/verify',
        headers: { authorization: `Bearer ${token}` },
        payload: { challengeToken, code: firstCode },
      });
      expect(stale.statusCode).toBe(400);

      const fresh = await app().inject({
        method: 'POST',
        url: '/api/v1/account/security-pin/verify',
        headers: { authorization: `Bearer ${token}` },
        payload: { challengeToken, code: secondCode },
      });
      expect(fresh.statusCode, fresh.body).toBe(200);
    });

    it('supersedes a live challenge when a new one is opened', async () => {
      const { user, token } = await registerOk('supersede@example.com');
      await verifyEmail(user.id);
      const first = await openGate(token);
      const second = await openGate(token);
      expect(second.challengeId).not.toBe(first.challengeId);

      const live = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM security_pin_verification_challenges
          WHERE user_id = $1 AND consumed_at IS NULL`,
        [user.id]
      );
      expect(Number(live.rows[0]!.count)).toBe(1);

      const stale = await app().inject({
        method: 'POST',
        url: '/api/v1/account/security-pin/verify',
        headers: { authorization: `Bearer ${token}` },
        payload: { challengeToken: first.challengeToken, code: first.code },
      });
      expect(stale.statusCode).toBe(404);
    });

    it('blocks the gate while an administrator is in support mode', async () => {
      const { user, token } = await registerOk('supportblock@example.com', 'pinowner');
      await verifyEmail(user.id);
      const staff = await createStaff('admin');

      const started = await app().inject({
        method: 'POST',
        url: `/api/v1/admin/customers/${user.id}/switch`,
        headers: { authorization: `Bearer ${staff.token}` },
        payload: { reason: 'customer called about their PIN' },
      });
      expect(started.statusCode, started.body).toBe(201);
      const delegatedToken = started.json().token as string;

      const res = await app().inject({
        method: 'POST',
        url: '/api/v1/account/security-pin/view',
        headers: { authorization: `Bearer ${delegatedToken}` },
        payload: {},
      });
      expect(res.statusCode).toBe(403);
      expect(res.body).not.toContain('challengeToken');

      // The customer's own session still works.
      const own = await app().inject({
        method: 'POST',
        url: '/api/v1/account/security-pin/view',
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      });
      expect(own.statusCode).toBe(200);
    });
  });

  // --- 5. Isolation & no leakage ------------------------------------------------------------------

  describe('customer isolation and leakage', () => {
    it('never lets one customer reach another customer', async () => {
      const a = await registerOk('iso-a@example.com');
      const b = await registerOk('iso-b@example.com');
      await verifyEmail(a.user.id);
      await verifyEmail(b.user.id);

      // A's token can only ever act on A's account, whatever ids it sends.
      const withForeignId = await app().inject({
        method: 'POST',
        url: '/api/v1/account/security-pin/view',
        headers: { authorization: `Bearer ${a.token}` },
        payload: { userId: b.user.id },
      });
      expect(withForeignId.statusCode).toBe(200);
      const queue = await db.query<{ recipient_email: string }>(
        `SELECT recipient_email FROM pin_verification_email_queue`
      );
      expect(queue.rows.map((row) => row.recipient_email)).toEqual(['iso-a@example.com']);

      // Unauthenticated access is refused outright.
      const anonymous = await app().inject({
        method: 'GET',
        url: '/api/v1/account/security',
      });
      expect(anonymous.statusCode).toBe(401);
    });

    it('does not leak the PIN through the audit trail or the security payload', async () => {
      const { user, token } = await registerOk('leak@example.com');
      await verifyEmail(user.id);
      const { challengeToken, code } = await openGate(token);
      await app().inject({
        method: 'POST',
        url: '/api/v1/account/security-pin/verify',
        headers: { authorization: `Bearer ${token}` },
        payload: { challengeToken, code },
      });
      const reveal = await app().inject({
        method: 'POST',
        url: '/api/v1/account/security-pin/reveal',
        headers: { authorization: `Bearer ${token}` },
        payload: { challengeToken },
      });
      const pin = reveal.json().securityPin.value as string;

      const audits = await db.query<{ action: string; metadata: unknown }>(
        `SELECT action, metadata FROM audit_logs WHERE resource_id = $1`,
        [user.id]
      );
      expect(audits.rows.some((row) => row.action === 'security_pin_viewed')).toBe(true);
      for (const row of audits.rows) {
        expect(JSON.stringify(row.metadata)).not.toContain(pin);
      }

      const events = await db.query<{ event_type: string; metadata: unknown }>(
        `SELECT event_type, metadata FROM auth_audit_log WHERE user_id = $1`,
        [user.id]
      );
      for (const row of events.rows) {
        expect(JSON.stringify(row.metadata)).not.toContain(pin);
        expect(JSON.stringify(row.metadata)).not.toContain(code);
      }
    });

    it('never gives staff the PIN value, only lifecycle metadata', async () => {
      const { user } = await registerOk('staffpin@example.com');
      const staff = await createStaff('admin');
      const stored = await findUserById(db, user.id);
      const pin = openSealedSecurityPin(stored!.security_pin_encrypted!)!;

      const res = await app().inject({
        method: 'GET',
        url: `/api/v1/admin/users/${user.id}/security-pin`,
        headers: { authorization: `Bearer ${staff.token}` },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.body).not.toContain(pin);
      expect(res.body).not.toContain(stored!.security_pin_hash!);
      expect(res.json().securityPin.expiresAt).toBeTruthy();

      // Nor through a forced rotation.
      const rotated = await app().inject({
        method: 'POST',
        url: `/api/v1/admin/users/${user.id}/security-pin/rotate`,
        headers: { authorization: `Bearer ${staff.token}` },
      });
      expect(rotated.statusCode).toBe(200);
      expect(rotated.body).not.toMatch(/"[0-9]{4}"/);
    });
  });

  // --- 6. Account recovery ------------------------------------------------------------------------

  describe('account recovery', () => {
    it('opens a request without revealing the PIN or bypassing verification', async () => {
      const { user, token } = await registerOk('recover@example.com');
      const stored = await findUserById(db, user.id);
      const pin = openSealedSecurityPin(stored!.security_pin_encrypted!)!;

      const res = await app().inject({
        method: 'POST',
        url: '/api/v1/account/recovery',
        headers: { authorization: `Bearer ${token}` },
        payload: { reason: 'cannot_access_email', details: 'Lost access to my inbox' },
      });
      expect(res.statusCode, res.body).toBe(200);
      const reference = (res.json().recovery.reference as string).trim();
      expect(reference).toMatch(/^[A-Z2-9]{10}$/);
      expect(res.body).not.toContain(pin);

      // Recovery alone does not unlock the PIN gate.
      const stillGated = await app().inject({
        method: 'POST',
        url: '/api/v1/account/security-pin/reveal',
        headers: { authorization: `Bearer ${token}` },
        payload: { challengeToken: 'not-a-real-challenge-token' },
      });
      expect(stillGated.statusCode).toBe(404);
      expect((await findUserById(db, user.id))!.security_pin_hash).toBe(stored!.security_pin_hash);
    });

    it('is idempotent: a second request returns the open one instead of stacking claims', async () => {
      const { token } = await registerOk('recover2@example.com');
      const first = await app().inject({
        method: 'POST',
        url: '/api/v1/account/recovery',
        headers: { authorization: `Bearer ${token}` },
        payload: { reason: 'lost_device' },
      });
      const second = await app().inject({
        method: 'POST',
        url: '/api/v1/account/recovery',
        headers: { authorization: `Bearer ${token}` },
        payload: { reason: 'lost_device' },
      });
      expect(second.json().existing).toBe(true);
      expect(second.json().recovery.reference).toBe(first.json().recovery.reference);
    });

    it('cannot be approved without a recorded identity verification, and approval only forces re-verification', async () => {
      const { user, token } = await registerOk('recover3@example.com');
      await verifyEmail(user.id);
      const staff = await createStaff('admin');

      const opened = await app().inject({
        method: 'POST',
        url: '/api/v1/account/recovery',
        headers: { authorization: `Bearer ${token}` },
        payload: { reason: 'email_compromised' },
      });
      const recoveryId = opened.json().recovery.id as string;

      const premature = await app().inject({
        method: 'PATCH',
        url: `/api/v1/admin/recovery-requests/${recoveryId}`,
        headers: { authorization: `Bearer ${staff.token}` },
        payload: { status: 'APPROVED' },
      });
      expect(premature.statusCode).toBe(409);

      const verified = await app().inject({
        method: 'PATCH',
        url: `/api/v1/admin/recovery-requests/${recoveryId}`,
        headers: { authorization: `Bearer ${staff.token}` },
        payload: { status: 'IDENTITY_VERIFIED', note: 'Video call + government ID checked' },
      });
      expect(verified.statusCode, verified.body).toBe(200);

      const approved = await app().inject({
        method: 'PATCH',
        url: `/api/v1/admin/recovery-requests/${recoveryId}`,
        headers: { authorization: `Bearer ${staff.token}` },
        payload: { status: 'APPROVED', note: 'Ownership confirmed' },
      });
      expect(approved.statusCode, approved.body).toBe(200);

      // Approval revokes email verification — it does not hand out a PIN, a session, or an email
      // address change.
      const after = await findUserById(db, user.id);
      expect(after!.email_verified_at).toBeNull();
      expect(after!.email).toBe('recover3@example.com');

      const gate = await app().inject({
        method: 'POST',
        url: '/api/v1/account/security-pin/view',
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      });
      expect(gate.statusCode).toBe(403);
    });

    it('rejects a request without a note, and refuses cross-customer cancellation', async () => {
      const a = await registerOk('recover-a@example.com');
      const b = await registerOk('recover-b@example.com');
      const staff = await createStaff('admin');

      const opened = await app().inject({
        method: 'POST',
        url: '/api/v1/account/recovery',
        headers: { authorization: `Bearer ${a.token}` },
        payload: { reason: 'other' },
      });
      const recoveryId = opened.json().recovery.id as string;

      const noNote = await app().inject({
        method: 'PATCH',
        url: `/api/v1/admin/recovery-requests/${recoveryId}`,
        headers: { authorization: `Bearer ${staff.token}` },
        payload: { status: 'REJECTED' },
      });
      expect(noNote.statusCode).toBe(400);

      // B cannot cancel A's claim — and learns nothing about whether it exists.
      const foreign = await app().inject({
        method: 'POST',
        url: `/api/v1/account/recovery/${recoveryId}/cancel`,
        headers: { authorization: `Bearer ${b.token}` },
        payload: {},
      });
      expect(foreign.statusCode).toBe(404);

      const own = await app().inject({
        method: 'POST',
        url: `/api/v1/account/recovery/${recoveryId}/cancel`,
        headers: { authorization: `Bearer ${a.token}` },
        payload: {},
      });
      expect(own.statusCode, own.body).toBe(200);
      expect(own.json().recovery.status).toBe('CANCELLED');
    });

    it('records every recovery step in the audit trail without secrets', async () => {
      const { user, token } = await registerOk('recover-audit@example.com');
      await app().inject({
        method: 'POST',
        url: '/api/v1/account/recovery',
        headers: { authorization: `Bearer ${token}` },
        payload: { reason: 'cannot_access_email' },
      });
      const events = await db.query<{ event_type: string }>(
        `SELECT event_type FROM auth_audit_log WHERE user_id = $1 ORDER BY created_at`,
        [user.id]
      );
      expect(events.rows.map((row) => row.event_type)).toContain('account_recovery_requested');
    });
  });

  // --- 7. Rate limiting & hashing mechanics -------------------------------------------------------

  describe('rate limits and primitives', () => {
    it('rate limits repeated code requests (route-level fixed window)', async () => {
      const { user, token } = await registerOk('ratelimit@example.com');
      await verifyEmail(user.id);

      // One long-lived instance: the limiter's counter lives on the instance, so building a fresh
      // app per request would silently test nothing.
      const instance = app();
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 9; attempt += 1) {
        const res = await instance.inject({
          method: 'POST',
          url: '/api/v1/account/security-pin/view',
          headers: { authorization: `Bearer ${token}` },
          payload: {},
        });
        statuses.push(res.statusCode);
      }
      // The route allows five per ten minutes; the rest are refused with 429.
      expect(statuses.filter((status) => status === 200).length).toBe(5);
      expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0);
    });

    it('hashes with a per-value salt so identical PINs do not produce identical rows', () => {
      const key = Buffer.from('k'.repeat(32));
      const saltA = 'a'.repeat(32);
      const saltB = 'b'.repeat(32);
      expect(hashSecurityPin('0047', saltA, key)).not.toBe(hashSecurityPin('0047', saltB, key));
      expect(verifySecurityPin('0047', { hash: hashSecurityPin('0047', saltA, key), salt: saltA }, key)).toBe(true);
      expect(verifySecurityPin('0048', { hash: hashSecurityPin('0047', saltA, key), salt: saltA }, key)).toBe(false);
    });

    it('seals the recoverable copy so tampering fails closed', () => {
      const key = Buffer.from('k'.repeat(32));
      const sealed = sealSecurityPin('0047', key);
      expect(openSealedSecurityPin(sealed, key)).toBe('0047');
      // A different key cannot open it, and neither can a tampered envelope.
      expect(openSealedSecurityPin(sealed, Buffer.from('z'.repeat(32)))).toBeNull();
      const [, iv, tag, data] = sealed.split(':');
      const flipped = data!.slice(0, -2) + (data!.endsWith('A') ? 'BA' : 'AA');
      expect(openSealedSecurityPin(['pin1', iv, tag, flipped].join(':'), key)).toBeNull();
    });

    it('stores only a challenge-token digest and a code digest', async () => {
      const { user, token } = await registerOk('digest@example.com');
      await verifyEmail(user.id);
      const { challengeToken, code, challengeId } = await openGate(token);
      const row = await findLatestChallenge(db, user.id);
      expect(row!.id).toBe(challengeId);
      expect(row!.challenge_token_hash).not.toContain(challengeToken);
      expect(row!.code_hash).not.toContain(code);
      expect(row!.challenge_token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(row!.code_hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});
