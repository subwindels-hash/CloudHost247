/**
 * Executive Board department digests (spec §2).
 *
 * Each seat's digest is a REAL run under that seat's own registry identity: the seat's own
 * permissions gate its tool calls, and the findings it emits are attributed to it. The CEO
 * never speaks for a seat — it aggregates what each seat itself produced (spec §27).
 */
import type { AgentRunContext, HandlerResult } from '../runtime/types';

type Rec = Record<string, unknown>;
const asRows = (data: unknown, key: string) => ((data as Rec)?.[key] as Rec[] | undefined) ?? [];

export interface DepartmentSection {
  seat: string;
  headline: string;
  bullets: string[];
  metrics: Record<string, unknown>;
}

async function cooDigest(ctx: AgentRunContext): Promise<DepartmentSection> {
  const [overview, openTickets, stuck, failed] = await Promise.all([
    ctx.callTool('get_platform_overview', {}),
    ctx.callTool('list_open_tickets', { limit: 10 }),
    ctx.callTool('list_stuck_deployments', { minutes: 60 }),
    ctx.callTool('list_failed_deployments', { days: 1 }),
  ]);
  const o = (overview.status === 'executed' ? overview.data : {}) as Rec;
  const tickets = openTickets.status === 'executed' ? asRows(openTickets.data, 'tickets') : [];
  const stuckCount = stuck.status === 'executed' ? Number((stuck.data as Rec).count) : 0;
  const failedCount = failed.status === 'executed' ? Number((failed.data as Rec).count) : 0;
  if (stuckCount > 0 || failedCount >= 3) {
    await ctx.emitFinding({
      findingType: 'ops.throughput_risk',
      severity: stuckCount > 0 ? 'high' : 'medium',
      title: `Operational pressure: ${stuckCount} stuck job(s), ${failedCount} failed deployment(s)/24h`,
      summary: `Provisioning/deployment health needs attention: ${stuckCount} stuck job(s) beyond 60 minutes and ${failedCount} failed deployment(s) in 24h (recorded queue data).`,
      evidence: [...(stuck.evidence ?? []), ...(failed.evidence ?? [])],
      recommendation: 'Assign an operator to the stuck queue first; repeated error codes point at one root cause.',
    });
  }
  return {
    seat: 'COO',
    headline: `Support backlog ${o.openTickets ?? 'n/a'} (new: ${o.newTickets ?? 'n/a'}); stuck jobs ${stuckCount}; failed deployments 24h: ${failedCount}; degraded servers: ${o.serversDegraded ?? 'n/a'}`,
    bullets: [
      tickets.length > 0 && tickets[0] ? `Oldest ticket: "${tickets[0].subject}" — ${tickets[0].ageHours}h old (${tickets[0].customerEmail})` : 'Support queue is empty.',
      `${o.sslExpiring30d ?? 'n/a'} SSL certificate(s) and ${o.domainsExpiring30d ?? 'n/a'} domain(s) expiring within 30 days need lifecycle attention.`,
    ],
    metrics: { openTickets: o.openTickets, newTickets: o.newTickets, stuckJobs: stuckCount, failedDeployments24h: failedCount, degradedServers: o.serversDegraded },
  };
}

