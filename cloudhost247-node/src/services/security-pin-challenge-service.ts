/**
 * Security PIN viewing challenges — the "Verify it's you" gate in front of the PIN.
 *
 * Flow, and the property each step protects:
 *
 *   1. `POST …/view` (authenticated) — issue a six-digit code, mail it to the address **on the
 *      account**, and hand the browser an opaque challenge token (not the code). The code is
 *      never returned by any API, and it is never sent to an address supplied in the request: the
 *      request body has no email field at all, and the service reads the address from `users`.
 *   2. `POST …/resend` — rotation of the same challenge, throttled by a cooldown *and* a cap.
 *      Issuing a replacement marks the previous challenge superseded, so an older code cannot be
 *      kept alive alongside the new one.
 *   3. `POST …/verify` — validate the code against the SHA-256 digest, bound to the challenge token
 *      *and* to the session (`jti`) that opened it, incrementing the attempt counter atomically.
 *      Five wrong attempts finish the challenge, so brute-forcing a 10^6 space is not viable.
 *   4. `POST …/reveal` — only after step 3 succeeds, and only once: the challenge is consumed, the
 *      PIN is returned with a short display TTL, and the browser must start again next time.
 *
 * Everything here is scoped to the authenticated caller. No endpoint accepts a user id, so one
 * customer can never reach another customer's PIN, and no endpoint reveals whether an arbitrary
 * address belongs to an account (the caller's own account is the only account in scope).
 *
 * Codes are stored as plain SHA-256 digests rather than keyed hashes on purpose: the search space is
 * only 10^6, so a keyed hash would add nothing an attacker with a database dump could not brute
 * force, and the digest keeps the verification query a single indexed lookup. The real defences are
 * the short TTL, the attempt cap, the per-session binding and the rate limits on the routes.
 */
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Queryable } from '../db/types';
import { withTransaction } from '../db/transaction';
import type { UserRecord } from '../db/users';
import { getSecurityPinPolicy, type SecurityPinPolicy } from './security-pin-service';

export const VERIFICATION_CODE_LENGTH = 6;
const VERIFICATION_CODE_SPACE = 1_000_000;

export interface ChallengeRow {
  id: string;
  user_id: string;
  session_jti: string;
  code_hash: string;
  challenge_token_hash: string;
  sent_to_email: string;
  attempts: number;
  max_attempts: number;
  resend_count: number;
  expires_at: string;
  verified_at: string | null;
  consumed_at: string | null;
  consumed_reason: string | null;
  created_at: string;
}

export class ChallengeNotFoundError extends Error {
  constructor() {
    super('This verification session is no longer valid. Start again to view your Security PIN.');
    this.name = 'ChallengeNotFoundError';
  }
}

export class ChallengeExpiredError extends Error {
  constructor() {
    super('That verification code has expired. Request a new one to continue.');
    this.name = 'ChallengeExpiredError';
  }
}

export class ChallengeExhaustedError extends Error {
  constructor() {
    super('Too many incorrect codes. Start again to request a new verification email.');
    this.name = 'ChallengeExhaustedError';
  }
}

export class InvalidCodeError extends Error {
  constructor(remainingAttempts: number) {
    super(
      remainingAttempts > 0
        ? `That code is not correct. ${remainingAttempts} attempt${remainingAttempts === 1 ? '' : 's'} remaining.`
        : 'That code is not correct. Start again to request a new verification email.'
    );
    this.name = 'InvalidCodeError';
  }
}

export class ResendTooSoonError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super(`Please wait ${retryAfterSeconds} second${retryAfterSeconds === 1 ? '' : 's'} before requesting another code.`);
    this.name = 'ResendTooSoonError';
  }
}

export class ResendLimitError extends Error {
  constructor() {
    super('You have requested the maximum number of codes for this session. Start again in a few minutes.');
    this.name = 'ResendLimitError';
  }
}

/** Cryptographically secure six-digit code; leading zeros are preserved as a string. */
export function generateVerificationCode(): string {
  return String(randomInt(0, VERIFICATION_CODE_SPACE)).padStart(VERIFICATION_CODE_LENGTH, '0');
}

