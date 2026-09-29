import type { Queryable } from './types';
import { withTransaction } from './transaction';

export interface UserRecord {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  role: string;
  status: string;
  created_at: string;
  updated_at: string;
  /** See database/migrations/0012_add_password_changed_at_to_users.sql — used by
   * src/lib/require-auth.ts to reject any token issued before the most recent real password
   * change. Backfilled to epoch for pre-Phase-4 accounts, never to `now()`, so existing sessions
   * are never invalidated by the migration itself. */
  password_changed_at: string;
}

export type UserRole = 'customer' | 'staff' | 'admin' | 'super_admin';
export type UserStatus = 'active' | 'suspended' | 'disabled';

export async function findUserByEmail(pool: Queryable, email: string): Promise<UserRecord | null> {
  const { rows } = await pool.query<UserRecord>('SELECT * FROM users WHERE lower(email) = lower($1) LIMIT 1', [email]);
  return rows[0] ?? null;
}

export async function findUserById(pool: Queryable, id: string): Promise<UserRecord | null> {
  const { rows } = await pool.query<UserRecord>('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
  return rows[0] ?? null;
}

export async function createUser(
  pool: Queryable,
  input: { id: string; email: string; passwordHash: string; fullName: string }
): Promise<UserRecord> {
  return withTransaction(pool, async (tx) => {
    const { rows } = await tx.query<UserRecord>(
      `INSERT INTO users (id, email, password_hash, full_name)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [input.id, input.email, input.passwordHash, input.fullName]
    );
    const row = rows[0];
    if (!row) {
      throw new Error('Failed to create user');
    }

    // Keep the explicit RBAC registry in sync with the legacy role column. The column remains a
    // fast, DB-fresh authorization read for existing routes, while user_roles is the canonical
    // auditable role assignment requested by the platform specification.
    await tx.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, id FROM roles WHERE name = 'customer'
       ON CONFLICT (user_id, role_id) DO NOTHING`,
      [row.id]
    );
    return row;
  });
}

/** Phase 4 self-service profile edit: full name only (see docs/API_CUSTOMER_APP.md — email change
 * is explicitly out of scope until an email-verification flow exists). */
export async function updateFullName(pool: Queryable, id: string, fullName: string): Promise<UserRecord | null> {
  const { rows } = await pool.query<UserRecord>(
    `UPDATE users SET full_name = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [fullName, id]
  );
  return rows[0] ?? null;
}

/** Phase 4 self-service password change. Always stamps `password_changed_at = now()` alongside
 * the new hash — this is the one and only place that column is ever set to a real, non-epoch
 * value, and it is what makes every token issued before this exact moment stop working on its
 * next use (see src/lib/require-auth.ts and 0012_add_password_changed_at_to_users.sql). */
export async function updatePasswordHash(pool: Queryable, id: string, passwordHash: string): Promise<UserRecord | null> {
  const { rows } = await pool.query<UserRecord>(
    `UPDATE users SET password_hash = $1, password_changed_at = now(), updated_at = now() WHERE id = $2 RETURNING *`,
    [passwordHash, id]
  );
  return rows[0] ?? null;
}

/** super_admin-only account status change (suspend/reactivate/disable) — see src/routes/admin-customers.ts. */
export async function updateUserStatus(pool: Queryable, id: string, status: UserStatus): Promise<UserRecord | null> {
  const { rows } = await pool.query<UserRecord>(
    `UPDATE users SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [status, id]
  );
  return rows[0] ?? null;
}

/** super_admin-only role change — privilege escalation/de-escalation. Self-demotion lockout
 * protection lives in the route handler (src/routes/admin-customers.ts), not here, since this
 * function has no notion of "the caller". The legacy role column and explicit user_roles registry
 * are updated atomically so they cannot disagree after a successful request. */
export async function updateUserRole(pool: Queryable, id: string, role: UserRole): Promise<UserRecord | null> {
  return withTransaction(pool, async (tx) => {
    const { rows } = await tx.query<UserRecord>(
      `UPDATE users SET role = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [role, id]
    );
    const row = rows[0];
    if (!row) return null;

    await tx.query(`DELETE FROM user_roles WHERE user_id = $1`, [id]);
    await tx.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, id FROM roles WHERE name = $2
       ON CONFLICT (user_id, role_id) DO NOTHING`,
      [id, role]
    );
    return row;
  });
}

export interface ListUsersFilter {
  /** Free-text match against email or full_name (case-insensitive, substring). */
  search?: string;
  role?: UserRole;
  limit: number;
  offset: number;
}

export interface ListUsersResult {
  users: UserRecord[];
  total: number;
}

/** Admin/super_admin customer directory (src/routes/admin-customers.ts). Paginated so a large
 * customer base never has to be loaded/rendered in one response. */
export async function listUsers(pool: Queryable, filter: ListUsersFilter): Promise<ListUsersResult> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.role) {
    params.push(filter.role);
    conditions.push(`role = $${params.length}`);
  }
  if (filter.search) {
    params.push(`%${filter.search.toLowerCase()}%`);
    conditions.push(`(lower(email) LIKE $${params.length} OR lower(full_name) LIKE $${params.length})`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM users ${where}`, params);
  const total = Number(countResult.rows[0]?.count ?? '0');

  const listParams = [...params, filter.limit, filter.offset];
  const { rows } = await pool.query<UserRecord>(
    `SELECT * FROM users ${where} ORDER BY created_at DESC LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  return { users: rows, total };
}

export async function recordAuthEvent(
  pool: Queryable,
  event: {
    id: string;
    userId: string | null;
    eventType:
      | 'register'
      | 'login_success'
      | 'login_failure'
      | 'logout'
      | 'token_refresh'
      | 'profile_update'
      | 'password_change'
      | 'admin_status_change'
      | 'admin_role_change'
      | 'payment_initiated'
      | 'manual_payment_confirmed'
      | 'manual_payment_rejected'
      | 'webhook_payment_succeeded'
      | 'webhook_payment_failed'
      | 'admin_invoice_refunded'
      | 'admin_invoice_cancelled';
    ipAddress?: string | null;
    userAgent?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await pool.query(
    `INSERT INTO auth_audit_log (id, user_id, event_type, ip_address, user_agent, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      event.id,
      event.userId,
      event.eventType,
      event.ipAddress ?? null,
      event.userAgent ?? null,
      JSON.stringify(event.metadata ?? {}),
    ]
  );
}
