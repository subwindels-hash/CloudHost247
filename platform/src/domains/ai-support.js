/**
 * AI support — agents, conversations, messages and the knowledge base.
 *
 * Ported from cloudhost247-node/src/routes/ai-support.ts. The LLM inference itself is an external
 * adapter (deferred); this module stores agents, conversations, messages and knowledge entries and
 * returns a deterministic canned reply so the workflow is testable without a model.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { authenticate, asAdmin } = require('../lib/auth');

const name = 'ai-support';

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
}

module.exports = { name, register };
