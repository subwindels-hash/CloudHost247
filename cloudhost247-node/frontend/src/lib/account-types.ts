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
  status: 'active' | 'suspended' | 'disabled' | 'deleted';
  /** Permanent six-digit account number. Display-safe identifier — never a credential. */
  customerId: string | null;
}

/** The signed-in customer's own editable profile (GET/PATCH /api/v1/account). */
export interface AccountProfile extends PublicUser {
  phone: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  hasProfileImage: boolean;
  createdAt: string;
}

/**
 * Security Number *status* — deliberately contains no value and no hash. The plaintext only ever
 * appears in the one-off response to a reveal/change request and is never stored client-side
 * (not in localStorage, not in the auth store, not in a cached user object).
 */
export interface SecurityNumberStatus {
  initialized: boolean;
  version: number;
  createdAt: string | null;
  expiresAt: string | null;
  expired: boolean;
  secondsUntilExpiry: number;
  rotationHours: number;
}

export interface SupportSessionContext {
  id: string;
  originalAdminId: string | null;
  expiresAt: string;
}

export interface AdminSupportSession {
  id: string;
  originalAdminId: string;
  targetUserId: string;
  targetCustomerId: string | null;
  reason: string | null;
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
  endedReason: string | null;
}

export interface CustomerService {
  id: string;
  label: string;
  status: string;
  productSlug: string | null;
  productName: string | null;
  planSlug: string | null;
  planName: string | null;
  serverId?: string | null;
  serverName?: string | null;
  serverIp?: string | null;
  serverStatus?: string | null;
  controlPanelId?: string | null;
  panelName?: string | null;
  panelSlug?: string | null;
  licenseId?: string | null;
  licenseStatus?: string | null;
  domain?: string | null;
  hostname?: string | null;
  username?: string | null;
  billingCycle?: string;
  amount?: number | string;
  currency?: string;
  nextDueDate?: string | null;
  suspensionDate?: string | null;
  terminationDate?: string | null;
  externalReference: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface AdminCustomerService extends CustomerService {
  userId: string;
  customerId?: string;
  notes: string | null;
  createdBy: string | null;
  updatedAt: string;
  customerEmail?: string;
  customerName?: string;
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
  status: 'active' | 'suspended' | 'disabled' | 'deleted';
  createdAt: string;
  customerId: string | null;
  phone: string | null;
  deletedAt: string | null;
}

export interface AdminCustomerDetail {
  customer: PublicUser;
  services: AdminCustomerService[];
  domains: AdminCustomerDomain[];
  tickets: TicketSummary[];
}
