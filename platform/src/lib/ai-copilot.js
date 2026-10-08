/**
 * The Copilot — deterministic intent routing over real platform data.
 *
 * Ported from `cloudhost247-node/src/ai-os/copilot/intents.ts`, and the reason it is deterministic is
 * the whole point of the module: the audited build's Copilot has **no language model behind it**.
 * A command matches a registered intent, the intent runs a real query, and the answer is rendered
 * from those rows. A command that matches nothing gets `confidence: 'none'` and the list of what is
 * supported — never an improvised answer, and never a plausible-sounding number.
 *
 * That property is what makes the assistant safe to put in front of a customer's billing records:
 * every sentence it can produce is traceable to a row, and the code that decides what to say is
 * small enough to read.
 *
 * The platform's module was deferred as "requires a model adapter, prompt recorded". This is the
 * completion of it: the capability the audited build actually shipped, wired to this platform's own
 * tables, refusing by name where it has nothing to say.
 */
'use strict';

const data = require('./ai-copilot-data');

/** The command vocabulary the admin Copilot actually implements, shown when nothing matches. */
const ADMIN_SUPPORTED = Object.freeze([
  'show today\'s failed payments',
  'find customers with overdue invoices',
  'show servers with abnormal cpu / unhealthy servers',
  'summarize unresolved support tickets',
  'show subscriptions with cancellation risk (churn)',
  'show stuck provisioning / deployments',
  'show failed deployments',
  'show expiring ssl certificates',
  'show expiring domains',
  'show security / login anomalies',
  'show incidents',
  'revenue summary',
  'platform overview',
  'prepare an executive briefing',
]);

/** The customer assistant's vocabulary. */
const CUSTOMER_SUPPORTED = Object.freeze([
  'my invoices / check invoice / unpaid balance',
  'my failed payments / billing status',
  'my services & subscriptions',
  'my domains (incl. expiry)',
  'my ssl certificates (incl. expiry)',
  'my support tickets / ticket status',
  'open ticket: <your issue>',
  'what has the ai done on my account',
  'help: <question> (knowledge base)',
]);

// ============================================================================ rendering helpers
// Values come from executed queries; these helpers describe those outcomes and invent nothing.

function listLines(heading, rows, line, empty) {
  if (rows.length === 0) return `${heading}: ${empty}`;
  const rendered = rows.slice(0, 25).map((row) => `· ${line(row)}`);
  if (rows.length > 25) rendered.push(`…and ${rows.length - 25} more.`);
  return `${heading}:\n${rendered.join('\n')}`;
}

function outcomeFailure(outcome) {
  return `Unable to answer from live data: ${outcome.message ?? outcome.errorCode ?? 'unknown error'}. Nothing was fabricated.`;
}

/** Render one intent, or the honest failure of it. Shared by both vocabularies. */
function render(outcome, renderer) {
  if (outcome.status !== 'executed') return outcomeFailure(outcome);
  return renderer(outcome.data);
}

const evidenceOf = (name, outcome, count) => ({
  query: name,
  status: outcome.status,
  ...(outcome.status === 'executed' ? { count: count ?? null } : { errorCode: outcome.errorCode }),
});

// ============================================================================ admin router

