/**
 * Executive Board orchestration + briefing generation (spec §2, §26, §27).
 *
 * The CEO seat aggregates: each other seat produces its own digest as a REAL child task under
 * its own identity (runChildAgent), so a seat's conclusion is never fabricated by another
 * agent — the CEO section quotes section output verbatim alongside its own platform metrics.
 */
import type { Queryable } from '../../db/types';
import type { AgentRunContext, HandlerResult } from '../runtime/types';
import { BOARD_SEAT_SLUGS, getSeatDigest } from './departments';
import { getAgentBySlug } from '../repositories/registry-repo';
import { createTask, getTask } from '../repositories/tasks-repo';
import { getExecutiveReport, insertExecutiveReport } from '../repositories/audit-repo';
import { listFindings } from '../repositories/findings-repo';
import type { ExecutiveReportRow, TaskRow } from '../types';

/** Injected by callers (routes/sweeps) to avoid an import cycle with the executor. */
export type RunTaskFn = (
  db: Queryable,
  taskId: string,
  opts?: { actorUserId?: string | null; customerScopeUserId?: string | null; boardDepth?: number }
) => Promise<{ task: TaskRow; runStatus: string; pendingApprovals: string[] }>;

type Rec = Record<string, unknown>;

function periodFor(type: 'daily' | 'weekly' | 'monthly'): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end);
  if (type === 'weekly') start.setDate(start.getDate() - 6);
  else if (type === 'monthly') start.setDate(start.getDate() - 29);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

/** board.executive_briefing — the CEO seat's own task handler. */
export const boardExecutiveBriefingHandler = async (ctx: AgentRunContext): Promise<HandlerResult> => {
  const reportType = ['daily', 'weekly', 'monthly'].includes(String(ctx.task.context?.reportType))
    ? (String(ctx.task.context?.reportType) as 'daily' | 'weekly' | 'monthly')
    : 'daily';

  // CEO's own observation.
  const overview = await ctx.callTool('get_platform_overview', {});
  if (overview.status !== 'executed') {
    return { summary: `CEO briefing aborted: platform overview unreadable (${overview.message ?? overview.errorCode}) — a briefing from partial data is not produced.` };
  }

  // Each seat reports UNDER ITS OWN identity via child tasks (spec §27).
  const sections: Rec[] = [];
  const failures: string[] = [];
  for (const slug of BOARD_SEAT_SLUGS) {
    const child = await ctx.runChildAgent(
      'board.department_digest',
      { reportType },
      { agentSlug: slug, idempotencyKey: `board:${reportType}:${slug}:${new Date().toISOString().slice(0, 10)}` }
    );
    if (child.status === 'succeeded' && child.result) {
      sections.push((child.result as Rec).section as Rec);
    } else {
      failures.push(`${slug}: ${child.status}${child.summary ? ` — ${child.summary}` : ''}`);
      // Honesty: the seat's missing section is listed as unavailable, never ghost-written.
      const fallbackDigest = getSeatDigest(slug) ? 'seat handler exists but did not succeed' : 'no seat digest registered';
      sections.push({ seat: slug.replace('ai-', '').toUpperCase(), headline: `UNAVAILABLE (${child.status}) — ${fallbackDigest}; this seat's view is omitted rather than fabricated`, bullets: [], metrics: {} });
    }
  }

  const metrics = overview.data as Rec;
  const ceoHeadline = [
    `Platform ${reportType} briefing for ${new Date().toISOString().slice(0, 10)}.`,
    `Customers ${metrics.customers}; collected 24h ${metrics.successfulPayments24h} payment(s); overdue invoices ${metrics.overdueInvoices} (${metrics.overdueAmountTotal}); failed payments 24h ${metrics.failedPayments24h}.`,
    `Support backlog ${metrics.openTickets}; degraded servers ${metrics.serversDegraded}; at-risk subscriptions ${metrics.subscriptionsAtRisk}.`,
  ].join(' ');

  return {
    summary: ceoHeadline,
    result: {
      reportType,
      headline: ceoHeadline,
      sections,
      sectionFailures: failures,
      coordinationNote: 'Every department section was produced by that seat\'s own task; unavailable seats are marked UNAVAILABLE instead of being ghost-written.',
    },
  };
};

