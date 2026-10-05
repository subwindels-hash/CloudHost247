/**
 * Revenue Guardian — churn/risk analytics and the recovery workflow.
 *
 * Ported from cloudhost247-node/src/revenue-guardian/. Risk is computed from invoices, payments and
 * subscription/service renewal dates. Recovery cases drive the follow-up workflow; assignment is
 * rule-ordered. All figures are derived from the ledger/invoices, never stored as truth.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { authenticate, asAdmin, asStaff } = require('../lib/auth');

const name = 'revenue-guardian';

const DAY = 86_400_000;

function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.round((new Date(dateStr).getTime() - Date.now()) / DAY);
}

/** Score a customer 0..100 for churn risk from unpaid invoices + imminent/past renewals. */
function riskScore(customer, invoices, subs) {
  let score = 0;
  const unpaid = invoices.filter((i) => i.user_id === customer.id && (i.status === 'unpaid' || i.status === 'overdue'));
  score += Math.min(40, unpaid.length * 15);
  for (const s of subs) {
    if (s.user_id !== customer.id) continue;
    const d = daysUntil(s.renews_at);
    if (d === null) continue;
    if (d < 0) score += 25;
    else if (d <= 7) score += 15;
  }
  if (customer.status === 'suspended') score += 20;
  return Math.min(100, score);
}

async function pickAssignee(store) {
  const rules = await store.table('rg_assignment_rules').all();
  const active = rules.filter((r) => r.active).sort((a, b) => a.priority - b.priority);
  if (active.length) return active[0].staff_id;
  const users = await store.table('users').all();
  const staff = users.find((u) => u.role === 'staff' || u.role === 'admin');
  return staff ? staff.id : null;
}

function publicCase(row) {
  return {
    id: row.id, customerId: row.customer_id, invoiceId: row.invoice_id, status: row.status,
    priority: row.priority, riskLevel: row.risk_level, ownerId: row.owner_id, createdAt: row.created_at,
  };
}