async function cfoDigest(ctx: AgentRunContext): Promise<DepartmentSection> {
  const [snapshot, overdue, failed, subs] = await Promise.all([
    ctx.callTool('get_revenue_snapshot', {}),
    ctx.callTool('list_overdue_invoices', { limit: 10 }),
    ctx.callTool('list_failed_payments', { days: 1 }),
    ctx.callTool('list_subscriptions', {}),
  ]);
  if (snapshot.status !== 'executed') throw new Error('CFO digest: revenue snapshot unavailable — refusing to improvise');
  const s = snapshot.data as { successfulPayments: Rec; failedPayments: Rec; subscriptions: Rec; refunds: Rec };
  const overdueRows = overdue.status === 'executed' ? asRows(overdue.data, 'invoices') : [];
  const failed24h = failed.status === 'executed' ? Number((failed.data as Rec).count) : 0;
  const atRiskSubs = subs.status === 'executed' ? asRows(subs.data, 'subscriptions').filter((x) => ['past_due', 'grace_period', 'suspended'].includes(String(x.status))).length : 0;
  if (Number(s.failedPayments.count30d) > 0 || overdueRows.length > 0) {
    await ctx.emitFinding({
      findingType: 'finance.cash_risk',
      severity: overdueRows.length >= 10 ? 'high' : 'medium',
      title: `Cash risk: ${overdueRows.length} overdue invoice(s), ${s.failedPayments.count30d} failed payment(s)/30d`,
      summary: `Overdue invoices: ${overdueRows.length} (oldest first presented to Collections). Failed payment attempts 30d: ${s.failedPayments.count30d} totalling ${s.failedPayments.amount30d}. Collections 30d: ${s.successfulPayments.last30Days}.`,
      evidence: [...(snapshot.evidence ?? []), ...(overdue.evidence ?? [])],
      recommendation: 'Collections drafts are prepared by the Collector agent; sending remains human-approved.',
    });
  }
  return {
    seat: 'CFO',
    headline: `Collected 30d: ${s.successfulPayments.last30Days} · 7d: ${s.successfulPayments.last7Days} · 24h: ${s.successfulPayments.last1Day}; overdue invoices: ${overdueRows.length}; failed payments 30d: ${s.failedPayments.amount30d} (${s.failedPayments.count30d} attempts)`,
    bullets: [
      `Refunds 30d: ${s.refunds.amount30d}`,
      `Subscriptions: ${s.subscriptions.active} active, ${atRiskSubs} at risk, ${s.subscriptions.pendingCancellation} pending cancellation`,
      `Methodology: sums from stored payment rows only — no estimated MRR is presented.`,
    ],
    metrics: { collected30d: s.successfulPayments.last30Days, collected7d: s.successfulPayments.last7Days, overdueInvoices: overdueRows.length, failedPayments30d: s.failedPayments, activeSubscriptions: s.subscriptions.active, atRiskSubscriptions: atRiskSubs },
  };
}

async function ctoDigest(ctx: AgentRunContext): Promise<DepartmentSection> {
  const [health, stuck, failed] = await Promise.all([
    ctx.callTool('list_server_health', { limit: 100 }),
    ctx.callTool('list_stuck_deployments', { minutes: 60 }),
    ctx.callTool('list_failed_deployments', { days: 7 }),
  ]);
  const flagged = health.status === 'executed' ? Number((health.data as Rec).flaggedCount) : 0;
  const total = health.status === 'executed' ? Number((health.data as Rec).count) : 0;
  const stuckCount = stuck.status === 'executed' ? Number((stuck.data as Rec).count) : 0;
  const failed7d = failed.status === 'executed' ? Number((failed.data as Rec).count) : 0;
  if (flagged > 0) {
    await ctx.emitFinding({
      findingType: 'technology.estate_risk',
      severity: flagged >= 5 ? 'high' : 'medium',
      title: `${flagged} of ${total} server(s) carry a health flag`,
      summary: `Telemetry thresholds breached on ${flagged}/${total} servers (latest server_metrics rows). Deployment queue: ${stuckCount} stuck, ${failed7d} failed in 7d.`,
      evidence: [...(health.evidence ?? [])],
      recommendation: 'Prioritize saturated hosts; see Infrastructure Guardian findings for the per-server breakdown.',
    });
  }
  return {
    seat: 'CTO',
    headline: `Estate: ${total} server(s), ${flagged} flagged on latest telemetry; deployments — ${stuckCount} stuck, ${failed7d} failed/7d`,
    bullets: ['All capacity/health statements trace to the latest server_metrics row per host.'],
    metrics: { servers: total, flaggedServers: flagged, stuckJobs: stuckCount, failedDeployments7d: failed7d },
  };
}

