/**
 * Customer identity — the permanent, human-readable nine-digit Customer ID.
 *
 * Design rules this module enforces (and why):
 *   - The value is generated **server-side only**, from Node's CSPRNG (`randomInt`), never from
 *     `Math.random()` and never from anything a client can influence.
 *   - It is **not a sequence**: draws come from the full 100,000,000–999,999,999 range, so the value
 *     leaks neither signup order nor customer volume, and the leading digit is never zero (a
 *     nine-digit identifier that renders as eight characters invites transcription mistakes).
 *   - Uniqueness is guaranteed by the database (`users_customer_id_unique_idx`), not by a
 *     "SELECT then INSERT" check, which races under concurrent registrations. We insert a
 *     candidate and retry on the unique violation.
 *   - It is **immutable** once assigned. Migration 0085 installs a trigger that aborts any UPDATE
 *     which changes a non-null `customer_id`, so the guarantee does not depend on every future
 *     call site remembering it; nothing in this codebase updates the column after creation, and
 *     the value is never reused — not even for soft-deleted accounts.
 *   - It never replaces `users.id` (uuid). Every foreign key in the schema still references the
 *     uuid; the Customer ID is a display/lookup identifier for humans (billing, support, admin).
 *
 * Backward compatibility: accounts created before migration 0085 hold a six-digit number. Those
 * values are preserved verbatim (widened in place, never re-issued) — a customer who was told
 * "000042" keeps that number. `isValidCustomerId` accepts both shapes for that reason; new
 * accounts are always nine digits.
 */
import { randomInt, randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';
import { createUser, type UserRecord, type UserRole } from '../db/users';

/**
 * Number of distinct nine-digit identifiers issued by this generator: 100,000,000–999,999,999.
 * (Zero-padded nine-digit values such as "000000042" are valid in the column for legacy reasons,
 * but new draws never produce them.)
 */
export const CUSTOMER_ID_SPACE = 900_000_000;
export const CUSTOMER_ID_MIN = 100_000_000;
/** New identifiers are exactly nine digits and never begin with zero. */
export const CUSTOMER_ID_PATTERN = /^[0-9]{9}$/;
/** Legacy six-digit identifiers assigned by migration 0053; preserved, never newly issued. */
export const LEGACY_CUSTOMER_ID_PATTERN = /^[0-9]{6}$/;
/** What the database CHECK constraint accepts (see 0085). */
export const CUSTOMER_ID_DB_PATTERN = /^([0-9]{6}|[0-9]{9})$/;

/** Bounded retries: at realistic customer counts a collision is rare, and each retry is one
 * insert. The loop terminates loudly rather than silently assigning a duplicate or NULL. */
export const CUSTOMER_ID_MAX_ATTEMPTS = 10;

export function generateCustomerIdCandidate(): string {
  return String(randomInt(CUSTOMER_ID_MIN, CUSTOMER_ID_MIN + CUSTOMER_ID_SPACE));
}

/** True for a well-formed nine-digit identifier. */
export function isValidCustomerId(value: string): boolean {
  return typeof value === 'string' && CUSTOMER_ID_PATTERN.test(value);
}

/** True for either an current nine-digit or a preserved legacy six-digit identifier. */
export function isKnownCustomerIdFormat(value: string): boolean {
  return typeof value === 'string' && CUSTOMER_ID_DB_PATTERN.test(value);
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
  /** Chosen (or derived) at registration. Uniqueness is enforced by the database. */
  username: string;
  role?: UserRole;
  securityNumberHash?: string | null;
  securityNumberExpiresAt?: Date | null;
  /** Keyed hash + salt of the first four-digit Security PIN (see security-pin-service.ts). */
  securityPinHash?: string | null;
  securityPinSalt?: string | null;
  /** Sealed (AES-GCM) copy of the same PIN, for the verified reveal path. */
  securityPinEncrypted?: string | null;
  securityPinExpiresAt?: Date | null;
}

export interface CreateUserWithIdentityResult {
  user: UserRecord;
  /** How many Customer ID candidates had to be tried (1 in the overwhelmingly common case). */
  attempts: number;
}

/**
 * Creates a user with a guaranteed-unique nine-digit Customer ID, retrying only on a Customer ID
 * collision. A duplicate *email* or *username* is a real, user-facing conflict and is rethrown
 * immediately rather than being retried — otherwise a registration with an already-used value
 * would spin the loop.
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
        username: input.username,
        role: input.role,
        customerId,
        securityNumberHash: input.securityNumberHash ?? null,
        securityNumberExpiresAt: input.securityNumberExpiresAt ?? null,
        securityPinHash: input.securityPinHash ?? null,
        securityPinSalt: input.securityPinSalt ?? null,
        securityPinEncrypted: input.securityPinEncrypted ?? null,
        securityPinExpiresAt: input.securityPinExpiresAt ?? null,
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
 * created by an out-of-band import; migration 0085 already backfills). Once assigned the value is
 * immutable — the trigger installed by 0085 rejects any later change.
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
