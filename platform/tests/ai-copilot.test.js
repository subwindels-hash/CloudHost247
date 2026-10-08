/**
 * The Copilot — deterministic answers from real rows, and honest refusals everywhere else.
 *
 * This suite exists to defend one property above all: **every sentence the assistant produces is
 * traceable to a row, and where there is no row it says so.** So the tests seed real records in the
 * real tables, ask the routes the way a person would, and assert that the numbers, names and dates in
 * the reply are the ones that were seeded — and that a prompt matching no intent produces the
 * supported-command list rather than a plausible-sounding paragraph.
 *
 * The refusal cases are asserted as carefully as the happy ones: an empty table must read as "zero
 * rows from a real query", a broken query must not be papered over, and one customer must never see
 * another customer's data.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { startServer, jsonFetch, register } = require('./helpers');
const { uuidv7 } = require('../src/lib/ids');

const JWT_SECRET = 'ai-copilot-test-secret-value-32-chars';

async function staffToken(base, app, email = 'copilot-staff@example.com', role = 'admin') {
  await register(base, email, 'SuperSecret123!');
  const user = await app.store.table('users').findOne({ email });
  await app.store.table('users').updateById(user.id, { role, full_name: 'Copilot Tester' });
  const login = await jsonFetch(base, { path: '/api/v1/auth/login', method: 'POST', body: { email, password: 'SuperSecret123!' } });
  return { token: login.data.accessToken, userId: user.id };
}

async function customerToken(base, app, email = 'copilot-customer@example.com') {
  await register(base, email, 'SuperSecret123!');
  const user = await app.store.table('users').findOne({ email });
  const login = await jsonFetch(base, { path: '/api/v1/auth/login', method: 'POST', body: { email, password: 'SuperSecret123!' } });
  return { token: login.data.accessToken, userId: user.id };
}

const ask = (base, token, prompt) => jsonFetch(base, { path: '/api/v1/admin/ai/copilot', method: 'POST', body: { prompt } }, token);
const tell = (base, token, message) => jsonFetch(base, { path: '/api/v1/account/ai/assistant', method: 'POST', body: { message } }, token);

/**
 * A deployment fixture whose rows are the only source of the numbers the tests look for.
 *
 * The customer is created by a real registration, so the same account can then sign in and ask the
 * customer assistant — the suite never fabricates a login it could not otherwise perform.
 */
