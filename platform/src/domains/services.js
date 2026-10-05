/**
 * Customer services (spec §services).
 *
 * Ported from cloudhost247-node/src/routes/services.ts. These are staff-entered service records
 * (hosting/server/control-panel/license assignments) that customers can read. List/detail are
 * role-aware: staff see every service (with filters), customers see only their own. Mutations and
 * lifecycle actions (provision/suspend/unsuspend/terminate) are admin/staff gated and audited.
 *
 * Provisioning is queued, not performed synchronously: the provision action flips the record to
 * 'provisioning'; the actual server build is the deferred provisioning worker's job.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { authenticate, asAdmin, asStaff } = require('../lib/auth');

const name = 'services';

const STATUSES = ['active', 'pending', 'provisioning', 'suspended', 'cancelled', 'terminated', 'pending_migration', 'degraded'];
const BILLING_CYCLES = ['one_time', 'monthly', 'quarterly', 'semi_annually', 'annually'];
const isStaffRole = (role) => ['admin', 'super_admin', 'staff'].includes(role);

function register(router, deps) {
  const { store } = deps;

  async function audit(ctx, action, resourceId, metadata) {
    await store.table('audit_logs').insert({
      id: uuidv7(), actor_id: ctx.user.id, actor_role: ctx.user.role, action,
      entity_type: 'service', entity_id: resourceId ?? null,
      ip_address: ctx.ip, user_agent: ctx.userAgent, after: metadata ?? null,
    });
  }

  // Resolve the joined display names the DTO exposes (best-effort; null when unset).
  async function customerDto(row) {
    const product = row.product_id ? await store.table('catalog_products').findById(row.product_id) : null;
    const plan = row.plan_id ? await store.table('catalog_product_plans').findById(row.plan_id) : null;
    const server = row.server_id ? await store.table('servers').findById(row.server_id) : null;
    const panel = row.control_panel_id ? await store.table('control_panels').findById(row.control_panel_id) : null;
    const license = row.license_id ? await store.table('licenses').findById(row.license_id) : null;
    return {
      id: row.id, label: row.label ?? null, status: row.status,
      productSlug: product?.slug ?? null, productName: product?.name ?? null,
      planSlug: plan?.slug ?? null, planName: plan?.name ?? null,
      serverId: row.server_id ?? null, serverName: server?.name ?? null, serverIp: null, serverStatus: server?.status ?? null,
      controlPanelId: row.control_panel_id ?? null, panelName: panel?.name ?? null, panelSlug: panel?.slug ?? null,
      licenseId: row.license_id ?? null, licenseStatus: license?.status ?? null,
      domain: row.domain ?? null, hostname: row.hostname ?? null, username: row.username ?? null,
      billingCycle: row.billing_cycle ?? 'monthly', amount: row.amount ?? 0, currency: row.currency ?? 'USD',
      nextDueDate: row.next_due_date ?? null, suspensionDate: row.suspension_date ?? null, terminationDate: row.termination_date ?? null,
      externalReference: row.external_reference ?? null, createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }
  async function adminDto(row) {
    const base = await customerDto(row);
    const customer = await store.table('users').findById(row.customer_id ?? row.user_id);
    return { ...base, userId: row.user_id, customerId: row.customer_id ?? row.user_id, notes: row.notes ?? null, createdBy: row.created_by ?? null, customerEmail: customer?.email ?? null, customerName: customer?.full_name ?? null };
  }

  const createServiceSchema = () => v.object({
    customerId: v.string().min(1),
    productId: v.string().nullable().optional(),
    planId: v.string().nullable().optional(),
    serverId: v.string().nullable().optional(),
    controlPanelId: v.string().nullable().optional(),
    licenseId: v.string().nullable().optional(),
    domain: v.string().max(255).nullable().optional(),
    hostname: v.string().max(255).nullable().optional(),
    username: v.string().max(64).nullable().optional(),
    label: v.string().min(1).max(255),
    status: v.enum(STATUSES).optional(),
    billingCycle: v.enum(BILLING_CYCLES).optional(),
    amount: v.coerce.number().min(0).max(100000).optional(),
    currency: v.string().length(3).optional(),
    nextDueDate: v.string().nullable().optional(),
    notes: v.string().max(2000).nullable().optional(),
    externalReference: v.string().max(255).nullable().optional(),
  });

  // ------------------------------------------------------------------- list
  router.get('/api/v1/services', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    if (isStaffRole(auth.role)) {
      const query = await ctx.validateQuery(v.object({ status: v.string().optional(), search: v.string().optional(), serverId: v.string().optional(), panelId: v.string().optional() }));
      let rows = await store.table('customer_services').find({}, { orderBy: '-created_at' }).then((r) => r.rows);
      if (query.status) rows = rows.filter((s) => s.status === query.status);
      if (query.serverId) rows = rows.filter((s) => s.server_id === query.serverId);
      if (query.panelId) rows = rows.filter((s) => s.control_panel_id === query.panelId);
      if (query.search) {
        const q = query.search.toLowerCase();
        rows = rows.filter((s) => [s.label, s.domain, s.hostname, s.username].some((f) => String(f ?? '').toLowerCase().includes(q)));
      }
      const out = [];
      for (const s of rows) out.push(await adminDto(s));
      return ctx.json({ services: out });
    }
    const rows = (await store.table('customer_services').all()).filter((s) => s.user_id === auth.id || s.customer_id === auth.id);
    const out = [];
    for (const s of rows) out.push(await customerDto(s));
    ctx.json({ services: out });
  });

  // ----------------------------------------------------------------- detail
  router.get('/api/v1/services/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const service = await store.table('customer_services').findById(ctx.params.id);
    const staff = isStaffRole(auth.role);
    if (!service || (!staff && service.user_id !== auth.id && service.customer_id !== auth.id)) throw new NotFoundError('Service not found');
    ctx.json({ service: staff ? await adminDto(service) : await customerDto(service) });
  });

  // ----------------------------------------------------------------- create
  router.post('/api/v1/services', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const input = await ctx.validate(createServiceSchema());
    const service = await store.table('customer_services').insert({
      id: uuidv7(), user_id: input.customerId, customer_id: input.customerId, product_id: input.productId ?? null,
      plan_id: input.planId ?? null, server_id: input.serverId ?? null, control_panel_id: input.controlPanelId ?? null,
      license_id: input.licenseId ?? null, domain: input.domain ?? null, hostname: input.hostname ?? null,
      username: input.username ?? null, label: input.label, status: input.status ?? 'active',
      billing_cycle: input.billingCycle ?? 'monthly', amount: input.amount ?? 0, currency: input.currency ?? 'USD',
      next_due_date: input.nextDueDate ?? null, notes: input.notes ?? null, external_reference: input.externalReference ?? null,
      created_by: auth.id,
    });
    await audit(ctx, 'SERVICE_CREATED', service.id, { customerId: input.customerId, label: input.label });
    ctx.code(201).json({ service: await adminDto(service) });
  });

  // ----------------------------------------------------------------- update
  router.patch('/api/v1/services/:id', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const id = ctx.params.id;
    const input = await ctx.validate(createServiceSchema().omit(['customerId']).partial());
    const existing = await store.table('customer_services').findById(id);
    if (!existing) throw new NotFoundError('Service not found');
    const fields = {};
    const map = { label: 'label', status: 'status', domain: 'domain', hostname: 'hostname', username: 'username', serverId: 'server_id', controlPanelId: 'control_panel_id', licenseId: 'license_id', billingCycle: 'billing_cycle', amount: 'amount', currency: 'currency', nextDueDate: 'next_due_date', suspensionDate: 'suspension_date', terminationDate: 'termination_date', notes: 'notes', externalReference: 'external_reference' };
    for (const [k, col] of Object.entries(map)) if (input[k] !== undefined) fields[col] = input[k];
    const updated = await store.table('customer_services').updateById(id, fields);
    await audit(ctx, 'SERVICE_UPDATED', id, { changes: Object.keys(input) });
    ctx.json({ service: await adminDto(updated) });
  });

  // -------------------------------------------------------------- provision
  router.post('/api/v1/services/:id/provision', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const id = ctx.params.id;
    const service = await store.table('customer_services').findById(id);
    if (!service) throw new NotFoundError('Service not found');
    const updated = await store.table('customer_services').updateById(id, { status: 'provisioning' });
    await audit(ctx, 'SERVICE_PROVISION_QUEUED', id, { serverId: service.server_id, panelId: service.control_panel_id });
    ctx.json({ service: await adminDto(updated), message: 'Provisioning initiated' });
  });

  // ---------------------------------------------------------------- suspend
  router.post('/api/v1/services/:id/suspend', async (ctx) => {
    const auth = await asStaff(ctx, deps);
    const id = ctx.params.id;
    const service = await store.table('customer_services').findById(id);
    if (!service) throw new NotFoundError('Service not found');
    const suspended = await store.table('customer_services').updateById(id, { status: 'suspended', suspension_date: new Date().toISOString() });
    await audit(ctx, 'SERVICE_SUSPENDED', id, null);
    ctx.json({ service: await adminDto(suspended) });
  });

  // -------------------------------------------------------------- unsuspend
  router.post('/api/v1/services/:id/unsuspend', async (ctx) => {
    const auth = await asStaff(ctx, deps);
    const id = ctx.params.id;
    const service = await store.table('customer_services').findById(id);
    if (!service) throw new NotFoundError('Service not found');
    const reactivated = await store.table('customer_services').updateById(id, { status: 'active', suspension_date: null });
    await audit(ctx, 'SERVICE_UNSUSPENDED', id, null);
    ctx.json({ service: await adminDto(reactivated) });
  });

  // --------------------------------------------------------------- terminate
  router.post('/api/v1/services/:id/terminate', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const id = ctx.params.id;
    const service = await store.table('customer_services').findById(id);
    if (!service) throw new NotFoundError('Service not found');
    const terminated = await store.table('customer_services').updateById(id, { status: 'terminated', termination_date: new Date().toISOString(), terminated_at: new Date().toISOString() });
    await audit(ctx, 'SERVICE_TERMINATED', id, null);
    ctx.json({ service: await adminDto(terminated) });
  });
}

module.exports = { name, register };
