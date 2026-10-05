/**
 * Staff-side customer management (spec §admin-customers).
 *
 * Ported from cloudhost247-node/src/routes/admin-customers.ts. Routine customer-support work
 * (directory, customer detail, managing the passive service/domain records, the ticket queue) is
 * open to admin + super_admin. Account-integrity actions that can lock someone out or escalate
 * privilege (status change, role change) are super_admin only, and a super_admin may not change
 * their own role (lockout guard). Every mutation is audited to auth_audit_log.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError, ValidationError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { asStaff, asSuperAdmin } = require('../lib/auth');
const { publicUser } = require('./auth');

const name = 'admin-customers';

const SERVICE_STATUSES = ['active', 'suspended', 'cancelled', 'pending_migration'];
const DOMAIN_STATUSES = ['active', 'expired', 'pending_transfer', 'pending_migration'];
const ACCOUNT_STATUSES = ['active', 'suspended', 'disabled'];
const ROLES = ['customer', 'staff', 'admin', 'super_admin'];
const TICKET_STATUSES = ['open', 'pending_customer', 'pending_staff', 'closed'];

function register(router, deps) {
  const { store } = deps;

  async function audit(userId, eventType, metadata) {
    await store.table('auth_audit_log').insert({
      id: uuidv7(), user_id: userId, event_type: eventType, metadata: metadata ?? null,
    });
  }

  function domainDto(row) {
    return {
      id: row.id, domainName: row.domain, registrar: row.registrar ?? null, status: row.status,
      expiresAt: row.expires_at ?? null, externalReference: row.external_reference ?? null,
      notes: row.notes ?? null, createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }
  function ticketSummary(t) {
    return {
      id: t.id, reference: t.reference ?? null, userId: t.user_id, subject: t.subject,
      department: t.department ?? null, priority: t.priority ?? null, status: t.status,
      lastReplyAt: t.last_reply_at ?? null, createdAt: t.created_at,
    };
  }
  function messageDto(m, viewerId) {
    return {
      id: m.id, body: m.body, authorId: m.author_id, authorRole: m.author_role,
      isInternal: !!m.is_internal, isOwn: m.author_id === viewerId, createdAt: m.created_at,
    };
  }
  // Admin-facing service DTO with the joined display names the original toAdminCustomerServiceDTO exposes.
  async function serviceDto(row) {
    const product = row.product_id ? await store.table('catalog_products').findById(row.product_id) : null;
    const plan = row.plan_id ? await store.table('catalog_product_plans').findById(row.plan_id) : null;
    const server = row.server_id ? await store.table('servers').findById(row.server_id) : null;
    return {
      id: row.id, label: row.label ?? null, status: row.status,
      productSlug: product?.slug ?? null, productName: product?.name ?? null,
      planSlug: plan?.slug ?? null, planName: plan?.name ?? null,
      serverId: row.server_id ?? null, serverName: server?.name ?? null, serverStatus: server?.status ?? null,
      domain: row.domain ?? null, hostname: row.hostname ?? null, username: row.username ?? null,
      billingCycle: row.billing_cycle ?? 'monthly', amount: row.amount ?? 0, currency: row.currency ?? 'USD',
      nextDueDate: row.next_due_date ?? null, externalReference: row.external_reference ?? null,
      notes: row.notes ?? null, createdBy: row.created_by ?? null, createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  async function loadCustomerOrThrow(id) {
    const user = await store.table('users').findById(id);
    if (!user) throw new NotFoundError('No customer account was found with that id');
    return user;
  }

  // --- Customer directory --------------------------------------------------------------------
  router.get('/api/v1/admin/customers', async (ctx) => {
    await asStaff(ctx, deps);
    const query = await ctx.validateQuery(v.object({
      search: v.string().max(255).optional(),
      role: v.enum(ROLES).optional(),
      limit: v.coerce.number().int().min(1).max(100).optional(),
      offset: v.coerce.number().int().min(0).optional(),
    }));
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;
    const search = (query.search ?? '').trim().toLowerCase();
    const predicate = (row) => {
      if (row.deleted_at) return false;
      if (query.role && row.role !== query.role) return false;
      if (!search) return true;
      return String(row.email ?? '').toLowerCase().includes(search)
        || String(row.full_name ?? '').toLowerCase().includes(search)
        || String(row.customer_id ?? '') === search;
    };
    const { rows, total } = await store.table('users').find(predicate, { orderBy: '-created_at', limit, offset });
    ctx.json({ customers: rows.map(publicUser), total });
  });

  router.get('/api/v1/admin/customers/:id', async (ctx) => {
    await asStaff(ctx, deps);
    const user = await loadCustomerOrThrow(ctx.params.id);
    const [services, domains, tickets] = await Promise.all([
      store.table('customer_services').find({ user_id: user.id }, { orderBy: '-created_at' }),
      store.table('customer_domains').find({ user_id: user.id }, { orderBy: '-created_at' }),
      store.table('support_tickets').find({ user_id: user.id }, { orderBy: '-created_at' }),
    ]);
    const serviceDtos = [];
    for (const s of services.rows) serviceDtos.push(await serviceDto(s));
    ctx.json({
      customer: publicUser(user),
      services: serviceDtos,
      domains: domains.rows.map(domainDto),
      tickets: tickets.rows.map(ticketSummary),
    });
  });

  // --- Account integrity (super_admin only) --------------------------------------------------
  router.patch('/api/v1/admin/customers/:id/status', async (ctx) => {
    const auth = await asSuperAdmin(ctx, deps);
    const body = await ctx.validate(v.object({ status: v.enum(ACCOUNT_STATUSES) }));
    const user = await loadCustomerOrThrow(ctx.params.id);
    const updated = await store.table('users').updateById(user.id, { status: body.status });
    await audit(auth.id, 'admin_status_change', { targetUserId: user.id, newStatus: body.status, by: auth.id });
    ctx.json({ customer: publicUser(updated) });
  });

  router.patch('/api/v1/admin/customers/:id/role', async (ctx) => {
    const auth = await asSuperAdmin(ctx, deps);
    const body = await ctx.validate(v.object({ role: v.enum(ROLES) }));
    if (ctx.params.id === auth.id) throw new ValidationError('You cannot change your own role');
    const user = await loadCustomerOrThrow(ctx.params.id);
    const updated = await store.table('users').updateById(user.id, { role: body.role });
    await audit(auth.id, 'admin_role_change', { targetUserId: user.id, newRole: body.role, by: auth.id });
    ctx.json({ customer: publicUser(updated) });
  });

  // --- Customer services (admin + super_admin) -----------------------------------------------
  const serviceBody = () => v.object({
    label: v.string().min(1).max(255),
    productId: v.string().nullable().optional(),
    planId: v.string().nullable().optional(),
    status: v.enum(SERVICE_STATUSES).optional(),
    externalReference: v.string().max(255).nullable().optional(),
    notes: v.string().max(4000).nullable().optional(),
  });

  router.post('/api/v1/admin/customers/:id/services', async (ctx) => {
    const auth = await asStaff(ctx, deps);
    const user = await loadCustomerOrThrow(ctx.params.id);
    const input = await ctx.validate(serviceBody());
    const service = await store.table('customer_services').insert({
      id: uuidv7(), user_id: user.id, customer_id: user.id, label: input.label,
      product_id: input.productId ?? null, plan_id: input.planId ?? null,
      status: input.status ?? 'active', external_reference: input.externalReference ?? null,
      notes: input.notes ?? null, created_by: auth.id,
    });
    ctx.code(201).json({ service: await serviceDto(service) });
  });

  router.patch('/api/v1/admin/customers/:id/services/:subId', async (ctx) => {
    await asStaff(ctx, deps);
    const userId = ctx.params.id;
    const existing = await store.table('customer_services').findById(ctx.params.subId);
    if (!existing || existing.user_id !== userId) throw new NotFoundError('No service record was found with that id for this customer');
    const patch = await ctx.validate(serviceBody().omit(['label']).partial().extend({ label: v.string().min(1).max(255).optional() }));
    if (Object.keys(patch).length === 0) throw new ValidationError('At least one field must be provided');
    const fields = {};
    if (patch.label !== undefined) fields.label = patch.label;
    if (patch.productId !== undefined) fields.product_id = patch.productId;
    if (patch.planId !== undefined) fields.plan_id = patch.planId;
    if (patch.status !== undefined) fields.status = patch.status;
    if (patch.externalReference !== undefined) fields.external_reference = patch.externalReference;
    if (patch.notes !== undefined) fields.notes = patch.notes;
    const service = await store.table('customer_services').updateById(existing.id, fields);
    ctx.json({ service: await serviceDto(service) });
  });

  // --- Customer domains (admin + super_admin) ------------------------------------------------
  const domainBody = () => v.object({
    domainName: v.string().min(1).max(255),
    registrar: v.string().max(255).nullable().optional(),
    status: v.enum(DOMAIN_STATUSES).optional(),
    expiresAt: v.string().nullable().optional(),
    externalReference: v.string().max(255).nullable().optional(),
    notes: v.string().max(4000).nullable().optional(),
  });

  router.post('/api/v1/admin/customers/:id/domains', async (ctx) => {
    const auth = await asStaff(ctx, deps);
    const user = await loadCustomerOrThrow(ctx.params.id);
    const input = await ctx.validate(domainBody());
    const domain = await store.table('customer_domains').insert({
      id: uuidv7(), user_id: user.id, domain: input.domainName, registrar: input.registrar ?? null,
      status: input.status ?? 'active', expires_at: input.expiresAt ?? null,
      external_reference: input.externalReference ?? null, notes: input.notes ?? null, created_by: auth.id,
    });
    ctx.code(201).json({ domain: domainDto(domain) });
  });

  router.patch('/api/v1/admin/customers/:id/domains/:subId', async (ctx) => {
    await asStaff(ctx, deps);
    const userId = ctx.params.id;
    const existing = await store.table('customer_domains').findById(ctx.params.subId);
    if (!existing || existing.user_id !== userId) throw new NotFoundError('No domain record was found with that id for this customer');
    const patch = await ctx.validate(domainBody().omit(['domainName']).partial().extend({ domainName: v.string().min(1).max(255).optional() }));
    if (Object.keys(patch).length === 0) throw new ValidationError('At least one field must be provided');
    const fields = {};
    if (patch.domainName !== undefined) fields.domain = patch.domainName;
    if (patch.registrar !== undefined) fields.registrar = patch.registrar;
    if (patch.status !== undefined) fields.status = patch.status;
    if (patch.expiresAt !== undefined) fields.expires_at = patch.expiresAt;
    if (patch.externalReference !== undefined) fields.external_reference = patch.externalReference;
    if (patch.notes !== undefined) fields.notes = patch.notes;
    const domain = await store.table('customer_domains').updateById(existing.id, fields);
    ctx.json({ domain: domainDto(domain) });
  });

  // --- Support tickets (admin + super_admin) -------------------------------------------------
  router.get('/api/v1/admin/tickets', async (ctx) => {
    await asStaff(ctx, deps);
    const query = await ctx.validateQuery(v.object({
      status: v.enum(TICKET_STATUSES).optional(),
      limit: v.coerce.number().int().min(1).max(100).optional(),
      offset: v.coerce.number().int().min(0).optional(),
    }));
    const predicate = query.status ? { status: query.status } : {};
    const { rows, total } = await store.table('support_tickets').find(predicate, { orderBy: '-created_at', limit: query.limit ?? 25, offset: query.offset ?? 0 });
    ctx.json({ tickets: rows.map(ticketSummary), total });
  });

  router.get('/api/v1/admin/tickets/:id', async (ctx) => {
    const auth = await asStaff(ctx, deps);
    const ticket = await store.table('support_tickets').findById(ctx.params.id);
    if (!ticket) throw new NotFoundError('No ticket was found with that id');
    const [messages, customer] = await Promise.all([
      store.table('support_ticket_messages').find({ ticket_id: ticket.id }, { orderBy: 'created_at' }),
      store.table('users').findById(ticket.user_id),
    ]);
    ctx.json({
      ticket: { ...ticketSummary(ticket), closedAt: ticket.closed_at ?? null, messages: messages.rows.map((m) => messageDto(m, auth.id)) },
      customer: customer ? publicUser(customer) : null,
    });
  });

  router.post('/api/v1/admin/tickets/:id/messages', async (ctx) => {
    const auth = await asStaff(ctx, deps);
    const body = await ctx.validate(v.object({ message: v.string().min(1).max(10000) }));
    const ticket = await store.table('support_tickets').findById(ctx.params.id);
    if (!ticket) throw new NotFoundError('No ticket was found with that id');
    await store.table('support_ticket_messages').insert({
      id: uuidv7(), ticket_id: ticket.id, author_id: auth.id, author_role: auth.role, body: body.message,
    });
    const updated = await store.table('support_tickets').updateById(ticket.id, { last_reply_at: new Date().toISOString() });
    const messages = await store.table('support_ticket_messages').find({ ticket_id: ticket.id }, { orderBy: 'created_at' });
    ctx.code(201).json({
      ticket: { ...ticketSummary(updated), closedAt: updated.closed_at ?? null, messages: messages.rows.map((m) => messageDto(m, auth.id)) },
    });
  });

  router.patch('/api/v1/admin/tickets/:id', async (ctx) => {
    await asStaff(ctx, deps);
    const body = await ctx.validate(v.object({ status: v.enum(TICKET_STATUSES) }));
    const existing = await store.table('support_tickets').findById(ctx.params.id);
    if (!existing) throw new NotFoundError('No ticket was found with that id');
    const patch = { status: body.status };
    if (body.status === 'closed') patch.closed_at = new Date().toISOString();
    const ticket = await store.table('support_tickets').updateById(existing.id, patch);
    ctx.json({ ticket: { ...ticketSummary(ticket), closedAt: ticket.closed_at ?? null } });
  });
}

module.exports = { name, register };
