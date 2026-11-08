import { describe, expect, it } from 'vitest';
import { WhmcsClient } from '../../src/whmcs/client';
import { loadWhmcsConfig, type WhmcsConfig } from '../../src/whmcs/config';
import { WhmcsApiError, WhmcsSsoError } from '../../src/whmcs/errors';
import {
  SSO_DESTINATIONS,
  SSO_MAX_HANDOFFS_PER_WINDOW,
  SSO_TOKEN_TTL_SECONDS,
  assertSafeSsoRedirect,
  consumeHandoffBudget,
  isCanonicalAddress,
  normalizeEmail,
  findClientLink,
  isSsoDestination,
  linkWhmcsClient,
  mintSsoHandoff,
  normalizeClientRows,
  resolveClientByEmail,
  type WhmcsClientLink,
} from '../../src/whmcs/sso';
import type { Transport, TransportRequest } from '../../src/whmcs/transport';
import type { Queryable } from '../../src/db/types';

/**
 * B5.1 — the security properties of the identity bridge, tested without a WHMCS install.
 *
 * Three things are being protected here, and each has a test that fails loudly if the property is
 * lost:
 *
 *  1. the client id is only ever the one stored for the authenticated account (never a request
 *     value), so a hand-off cannot be aimed at another customer;
 *  2. the token that WHMCS mints is never persisted and never retried;
 *  3. the redirect URL is pinned to the configured WHMCS origin.
 */

const ENV = {
  WHMCS_BASE_URL: 'https://billing.example.com',
  WHMCS_API_IDENTIFIER: 'cloudhost247-site',
  WHMCS_API_SECRET: 'super-secret-value-that-must-not-leak',
} as NodeJS.ProcessEnv;

function config(overrides: Partial<WhmcsConfig> = {}): WhmcsConfig {
  const loaded = loadWhmcsConfig(ENV);
  if (!loaded.enabled) throw new Error('test env invalid');
  return { ...loaded.config, ...overrides };
}

function transportOf(
  handler: (request: TransportRequest) => { status: number; body: string } | Promise<{ status: number; body: string }>,
): Transport & { requests: TransportRequest[] } {
  const requests: TransportRequest[] = [];
  return {
    requests,
    async send(request) {
      requests.push(request);
      return handler(request);
    },
  };
}

function bodyOf(request: TransportRequest): URLSearchParams {
  return new URLSearchParams(request.body);
}

function ok(payload: Record<string, unknown>) {
  return { status: 200, body: JSON.stringify(payload) };
}

/** Minimal Queryable: records the SQL and answers with canned rows. */
function fakePool(handler: (sql: string, params: unknown[]) => { rows: unknown[] }): Queryable & { calls: Array<{ sql: string; params: unknown[] }> } {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  return {
    calls,
    async query<T>(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      return handler(sql, params) as { rows: T[] };
    },
  } as unknown as Queryable & { calls: Array<{ sql: string; params: unknown[] }> };
}

/**
 * A pool that answers the three statements `mintSsoHandoff` can issue: the rate-limit prune, the
 * atomic budget increment (whose `issued` value decides the verdict) and the audit insert.
 */
function handoffPool(issued = 1, onAuditInsert?: (params: unknown[]) => void) {
  return fakePool((sql, params) => {
    if (sql.includes('DELETE FROM whmcs_sso_rate_limits')) return { rows: [] };
    if (sql.includes('INSERT INTO whmcs_sso_rate_limits')) return { rows: [{ issued }] };
    if (sql.startsWith('INSERT INTO whmcs_sso_handoffs')) {
      onAuditInsert?.(params);
      return { rows: [] };
    }
    return { rows: [] };
  });
}

const LINK: WhmcsClientLink = {
  userId: '11111111-1111-4111-8111-111111111111',
  whmcsClientId: 4242,
  whmcsEmail: 'customer@example.com',
  linkMethod: 'verified-email-match',
  verifiedAt: '2026-01-01T00:00:00.000Z',
};

