/**
 * Firewall rules.
 *
 * Ported from cloudhost247-node/src/routes/firewall.ts. Rules are stored per customer/server;
 * enforcement on the actual host is an infrastructure-adapter concern that is deferred, so rules
 * are the declared source of truth here. Dangerous open-everything rules are refused.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError, ValidationError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { authenticate } = require('../lib/auth');

const name = 'firewall';

const ruleSchema = v.object({
  direction: v.enum(['in', 'out']).default('in'),
  action: v.enum(['allow', 'deny']).default('allow'),
  protocol: v.enum(['tcp', 'udp', 'icmp', 'any']).default('tcp'),
  port: v.coerce.number().int().min(1).max(65535).optional(),
  cidr: v.string().regex(/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/, 'cidr must look like 203.0.113.0/24').optional(),
  description: v.string().trim().max(200).optional(),
  serverId: v.string().optional(),
});

function publicRule(row) {
  return {
    id: row.id,
    direction: row.direction,
    action: row.action,
    protocol: row.protocol,
    port: row.port,
    cidr: row.cidr,
    description: row.description,
    enabled: row.enabled,
  };
}

function register(router, deps) {
  const { store } = deps;

  router.get('/api/v1/firewall/rules', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { rows, total } = await store.table('firewall_rules').find({ user_id: auth.id }, { orderBy: '-created_at' });
    ctx.json({ rules: rows.map(publicRule), total });
  });

  router.post('/api/v1/firewall/rules', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(ruleSchema);

    // Refuse "allow any from anywhere" on all ports — a footgun, not a rule.
    if (body.action === 'allow' && body.protocol === 'any' && !body.port && !body.cidr) {
      throw new ValidationError('Refusing an allow-any rule with no port or source restriction');
    }

    const rule = await store.table('firewall_rules').insert({
      id: uuidv7(),
      user_id: auth.id,
      server_id: body.serverId ?? null,
      direction: body.direction,
      action: body.action,
      protocol: body.protocol,
      port: body.port ?? null,
      cidr: body.cidr ?? null,
      description: body.description ?? null,
    });
    ctx.code(201).json({ rule: publicRule(rule) });
  });

  router.patch('/api/v1/firewall/rules/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const rule = await store.table('firewall_rules').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!rule) throw new NotFoundError('Rule not found');

    const body = await ctx.validate(v.object({ enabled: v.boolean() }));
    const updated = await store.table('firewall_rules').updateById(rule.id, { enabled: body.enabled });
    ctx.json({ rule: publicRule(updated) });
  });

  router.delete('/api/v1/firewall/rules/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const rule = await store.table('firewall_rules').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!rule) throw new NotFoundError('Rule not found');
    await store.table('firewall_rules').deleteById(rule.id);
    ctx.json({ ok: true });
  });
}

module.exports = { name, register };
