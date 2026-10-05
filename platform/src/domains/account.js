/**
 * Self-service account: profile, services, domains, support tickets.
 *
 * Ported from cloudhost247-node/src/routes/account.ts.
 *
 * Two invariants carried over verbatim:
 *
 *  1. Every query is filtered by the authenticated caller's own id. A record that exists but
 *     belongs to someone else is indistinguishable from one that does not exist — both are 404,
 *     never 403. This API never confirms or denies another customer's data.
 *
 *  2. An administrator acting inside a customer account via support mode must never be able to
 *     perform identity-changing actions (password change, email change, security number). These
 *     are refused and audited, not silently ignored.
 *
 * customer_services and customer_domains are read-only here: customers can view staff-entered
 * records but cannot create or edit them.
 */
'use strict';

const { v } = require('../core/validate');
const {
  NotFoundError, ForbiddenError, ValidationError,
} = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { authenticate } = require('../lib/auth');
const { publicUser } = require('./auth');

const name = 'account';

const profileSchema = v.object({
  fullName: v.string().trim().min(1).max(120).optional(),
  phone: v.string().trim().max(40).nullish(),
  addressLine1: v.string().trim().max(200).nullish(),
  city: v.string().trim().max(100).nullish(),
  state: v.string().trim().max(100).nullish(),
  postalCode: v.string().trim().max(20).nullish(),
  country: v.string().trim().max(2).nullish(),
});

const ticketSchema = v.object({
  subject: v.string().trim().min(3).max(200),
  body: v.string().trim().min(1).max(20000),
  department: v.enum(['general', 'billing', 'technical', 'abuse', 'domain']).default('general'),
  priority: v.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
});

async function audit(deps, event) {
  await deps.store.table('auth_audit_log').insert({
    id: uuidv7(),
    user_id: event.userId,
    event_type: event.eventType,
    ip_address: event.ipAddress ?? null,
    user_agent: event.userAgent ?? null,
    metadata: event.metadata ?? {},
  });
}

/**
 * Refuse identity-changing actions while an admin is acting inside this account (support mode).
 * A support session grants the ability to look and act as the customer for their problem; it must
 * never grant account takeover.
 */
function guardSupportMode(ctx, action) {
  if (ctx.user?.supportSessionId) {
    throw new ForbiddenError(`This action is not available while support is signed in as you (${action})`);
  }
}

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
    provisionedAt: row.provisioned_at,
    createdAt: row.created_at,
  };
}

function publicDomain(row) {
  return {
    id: row.id,
    domain: row.domain,
    registrar: row.registrar,
    status: row.status,
    registeredAt: row.registered_at,
    expiresAt: row.expires_at,
    autoRenew: row.auto_renew,
    nameservers: row.nameservers ?? [],
  };
}

function publicTicket(row) {
  return {
    id: row.id,
    reference: row.reference,
    subject: row.subject,
    department: row.department,
    priority: row.priority,
    status: row.status,
    lastReplyAt: row.last_reply_at,
    createdAt: row.created_at,
  };
}

function publicMessage(row) {
  return {
    id: row.id,
    authorId: row.author_id,
    authorRole: row.author_role,
    body: row.body,
    createdAt: row.created_at,
  };
}

