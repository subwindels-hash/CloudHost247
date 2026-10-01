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

const idSchema = z.string().uuid();
const domainSchema = z
  .string()
  .min(3)
  .max(253)
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i, 'Invalid domain name');

const recordTypeSchema = z.enum(['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'SRV', 'CAA', 'PTR', 'SOA']);

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

export async function registerDnsRoutes(
  app: FastifyInstance,
  env: Env,
  overridePool?: Queryable
) {
  const pool = overridePool ?? getPool(env);

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
          provider: z.string().optional(),
        }),
        request.body
      );

      const existing = await findDnsZoneByDomain(pool, input.domainName);
      if (existing) {
        throw new ConflictError('A DNS zone for that domain already exists');
      }

      const zone = await createDnsZone(pool, {
        userId: auth.userId,
        domainName: input.domainName.toLowerCase(),
        provider: input.provider,
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

      const record = await createDnsRecord(pool, {
        zoneId: input.zoneId,
        name: input.name,
        type: input.type,
        content: input.content,
        ttl: input.ttl,
        priority: input.priority,
        proxied: input.proxied,
      });

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
      const updated = await updateDnsRecord(pool, recordId, patch);

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
      const record = await createDnsRecord(pool, {
        zoneId,
        name: input.name,
        type: input.type,
        content: input.content,
        ttl: input.ttl,
        priority: input.priority,
        proxied: input.proxied,
      });

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
        const updated = await updateDnsRecord(pool, recordId, patch);

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
