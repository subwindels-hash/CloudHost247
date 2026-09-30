/**
 * Administrative user management, Security Number oversight, and support-mode account switching
 * (spec §20, §32–§40, §21–§25).
 *
 *   GET    /api/v1/admin/users                          — search/list (incl. Customer ID lookup)
 *   POST   /api/v1/admin/users                          — create (auto Customer ID + Security Number)
 *   GET    /api/v1/admin/users/:id                      — detail
 *   PATCH  /api/v1/admin/users/:id                      — update (role/status: super_admin only)
 *   DELETE /api/v1/admin/users/:id                      — soft delete (history preserved)
 *   GET    /api/v1/admin/users/:id/security-number      — status metadata only, never the value
 *   POST   /api/v1/admin/users/:id/security-number/rotate
 *   POST   /api/v1/admin/users/:id/security-number/require-reinitialization
 *   GET/PUT /api/v1/admin/security-number/policy        — super_admin policy configuration
 *   POST   /api/v1/admin/customers/:id/switch           — begin a delegated support session
 *   GET    /api/v1/admin/support-sessions               — active/recent sessions
 *   POST   /api/v1/admin/support-sessions/:id/end       — end one
 *
 * Two rules dominate this file:
 *   1. **No administrator ever sees a Security Number.** Not the plaintext (it isn't stored) and
 *      not the hash (it is never selected into a DTO). Admins can only see lifecycle metadata and
 *      force a rotation, which issues a value only the customer can retrieve.
 *   2. **Switching never uses the customer's credentials.** It mints a separate, short-lived,
 *      individually revocable delegated session that keeps the acting admin's identity attached.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { setSetting } from '../db/ops-tables';
import { getProfileImageMeta } from '../db/profile-images';
import {
  createSupportSession,
  endSupportSession,
  findSupportSessionById,
  listSupportSessions,
} from '../db/support-sessions';
import {
  findUserByEmail,
  findUserById,
  listUsers,
  restoreUser,
  softDeleteUser,
  updateProfileFields,
  updateUserRole,
  updateUserStatus,
  type UserRole,
} from '../db/users';
import { toAdminCustomerSummaryDTO, toAdminUserDetailDTO } from '../dto/account';
import { auditRequest } from '../lib/audit';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../lib/errors';
import { signAuthToken } from '../lib/jwt';
import { hashPassword } from '../lib/password';
import { authenticate } from '../lib/require-auth';
import { requireRole } from '../lib/require-role';
import { createUserWithIdentity } from '../services/customer-identity-service';
import {
  SETTING_KEYS,
  expiryFromNow,
  generateSecurityNumber,
  getSecurityNumberPolicy,
  getStatus,
  hashSecurityNumber,
  requireReinitialization,
  rotateSecurityNumber,
} from '../services/security-number-service';

// Mirrors the split already established in src/routes/admin-customers.ts: routine support work
// for admin + super_admin, account-integrity actions (role/status/deletion, policy) for
// super_admin only.
const USER_MANAGEMENT_ROLES = ['admin', 'super_admin'] as const;
const ACCOUNT_INTEGRITY_ROLES = ['super_admin'] as const;

const idParamSchema = z.object({ id: z.string().uuid('id must be a valid UUID') });

const listUsersQuerySchema = z.object({
  /** Matches email, name, phone, the six-digit Customer ID, or the internal UUID. */
  search: z.string().max(255).optional(),
  role: z.enum(['customer', 'staff', 'admin', 'super_admin']).optional(),
  status: z.enum(['active', 'suspended', 'disabled', 'deleted']).optional(),
  includeDeleted: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const createUserSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1).max(255),
  password: z.string().min(10, 'Password must be at least 10 characters'),
  role: z.enum(['customer', 'staff', 'admin', 'super_admin']).optional(),
  phone: z.string().max(32).nullable().optional(),
});

