/**
 * PostgreSQL connection pool.
 *
 * Works against:
 *   - PostgreSQL provided directly on the cPanel account (if available), or
 *   - An external/managed PostgreSQL provider (Supabase, RDS, Neon, DigitalOcean, etc.)
 * selected purely by DATABASE_URL. Nothing here hardcodes a host, user, password or database
 * name — see docs/CPANEL_DEPLOYMENT.md section "Database" for how to obtain DATABASE_URL.
 *
 * cPanel shared hosting note: pool size is intentionally small and configurable
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
    // from crashing the whole Passenger-managed process.
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