export function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/** Opaque, high-entropy handle the browser keeps while it types the code. Not a code itself. */
export function generateChallengeToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashChallengeToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const CODE_PATTERN = /^[0-9]{6}$/;

export interface IssuedChallenge {
  challengeId: string;
  /** Opaque token for the browser. Deliberately not the code. */
  challengeToken: string;
  /** Plaintext code — passed straight to the mail queue by the route and never persisted. */
  code: string;
  expiresAt: string;
  sentToEmail: string;
  /** Masked address for display, e.g. `a•••@example.com`. */
  maskedEmail: string;
  codeTtlMinutes: number;
  resendAvailableInSeconds: number;
  maxAttempts: number;
  maxResends: number;
}

/** Masks an address for on-screen confirmation without exposing the whole mailbox. */
export function maskEmail(email: string): string {
  const [local, domain] = String(email ?? '').split('@');
  if (!local || !domain) return 'your registered email address';
  const visible = local.slice(0, 1);
  return `${visible}${'•'.repeat(Math.max(2, Math.min(6, local.length - 1)))}@${domain}`;
}

/**
 * Creates a fresh challenge, superseding any live one for the same account. Runs in a transaction:
 * the supersede + insert must not be observable half-done, and the partial unique index would
 * otherwise reject the insert.
 */
export async function issueChallenge(
  db: Queryable,
  input: { user: Pick<UserRecord, 'id' | 'email'>; sessionJti: string; ipAddress?: string | null; userAgent?: string | null },
  options: { policy?: SecurityPinPolicy; now?: Date } = {}
): Promise<IssuedChallenge> {
  const policy = options.policy ?? (await getSecurityPinPolicy(db));
  const now = options.now ?? new Date();
  const code = generateVerificationCode();
  const challengeToken = generateChallengeToken();
  const codeHash = hashCode(code);
  const tokenHash = hashChallengeToken(challengeToken);
  const expiresAt = new Date(now.getTime() + policy.verificationCodeTtlMinutes * 60_000).toISOString();
  const id = randomUUID();

  await withTransaction(db, async (tx) => {
    await tx.query(
      `UPDATE security_pin_verification_challenges
          SET consumed_at = now(), consumed_reason = 'superseded', updated_at = now()
        WHERE user_id = $1 AND consumed_at IS NULL`,
      [input.user.id]
    );
    await tx.query(
      `INSERT INTO security_pin_verification_challenges
         (id, user_id, session_jti, code_hash, challenge_token_hash, sent_to_email,
          attempts, max_attempts, resend_count, expires_at, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,0,$7,0,$8,$9,$10)`,
      [
        id,
        input.user.id,
        input.sessionJti,
        codeHash,
        tokenHash,
        input.user.email,
        policy.verificationMaxAttempts,
        expiresAt,
        input.ipAddress ?? null,
        input.userAgent ?? null,
      ]
    );
  });

  return {
    challengeId: id,
    challengeToken,
    code,
    expiresAt,
    sentToEmail: input.user.email,
    maskedEmail: maskEmail(input.user.email),
    codeTtlMinutes: policy.verificationCodeTtlMinutes,
    resendAvailableInSeconds: policy.verificationResendCooldownSeconds,
    maxAttempts: policy.verificationMaxAttempts,
    maxResends: policy.verificationMaxResends,
  };
}

export interface ResentChallenge extends IssuedChallenge {
  resendCount: number;
}

/**
 * Replaces the code on an existing challenge (the token the browser holds stays the same, so a
 * resend does not require restarting the flow). Cooldown and cap are evaluated inside the row lock,
 * so two rapid clicks cannot both issue a code.
 */