export interface BriefingOutcome {
  report: ExecutiveReportRow;
  created: boolean;
  taskId: string | null;
  runStatus: string;
}

/**
 * Generates (or returns the existing) executive briefing for the period. Idempotent per
 * (type, period) via the ai_executive_reports unique constraint — scheduled sweeps and manual
 * clicks can never duplicate a period's final briefing.
 */
export async function generateExecutiveBriefing(
  db: Queryable,
  reportType: 'daily' | 'weekly' | 'monthly',
  actorUserId: string | null,
  runTaskFn: RunTaskFn
): Promise<BriefingOutcome> {
  const period = periodFor(reportType);
  const existing = await getExecutiveReport(db, reportType, period.start, period.end);
  if (existing) return { report: existing, created: false, taskId: null, runStatus: 'already_final' };

  const ceo = await getAgentBySlug(db, 'ai-ceo');
  if (!ceo) throw new Error('AI CEO agent is not registered — seed the registry first');
  const { task } = await createTask(db, {
    agentId: ceo.id,
    taskType: 'board.executive_briefing',
    context: { reportType, periodStart: period.start, periodEnd: period.end },
    requestedBy: actorUserId,
    requestedByType: actorUserId ? 'staff' : 'schedule',
    idempotencyKey: `briefing:${reportType}:${period.end}:${actorUserId ?? 'schedule'}`,
  });
  const outcome = await runTaskFn(db, task.id, { actorUserId });
  const finished = await getTask(db, task.id);
  const result = (finished?.result ?? null) as Rec | null;
  if (outcome.runStatus !== 'succeeded' || !result) {
    return {
      report: (await getExecutiveReport(db, reportType, period.start, period.end)) as ExecutiveReportRow,
      created: false,
      taskId: task.id,
      runStatus: outcome.runStatus,
    };
  }

  // Attach the highest-severity open findings the board should see (real rows, capped).
  const openFindings = await listFindings(db, { status: 'open', limit: 50 });
  const notable = openFindings
    .filter((f) => ['high', 'critical'].includes(f.severity))
    .slice(0, 20)
    .map((f) => ({ id: f.id, type: f.finding_type, severity: f.severity, title: f.title, agent: f.agent_slug }));

  const report = await insertExecutiveReport(db, {
    reportType,
    periodStart: period.start,
    periodEnd: period.end,
    sections: (result.sections as Rec[]) ?? [],
    metrics: {
      headline: result.headline,
      sectionFailures: result.sectionFailures ?? [],
    },
    findings: notable,
    generatedByAgentId: ceo.id,
  });
  return { report, created: true, taskId: task.id, runStatus: 'succeeded' };
}

/** Board War Room view: seats + their latest digest memory + open high findings. */
export async function getBoardOverview(db: Queryable): Promise<Record<string, unknown>> {
  const { rows: seats } = await db.query<Rec>(
    `SELECT id, slug, name, board_seat, enabled, status FROM ai_agents WHERE board_seat IS NOT NULL ORDER BY board_seat`
  );
  const { rows: digests } = await db.query<Rec>(
    `SELECT DISTINCT ON (agent_slug) agent_slug, value, updated_at
     FROM ai_memories
     WHERE scope = 'executive' AND agent_slug IS NOT NULL AND memory_key LIKE 'digest:%'
     ORDER BY agent_slug, updated_at DESC`
  );
  const { rows: pendingApprovals } = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM ai_approvals WHERE status = 'pending'`);
  const { rows: openHigh } = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM ai_findings WHERE status = 'open' AND severity IN ('high','critical')`);
  const digestBySlug = new Map(digests.map((d) => [String(d.agent_slug), d]));
  return {
    seats: seats.map((s) => {
      const digest = digestBySlug.get(String(s.slug));
      return {
        slug: s.slug,
        name: s.name,
        seat: s.board_seat,
        enabled: s.enabled,
        status: s.status,
        latestDigest: digest ? { ...(digest.value as Rec), producedAt: digest.updated_at } : null,
      };
    }),
    pendingApprovals: Number(pendingApprovals[0]?.count ?? 0),
    openHighSeverityFindings: Number(openHigh[0]?.count ?? 0),
    note: 'Sections quote each seat\'s own last produced digest; seats without a recent digest have null — the Board never ghost-writes them.',
  };
}
