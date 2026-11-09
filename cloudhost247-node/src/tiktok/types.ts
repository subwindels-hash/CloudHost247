import { z } from 'zod';
import { domainSchema, CONSENT_POLICY_VERSION } from '../marketing/types';

export const TIKTOK_PROVIDER = 'tiktok_pixel';
export const TIKTOK_SECRET_KEY = 'events_api_access_token';
export { CONSENT_POLICY_VERSION };

/**
 * TikTok standard web events (TikTok Business Help Center, "standard events"
 * for Pixel / Events API). No other names may be recorded for this provider.
 * `CompletePayment` is the purchase conversion and, like Meta's `Purchase`,
 * may only be created from authoritative payment confirmation — never from a
 * browser claim. `PlaceAnOrder` marks a successfully created order.
 */
export const TIKTOK_EVENTS = ['PageView', 'ViewContent', 'Search', 'AddToCart', 'InitiateCheckout', 'AddPaymentInfo', 'PlaceAnOrder', 'CompletePayment', 'SubmitForm', 'CompleteRegistration', 'Contact', 'Subscribe'] as const;
export type TikTokEvent = typeof TIKTOK_EVENTS[number];
export const LEAD_EVENTS: readonly TikTokEvent[] = ['Contact', 'SubmitForm', 'CompleteRegistration', 'Subscribe'];

/**
 * TikTok pixel codes ("Pixel ID" in Events Manager, `event_source_id` in the
 * Events API) are alphanumeric strings (commonly beginning with "C"). They are
 * not numeric like Meta IDs and must never contain markup or whitespace, so
 * arbitrary JavaScript/HTML can never be smuggled in as an identifier.
 */
export const tiktokPixelIdSchema = z.string().regex(/^[A-Za-z0-9]{16,32}$/, 'TikTok Pixel ID must be 16–32 letters or digits, exactly as shown in TikTok Events Manager');

export const tiktokConfigurationSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  websiteDomain: domainSchema,
  enabled: z.boolean(),
  pixelId: z.union([tiktokPixelIdSchema, z.null()]),
  testMode: z.boolean(),
  testEventCode: z.union([z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Test Event Code may contain letters, digits, underscores and hyphens'), z.null()]),
  /** Remarketing/audience building. Off by default; requires marketing consent at runtime regardless. */
  remarketingEnabled: z.boolean(),
  /** Per-event opt-outs. Lead events (Contact/SubmitForm/CompleteRegistration/Subscribe) can be disabled individually here. */
  enabledEvents: z.array(z.enum(TIKTOK_EVENTS)).min(1).max(TIKTOK_EVENTS.length),
  eventsApi: z.object({ enabled: z.boolean() }).strict(),
}).strict().superRefine((value, ctx) => {
  if (value.enabled && !value.pixelId) ctx.addIssue({ code: 'custom', path: ['pixelId'], message: 'A TikTok Pixel ID is required before enabling TikTok Pixel' });
  if (value.testMode && !value.testEventCode) ctx.addIssue({ code: 'custom', path: ['testEventCode'], message: 'A Test Event Code from TikTok Events Manager is required in test mode' });
  if (value.eventsApi.enabled && (!value.enabled || !value.pixelId)) ctx.addIssue({ code: 'custom', path: ['eventsApi'], message: 'Enable and configure the browser Pixel before enabling the Events API' });
  if (value.remarketingEnabled && !value.enabled) ctx.addIssue({ code: 'custom', path: ['remarketingEnabled'], message: 'Enable TikTok Pixel before enabling remarketing' });
});
export type TikTokConfiguration = z.infer<typeof tiktokConfigurationSchema>;

export const defaultTikTokConfiguration: TikTokConfiguration = {
  displayName: 'CloudHost247 TikTok Pixel', websiteDomain: '', enabled: false, pixelId: null,
  testMode: false, testEventCode: null, remarketingEnabled: false,
  enabledEvents: [...TIKTOK_EVENTS],
  eventsApi: { enabled: false },
};

export interface TikTokIntegrationRow {
  provider_key: string;
  display_name: string;
  website_domain: string;
  enabled: boolean;
  configuration: TikTokConfiguration;
  revision: number;
  last_configuration_update: string | null;
  last_configuration_test_at: string | null;
  last_configuration_test_status: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  has_events_api_token?: boolean;
}

/** Public DTO allowlist. Never spread a database row or decrypt a secret into a response. */
export function tiktokConfigurationDTO(row: TikTokIntegrationRow) {
  const c = row.configuration;
  return {
    providerKey: TIKTOK_PROVIDER, displayName: row.display_name, websiteDomain: row.website_domain,
    enabled: row.enabled, pixelId: c.pixelId, testMode: c.testMode,
    testEventCode: c.testEventCode, remarketingEnabled: c.remarketingEnabled,
    enabledEvents: c.enabledEvents,
    eventsApi: { enabled: c.eventsApi.enabled, hasToken: Boolean(row.has_events_api_token) },
    revision: row.revision, lastConfigurationUpdate: row.last_configuration_update,
    lastConfigurationTestAt: row.last_configuration_test_at,
    lastConfigurationTestStatus: row.last_configuration_test_status, lastError: row.last_error,
  };
}

/** The public runtime object intentionally omits admin diagnostics and all secret metadata. */
export function tiktokRuntimeConfiguration(row: TikTokIntegrationRow | null, hostname: string) {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  const matches = Boolean(row && row.website_domain.replace(/^www\./, '') === host);
  const active = Boolean(row?.enabled && row.configuration.pixelId && matches);
  return {
    provider: 'tiktok' as const, enabled: active,
    pixelId: active ? row!.configuration.pixelId : null,
    // The TikTok test event code is honoured by the browser SDK's test mode and
    // by Events API deliveries; it is not a secret and TikTok documents passing
    // it with test traffic so it never pollutes production reporting.
    testMode: active && row!.configuration.testMode,
    testEventCode: active && row!.configuration.testMode ? row!.configuration.testEventCode : null,
    remarketingEnabled: active && row!.configuration.remarketingEnabled,
    enabledEvents: active ? row!.configuration.enabledEvents : [] as TikTokEvent[],
    eventsApiEnabled: active && row!.configuration.eventsApi.enabled,
    policyVersion: CONSENT_POLICY_VERSION,
    revision: row?.revision ?? 0,
    diagnostic: !row || !row.configuration.pixelId ? 'missing_configuration' : !row.enabled ? 'disabled' : !matches ? 'domain_mismatch' : 'configured',
  };
}
export type TikTokRuntimeConfiguration = ReturnType<typeof tiktokRuntimeConfiguration>;
