/**
 * AI support — agents, conversations, messages and the reviewed knowledge catalogue.
 *
 * Ported from cloudhost247-node/src/routes/ai-support.ts, and the assistant in it is now completed
 * rather than deferred: `lib/support-operator.js` decides what happens to each customer message — a
 * reviewed catalogue answer, a published price read from the live catalog, the newsletter form, or an
 * escalation to the human queue. That decision layer is deterministic on purpose. The audited build
 * runs no language model on this path either, so nothing here is simulated: every answer is traceable
 * to a catalogue entry or a catalog row, and every question this platform cannot verify — anything
 * account-specific, anything outside the catalogue — is escalated with the transcript instead of
 * being answered.
 *
 * An escalation is not a dead end. It creates a real `support_tickets` row for a signed-in customer,
 * assigns an available agent when one exists, sets the priority from the reason, and notifies both
 * sides, so "a human will follow up" is a statement about rows that now exist.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError, ValidationError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { authenticate, asAdmin, asStaff } = require('../lib/auth');
const {
  decideSupportResponse, listSupportKnowledge, supportAvailability, HIGH_PRIORITY_REASONS, ENGINE,
} = require('../lib/support-operator');

const name = 'ai-support';

const CONVERSATION_STATUSES = ['AI_ACTIVE', 'WAITING_FOR_HUMAN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'RESOLVED', 'CLOSED'];

/**
 * Statuses in which the assistant may answer. `AI_ACTIVE` is the registry default; `open` is what the
 * customer-facing create route writes, and the two must mean the same thing here or a new
 * conversation would silently get no assistant at all.
 */
const ASSISTANT_STATUSES = ['AI_ACTIVE', 'open'];

/** Terminal statuses — a message into one of these is refused rather than answered. */
const TERMINAL_STATUSES = ['RESOLVED', 'CLOSED'];

/** Which queue a reason belongs in, and how urgent it is. */
const REASON_DEPARTMENT = {
  BILLING_SUPPORT_REQUIRED: 'billing',
  SECURITY_RELATED: 'abuse',
  REFUND_REQUEST: 'billing',
  COMPLAINT: 'abuse',
  SERVER_SUPPORT_REQUIRED: 'technical',
  TECHNICAL_SUPPORT_REQUIRED: 'technical',
};

function publicConversation(row) {
  return { id: row.id, agentId: row.agent_id, subject: row.subject, status: row.status, createdAt: row.created_at };
}

/** Public DTO for a stored message, including the assistant's reasoning when it has any. */
function publicMessage(row) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
    ...(row.intent ? { intent: row.intent } : {}),
    ...(row.confidence === null || row.confidence === undefined ? {} : { confidence: Number(row.confidence) }),
    ...(Array.isArray(row.knowledge_sources) && row.knowledge_sources.length > 0 ? { sources: row.knowledge_sources } : {}),
  };
}