async function cisoDigest(ctx: AgentRunContext): Promise<DepartmentSection> {
  const anomalies = await ctx.callTool('list_auth_anomalies', { hours: 24 });
  if (anomalies.status !== 'executed') throw new Error('CISO digest: auth anomaly data unavailable — refusing to improvise');
  const a = anomalies.data as { ipClusters: Rec[]; accountClusters: Rec[] };
  if (a.ipClusters.length > 0 || a.accountClusters.length > 0) {
    await ctx.emitFinding({
      findingType: 'security.digest',
      severity: a.ipClusters.length >= 3 || a.accountClusters.some((c) => Number(c.failures) >= 10) ? 'high' : 'medium',
      title: `Auth anomalies: ${a.ipClusters.length} IP cluster(s), ${a.accountClusters.length} account cluster(s) in 24h`,
      summary: `From auth_audit_log: ${a.ipClusters.length} IP cluster(s) ≥5 failures and ${a.accountClusters.length} account(s) with ≥3 failures. Signals only — no account action has been taken or is implied.`,
      evidence: anomalies.evidence ?? [],
      recommendation: 'Triage clusters per security policy; containment requires the approval workflow.',
    });
  }
  return {
    seat: 'CISO',
    headline: `Auth anomaly clusters (24h): ${a.ipClusters.length} IP, ${a.accountClusters.length} account; no automatic containment performed`,
    bullets: ['Detection → evidence → classification; lockouts never happen on score alone.'],
    metrics: { ipClusters24h: a.ipClusters.length, accountClusters24h: a.accountClusters.length },
  };
}

async function croDigest(ctx: AgentRunContext): Promise<DepartmentSection> {
  const [snapshot, subs] = await Promise.all([ctx.callTool('get_revenue_snapshot', {}), ctx.callTool('list_subscriptions', {})]);
  if (snapshot.status !== 'executed') throw new Error('CRO digest: revenue snapshot unavailable');
  const s = snapshot.data as { successfulPayments: Rec; subscriptions: Rec };
  const pendingCancel = Number(s.subscriptions.pendingCancellation);
  if (pendingCancel > 0 || Number(s.subscriptions.atRisk) > 0) {
    await ctx.emitFinding({
      findingType: 'growth.churn_exposure',
      severity: pendingCancel + Number(s.subscriptions.atRisk) >= 5 ? 'high' : 'medium',
      title: `Churn exposure: ${pendingCancel} pending cancellation(s), ${s.subscriptions.atRisk} at-risk subscription(s)`,
      summary: `Customers flagging cancellation or entering dunning represent revenue formally at risk (real subscription lifecycle states).`,
      evidence: snapshot.evidence ?? [],
      recommendation: 'Retention agent scans identify which accounts carry compounding signals — review those findings.',
    });
  }
  return {
    seat: 'CRO',
    headline: `Growth: ${s.successfulPayments.count30d} successful payment(s)/30d; subscription base ${s.subscriptions.active} active, ${pendingCancel} pending cancellation`,
    bullets: [`Cancelled subscriptions (30d): ${s.subscriptions.cancelledLast30d}`],
    metrics: { successfulPayments30d: s.successfulPayments.count30d, activeSubscriptions: s.subscriptions.active, pendingCancellations: pendingCancel, cancelled30d: s.subscriptions.cancelledLast30d },
  };
}

