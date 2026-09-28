import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { requireRole } from '../lib/require-role';
import { ValidationError } from '../lib/errors';
import { confirmManualPayment, rejectManualPayment } from '../services/payment-service';

// Confirming/rejecting a manual bank-transfer payment is routine billing support work — the staff
// equivalent of an automated webhook arriving — not an account-integrity action (it can't lock
// anyone out of their account or escalate anyone's privilege), so it is available to both
// privileged roles, mirroring the `admin`+`super_admin` split already used for routine customer
// support work in src/routes/admin-customers.ts (`CUSTOMER_MANAGEMENT_ROLES`).
const BILLING_STAFF_ROLES = ['admin', 'super_admin'] as const;

const idParamSchema = z.object({ id: z.string().uuid('id must be a valid UUID') });
const rejectPaymentSchema = z.object({ reason: z.string().min(1).max(2000) });

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
  }
  return parsed.data;
}

/**
 * Phase 5C staff-side billing API — the manual/offline gateway's confirmation mechanism only.
 * See docs/API_PAYMENTS.md for the full contract.
 *
 * This is deliberately narrow: two single-purpose endpoints for resolving a `manual`-provider
 * payment that's still `pending`. It is NOT the broader Phase 5F admin billing dashboard
 * (search/filter/view-all-invoices, refunds, etc.) — that remains out of scope for this phase.
 */
export async function registerAdminBillingRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  app.post<{ Params: { id: string } }>('/api/v1/admin/payments/:id/confirm-manual', async (request) => {
    const auth = await requireRole(request, env, pool, BILLING_STAFF_ROLES);
    const { id } = parseOrThrow(idParamSchema, request.params);

    const payment = await confirmManualPayment(pool, auth.userId, id, randomUUID, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });

    return { payment };
  });

  app.post<{ Params: { id: string } }>('/api/v1/admin/payments/:id/reject-manual', async (request) => {
    const auth = await requireRole(request, env, pool, BILLING_STAFF_ROLES);
    const { id } = parseOrThrow(idParamSchema, request.params);
    const { reason } = parseOrThrow(rejectPaymentSchema, request.body);

    const payment = await rejectManualPayment(pool, auth.userId, id, reason, randomUUID, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });

    return { payment };
  });
}
