/**
 * PostgreSQL connection pool.
 *
 * Works against:
 *   - the local PostgreSQL 16 instance on the VPS, or
 *   - An external/managed PostgreSQL provider (Supabase, RDS, Neon, DigitalOcean, etc.)
 * selected purely by DATABASE_URL. Nothing here hardcodes a host, user, password or database
 * name — see docs/CPANEL_DEPLOYMENT.md section "Database" for how to obtain DATABASE_URL.
 *
 * VPS note: pool size stays small and configurable
 * (DATABASE_POOL_MAX) because shared hosting / small managed Postgres plans usually cap the
 * number of concurrent connections per account.
 */
import { Pool, type PoolConfig } from 'pg';
import type { Env } from '../config/env';
import type { Queryable } from './types';

export function buildPoolConfig(env: Env): PoolConfig {
  const config: PoolConfig = {
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  };

  if (env.DATABASE_SSL) {
    config.ssl = {
      rejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED,
    };
  }

  return config;
}

let pool: Pool | null = null;

export function getPool(env: Env): Pool {
  if (!pool) {
    pool = new Pool(buildPoolConfig(env));
    // Prevent unhandled 'error' events (emitted on idle client errors, e.g. connection drops)
    // from crashing the whole process. On the VPS this is a systemd unit, so an unhandled error
    // means a hard restart and a 502 from Nginx until it comes back.
    pool.on('error', (err) => {
      // eslint-disable-next-line no-console
      console.error('[db] unexpected idle client error', err.message);
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Lightweight liveness probe used by /ready. Resolves true/false, never throws.
 *
 * `overridePool` lets the same probe check the Queryable an app was actually built with (the
 * embedded preview database, or a pool injected by a test) instead of always opening a second
 * live connection from DATABASE_URL. Production leaves it unset.
 */
export async function isDatabaseReachable(
  env: Env,
  timeoutMs = 3000,
  overridePool?: Queryable,
): Promise<boolean> {
  const p = overridePool ?? getPool(env);
  try {
    await Promise.race([
      p.query('SELECT 1'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('db check timeout')), timeoutMs)),
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Schema probe used by /ready. `SELECT 1` answers "is the server accepting connections"; it does
 * NOT answer "can this process serve traffic", because a database with an empty schema accepts
 * connections just fine. A deploy that skipped or refused its migrations (see the quarantine gate
 * documented in docs/VPS_DEPLOYMENT.md §6) leaves exactly that state, and a readiness check that
 * stays green through it guarantees the failure surfaces to a customer instead of to the operator.
 *
 * Resolves true only when the migrations ledger itself exists — every real table is created by a
 * migration, so its presence is a cheap, version-agnostic proof that migrations ran. Never throws.
 */
export async function isSchemaPresent(
  env: Env,
  timeoutMs = 3000,
  overridePool?: Queryable,
): Promise<boolean> {
  const p = overridePool ?? getPool(env);
  try {
    const result = await Promise.race([
      p.query(`SELECT to_regclass('public.schema_migrations') AS ledger`),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('schema check timeout')), timeoutMs)),
    ]);
    const rows = (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
    return Boolean(rows[0]?.ledger);
  } catch {
    return false;
  }
}
