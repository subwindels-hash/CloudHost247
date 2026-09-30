/**
 * Cloudflare provider types + the capability layer (spec §58–§59).
 *
 * Capabilities describe what the CURRENT Cloudflare API supports per plan tier so the UI never
 * renders broken controls and the backend can answer FEATURE_NOT_SUPPORTED deterministically.
 */

export type CloudflarePlanTier = 'free' | 'pro' | 'business' | 'enterprise';

export interface CfZone {
  id: string;
  name: string;
  status: string; // active | pending | initializing | moved | deleted | deactivated
  paused: boolean;
  name_servers?: string[];
  plan?: { id?: string; name?: string; legacy_id?: string };
}

export interface CfDnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied?: boolean;
  priority?: number;
  comment?: string | null;
  created_on?: string;
  modified_on?: string;
}

export interface CfDnssecStatus {
  status: string; // active | pending | disabled | pending-disabled | error
  ds?: string | null;
  key_tag?: number | null;
  algorithm?: string | null;
  digest?: string | null;
  digest_type?: string | null;
}

export interface CfSettingValue {
  id: string;
  value: unknown;
  editable?: boolean;
  modified_on?: string | null;
}

export interface CfAccessRule {
  id: string;
  mode: string; // block | challenge | whitelist | js_challenge | managed_challenge
  notes?: string;
  configuration: { target: string; value: string };
  created_on?: string;
}

export interface CfAnalyticsTotals {
  requests: number | null;
  cachedRequests: number | null;
  bytes: number | null;
  cachedBytes: number | null;
  threats: number | null;
  pageViews: number | null;
  uniques: number | null;
}

export const CLOUDFLARE_FEATURE_KEYS = [
  'dns',
  'dnssec',
  'analytics',
  'ssl',
  'firewall',
  'speed',
  'caching',
  'cache_purge',
  'development_mode',
  'scrape_shield',
  'plan_change',
] as const;
export type CloudflareFeatureKey = (typeof CLOUDFLARE_FEATURE_KEYS)[number];

export interface CloudflareCapabilities {
  supportsDns: boolean;
  supportsDnssec: boolean;
  supportsAnalytics: boolean;
  supportsSsl: boolean;
  supportsFirewall: boolean;
  supportsSpeed: boolean;
  supportsCaching: boolean;
  supportsCachePurge: boolean;
  supportsDevelopmentMode: boolean;
  supportsScrapeShield: boolean;
  supportsPlanChange: boolean;
  /** SSL modes selectable at this tier via the current API. */
  sslModes: string[];
  /** Minimum browser cache TTL choices etc. are validated by zod in the routes. */
}

/**
 * Per-tier capability matrix for the CURRENT Cloudflare v4 API. All listed features exist on
 * every paid-and-free tier today; the matrix exists so future divergence (or partial-setup
 * zones) is a data change, not a code hunt.
 */
export function capabilitiesForPlan(tier: CloudflarePlanTier): CloudflareCapabilities {
  return {
    supportsDns: true,
    supportsDnssec: true,
    supportsAnalytics: true,
    supportsSsl: true,
    supportsFirewall: true,
    supportsSpeed: true,
    supportsCaching: true,
    supportsCachePurge: true,
    supportsDevelopmentMode: true,
    supportsScrapeShield: true,
    supportsPlanChange: tier !== 'enterprise',
    sslModes: ['off', 'flexible', 'full', 'strict'],
  };
}

/** Cloudflare zone-subscription rate-plan ids for the self-serve tiers. */
export const CLOUDFLARE_RATE_PLAN_IDS: Record<CloudflarePlanTier, string> = {
  free: 'free',
  pro: 'pro',
  business: 'business',
  enterprise: 'enterprise',
};

/** Normalizes a zone's reported plan (legacy_id preferred) to a tier, defaulting to free. */
export function tierFromZonePlan(zone: CfZone): CloudflarePlanTier {
  const legacy = zone.plan?.legacy_id?.toLowerCase() ?? '';
  if (legacy === 'pro' || legacy === 'business' || legacy === 'enterprise') return legacy;
  const name = zone.plan?.name?.toLowerCase() ?? '';
  if (name.includes('pro')) return 'pro';
  if (name.includes('business')) return 'business';
  if (name.includes('enterprise')) return 'enterprise';
  return 'free';
}
