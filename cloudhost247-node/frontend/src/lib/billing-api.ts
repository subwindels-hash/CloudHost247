import { apiFetch } from './api';

export interface InvoiceSummary {
  id: string;
  invoiceNumber: string;
  orderId: string;
  orderNumber: string;
  status: 'unpaid' | 'paid' | 'cancelled' | 'partially_refunded' | 'refunded';
  currency: string;
  subtotalAmount: string;
  discountAmount: string;
  taxAmount: string;
  totalAmount: string;
  dueDate: string;
  issuedAt: string;
}

export interface OrderItem {
  id: string;
  planId: string;
  billingPeriod: string;
  quantity: number;
  unitPriceAmount: string;
  lineTotalAmount: string;
  currency: string;
  productName?: string;
  productType?: string;
  planName?: string;
  planSlug?: string;
}

export interface LedgerEntry {
  id: string;
  entryType: 'charge' | 'payment' | 'credit' | 'refund';
  amount: string;
  currency: string;
  description: string;
  createdAt: string;
}

export interface PaymentAttempt {
  id: string;
  invoiceId: string;
  provider: string | null;
  providerReference: string | null;
  method: string | null;
  amount: string;
  currency: string;
  status: 'pending' | 'successful' | 'failed' | 'cancelled';
  failureReason: string | null;
  initiatedAt: string;
  completedAt: string | null;
  instructions?: string | null;
}

export interface InvoiceDetail extends InvoiceSummary {
  items: OrderItem[];
  ledger: LedgerEntry[];
  payments: PaymentAttempt[];
}

export async function fetchInvoices(): Promise<InvoiceSummary[]> {
  const res = await apiFetch<{ invoices: InvoiceSummary[] }>('/api/v1/invoices');
  return res.invoices;
}

export async function fetchInvoiceDetail(id: string): Promise<InvoiceDetail> {
  const res = await apiFetch<{ invoice: InvoiceDetail }>(`/api/v1/invoices/${id}`);
  return res.invoice;
}

export async function fetchBillingLedger(): Promise<LedgerEntry[]> {
  const res = await apiFetch<{ ledger: LedgerEntry[] }>('/api/v1/billing/ledger');
  return res.ledger;
}

export async function initiatePayment(invoiceId: string, gateway: 'manual' | 'sandbox'): Promise<PaymentAttempt> {
  const res = await apiFetch<{ payment: PaymentAttempt }>(`/api/v1/invoices/${invoiceId}/payments`, {
    method: 'POST',
    body: JSON.stringify({ gateway }),
  });
  return res.payment;
}

export async function fetchPaymentStatus(paymentId: string): Promise<PaymentAttempt> {
  const res = await apiFetch<{ payment: PaymentAttempt }>(`/api/v1/payments/${paymentId}`);
  return res.payment;
}
