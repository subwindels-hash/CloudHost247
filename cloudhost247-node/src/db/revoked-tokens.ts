import type { Queryable } from './types';

/**
 * DB-backed denylist for logged-out JWTs. See database/migrations/0003_create_revoked_tokens.sql
 * for the full rationale (no Redis/queue — a single indexed Postgres table, consistent with the
 * project's "no mandatory Redis" constraint).
 */
export async function revokeToken(
  pool: Queryable,
  input: { jti: string; userId: string; expiresAt: Date }
): Promise<void> {
  await pool.query(
    `INSERT INTO revoked_tokens (jti, user_id, expires_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (jti) DO NOTHING`,
    [input.jti, input.userId, input.expiresAt.toISOString()]
  );
}

export async function isTokenRevoked(pool: Queryable, jti: string): Promise<boolean> {
  const { rows } = await pool.query('SELECT 1 FROM revoked_tokens WHERE jti = $1 LIMIT 1', [jti]);
  return rows.length > 0;
}
