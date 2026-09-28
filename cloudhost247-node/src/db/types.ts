/**
 * Minimal structural interface for "something you can run a parameterized SQL query against".
 *
 * `pg.Pool` (and `pg.PoolClient`) satisfy this shape already, so production code passes a real
 * Pool without any adapter. Tests can instead pass an embedded `@electric-sql/pglite` instance
 * (a real, WASM-compiled PostgreSQL engine — see tests/integration/auth-flow.test.ts) because its
 * `.query(text, params)` method returns the same `{ rows }` shape. This lets route handlers that
 * touch the database (registerAuthRoutes, db/users.ts, db/revoked-tokens.ts) be exercised against
 * real SQL semantics in CI without a running PostgreSQL server, instead of being untestable or
 * mocked away.
 */
export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