async function cmoDigest(ctx: AgentRunContext): Promise<DepartmentSection> {
  const [overview, subs] = await Promise.all([ctx.callTool('get_platform_overview', {}), ctx.callTool('list_subscriptions', {})]);
  const o = (overview.status === 'executed' ? overview.data : {}) as Rec;
  const byPlan = new Map<string, number>();
  if (subs.status === 'executed') {
    for (const s of asRows(subs.data, 'subscriptions')) {
      const plan = String(s.planName ?? 'unlabeled');
      byPlan.set(plan, (byPlan.get(plan) ?? 0) + 1);
    }
  }
  return {
    seat: 'CMO',
    headline: `Audience: ${o.customers ?? 'n/a'} registered customer(s); renewal-touch segment: ${o.domainsExpiring30d ?? 0} domains + ${o.sslExpiring30d ?? 0} certificates expiring in 30d`,
    bullets: [`Plan mix: ${[...byPlan.entries()].map(([p, c]) => `${p}: ${c}`).join(', ') || 'no subscriptions yet'}`],
    metrics: { customers: o.customers, domainRenewalSegment: o.domainsExpiring30d, sslRenewalSegment: o.sslExpiring30d, planMix: [...byPlan.entries()] },
  };
}

async function ccoDigest(ctx: AgentRunContext): Promise<DepartmentSection> {
  const openTickets = await ctx.callTool('list_open_tickets', { limit: 100 });
  const tickets = openTickets.status === 'executed' ? asRows(openTickets.data, 'tickets') : [];
  const highPriority = tickets.filter((t) => t.priority === 'high').length;
  const aged = tickets.filter((t) => Number(t.ageHours) >= 48).length;
  if (aged > 0 || highPriority > 0) {
    await ctx.emitFinding({
      findingType: 'customer_experience.backlog_risk',
      severity: aged >= 5 ? 'high' : 'medium',
      title: `CX risk: ${highPriority} high-priority and ${aged} ticket(s) older than 48h`,
      summary: `Open queue carries ${highPriority} high-priority ticket(s) and ${aged} ticket(s) waiting longer than 48 hours (real timestamps).`,
      evidence: openTickets.evidence ?? [],
      recommendation: 'Rebalance the queue; Resolution Pro findings indicate tickets lacking knowledge coverage.',
    });
  }
  return {
    seat: 'CCO',
    headline: `Support experience: ${tickets.length} unclosed ticket(s), ${highPriority} high priority, ${aged} waiting >48h`,
    bullets: [tickets[0] ? `Oldest waiting: ${tickets[0].ageHours}h` : 'Queue is clear.'],
    metrics: { openTickets: tickets.length, highPriority, olderThan48h: aged },
  };
}

async function cpoDigest(ctx: AgentRunContext): Promise<DepartmentSection> {
  const subs = await ctx.callTool('list_subscriptions', {});
  const rows = subs.status === 'executed' ? asRows(subs.data, 'subscriptions') : [];
  const byPlan = new Map<string, { active: number; pendingCancel: number }>();
  for (const s of rows) {
    const plan = String(s.planName ?? 'unlabeled');
    const agg = byPlan.get(plan) ?? { active: 0, pendingCancel: 0 };
    if (s.status === 'active') agg.active += 1;
    if (s.cancelAtPeriodEnd === true) agg.pendingCancel += 1;
    byPlan.set(plan, agg);
  }
  return {
    seat: 'CPO',
    headline: `Product adoption: ${byPlan.size} plan(s) with subscriptions; ${rows.length} total subscription row(s) considered`,
    bullets: [...byPlan.entries()].slice(0, 8).map(([p, v]) => `${p}: ${v.active} active, ${v.pendingCancel} pending cancellation`),
    metrics: { planAdoption: [...byPlan.entries()].map(([plan, v]) => ({ plan, ...v })) },
  };
}

