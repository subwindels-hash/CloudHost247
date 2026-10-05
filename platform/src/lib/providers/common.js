/**
 * Shared helpers for infrastructure provider adapters.
 *
 * Ported from cloudhost247-node/src/infrastructure/providers/common.ts. Nothing here performs I/O
 * or reads credentials; it exists so every adapter derives provider-side resource names, idempotency
 * lookups and transport guarantees the same way.
 */
'use strict';

const { ProviderError } = require('./types');

/** Resource-name prefix used for every CloudHost247-owned provider resource. */
const RESOURCE_NAME_PREFIX = 'ch247';

/**
 * Providers without a native idempotency key (OVH, Proxmox, Virtualizor, SolusVM, OpenStack) still
 * must never create two billable servers for one job. Each adapter derives a deterministic,
 * provider-legal resource name from the job idempotency key and looks that name up before creating
 * anything. The customer hostname is applied inside the guest by cloud-init or the provider
 * hostname field, so this label never leaks to the customer as their hostname.
 */
function idempotentResourceName(idempotencyKey, maxLength = 60) {
  const normalized = String(idempotencyKey ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normalized.length === 0) {
    throw new ProviderError('INVALID_CONFIGURATION', 'Provisioning job has no usable idempotency key', false);
  }
  const budget = Math.max(8, maxLength - RESOURCE_NAME_PREFIX.length - 1);
  return `${RESOURCE_NAME_PREFIX}-${normalized.slice(0, budget)}`;
}

/** Proxmox tags and similar label fields accept a narrower character set than resource names. */
function idempotentTag(idempotencyKey, prefix = RESOURCE_NAME_PREFIX) {
  return `${prefix}-${String(idempotencyKey ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 32)}`;
}

/**
 * Provider credentials are bearer-equivalent. An adapter must refuse to send them over a plaintext
 * channel even when an administrator mistypes the base URL. Loopback is allowed so an operator can
 * front a provider through a local TLS-terminating tunnel on the API/worker host.
 */
function requireSecureBaseUrl(kind, baseUrl) {
  if (!baseUrl) {
    throw new ProviderError('PROVIDER_NOT_CONFIGURED', `${kind} API base URL is not configured`, false);
  }
  let parsed;
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
      false,
    );
  }
  return String(baseUrl).replace(/\/$/, '');
}

function planMetadataString(planMetadata, keys) {
  for (const key of keys) {
    const value = (planMetadata ?? {})[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function planMetadataNumber(planMetadata, keys) {
  for (const key of keys) {
    const value = (planMetadata ?? {})[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function requirePlanMetadataString(planMetadata, keys, description) {
  const value = planMetadataString(planMetadata, keys);
  if (!value) {
    throw new ProviderError(
      'INVALID_CONFIGURATION',
      `Product configuration metadata is missing ${description} (expected one of: ${keys.join(', ')})`,
      false,
    );
  }
  return value;
}

/** Returns the first routable IPv4 address in a list, ignoring link-local/loopback entries. */
function firstPublicIpv4(candidates) {
  for (const candidate of candidates ?? []) {
    if (typeof candidate !== 'string') continue;
    const value = candidate.trim();
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) continue;
    if (value.startsWith('127.') || value.startsWith('169.254.')) continue;
    return value;
  }
  return null;
}

/** Base64 for provider APIs that require encoded cloud-init user data (OpenStack, OVH). */
function encodeUserData(userData) {
  return Buffer.from(String(userData ?? ''), 'utf8').toString('base64');
}

/**
 * Rescue mode is only implemented for providers whose API genuinely offers a rescue system.
 * Everywhere else the adapter refuses instead of pretending: a rescue that silently did nothing
 * would strand a customer who believes they are about to repair a broken disk.
 */
function unsupportedRescue(kind) {
  throw new ProviderError('UNSUPPORTED_OPERATION', `${kind} does not offer a rescue system through its API`, false);
}

/**
 * A console session hands a customer an interactive login to their own machine, so an adapter may
 * only return one when the provider really issues one. Refusing is the honest answer: the capability
 * is then false, the button is never shown, and the reason is on the record.
 *
 * `reason` must state what the provider documents, not what we wish it did.
 */
function unsupportedConsole(kind, reason) {
  throw new ProviderError('UNSUPPORTED_OPERATION', `${kind} offers no console session through its API: ${reason}`, false);
}

/**
 * The image identifier a provider record carries. The reference implementation reads the
 * `server_os_images` columns (snake_case); the platform's own `os_images` rows use the same name,
 * and camelCase is accepted so a caller can pass an adapter-shaped input directly.
 */
function imageIdentifier(image) {
  if (!image) return null;
  return image.providerImageId ?? image.providerTemplateId
    ?? image.provider_image_id ?? image.provider_template_id ?? null;
}

module.exports = {
  RESOURCE_NAME_PREFIX,
  idempotentResourceName,
  idempotentTag,
  requireSecureBaseUrl,
  planMetadataString,
  planMetadataNumber,
  requirePlanMetadataString,
  firstPublicIpv4,
  encodeUserData,
  unsupportedRescue,
  unsupportedConsole,
  imageIdentifier,
};
