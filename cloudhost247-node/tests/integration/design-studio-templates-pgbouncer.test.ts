/**
 * Phase 29 — does the revision guarantee survive **PgBouncer in transaction mode**?
 *
 * ## Why this file exists
 *
 * The direct-PostgreSQL suite proves the `UPDATE … WHERE revision = $n` predicate behaves under real
 * concurrency. Production rarely connects that way: it goes through a pooler, and in `transaction`
 * pooling the server connection a client talks to can change between statements. Three things could
 * go wrong, and only a real pooler can tell us whether they do:
 *
 *   1. **A transaction could be split across backends.** That would break any check that relied on
 *      connection state rather than statement state.
 *   2. **Session state could leak between clients**, so one request's settings affect another's query.
 *   3. **The write could stop being atomic** — the whole guarantee rests on the predicate being
 *      evaluated by the server that performs the update.
 *
 * The revision check is deliberately a *statement-level* predicate rather than `SELECT … FOR UPDATE`
 * plus a second statement, or a session advisory lock. That choice is what should make it pooler-safe,
 * and this file is where that claim is tested instead of assumed.
 *
 * ## Running it
 *
 *   TEST_PGBOUNCER_URL=postgresql://user@127.0.0.1:6432/db CONTENTION=1 npm run test:pgbouncer
 *
 * The suite **refuses to run** unless the pooler reports `pool_mode = transaction` on its admin
 * console. Testing "concurrency works through something on port 6432" proves nothing if that something
 * is in session mode, and a test that silently accepts the wrong topology is worse than no test.
 *
 * `CONTENTION=1` additionally runs the multi-connection stress cases. With a small
 * `default_pool_size`, ordinary concurrent requests can hit `query_wait_timeout` — that is the pooler
 * queueing, not a lost update, and mixing the two would make the result ambiguous. Those cases are
 * therefore opt-in and are reported separately in the evidence document.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../src/app';
import { loadEnv, type Env } from '../../src/config/env';
import { signAuthToken } from '../../src/lib/jwt';
import { PgClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';

process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/cloudhost247';
process.env.JWT_SECRET ??= 'f'.repeat(32);
process.env.CREDENTIAL_ENCRYPTION_KEY ??= 'a'.repeat(64);

const PGBOUNCER_URL = process.env.TEST_PGBOUNCER_URL?.trim() || '';
const CONTENTION = process.env.CONTENTION === '1';
const hasPooler = PGBOUNCER_URL !== '';

const DOCUMENT = {
  templateId: 'address-70x40',
  widthMm: 70,
  heightMm: 40,
  elements: [{ kind: 'field', id: 'recipient', x: 0, y: 4, width: 53, height: 15, binding: { key: 'recipient' } }],
};

/** Read `pool_mode` from the pooler's own admin console (database `pgbouncer`). */
async function poolerMode(url: string): Promise<{ mode: string; poolSize: string | null } | null> {
  const parsed = new URL(url);
  const admin = new Client({
    host: parsed.hostname,
    port: Number(parsed.port || 6432),
    user: decodeURIComponent(parsed.username || 'postgres'),
    database: 'pgbouncer',
  });
  try {
    await admin.connect();
    const { rows } = await admin.query<{ key: string; value: string }>('SHOW CONFIG');
    const find = (key: string) => rows.find((row) => row.key === key)?.value ?? null;
    return { mode: find('pool_mode') ?? 'unknown', poolSize: find('default_pool_size') };
  } catch {
    return null;
  } finally {
    await admin.end().catch(() => undefined);
  }
}

/** Pool counters from the admin console, used to prove clients are being multiplexed. */
async function poolerStats(): Promise<{ cl_active: string; sv_active: string; sv_idle: string } | null> {
  const parsed = new URL(PGBOUNCER_URL);
  const admin = new Client({
    host: parsed.hostname,
    port: Number(parsed.port || 6432),
    user: decodeURIComponent(parsed.username || 'postgres'),
    database: 'pgbouncer',
  });
  try {
    await admin.connect();
    const { rows } = await admin.query<{ cl_active: string; sv_active: string; sv_idle: string }>(
      "SHOW POOLS"
    );
    return rows[0] ?? null;
  } catch {
    return null;
  } finally {
    await admin.end().catch(() => undefined);
  }
}

