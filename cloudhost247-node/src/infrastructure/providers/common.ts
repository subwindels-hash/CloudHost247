/**
 * Shared helpers for infrastructure provider adapters.
 *
 * Nothing in this file performs I/O or reads credentials. It exists so every adapter derives
 * provider-side resource names, idempotency lookups, and transport guarantees the same way.
 */
import { ProviderError } from './types';

/** Resource-name prefix used for every CloudHost247-owned provider resource. */
export const RESOURCE_NAME_PREFIX = 'ch247';

/**
 * Providers without a native idempotency key (OVH, Proxmox, Virtualizor, SolusVM, OpenStack)
 * still must never create two billable servers for one job. Each adapter therefore derives a
 * deterministic, provider-legal resource name from the job idempotency key and looks that name
 * up before creating anything. The customer hostname is applied inside the guest by cloud-init
 * or the provider hostname field, so this label never leaks to the customer as their hostname.
 */
export function idempotentResourceName(idempotencyKey: string, maxLength = 60): string {
  const normalized = idempotencyKey.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normalized.length === 0) {
    throw new ProviderError('INVALID_CONFIGURATION', 'Provisioning job has no usable idempotency key', false);
  }
  const budget = Math.max(8, maxLength - RESOURCE_NAME_PREFIX.length - 1);
  return `${RESOURCE_NAME_PREFIX}-${normalized.slice(0, budget)}`;
}

/** Proxmox tags and similar label fields accept a narrower character set than resource names. */
export function idempotentTag(idempotencyKey: string, prefix = RESOURCE_NAME_PREFIX): string {
  return `${prefix}-${idempotencyKey.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 32)}`;
}

/**
 * Provider credentials are bearer-equivalent. An adapter must refuse to send them over a
 * plaintext channel even when an administrator mistypes the base URL. Loopback is allowed so an
 * operator can front a provider through a local TLS-terminating tunnel on the API/worker host.
 */
export function requireSecureBaseUrl(kind: string, baseUrl: string | null | undefined): string {
  if (!baseUrl) {
    throw new ProviderError('PROVIDER_NOT_CONFIGURED', `${kind} API base URL is not configured`, false);
  }
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new ProviderError('INVALID_CONFIGURATION', `${kind} API base URL is not a valid URL`, false);
  }
  const loopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
  if (parsed.protocol !== 'https:' && !loopback) {
    throw new ProviderError(
      'INVALID_CONFIGURATION',
      `${kind} API base URL must use https so provider credentials are never sent in plaintext`,
      false
    );
  }
  return baseUrl.replace(/\/$/, '');
}

/** Picks the first non-empty string value for any of the supplied plan-metadata keys. */
export function planMetadataString(
  planMetadata: Record<string, unknown>,
  keys: string[]
): string | null {
  for (const key of keys) {
    const value = planMetadata[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

export function planMetadataNumber(
  planMetadata: Record<string, unknown>,
  keys: string[]
): number | null {
  for (const key of keys) {
    const value = planMetadata[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

export function requirePlanMetadataString(
  planMetadata: Record<string, unknown>,
  keys: string[],
  description: string
): string {
  const value = planMetadataString(planMetadata, keys);
  if (!value) {
    throw new ProviderError(
      'INVALID_CONFIGURATION',
      `Product configuration metadata is missing ${description} (expected one of: ${keys.join(', ')})`,
      false
    );
  }
  return value;
}

/** Returns the first routable IPv4 address in a list, ignoring link-local/loopback entries. */
export function firstPublicIpv4(candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const value = candidate.trim();
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) continue;
    if (value.startsWith('127.') || value.startsWith('169.254.')) continue;
    return value;
  }
  return null;
}

/** Base64 for provider APIs that require encoded cloud-init user data (OpenStack, OVH). */
export function encodeUserData(userData: string): string {
  return Buffer.from(userData, 'utf8').toString('base64');
}

/**
 * Rescue mode is only implemented for providers whose API genuinely offers a rescue system.
 * Everywhere else the adapter refuses instead of pretending: a rescue that silently did nothing
 * would strand a customer who believes they are about to repair a broken disk.
 */
export function unsupportedRescue(kind: string): never {
  throw new ProviderError('UNSUPPORTED_OPERATION', `${kind} does not offer a rescue system through its API`, false);
}

/**
 * A console session hands a customer an interactive login to their own machine, so an adapter may
 * only return one when the provider really issues one. Two adapters used to answer this call with
 * the provider's *action history* endpoint instead — the customer clicked "Open console", the
 * platform audited `SERVER_CONSOLE_OPENED`, and the UI rendered a list of past power events in a
 * panel labelled "Serial console session". Refusing is the honest answer: the capability is then
 * false, the button is never shown, and the reason is on the record.
 *
 * `reason` must state what the provider documents, not what we wish it did.
 */
export function unsupportedConsole(kind: string, reason: string): never {
  throw new ProviderError('UNSUPPORTED_OPERATION', `${kind} offers no console session through its API: ${reason}`, false);
}