async function seedPlatformData(app, base, { customerEmail = 'seeded-customer@example.com' } = {}) {
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();

  await register(base, customerEmail, 'SuperSecret123!');
  const customer = await app.store.table('users').findOne({ email: customerEmail });

  await app.store.table('payments').insert({
    id: uuidv7(), user_id: customer.id, gateway: 'stripe', currency: 'USD', amount: 4200,
    status: 'failed', rejection_reason: 'card_declined: insufficient funds', created_at: iso(now - 3_600_000),
  });
  await app.store.table('invoices').insert({
    id: uuidv7(), user_id: customer.id, number: 'INV-9001', currency: 'USD', subtotal: 5000,
    total: 5000, amount_paid: 0, status: 'unpaid', issued_at: iso(now - 40 * 86_400_000),
    due_at: iso(now - 10 * 86_400_000),
  });
  await app.store.table('subscriptions').insert({
    id: uuidv7(), user_id: customer.id, plan_id: 'plan-vps-2', billing_cycle: 'monthly', status: 'past_due',
    past_due_since: iso(now - 5 * 86_400_000), current_period_end: iso(now + 20 * 86_400_000),
    cancel_at_period_end: false,
  });
  await app.store.table('support_tickets').insert({
    id: uuidv7(), reference: 'TCK-000042', user_id: customer.id, subject: 'VPS unreachable after reboot',
    department: 'technical', priority: 'high', status: 'open', created_at: iso(now - 30 * 3_600_000),
  });

  const server = await app.store.table('servers').insert({
    id: uuidv7(), user_id: customer.id, name: 'web-1', hostname: 'web-1.example.net', status: 'degraded',
  });
  await app.store.table('server_metrics').insert({
    id: uuidv7(), server_id: server.id, cpu_percent: 97.5, memory_percent: 41, disk_percent: 22,
    load_average: 12.4, collected_at: iso(now - 60_000),
  });

  await app.store.table('deployments').insert({
    id: uuidv7(), ref: 'dep-1', user_id: customer.id, server_id: server.id, action: 'deploy_wordpress',
    status: 'failed', attempts: 3, max_attempts: 3, error_code: 'PROVIDER_TIMEOUT',
    error_message: 'The provider did not answer within 30s', created_at: iso(now - 5 * 3_600_000),
    completed_at: iso(now - 4 * 3_600_000),
  });
  await app.store.table('deployments').insert({
    id: uuidv7(), ref: 'dep-2', user_id: customer.id, server_id: server.id, action: 'install_cpanel',
    status: 'running', attempts: 1, max_attempts: 3, created_at: iso(now - 3 * 3_600_000),
  });
  await app.store.table('provisioning_jobs').insert({
    id: uuidv7(), user_id: customer.id, kind: 'transfer_domain', resource_type: 'domain_transfers',
    resource_id: uuidv7(), status: 'queued', attempts: 0, created_at: iso(now - 2 * 3_600_000),
  });

  await app.store.table('ssl_certificates').insert({
    id: uuidv7(), user_id: customer.id, domain_name: 'shop.example.com', status: 'issued',
    expires_at: iso(now + 9 * 86_400_000), auto_renew: false,
  });
  await app.store.table('customer_domains').insert({
    id: uuidv7(), user_id: customer.id, domain: 'shop.example.com', status: 'active',
    expires_at: iso(now + 12 * 86_400_000), auto_renew: true,
  });

  // Nine failures from one IP, and four against one account from three IPs — both above threshold.
  for (let i = 0; i < 9; i += 1) {
    await app.store.table('auth_audit_log').insert({
      id: uuidv7(), user_id: customer.id, event_type: 'login_failed', ip_address: '203.0.113.66',
      created_at: iso(now - i * 60_000),
    });
  }
  for (const ip of ['198.51.100.1', '198.51.100.2', '198.51.100.3']) {
    await app.store.table('auth_audit_log').insert({
      id: uuidv7(), user_id: customer.id, event_type: 'login_failed', ip_address: ip,
      created_at: iso(now - 30 * 60_000),
    });
  }

  await app.store.table('ai_registry').insert({
    id: uuidv7(), slug: 'incident-9001', name: 'Registry latency', kind: 'incident', status: 'open',
    metadata: { severity: 'high', notes: ['paging on-call'] },
  });
  await app.store.table('ai_support_knowledge').insert({
    id: uuidv7(), title: 'Resetting your account password',
    body: 'Use the Forgot password link on the sign-in page, then follow the emailed reset link within 30 minutes.',
  });

  return { customer, server };
}

// ============================================================================ admin answers