function register(router, deps) {
  const { store } = deps;

  const authed = (handler) => async (ctx) => {
    await authenticate(ctx, deps);
    return handler(ctx);
  };

  // ------------------------------------------------------------------ profile
  router.patch('/api/v1/account/profile', authed(async (ctx) => {
    const input = await ctx.validate(profileSchema);
    guardSupportMode(ctx, 'profile.update');

    const patch = {};
    if (input.fullName !== undefined) patch.full_name = input.fullName;
    // Only the safe, user-owned fields are reachable here. email, role, status, customer_id and
    // every security_number_* column are deliberately absent, so a crafted body can never
    // escalate privilege or rewrite identity.
    if (input.phone !== undefined) patch.phone = input.phone;
    if (input.addressLine1 !== undefined) patch.address_line1 = input.addressLine1;
    if (input.city !== undefined) patch.city = input.city;
    if (input.state !== undefined) patch.state = input.state;
    if (input.postalCode !== undefined) patch.postal_code = input.postalCode;
    if (input.country !== undefined) patch.country = input.country;

    const user = await store.table('users').updateById(ctx.user.id, patch);
    if (!user) throw new NotFoundError('Account no longer exists');

    await audit(deps, {
      eventType: 'profile_update',
      userId: user.id,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { fields: Object.keys(patch) },
    });

    ctx.json({ user: publicUser(user) });
  }));

  router.get('/api/v1/account/profile', authed(async (ctx) => {
    const user = await store.table('users').findById(ctx.user.id);
    if (!user) throw new NotFoundError('Account no longer exists');
    ctx.json({ user: publicUser(user) });
  }));

  // ----------------------------------------------------------------- services
  router.get('/api/v1/account/services', authed(async (ctx) => {
    const { rows, total } = await store.table('customer_services').find(
      { user_id: ctx.user.id },
      { orderBy: '-created_at' }
    );
    ctx.json({ services: rows.map(publicService), total });
  }));

  // ------------------------------------------------------------------ domains
  router.get('/api/v1/account/domains', authed(async (ctx) => {
    const { rows, total } = await store.table('customer_domains').find(
      { user_id: ctx.user.id },
      { orderBy: '-created_at' }
    );
    ctx.json({ domains: rows.map(publicDomain), total });
  }));

  // ------------------------------------------------------------------ tickets
  router.get('/api/v1/account/tickets', authed(async (ctx) => {
    const { rows, total } = await store.table('support_tickets').find(
      { user_id: ctx.user.id },
      { orderBy: '-created_at' }
    );
    ctx.json({ tickets: rows.map(publicTicket), total });
  }));

  router.post('/api/v1/account/tickets', authed(async (ctx) => {
    const input = await ctx.validate(ticketSchema);

    const reference = `TCK-${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
    const ticket = await store.table('support_tickets').insert({
      id: uuidv7(),
      reference,
      user_id: ctx.user.id,
      subject: input.subject,
      department: input.department,
      priority: input.priority,
      status: 'open',
    });

    await store.table('support_ticket_messages').insert({
      id: uuidv7(),
      ticket_id: ticket.id,
      author_id: ctx.user.id,
      author_role: 'customer',
      body: input.body,
    });

    await store.table('support_tickets').updateById(ticket.id, {
      last_reply_at: new Date().toISOString(),
    });

    ctx.code(201).json({ ticket: publicTicket({ ...ticket, reference }) });
  }));

  router.get('/api/v1/account/tickets/:id', authed(async (ctx) => {
    // Scoped to the caller: someone else's ticket is a 404, never a 403.
    const ticket = await store.table('support_tickets').findOne({
      id: ctx.params.id,
      user_id: ctx.user.id,
    });
    if (!ticket) throw new NotFoundError('Ticket not found');

    const { rows } = await store.table('support_ticket_messages').find(
      { ticket_id: ticket.id },
      { orderBy: 'created_at' }
    );

    ctx.json({
      ticket: publicTicket(ticket),
      messages: rows.filter((m) => !m.is_internal).map(publicMessage),
    });
  }));

  router.post('/api/v1/account/tickets/:id/replies', authed(async (ctx) => {
    const body = await ctx.validate(v.object({ body: v.string().trim().min(1).max(20000) }));

    const ticket = await store.table('support_tickets').findOne({
      id: ctx.params.id,
      user_id: ctx.user.id,
    });
    if (!ticket) throw new NotFoundError('Ticket not found');
    if (ticket.status === 'closed') throw new ValidationError('This ticket is closed, open a new one');

    const message = await store.table('support_ticket_messages').insert({
      id: uuidv7(),
      ticket_id: ticket.id,
      author_id: ctx.user.id,
      author_role: 'customer',
      body: body.body,
    });

    await store.table('support_tickets').updateById(ticket.id, {
      status: 'customer_reply',
      last_reply_at: new Date().toISOString(),
    });

    ctx.code(201).json({ message: publicMessage(message) });
  }));
}

module.exports = { name, register };
