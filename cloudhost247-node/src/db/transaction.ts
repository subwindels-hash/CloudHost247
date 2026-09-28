import type { Queryable } from './types';

/**
 * Runs `fn` against a single database transaction: every query `fn` issues (via the `tx` argument
 * it receives) sees the others' uncommitted writes, and either **all** of them commit together, or
 * — if `fn` throws anything at all — **all** of them roll back together and the original error is
 * re-thrown. Required for financial correctness anywhere an order/payment/invoice write touches
 * more than one table (Phase 5): a half-written order (order row present, its order_items missing,
 * or its cart not cleared) must never be observable.
 *
 * Supports both runtime engines used in this codebase (see `Queryable`'s own doc comment):
 *   - Production: a real `pg.Pool`. Deliberately checks out one dedicated `PoolClient` via
 *     `pool.connect()` and runs `BEGIN`/`COMMIT`/`ROLLBACK` on that *same* client for every
 *     statement in `fn`. This is not optional: calling `pool.query('BEGIN')` followed by more
 *     `pool.query(...)` calls would NOT be a real transaction, because `pg.Pool.query()` may hand
 *     out a different underlying connection for each call — the well-known node-postgres
 *     transaction pitfall. Only a client checked out via `pool.connect()` and reused for every
 *     statement guarantees they all run on the same session.
 *   - Tests: an embedded `@electric-sql/pglite` instance, which ships its own native
 *     `.transaction(async (tx) => ...)` API with the same commit-all/rollback-all-on-throw
 *     semantics, and hands back a `tx` whose `.query()` matches this codebase's `Queryable` shape.
 */
export async function withTransaction<T>(pool: Queryable, fn: (tx: Queryable) => Promise<T>): Promise<T> {
  const asPglite = pool as unknown as { transaction?: (cb: (tx: Queryable) => Promise<T>) => Promise<T> };
  if (typeof asPglite.transaction === 'function') {
    return asPglite.transaction(fn);
  }

  const asPgPool = pool as unknown as {
    connect?: () => Promise<Queryable & { release: (err?: unknown) => void }>;
  };
  if (typeof asPgPool.connect === 'function') {
    const client = await asPgPool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // The connection may already be unusable (e.g. it was the failure) — the original error
        // below is what matters; a failed ROLLBACK must never mask it.
      }
      throw err;
    } finally {
      client.release();
    }
  }

  throw new Error(
    'withTransaction: the provided database handle supports neither pg.Pool.connect() nor PGlite.transaction() — cannot guarantee an atomic write'
  );
}