describe('WHMCS SSO destinations', () => {
  it('only accepts scopes that were chosen by name on this side', () => {
    expect(isSsoDestination('invoices')).toBe(true);
    expect(isSsoDestination('clientarea:invoices')).toBe(false);
    expect(isSsoDestination('sso:custom_redirect')).toBe(false);
    expect(isSsoDestination('__proto__')).toBe(false);
    expect(isSsoDestination('')).toBe(false);
    // The allow-list never contains a free-form path or an absolute URL.
    for (const value of Object.values(SSO_DESTINATIONS)) {
      expect(value.scope === null || /^clientarea:[a-z_]+$/.test(value.scope)).toBe(true);
    }
  });
});

describe('resolveClientByEmail', () => {
  it('accepts exactly one case-insensitive match and ignores unrelated search hits', async () => {
    const transport = transportOf(() =>
      ok({
        result: 'success',
        clients: {
          client: [
            { id: 7, email: 'someone-else@example.com' },
            { id: 4242, email: 'Customer@Example.com' },
          ],
        },
      }),
    );
    const client = new WhmcsClient({ config: config(), transport });

    const resolved = await resolveClientByEmail(client, 'customer@example.com');
    expect(resolved).toEqual({ clientId: 4242, email: 'customer@example.com' });
    const sent = bodyOf(transport.requests[0]!);
    expect(sent.get('action')).toBe('GetClients');
    expect(sent.get('search')).toBe('customer@example.com');
  });

  it('refuses when no client holds the address, instead of creating one', async () => {
    const transport = transportOf(() => ok({ result: 'success', clients: { client: [] } }));
    const client = new WhmcsClient({ config: config(), transport });

    await expect(resolveClientByEmail(client, 'missing@example.com')).rejects.toMatchObject({
      code: 'WHMCS_SSO_CLIENT_NOT_FOUND',
    });
    // Only a read was issued: no AddClient, no AddOrder.
    expect(transport.requests.map((r) => bodyOf(r).get('action'))).toEqual(['GetClients']);
  });

  it('refuses to guess between two clients sharing an address', async () => {
    const transport = transportOf(() =>
      ok({
        result: 'success',
        clients: {
          client: [
            { id: 1, email: 'shared@example.com' },
            { id: 2, email: 'SHARED@example.com' },
          ],
        },
      }),
    );
    const client = new WhmcsClient({ config: config(), transport });

    await expect(resolveClientByEmail(client, 'shared@example.com')).rejects.toMatchObject({
      code: 'WHMCS_SSO_CLIENT_AMBIGUOUS',
    });
  });

  it('normalises all three shapes WHMCS uses for a client collection', () => {
    expect(normalizeClientRows([{ id: 1 }])).toHaveLength(1);
    expect(normalizeClientRows({ client: [{ id: 1 }] })).toHaveLength(1);
    expect(normalizeClientRows({ client: { 0: { id: 1 }, 1: { id: 2 } } })).toHaveLength(2);
    expect(normalizeClientRows({ 0: { id: 1 } })).toHaveLength(1);
    expect(normalizeClientRows(null)).toEqual([]);
    expect(normalizeClientRows('nonsense')).toEqual([]);
  });
});

