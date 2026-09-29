import type { Queryable } from '../db/types';
import { withTransaction } from '../db/transaction';
import {
  createInvoice,
  findInvoiceById,
  findInvoiceByIdAdmin,
  listAllInvoices,
  listInvoicesForUser,
  setInvoiceStatus,
  type InvoiceRow,
} from '../db/invoices';
import {
  listAllLedgerEntriesAdmin,
  listLedgerEntriesForInvoice,
  listLedgerEntriesForUser,
  recordLedgerEntry,
} from '../db/billing-ledger';
import { listOrderItemsForOrder, setOrderPaymentStatus, setOrderStatus, type OrderRow } from '../db/orders';
import { cancelAllPendingPaymentsForInvoice, listPaymentsForInvoice } from '../db/payments';
import { NotFoundError, ValidationError } from '../lib/errors';
import { fromCents, toCents } from '../lib/money';
import { recordAuthEvent } from '../db/users';
import {
  toAdminInvoiceDetailDTO,
  toAdminInvoiceSummaryDTO,
  toAdminLedgerEntryDTO,
  toInvoiceDetailDTO,
  toInvoiceSummaryDTO,
  toLedgerEntryDTO,
  type AdminInvoiceDetailDTO,
  type AdminInvoiceSummaryDTO,
  type AdminLedgerEntryDTO,
  type InvoiceDetailDTO,
  type InvoiceSummaryDTO,
  type LedgerEntryDTO,
} from '../dto/billing';

export interface AuditContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Billing business logic (Phase 5B & 5F) — invoices and the append-only ledger built on top of them.
 * `issueInvoiceForOrder` is the only place an invoice is ever created, and it is only ever called
 * from inside `checkoutCart`'s single `withTransaction` (src/services/commerce-service.ts) — an
 * order, its invoice, and the invoice's opening `charge` ledger entry are one atomic unit; none of
 * the three can ever exist without the other two.
 */

/**
 * Issues an invoice for a just-created order and records the matching `charge` ledger entry, both
 * inside the caller's already-open transaction. Every amount is copied verbatim from the order —
 * this phase has no tax/discount configuration system, so, exactly like the order itself, a
 * `0` discount/tax here is a genuine zero, never a fabricated value.
 */
export async function issueInvoiceForOrder(tx: Queryable, order: OrderRow, genId: () => string): Promise<InvoiceRow> {
  const invoice = await createInvoice(tx, {
    id: genId(),
    orderId: order.id,
    userId: order.user_id,
    currency: order.currency,
    subtotalAmount: order.subtotal_amount,
    discountAmount: order.discount_amount,
    taxAmount: order.tax_amount,
    totalAmount: order.total_amount,
  });

  await recordLedgerEntry(tx, {
    id: genId(),
    userId: order.user_id,
    invoiceId: invoice.id,
    entryType: 'charge',
    amount: invoice.total_amount,
    currency: invoice.currency,
    description: `Invoice ${invoice.invoice_number} for order ${order.order_number}`,
  });

  return invoice;
}

export async function listMyInvoices(pool: Queryable, userId: string): Promise<InvoiceSummaryDTO[]> {
  const invoices = await listInvoicesForUser(pool, userId);
  return invoices.map(toInvoiceSummaryDTO);
}

export async function listMyLedger(pool: Queryable, userId: string): Promise<LedgerEntryDTO[]> {
  const entries = await listLedgerEntriesForUser(pool, userId);
  return entries.map(toLedgerEntryDTO);
}

export async function getMyInvoiceDetail(pool: Queryable, userId: string, invoiceId: string): Promise<InvoiceDetailDTO> {
  const invoice = await findInvoiceById(pool, invoiceId);
  if (!invoice || invoice.user_id !== userId) {
    // Never distinguish "doesn't exist" from "exists but isn't yours" — same pattern as every
    // other ownership check in this codebase.
    throw new NotFoundError('No invoice was found with that id');
  }

  const [items, ledger, payments] = await Promise.all([
    listOrderItemsForOrder(pool, invoice.order_id),
    listLedgerEntriesForInvoice(pool, invoice.id),
    listPaymentsForInvoice(pool, invoice.id),
  ]);

  return toInvoiceDetailDTO(invoice, items, ledger, payments);
}

