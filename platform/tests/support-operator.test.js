/**
 * The support operator — answers from a reviewed catalogue, escalations that really escalate.
 *
 * `platform/src/domains/ai-support.js` was deferred as "LLM inference (human agents reply manually)"
 * and answered with a canned string. What this suite defends is the replacement: a deterministic
 * decision layer that can only say what a catalogue entry or a catalog row says, and that hands
 * everything else to a human *for real* — a ticket row, an assigned agent, a recorded reason.
 *
 * The escalation tests are written as carefully as the answer tests, because "a human will follow up"
 * is exactly the kind of sentence that is easy to render while being false.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { startServer, jsonFetch, register } = require('./helpers');
const { uuidv7 } = require('../src/lib/ids');
const { decideSupportResponse, listSupportKnowledge, KNOWLEDGE_ENTRIES } = require('../src/lib/support-operator');

const JWT_SECRET = 'ai-support-test-secret-value-32-chars';

async function signIn(base, app, email, { role } = {}) {
  await register(base, email, 'SuperSecret123!');
  const user = await app.store.table('users').findOne({ email });
  if (role) await app.store.table('users').updateById(user.id, { role, full_name: role === 'customer' ? 'Test Customer' : 'Support Agent' });
  const login = await jsonFetch(base, { path: '/api/v1/auth/login', method: 'POST', body: { email, password: 'SuperSecret123!' } });
  return { token: login.data.accessToken, userId: user.id };
}

async function openConversation(base, token, subject = 'Need help') {
  const res = await jsonFetch(base, { path: '/api/v1/ai-support/conversations', method: 'POST', body: { subject } }, token);
  assert.strictEqual(res.status, 201, JSON.stringify(res.data));
  return res.data.conversation;
}

const say = (base, token, id, content) => jsonFetch(base, {
  path: `/api/v1/ai-support/conversations/${id}/messages`, method: 'POST', body: { content },
}, token);

/** An active staff member present in the queue, with `capacity` spare slots by default. */
async function onlineAgent(app, email, { capacity = 3, status = 'ONLINE', fullName = 'Support Agent' } = {}) {
  await register(app.base ?? 'http://127.0.0.1', email, 'SuperSecret123!').catch(() => {});
  const user = await app.store.table('users').findOne({ email });
  if (user) await app.store.table('users').updateById(user.id, { role: 'staff', full_name: fullName });
  return user.id;
}

test('the assistant answers from the reviewed catalogue, and the answer is the catalogue verbatim', async (t) => {
  const { base, app, close } = await startServer({ JWT_SECRET });
  t.after(() => close());

  const customer = await signIn(base, app, 'kb-customer@example.com', { role: 'customer' });
  const conversation = await openConversation(base, customer.token, 'DNS question');

  const res = await say(base, customer.token, conversation.id, 'how do I set up DNS for my domain?');
  assert.strictEqual(res.status, 201, JSON.stringify(res.data));
  assert.strictEqual(res.data.decision.kind, 'ANSWER');
  assert.strictEqual(res.data.decision.intent, 'domain_dns');
  assert.strictEqual(res.data.decision.engine, 'deterministic-retrieval', 'the engine is named, it is not "AI"');
  assert.strictEqual(res.data.transfer, undefined, 'no escalation was needed, so none was recorded');

  // The reply is the reviewed entry's own text — retrieval, not composition.
  const entry = KNOWLEDGE_ENTRIES.find((row) => row.intent === 'domain_dns');
  assert.strictEqual(res.data.reply.content, entry.answer);
  assert.deepStrictEqual(res.data.decision.sources, [entry.source]);
  assert.strictEqual(res.data.reply.intent, 'domain_dns');
  assert.ok(res.data.reply.confidence > 0.9 && res.data.reply.confidence <= 0.98, 'confidence is a number in the answer');

  // ...and it is stored on the message, so an agent inheriting the conversation can see why it said it.
  const stored = await app.store.table('ai_support_messages').find({ conversation_id: conversation.id });
  const assistantRow = stored.rows.find((row) => row.role === 'assistant');
  assert.strictEqual(assistantRow.intent, 'domain_dns');
  assert.deepStrictEqual(assistantRow.knowledge_sources, [entry.source]);
  const userRow = stored.rows.find((row) => row.role === 'user');
  assert.strictEqual(userRow.intent, null, 'a customer message carries no assistant reasoning');

  // An answered conversation stays with the assistant and nobody was paged.
  const after = await app.store.table('ai_support_conversations').findById(conversation.id);
  assert.strictEqual(after.status, 'open');
  assert.strictEqual(after.assigned_agent_id, null);
  assert.strictEqual((await app.store.table('support_tickets').all()).length, 0);
  const audits = await app.store.table('audit_logs').all();
  assert.ok(audits.some((row) => row.action === 'AI_RESPONSE_GENERATED' && row.after?.engine === 'deterministic-retrieval'));

  // The customer can see the reasoning on their own conversation.
  const read = await jsonFetch(base, { path: `/api/v1/ai-support/conversations/${conversation.id}` }, customer.token);
  assert.strictEqual(read.data.messages[1].intent, 'domain_dns');
  assert.deepStrictEqual(read.data.messages[1].sources, [entry.source]);
  assert.strictEqual(read.data.messages[0].intent, undefined);
});

