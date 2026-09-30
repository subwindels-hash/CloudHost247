/**
 * Customer-facing identity routes (spec §18–§19, §26–§31):
 *   GET    /api/v1/account                          — own profile, including the Customer ID
 *   PATCH  /api/v1/account                          — self-service profile edit (safe fields only)
 *   GET    /api/v1/account/security-number/status   — lifecycle metadata, never the value
 *   POST   /api/v1/account/security-number/reveal   — step-up authenticated, temporary reveal
 *   POST   /api/v1/account/security-number/change   — set a new value, restarting the window
 *   GET/PUT/DELETE /api/v1/account/profile-image    — avatar management
 *
 * Everything here is scoped to the caller's own account. Two invariants are worth calling out:
 *   1. The stored Security Number is a bcrypt hash; the plaintext only ever exists in the
 *      response body of the request that generated it, and never enters a log, an audit row, a
 *      JWT, or any user DTO.
 *   2. While an administrator is inside this account in support mode, the sensitive routes below
 *      refuse to run at all (src/lib/support-mode.ts) — an impersonated session must not be able
 *      to read or change the customer's secrets.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { findUserById, updateProfileFields } from '../db/users';
import { deleteProfileImage, getProfileImage, getProfileImageMeta, upsertProfileImage } from '../db/profile-images';
import { toAccountProfileDTO } from '../dto/account';
import { auditRequest, recordAuditBestEffort, requestAuditContext } from '../lib/audit';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '../lib/errors';
import { validateProfileImageUpload } from '../lib/image-upload';
import { verifyPassword } from '../lib/password';
import { authenticate } from '../lib/require-auth';
import { guardSupportMode } from '../lib/support-mode';
import {
  countRecentFailures,
  getSecurityNumberPolicy,
  getStatus,
  isValidSecurityNumberFormat,
  recordVerificationAttempt,
  rotateIfExpired,
  rotateSecurityNumber,
  verifySecurityNumberHash,
} from '../services/security-number-service';

const updateAccountSchema = z
  .object({
    fullName: z.string().min(1).max(255).optional(),
    phone: z.string().max(32).nullable().optional(),
    addressLine1: z.string().max(255).nullable().optional(),
    city: z.string().max(120).nullable().optional(),
    state: z.string().max(120).nullable().optional(),
    postalCode: z.string().max(32).nullable().optional(),
    country: z.string().max(64).nullable().optional(),
  })
  // `.strict()` is the actual enforcement of "a customer cannot change their id, customerId,
  // email, role, status, or any security field": unknown keys are rejected outright rather than
  // being silently ignored, so an attempt to smuggle `role: "admin"` fails loudly (spec §27).
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field must be provided' });

const revealSchema = z.object({
  /** Step-up: the account password must be re-entered even though the caller is already
   * authenticated, so a stolen/borrowed session alone cannot read the Security Number. */
  password: z.string().min(1, 'password is required'),
});

const changeSecurityNumberSchema = z.object({
  currentSecurityNumber: z.string(),
  newSecurityNumber: z.string(),
});

const uploadImageSchema = z.object({
  data: z.string().min(1, 'data is required'),
  contentType: z.string().max(64).optional(),
  fileName: z.string().max(255).optional(),
});

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
  }
  return parsed.data;
}

