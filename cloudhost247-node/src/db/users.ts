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
  /** Set only after the customer redeems a single-use email verification action (0059 migration). */
  email_verified_at: string | null;
  /** Monotonic JWT session generation; increments with every password change (0059 migration). */
  auth_session_version: number;
  /** Unique, customer-chosen login handle (0085 migration). Case-insensitive uniqueness. */
  username: string;
  username_changed_at: string | null;
  /** Permanent, human-readable nine-digit account number (0085 migration; six digits for accounts
   * created before it). Never a relational key — `id` (uuid) remains the primary key and every
   * foreign key still points at it. Immutable: a database trigger rejects any change. */
  customer_id: string | null;
  /** Keyed hash (HMAC-SHA-256) of the four-digit Security PIN plus its per-value salt. The
   * plaintext is never stored, never logged and never included in a DTO. */
  security_pin_hash: string | null;
  security_pin_salt: string | null;
  /** AES-256-GCM envelope of the same PIN, used only by the verified reveal path. Never DTO'd. */
  security_pin_encrypted: string | null;
  security_pin_created_at: string | null;
  security_pin_expires_at: string | null;
  security_pin_version: number;
  security_pin_notified_version: number;
  security_pin_previous_hash: string | null;
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
    /** Chosen (or derived) username. A unique-violation on this column is a real conflict and is
     * surfaced to the caller; the database index on lower(username) is the authority. */
    username: string;
    /** Nine-digit Customer ID candidate. A unique-violation on this column is the authoritative
     * collision signal and is retried by src/services/customer-identity-service.ts — never do a
     * SELECT-then-INSERT, which races. */
    customerId?: string;
    role?: UserRole;
    securityNumberHash?: string | null;
    securityNumberExpiresAt?: Date | null;
    /** Keyed hash + salt of the first rotating Security PIN (see src/services/security-pin-service.ts). */
    securityPinHash?: string | null;
    securityPinSalt?: string | null;
    /** Sealed (AES-GCM) copy of the same PIN — see src/services/security-pin-service.ts. */
    securityPinEncrypted?: string | null;
    securityPinExpiresAt?: Date | null;
  }
): Promise<UserRecord> {
  return withTransaction(pool, async (tx) => {
    const role: UserRole = input.role ?? 'customer';
    const hasSecurityNumber = Boolean(input.securityNumberHash);
    // The identity of an account — username, permanent Customer ID, first Security PIN — is written
    // in the same INSERT as the account itself, so an account can never exist without them.
    const { rows } = await tx.query<UserRecord>(
      `INSERT INTO users (
         id, email, password_hash, full_name, role, username, customer_id,
         security_number_hash, security_number_created_at, security_number_expires_at,
         security_number_initialized,
         security_pin_hash, security_pin_salt, security_pin_encrypted,
         security_pin_created_at, security_pin_expires_at, security_pin_version
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7,
               $8, CASE WHEN $8::text IS NULL THEN NULL ELSE now() END, $9, $10,
               $11, $12, $13, CASE WHEN $11::text IS NULL THEN NULL ELSE now() END, $14,
               CASE WHEN $11::text IS NULL THEN 0 ELSE 1 END)
       RETURNING *`,
      [
        input.id,
        input.email,
        input.passwordHash,
        input.fullName,
        role,
        input.username,
        input.customerId ?? null,
        input.securityNumberHash ?? null,
        input.securityNumberExpiresAt ?? null,
        hasSecurityNumber,
        input.securityPinHash ?? null,
        input.securityPinSalt ?? null,
        input.securityPinEncrypted ?? null,
        input.securityPinExpiresAt ?? null,
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

/** Password change/reset. It stamps `password_changed_at` and increments the database-backed
 * session version. The version is the exact invalidation mechanism (including same-second JWTs);
 * the timestamp remains useful for audit/history and compatibility with older sessions. */
export async function updatePasswordHash(pool: Queryable, id: string, passwordHash: string): Promise<UserRecord | null> {
  const { rows } = await pool.query<UserRecord>(
    `UPDATE users
        SET password_hash = $1,
            password_changed_at = now(),
            auth_session_version = auth_session_version + 1,
            updated_at = now()
      WHERE id = $2
      RETURNING *`,
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
    // Exact-match lane for a pasted username, so "ada" does not bury "ada" under "ada2".
    params.push(term.toLowerCase());
    const likeExactUsername = `$${params.length}`;
    // Exact-match lanes for the two identifiers staff actually paste in (six-digit Customer ID
    // and the internal UUID) alongside the substring lanes for human fields.
    params.push(/^([0-9]{6}|[0-9]{9})$/.test(term) ? term : null);
    const exactCustomerId = `$${params.length}`;
    params.push(/^[0-9a-fA-F-]{36}$/.test(term) ? term : null);
    const exactUuid = `$${params.length}`;
    conditions.push(
      `(lower(email) LIKE ${like} OR lower(full_name) LIKE ${like} OR lower(coalesce(phone, '')) LIKE ${like}` +
        ` OR lower(username) LIKE ${like}` +
        ` OR lower(username) = ${likeExactUsername} OR customer_id = ${exactCustomerId} OR id::text = ${exactUuid})`
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
      | 'admin_invoice_cancelled'
      | 'email_verification_requested'
      | 'email_verified'
      | 'password_reset_requested'
      | 'password_reset_completed'
      | 'mfa_enrollment_started'
      | 'mfa_enabled'
      | 'mfa_disabled'
      | 'mfa_login_challenge'
      | 'mfa_login_failure'
      | 'mfa_recovery_code_used'
      | 'passkey_enrollment_started'
      | 'passkey_added'
      | 'passkey_removed'
      | 'passkey_renamed'
      // --- 0085: username, Security PIN, verification and recovery -----------------------------
      | 'username_changed'
      | 'security_pin_rotated'
      | 'security_pin_view_challenge_requested'
      | 'security_pin_view_challenge_resent'
      | 'security_pin_view_verification_failed'
      | 'security_pin_viewed'
      | 'account_recovery_requested'
      | 'account_recovery_cancelled'
      | 'account_recovery_identity_verified'
      | 'account_recovery_approved'
      | 'account_recovery_rejected';
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

/** Looks an account up by its permanent nine-digit Customer ID (admin search, support flows). */
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

/**
 * Looks an account up by username, case-insensitively. Username-based identification is used by
 * support tooling and by the login form (which accepts "email or username"); it is never used to
 * decide authorization — the account's uuid and role are still the only authorities.
 */
export async function findUserByUsername(pool: Queryable, username: string): Promise<UserRecord | null> {
  const { rows } = await pool.query<UserRecord>('SELECT * FROM users WHERE lower(username) = lower($1) LIMIT 1', [
    username,
  ]);
  return rows[0] ?? null;
}

/**
 * Resolves a login identifier that may be either an email address or a username. Lookup order is
 * deliberately email-first: an account can only be reached by the handle that exactly matches, so a
 * username can never be used to shadow somebody else's email address.
 */
export async function findUserByLoginIdentifier(pool: Queryable, identifier: string): Promise<UserRecord | null> {
  const value = identifier.trim();
  if (value.includes('@')) {
    const byEmail = await findUserByEmail(pool, value);
    if (byEmail) return byEmail;
  }
  return findUserByUsername(pool, value);
}

/**
 * Profile edit. Extends the Phase 4 safe-field list with the username, which is customer-owned but
 * must go through the service layer's reservation/uniqueness rules before it gets here. The
 * permanent Customer ID and every security_pin_* column remain unreachable from this function.
 */
export async function updateUsernameForUser(
  pool: Queryable,
  id: string,
  username: string
): Promise<UserRecord | null> {
  const { rows } = await pool.query<UserRecord>(
    `UPDATE users SET username = $2, username_changed_at = now(), updated_at = now() WHERE id = $1 RETURNING *`,
    [id, username]
  );
  return rows[0] ?? null;
}
