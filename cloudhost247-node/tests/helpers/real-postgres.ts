/**
 * A real PostgreSQL server for tests that need real concurrency.
 *
 * PGlite is a genuine PostgreSQL engine, but it is *one* interpreter over *one* connection: two
 * "concurrent" requests are serialised by the test harness before they ever reach the storage layer.
 * That is fine for proving a `WHERE` predicate (see `design-studio-templates.test.ts`), and useless for
 * proving the thing a production database actually has to provide — that two independent backends
 * using default READ COMMITTED isolation cannot both match the same revision row.
 *
 * So these tests need a server. They are opt-in, not silently skipped in a way that would let someone
 * claim coverage they do not have:
 *
 *   TEST_POSTGRES_URL=postgres://postgres@127.0.0.1:5432/postgres npm run test:postgres
 *
 * `describeRealPostgres` reports the skip loudly (once per file, with the variable name) rather than
 * passing quietly. A skipped suite is not a green suite, and the evidence report says so.
 */
import { Client, Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { PgClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';

/** The server to create throwaway databases on, or null when the environment has none. */
export function realPostgresUrl(): string | null {
  const url = process.env.TEST_POSTGRES_URL?.trim();
  return url && url !== '' ? url : null;
}

export const hasRealPostgres = realPostgresUrl() !== null;

/** A message that tells a reader exactly how to provide the server. */
export const REAL_POSTGRES_SKIP =
  'TEST_POSTGRES_URL is not set — real-PostgreSQL concurrency tests skipped. Start a server and set TEST_POSTGRES_URL=postgres://user@host:port/db (see docs/tools/DESIGN-STUDIO.md, "Outstanding limitations").';

export interface ScratchDatabase {
  /** Connection string for the throwaway database, e.g. to hand to `pg.Pool`. */
  url: string;
  /** A migrated, ready-to-use pool. Close it with `close()`. */
  pool: Pool;
  /** The same database as the app's driver-agnostic client, for migration and direct reads. */
  client: PgClient;
  close(): Promise<void>;
}

/**
 * Create a database, run every migration against it, and hand back a pool.
 *
 * One database per test file (not per test) keeps migration time off the critical path, and each file
 * uses its own ids so the files cannot interfere. The database is dropped on `close()`, so a failed run
 * does not accumulate schemas.
 */
export async function createScratchDatabase(prefix = 'ch247_test'): Promise<ScratchDatabase> {
  const adminUrl = realPostgresUrl();
  if (!adminUrl) throw new Error(REAL_POSTGRES_SKIP);
  const name = `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    // Identifiers cannot be parameterised; `name` is generated here from a UUID, never from input.
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }

  const url = withDatabase(adminUrl, name);
  const pool = new Pool({ connectionString: url, max: 8 });
  const client = new PgClient(pool);
  await migrateUp(client, { allowProduction: true });

  return {
    url,
    pool,
    client,
    async close() {
      await pool.end();
      const cleanup = new Client({ connectionString: adminUrl });
      await cleanup.connect();
      try {
        await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      } finally {
        await cleanup.end();
      }
    },
  };
}

/** Replace the database component of a connection string, keeping credentials, host and options. */
export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}
