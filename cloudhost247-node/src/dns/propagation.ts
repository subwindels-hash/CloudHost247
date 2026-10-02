/**
 * DNS propagation — pushes zone and record changes to the zone's declared external provider.
 *
 * WHY THIS EXISTS: `src/routes/dns.ts` writes to the platform's own dns_zones / dns_records tables.
 * On its own that store is only a record of intent — a zone whose `provider` column says CLOUDFLARE
 * but which was never created at Cloudflare is a lie the customer can act on (they would point their
 * registrar at nameservers that resolve nothing). This layer makes the write real or refuses it.
 *
 * ORDERING: every propagation happens BEFORE the local write. The local store therefore never claims
 * a resource exists upstream when the upstream call did not succeed. The one asymmetric case is
 * delete, where the upstream delete runs first and the local row is only then marked DELETED; if the
 * upstream delete fails the row stays, which is the state that still tells the truth.
 *
 * FAIL-CLOSED: a zone whose provider is external but which has no resolvable upstream zone id, or an
 * unconfigured provider, is an error — never a silent local-only write and never a fabricated id.
 *
 * INTERNAL (the default) zones are untouched by this layer and keep their exact previous behaviour.
 */
import type { Queryable } from '../db/types';
import { HttpError, ServiceUnavailableError } from '../lib/errors';
import { CloudflareError } from '../integrations/cloudflare/errors';
import {
  createDnsProvider,
  type CloudflareDnsProviderOptions,
  type Route53DnsProviderOptions,
} from './providers';
import type {
  CreateDnsRecordInput,
  DnsProvider,
  DnsRecordRow,
  DnsRecordType,
  DnsZoneRow,
  UpdateDnsRecordInput,
} from './types';

export interface DnsPropagationOptions {
  cloudflare?: CloudflareDnsProviderOptions;
  route53?: Route53DnsProviderOptions;
  /** Injectable provider factory so tests run the real propagation logic against a fake provider. */
  factory?: (providerName: string, db: Queryable) => DnsProvider;
}

const EXTERNAL_PROVIDERS = new Set(['CLOUDFLARE', 'ROUTE53']);

/** Key under which the provider's own zone identifier is kept in dns_zones.metadata. */
export const PROVIDER_ZONE_ID_KEY = 'providerZoneId';

/** True when the zone's declared provider is one this platform can push changes to. */
export function isExternalDnsProvider(provider: string | null | undefined): boolean {
  return EXTERNAL_PROVIDERS.has(String(provider ?? '').toUpperCase());
}

/** Converts a provider failure into a safe platform HTTP error, leaking no upstream payload. */
export function rethrowSafeDns(error: unknown): never {
  if (error instanceof CloudflareError) {
    throw new HttpError(
      error.statusCode,
      error.code === 'CLOUDFLARE_VALIDATION_ERROR' ? error.message : error.safeMessage,
      error.code
    );
  }
  if (error instanceof HttpError) throw error;
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith('CONFIGURATION_REQUIRED')) {
    throw new ServiceUnavailableError(
      'This DNS zone\'s provider is not configured on this platform, so the change cannot be applied upstream.'
    );
  }
  throw new HttpError(502, 'The DNS provider rejected this change.', 'DNS_PROVIDER_ERROR');
}

/** Reads the provider's own zone id from the zone metadata, or fails closed. */
export function providerZoneIdOf(zone: DnsZoneRow): string {
  const raw = zone.metadata as Record<string, unknown> | null;
  const id = raw?.[PROVIDER_ZONE_ID_KEY];
  if (typeof id !== 'string' || id.length === 0) {
    throw new ServiceUnavailableError(
      `This zone was created before upstream propagation existed, so it has no ${zone.provider} zone id. Re-provision the zone to manage it through this platform.`
    );
  }
  return id;
}

/**
 * Creates the zone at the provider and returns what the local row must record.
 * Returns null for internal zones, which are managed by the platform's own store alone.
 */