export async function resendChallengeCode(
  db: Queryable,
  input: { userId: string; challengeToken: string; sessionJti: string },
  options: { policy?: SecurityPinPolicy; now?: Date } = {}
): Promise<ResentChallenge> {
  const policy = options.policy ?? (await getSecurityPinPolicy(db));
  const now = options.now ?? new Date();
  const tokenHash = hashChallengeToken(input.challengeToken);
  const code = generateVerificationCode();
  const codeHash = hashCode(code);
  const expiresAt = new Date(now.getTime() + policy.verificationCodeTtlMinutes * 60_000).toISOString();

  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query<ChallengeRow>(
      `SELECT * FROM security_pin_verification_challenges
        WHERE challenge_token_hash = $1 AND user_id = $2 AND session_jti = $3
        FOR UPDATE`,
      [tokenHash, input.userId, input.sessionJti]
    );
    const row = rows[0];
    if (!row || row.consumed_at || row.verified_at) throw new ChallengeNotFoundError();
    if (new Date(row.expires_at).getTime() <= now.getTime()) throw new ChallengeExpiredError();
    if (row.resend_count >= policy.verificationMaxResends) throw new ResendLimitError();

    const elapsedSeconds = Math.floor((now.getTime() - new Date(row.created_at).getTime()) / 1000);
    if (elapsedSeconds < policy.verificationResendCooldownSeconds) {
      throw new ResendTooSoonError(policy.verificationResendCooldownSeconds - elapsedSeconds);
    }

    const updated = await tx.query<{ resend_count: number; sent_to_email: string }>(
      `UPDATE security_pin_verification_challenges
          SET code_hash = $2, expires_at = $3, resend_count = resend_count + 1,
              updated_at = now()
        WHERE id = $1
        RETURNING resend_count, sent_to_email`,
      [row.id, codeHash, expiresAt]
    );

    return {
      challengeId: row.id,
      challengeToken: input.challengeToken,
      code,
      expiresAt,
      sentToEmail: updated.rows[0]?.sent_to_email ?? row.sent_to_email,
      maskedEmail: maskEmail(updated.rows[0]?.sent_to_email ?? row.sent_to_email),
      codeTtlMinutes: policy.verificationCodeTtlMinutes,
      resendAvailableInSeconds: policy.verificationResendCooldownSeconds,
      maxAttempts: row.max_attempts,
      maxResends: policy.verificationMaxResends,
      resendCount: updated.rows[0]?.resend_count ?? row.resend_count + 1,
    };
  });
}

export interface VerifyResult {
  challengeId: string;
  /** Remaining attempts after this call (only meaningful when the code was wrong). */
  remainingAttempts: number;
}

/**
 * Validates a code. Wrong codes increment the attempt counter in the same locked read, so parallel
 * guesses cannot exceed the cap. A correct code marks the challenge verified, single-use-style:
 * `revealSecurityPin` consumes it and refuses a second reveal.
 *
 * NOTE on transaction boundaries: the outcome is *returned* from the transaction and thrown after
 * it commits, never thrown from inside it. Throwing inside would roll back the very UPDATE that
 * records the failed attempt, so a wrong guess would leave `attempts` at zero and the five-attempt
 * cap would never be reached — an unlimited-guess oracle behind a six-digit code. Every write that
 * must survive a failure therefore commits first, and the caller sees the error afterwards.
 */
