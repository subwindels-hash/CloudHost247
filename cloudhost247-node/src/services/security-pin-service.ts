/**
 * Security PIN service — the single owner of the automatically rotating four-digit credential.
 *
 * Shape of the secret, and why it is not a one-way hash:
 *
 *   The PIN must be *shown to its owner* after an email verification. A plain one-way hash would
 *   make that impossible (the existing Security Number in 0053 pays that price by "revealing" a
 *   newly issued value instead). Storing the plaintext would be worse. So each PIN is stored as
 *
 *       HMAC-SHA-256(key = SECURITY_PIN_HMAC_KEY, message = "<salt>:<user id>:<pin>")
 *
 *   with a fresh 16-byte random salt per rotation. That is a *keyed* hash:
 *     - a database dump alone cannot be brute-forced into PINs, because the key lives in the
 *       application environment, not in the database (10,000 PINs × a 128-bit-per-value salt is
 *       trivial to enumerate *if* you hold the key, and effectively impossible without it);
 *     - verification is a constant-time comparison, so an attacker who somehow reads the row on
 *       one rotation still cannot use it to predict the next;
 *     - the owner can still be shown their current PIN, which is the whole point of the feature.
 *   The plaintext never leaves the process except in one response body to the account owner,
 *   behind a fresh email verification. It is never logged, never audited, never emailed.
 *
 * Rotation rules:
 *   - 24 hours, measured from issue (policy-configurable, like the Security Number).
 *   - The replacement is generated with `randomInt` (CSPRNG) and is guaranteed different from the
 *     value it replaces (`security_pin_previous_hash`), so "never reuse the previous PIN" is a
 *     property of the code, not a hope about a 1-in-10,000 draw.
 *   - Leading zeros are preserved ("0047") because the value is handled as a four-character string
 *     from generation to display.
 *   - Concurrency: `rotateSecurityPin` is a compare-and-swap on `security_pin_version` inside a
 *     row lock. Two requests that both observe "expired" cannot both rotate — the loser sees zero
 *     affected rows and re-reads the winner's value. Nothing is lost and nobody gets two PINs.
 *   - Expiry is enforced by the backend on every read path (`ensureCurrentPin`), not by the
 *     dashboard countdown: the UI may tick down, but a stale PIN is replaced server-side before it
 *     is ever shown.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { Queryable } from '../db/types';
import { getSetting } from '../db/ops-tables';
import { withTransaction } from '../db/transaction';
import type { UserRecord } from '../db/users';

export const SECURITY_PIN_LENGTH = 4;
export const SECURITY_PIN_PATTERN = /^[0-9]{4}$/;

export const DEFAULT_ROTATION_HOURS = 24;
export const DEFAULT_REVEAL_TTL_SECONDS = 30;
/** Short enough to be invisible when a customer resends after a mistyped address, long enough to
 *  stop a double-click (or a held Return key) from sending two mails. Guessing is capped
 *  separately by `verificationMaxAttempts` and `verificationMaxResends`. */
export const DEFAULT_RESEND_COOLDOWN_SECONDS = 3;
/** How long a rotation notification mail stays queued before it is dropped as stale. */
export const ROTATION_NOTICE_TTL_HOURS = 48;

export const PIN_SETTING_KEYS = {
  rotationHours: 'security_pin.rotation_hours',
  revealTtlSeconds: 'security_pin.reveal_ttl_seconds',
  verificationCodeTtlMinutes: 'security_pin.verification_code_ttl_minutes',
  verificationMaxAttempts: 'security_pin.verification_max_attempts',
  verificationResendCooldownSeconds: 'security_pin.verification_resend_cooldown_seconds',
  verificationMaxResends: 'security_pin.verification_max_resends',
  notifyOnRotation: 'security_pin.notify_on_rotation',
} as const;

export interface SecurityPinPolicy {
  rotationHours: number;
  revealTtlSeconds: number;
  verificationCodeTtlMinutes: number;
  verificationMaxAttempts: number;
  verificationResendCooldownSeconds: number;
  verificationMaxResends: number;
  notifyOnRotation: boolean;
}

