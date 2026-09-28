import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { authenticate } from '../lib/require-auth';
import { ValidationError } from '../lib/errors';
import { AVAILABLE_GATEWAY_IDS } from '../payments/gateway-registry';
import { getMyPaymentDetail, initiatePaymentForInvoice } from '../services/payment-service';

const idParamSchema = z.object({ id: z.string().uuid('id must be a valid UUID') });
const initiatePaymentSchema = z.object({
  gateway: z.enum(AVAILABLE_GATEWAY_IDS as [string, ...string[]], {
    errorMap: () => ({ message: `gateway must be one of: ${AVAILABLE_GATEWAY_IDS.join(', ')}` }),
  }),
});

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
  }
  return parsed.data;
}

/**
 * Phase 5C "Payment integration" — customer-facing API. See docs/API_PAYMENTS.md for the full
 * contract.
 *
 * Same rules as src/routes/billing.ts (Phase 5B):
 *   - `authenticate()` on every request; every query is scoped to the caller's own `user_id` — a
 *     payment/invoice that exists but belongs to a different customer is never distinguishable
 *     from one that doesn't exist (`404`, never `403`).
 *   - Initiating a payment only ever produces a `pending` attempt (src/payments/*); resolving it
 *     is either the manual gateway's staff-confirmation flow (src/routes/admin-billing.ts) or
 *     Phase 5D's webhook receiver (not built yet) — no route here ever marks a payment
 *     successful/failed directly.
 */
export async function registerPaymentRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  app.post<{ Params: { id: string } }>('/api/v1/invoices/:id/payments', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const { id: invoiceId } = parseOrThrow(idParamSchema, request.params);
    const { gateway } = parseOrThrow(initiatePaymentSchema, request.body);

    const payment = await initiatePaymentForInvoice(pool, env, auth.userId, invoiceId, gateway, randomUUID, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });

    reply.code(201);
    return { payment };
  });

  app.get<{ Params: { id: string } }>('/api/v1/payments/:id', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParamSchema, request.params);

    const payment = await getMyPaymentDetail(pool, auth.userId, id);
    return { payment };
  });
}