describe('linkWhmcsClient', () => {
  it('requires a verified CloudHost247 address before it will look anything up', async () => {
    const transport = transportOf(() => ok({ result: 'success', clients: { client: [] } }));
    const client = new WhmcsClient({ config: config(), transport });
    const pool = fakePool(() => ({ rows: [] }));

    await expect(
      linkWhmcsClient(pool, client, { userId: LINK.userId, email: 'customer@example.com', emailVerified: false }),
    ).rejects.toMatchObject({ code: 'WHMCS_SSO_NOT_VERIFIED' });
    expect(transport.requests).toHaveLength(0);
    expect(pool.calls).toHaveLength(0);
  });

  it('stores the resolved client id against the account, lower-cased', async () => {
    const transport = transportOf(() =>
      ok({ result: 'success', clients: { client: [{ id: 4242, email: 'Customer@Example.com' }] } }),
    );
    const client = new WhmcsClient({ config: config(), transport });
    let inserted: unknown[] | null = null;
    // The first read must miss (nothing linked yet); the read after the insert must hit.
    const pool = fakePool((sql, params) => {
      if (sql.startsWith('INSERT INTO whmcs_client_links')) {
        inserted = params;
        return { rows: [] };
      }
      if (sql.includes('FROM whmcs_client_links') && inserted) {
        return {
          rows: [
            {
              user_id: LINK.userId,
              whmcs_client_id: 4242,
              whmcs_email: 'customer@example.com',
              link_method: 'verified-email-match',
              verified_at: new Date('2026-01-01T00:00:00Z'),
            },
          ],
        };
      }
      return { rows: [] };
    });

    const link = await linkWhmcsClient(pool, client, {
      userId: LINK.userId,
      email: 'Customer@Example.com',
      emailVerified: true,
    });

    expect(inserted).toEqual([LINK.userId, 4242, 'customer@example.com']);
    expect(link.whmcsClientId).toBe(4242);
    expect(link.whmcsEmail).toBe('customer@example.com');
  });

  it('is idempotent: an already-linked account is not re-resolved', async () => {
    const transport = transportOf(() => ok({ result: 'success', clients: { client: [] } }));
    const client = new WhmcsClient({ config: config(), transport });
    const pool = fakePool((sql) =>
      sql.includes('FROM whmcs_client_links')
        ? {
            rows: [
              {
                user_id: LINK.userId,
                whmcs_client_id: 4242,
                whmcs_email: 'customer@example.com',
                link_method: 'verified-email-match',
                verified_at: new Date('2026-01-01T00:00:00Z'),
              },
            ],
          }
        : { rows: [] },
    );

    const link = await linkWhmcsClient(pool, client, {
      userId: LINK.userId,
      email: 'customer@example.com',
      emailVerified: true,
    });
    expect(link.whmcsClientId).toBe(4242);
    expect(transport.requests).toHaveLength(0);
  });

  it('refuses a look-alike address before it calls WHMCS at all', async () => {
    const transport = transportOf(() =>
      ok({ result: 'success', clients: { client: [{ id: 4242, email: 'customer@example.com' }] } }),
    );
    const client = new WhmcsClient({ config: config(), transport });
    const pool = fakePool(() => ({ rows: [] }));

    await expect(
      linkWhmcsClient(pool, client, {
        userId: LINK.userId,
        // Full-width characters that NFKC would fold onto the victim's address.
        email: 'ｃｕｓｔｏｍｅｒ＠ｅｘａｍｐｌｅ.com',
        emailVerified: true,
      }),
    ).rejects.toMatchObject({ code: 'WHMCS_SSO_EMAIL_NOT_CANONICAL' });
    expect(transport.requests).toHaveLength(0);
    expect(pool.calls).toHaveLength(0);
  });

  it('treats a lost race with itself as the same link, not as a conflict', async () => {
    const transport = transportOf(() =>
      ok({ result: 'success', clients: { client: [{ id: 4242, email: 'customer@example.com' }] } }),
    );
    const client = new WhmcsClient({ config: config(), transport });
    let inserted = false;
    const pool = fakePool((sql) => {
      if (sql.startsWith('INSERT INTO whmcs_client_links')) {
        inserted = true;
        const error = new Error('duplicate key value violates unique constraint') as Error & { code: string };
        error.code = '23505';
        throw error;
      }
      // The concurrent call for the *same* account already wrote the row.
      if (sql.includes('FROM whmcs_client_links') && inserted) {
        return {
          rows: [
            {
              user_id: LINK.userId,
              whmcs_client_id: 4242,
              whmcs_email: 'customer@example.com',
              link_method: 'verified-email-match',
              verified_at: new Date('2026-01-01T00:00:00Z'),
            },
          ],
        };
      }
      return { rows: [] };
    });

    const link = await linkWhmcsClient(pool, client, {
      userId: LINK.userId,
      email: 'customer@example.com',
      emailVerified: true,
    });
    expect(link.whmcsClientId).toBe(4242);
  });

  it('turns a unique violation into a conflict instead of overwriting the other link', async () => {
    const transport = transportOf(() =>
      ok({ result: 'success', clients: { client: [{ id: 4242, email: 'customer@example.com' }] } }),
    );
    const client = new WhmcsClient({ config: config(), transport });
    const pool = fakePool((sql) => {
      if (sql.startsWith('INSERT INTO whmcs_client_links')) {
        const error = new Error('duplicate key value violates unique constraint') as Error & { code: string };
        error.code = '23505';
        throw error;
      }
      return { rows: [] };
    });

    await expect(
      linkWhmcsClient(pool, client, { userId: LINK.userId, email: 'customer@example.com', emailVerified: true }),
    ).rejects.toMatchObject({ code: 'WHMCS_SSO_LINK_CONFLICT' });
  });
});

