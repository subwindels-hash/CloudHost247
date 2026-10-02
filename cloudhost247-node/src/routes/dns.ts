import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import { getPool } from '../db/pool';
import { authenticate } from '../lib/require-auth';
import { NotFoundError, ValidationError, ConflictError } from '../lib/errors';
import { auditRequest } from '../lib/audit';
import {
  listDnsZonesForUser,
  findDnsZoneById,
  findDnsZoneByDomain,
  createDnsZone,
  deleteDnsZone,
  listDnsRecordsForZone,
  findDnsRecordById,
  createDnsRecord,
  updateDnsRecord,
  deleteDnsRecord,
} from '../db/dns';
import type { DnsProvider, DnsRecordType, DnsZoneRow, UpdateDnsRecordInput } from '../dns/types';
import {
  SUPPORTED_DNS_PROVIDERS,
  createDnsProvider,
  isSupportedDnsProvider,
  type DnsProviderOverrides,
} from '../dns/providers';
import { CloudflareError } from '../integrations/cloudflare/errors';
import { dnsNotFound, mapCloudflareDnsFailure, unsupportedDnsOperation } from '../dns/errors';

const idSchema = z.string().uuid();
const domainSchema = z
  .string()
  .min(3)
  .max(253)
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i, 'Invalid domain name');

