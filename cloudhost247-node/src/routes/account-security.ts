/**
 * Account security routes — username, the rotating Security PIN, its email-verification gate, and
 * account recovery.
 *
 *   GET    /api/v1/account/security                 — the Account Security section payload
 *   PATCH  /api/v1/account/username                 — change the username (validated + reserved)
 *   GET    /api/v1/account/username/availability    — live availability check for the settings form
 *   POST   /api/v1/account/security-pin/view        — issue the six-digit verification code
 *   POST   /api/v1/account/security-pin/resend      — rotate that code (cooldown + cap)
 *   POST   /api/v1/account/security-pin/verify      — check the code
 *   POST   /api/v1/account/security-pin/reveal      — return the PIN once, with a display TTL
 *   POST   /api/v1/account/recovery                 — open an account recovery request
 *   GET    /api/v1/account/recovery                 — the caller's own recovery requests
 *   POST   /api/v1/account/recovery/:id/cancel      — withdraw one
 *
 * Invariants that hold on every route in this file:
 *
 *   1. **The PIN is not an ordinary API field.** No response here (or anywhere else) includes it
 *      except `POST …/reveal`, which requires a completed email verification in the same session,
 *      consumes that verification, and returns the value with `displayTtlSeconds` so the UI hides
 *      it again on its own. The status payload never contains the value, the hash or the salt.
 *   2. **The caller can only reach their own account.** There is no `:userId` anywhere: every
 *      lookup uses the authenticated `auth.userId`, so a crafted request cannot name another
 *      customer. (Staff reads live in src/routes/admin-users.ts and never see the value.)
 *   3. **Support mode is refused.** While an administrator is switched into a customer account, the
 *      PIN gate and username change are blocked (`guardSupportMode`) — an impersonated session must
 *      not be able to read a customer's PIN, and the audit trail records the attempt.
 *   4. **Expiry is enforced server-side.** Any read path calls `ensureCurrentPin`, which rotates a
 *      PIN that has outlived its window using a compare-and-swap, so two concurrent requests
 *      cannot mint competing PINs and the dashboard countdown is cosmetic only.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { findUserById, recordAuthEvent, updateUsernameForUser } from '../db/users';
import { getSecurityNumberPolicy, getStatus as getSecurityNumberStatus } from '../services/security-number-service';
import {
  createRecoveryRequest,
  findRecoveryRequest,
  listRecoveryRequestsForUser,
  transitionRecoveryRequest,
} from '../services/account-recovery-service';
import {
  ChallengeExpiredError,
  ChallengeExhaustedError,
  ChallengeNotFoundError,
  InvalidCodeError,
  ResendLimitError,
  ResendTooSoonError,
  consumeVerifiedChallenge,
  issueChallenge,
  resendChallengeCode,
  verifyChallengeCode,
} from '../services/security-pin-challenge-service';
import {
  describeSecurityPin,
  ensureCurrentPin,
  getSecurityPinPolicy,
  openSealedSecurityPin,
} from '../services/security-pin-service';
import {
  deriveCodeKey,
  queueVerificationCodeEmail,
  sealCode,
} from '../services/security-pin-email-service';
import { isPinKeyConfigured, pinKeyOrNull } from '../lib/pin-key';
import { accountRecoveryRequestedEmail } from '../lib/pin-email-templates';
import { recordAuditBestEffort, requestAuditContext } from '../lib/audit';
import {
  ConflictError,
  ForbiddenError,
  HttpError,
  NotFoundError,
  ValidationError,
} from '../lib/errors';
import { authenticate } from '../lib/require-auth';
import { guardSupportMode } from '../lib/support-mode';
import { isUsernameTaken, suggestUsernames, validateUsernameFormat } from '../services/username-service';

const usernameSchema = z
  .object({
    // Format/reservation rules live in the service, not here, so registration and this route agree.
    username: z.string().min(3).max(32),
  })
  .strict();

const availabilitySchema = z.object({ username: z.string().min(1).max(64) });

const challengeTokenSchema = z.object({
  challengeToken: z.string().min(20).max(200).regex(/^[A-Za-z0-9_-]+$/, 'Invalid verification session'),
});

const verifySchema = challengeTokenSchema.extend({
  code: z.string().trim().min(4).max(10),
});

const recoverySchema = z
  .object({
    reason: z.enum(['cannot_access_email', 'email_compromised', 'lost_device', 'other']),
    contactEmail: z.string().email().max(320).optional(),
    contactPhone: z.string().trim().max(40).optional(),
    details: z.string().trim().max(2000).optional(),
    // Defence against naive form automation; a human-facing form sends `true`.
    acknowledgeNoPinDisclosure: z.literal(true).optional(),
  })
  .strict();

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join(', '));
  }
  return parsed.data;
}

/** Translates the challenge service's typed failures into HTTP responses with safe messages. */
function challengeErrorToHttp(error: unknown): never {
  if (error instanceof ChallengeNotFoundError) {
    throw new HttpError(404, error.message, 'VERIFICATION_NOT_FOUND');
  }
  if (error instanceof ChallengeExpiredError) {
    throw new HttpError(410, error.message, 'VERIFICATION_EXPIRED');
  }
  if (error instanceof ChallengeExhaustedError) {
    throw new HttpError(429, error.message, 'VERIFICATION_ATTEMPTS_EXHAUSTED');
  }
  if (error instanceof ResendTooSoonError) {
    throw new HttpError(429, error.message, 'VERIFICATION_RESEND_TOO_SOON');
  }
  if (error instanceof ResendLimitError) {
    throw new HttpError(429, error.message, 'VERIFICATION_RESEND_LIMIT');
  }
  if (error instanceof InvalidCodeError) {
    throw new HttpError(400, error.message, 'VERIFICATION_CODE_INVALID');
  }
  throw error;
}

