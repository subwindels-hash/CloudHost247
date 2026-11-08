import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { signAuthToken } from '../../src/lib/jwt';
import { hashPassword } from '../../src/lib/password';
import { WhmcsClient } from '../../src/whmcs/client';
import { loadWhmcsConfig, type WhmcsConfig } from '../../src/whmcs/config';
import type { Transport, TransportRequest } from '../../src/whmcs/transport';

/**
 * B5.1 end-to-end, against a real embedded Postgres and a scripted WHMCS.
 *
 * What is actually being proven here (not asserted by comment):
 *  - a customer cannot obtain a hand-off for a WHMCS client that is not linked to *their* account,
 *    even when they put a client id in the request body;
 *  - linking requires a verified address and an exact, unambiguous email match;
 *  - the hand-off is refused without MFA when the deployment requires it, and refused entirely
 *    from inside an admin support session;
 *  - the token is returned once, marked `no-store`, and never written to the database.
 */

const WHMCS_ENV = {
  WHMCS_BASE_URL: 'https://billing.example.com',
  WHMCS_API_IDENTIFIER: 'cloudhost247-site',
  WHMCS_API_SECRET: 'super-secret-value-that-must-not-leak',
} as NodeJS.ProcessEnv;

const SSO_URL = 'https://billing.example.com/sso.php?token=one-time-token-value';