export async function verifyChallengeCode(
  db: Queryable,
  input: { userId: string; challengeToken: string; sessionJti: string; code: string },
  options: { now?: Date } = {}
): Promise<VerifyResult> {
  const now = options.now ?? new Date();
  const tokenHash = hashChallengeToken(input.challengeToken);
  const code = String(input.code ?? '').trim();

  const outcome = await withTransaction<
    | { status: 'verified'; challengeId: string; remainingAttempts: number }
    | { status: 'not_found' }
    | { status: 'expired' }
    | { status: 'exhausted' }
    | { status: 'invalid'; remainingAttempts: number }
  >(db, async (tx) => {
    const { rows } = await tx.query<ChallengeRow>(
      `SELECT * FROM security_pin_verification_challenges
        WHERE challenge_token_hash = $1 AND user_id = $2 AND session_jti = $3
        FOR UPDATE`,
      [tokenHash, input.userId, input.sessionJti]
    );
    const row = rows[0];
    if (!row || row.consumed_at) return { status: 'not_found' };
    if (row.verified_at) {
      // Already answered: the code is spent. Re-submitting it must never re-open the gate.
      return { status: 'not_found' };
    }
    if (new Date(row.expires_at).getTime() <= now.getTime()) {
      await tx.query(
        `UPDATE security_pin_verification_challenges
            SET consumed_at = now(), consumed_reason = 'expired', updated_at = now()
          WHERE id = $1 AND consumed_at IS NULL`,
        [row.id]
      );
      return { status: 'expired' };
    }
    if (row.attempts >= row.max_attempts) {
      await tx.query(
        `UPDATE security_pin_verification_challenges
            SET consumed_at = COALESCE(consumed_at, now()),
                consumed_reason = COALESCE(consumed_reason, 'attempts_exhausted'),
                updated_at = now()
          WHERE id = $1`,
        [row.id]
      );
      return { status: 'exhausted' };
    }

    const matches = CODE_PATTERN.test(code) && safeEqualHex(hashCode(code), row.code_hash);
    if (!matches) {
      const attempts = row.attempts + 1;
      const exhausted = attempts >= row.max_attempts;
      await tx.query(
        `UPDATE security_pin_verification_challenges
            SET attempts = $2,
                consumed_at = CASE WHEN $3 THEN now() ELSE consumed_at END,
                consumed_reason = CASE WHEN $3 THEN 'attempts_exhausted' ELSE consumed_reason END,
                updated_at = now()
          WHERE id = $1`,
        [row.id, attempts, exhausted]
      );
      return exhausted
        ? { status: 'exhausted' }
        : { status: 'invalid', remainingAttempts: row.max_attempts - attempts };
    }

    await tx.query(
      `UPDATE security_pin_verification_challenges
          SET verified_at = now(), attempts = attempts + 1, updated_at = now()
        WHERE id = $1`,
      [row.id]
    );
    return {
      status: 'verified',
      challengeId: row.id,
      remainingAttempts: row.max_attempts - (row.attempts + 1),
    };
  });

  // The attempt bookkeeping is committed at this point; only now is it safe to report failure.
  switch (outcome.status) {
    case 'not_found':
      throw new ChallengeNotFoundError();
    case 'expired':
      throw new ChallengeExpiredError();
    case 'exhausted':
      throw new ChallengeExhaustedError();
    case 'invalid':
      throw new InvalidCodeError(outcome.remainingAttempts);
    case 'verified':
      return { challengeId: outcome.challengeId, remainingAttempts: outcome.remainingAttempts };
  }
}

function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Consumes a verified challenge and returns the id to reveal for. Refuses anything that is not a
 * single fresh success: unverified, already consumed, or opened by a different session.
 */
export async function consumeVerifiedChallenge(
  db: Queryable,
  input: { userId: string; challengeToken: string; sessionJti: string }
): Promise<string> {
  const tokenHash = hashChallengeToken(input.challengeToken);
  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query<ChallengeRow>(
      `UPDATE security_pin_verification_challenges
          SET consumed_at = now(), consumed_reason = 'revealed', updated_at = now()
        WHERE challenge_token_hash = $1 AND user_id = $2 AND session_jti = $3
          AND verified_at IS NOT NULL AND consumed_at IS NULL
        RETURNING *`,
      [tokenHash, input.userId, input.sessionJti]
    );
    const row = rows[0];
    if (!row) throw new ChallengeNotFoundError();
    if (new Date(row.expires_at).getTime() <= Date.now()) throw new ChallengeExpiredError();
    return row.id;
  });
}

/** Test/diagnostic helper: the newest challenge for an account (never exposes the code). */
export async function findLatestChallenge(db: Queryable, userId: string): Promise<ChallengeRow | null> {
  const { rows } = await db.query<ChallengeRow>(
    `SELECT * FROM security_pin_verification_challenges
      WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  return rows[0] ?? null;
}
