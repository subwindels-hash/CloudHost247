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
import { sweepExpiredSupportSessions, sweepSecurityNumbers } from '../../src/worker/sweeps';
import {
  generateSecurityNumber,
  getStatus,
  hashSecurityNumber,
  rotateSecurityNumber,
} from '../../src/services/security-number-service';

/**
 * End-to-end coverage for customer identity, the rotating Security Number, profile editing and
 * admin support-mode account switching, against a real embedded Postgres engine (pglite) with
 * the real migrations applied — including 0051.
 */
describe('customer identity, security number and support mode', () => {
  let db: PGlite;
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
    JWT_SECRET: 'k'.repeat(32),
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

  async function register(email: string, password = 'correct-horse-battery') {
    const res = await app().inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email, password, fullName: 'Test Person' },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as {
      user: { id: string; customerId: string };
      token: string;
      securityNumber: { value: string; expiresAt: string };
    };
  }

  async function createStaff(role: 'admin' | 'super_admin', email = `${role}-${randomUUID()}@example.com`) {
    const id = randomUUID();
    await db.query(
      `INSERT INTO users (id, email, password_hash, full_name, role, customer_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, email, await hashPassword('correct-horse-battery'), 'Staff Person', role, String(Math.floor(Math.random() * 900000) + 100000)]
    );
    return { id, token: signAuthToken(env, { sub: id, role, email }) };
  }

  // --- Customer ID ------------------------------------------------------------------------------

  it('issues a permanent, unique six-digit Customer ID at registration and keeps it stable', async () => {
    const first = await register('ident1@example.com');
    const second = await register('ident2@example.com');

    expect(first.user.customerId).toMatch(/^[0-9]{6}$/);
    expect(second.user.customerId).toMatch(/^[0-9]{6}$/);
    expect(first.user.customerId).not.toBe(second.user.customerId);

    // Immutable across profile edits.
    const res = await app().inject({
      method: 'PATCH',
      url: '/api/v1/account',
      headers: { authorization: `Bearer ${first.token}` },
      payload: { fullName: 'Renamed Person', city: 'Abuja' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.customerId).toBe(first.user.customerId);

    const stored = await findUserById(db, first.user.id);
    expect(stored?.customer_id).toBe(first.user.customerId);
    expect(stored?.id).toBe(first.user.id); // the uuid primary key is untouched
  });

  it('backfilled every pre-existing account during the migration', async () => {
    const { rows } = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM users WHERE customer_id IS NULL`
    );
    expect(Number(rows[0]?.count)).toBe(0);
  });

  it('refuses a duplicate Customer ID at the database level', async () => {
    const a = await register('dupe1@example.com');
    await expect(
      db.query(`UPDATE users SET customer_id = $1 WHERE email = 'dupe1@example.com' OR email = $2`, [
        a.user.customerId,
        'dupe1@example.com',
      ])
    ).resolves.toBeTruthy();
    const b = await register('dupe2@example.com');
    await expect(db.query(`UPDATE users SET customer_id = $1 WHERE id = $2`, [a.user.customerId, b.user.id])).rejects.toThrow();
  });

  // --- Security Number --------------------------------------------------------------------------

  it('returns a four-digit Security Number once at registration and never stores it in plaintext', async () => {
    const { user, securityNumber } = await register('sn1@example.com');
    expect(securityNumber.value).toMatch(/^[0-9]{4}$/);

    const stored = await findUserById(db, user.id);
    expect(stored?.security_number_hash).toBeTruthy();
    expect(stored?.security_number_hash).not.toContain(securityNumber.value);
    expect(stored?.security_number_initialized).toBe(true);

    // 24-hour window by default.
    const ttlHours =
      (new Date(stored!.security_number_expires_at!).getTime() - new Date(stored!.security_number_created_at!).getTime()) /
      3_600_000;
    expect(ttlHours).toBeGreaterThan(23.9);
    expect(ttlHours).toBeLessThan(24.1);
  });

  it('never exposes the security number (or its hash) via /api/auth/me or the account payload', async () => {
    const { token, securityNumber } = await register('sn2@example.com');
    for (const url of ['/api/auth/me', '/api/v1/account']) {
      const res = await app().inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
      expect(res.statusCode).toBe(200);
      const body = res.body;
      expect(body).not.toContain(securityNumber.value);
      expect(body).not.toContain('security_number');
      expect(body).not.toContain('securityNumberHash');
    }
  });

  it('exposes status only — never the value — on the status endpoint', async () => {
    const { token, securityNumber } = await register('sn3@example.com');
    const res = await app().inject({
      method: 'GET',
      url: '/api/v1/account/security-number/status',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.securityNumber.initialized).toBe(true);
    expect(body.securityNumber.expired).toBe(false);
    expect(body.securityNumber.secondsUntilExpiry).toBeGreaterThan(0);
    expect(res.body).not.toContain(securityNumber.value);
    expect(body.securityNumber.value).toBeUndefined();
  });

  it('reactively rotates an expired number so the customer is never locked out', async () => {
    const { user, token } = await register('sn4@example.com');
    await db.query(`UPDATE users SET security_number_expires_at = now() - interval '2 hours' WHERE id = $1`, [user.id]);

    const before = await findUserById(db, user.id);
    const res = await app().inject({
      method: 'GET',
      url: '/api/v1/account/security-number/status',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().rotated).toBe(true);
    expect(res.json().securityNumber.expired).toBe(false);

    const after = await findUserById(db, user.id);
    expect(after!.security_number_version).toBe(before!.security_number_version + 1);
    expect(after!.security_number_hash).not.toBe(before!.security_number_hash);
  });

  it('proactively rotates expired numbers in the worker sweep, audited without the value', async () => {
    const { user } = await register('sn5@example.com');
    await db.query(`UPDATE users SET security_number_expires_at = now() - interval '1 hour' WHERE id = $1`, [user.id]);

    const rotated = await sweepSecurityNumbers(db);
    expect(rotated).toBeGreaterThanOrEqual(1);

    const after = await findUserById(db, user.id);
    expect(new Date(after!.security_number_expires_at!).getTime()).toBeGreaterThan(Date.now());

    const audit = await db.query<{ action: string; metadata: unknown }>(
      `SELECT action, metadata FROM audit_logs WHERE action = 'security_number_rotated' AND resource_id = $1`,
      [user.id]
    );
    expect(audit.rows.length).toBe(1);
    expect(JSON.stringify(audit.rows[0]!.metadata)).toContain('scheduled_rotation');
  });

  it('changes the security number only when the current one is supplied, restarting the window', async () => {
    const { user, token, securityNumber } = await register('sn6@example.com');

    const wrong = await app().inject({
      method: 'POST',
      url: '/api/v1/account/security-number/change',
      headers: { authorization: `Bearer ${token}` },
      payload: { currentSecurityNumber: securityNumber.value === '0000' ? '1111' : '0000', newSecurityNumber: '4321' },
    });
    expect(wrong.statusCode).toBe(401);

    const bad = await app().inject({
      method: 'POST',
      url: '/api/v1/account/security-number/change',
      headers: { authorization: `Bearer ${token}` },
      payload: { currentSecurityNumber: securityNumber.value, newSecurityNumber: '12' },
    });
    expect(bad.statusCode).toBe(400);

    const ok = await app().inject({
      method: 'POST',
      url: '/api/v1/account/security-number/change',
      headers: { authorization: `Bearer ${token}` },
      payload: { currentSecurityNumber: securityNumber.value, newSecurityNumber: '4321' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).not.toContain('4321');

    const after = await findUserById(db, user.id);
    expect(new Date(after!.security_number_expires_at!).getTime()).toBeGreaterThan(Date.now() + 23 * 3_600_000);
  });

  it('requires step-up re-authentication before revealing a new value', async () => {
    const { token } = await register('sn7@example.com');

    const denied = await app().inject({
      method: 'POST',
      url: '/api/v1/account/security-number/reveal',
      headers: { authorization: `Bearer ${token}` },
      payload: { password: 'not-the-password' },
    });
    expect(denied.statusCode).toBe(401);

    const revealed = await app().inject({
      method: 'POST',
      url: '/api/v1/account/security-number/reveal',
      headers: { authorization: `Bearer ${token}` },
      payload: { password: 'correct-horse-battery' },
    });
    expect(revealed.statusCode).toBe(200);
    expect(revealed.json().securityNumber.value).toMatch(/^[0-9]{4}$/);
    expect(revealed.json().securityNumber.displayTtlSeconds).toBeGreaterThan(0);
  });

  it('never gives an administrator the value or the hash, only lifecycle metadata', async () => {
    const { user, securityNumber } = await register('sn8@example.com');
    const admin = await createStaff('admin');

    const res = await app().inject({
      method: 'GET',
      url: `/api/v1/admin/users/${user.id}/security-number`,
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(securityNumber.value);
    expect(res.body).not.toContain('hash');
    expect(res.json().securityNumber.initialized).toBe(true);

    const detail = await app().inject({
      method: 'GET',
      url: `/api/v1/admin/users/${user.id}`,
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(detail.body).not.toContain(securityNumber.value);
    expect(detail.body).not.toContain('passwordHash');
    expect(detail.json().user.customerId).toMatch(/^[0-9]{6}$/);
  });

  it('lets an admin force rotation and a super admin require re-initialization', async () => {
    const { user } = await register('sn9@example.com');
    const admin = await createStaff('admin');
    const superAdmin = await createStaff('super_admin');

    const before = await findUserById(db, user.id);
    const rotate = await app().inject({
      method: 'POST',
      url: `/api/v1/admin/users/${user.id}/security-number/rotate`,
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(rotate.statusCode).toBe(200);
    const afterRotate = await findUserById(db, user.id);
    expect(afterRotate!.security_number_version).toBe(before!.security_number_version + 1);

    const denied = await app().inject({
      method: 'POST',
      url: `/api/v1/admin/users/${user.id}/security-number/require-reinitialization`,
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(denied.statusCode).toBe(403);

    const required = await app().inject({
      method: 'POST',
      url: `/api/v1/admin/users/${user.id}/security-number/require-reinitialization`,
      headers: { authorization: `Bearer ${superAdmin.token}` },
    });
    expect(required.statusCode).toBe(200);
    const afterReset = await findUserById(db, user.id);
    expect(afterReset!.security_number_initialized).toBe(false);
    expect(afterReset!.security_number_hash).toBeNull();
  });

  it('honours the super admin rotation-interval policy', async () => {
    const superAdmin = await createStaff('super_admin');
    const res = await app().inject({
      method: 'PUT',
      url: '/api/v1/admin/security-number/policy',
      headers: { authorization: `Bearer ${superAdmin.token}` },
      payload: { rotationHours: 6, supportSessionMinutes: 15 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().policy.rotationHours).toBe(6);

    const { user } = await register('sn10@example.com');
    await rotateSecurityNumber(db, user.id);
    const refreshed = await findUserById(db, user.id);
    const hours =
      (new Date(refreshed!.security_number_expires_at!).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(5.9);
    expect(hours).toBeLessThan(6.1);
  });

  it('rate limits repeated failed verifications', async () => {
    const { user, token } = await register('sn11@example.com');
    await rotateSecurityNumber(db, user.id, { plain: '1234' });

    let lastStatus = 0;
    for (let i = 0; i < 6; i += 1) {
      const res = await app().inject({
        method: 'POST',
        url: '/api/v1/account/security-number/change',
        headers: { authorization: `Bearer ${token}` },
        payload: { currentSecurityNumber: '9999', newSecurityNumber: '4321' },
      });
      lastStatus = res.statusCode;
    }
    // Either the per-account attempt policy (403) or the per-route rate limiter (429) stops it.
    expect([403, 429]).toContain(lastStatus);
  });

  // --- Profile editing ---------------------------------------------------------------------------

  it('allows editing safe profile fields and rejects protected ones', async () => {
    const { user, token } = await register('prof1@example.com');

    const ok = await app().inject({
      method: 'PATCH',
      url: '/api/v1/account',
      headers: { authorization: `Bearer ${token}` },
      payload: { fullName: 'New Name', phone: '+2348000000000', country: 'NG', city: 'Abuja', state: 'FCT' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.phone).toBe('+2348000000000');

    for (const payload of [
      { role: 'super_admin' },
      { status: 'active' },
      { customerId: '123456' },
      { id: randomUUID() },
      { email: 'new@example.com' },
      { securityNumberHash: 'x' },
    ]) {
      const res = await app().inject({
        method: 'PATCH',
        url: '/api/v1/account',
        headers: { authorization: `Bearer ${token}` },
        payload,
      });
      expect(res.statusCode).toBe(400);
    }

    const stored = await findUserById(db, user.id);
    expect(stored!.role).toBe('customer');
    expect(stored!.email).toBe('prof1@example.com');
  });

  it('stores, serves and removes a profile image, rejecting unsafe uploads', async () => {
    const { token } = await register('prof2@example.com');
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 3)]);

    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>').toString('base64');
    const rejected = await app().inject({
      method: 'PUT',
      url: '/api/v1/account/profile-image',
      headers: { authorization: `Bearer ${token}` },
      payload: { data: svg, contentType: 'image/svg+xml' },
    });
    expect(rejected.statusCode).toBe(400);

    const uploaded = await app().inject({
      method: 'PUT',
      url: '/api/v1/account/profile-image',
      headers: { authorization: `Bearer ${token}` },
      payload: { data: png.toString('base64'), contentType: 'image/png', fileName: 'avatar.png' },
    });
    expect(uploaded.statusCode).toBe(200);
    expect(uploaded.json().profileImage.contentType).toBe('image/png');

    const fetched = await app().inject({
      method: 'GET',
      url: '/api/v1/account/profile-image',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.headers['content-type']).toContain('image/png');
    expect(fetched.headers['x-content-type-options']).toBe('nosniff');

    const removed = await app().inject({
      method: 'DELETE',
      url: '/api/v1/account/profile-image',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(removed.statusCode).toBe(204);
  });

  // --- Admin user management ---------------------------------------------------------------------

  it('creates users with identity, searches by Customer ID, and soft-deletes them', async () => {
    const superAdmin = await createStaff('super_admin');

    const created = await app().inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: { authorization: `Bearer ${superAdmin.token}` },
      payload: { email: 'made-by-admin@example.com', fullName: 'Made ByAdmin', password: 'correct-horse-battery' },
    });
    expect(created.statusCode).toBe(201);
    const customerId = created.json().user.customerId as string;
    expect(customerId).toMatch(/^[0-9]{6}$/);
    // The admin does not receive the generated Security Number.
    expect(created.body).not.toMatch(/"securityNumber"\s*:\s*"?[0-9]{4}/);

    const stored = await findUserById(db, created.json().user.id);
    expect(stored!.security_number_initialized).toBe(true);

    const search = await app().inject({
      method: 'GET',
      url: `/api/v1/admin/users?search=${customerId}`,
      headers: { authorization: `Bearer ${superAdmin.token}` },
    });
    expect(search.statusCode).toBe(200);
    expect(search.json().users).toHaveLength(1);
    expect(search.json().users[0].customerId).toBe(customerId);

    const deleted = await app().inject({
      method: 'DELETE',
      url: `/api/v1/admin/users/${created.json().user.id}`,
      headers: { authorization: `Bearer ${superAdmin.token}` },
    });
    expect(deleted.statusCode).toBe(204);

    // Row (and therefore all financial/audit history) is preserved, just not signable-in.
    const after = await findUserById(db, created.json().user.id);
    expect(after).not.toBeNull();
    expect(after!.status).toBe('deleted');
    expect(after!.customer_id).toBe(customerId);

    const hidden = await app().inject({
      method: 'GET',
      url: `/api/v1/admin/users?search=${customerId}`,
      headers: { authorization: `Bearer ${superAdmin.token}` },
    });
    expect(hidden.json().users).toHaveLength(0);
  });

  it('refuses privileged changes from a plain admin and self-lockout from a super admin', async () => {
    const admin = await createStaff('admin');
    const superAdmin = await createStaff('super_admin');
    const { user } = await register('target@example.com');

    const roleChange = await app().inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${user.id}`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { role: 'admin' },
    });
    expect(roleChange.statusCode).toBe(403);

    const selfChange = await app().inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${superAdmin.id}`,
      headers: { authorization: `Bearer ${superAdmin.token}` },
      payload: { role: 'customer' },
    });
    expect(selfChange.statusCode).toBe(403);

    const customerAttempt = await app().inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: { authorization: `Bearer ${(await register('nosy@example.com')).token}` },
    });
    expect(customerAttempt.statusCode).toBe(403);
  });

  // --- Support mode ------------------------------------------------------------------------------

  it('switches into a customer account without touching their credentials, and restricts sensitive actions', async () => {
    const customer = await register('switch1@example.com');
    const admin = await createStaff('admin');
    const before = await findUserById(db, customer.user.id);

    const switched = await app().inject({
      method: 'POST',
      url: `/api/v1/admin/customers/${customer.user.id}/switch`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { reason: 'Investigating invoice #123' },
    });
    expect(switched.statusCode).toBe(201);
    const { token: delegated, supportSession } = switched.json();
    expect(supportSession.originalAdminId).toBe(admin.id);
    expect(supportSession.targetCustomerId).toBe(customer.user.customerId);

    // Customer's own credentials are untouched, and their existing session still works.
    const after = await findUserById(db, customer.user.id);
    expect(after!.password_hash).toBe(before!.password_hash);
    expect(after!.security_number_hash).toBe(before!.security_number_hash);
    const ownSession = await app().inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${customer.token}` },
    });
    expect(ownSession.statusCode).toBe(200);
    expect(ownSession.json().supportSession).toBeNull();

    // The delegated token acts as the customer and advertises the banner context.
    const me = await app().inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${delegated}` } });
    expect(me.json().user.id).toBe(customer.user.id);
    expect(me.json().supportSession.id).toBe(supportSession.id);
    expect(me.json().supportSession.originalAdminId).toBe(admin.id);

    // Restricted actions are refused and audited.
    for (const [url, payload] of [
      ['/api/v1/account/password', { currentPassword: 'correct-horse-battery', newPassword: 'another-long-password' }],
      ['/api/v1/account/security-number/reveal', { password: 'correct-horse-battery' }],
      ['/api/v1/account/security-number/change', { currentSecurityNumber: '1234', newSecurityNumber: '4321' }],
    ] as const) {
      const res = await app().inject({
        method: 'POST',
        url,
        headers: { authorization: `Bearer ${delegated}` },
        payload,
      });
      expect(res.statusCode).toBe(403);
    }
    const blocked = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit_logs WHERE action = 'admin_customer_account_switch_action_blocked'`
    );
    expect(Number(blocked.rows[0]!.count)).toBe(3);

    // Non-sensitive support work still works.
    const allowed = await app().inject({
      method: 'GET',
      url: '/api/v1/account/services',
      headers: { authorization: `Bearer ${delegated}` },
    });
    expect(allowed.statusCode).toBe(200);
  });

  it('ends a support session and immediately invalidates its token', async () => {
    const customer = await register('switch2@example.com');
    const admin = await createStaff('admin');

    const switched = await app().inject({
      method: 'POST',
      url: `/api/v1/admin/customers/${customer.user.id}/switch`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { reason: 'Support call' },
    });
    const { token: delegated, supportSession } = switched.json();

    const ended = await app().inject({
      method: 'POST',
      url: `/api/v1/admin/support-sessions/${supportSession.id}/end`,
      headers: { authorization: `Bearer ${delegated}` },
    });
    expect(ended.statusCode).toBe(204);

    const afterEnd = await app().inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${delegated}` },
    });
    expect(afterEnd.statusCode).toBe(401);

    // The customer's own session is unaffected.
    const own = await app().inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${customer.token}` },
    });
    expect(own.statusCode).toBe(200);

    const actions = await db.query<{ action: string }>(
      `SELECT action FROM audit_logs WHERE action LIKE 'admin_customer_account_switch%' ORDER BY created_at`
    );
    expect(actions.rows.map((r) => r.action)).toEqual([
      'admin_customer_account_switch_started',
      'admin_customer_account_switch_ended',
    ]);
  });

  it('tracks concurrent support sessions individually and expires them', async () => {
    const one = await register('switch3@example.com');
    const two = await register('switch4@example.com');
    const admin = await createStaff('admin');

    const sessions = [];
    for (const target of [one, two]) {
      const res = await app().inject({
        method: 'POST',
        url: `/api/v1/admin/customers/${target.user.id}/switch`,
        headers: { authorization: `Bearer ${admin.token}` },
        payload: { reason: 'Parallel support' },
      });
      expect(res.statusCode).toBe(201);
      sessions.push(res.json());
    }
    expect(sessions[0]!.supportSession.id).not.toBe(sessions[1]!.supportSession.id);

    const listed = await app().inject({
      method: 'GET',
      url: '/api/v1/admin/support-sessions',
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(listed.json().sessions).toHaveLength(2);

    // Expiry closes them out and kills the tokens.
    await db.query(`UPDATE admin_support_sessions SET expires_at = now() - interval '1 minute'`);
    const expiredNow = await app().inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${sessions[0]!.token}` },
    });
    expect(expiredNow.statusCode).toBe(401);

    const closed = await sweepExpiredSupportSessions(db);
    expect(closed).toBe(2);
    const rows = await db.query<{ ended_reason: string }>(`SELECT ended_reason FROM admin_support_sessions`);
    expect(rows.rows.every((r) => r.ended_reason === 'expired')).toBe(true);
  });

  it('refuses to switch into another administrator account', async () => {
    const admin = await createStaff('admin');
    const otherAdmin = await createStaff('super_admin');

    const res = await app().inject({
      method: 'POST',
      url: `/api/v1/admin/customers/${otherAdmin.id}/switch`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { reason: 'nope' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('keeps the security number service honest about expiry maths', async () => {
    const { user } = await register('svc@example.com');
    const record = (await findUserById(db, user.id))!;
    const status = await getStatus(db, record);
    expect(status.expired).toBe(false);
    expect(status.rotationHours).toBe(24);

    const hashed = await hashSecurityNumber(generateSecurityNumber());
    expect(hashed).toMatch(/^\$2[aby]\$/);
  });
});