test('the Copilot answers from real rows, and says what it is looking at', async (t) => {
  const harness = await startServer({ JWT_SECRET });
  const { base, app, close } = harness;
  t.after(() => close());

  const { token } = await staffToken(base, app);
  const { customer, server } = await seedPlatformData(app, base);

  // --- billing -----------------------------------------------------------------
  const failed = await ask(base, token, "show today's failed payments");
  assert.strictEqual(failed.status, 200, JSON.stringify(failed.data));
  assert.strictEqual(failed.data.intent, 'billing.failed_payments');
  assert.strictEqual(failed.data.confidence, 'exact');
  assert.match(failed.data.reply, /seeded-customer@example\.com/);
  assert.match(failed.data.reply, /4200 USD/);
  assert.match(failed.data.reply, /card_declined: insufficient funds/, 'the recorded reason is quoted');
  assert.deepStrictEqual(failed.data.evidence.map((e) => e.query), ['list_failed_payments']);
  assert.strictEqual(failed.data.evidence[0].count, 1);

  const overdue = await ask(base, token, 'find customers with overdue invoices');
  assert.strictEqual(overdue.data.intent, 'billing.overdue_invoices');
  assert.match(overdue.data.reply, /INV-9001/);
  assert.match(overdue.data.reply, /10 day\(s\) overdue/, 'days overdue is computed from the stored due date');
  assert.match(overdue.data.reply, /seeded-customer@example\.com/);

  const revenue = await ask(base, token, 'revenue summary');
  assert.strictEqual(revenue.data.intent, 'billing.revenue_summary');
  assert.match(revenue.data.reply, /Failed payments \(30d\): 4200 across 1 attempt\(s\)/);
  // The figure must always arrive with the sentence that defines it.
  assert.match(revenue.data.reply, /Methodology: sum of payments rows with status succeeded\/confirmed/);
  assert.match(revenue.data.reply, /no inferred MRR/, 'the answer refuses to imply a projection');

  // --- infrastructure ----------------------------------------------------------
  const health = await ask(base, token, 'show servers with abnormal cpu');
  assert.strictEqual(health.data.intent, 'infrastructure.server_health');
  assert.match(health.data.reply, /1 of 1 servers carry a health flag/);
  assert.match(health.data.reply, /web-1/);
  assert.match(health.data.reply, /high_cpu/);
  assert.match(health.data.reply, /status_degraded/);
  assert.match(health.data.reply, /Thresholds: cpu ≥ 90%/, 'the threshold that produced the flag is printed');

  const stuck = await ask(base, token, 'show stuck provisioning');
  assert.strictEqual(stuck.data.intent, 'infrastructure.stuck_provisioning');
  assert.match(stuck.data.reply, /install_cpanel/);
  assert.match(stuck.data.reply, /transfer_domain/, 'provisioning jobs are covered as well as deployments');

  const deployments = await ask(base, token, 'show failed deployments');
  assert.strictEqual(deployments.data.intent, 'infrastructure.failed_deployments');
  assert.match(deployments.data.reply, /deploy_wordpress/);
  assert.match(deployments.data.reply, /PROVIDER_TIMEOUT/);

  const ssl = await ask(base, token, 'show expiring ssl certificates');
  assert.match(ssl.data.reply, /shop\.example\.com/);
  assert.match(ssl.data.reply, /9 day\(s\)/);
  assert.match(ssl.data.reply, /auto-renew false/);

  const domains = await ask(base, token, 'show expiring domains');
  assert.match(domains.data.reply, /shop\.example\.com/);
  assert.match(domains.data.reply, /12 day\(s\)/);

  // --- support, sales, security, incidents ------------------------------------
  const tickets = await ask(base, token, 'summarize unresolved support tickets');
  assert.match(tickets.data.reply, /VPS unreachable after reboot/);
  assert.match(tickets.data.reply, /open\/high/);
  assert.match(tickets.data.reply, /30h old/);

  const risk = await ask(base, token, 'show subscriptions with cancellation risk');
  assert.match(risk.data.reply, /Past-due subscriptions: 1/);
  assert.match(risk.data.reply, /No churn score is computed/, 'the answer names what it will not invent');

  const anomalies = await ask(base, token, 'show login anomalies');
  assert.match(anomalies.data.reply, /203\.0\.113\.66 — 9 failures across 1 account\(s\)/);
  // The account cluster aggregates that account's failures across every source IP — 9 + 3 = 12
  // from 4 addresses — which is what the stored rows say.
  assert.match(anomalies.data.reply, /seeded-customer@example\.com — 12 failures from 4 IP\(s\)/);
  assert.match(anomalies.data.reply, /not a conclusion about the account/);

  const incidents = await ask(base, token, 'show incidents');
  assert.match(incidents.data.reply, /incident-9001 — Registry latency — high\/open/);

  const overview = await ask(base, token, 'platform overview');
  assert.strictEqual(overview.data.intent, 'platform.overview');
  assert.match(overview.data.reply, /Customers: 1 \(1 active\)/);
  assert.match(overview.data.reply, /Support: 1 open ticket\(s\), 1 new/);
  assert.match(overview.data.reply, /Billing: 1 unpaid invoice\(s\), 1 overdue/);

  const briefing = await ask(base, token, 'prepare an executive briefing');
  assert.strictEqual(briefing.data.intent, 'board.briefing_hint');
  assert.match(briefing.data.reply, /POST \/api\/v1\/admin\/ai\/board\/briefings/);
  assert.match(briefing.data.reply, /will not write a briefing nobody produced/);

  // A predictive question still routes to the risk list — and is told, in the answer itself, that no
  // prediction was made. That is the boundary the Copilot draws rather than a number it invents.
  const prediction = await ask(base, token, 'what will our churn be next quarter?');
  assert.strictEqual(prediction.data.intent, 'sales.subscription_risk');
  assert.match(prediction.data.reply, /No churn score is computed/);
  assert.ok(!/next quarter (will|is expected)/i.test(prediction.data.reply));

  // The interaction is recorded either way, with the evidence it used.
  const events = await app.store.table('ai_registry').all();
  const copilotEvents = events.filter((row) => String(row.slug).startsWith('copilot-'));
  assert.strictEqual(copilotEvents.length, 15, 'every answer is recorded');
  assert.strictEqual(copilotEvents[0].metadata.intent, 'billing.failed_payments');
  assert.ok(copilotEvents[0].metadata.evidence.length >= 1, 'the evidence trail is stored, not just displayed');
  assert.strictEqual(copilotEvents[0].metadata.actorId, (await app.store.table('users').findOne({ email: 'copilot-staff@example.com' })).id);
  assert.strictEqual(server.status, 'degraded');
  assert.strictEqual(customer.role, 'customer');
});

