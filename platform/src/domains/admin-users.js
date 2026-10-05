/**
 * Admin user management: staff-created accounts, role changes, and delegated support sessions.
 *
 * Ported from cloudhost247-node/src/routes/admin-users.ts. Role/status changes are super_admin
 * only, and self-demotion/self-suspension is refused so an admin cannot lock themselves out.
 * The support-mode switch mints a short-lived delegated token whose claims are re-verified
 * against the admin_support_sessions row on every request (src/lib/auth.js).
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError, ForbiddenError, ConflictError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { hashPassword } = require('../lib/password');
const jwt = require('../lib/jwt');
const { asAdmin, asSuperAdmin, authenticate, ROLES } = require('../lib/auth');
const { publicUser } = require('./auth');

const name = 'admin-users';

const createUserSchema = v.object({
  email: v.string().trim().toLowerCase().email(),
  fullName: v.string().trim().min(1).max(120),
  password: v.string().min(12).max(200),
  role: v.enum(ROLES).default('customer'),
});

function register(router, deps) {
  const { store, config } = deps;

  router.get('/api/v1/admin/users', async (ctx) => {
    await asAdmin(ctx, deps);
    const { rows, total } = await store.table('users').find({}, { orderBy: '-created_at', limit: 200 });
    ctx.json({ users: rows.map(publicUser), total });
  });

  router.post('/api/v1/admin/users', async (ctx) => {
    const auth = await asSuperAdmin(ctx, deps);
    const input = await ctx.validate(createUserSchema);

    // An admin cannot create an account at or above their own role.
    if (input.role !== 'customer' && !(ROLES.indexOf(input.role) < ROLES.indexOf(auth.role))) {
      throw new ForbiddenError('You cannot create an account at or above your own role');
    }

    if (await store.table('users').findOneCi('email', input.email)) {
      throw new ConflictError('An account with this email already exists');
    }

    const user = await store.table('users').insert({
      id: uuidv7(),
      email: input.email,
      password_hash: await hashPassword(input.password),
      full_name: input.fullName,
      role: input.role,
    });
    ctx.code(201).json({ user: publicUser(user) });
  });

  router.patch('/api/v1/admin/users/:id', async (ctx) => {
    const auth = await asSuperAdmin(ctx, deps);
    const input = await ctx.validate(v.object({
      role: v.enum(ROLES).optional(),
      status: v.enum(['active', 'suspended', 'disabled']).optional(),
      fullName: v.string().trim().min(1).max(120).optional(),
    }));

    const target = await store.table('users').findById(ctx.params.id);
    if (!target) throw new NotFoundError('User not found');

    // Self-demotion / self-suspension lockout protection.
    if (target.id === auth.id && (input.role !== undefined || input.status !== undefined)) {
      throw new ForbiddenError('You cannot change your own role or status');
    }
    if (input.role !== undefined && !(ROLES.indexOf(input.role) <= ROLES.indexOf(auth.role))) {
      throw new ForbiddenError('You cannot grant a role above your own');
    }

    const patch = {};
    if (input.role !== undefined) patch.role = input.role;
    if (input.status !== undefined) patch.status = input.status;
    if (input.fullName !== undefined) patch.full_name = input.fullName;

    const updated = await store.table('users').updateById(target.id, patch);
    await store.table('auth_audit_log').insert({
      id: uuidv7(), user_id: target.id, event_type: 'admin_role_change',
      ip_address: ctx.ip, user_agent: ctx.userAgent, metadata: { patch, by: auth.id },
    });
    ctx.json({ user: publicUser(updated) });
  });

  router.delete('/api/v1/admin/users/:id', async (ctx) => {
    const auth = await asSuperAdmin(ctx, deps);
    const target = await store.table('users').findById(ctx.params.id);
    if (!target) throw new NotFoundError('User not found');
    if (target.id === auth.id) throw new ForbiddenError('You cannot delete your own account');

    // Soft delete: history retained, authentication stopped.
    await store.table('users').updateById(target.id, {
      status: 'deleted', deleted_at: new Date().toISOString(), deleted_by: auth.id,
    });
    ctx.json({ ok: true });
  });

  /** Delegate: mint a short-lived token that authenticates as the customer, acting as the admin. */
  router.post('/api/v1/admin/customers/:id/switch', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const customer = await store.table('users').findById(ctx.params.id);
    if (!customer || customer.status !== 'active') throw new NotFoundError('Customer not found');

    const session = await store.table('admin_support_sessions').insert({
      id: uuidv7(),
      admin_user_id: auth.id,
      customer_user_id: customer.id,
      reason: ctx.query.reason ?? null,
      ends_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const token = jwt.sign(
      { sub: customer.id, role: customer.role, email: customer.email, sv: customer.auth_session_version, sup: session.id, act: auth.id },
      config.JWT_SECRET,
      { expiresInMs: 60 * 60 * 1000 }
    );

    ctx.json({ supportSessionId: session.id, accessToken: token, customer: publicUser(customer) });
  });

  router.get('/api/v1/admin/support-sessions', async (ctx) => {
    await asAdmin(ctx, deps);
    const { rows } = await store.table('admin_support_sessions').find({}, { orderBy: '-created_at', limit: 200 });
    ctx.json({ sessions: rows.map((s) => ({
      id: s.id, adminId: s.admin_user_id, customerId: s.customer_user_id,
      startedAt: s.started_at, endsAt: s.ends_at, endedAt: s.ended_at,
    })) });
  });

  router.post('/api/v1/admin/support-sessions/:id/end', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const session = await store.table('admin_support_sessions').findById(ctx.params.id);
    if (!session) throw new NotFoundError('Support session not found');
    if (session.admin_user_id !== auth.id && auth.role !== 'super_admin') {
      throw new ForbiddenError('You can only end your own support sessions');
    }

    await store.table('admin_support_sessions').updateById(session.id, { ended_at: new Date().toISOString() });
    ctx.json({ ok: true });
  });
}

module.exports = { name, register };