export async function registerAccountSecurityRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  // --- Account Security section -----------------------------------------------------------------

  /**
   * Everything the Account Security card renders. The PIN is represented as `set` +
   * `maskedValue: '••••'` only — never a digit of the real value, and never the hash or salt.
   */
  app.get('/api/v1/account/security', async (request) => {
    const auth = await authenticate(request, env, pool);
    let user = await findUserById(pool, auth.userId);
    if (!user) throw new NotFoundError('Account no longer exists');

    const pinPolicy = await getSecurityPinPolicy(pool);
    // Rotate here if the window has passed (or if this account has never had a PIN). The rotation
    // happens server-side and is audited; the plaintext is discarded — the customer must still
    // complete email verification to read the (now current) value.
    if (!user.security_pin_hash || describeSecurityPin(user).expired) {
      const { rotated, rotation } = await ensureCurrentPin(pool, user);
      if (rotated && rotation) {
        await recordAuditBestEffort(
          pool,
          {
            actorId: user.id,
            action: 'security_pin_rotated',
            resourceType: 'user',
            resourceId: user.id,
            metadata: {
              customerId: user.customer_id,
              trigger: user.security_pin_hash ? 'expired_on_access' : 'first_issue',
              version: rotation.version,
            },
          },
          requestAuditContext(request)
        );
      }
      user = (await findUserById(pool, auth.userId)) ?? user;
    }

    const pin = describeSecurityPin(user, pinPolicy.rotationHours);
    const securityNumberPolicy = await getSecurityNumberPolicy(pool);
    const securityNumber = await getSecurityNumberStatus(pool, user);

    return {
      account: {
        username: user.username,
        usernameChangedAt: user.username_changed_at,
        customerId: user.customer_id,
        email: user.email,
        emailVerified: Boolean(user.email_verified_at),
      },
      securityPin: {
        // Never the value. The UI renders this literal mask and nothing else until a verified
        // reveal returns the real digits.
        maskedValue: '••••',
        set: pin.set,
        version: pin.version,
        lastRotatedAt: pin.createdAt,
        nextRotationAt: pin.expiresAt,
        secondsUntilRotation: pin.secondsUntilExpiry,
        rotationHours: pin.rotationHours,
        // How long a successful reveal keeps the value on screen before the UI hides it again.
        revealDisplayTtlSeconds: pinPolicy.revealTtlSeconds,
        verificationCodeTtlMinutes: pinPolicy.verificationCodeTtlMinutes,
        resendCooldownSeconds: pinPolicy.verificationResendCooldownSeconds,
        maxAttempts: pinPolicy.verificationMaxAttempts,
        canView: isPinKeyConfigured() && Boolean(user.email_verified_at),
        viewRequiresEmailVerification: true,
        emailVerificationConfigured: Boolean(process.env.NOTIFICATION_EMAIL_WEBHOOK_URL),
      },
      securityNumber: {
        initialized: securityNumber.initialized,
        version: securityNumber.version,
        expiresAt: securityNumber.expiresAt,
        rotationHours: securityNumberPolicy.rotationHours,
      },
    };
  });

  // --- Username ---------------------------------------------------------------------------------

  app.get('/api/v1/account/username/availability', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request) => {
    await authenticate(request, env, pool);
    const { username } = parseOrThrow(availabilitySchema, request.query);
    const check = validateUsernameFormat(username);
    if (!check.ok) return { available: false, username: check.value, reason: check.error };
    const taken = await isUsernameTaken(pool, check.value);
    return {
      available: !taken,
      username: check.value,
      reason: taken ? 'That username is already taken.' : null,
      suggestions: taken ? await suggestUsernames(pool, check.value) : [],
    };
  });

  app.patch('/api/v1/account/username', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (request) => {
    const auth = await authenticate(request, env, pool);
    await guardSupportMode(pool, request, auth, 'username.change');
    const { username: raw } = parseOrThrow(usernameSchema, request.body);

    const user = await findUserById(pool, auth.userId);
    if (!user) throw new NotFoundError('Account no longer exists');

    const check = validateUsernameFormat(raw);
    if (!check.ok) throw new ValidationError(check.error ?? 'That username is not available');
    if (check.value.toLowerCase() === user.username.toLowerCase()) {
      return { username: user.username, usernameChangedAt: user.username_changed_at, unchanged: true };
    }
    if (await isUsernameTaken(pool, check.value, user.id)) {
      const suggestions = await suggestUsernames(pool, check.value);
      throw new ConflictError(
        suggestions.length > 0
          ? `That username is already taken. Try ${suggestions.map((s) => `"${s}"`).join(', ')}.`
          : 'That username is already taken.'
      );
    }

    let updated;
    try {
      updated = await updateUsernameForUser(pool, user.id, check.value);
    } catch (error) {
      // The unique index is the final authority; a concurrent registration can win the race
      // between our check and this write, so translate that to the same friendly conflict.
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictError('That username is already taken.');
      }
      throw error;
    }
    if (!updated) throw new NotFoundError('Account no longer exists');

    await recordAuthEvent(pool, {
      id: randomUUID(),
      userId: updated.id,
      eventType: 'username_changed',
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
      metadata: { previousUsername: user.username, username: updated.username },
    });
    await recordAuditBestEffort(
      pool,
      {
        actorId: updated.id,
        action: 'account_username_changed',
        resourceType: 'user',
        resourceId: updated.id,
        metadata: { customerId: updated.customer_id, previousUsername: user.username, username: updated.username },
      },
      requestAuditContext(request)
    );

    return { username: updated.username, usernameChangedAt: updated.username_changed_at, unchanged: false };
  });

  // --- Security PIN: the verify-then-reveal gate ------------------------------------------------

  /**
   * Issues the six-digit code. The address is taken from the account row — never from the request,
   * which has no field for it — so this endpoint cannot be used to discover which address belongs
   * to an account, and cannot be used to send a code somewhere else.
   */
  app.post(
    '/api/v1/account/security-pin/view',
    { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (request) => {
      const auth = await authenticate(request, env, pool);
      await guardSupportMode(pool, request, auth, 'security_pin.view');

      const user = await findUserById(pool, auth.userId);
      if (!user) throw new NotFoundError('Account no longer exists');
      if (!user.email_verified_at) {
        // The gate is the *verified* registered address. An unverified account must complete the
        // ordinary email verification first; this response never reveals the PIN or the address.
        throw new ForbiddenError(
          'Verify your registered email address before you can view your Security PIN.'
        );
      }
      const pinKey = pinKeyOrNull();
      if (!pinKey) {
        throw new HttpError(
          503,
          'Security PIN viewing is temporarily unavailable because the security key is not configured. Contact support.',
          'SECURITY_PIN_UNAVAILABLE'
        );
      }

      const policy = await getSecurityPinPolicy(pool);
      const issued = await issueChallenge(
        pool,
        {
          user,
          sessionJti: auth.jti,
          ipAddress: request.ip,
          userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
        },
        { policy }
      );

      await queueVerificationCodeEmail(pool, {
        challengeId: issued.challengeId,
        userId: user.id,
        email: user.email,
        name: user.full_name,
        codeEnvelope: sealCode(issued.code, deriveCodeKey(pinKey)),
        ttlMinutes: issued.codeTtlMinutes,
        expiresAt: issued.expiresAt,
      });

      await recordAuthEvent(pool, {
        id: randomUUID(),
        userId: user.id,
        eventType: 'security_pin_view_challenge_requested',
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
        metadata: { challengeId: issued.challengeId },
      });

      // Note the omission: neither the code nor the full address is returned. The masked address
      // exists only so the customer can confirm where to look.
      return {
        challenge: {
          challengeToken: issued.challengeToken,
          maskedEmail: issued.maskedEmail,
          expiresAt: issued.expiresAt,
          codeTtlMinutes: issued.codeTtlMinutes,
          resendAvailableInSeconds: issued.resendAvailableInSeconds,
          maxAttempts: issued.maxAttempts,
          maxResends: issued.maxResends,
        },
        message: 'An email with your 6-digit code has been sent to your registered email address.',
      };
    }
  );

  app.post(
    '/api/v1/account/security-pin/resend',
    { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (request) => {
      const auth = await authenticate(request, env, pool);
      await guardSupportMode(pool, request, auth, 'security_pin.view');
      const { challengeToken } = parseOrThrow(challengeTokenSchema, request.body);

      const user = await findUserById(pool, auth.userId);
      if (!user) throw new NotFoundError('Account no longer exists');
      const pinKey = pinKeyOrNull();
      if (!pinKey) {
        throw new HttpError(503, 'Security PIN viewing is temporarily unavailable.', 'SECURITY_PIN_UNAVAILABLE');
      }

      const policy = await getSecurityPinPolicy(pool);
      let resent;
      try {
        resent = await resendChallengeCode(pool, {
          userId: user.id,
          challengeToken,
          sessionJti: auth.jti,
        }, { policy });
      } catch (error) {
        challengeErrorToHttp(error);
      }

      // Overwrites the queued envelope for this challenge: an older code is not left alive.
      await queueVerificationCodeEmail(pool, {
        challengeId: resent.challengeId,
        userId: user.id,
        email: resent.sentToEmail,
        name: user.full_name,
        codeEnvelope: sealCode(resent.code, deriveCodeKey(pinKey)),
        ttlMinutes: resent.codeTtlMinutes,
        expiresAt: resent.expiresAt,
      });

      await recordAuthEvent(pool, {
        id: randomUUID(),
        userId: user.id,
        eventType: 'security_pin_view_challenge_resent',
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
        metadata: { challengeId: resent.challengeId, resendCount: resent.resendCount },
      });

      return {
        challenge: {
          challengeToken: resent.challengeToken,
          maskedEmail: resent.maskedEmail,
          expiresAt: resent.expiresAt,
          codeTtlMinutes: resent.codeTtlMinutes,
          resendAvailableInSeconds: resent.resendAvailableInSeconds,
          maxAttempts: resent.maxAttempts,
          maxResends: resent.maxResends,
          resendCount: resent.resendCount,
        },
        message: 'A new 6-digit code has been sent to your registered email address.',
      };
    }
  );

  app.post(
    '/api/v1/account/security-pin/verify',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (request) => {
      const auth = await authenticate(request, env, pool);
      await guardSupportMode(pool, request, auth, 'security_pin.view');
      const { challengeToken, code } = parseOrThrow(verifySchema, request.body);

      const user = await findUserById(pool, auth.userId);
      if (!user) throw new NotFoundError('Account no longer exists');

      try {
        const result = await verifyChallengeCode(pool, {
          userId: user.id,
          challengeToken,
          sessionJti: auth.jti,
          code,
        });
        await recordAuthEvent(pool, {
          id: randomUUID(),
          userId: user.id,
          eventType: 'security_pin_view_challenge_requested',
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
          metadata: { challengeId: result.challengeId, verified: true },
        });
        return {
          verified: true,
          // The browser now calls /reveal with the same token. It must not be treated as a
          // long-lived grant: the challenge is consumed by that call.
          message: 'Verified. You can now reveal your Security PIN.',
        };
      } catch (error) {
        // Record the failure (never the code) before translating to an HTTP error.
        await recordAuthEvent(pool, {
          id: randomUUID(),
          userId: user.id,
          eventType: 'security_pin_view_verification_failed',
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
          metadata: {
            challengeId: null,
            reason: error instanceof Error ? error.name : 'unknown',
          },
        });
        challengeErrorToHttp(error);
      }
    }
  );

  /**
   * The only endpoint in the entire application that returns a Security PIN value.
   *
   * Preconditions, all enforced here: an authenticated session, no support mode, a challenge that
   * this same session opened and that has been verified by a fresh code, and a PIN that is current
   * (rotated on the spot if it has expired). The challenge is consumed in the same call, so the
   * value can be shown exactly once per email verification.
   */
  app.post(
    '/api/v1/account/security-pin/reveal',
    { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (request) => {
      const auth = await authenticate(request, env, pool);
      await guardSupportMode(pool, request, auth, 'security_pin.view');
      const { challengeToken } = parseOrThrow(challengeTokenSchema, request.body);

      let user = await findUserById(pool, auth.userId);
      if (!user) throw new NotFoundError('Account no longer exists');
      const pinKey = pinKeyOrNull();
      if (!pinKey) {
        throw new HttpError(503, 'Security PIN viewing is temporarily unavailable.', 'SECURITY_PIN_UNAVAILABLE');
      }

      let challengeId: string;
      try {
        challengeId = await consumeVerifiedChallenge(pool, {
          userId: user.id,
          challengeToken,
          sessionJti: auth.jti,
        });
      } catch (error) {
        challengeErrorToHttp(error);
      }

      // Enforce freshness at read time. If the window passed while the customer was verifying, the
      // PIN they are about to see is the *new* one, not the expired one.
      const policy = await getSecurityPinPolicy(pool);
      if (!user.security_pin_hash || describeSecurityPin(user).expired) {
        const { rotation } = await ensureCurrentPin(pool, user, { key: pinKey });
        if (rotation) {
          await recordAuditBestEffort(
            pool,
            {
              actorId: user.id,
              action: 'security_pin_rotated',
              resourceType: 'user',
              resourceId: user.id,
              metadata: { customerId: user.customer_id, trigger: 'expired_on_access', version: rotation.version },
            },
            requestAuditContext(request)
          );
        }
        user = (await findUserById(pool, auth.userId)) ?? user;
      }

      const pin = readCurrentPinPlaintext(user, pinKey);
      if (!pin) {
        throw new HttpError(503, 'Your Security PIN could not be read. Contact support.', 'SECURITY_PIN_UNAVAILABLE');
      }

      const state = describeSecurityPin(user, policy.rotationHours);
      await recordAuthEvent(pool, {
        id: randomUUID(),
        userId: user.id,
        eventType: 'security_pin_viewed',
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
        metadata: { challengeId, version: state.version, displayTtlSeconds: policy.revealTtlSeconds },
      });
      await recordAuditBestEffort(
        pool,
        {
          actorId: user.id,
          action: 'security_pin_viewed',
          resourceType: 'user',
          resourceId: user.id,
          metadata: { customerId: user.customer_id, version: state.version, challengeId },
        },
        requestAuditContext(request)
      );

      return {
        securityPin: {
          value: pin,
          maskedValue: '••••',
          version: state.version,
          lastRotatedAt: state.createdAt,
          nextRotationAt: state.expiresAt,
          secondsUntilRotation: state.secondsUntilExpiry,
          /**
           * The UI must clear the value from state after this many seconds. It is a courtesy to
           * the customer, not a security control: the challenge is already spent, so a screenshot
           * or a re-render cannot extend access. The next view needs a new email code.
           */
          displayTtlSeconds: policy.revealTtlSeconds,
        },
        message: `Your Security PIN is shown for ${policy.revealTtlSeconds} seconds. A new code is required next time.`,
      };
    }
  );

  // --- Account recovery -------------------------------------------------------------------------

  app.post('/api/v1/account/recovery', { config: { rateLimit: { max: 3, timeWindow: '1 hour' } } }, async (request) => {
    const auth = await authenticate(request, env, pool);
    await guardSupportMode(pool, request, auth, 'account.recovery');
    const input = parseOrThrow(recoverySchema, request.body);

    const user = await findUserById(pool, auth.userId);
    if (!user) throw new NotFoundError('Account no longer exists');

    const { request: recovery, existing } = await createRecoveryRequest(pool, {
      user,
      reason: input.reason,
      contactEmail: input.contactEmail ?? null,
      contactPhone: input.contactPhone ?? null,
      details: input.details ?? null,
      ipAddress: request.ip,
      userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
    });

    // Tell the address on the account that a recovery was requested. Best effort: a mail outage
    // must not fail the request the customer just made, and the notice carries no secret.
    await notifyRecoveryRequested(pool, user, recovery.reference, input.reason);

    await recordAuditBestEffort(
      pool,
      {
        actorId: user.id,
        action: 'account_recovery_requested',
        resourceType: 'user',
        resourceId: user.id,
        metadata: { customerId: user.customer_id, reference: recovery.reference, reason: input.reason },
      },
      requestAuditContext(request)
    );

    return {
      recovery: {
        id: recovery.id,
        reference: recovery.reference,
        status: recovery.status,
        reason: recovery.reason,
        createdAt: recovery.created_at,
      },
      existing,
      message: existing
        ? 'You already have an open recovery request. Quote the reference below when support contacts you.'
        : 'Your recovery request has been logged. Support will verify your identity before anything changes. Your Security PIN is not revealed or reset by recovery.',
    };
  });

  app.get('/api/v1/account/recovery', async (request) => {
    const auth = await authenticate(request, env, pool);
    const rows = await listRecoveryRequestsForUser(pool, auth.userId);
    return {
      recoveries: rows.map((row) => ({
        id: row.id,
        reference: row.reference,
        status: row.status,
        reason: row.reason,
        createdAt: row.created_at,
        resolvedAt: row.resolved_at,
      })),
    };
  });

  app.post('/api/v1/account/recovery/:id/cancel', async (request) => {
    const auth = await authenticate(request, env, pool);
    await guardSupportMode(pool, request, auth, 'account.recovery');
    const params = parseOrThrow(z.object({ id: z.string().uuid() }), request.params);

    // Ownership is checked against the row *before* it is touched, not after: a customer must not
    // be able to cancel — or learn the existence of — another account's recovery request.
    const owned = await findRecoveryRequest(pool, params.id);
    if (!owned || owned.user_id !== auth.userId) {
      throw new NotFoundError('No open recovery request with that id');
    }

    const cancelled = await transitionRecoveryRequest(pool, {
      id: params.id,
      status: 'CANCELLED',
      actorId: auth.userId,
      note: 'Cancelled by the account owner',
      ipAddress: request.ip,
      userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
    });
    if (!cancelled) throw new ConflictError('That recovery request is no longer open');

    return { recovery: { id: cancelled.id, reference: cancelled.reference, status: cancelled.status } };
  });
}

/**
 * Reads the account's current PIN by opening the sealed copy written at rotation time.
 *
 * Why a sealed copy exists at all: the requirement is that the owner can be *shown* the current
 * four-digit PIN after verifying their email, so a pure one-way hash is not sufficient. The value is
 * therefore stored twice — once as a keyed HMAC (the verification path, used to reject wrong PINs
 * without ever decrypting) and once as an AES-256-GCM envelope under a domain-separated key (the
 * display path). Neither copy is plaintext, neither is in a DTO, a log line, or an audit row, and a
 * database dump without the environment key yields nothing usable from either.
 *
 * A failed open (key rotated, row tampered, or no PIN yet) returns null and the route reports 503
 * rather than guessing or silently rotating — rotating here would mean showing a value that differs
 * from the one the customer's verification was about.
 */
function readCurrentPinPlaintext(
  user: { security_pin_encrypted?: string | null; security_pin_version: number },
  key: Buffer
): string | null {
  if (!user.security_pin_encrypted) return null;
  return openSealedSecurityPin(user.security_pin_encrypted, key);
}

/** Queues the "a recovery request was opened" notice to the address on the account. */
async function notifyRecoveryRequested(
  db: Queryable,
  user: { id: string; email: string; full_name: string; customer_id: string | null },
  reference: string,
  reason: string
): Promise<void> {
  try {
    const content = accountRecoveryRequestedEmail({ name: user.full_name, reference, reason });
    await db.query(
      `INSERT INTO user_notifications (id,user_id,type,title,message,resource_type,resource_id)
       VALUES ($1,$2,'ACCOUNT_RECOVERY_REQUESTED',$3,$4,'account_recovery',$5)
       ON CONFLICT DO NOTHING`,
      [randomUUID(), user.id, content.subject, content.text, randomUUID()]
    );
  } catch {
    // Notification delivery is best effort; the durable recovery row and audit trail are what
    // matter, and they were already written.
  }
}