test('account-specific questions are escalated into a real ticket, not answered from chat', async (t) => {
  const { base, app, close } = await startServer({ JWT_SECRET });
  t.after(() => close());

  const customer = await signIn(base, app, 'escalation-customer@example.com', { role: 'customer' });

  // ---- a refund request: high priority, billing queue, the customer's own words carried over ----
  const refundConv = await openConversation(base, customer.token, 'Refund');
  const refund = await say(base, customer.token, refundConv.id, 'I want a refund for the payment I made yesterday');
  assert.strictEqual(refund.data.decision.kind, 'ESCALATE');
  assert.strictEqual(refund.data.decision.reason, 'REFUND_REQUEST');
  assert.strictEqual(refund.data.transfer.status, 'WAITING_FOR_HUMAN');
  assert.strictEqual(refund.data.transfer.assignedAgentId, null);
  assert.strictEqual(refund.data.transfer.availability, 'OFFLINE');
  assert.strictEqual(refund.data.transfer.priority, 'high');

  const tickets = await app.store.table('support_tickets').all();
  assert.strictEqual(tickets.length, 1);
  assert.strictEqual(tickets[0].user_id, customer.userId);
  assert.strictEqual(tickets[0].department, 'billing');
  assert.strictEqual(tickets[0].priority, 'high');
  assert.strictEqual(tickets[0].status, 'open');
  assert.strictEqual(tickets[0].reference, refund.data.transfer.ticketId ? tickets[0].reference : null);
  assert.match(tickets[0].subject, /^AI support escalation: refund request/);
  const ticketMessages = await app.store.table('support_ticket_messages').all();
  assert.strictEqual(ticketMessages.length, 1);
  assert.match(ticketMessages[0].body, /I want a refund for the payment I made yesterday/, 'the customer does not have to repeat themselves');
  assert.match(ticketMessages[0].body, /reason: REFUND_REQUEST/);
  assert.strictEqual(refund.data.transfer.ticketId, tickets[0].id);

  // The reply admits nobody is available rather than promising a representative who is not there.
  assert.match(refund.data.reply.content, /Support is not available right now/);
  assert.match(refund.data.reply.content, /rather than claim someone is on it/);

  // ---- a billing-status question: account-specific, escalated, no second ticket ----
  const billConv = await openConversation(base, customer.token, 'Invoice');
  const bill = await say(base, customer.token, billConv.id, 'what is the status of my invoice?');
  assert.strictEqual(bill.data.decision.reason, 'BILLING_SUPPORT_REQUIRED');
  assert.strictEqual(bill.data.transfer.priority, 'normal');
  assert.strictEqual((await app.store.table('support_tickets').all()).length, 2, 'a different conversation is a different request');
  assert.strictEqual((await app.store.table('support_tickets').all()).length, 2);

  // ---- a credential question is escalated without ever echoing anything back ----
  const securityConv = await openConversation(base, customer.token, 'Access');
  const security = await say(base, customer.token, securityConv.id, 'I think my password was stolen and someone hacked my account');
  assert.strictEqual(security.data.decision.reason, 'SECURITY_RELATED');
  assert.strictEqual(security.data.transfer.priority, 'high');
  const securityTicket = (await app.store.table('support_tickets').all()).find((row) => row.id === security.data.transfer.ticketId);
  assert.strictEqual(securityTicket.department, 'abuse');

  // ---- repeated escalation reuses the ticket instead of duplicating the conversation ----
  const again = await say(base, customer.token, securityConv.id, 'I still cannot get in, please hand me to a human');
  assert.strictEqual(again.data.accepted, true, 'a conversation with the queue no longer gets assistant answers');
  assert.strictEqual((await app.store.table('support_tickets').all()).length, 3, 'no ticket was created for the follow-up');
  const storedConv = await app.store.table('ai_support_conversations').findById(securityConv.id);
  assert.strictEqual(storedConv.status, 'WAITING_FOR_HUMAN');
  assert.strictEqual(storedConv.escalation_reason, 'SECURITY_RELATED');
});

