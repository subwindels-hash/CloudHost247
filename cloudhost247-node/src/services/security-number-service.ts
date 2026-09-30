/**
 * Security Number service — the single, centralized owner of the four-digit rotating credential.
 *
 * Non-negotiable rules encoded here (spec §7–§20):
 *   - Generated with Node's CSPRNG (`randomInt`), never `Math.random()`.
 *   - Only a bcrypt hash is ever persisted (`users.security_number_hash`). The plaintext exists
 *     only in the response to the request that generated it, and is never logged, never put in a
 *     JWT, never written to an audit row, and never returned to an administrator.
 *   - Every value expires. The rotation interval is policy-driven (default 24 hours) and is
 *     enforced two ways so an account can never be left stuck with an expired number: proactively
 *     by the worker sweep, and reactively the moment an expired number is observed.
 *   - Every rotation increments `security_number_version`, which is what makes the previous value
 *     unusable even if someone still remembers it (the hash is replaced in the same statement).
 *
 * No route builds its own hashing/rotation logic; they all call this module.
 */
import { randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Queryable } from '../db/types';
import { getSetting } from '../db/ops-tables';
import type { UserRecord } from '../db/users';

const SALT_ROUNDS = 12;

export const SECURITY_NUMBER_LENGTH = 4;
export const SECURITY_NUMBER_PATTERN = /^[0-9]{4}$/;

export const DEFAULT_ROTATION_HOURS = 24;
export const DEFAULT_MAX_ATTEMPTS = 5;
export const DEFAULT_ATTEMPT_WINDOW_SECONDS = 60;
export const DEFAULT_SUPPORT_SESSION_MINUTES = 30;

export const SETTING_KEYS = {
  rotationHours: 'security_number.rotation_hours',
  allowManualRotation: 'security_number.allow_manual_rotation',
  requireStepUp: 'security_number.require_step_up',
  maxAttempts: 'security_number.max_verification_attempts',
  attemptWindowSeconds: 'security_number.attempt_window_seconds',
  revealTtlSeconds: 'security_number.reveal_ttl_seconds',
  supportSessionMinutes: 'support_mode.session_minutes',
} as const;

export interface SecurityNumberPolicy {
  rotationHours: number;
  allowManualRotation: boolean;
  requireStepUp: boolean;
  maxAttempts: number;
  attemptWindowSeconds: number;
  revealTtlSeconds: number;
  supportSessionMinutes: number;
}

/** Reads the Super Admin-configurable policy from platform_settings, falling back to the
 * documented defaults when a key has never been set. */
export async function getSecurityNumberPolicy(db: Queryable): Promise<SecurityNumberPolicy> {
  const [rotationHours, allowManualRotation, requireStepUp, maxAttempts, attemptWindowSeconds, revealTtlSeconds, supportSessionMinutes] =
    await Promise.all([
      getSetting<number>(db, SETTING_KEYS.rotationHours, DEFAULT_ROTATION_HOURS),
      getSetting<boolean>(db, SETTING_KEYS.allowManualRotation, true),
      getSetting<boolean>(db, SETTING_KEYS.requireStepUp, true),
      getSetting<number>(db, SETTING_KEYS.maxAttempts, DEFAULT_MAX_ATTEMPTS),
      getSetting<number>(db, SETTING_KEYS.attemptWindowSeconds, DEFAULT_ATTEMPT_WINDOW_SECONDS),
      getSetting<number>(db, SETTING_KEYS.revealTtlSeconds, 120),
      getSetting<number>(db, SETTING_KEYS.supportSessionMinutes, DEFAULT_SUPPORT_SESSION_MINUTES),
    ]);

  return {
    rotationHours: clampPositive(rotationHours, DEFAULT_ROTATION_HOURS),
    allowManualRotation: allowManualRotation !== false,
    requireStepUp: requireStepUp !== false,
    maxAttempts: clampPositive(maxAttempts, DEFAULT_MAX_ATTEMPTS),
    attemptWindowSeconds: clampPositive(attemptWindowSeconds, DEFAULT_ATTEMPT_WINDOW_SECONDS),
    revealTtlSeconds: clampPositive(revealTtlSeconds, 120),
    supportSessionMinutes: clampPositive(supportSessionMinutes, DEFAULT_SUPPORT_SESSION_MINUTES),
  };
}

