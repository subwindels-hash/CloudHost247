/**
 * Domain brokerage — customers open a case to acquire a taken domain; staff work the case.
 *
 * Ported from cloudhost247-node/src/routes/domain-brokerage.ts. Cases move through statuses;
 * follow-ups and payment promises hang off a case. Assignment uses rg_assignment_rules ordering.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { authenticate, asStaff, asAdmin } = require('../lib/auth');

const name = 'domain-brokerage';

const CASE_STATUSES = ['open', 'in_progress', 'awaiting_customer', 'won', 'lost', 'cancelled'];

function publicCase(row) {
  return {
    id: row.id, domainName: row.domain_name, status: row.status, priority: row.priority,
    ownerId: row.owner_id, createdAt: row.created_at,
  };
}

async function pickAssignee(store) {
  const rules = await store.table('rg_assignment_rules').all();
  const active = rules.filter((r) => r.active).sort((a, b) => a.priority - b.priority);
  if (active.length) return active[0].staff_id;
  const users = await store.table('users').all();
  const staff = users.find((u) => u.role === 'staff' || u.role === 'admin');
  return staff ? staff.id : null;
}

function register(router, deps) {
  const { store } = deps;

  router.get('/api/v1/brokerage', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { rows, total } = await store.table('domain_brokerage_cases').find({ user_id: auth.id }, { orderBy: '-created_at' });
    ctx.json({ cases: rows.map(publicCase), total });
  });

  router.post('/api/v1/brokerage', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(v.object({
      domainName: v.string().trim().min(3).max(253),
      budgetCents: v.coerce.number().int().min(0).optional(),
      notes: v.string().trim().max(2000).optional(),
    }));

    const caseId = uuidv7();
    const ownerId = await pickAssignee(store);
    await store.transaction(async (tx) => {
      await tx.table('domain_brokerage_cases').insert({
        id: caseId, user_id: auth.id, domain_name: body.domainName, status: 'open',
        priority: 'normal', owner_id: ownerId, budget_cents: body.budgetCents ?? null, notes: body.notes ?? null,
      });
      await tx.table('rg_follow_ups').insert({
        id: uuidv7(), case_id: caseId, kind: 'opened', body: 'Brokerage case opened', created_by: auth.id,
      });
    });
    ctx.code(201).json({ case: { id: caseId, status: 'open' } });
  });

  router.get('/api/v1/brokerage/:caseId', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const kase = await store.table('domain_brokerage_cases').findById(ctx.params.caseId);
    if (!kase) throw new NotFoundError('Case not found');
    const isOwner = kase.user_id === auth.id || auth.role === 'admin' || auth.role === 'super_admin' || auth.role === 'staff';
    if (!isOwner) throw new NotFoundError('Case not found');
    const { rows: followUps } = await store.table('rg_follow_ups').find({ case_id: kase.id }, { orderBy: '-created_at' });
    ctx.json({ case: publicCase(kase), followUps });
  });

  router.post('/api/v1/brokerage/:caseId/follow-ups', async (ctx) => {
    const auth = await asStaff(ctx, deps);
    const kase = await store.table('domain_brokerage_cases').findById(ctx.params.caseId);
    if (!kase) throw new NotFoundError('Case not found');
    const body = await ctx.validate(v.object({ body: v.string().trim().min(1).max(2000), kind: v.string().trim().max(40).default('note') }));
    const fu = await store.table('rg_follow_ups').insert({ id: uuidv7(), case_id: kase.id, kind: body.kind, body: body.body, created_by: auth.id });
    ctx.code(201).json({ followUp: fu });
  });

  router.post('/api/v1/brokerage/:caseId/promises', async (ctx) => {
    const auth = await asStaff(ctx, deps);
    const kase = await store.table('domain_brokerage_cases').findById(ctx.params.caseId);
    if (!kase) throw new NotFoundError('Case not found');
    const body = await ctx.validate(v.object({ amountCents: v.coerce.number().int().min(1), dueAt: v.string().min(1) }));
    const promise = await store.table('rg_payment_promises').insert({ id: uuidv7(), case_id: kase.id, amount_cents: body.amountCents, due_at: body.dueAt, status: 'promised', created_by: auth.id });
    ctx.code(201).json({ promise });
  });

  // ---- admin --------------------------------------------------------------
  router.get('/api/v1/admin/brokerage/cases', async (ctx) => {
    await asAdmin(ctx, deps);
    const query = await ctx.validateQuery(v.object({ status: v.string().optional(), ownerId: v.string().optional() }));
    const where = {};
    if (query.status) where.status = query.status;
    if (query.ownerId) where.owner_id = query.ownerId;
    const { rows, total } = await store.table('domain_brokerage_cases').find(where, { orderBy: '-created_at', limit: 200 });
    ctx.json({ cases: rows.map(publicCase), total });
  });

  router.post('/api/v1/admin/brokerage/cases/:id/assign', async (ctx) => {
    await asStaff(ctx, deps);
    const kase = await store.table('domain_brokerage_cases').findById(ctx.params.id);
    if (!kase) throw new NotFoundError('Case not found');
    const body = await ctx.validate(v.object({ ownerId: v.string().min(1) }));
    const updated = await store.table('domain_brokerage_cases').updateById(kase.id, { owner_id: body.ownerId });
    ctx.json({ case: publicCase(updated) });
  });

  router.patch('/api/v1/admin/brokerage/cases/:id', async (ctx) => {
    await asStaff(ctx, deps);
    const kase = await store.table('domain_brokerage_cases').findById(ctx.params.id);
    if (!kase) throw new NotFoundError('Case not found');
    const body = await ctx.validate(v.object({ status: v.enum(CASE_STATUSES).optional(), priority: v.string().optional() }));
    const patch = {};
    if (body.status) patch.status = body.status;
    if (body.priority) patch.priority = body.priority;
    const updated = await store.table('domain_brokerage_cases').updateById(kase.id, patch);
    ctx.json({ case: publicCase(updated) });
  });
}

module.exports = { name, register };