async function resolveAdminCommand(store, rawPrompt, options = {}) {
  const prompt = String(rawPrompt ?? '');
  const q = prompt.toLowerCase();
  const has = (...needles) => needles.some((needle) => q.includes(needle));
  const now = options.now ?? Date.now();

  if (has('failed payment', 'failed payments', 'payment failure')) {
    const outcome = await data.listFailedPayments(store, { days: 1, now });
    return {
      intent: 'billing.failed_payments', confidence: 'exact',
      answer: render(outcome, (d) => listLines(
        'Failed payments in the last 24 hours (payment rows with a failed/rejected/declined status)',
        d.payments,
        (p) => `${p.customerEmail ?? 'unknown customer'} — ${p.amount} ${p.currency} — ${p.failureReason ?? 'no reason recorded'}`,
        'none found (real query, zero rows).',
      )),
      evidence: [evidenceOf('list_failed_payments', outcome, outcome.data?.count)],
    };
  }

  if (has('overdue invoice', 'overdue invoices', 'overdue')) {
    const outcome = await data.listOverdueInvoices(store, { limit: 50, now });
    return {
      intent: 'billing.overdue_invoices', confidence: 'exact',
      answer: render(outcome, (d) => listLines(
        'Customers with overdue invoices (unpaid, past their due date)',
        d.invoices,
        (i) => `${i.invoiceNumber} — ${i.customerEmail ?? 'unknown customer'} — ${i.amountDue} ${i.currency} — ${i.daysOverdue} day(s) overdue`,
        'none found (real query, zero rows).',
      )),
      evidence: [evidenceOf('list_overdue_invoices', outcome, outcome.data?.count)],
    };
  }

  if (has('abnormal cpu', 'high cpu', 'cpu usage', 'server health', 'unhealthy server', 'server status')) {
    const outcome = await data.listServerHealth(store, { limit: 100, now });
    return {
      intent: 'infrastructure.server_health', confidence: 'exact',
      answer: render(outcome, (d) => {
        const flagged = d.servers.filter((server) => server.flags.length > 0);
        const lines = flagged.slice(0, 25).map((server) => `· ${server.hostname} (${server.status ?? 'unknown status'}) — flags: ${server.flags.join(', ')}`);
        return [
          `${d.flaggedCount} of ${d.count} servers carry a health flag.`,
          `Thresholds: cpu ≥ ${d.thresholds.cpuPercent}%, memory ≥ ${d.thresholds.memoryPercent}%, disk ≥ ${d.thresholds.diskPercent}%, newest metric older than ${d.thresholds.staleMetricsMinutes} min (or missing) — each flag is one of those, from stored metric rows.`,
          ...(lines.length > 0 ? lines : ['No server currently carries a flag.']),
          ...(flagged.length > 25 ? [`…and ${flagged.length - 25} more.`] : []),
        ].join('\n');
      }),
      evidence: [evidenceOf('list_server_health', outcome, outcome.data?.flaggedCount)],
    };
  }

  if (has('unresolved', 'open ticket', 'open tickets', 'support tickets', 'support queue', 'ticket summary')) {
    const outcome = await data.listOpenTickets(store, { limit: 30, now });
    return {
      intent: 'support.open_tickets', confidence: 'exact',
      answer: render(outcome, (d) => listLines(
        `Unresolved support tickets (oldest first; statuses counted: ${d.statusesCounted.join(', ')})`,
        d.tickets,
        (t) => `"${t.subject}" — ${t.customerEmail ?? 'unknown customer'} — ${t.status}/${t.priority ?? 'no priority'} — ${t.ageHours}h old`,
        'none found (real query, zero rows).',
      )),
      evidence: [evidenceOf('list_open_tickets', outcome, outcome.data?.count)],
    };
  }

  if (has('churn', 'cancellation', 'cancellations', 'at risk subscription', 'cancellation risk')) {
    const outcome = await data.listSubscriptionRisk(store, { now });
    return {
      intent: 'sales.subscription_risk', confidence: 'exact',
      answer: render(outcome, (d) => {
        const lines = [`Past-due subscriptions: ${d.pastDue.length}`];
        for (const row of d.pastDue.slice(0, 15)) lines.push(`· ${row.customerEmail ?? 'unknown customer'} — ${row.planId ?? 'no plan id'} — past due since ${row.pastDueSince ?? 'not recorded'}`);
        lines.push(`Active subscriptions flagged cancel-at-period-end: ${d.pendingCancellation.length}`);
        for (const row of d.pendingCancellation.slice(0, 15)) lines.push(`· ${row.customerEmail ?? 'unknown customer'} — ${row.planId ?? 'no plan id'} — ends ${row.currentPeriodEnd ?? 'not recorded'}`);
        lines.push(`Active subscriptions: ${d.totalActive}. No churn score is computed: the numbers above are stored columns.`);
        return lines.join('\n');
      }),
      evidence: [evidenceOf('list_subscription_risk', outcome, outcome.data?.subscriptions?.length)],
    };
  }

  if (has('stuck', 'provisioning')) {
    const outcome = await data.listStuckDeployments(store, { minutes: 60, now });
    return {
      intent: 'infrastructure.stuck_provisioning', confidence: 'exact',
      answer: render(outcome, (d) => {
        const lines = [`Stuck deployments (in a non-terminal state for over ${d.thresholdMinutes} minutes): ${d.deployments.length}`];
        for (const row of d.deployments.slice(0, 15)) lines.push(`· ${row.action} on server ${row.serverId ?? 'n/a'} — ${row.status} for ${row.ageMinutes} min — attempts ${row.attempts}/${row.maxAttempts ?? 'n/a'}`);
        lines.push(`Stuck provisioning jobs (over ${d.thresholdMinutes} minutes): ${d.jobs.length}`);
        for (const row of d.jobs.slice(0, 15)) lines.push(`· ${row.kind} (${row.resourceType ?? 'no resource type'}) — ${row.status} for ${row.ageMinutes} min — attempts ${row.attempts}`);
        if (d.deployments.length === 0 && d.jobs.length === 0) lines.push('Nothing has been sitting in the queue or running for that long.');
        return lines.join('\n');
      }),
      evidence: [
        evidenceOf('list_stuck_deployments', outcome, outcome.data?.deployments?.length),
      ],
    };
  }

  if (has('failed deployment', 'deployment failure', 'deployments failed')) {
    const outcome = await data.listFailedDeployments(store, { days: 1, now });
    return {
      intent: 'infrastructure.failed_deployments', confidence: 'exact',
      answer: render(outcome, (d) => listLines(
        'Failed deployments in the last 24 hours',
        d.deployments,
        (row) => `${row.action} on ${row.serverHostname ?? row.serverId ?? 'n/a'} — ${row.errorCode ?? 'no error code'}: ${String(row.errorMessage ?? '').slice(0, 140)}`,
        'none found (real query, zero rows).',
      )),
      evidence: [evidenceOf('list_failed_deployments', outcome, outcome.data?.count)],
    };
  }

  if (has('ssl', 'certificate')) {
    const outcome = await data.listExpiringSsl(store, { days: 30, now });
    return {
      intent: 'infrastructure.expiring_ssl', confidence: 'exact',
      answer: render(outcome, (d) => listLines(
        'SSL certificates expiring within 30 days (or already expired / failed)',
        d.certificates,
        (c) => `${c.domainName} — ${c.customerEmail ?? 'unknown customer'} — ${c.status ?? 'no status'} — ${c.daysUntilExpiry ?? 'unknown'} day(s) — auto-renew ${c.autoRenew}`,
        'none found (real query, zero rows).',
      )),
      evidence: [evidenceOf('list_expiring_ssl', outcome, outcome.data?.count)],
    };
  }

  if (has('domain', 'domains expiring', 'expiring domain')) {
    const outcome = await data.listExpiringDomains(store, { days: 30, now });
    return {
      intent: 'infrastructure.expiring_domains', confidence: 'exact',
      answer: render(outcome, (d) => listLines(
        'Domains expiring within 30 days (or already expired)',
        d.domains,
        (row) => `${row.domainName} — ${row.customerEmail ?? 'unknown customer'} — ${row.daysUntilExpiry} day(s)`,
        'none found (real query, zero rows).',
      )),
      evidence: [evidenceOf('list_expiring_domains', outcome, outcome.data?.count)],
    };
  }

  if (has('security', 'login anomal', 'suspicious login', 'brute force', 'failed login')) {
    const outcome = await data.listAuthAnomalies(store, { hours: 24, now });
    return {
      intent: 'security.auth_anomalies', confidence: 'exact',
      answer: render(outcome, (d) => {
        const lines = [`Authentication anomaly clusters in the last ${d.windowHours} hours (from auth_audit_log; ${d.failureEvents} failure event(s) recorded).`];
        lines.push(`IP clusters (≥${d.thresholds.ip} failures): ${d.ipClusters.length}`);
        for (const cluster of d.ipClusters.slice(0, 15)) lines.push(`· ${cluster.ipAddress} — ${cluster.failures} failures across ${cluster.accountsTargeted} account(s)`);
        lines.push(`Account clusters (≥${d.thresholds.account} failures): ${d.accountClusters.length}`);
        for (const cluster of d.accountClusters.slice(0, 15)) lines.push(`· ${cluster.customerEmail ?? cluster.userId} — ${cluster.failures} failures from ${cluster.distinctIps} IP(s)`);
        if (d.ipClusters.length === 0 && d.accountClusters.length === 0) lines.push('No clusters above threshold.');
        lines.push('A cluster is a count of recorded failures, not a conclusion about the account.');
        return lines.join('\n');
      }),
      evidence: [evidenceOf('list_auth_anomalies', outcome, outcome.data?.failureEvents)],
    };
  }

  if (has('incident')) {
    const outcome = await data.listIncidents(store, { limit: 25 });
    return {
      intent: 'incidents.list', confidence: 'exact',
      answer: render(outcome, (d) => listLines(
        'AI incident register',
        d.incidents,
        (row) => `${row.incidentNumber} — ${row.title} — ${row.severity ?? 'no severity'}/${row.status}`,
        'none found (real query, zero rows).',
      )),
      evidence: [evidenceOf('list_incidents', outcome, outcome.data?.count)],
    };
  }

  if (has('revenue', 'mrr', 'arr')) {
    const outcome = await data.getRevenueSnapshot(store, { now });
    return {
      intent: 'billing.revenue_summary', confidence: 'exact',
      answer: render(outcome, (d) => [
        'Revenue snapshot (real payment rows only):',
        `Successful payments — 24h: ${d.successfulPayments.amount1Day} · 7d: ${d.successfulPayments.amount7Days} · 30d: ${d.successfulPayments.amount30Days} (${d.successfulPayments.count30d} payment(s))`,
        `Failed payments (30d): ${d.failedPayments.amount30d} across ${d.failedPayments.count30d} attempt(s)`,
        `Subscriptions — active: ${d.subscriptions.active} · at-risk: ${d.subscriptions.atRisk} · pending cancellation: ${d.subscriptions.pendingCancellation}`,
        `Methodology: ${d.methodology}`,
      ].join('\n')),
      evidence: [evidenceOf('get_revenue_snapshot', outcome, outcome.data?.successfulPayments?.count30d)],
    };
  }

  if (has('overview', 'platform status', 'summary')) {
    const outcome = await data.getPlatformOverview(store, { now });
    return {
      intent: 'platform.overview', confidence: 'exact',
      answer: render(outcome, (d) => [
        `Platform overview (as of ${d.asOf}):`,
        `Customers: ${d.customers} (${d.activeCustomers} active)`,
        `Support: ${d.openTickets} open ticket(s), ${d.newTickets} new`,
        `Billing: ${d.unpaidInvoices} unpaid invoice(s), ${d.overdueInvoices} overdue (total ${d.overdueAmountTotal}), failed payments 24h: ${d.failedPayments24h}`,
        `Infrastructure: ${d.serversActive} active server(s), ${d.serversDegraded} flagged by a health check, failed deployments 24h: ${d.failedDeployments24h}`,
        `Subscriptions: ${d.subscriptionsActive} active, ${d.subscriptionsAtRisk} at risk`,
        `Lifecycle: ${d.sslExpiring30d} SSL cert(s) and ${d.domainsExpiring30d} domain(s) expiring within 30 days`,
      ].join('\n')),
      evidence: [evidenceOf('get_platform_overview', outcome, outcome.data?.customers)],
    };
  }

  if (has('briefing')) {
    // Ported from the audited build: the Board composes briefings from each seat's own digest, so
    // the Copilot points at it rather than generating one that no seat produced.
    return {
      intent: 'board.briefing_hint', confidence: 'exact',
      answer: 'Executive briefings are composed on the Board surface, where each seat contributes its own findings: open Admin → AI → Board, or POST /api/v1/admin/ai/board/briefings. This command performs no fabrication — it will not write a briefing nobody produced.',
      evidence: [],
    };
  }

  return {
    intent: 'unsupported',
    confidence: 'none',
    answer: 'No registered admin action matches this command. I will not guess. Ask for data via one of the supported commands, or search the knowledge base from Admin → AI → Knowledge.',
    unsupportedReason: 'No registered admin action matches this command. I will not guess.',
    supported: [...ADMIN_SUPPORTED],
    evidence: [],
  };
}