export async function adminListInvoices(
  pool: Queryable,
  options: { page?: number; limit?: number; status?: string; search?: string }
): Promise<{ invoices: AdminInvoiceSummaryDTO[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.max(1, Math.min(100, options.limit ?? 20));
  const { invoices, total } = await listAllInvoices(pool, { ...options, page, limit });
  return {
    invoices: invoices.map(toAdminInvoiceSummaryDTO),
    total,
    page,
    limit,
  };
}

export async function adminGetInvoiceDetail(pool: Queryable, invoiceId: string): Promise<AdminInvoiceDetailDTO> {
  const invoice = await findInvoiceByIdAdmin(pool, invoiceId);
  if (!invoice) {
    throw new NotFoundError('No invoice was found with that id');
  }

  const [items, ledger, payments] = await Promise.all([
    listOrderItemsForOrder(pool, invoice.order_id),
    listLedgerEntriesForInvoice(pool, invoice.id),
    listPaymentsForInvoice(pool, invoice.id),
  ]);

  return toAdminInvoiceDetailDTO(invoice, items, ledger, payments);
}

export async function adminListLedger(
  pool: Queryable,
  options: { page?: number; limit?: number; userId?: string; invoiceId?: string; entryType?: string }
): Promise<{ ledger: AdminLedgerEntryDTO[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.max(1, Math.min(100, options.limit ?? 20));
  const { ledger, total } = await listAllLedgerEntriesAdmin(pool, { ...options, page, limit });
  return {
    ledger: ledger.map(toAdminLedgerEntryDTO),
    total,
    page,
    limit,
  };
}

export async function adminIssueRefund(
  pool: Queryable,
  actorUserId: string,
  invoiceId: string,
  amountCents: number,
  reason: string,
  genId: () => string,
  audit: AuditContext = {}
): Promise<AdminInvoiceDetailDTO> {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new ValidationError('Refund amount must be a positive integer in cents');
  }
  if (!reason || reason.trim().length === 0) {
    throw new ValidationError('A refund reason is required for audit compliance');
  }

  const invoice = await findInvoiceByIdAdmin(pool, invoiceId);
  if (!invoice) {
    throw new NotFoundError('No invoice was found with that id');
  }

  if (invoice.status !== 'paid' && invoice.status !== 'partially_refunded') {
    throw new ValidationError(`Cannot refund an invoice in '${invoice.status}' status`);
  }

  const ledgerEntries = await listLedgerEntriesForInvoice(pool, invoiceId);
  const totalPaidCents = ledgerEntries
    .filter((e) => e.entry_type === 'payment')
    .reduce((sum, e) => sum + toCents(e.amount), 0);
  const totalRefundedCents = ledgerEntries
    .filter((e) => e.entry_type === 'refund')
    .reduce((sum, e) => sum + toCents(e.amount), 0);

  const maxRefundableCents = totalPaidCents - totalRefundedCents;
  if (amountCents > maxRefundableCents) {
    throw new ValidationError(
      `Refund amount of $${fromCents(amountCents)} exceeds refundable balance of $${fromCents(maxRefundableCents)}`
    );
  }

  const isFullRefund = totalRefundedCents + amountCents === totalPaidCents;
  const newInvoiceStatus = isFullRefund ? 'refunded' : 'partially_refunded';
  const newOrderPaymentStatus = isFullRefund ? 'refunded' : 'partially_refunded';

  await withTransaction(pool, async (tx) => {
    // 1. Append refund entry into immutable billing ledger
    await recordLedgerEntry(tx, {
      id: genId(),
      userId: invoice.user_id,
      invoiceId: invoice.id,
      entryType: 'refund',
      amount: fromCents(amountCents),
      currency: invoice.currency,
      description: `Staff refund: ${reason.trim()}`,
    });

    // 2. Update invoice status
    await setInvoiceStatus(tx, invoice.id, newInvoiceStatus);

    // 3. Update order payment_status
    await setOrderPaymentStatus(tx, invoice.order_id, newOrderPaymentStatus);

    // 4. Record audit event
    await recordAuthEvent(tx, {
      id: genId(),
      userId: actorUserId,
      eventType: 'admin_invoice_refunded',
      ipAddress: audit.ipAddress ?? null,
      userAgent: audit.userAgent ?? null,
      metadata: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoice_number,
        customerId: invoice.user_id,
        refundAmountCents: amountCents,
        refundAmount: fromCents(amountCents),
        currency: invoice.currency,
        newStatus: newInvoiceStatus,
        reason: reason.trim(),
      },
    });
  });

  return adminGetInvoiceDetail(pool, invoiceId);
}

export async function adminCancelInvoice(
  pool: Queryable,
  actorUserId: string,
  invoiceId: string,
  reason: string,
  genId: () => string,
  audit: AuditContext = {}
): Promise<AdminInvoiceDetailDTO> {
  if (!reason || reason.trim().length === 0) {
    throw new ValidationError('A cancellation reason is required for audit compliance');
  }

  const invoice = await findInvoiceByIdAdmin(pool, invoiceId);
  if (!invoice) {
    throw new NotFoundError('No invoice was found with that id');
  }

  if (invoice.status !== 'unpaid') {
    throw new ValidationError(`Cannot cancel an invoice with status '${invoice.status}'`);
  }

  await withTransaction(pool, async (tx) => {
    // 1. Cancel any pending payment attempts
    await cancelAllPendingPaymentsForInvoice(tx, invoice.id);

    // 2. Mark invoice void
    await setInvoiceStatus(tx, invoice.id, 'void');

    // 3. Mark parent order cancelled
    await setOrderStatus(tx, invoice.order_id, 'cancelled');

    // 4. Record audit log
    await recordAuthEvent(tx, {
      id: genId(),
      userId: actorUserId,
      eventType: 'admin_invoice_cancelled',
      ipAddress: audit.ipAddress ?? null,
      userAgent: audit.userAgent ?? null,
      metadata: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoice_number,
        customerId: invoice.user_id,
        reason: reason.trim(),
      },
    });
  });

  return adminGetInvoiceDetail(pool, invoiceId);
}