describe('assertSafeSsoRedirect', () => {
  it('accepts a URL on the configured origin', () => {
    const url = assertSafeSsoRedirect(config(), 'https://billing.example.com/sso.php?token=abc');
    expect(url).toBe('https://billing.example.com/sso.php?token=abc');
  });

  it.each([
    ['another host', 'https://evil.example.net/sso.php?token=abc'],
    ['a scheme downgrade', 'http://billing.example.com/sso.php?token=abc'],
    ['a sub-domain that only looks similar', 'https://billing.example.com.evil.net/sso.php'],
    ['a relative path', '/sso.php?token=abc'],
    ['embedded credentials', 'https://user:pass@billing.example.com/sso.php'],
  ])('refuses %s', (_label, url) => {
    expect(() => assertSafeSsoRedirect(config(), url)).toThrow(WhmcsSsoError);
    try {
      assertSafeSsoRedirect(config(), url);
    } catch (error) {
      expect((error as WhmcsSsoError).code).toBe('WHMCS_SSO_UNSAFE_REDIRECT');
    }
  });
});

describe('mintSsoHandoff', () => {
  it('mints a token for the linked client only, in read-only mode, and stores no token', async () => {
    const transport = transportOf((request) => {
      expect(bodyOf(request).get('client_id')).toBe('4242');
      return ok({
        result: 'success',
        access_token: 'sso-access-token-value',
        redirect_url: 'https://billing.example.com/sso.php?token=sso-access-token-value',
      });
    });
    const client = new WhmcsClient({ config: config({ mode: 'read-only' }), transport });
    const inserted: unknown[] = [];
    const pool = handoffPool(1, (params) => inserted.push(params));

    const result = await mintSsoHandoff(
      pool,
      client,
      { userId: LINK.userId, link: LINK, destination: 'invoices', sessionJti: 'jti-1' },
      { now: () => Date.parse('2026-05-01T12:00:00Z'), newId: () => '22222222-2222-4222-8222-222222222222' },
    );

    expect(result.url).toBe('https://billing.example.com/sso.php?token=sso-access-token-value');
    expect(result.ttlSeconds).toBe(SSO_TOKEN_TTL_SECONDS);
    expect(SSO_TOKEN_TTL_SECONDS).toBe(60);
    expect(result.expiresAt).toBe('2026-05-01T12:01:00.000Z');

    // The API call used the allow-listed scope, and carried nothing the caller could influence.
    const request = transport.requests[0]!;
    const body = bodyOf(request);
    expect(body.get('action')).toBe('CreateSsoToken');
    expect(body.get('destination')).toBe('clientarea:invoices');
    expect(body.get('client_id')).toBe('4242');
    expect([...body.keys()].sort()).toEqual(
      ['action', 'client_id', 'destination', 'identifier', 'responsetype', 'secret'].sort(),
    );

    // What was written is an audit row, not a credential.
    const stored = JSON.stringify(inserted);
    expect(stored).not.toContain('sso-access-token-value');
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toEqual([expect.any(String), LINK.userId, 4242, 'clientarea:invoices', 'jti-1', expect.any(Number)]);
  });

  it('omits the destination for the client-area home scope', async () => {
    const transport = transportOf(() =>
      ok({ result: 'success', redirect_url: 'https://billing.example.com/clientarea.php' }),
    );
    const client = new WhmcsClient({ config: config(), transport });
    const pool = handoffPool();

    await mintSsoHandoff(pool, client, { userId: LINK.userId, link: LINK, destination: 'clientarea' });
    expect(bodyOf(transport.requests[0]!).has('destination')).toBe(false);
  });

  it('refuses before touching WHMCS when the customer is over the hand-off budget', async () => {
    const transport = transportOf(() => ok({ result: 'success', redirect_url: 'https://billing.example.com/x' }));
    const client = new WhmcsClient({ config: config(), transport });
    const pool = handoffPool(SSO_MAX_HANDOFFS_PER_WINDOW + 1);

    await expect(
      mintSsoHandoff(pool, client, { userId: LINK.userId, link: LINK, destination: 'clientarea' }),
    ).rejects.toMatchObject({ code: 'WHMCS_SSO_RATE_LIMITED' });
    expect(transport.requests).toHaveLength(0);
  });

  it('maps WHMCS "SSO authentication blocked" onto its own code', async () => {
    const transport = transportOf(() => ({
      status: 200,
      body: JSON.stringify({ result: 'error', message: 'SSO authentication blocked for client 4242' }),
    }));
    const client = new WhmcsClient({ config: config(), transport });
    const pool = handoffPool();

    await expect(
      mintSsoHandoff(pool, client, { userId: LINK.userId, link: LINK, destination: 'clientarea' }),
    ).rejects.toMatchObject({ code: 'WHMCS_SSO_BLOCKED' });
  });

  it('reports a deleted WHMCS client as a stale link, not as an outage', async () => {
    const transport = transportOf(() => ({
      status: 200,
      body: JSON.stringify({ result: 'error', message: 'Invalid client_id' }),
    }));
    const client = new WhmcsClient({ config: config(), transport });
    const pool = handoffPool();

    await expect(
      mintSsoHandoff(pool, client, { userId: LINK.userId, link: LINK, destination: 'clientarea' }),
    ).rejects.toMatchObject({ code: 'WHMCS_SSO_LINK_STALE' });
  });

  it('never retries a token mint, even when the transport times out', async () => {
    let attempts = 0;
    const transport = transportOf(() => {
      attempts += 1;
      const error = new Error('timed out') as Error;
      error.name = 'TimeoutError';
      throw error;
    });
    const client = new WhmcsClient({
      config: config({ mode: 'full', maxAttempts: 3 }),
      transport,
      sleep: async () => undefined,
    });
    const pool = handoffPool();

    await expect(
      mintSsoHandoff(pool, client, { userId: LINK.userId, link: LINK, destination: 'clientarea' }),
    ).rejects.toBeInstanceOf(Error);
    expect(attempts).toBe(1);
  });

  it('rejects a redirect that leaves the configured origin', async () => {
    const transport = transportOf(() =>
      ok({ result: 'success', redirect_url: 'https://attacker.example/sso.php?token=abc' }),
    );
    const client = new WhmcsClient({ config: config(), transport });
    const pool = handoffPool();

    await expect(
      mintSsoHandoff(pool, client, { userId: LINK.userId, link: LINK, destination: 'clientarea' }),
    ).rejects.toMatchObject({ code: 'WHMCS_SSO_UNSAFE_REDIRECT' });
    // No audit row was written: the hand-off never happened, even though the budget was consumed.
    expect(pool.calls.filter((c) => c.sql.includes('INSERT INTO whmcs_sso_handoffs'))).toHaveLength(0);
  });

  it('keeps an upstream error message out of the customer-facing failure', async () => {
    const transport = transportOf(() => ({
      status: 200,
      body: JSON.stringify({ result: 'error', message: 'Gateway exploded near secret abcd1234' }),
    }));
    const client = new WhmcsClient({ config: config(), transport });
    const pool = handoffPool();

    try {
      await mintSsoHandoff(pool, client, { userId: LINK.userId, link: LINK, destination: 'clientarea' });
      throw new Error('expected a failure');
    } catch (error) {
      expect(error).toBeInstanceOf(WhmcsApiError);
      const { safeCustomerMessage } = await import('../../src/whmcs/errors');
      expect(safeCustomerMessage(error)).not.toContain('secret');
      expect(safeCustomerMessage(error)).not.toContain('abcd1234');
    }
  });
});

