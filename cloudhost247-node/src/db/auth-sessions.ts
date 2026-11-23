import { randomUUID } from 'node:crypto';
import type { Queryable } from './types';
import { revokeToken } from './revoked-tokens';

/**
 * The account's own session inventory (Phase 6 — security).
 *
 * One row per login token, written when the token is issued (see src/routes/auth.ts). The row is
 * descriptive, not authoritative: the JWT and `revoked_tokens` decide whether a request is accepted,
 * and this table exists so a customer can see — and revoke — the sessions that exist.
 *
 * Two rules hold throughout and are worth stating plainly:
 *   - Every read is scoped by `user_id`, so one account can never read another's sessions.
 *   - Revocation always writes the `jti` to `revoked_tokens` in the same call, because that table is
 *     what `src/lib/require-auth.ts` checks on every request. Stamping `revoked_at` here without
 *     revoking the token would show a session as revoked while it still worked.
 */

export type SessionRevocationReason = 'customer_revoked' | 'customer_revoked_others' | 'logout';

/**
 * A row as Postgres returns it — snake_case column names, matching every other row type in this
 * directory. Callers map it to an API view explicitly (see src/routes/security.ts) so a column
 * rename cannot silently leak into a response.
 */
export interface AuthSessionRow {
  id: string;
  user_id: string;
  jti: string;
  user_agent: string | null;
  ip_address: string | null;
  created_at: Date;
  last_seen_at: Date;
  revoked_at: Date | null;
  revoked_reason: SessionRevocationReason | null;
  expires_at: Date;
}

export interface RecordAuthSessionInput {
  userId: string;
  jti: string;
  /** The JWT `exp` claim as a date — mirrors the token's own lifetime, never a second expiry. */
  expiresAt: Date;
  userAgent?: string | null;
  ipAddress?: string | null;
}

/**
 * Writes the session row for a freshly issued token. Idempotent on `jti`: re-recording the same
 * token (a retried login response, say) refreshes the observed metadata rather than creating a
 * second row, so the list can never show one token as two devices.
 */
