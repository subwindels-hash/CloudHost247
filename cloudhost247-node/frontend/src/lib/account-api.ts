/**
 * Thin, typed wrappers around the Phase 4 Customer App API (see docs/API_CUSTOMER_APP.md) built on
 * top of the shared apiFetch (lib/api.ts). Kept separate from lib/api.ts itself so that file stays
 * a generic transport helper with no knowledge of any particular route.
 */
import { apiFetch } from './api';
import type {
  AdminCustomerDetail,
  AdminCustomerDomain,
  AdminCustomerService,
  AdminCustomerSummary,
  CustomerDomain,
  CustomerService,
  PublicUser,
  TicketDetail,
  TicketStatus,
  TicketSummary,
} from './account-types';

// --- Self-service (customer's own account) -----------------------------------------------------

export function updateProfile(fullName: string) {
  return apiFetch<{ user: PublicUser }>('/api/v1/account/profile', {
    method: 'PATCH',
    body: JSON.stringify({ fullName }),
  });
}

export function changePassword(currentPassword: string, newPassword: string) {
  return apiFetch<void>('/api/v1/account/password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export function listMyServices() {
  return apiFetch<{ services: CustomerService[] }>('/api/v1/account/services');
}

export function listMyDomains() {
  return apiFetch<{ domains: CustomerDomain[] }>('/api/v1/account/domains');
}

export function listMyTickets() {
  return apiFetch<{ tickets: TicketSummary[] }>('/api/v1/account/tickets');
}

export function createMyTicket(input: { subject: string; message: string; priority?: 'low' | 'normal' | 'high' }) {
  return apiFetch<{ ticket: TicketSummary }>('/api/v1/account/tickets', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getMyTicket(id: string) {
  return apiFetch<{ ticket: TicketDetail }>(`/api/v1/account/tickets/${id}`);
}

export function replyToMyTicket(id: string, message: string) {
  return apiFetch<{ ticket: TicketDetail }>(`/api/v1/account/tickets/${id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}

// --- Staff (admin / super_admin) ----------------------------------------------------------------

export function listCustomers(params: { search?: string; role?: string } = {}) {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.role) query.set('role', params.role);
  const qs = query.toString();
  return apiFetch<{ customers: AdminCustomerSummary[]; total: number }>(`/api/v1/admin/customers${qs ? `?${qs}` : ''}`);
}

export function getCustomerDetail(id: string) {
  return apiFetch<AdminCustomerDetail>(`/api/v1/admin/customers/${id}`);
}

export function setCustomerStatus(id: string, status: 'active' | 'suspended' | 'disabled') {
  return apiFetch<{ customer: PublicUser }>(`/api/v1/admin/customers/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function setCustomerRole(id: string, role: 'customer' | 'admin' | 'super_admin') {
  return apiFetch<{ customer: PublicUser }>(`/api/v1/admin/customers/${id}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });
}

export interface ServiceInput {
  label: string;
  productId?: string | null;
  planId?: string | null;
  status?: CustomerService['status'];
  externalReference?: string | null;
  notes?: string | null;
}

export function createCustomerService(customerId: string, input: ServiceInput) {
  return apiFetch<{ service: AdminCustomerService }>(`/api/v1/admin/customers/${customerId}/services`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateCustomerService(customerId: string, serviceId: string, input: Partial<ServiceInput>) {
  return apiFetch<{ service: AdminCustomerService }>(`/api/v1/admin/customers/${customerId}/services/${serviceId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export interface DomainInput {
  domainName: string;
  registrar?: string | null;
  status?: CustomerDomain['status'];
  expiresAt?: string | null;
  externalReference?: string | null;
  notes?: string | null;
}

export function createCustomerDomain(customerId: string, input: DomainInput) {
  return apiFetch<{ domain: AdminCustomerDomain }>(`/api/v1/admin/customers/${customerId}/domains`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateCustomerDomain(customerId: string, domainId: string, input: Partial<DomainInput>) {
  return apiFetch<{ domain: AdminCustomerDomain }>(`/api/v1/admin/customers/${customerId}/domains/${domainId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function listAllTickets(params: { status?: TicketStatus } = {}) {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  const qs = query.toString();
  return apiFetch<{ tickets: TicketSummary[]; total: number }>(`/api/v1/admin/tickets${qs ? `?${qs}` : ''}`);
}

export function getTicketForStaff(id: string) {
  return apiFetch<{ ticket: TicketDetail; customer: AdminCustomerSummary | null }>(`/api/v1/admin/tickets/${id}`);
}

export function replyToTicketAsStaff(id: string, message: string) {
  return apiFetch<{ ticket: TicketDetail }>(`/api/v1/admin/tickets/${id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}

export function setTicketStatus(id: string, status: TicketStatus) {
  return apiFetch<{ ticket: TicketSummary & { closedAt: string | null } }>(`/api/v1/admin/tickets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}