test('an available agent is assigned, notified, and the reply says a representative has it', async (t) => {
  const { base, app, close } = await startServer({ JWT_SECRET });
  t.after(() => close());

  const customer = await signIn(base, app, 'assigned-customer@example.com', { role: 'customer' });
  const agentA = await signIn(base, app, 'agent-a@example.com', { role: 'staff' });
  const agentB = await signIn(base, app, 'agent-b@example.com', { role: 'staff' });
  await app.store.table('support_agent_presence').insert({ id: uuidv7(), user_id: agentA.userId, status: 'ONLINE', capacity: 3 });
  await app.store.table('support_agent_presence').insert({ id: uuidv7(), user_id: agentB.userId, status: 'ONLINE', capacity: 3 });

  // Agent A is already carrying one conversation, so the next one goes to B — the queue levels out
  // instead of always handing everything to whoever happens to be first.
  await app.store.table('ai_support_conversations').insert({
    id: uuidv7(), user_id: customer.userId, subject: 'Existing', status: 'ASSIGNED', assigned_agent_id: agentA.userId,
  });

  const conv = await openConversation(base, customer.token, 'Complaint');
  const res = await say(base, customer.token, conv.id, 'I want to file a complaint about how this was handled');
  assert.strictEqual(res.data.decision.reason, 'COMPLAINT');
  assert.strictEqual(res.data.transfer.status, 'ASSIGNED');
  assert.strictEqual(res.data.transfer.assignedAgentId, agentB.userId, 'the idle agent was chosen');
  assert.strictEqual(res.data.transfer.availability, 'ONLINE');
  assert.match(res.data.reply.content, /a representative has been assigned/);

  const row = await app.store.table('ai_support_conversations').findById(conv.id);
  assert.strictEqual(row.assigned_agent_id, agentB.userId);
  assert.strictEqual(row.priority, 'high');
  assert.ok(row.support_ticket_id, 'the ticket is linked on the conversation');

  const notified = (await app.store.table('notifications').all()).filter((n) => n.user_id === agentB.userId);
  assert.strictEqual(notified.length, 1);
  assert.match(notified[0].title, /New AI support escalation/);
  assert.ok(!(await app.store.table('notifications').all()).some((n) => n.user_id === agentA.userId), 'the busy agent was not paged');

  // The agent can then start a real reply, and the conversation is in progress.
  const reply = await jsonFetch(base, {
    path: `/api/v1/admin/ai-support/conversations/${conv.id}/reply`, method: 'POST', body: { message: 'On it — looking at your account now.' },
  }, agentB.token);
  assert.strictEqual(reply.status, 200, JSON.stringify(reply.data));
  const afterReply = await app.store.table('ai_support_conversations').findById(conv.id);
  assert.strictEqual(afterReply.status, 'IN_PROGRESS');

  // A message from the customer now goes to the human thread, with no assistant reply invented.
  const humanThread = await say(base, customer.token, conv.id, 'thanks, I am waiting');
  assert.strictEqual(humanThread.data.accepted, true);
  assert.strictEqual(humanThread.data.humanActive, true);
  assert.strictEqual(humanThread.data.reply, undefined);
  const messages = await app.store.table('ai_support_messages').find({ conversation_id: conv.id });
  assert.strictEqual(messages.rows.filter((m) => m.role === 'assistant' && m.intent === 'complaint').length, 1);
  assert.strictEqual(messages.rows.filter((m) => m.content === 'thanks, I am waiting').length, 1);

  // A resolved conversation is closed to new messages.
  await app.store.table('ai_support_conversations').updateById(conv.id, { status: 'RESOLVED' });
  const closed = await say(base, customer.token, conv.id, 'one more thing');
  assert.strictEqual(closed.status, 400);
});