const updateUserSchema = z
  .object({
    fullName: z.string().min(1).max(255).optional(),
    phone: z.string().max(32).nullable().optional(),
    addressLine1: z.string().max(255).nullable().optional(),
    city: z.string().max(120).nullable().optional(),
    state: z.string().max(120).nullable().optional(),
    postalCode: z.string().max(32).nullable().optional(),
    country: z.string().max(64).nullable().optional(),
    role: z.enum(['customer', 'staff', 'admin', 'super_admin']).optional(),
    status: z.enum(['active', 'suspended', 'disabled']).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field must be provided' });

const switchSchema = z.object({
  reason: z.string().min(1, 'reason is required').max(255),
  /** Optional override, capped by policy below. */
  minutes: z.coerce.number().int().min(1).max(240).optional(),
});

const policySchema = z
  .object({
    rotationHours: z.number().int().min(1).max(8760).optional(),
    allowManualRotation: z.boolean().optional(),
    requireStepUp: z.boolean().optional(),
    maxVerificationAttempts: z.number().int().min(1).max(100).optional(),
    attemptWindowSeconds: z.number().int().min(10).max(86400).optional(),
    revealTtlSeconds: z.number().int().min(10).max(3600).optional(),
    supportSessionMinutes: z.number().int().min(1).max(240).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one setting must be provided' });

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
  }
  return parsed.data;
}

export async function registerAdminUserRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  // --- Directory --------------------------------------------------------------------------------

  app.get('/api/v1/admin/users', async (request) => {
    await requireRole(request, env, pool, USER_MANAGEMENT_ROLES);
    const query = parseOrThrow(listUsersQuerySchema, request.query);
    const result = await listUsers(pool, {
      search: query.search,
      role: query.role,
      status: query.status,
      includeDeleted: query.includeDeleted === true || query.status === 'deleted',
      limit: query.limit ?? 25,
      offset: query.offset ?? 0,
    });
    return { users: result.users.map(toAdminCustomerSummaryDTO), total: result.total };
  });

  app.post('/api/v1/admin/users', async (request, reply) => {
    const actor = await requireRole(request, env, pool, USER_MANAGEMENT_ROLES);
    const input = parseOrThrow(createUserSchema, request.body);

    // Only a super_admin may mint privileged accounts — an admin can create customers/staff.
    const role: UserRole = input.role ?? 'customer';
    if ((role === 'admin' || role === 'super_admin') && actor.role !== 'super_admin') {
      throw new ForbiddenError('Only a super admin can create administrator accounts');
    }

    if (await findUserByEmail(pool, input.email)) {
      throw new ConflictError('An account with this email already exists');
    }

    const policy = await getSecurityNumberPolicy(pool);
    const securityNumber = generateSecurityNumber();
    const { user } = await createUserWithIdentity(pool, {
      email: input.email,
      fullName: input.fullName,
      passwordHash: await hashPassword(input.password),
      role,
      securityNumberHash: await hashSecurityNumber(securityNumber),
      securityNumberExpiresAt: expiryFromNow(policy.rotationHours),
    });

    if (input.phone !== undefined) {
      await updateProfileFields(pool, user.id, { phone: input.phone });
    }

    await auditRequest(pool, request, actor.userId, {
      action: 'admin_user_created',
      resourceType: 'user',
      resourceId: user.id,
      metadata: { customerId: user.customer_id, role, email: user.email },
    });

    const created = (await findUserById(pool, user.id))!;
    reply.code(201);
    // Note what is absent: the generated Security Number. It is issued so the account has a
    // valid credential from minute one, but the administrator who created the account does not
    // get to see it — the customer retrieves it themselves via their own step-up reveal.
    return { user: toAdminUserDetailDTO(created) };
  });

  app.get('/api/v1/admin/users/:id', async (request) => {
    await requireRole(request, env, pool, USER_MANAGEMENT_ROLES);
    const { id } = parseOrThrow(idParamSchema, request.params);
    const user = await findUserById(pool, id);
    if (!user) throw new NotFoundError('User not found');
    const image = await getProfileImageMeta(pool, user.id);
    return { user: toAdminUserDetailDTO(user, image !== null) };
  });

  app.patch('/api/v1/admin/users/:id', async (request) => {
    const actor = await requireRole(request, env, pool, USER_MANAGEMENT_ROLES);
    const { id } = parseOrThrow(idParamSchema, request.params);
    const input = parseOrThrow(updateUserSchema, request.body);

    const existing = await findUserById(pool, id);
    if (!existing) throw new NotFoundError('User not found');

    if ((input.role !== undefined || input.status !== undefined) && actor.role !== 'super_admin') {
      throw new ForbiddenError('Only a super admin can change an account role or status');
    }
    // Lockout protection, matching src/routes/admin-customers.ts.
    if (input.role !== undefined && id === actor.userId) {
      throw new ForbiddenError('You cannot change your own role');
    }
    if (input.status !== undefined && id === actor.userId) {
      throw new ForbiddenError('You cannot change your own account status');
    }

    const { role, status, ...profile } = input;
    if (Object.keys(profile).length > 0) {
      await updateProfileFields(pool, id, profile);
    }
    if (role !== undefined) {
      await updateUserRole(pool, id, role);
    }
    if (status !== undefined) {
      if (existing.deleted_at) {
        await restoreUser(pool, id);
      }
      await updateUserStatus(pool, id, status);
    }

    const updated = (await findUserById(pool, id))!;
    await auditRequest(pool, request, actor.userId, {
      action: 'admin_user_updated',
      resourceType: 'user',
      resourceId: id,
      metadata: { customerId: updated.customer_id, fields: Object.keys(input) },
    });

    return { user: toAdminUserDetailDTO(updated) };
  });

  /**
   * Soft delete. The row, its Customer ID, and every invoice/payment/ticket/audit record that
   * references it stay exactly where they are — only the ability to sign in goes away. Hard
   * deletion is deliberately not offered: it would orphan financial history (spec §22).
   */
  app.delete('/api/v1/admin/users/:id', async (request, reply) => {
    const actor = await requireRole(request, env, pool, ACCOUNT_INTEGRITY_ROLES);
    const { id } = parseOrThrow(idParamSchema, request.params);
    if (id === actor.userId) {
      throw new ForbiddenError('You cannot delete your own account');
    }

    const user = await findUserById(pool, id);
    if (!user) throw new NotFoundError('User not found');
    if (user.deleted_at) {
      reply.code(204);
      return null;
    }

    await softDeleteUser(pool, id, actor.userId);
    await auditRequest(pool, request, actor.userId, {
      action: 'admin_user_deleted',
      resourceType: 'user',
      resourceId: id,
      metadata: { customerId: user.customer_id, mode: 'soft_delete' },
    });

    reply.code(204);
    return null;
  });

  // --- Security Number oversight -----------------------------------------------------------------

  app.get('/api/v1/admin/users/:id/security-number', async (request) => {
    await requireRole(request, env, pool, USER_MANAGEMENT_ROLES);
    const { id } = parseOrThrow(idParamSchema, request.params);
    const user = await findUserById(pool, id);
    if (!user) throw new NotFoundError('User not found');
    // getStatus() returns lifecycle metadata only — there is no code path anywhere that can
    // hand an administrator the value or its hash.
    return { securityNumber: await getStatus(pool, user) };
  });

  app.post('/api/v1/admin/users/:id/security-number/rotate', async (request) => {
    const actor = await requireRole(request, env, pool, USER_MANAGEMENT_ROLES);
    const { id } = parseOrThrow(idParamSchema, request.params);
    const user = await findUserById(pool, id);
    if (!user) throw new NotFoundError('User not found');

    const rotation = await rotateSecurityNumber(pool, id);
    if (!rotation) throw new NotFoundError('User not found');

    await auditRequest(pool, request, actor.userId, {
      action: 'security_number_force_rotated',
      resourceType: 'user',
      resourceId: id,
      metadata: { customerId: user.customer_id, version: rotation.version, trigger: 'admin_forced' },
    });

    const refreshed = (await findUserById(pool, id))!;
    return { securityNumber: await getStatus(pool, refreshed) };
  });

  app.post('/api/v1/admin/users/:id/security-number/require-reinitialization', async (request) => {
    const actor = await requireRole(request, env, pool, ACCOUNT_INTEGRITY_ROLES);
    const { id } = parseOrThrow(idParamSchema, request.params);
    const user = await findUserById(pool, id);
    if (!user) throw new NotFoundError('User not found');

    await requireReinitialization(pool, id);
    await auditRequest(pool, request, actor.userId, {
      action: 'security_number_reinitialization_required',
      resourceType: 'user',
      resourceId: id,
      metadata: { customerId: user.customer_id },
    });

    const refreshed = (await findUserById(pool, id))!;
    return { securityNumber: await getStatus(pool, refreshed) };
  });

  app.get('/api/v1/admin/security-number/policy', async (request) => {
    await requireRole(request, env, pool, USER_MANAGEMENT_ROLES);
    return { policy: await getSecurityNumberPolicy(pool) };
  });

  app.put('/api/v1/admin/security-number/policy', async (request) => {
    const actor = await requireRole(request, env, pool, ACCOUNT_INTEGRITY_ROLES);
    const input = parseOrThrow(policySchema, request.body);

    const writes: Array<[string, unknown]> = [];
    if (input.rotationHours !== undefined) writes.push([SETTING_KEYS.rotationHours, input.rotationHours]);
    if (input.allowManualRotation !== undefined) writes.push([SETTING_KEYS.allowManualRotation, input.allowManualRotation]);
    if (input.requireStepUp !== undefined) writes.push([SETTING_KEYS.requireStepUp, input.requireStepUp]);
    if (input.maxVerificationAttempts !== undefined) writes.push([SETTING_KEYS.maxAttempts, input.maxVerificationAttempts]);
    if (input.attemptWindowSeconds !== undefined) writes.push([SETTING_KEYS.attemptWindowSeconds, input.attemptWindowSeconds]);
    if (input.revealTtlSeconds !== undefined) writes.push([SETTING_KEYS.revealTtlSeconds, input.revealTtlSeconds]);
    if (input.supportSessionMinutes !== undefined) writes.push([SETTING_KEYS.supportSessionMinutes, input.supportSessionMinutes]);

    for (const [key, value] of writes) {
      await setSetting(pool, key, value, actor.userId);
    }

    await auditRequest(pool, request, actor.userId, {
      action: 'security_number_policy_updated',
      resourceType: 'platform_settings',
      resourceId: null,
      metadata: { keys: writes.map(([key]) => key), values: Object.fromEntries(writes) },
    });

    return { policy: await getSecurityNumberPolicy(pool) };
  });

  // --- Support mode (account switching) ----------------------------------------------------------

  /**
   * Starts a delegated session. The returned token authenticates *as the customer* (so every
   * existing ownership-scoped route keeps working untouched) while carrying the support session
   * id and the acting administrator's id, which src/lib/require-auth.ts re-validates against the
   * database on every single request. Nothing about the customer's own credentials, sessions, or
   * Security Number is read, changed, or invalidated.
   */
  app.post('/api/v1/admin/customers/:id/switch', async (request, reply) => {
    const actor = await requireRole(request, env, pool, USER_MANAGEMENT_ROLES);
    const { id } = parseOrThrow(idParamSchema, request.params);
    const { reason, minutes } = parseOrThrow(switchSchema, request.body);

    if (id === actor.userId) {
      throw new ValidationError('You are already signed in to this account');
    }

    const target = await findUserById(pool, id);
    if (!target) throw new NotFoundError('User not found');
    if (target.status !== 'active' || target.deleted_at) {
      throw new ValidationError('You can only switch into an active account');
    }
    // Impersonating another privileged account would be a privilege-escalation path (an admin
    // could act as a super_admin); support mode is for customer accounts only.
    if (target.role === 'admin' || target.role === 'super_admin') {
      throw new ForbiddenError('Administrator accounts cannot be accessed through support mode');
    }

    const policy = await getSecurityNumberPolicy(pool);
    const durationMinutes = Math.min(minutes ?? policy.supportSessionMinutes, policy.supportSessionMinutes);
    const expiresAt = new Date(Date.now() + durationMinutes * 60_000);

    const session = await createSupportSession(pool, {
      id: randomUUID(),
      adminId: actor.userId,
      customerUuid: target.id,
      customerId: target.customer_id ?? null,
      reason,
      expiresAt,
      ipAddress: request.ip,
      userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
    });

    const token = signAuthToken(
      env,
      { sub: target.id, role: target.role, email: target.email, sup: session.id, act: actor.userId },
      { expiresIn: `${durationMinutes}m` }
    );

    await auditRequest(pool, request, actor.userId, {
      action: 'admin_customer_account_switch_started',
      resourceType: 'user',
      resourceId: target.id,
      metadata: {
        customerId: target.customer_id,
        switchSessionId: session.id,
        reason,
        expiresAt: session.expires_at,
      },
    });

    reply.code(201);
    return {
      token,
      supportSession: {
        id: session.id,
        originalAdminId: actor.userId,
        targetUserId: target.id,
        targetCustomerId: target.customer_id,
        targetEmail: target.email,
        targetFullName: target.full_name,
        reason: session.reason,
        startedAt: session.started_at,
        expiresAt: session.expires_at,
      },
    };
  });

  app.get('/api/v1/admin/support-sessions', async (request) => {
    const actor = await requireRole(request, env, pool, USER_MANAGEMENT_ROLES);
    const activeOnly = (request.query as { active?: string } | undefined)?.active !== 'false';
    // An admin sees their own sessions; a super_admin sees everyone's (oversight).
    const sessions = await listSupportSessions(pool, {
      adminId: actor.role === 'super_admin' ? undefined : actor.userId,
      activeOnly,
    });
    return {
      sessions: sessions.map((s) => ({
        id: s.id,
        originalAdminId: s.admin_id,
        targetUserId: s.customer_uuid,
        targetCustomerId: s.customer_id,
        reason: s.reason,
        startedAt: s.started_at,
        expiresAt: s.expires_at,
        endedAt: s.ended_at,
        endedReason: s.ended_reason,
      })),
    };
  });

  /**
   * Ends one session. Callable both by the acting administrator (normally from the support-mode
   * banner) and — because the delegated token itself authenticates as the customer — by that
   * delegated token, which is how "Exit support mode" works from inside the switched session.
   */
  app.post('/api/v1/admin/support-sessions/:id/end', async (request, reply) => {
    const { id } = parseOrThrow(idParamSchema, request.params);

    const session = await findSupportSessionById(pool, id);
    if (!session) throw new NotFoundError('Support session not found');

    // Authorize either as the acting admin/super_admin, or as the delegated session itself.
    let actorId: string;
    try {
      const actor = await requireRole(request, env, pool, USER_MANAGEMENT_ROLES);
      if (actor.role !== 'super_admin' && session.admin_id !== actor.userId) {
        throw new NotFoundError('Support session not found');
      }
      actorId = actor.userId;
    } catch (error) {
      const auth = await authenticate(request, env, pool);
      if (auth.supportSessionId !== id) throw error;
      actorId = auth.actingAdminId ?? auth.userId;
    }

    const ended = await endSupportSession(pool, id, 'admin_exit');
    await auditRequest(pool, request, actorId, {
      action: 'admin_customer_account_switch_ended',
      resourceType: 'user',
      resourceId: session.customer_uuid,
      metadata: {
        customerId: session.customer_id,
        switchSessionId: id,
        endedReason: ended?.ended_reason ?? session.ended_reason,
      },
    });

    reply.code(204);
    return null;
  });
}