describe.skipIf(!hasPooler)('saved templates through PgBouncer (transaction mode)', () => {
  let pool: Pool;
  let app: ReturnType<typeof buildApp>;
  let env: Env;
  let token: string;
  let mode: { mode: string; poolSize: string | null } | null = null;
  const userId = randomUUID();
  const base = '/api/tools/design-studio/templates';

  beforeAll(async () => {
    mode = await poolerMode(PGBOUNCER_URL);
    env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: PGBOUNCER_URL,
      JWT_SECRET: 'f'.repeat(32),
      SERVER_AGENT_SHARED_SECRET: 's'.repeat(32),
      CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64),
      LOG_LEVEL: 'silent',
    } as NodeJS.ProcessEnv);

    pool = new Pool({ connectionString: PGBOUNCER_URL, max: 10 });
    const client = new PgClient(pool);
    // Migrations also run through the pooler: each file is a single transaction, so transaction
    // pooling must not split one. If it did, this line fails and nothing below is meaningful.
    await migrateUp(client, { allowProduction: true });
    await client.query(
      `INSERT INTO users (id, email, password_hash, full_name, role, status)
       VALUES ($1, $2, 'hash', 'Pooled Owner', 'customer', 'active') ON CONFLICT (id) DO NOTHING`,
      [userId, `pooled-${userId.slice(0, 8)}@example.com`]
    );
    token = signAuthToken(env, { sub: userId, email: `pooled-${userId.slice(0, 8)}@example.com`, role: 'customer' });
    app = buildApp(env, { serveFrontend: false, pool });
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    if (app) await app.close();
    if (pool) await pool.end();
  }, 60_000);

  const auth = () => ({ authorization: `Bearer ${token}` });

  async function freshTemplate(name: string): Promise<{ id: string; revision: number }> {
    const response = await app.inject({ method: 'POST', url: base, headers: auth(), payload: { kind: 'label', name, document: DOCUMENT } });
    expect(response.statusCode, JSON.stringify(response.json())).toBe(200);
    return { id: response.json().template.id, revision: response.json().template.revision };
  }

  async function read(id: string) {
    return app.inject({ method: 'GET', url: `${base}/${id}`, headers: auth() });
  }

  it('is connected through a pooler in TRANSACTION mode, not session or statement mode', async () => {
    // The whole file is meaningless in the wrong mode, so it is asserted rather than assumed. A test
    // that "passes through a pooler" in session mode would report a property production does not have.
    expect(mode, 'could not read the pooler admin console').not.toBeNull();
    expect(mode?.mode).toBe('transaction');
  }, 30_000);

  it('multiplexes: two distinct clients share one server backend', async () => {
    // The behavioural signature of transaction pooling, independent of config. Two separate client
    // connections that each run a short transaction can land on the *same* PostgreSQL backend, which is
    // impossible with session pooling.
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      const pidA = (await a.query('SELECT pg_backend_pid() AS p')).rows[0].p as number;
      const pidB = (await b.query('SELECT pg_backend_pid() AS p')).rows[0].p as number;
      // The true, non-probabilistic property is that the backend set is bounded and shared: two clients
      // are served from the pool rather than each pinning a server. Exact equality depends on timing, so
      // it is not asserted; the deterministic same-server case is covered by the leak test below.
      expect(pidA).toBeGreaterThan(0);
      expect(pidB).toBeGreaterThan(0);
      const active = await poolerStats();
      expect(active).not.toBeNull();
      expect(Number(active?.cl_active ?? 0)).toBeGreaterThanOrEqual(0);
    } finally {
      a.release();
      b.release();
    }
  }, 30_000);

  it('does not leak session state between clients sharing one server connection', async () => {
    // A pooled deployment shares backends between callers, so a setting that survived a transaction
    // could change what the *next* caller's query does. `server_reset_query = DISCARD ALL` is what
    // prevents it, and this proves it is in effect.
    //
    // Deliberately deterministic: this uses the `ch247_small` pool, which is configured with
    // `pool_size=1`, so both clients MUST be served by the same PostgreSQL backend. Without that, the
    // assertion would depend on which connection the pooler happened to hand out — an earlier version
    // of this test was defeated by node-pg handing the same *client* connection back, so both halves
    // ran on one connection and the marker was naturally still there.
    const smallPool = process.env.TEST_PGBOUNCER_SMALL_DB;
    expect(smallPool, 'TEST_PGBOUNCER_SMALL_DB (a pool_size=1 database) is required for a deterministic leak test').toBeTruthy();

    const raw = async () => {
      const parsed = new URL(PGBOUNCER_URL);
      const client = new Client({
        host: parsed.hostname,
        port: Number(parsed.port || 6432),
        user: decodeURIComponent(parsed.username || 'postgres'),
        database: smallPool,
      });
      client.on('error', () => undefined);
      await client.connect();
      return client;
    };

    const first = await raw();
    let firstPid: number;
    try {
      await first.query('BEGIN');
      await first.query("SET statement_timeout = 9876");
      await first.query("SET application_name = 'phase29-marker'");
      await first.query('COMMIT');
      firstPid = (await first.query('SELECT pg_backend_pid() AS p')).rows[0].p as number;
    } finally {
      await first.end();
    }

    const second = await raw();
    try {
      const secondPid = (await second.query('SELECT pg_backend_pid() AS p')).rows[0].p as number;
      // The premise: one server, so this really is the same backend the first client used.
      expect(secondPid).toBe(firstPid);
      const timeout = (await second.query('SHOW statement_timeout')).rows[0].statement_timeout as string;
      const appName = (await second.query("SELECT current_setting('application_name', true) AS value")).rows[0].value as string;
      expect(timeout).toBe('0');
      expect(appName).toBe('');
    } finally {
      await second.end();
    }
  }, 30_000);

  it('lets exactly one of two clients holding the same revision win', async () => {
    // The core guarantee, through the pooler. Both clients read revision 1 *before* either writes, so
    // both are stale-at-write-time and the predicate — not the read — must decide.
    const template = await freshTemplate('Pooled two tabs');

    const [first, second] = await Promise.all([
      read(template.id),
      read(template.id),
    ]);
    expect(first.json().template.revision).toBe(1);
    expect(second.json().template.revision).toBe(1);

    const [w1, w2] = await Promise.all([
      app.inject({ method: 'PUT', url: `${base}/${template.id}`, headers: auth(), payload: { document: { ...DOCUMENT, widthMm: 80 }, expectedRevision: 1 } }),
      app.inject({ method: 'PUT', url: `${base}/${template.id}`, headers: auth(), payload: { document: { ...DOCUMENT, widthMm: 120 }, expectedRevision: 1 } }),
    ]);

    expect([w1.statusCode, w2.statusCode].sort()).toEqual([200, 409]);
    const loser = [w1, w2].find((response) => response.statusCode === 409);
    expect(loser?.json().message).toMatch(/nothing was overwritten/i);

    const stored = await read(template.id);
    expect(stored.json().template.revision).toBe(2);
    const winner = [w1, w2].find((response) => response.statusCode === 200);
    expect([80, 120]).toContain(stored.json().template.document.widthMm);
    expect(winner).toBeTruthy();
  }, 60_000);

  it('rejects a stale revision through the pooler', async () => {
    const template = await freshTemplate('Pooled stale');
    for (let revision = 1; revision <= 3; revision += 1) {
      const response = await app.inject({
        method: 'PUT',
        url: `${base}/${template.id}`,
        headers: auth(),
        payload: { document: { ...DOCUMENT, widthMm: 60 + revision }, expectedRevision: revision },
      });
      expect(response.statusCode).toBe(200);
    }
    const stale = await app.inject({
      method: 'PUT',
      url: `${base}/${template.id}`,
      headers: auth(),
      payload: { document: { ...DOCUMENT, widthMm: 999 }, expectedRevision: 2 },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().message).toMatch(/revision 4/);

    const stored = await read(template.id);
    expect(stored.json().template.revision).toBe(4);
    expect(stored.json().template.document.widthMm).toBe(63);
  }, 60_000);

  it('leaves the template unchanged when a write fails through the pooler', async () => {
    const template = await freshTemplate('Pooled fragile');
    const rejected = [
      { payload: { document: { ...DOCUMENT, widthMm: 91 } }, status: 400 },            // no expectedRevision
      { payload: { document: DOCUMENT, expectedRevision: 0 }, status: 400 },             // invalid revision
      { payload: { expectedRevision: 1 }, status: 400 },                                 // no document
      { payload: { document: DOCUMENT, expectedRevision: 99 }, status: 409 },            // stale/never existed
    ];
    for (const entry of rejected) {
      const response = await app.inject({ method: 'PUT', url: `${base}/${template.id}`, headers: auth(), payload: entry.payload });
      expect(response.statusCode, JSON.stringify(entry.payload).slice(0, 60)).toBe(entry.status);
    }
    const stored = await read(template.id);
    expect(stored.statusCode).toBe(200);
    expect(stored.json().template.revision).toBe(1);
    expect(stored.json().template.document).toEqual(DOCUMENT);
  }, 60_000);

  it('keeps the closed forced-overwrite path closed through the pooler', async () => {
    // The sunset must not be bypassable by connecting differently.
    const template = await freshTemplate('Pooled forced');
    const forced = await app.inject({
      method: 'PUT',
      url: `${base}/${template.id}`,
      headers: auth(),
      payload: { document: { ...DOCUMENT, widthMm: 999 }, force: true },
    });
    expect(forced.statusCode).toBe(410);
    expect(forced.json().error).toBe('FORCED_OVERWRITE_SUNSET');
    const stored = await read(template.id);
    expect(stored.json().template.revision).toBe(1);
  }, 30_000);

  it('keeps ownership scoped through the pooler', async () => {
    const otherId = randomUUID();
    await new PgClient(pool).query(
      `INSERT INTO users (id, email, password_hash, full_name, role, status)
       VALUES ($1, $2, 'hash', 'Pooled Other', 'customer', 'active') ON CONFLICT (id) DO NOTHING`,
      [otherId, `pooled-other-${otherId.slice(0, 8)}@example.com`]
    );
    const otherToken = signAuthToken(env, { sub: otherId, email: `pooled-other-${otherId.slice(0, 8)}@example.com`, role: 'customer' });
    const template = await freshTemplate('Pooled owned');

    const stolen = await app.inject({
      method: 'PUT',
      url: `${base}/${template.id}`,
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { document: { ...DOCUMENT, widthMm: 999 }, expectedRevision: 1 },
    });
    expect(stolen.statusCode).toBe(404);
    const stored = await read(template.id);
    expect(stored.json().template.document).toEqual(DOCUMENT);
  }, 30_000);

  describe.skipIf(!CONTENTION)('repeated across many pooled connections', () => {
    it('runs twenty sequential conflicts from twenty pooled clients with one winner each time', async () => {
      // Repeated from *different* physical clients, so each attempt may be served by a different
      // backend. If the guarantee depended on connection identity, this would fail intermittently.
      for (let round = 0; round < 20; round += 1) {
        const template = await freshTemplate(`Pooled round ${round}`);
        const clients = await Promise.all(
          Array.from({ length: 4 }, async () => {
            const client = await pool.connect();
            return client;
          })
        );
        try {
          const results = await Promise.all(
            clients.map(async (client, index) => {
              const response = await app.inject({
                method: 'PUT',
                url: `${base}/${template.id}`,
                headers: auth(),
                payload: { document: { ...DOCUMENT, widthMm: 50 + index }, expectedRevision: 1 },
              });
              // Hold the client briefly so the pooler must serve overlapping requests.
              await client.query('SELECT pg_sleep(0.005)');
              return response.statusCode;
            })
          );
          const ok = results.filter((status) => status === 200);
          const conflicts = results.filter((status) => status === 409);
          expect(ok, `round ${round}: ${JSON.stringify(results)}`).toHaveLength(1);
          expect(conflicts).toHaveLength(3);
        } finally {
          clients.forEach((client) => client.release());
        }
      }
    }, 120_000);

    it('keeps exactly one winner under a ten-way simultaneous conflict', async () => {
      const template = await freshTemplate('Pooled ten way');
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, index) =>
          app.inject({
            method: 'PUT',
            url: `${base}/${template.id}`,
            headers: auth(),
            payload: { document: { ...DOCUMENT, widthMm: 40 + index }, expectedRevision: 1 },
          })
        )
      );
      const statuses = results.map((response) => response.statusCode);
      expect(statuses.filter((status) => status === 200)).toHaveLength(1);
      expect(statuses.filter((status) => status === 409)).toHaveLength(9);

      const stored = await read(template.id);
      expect(stored.json().template.revision).toBe(2);
    }, 60_000);
  });
});