describe('consumeHandoffBudget', () => {
  function budgetPool(issued: number | string) {
    return fakePool((sql) =>
      sql.includes('INSERT INTO whmcs_sso_rate_limits') ? { rows: [{ issued }] } : { rows: [] },
    );
  }

  it('increments and reads in one statement, so concurrent instances cannot both read "9"', async () => {
    const pool = budgetPool(4);
    const budget = await consumeHandoffBudget(pool, LINK.userId, Date.parse('2026-05-01T12:00:00Z'));

    expect(budget).toMatchObject({ allowed: true, used: 4, limit: SSO_MAX_HANDOFFS_PER_WINDOW });
    const increment = pool.calls.find((call) => call.sql.includes('INSERT INTO whmcs_sso_rate_limits'))!;
    // The whole point: an UPSERT that returns the post-increment value. No SELECT-then-INSERT.
    expect(increment.sql).toContain('ON CONFLICT');
    expect(increment.sql).toContain('RETURNING issued');
    expect(pool.calls.some((call) => /SELECT count\(\*\)/i.test(call.sql))).toBe(false);
  });

  it('puts every request in a whole-number window bucket', async () => {
    const windowStart = Date.parse('2026-05-01T12:05:00Z');
    const pool = budgetPool(1);
    const budget = await consumeHandoffBudget(pool, LINK.userId, windowStart + 61_000);
    expect(budget.windowStart).toBe(new Date(windowStart).toISOString());
    const increment = pool.calls.find((call) => call.sql.includes('INSERT INTO whmcs_sso_rate_limits'))!;
    expect(increment.params[1]).toBe(windowStart);
  });

  it('refuses the request that goes over the limit, and keeps counting', async () => {
    const allowed = await consumeHandoffBudget(budgetPool(SSO_MAX_HANDOFFS_PER_WINDOW), LINK.userId, 0);
    expect(allowed.allowed).toBe(true);

    const refused = await consumeHandoffBudget(budgetPool(SSO_MAX_HANDOFFS_PER_WINDOW + 1), LINK.userId, 0);
    expect(refused.allowed).toBe(false);
    expect(refused.used).toBe(SSO_MAX_HANDOFFS_PER_WINDOW + 1);
  });
});

