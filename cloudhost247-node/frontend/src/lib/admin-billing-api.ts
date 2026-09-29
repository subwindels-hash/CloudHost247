import { apiFetch } from './api';
import type { InvoiceDetail, InvoiceSummary, LedgerEntry } from './billing-api';

export interface AdminInvoiceSummary extends InvoiceSummary {
  userId: string;
  userEmail: string;
  userFullName: string;
}

export interface AdminInvoiceDetail extends InvoiceDetail {
  userId: string;
  userEmail: string;
  userFullName: string;
}

export interface AdminLedgerEntry extends LedgerEntry {
  userId: string;
  userEmail: string;
  userFullName: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
}

export interface ListAdminInvoicesParams {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
}

export interface ListAdminInvoicesResponse {
  invoices: AdminInvoiceSummary[];
  total: number;
  page: number;
  limit: number;
}

export interface ListAdminLedgerParams {
  page?: number;
  limit?: number;
  userId?: string;
  invoiceId?: string;
  entryType?: string;
}

export interface ListAdminLedgerResponse {
  ledger: AdminLedgerEntry[];
  total: number;
  page: number;
  limit: number;
}

export async function fetchAdminInvoices(params: ListAdminInvoicesParams = {}): Promise<ListAdminInvoicesResponse> {
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.set('page', params.page.toString());
  if (params.limit) searchParams.set('limit', params.limit.toString());
  if (params.status) searchParams.set('status', params.status);
  if (params.search) searchParams.set('search', params.search);

  const query = searchParams.toString();
  return apiFetch<ListAdminInvoicesResponse>(`/api/v1/admin/invoices${query ? `?${query}` : ''}`);
}

export async function fetchAdminInvoiceDetail(invoiceId: string): Promise<AdminInvoiceDetail> {
  const res = await apiFetch<{ invoice: AdminInvoiceDetail }>(`/api/v1/admin/invoices/${invoiceId}`);
  return res.invoice;
}

export async function issueAdminRefund(invoiceId: string, amountCents: number, reason: string): Promise<AdminInvoiceDetail> {
  const res = await apiFetch<{ invoice: AdminInvoiceDetail }>(`/api/v1/admin/invoices/${invoiceId}/refund`, {
    method: 'POST',
    body: JSON.stringify({ amountCents, reason }),
  });
  return res.invoice;
}

export async function cancelAdminInvoice(invoiceId: string, reason: string): Promise<AdminInvoiceDetail> {
  const res = await apiFetch<{ invoice: AdminInvoiceDetail }>(`/api/v1/admin/invoices/${invoiceId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
  return res.invoice;
}

export async function fetchAdminLedger(params: ListAdminLedgerParams = {}): Promise<ListAdminLedgerResponse> {
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.set('page', params.page.toString());
  if (params.limit) searchParams.set('limit', params.limit.toString());
  if (params.userId) searchParams.set('userId', params.userId);
  if (params.invoiceId) searchParams.set('invoiceId', params.invoiceId);
  if (params.entryType) searchParams.set('entryType', params.entryType);

  const query = searchParams.toString();
  return apiFetch<ListAdminLedgerResponse>(`/api/v1/admin/billing/ledger${query ? `?${query}` : ''}`);
}