test('the Copilot refuses to improvise, and reports empty results as empty', async (t) => {
  const harness = await startServer({ JWT_SECRET });
  const { base, app, close } = harness;
  t.after(() => close());

  const { token } = await staffToken(base, app);

  // An unrouted prompt: no answer, the vocabulary it does have, and nothing that looks like a fact.
  const unsupported = await ask(base, token, 'write a haiku about our uptime last month');
  assert.strictEqual(unsupported.status, 200);
  assert.strictEqual(unsupported.data.intent, 'unsupported');
  assert.strictEqual(unsupported.data.confidence, 'none');
  assert.match(unsupported.data.reply, /I will not guess/);
  assert.ok(Array.isArray(unsupported.data.supported) && unsupported.data.supported.length >= 10);
  assert.ok(unsupported.data.supported.includes('revenue summary'));
  assert.ok(!/\d{2,}/.test(unsupported.data.reply), 'an unsupported prompt produces no figures at all');
  assert.strictEqual(unsupported.data.evidence.length, 0);

  // Empty tables are not an error and not an answer: they are zero rows from a real query.
  const failed = await ask(base, token, 'failed payments');
  assert.match(failed.data.reply, /none found \(real query, zero rows\)/);
  assert.strictEqual(failed.data.evidence[0].count, 0);

  const health = await ask(base, token, 'unhealthy servers');
  assert.match(health.data.reply, /0 of 0 servers carry a health flag/);
  assert.match(health.data.reply, /No server currently carries a flag/);

  const anomalies = await ask(base, token, 'brute force');
  assert.match(anomalies.data.reply, /No clusters above threshold/);

  // A recorded interaction for the unsupported prompt too — a gap in the vocabulary is visible.
  const events = (await app.store.table('ai_registry').all()).filter((row) => String(row.slug).startsWith('copilot-'));
  assert.strictEqual(events.length, 4);
  // Three empty-table answers and one unrouted prompt: the refusal is recorded with the same care as
  // the answer, because an unsupported command is a gap in the vocabulary someone maintains.
  assert.strictEqual(events.filter((row) => row.status === 'answered').length, 3);
  assert.strictEqual(events.filter((row) => row.status === 'unsupported').length, 1);
  const recorded = events.find((row) => row.status === 'answered');
  assert.ok(recorded.metadata.evidence.every((entry) => entry.status === 'executed'));
});

test('the admin Copilot is staff-only', async (t) => {
  const harness = await startServer({ JWT_SECRET });
  const { base, app, close } = harness;
  t.after(() => close());

  // Anonymous.
  const anon = await jsonFetch(base, { path: '/api/v1/admin/ai/copilot', method: 'POST', body: { prompt: 'revenue summary' } });
  assert.strictEqual(anon.status, 401);

  // A customer is not staff.
  const { token } = await customerToken(base, app);
  const denied = await ask(base, token, 'revenue summary');
  assert.strictEqual(denied.status, 403, JSON.stringify(denied.data));

  // Staff is allowed — the role on the row is what decides, not the caller's claim.
  const staff = await staffToken(base, app, 'copilot-staff2@example.com', 'staff');
  const allowed = await ask(base, staff.token, 'platform overview');
  assert.strictEqual(allowed.status, 200, JSON.stringify(allowed.data));
});