describe('email canonicalisation', () => {
  it('normalises case and folds look-alike forms to one comparable value', () => {
    expect(normalizeEmail(' Customer@Example.COM ')).toBe('customer@example.com');
    expect(normalizeEmail('ｃｕｓｔｏｍｅｒ＠ｅｘａｍｐｌｅ.com')).toBe('customer@example.com');
    expect(normalizeEmail('cust\u200Bomer@example.com'.replace('\\u200B', '\u200B'))).toBe('customer@example.com');
  });

  it('treats a plain address as canonical, whatever its capitalisation', () => {
    expect(isCanonicalAddress('customer@example.com')).toBe(true);
    expect(isCanonicalAddress(' Customer@Example.COM ')).toBe(true);
  });

  it('refuses an address that only matches after normalising look-alike characters', () => {
    expect(isCanonicalAddress('ｃｕｓｔｏｍｅｒ＠ｅｘａｍｐｌｅ.com')).toBe(false);
    expect(isCanonicalAddress('cust\u200Bomer@example.com'.replace('\\u200B', '\u200B'))).toBe(false);
    expect(isCanonicalAddress('   ')).toBe(false);
  });
});

describe('findClientLink', () => {
  it('returns null for an account that has never been connected', async () => {
    const pool = fakePool(() => ({ rows: [] }));
    expect(await findClientLink(pool, LINK.userId)).toBeNull();
  });
});