export async function propagateZoneCreate(
  db: Queryable,
  domainName: string,
  provider: string | undefined,
  options: DnsPropagationOptions = {}
): Promise<{ provider: string; nameservers: string[]; metadata: Record<string, unknown> } | null> {
  if (!isExternalDnsProvider(provider)) return null;
  const name = String(provider).toUpperCase();
  try {
    const impl = (options.factory ?? ((n, d) => createDnsProvider(n, d, options)))(name, db);
    const created = await impl.createZone(domainName);
    if (!created.zoneId) {
      throw new HttpError(502, `The ${name} provider accepted the zone but returned no zone id.`, 'DNS_PROVIDER_ERROR');
    }
    if (created.nameservers.length === 0) {
      // A zone with no delegation set cannot be delegated, and substituting the platform's own
      // nameservers would point the customer's registrar somewhere that resolves nothing.
      throw new HttpError(
        502,
        `The ${name} provider created the zone but returned no nameservers, so it cannot be delegated.`,
        'DNS_PROVIDER_ERROR'
      );
    }
    return {
      provider: name,
      // The provider's own nameservers, never the platform's defaults.
      nameservers: created.nameservers,
      metadata: { [PROVIDER_ZONE_ID_KEY]: created.zoneId, providerZoneStatus: 'PROVISIONED' },
    };
  } catch (error) {
    rethrowSafeDns(error);
  }
}

/** Deletes the zone at the provider. Internal zones and already-missing ids are no-ops. */
export async function propagateZoneDelete(
  db: Queryable,
  zone: DnsZoneRow,
  options: DnsPropagationOptions = {}
): Promise<void> {
  if (!isExternalDnsProvider(zone.provider)) return;
  const providerZoneId = providerZoneIdOf(zone);
  try {
    const impl = (options.factory ?? ((n, d) => createDnsProvider(n, d, options)))(zone.provider.toUpperCase(), db);
    await impl.deleteZone(providerZoneId);
  } catch (error) {
    rethrowSafeDns(error);
  }
}

/**
 * Creates the record at the provider and returns its upstream id, or null for internal zones.
 * The upstream id is reported to the caller but is not persisted: dns_records has no metadata
 * column, and later operations resolve the record by name+type instead.
 */
export async function propagateRecordCreate(
  db: Queryable,
  zone: DnsZoneRow,
  input: CreateDnsRecordInput,
  options: DnsPropagationOptions = {}
): Promise<string | null> {
  if (!isExternalDnsProvider(zone.provider)) return null;
  const providerZoneId = providerZoneIdOf(zone);
  try {
    const impl = (options.factory ?? ((n, d) => createDnsProvider(n, d, options)))(zone.provider.toUpperCase(), db);
    const created = await impl.createRecord(providerZoneId, input);
    return created.recordId;
  } catch (error) {
    rethrowSafeDns(error);
  }
}

/**
 * Updates the record at the provider. Route53 addresses records by name+type rather than by id, so
 * the stored row supplies any field the patch omits — a content-only PATCH must not blank the name.
 */
export async function propagateRecordUpdate(
  db: Queryable,
  zone: DnsZoneRow,
  existing: DnsRecordRow,
  patch: UpdateDnsRecordInput,
  options: DnsPropagationOptions = {}
): Promise<void> {
  if (!isExternalDnsProvider(zone.provider)) return;
  const providerZoneId = providerZoneIdOf(zone);
  try {
    const impl = (options.factory ?? ((n, d) => createDnsProvider(n, d, options)))(zone.provider.toUpperCase(), db);
    await impl.updateRecord(providerZoneId, existing.id, {
      name: patch.name ?? existing.name,
      type: (patch.type ?? existing.type) as DnsRecordType,
      content: patch.content ?? existing.content,
      ttl: patch.ttl ?? existing.ttl,
      priority: patch.priority !== undefined ? patch.priority : existing.priority,
      proxied: patch.proxied ?? existing.proxied,
    });
  } catch (error) {
    rethrowSafeDns(error);
  }
}

/**
 * Deletes the record at the provider. Providers that cannot address a record by the platform's id
 * use `deleteRecordByValues`, which needs the exact current values — hence the stored row.
 */
export async function propagateRecordDelete(
  db: Queryable,
  zone: DnsZoneRow,
  record: DnsRecordRow,
  options: DnsPropagationOptions = {}
): Promise<void> {
  if (!isExternalDnsProvider(zone.provider)) return;
  const providerZoneId = providerZoneIdOf(zone);
  try {
    const impl = (options.factory ?? ((n, d) => createDnsProvider(n, d, options)))(zone.provider.toUpperCase(), db);
    if (impl.deleteRecordByValues) {
      await impl.deleteRecordByValues(providerZoneId, {
        name: record.name,
        type: record.type,
        content: record.content,
        ttl: record.ttl,
        priority: record.priority,
      });
      return;
    }
    await impl.deleteRecord(providerZoneId, record.id);
  } catch (error) {
    rethrowSafeDns(error);
  }
}
