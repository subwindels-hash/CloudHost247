import { toolsApiPath } from './tools-runtime';
/**
 * Revenue Guardian API client — thin typed wrappers over /api/admin/revenue-guardian/*.
 * Uses the shared apiFetch (same-origin, bearer token) like every other module client.
 */
import { apiFetch } from './api';

const BASE = '/api/admin/revenue-guardian';

export type RgPermission =
  | 'revenue_guardian.view'
  | 'revenue_guardian.manage'
  | 'revenue_guardian.assign'
  | 'revenue_guardian.followups'
  | 'revenue_guardian.promises'
  | 'revenue_guardian.reports'
  | 'revenue_guardian.automation'
  | 'revenue_guardian.settings'
  | 'revenue_guardian.export'
  | 'revenue_guardian.staff_performance'
  | 'revenue_guardian.view_all_customers'
  | 'revenue_guardian.view_financials'
  | 'revenue_guardian.manual_run'
  | 'revenue_guardian.write_off';

/**
 * UX-only mirror of the server-side role→permission map (src/revenue-guardian/permissions.ts):
 * used to hide menu entries a role cannot use. The server independently re-verifies every call.
 */
export function rgPermissionsForRole(role: string | undefined): RgPermission[] {
  if (role === 'super_admin') {
    return [
      'revenue_guardian.view', 'revenue_guardian.manage', 'revenue_guardian.assign', 'revenue_guardian.followups',
      'revenue_guardian.promises', 'revenue_guardian.reports', 'revenue_guardian.automation', 'revenue_guardian.settings',
      'revenue_guardian.export', 'revenue_guardian.staff_performance', 'revenue_guardian.view_all_customers',
      'revenue_guardian.view_financials', 'revenue_guardian.manual_run', 'revenue_guardian.write_off',
    ];
  }
  if (role === 'admin') {
    return [
      'revenue_guardian.view', 'revenue_guardian.manage', 'revenue_guardian.assign', 'revenue_guardian.followups',
      'revenue_guardian.promises', 'revenue_guardian.reports', 'revenue_guardian.automation', 'revenue_guardian.settings',
      'revenue_guardian.export', 'revenue_guardian.staff_performance', 'revenue_guardian.view_all_customers',
      'revenue_guardian.view_financials', 'revenue_guardian.manual_run',
    ];
  }
  if (role === 'staff') {
    return ['revenue_guardian.view', 'revenue_guardian.followups', 'revenue_guardian.promises'];
  }
  return [];
}

export interface CurrencyAmount {
  currency: string;
  amount: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

function query(params: Record<string, string | number | boolean | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function rgGet<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
  return apiFetch<T>(`${BASE}${path}${query(params)}`);
}

export function rgPost<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(`${BASE}${path}`, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
}

export function rgPatch<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(`${BASE}${path}`, { method: 'PATCH', body: JSON.stringify(body) });
}

/** CSV export needs the raw body, so it bypasses apiFetch's JSON parsing. */
export async function rgExportCsv(body: Record<string, unknown>): Promise<Blob> {
  const token = localStorage.getItem('ch247_token');
  const res = await fetch(toolsApiPath(`${BASE}/reports/export`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ message: res.statusText }))) as { message?: string };
    throw new Error(err.message ?? 'Export failed');
  }
  return res.blob();
}

export const RG_CASE_STATUSES = [
  'new', 'contact_required', 'contacted', 'awaiting_customer', 'payment_promised', 'payment_pending',
  'partially_recovered', 'recovered', 'escalated', 'disputed', 'closed', 'written_off',
] as const;

export const RG_KANBAN_COLUMNS = [
  'new', 'contact_required', 'contacted', 'payment_promised', 'payment_pending',
  'partially_recovered', 'recovered', 'escalated', 'disputed', 'closed',
] as const;

export const RG_FOLLOW_UP_TYPES = [
  'payment_reminder', 'invoice_due', 'invoice_overdue', 'renewal_reminder', 'expiration_reminder',
  'pre_suspension', 'pre_termination', 'failed_payment', 'payment_promise', 'customer_check_in',
  'escalation', 'custom',
] as const;

export const RG_ASSIGNMENT_TYPES = ['account_manager', 'sales_rep', 'collections', 'customer_success'] as const;

export interface RgStaffMember {
  id: string;
  email: string;
  full_name: string;
  role: string;
}

export function fetchRgStaff(): Promise<{ staff: RgStaffMember[] }> {
  return rgGet('/staff');
}
