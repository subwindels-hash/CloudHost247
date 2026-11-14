/**
 * Frontend mirror of the Phase 4 "Customer App" API response DTOs (see src/dto/account.ts on the
 * backend and docs/API_CUSTOMER_APP.md for the full contract). Kept as plain types, not generated
 * — see the equivalent note in lib/catalog-types.ts for why.
 */

export interface PublicUser {
  id: string;
  /**
   * The customer's unique, changeable handle. Used for signing in (alongside email) and for
   * support to find the account. Optional only for payloads written before migration 0085.
   */
  username?: string | null;
  email: string;
  fullName: string;
  role: 'customer' | 'admin' | 'super_admin';
  status: 'active' | 'suspended' | 'disabled' | 'deleted';
  /**
   * Permanent account number: nine digits for every account created after migration 0085, and six
   * digits for accounts that predate it (those are preserved verbatim, never re-issued).
   * Display-safe identifier — never a credential.
   */
  customerId: string | null;
  /** Whether the registered email address has been confirmed. Gates viewing the Security PIN. */
  emailVerified?: boolean;
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

/**
 * The rotating four-digit Security PIN, as far as the browser is ever concerned.
 *
 * `maskedValue` is a literal mask produced by the server. There is no field here that can hold the
 * real PIN: the only way to obtain it is `POST /account/security-pin/reveal`, whose response is
 * consumed by the caller and never persisted.
 */
export interface SecurityPinStatus {
  maskedValue: string;
  set: boolean;
  version: number;
  lastRotatedAt: string | null;
  nextRotationAt: string | null;
  secondsUntilRotation: number;
  rotationHours: number;
  /** How long a revealed PIN stays on screen before the UI hides it again. */
  revealDisplayTtlSeconds: number;
  verificationCodeTtlMinutes: number;
  resendCooldownSeconds: number;
  maxAttempts: number;
  /** False when the account's email is unverified, or the server has no PIN key configured. */
  canView: boolean;
  viewRequiresEmailVerification: boolean;
  /** Whether the platform can actually deliver verification mail right now. */
  emailVerificationConfigured: boolean;
}

/** The whole Account / Security card (GET /api/v1/account/security). */
export interface AccountSecurityPayload {
  account: {
    username: string | null;
    usernameChangedAt: string | null;
    customerId: string | null;
    email: string;
    emailVerified: boolean;
  };
  securityPin: SecurityPinStatus;
  securityNumber: SecurityNumberStatus;
}

/** A verification challenge opened by POST /account/security-pin/view. */
export interface SecurityPinChallenge {
  challengeToken: string;
  maskedEmail: string;
  expiresAt: string;
  codeTtlMinutes: number;
  resendAvailableInSeconds: number;
  maxAttempts: number;
  maxResends: number;
  resendCount?: number;
}

/** The one response in the application that carries the real PIN. Shows once, then it is spent. */
export interface RevealedSecurityPin {
  securityPin: {
    value: string;
    version: number;
    expiresAt: string | null;
    displayTtlSeconds: number;
  };
}

export interface UsernameAvailability {
  available: boolean;
  username: string;
  reason: string | null;
  suggestions: string[];
}

export interface AccountRecoveryRequest {
  id: string;
  reference: string;
  reason: 'cannot_access_email' | 'email_compromised' | 'lost_device' | 'other';
  status: 'OPEN' | 'IDENTITY_VERIFIED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  details: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
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

/**
 * A file attached to a ticket message. `downloadPath` is answered by a session-scoped route, so a
 * download must go through the authenticated API client (see `downloadTicketAttachment`) — it is
 * not a public URL and cannot be opened from a bare link in a new tab.
 */
export interface TicketAttachment {
  id: string;
  filename: string;
  contentType: string;
  byteSize: number;
  createdAt: string;
  downloadPath: string;
}

export interface TicketMessage {
  id: string;
  authorRole: string;
  body: string;
  createdAt: string;
  isSelf: boolean;
  /** Present on every message (empty array when there are none) so the UI can distinguish
   * "no attachments" from "not loaded". */
  attachments?: TicketAttachment[];
}

export interface TicketDetail extends TicketSummary {
  closedAt: string | null;
  messages: TicketMessage[];
  /** Attachments that belong to the ticket rather than to a single message. */
  attachments?: TicketAttachment[];
}

/** One file on its way out — base64 plus the claims the server will verify against the bytes. */
export interface TicketAttachmentInput {
  base64: string;
  contentType: string;
  filename: string;
}

export interface AdminCustomerSummary {
  id: string;
  email: string;
  fullName: string;
  role: 'customer' | 'admin' | 'super_admin';
  status: 'active' | 'suspended' | 'disabled' | 'deleted';
  createdAt: string;
  customerId: string | null;
  username?: string | null;
  phone: string | null;
  deletedAt: string | null;
}

export interface AdminCustomerDetail {
  customer: PublicUser;
  services: AdminCustomerService[];
  domains: AdminCustomerDomain[];
  tickets: TicketSummary[];
}
