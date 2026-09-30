/**
 * Customer identity — the permanent, human-readable six-digit Customer ID.
 *
 * Design rules this module enforces (and why):
 *   - The value is generated **server-side only**, from Node's CSPRNG (`randomInt`), never from
 *     `Math.random()` and never from anything a client can influence.
 *   - It is **not** a sequence and not derived from the user's uuid/email, so it leaks neither
 *     signup order nor personal data.
 *   - Uniqueness is guaranteed by the database (`users_customer_id_unique_idx`), not by a
 *     "SELECT then INSERT" check, which would race under concurrent registrations. We insert a
 *     candidate and retry on the unique violation.
 *   - It is **immutable** once assigned: nothing in this codebase updates `users.customer_id`
 *     after creation, and it is never reused — even for soft-deleted accounts.
 *   - It never replaces `users.id` (uuid). Every foreign key in the schema still references the
 *     uuid; the Customer ID is a display/lookup identifier for humans (billing, support, admin).
 */
import { randomInt, randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';
import { createUser, type UserRecord, type UserRole } from '../db/users';

/** Total six-digit space, including leading zeros ("000042" is a valid Customer ID). */
export const CUSTOMER_ID_SPACE = 1_000_000;
export const CUSTOMER_ID_PATTERN = /^[0-9]{6}$/;

/** Bounded retries: at realistic customer counts a collision is rare, and each retry is one
 * insert. The loop terminates loudly rather than silently assigning a duplicate or NULL. */
export const CUSTOMER_ID_MAX_ATTEMPTS = 10;

export function generateCustomerIdCandidate(): string {
  return String(randomInt(0, CUSTOMER_ID_SPACE)).padStart(6, '0');
}

export function isValidCustomerId(value: string): boolean {
  return CUSTOMER_ID_PATTERN.test(value);
}

/** Postgres unique-violation. Also matches PGlite, which reports the same SQLSTATE. */
export function isUniqueViolation(error: unknown, constraintHint?: string): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (code !== '23505') return false;
  if (!constraintHint) return true;
  const detail = `${(error as { constraint?: string }).constraint ?? ''} ${(error as Error).message ?? ''}`;
  return detail.includes(constraintHint);
}

export interface CreateUserWithIdentityInput {
  email: string;
  passwordHash: string;
  fullName: string;
  role?: UserRole;
  securityNumberHash?: string | null;
  securityNumberExpiresAt?: Date | null;
}

export interface CreateUserWithIdentityResult {
  user: UserRecord;
  /** How many Customer ID candidates had to be tried (1 in the overwhelmingly common case). */
  attempts: number;
}

/**
 * Creates a user with a guaranteed-unique Customer ID, retrying only on a Customer ID collision.
 * A duplicate *email* is a real, user-facing conflict and is rethrown immediately rather than
 * being retried — otherwise a registration with an already-used email would spin the loop.
 */
export async function createUserWithIdentity(
  pool: Queryable,
  input: CreateUserWithIdentityInput
): Promise<CreateUserWithIdentityResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= CUSTOMER_ID_MAX_ATTEMPTS; attempt += 1) {
    const customerId = generateCustomerIdCandidate();
    try {
      const user = await createUser(pool, {
        id: randomUUID(),
        email: input.email,
        passwordHash: input.passwordHash,
        fullName: input.fullName,
        role: input.role,
        customerId,
        securityNumberHash: input.securityNumberHash ?? null,
        securityNumberExpiresAt: input.securityNumberExpiresAt ?? null,
      });
      return { user, attempts: attempt };
    } catch (error) {
      if (isUniqueViolation(error, 'customer_id')) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }
  throw new Error(
    `Could not allocate a unique Customer ID after ${CUSTOMER_ID_MAX_ATTEMPTS} attempts: ${
      (lastError as Error | undefined)?.message ?? 'unknown error'
    }`
  );
}

/**
 * Assigns a Customer ID to an existing account that somehow has none (defence in depth for rows
 * created before 0051 by an out-of-band import; the migration itself already backfills).
 */
export async function ensureCustomerId(pool: Queryable, userId: string): Promise<string | null> {
  for (let attempt = 1; attempt <= CUSTOMER_ID_MAX_ATTEMPTS; attempt += 1) {
    const candidate = generateCustomerIdCandidate();
    try {
      const { rows } = await pool.query<{ customer_id: string }>(
        `UPDATE users SET customer_id = $2, updated_at = now()
          WHERE id = $1 AND customer_id IS NULL
          RETURNING customer_id`,
        [userId, candidate]
      );
      if (rows[0]) return rows[0].customer_id;
      // Already had one — return it unchanged (Customer IDs are immutable).
      const existing = await pool.query<{ customer_id: string | null }>('SELECT customer_id FROM users WHERE id = $1', [
        userId,
      ]);
      return existing.rows[0]?.customer_id ?? null;
    } catch (error) {
      if (isUniqueViolation(error, 'customer_id')) continue;
      throw error;
    }
  }
  throw new Error('Could not allocate a unique Customer ID');
}
