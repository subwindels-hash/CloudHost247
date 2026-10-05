/**
 * DNS zones and records.
 *
 * Ported from cloudhost247-node/src/routes/dns.ts. Zones are owned by a customer; records belong to
 * a zone. Validation of record shapes happens here; actual propagation to a provider is an
 * integration concern (Cloudflare/Route53) that is deferred — records are stored as the source of
 * truth and marked for sync.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError, ForbiddenError, ValidationError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { authenticate } = require('../lib/auth');

const name = 'dns';

const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA'];

const zoneSchema = v.object({ domain: v.string().trim().toLowerCase().min(4).max(253) });

const recordSchema = v.object({
  zoneId: v.string().min(1),
  type: v.enum(RECORD_TYPES),
  name: v.string().trim().min(1).max(253),
  content: v.string().trim().min(1).max(1024),
  ttl: v.coerce.number().int().min(60).max(86400).default(3600),
  priority: v.coerce.number().int().min(0).max(65535).optional(),
});

async function requireZone(store, zoneId, userId) {
  const zone = await store.table('dns_zones').findById(zoneId);
  if (!zone) throw new NotFoundError('Zone not found');
  if (zone.user_id !== userId) throw new NotFoundError('Zone not found');
  return zone;
}

function register(router, deps) {
  const { store } = deps;

  router.get('/api/v1/dns/zones', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { rows, total } = await store.table('dns_zones').find({ user_id: auth.id }, { orderBy: 'domain' });
    ctx.json({ zones: rows.map((z) => ({ id: z.id, domain: z.domain, status: z.status })), total });
  });

  router.post('/api/v1/dns/zones', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(zoneSchema);

    const zone = await store.table('dns_zones').insert({
      id: uuidv7(),
      user_id: auth.id,
      domain: body.domain,
      status: 'active',
    });

    // Seed the standard NS/SOA placeholder records so the zone is usable immediately.
    for (const [type, content] of [['NS', 'ns1.cloudhost247.example'], ['NS', 'ns2.cloudhost247.example']]) {
      await store.table('dns_records').insert({
        id: uuidv7(), zone_id: zone.id, type, name: '@', content, ttl: 3600,
      });
    }

    ctx.code(201).json({ id: zone.id, domain: zone.domain });
  });

  router.get('/api/v1/dns/zones/:id/records', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const zone = await requireZone(store, ctx.params.id, auth.id);
    const { rows } = await store.table('dns_records').find({ zone_id: zone.id }, { orderBy: ['type', 'name'] });
    ctx.json({
      zone: { id: zone.id, domain: zone.domain },
      records: rows.map((r) => ({
        id: r.id, type: r.type, name: r.name, content: r.content, ttl: r.ttl, priority: r.priority,
      })),
    });
  });

  router.post('/api/v1/dns/records', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(recordSchema);
    await requireZone(store, body.zoneId, auth.id);

    if ((body.type === 'MX' || body.type === 'SRV') && body.priority === undefined) {
      throw new ValidationError(`${body.type} records require a priority`);
    }

    const record = await store.table('dns_records').insert({
      id: uuidv7(),
      zone_id: body.zoneId,
      type: body.type,
      name: body.name,
      content: body.content,
      ttl: body.ttl,
      priority: body.priority ?? null,
    });
    ctx.code(201).json({ id: record.id });
  });

  router.delete('/api/v1/dns/records/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const record = await store.table('dns_records').findById(ctx.params.id);
    if (!record) throw new NotFoundError('Record not found');
    await requireZone(store, record.zone_id, auth.id);
    await store.table('dns_records').deleteById(record.id);
    ctx.json({ ok: true });
  });
}

module.exports = { name, register };
