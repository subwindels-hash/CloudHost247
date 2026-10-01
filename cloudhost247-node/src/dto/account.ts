import type { UserRecord } from '../db/users';
import type { CustomerServiceRow } from '../db/customer-services';
import type { CustomerDomainRow } from '../db/customer-domains';
import type { SupportTicketRow, SupportTicketMessageRow } from '../db/support-tickets';

/**
 * Phase 4 DTOs — same "never leak an internal field, never leak someone else's data" pattern as
 * src/dto/catalog.ts (Phase 3). In particular:
 *   - `notes` and `created_by` on customer_services/customer_domains are staff-only and never
 *     appear in any *CustomerDTO below, only in the Admin* variants.
 *   - Ticket messages expose `authorRole` (so the UI can show "You" vs "Support"), never the raw
 *     `author_id` of a *different* user.
 *   - password_hash is never part of any DTO here (or anywhere in the codebase).
 */

export interface PublicUserDTO {
  id: string;
  email: string;
  fullName: string;
  role: string;
  status: string;
  /** Permanent six-digit account number. Safe to display: it is an identifier, not a secret.
   * Note what is NOT here and never will be — `security_number_hash` and every other
   * security_number_* column. The Security Number has its own dedicated status endpoint and is
   * never folded into a generic user payload (spec §11/§46). */
  customerId: string | null;
}

export function toPublicUser(user: UserRecord): PublicUserDTO {
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    role: user.role,
    status: user.status,
    customerId: user.customer_id ?? null,
  };
}

/** The caller's own account, including the self-editable profile fields (spec §26). */
export interface AccountProfileDTO extends PublicUserDTO {
  phone: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  hasProfileImage: boolean;
  createdAt: string;
}

export function toAccountProfileDTO(user: UserRecord, hasProfileImage: boolean): AccountProfileDTO {
  return {
    ...toPublicUser(user),
    phone: user.phone ?? null,
    addressLine1: user.address_line1 ?? null,
    city: user.city ?? null,
    state: user.state ?? null,
    postalCode: user.postal_code ?? null,
    country: user.country ?? null,
    hasProfileImage,
    createdAt: user.created_at,
  };
}

// --- Customer services -----------------------------------------------------------------------

export interface CustomerServiceDTO {
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

export function toCustomerServiceDTO(row: CustomerServiceRow): CustomerServiceDTO {
  return {
    id: row.id,
    label: row.label,
    status: row.status,
    productSlug: row.product_slug,
    productName: row.product_name,
    planSlug: row.plan_slug,
    planName: row.plan_name,
    serverId: row.server_id ?? null,
    serverName: row.server_name ?? null,
    serverIp: row.server_ip ?? null,
    serverStatus: row.server_status ?? null,
    controlPanelId: row.control_panel_id ?? null,
    panelName: row.panel_name ?? null,
    panelSlug: row.panel_slug ?? null,
    licenseId: row.license_id ?? null,
    licenseStatus: row.license_status ?? null,
    domain: row.domain ?? null,
    hostname: row.hostname ?? null,
    username: row.username ?? null,
    billingCycle: row.billing_cycle ?? 'monthly',
    amount: row.amount ?? 0.0,
    currency: row.currency ?? 'USD',
    nextDueDate: row.next_due_date ?? null,
    suspensionDate: row.suspension_date ?? null,
    terminationDate: row.termination_date ?? null,
    externalReference: row.external_reference,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface AdminCustomerServiceDTO extends CustomerServiceDTO {
  userId: string;
  customerId: string;
  notes: string | null;
  createdBy: string | null;
  updatedAt: string;
  customerEmail?: string;
  customerName?: string;
}

export function toAdminCustomerServiceDTO(row: CustomerServiceRow): AdminCustomerServiceDTO {
  return {
    ...toCustomerServiceDTO(row),
    userId: row.user_id,
    customerId: row.customer_id ?? row.user_id,
    notes: row.notes,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    customerEmail: row.customer_email,
    customerName: row.customer_name,
  };
}

// --- Customer domains -------------------------------------------------------------------------

export interface CustomerDomainDTO {
  id: string;
  domainName: string;
  registrar: string | null;
  status: string;
  expiresAt: string | null;
  externalReference: string | null;
  createdAt: string;
}

export function toCustomerDomainDTO(row: CustomerDomainRow): CustomerDomainDTO {
  return {
    id: row.id,
    domainName: row.domain_name,
    registrar: row.registrar,
    status: row.status,
    expiresAt: row.expires_at,
    externalReference: row.external_reference,
    createdAt: row.created_at,
  };
}

export interface AdminCustomerDomainDTO extends CustomerDomainDTO {
  userId: string;
  notes: string | null;
  createdBy: string | null;
  updatedAt: string;
}

export function toAdminCustomerDomainDTO(row: CustomerDomainRow): AdminCustomerDomainDTO {
  return {
    ...toCustomerDomainDTO(row),
    userId: row.user_id,
    notes: row.notes,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
  };
}

// --- Support tickets ---------------------------------------------------------------------------

export interface TicketSummaryDTO {
  id: string;
  subject: string;
  status: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
}

export function toTicketSummaryDTO(row: SupportTicketRow): TicketSummaryDTO {
  return {
    id: row.id,
    subject: row.subject,
    status: row.status,
    priority: row.priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface TicketMessageDTO {
  id: string;
  authorRole: string;
  body: string;
  createdAt: string;
  /** True when the message's author is the caller themself — lets the UI render "You" without
   * exposing any other user's id. Computed per-request by the route, not stored. */
  isSelf: boolean;
}

export function toTicketMessageDTO(row: SupportTicketMessageRow, viewerUserId: string): TicketMessageDTO {
  return {
    id: row.id,
    authorRole: row.author_role,
    body: row.body,
    createdAt: row.created_at,
    isSelf: row.author_id === viewerUserId,
  };
}

export interface TicketDetailDTO extends TicketSummaryDTO {
  closedAt: string | null;
  messages: TicketMessageDTO[];
}

// --- Admin customer directory --------------------------------------------------------------------

export interface AdminCustomerSummaryDTO {
  id: string;
  email: string;
  fullName: string;
  role: string;
  status: string;
  createdAt: string;
  /** Shown in the staff directory so support can match the number a caller reads out. */
  customerId: string | null;
  phone: string | null;
  deletedAt: string | null;
}

export function toAdminCustomerSummaryDTO(user: UserRecord): AdminCustomerSummaryDTO {
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    role: user.role,
    status: user.status,
    createdAt: user.created_at,
    customerId: user.customer_id ?? null,
    phone: user.phone ?? null,
    deletedAt: user.deleted_at ?? null,
  };
}

/**
 * Staff-facing view of one account. Contains the customer's *identity*, never their secrets:
 * no password hash, and no Security Number hash, plaintext, or any value derived from it —
 * administrators only ever see its lifecycle metadata, exposed separately by the
 * /security-number/status endpoint (spec §20/§46).
 */
export interface AdminUserDetailDTO extends AdminCustomerSummaryDTO {
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  updatedAt: string;
  hasProfileImage: boolean;
}

export function toAdminUserDetailDTO(user: UserRecord, hasProfileImage = false): AdminUserDetailDTO {
  return {
    ...toAdminCustomerSummaryDTO(user),
    addressLine1: user.address_line1 ?? null,
    city: user.city ?? null,
    state: user.state ?? null,
    postalCode: user.postal_code ?? null,
    country: user.country ?? null,
    updatedAt: user.updated_at,
    hasProfileImage,
  };
}
