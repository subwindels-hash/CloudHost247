import type { Queryable } from '../db/types';
import { createInvoice, findInvoiceById, listInvoicesForUser, type InvoiceRow } from '../db/invoices';
import { listLedgerEntriesForInvoice, recordLedgerEntry } from '../db/billing-ledger';
import { listOrderItemsForOrder, type OrderRow } from '../db/orders';
import { NotFoundError } from '../lib/errors';
import { toInvoiceDetailDTO, toInvoiceSummaryDTO, type InvoiceDetailDTO, type InvoiceSummaryDTO } from '../dto/billing';

/**
 * Billing business logic (Phase 5B) — invoices and the append-only ledger built on top of them.
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

export async function getMyInvoiceDetail(pool: Queryable, userId: string, invoiceId: string): Promise<InvoiceDetailDTO> {
  const invoice = await findInvoiceById(pool, invoiceId);
  if (!invoice || invoice.user_id !== userId) {
    // Never distinguish "doesn't exist" from "exists but isn't yours" — same pattern as every
    // other ownership check in this codebase.
    throw new NotFoundError('No invoice was found with that id');
  }

  const [items, ledger] = await Promise.all([
    listOrderItemsForOrder(pool, invoice.order_id),
    listLedgerEntriesForInvoice(pool, invoice.id),
  ]);

  return toInvoiceDetailDTO(invoice, items, ledger);
}
