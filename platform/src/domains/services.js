/**
 * Customer services.
 *
 * Ported from cloudhost247-node/src/routes/services.ts. Customers read their own services; staff
 * create/update them (these are staff-entered, informational records per the original migrations).
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { authenticate, asStaff } = require('../lib/auth');

const name = 'services';

function publicService(row) {
  return {
    id: row.id,
    planId: row.plan_id,
    label: row.label,
    status: row.status,
    domain: row.domain,
    username: row.username,
    package: row.package,
    nextDueDate: row.next_due_date,
    createdAt: row.created_at,
  };
}

function register(router, deps) {
  const { store } = deps;

  router.get('/api/v1/services', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { rows, total } = await store.table('customer_services').find({ user_id: auth.id }, { orderBy: '-created_at' });
    ctx.json({ services: rows.map(publicService), total });
  });

  router.post('/api/v1/admin/services', async (ctx) => {
    await asStaff(ctx, deps);
    const body = await ctx.validate(v.object({
      userId: v.string().min(1),
      label: v.string().trim().max(120).optional(),
      domain: v.string().trim().max(253).optional(),
      package: v.string().trim().max(120).optional(),
      status: v.enum(['pending', 'active', 'suspended', 'terminated']).default('active'),
    }));

    const service = await store.table('customer_services').insert({
      id: uuidv7(),
      user_id: body.userId,
      label: body.label ?? null,
      domain: body.domain ?? null,
      package: body.package ?? null,
      status: body.status,
    });
    ctx.code(201).json({ service: publicService(service) });
  });

  router.patch('/api/v1/admin/services/:id', async (ctx) => {
    await asStaff(ctx, deps);
    const body = await ctx.validate(v.object({
      status: v.enum(['pending', 'active', 'suspended', 'terminated']).optional(),
      label: v.string().trim().max(120).optional(),
    }));

    const service = await store.table('customer_services').findById(ctx.params.id);
    if (!service) throw new NotFoundError('Service not found');

    const patch = {};
    if (body.status !== undefined) patch.status = body.status;
    if (body.label !== undefined) patch.label = body.label;
    const updated = await store.table('customer_services').updateById(service.id, patch);
    ctx.json({ service: publicService(updated) });
  });
}

module.exports = { name, register };
