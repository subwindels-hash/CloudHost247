/**
 * Minimal DB client abstraction used by the migration runner.
 *
 * The production adapter wraps a real `pg` client/pool. The test adapter wraps an embedded
 * PGlite instance (a real, WASM-compiled PostgreSQL engine) so migrations can be executed and
 * verified in CI without requiring a running PostgreSQL server — see tests/integration/migrate.test.ts.
 *
 * `exec` runs one or more semicolon-separated statements with no return value (used for DDL and
 * transaction control). `query` runs a single parameterized statement and returns rows (used for
 * bookkeeping reads/writes against schema_migrations).
 */
export interface DbClient {
  exec(sql: string): Promise<void>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface PgLikeQueryable {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

/** Adapter for a real `pg` Pool or PoolClient. */
export class PgClient implements DbClient {
  constructor(private readonly client: PgLikeQueryable) {}

  async exec(sql: string): Promise<void> {
    // node-postgres runs multiple ;-separated statements via the simple query protocol when
    // no parameters are supplied and the driver receives a plain string.
    await this.client.query(sql);
  }

  async query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<{ rows: T[] }> {
    const res = await this.client.query(text, params);
    return { rows: res.rows as T[] };
  }
}

/** Adapter for @electric-sql/pglite, used only in tests (never a production dependency path). */
export class PgliteClient implements DbClient {
  constructor(private readonly db: { exec(sql: string): Promise<unknown>; query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }> }) {}

  async exec(sql: string): Promise<void> {
    await this.db.exec(sql);
  }

  async query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<{ rows: T[] }> {
    const res = await this.db.query(text, params);
    return { rows: res.rows as T[] };
  }
}
