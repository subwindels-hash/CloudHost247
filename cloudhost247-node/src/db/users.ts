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
  /** Permanent, human-readable six-digit account number (0051 migration). Never a relational
   * key — `id` (uuid) remains the primary key and every foreign key still points at it. */
  customer_id: string | null;
  /** bcrypt hash of the four-digit Security Number. The plaintext is never stored anywhere. */
  security_number_hash: string | null;
  security_number_created_at: string | null;
  security_number_expires_at: string | null;
  security_number_version: number;
  security_number_initialized: boolean;
  phone: string | null;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
}

export type UserRole = 'customer' | 'staff' | 'admin' | 'super_admin';
export type UserStatus = 'active' | 'suspended' | 'disabled' | 'deleted';

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
  input: {
    id: string;
    email: string;
    passwordHash: string;
    fullName: string;
    /** Six-digit Customer ID candidate. A unique-violation on this column is the authoritative
     * collision signal and is retried by src/services/customer-identity-service.ts — never do a
     * SELECT-then-INSERT, which races. */
    customerId?: string;
    role?: UserRole;
    securityNumberHash?: string | null;
    securityNumberExpiresAt?: Date | null;
  }
): Promise<UserRecord> {
  return withTransaction(pool, async (tx) => {
    const role: UserRole = input.role ?? 'customer';
    const hasSecurityNumber = Boolean(input.securityNumberHash);
    const { rows } = await tx.query<UserRecord>(
      `INSERT INTO users (
         id, email, password_hash, full_name, role, customer_id,
         security_number_hash, security_number_created_at, security_number_expires_at,
         security_number_initialized
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $7::text IS NULL THEN NULL ELSE now() END, $8, $9)
       RETURNING *`,
      [
        input.id,
        input.email,
        input.passwordHash,
        input.fullName,
        role,
        input.customerId ?? null,
        input.securityNumberHash ?? null,
        input.securityNumberExpiresAt ?? null,
        hasSecurityNumber,
      ]
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
       SELECT $1, id FROM roles WHERE name = $2
       ON CONFLICT (user_id, role_id) DO NOTHING`,
      [row.id, role]
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
  status?: UserStatus;
  /** Soft-deleted accounts are hidden unless explicitly requested (their history is retained). */
  includeDeleted?: boolean;
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
  if (filter.status) {
    params.push(filter.status);
    conditions.push(`status = $${params.length}`);
  }
  if (!filter.includeDeleted) {
    conditions.push(`deleted_at IS NULL`);
  }
  if (filter.search) {
    const term = filter.search.trim();
    params.push(`%${term.toLowerCase()}%`);
    const like = `$${params.length}`;
    // Exact-match lanes for the two identifiers staff actually paste in (six-digit Customer ID
    // and the internal UUID) alongside the substring lanes for human fields.
    params.push(/^[0-9]{6}$/.test(term) ? term : null);
    const exactCustomerId = `$${params.length}`;
    params.push(/^[0-9a-fA-F-]{36}$/.test(term) ? term : null);
    const exactUuid = `$${params.length}`;
    conditions.push(
      `(lower(email) LIKE ${like} OR lower(full_name) LIKE ${like} OR lower(coalesce(phone, '')) LIKE ${like}` +
        ` OR customer_id = ${exactCustomerId} OR id::text = ${exactUuid})`
    );
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

/** Looks an account up by its permanent six-digit Customer ID (admin search, support flows). */
export async function findUserByCustomerId(pool: Queryable, customerId: string): Promise<UserRecord | null> {
  const { rows } = await pool.query<UserRecord>('SELECT * FROM users WHERE customer_id = $1 LIMIT 1', [customerId]);
  return rows[0] ?? null;
}

export interface ProfileFieldUpdate {
  fullName?: string;
  phone?: string | null;
  addressLine1?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
}

/**
 * Self-service profile edit. Deliberately accepts *only* the safe, user-owned fields: email,
 * role, status, customer_id, and every security_number_* column are unreachable from here, so a
 * crafted request body can never escalate privilege or rewrite identity (spec §26/§31).
 */
export async function updateProfileFields(
  pool: Queryable,
  id: string,
  input: ProfileFieldUpdate
): Promise<UserRecord | null> {
  const columns: Record<string, unknown> = {};
  if (input.fullName !== undefined) columns.full_name = input.fullName;
  if (input.phone !== undefined) columns.phone = input.phone;
  if (input.addressLine1 !== undefined) columns.address_line1 = input.addressLine1;
  if (input.city !== undefined) columns.city = input.city;
  if (input.state !== undefined) columns.state = input.state;
  if (input.postalCode !== undefined) columns.postal_code = input.postalCode;
  if (input.country !== undefined) columns.country = input.country;

  const entries = Object.entries(columns);
  if (entries.length === 0) return findUserById(pool, id);

  const sets = entries.map(([column], index) => `${column} = $${index + 2}`);
  const { rows } = await pool.query<UserRecord>(
    `UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, ...entries.map(([, value]) => value)]
  );
  return rows[0] ?? null;
}

/**
 * Soft deletion (spec §22). The row is retained so invoices, payments, tickets and audit entries
 * keep resolving their foreign keys and financial history stays intact; the account simply stops
 * being able to authenticate (status is no longer 'active' — see src/lib/require-auth.ts). The
 * Customer ID is never released or reassigned.
 */
export async function softDeleteUser(pool: Queryable, id: string, deletedBy: string): Promise<UserRecord | null> {
  const { rows } = await pool.query<UserRecord>(
    `UPDATE users
        SET status = 'deleted', deleted_at = now(), deleted_by = $2, updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING *`,
    [id, deletedBy]
  );
  return rows[0] ?? null;
}

/** Restores a soft-deleted account (super_admin correction path). */
export async function restoreUser(pool: Queryable, id: string): Promise<UserRecord | null> {
  const { rows } = await pool.query<UserRecord>(
    `UPDATE users
        SET status = 'active', deleted_at = NULL, deleted_by = NULL, updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [id]
  );
  return rows[0] ?? null;
}

export async function updateUserEmail(pool: Queryable, id: string, email: string): Promise<UserRecord | null> {
  const { rows } = await pool.query<UserRecord>(
    `UPDATE users SET email = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, email]
  );
  return rows[0] ?? null;
}
