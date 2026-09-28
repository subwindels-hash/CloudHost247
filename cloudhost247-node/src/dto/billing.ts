import type { InvoiceWithOrderRow } from '../db/invoices';
import type { LedgerEntryRow } from '../db/billing-ledger';
import { toOrderItemDTO, type OrderItemDTO } from './commerce';
import type { OrderItemRow } from '../db/orders';

/**
 * Phase 5B billing DTOs — same "never leak an internal field, never fabricate a value" mapping
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

export interface LedgerEntryDTO {
  id: string;
  entryType: string;
  amount: string;
  currency: string;
  description: string;
  createdAt: string;
}

export interface InvoiceDetailDTO extends InvoiceSummaryDTO {
  items: OrderItemDTO[];
  ledger: LedgerEntryDTO[];
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

export function toInvoiceDetailDTO(invoice: InvoiceWithOrderRow, orderItems: OrderItemRow[], ledger: LedgerEntryRow[]): InvoiceDetailDTO {
  return {
    ...toInvoiceSummaryDTO(invoice),
    items: orderItems.map(toOrderItemDTO),
    ledger: ledger.map(toLedgerEntryDTO),
  };
}