const recordTypeSchema = z.enum(['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'SRV', 'CAA', 'PTR', 'SOA']);

// Only connectors that exist in this build are selectable; a typo cannot be stored and silently
// leave a customer's DNS somewhere they did not choose (A11).
const providerSchema = z.enum(SUPPORTED_DNS_PROVIDERS);

const createDirectRecordSchema = z.object({
  zoneId: z.string().uuid(),
  name: z.string().min(1).max(255),
  type: recordTypeSchema,
  content: z.string().min(1).max(2000),
  ttl: z.coerce.number().int().min(60).max(86400).optional(),
  priority: z.coerce.number().int().min(0).max(65535).nullable().optional(),
  proxied: z.boolean().optional(),
});

const createNestedRecordSchema = z.object({
  name: z.string().min(1).max(255),
  type: recordTypeSchema,
  content: z.string().min(1).max(2000),
  ttl: z.coerce.number().int().min(60).max(86400).optional(),
  priority: z.coerce.number().int().min(0).max(65535).nullable().optional(),
  proxied: z.boolean().optional(),
});

const patchRecordSchema = createNestedRecordSchema.partial();

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError(result.error.issues.map((i) => i.message).join(', '));
  return result.data;
}

export interface DnsRouteOptions {
  /** Connector overrides for tests; production resolves credentials from the vault/environment. */
  providers?: DnsProviderOverrides;
}

export async function registerDnsRoutes(
  app: FastifyInstance,
  env: Env,
  overridePool?: Queryable,
  options: DnsRouteOptions = {}
) {
  const pool = overridePool ?? getPool(env);

  /**
   * A connector that governs a zone, with the provider-side zone id. Returns null for the internal
   * engine (records live only in our database). An external provider row without an attached remote
   * zone is refused rather than silently treated as internal.
   */
  const connectorFor = (zone: DnsZoneRow): { provider: DnsProvider; remoteZoneId: string } | null => {
    const providerName = (zone.provider ?? 'INTERNAL').toUpperCase();
    if (providerName === 'INTERNAL' || providerName === 'DEFAULT') return null;
    if (!isSupportedDnsProvider(providerName)) {
      throw unsupportedDnsOperation(
        providerName,
        'no DNS connector is implemented for this provider in this build'
      );
    }
    const remoteZoneId = typeof zone.metadata?.remoteZoneId === 'string' ? zone.metadata.remoteZoneId : null;
    if (!remoteZoneId) {
      throw unsupportedDnsOperation(
        providerName,
        `the zone is recorded as ${providerName} but no ${providerName} zone is attached to it; reconnect the zone before changing its records`
      );
    }
    return { provider: createDnsProvider(providerName, pool, options.providers), remoteZoneId };
  };

  /** Provider failures become safe HTTP errors; Cloudflare errors are translated first. */
  const rethrowProviderError = (error: unknown): never => {
    if (error instanceof CloudflareError) return mapCloudflareDnsFailure(error);
    throw error;
  };

  /** Creates the record on the zone's connector first; returns the provider's identifier. */
  const createProviderRecord = async (
    zone: DnsZoneRow,
    input: { name: string; type: string; content: string; ttl?: number; priority?: number | null; proxied?: boolean },
  ): Promise<string | null> => {
    const connector = connectorFor(zone);
    if (!connector) return null;
    try {
      const created = await connector.provider.createRecord(connector.remoteZoneId, {
        zoneId: zone.id,
        name: input.name,
        type: input.type as DnsRecordType,
        content: input.content,
        ttl: input.ttl,
        priority: input.priority,
        proxied: input.proxied,
      });
      return created.recordId;
    } catch (error) {
      return rethrowProviderError(error);
    }
  };

  /**
   * The local row is a mirror of the connector's state, so a failed local write must not leave a
   * live record that the customer cannot see: the provider record is removed again. A failure here
   * is logged loudly rather than hidden.
   */
  const rollbackProviderRecord = async (zone: DnsZoneRow, providerRecordId: string | null): Promise<void> => {
    if (!providerRecordId) return;
    const connector = connectorFor(zone);
    if (!connector) return;
    try {
      await connector.provider.deleteRecord(connector.remoteZoneId, providerRecordId);
    } catch (cleanupError) {
      app.log.error({ err: cleanupError }, 'failed to roll back a provider DNS record after a local write failure');
    }
  };

  /**
   * Pushes a record patch to the zone's connector before the mirror row is updated, and refuses the
   * states the connector cannot represent (a "disabled" record has no meaning at Cloudflare or
   * Route 53 — claiming otherwise would be a capability the platform does not have).
   */
  const applyProviderPatch = async (
    zone: DnsZoneRow,
    existing: { name: string; type: string; provider_record_id: string | null },
    patch: UpdateDnsRecordInput,
  ): Promise<UpdateDnsRecordInput> => {
    const connector = connectorFor(zone);
    if (!connector) return patch;
    if (patch.status === 'DISABLED') {
      throw unsupportedDnsOperation(
        connector.provider.name,
        'this connector has no disabled-record state; delete the record instead of disabling it'
      );
    }
    const providerRecordId = await providerRecordIdFor(connector, existing);
    if (!providerRecordId) {
      throw dnsNotFound(connector.provider.name, 'the record no longer exists at the provider');
    }
    try {
      await connector.provider.updateRecord(connector.remoteZoneId, providerRecordId, patch);
    } catch (error) {
      rethrowProviderError(error);
    }
    // Re-storing the resolved identifier self-heals rows created before the connector was wired.
    return { ...patch, providerRecordId };
  };

  /**
   * Deletes the record at the connector first. When the record is already absent there, the mirror
   * row is still removed: the customer asked for the record to be gone, and it is.
   */
  const deleteProviderRecord = async (
    zone: DnsZoneRow,
    existing: { name: string; type: string; provider_record_id: string | null },
  ): Promise<void> => {
    const connector = connectorFor(zone);
    if (!connector) return;
    const providerRecordId = await providerRecordIdFor(connector, existing);
    if (!providerRecordId) return;
    try {
      await connector.provider.deleteRecord(connector.remoteZoneId, providerRecordId);
    } catch (error) {
      rethrowProviderError(error);
    }
  };

  /** The connector's identifier for an existing platform record, self-healing legacy rows. */
  const providerRecordIdFor = async (
    connector: { provider: DnsProvider; remoteZoneId: string },
    record: { name: string; type: string; provider_record_id: string | null },
  ): Promise<string | null> => {
    if (record.provider_record_id) return record.provider_record_id;
    if (!connector.provider.resolveRecordId) return null;
    return connector.provider.resolveRecordId(
      connector.remoteZoneId,
      record.name,
      record.type as DnsRecordType
    );
  };

  const registerHandlers = (prefix: string) => {
    // --- DNS Zones Endpoints --------------------------------------------------------------------

    app.get(`${prefix}/dns/zones`, async (request) => {
      const auth = await authenticate(request, env, pool);
      const zones = await listDnsZonesForUser(pool, auth.userId);
      return { zones };
    });

    app.post(`${prefix}/dns/zones`, async (request, reply) => {
      const auth = await authenticate(request, env, pool);
      const input = parseOrThrow(
        z.object({
          domainName: domainSchema,
          provider: providerSchema.optional(),
        }),
        request.body
      );

      const existing = await findDnsZoneByDomain(pool, input.domainName);
      if (existing) {
        throw new ConflictError('A DNS zone for that domain already exists');
      }

      const providerName = (input.provider ?? 'INTERNAL').toUpperCase();
      // The connector is authoritative: the real zone is created first and only recorded locally
      // once it exists, so a provider failure leaves no half-created zone behind.
      let remoteZoneId: string | null = null;
      let remoteNameservers: string[] = [];
      if (providerName !== 'INTERNAL') {
        const provider = createDnsProvider(providerName, pool, options.providers);
        try {
          const created = await provider.createZone(input.domainName.toLowerCase());
          remoteZoneId = created.zoneId;
          remoteNameservers = created.nameservers;
        } catch (error) {
          rethrowProviderError(error);
        }
      }

      const zone = await createDnsZone(pool, {
        userId: auth.userId,
        domainName: input.domainName.toLowerCase(),
        provider: providerName,
        ...(remoteNameservers.length > 0 ? { nameservers: remoteNameservers } : {}),
        ...(remoteZoneId ? { metadata: { remoteZoneId } } : {}),
      });

      await auditRequest(pool, request, auth.userId, {
        action: 'DNS_ZONE_CREATED',
        resourceType: 'dns_zone',
        resourceId: zone.id,
        metadata: { domain: zone.domain_name },
      });

      reply.code(201);
      return { zone };
    });

    app.get<{ Params: { id: string } }>(`${prefix}/dns/zones/:id`, async (request) => {
      const auth = await authenticate(request, env, pool);
      const id = parseOrThrow(idSchema, request.params.id);
      const zone = await findDnsZoneById(pool, id);
      if (!zone || zone.user_id !== auth.userId) throw new NotFoundError('DNS zone not found');

      const records = await listDnsRecordsForZone(pool, id);
      return { zone, records };
    });

    app.delete<{ Params: { id: string } }>(`${prefix}/dns/zones/:id`, async (request, reply) => {
      const auth = await authenticate(request, env, pool);
      const id = parseOrThrow(idSchema, request.params.id);
      const zone = await findDnsZoneById(pool, id);
      if (!zone || zone.user_id !== auth.userId) throw new NotFoundError('DNS zone not found');

      const remoteZoneId = typeof zone.metadata?.remoteZoneId === 'string' ? zone.metadata.remoteZoneId : null;
      if (remoteZoneId && isSupportedDnsProvider(zone.provider)) {
        const provider = createDnsProvider(zone.provider, pool, options.providers);
        try {
          await provider.deleteZone(remoteZoneId);
        } catch (error) {
          rethrowProviderError(error);
        }
      }
      await deleteDnsZone(pool, id);
      await auditRequest(pool, request, auth.userId, {
        action: 'DNS_ZONE_DELETED',
        resourceType: 'dns_zone',
        resourceId: id,
        metadata: { domain: zone.domain_name },
      });

      reply.code(204);
      return null;
    });

    // --- Direct DNS Records Endpoints (Section 29) ----------------------------------------------

    app.post(`${prefix}/dns/records`, async (request, reply) => {
      const auth = await authenticate(request, env, pool);
      const input = parseOrThrow(createDirectRecordSchema, request.body);
      const zone = await findDnsZoneById(pool, input.zoneId);
      if (!zone || zone.user_id !== auth.userId) throw new NotFoundError('DNS zone not found');

      const providerRecordId = await createProviderRecord(zone, input);
      let record;
      try {
        record = await createDnsRecord(pool, {
          zoneId: input.zoneId,
          name: input.name,
          type: input.type,
          content: input.content,
          ttl: input.ttl,
          priority: input.priority,
          proxied: input.proxied,
          providerRecordId,
        });
      } catch (error) {
        await rollbackProviderRecord(zone, providerRecordId);
        throw error;
      }

      await auditRequest(pool, request, auth.userId, {
        action: 'DNS_RECORD_CREATED',
        resourceType: 'dns_record',
        resourceId: record.id,
        metadata: { zoneId: record.zone_id, name: record.name, type: record.type },
      });

      reply.code(201);
      return { record };
    });

    app.patch<{ Params: { id: string } }>(`${prefix}/dns/records/:id`, async (request) => {
      const auth = await authenticate(request, env, pool);
      const recordId = parseOrThrow(idSchema, request.params.id);
      const existingRecord = await findDnsRecordById(pool, recordId);
      if (!existingRecord) throw new NotFoundError('DNS record not found');

      const zone = await findDnsZoneById(pool, existingRecord.zone_id);
      if (!zone || zone.user_id !== auth.userId) throw new NotFoundError('DNS record not found');

      const patch = parseOrThrow(patchRecordSchema, request.body);
      const updated = await updateDnsRecord(
        pool,
        recordId,
        await applyProviderPatch(zone, existingRecord, patch)
      );

      await auditRequest(pool, request, auth.userId, {
        action: 'DNS_RECORD_UPDATED',
        resourceType: 'dns_record',
        resourceId: recordId,
        metadata: { zoneId: existingRecord.zone_id, changes: Object.keys(patch) },
      });

      return { record: updated };
    });

    app.delete<{ Params: { id: string } }>(`${prefix}/dns/records/:id`, async (request, reply) => {
      const auth = await authenticate(request, env, pool);
      const recordId = parseOrThrow(idSchema, request.params.id);
      const existingRecord = await findDnsRecordById(pool, recordId);
      if (!existingRecord) throw new NotFoundError('DNS record not found');

      const zone = await findDnsZoneById(pool, existingRecord.zone_id);
      if (!zone || zone.user_id !== auth.userId) throw new NotFoundError('DNS record not found');

      await deleteProviderRecord(zone, existingRecord);
      await deleteDnsRecord(pool, recordId);
      await auditRequest(pool, request, auth.userId, {
        action: 'DNS_RECORD_DELETED',
        resourceType: 'dns_record',
        resourceId: recordId,
        metadata: { zoneId: existingRecord.zone_id, name: existingRecord.name, type: existingRecord.type },
      });

      reply.code(204);
      return null;
    });

    // --- Nested DNS Records Endpoints -----------------------------------------------------------

    app.get<{ Params: { id: string } }>(`${prefix}/dns/zones/:id/records`, async (request) => {
      const auth = await authenticate(request, env, pool);
      const id = parseOrThrow(idSchema, request.params.id);
      const zone = await findDnsZoneById(pool, id);
      if (!zone || zone.user_id !== auth.userId) throw new NotFoundError('DNS zone not found');

      const records = await listDnsRecordsForZone(pool, id);
      return { records };
    });

    app.post<{ Params: { id: string } }>(`${prefix}/dns/zones/:id/records`, async (request, reply) => {
      const auth = await authenticate(request, env, pool);
      const zoneId = parseOrThrow(idSchema, request.params.id);
      const zone = await findDnsZoneById(pool, zoneId);
      if (!zone || zone.user_id !== auth.userId) throw new NotFoundError('DNS zone not found');

      const input = parseOrThrow(createNestedRecordSchema, request.body);
      const providerRecordId = await createProviderRecord(zone, input);
      let record;
      try {
        record = await createDnsRecord(pool, {
          zoneId,
          name: input.name,
          type: input.type,
          content: input.content,
          ttl: input.ttl,
          priority: input.priority,
          proxied: input.proxied,
          providerRecordId,
        });
      } catch (error) {
        await rollbackProviderRecord(zone, providerRecordId);
        throw error;
      }

      await auditRequest(pool, request, auth.userId, {
        action: 'DNS_RECORD_CREATED',
        resourceType: 'dns_record',
        resourceId: record.id,
        metadata: { zoneId, name: record.name, type: record.type },
      });

      reply.code(201);
      return { record };
    });

    app.patch<{ Params: { id: string; recordId: string } }>(
      `${prefix}/dns/zones/:id/records/:recordId`,
      async (request) => {
        const auth = await authenticate(request, env, pool);
        const zoneId = parseOrThrow(idSchema, request.params.id);
        const recordId = parseOrThrow(idSchema, request.params.recordId);

        const zone = await findDnsZoneById(pool, zoneId);
        if (!zone || zone.user_id !== auth.userId) throw new NotFoundError('DNS zone not found');

        const existingRecord = await findDnsRecordById(pool, recordId);
        if (!existingRecord || existingRecord.zone_id !== zoneId) {
          throw new NotFoundError('DNS record not found in this zone');
        }

        const patch = parseOrThrow(patchRecordSchema, request.body);
        const updated = await updateDnsRecord(
          pool,
          recordId,
          await applyProviderPatch(zone, existingRecord, patch)
        );

        await auditRequest(pool, request, auth.userId, {
          action: 'DNS_RECORD_UPDATED',
          resourceType: 'dns_record',
          resourceId: recordId,
          metadata: { zoneId, changes: Object.keys(patch) },
        });

        return { record: updated };
      }
    );

    app.delete<{ Params: { id: string; recordId: string } }>(
      `${prefix}/dns/zones/:id/records/:recordId`,
      async (request, reply) => {
        const auth = await authenticate(request, env, pool);
        const zoneId = parseOrThrow(idSchema, request.params.id);
        const recordId = parseOrThrow(idSchema, request.params.recordId);

        const zone = await findDnsZoneById(pool, zoneId);
        if (!zone || zone.user_id !== auth.userId) throw new NotFoundError('DNS zone not found');

        const existingRecord = await findDnsRecordById(pool, recordId);
        if (!existingRecord || existingRecord.zone_id !== zoneId) {
          throw new NotFoundError('DNS record not found in this zone');
        }

        await deleteProviderRecord(zone, existingRecord);
        await deleteDnsRecord(pool, recordId);
        await auditRequest(pool, request, auth.userId, {
          action: 'DNS_RECORD_DELETED',
          resourceType: 'dns_record',
          resourceId: recordId,
          metadata: { zoneId, name: existingRecord.name, type: existingRecord.type },
        });

        reply.code(204);
        return null;
      }
    );
  };

  registerHandlers('/api/v1');
  registerHandlers('/api');
}
