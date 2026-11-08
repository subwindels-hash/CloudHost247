/**
 * Staff oversight for the customer identity + Security PIN system.
 *
 *   GET  /api/v1/admin/security-pin/policy        — read the rotation / verification policy
 *   PUT  /api/v1/admin/security-pin/policy        — super_admin: change it
 *   GET  /api/v1/admin/recovery-requests          — the recovery queue
 *   GET  /api/v1/admin/recovery-requests/:id      — one request
 *   PATCH /api/v1/admin/recovery-requests/:id     — move it through the workflow
 *
 * What an administrator can and cannot do here is the point of the file:
 *
 *   - They can see *lifecycle metadata* for a customer's PIN (when it was issued, when it rotates,
 *     which version) through the existing `/api/v1/admin/users/:id/security-number` shape and the
 *     status fields added below. They can never see the value, the hash, the salt or the sealed
 *     envelope. There is no "show me the PIN" endpoint, and adding one would break the contract.
 *   - They cannot change a Customer ID. The database trigger installed by migration 0085 rejects it
 *     even if a future route forgets to strip the field, and no route here accepts it.
 *   - Recovery handling is deliberately two-step: a staff member records that identity was verified
 *     (`IDENTITY_VERIFIED`), and only then can the request be approved. Approval revokes the
 *     account's email verification and cancels outstanding challenges — it does not reveal, reset
 *     or rotate the PIN, and it cannot change the registered email address.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { findUserById, listUsers } from '../db/users';
import { setSetting } from '../db/ops-tables';
import { toAdminCustomerSummaryDTO } from '../dto/account';
import { auditRequest } from '../lib/audit';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors';
import { requireRole } from '../lib/require-role';
import {
  PIN_SETTING_KEYS,
  describeSecurityPin,
  getSecurityPinPolicy,
  listAccountsNeedingPinRotation,
  rotateSecurityPin,
} from '../services/security-pin-service';
import {
  findRecoveryRequest,
  listRecoveryRequests,
  transitionRecoveryRequest,
} from '../services/account-recovery-service';

const USER_MANAGEMENT_ROLES = ['admin', 'super_admin'] as const;
const SUPER_ADMIN = ['super_admin'] as const;

const idParamSchema = z.object({ id: z.string().uuid('id must be a valid UUID') });

const policySchema = z
  .object({
    rotationHours: z.number().int().min(1).max(720).optional(),
    revealTtlSeconds: z.number().int().min(5).max(300).optional(),
    verificationCodeTtlMinutes: z.number().int().min(1).max(60).optional(),
    verificationMaxAttempts: z.number().int().min(1).max(20).optional(),
    verificationResendCooldownSeconds: z.number().int().min(0).max(600).optional(),
    verificationMaxResends: z.number().int().min(0).max(10).optional(),
    notifyOnRotation: z.boolean().optional(),
  })
  .strict();

const recoveryTransitionSchema = z
  .object({
    status: z.enum(['IDENTITY_VERIFIED', 'APPROVED', 'REJECTED', 'CANCELLED']),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join(', '));
  }
  return parsed.data;
}

export async function registerAdminAccountSecurityRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  app.get('/api/v1/admin/security-pin/policy', async (request) => {
    await requireRole(request, env, pool, USER_MANAGEMENT_ROLES);
    return { policy: await getSecurityPinPolicy(pool) };
  });

  app.put('/api/v1/admin/security-pin/policy', async (request) => {
    const actor = await requireRole(request, env, pool, SUPER_ADMIN);
    const input = parseOrThrow(policySchema, request.body);

    const mapping: Array<[keyof typeof input, string]> = [
      ['rotationHours', PIN_SETTING_KEYS.rotationHours],
      ['revealTtlSeconds', PIN_SETTING_KEYS.revealTtlSeconds],
      ['verificationCodeTtlMinutes', PIN_SETTING_KEYS.verificationCodeTtlMinutes],
      ['verificationMaxAttempts', PIN_SETTING_KEYS.verificationMaxAttempts],
      ['verificationResendCooldownSeconds', PIN_SETTING_KEYS.verificationResendCooldownSeconds],
      ['verificationMaxResends', PIN_SETTING_KEYS.verificationMaxResends],
      ['notifyOnRotation', PIN_SETTING_KEYS.notifyOnRotation],
    ];
    for (const [field, key] of mapping) {
      const value = input[field];
      if (value !== undefined) await setSetting(pool, key, value, actor.userId);
    }

    await auditRequest(pool, request, actor.userId, {
      action: 'admin_security_pin_policy_updated',
      resourceType: 'platform_settings',
      metadata: { fields: Object.keys(input) },
    });
    return { policy: await getSecurityPinPolicy(pool) };
  });

  /** Lifecycle metadata for one customer's PIN. Never the value, hash, salt or envelope. */
  app.get('/api/v1/admin/users/:id/security-pin', async (request) => {
    await requireRole(request, env, pool, USER_MANAGEMENT_ROLES);
    const { id } = parseOrThrow(idParamSchema, request.params);
    const user = await findUserById(pool, id);
    if (!user) throw new NotFoundError('User not found');
    const policy = await getSecurityPinPolicy(pool);
    return {
      securityPin: describeSecurityPin(user, policy.rotationHours),
      customer: toAdminCustomerSummaryDTO(user),
    };
  });

  /**
   * Force a rotation (support action after a suspected compromise). The new value is *not* returned
   * to the administrator — it is sealed for the customer, who must complete email verification to
   * read it. Audited without any secret.
   */
  app.post('/api/v1/admin/users/:id/security-pin/rotate', async (request) => {
    const actor = await requireRole(request, env, pool, USER_MANAGEMENT_ROLES);
    const { id } = parseOrThrow(idParamSchema, request.params);
    const user = await findUserById(pool, id);
    if (!user) throw new NotFoundError('User not found');

    const rotation = await rotateSecurityPin(pool, user.id);
    if (!rotation) throw new NotFoundError('User not found');

    await auditRequest(pool, request, actor.userId, {
      action: 'admin_security_pin_rotated',
      resourceType: 'user',
      resourceId: user.id,
      metadata: { customerId: user.customer_id, version: rotation.version },
    });

    const refreshed = (await findUserById(pool, user.id))!;
    const policy = await getSecurityPinPolicy(pool);
    return { securityPin: describeSecurityPin(refreshed, policy.rotationHours) };
  });

  /** Customers whose PIN is due for rotation — an operator view of the sweep's work queue. */
  app.get('/api/v1/admin/security-pin/due', async (request) => {
    await requireRole(request, env, pool, USER_MANAGEMENT_ROLES);
    const due = await listAccountsNeedingPinRotation(pool, 100);
    return {
      due: due.map((user) => ({
        id: user.id,
        username: user.username,
        customerId: user.customer_id,
        email: user.email,
        expiresAt: user.security_pin_expires_at,
        version: user.security_pin_version,
      })),
    };
  });

  // --- Recovery queue ---------------------------------------------------------------------------

  app.get('/api/v1/admin/recovery-requests', async (request) => {
    await requireRole(request, env, pool, USER_MANAGEMENT_ROLES);
    const query = parseOrThrow(
      z.object({
        status: z.enum(['OPEN', 'IDENTITY_VERIFIED', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
      }),
      request.query
    );
    const rows = await listRecoveryRequests(pool, { status: query.status, limit: 100 });
    return {
      recoveries: rows.map((row) => ({
        id: row.id,
        reference: row.reference,
        status: row.status,
        reason: row.reason,
        createdAt: row.created_at,
        resolvedAt: row.resolved_at,
        note: row.resolution_note,
        customer: {
          id: row.user_id,
          username: row.username,
          customerId: row.customer_id,
          email: row.user_email,
        },
      })),
    };
  });

  app.get('/api/v1/admin/recovery-requests/:id', async (request) => {
    await requireRole(request, env, pool, USER_MANAGEMENT_ROLES);
    const { id } = parseOrThrow(idParamSchema, request.params);
    const recovery = await findRecoveryRequest(pool, id);
    if (!recovery) throw new NotFoundError('Recovery request not found');
    const user = await findUserById(pool, recovery.user_id);
    return {
      recovery: {
        id: recovery.id,
        reference: recovery.reference,
        status: recovery.status,
        reason: recovery.reason,
        contactEmail: recovery.contact_email,
        contactPhone: recovery.contact_phone,
        details: recovery.details,
        createdAt: recovery.created_at,
        resolvedAt: recovery.resolved_at,
        note: recovery.resolution_note,
      },
      customer: user ? toAdminCustomerSummaryDTO(user) : null,
    };
  });

  app.patch('/api/v1/admin/recovery-requests/:id', async (request) => {
    const actor = await requireRole(request, env, pool, USER_MANAGEMENT_ROLES);
    const { id } = parseOrThrow(idParamSchema, request.params);
    const input = parseOrThrow(recoveryTransitionSchema, request.body);

    const existing = await findRecoveryRequest(pool, id);
    if (!existing) throw new NotFoundError('Recovery request not found');

    // Two-step workflow: approval requires a recorded identity verification first, so a single
    // slip of the mouse cannot grant a recovery.
    if (input.status === 'APPROVED' && existing.status !== 'IDENTITY_VERIFIED') {
      throw new ConflictError(
        'Record that the customer\'s identity was verified before approving this recovery request.'
      );
    }
    if (input.status === 'REJECTED' && !input.note) {
      throw new ValidationError('A rejection must include a note explaining why, for the audit trail.');
    }

    const updated = await transitionRecoveryRequest(pool, {
      id,
      status: input.status,
      actorId: actor.userId,
      note: input.note ?? null,
      ipAddress: request.ip,
      userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
    });
    if (!updated) throw new ConflictError('That recovery request is no longer open');

    await auditRequest(pool, request, actor.userId, {
      action: `admin_account_recovery_${input.status.toLowerCase()}`,
      resourceType: 'user',
      resourceId: updated.user_id,
      metadata: { reference: updated.reference, status: input.status, note: input.note ?? null },
    });

    // Anything the customer should be told is delivered by the caller's normal notification
    // pipeline; here we only return the resulting state.
    return {
      recovery: {
        id: updated.id,
        reference: updated.reference,
        status: updated.status,
        resolvedAt: updated.resolved_at,
        note: updated.resolution_note,
      },
    };
  });

  /** Directory search by username as well as the existing email / Customer ID lanes. */
  app.get('/api/v1/admin/customers/lookup', async (request) => {
    await requireRole(request, env, pool, USER_MANAGEMENT_ROLES);
    const query = parseOrThrow(z.object({ q: z.string().trim().min(1).max(120) }), request.query);
    const result = await listUsers(pool, { search: query.q, limit: 20, offset: 0 });
    return { customers: result.users.map(toAdminCustomerSummaryDTO), total: result.total };
  });
}