// ============================================================================ customer assistant

test('the customer assistant answers from the customer\'s own rows only', async (t) => {
  const harness = await startServer({ JWT_SECRET });
  const { base, app, close } = harness;
  t.after(() => close());

  const { customer } = await seedPlatformData(app, base, { customerEmail: 'alice@example.com' });
  const alice = await customerToken(base, app, 'alice@example.com');
  const bob = await customerToken(base, app, 'bob@example.com');

  // Give Bob his own invoice, so a leak has something to leak.
  await app.store.table('invoices').insert({
    id: uuidv7(), user_id: bob.userId, number: 'INV-BOB-1', currency: 'USD', subtotal: 1234,
    total: 1234, amount_paid: 0, status: 'unpaid', issued_at: new Date().toISOString(),
    due_at: new Date(Date.now() - 86_400_000).toISOString(),
  });

  const aliceInvoices = await tell(base, alice.token, 'check my invoices');
  assert.strictEqual(aliceInvoices.status, 200, JSON.stringify(aliceInvoices.data));
  assert.strictEqual(aliceInvoices.data.intent, 'customer.invoices');
  assert.match(aliceInvoices.data.reply, /INV-9001/);
  assert.ok(!aliceInvoices.data.reply.includes('INV-BOB-1'), "another customer's invoice must never appear");
  assert.ok(!aliceInvoices.data.reply.includes('seeded-customer@example.com'), 'and neither must their email');

  const bobInvoices = await tell(base, bob.token, 'check my invoices');
  assert.match(bobInvoices.data.reply, /INV-BOB-1/);
  assert.ok(!bobInvoices.data.reply.includes('INV-9001'));

  // The profile-based intents are scoped the same way.
  const billing = await tell(base, alice.token, 'my failed payment status');
  assert.strictEqual(billing.data.intent, 'customer.billing_status');
  assert.match(billing.data.reply, /Unpaid invoice\(s\): 1 \(1 overdue\) — outstanding total 5000 USD/);
  assert.match(billing.data.reply, /Failed payment attempt\(s\) in the last 30 days: 1/);

  const domains = await tell(base, alice.token, 'my domains');
  assert.match(domains.data.reply, /shop\.example\.com/);
  assert.match(domains.data.reply, /12 day\(s\)/);

  const ssl = await tell(base, alice.token, 'my ssl certificates');
  assert.match(ssl.data.reply, /shop\.example\.com/);

  const tickets = await tell(base, alice.token, 'my support tickets');
  assert.strictEqual(tickets.data.intent, 'customer.tickets');
  assert.match(tickets.data.reply, /You have 1 open support ticket\(s\) out of 1 total/);

  const activity = await tell(base, alice.token, 'what has the ai done on my account');
  assert.strictEqual(activity.data.intent, 'customer.ai_activity');
  assert.match(activity.data.reply, /AI activity on your account/);

  const services = await tell(base, alice.token, 'my services and subscriptions');
  assert.strictEqual(services.data.intent, 'customer.subscriptions');
  assert.match(services.data.reply, /0 active service\(s\), 1 domain\(s\), 0 active subscription\(s\), 1 at risk/);
  assert.match(services.data.reply, /past_due/);

  assert.strictEqual((await app.store.table('invoices').all()).filter((row) => row.user_id === customer.id).length, 1);
});

