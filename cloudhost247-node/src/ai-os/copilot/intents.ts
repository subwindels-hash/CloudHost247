/**
 * Deterministic intent router for the Admin Copilot and the Customer Cloud Assistant.
 *
 * No LLM guessing: commands map to explicit tool calls. Unknown commands produce an honest
 * "I don't have a registered action for that" response listing what IS supported — never an
 * improvised answer (spec §29, §33, §34).
 */
import type { AgentRunContext, ToolCallOutcome } from '../runtime/types';
import { explainMrzWithAi } from '../../tools/mrz/mrz-engine';

export interface IntentResolution {
  intent: string;
  confidence: 'exact' | 'none';
  execute?(ctx: AgentRunContext): Promise<{ answer: string; toolOutcomes: ToolCallOutcome[] }>;
  unsupportedReason?: string;
  supported?: readonly string[];
}

// ----------------------------------------------------------------------------------------------
// Admin Copilot intents (spec §33 command vocabulary)
// ----------------------------------------------------------------------------------------------

const ADMIN_SUPPORTED = [
  'show today\'s failed payments',
  'find customers with overdue invoices',
  'show servers with abnormal cpu / unhealthy servers',
  'summarize unresolved support tickets',
  'show subscriptions with cancellation risk (churn)',
  'show stuck provisioning / deployments',
  'show failed deployments',
  'show expiring ssl certificates / domains',
  'show security / login anomalies',
  'show today\'s incidents',
  'revenue summary',
  'platform overview',
  'prepare an executive briefing',
] as const;

