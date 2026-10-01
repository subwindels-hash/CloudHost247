/**
 * TOTP multi-factor authentication.
 *
 * Secrets use the existing versioned AES-GCM credential key ring; recovery codes and login
 * challenges are persisted only as SHA-256 hashes. The implementation is dependency-free but
 * interoperable with RFC 6238 authenticator applications (SHA-1, six digits, 30-second period).
 */
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { Env } from '../config/env';
import { buildKeyRing, decryptSecret, encryptSecret, safeEqual } from '../lib/crypto';
import type { Queryable } from '../db/types';
import { withTransaction } from '../db/transaction';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
const LOGIN_CHALLENGE_MINUTES = 5;
const LOGIN_CHALLENGE_MAX_ATTEMPTS = 5;
const RECOVERY_CODE_COUNT = 10;

type MfaEnv = Pick<Env, 'JWT_SECRET' | 'CREDENTIAL_ENCRYPTION_KEY' | 'CREDENTIAL_ENCRYPTION_KEYS'>;

interface TotpRow {
  user_id: string;
  secret_encrypted: string;
  confirmed_at: string | null;
  last_used_timestep: number | string | null;
}

interface LoginChallengeRow {
  id: string;
  user_id: string;
  session_version: number | string;
  attempts: number;
  max_attempts: number;
  expires_at: string;
  used_at: string | null;
}

export interface MfaStatus {
  enabled: boolean;
  recoveryCodesRemaining: number;
}

export type MfaMethod = 'totp' | 'recovery_code';

function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Base32 without padding, as accepted by mainstream authenticator applications. */
export function encodeBase32(bytes: Buffer): string {
  let buffer = 0;
  let bits = 0;
  let result = '';
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += BASE32[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) result += BASE32[(buffer << (5 - bits)) & 31];
  return result;
}

export function decodeBase32(value: string): Buffer {
  const normalized = value.toUpperCase().replace(/[\s=-]/g, '');
  let buffer = 0;
  let bits = 0;
  const output: number[] = [];
  for (const char of normalized) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('Malformed TOTP secret');
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function totpAt(secret: string, timestep: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(timestep));
  const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const number = ((digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** TOTP_DIGITS).toString();
  return number.padStart(TOTP_DIGITS, '0');
}

/** Returns the accepted timestep (one period either side for minor clock skew), not merely true. */
export function verifyTotp(secret: string, code: string, now = new Date()): number | null {
  const normalized = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(normalized)) return null;
  const current = Math.floor(now.getTime() / 1000 / TOTP_PERIOD_SECONDS);
  for (const offset of [0, -1, 1]) {
    const timestep = current + offset;
    if (safeEqual(totpAt(secret, timestep), normalized)) return timestep;
  }
  return null;
}

function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function recoveryCode(): string {
  // 80 random bits, formatted solely for a human to transcribe; only its SHA-256 digest is stored.
  const raw = randomBytes(10).toString('hex').toUpperCase();
  return raw.match(/.{1,4}/g)?.join('-') ?? raw;
}

function encryptionRing(env: MfaEnv) {
  return buildKeyRing(env.CREDENTIAL_ENCRYPTION_KEY, env.CREDENTIAL_ENCRYPTION_KEYS);
}

function deriveMfaChallengeToken(jwtSecret: string, challengeId: string): string {
  return createHmac('sha256', jwtSecret).update(`cloudhost247:mfa-login:v1:${challengeId}`).digest('base64url');
}

export async function getMfaStatus(db: Queryable, userId: string): Promise<MfaStatus> {
  const result = await db.query<{ enabled: boolean; recovery_codes_remaining: number | string }>(
    `SELECT EXISTS(
       SELECT 1 FROM user_mfa_totp WHERE user_id=$1 AND confirmed_at IS NOT NULL
     ) enabled,
     (SELECT count(*)::int FROM user_mfa_recovery_codes WHERE user_id=$1 AND used_at IS NULL) recovery_codes_remaining`,
    [userId]
  );
  const row = result.rows[0];
  return { enabled: Boolean(row?.enabled), recoveryCodesRemaining: Number(row?.recovery_codes_remaining ?? 0) };
}