test('the customer assistant opens a real ticket only when asked, and refuses to guess otherwise', async (t) => {
  const harness = await startServer({ JWT_SECRET });
  const { base, app, close } = harness;
  t.after(() => close());

  const { token, userId } = await customerToken(base, app, 'assistant-customer@example.com');
  await app.store.table('ai_support_knowledge').insert({
    id: uuidv7(), title: 'Resetting your account password',
    body: 'Use the Forgot password link on the sign-in page, then follow the emailed reset link within 30 minutes.',
  });

  // The prompt form first: it does not create anything, it asks for the details.
  const prompt = await tell(base, token, 'I need to open a ticket');
  assert.strictEqual(prompt.data.intent, 'customer.open_ticket_prompt');
  assert.match(prompt.data.reply, /Reply with the subject and a description/);
  assert.strictEqual((await app.store.table('support_tickets').all()).length, 0, 'nothing was created by the prompt');

  // The explicit form creates a real ticket in the real queue, with the customer as the author.
  const created = await tell(base, token, 'open ticket: my VPS has been unreachable since the reboot this morning');
  assert.strictEqual(created.data.intent, 'customer.open_ticket');
  assert.match(created.data.reply, /Your support ticket is open \(reference TCK-/);

  const tickets = await app.store.table('support_tickets').all();
  assert.strictEqual(tickets.length, 1);
  assert.strictEqual(tickets[0].user_id, userId);
  assert.strictEqual(tickets[0].status, 'open');
  assert.match(tickets[0].subject, /my VPS has been unreachable/);
  const messages = await app.store.table('support_ticket_messages').all();
  assert.strictEqual(messages.length, 1);
  assert.strictEqual(messages[0].author_role, 'customer');
  assert.match(messages[0].body, /Customer request via Cloud Assistant/);

  // A too-short request is not silently turned into a ticket with a guessed subject.
  const tooShort = await tell(base, token, 'open ticket: help');
  assert.notStrictEqual(tooShort.data.intent, 'customer.open_ticket');
  assert.strictEqual((await app.store.table('support_tickets').all()).length, 1);

  // Documentation questions are answered from the knowledge base, with the article named...
  const knowledge = await tell(base, token, 'how do I reset my account password?');
  assert.strictEqual(knowledge.data.intent, 'customer.knowledge');
  assert.match(knowledge.data.reply, /Based on CloudHost247 documentation/);
  assert.match(knowledge.data.reply, /Forgot password link/);
  assert.match(knowledge.data.reply, /Resetting your account password/, 'the citation names the article');

  // ...and an undocumented question is refused rather than answered from thin air.
  const unknown = await tell(base, token, 'what is your internal escalation policy for datacentre outages in Lagos?');
  assert.strictEqual(unknown.data.intent, 'customer.knowledge');
  assert.match(unknown.data.reply, /I couldn't find documentation answering that/);
  assert.match(unknown.data.reply, /I won't guess/);

  // A message with no intent at all lists what the assistant can do.
  const unsupported = await tell(base, token, 'hi there');
  assert.strictEqual(unsupported.data.intent, 'unsupported');
  assert.strictEqual(unsupported.data.confidence, 'none');
  assert.ok(unsupported.data.supported.includes('my invoices / check invoice / unpaid balance'));

  // Every interaction — answered, refused or unsupported — is recorded against the customer.
  const events = (await app.store.table('ai_registry').all()).filter((row) => String(row.slug).startsWith('assistant-'));
  assert.strictEqual(events.length, 6);
  assert.ok(events.every((row) => row.metadata.userId === userId));
});

test('a failing query is reported, never smoothed over', async (t) => {
  const harness = await startServer({ JWT_SECRET });
  const { base, app, close } = harness;
  t.after(() => close());

  const { token } = await staffToken(base, app);
  const { resolveAdminCommand } = require('../src/lib/ai-copilot');

  // A store whose payments table refuses to read stands in for a broken backend.
  const brokenStore = {
    table(name) {
      if (name === 'payments') return { all: async () => { throw new Error('relation "payments" does not exist'); } };
      if (name === 'users') return { all: async () => [] };
      return app.store.table(name);
    },
  };

  const result = await resolveAdminCommand(brokenStore, 'failed payments');
  assert.strictEqual(result.confidence, 'exact', 'the intent still matches');
  assert.match(result.answer, /Unable to answer from live data/);
  assert.match(result.answer, /relation "payments" does not exist/, 'the operator sees the real reason');
  assert.match(result.answer, /Nothing was fabricated/);
  assert.strictEqual(result.evidence[0].status, 'failed');
  assert.strictEqual(result.evidence[0].errorCode, 'QUERY_FAILED');
  // No figure from the broken query can appear, because there is no figure to print.
  assert.ok(!/revenue|amount|USD/.test(result.answer), 'nothing resembling a value is invented');

  // The same failure through the route is still a 200 carrying the honest answer, and the event that
  // records it says the query failed rather than claiming an answer.
  const throughRoute = await ask(base, token, 'failed payments');
  assert.strictEqual(throughRoute.status, 200);
  assert.match(throughRoute.data.reply, /none found|Unable to answer/);
});
