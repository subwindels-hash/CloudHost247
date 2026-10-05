/**
 * Control panels (cPanel, Plesk, DirectAdmin, …).
 *
 * Ported from cloudhost247-node/src/routes/control-panels.ts. Panel definitions are admin-managed
 * in control_panels; customers install one per hosting plan via control_panel_plans.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { authenticate, asStaff, asAdmin } = require('../lib/auth');

const name = 'control-panels';

function publicPanel(row) {
  return {
    id: row.id, name: row.name, slug: row.slug, description: row.description,
    version: row.version, priceCents: row.price_cents, active: row.active,
  };
}

function register(router, deps) {
  const { store } = deps;

  router.get('/api/v1/control-panels', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { rows, total } = await store.table('control_panel_plans').find({ user_id: auth.id }, { orderBy: '-created_at' });
    ctx.json({ panels: rows, total });
  });

  router.post('/api/v1/control-panels', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(v.object({ panelId: v.string().min(1), hostingPlanId: v.string().optional() }));

    const panel = await store.table('control_panels').findById(body.panelId);
    if (!panel || !panel.active) throw new NotFoundError('Control panel not found');

    const existing = await store.table('control_panel_plans').findOne({ user_id: auth.id, panel_id: panel.id });
    if (existing) return ctx.json({ idempotent: true, panel: existing });

    const installed = await store.table('control_panel_plans').insert({
      id: uuidv7(), user_id: auth.id, panel_id: panel.id, hosting_plan_id: body.hostingPlanId ?? null,
    });
    ctx.code(201).json({ panel: installed });
  });

  router.get('/api/v1/admin/control-panels', async (ctx) => {
    await asAdmin(ctx, deps);
    const rows = await store.table('control_panels').all();
    ctx.json({ panels: rows.map(publicPanel) });
  });

  router.put('/api/v1/admin/control-panels/:id', async (ctx) => {
    await asStaff(ctx, deps);
    const body = await ctx.validate(v.object({
      name: v.string().trim().max(120).optional(),
      version: v.string().trim().max(40).optional(),
      priceCents: v.coerce.number().int().min(0).optional(),
      active: v.boolean().optional(),
      description: v.string().trim().max(1000).optional(),
    }));

    const panel = await store.table('control_panels').findById(ctx.params.id);
    if (!panel) throw new NotFoundError('Control panel not found');

    const patch = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.version !== undefined) patch.version = body.version;
    if (body.priceCents !== undefined) patch.price_cents = body.priceCents;
    if (body.active !== undefined) patch.active = body.active;
    if (body.description !== undefined) patch.description = body.description;
    const updated = await store.table('control_panels').updateById(panel.id, patch);
    ctx.json({ panel: publicPanel(updated) });
  });

  router.delete('/api/v1/admin/control-panels/:id', async (ctx) => {
    await asAdmin(ctx, deps);
    await store.table('control_panels').deleteById(ctx.params.id);
    ctx.json({ ok: true });
  });
}

module.exports = { name, register };