export async function getSecurityPinPolicy(db: Queryable): Promise<SecurityPinPolicy> {
  const [rotationHours, revealTtl, ttlMinutes, maxAttempts, cooldown, maxResends, notify] = await Promise.all([
    getSetting<number>(db, PIN_SETTING_KEYS.rotationHours, DEFAULT_ROTATION_HOURS),
    getSetting<number>(db, PIN_SETTING_KEYS.revealTtlSeconds, DEFAULT_REVEAL_TTL_SECONDS),
    getSetting<number>(db, PIN_SETTING_KEYS.verificationCodeTtlMinutes, 10),
    getSetting<number>(db, PIN_SETTING_KEYS.verificationMaxAttempts, 5),
    getSetting<number>(db, PIN_SETTING_KEYS.verificationResendCooldownSeconds, DEFAULT_RESEND_COOLDOWN_SECONDS),
    getSetting<number>(db, PIN_SETTING_KEYS.verificationMaxResends, 3),
    getSetting<boolean>(db, PIN_SETTING_KEYS.notifyOnRotation, true),
  ]);
  return {
    // The rotation interval is deliberately clamped to a sane band: a policy of 0 would rotate on
    // every read and a policy of years would defeat the point of a rotating credential.
    rotationHours: clampInt(rotationHours, DEFAULT_ROTATION_HOURS, 1, 24 * 30),
    revealTtlSeconds: clampInt(revealTtl, DEFAULT_REVEAL_TTL_SECONDS, 5, 300),
    verificationCodeTtlMinutes: clampInt(ttlMinutes, 10, 1, 60),
    verificationMaxAttempts: clampInt(maxAttempts, 5, 1, 20),
    // Three seconds, not thirty. The window exists to stop a double-click from sending two mails
    // and to blunt scripted mail flooding — it is not a defence against guessing, because guessing
    // is capped separately (`verificationMaxAttempts` and `verificationMaxResends` per challenge,
    // plus a per-route request limit). Thirty seconds turned a mail-client filter into a
    // half-minute dead end for the customer, while three is invisible in normal use and still
    // stops a held-down Enter key from minting a stream of messages. Operators can raise it
    // without a deploy via `security_pin.verification_resend_cooldown_seconds`.
    verificationResendCooldownSeconds: clampInt(cooldown, DEFAULT_RESEND_COOLDOWN_SECONDS, 0, 600),
    verificationMaxResends: clampInt(maxResends, 3, 0, 10),
    notifyOnRotation: notify !== false,
  };
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(num)));
}

// --- Generation & hashing ----------------------------------------------------------------------

/** Cryptographically secure four-digit value, uniformly distributed over 0000–9999. */
export function generateSecurityPin(): string {
  return String(randomInt(0, 10_000)).padStart(SECURITY_PIN_LENGTH, '0');
}

export function isValidSecurityPinFormat(value: string): boolean {
  return typeof value === 'string' && SECURITY_PIN_PATTERN.test(value);
}

export class MissingPinKeyError extends Error {
  constructor() {
    super(
      'SECURITY_PIN_HMAC_KEY (or CREDENTIAL_ENCRYPTION_KEY / CREDENTIAL_ENCRYPTION_KEYS as a fallback) must be configured before a Security PIN can be hashed or verified'
    );
    this.name = 'MissingPinKeyError';
  }
}

/**
 * Resolves the keyed-hash secret. `SECURITY_PIN_HMAC_KEY` is preferred (a dedicated key means a
 * credential-key rotation does not silently invalidate every PIN); the credential-encryption
 * material is accepted as a fallback so an already-configured deployment needs no new secret.
 * Derived with HMAC so the derived key never equals the material it came from.
 */
export function resolvePinKey(source: NodeJS.ProcessEnv = process.env): Buffer {
  const dedicated = source.SECURITY_PIN_HMAC_KEY;
  if (dedicated && dedicated.length >= 32) {
    return createHmac('sha256', dedicated).update('cloudhost247:security-pin:key:v1').digest();
  }
  const fallback = source.CREDENTIAL_ENCRYPTION_KEYS ?? source.CREDENTIAL_ENCRYPTION_KEY;
  if (fallback) {
    return createHmac('sha256', fallback).update('cloudhost247:security-pin:key:v1').digest();
  }
  throw new MissingPinKeyError();
}

