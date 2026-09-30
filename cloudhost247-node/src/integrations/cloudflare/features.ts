/**
 * Zone feature operations: DNSSEC, SSL/TLS, firewall/security, speed, caching, scrape shield,
 * development mode, and plan changes (spec §16–§25).
 *
 * Everything maps to the CURRENT Cloudflare v4 API: zone settings, DNSSEC endpoint, IP Access
 * Rules, cache purge, and zone subscription rate plans. Deprecated concepts from the reference
 * product (e.g. legacy minify) are intentionally NOT exposed (spec §59).
 */
import type { CloudflareClient } from './client';
import { CloudflareError } from './errors';
import type { CfAccessRule, CfDnssecStatus, CfSettingValue, CloudflarePlanTier } from './types';
import { CLOUDFLARE_RATE_PLAN_IDS } from './types';

// ------------------------------------------------------------------------------- DNSSEC ---

export async function getDnssec(client: CloudflareClient, zoneId: string): Promise<CfDnssecStatus> {
  const { result } = await client.request<CfDnssecStatus>('dnssec.get', 'GET', `/zones/${encodeURIComponent(zoneId)}/dnssec`);
  return result;
}

export async function setDnssec(client: CloudflareClient, zoneId: string, enabled: boolean): Promise<CfDnssecStatus> {
  const { result } = await client.request<CfDnssecStatus>('dnssec.set', 'PATCH', `/zones/${encodeURIComponent(zoneId)}/dnssec`, {
    status: enabled ? 'active' : 'disabled',
  });
  return result;
}

// ------------------------------------------------------------------------- zone settings ---

export async function getZoneSetting(client: CloudflareClient, zoneId: string, settingId: string): Promise<CfSettingValue> {
  const { result } = await client.request<CfSettingValue>(
    `settings.get.${settingId}`,
    'GET',
    `/zones/${encodeURIComponent(zoneId)}/settings/${encodeURIComponent(settingId)}`
  );
  return result;
}

export async function setZoneSetting(client: CloudflareClient, zoneId: string, settingId: string, value: unknown): Promise<CfSettingValue> {
  const { result } = await client.request<CfSettingValue>(
    `settings.set.${settingId}`,
    'PATCH',
    `/zones/${encodeURIComponent(zoneId)}/settings/${encodeURIComponent(settingId)}`,
    { value }
  );
  return result;
}

/** Batch read of a fixed set of settings; individual failures surface as null (never fabricated). */
export async function readSettings(
  client: CloudflareClient,
  zoneId: string,
  ids: string[]
): Promise<Record<string, unknown | null>> {
  const out: Record<string, unknown | null> = {};
  for (const id of ids) {
    try {
      const setting = await getZoneSetting(client, zoneId, id);
      out[id] = setting.value ?? null;
    } catch (error) {
      if (error instanceof CloudflareError && !error.retryable) {
        out[id] = null; // setting unsupported on this zone/plan — honest null, not a guess
      } else {
        throw error;
      }
    }
  }
  return out;
}

export const SSL_SETTING_IDS = ['ssl', 'min_tls_version', 'tls_1_3', 'always_use_https', 'automatic_https_rewrites'];
export const SECURITY_SETTING_IDS = ['security_level', 'browser_check', 'challenge_ttl'];
export const SPEED_SETTING_IDS = ['rocket_loader', 'brotli', 'http3', 'early_hints', 'ip_geolocation'];
export const CACHE_SETTING_IDS = ['cache_level', 'browser_cache_ttl', 'development_mode'];
export const SCRAPE_SHIELD_SETTING_IDS = ['email_obfuscation', 'server_side_exclude', 'hotlink_protection'];

// ---------------------------------------------------------------------- IP access rules ---

export const ACCESS_RULE_MODES = ['block', 'challenge', 'whitelist', 'js_challenge', 'managed_challenge'] as const;

export async function listAccessRules(client: CloudflareClient, zoneId: string): Promise<CfAccessRule[]> {
  const { result } = await client.request<CfAccessRule[]>(
    'firewall.access_rules.list',
    'GET',
    `/zones/${encodeURIComponent(zoneId)}/firewall/access_rules/rules`,
    undefined,
    { per_page: 100 }
  );
  return result ?? [];
}

export async function createAccessRule(
  client: CloudflareClient,
  zoneId: string,
  input: { target: 'ip' | 'ip_range'; value: string; mode: string; notes?: string }
): Promise<CfAccessRule> {
  const { result } = await client.request<CfAccessRule>(
    'firewall.access_rules.create',
    'POST',
    `/zones/${encodeURIComponent(zoneId)}/firewall/access_rules/rules`,
    { mode: input.mode, notes: input.notes, configuration: { target: input.target, value: input.value } }
  );
  return result;
}

export async function updateAccessRule(
  client: CloudflareClient,
  zoneId: string,
  ruleId: string,
  input: { mode?: string; notes?: string }
): Promise<CfAccessRule> {
  const { result } = await client.request<CfAccessRule>(
    'firewall.access_rules.update',
    'PATCH',
    `/zones/${encodeURIComponent(zoneId)}/firewall/access_rules/rules/${encodeURIComponent(ruleId)}`,
    input
  );
  return result;
}

export async function deleteAccessRule(client: CloudflareClient, zoneId: string, ruleId: string): Promise<void> {
  await client.request<{ id: string }>(
    'firewall.access_rules.delete',
    'DELETE',
    `/zones/${encodeURIComponent(zoneId)}/firewall/access_rules/rules/${encodeURIComponent(ruleId)}`
  );
}

// -------------------------------------------------------------------------------- caching ---

export async function purgeCache(
  client: CloudflareClient,
  zoneId: string,
  options: { everything?: boolean; files?: string[] }
): Promise<void> {
  const body = options.everything ? { purge_everything: true } : { files: options.files ?? [] };
  await client.request<{ id: string }>('cache.purge', 'POST', `/zones/${encodeURIComponent(zoneId)}/purge_cache`, body);
}

// ----------------------------------------------------------------------------------- plan ---

/** Changes the zone's subscription rate plan (current API replacement for legacy setPlan). */
export async function changeZonePlan(client: CloudflareClient, zoneId: string, tier: CloudflarePlanTier): Promise<void> {
  await client.request<unknown>('plan.change', 'PUT', `/zones/${encodeURIComponent(zoneId)}/subscription`, {
    rate_plan: { id: CLOUDFLARE_RATE_PLAN_IDS[tier] },
    frequency: 'monthly',
  });
}
