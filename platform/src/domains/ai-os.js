/**
 * AI OS — the admin control plane for agents, models, tasks, incidents, knowledge and the
 * customer-facing assistant.
 *
 * Ported from cloudhost247-node/src/ai-os/. Entities are stored in the generic ai_registry table
 * (kind + metadata) so the whole subsystem persists on both backends without bespoke tables.
 * Admin base: /api/v1/admin/ai. Customer base: /api/v1/account/ai.
 *
 * The Copilot is live, and it is **deterministic**: `lib/ai-copilot.js` matches the prompt to a
 * registered intent, the intent reads real rows through `lib/ai-copilot-data.js`, and the answer is
 * rendered from those rows. There is no language model in the path — so every sentence the assistant
 * can produce is traceable to a row, a prompt that matches nothing returns the supported-command
 * list instead of an improvisation, and a query that fails says so rather than filling the gap.
 * (The audited build's Copilot worked the same way; this module's "requires a model adapter"
 * deferral conflated answering with inference, and the ported router is what actually shipped.)
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { authenticate, asAdmin, asStaff } = require('../lib/auth');
const { resolveAdminCommand, resolveCustomerMessage } = require('../lib/ai-copilot');

const name = 'ai-os';

const ADMIN = '/api/v1/admin/ai';
const CUSTOMER = '/api/v1/account/ai';

async function listByKind(store, kind) {
  const rows = await store.table('ai_registry').all();
  return rows.filter((r) => r.kind === kind);
}

function publicEntity(row) {
  return { id: row.id, slug: row.slug, name: row.name, kind: row.kind, status: row.status, metadata: row.metadata, createdAt: row.created_at };
}

function register(router, deps) {
  const { store } = deps;

  // ---- admin: overview / observability ------------------------------------
  router.get(`${ADMIN}/overview`, async (ctx) => {
    await asAdmin(ctx, deps);
    const rows = await store.table('ai_registry').all();
    const byKind = {};
    for (const r of rows) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
    ctx.json({ totals: byKind, entities: rows.length });
  });

  router.get(`${ADMIN}/observability`, async (ctx) => {
    await asAdmin(ctx, deps);
    const events = await listByKind(store, 'event');
    ctx.json({ events: events.slice(-100).map(publicEntity) });
  });

  // ---- admin: agents ------------------------------------------------------
  router.get(`${ADMIN}/agents`, async (ctx) => {
    await asAdmin(ctx, deps);
    const agents = await listByKind(store, 'agent');
    ctx.json({ agents: agents.map(publicEntity) });
  });

  router.get(`${ADMIN}/agents/:id`, async (ctx) => {
    await asAdmin(ctx, deps);
    const row = await store.table('ai_registry').findById(ctx.params.id);
    if (!row || row.kind !== 'agent') throw new NotFoundError('Agent not found');
    ctx.json({ agent: publicEntity(row) });
  });

  router.post(`${ADMIN}/agents`, async (ctx) => {
    await asAdmin(ctx, deps);
    const body = await ctx.validate(v.object({ name: v.string().trim().min(1).max(120), slug: v.string().trim().min(1).max(120), systemPrompt: v.string().max(8000).optional() }));
    const row = await store.table('ai_registry').insert({ id: uuidv7(), slug: body.slug, name: body.name, kind: 'agent', status: 'enabled', metadata: { systemPrompt: body.systemPrompt ?? null } });
    ctx.code(201).json({ agent: publicEntity(row) });
  });

  router.post(`${ADMIN}/agents/:id/enabled`, async (ctx) => {
    await asStaff(ctx, deps);
    const row = await store.table('ai_registry').findById(ctx.params.id);
    if (!row || row.kind !== 'agent') throw new NotFoundError('Agent not found');
    const body = await ctx.validate(v.object({ enabled: v.boolean() }));
    const updated = await store.table('ai_registry').updateById(row.id, { status: body.enabled ? 'enabled' : 'disabled' });
    ctx.json({ agent: publicEntity(updated) });
  });

  router.post(`${ADMIN}/agents/:id/evaluate`, async (ctx) => {
    await asAdmin(ctx, deps);
    const row = await store.table('ai_registry').findById(ctx.params.id);
    if (!row || row.kind !== 'agent') throw new NotFoundError('Agent not found');
    // No live model to evaluate against; record a placeholder evaluation entity.
    const evalRow = await store.table('ai_registry').insert({ id: uuidv7(), slug: `eval-${row.slug}`, name: `Evaluation of ${row.name}`, kind: 'evaluation', status: 'pending', metadata: { agentId: row.id } });
    ctx.code(201).json({ evaluation: publicEntity(evalRow) });
  });

  // ---- admin: models ------------------------------------------------------
  router.get(`${ADMIN}/models`, async (ctx) => {
    await asAdmin(ctx, deps);
    const models = await listByKind(store, 'model');
    ctx.json({ models: models.map(publicEntity) });
  });

  router.put(`${ADMIN}/models/:engine`, async (ctx) => {
    await asAdmin(ctx, deps);
    const body = await ctx.validate(v.object({ model: v.string().trim().min(1).max(120), enabled: v.boolean().default(true) }));
    const existing = (await listByKind(store, 'model')).find((m) => m.slug === ctx.params.engine);
    if (existing) {
      const updated = await store.table('ai_registry').updateById(existing.id, { name: body.model, status: body.enabled ? 'enabled' : 'disabled' });
      return ctx.json({ model: publicEntity(updated) });
    }
    const row = await store.table('ai_registry').insert({ id: uuidv7(), slug: ctx.params.engine, name: body.model, kind: 'model', status: body.enabled ? 'enabled' : 'disabled', metadata: {} });
    ctx.code(201).json({ model: publicEntity(row) });
  });

  // ---- admin: tasks / events / incidents / findings / approvals -----------
  router.get(`${ADMIN}/tasks`, async (ctx) => {
    await asAdmin(ctx, deps);
    ctx.json({ tasks: (await listByKind(store, 'task')).map(publicEntity) });
  });
  router.post(`${ADMIN}/tasks`, async (ctx) => {
    await asStaff(ctx, deps);
    const body = await ctx.validate(v.object({ name: v.string().trim().min(1).max(120), payload: v.object({}).passthrough().default({}) }));
    const row = await store.table('ai_registry').insert({ id: uuidv7(), slug: `task-${Date.now()}`, name: body.name, kind: 'task', status: 'queued', metadata: body.payload });
    ctx.code(201).json({ task: publicEntity(row) });
  });
  router.get(`${ADMIN}/tasks/:id`, async (ctx) => {
    await asAdmin(ctx, deps);
    const row = await store.table('ai_registry').findById(ctx.params.id);
    if (!row || row.kind !== 'task') throw new NotFoundError('Task not found');
    ctx.json({ task: publicEntity(row) });
  });

  router.get(`${ADMIN}/events`, async (ctx) => {
    await asAdmin(ctx, deps);
    ctx.json({ events: (await listByKind(store, 'event')).map(publicEntity) });
  });
  router.post(`${ADMIN}/events`, async (ctx) => {
    await asStaff(ctx, deps);
    const body = await ctx.validate(v.object({ name: v.string().trim().min(1).max(120), payload: v.object({}).passthrough().default({}) }));
    const row = await store.table('ai_registry').insert({ id: uuidv7(), slug: `event-${Date.now()}`, name: body.name, kind: 'event', status: 'recorded', metadata: body.payload });
    ctx.code(201).json({ event: publicEntity(row) });
  });

  router.get(`${ADMIN}/incidents`, async (ctx) => {
    await asAdmin(ctx, deps);
    ctx.json({ incidents: (await listByKind(store, 'incident')).map(publicEntity) });
  });
  router.post(`${ADMIN}/incidents`, async (ctx) => {
    await asStaff(ctx, deps);
    const body = await ctx.validate(v.object({ name: v.string().trim().min(1).max(120), severity: v.enum(['low', 'medium', 'high', 'critical']).default('medium') }));
    const row = await store.table('ai_registry').insert({ id: uuidv7(), slug: `incident-${Date.now()}`, name: body.name, kind: 'incident', status: 'open', metadata: { severity: body.severity, notes: [] } });
    ctx.code(201).json({ incident: publicEntity(row) });
  });
  router.post(`${ADMIN}/incidents/:id/notes`, async (ctx) => {
    await asStaff(ctx, deps);
    const row = await store.table('ai_registry').findById(ctx.params.id);
    if (!row || row.kind !== 'incident') throw new NotFoundError('Incident not found');
    const body = await ctx.validate(v.object({ note: v.string().trim().min(1).max(2000) }));
    const meta = { ...(row.metadata || {}), notes: [...((row.metadata && row.metadata.notes) || []), body.note] };
    const updated = await store.table('ai_registry').updateById(row.id, { metadata: meta });
    ctx.json({ incident: publicEntity(updated) });
  });

  router.get(`${ADMIN}/findings`, async (ctx) => {
    await asAdmin(ctx, deps);
    ctx.json({ findings: (await listByKind(store, 'finding')).map(publicEntity) });
  });
  router.post(`${ADMIN}/findings/:id/status`, async (ctx) => {
    await asStaff(ctx, deps);
    const row = await store.table('ai_registry').findById(ctx.params.id);
    if (!row || row.kind !== 'finding') throw new NotFoundError('Finding not found');
    const body = await ctx.validate(v.object({ status: v.string().min(1).max(40) }));
    const updated = await store.table('ai_registry').updateById(row.id, { status: body.status });
    ctx.json({ finding: publicEntity(updated) });
  });

  router.get(`${ADMIN}/approvals`, async (ctx) => {
    await asAdmin(ctx, deps);
    ctx.json({ approvals: (await listByKind(store, 'approval')).map(publicEntity) });
  });
  router.post(`${ADMIN}/approvals/:id/decision`, async (ctx) => {
    await asAdmin(ctx, deps);
    const row = await store.table('ai_registry').findById(ctx.params.id);
    if (!row || row.kind !== 'approval') throw new NotFoundError('Approval not found');
    const body = await ctx.validate(v.object({ decision: v.enum(['approved', 'rejected']) }));
    const updated = await store.table('ai_registry').updateById(row.id, { status: body.decision });
    ctx.json({ approval: publicEntity(updated) });
  });

  // ---- admin: workflows / runs / board ------------------------------------
  router.get(`${ADMIN}/workflows`, async (ctx) => {
    await asAdmin(ctx, deps);
    ctx.json({ workflows: (await listByKind(store, 'workflow')).map(publicEntity) });
  });
  router.patch(`${ADMIN}/workflows/:id`, async (ctx) => {
    await asAdmin(ctx, deps);
    const row = await store.table('ai_registry').findById(ctx.params.id);
    if (!row || row.kind !== 'workflow') throw new NotFoundError('Workflow not found');
    const body = await ctx.validate(v.object({ status: v.string().min(1).max(40).optional() }));
    const updated = await store.table('ai_registry').updateById(row.id, body.status ? { status: body.status } : {});
    ctx.json({ workflow: publicEntity(updated) });
  });
  router.get(`${ADMIN}/workflow-runs`, async (ctx) => {
    await asAdmin(ctx, deps);
    ctx.json({ runs: (await listByKind(store, 'workflow-run')).map(publicEntity) });
  });

  router.get(`${ADMIN}/board`, async (ctx) => {
    await asAdmin(ctx, deps);
    const rows = await store.table('ai_registry').all();
    ctx.json({ board: rows.filter((r) => r.kind === 'briefing').map(publicEntity) });
  });
  router.get(`${ADMIN}/board/briefings`, async (ctx) => {
    await asAdmin(ctx, deps);
    ctx.json({ briefings: (await listByKind(store, 'briefing')).map(publicEntity) });
  });
  router.post(`${ADMIN}/board/briefings`, async (ctx) => {
    await asAdmin(ctx, deps);
    const body = await ctx.validate(v.object({ title: v.string().trim().min(1).max(200), content: v.string().trim().max(8000).default('') }));
    const row = await store.table('ai_registry').insert({ id: uuidv7(), slug: `briefing-${Date.now()}`, name: body.title, kind: 'briefing', status: 'published', metadata: { content: body.content } });
    ctx.code(201).json({ briefing: publicEntity(row) });
  });
  router.get(`${ADMIN}/board/briefings/:id`, async (ctx) => {
    await asAdmin(ctx, deps);
    const row = await store.table('ai_registry').findById(ctx.params.id);
    if (!row || row.kind !== 'briefing') throw new NotFoundError('Briefing not found');
    ctx.json({ briefing: publicEntity(row) });
  });

  router.get(`${ADMIN}/audit`, async (ctx) => {
    await asAdmin(ctx, deps);
    const { rows } = await store.table('audit_logs').find({ entity_type: 'ai_registry' }, { orderBy: '-created_at', limit: 100 });
    ctx.json({ audit: rows });
  });

  router.get(`${ADMIN}/evaluations`, async (ctx) => {
    await asAdmin(ctx, deps);
    ctx.json({ evaluations: (await listByKind(store, 'evaluation')).map(publicEntity) });
  });

  // ---- admin: knowledge ---------------------------------------------------
  router.get(`${ADMIN}/knowledge`, async (ctx) => {
    await asAdmin(ctx, deps);
    const rows = await store.table('ai_support_knowledge').all();
    ctx.json({ knowledge: rows.map((k) => ({ id: k.id, title: k.title })) });
  });
  router.post(`${ADMIN}/knowledge`, async (ctx) => {
    await asAdmin(ctx, deps);
    const body = await ctx.validate(v.object({ title: v.string().trim().min(1).max(200), body: v.string().trim().min(1).max(8000) }));
    const row = await store.table('ai_support_knowledge').insert({ id: uuidv7(), title: body.title, body: body.body });
    ctx.code(201).json({ knowledge: { id: row.id, title: row.title } });
  });
  router.get(`${ADMIN}/knowledge/search`, async (ctx) => {
    await asAdmin(ctx, deps);
    const query = await ctx.validateQuery(v.object({ q: v.string().trim().max(200).default('') }));
    const rows = await store.table('ai_support_knowledge').all();
    const q = query.q.toLowerCase();
    ctx.json({ results: rows.filter((k) => k.title.toLowerCase().includes(q) || k.body.toLowerCase().includes(q)).map((k) => ({ id: k.id, title: k.title })) });
  });

  /**
   * Admin Copilot — a real answer from real data, or an honest refusal naming what it can do.
   *
   * The interaction is recorded as an `event` entity either way, including when the prompt matched
   * nothing: an unsupported command is a gap in the vocabulary, and it should be visible to whoever
   * maintains it rather than vanishing.
   */
  router.post(`${ADMIN}/copilot`, async (ctx) => {
    const auth = await asStaff(ctx, deps);
    const body = await ctx.validate(v.object({ prompt: v.string().trim().min(1).max(4000) }));

    const result = await resolveAdminCommand(store, body.prompt);
    // The slug is derived from the row id, not a timestamp: two answers in the same millisecond must
    // still be two rows, or a recorded interaction would silently overwrite the one before it.
    const eventId = uuidv7();
    const event = await store.table('ai_registry').insert({
      id: eventId,
      slug: `copilot-${eventId}`,
      name: `Copilot: ${result.intent}`,
      kind: 'event',
      status: result.confidence === 'exact' ? 'answered' : 'unsupported',
      metadata: {
        prompt: body.prompt.slice(0, 500),
        intent: result.intent,
        confidence: result.confidence,
        actorId: auth.id ?? null,
        evidence: result.evidence,
      },
    });

    ctx.json({
      reply: result.answer,
      intent: result.intent,
      confidence: result.confidence,
      ...(result.supported ? { supported: result.supported } : {}),
      evidence: result.evidence,
      eventId: event.id,
    });
  });

  // ---- customer -----------------------------------------------------------
  /**
   * Customer Cloud Assistant — the same deterministic router, scoped to the asking customer.
   *
   * Every read is filtered by `auth.id` inside the data layer, so one customer's invoices cannot
   * appear in another's answer even if an intent is misworded. The one mutation it can perform is
   * opening a ticket on the customer's own explicit request.
   */
  router.post(`${CUSTOMER}/assistant`, async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(v.object({ message: v.string().trim().min(1).max(4000) }));

    const result = await resolveCustomerMessage(store, { userId: auth.id, message: body.message });
    const eventId = uuidv7();
    await store.table('ai_registry').insert({
      id: eventId,
      slug: `assistant-${eventId}`,
      name: `Assistant: ${result.intent}`,
      kind: 'event',
      status: result.confidence === 'exact' ? 'answered' : 'unsupported',
      metadata: { userId: auth.id, intent: result.intent, confidence: result.confidence, evidence: result.evidence },
    });

    ctx.json({
      reply: result.answer,
      intent: result.intent,
      confidence: result.confidence,
      ...(result.supported ? { supported: result.supported } : {}),
    });
  });

  router.get(`${CUSTOMER}/activity`, async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const rows = await store.table('ai_registry').all();
    ctx.json({ activity: rows.filter((r) => r.metadata && r.metadata.userId === auth.id).slice(-50).map(publicEntity) });
  });

  router.get(`${CUSTOMER}/profile`, async (ctx) => {
    const auth = await authenticate(ctx, deps);
    ctx.json({ id: auth.id, email: auth.email, role: auth.role });
  });
}

module.exports = { name, register };
