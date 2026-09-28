import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { authenticate } from '../lib/require-auth';
import { ValidationError } from '../lib/errors';
import { getMyInvoiceDetail, listMyInvoices } from '../services/billing-service';

const idParamSchema = z.object({ id: z.string().uuid('id must be a valid UUID') });

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
  }
  return parsed.data;
}

/**
 * Phase 5B "Billing foundation" API — invoices and the ledger entries behind them. See
 * docs/API_BILLING.md for the full contract.
 *
 * Same rules as src/routes/commerce.ts (Phase 5A):
 *   - `authenticate()` on every request; every query is scoped to the caller's own `user_id`. An
 *     invoice that exists but belongs to a different customer is never distinguishable from one
 *     that doesn't exist — `404`, never `403`.
 *   - There is no route here that creates, edits, or deletes an invoice or a ledger entry — both
 *     are produced only as a side effect of checkout (src/services/commerce-service.ts#checkoutCart
 *     -> src/services/billing-service.ts#issueInvoiceForOrder). Financial history is never
 *     client-writable.
 *   - Admin/staff invoice-viewing routes are explicitly out of scope for this phase (deferred to
 *     5F, same as Phase 5A's order-viewing routes).
 */
export async function registerBillingRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  app.get('/api/v1/invoices', async (request) => {
    const auth = await authenticate(request, env, pool);
    const invoices = await listMyInvoices(pool, auth.userId);
    return { invoices };
  });

  app.get<{ Params: { id: string } }>('/api/v1/invoices/:id', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParamSchema, request.params);

    const invoice = await getMyInvoiceDetail(pool, auth.userId, id);
    return { invoice };
  });
}