function register(router, deps) {
  const { store } = deps;

  // ---- customer-facing revenue health -------------------------------------
  router.get('/api/v1/account/revenue-health', async (ctx) => {
    const auth = await authenticate(ctx, deps);

    const invoices = await store.table('invoices').all();
    const outstandingInvoices = invoices
      .filter((i) => i.user_id === auth.id && i.status === 'unpaid')
      .map((i) => ({ id: i.id, number: i.number, currency: i.currency, total: i.total, status: i.status, dueAt: i.due_at, isOverdue: new Date(i.due_at).getTime() < Date.now() }));

    const subs = await store.table('subscriptions').all();
    const services = subs
      .filter((s) => s.user_id === auth.id)
      .map((s) => ({ id: s.id, status: s.status, expiresAt: s.renews_at }));

    // Payment promises hang off recovery cases; map cases owned by this customer to their promises.
    const cases = await store.table('rg_recovery_cases').all();
    const myCaseIds = new Set(cases.filter((c) => c.customer_id === auth.id).map((c) => c.id));
    const promises = await store.table('rg_payment_promises').all();
    const paymentArrangements = promises
      .filter((p) => myCaseIds.has(p.case_id) && (p.status === 'promised' || p.status === 'partially_fulfilled'))
      .map((p) => ({ amountCents: p.amount_cents, dueAt: p.due_at, status: p.status }));

    ctx.json({ outstandingInvoices, services, paymentArrangements });
  });

  // ---- dashboard ----------------------------------------------------------
  router.get('/api/v1/revenue-guardian/dashboard', async (ctx) => {
    await asAdmin(ctx, deps);
    const invoices = await store.table('invoices').all();
    const payments = await store.table('payments').all();
    const subs = await store.table('subscriptions').all();
    const customers = await store.table('users').all();

    const outstanding = invoices.filter((i) => i.status === 'unpaid' || i.status === 'overdue');
    const atRiskCents = outstanding.reduce((s, i) => s + (i.total_cents - (i.amount_paid_cents || 0)), 0);
    const collectedCents = payments.filter((p) => p.status === 'succeeded').reduce((s, p) => s + p.amount_cents, 0);

    const scored = customers
      .filter((c) => c.role === 'customer')
      .map((c) => ({ id: c.id, email: c.email, score: riskScore(c, invoices, subs), status: c.status }))
      .sort((a, b) => b.score - a.score);

    ctx.json({
      outstandingCents: atRiskCents,
      collectedCents,
      openInvoices: outstanding.length,
      customersAtRisk: scored.filter((c) => c.score >= 50).length,
      topRisk: scored.slice(0, 10),
    });
  });

  router.get('/api/v1/revenue-guardian/customer-health', async (ctx) => {
    await asAdmin(ctx, deps);
    const invoices = await store.table('invoices').all();
    const subs = await store.table('subscriptions').all();
    const customers = await store.table('users').all();
    ctx.json({
      customers: customers
        .filter((c) => c.role === 'customer')
        .map((c) => ({ id: c.id, email: c.email, status: c.status, riskScore: riskScore(c, invoices, subs) }))
        .sort((a, b) => b.riskScore - a.riskScore),
    });
  });

  router.get('/api/v1/revenue-guardian/renewals', async (ctx) => {
    await asAdmin(ctx, deps);
    const subs = await store.table('subscriptions').all();
    ctx.json({
      renewals: subs
        .map((s) => ({ id: s.id, userId: s.user_id, renewsAt: s.renews_at, daysUntil: daysUntil(s.renews_at), status: s.status }))
        .filter((r) => r.daysUntil !== null && r.daysUntil <= 30)
        .sort((a, b) => a.daysUntil - b.daysUntil),
    });
  });

  // ---- recovery cases -----------------------------------------------------
  router.get('/api/v1/revenue-guardian/cases', async (ctx) => {
    await asAdmin(ctx, deps);
    const query = await ctx.validateQuery(v.object({ status: v.string().optional(), ownerId: v.string().optional() }));
    const where = {};
    if (query.status) where.status = query.status;
    if (query.ownerId) where.owner_id = query.ownerId;
    const { rows, total } = await store.table('rg_recovery_cases').find(where, { orderBy: '-created_at', limit: 200 });
    ctx.json({ cases: rows.map(publicCase), total });
  });

  router.post('/api/v1/revenue-guardian/cases', async (ctx) => {
    await asStaff(ctx, deps);
    const body = await ctx.validate(v.object({
      customerId: v.string().min(1), invoiceId: v.string().optional(),
      priority: v.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
    }));
    const caseId = uuidv7();
    const ownerId = await pickAssignee(store);
    await store.transaction(async (tx) => {
      await tx.table('rg_recovery_cases').insert({
        id: caseId, customer_id: body.customerId, invoice_id: body.invoiceId ?? null,
        status: 'open', priority: body.priority, risk_level: body.priority, owner_id: ownerId,
      });
      await tx.table('rg_follow_ups').insert({ id: uuidv7(), case_id: caseId, kind: 'opened', body: 'Recovery case opened' });
    });
    ctx.code(201).json({ case: { id: caseId, status: 'open', ownerId } });
  });

  router.get('/api/v1/revenue-guardian/cases/:id', async (ctx) => {
    await asAdmin(ctx, deps);
    const kase = await store.table('rg_recovery_cases').findById(ctx.params.id);
    if (!kase) throw new NotFoundError('Case not found');
    const { rows: followUps } = await store.table('rg_follow_ups').find({ case_id: kase.id }, { orderBy: '-created_at' });
    const { rows: promises } = await store.table('rg_payment_promises').find({ case_id: kase.id }, { orderBy: '-created_at' });
    ctx.json({ case: publicCase(kase), followUps, promises });
  });

  router.patch('/api/v1/revenue-guardian/cases/:id', async (ctx) => {
    await asStaff(ctx, deps);
    const kase = await store.table('rg_recovery_cases').findById(ctx.params.id);
    if (!kase) throw new NotFoundError('Case not found');
    const body = await ctx.validate(v.object({ status: v.string().optional(), priority: v.string().optional() }));
    const patch = {};
    if (body.status) patch.status = body.status;
    if (body.priority) patch.priority = body.priority;
    const updated = await store.table('rg_recovery_cases').updateById(kase.id, patch);
    ctx.json({ case: publicCase(updated) });
  });

  router.post('/api/v1/revenue-guardian/cases/:id/assign', async (ctx) => {
    await asStaff(ctx, deps);
    const kase = await store.table('rg_recovery_cases').findById(ctx.params.id);
    if (!kase) throw new NotFoundError('Case not found');
    const body = await ctx.validate(v.object({ ownerId: v.string().min(1) }));
    const updated = await store.table('rg_recovery_cases').updateById(kase.id, { owner_id: body.ownerId });
    ctx.json({ case: publicCase(updated) });
  });

  router.post('/api/v1/revenue-guardian/cases/:id/follow-ups', async (ctx) => {
    const auth = await asStaff(ctx, deps);
    const kase = await store.table('rg_recovery_cases').findById(ctx.params.id);
    if (!kase) throw new NotFoundError('Case not found');
    const body = await ctx.validate(v.object({ body: v.string().trim().min(1).max(2000), kind: v.string().trim().max(40).default('note') }));
    const fu = await store.table('rg_follow_ups').insert({ id: uuidv7(), case_id: kase.id, kind: body.kind, body: body.body, created_by: auth.id });
    ctx.code(201).json({ followUp: fu });
  });

  router.post('/api/v1/revenue-guardian/cases/:id/promises', async (ctx) => {
    const auth = await asStaff(ctx, deps);
    const kase = await store.table('rg_recovery_cases').findById(ctx.params.id);
    if (!kase) throw new NotFoundError('Case not found');
    const body = await ctx.validate(v.object({ amountCents: v.coerce.number().int().min(1), dueAt: v.string().min(1) }));
    const promise = await store.table('rg_payment_promises').insert({ id: uuidv7(), case_id: kase.id, amount_cents: body.amountCents, due_at: body.dueAt, status: 'promised', created_by: auth.id });
    ctx.code(201).json({ promise });
  });

  router.get('/api/v1/revenue-guardian/my-work', async (ctx) => {
    const auth = await asStaff(ctx, deps);
    const { rows } = await store.table('rg_recovery_cases').find({ owner_id: auth.id }, { orderBy: '-created_at' });
    ctx.json({ cases: rows.map(publicCase) });
  });

  // ---- assignment + automation rules --------------------------------------
  router.get('/api/v1/revenue-guardian/assignment-rules', async (ctx) => {
    await asAdmin(ctx, deps);
    const rows = await store.table('rg_assignment_rules').all();
    ctx.json({ rules: rows.sort((a, b) => a.priority - b.priority) });
  });

  router.post('/api/v1/revenue-guardian/assignment-rules', async (ctx) => {
    await asAdmin(ctx, deps);
    const body = await ctx.validate(v.object({ staffId: v.string().min(1), priority: v.coerce.number().int().min(0).default(100), active: v.boolean().default(true) }));
    const row = await store.table('rg_assignment_rules').insert({ id: uuidv7(), staff_id: body.staffId, priority: body.priority, active: body.active });
    ctx.code(201).json({ rule: row });
  });

  router.get('/api/v1/revenue-guardian/automation', async (ctx) => {
    await asAdmin(ctx, deps);
    const rows = await store.table('rg_automation_rules').all();
    ctx.json({ rules: rows });
  });

  router.post('/api/v1/revenue-guardian/automation', async (ctx) => {
    await asAdmin(ctx, deps);
    const body = await ctx.validate(v.object({ name: v.string().trim().min(1).max(120), trigger: v.string().trim().min(1).max(64), action: v.string().trim().min(1).max(64), active: v.boolean().default(true) }));
    const row = await store.table('rg_automation_rules').insert({ id: uuidv7(), name: body.name, trigger: body.trigger, action: body.action, active: body.active });
    ctx.code(201).json({ rule: row });
  });

  // ---- reports ------------------------------------------------------------
  router.get('/api/v1/revenue-guardian/reports/summary', async (ctx) => {
    await asAdmin(ctx, deps);
    const cases = await store.table('rg_recovery_cases').all();
    const byStatus = {};
    for (const c of cases) byStatus[c.status] = (byStatus[c.status] || 0) + 1;
    ctx.json({ totalCases: cases.length, byStatus });
  });

  router.get('/api/v1/revenue-guardian/reports/staff-performance', async (ctx) => {
    await asAdmin(ctx, deps);
    const cases = await store.table('rg_recovery_cases').all();
    const byOwner = {};
    for (const c of cases) {
      const key = c.owner_id || 'unassigned';
      byOwner[key] = byOwner[key] || { ownerId: c.owner_id, total: 0, resolved: 0 };
      byOwner[key].total += 1;
      if (c.status === 'won' || c.status === 'resolved') byOwner[key].resolved += 1;
    }
    ctx.json({ staff: Object.values(byOwner) });
  });
}

module.exports = { name, register };