export function resolveAdminCommand(raw: string): IntentResolution {
  const q = raw.toLowerCase();
  const has = (...needles: string[]) => needles.some((n) => q.includes(n));

  if (has('failed payment', 'failed payments', 'payment failure')) {
    return {
      intent: 'billing.failed_payments', confidence: 'exact',
      async execute(ctx) {
        const out = await ctx.callTool('list_failed_payments', { days: 1 });
        return { answer: summarize(out, (d) => formatList(d, 'payments', (p: Record<string, unknown>) => `${p.customerEmail} — ${p.amount} ${p.currency} — ${p.failureReason ?? 'no reason recorded'}`), 'Failed payments in the last 24 hours'), toolOutcomes: [out] };
      },
    };
  }
  if (has('overdue invoice', 'overdue invoices', 'overdue')) {
    return {
      intent: 'billing.overdue_invoices', confidence: 'exact',
      async execute(ctx) {
        const out = await ctx.callTool('list_overdue_invoices', { limit: 50 });
        return { answer: summarize(out, (d) => formatList(d, 'invoices', (i: Record<string, unknown>) => `${i.invoiceNumber} — ${i.customerEmail} — ${i.totalAmount} ${i.currency} — ${i.daysOverdue} day(s) overdue`), 'Customers with overdue invoices'), toolOutcomes: [out] };
      },
    };
  }
  if (has('abnormal cpu', 'high cpu', 'cpu usage', 'server health', 'unhealthy server', 'server status')) {
    return {
      intent: 'infrastructure.server_health', confidence: 'exact',
      async execute(ctx) {
        const out = await ctx.callTool('list_server_health', { limit: 100 });
        if (out.status !== 'executed') return { answer: outcomeFailure(out), toolOutcomes: [out] };
        const data = out.data as { servers: Array<Record<string, unknown>>; count: number; flaggedCount: number };
        const flagged = data.servers.filter((s) => (s.flags as string[]).length > 0);
        const lines = flagged.slice(0, 25).map((s) => `${s.hostname} (${s.status}) — flags: ${(s.flags as string[]).join(', ')}`);
        return {
          answer: [`${data.flaggedCount} of ${data.count} servers carry a health flag (thresholds documented in the tool result).`, ...lines, flagged.length > 25 ? `…and ${flagged.length - 25} more (see tool result).` : null].filter(Boolean).join('\n'),
          toolOutcomes: [out],
        };
      },
    };
  }
  if (has('unresolved', 'open ticket', 'open tickets', 'support tickets', 'support queue', 'ticket summary')) {
    return {
      intent: 'support.open_tickets', confidence: 'exact',
      async execute(ctx) {
        const out = await ctx.callTool('list_open_tickets', { limit: 30 });
        return { answer: summarize(out, (d) => formatList(d, 'tickets', (t: Record<string, unknown>) => `"${t.subject}" — ${t.customerEmail} — ${t.status}/${t.priority} — ${t.ageHours}h old`), 'Unresolved support tickets (oldest first)'), toolOutcomes: [out] };
      },
    };
  }
  if (has('churn', 'cancellation', 'cancellations', 'at risk subscription', 'highest cancellation')) {
    return {
      intent: 'sales.subscription_risk', confidence: 'exact',
      async execute(ctx) {
        const pastDue = await ctx.callTool('list_subscriptions', { status: 'past_due' });
        const pending = await ctx.callTool('list_subscriptions', {});
        const pendingList = pending.status === 'executed' ? (pending.data as { subscriptions: Array<Record<string, unknown>> }).subscriptions.filter((s) => s.cancelAtPeriodEnd === true) : [];
        const lines: string[] = [];
        if (pastDue.status === 'executed') {
          const d = pastDue.data as { subscriptions: Array<Record<string, unknown>> };
          lines.push(`Past-due subscriptions: ${d.subscriptions.length}`);
          for (const s of d.subscriptions.slice(0, 15)) lines.push(`· ${s.customerEmail} — ${s.planName ?? s.planId} — past due since ${s.pastDueSince ?? 'unknown'}`);
        } else lines.push(outcomeFailure(pastDue));
        lines.push(`Active subscriptions flagged cancel-at-period-end: ${pendingList.length}`);
        for (const s of pendingList.slice(0, 15)) lines.push(`· ${s.customerEmail} — ${s.planName ?? s.planId} — cancels ${s.currentPeriodEnd}`);
        return { answer: lines.join('\n'), toolOutcomes: [pastDue, pending] };
      },
    };
  }
  if (has('stuck', 'provisioning')) {
    return {
      intent: 'infrastructure.stuck_provisioning', confidence: 'exact',
      async execute(ctx) {
        const out = await ctx.callTool('list_stuck_deployments', { minutes: 60 });
        return { answer: summarize(out, (d) => formatList(d, 'deployments', (d2: Record<string, unknown>) => `${d2.action} on server ${d2.serverId ?? 'n/a'} — ${d2.status} for ${d2.ageMinutes} min — attempts ${d2.attempts}/${d2.maxAttempts}`), 'Stuck provisioning/deployments (over 60 minutes in queue/run)'), toolOutcomes: [out] };
      },
    };
  }
  if (has('failed deployment', 'deployment failure', 'deployments failed')) {
    return {
      intent: 'infrastructure.failed_deployments', confidence: 'exact',
      async execute(ctx) {
        const out = await ctx.callTool('list_failed_deployments', { days: 1 });
        return { answer: summarize(out, (d) => formatList(d, 'deployments', (d2: Record<string, unknown>) => `${d2.action} on ${d2.serverHostname ?? d2.serverId ?? 'n/a'} — ${d2.errorCode ?? 'no error code'}: ${String(d2.errorMessage ?? '').slice(0, 140)}`), 'Failed deployments in the last 24 hours'), toolOutcomes: [out] };
      },
    };
  }
  if (has('ssl', 'certificate')) {
    return {
      intent: 'infrastructure.expiring_ssl', confidence: 'exact',
      async execute(ctx) {
        const out = await ctx.callTool('list_expiring_ssl', { days: 30 });
        return { answer: summarize(out, (d) => formatList(d, 'certificates', (c: Record<string, unknown>) => `${c.domainName} — ${c.customerEmail} — ${c.status} — ${c.daysUntilExpiry} day(s) — auto-renew ${c.autoRenew}`), 'SSL certificates expiring within 30 days (or already expired)'), toolOutcomes: [out] };
      },
    };
  }
  if (has('domain', 'domains expiring', 'expiring domain')) {
    return {
      intent: 'infrastructure.expiring_domains', confidence: 'exact',
      async execute(ctx) {
        const out = await ctx.callTool('list_expiring_domains', { days: 30 });
        return { answer: summarize(out, (d) => formatList(d, 'domains', (d2: Record<string, unknown>) => `${d2.domainName} — ${d2.customerEmail} — ${d2.daysUntilExpiry} day(s)`), 'Domains expiring within 30 days (or already expired)'), toolOutcomes: [out] };
      },
    };
  }
  if (has('security', 'login anomal', 'suspicious login', 'brute force', 'failed login')) {
    return {
      intent: 'security.auth_anomalies', confidence: 'exact',
      async execute(ctx) {
        const out = await ctx.callTool('list_auth_anomalies', { hours: 24 });
        if (out.status !== 'executed') return { answer: outcomeFailure(out), toolOutcomes: [out] };
        const d = out.data as { ipClusters: Array<Record<string, unknown>>; accountClusters: Array<Record<string, unknown>> };
        const lines = [`Authentication anomaly clusters in the last 24 hours (from auth_audit_log):`];
        lines.push(`IP clusters (≥5 failures): ${d.ipClusters.length}`);
        for (const c of d.ipClusters.slice(0, 15)) lines.push(`· ${c.ipAddress} — ${c.failures} failures across ${c.accountsTargeted} account(s)`);
        lines.push(`Account clusters (≥3 failures): ${d.accountClusters.length}`);
        for (const c of d.accountClusters.slice(0, 15)) lines.push(`· ${c.customerEmail} — ${c.failures} failures from ${c.distinctIps} IP(s)`);
        if (d.ipClusters.length === 0 && d.accountClusters.length === 0) lines.push('No clusters above threshold.');
        return { answer: lines.join('\n'), toolOutcomes: [out] };
      },
    };
  }
  if (has('incident')) {
    return {
      intent: 'incidents.list', confidence: 'exact',
      async execute(ctx) {
        const out = await ctx.callTool('list_incidents', { limit: 25 });
        return { answer: summarize(out, (d) => formatList(d, 'incidents', (i: Record<string, unknown>) => `${i.incidentNumber} — ${i.title} — ${i.severity}/${i.status}`), 'AI incident register'), toolOutcomes: [out] };
      },
    };
  }
  if (has('revenue', 'mrr', 'arr')) {
    return {
      intent: 'billing.revenue_summary', confidence: 'exact',
      async execute(ctx) {
        const out = await ctx.callTool('get_revenue_snapshot', {});
        if (out.status !== 'executed') return { answer: outcomeFailure(out), toolOutcomes: [out] };
        const d = out.data as Record<string, never> & { successfulPayments: Record<string, unknown>; failedPayments: Record<string, unknown>; subscriptions: Record<string, unknown>; methodology: string };
        const answer = [
          'Revenue snapshot (real payment rows only):',
          `Successful payments — 24h: ${d.successfulPayments.last1Day} · 7d: ${d.successfulPayments.last7Days} · 30d: ${d.successfulPayments.last30Days} (${d.successfulPayments.count30d} payment(s))`,
          `Failed payments (30d): ${d.failedPayments.amount30d} across ${d.failedPayments.count30d} attempt(s)`,
          `Subscriptions — active: ${d.subscriptions.active} · at-risk: ${d.subscriptions.atRisk} · pending cancellation: ${d.subscriptions.pendingCancellation}`,
          `Methodology: ${d.methodology}`,
        ].join('\n');
        return { answer, toolOutcomes: [out] };
      },
    };
  }
  if (has('overview', 'platform status', 'summary')) {
    return {
      intent: 'platform.overview', confidence: 'exact',
      async execute(ctx) {
        const out = await ctx.callTool('get_platform_overview', {});
        if (out.status !== 'executed') return { answer: outcomeFailure(out), toolOutcomes: [out] };
        const d = out.data as Record<string, unknown>;
        return {
          answer: [
            `Platform overview (as of ${d.asOf}):`,
            `Customers: ${d.customers} (${d.activeCustomers} active)`,
            `Support: ${d.openTickets} open ticket(s), ${d.newTickets} new`,
            `Billing: ${d.unpaidInvoices} unpaid invoice(s), ${d.overdueInvoices} overdue (total ${d.overdueAmountTotal}), failed payments 24h: ${d.failedPayments24h}`,
            `Infrastructure: ${d.serversActive} active server(s), ${d.serversDegraded} degraded, failed deployments 24h: ${d.failedDeployments24h}`,
            `Subscriptions: ${d.subscriptionsActive} active, ${d.subscriptionsAtRisk} at risk`,
            `Lifecycle: ${d.sslExpiring30d} SSL certs and ${d.domainsExpiring30d} domains expiring within 30 days`,
          ].join('\n'),
          toolOutcomes: [out],
        };
      },
    };
  }
  if (has('briefing')) {
    return {
      intent: 'board.briefing_hint', confidence: 'exact',
      async execute() {
        return {
          answer: 'Executive briefings are generated from the Board surface so all ten seats contribute their own findings: POST /api/v1/admin/ai/board/briefings with {"type":"daily"} (or use the Board page). This command performs no fabrication — the briefing is assembled from each seat\'s real digest.',
          toolOutcomes: [],
        };
      },
    };
  }

  return {
    intent: 'unsupported', confidence: 'none',
    unsupportedReason: `No registered admin action matches this command. I will not guess. Ask for data via one of the supported commands, or search the knowledge base from /admin/ai/knowledge.`,
    supported: ADMIN_SUPPORTED,
  };
}