describe('WHMCS identity API (/api/v1/account/whmcs)', () => {
  let db: PGlite;
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
    JWT_SECRET: 'g'.repeat(32),
  } as NodeJS.ProcessEnv);

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
  });

  afterEach(async () => {
    await db.close();
  });

  /** Scripted WHMCS: answers `GetClients` from a fixed client list and `CreateSsoToken` with a URL. */
  function whmcs(overrides: { clients?: Array<{ id: number; email: string }>; ssoUrl?: string } = {}) {
    const clients = overrides.clients ?? [{ id: 4242, email: 'customer@example.com' }];
    const requests: TransportRequest[] = [];
    const transport: Transport = {
      async send(request) {
        requests.push(request);
        const body = new URLSearchParams(request.body);
        if (body.get('action') === 'GetClients') {
          return {
            status: 200,
            body: JSON.stringify({ result: 'success', clients: { client: clients } }),
          };
        }
        if (body.get('action') === 'CreateSsoToken') {
          return {
            status: 200,
            body: JSON.stringify({
              result: 'success',
              access_token: 'one-time-token-value',
              redirect_url: overrides.ssoUrl ?? SSO_URL,
            }),
          };
        }
        return { status: 200, body: JSON.stringify({ result: 'error', message: 'unexpected action' }) };
      },
    };
    const loaded = loadWhmcsConfig(WHMCS_ENV);
    if (!loaded.enabled) throw new Error('test env invalid');
    const config: WhmcsConfig = { ...loaded.config, mode: 'read-only' };
    return {
      requests,
      deps: {
        whmcsConfig: { enabled: true as const, config, reason: null as string | null },
        whmcsClient: new WhmcsClient({ config, transport }),
      },
    };
  }

  function buildTestApp(deps: Parameters<typeof buildApp>[1]['whmcs'] = undefined) {
    return buildApp(env, { serveFrontend: false, pool: db, whmcs: deps });
  }

  async function createCustomer(options: {
    email?: string;
    verified?: boolean;
    mfa?: boolean;
    role?: 'customer' | 'admin';
  } = {}): Promise<{ userId: string; token: string; email: string }> {
    const email = options.email ?? `c-${randomUUID()}@example.com`;
    const userId = randomUUID();
    await db.query(
      `INSERT INTO users (id, email, password_hash, full_name, role, username, customer_id, email_verified_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        userId,
        email,
        await hashPassword('correct-horse-battery'),
        'Test Customer',
        options.role ?? 'customer',
        `u${userId.replace(/-/g, '').slice(0, 12)}`,
        String(Math.floor(Math.random() * 900_000_000) + 100_000_000),
        options.verified === false ? null : new Date(),
      ],
    );
    if (options.mfa) {
      await db.query(
        `INSERT INTO user_mfa_totp (user_id, secret_encrypted, confirmed_at) VALUES ($1, 'encrypted-secret', now())`,
        [userId],
      );
    }
    return { userId, token: signAuthToken(env, { sub: userId, role: options.role ?? 'customer', email }), email };
  }

  function link(userId: string, clientId = 4242, email = 'customer@example.com') {
    return db.query(
      `INSERT INTO whmcs_client_links (user_id, whmcs_client_id, whmcs_email) VALUES ($1, $2, $3)`,
      [userId, clientId, email],
    );
  }

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  it('rejects every route without a session', async () => {
    const app = buildTestApp();
    const calls: Array<{ method: 'GET' | 'POST' | 'DELETE'; url: string; payload?: unknown }> = [
      { method: 'GET', url: '/api/v1/account/whmcs' },
      { method: 'POST', url: '/api/v1/account/whmcs/link' },
      { method: 'DELETE', url: '/api/v1/account/whmcs/link', payload: { password: 'x' } },
      { method: 'POST', url: '/api/v1/account/whmcs/sso', payload: { destination: 'invoices' } },
    ];
    for (const call of calls) {
      const response = await app.inject(call as never);
      expect(response.statusCode, `${call.method} ${call.url}`).toBe(401);
    }
  });

  it('reports an honest unavailable state when WHMCS is not configured', async () => {
    const customer = await createCustomer();
    const app = buildTestApp({ whmcsConfig: { enabled: false, config: null, reason: 'WHMCS is not connected: WHMCS_BASE_URL not set' } });

    const status = await app.inject({ method: 'GET', url: '/api/v1/account/whmcs', headers: auth(customer.token) });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ configured: false, linked: false, mode: null });

    const attempt = await app.inject({
      method: 'POST',
      url: '/api/v1/account/whmcs/sso',
      headers: auth(customer.token),
      payload: { destination: 'invoices' },
    });
    expect(attempt.statusCode).toBe(503);
    // No queue, no stub, no invented session: just the reason, addressed to an operator.
    expect(attempt.json().message).toContain('WHMCS');
  });

  it('links a verified account whose address matches exactly one WHMCS client', async () => {
    const customer = await createCustomer({ email: 'customer@example.com' });
    const fake = whmcs();
    const app = buildTestApp(fake.deps);

    const status = await app.inject({ method: 'GET', url: '/api/v1/account/whmcs', headers: auth(customer.token) });
    expect(status.json()).toMatchObject({ configured: true, linked: false, mode: 'read-only' });

    const linked = await app.inject({ method: 'POST', url: '/api/v1/account/whmcs/link', headers: auth(customer.token) });
    expect(linked.statusCode).toBe(200);
    expect(linked.json()).toMatchObject({
      linked: true,
      link: { clientId: 4242, email: 'customer@example.com', method: 'verified-email-match' },
    });

    // The link survives a second call (idempotent) and is what a later hand-off will use.
    const again = await app.inject({ method: 'POST', url: '/api/v1/account/whmcs/link', headers: auth(customer.token) });
    expect(again.statusCode).toBe(200);
    expect(again.json().link.clientId).toBe(4242);

    const rows = await db.query<{ whmcs_client_id: number }>(
      `SELECT whmcs_client_id FROM whmcs_client_links WHERE user_id = $1`,
      [customer.userId],
    );
    expect(rows.rows).toHaveLength(1);
  });

  it('refuses to link an unverified account, or an address nobody bills under', async () => {
    const unverified = await createCustomer({ email: 'unverified@example.com', verified: false });
    const fake = whmcs({ clients: [{ id: 9, email: 'unverified@example.com' }] });
    const app = buildTestApp(fake.deps);

    const blocked = await app.inject({ method: 'POST', url: '/api/v1/account/whmcs/link', headers: auth(unverified.token) });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().message).toContain('Verify your email');
    expect(fake.requests).toHaveLength(0);

    const stranger = await createCustomer({ email: 'nobody@example.com' });
    const missing = await app.inject({ method: 'POST', url: '/api/v1/account/whmcs/link', headers: auth(stranger.token) });
    expect(missing.statusCode).toBe(404);

    // Nothing was created on either side.
    const rows = await db.query(`SELECT user_id FROM whmcs_client_links`);
    expect(rows.rows).toHaveLength(0);
  });

  it('never lets one WHMCS client belong to two accounts', async () => {
    const first = await createCustomer({ email: 'customer@example.com' });
    const second = await createCustomer({ email: 'other@example.com' });
    // A staff-assisted link already sits on the second account (the table is the record of who owns
    // the client). Two SPA accounts can never share an email, so this — not a form submission — is
    // the realistic collision, and it must still end in a refusal rather than an overwrite.
    await link(second.userId, 4242, 'customer@example.com');
    const app = buildTestApp(whmcs().deps);

    const conflict = await app.inject({
      method: 'POST',
      url: '/api/v1/account/whmcs/link',
      headers: auth(first.token),
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().message).toMatch(/already connected/i);

    const rows = await db.query<{ user_id: string }>(`SELECT user_id FROM whmcs_client_links`);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.user_id).toBe(second.userId);
  });

  it('mints a no-store hand-off for the linked client only, ignoring a client id from the caller', async () => {
    const customer = await createCustomer({ email: 'customer@example.com', mfa: true });
    await link(customer.userId, 4242);
    const fake = whmcs();
    const app = buildTestApp(fake.deps);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/account/whmcs/sso',
      headers: auth(customer.token),
      // A caller-supplied client id must be ignored entirely — there is no such parameter.
      payload: { destination: 'invoices', client_id: 999, destination_scope: 'sso:custom_redirect' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.url).toBe(SSO_URL);
    expect(body.destination).toBe('invoices');
    expect(body.ttlSeconds).toBe(60);
    expect(response.headers['cache-control']).toBe('no-store');

    const tokenRequest = fake.requests.find((r) => new URLSearchParams(r.body).get('action') === 'CreateSsoToken');
    expect(tokenRequest).toBeDefined();
    const sent = new URLSearchParams(tokenRequest!.body);
    expect(sent.get('client_id')).toBe('4242');
    expect(sent.get('destination')).toBe('clientarea:invoices');

    // The credential is not persisted; the audit row is.
    const handoffs = await db.query<{ id: string; destination: string }>(
      `SELECT id, destination FROM whmcs_sso_handoffs WHERE user_id = $1`,
      [customer.userId],
    );
    expect(handoffs.rows).toHaveLength(1);
    expect(handoffs.rows[0]!.destination).toBe('clientarea:invoices');
    const dump = await db.query<{ blob: string }>(`SELECT row_to_json(h)::text AS blob FROM whmcs_sso_handoffs h`);
    expect(dump.rows[0]!.blob).not.toContain('one-time-token-value');
  });

  it('refuses a hand-off for an account that is not linked', async () => {
    const customer = await createCustomer({ mfa: true });
    const app = buildTestApp(whmcs().deps);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/account/whmcs/sso',
      headers: auth(customer.token),
      payload: { destination: 'invoices' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().message).toContain('Connect your billing account');
  });

  it('refuses a hand-off without MFA when the deployment requires it', async () => {
    const noMfa = await createCustomer({ email: 'customer@example.com' });
    await link(noMfa.userId, 4242);
    const fake = whmcs();
    const app = buildTestApp(fake.deps);

    const status = await app.inject({ method: 'GET', url: '/api/v1/account/whmcs', headers: auth(noMfa.token) });
    expect(status.json()).toMatchObject({ ssoRequiresMfa: true, mfaEnabled: false });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/account/whmcs/sso',
      headers: auth(noMfa.token),
      payload: { destination: 'clientarea' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().message).toContain('two-factor');
    // Nothing was sent to WHMCS: the second factor is enforced before a token exists.
    expect(fake.requests).toHaveLength(0);
  });

  it('refuses a redirect that leaves the configured WHMCS origin', async () => {
    const customer = await createCustomer({ mfa: true });
    await link(customer.userId, 4242);
    const app = buildTestApp(whmcs({ ssoUrl: 'https://attacker.example/sso.php?token=stolen' }).deps);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/account/whmcs/sso',
      headers: auth(customer.token),
      payload: { destination: 'clientarea' },
    });
    expect(response.statusCode).toBe(502);
    expect(JSON.stringify(response.json())).not.toContain('attacker.example');
  });

  it('rejects an unknown destination instead of forwarding it to WHMCS', async () => {
    const customer = await createCustomer({ mfa: true });
    await link(customer.userId, 4242);
    const fake = whmcs();
    const app = buildTestApp(fake.deps);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/account/whmcs/sso',
      headers: auth(customer.token),
      payload: { destination: 'sso:custom_redirect' },
    });
    expect(response.statusCode).toBe(400);
    expect(fake.requests).toHaveLength(0);
  });

  it('throttles repeated hand-offs for the same account', async () => {
    const customer = await createCustomer({ mfa: true });
    await link(customer.userId, 4242);
    const app = buildTestApp(whmcs().deps);

    for (let i = 0; i < 10; i += 1) {
      const ok = await app.inject({
        method: 'POST',
        url: '/api/v1/account/whmcs/sso',
        headers: auth(customer.token),
        payload: { destination: 'clientarea' },
      });
      expect(ok.statusCode, `hand-off ${i + 1}`).toBe(200);
    }

    const limited = await app.inject({
      method: 'POST',
      url: '/api/v1/account/whmcs/sso',
      headers: auth(customer.token),
      payload: { destination: 'clientarea' },
    });
    expect(limited.statusCode).toBe(429);
  });

  it('refuses to mint a hand-off from inside an admin support session', async () => {
    const customer = await createCustomer({ email: 'customer@example.com', mfa: true });
    await link(customer.userId, 4242);
    const admin = await createCustomer({ role: 'admin' });
    const fake = whmcs();
    const app = buildTestApp(fake.deps);

    const switched = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/customers/${customer.userId}/switch`,
      headers: auth(admin.token),
      payload: { reason: 'Support ticket about billing' },
    });
    expect(switched.statusCode).toBe(201);
    const delegated = switched.json().token as string;

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/account/whmcs/sso',
      headers: auth(delegated),
      payload: { destination: 'invoices' },
    });
    expect(response.statusCode).toBe(403);
    expect(fake.requests).toHaveLength(0);
  });

  it('disconnects only after the correct password, and stops minting afterwards', async () => {
    const customer = await createCustomer({ mfa: true });
    await link(customer.userId, 4242);
    const app = buildTestApp(whmcs().deps);

    const wrong = await app.inject({
      method: 'DELETE',
      url: '/api/v1/account/whmcs/link',
      headers: auth(customer.token),
      payload: { password: 'not-the-password' },
    });
    expect(wrong.statusCode).toBe(403);
    expect((await db.query(`SELECT 1 FROM whmcs_client_links`)).rows).toHaveLength(1);

    const removed = await app.inject({
      method: 'DELETE',
      url: '/api/v1/account/whmcs/link',
      headers: auth(customer.token),
      payload: { password: 'correct-horse-battery' },
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({ linked: false });
    expect((await db.query(`SELECT 1 FROM whmcs_client_links`)).rows).toHaveLength(0);

    const after = await app.inject({
      method: 'POST',
      url: '/api/v1/account/whmcs/sso',
      headers: auth(customer.token),
      payload: { destination: 'clientarea' },
    });
    expect(after.statusCode).toBe(409);
  });

  it('never exposes a password field, even if the identity payload grows one', async () => {
    const customer = await createCustomer({ mfa: true });
    await link(customer.userId, 4242);
    const app = buildTestApp(whmcs().deps);

    const responses = await Promise.all([
      app.inject({ method: 'GET', url: '/api/v1/account/whmcs', headers: auth(customer.token) }),
      app.inject({ method: 'POST', url: '/api/v1/account/whmcs/link', headers: auth(customer.token) }),
    ]);
    for (const response of responses) {
      const text = JSON.stringify(response.json()).toLowerCase();
      expect(text).not.toContain('password');
      expect(text).not.toContain('secret');
      expect(text).not.toContain('correct-horse-battery');
    }
  });
});
