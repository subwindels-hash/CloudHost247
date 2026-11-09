/**
 * Local development server with an embedded Postgres.
 *
 * `npm run dev:server` runs `src/server.ts`, which connects through `pg` to a DATABASE_URL — that
 * needs a real Postgres instance. On a machine with none, this script mounts the same Fastify app
 * (`buildApp`) on an embedded @electric-sql/pglite database after running the real committed
 * migrations, exactly as tests/integration/*.test.ts does. Nothing in `src/` changes: `buildApp`
 * already accepts an injected Queryable, and PGlite is a real Postgres engine, not a mock.
 *
 * Development convenience ONLY. No production code path imports this; it is never deployed.
 */
import { PGlite } from '@electric-sql/pglite';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnv } from '../src/config/env';
import { buildApp } from '../src/app';
import { PgliteClient } from '../database/db-client';
import { migrateUp } from '../database/migrate';

const DATA_DIR = process.env.PGLITE_DATA_DIR ?? path.join(process.cwd(), '.dev-db-pg');
const PORT = Number(process.env.PORT ?? 3000);

async function main() {
  const env = loadEnv();
  const db = await PGlite.create(DATA_DIR);
  const result = await migrateUp(new PgliteClient(db), { isProduction: false });
  // eslint-disable-next-line no-console
  console.log(`[dev-server] embedded Postgres at ${DATA_DIR} — ${result.applied.length} migration(s) applied this run`);

  // The catalogue is empty after `migrate up` by design (real pricing comes from the admin API).
  // On a fresh local database, load the committed dev fixture so the plans UI has something to
  // render. The seed is idempotent and explicitly marked "not a real price" in every row.
  const seedPath = path.join(process.cwd(), 'database', 'seed', 'dev-catalog-seed.sql');
  if (existsSync(seedPath)) {
    const { rows } = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM products');
    if (rows[0]?.count === '0') {
      await db.exec(readFileSync(seedPath, 'utf8'));
      // eslint-disable-next-line no-console
      console.log('[dev-server] catalogue was empty — loaded database/seed/dev-catalog-seed.sql (dev fixtures, not real prices)');
    }
  }

  // Deliberately no Domain Services fixture: nothing in the repository may seed the extension
  // catalogue (tests/security/test_domain_data_provenance.py, and the release-candidate gate that
  // runs it). A local database with no registrar connected therefore renders the honest empty
  // state, exactly as a fresh install does.

  const app = buildApp(env, { serveFrontend: false, pool: db });
  await app.listen({ port: PORT, host: '0.0.0.0' });
  // eslint-disable-next-line no-console
  console.log(`[dev-server] API listening on 0.0.0.0:${PORT}`);

  const shutdown = async () => {
    await app.close();
    await db.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[dev-server] failed to start', error);
  process.exit(1);
});
