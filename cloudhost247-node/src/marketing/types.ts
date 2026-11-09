import { z } from 'zod';

export const META_PROVIDER = 'meta_pixel';
export const CONSENT_POLICY_VERSION = 1;
export const STANDARD_EVENTS = ['PageView', 'ViewContent', 'Search', 'AddToCart', 'InitiateCheckout', 'AddPaymentInfo', 'Purchase', 'CompleteRegistration', 'Lead', 'Contact'] as const;
export type StandardEvent = typeof STANDARD_EVENTS[number];
export const pixelIdSchema = z.string().regex(/^[1-9][0-9]{4,31}$/, 'Pixel ID must contain 5–32 digits and cannot start with zero');
export const domainSchema = z.string().max(253).transform(v => v.trim().toLowerCase().replace(/^www\./, '')).refine(v => v === 'localhost' || /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(v), 'Enter a hostname such as cloudhost247.com, without a scheme, path or port');

export const configurationSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  websiteDomain: domainSchema,
  enabled: z.boolean(),
  pixelId: z.union([pixelIdSchema, z.null()]),
  testMode: z.boolean(),
  testEventCode: z.union([z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Test Event Code may contain letters, digits, underscores and hyphens'), z.null()]),
  consentPolicy: z.enum(['global_opt_in', 'jurisdiction_opt_in']),
  consentBannerEnabled: z.boolean().default(false),
  capi: z.object({ enabled: z.boolean(), apiVersion: z.string().regex(/^v(?:2[3-9]|[3-9][0-9])\.0$/, 'Use a supported Graph API version such as v26.0') }).strict(),
}).strict().superRefine((value, ctx) => {
  if (value.enabled && !value.pixelId) ctx.addIssue({ code: 'custom', path: ['pixelId'], message: 'A Pixel ID is required before enabling Meta Pixel' });
  if (value.testMode && !value.testEventCode) ctx.addIssue({ code: 'custom', path: ['testEventCode'], message: 'A Test Event Code is required in test mode' });
  if (value.capi.enabled && (!value.enabled || !value.pixelId)) ctx.addIssue({ code: 'custom', path: ['capi'], message: 'Enable and configure the browser Pixel before enabling CAPI' });
});
export type MetaConfiguration = z.infer<typeof configurationSchema>;

export const defaultConfiguration: MetaConfiguration = {
  displayName: 'CloudHost247 Meta Pixel', websiteDomain: '', enabled: false, pixelId: null,
  testMode: false, testEventCode: null, consentPolicy: 'global_opt_in', consentBannerEnabled: false,
  capi: { enabled: false, apiVersion: 'v26.0' },
};

export interface IntegrationRow {
  provider_key: string;
  display_name: string;
  website_domain: string;
  enabled: boolean;
  configuration: MetaConfiguration;
  revision: number;
  last_configuration_update: string | null;
  last_configuration_test_at: string | null;
  last_configuration_test_status: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  has_capi_token?: boolean;
}

export interface Preferences { essential: true; analytics: boolean; marketing: boolean }
export const preferencesSchema = z.object({ essential: z.literal(true), analytics: z.boolean(), marketing: z.boolean() }).strict();
export const defaultPreferences: Preferences = { essential: true, analytics: false, marketing: false };

/** Public DTO allowlist. Never spread a database row or decrypt a secret into a response. */
export function configurationDTO(row: IntegrationRow) {
  const c = row.configuration;
  return {
    providerKey: META_PROVIDER, displayName: row.display_name, websiteDomain: row.website_domain,
    enabled: row.enabled, pixelId: c.pixelId, testMode: c.testMode,
    testEventCode: c.testEventCode, consentPolicy: c.consentPolicy,
    consentBannerEnabled: Boolean(c.consentBannerEnabled),
    capi: { ...c.capi, hasToken: Boolean(row.has_capi_token) },
    revision: row.revision, lastConfigurationUpdate: row.last_configuration_update,
    lastConfigurationTestAt: row.last_configuration_test_at,
    lastConfigurationTestStatus: row.last_configuration_test_status, lastError: row.last_error,
  };
}

// The public runtime object intentionally omits admin diagnostics and all secret metadata.
export function runtimeConfiguration(row: IntegrationRow | null, hostname: string) {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  const matches = Boolean(row && row.website_domain.replace(/^www\./, '') === host);
  const active = Boolean(row?.enabled && row.configuration.pixelId && matches);
  return {
    provider: 'meta' as const, enabled: active,
    pixelId: active ? row!.configuration.pixelId : null,
    testMode: active && row!.configuration.testMode,
    testEventCode: active && row!.configuration.testMode ? row!.configuration.testEventCode : null,
    consentPolicy: row?.configuration.consentPolicy ?? 'global_opt_in' as const,
    consentBannerEnabled: Boolean(row?.configuration.consentBannerEnabled),
    policyVersion: CONSENT_POLICY_VERSION,
    revision: row?.revision ?? 0,
    diagnostic: !row || !row.configuration.pixelId ? 'missing_configuration' : !row.enabled ? 'disabled' : !matches ? 'domain_mismatch' : 'configured',
  };
}