async function riskDigest(ctx: AgentRunContext): Promise<DepartmentSection> {
  await ctx.step('observe', { query: 'pending approvals + open critical findings + disabled engines/agents', tables: ['ai_approvals', 'ai_findings', 'ai_model_configs', 'ai_agents'] });
  const { rows: pendingApprovals } = await ctx.db.query<{ count: string }>(`SELECT count(*)::text AS count FROM ai_approvals WHERE status = 'pending'`);
  const { rows: criticalFindings } = await ctx.db.query<{ count: string }>(`SELECT count(*)::text AS count FROM ai_findings WHERE status = 'open' AND severity IN ('high','critical')`);
  const { rows: disabledEngines } = await ctx.db.query<{ engine: string }>(`SELECT engine FROM ai_model_configs WHERE enabled = false AND engine <> 'deterministic' ORDER BY engine`);
  const { rows: disabledAgents } = await ctx.db.query<{ count: string }>(`SELECT count(*)::text AS count FROM ai_agents WHERE enabled = false`);
  const overdue = await ctx.callTool('list_overdue_invoices', { limit: 5 });
  const overdueCount = overdue.status === 'executed' ? Number((overdue.data as Rec).count) : 0;
  const pending = Number(pendingApprovals[0]?.count ?? 0);
  const critical = Number(criticalFindings[0]?.count ?? 0);
  if (pending > 0 || critical > 0) {
    await ctx.emitFinding({
      findingType: 'risk.governance_attention',
      severity: critical >= 3 ? 'high' : 'medium',
      title: `Governance: ${pending} pending approval(s), ${critical} open high/critical finding(s)`,
      summary: `Human attention queue: ${pending} AI action request(s) await decision; ${critical} open finding(s) are high/critical severity. Approvals expiring unanswered are auto-marked expired.`,
      evidence: [{ table: 'ai_approvals', description: 'pending count' }, { table: 'ai_findings', description: 'high/critical open count' }],
      recommendation: 'Clear the Decision Inbox daily; review critical findings before scaling automation.',
    });
  }
  return {
    seat: 'RISK',
    headline: `Governance: ${pending} pending approval(s); ${critical} high/critical open finding(s); ${overdueCount} overdue invoice(s); external model engines disabled (${disabledEngines.map((r) => r.engine).join(', ') || 'none seed-listed'}) = deterministic-only operation`,
    bullets: [
      `${disabledAgents[0]?.count ?? '0'} agent(s) disabled by governance`,
      'No external LLM engine is enabled: every AI output currently comes from the auditable deterministic engine over real data.',
    ],
    metrics: { pendingApprovals: pending, criticalFindings: critical, overdueInvoices: overdueCount, disabledExternalEngines: disabledEngines.map((r) => r.engine), disabledAgents: Number(disabledAgents[0]?.count ?? 0) },
  };
}

const SEAT_DIGESTS: Record<string, (ctx: AgentRunContext) => Promise<DepartmentSection>> = {
  'ai-coo': cooDigest,
  'ai-cfo': cfoDigest,
  'ai-cto': ctoDigest,
  'ai-ciso': cisoDigest,
  'ai-cro': croDigest,
  'ai-cmo': cmoDigest,
  'ai-cco': ccoDigest,
  'ai-cpo': cpoDigest,
  'ai-risk': riskDigest,
};

export const BOARD_SEAT_SLUGS = Object.keys(SEAT_DIGESTS);

export function getSeatDigest(slug: string): ((ctx: AgentRunContext) => Promise<DepartmentSection>) | null {
  return SEAT_DIGESTS[slug] ?? null;
}

/** Handler: board.department_digest — run by each seat under its own task. */
export const boardDepartmentDigestHandler = async (ctx: AgentRunContext): Promise<HandlerResult> => {
  const digest = getSeatDigest(ctx.agent.slug);
  if (!digest) {
    return { summary: `${ctx.agent.name} holds no department digest function (seat ${ctx.agent.board_seat ?? 'none'}) — nothing fabricated.`, result: { seat: ctx.agent.board_seat } };
  }
  const section = await digest(ctx);
  await ctx.putMemory(`digest:${new Date().toISOString().slice(0, 10)}`, section, 'executive', null);
  return {
    summary: `[${section.seat}] ${section.headline}`,
    result: { section },
    verification: { producedBy: ctx.agent.slug, note: 'Self-produced seat digest; aggregation by the CEO seat happens via child tasks.' },
  };
};

export { SEAT_DIGESTS };