// ============================================================================ customer router

async function resolveCustomerMessage(store, { userId, message } = {}, options = {}) {
  const raw = String(message ?? '');
  const q = raw.toLowerCase();
  const has = (...needles) => needles.some((needle) => q.includes(needle));
  const now = options.now ?? Date.now();

  if (has('ai activity', 'what did the ai', 'what has the ai', 'ai done')) {
    const outcome = await data.getAiActivity(store, { userId });
    return {
      intent: 'customer.ai_activity', confidence: 'exact',
      answer: render(outcome, (d) => [
        `AI activity on your account: ${d.events.length} recorded interaction(s), ${d.tasks} task(s), ${d.findings} finding(s), ${d.approvals} approval-gated action request(s).`,
        ...d.events.slice(0, 8).map((event) => `· ${event.name ?? 'interaction'}${event.intent ? ` (${event.intent})` : ''} — ${String(event.createdAt).slice(0, 10)}`),
      ].join('\n')),
      evidence: [evidenceOf('get_ai_activity', outcome, outcome.data?.total)],
    };
  }

  // The explicit confirmation form runs first: "open ticket: ..." is the customer's own request, and
  // if the generic prompt below matched it first the request would loop back as a question.
  if (has('open ticket:') || has('ticket:') || q.startsWith('support request')) {
    const body = raw.replace(/^(open ticket:|ticket:|support request)/i, '').trim();
    if (body.length >= 10) {
      const subject = (body.split(/[.\n]/)[0] ?? 'Support request').slice(0, 120);
      const outcome = await data.createTicket(store, { userId, subject, body });
      return {
        intent: 'customer.open_ticket', confidence: 'exact',
        answer: render(outcome, (d) => `Your support ticket is open (reference ${d.reference}) — the team will respond from the support queue. You can follow it under Support in your dashboard.`),
        evidence: [evidenceOf('create_ticket', outcome, outcome.data ? 1 : null)],
      };
    }
  }

  if (has('open ticket', 'open a ticket', 'create ticket', 'contact support', 'talk to human', 'speak to an agent', 'human support')) {
    return {
      intent: 'customer.open_ticket_prompt', confidence: 'exact',
      answer: 'I can open a support ticket for you. Reply with the subject and a description of the issue (e.g. "open ticket: cannot reach my VPS — it stopped responding after reboot"), and I will create it in the real support queue where our team picks it up.',
      evidence: [],
    };
  }

  if (has('invoice', 'unpaid', 'balance', 'amount due', 'bill')) {
    const outcome = await data.listInvoices(store, { userId, limit: 10 });
    return {
      intent: 'customer.invoices', confidence: 'exact',
      answer: render(outcome, (d) => (d.invoices.length === 0
        ? 'You have no invoices on record.'
        : [`Your ${d.invoices.length > 10 ? 'latest 10 ' : ''}invoice(s):`,
          ...d.invoices.slice(0, 10).map((i) => `· ${i.invoiceNumber} — ${i.totalAmount} ${i.currency} — ${i.status} — due ${String(i.dueDate ?? i.issuedAt).slice(0, 10)}`)].join('\n'))),
      evidence: [evidenceOf('list_invoices', outcome, outcome.data?.count)],
    };
  }

  if (has('subscription', 'service status', 'my services', 'my service', 'renewal')) {
    const profile = await data.getCustomerProfile(store, { userId, now });
    const subs = await data.listCustomerSubscriptions(store, { userId, limit: 10 });
    const lines = [];
    if (profile.status === 'executed') {
      const m = profile.data.metrics;
      lines.push(`Your account: ${m.servicesActive} active service(s), ${m.domainsTotal} domain(s), ${m.subscriptionsActive} active subscription(s), ${m.subscriptionsAtRisk} at risk.`);
    } else lines.push(outcomeFailure(profile));
    if (subs.status === 'executed' && subs.data.subscriptions.length > 0) {
      lines.push('Subscriptions:');
      for (const row of subs.data.subscriptions.slice(0, 10)) {
        lines.push(`· ${row.planName ?? row.planId ?? 'plan'} — ${row.status} — period ends ${String(row.currentPeriodEnd ?? 'not recorded').slice(0, 10)}${row.cancelAtPeriodEnd ? ' — set to cancel' : ''}`);
      }
    }
    return {
      intent: 'customer.subscriptions', confidence: 'exact', answer: lines.join('\n'),
      evidence: [evidenceOf('get_customer_profile', profile), evidenceOf('list_subscriptions', subs, subs.data?.count)],
    };
  }

  if (has('domain', 'dns')) {
    const outcome = await data.listExpiringDomains(store, { days: 90, userId, now });
    return {
      intent: 'customer.domains', confidence: 'exact',
      answer: render(outcome, (d) => (d.domains.length === 0
        ? 'None of your domains expire within the next 90 days (checked against the recorded expiry dates).'
        : ['Your domains expiring within 90 days:',
          ...d.domains.slice(0, 10).map((row) => `· ${row.domainName} — expires ${String(row.expiresAt).slice(0, 10)} (${row.daysUntilExpiry} day(s))`)].join('\n'))),
      evidence: [evidenceOf('list_expiring_domains', outcome, outcome.data?.count)],
    };
  }

  if (has('ssl', 'certificate', 'https')) {
    const outcome = await data.listExpiringSsl(store, { days: 90, userId, now });
    return {
      intent: 'customer.ssl', confidence: 'exact',
      answer: render(outcome, (d) => (d.certificates.length === 0
        ? 'No certificates on your account expire within 90 days or are in a failed state (checked recorded expiry data).'
        : ['Your certificates needing attention:',
          ...d.certificates.slice(0, 10).map((c) => `· ${c.domainName} — ${c.status ?? 'no status'} — ${c.daysUntilExpiry ?? 'unknown'} day(s) — auto-renew ${c.autoRenew}`)].join('\n'))),
      evidence: [evidenceOf('list_expiring_ssl', outcome, outcome.data?.count)],
    };
  }

  if (has('ticket', 'my tickets', 'support status')) {
    const profile = await data.getCustomerProfile(store, { userId, now });
    return {
      intent: 'customer.tickets', confidence: 'exact',
      answer: render(profile, (d) => `You have ${d.metrics.ticketsOpen} open support ticket(s) out of ${d.metrics.ticketsTotal} total. Open your Support section in the dashboard to view threads and replies.`),
      evidence: [evidenceOf('get_customer_profile', profile)],
    };
  }

  if (has('failed payment', 'payment failed', 'card declined')) {
    const profile = await data.getCustomerProfile(store, { userId, now });
    return {
      intent: 'customer.billing_status', confidence: 'exact',
      answer: render(profile, (d) => [
        'Your billing status (from your billing records):',
        `Unpaid invoice(s): ${d.metrics.invoicesUnpaid} (${d.metrics.invoicesOverdue} overdue) — outstanding total ${d.metrics.unpaidAmountTotal} ${d.metrics.currency}`,
        `Failed payment attempt(s) in the last 30 days: ${d.metrics.failedPayments30d}`,
        d.metrics.invoicesUnpaid > 0 ? 'You can settle open invoices from the Billing area of your dashboard.' : 'Nothing is due on your account.',
      ].join('\n')),
      evidence: [evidenceOf('get_customer_profile', profile)],
    };
  }

  // Deliberately *not* handled here: the MRZ explainer is its own tool at /api/v1/tools/mrz/explain,
  // and the audited build routed those questions to it because it is a real, reviewable explanation —
  // not because the assistant should grow a second copy of it. A question about MRZ therefore falls
  // through to the knowledge-base search below, which answers from stored documentation or says it
  // could not find any.

  // Knowledge-base fallback for genuine questions — a real search, never a generated answer.
  if (q.length >= 8 && (has('how', 'what', 'why', 'where', 'can i', 'do you', 'help', '?') || q.split(/\s+/).length >= 3)) {
    const outcome = await data.searchKnowledge(store, { query: raw, limit: 3 });
    return {
      intent: 'customer.knowledge', confidence: 'exact',
      answer: render(outcome, (d) => {
        if (d.count === 0) {
          return 'I couldn\'t find documentation answering that in our knowledge base, so I won\'t guess. You can open a support ticket ("open ticket: <your issue>") and the team will help.';
        }
        return ['Based on CloudHost247 documentation:', ...d.results.map((result) => `${result.content}\n— Source: ${result.citation.source}, article "${result.citation.title}"`)].join('\n\n');
      }),
      evidence: [evidenceOf('search_knowledge', outcome, outcome.data?.count)],
    };
  }

  return {
    intent: 'unsupported',
    confidence: 'none',
    answer: 'I can help with your CloudHost247 account — invoices, payments, services, subscriptions, domains, SSL, tickets, or opening a support ticket — plus questions covered by our documentation. I will not guess outside that.',
    unsupportedReason: 'I can help with your CloudHost247 account — invoices, payments, services, subscriptions, domains, SSL, tickets, or opening a support ticket — plus questions covered by our documentation. I will not guess outside that.',
    supported: [...CUSTOMER_SUPPORTED],
    evidence: [],
  };
}

module.exports = {
  ADMIN_SUPPORTED,
  CUSTOMER_SUPPORTED,
  resolveAdminCommand,
  resolveCustomerMessage,
};
