/**
 * Admin customer directory and support queue.
 *
 * Ported from cloudhost247-node/src/routes/admin-customers.ts. Status/role changes live in
 * admin-users (super_admin); this module is the staff view: a searchable customer directory and
 * the global ticket queue with staff replies.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { asStaff, asSuperAdmin } = require('../lib/auth');
const { publicUser } = require('./auth');

const name = 'admin-customers';

function register(router, deps) {
  const { store } = deps;

  router.get('/api/v1/admin/customers', async (ctx) => {
    await asStaff(ctx, deps);
    const limit = Math.min(Number(ctx.query.limit) || 50, 200);
    const offset = Number(ctx.query.offset) || 0;

    const search = (ctx.query.search ?? '').trim().toLowerCase();
    const predicate = (row) => {
      if (row.deleted_at) return false;
      if (!search) return true;
      return (
        String(row.email ?? '').toLowerCase().includes(search)
        || String(row.full_name ?? '').toLowerCase().includes(search)
        || String(row.customer_id ?? '') === search
      );
    };

    const { rows, total } = await store.table('users').find(predicate, { orderBy: '-created_at', limit, offset });
    ctx.json({ customers: rows.map(publicUser), total });
  });

  router.get('/api/v1/admin/customers/:id', async (ctx) => {
    await asStaff(ctx, deps);
    const user = await store.table('users').findById(ctx.params.id);
    if (!user) throw new NotFoundError('Customer not found');

    const [services, invoices, tickets] = await Promise.all([
      store.table('customer_services').find({ user_id: user.id }),
      store.table('invoices').find({ user_id: user.id }, { orderBy: '-created_at', limit: 20 }),
      store.table('support_tickets').find({ user_id: user.id }, { orderBy: '-created_at', limit: 20 }),
    ]);

    ctx.json({
      customer: publicUser(user),
      services: services.rows.map((s) => ({ id: s.id, label: s.label, status: s.status })),
      invoices: invoices.rows.map((i) => ({ id: i.id, number: i.number, status: i.status, total: i.total })),
      tickets: tickets.rows.map((t) => ({ id: t.id, subject: t.subject, status: t.status })),
    });
  });

  router.post('/api/v1/admin/customers/:id/suspend', async (ctx) => {
    await asSuperAdmin(ctx, deps);
    const user = await store.table('users').findById(ctx.params.id);
    if (!user) throw new NotFoundError('Customer not found');

    await store.table('users').updateById(user.id, { status: 'suspended' });
    await store.table('auth_audit_log').insert({
      id: uuidv7(), user_id: user.id, event_type: 'admin_status_change',
      ip_address: ctx.ip, user_agent: ctx.userAgent, metadata: { to: 'suspended', by: ctx.user.id },
    });
    ctx.json({ ok: true });
  });

  router.post('/api/v1/admin/customers/:id/reactivate', async (ctx) => {
    await asSuperAdmin(ctx, deps);
    const user = await store.table('users').findById(ctx.params.id);
    if (!user) throw new NotFoundError('Customer not found');

    await store.table('users').updateById(user.id, { status: 'active', deleted_at: null, deleted_by: null });
    await store.table('auth_audit_log').insert({
      id: uuidv7(), user_id: user.id, event_type: 'admin_status_change',
      ip_address: ctx.ip, user_agent: ctx.userAgent, metadata: { to: 'active', by: ctx.user.id },
    });
    ctx.json({ ok: true });
  });

  router.get('/api/v1/admin/tickets', async (ctx) => {
    await asStaff(ctx, deps);
    const status = ctx.query.status;
    const predicate = status ? { status } : {};
    const { rows, total } = await store.table('support_tickets').find(predicate, { orderBy: '-created_at', limit: 200 });
    ctx.json({
      tickets: rows.map((t) => ({
        id: t.id, reference: t.reference, userId: t.user_id, subject: t.subject,
        department: t.department, priority: t.priority, status: t.status, createdAt: t.created_at,
      })),
      total,
    });
  });

  router.post('/api/v1/admin/tickets/:id/reply', async (ctx) => {
    const auth = await asStaff(ctx, deps);
    const body = await ctx.validate(v.object({ body: v.string().trim().min(1).max(20000), internal: v.boolean().default(false) }));

    const ticket = await store.table('support_tickets').findById(ctx.params.id);
    if (!ticket) throw new NotFoundError('Ticket not found');

    const message = await store.table('support_ticket_messages').insert({
      id: uuidv7(),
      ticket_id: ticket.id,
      author_id: auth.id,
      author_role: 'staff',
      body: body.body,
      is_internal: body.internal,
    });

    await store.table('support_tickets').updateById(ticket.id, {
      status: body.internal ? ticket.status : 'answered',
      last_reply_at: new Date().toISOString(),
    });

    ctx.code(201).json({ id: message.id });
  });
}

module.exports = { name, register };