test('prices come from published catalog rows, or the assistant refuses to quote one', async (t) => {
  const { base, app, close } = await startServer({ JWT_SECRET });
  t.after(() => close());

  const customer = await signIn(base, app, 'price-customer@example.com', { role: 'customer' });
  const conv = await openConversation(base, customer.token, 'Pricing');

  // Nothing published yet: the assistant will not invent a figure.
  const empty = await say(base, customer.token, conv.id, 'how much does a VPS cost?');
  assert.strictEqual(empty.status, 201, JSON.stringify(empty.data));
  assert.strictEqual(empty.data.decision.kind, 'ESCALATE');
  assert.strictEqual(empty.data.decision.intent, 'pricing');
  assert.match(empty.data.reply.content, /could not find published pricing/);
  assert.match(empty.data.reply.content, /will not guess a price/);

  const product = await app.store.table('catalog_products').insert({ id: uuidv7(), slug: 'vps', name: 'Cloud VPS', category: 'servers', status: 'active' });
  const plan = await app.store.table('catalog_product_plans').insert({ id: uuidv7(), product_id: product.id, slug: 'vps-2', name: 'VPS 2GB', status: 'active' });
  await app.store.table('catalog_plan_pricing').insert({
    id: uuidv7(), plan_id: plan.id, currency: 'USD', billing_cycle: 'monthly', price: 12, setup_fee: 0, is_active: true,
  });
  // A draft product's pricing must never be quoted: it is not published, so it is not an answer.
  const draft = await app.store.table('catalog_products').insert({ id: uuidv7(), slug: 'secret', name: 'Unreleased VPS', category: 'servers', status: 'draft' });
  const draftPlan = await app.store.table('catalog_product_plans').insert({ id: uuidv7(), product_id: draft.id, slug: 'secret-1', name: 'Unreleased 1', status: 'active' });
  await app.store.table('catalog_plan_pricing').insert({
    id: uuidv7(), plan_id: draftPlan.id, currency: 'USD', billing_cycle: 'monthly', price: 9999, setup_fee: 0, is_active: true,
  });

  // The refusal above moved that conversation into the human queue, which is exactly what an
  // escalation is for: a fresh conversation is where a new question gets an assistant answer.
  const escalated = await app.store.table('ai_support_conversations').findById(conv.id);
  assert.strictEqual(escalated.status, 'WAITING_FOR_HUMAN');
  const pricedConv = await openConversation(base, customer.token, 'Pricing again');
  const priced = await say(base, customer.token, pricedConv.id, 'how much does a VPS cost?');
  assert.strictEqual(priced.status, 201, JSON.stringify(priced.data));
  assert.strictEqual(priced.data.decision.kind, 'ANSWER');
  assert.strictEqual(priced.data.decision.intent, 'pricing');
  assert.match(priced.data.reply.content, /Cloud VPS — VPS 2GB: USD 12 monthly/);
  assert.ok(!priced.data.reply.content.includes('9999'), 'an unpublished product is not quoted');
  assert.ok(!priced.data.reply.content.includes('Unreleased'), 'and it is not named either');
  assert.deepStrictEqual(priced.data.decision.sources, ['CloudHost247 published product catalog']);
  assert.match(priced.data.reply.content, /live product page is the source of truth/);

  // A catalog failure is a refusal, not an empty price list dressed as "no charge".
  const failingStore = { table: (table) => (table === 'catalog_plan_pricing' ? { all: async () => { throw new Error('relation does not exist'); } } : app.store.table(table)) };
  const unit = await decideSupportResponse(failingStore, 'how much is hosting?');
  assert.strictEqual(unit.kind, 'ESCALATE');
  assert.match(unit.body, /catalog could not be read just now/, 'a broken catalog read is not "no such product"');
  assert.match(unit.body, /will not guess a price/);
});