export async function registerAccountIdentityRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  app.get('/api/v1/account', async (request) => {
    const auth = await authenticate(request, env, pool);
    const user = await findUserById(pool, auth.userId);
    if (!user) throw new NotFoundError('Account no longer exists');
    const image = await getProfileImageMeta(pool, user.id);
    return { user: toAccountProfileDTO(user, image !== null) };
  });

  app.patch('/api/v1/account', async (request) => {
    const auth = await authenticate(request, env, pool);
    const input = parseOrThrow(updateAccountSchema, request.body);

    const user = await updateProfileFields(pool, auth.userId, input);
    if (!user) throw new NotFoundError('Account no longer exists');

    await recordAuditBestEffort(
      pool,
      {
        actorId: auth.actingAdminId ?? auth.userId,
        action: 'account_profile_updated',
        resourceType: 'user',
        resourceId: user.id,
        metadata: {
          customerId: user.customer_id,
          fields: Object.keys(input),
          viaSupportSession: auth.supportSessionId ?? null,
        },
      },
      requestAuditContext(request)
    );

    const image = await getProfileImageMeta(pool, user.id);
    return { user: toAccountProfileDTO(user, image !== null) };
  });

  // --- Security Number -------------------------------------------------------------------------

  /**
   * Status only: whether a number exists, which version it is, when it was issued and when it
   * expires. Never the value and never the hash.
   *
   * This is also the reactive half of the rotation guarantee (spec §17): if the stored number
   * has already expired — because the worker is not running, or the account slept through
   * several windows — a fresh one is issued right here, so the customer is never left holding
   * an unusable credential with no way to get a new one.
   */
  app.get('/api/v1/account/security-number/status', async (request) => {
    const auth = await authenticate(request, env, pool);
    let user = await findUserById(pool, auth.userId);
    if (!user) throw new NotFoundError('Account no longer exists');

    const { rotated } = await rotateIfExpired(pool, user);
    if (rotated) {
      user = (await findUserById(pool, auth.userId))!;
      await recordAuditBestEffort(
        pool,
        {
          actorId: user.id,
          action: 'security_number_rotated',
          resourceType: 'user',
          resourceId: user.id,
          metadata: { customerId: user.customer_id, trigger: 'expired_on_access', version: user.security_number_version },
        },
        requestAuditContext(request)
      );
    }

    return { securityNumber: await getStatus(pool, user), rotated };
  });

  /**
   * Temporary reveal. Requires step-up re-authentication (the account password) when policy
   * demands it, is rate limited, and is refused outright inside a support session. Because only
   * a hash is stored, "revealing" necessarily means issuing a new value — the old one cannot be
   * recovered, by anyone, including us. The response therefore carries a short display TTL.
   */
  app.post(
    '/api/v1/account/security-number/reveal',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request) => {
      const auth = await authenticate(request, env, pool);
      await guardSupportMode(pool, request, auth, 'security_number.reveal');

      const { password } = parseOrThrow(revealSchema, request.body);
      const user = await findUserById(pool, auth.userId);
      if (!user) throw new NotFoundError('Account no longer exists');

      const policy = await getSecurityNumberPolicy(pool);
      const failures = await countRecentFailures(pool, user.id, policy.attemptWindowSeconds);
      if (failures >= policy.maxAttempts) {
        throw new ForbiddenError('Too many failed attempts. Please wait before trying again.');
      }

      if (policy.requireStepUp) {
        const ok = await verifyPassword(password, user.password_hash);
        await recordVerificationAttempt(pool, {
          id: randomUUID(),
          userId: user.id,
          succeeded: ok,
          ipAddress: request.ip,
        });
        if (!ok) {
          await recordAuditBestEffort(
            pool,
            {
              actorId: user.id,
              action: 'security_number_reveal_failed',
              resourceType: 'user',
              resourceId: user.id,
              metadata: { customerId: user.customer_id, reason: 'step_up_failed' },
            },
            requestAuditContext(request)
          );
          throw new UnauthorizedError('Password is incorrect');
        }
      }

      const rotation = await rotateSecurityNumber(pool, user.id);
      if (!rotation) throw new NotFoundError('Account no longer exists');

      await auditRequest(pool, request, user.id, {
        action: 'security_number_revealed',
        resourceType: 'user',
        resourceId: user.id,
        metadata: { customerId: user.customer_id, version: rotation.version },
      });

      return {
        securityNumber: {
          value: rotation.securityNumber,
          version: rotation.version,
          expiresAt: rotation.expiresAt,
          /** How long the UI should keep the value on screen before hiding it again. */
          displayTtlSeconds: policy.revealTtlSeconds,
        },
      };
    }
  );

  /**
   * Customer-chosen change. Requires the current value (proving the caller actually holds it),
   * enforces the four-digit format, and starts a fresh full rotation window from *now*.
   */
  app.post(
    '/api/v1/account/security-number/change',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const auth = await authenticate(request, env, pool);
      await guardSupportMode(pool, request, auth, 'security_number.change');

      const { currentSecurityNumber, newSecurityNumber } = parseOrThrow(changeSecurityNumberSchema, request.body);
      if (!isValidSecurityNumberFormat(newSecurityNumber)) {
        throw new ValidationError('The new Security Number must be exactly four digits');
      }

      const user = await findUserById(pool, auth.userId);
      if (!user) throw new NotFoundError('Account no longer exists');

      const policy = await getSecurityNumberPolicy(pool);
      if (!policy.allowManualRotation) {
        throw new ForbiddenError('Manual Security Number changes are disabled by platform policy');
      }
      if (!user.security_number_initialized || !user.security_number_hash) {
        throw new ValidationError(
          'This account has no Security Number yet. Request one from the security number status endpoint first.'
        );
      }

      const failures = await countRecentFailures(pool, user.id, policy.attemptWindowSeconds);
      if (failures >= policy.maxAttempts) {
        throw new ForbiddenError('Too many failed attempts. Please wait before trying again.');
      }

      const matches = await verifySecurityNumberHash(currentSecurityNumber, user.security_number_hash);
      await recordVerificationAttempt(pool, {
        id: randomUUID(),
        userId: user.id,
        succeeded: matches,
        ipAddress: request.ip,
      });
      if (!matches) {
        await recordAuditBestEffort(
          pool,
          {
            actorId: user.id,
            action: 'security_number_verification_failed',
            resourceType: 'user',
            resourceId: user.id,
            metadata: { customerId: user.customer_id },
          },
          requestAuditContext(request)
        );
        throw new UnauthorizedError('The current Security Number is incorrect');
      }

      const rotation = await rotateSecurityNumber(pool, user.id, { plain: newSecurityNumber });
      if (!rotation) throw new NotFoundError('Account no longer exists');

      await auditRequest(pool, request, user.id, {
        action: 'security_number_changed',
        resourceType: 'user',
        resourceId: user.id,
        metadata: { customerId: user.customer_id, version: rotation.version },
      });

      reply.code(200);
      return {
        securityNumber: { version: rotation.version, expiresAt: rotation.expiresAt, createdAt: rotation.createdAt },
      };
    }
  );

  // --- Profile image -----------------------------------------------------------------------------

  app.get('/api/v1/account/profile-image', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const image = await getProfileImage(pool, auth.userId);
    if (!image) throw new NotFoundError('No profile image has been uploaded');

    const bytes = Buffer.isBuffer(image.data) ? image.data : Buffer.from(image.data as Uint8Array);
    reply
      .header('Content-Type', image.content_type)
      .header('Content-Length', String(bytes.length))
      // Private: an avatar is served through an authenticated route and must not be cached by
      // shared proxies where another user could receive it.
      .header('Cache-Control', 'private, max-age=60')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Disposition', `inline; filename="profile-${image.id}"`);
    return reply.send(bytes);
  });

  app.put(
    '/api/v1/account/profile-image',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const auth = await authenticate(request, env, pool);
      const input = parseOrThrow(uploadImageSchema, request.body);

      const validated = validateProfileImageUpload(input);
      // The storage key is generated here, server-side. The client's filename is never used as
      // a key, so it cannot influence where or under what name the object lives.
      const meta = await upsertProfileImage(pool, {
        id: randomUUID(),
        userId: auth.userId,
        contentType: validated.contentType,
        data: validated.data,
        checksum: validated.checksum,
        uploadedBy: auth.actingAdminId ?? auth.userId,
      });

      await recordAuditBestEffort(
        pool,
        {
          actorId: auth.actingAdminId ?? auth.userId,
          action: 'account_profile_image_updated',
          resourceType: 'user',
          resourceId: auth.userId,
          metadata: {
            customerId: auth.customerId,
            contentType: meta.content_type,
            byteSize: meta.byte_size,
            viaSupportSession: auth.supportSessionId ?? null,
          },
        },
        requestAuditContext(request)
      );

      reply.code(200);
      return { profileImage: { contentType: meta.content_type, byteSize: meta.byte_size, updatedAt: meta.updated_at } };
    }
  );

  app.delete('/api/v1/account/profile-image', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const removed = await deleteProfileImage(pool, auth.userId);
    if (!removed) throw new NotFoundError('No profile image has been uploaded');

    await recordAuditBestEffort(
      pool,
      {
        actorId: auth.actingAdminId ?? auth.userId,
        action: 'account_profile_image_removed',
        resourceType: 'user',
        resourceId: auth.userId,
        metadata: { customerId: auth.customerId, viaSupportSession: auth.supportSessionId ?? null },
      },
      requestAuditContext(request)
    );

    reply.code(204);
    return null;
  });
}