export async function recordAuthSession(pool: Queryable, input: RecordAuthSessionInput): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO auth_sessions (id, user_id, jti, user_agent, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (jti) DO UPDATE
       SET user_agent = EXCLUDED.user_agent,
           ip_address = EXCLUDED.ip_address,
           expires_at = EXCLUDED.expires_at
     RETURNING id`,
    [
      id,
      input.userId,
      input.jti,
      input.userAgent ?? null,
      input.ipAddress ?? null,
      input.expiresAt.toISOString(),
    ]
  );
  return id;
}

export async function findAuthSessionByJti(pool: Queryable, jti: string): Promise<AuthSessionRow | null> {
  const { rows } = await pool.query<AuthSessionRow>('SELECT * FROM auth_sessions WHERE jti = $1 LIMIT 1', [jti]);
  return rows[0] ?? null;
}

/**
 * Refreshes `last_seen_at`, throttled to one write per `intervalMinutes` per session.
 *
 * Authentication is a hot path, so this is deliberately not a write on every request: the update is
 * skipped entirely while the stored value is recent. The consequence is that `last_seen_at` is
 * approximate (it can lag real use by up to the interval), which is why nothing security-relevant
 * reads it. Failures are swallowed by the caller — a statistics column must never break login.
 */
export async function touchAuthSession(pool: Queryable, jti: string, intervalMinutes = 15): Promise<void> {
  await pool.query(
    `UPDATE auth_sessions
        SET last_seen_at = now()
      WHERE jti = $1
        AND (last_seen_at IS NULL OR last_seen_at < now() - $2::interval)`,
    [jti, `${intervalMinutes} minutes`]
  );
}

export interface ListAuthSessionsOptions {
  /** Include rows already revoked. Default false: the customer's list is the sessions that exist. */
  includeRevoked?: boolean;
  limit?: number;
}

export async function listAuthSessions(
  pool: Queryable,
  userId: string,
  options: ListAuthSessionsOptions = {}
): Promise<AuthSessionRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 200);
  const { rows } = await pool.query<AuthSessionRow>(
    `SELECT * FROM auth_sessions
      WHERE user_id = $1 ${options.includeRevoked ? '' : 'AND revoked_at IS NULL'}
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

/**
 * Revokes one of the caller's own sessions. Returns false when the row does not exist or does not
 * belong to `userId` — the caller's own id is part of the WHERE clause, so a guessed id can neither
 * revoke another account's session nor reveal that it exists (the same 404 either way).
 *
 * The token itself is revoked through `revoked_tokens`, so the session stops working immediately.
 */
export async function revokeAuthSession(
  pool: Queryable,
  input: { userId: string; sessionId: string; reason: SessionRevocationReason }
): Promise<{ revoked: boolean; jti: string | null; expiresAt: Date | null }> {
  const { rows } = await pool.query<AuthSessionRow>(
    `UPDATE auth_sessions
        SET revoked_at = now(), revoked_reason = $3
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
      RETURNING jti, expires_at`,
    [input.sessionId, input.userId, input.reason]
  );
  const row = rows[0];
  if (!row) return { revoked: false, jti: null, expiresAt: null };

  await revokeToken(pool, { jti: row.jti, userId: input.userId, expiresAt: new Date(row.expires_at) });
  return { revoked: true, jti: row.jti, expiresAt: new Date(row.expires_at) };
}

/**
 * Stamps an existing session row revoked by `jti`, for the logout path where the caller already
 * holds the token id and not a session row id. Returns false when there is no row — which is normal
 * for a token minted before this table existed, and must not fail the logout: `revoked_tokens` is
 * what actually ends the session.
 */
export async function revokeAuthSessionByJti(
  pool: Queryable,
  input: { userId: string; jti: string; reason: SessionRevocationReason }
): Promise<boolean> {
  const { rows } = await pool.query<{ id: string }>(
    `UPDATE auth_sessions
        SET revoked_at = now(), revoked_reason = $3
      WHERE jti = $1 AND user_id = $2 AND revoked_at IS NULL
      RETURNING id`,
    [input.jti, input.userId, input.reason]
  );
  return rows.length > 0;
}

/**
 * Revokes every recorded session except `keepJti` — "log out everywhere else". Returns the number
 * of sessions revoked. The caller's own token is never touched, so the request that asked for this
 * keeps working; a password change remains the way to invalidate *everything*, including the
 * current token (see `auth_session_version`).
 */
export async function revokeOtherAuthSessions(
  pool: Queryable,
  input: { userId: string; keepJti: string; reason: SessionRevocationReason }
): Promise<number> {
  const { rows } = await pool.query<AuthSessionRow>(
    `UPDATE auth_sessions
        SET revoked_at = now(), revoked_reason = $3
      WHERE user_id = $1 AND jti <> $2 AND revoked_at IS NULL
      RETURNING jti, expires_at`,
    [input.userId, input.keepJti, input.reason]
  );
  for (const row of rows) {
    await revokeToken(pool, { jti: row.jti, userId: input.userId, expiresAt: new Date(row.expires_at) });
  }
  return rows.length;
}

/**
 * Whether the account already has an active session with this user agent, excluding `excludeJti`.
 *
 * This is the "familiar device" test used to decide whether a sign-in is worth a notification. It
 * keys on the **user agent** and deliberately not on the IP address: the app reads `request.ip`,
 * which is the immediate peer, so behind the reverse proxy every request appears to come from the
 * proxy and an IP-based test would either never fire or fire on every mobile network change. The
 * recorded IP is still shown to the customer, who is the best judge of whether it is theirs.
 *
 * An empty/blank user agent matches nothing, so a client that sends none is treated as unfamiliar
 * rather than silently folded into "the same device".
 */
export async function hasActiveSessionWithUserAgent(
  pool: Queryable,
  input: { userId: string; userAgent: string | null; excludeJti: string }
): Promise<boolean> {
  const agent = input.userAgent?.trim();
  if (!agent) return false;
  const { rows } = await pool.query<{ one: number }>(
    `SELECT 1 AS one FROM auth_sessions
      WHERE user_id = $1
        AND jti <> $2
        AND revoked_at IS NULL
        AND lower(user_agent) = lower($3)
      LIMIT 1`,
    [input.userId, input.excludeJti, agent]
  );
  return rows.length > 0;
}

/**
 * Whether the account has any *other* active recorded session at all. Used so a customer's first
 * recorded sign-in is not announced as an unfamiliar one — there is nothing to be unfamiliar from.
 */
export async function hasOtherActiveSession(
  pool: Queryable,
  input: { userId: string; excludeJti: string }
): Promise<boolean> {
  const { rows } = await pool.query<{ one: number }>(
    `SELECT 1 AS one FROM auth_sessions
      WHERE user_id = $1 AND jti <> $2 AND revoked_at IS NULL
      LIMIT 1`,
    [input.userId, input.excludeJti]
  );
  return rows.length > 0;
}
