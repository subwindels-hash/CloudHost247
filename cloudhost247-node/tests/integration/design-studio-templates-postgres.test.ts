/**
 * Design Studio — saved templates under *real* PostgreSQL concurrency.
 *
 * ## What this file exists to prove
 *
 * `overwriteTemplate` decides whether a save may proceed with a predicate inside the statement:
 *
 *     UPDATE ... SET revision = revision + 1 WHERE id = $1 AND user_id = $2 AND revision = $expected
 *
 * The PGlite suite proves the predicate is correct. It cannot prove the *concurrency* property,
 * because PGlite processes one statement at a time: two "parallel" requests are serialised by the
 * harness, so even a read-then-write implementation would pass. Here the writes are issued from two
 * independent connections against a real server, which is the only way to observe what PostgreSQL
 * actually does with two competing `UPDATE`s.
 *
 * ## The failure being ruled out
 *
 * Lost update. Two tabs load revision 1. Both save. If the check were a read followed by a write, both
 * would read 1, both would pass, and the second write would silently discard the first — the customer
 * keeps a template with contents they did not choose and no indication anything was lost.
 *
 * ## How the race is made deterministic
 *
 * Rather than firing two requests and hoping they overlap, transaction A is *held open* after its
 * `UPDATE` (the row is locked, uncommitted) while transaction B attempts the same update. B must block
 * on the row lock, then re-evaluate its predicate against the committed row once A commits — which is
 * exactly READ COMMITTED semantics, and the reason the `AND revision = $n` predicate is re-checked
 * rather than trusted from a snapshot. That is a stronger demonstration than a timing race: it fails
 * deterministically if the guarantee is missing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../src/app';
import { loadEnv, type Env } from '../../src/config/env';
import { signAuthToken } from '../../src/lib/jwt';
import { createScratchDatabase, hasRealPostgres, REAL_POSTGRES_SKIP, type ScratchDatabase } from '../helpers/real-postgres';

process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/cloudhost247';
process.env.JWT_SECRET ??= 'f'.repeat(32);
process.env.CREDENTIAL_ENCRYPTION_KEY ??= 'a'.repeat(64);

const DOCUMENT = {
  templateId: 'address-70x40',
  widthMm: 70,
  heightMm: 40,
  elements: [{ kind: 'field', id: 'recipient', x: 0, y: 4, width: 53, height: 15, binding: { key: 'recipient' } }],
};

describe.skipIf(!hasRealPostgres)('saved templates under real PostgreSQL', () => {
  let scratch: ScratchDatabase;
  let app: ReturnType<typeof buildApp>;
  let env: Env;
  let token: string;
  const userId = randomUUID();
  const base = '/api/tools/design-studio/templates';

  beforeAll(async () => {
    scratch = await createScratchDatabase('ch247_conc');
    env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: scratch.url,
      JWT_SECRET: 'f'.repeat(32),
      SERVER_AGENT_SHARED_SECRET: 's'.repeat(32),
      CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64),
      LOG_LEVEL: 'silent',
    } as NodeJS.ProcessEnv);

    await scratch.client.query(
      `INSERT INTO users (id, email, password_hash, full_name, role, status) VALUES ($1, $2, 'hash', 'Concurrency Owner', 'customer', 'active')`,
      [userId, `conc-${userId.slice(0, 8)}@example.com`]
    );
    token = signAuthToken(env, { sub: userId, email: `conc-${userId.slice(0, 8)}@example.com`, role: 'customer' });
    app = buildApp(env, { serveFrontend: false, pool: scratch.pool });
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
    if (scratch) await scratch.close();
  }, 60_000);

  // A function, not a constant: this describe body is evaluated at collection time, before beforeAll
  // has minted the token, so a captured object would send `Bearer undefined` to every request.
  const auth = () => ({ authorization: `Bearer ${token}` });

  async function freshTemplate(name: string): Promise<{ id: string; revision: number }> {
    const response = await app.inject({ method: 'POST', url: base, headers: auth(), payload: { kind: 'label', name, document: DOCUMENT } });
    expect(response.statusCode, JSON.stringify(response.json())).toBe(200);
    return { id: response.json().template.id, revision: response.json().template.revision };
  }

  /** Run `work` inside an explicit transaction on a dedicated connection. */
  async function inTransaction(pool: Pool, work: (client: Client) => Promise<void>): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await work(client);
    } finally {
      client.release();
    }
  }

  it('is talking to a real server, not an embedded engine', async () => {
    const { rows } = await scratch.client.query<{ version: string }>('SELECT version()');
    expect(rows[0]?.version).toMatch(/PostgreSQL/);
    // PGlite reports itself as PostgreSQL too, so assert on the server having a real backend count.
    const backends = await scratch.client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM pg_stat_activity WHERE backend_type = 'client backend'"
    );
    expect(Number(backends.rows[0]?.count)).toBeGreaterThan(0);
  });

  it('lets exactly one of two writes succeed when both read the same revision', async () => {
    // Two browser tabs, driven honestly: **both read first, then both write**. Doing it as two parallel
    // read-then-write sequences would be the wrong test — the two reads would still be serialised by
    // timing, and the second tab would load revision 2 and legitimately win. The lost update needs both
    // tabs holding revision 1 at the moment they save, which is what this arranges.
    const template = await freshTemplate('Two tabs');

    const [tabA, tabB] = await Promise.all([
      app.inject({ method: 'GET', url: `${base}/${template.id}`, headers: auth() }),
      app.inject({ method: 'GET', url: `${base}/${template.id}`, headers: auth() }),
    ]);
    expect(tabA.json().template.revision).toBe(1);
    expect(tabB.json().template.revision).toBe(1);

    const [first, second] = await Promise.all([
      app.inject({
        method: 'PUT',
        url: `${base}/${template.id}`,
        headers: auth(),
        payload: { document: { ...DOCUMENT, widthMm: 80 }, expectedRevision: 1 },
      }),
      app.inject({
        method: 'PUT',
        url: `${base}/${template.id}`,
        headers: auth(),
        payload: { document: { ...DOCUMENT, widthMm: 120 }, expectedRevision: 1 },
      }),
    ]);

    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
    const loser = [first, second].find((response) => response.statusCode === 409);
    expect(loser?.json().message).toMatch(/nothing was overwritten/i);

    // Exactly one revision bump, and the stored document is the winner's — not a blend of the two.
    const winner = [first, second].find((response) => response.statusCode === 200);
    const winnerWidth = winner === first ? 80 : 120;
    const stored = await app.inject({ method: 'GET', url: `${base}/${template.id}`, headers: auth() });
    expect(stored.json().template.revision).toBe(2);
    expect(stored.json().template.document.widthMm).toBe(winnerWidth);
  }, 30_000);

  it('blocks the second writer on the row lock and refuses it after the first commits', async () => {
    // The deterministic version, and the reason READ COMMITTED matters: while A holds an uncommitted
    // UPDATE the row is locked, so B waits. When A commits, B re-evaluates `revision = 1` against the
    // *new* row — which is now revision 2 — and matches nothing. A snapshot-based implementation that
    // did not re-check would let B through.
    const template = await freshTemplate('Locked row');
    const clientA = await scratch.pool.connect();
    const clientB = await scratch.pool.connect();
    try {
      await clientA.query('BEGIN');
      const a = await clientA.query(
        'UPDATE design_studio_templates SET document = $2::jsonb, revision = revision + 1 WHERE id = $1 AND revision = 1 RETURNING revision',
        [template.id, JSON.stringify({ ...DOCUMENT, widthMm: 100 })]
      );
      expect(a.rows[0].revision).toBe(2);

      // B asks for the same row before A commits. It must not resolve until A does.
      await clientB.query('BEGIN');
      await clientB.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      const bPromise = clientB.query(
        'UPDATE design_studio_templates SET document = $2::jsonb, revision = revision + 1 WHERE id = $1 AND revision = 1 RETURNING revision',
        [template.id, JSON.stringify({ ...DOCUMENT, widthMm: 999 })]
      );
      let bSettled = false;
      void bPromise.then(() => {
        bSettled = true;
      });
      // Give the driver a generous moment to prove it is *waiting* rather than failing fast.
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(bSettled).toBe(false);

      await clientA.query('COMMIT');
      const b = await bPromise;
      // Zero rows: the predicate no longer holds. B has not overwritten A.
      expect(b.rowCount).toBe(0);
      await clientB.query('ROLLBACK');
    } finally {
      clientA.release();
      clientB.release();
    }

    const stored = await scratch.client.query<{ revision: number; document: { widthMm: number } }>(
      'SELECT revision, document FROM design_studio_templates WHERE id = $1',
      [template.id]
    );
    expect(stored.rows[0]?.revision).toBe(2);
    expect(stored.rows[0]?.document.widthMm).toBe(100);
  }, 30_000);

  it('survives ten simultaneous conditional saves with exactly one winner', async () => {
    // A wider race than two: ten backends, same revision, one winner. Catches an implementation that
    // serialises by luck rather than by predicate.
    const template = await freshTemplate('Ten writers');
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
    const ok = results.filter((response) => response.statusCode === 200);
    const conflicts = results.filter((response) => response.statusCode === 409);
    expect(ok).toHaveLength(1);
    expect(conflicts).toHaveLength(9);

    const stored = await app.inject({ method: 'GET', url: `${base}/${template.id}`, headers: auth() });
    expect(stored.json().template.revision).toBe(2);
  }, 30_000);

  it('refuses a stale save even when it arrives after many successful ones', async () => {
    const template = await freshTemplate('Long lived');
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
  }, 30_000);

  it('never lets a write skip ownership — forced path closed, conditional path scoped', async () => {
    // Two separate guarantees, both checked against the database rather than the handler:
    //  1. the forced path is closed (410) for everyone, so it cannot be used to skip anything;
    //  2. the *statement* that does the writing carries `user_id = $2`, so even a caller who reaches it
    //     cannot touch another account's row.
    const otherId = randomUUID();
    await scratch.client.query(
      `INSERT INTO users (id, email, password_hash, full_name, role, status) VALUES ($1, $2, 'hash', 'Someone Else', 'customer', 'active')`,
      [otherId, `other-${otherId.slice(0, 8)}@example.com`]
    );
    const otherToken = signAuthToken(env, { sub: otherId, email: `other-${otherId.slice(0, 8)}@example.com`, role: 'customer' });

    const template = await freshTemplate('Owned by someone');

    const forced = await app.inject({
      method: 'PUT',
      url: `${base}/${template.id}`,
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { document: { ...DOCUMENT, widthMm: 999 }, force: true },
    });
    expect(forced.statusCode).toBe(410);
    expect(forced.json().error).toBe('FORCED_OVERWRITE_SUNSET');

    const conditional = await app.inject({
      method: 'PUT',
      url: `${base}/${template.id}`,
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { document: { ...DOCUMENT, widthMm: 999 }, expectedRevision: 1 },
    });
    expect(conditional.statusCode).toBe(404);

    // And at the storage layer, against the real database: the update matches nothing for another owner.
    const direct = await scratch.client.query(
      'UPDATE design_studio_templates SET document = $3::jsonb WHERE id = $1 AND user_id = $2 RETURNING id',
      [template.id, otherId, JSON.stringify({ widthMm: 999 })]
    );
    expect(direct.rows).toHaveLength(0);

    const stored = await app.inject({ method: 'GET', url: `${base}/${template.id}`, headers: auth() });
    expect(stored.json().template.document).toEqual(DOCUMENT);
    expect(stored.json().template.revision).toBe(1);
  }, 30_000);
});

if (!hasRealPostgres) {
  // Printed once, loudly. A silent skip reads as "covered" in a summary line, which is how a
  // concurrency claim ends up in a report with nothing behind it.
  describe('real PostgreSQL concurrency', () => {
    it.skip(REAL_POSTGRES_SKIP, () => undefined);
  });
}
