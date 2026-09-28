/**
 * Frontend mirror of the Phase 4 "Customer App" API response DTOs (see src/dto/account.ts on the
 * backend and docs/API_CUSTOMER_APP.md for the full contract). Kept as plain types, not generated
 * — see the equivalent note in lib/catalog-types.ts for why.
 */

export interface PublicUser {
  id: string;
  email: string;
  fullName: string;
  role: 'customer' | 'admin' | 'super_admin';
  status: 'active' | 'suspended' | 'disabled';
}

export interface CustomerService {
  id: string;
  label: string;
  status: 'active' | 'suspended' | 'cancelled' | 'pending_migration';
  productSlug: string | null;
  productName: string | null;
  planSlug: string | null;
  planName: string | null;
  externalReference: string | null;
  createdAt: string;
}

export interface AdminCustomerService extends CustomerService {
  userId: string;
  notes: string | null;
  createdBy: string | null;
  updatedAt: string;
}

export interface CustomerDomain {
  id: string;
  domainName: string;
  registrar: string | null;
  status: 'active' | 'expired' | 'pending_transfer' | 'pending_migration';
  expiresAt: string | null;
  externalReference: string | null;
  createdAt: string;
}

export interface AdminCustomerDomain extends CustomerDomain {
  userId: string;
  notes: string | null;
  createdBy: string | null;
  updatedAt: string;
}

export type TicketStatus = 'open' | 'pending_customer' | 'pending_staff' | 'closed';

export interface TicketSummary {
  id: string;
  subject: string;
  status: TicketStatus;
  priority: 'low' | 'normal' | 'high';
  createdAt: string;
  updatedAt: string;
}

export interface TicketMessage {
  id: string;
  authorRole: string;
  body: string;
  createdAt: string;
  isSelf: boolean;
}

export interface TicketDetail extends TicketSummary {
  closedAt: string | null;
  messages: TicketMessage[];
}

export interface AdminCustomerSummary {
  id: string;
  email: string;
  fullName: string;
  role: 'customer' | 'admin' | 'super_admin';
  status: 'active' | 'suspended' | 'disabled';
  createdAt: string;
}

export interface AdminCustomerDetail {
  customer: PublicUser;
  services: AdminCustomerService[];
  domains: AdminCustomerDomain[];
  tickets: TicketSummary[];
}