function register(router, deps) {
  const { store } = deps;

  /**
   * Human-support availability for the widget (public — the original takes no auth).
   * ONLINE when at least one staff member is present with spare capacity, BUSY when staff are
   * present but at capacity, otherwise OFFLINE.
   */
  router.get('/api/v1/ai-support/availability', async (ctx) => {
    // One definition of "a human is reachable", shared with the escalation path: the widget and the
    // transfer decision can never disagree about it.
    const availability = await supportAvailability(store);
    ctx.json({ status: availability.status });
  });

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
    ctx.json({ conversation: publicConversation(conv), messages: rows.map(publicMessage) });
  });

  /**
   * Send a message to the support assistant.
   *
   * Three outcomes, all of them honest:
   *  · the assistant answers from the reviewed catalogue, the live catalog, or the newsletter form;
   *  · it escalates, which writes a real ticket for a signed-in customer and hands the conversation
   *    to the queue;
   *  · a conversation already with a human stays with the human — the message is stored and the queue
   *    is told, and no assistant reply is invented for it.
   */
  router.post('/api/v1/ai-support/conversations/:id/messages', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const conv = await store.table('ai_support_conversations').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!conv) throw new NotFoundError('Conversation not found');
    const body = await ctx.validate(v.object({ content: v.string().trim().min(1).max(8000) }));
    const now = () => new Date().toISOString();

    if (TERMINAL_STATUSES.includes(conv.status)) throw new ValidationError('This conversation is closed');

    // A conversation that is with the human queue does not get assistant answers.
    if (!ASSISTANT_STATUSES.includes(conv.status)) {
      const userMessage = await store.table('ai_support_messages').insert({ id: uuidv7(), conversation_id: conv.id, role: 'user', content: body.content });
      await store.table('ai_support_conversations').updateById(conv.id, {
        status: conv.assigned_agent_id ? 'IN_PROGRESS' : 'WAITING_FOR_HUMAN',
        last_message_at: now(), updated_at: now(),
      });
      ctx.code(201).json({
        accepted: true, humanActive: true,
        userMessage: publicMessage(userMessage),
      });
      return;
    }

    const previous = (await store.table('ai_support_messages').find({ conversation_id: conv.id }, { orderBy: '-created_at', limit: 8 })).rows;
    const userMessage = await store.table('ai_support_messages').insert({ id: uuidv7(), conversation_id: conv.id, role: 'user', content: body.content });
    const decision = await decideSupportResponse(store, body.content, { previousMessages: previous });

    if (decision.kind === 'ESCALATE' && decision.reason === 'USER_REQUESTED_HUMAN') {
      await store.table('audit_logs').insert({
        id: uuidv7(), actor_id: auth.id, actor_role: auth.role, action: 'HUMAN_TRANSFER_REQUESTED',
        entity_type: 'ai_support_conversation', entity_id: conv.id, ip_address: ctx.ip, user_agent: ctx.userAgent, after: null,
      });
    }

    // Escalation runs first: it decides whether a human is actually there, and the reply the customer
    // receives has to say which of the two happened.
    const transfer = decision.kind === 'ESCALATE' ? await escalate(ctx, conv, decision.reason ?? 'OTHER') : null;
    // Both halves are true and the customer needs both: why it could not be answered here, and what
    // actually happened instead. Dropping the first would hide the reason for the escalation.
    const content = transfer ? `${decision.body}\n\n${transfer.body}` : decision.body;
    const reply = await store.table('ai_support_messages').insert({
      id: uuidv7(), conversation_id: conv.id, role: 'assistant', content,
      intent: decision.intent, confidence: decision.confidence, knowledge_sources: decision.sources,
    });
    await store.table('ai_support_conversations').updateById(conv.id, { last_message_at: now(), updated_at: now() });
    await store.table('audit_logs').insert({
      id: uuidv7(), actor_id: auth.id, actor_role: auth.role,
      action: decision.kind === 'ESCALATE' ? 'AI_ESCALATION_TRIGGERED' : decision.kind === 'NEWSLETTER' ? 'NEWSLETTER_SUBSCRIPTION_REQUESTED' : 'AI_RESPONSE_GENERATED',
      entity_type: 'ai_support_conversation', entity_id: conv.id, ip_address: ctx.ip, user_agent: ctx.userAgent,
      after: { intent: decision.intent, engine: decision.engine ?? ENGINE, confidence: decision.confidence, reason: decision.reason ?? null, sources: decision.sources },
    });

    ctx.code(201).json({
      userMessage: publicMessage(userMessage),
      reply: publicMessage(reply),
      decision: {
        kind: decision.kind, intent: decision.intent, confidence: decision.confidence,
        ...(decision.reason ? { reason: decision.reason } : {}),
        ...(decision.sources.length > 0 ? { sources: decision.sources } : {}),
        engine: decision.engine ?? ENGINE,
      },
      ...(transfer ? { transfer } : {}),
    });
  });

  // Newsletter sign-up captured from inside a support conversation. Idempotent on email: an
  // existing subscription is returned with alreadySubscribed=true rather than duplicated.
  // Capture contact details from inside a conversation. The widget can be used before sign-in, so
  // auth is optional — but a conversation that belongs to an account is only editable by it.
  router.patch('/api/v1/ai-support/conversations/:id/contact', async (ctx) => {
    const body = await ctx.validate(v.object({
      name: v.string().trim().min(2).max(160),
      email: v.string().trim().toLowerCase().email(),
    }));
    const auth = await authenticate(ctx, { ...deps, allowMissing: true });

    const conv = await store.table('ai_support_conversations').findById(ctx.params.id);
    if (!conv) throw new NotFoundError('Conversation not found');
    if (conv.user_id && conv.user_id !== auth?.id) throw new NotFoundError('Conversation not found');

    const email = body.email.toLowerCase();
    await store.table('ai_support_conversations').updateById(conv.id, {
      visitor_name: body.name, visitor_email: email, updated_at: new Date().toISOString(),
    });

    // Still waiting on the AI (or escalated but unassigned) — tell the human queue who to contact.
    if (conv.status !== 'AI_ACTIVE' && conv.user_id) {
      await store.table('notifications').insert({
        id: uuidv7(), user_id: conv.user_id,
        title: 'CloudHost247 Support has your contact details',
        body: `We recorded ${email} on your support conversation and a representative will follow up.`,
      });
    }

    if (auth) {
      await store.table('audit_logs').insert({
        id: uuidv7(), actor_id: auth.id, actor_role: auth.role, action: 'SUPPORT_CONTACT_DETAILS_CAPTURED',
        entity_type: 'ai_support_conversation', entity_id: conv.id,
        ip_address: ctx.ip, user_agent: ctx.userAgent, after: null,
      });
    }
    ctx.json({ saved: true });
  });

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
  // staff/admin/super_admin. The assistant answers from the reviewed catalogue and
  // escalates the rest; a human agent replies directly through the routes below.
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

  /**
   * Hand a conversation to the human queue.
   *
   * The escalation is only allowed to say "a human will follow up" because it makes that true: an
   * available agent is assigned when one exists, the reason is recorded on the conversation, and for
   * a signed-in customer a real `support_tickets` row is created carrying the customer's own first
   * message into the queue that already exists. When nobody is available the conversation waits in
   * the queue and the reply says so, rather than promising an agent who is not there.
   */
  async function escalate(ctx, conversation, reason) {
    const availability = await supportAvailability(store);
    const assignedAgentId = conversation.assigned_agent_id ?? availability.availableAgentIds[0] ?? null;
    const priority = HIGH_PRIORITY_REASONS.includes(reason) ? 'high' : 'normal';
    const now = () => new Date().toISOString();
    let ticketId = conversation.support_ticket_id ?? null;

    if (assignedAgentId && assignedAgentId !== conversation.assigned_agent_id) {
      await store.table('notifications').insert({
        id: uuidv7(), user_id: assignedAgentId,
        title: 'New AI support escalation',
        body: `A support conversation was escalated to you (${reason.replaceAll('_', ' ').toLowerCase()}).`,
      });
    }

    if (!ticketId && conversation.user_id) {
      const first = (await store.table('ai_support_messages')
        .find({ conversation_id: conversation.id, role: 'user' }, { orderBy: 'created_at', limit: 1 })).rows[0];
      const reference = `TCK-${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
      const ticket = await store.table('support_tickets').insert({
        id: uuidv7(), reference, user_id: conversation.user_id,
        subject: `AI support escalation: ${reason.replaceAll('_', ' ').toLowerCase()}`.slice(0, 200),
        department: REASON_DEPARTMENT[reason] ?? 'general', priority, status: 'open',
      });
      await store.table('support_ticket_messages').insert({
        id: uuidv7(), ticket_id: ticket.id, author_id: conversation.user_id, author_role: 'customer',
        body: `Transferred from the CloudHost247 support assistant (reason: ${reason}).\n\n${first?.content ?? 'Please review the attached support conversation.'}`,
      });
      await store.table('support_tickets').updateById(ticket.id, { last_reply_at: now() });
      ticketId = ticket.id;
    }

    const status = assignedAgentId ? 'ASSIGNED' : 'WAITING_FOR_HUMAN';
    // The sentence the customer reads depends on which of those two is true. "A representative will
    // follow up" is only allowed to be said when a representative actually has it.
    const body = assignedAgentId
      ? 'I have transferred this conversation to CloudHost247 Support — a representative has been assigned and can see the full transcript, so you do not need to repeat anything.'
      : 'CloudHost247 Support is not available right now, so I have left this conversation in the support queue rather than claim someone is on it. The transcript is saved and the team will follow up.';
    await store.table('ai_support_conversations').updateById(conversation.id, {
      status,
      escalation_reason: reason,
      last_message_at: now(),
      escalation_note: assignedAgentId
        ? 'Assigned to the available CloudHost247 support queue.'
        : 'Waiting for the CloudHost247 support queue.',
      assigned_agent_id: assignedAgentId,
      support_ticket_id: ticketId,
      priority,
      updated_at: now(),
    });

    return {
      status, assignedAgentId, ticketId, priority, body,
      availability: availability.status,
      // Nobody to reach the visitor at — the widget asks for a name and email instead of assuming.
      requiresContact: !conversation.user_id && !conversation.visitor_email,
    };
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

  // The reviewed catalogue itself — code-owned. The admin surface can read it; nothing here can edit
  // it, so a support answer cannot be changed without a code review.
  router.get('/api/v1/admin/ai-support/knowledge', async (ctx) => {
    await asStaff(ctx, deps);
    const knowledge = listSupportKnowledge();
    ctx.json({
      knowledge: knowledge.map((entry) => ({
        id: entry.id, intent: entry.intent, title: entry.title, topic: entry.title,
        keywords: [...entry.keywords], summary: entry.answer, answer: entry.answer,
        source: entry.source, weight: entry.weight ?? 0,
      })),
      editable: false,
      note: 'Reviewed in code. Answers are retrieved verbatim from this catalogue; the assistant escalates instead of composing anything of its own.',
    });
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
      messages: messages.map((m) => ({
        id: m.id, senderType: m.role, message: m.content, createdAt: m.created_at,
        // Why the assistant said it: visible to the agent who inherits the conversation.
        intent: m.intent ?? null,
        confidence: m.confidence === null || m.confidence === undefined ? null : Number(m.confidence),
        sources: Array.isArray(m.knowledge_sources) ? m.knowledge_sources : [],
      })),
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