/** Begins enrollment and returns a secret exactly once to the authenticated browser. */
export async function beginTotpEnrollment(
  db: Queryable,
  env: MfaEnv,
  user: { id: string; email: string }
): Promise<{ alreadyEnabled: boolean; secret?: string; otpauthUrl?: string }> {
  const existing = await db.query<{ confirmed_at: string | null }>(`SELECT confirmed_at FROM user_mfa_totp WHERE user_id=$1`, [user.id]);
  if (existing.rows[0]?.confirmed_at) return { alreadyEnabled: true };

  const secret = encodeBase32(randomBytes(20));
  const encrypted = encryptSecret(encryptionRing(env), secret);
  await withTransaction(db, async (tx) => {
    await tx.query(`DELETE FROM user_mfa_recovery_codes WHERE user_id=$1`, [user.id]);
    await tx.query(
      `INSERT INTO user_mfa_totp (user_id,secret_encrypted,confirmed_at,last_used_timestep,updated_at)
       VALUES ($1,$2,NULL,NULL,now())
       ON CONFLICT (user_id) DO UPDATE SET
         secret_encrypted=EXCLUDED.secret_encrypted,confirmed_at=NULL,last_used_timestep=NULL,updated_at=now()`,
      [user.id, encrypted]
    );
  });
  const label = encodeURIComponent(`CloudHost247:${user.email}`);
  const issuer = encodeURIComponent('CloudHost247');
  const otpauthUrl = `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
  return { alreadyEnabled: false, secret, otpauthUrl };
}

/** Confirms a pending enrollment, then returns recovery codes exactly once. */
export async function confirmTotpEnrollment(
  db: Queryable,
  env: MfaEnv,
  userId: string,
  code: string
): Promise<{ confirmed: boolean; recoveryCodes: string[] }> {
  return withTransaction(db, async (tx) => {
    const selected = await tx.query<TotpRow>(`SELECT * FROM user_mfa_totp WHERE user_id=$1 FOR UPDATE`, [userId]);
    const row = selected.rows[0];
    if (!row || row.confirmed_at) return { confirmed: false, recoveryCodes: [] };
    const timestep = verifyTotp(decryptSecret(encryptionRing(env), row.secret_encrypted), code);
    if (timestep === null) return { confirmed: false, recoveryCodes: [] };

    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, recoveryCode);
    await tx.query(
      `UPDATE user_mfa_totp
          SET confirmed_at=now(),last_used_timestep=$2,updated_at=now()
        WHERE user_id=$1`,
      [userId, timestep]
    );
    for (const value of codes) {
      await tx.query(
        `INSERT INTO user_mfa_recovery_codes (id,user_id,code_hash) VALUES ($1,$2,$3)`,
        [randomUUID(), userId, hashValue(normalizeRecoveryCode(value))]
      );
    }
    return { confirmed: true, recoveryCodes: codes };
  });
}

export async function issueMfaLoginChallenge(
  db: Queryable,
  jwtSecret: string,
  userId: string,
  sessionVersion: number
): Promise<string> {
  return withTransaction(db, async (tx) => {
    // A new password-authenticated login replaces any unfinished MFA challenge for that account.
    await tx.query(`UPDATE auth_mfa_login_challenges SET used_at=now() WHERE user_id=$1 AND used_at IS NULL`, [userId]);
    const id = randomUUID();
    const token = deriveMfaChallengeToken(jwtSecret, id);
    await tx.query(
      `INSERT INTO auth_mfa_login_challenges (id,user_id,token_hash,session_version,max_attempts,expires_at)
       VALUES ($1,$2,$3,$4,$5,now() + ($6 || ' minutes')::interval)`,
      [id, userId, hashValue(token), sessionVersion, LOGIN_CHALLENGE_MAX_ATTEMPTS, String(LOGIN_CHALLENGE_MINUTES)]
    );
    return token;
  });
}

async function verifyFactorInTransaction(
  tx: Queryable,
  env: MfaEnv,
  row: TotpRow,
  code: string
): Promise<MfaMethod | null> {
  if (!row.confirmed_at) return null;
  const secret = decryptSecret(encryptionRing(env), row.secret_encrypted);
  const timestep = verifyTotp(secret, code);
  const lastUsed = row.last_used_timestep === null ? null : Number(row.last_used_timestep);
  if (timestep !== null && (lastUsed === null || timestep > lastUsed)) {
    await tx.query(`UPDATE user_mfa_totp SET last_used_timestep=$2,updated_at=now() WHERE user_id=$1`, [row.user_id, timestep]);
    return 'totp';
  }

  const normalizedRecovery = normalizeRecoveryCode(code);
  if (!normalizedRecovery) return null;
  const used = await tx.query<{ id: string }>(
    `UPDATE user_mfa_recovery_codes
        SET used_at=now()
      WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL
      RETURNING id`,
    [row.user_id, hashValue(normalizedRecovery)]
  );
  return used.rows[0] ? 'recovery_code' : null;
}

export interface MfaLoginVerification {
  success: boolean;
  userId: string | null;
  sessionVersion: number | null;
  method: MfaMethod | null;
}

/** Validates and consumes one short-lived password-login MFA challenge. */
export async function completeMfaLogin(
  db: Queryable,
  env: MfaEnv,
  challengeToken: string,
  code: string
): Promise<MfaLoginVerification> {
  return withTransaction(db, async (tx) => {
    const challenge = await tx.query<LoginChallengeRow>(
      `SELECT * FROM auth_mfa_login_challenges WHERE token_hash=$1 FOR UPDATE`,
      [hashValue(challengeToken)]
    );
    const row = challenge.rows[0];
    if (!row || row.used_at || new Date(row.expires_at).getTime() <= Date.now()) {
      return { success: false, userId: null, sessionVersion: null, method: null };
    }
    if (row.attempts >= row.max_attempts) {
      await tx.query(`UPDATE auth_mfa_login_challenges SET used_at=now() WHERE id=$1`, [row.id]);
      return { success: false, userId: row.user_id, sessionVersion: null, method: null };
    }

    // A reset/change can happen after the password was checked but before its second factor is
    // entered. Bind the continuation to the same session version so that stale password-login
    // challenges cannot survive that reset.
    const currentSession = await tx.query<{ auth_session_version: number | string }>(
      `SELECT auth_session_version FROM users WHERE id=$1 FOR UPDATE`,
      [row.user_id]
    );
    if (Number(currentSession.rows[0]?.auth_session_version) !== Number(row.session_version)) {
      await tx.query(`UPDATE auth_mfa_login_challenges SET used_at=now() WHERE id=$1`, [row.id]);
      return { success: false, userId: row.user_id, sessionVersion: null, method: null };
    }

    const factor = await tx.query<TotpRow>(`SELECT * FROM user_mfa_totp WHERE user_id=$1 FOR UPDATE`, [row.user_id]);
    const method = factor.rows[0] ? await verifyFactorInTransaction(tx, env, factor.rows[0], code) : null;
    if (!method) {
      await tx.query(
        `UPDATE auth_mfa_login_challenges
            SET attempts=attempts+1,used_at=CASE WHEN attempts + 1 >= max_attempts THEN now() ELSE used_at END
          WHERE id=$1`,
        [row.id]
      );
      return { success: false, userId: row.user_id, sessionVersion: null, method: null };
    }
    await tx.query(`UPDATE auth_mfa_login_challenges SET used_at=now() WHERE id=$1`, [row.id]);
    return { success: true, userId: row.user_id, sessionVersion: Number(row.session_version), method };
  });
}

/** Requires a current TOTP/recovery factor and removes MFA in the same transaction. */
export async function disableTotpMfa(db: Queryable, env: MfaEnv, userId: string, code: string): Promise<MfaMethod | null> {
  return withTransaction(db, async (tx) => {
    const selected = await tx.query<TotpRow>(`SELECT * FROM user_mfa_totp WHERE user_id=$1 FOR UPDATE`, [userId]);
    const row = selected.rows[0];
    if (!row) return null;
    const method = await verifyFactorInTransaction(tx, env, row, code);
    if (!method) return null;
    // Recovery codes cascade with the MFA row; delete explicitly for clarity and compatibility.
    await tx.query(`DELETE FROM user_mfa_recovery_codes WHERE user_id=$1`, [userId]);
    await tx.query(`DELETE FROM user_mfa_totp WHERE user_id=$1`, [userId]);
    return method;
  });
}

export const __private__ = { deriveMfaChallengeToken, hashValue, normalizeRecoveryCode, totpAt };