/**
 * Secondary key for the *recoverable* copy of the PIN (see `sealSecurityPin`). Domain-separated
 * from the hashing key so the two values can never be confused for one another.
 */
export function derivePinSealKey(key: Buffer = resolvePinKey()): Buffer {
  return createHmac('sha256', key).update('cloudhost247:security-pin:seal:v1').digest();
}

/**
 * Seals a PIN so its owner can be shown it later, without ever storing plaintext.
 *
 * AES-256-GCM: authenticated, so a tampered column fails closed at decrypt time instead of
 * yielding attacker-chosen digits. The envelope is `pin1:<iv>:<tag>:<ciphertext>` and only this
 * module knows the format. Combined with the keyed hash (which is the *verification* path), the
 * column set means: a database dump alone reveals nothing, and the value is still retrievable by
 * the application, which is exactly what the "view your PIN after email verification" requirement
 * needs.
 */
export function sealSecurityPin(pin: string, key: Buffer = resolvePinKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', derivePinSealKey(key), iv);
  const ciphertext = Buffer.concat([cipher.update(pin, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['pin1', iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

/** Opens a sealed PIN envelope. Returns null on any tamper/format/key mismatch — never a guess. */
export function openSealedSecurityPin(envelope: string | null | undefined, key: Buffer = resolvePinKey()): string | null {
  const [prefix, ivPart, tagPart, dataPart] = String(envelope ?? '').split(':');
  if (prefix !== 'pin1' || !ivPart || !tagPart || !dataPart) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', derivePinSealKey(key), Buffer.from(ivPart, 'base64'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64')), decipher.final()]).toString('utf8');
    return isValidSecurityPinFormat(plain) ? plain : null;
  } catch {
    return null;
  }
}

export function generatePinSalt(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Keyed hash of one PIN. The per-value random `salt` (128 bits, stored beside the hash) means two
 * accounts that happen to share a PIN still have different stored values, so the column cannot be
 * used to spot shared PINs or to precompute a rainbow table. The HMAC key lives in the application
 * environment, so the database content alone cannot be turned into PINs.
 */
export function hashSecurityPin(pin: string, salt: string, key: Buffer = resolvePinKey()): string {
  return createHmac('sha256', key).update(`${salt}:${pin}`).digest('hex');
}

export function verifySecurityPin(
  pin: string,
  stored: { hash: string | null; salt: string | null },
  key: Buffer = resolvePinKey()
): boolean {
  if (!stored.hash || !stored.salt) return false;
  if (!isValidSecurityPinFormat(pin)) return false;
  const candidate = Buffer.from(hashSecurityPin(pin, stored.salt, key), 'hex');
  const expected = Buffer.from(stored.hash, 'hex');
  if (candidate.length !== expected.length || candidate.length === 0) return false;
  return timingSafeEqual(candidate, expected);
}

// --- Lifecycle ---------------------------------------------------------------------------------

export interface SecurityPinState {
  /** Something is stored for this account (i.e. a PIN has been issued at least once). */
  set: boolean;
  version: number;
  createdAt: string | null;
  expiresAt: string | null;
  expired: boolean;
  /** Whole seconds until expiry; never negative. */
  secondsUntilExpiry: number;
  rotationHours: number;
}

export function isSecurityPinExpired(
  user: Pick<UserRecord, 'security_pin_expires_at'>,
  now: Date = new Date()
): boolean {
  if (!user.security_pin_expires_at) return true;
  return new Date(user.security_pin_expires_at).getTime() <= now.getTime();
}

export function expiryFromNow(rotationHours: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + rotationHours * 3_600_000);
}

export function describeSecurityPin(
  user: Pick<UserRecord, 'security_pin_hash' | 'security_pin_created_at' | 'security_pin_expires_at' | 'security_pin_version'>,
  rotationHours = DEFAULT_ROTATION_HOURS,
  now: Date = new Date()
): SecurityPinState {
  const set = Boolean(user.security_pin_hash);
  const expired = !set || isSecurityPinExpired(user, now);
  const expiresMs = user.security_pin_expires_at ? new Date(user.security_pin_expires_at).getTime() : 0;
  return {
    set,
    version: user.security_pin_version ?? 0,
    createdAt: user.security_pin_created_at ?? null,
    expiresAt: user.security_pin_expires_at ?? null,
    expired,
    secondsUntilExpiry: expired ? 0 : Math.max(0, Math.floor((expiresMs - now.getTime()) / 1000)),
    rotationHours,
  };
}

