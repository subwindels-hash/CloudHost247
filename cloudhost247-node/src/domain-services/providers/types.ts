/**
 * Domain-provider contract.
 *
 * The domain services layer owns business rules, customer ownership, price snapshots, payment
 * gates, state transitions and auditing. Provider adapters are intentionally narrow transport
 * boundaries: they turn an authenticated registrar/RDAP/appraisal API into normalized facts.
 * They must never manufacture availability, price, WHOIS, appraisal or auction data.
 */

export type DomainProviderFailureCode =
  | 'PROVIDER_NOT_CONFIGURED'
  | 'ADAPTER_NOT_INSTALLED'
  | 'AUTHENTICATION_FAILED'
  | 'RATE_LIMITED'
  | 'NETWORK_TEMPORARY_FAILURE'
  | 'PROVIDER_UNAVAILABLE'
  | 'UNSUPPORTED_OPERATION'
  | 'INVALID_PROVIDER_RESPONSE'
  | 'PROVIDER_ERROR';

export class DomainProviderError extends Error {
  constructor(
    public readonly code: DomainProviderFailureCode,
    message: string,
    public readonly retryable: boolean,
    /** Sanitised provider detail for server-side diagnostics only. Never return credential data. */
    public readonly providerDetail?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'DomainProviderError';
  }
}

export type DomainAvailabilityStatus = 'available' | 'registered' | 'premium' | 'unavailable' | 'unsupported';

export interface DomainPrice {
  amount: string;
  currency: string;
}

export interface DomainPricing {
  registration: DomainPrice | null;
  renewal: DomainPrice | null;
  transfer: DomainPrice | null;
  premium: boolean;
}

export interface DomainAvailability {
  domainName: string;
  status: DomainAvailabilityStatus;
  pricing: DomainPricing | null;
  providerReference: string | null;
  /** Non-sensitive data required to complete a later provider request, never customer input. */
  metadata: Record<string, unknown>;
  checkedAt: string;
}

export interface DomainExtensionOffering {
  extension: string;
  providerTld: string;
  description?: string | null;
  restrictions?: string | null;
  registrationRequirements?: string | null;
  premiumSupported: boolean;
  pricing: DomainPricing;
  status: 'enabled' | 'disabled' | 'unavailable';
  metadata: Record<string, unknown>;
  sourcedAt: string;
}

export interface DomainContactInput {
  firstName: string;
  lastName: string;
  organization?: string | null;
  email: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state?: string | null;
  postalCode?: string | null;
  countryCode: string;
}

export interface RegisterDomainInput {
  domainName: string;
  years: number;
  contacts: {
    registrant: DomainContactInput;
    administrative?: DomainContactInput;
    technical?: DomainContactInput;
    billing?: DomainContactInput;
  };
  /** Stable key supplied only by the platform transaction/job. */
  idempotencyKey: string;
}

export interface RegisterDomainResult {
  providerReference: string;
  status: 'requested' | 'pending_confirmation' | 'registered';
  expiresAt: string | null;
  providerStatus: string | null;
  metadata: Record<string, unknown>;
}

export interface TransferDomainInput {
  domainName: string;
  authCode: string;
  contacts?: { registrant?: DomainContactInput; administrative?: DomainContactInput };
  authorizationConfirmedAt: string;
  idempotencyKey: string;
}

export interface TransferDomainResult {
  providerReference: string;
  status: 'authorization_required' | 'initiated' | 'in_progress' | 'pending_registry' | 'completed';
  providerStatus: string | null;
  metadata: Record<string, unknown>;
}

export interface ProviderDomainStatus {
  domainName: string;
  registrationStatus: 'pending_confirmation' | 'registered' | 'failed' | 'unknown';
  transferStatus?: 'authorization_required' | 'initiated' | 'in_progress' | 'pending_registry' | 'completed' | 'failed' | 'unknown';
  providerStatus: string | null;
  expiresAt: string | null;
  metadata: Record<string, unknown>;
}

/** Privacy-respecting public domain information. Raw registrant records are intentionally absent. */
export interface PublicDomainInfo {
  domainName: string;
  registrar: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  expiresAt: string | null;
  statuses: string[];
  nameservers: string[];
  registry: string | null;
  privacyProtected: boolean;
  source: 'rdap' | 'whois';
  providerReference: string | null;
}

export interface DomainAppraisalResult {
  estimatedValue: DomainPrice;
  confidence: 'low' | 'medium' | 'high' | null;
  tld: string;
  domainLength: number;
  keywords: string[];
  brandability: string | null;
  /** Provider-supplied public comparables only. Never construct synthetic sales. */
  comparableSales: Array<{ domainName: string; price: DomainPrice; soldAt: string | null; source?: string | null }>;
  factors: Record<string, unknown>;
  providerReference: string | null;
}

export interface DomainProviderCapabilities {
  availability: boolean;
  pricing: boolean;
  registration: boolean;
  transfer: boolean;
  domainStatus: boolean;
  domainInfo: boolean;
  extensions: boolean;
  appraisal: boolean;
}

export interface DomainProviderConnectionResult {
  status: 'connected' | 'auth_failed' | 'unavailable' | 'not_configured';
  message: string;
  capabilities: Partial<DomainProviderCapabilities>;
}

export interface DomainProviderConfig {
  id: string;
  key: string;
  name: string;
  adapterKey: string;
  type: 'registrar' | 'rdap' | 'appraisal' | 'auction';
  environment: 'sandbox' | 'production';
  apiBaseUrl: string | null;
  capabilities: Record<string, unknown>;
  configuration: Record<string, unknown>;
  credentials: Record<string, string>;
}

/**
 * Every concrete provider must either implement an operation against its documented real API or
 * reject it with DomainProviderError('UNSUPPORTED_OPERATION'). A missing provider is never
 * represented by fabricated availability or price data.
 */
export interface DomainProviderAdapter {
  readonly key: string;
  readonly capabilities: Partial<DomainProviderCapabilities>;

  testConnection(): Promise<DomainProviderConnectionResult>;
  checkAvailability(domainNames: string[]): Promise<DomainAvailability[]>;
  getPricing(extensions: string[]): Promise<DomainExtensionOffering[]>;
  getExtensions(): Promise<DomainExtensionOffering[]>;
  registerDomain(input: RegisterDomainInput): Promise<RegisterDomainResult>;
  transferDomain(input: TransferDomainInput): Promise<TransferDomainResult>;
  getDomainStatus(providerReference: string, domainName: string): Promise<ProviderDomainStatus>;
  getDomainInfo(domainName: string): Promise<PublicDomainInfo>;
  appraiseDomain(domainName: string): Promise<DomainAppraisalResult>;
}

/** Safe, user-facing wording. Technical errors stay in structured audit/provider logs. */
export function safeDomainProviderMessage(error: unknown): string {
  if (error instanceof DomainProviderError) {
    switch (error.code) {
      case 'PROVIDER_NOT_CONFIGURED':
      case 'ADAPTER_NOT_INSTALLED':
        return 'Service Provider Not Configured';
      case 'RATE_LIMITED':
        return 'Domain provider rate limit reached. Please try again shortly.';
      case 'NETWORK_TEMPORARY_FAILURE':
      case 'PROVIDER_UNAVAILABLE':
        return 'Domain provider temporarily unavailable. Please try again.';
      case 'AUTHENTICATION_FAILED':
        return 'Domain provider is unavailable. Please try again later.';
      default:
        return 'We could not complete this request right now. Please try again.';
    }
  }
  return 'We could not complete this request right now. Please try again.';
}
