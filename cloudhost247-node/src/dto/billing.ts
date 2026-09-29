import type { AdminInvoiceRow, InvoiceWithOrderRow } from '../db/invoices';
import type { AdminLedgerEntryRow, LedgerEntryRow } from '../db/billing-ledger';
import { toOrderItemDTO, type OrderItemDTO } from './commerce';
import type { OrderItemRow } from '../db/orders';
import { toPaymentDTO, type PaymentDTO } from './payments';
import type { PaymentRow } from '../db/payments';

/**
 * Phase 5B & 5F billing DTOs — same "never leak an internal field, never fabricate a value" mapping
 * layer used by src/dto/catalog.ts (Phase 3), src/dto/account.ts (Phase 4), and src/dto/commerce.ts
 * (Phase 5A).
 */

export interface InvoiceSummaryDTO {
  id: string;
  invoiceNumber: string;
  orderId: string;
  orderNumber: string;
  status: string;
  currency: string;
  subtotalAmount: string;
  discountAmount: string;
  taxAmount: string;
  totalAmount: string;
  dueDate: string;
  issuedAt: string;
}

export interface AdminInvoiceSummaryDTO extends InvoiceSummaryDTO {
  userId: string;
  userEmail: string;
  userFullName: string;
}

export interface LedgerEntryDTO {
  id: string;
  entryType: string;
  amount: string;
  currency: string;
  description: string;
  createdAt: string;
}

export interface AdminLedgerEntryDTO extends LedgerEntryDTO {
  userId: string;
  userEmail: string;
  userFullName: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
}

export interface InvoiceDetailDTO extends InvoiceSummaryDTO {
  items: OrderItemDTO[];
  ledger: LedgerEntryDTO[];
  /** Every payment *attempt* (Phase 5C) recorded against this invoice, oldest first — including
   * cancelled/failed ones, so a customer can see their own payment history, not just the one that
   * eventually succeeded. */
  payments: PaymentDTO[];
}

export interface AdminInvoiceDetailDTO extends AdminInvoiceSummaryDTO {
  items: OrderItemDTO[];
  ledger: LedgerEntryDTO[];
  payments: PaymentDTO[];
}

export function toInvoiceSummaryDTO(row: InvoiceWithOrderRow): InvoiceSummaryDTO {
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    orderId: row.order_id,
    orderNumber: row.order_number,
    status: row.status,
    currency: row.currency,
    subtotalAmount: row.subtotal_amount,
    discountAmount: row.discount_amount,
    taxAmount: row.tax_amount,
    totalAmount: row.total_amount,
    dueDate: row.due_date,
    issuedAt: row.issued_at,
  };
}

export function toAdminInvoiceSummaryDTO(row: AdminInvoiceRow): AdminInvoiceSummaryDTO {
  return {
    ...toInvoiceSummaryDTO(row),
    userId: row.user_id,
    userEmail: row.user_email,
    userFullName: row.user_full_name,
  };
}

export function toLedgerEntryDTO(row: LedgerEntryRow): LedgerEntryDTO {
  return {
    id: row.id,
    entryType: row.entry_type,
    amount: row.amount,
    currency: row.currency,
    description: row.description,
    createdAt: row.created_at,
  };
}

export function toAdminLedgerEntryDTO(row: AdminLedgerEntryRow): AdminLedgerEntryDTO {
  return {
    ...toLedgerEntryDTO(row),
    userId: row.user_id,
    userEmail: row.user_email,
    userFullName: row.user_full_name,
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number,
  };
}

export function toInvoiceDetailDTO(
  invoice: InvoiceWithOrderRow,
  orderItems: OrderItemRow[],
  ledger: LedgerEntryRow[],
  payments: PaymentRow[]
): InvoiceDetailDTO {
  return {
    ...toInvoiceSummaryDTO(invoice),
    items: orderItems.map(toOrderItemDTO),
    ledger: ledger.map(toLedgerEntryDTO),
    payments: payments.map(toPaymentDTO),
  };
}

export function toAdminInvoiceDetailDTO(
  invoice: AdminInvoiceRow,
  orderItems: OrderItemRow[],
  ledger: LedgerEntryRow[],
  payments: PaymentRow[]
): AdminInvoiceDetailDTO {
  return {
    ...toAdminInvoiceSummaryDTO(invoice),
    items: orderItems.map(toOrderItemDTO),
    ledger: ledger.map(toLedgerEntryDTO),
    payments: payments.map(toPaymentDTO),
  };
}