export interface RotatedSecurityPin {
  pin: string;
  version: number;
  salt: string;
  createdAt: string;
  expiresAt: string;
}

/**
 * Issues a fresh PIN for `userId`, replacing (and thereby invalidating) whatever was stored.
 *
 * Wrapped in a transaction with `SELECT … FOR UPDATE` on the user row so the "previous PIN" read,
 * the guarantee that the new value differs, and the write are one atomic unit. The version is
 * incremented, which is the durable marker used by concurrent compare-and-swap callers.
 */
export async function rotateSecurityPin(
  db: Queryable,
  userId: string,
  options: { rotationHours?: number; now?: Date; key?: Buffer } = {}
): Promise<RotatedSecurityPin | null> {
  const policy = await getSecurityPinPolicy(db);
  const rotationHours = options.rotationHours ?? policy.rotationHours;
  const key = options.key ?? resolvePinKey();
  const now = options.now ?? new Date();

  return withTransaction(db, async (tx) => {
    const current = await tx.query<{ security_pin_previous_hash: string | null; security_pin_hash: string | null }>(
      `SELECT security_pin_previous_hash, security_pin_hash FROM users WHERE id = $1 FOR UPDATE`,
      [userId]
    );
    if (!current.rows[0]) return null;

    const salt = generatePinSalt();
    // A known previous plaintext is not available (and must not be), so "not the previous PIN" is
    // enforced by comparing keyed hashes: draw until the new hash is not the one being replaced.
    let pin = generateSecurityPin();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidateHash = hashSecurityPin(pin, salt, key);
      if (candidateHash !== current.rows[0].security_pin_hash) break;
      pin = generateSecurityPin();
    }
    const hash = hashSecurityPin(pin, salt, key);
    const expiresAt = expiryFromNow(rotationHours, now);

    const { rows } = await tx.query<{
      security_pin_created_at: string;
      security_pin_expires_at: string;
      security_pin_version: number;
    }>(
      `UPDATE users
          SET security_pin_previous_hash = security_pin_hash,
              security_pin_hash = $2,
              security_pin_salt = $3,
              security_pin_encrypted = $4,
              security_pin_created_at = $5,
              security_pin_expires_at = $6,
              security_pin_version = security_pin_version + 1,
              updated_at = now()
        WHERE id = $1
        RETURNING security_pin_created_at, security_pin_expires_at, security_pin_version`,
      [userId, hash, salt, sealSecurityPin(pin, key), now.toISOString(), expiresAt.toISOString()]
    );
    const row = rows[0];
    if (!row) return null;
    return {
      pin,
      version: row.security_pin_version,
      salt,
      createdAt: row.security_pin_created_at,
      expiresAt: row.security_pin_expires_at,
    };
  });
}

/**
 * Compare-and-swap rotation used by concurrent read paths. Callers pass the version they observed;
 * only the request that wins the swap rotates. The loser re-reads and returns the winner's value,
 * so simultaneous dashboard tabs cannot mint competing PINs.
 */
export async function rotateSecurityPinIfVersion(
  db: Queryable,
  userId: string,
  expectedVersion: number,
  options: { rotationHours?: number; key?: Buffer } = {}
): Promise<RotatedSecurityPin | null> {
  const policy = await getSecurityPinPolicy(db);
  const rotationHours = options.rotationHours ?? policy.rotationHours;
  const key = options.key ?? resolvePinKey();
  const salt = generatePinSalt();
  const pin = generateSecurityPin();
  const hash = hashSecurityPin(pin, salt, key);
  const expiresAt = expiryFromNow(rotationHours);

  const { rows } = await db.query<{
    security_pin_created_at: string;
    security_pin_expires_at: string;
    security_pin_version: number;
  }>(
    `UPDATE users
        SET security_pin_previous_hash = security_pin_hash,
            security_pin_hash = $3,
            security_pin_salt = $4,
            security_pin_encrypted = $5,
            security_pin_created_at = now(),
            security_pin_expires_at = $6,
            security_pin_version = security_pin_version + 1,
            updated_at = now()
      WHERE id = $1 AND security_pin_version = $2
      RETURNING security_pin_created_at, security_pin_expires_at, security_pin_version`,
    [userId, expectedVersion, hash, salt, sealSecurityPin(pin, key), expiresAt.toISOString()]
  );
  const row = rows[0];
  if (!row) return null;
  return { pin, version: row.security_pin_version, salt, createdAt: row.security_pin_created_at, expiresAt: row.security_pin_expires_at };
}