function clampPositive(value: unknown, fallback: number): number {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

/** Cryptographically secure four-digit value, uniformly distributed over 0000–9999. */
export function generateSecurityNumber(): string {
  return String(randomInt(0, 10_000)).padStart(SECURITY_NUMBER_LENGTH, '0');
}

export function isValidSecurityNumberFormat(value: string): boolean {
  return SECURITY_NUMBER_PATTERN.test(value);
}

export async function hashSecurityNumber(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifySecurityNumberHash(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export interface SecurityNumberStatus {
  /** Whether this account has ever had a Security Number issued (false for legacy accounts). */
  initialized: boolean;
  version: number;
  createdAt: string | null;
  expiresAt: string | null;
  expired: boolean;
  /** Whole seconds until expiry; 0 when expired/uninitialized. Never negative. */
  secondsUntilExpiry: number;
  rotationHours: number;
}

export function isExpired(user: Pick<UserRecord, 'security_number_expires_at'>, now: Date = new Date()): boolean {
  if (!user.security_number_expires_at) return true;
  return new Date(user.security_number_expires_at).getTime() <= now.getTime();
}

export async function getStatus(
  db: Queryable,
  user: UserRecord,
  now: Date = new Date()
): Promise<SecurityNumberStatus> {
  const policy = await getSecurityNumberPolicy(db);
  const initialized = Boolean(user.security_number_initialized && user.security_number_hash);
  const expired = !initialized || isExpired(user, now);
  const expiresAtMs = user.security_number_expires_at ? new Date(user.security_number_expires_at).getTime() : 0;
  return {
    initialized,
    version: user.security_number_version ?? 1,
    createdAt: user.security_number_created_at,
    expiresAt: user.security_number_expires_at,
    expired,
    secondsUntilExpiry: expired ? 0 : Math.max(0, Math.floor((expiresAtMs - now.getTime()) / 1000)),
    rotationHours: policy.rotationHours,
  };
}

export function expiryFromNow(rotationHours: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + rotationHours * 3_600_000);
}

export interface RotationResult {
  /** Plaintext — returned to the *owner* of the account only, never persisted, never logged. */
  securityNumber: string;
  version: number;
  expiresAt: string;
  createdAt: string;
}

/**
 * Issues a brand-new Security Number for `userId`, replacing whatever was there. The hash, the
 * new 24-hour window (measured from *this* moment, per spec §14/§16) and the incremented version
 * are written in a single statement, so the old value stops working atomically.
 */
export async function rotateSecurityNumber(
  db: Queryable,
  userId: string,
  options: { plain?: string; rotationHours?: number } = {}
): Promise<RotationResult | null> {
  const policy = await getSecurityNumberPolicy(db);
  const rotationHours = options.rotationHours ?? policy.rotationHours;
  const plain = options.plain ?? generateSecurityNumber();
  if (!isValidSecurityNumberFormat(plain)) {
    throw new Error('Security Number must be exactly four digits');
  }
  const hash = await hashSecurityNumber(plain);
  const expiresAt = expiryFromNow(rotationHours);

  const { rows } = await db.query<{
    security_number_version: number;
    security_number_expires_at: string;
    security_number_created_at: string;
  }>(
    `UPDATE users
        SET security_number_hash = $2,
            security_number_created_at = now(),
            security_number_expires_at = $3,
            security_number_version = security_number_version + 1,
            security_number_initialized = true,
            updated_at = now()
      WHERE id = $1
      RETURNING security_number_version, security_number_expires_at, security_number_created_at`,
    [userId, hash, expiresAt]
  );

  const row = rows[0];
  if (!row) return null;
  return {
    securityNumber: plain,
    version: row.security_number_version,
    expiresAt: row.security_number_expires_at,
    createdAt: row.security_number_created_at,
  };
}

/**
 * Reactive rotation: if the stored number has expired (or was never initialized), issue a fresh
 * one immediately. This is what guarantees "the customer is never locked out because a worker
 * tick was missed" (spec §17) — any read path can call it safely.
 */
export async function rotateIfExpired(
  db: Queryable,
  user: UserRecord
): Promise<{ rotated: boolean; result: RotationResult | null }> {
  if (user.security_number_initialized && user.security_number_hash && !isExpired(user)) {
    return { rotated: false, result: null };
  }
  const result = await rotateSecurityNumber(db, user.id);
  return { rotated: result !== null, result };
}

/**
 * Forces the account back to the uninitialized state (admin "require re-initialization"). The
 * old hash is destroyed, so the previous number is dead immediately; the customer is issued a
 * fresh one on their next status check.
 */
export async function requireReinitialization(db: Queryable, userId: string): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE users
        SET security_number_hash = NULL,
            security_number_created_at = NULL,
            security_number_expires_at = NULL,
            security_number_initialized = false,
            security_number_version = security_number_version + 1,
            updated_at = now()
      WHERE id = $1
      RETURNING id`,
    [userId]
  );
  return rows.length > 0;
}

/** Accounts whose Security Number has expired (or was never issued) — worker sweep input. */
export async function listAccountsNeedingRotation(db: Queryable, limit = 500): Promise<UserRecord[]> {
  const { rows } = await db.query<UserRecord>(
    `SELECT * FROM users
      WHERE status = 'active'
        AND deleted_at IS NULL
        AND (security_number_initialized = false OR security_number_expires_at IS NULL OR security_number_expires_at <= now())
      ORDER BY coalesce(security_number_expires_at, created_at) ASC
      LIMIT $1`,
    [limit]
  );
  return rows;
}

// --- Verification attempt throttling ----------------------------------------------------------

export async function recordVerificationAttempt(
  db: Queryable,
  input: { id: string; userId: string; succeeded: boolean; ipAddress?: string | null }
): Promise<void> {
  await db.query(
    `INSERT INTO security_number_attempts (id, user_id, succeeded, ip_address) VALUES ($1, $2, $3, $4)`,
    [input.id, input.userId, input.succeeded, input.ipAddress ?? null]
  );
}

/** Failed attempts for this account inside the policy window (successful ones reset nothing —
 * they simply are not counted). */
export async function countRecentFailures(db: Queryable, userId: string, windowSeconds: number): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM security_number_attempts
      WHERE user_id = $1
        AND succeeded = false
        AND created_at > now() - ($2::text || ' seconds')::interval`,
    [userId, String(Math.floor(windowSeconds))]
  );
  return Number(rows[0]?.count ?? '0');
}