// ----------------------------------------------------------------------------------------------
// Customer Cloud Assistant intents (spec §34)
// ----------------------------------------------------------------------------------------------

const CUSTOMER_SUPPORTED = [
  'my invoices / check invoice / unpaid balance',
  'my payments / failed payments',
  'my services & subscriptions',
  'my domains (incl. expiry)',
  'my ssl certificates (incl. expiry)',
  'my support tickets / ticket status',
  'open a support ticket',
  'what has the AI done on my account',
  'help: <question> (knowledge base)',
] as const;

export function resolveCustomerMessage(raw: string): IntentResolution {
  const q = raw.toLowerCase();
  const has = (...needles: string[]) => needles.some((n) => q.includes(n));

  if (has('ai activity', 'what did the ai', 'what has the ai', 'ai done')) {
    return {
      intent: 'customer.ai_activity', confidence: 'exact',
      async execute(ctx) {
        const out = await ctx.callTool('get_ai_activity', { userId: ctx.customerScopeUserId ?? '' });
        if (out.status !== 'executed') return { answer: outcomeFailure(out), toolOutcomes: [out] };
        const d = out.data as { tasks: Array<Record<string, unknown>>; findings: Array<Record<string, unknown>>; approvals: Array<Record<string, unknown>> };
        return {
          answer: [
            `AI activity on your account: ${d.tasks.length} task(s), ${d.findings.length} finding(s), ${d.approvals.length} approval-gated action request(s).`,
            ...d.tasks.slice(0, 8).map((t) => `· [${t.status}] ${t.agent_name}: ${t.result_summary ?? t.task_type} (${String(t.created_at).slice(0, 10)})`),
          ].join('\n'),
          toolOutcomes: [out],
        };
      },
    };
  }
  // Explicit confirmation form first ("open ticket: ...") — the user's own request to open the
  // ticket, executed in their own workspace. This must precede the generic prompt below, otherwise
  // "open ticket: <issue>" would loop back into the prompt instead of opening the ticket.
  if (has('open ticket:') || has('ticket:') || q.startsWith('support request')) {
    const body = raw.replace(/^(open ticket:|ticket:|support request)/i, '').trim();
    if (body.length >= 10) {
      return {
        intent: 'customer.open_ticket', confidence: 'exact',
        async execute(ctx) {
          const subject = (body.split(/[.\n]/)[0] ?? 'Support request').slice(0, 120);
          const out = await ctx.callTool('create_ticket', { userId: ctx.customerScopeUserId ?? '', subject, body: `Customer request via Cloud Assistant:\n\n${body}` });
          if (out.status !== 'executed') return { answer: outcomeFailure(out), toolOutcomes: [out] };
          const d = out.data as { ticketId: string };
          return { answer: `Your support ticket is open (id ${d.ticketId}) — the team will respond from the support queue. You can follow it under Support in your dashboard.`, toolOutcomes: [out] };
        },
      };
    }
  }
  if (has('open ticket', 'open a ticket', 'create ticket', 'contact support', 'talk to human', 'speak to an agent', 'human support')) {
    return {
      intent: 'customer.open_ticket_prompt', confidence: 'exact',
      async execute() {
        return {
          answer: 'I can open a support ticket for you. Reply with the subject and a description of the issue (e.g. "open ticket: cannot reach my VPS — it stopped responding after reboot"), and I will create it in the real support queue where our team picks it up.',
          toolOutcomes: [],
        };
      },
    };
  }
  if (has('invoice', 'unpaid', 'balance', 'amount due', 'bill')) {
    return {
      intent: 'customer.invoices', confidence: 'exact',
      async execute(ctx) {
        const out = await ctx.callTool('list_invoices', { userId: ctx.customerScopeUserId ?? '', limit: 10 });
        if (out.status !== 'executed') return { answer: outcomeFailure(out), toolOutcomes: [out] };
        const d = out.data as { invoices: Array<Record<string, unknown>> };
        if (d.invoices.length === 0) return { answer: 'You have no invoices on record.', toolOutcomes: [out] };
        const lines = d.invoices.slice(0, 10).map((i) => `· ${i.invoiceNumber} — ${i.totalAmount} ${i.currency} — ${i.status} — due ${String(i.dueDate).slice(0, 10)}`);
        return { answer: [`Your ${d.invoices.length > 10 ? 'latest 10 ' : ''}invoice(s):`, ...lines].join('\n'), toolOutcomes: [out] };
      },
    };
  }
  if (has('subscription', 'service status', 'my services', 'my service', 'renewal')) {
    return {
      intent: 'customer.subscriptions', confidence: 'exact',
      async execute(ctx) {
        const profile = await ctx.callTool('get_customer_profile', { userId: ctx.customerScopeUserId ?? '' });
        // Scoped server-side by the tool layer (customer workspace) — it can only return the
        // asking customer's own subscriptions.
        const subs = await ctx.callTool('list_subscriptions', { userId: ctx.customerScopeUserId ?? '', limit: 10 });
        const lines: string[] = [];
        if (profile.status === 'executed') {
          const m = (profile.data as { metrics: Record<string, unknown> }).metrics;
          lines.push(`Your account: ${m.servicesActive} active service(s), ${m.domainsTotal} domain(s), ${m.subscriptionsActive} active subscription(s), ${m.subscriptionsAtRisk} at risk.`);
        } else lines.push(outcomeFailure(profile));
        if (subs.status === 'executed') {
          const rows = (subs.data as { subscriptions: Array<Record<string, unknown>> }).subscriptions;
          if (rows.length > 0) {
            lines.push('Subscriptions:');
            for (const s of rows.slice(0, 10)) lines.push(`· ${s.planName ?? 'plan'} — ${s.status} — period ends ${String(s.currentPeriodEnd).slice(0, 10)}${s.cancelAtPeriodEnd ? ' — set to cancel' : ''}`);
          }
        }
        return { answer: lines.join('\n'), toolOutcomes: [profile, subs] };
      },
    };
  }
  if (has('domain', 'dns')) {
    return {
      intent: 'customer.domains', confidence: 'exact',
      async execute(ctx) {
        const out = await ctx.callTool('list_expiring_domains', { days: 90, userId: ctx.customerScopeUserId ?? '' });
        if (out.status !== 'executed') return { answer: outcomeFailure(out), toolOutcomes: [out] };
        const d = out.data as { domains: Array<Record<string, unknown>> };
        if (d.domains.length === 0) return { answer: 'None of your domains expire within the next 90 days (checked against the recorded expiry dates).', toolOutcomes: [out] };
        return { answer: [`Your domains expiring within 90 days:`, ...d.domains.slice(0, 10).map((d2) => `· ${d2.domainName} — expires ${String(d2.expiresAt).slice(0, 10)} (${d2.daysUntilExpiry} day(s))`)].join('\n'), toolOutcomes: [out] };
      },
    };
  }
  if (has('ssl', 'certificate', 'https')) {
    return {
      intent: 'customer.ssl', confidence: 'exact',
      async execute(ctx) {
        const out = await ctx.callTool('list_expiring_ssl', { days: 90, userId: ctx.customerScopeUserId ?? '' });
        if (out.status !== 'executed') return { answer: outcomeFailure(out), toolOutcomes: [out] };
        const d = out.data as { certificates: Array<Record<string, unknown>> };
        if (d.certificates.length === 0) return { answer: 'No certificates on your account expire within 90 days or are in a failed state (checked recorded expiry data).', toolOutcomes: [out] };
        return { answer: [`Your certificates needing attention:`, ...d.certificates.slice(0, 10).map((c) => `· ${c.domainName} — ${c.status} — ${c.daysUntilExpiry} day(s) — auto-renew ${c.autoRenew}`)].join('\n'), toolOutcomes: [out] };
      },
    };
  }
  if (has('ticket', 'my tickets', 'support status')) {
    return {
      intent: 'customer.tickets', confidence: 'exact',
      async execute(ctx) {
        const profile = await ctx.callTool('get_customer_profile', { userId: ctx.customerScopeUserId ?? '' });
        if (profile.status !== 'executed') return { answer: outcomeFailure(profile), toolOutcomes: [profile] };
        const m = (profile.data as { metrics: Record<string, unknown> }).metrics;
        return { answer: `You have ${m.ticketsOpen} open support ticket(s) out of ${m.ticketsTotal} total. Open your Support section in the dashboard to view threads and replies.`, toolOutcomes: [profile] };
      },
    };
  }
  if (has('failed payment', 'payment failed', 'card declined')) {
    return {
      intent: 'customer.billing_status', confidence: 'exact',
      async execute(ctx) {
        const profile = await ctx.callTool('get_customer_profile', { userId: ctx.customerScopeUserId ?? '' });
        if (profile.status !== 'executed') return { answer: outcomeFailure(profile), toolOutcomes: [profile] };
        const m = (profile.data as { metrics: Record<string, unknown> }).metrics;
        const lines = [
          `Your billing status (from your billing records):`,
          `Unpaid invoice(s): ${m.invoicesUnpaid} (${m.invoicesOverdue} overdue) — outstanding total ${m.unpaidAmountTotal}`,
          `Failed payment attempt(s) in the last 30 days: ${m.failedPayments30d}`,
          Number(m.invoicesUnpaid) > 0 ? 'You can settle open invoices from the Billing area of your dashboard.' : 'Nothing is due on your account.',
        ];
        return { answer: lines.join('\n'), toolOutcomes: [profile] };
      },
    };
  }

  if (has('mrz', 'machine readable zone', 'td3', 'icao 9303', 'check digit')) {
    return {
      intent: 'tools.mrz_explanation', confidence: 'exact',
      async execute() {
        const exp = explainMrzWithAi({ topic: 'overview', question: raw });
        const answer = [
          exp.title,
          ...exp.sections.map((s) => `${s.heading}:\n${s.body}`),
        ].join('\n\n');
        return { answer, toolOutcomes: [] };
      },
    };
  }

  // Knowledge-base fallback for genuine questions.
  if (q.length >= 8 && (has('how', 'what', 'why', 'where', 'can i', 'do you', 'help', '?') || q.split(/\s+/).length >= 3)) {
    return {
      intent: 'customer.knowledge', confidence: 'exact',
      async execute(ctx) {
        const out = await ctx.callTool('search_knowledge', { query: raw, limit: 3 });
        if (out.status !== 'executed') return { answer: outcomeFailure(out), toolOutcomes: [out] };
        const d = out.data as { count: number; results: Array<{ content: string; citation: { source: string; version: string } }>; note?: string };
        if (d.count === 0) {
          return {
            answer: `I couldn't find documentation answering that in our knowledge base, so I won't guess. You can open a support ticket ("open ticket: <your issue>") and the team will help — or browse Help Center articles.`,
            toolOutcomes: [out],
          };
        }
        return {
          answer: [`Based on CloudHost247 documentation:`, ...d.results.map((r) => `${r.content}\n— Source: ${r.citation.source} (v${r.citation.version})`)].join('\n\n'),
          toolOutcomes: [out],
        };
      },
    };
  }

  return {
    intent: 'unsupported', confidence: 'none',
    unsupportedReason: 'I can help with your CloudHost247 account — invoices, payments, services, subscriptions, domains, SSL, tickets, or opening a support ticket — plus questions covered by our documentation. I will not guess outside that.',
    supported: CUSTOMER_SUPPORTED,
  };
}