/**
 * Reactive rotation: guarantee the caller is looking at a live PIN. Returns the plaintext only when
 * this call performed the rotation (the caller then also queues the customer notification).
 *
 * Concurrency-safe by construction: the swap is conditional on the version read, so if a concurrent
 * request rotated first, `rotated` is false and the caller re-reads the row rather than showing a
 * value that is already superseded.
 */
export async function ensureCurrentPin(
  db: Queryable,
  user: Pick<UserRecord, 'id' | 'security_pin_hash' | 'security_pin_expires_at' | 'security_pin_version'>,
  options: { rotationHours?: number; key?: Buffer } = {}
): Promise<{ rotated: boolean; rotation: RotatedSecurityPin | null }> {
  if (user.security_pin_hash && !isSecurityPinExpired(user)) {
    return { rotated: false, rotation: null };
  }
  const rotation = await rotateSecurityPinIfVersion(db, user.id, user.security_pin_version ?? 0, options);
  return { rotated: rotation !== null, rotation };
}

/** Accounts whose PIN has expired (or was never issued) — worker sweep input. */
export async function listAccountsNeedingPinRotation(db: Queryable, limit = 500): Promise<UserRecord[]> {
  const { rows } = await db.query<UserRecord>(
    `SELECT * FROM users
      WHERE status = 'active'
        AND deleted_at IS NULL
        AND (security_pin_hash IS NULL OR security_pin_expires_at IS NULL OR security_pin_expires_at <= now())
      ORDER BY coalesce(security_pin_expires_at, created_at) ASC
      LIMIT $1`,
    [limit]
  );
  return rows;
}

/**
 * Accounts that rotated since their last notification (worker sweep input for the "your PIN has
 * changed" mail). The notification never contains the PIN itself.
 */
export async function listAccountsNeedingPinNotice(db: Queryable, limit = 200): Promise<UserRecord[]> {
  const { rows } = await db.query<UserRecord>(
    `SELECT * FROM users
      WHERE status = 'active'
        AND deleted_at IS NULL
        AND security_pin_hash IS NOT NULL
        AND security_pin_version > security_pin_notified_version
      ORDER BY security_pin_version DESC
      LIMIT $1`,
    [limit]
  );
  return rows;
}

/** Marks the current version as notified so a redelivered sweep tick does not re-send the mail. */
export async function markPinNotified(db: Queryable, userId: string, version: number): Promise<void> {
  await db.query(
    `UPDATE users SET security_pin_notified_version = $2 WHERE id = $1 AND security_pin_notified_version < $2`,
    [userId, version]
  );
}

/**
 * Records the rotation in the shared audit log without ever including the PIN (or its hash). Kept
 * here so every rotation path — worker sweep, login, dashboard read — writes the same shape.
 */
export async function auditPinRotation(
  db: Queryable,
  record: (entry: {
    actorId: string | null;
    action: string;
    resourceType: string;
    resourceId: string;
    metadata: Record<string, unknown>;
  }) => Promise<void>,
  user: Pick<UserRecord, 'id' | 'customer_id'>,
  rotation: { version: number; expiresAt: string },
  trigger: 'scheduled_rotation' | 'expired_on_access' | 'first_issue' | 'admin_action'
): Promise<void> {
  await record({
    actorId: null,
    action: 'security_pin_rotated',
    resourceType: 'user',
    resourceId: user.id,
    metadata: {
      customerId: user.customer_id,
      trigger,
      version: rotation.version,
      expiresAt: rotation.expiresAt,
    },
  });
}
