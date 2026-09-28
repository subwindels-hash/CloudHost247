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
}

export function toPublicUser(user: UserRecord): PublicUserDTO {
  return { id: user.id, email: user.email, fullName: user.full_name, role: user.role, status: user.status };
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
  externalReference: string | null;
  createdAt: string;
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
    externalReference: row.external_reference,
    createdAt: row.created_at,
  };
}

export interface AdminCustomerServiceDTO extends CustomerServiceDTO {
  userId: string;
  notes: string | null;
  createdBy: string | null;
  updatedAt: string;
}

export function toAdminCustomerServiceDTO(row: CustomerServiceRow): AdminCustomerServiceDTO {
  return {
    ...toCustomerServiceDTO(row),
    userId: row.user_id,
    notes: row.notes,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
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
}

export function toAdminCustomerSummaryDTO(user: UserRecord): AdminCustomerSummaryDTO {
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    role: user.role,
    status: user.status,
    createdAt: user.created_at,
  };
}
