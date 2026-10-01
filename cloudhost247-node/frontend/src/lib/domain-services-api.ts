/**
 * Domain Services frontend API types + helpers.
 *
 * Every type here mirrors the server DTO exactly. Prices are strings (never computed in the
 * browser), statuses come from the server, and nothing here fabricates availability or pricing.
 */
import { apiFetch } from './api';

export type DomainAvailabilityStatus =
  | 'available'
  | 'registered'
  | 'premium'
  | 'unavailable'
  | 'unsupported'
  | 'provider_error';

export interface SearchResultRow {
  domainName: string;
  availabilityStatus: DomainAvailabilityStatus;
  isPremium: boolean;
  registrationPrice: string | null;
  renewalPrice: string | null;
  transferPrice: string | null;
  currency: string | null;
}

export interface SearchResponse {
  searchId: string;
  queryLabel: string;
  status: 'completed' | 'provider_not_configured' | 'provider_error' | 'rate_limited';
  message: string | null;
  results: SearchResultRow[];
}

export interface BulkSearchResponse {
  searchId: string;
  status: 'completed' | 'provider_not_configured' | 'provider_error' | 'rate_limited';
  message: string | null;
  submittedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  results: SearchResultRow[];
}

export interface ExtensionEntry {
  id: string;
  extension: string;
  description: string | null;
  restrictions: string | null;
  registrationRequirements: string | null;
  isTrending: boolean;
  status: string;
  registrationPrice: string | null;
  renewalPrice: string | null;
  transferPrice: string | null;
  currency: string | null;
  premiumSupported: boolean;
  offeringStatus: string | null;
  providerName: string | null;
  sourcedAt: string | null;
}

export interface ReadinessResponse {
  registrar: { configured: boolean; providerKey: string | null };
  rdap: { configured: boolean; providerKey: string | null };
  appraisal: { configured: boolean; providerKey: string | null };
  auctions: { configured: boolean };
}

export interface RegistrationQuote {
  domainName: string;
  years: number;
  isPremium: boolean;
  standardPrice: string;
  memberPrice: string | null;
  discountAmount: string | null;
  currency: string;
  clubName: string | null;
}

export interface OrderCreatedResponse {
  registrationId?: string;
  transferId?: string;
  membershipId?: string;
  appraisalId?: string;
  orderId: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  amount: string;
  currency: string;
  appraisal?: AppraisalOutcome | null;
  status?: string;
  message?: string | null;
}

export interface AppraisalOutcome {
  domainName: string;
  estimatedValue: string;
  currency: string;
  confidence: string | null;
  tld: string;
  domainLength: number;
  keywords: string[];
  brandability: string | null;
  comparableSales: Array<{ domainName: string; price: string; soldAt: string | null; source: string | null }>;
  factors: Record<string, unknown>;
  disclaimer: string;
}

export interface WhoisResponse {
  lookupId: string | null;
  status: 'completed' | 'provider_not_configured' | 'not_found' | 'rate_limited' | 'provider_error';
  message: string | null;
  result: {
    domainName: string;
    registrar: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    expiresAt: string | null;
    statuses: string[];
    nameservers: string[];
    registry: string | null;
    source: string;
    privacyProtected: boolean;
    registrant: string;
  } | null;
}

export interface AuctionDto {
  id: string;
  domainName: string;
  status: string;
  currency: string;
  minimumBid: string;
  bidIncrement: string;
  currentHighestBid: string | null;
  bidCount: number;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  description?: string | null;
  myHighestBid?: string | null;
}

export interface ClubPlanDto {
  id: string;
  name: string;
  description: string | null;
  status: string;
  currency: string;
  billingPeriod: 'monthly' | 'annually';
  priceAmount: string;
  discountType: 'percentage' | 'fixed';
  discountValue: string;
  eligibleExtensions: string[];
  promotion: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface MembershipDto {
  id: string;
  planId: string;
  planName: string;
  status: string;
  startsAt: string | null;
  renewsAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  orderId: string | null;
  invoiceId: string | null;
  billingPeriod: string;
  priceAmount: string;
  currency: string;
}

export function fetchReadiness(): Promise<ReadinessResponse> {
  return apiFetch<ReadinessResponse>('/api/v1/domain-services/readiness');
}

export function searchDomains(query: string): Promise<SearchResponse> {
  return apiFetch<SearchResponse>('/api/v1/domain-services/search', {
    method: 'POST',
    body: JSON.stringify({ query }),
  });
}

export function bulkSearchDomains(content: string, sourceType: 'text' | 'csv' | 'txt' = 'text'): Promise<BulkSearchResponse> {
  return apiFetch<BulkSearchResponse>('/api/v1/domain-services/bulk-search', {
    method: 'POST',
    body: JSON.stringify({ content, sourceType }),
  });
}

export function listExtensions(search?: string): Promise<{ extensions: ExtensionEntry[] }> {
  const suffix = search && search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
  return apiFetch<{ extensions: ExtensionEntry[] }>(`/api/v1/domain-services/extensions${suffix}`);
}

export function quoteRegistration(domainName: string, years: number): Promise<{ quote: RegistrationQuote }> {
  return apiFetch<{ quote: RegistrationQuote }>('/api/v1/domain-services/registrations/quote', {
    method: 'POST',
    body: JSON.stringify({ domainName, years }),
  });
}

export function whoisLookup(domainName: string): Promise<WhoisResponse> {
  return apiFetch<WhoisResponse>('/api/v1/domain-services/whois', {
    method: 'POST',
    body: JSON.stringify({ domainName }),
  });
}

export const AVAILABILITY_LABELS: Record<DomainAvailabilityStatus, string> = {
  available: 'Available',
  registered: 'Registered',
  premium: 'Premium',
  unavailable: 'Unavailable',
  unsupported: 'Unsupported',
  provider_error: 'Provider Error',
};
