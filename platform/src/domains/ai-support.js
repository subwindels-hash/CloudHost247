/**
 * AI support — agents, conversations, messages and the knowledge base.
 *
 * Ported from cloudhost247-node/src/routes/ai-support.ts. The LLM inference itself is an external
 * adapter (deferred); this module stores agents, conversations, messages and knowledge entries and
 * returns a deterministic canned reply so the workflow is testable without a model.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError, ValidationError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { authenticate, asAdmin, asStaff } = require('../lib/auth');

const name = 'ai-support';

const CONVERSATION_STATUSES = ['AI_ACTIVE', 'WAITING_FOR_HUMAN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'RESOLVED', 'CLOSED'];

// Static support knowledge base (the original listSupportKnowledge() returns a fixed catalogue).
const SUPPORT_KNOWLEDGE = [
  { id: 'kb-billing', topic: 'Billing & invoices', summary: 'How to read invoices, update payment methods and request refunds.' },
  { id: 'kb-domains', topic: 'Domains & DNS', summary: 'Registering, transferring and pointing domains; nameserver and DNS record help.' },
  { id: 'kb-hosting', topic: 'Hosting & servers', summary: 'Provisioning, resource limits, backups and server lifecycle questions.' },
  { id: 'kb-cloudflare', topic: 'Cloudflare integration', summary: 'Connecting Cloudflare, plans, SSL modes and cache purges.' },
  { id: 'kb-account', topic: 'Account & security', summary: 'Passwords, two-factor authentication and account recovery.' },
];

function publicConversation(row) {
  return { id: row.id, agentId: row.agent_id, subject: row.subject, status: row.status, createdAt: row.created_at };
}

function cannedReply(knowledge, text) {
  const q = String(text).toLowerCase();
  const hit = knowledge.find((k) => q.includes(String(k.trigger || '').toLowerCase()) && k.trigger);
  if (hit) return hit.body;
  return "Thanks for reaching out. I've logged your question and a member of our support team will follow up shortly.";
}

function register(router, deps) {
  const { store } = deps;

  router.get('/api/v1/ai-support/agents', async (ctx) => {
    await authenticate(ctx, deps);
    const rows = await store.table('ai_support_agents').all();
    ctx.json({ agents: rows.filter((a) => a.active).map((a) => ({ id: a.id, name: a.name, role: a.role })) });
  });

  router.post('/api/v1/ai-support/agents', async (ctx) => {
    await asAdmin(ctx, deps);
    const body = await ctx.validate(v.object({ name: v.string().trim().min(1).max(120), role: v.string().trim().max(120).optional(), systemPrompt: v.string().max(8000).optional() }));
    const agent = await store.table('ai_support_agents').insert({ id: uuidv7(), name: body.name, role: body.role ?? null, system_prompt: body.systemPrompt ?? null, active: true });
    ctx.code(201).json({ agent: { id: agent.id, name: agent.name } });
  });

  router.get('/api/v1/ai-support/conversations', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { rows, total } = await store.table('ai_support_conversations').find({ user_id: auth.id }, { orderBy: '-created_at' });
    ctx.json({ conversations: rows.map(publicConversation), total });
  });

  router.post('/api/v1/ai-support/conversations', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(v.object({ subject: v.string().trim().min(1).max(200), agentId: v.string().optional() }));
    const conv = await store.table('ai_support_conversations').insert({
      id: uuidv7(), user_id: auth.id, agent_id: body.agentId ?? null, subject: body.subject, status: 'open',
    });
    ctx.code(201).json({ conversation: publicConversation(conv) });
  });

  router.get('/api/v1/ai-support/conversations/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const conv = await store.table('ai_support_conversations').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!conv) throw new NotFoundError('Conversation not found');
    const { rows } = await store.table('ai_support_messages').find({ conversation_id: conv.id }, { orderBy: 'created_at' });
    ctx.json({ conversation: publicConversation(conv), messages: rows.map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.created_at })) });
  });

  router.post('/api/v1/ai-support/conversations/:id/messages', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const conv = await store.table('ai_support_conversations').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!conv) throw new NotFoundError('Conversation not found');
    const body = await ctx.validate(v.object({ content: v.string().trim().min(1).max(8000) }));

    const knowledge = await store.table('ai_support_knowledge').all();
    const reply = cannedReply(knowledge, body.content);

    let userMsg; let botMsg;
    await store.transaction(async (tx) => {
      userMsg = await tx.table('ai_support_messages').insert({ id: uuidv7(), conversation_id: conv.id, role: 'user', content: body.content });
      botMsg = await tx.table('ai_support_messages').insert({ id: uuidv7(), conversation_id: conv.id, role: 'assistant', content: reply });
    });
    ctx.code(201).json({ userMessage: userMsg, reply: { id: botMsg.id, role: 'assistant', content: reply } });
  });

  // Newsletter sign-up captured from inside a support conversation. Idempotent on email: an
  // existing subscription is returned with alreadySubscribed=true rather than duplicated.
  router.post('/api/v1/ai-support/conversations/:id/newsletter', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const conv = await store.table('ai_support_conversations').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!conv) throw new NotFoundError('Conversation not found');
    const body = await ctx.validate(v.object({ name: v.string().trim().min(2).max(160), email: v.string().trim().toLowerCase().email() }));
    const email = body.email.toLowerCase();
    let subscription = await store.table('newsletter_subscriptions').findOne({ email });
    const alreadySubscribed = !!subscription;
    if (!subscription) {
      subscription = await store.table('newsletter_subscriptions').insert({ id: uuidv7(), name: body.name, email, status: 'active', source: 'ai_assistant' });
    }
    await store.table('audit_logs').insert({
      id: uuidv7(), actor_id: auth.id, actor_role: auth.role, action: 'NEWSLETTER_SUBSCRIPTION_COMPLETED',
      entity_type: 'newsletter_subscription', entity_id: subscription.id, ip_address: ctx.ip, user_agent: ctx.userAgent,
      after: { source: 'ai_assistant', alreadySubscribed },
    });
    ctx.json({ subscribed: true, alreadySubscribed, status: subscription.status });
  });

  router.get('/api/v1/ai-support/knowledge', async (ctx) => {
    await asAdmin(ctx, deps);
    const rows = await store.table('ai_support_knowledge').all();
    ctx.json({ knowledge: rows.map((k) => ({ id: k.id, title: k.title, trigger: k.trigger })) });
  });

  router.post('/api/v1/ai-support/knowledge', async (ctx) => {
    await asAdmin(ctx, deps);
    const body = await ctx.validate(v.object({ title: v.string().trim().min(1).max(200), trigger: v.string().trim().max(120).optional(), body: v.string().trim().min(1).max(8000) }));
    const row = await store.table('ai_support_knowledge').insert({ id: uuidv7(), title: body.title, trigger: body.trigger ?? null, body: body.body });
    ctx.code(201).json({ knowledge: { id: row.id, title: row.title } });
  });

  // ===========================================================================
  // Admin / staff support console (spec: ai-support admin). All routes require
  // staff/admin/super_admin. LLM inference is deferred; human agents reply directly.
  // ===========================================================================

  async function audit(ctx, action, resourceType, resourceId, metadata) {
    await store.table('audit_logs').insert({
      id: uuidv7(), actor_id: ctx.user.id, actor_role: ctx.user.role, action,
      entity_type: resourceType, entity_id: resourceId ?? null,
      ip_address: ctx.ip, user_agent: ctx.userAgent, after: metadata ?? null,
    });
  }
  async function addMessage(conversationId, role, content, senderId) {
    const msg = await store.table('ai_support_messages').insert({ id: uuidv7(), conversation_id: conversationId, role, content });
    await store.table('ai_support_conversations').updateById(conversationId, { last_message_at: new Date().toISOString() });
    return { id: msg.id, conversationId, senderType: role, message: content, senderId: senderId ?? null, createdAt: msg.created_at };
  }
  const userName = (u) => u?.full_name ?? null;

  router.get('/api/v1/admin/ai-support/agents', async (ctx) => {
    await asStaff(ctx, deps);
    const users = (await store.table('users').all()).filter((u) => u.status === 'active' && ['staff', 'admin', 'super_admin'].includes(u.role));
    const presence = await store.table('support_agent_presence').all();
    const byUser = new Map(presence.map((p) => [p.user_id, p]));
    users.sort((a, b) => String(a.full_name ?? '').localeCompare(String(b.full_name ?? '')));
    ctx.json({ agents: users.map((u) => ({ id: u.id, fullName: u.full_name ?? null, email: u.email, role: u.role, presenceStatus: byUser.get(u.id)?.status ?? 'OFFLINE', capacity: byUser.get(u.id)?.capacity ?? 3 })) });
  });

  router.get('/api/v1/admin/ai-support/knowledge', async (ctx) => {
    await asStaff(ctx, deps);
    ctx.json({ knowledge: SUPPORT_KNOWLEDGE });
  });

  router.get('/api/v1/admin/ai-support/conversations', async (ctx) => {
    await asStaff(ctx, deps);
    const query = await ctx.validateQuery(v.object({ status: v.enum(CONVERSATION_STATUSES).optional(), search: v.string().trim().max(160).optional() }));
    let rows = await store.table('ai_support_conversations').find({}, { orderBy: '-updated_at', limit: 200 }).then((r) => r.rows);
    if (query.status) rows = rows.filter((c) => c.status === query.status);
    if (query.search) {
      const s = query.search.toLowerCase();
      rows = rows.filter((c) => [c.visitor_name, c.visitor_email, c.id].some((f) => String(f ?? '').toLowerCase().includes(s)));
    }
    const out = [];
    for (const c of rows) {
      const cust = c.user_id ? await store.table('users').findById(c.user_id) : null;
      const agent = c.assigned_agent_id ? await store.table('users').findById(c.assigned_agent_id) : null;
      out.push({
        id: c.id, userId: c.user_id ?? null, visitorName: c.visitor_name ?? null, visitorEmail: c.visitor_email ?? null,
        status: c.status, escalationReason: c.escalation_reason ?? null, escalationNote: c.escalation_note ?? null,
        priority: c.priority ?? 'normal', assignedAgentId: c.assigned_agent_id ?? null, supportTicketId: c.support_ticket_id ?? null,
        source: c.source ?? null, createdAt: c.created_at, updatedAt: c.updated_at, lastMessageAt: c.last_message_at ?? null,
        customerAccountName: userName(cust), customerAccountEmail: cust?.email ?? null,
        assignedAgentName: userName(agent), assignedAgentEmail: agent?.email ?? null,
      });
    }
    ctx.json({ conversations: out });
  });

  router.get('/api/v1/admin/ai-support/conversations/:id', async (ctx) => {
    await asStaff(ctx, deps);
    const c = await store.table('ai_support_conversations').findById(ctx.params.id);
    if (!c) throw new NotFoundError('Conversation not found');
    const cust = c.user_id ? await store.table('users').findById(c.user_id) : null;
    const agent = c.assigned_agent_id ? await store.table('users').findById(c.assigned_agent_id) : null;
    const messages = await store.table('ai_support_messages').find({ conversation_id: c.id }, { orderBy: 'created_at' }).then((r) => r.rows);
    ctx.json({
      conversation: { ...c, customerAccountName: userName(cust), customerAccountEmail: cust?.email ?? null, assignedAgentName: userName(agent), assignedAgentEmail: agent?.email ?? null },
      messages: messages.map((m) => ({ id: m.id, senderType: m.role, message: m.content, createdAt: m.created_at })),
    });
  });

  router.post('/api/v1/admin/ai-support/conversations/:id/reply', async (ctx) => {
    const auth = await asStaff(ctx, deps);
    const input = await ctx.validate(v.object({ message: v.string().trim().min(1).max(10000) }));
    const conversationId = ctx.params.id;
    const conv = await store.table('ai_support_conversations').findById(conversationId);
    if (!conv || ['CLOSED', 'RESOLVED'].includes(conv.status)) throw new NotFoundError('Conversation not found or already closed');
    const patch = { status: 'IN_PROGRESS', assigned_agent_id: conv.assigned_agent_id ?? auth.id };
    await store.table('ai_support_conversations').updateById(conversationId, patch);
    const reply = await addMessage(conversationId, 'AGENT', input.message, auth.id);
    if (conv.user_id) {
      await store.table('notifications').insert({
        id: uuidv7(), user_id: conv.user_id, title: 'CloudHost247 Support replied to your conversation',
        body: 'A support representative replied to your CloudHost247 Support conversation. Open the support widget to continue.',
      });
    }
    await audit(ctx, 'HUMAN_AGENT_REPLIED', 'ai_support_conversation', conversationId, null);
    ctx.json({ message: reply });
  });

  router.patch('/api/v1/admin/ai-support/conversations/:id', async (ctx) => {
    const auth = await asStaff(ctx, deps);
    const input = await ctx.validate(v.object({
      status: v.enum(CONVERSATION_STATUSES).optional(),
      assignedAgentId: v.string().nullable().optional(),
      priority: v.enum(['low', 'normal', 'high']).optional(),
    }));
    if (input.status === undefined && input.assignedAgentId === undefined && input.priority === undefined) throw new ValidationError('At least one conversation field must be provided');
    const conversationId = ctx.params.id;
    if (input.assignedAgentId) {
      const agent = await store.table('users').findById(input.assignedAgentId);
      if (!agent || agent.status !== 'active' || !['staff', 'admin', 'super_admin'].includes(agent.role)) throw new ValidationError('Assigned user is not an active support agent');
    }
    const conv = await store.table('ai_support_conversations').findById(conversationId);
    if (!conv) throw new NotFoundError('Conversation not found');
    const patch = {};
    if (input.status !== undefined) {
      patch.status = input.status;
      patch.resolved_at = ['RESOLVED', 'CLOSED'].includes(input.status) ? new Date().toISOString() : null;
    }
    if (input.assignedAgentId !== undefined) patch.assigned_agent_id = input.assignedAgentId;
    if (input.priority !== undefined) patch.priority = input.priority;
    const row = await store.table('ai_support_conversations').updateById(conversationId, patch);
    if (input.status === 'AI_ACTIVE') await addMessage(conversationId, 'SYSTEM', 'CloudHost247 Support returned this conversation to the AI assistant.');
    if (input.status === 'RESOLVED' || input.status === 'CLOSED') await addMessage(conversationId, 'SYSTEM', `This conversation was marked ${input.status.toLowerCase()} by CloudHost247 Support.`);
    await audit(ctx, input.status === 'AI_ACTIVE' ? 'AI_HANDOFF_RETURNED' : input.status === 'RESOLVED' ? 'CONVERSATION_RESOLVED' : 'AI_CONVERSATION_UPDATED', 'ai_support_conversation', conversationId, input);
    ctx.json({ conversation: row });
  });

  router.put('/api/v1/admin/ai-support/presence', async (ctx) => {
    const auth = await asStaff(ctx, deps);
    const input = await ctx.validate(v.object({ status: v.enum(['ONLINE', 'BUSY', 'OFFLINE']), capacity: v.coerce.number().int().min(1).max(20).optional() }));
    const capacity = input.capacity ?? 3;
    const existing = await store.table('support_agent_presence').findOne({ user_id: auth.id });
    if (existing) await store.table('support_agent_presence').updateById(existing.id, { status: input.status, capacity });
    else await store.table('support_agent_presence').insert({ id: uuidv7(), user_id: auth.id, status: input.status, capacity });
    await audit(ctx, 'SUPPORT_AGENT_PRESENCE_UPDATED', 'support_agent_presence', auth.id, { status: input.status, capacity });
    ctx.json({ status: input.status, capacity });
  });

  router.get('/api/v1/admin/ai-support/overview', async (ctx) => {
    await asStaff(ctx, deps);
    const conversations = await store.table('ai_support_conversations').all();
    const counts = {};
    for (const c of conversations) counts[c.status] = (counts[c.status] ?? 0) + 1;
    const newsletter = (await store.table('newsletter_subscriptions').all()).filter((n) => String(n.status).toUpperCase() === 'ACTIVE').length;
    const humanStatuses = ['ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'RESOLVED', 'CLOSED'];
    const aiHandled = counts.AI_ACTIVE ?? 0;
    const humanHandled = conversations.filter((c) => humanStatuses.includes(c.status)).length;
    const byReason = {};
    for (const c of conversations) if (c.escalation_reason) byReason[c.escalation_reason] = (byReason[c.escalation_reason] ?? 0) + 1;
    ctx.json({
      counts, newsletterSubscriptions: newsletter, aiHandledConversations: aiHandled, humanHandledConversations: humanHandled,
      humanEscalations: conversations.filter((c) => c.status !== 'AI_ACTIVE').length, byReason,
    });
  });

  router.get('/api/v1/admin/newsletter-subscriptions', async (ctx) => {
    await asStaff(ctx, deps);
    const { rows } = await store.table('newsletter_subscriptions').find({}, { orderBy: '-created_at', limit: 500 });
    ctx.json({
      subscriptions: rows.map((s) => ({
        id: s.id, name: s.name, email: s.email, source: s.source ?? null,
        status: s.status, createdAt: s.created_at,
      })),
    });
  });
}

module.exports = { name, register };