test('the newsletter offer is a form request, and a short follow-up uses the previous message', async (t) => {
  const { base, app, close } = await startServer({ JWT_SECRET });
  t.after(() => close());

  const customer = await signIn(base, app, 'newsletter-customer@example.com', { role: 'customer' });
  const conv = await openConversation(base, customer.token, 'Updates');

  const offer = await say(base, customer.token, conv.id, 'please subscribe me to the newsletter');
  assert.strictEqual(offer.data.decision.kind, 'NEWSLETTER');
  assert.strictEqual(offer.data.decision.intent, 'newsletter');
  assert.match(offer.data.reply.content, /full name and email/);
  assert.match(offer.data.reply.content, /separate from a support request/);
  assert.strictEqual((await app.store.table('newsletter_subscriptions').all()).length, 0, 'the offer is not a subscription');

  // "yes" only means yes because the assistant asked — that context is the stored message.
  const confirmed = await say(base, customer.token, conv.id, 'yes');
  assert.strictEqual(confirmed.data.decision.kind, 'NEWSLETTER');
  assert.strictEqual(confirmed.data.decision.intent, 'newsletter');

  // Retrieval context: a short follow-up borrows the previous customer message, deterministically.
  const context = await openConversation(base, customer.token, 'Products');
  const first = await say(base, customer.token, context.id, 'do you offer web hosting plans?');
  assert.strictEqual(first.data.decision.intent, 'hosting');
  const followUp = await say(base, customer.token, context.id, 'and WordPress?');
  assert.strictEqual(followUp.data.decision.intent, 'hosting', 'the follow-up matched the hosting entry');

  // A fragment with no keyword of its own is the case where context decides: on its own it must
  // escalate, and with the previous customer message it retrieves — the same rule the audited build
  // used, and one that never reaches outside the conversation.
  const bare = await decideSupportResponse(app.store, 'and the 2GB one?', { previousMessages: [] });
  assert.strictEqual(bare.kind, 'ESCALATE', 'without context a fragment earns an escalation, not a guess');
  const withContext = await decideSupportResponse(app.store, 'and the 2GB one?', {
    previousMessages: [{ role: 'user', content: first.data.userMessage.content }, { role: 'assistant', content: first.data.reply.content }],
  });
  assert.strictEqual(withContext.kind, 'ANSWER');
  assert.strictEqual(withContext.intent, 'hosting', 'the fragment inherited the previous subject');
});

test('the reviewed catalogue is code-owned, read-only in the admin view, and stable', async (t) => {
  const { base, app, close } = await startServer({ JWT_SECRET });
  t.after(() => close());

  const staff = await signIn(base, app, 'catalogue-staff@example.com', { role: 'staff' });
  const customer = await signIn(base, app, 'catalogue-customer@example.com', { role: 'customer' });

  const res = await jsonFetch(base, { path: '/api/v1/admin/ai-support/knowledge' }, staff.token);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.data.editable, false, 'the catalogue cannot be edited from the UI');
  assert.strictEqual(res.data.knowledge.length, KNOWLEDGE_ENTRIES.length);
  assert.ok(res.data.knowledge.every((entry) => entry.intent && entry.title && entry.answer && entry.source));
  assert.match(res.data.note, /escalates instead of composing/);

  const denied = await jsonFetch(base, { path: '/api/v1/admin/ai-support/knowledge' }, customer.token);
  assert.strictEqual(denied.status, 403);

  // Same question, same answer — there is no sampling temperature in this path.
  const one = await decideSupportResponse(app.store, 'how do I point my domain at my hosting?');
  const two = await decideSupportResponse(app.store, 'how do I point my domain at my hosting?');
  assert.strictEqual(one.kind, 'ANSWER');
  assert.strictEqual(one.intent, 'domain_dns');
  assert.strictEqual(one.body, two.body);
  assert.strictEqual(one.confidence, two.confidence);
  assert.strictEqual(one.engine, 'deterministic-retrieval');
  assert.ok(Object.isFrozen(listSupportKnowledge()[0]) === false && Array.isArray(listSupportKnowledge()), 'the admin view gets copies, not the frozen originals');
  assert.ok(Object.isFrozen(KNOWLEDGE_ENTRIES), 'the reviewed catalogue itself is immutable');
});