// ----------------------------------------------------------------------------------------------
// Formatting helpers — values come from executed tool outcomes; the helpers never invent text
// beyond describing those outcomes.
// ----------------------------------------------------------------------------------------------

function summarize(
  out: ToolCallOutcome,
  render: (data: unknown) => string,
  heading: string
): string {
  if (out.status !== 'executed') return outcomeFailure(out);
  const body = render(out.data);
  return `${heading}:\n${body}`;
}

function formatList(data: unknown, key: string, line: (row: Record<string, unknown>) => string): string {
  const container = data as Record<string, unknown>;
  const rows = (container?.[key] as Array<Record<string, unknown>> | undefined) ?? [];
  if (rows.length === 0) return 'None found (real query, zero rows).';
  const rendered = rows.slice(0, 25).map((r) => `· ${line(r)}`);
  if (rows.length > 25) rendered.push(`…and ${rows.length - 25} more (see tool result).`);
  return rendered.join('\n');
}

function outcomeFailure(out: ToolCallOutcome): string {
  if (out.status === 'pending_approval') return `This action requires human approval (request ${out.approvalId}). It was NOT executed automatically.`;
  return `Unable to answer from live data: ${out.message ?? out.errorCode ?? 'unknown error'}. Nothing was fabricated.`;
}
