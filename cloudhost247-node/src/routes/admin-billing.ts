import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { requireRole } from '../lib/require-role';
import { ValidationError } from '../lib/errors';
import { confirmManualPayment, rejectManualPayment } from '../services/payment-service';
import {
  adminCancelInvoice,
  adminGetInvoiceDetail,
  adminIssueRefund,
  adminListInvoices,
  adminListLedger,
} from '../services/billing-service';

// Confirming/rejecting a manual bank-transfer payment, viewing invoices/ledger, issuing refunds,
// and cancelling invoices are billing operations available to admin and super_admin roles.
const BILLING_STAFF_ROLES = ['admin', 'super_admin'] as const;

const idParamSchema = z.object({ id: z.string().uuid('id must be a valid UUID') });
const rejectPaymentSchema = z.object({ reason: z.string().min(1).max(2000) });

const listInvoicesQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  status: z.enum(['paid', 'unpaid', 'void', 'refunded', 'partially_refunded']).optional(),
  search: z.string().max(100).optional(),
});

const listLedgerQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  userId: z.string().uuid().optional(),
  invoiceId: z.string().uuid().optional(),
  entryType: z.enum(['charge', 'payment', 'refund', 'credit']).optional(),
});

const refundInvoiceSchema = z.object({
  amountCents: z.number().int().positive('Refund amount must be a positive integer in cents'),
  reason: z.string().min(1, 'Reason is required').max(2000),
});

const cancelInvoiceSchema = z.object({
  reason: z.string().min(1, 'Reason is required').max(2000),
});

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
  }
  return parsed.data;
}

/**
 * Phase 5C & 5F staff-side billing API routes.
 */
export async function registerAdminBillingRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  // --- Phase 5F: Invoices Management ---
  app.get('/api/v1/admin/invoices', async (request) => {
    await requireRole(request, env, pool, BILLING_STAFF_ROLES);
    const query = parseOrThrow(listInvoicesQuerySchema, request.query);
    return adminListInvoices(pool, query);
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/invoices/:id', async (request) => {
    await requireRole(request, env, pool, BILLING_STAFF_ROLES);
    const { id } = parseOrThrow(idParamSchema, request.params);
    const invoice = await adminGetInvoiceDetail(pool, id);
    return { invoice };
  });

  app.post<{ Params: { id: string } }>('/api/v1/admin/invoices/:id/refund', async (request) => {
    const auth = await requireRole(request, env, pool, BILLING_STAFF_ROLES);
    const { id } = parseOrThrow(idParamSchema, request.params);
    const { amountCents, reason } = parseOrThrow(refundInvoiceSchema, request.body);

    const invoice = await adminIssueRefund(pool, auth.userId, id, amountCents, reason, randomUUID, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });

    return { invoice };
  });

  app.post<{ Params: { id: string } }>('/api/v1/admin/invoices/:id/cancel', async (request) => {
    const auth = await requireRole(request, env, pool, BILLING_STAFF_ROLES);
    const { id } = parseOrThrow(idParamSchema, request.params);
    const { reason } = parseOrThrow(cancelInvoiceSchema, request.body);

    const invoice = await adminCancelInvoice(pool, auth.userId, id, reason, randomUUID, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });

    return { invoice };
  });

  // --- Phase 5F: Global Financial Ledger ---
  app.get('/api/v1/admin/billing/ledger', async (request) => {
    await requireRole(request, env, pool, BILLING_STAFF_ROLES);
    const query = parseOrThrow(listLedgerQuerySchema, request.query);
    return adminListLedger(pool, query);
  });

  // --- Phase 5C: Manual Payment Confirmation / Rejection ---
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

