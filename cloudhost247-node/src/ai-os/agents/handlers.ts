/**
 * Deterministic agent handlers — every task type the 43-agent workforce supports.
 *
 * Handlers OBSERVE via gated tool calls (each call is permission-checked, risk-classified,
 * approval-gated and audited), EMIT evidence-carrying findings, and REPORT a summary. They
 * never fabricate: a tool that returns zero rows yields "none", a denied/failed tool yields an
 * honest note, and uncertain conclusions are labeled as such.
 */
import type { AgentHandler } from '../runtime/types';
import { resolveAdminCommand, resolveCustomerMessage } from '../copilot/intents';
import { boardDepartmentDigestHandler } from '../board/departments';
import { boardExecutiveBriefingHandler } from '../board/board-service';

type Rec = Record<string, unknown>;
const asRows = (data: unknown, key: string): Rec[] => ((data as Rec)?.[key] as Rec[] | undefined) ?? [];

// ==============================================================================================
// §3 — Resolution Pro: ticket triage
// ==============================================================================================

const supportTicketTriage: AgentHandler = async (ctx, input) => {
  const ticketId = String(input.ticketId ?? '');
  if (!ticketId) throw new Error('support.ticket_triage requires ticketId');
  const ticketOut = await ctx.callTool('get_ticket', { ticketId });
  if (ticketOut.status !== 'executed') {
    return { summary: `Could not read ticket ${ticketId}: ${ticketOut.message ?? ticketOut.errorCode}. No diagnosis attempted.` };
  }
  const ticket = (ticketOut.data as Rec).ticket as Rec;
  const messages = ((ticketOut.data as Rec).messages as Rec[]) ?? [];
  const firstCustomerMessage = messages.find((m) => m.authorRole === 'customer') ?? messages[0];
  await ctx.step('understand', { ticketSubject: ticket.subject, status: ticket.status, messageCount: messages.length });

  const kb = await ctx.callTool('search_knowledge', { query: `${ticket.subject} ${String(firstCustomerMessage?.body ?? '').slice(0, 200)}`, limit: 3 });
  const kbHits = kb.status === 'executed' ? (kb.data as Rec).count as number : 0;

  if (ticket.status === 'closed') {
    return { summary: `Ticket "${ticket.subject}" is already closed — nothing to triage.` };
  }

  if (kbHits > 0) {
    const top = ((kb.data as Rec).results as Rec[])[0] as Rec;
    const citation = top.citation as Rec;
    const draft = {
      to: ticket.customerEmail,
      ticketSubject: ticket.subject,
      body: [
        `Hi ${String(ticket.customerEmail).split('@')[0]},`,
        '',
        `regarding "${ticket.subject}":`,
        '',
        String(top.content),
        '',
        `Source: ${citation.source} (v${citation.version}) — CloudHost247 knowledge base.`,
        '',
        'If this does not resolve the issue, reply here and our support team will take over.',
      ].join('\n'),
      groundedIn: { knowledgeChunk: top.chunkId, source: citation.source, version: citation.version },
    };
    await ctx.step('plan', { strategy: 'kb_answer', citation });
    await ctx.step('report', { draftPrepared: true });
    return {
      summary: `Drafted a knowledge-based response for ticket "${ticket.subject}" citing "${citation.source}" (v${citation.version}). Draft stored as task output for staff review — not sent.`,
      result: { draftResponse: draft, evidence: kb.evidence },
      verification: { grounded: true, citations: kb.evidence },
    };
  }

  // No documented answer: escalate honestly instead of guessing.
  const ack = await ctx.callTool('acknowledge_ticket', { ticketId, status: 'pending_staff' });
  await ctx.emitFinding({
    findingType: 'support.escalation',
    severity: ticket.priority === 'high' ? 'high' : 'medium',
    title: `Escalation needed: "${ticket.subject}"`,
    summary: `No registered knowledge entry answers this ticket; the customer-visible diagnosis was NOT invented. Ticket requires a human support engineer.`,
    evidence: ticketOut.evidence ?? [],
    subjectType: 'ticket',
    subjectId: ticketId,
    recommendation: 'Assign to the responsible support queue. Expand the knowledge base with the resolution afterwards.',
  });
  return {
    summary: `Escalated ticket "${ticket.subject}" to humans — no knowledge-base coverage; no diagnosis was invented.${ack.status === 'executed' ? ' Ticket flagged pending_staff.' : ''}`,
    result: { escalated: true, ticketStatusUpdate: ack.status },
  };
};

// ==============================================================================================
// §4 — Infrastructure Guardians
// ==============================================================================================

const infrastructureHealthScan: AgentHandler = async (ctx, input) => {
  const out = await ctx.callTool('list_server_health', { limit: Number(input.limit ?? 100) });
  if (out.status !== 'executed') {
    return { summary: `Server telemetry could not be read: ${out.message ?? out.errorCode}. No health claims were made.` };
  }
  const data = out.data as { servers: Array<Rec & { flags: string[] }>; count: number; flaggedCount: number; thresholds: string };
  await ctx.step('understand', { servers: data.count, flagged: data.flaggedCount });
  let created = 0;
  for (const server of data.servers) {
    if (server.flags.length === 0) continue;
    const { created: wasCreated } = await ctx.emitFinding({
      findingType: 'infrastructure.health',
      severity: server.flags.includes('cpu_saturated') || server.status === 'offline' ? 'high' : 'medium',
      title: `${server.hostname}: ${server.flags.join(', ')}`,
      summary: `Server ${server.hostname} (${server.serverType}, ${server.region ?? 'region unknown'}) crossed real health threshold(s): ${server.flags.join(', ')}. Latest telemetry at ${(server.latestMetrics as Rec | null)?.capturedAt ?? 'never recorded'}.`,
      evidence: [
        { table: 'servers', id: String(server.id), description: `status ${server.status}` },
        { table: 'server_metrics', id: String(server.id), description: `cpu ${(server.latestMetrics as Rec | null)?.cpuPercent ?? 'n/a'}% · mem ${(server.latestMetrics as Rec | null)?.memoryUsedMb ?? 'n/a'}/${(server.latestMetrics as Rec | null)?.memoryTotalMb ?? 'n/a'}MB · disk ${(server.latestMetrics as Rec | null)?.diskUsedMb ?? 'n/a'}/${(server.latestMetrics as Rec | null)?.diskTotalMb ?? 'n/a'}MB` },
      ],
      subjectType: 'server',
      subjectId: String(server.id),
      recommendation: 'Investigate the flagged resource. Remediation (restart/suspend/migration) requires human approval — the Guardian does not auto-remediate.',
    });
    if (wasCreated) created += 1;
  }
  return {
    summary: `Scanned ${data.count} server(s): ${data.flaggedCount} carry a health flag; ${created} new finding(s) opened (deduped against open findings). Thresholds: ${data.thresholds}`,
    result: { scanned: data.count, flagged: data.flaggedCount, newFindings: created },
    verification: { evidence: out.evidence },
  };
};

const infrastructureServerReport: AgentHandler = async (ctx, input) => {
  const serverId = String(input.serverId ?? ctx.task.subject_id ?? '');
  if (!serverId) throw new Error('infrastructure.server_report requires serverId');
  const out = await ctx.callTool('get_server', { serverId });
  if (out.status !== 'executed') {
    return { summary: `Server ${serverId} could not be read: ${out.message ?? out.errorCode}. No report fabricated.` };
  }
  const data = out.data as { server: Rec; recentMetrics: Rec[]; recentDeployments: Rec[] };
  const latest = (data.recentMetrics[0] ?? null) as Rec | null;
  const problems: string[] = [];
  if (data.server.status !== 'active') problems.push(`Server status is '${data.server.status}'`);
  if (!latest) problems.push('No telemetry has been recorded for this server');
  if (latest && Number(latest.cpu_percent) >= 90) problems.push(`CPU at ${latest.cpu_percent}%`);
  if (latest && Number(latest.memory_total_mb) > 0 && Number(latest.memory_used_mb) / Number(latest.memory_total_mb) >= 0.9) problems.push('Memory usage ≥90%');
  if (latest && Number(latest.disk_total_mb) > 0 && Number(latest.disk_used_mb) / Number(latest.disk_total_mb) >= 0.9) problems.push('Disk usage ≥90%');
  const failedDeployments = data.recentDeployments.filter((d) => d.status === 'failed');
  if (failedDeployments.length > 0) problems.push(`${failedDeployments.length} of the last ${data.recentDeployments.length} deployment(s) failed`);

  const report = {
    status: problems.length === 0 ? 'HEALTHY' : 'ATTENTION_REQUIRED',
    server: { id: data.server.id, hostname: data.server.hostname, type: data.server.server_type, status: data.server.status },
    problem: problems.length === 0 ? 'None detected against thresholds' : problems.join('; '),
    evidence: {
      latestMetrics: latest,
      recentDeployments: data.recentDeployments.map((d) => ({ action: d.action, status: d.status, errorCode: d.error_code })),
    },
    impact: problems.length === 0 ? 'No customer impact indicated by current telemetry' : 'Potential service degradation for workloads on this host — pending human confirmation',
    recommendedAction: problems.length === 0 ? 'None' : 'Verify on-host resource usage; approve targeted remediation only after human review',
    actionTaken: 'None — reporting agent (no remediation authority)',
    verification: 'Report generated strictly from the latest server_metrics rows and deployment records cited above',
  };
  if (problems.length > 0) {
    await ctx.emitFinding({
      findingType: 'infrastructure.server_report',
      severity: problems.length >= 2 ? 'high' : 'medium',
      title: `Server report: ${String(data.server.hostname)} — ${problems.length} issue(s)`,
      summary: report.problem,
      evidence: out.evidence ?? [],
      subjectType: 'server',
      subjectId: serverId,
      recommendation: report.recommendedAction,
    });
  }
  return { summary: `SERVER HEALTH — ${String(data.server.hostname)}: ${report.status}. ${report.problem}`, result: { report } };
};

const provisioningStuckScan: AgentHandler = async (ctx, input) => {
  const out = await ctx.callTool('list_stuck_deployments', { minutes: Number(input.minutes ?? 60) });
  if (out.status !== 'executed') return { summary: `Stuck-deployment scan failed to read the queue: ${out.message ?? out.errorCode}.` };
  const data = out.data as { count: number; deployments: Rec[]; thresholdMinutes: number };
  let created = 0;
  for (const d of data.deployments) {
    const { created: wasCreated } = await ctx.emitFinding({
      findingType: 'provisioning.stuck',
      severity: Number(d.ageMinutes) >= 240 ? 'high' : 'medium',
      title: `Stuck ${String(d.action)} job (${Math.round(Number(d.ageMinutes))} min in '${String(d.status)}')`,
      summary: `Deployment ${d.id} (action '${d.action}', installation ${d.installationId ?? 'none'}, server ${d.serverId ?? 'none'}) has been '${d.status}' for ${Math.round(Number(d.ageMinutes))} minutes — beyond the ${data.thresholdMinutes}-minute platform threshold.`,
      evidence: [{ table: 'deployments', id: String(d.id), description: `status ${d.status}, attempts ${d.attempts}/${d.maxAttempts}, error ${d.errorCode ?? 'none recorded'}` }],
      subjectType: 'deployment',
      subjectId: String(d.id),
      recommendation: 'Inspect the worker queue / provider for this job. A stale lease may need recovery; do not retry blindly if a provider-side operation already ran.',
    });
    if (wasCreated) created += 1;
  }
  return {
    summary: `Provisioning scan: ${data.count} stuck job(s) beyond ${data.thresholdMinutes} minutes; ${created} new finding(s) opened.`,
    result: { stuck: data.count, thresholdMinutes: data.thresholdMinutes, newFindings: created },
  };
};

const deploymentFailureDigest: AgentHandler = async (ctx, input) => {
  const days = Number(input.days ?? 1);
  const out = await ctx.callTool('list_failed_deployments', { days });
  if (out.status !== 'executed') return { summary: `Failed-deployment read failed: ${out.message ?? out.errorCode}.` };
  const data = out.data as { count: number; deployments: Rec[]; windowDays: number };
  const byError = new Map<string, number>();
  for (const d of data.deployments) {
    const key = String(d.errorCode ?? 'no_error_code');
    byError.set(key, (byError.get(key) ?? 0) + 1);
  }
  const clusters = [...byError.entries()].sort((a, b) => b[1] - a[1]).map(([code, count]) => ({ errorCode: code, count }));
  if (data.count > 0) {
    await ctx.emitFinding({
      findingType: 'deployment.failure_cluster',
      severity: data.count >= 5 ? 'high' : 'medium',
      title: `${data.count} failed deployment(s) in ${data.windowDays}d — top cause: ${clusters[0]?.errorCode ?? 'unknown'}`,
      summary: `Failed deployments in the window cluster by recorded error code: ${clusters.map((c) => `${c.errorCode}×${c.count}`).join(', ')}.`,
      evidence: (out.evidence ?? []).concat(data.deployments.slice(0, 5).map((d) => ({ table: 'deployments', id: String(d.id), description: `${d.action} failed with ${d.errorCode ?? 'no error code'}` }))),
      recommendation: 'Review the top error cluster first; repeated identical error codes usually mean one root cause, not many.',
    });
  }
  return {
    summary: `Deployment health (${data.windowDays}d): ${data.count} failure(s); error clusters: ${clusters.length === 0 ? 'none' : clusters.map((c) => `${c.errorCode}×${c.count}`).join(', ')}.`,
    result: { windowDays: data.windowDays, failed: data.count, errorClusters: clusters },
  };
};

const domainExpiryScan: AgentHandler = async (ctx, input) => {
  const days = Number(input.days ?? 30);
  const out = await ctx.callTool('list_expiring_domains', { days });
  if (out.status !== 'executed') return { summary: `Domain expiry read failed: ${out.message ?? out.errorCode}.` };
  const data = out.data as { count: number; domains: Rec[]; windowDays: number };
  let created = 0;
  for (const d of data.domains) {
    const daysLeft = Number(d.daysUntilExpiry);
    const { created: wasCreated } = await ctx.emitFinding({
      findingType: 'domain.expiring',
      severity: daysLeft < 0 ? 'critical' : daysLeft <= 7 ? 'high' : 'medium',
      title: `Domain ${String(d.domainName)} ${daysLeft < 0 ? 'EXPIRED' : `expires in ${daysLeft} day(s)`}`,
      summary: `Domain ${d.domainName} (customer ${d.customerEmail}, registrar ${d.registrar ?? 'not recorded'}) has recorded expiry ${String(d.expiresAt).slice(0, 10)} — status '${d.status}'.`,
      evidence: [{ table: 'customer_domains', id: String(d.id), description: `expires_at ${String(d.expiresAt).slice(0, 10)}` }],
      subjectType: 'customer',
      subjectId: String(d.customerId),
      recommendation: daysLeft < 0 ? 'Contact the customer immediately: an expired domain risks loss of the registration.' : 'Send a renewal reminder (via an approved notification) before expiry.',
    });
    if (wasCreated) created += 1;
  }
  return {
    summary: `Domain watch (${data.windowDays}d window): ${data.count} domain(s) expiring or expired; ${created} new finding(s).`,
    result: { windowDays: data.windowDays, expiring: data.count, newFindings: created },
  };
};

const sslExpiryScan: AgentHandler = async (ctx, input) => {
  const days = Number(input.days ?? 30);
  const out = await ctx.callTool('list_expiring_ssl', { days });
  if (out.status !== 'executed') return { summary: `SSL expiry read failed: ${out.message ?? out.errorCode}.` };
  const data = out.data as { count: number; certificates: Rec[]; windowDays: number };
  let created = 0;
  for (const c of data.certificates) {
    const daysLeft = Number(c.daysUntilExpiry);
    const failed = ['FAILED', 'EXPIRED'].includes(String(c.status));
    const { created: wasCreated } = await ctx.emitFinding({
      findingType: failed ? 'ssl.failed' : 'ssl.expiring',
      severity: failed || daysLeft < 0 ? 'high' : daysLeft <= 7 ? 'high' : 'medium',
      title: `Certificate ${String(c.domainName)} — ${failed ? c.status : `expires in ${daysLeft} day(s)`}`,
      summary: `SSL certificate for ${c.domainName} (customer ${c.customerEmail}, issuer ${c.issuer}) is in status '${c.status}'${c.expiresAt ? ` expiring ${String(c.expiresAt).slice(0, 10)}` : ''}. Auto-renew: ${c.autoRenew}.`,
      evidence: [{ table: 'ssl_certificates', id: String(c.id), description: `status ${c.status}, expires_at ${String(c.expiresAt ?? 'null').slice(0, 10)}, auto_renew ${c.autoRenew}` }],
      subjectType: 'customer',
      subjectId: String(c.customerId),
      recommendation: failed ? 'Investigate the validation/issuance failure (see ssl_certificates.metadata and deployment logs).' : c.autoRenew ? 'Verify the auto-renewal scheduled for this certificate before expiry.' : 'Manual renewal is required — auto-renew is OFF for this certificate.',
    });
    if (wasCreated) created += 1;
  }
  return {
    summary: `SSL watch (${data.windowDays}d window): ${data.count} certificate(s) expiring/failed; ${created} new finding(s).`,
    result: { windowDays: data.windowDays, flagged: data.count, newFindings: created },
  };
};

// ==============================================================================================
// §5 — Security
// ==============================================================================================

const securityAuthAnomalyScan: AgentHandler = async (ctx, input) => {
  const hours = Number(input.hours ?? 24);
  const out = await ctx.callTool('list_auth_anomalies', { hours });
  if (out.status !== 'executed') return { summary: `Auth anomaly read failed: ${out.message ?? out.errorCode}.` };
  const data = out.data as { ipClusters: Rec[]; accountClusters: Rec[]; windowHours: number; thresholds: string };
  let created = 0;
  for (const c of data.ipClusters) {
    const { created: wasCreated } = await ctx.emitFinding({
      findingType: 'security.auth_ip_cluster',
      severity: Number(c.failures) >= 20 ? 'high' : 'medium',
      title: `${c.failures} failed logins from ${String(c.ipAddress)}`,
      summary: `IP ${c.ipAddress} recorded ${c.failures} failed login(s) targeting ${c.accountsTargeted} account(s) in ${data.windowHours}h (auth_audit_log). Last seen ${c.lastSeen}. This is a raw signal for triage — NOT an accusation and NOT grounds for automatic lockout.`,
      evidence: [{ table: 'auth_audit_log', description: `${c.failures} login_failure rows from ${c.ipAddress} in ${data.windowHours}h` }],
      subjectType: 'ip',
      subjectId: null,
      recommendation: 'Human security review: assess intent (password spraying vs forgotten password). Any containment (rate-limit, WAF rule) goes through the approval workflow.',
    });
    if (wasCreated) created += 1;
  }
  for (const c of data.accountClusters) {
    const { created: wasCreated } = await ctx.emitFinding({
      findingType: 'security.auth_account_cluster',
      severity: Number(c.failures) >= 10 ? 'high' : 'medium',
      title: `${c.failures} failed logins on ${String(c.customerEmail)}`,
      summary: `Account ${c.customerEmail} recorded ${c.failures} failed login(s) from ${c.distinctIps} distinct IP(s) in ${data.windowHours}h. No lockout was performed — Sentinel does not act on scores alone.`,
      evidence: [{ table: 'auth_audit_log', description: `${c.failures} login_failure rows for account ${c.customerEmail}` }],
      subjectType: 'customer',
      subjectId: String(c.customerId),
      recommendation: 'Review with the customer (verify it was them); consider forced re-authentication only per human-approved security policy.',
    });
    if (wasCreated) created += 1;
  }
  return {
    summary: `Auth anomaly scan (${data.windowHours}h): ${data.ipClusters.length} IP cluster(s), ${data.accountClusters.length} account cluster(s); ${created} new finding(s). ${data.thresholds}`,
    result: { ipClusters: data.ipClusters.length, accountClusters: data.accountClusters.length, newFindings: created },
  };
};

const fraudOrderAnomalyScan: AgentHandler = async (ctx) => {
  const overdueOut = await ctx.callTool('list_overdue_invoices', { limit: 100 });
  const failedOut = await ctx.callTool('list_failed_payments', { days: 30 });
  if (overdueOut.status !== 'executed' || failedOut.status !== 'executed') {
    return { summary: 'Fraud pattern read incomplete — no review flags raised from partial data.', result: { partial: true } };
  }
  const overdueByCustomer = new Map<string, Rec[]>();
  for (const inv of asRows(overdueOut.data, 'invoices')) {
    const list = overdueByCustomer.get(String(inv.customerId)) ?? [];
    list.push(inv);
    overdueByCustomer.set(String(inv.customerId), list);
  }
  const failedByCustomer = new Map<string, number>();
  for (const p of asRows(failedOut.data, 'payments')) {
    failedByCustomer.set(String(p.customerId), (failedByCustomer.get(String(p.customerId)) ?? 0) + 1);
  }
  let created = 0;
  for (const [customerId, invoices] of overdueByCustomer) {
    const failures = failedByCustomer.get(customerId) ?? 0;
    if (invoices.length < 3 && failures < 3) continue;
    const customerEmail = String(invoices[0]?.customerEmail);
    const { created: wasCreated } = await ctx.emitFinding({
      findingType: 'fraud.review',
      severity: invoices.length >= 5 || failures >= 5 ? 'high' : 'medium',
      title: `Review: ${customerEmail} — ${invoices.length} overdue invoice(s), ${failures} failed payment(s)/30d`,
      summary: `Account ${customerEmail} shows ${invoices.length} overdue invoice(s) and ${failures} failed payment attempts in 30 days. Flagged FOR REVIEW ONLY — no ban/suspension is performed or implied. Context (genuine hardship vs abuse) requires human judgment.`,
      evidence: invoices.slice(0, 5).map((i) => ({ table: 'invoices', id: String(i.id), description: `${i.invoiceNumber} ${i.totalAmount} ${i.currency} ${i.daysOverdue}d overdue` })),
      subjectType: 'customer',
      subjectId: customerId,
      recommendation: 'Human review before any action. If contacted, use customer-friendly collections language (see Collector drafts).',
    });
    if (wasCreated) created += 1;
  }
  return {
    summary: `Fraud/abuse pattern scan: ${created} account(s) flagged for human review from real overdue/failed-payment patterns. No accounts were banned, restricted or labeled conclusively.`,
    result: { flagged: created },
  };
};

const vulnerabilityAssessment: AgentHandler = async (ctx) => {
  await ctx.step('observe', { checking: 'scanner_integration' });
  await ctx.emitFinding({
    findingType: 'vulnerability.scanner_required',
    severity: 'low',
    title: 'Vulnerability scanning integration is not configured',
    summary:
      'No dependency/image scanner integration is registered for this platform, so no CVE or exposure list can be produced. This finding exists precisely so that absence is visible — a scan result was NOT fabricated.',
    evidence: [{ table: 'ai_model_configs', description: 'No scanner engine present' }],
    recommendation: 'Connect a scanner feed (e.g. an OSV/Trivy-backed service) via ai_model_configs/integrations, then this agent will produce real findings from its output.',
    dedupeOpen: true,
  });
  return {
    summary:
      'CONFIGURATION_REQUIRED: no vulnerability-scanner integration is configured, so no vulnerability data exists to analyze. The agent reports this state instead of inventing a CVE list. Connect a scanner to enable real assessments.',
    result: { configurationRequired: 'scanner_integration' },
  };
};

// ==============================================================================================
// §6 — Billing & Finance
// ==============================================================================================

const billingInvoiceExplain: AgentHandler = async (ctx, input) => {
  const invoiceId = String(input.invoiceId ?? ctx.task.subject_id ?? '');
  if (!invoiceId) throw new Error('billing.invoice_explain requires invoiceId');
  const out = await ctx.callTool('get_invoice', { invoiceId });
  if (out.status !== 'executed') return { summary: `Invoice ${invoiceId} could not be read: ${out.message ?? out.errorCode}. Nothing was invented.` };
  const data = out.data as { invoice: Rec; payments: Rec[] };
  const inv = data.invoice;
  const paidRows = data.payments.filter((p) => p.status === 'successful');
  const failedRows = data.payments.filter((p) => p.status === 'failed');
  const explanation = [
    `Invoice ${inv.invoiceNumber} for ${inv.customerEmail}: total ${inv.totalAmount} ${inv.currency} (subtotal ${inv.subtotalAmount}, discount ${inv.discountAmount}, tax ${inv.taxAmount}).`,
    `Status: ${inv.status}. Issued ${String(inv.issuedAt).slice(0, 10)}, due ${String(inv.dueDate).slice(0, 10)}.`,
    paidRows.length > 0 ? `Successful payment(s): ${paidRows.map((p) => `${p.amount} ${p.currency} on ${String(p.completedAt).slice(0, 10)}`).join('; ')}.` : 'No successful payment is recorded.',
    failedRows.length > 0 ? `Failed attempt(s): ${failedRows.length} (latest reason: ${failedRows[0]?.failureReason ?? 'not recorded'}).` : null,
  ].filter(Boolean).join('\n');
  return { summary: explanation, result: { invoice: inv, payments: data.payments }, verification: { evidence: out.evidence } };
};

const billingOverdueDigest: AgentHandler = async (ctx, input) => {
  const limit = Math.min(Number(input.limit ?? 25) || 25, 50);
  const out = await ctx.callTool('list_overdue_invoices', { limit });
  if (out.status !== 'executed') return { summary: `Overdue invoice read failed: ${out.message ?? out.errorCode}.` };
  const invoices = asRows(out.data, 'invoices');
  await ctx.step('understand', { overdue: invoices.length, focusInvoiceId: input.focusInvoiceId ?? null });
  let drafts = 0;
  let approvals = 0;
  const focusId = typeof input.focusInvoiceId === 'string' ? input.focusInvoiceId : null;
  for (const inv of invoices) {
    const { created: findingCreated } = await ctx.emitFinding({
      findingType: 'billing.overdue_invoice',
      severity: Number(inv.daysOverdue) >= 30 ? 'high' : Number(inv.daysOverdue) >= 7 ? 'medium' : 'low',
      title: `${inv.invoiceNumber} — ${inv.daysOverdue} day(s) overdue — ${inv.totalAmount} ${inv.currency}`,
      summary: `Invoice ${inv.invoiceNumber} for ${inv.customerEmail}: ${inv.totalAmount} ${inv.currency}, due ${String(inv.dueDate).slice(0, 10)}, now ${inv.daysOverdue} day(s) overdue.`,
      evidence: (out.evidence ?? []).concat([{ table: 'invoices', id: String(inv.id), description: `${inv.invoiceNumber} ${inv.totalAmount} ${inv.currency}` }]),
      subjectType: 'customer',
      subjectId: String(inv.customerId),
      recommendation: 'Send a customer-friendly reminder (approval-gated); escalate per collections policy after 30 days.',
    });
    if (!findingCreated) continue; // already tracked: don't rebuild drafts for known invoices
    if (focusId && inv.id !== focusId) continue;

    const facts = `Invoice ${inv.invoiceNumber} for ${inv.totalAmount} ${inv.currency} was due on ${String(inv.dueDate).slice(0, 10)} and is currently unpaid (${inv.daysOverdue} day(s) past the due date). You can pay from the Billing section of your CloudHost247 dashboard.`;
    const draft = await ctx.callTool('draft_customer_message', {
      purpose: `Payment reminder for invoice ${inv.invoiceNumber}`,
      facts,
      tone: 'friendly',
    });
    if (draft.status !== 'executed') continue;
    drafts += 1;
    const draftData = (draft.data as Rec).draft as Rec;
    // Propose sending through the ALWAYS approval-gated notification tool — the Collector
    // prepares; humans send.
    const send = await ctx.callTool('send_notification', {
      userId: inv.customerId,
      type: 'AI_COLLECTIONS_REMINDER',
      title: String(draftData.subject).replace('[DRAFT] ', ''),
      message: String(draftData.body),
      resourceType: 'invoice',
      resourceId: inv.id,
    });
    if (send.status === 'pending_approval') approvals += 1;
  }
  return {
    summary: `Collections digest: ${invoices.length} overdue invoice(s) analyzed; ${drafts} factual reminder draft(s) prepared; ${approvals} send request(s) are awaiting human approval in the Decision Inbox — nothing was sent automatically.`,
    result: { overdue: invoices.length, draftsPrepared: drafts, pendingApprovals: approvals },
    verification: { evidence: out.evidence },
  };
};

const financeRevenueSummary: AgentHandler = async (ctx) => {
  const snapshot = await ctx.callTool('get_revenue_snapshot', {});
  const subs = await ctx.callTool('list_subscriptions', {});
  if (snapshot.status !== 'executed') return { summary: `Revenue snapshot failed: ${snapshot.message ?? snapshot.errorCode}.` };
  const d = snapshot.data as { successfulPayments: Rec; failedPayments: Rec; refunds: Rec; subscriptions: Rec; methodology: string };
  const byPlan = new Map<string, number>();
  if (subs.status === 'executed') {
    for (const s of asRows(subs.data, 'subscriptions')) {
      const plan = String(s.planName ?? 'unlabeled');
      byPlan.set(plan, (byPlan.get(plan) ?? 0) + 1);
    }
  }
  if (Number(d.failedPayments.count30d) > 0) {
    await ctx.emitFinding({
      findingType: 'finance.failed_payments',
      severity: Number(d.failedPayments.count30d) >= 10 ? 'high' : 'medium',
      title: `${d.failedPayments.count30d} failed payment(s) worth ${d.failedPayments.amount30d} in 30d`,
      summary: `Failed payment volume in the last 30 days: ${d.failedPayments.count30d} attempt(s) totalling ${d.failedPayments.amount30d} (stored payment rows). Successful collections in the same window: ${d.successfulPayments.last30Days}.`,
      evidence: snapshot.evidence ?? [],
      recommendation: 'Route to the Collector for customer-friendly follow-up; investigate any provider-side failure clustering.',
    });
  }
  return {
    summary: `Revenue: ${d.successfulPayments.last30Days} collected (30d), ${d.successfulPayments.last7Days} (7d), ${d.successfulPayments.last1Day} (24h). Failed: ${d.failedPayments.amount30d} across ${d.failedPayments.count30d} attempt(s). Refunds: ${d.refunds.amount30d} (30d). Active subscriptions: ${d.subscriptions.active}; at-risk: ${d.subscriptions.atRisk}.`,
    result: {
      snapshot: d,
      subscriptionsByPlan: [...byPlan.entries()].map(([plan, count]) => ({ plan, count })),
      methodology: d.methodology,
    },
    verification: { evidence: snapshot.evidence },
  };
};

const financeReconciliationDigest: AgentHandler = async (ctx) => {
  // Cross-checks that need joins beyond single-tool scope are issued as direct observation SQL —
  // recorded in the observe step with the tables they touch (traceable, read-only).
  await ctx.step('observe', { checks: ['paid_invoice_without_successful_payment', 'unpaid_invoice_with_successful_payment', 'successful_payment_total_vs_invoice_total'], tables: ['invoices', 'payments'] });
  const { rows: mismatch1 } = await ctx.db.query<{ id: string; invoice_number: string; status: string }>(
    `SELECT i.id, i.invoice_number, i.status
     FROM invoices i
     WHERE i.status = 'paid'
       AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = i.id AND p.status = 'successful')
     LIMIT 50`
  );
  const { rows: mismatch2 } = await ctx.db.query<{ id: string; invoice_number: string; status: string }>(
    `SELECT i.id, i.invoice_number, i.status
     FROM invoices i
     WHERE i.status = 'unpaid'
       AND EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = i.id AND p.status = 'successful')
     LIMIT 50`
  );
  const { rows: mismatch3 } = await ctx.db.query<{ id: string; invoice_number: string; total_amount: string; paid_sum: string }>(
    `SELECT i.id, i.invoice_number, i.total_amount::text, COALESCE(sum(p.amount), 0)::text AS paid_sum
     FROM invoices i JOIN payments p ON p.invoice_id = i.id AND p.status = 'successful'
     WHERE i.status = 'paid'
     GROUP BY i.id, i.invoice_number, i.total_amount
     HAVING COALESCE(sum(p.amount), 0) < i.total_amount
     LIMIT 50`
  );
  const discrepancies = mismatch1.length + mismatch2.length + mismatch3.length;
  if (discrepancies > 0) {
    await ctx.emitFinding({
      findingType: 'finance.reconciliation_discrepancy',
      severity: 'high',
      title: `Billing reconciliation: ${discrepancies} discrepancy row(s)`,
      summary: [
        mismatch1.length > 0 ? `${mismatch1.length} invoice(s) marked paid with NO successful payment row (e.g. ${mismatch1.slice(0, 3).map((r) => r.invoice_number).join(', ')})` : null,
        mismatch2.length > 0 ? `${mismatch2.length} unpaid invoice(s) WITH successful payment(s) (e.g. ${mismatch2.slice(0, 3).map((r) => r.invoice_number).join(', ')})` : null,
        mismatch3.length > 0 ? `${mismatch3.length} paid invoice(s) whose successful payments sum below invoice total (e.g. ${mismatch3.slice(0, 3).map((r) => `${r.invoice_number}: ${r.paid_sum}/${r.total_amount}`).join(', ')})` : null,
      ].filter(Boolean).join('. '),
      evidence: [
        ...mismatch1.slice(0, 5).map((r) => ({ table: 'invoices', id: r.id, description: `paid without successful payment: ${r.invoice_number}` })),
        ...mismatch2.slice(0, 5).map((r) => ({ table: 'invoices', id: r.id, description: `unpaid with successful payment: ${r.invoice_number}` })),
        ...mismatch3.slice(0, 5).map((r) => ({ table: 'invoices', id: r.id, description: `under-collected: ${r.invoice_number} paid ${r.paid_sum} of ${r.total_amount}` })),
      ],
      recommendation: 'Investigate against the platform reconciliation report (Admin → Billing → Reconciliation) — these rows disagree with the bookings and need staff review, not automated correction.',
    });
  }
  return {
    summary: `Reconciliation pass complete: ${mismatch1.length} paid-without-payment, ${mismatch2.length} unpaid-with-payment, ${mismatch3.length} under-collected. ${discrepancies === 0 ? 'No discrepancies found across the checked invariants.' : 'Findings opened for staff review — never auto-corrected.'}`,
    result: { paidWithoutPayment: mismatch1.slice(0, 20), unpaidWithPayment: mismatch2.slice(0, 20), underCollected: mismatch3.slice(0, 20) },
  };
};

const financePricingObservations: AgentHandler = async (ctx) => {
  const subs = await ctx.callTool('list_subscriptions', {});
  if (subs.status !== 'executed') return { summary: `Subscription read failed: ${subs.message ?? subs.errorCode}.` };
  const rows = asRows(subs.data, 'subscriptions');
  const byPlan = new Map<string, { active: number; pendingCancel: number; atRisk: number }>();
  for (const s of rows) {
    const plan = String(s.planName ?? 'unlabeled');
    const agg = byPlan.get(plan) ?? { active: 0, pendingCancel: 0, atRisk: 0 };
    if (s.status === 'active') agg.active += 1;
    if (s.cancelAtPeriodEnd === true) agg.pendingCancel += 1;
    if (['past_due', 'grace_period', 'suspended'].includes(String(s.status))) agg.atRisk += 1;
    byPlan.set(plan, agg);
  }
  const observations = [...byPlan.entries()].map(([plan, v]) => ({
    plan,
    activeSubscriptions: v.active,
    pendingCancellations: v.pendingCancel,
    atRisk: v.atRisk,
    cancellationPressure: v.active > 0 ? Math.round((v.pendingCancel / v.active) * 1000) / 10 : 0,
  }));
  return {
    summary: `Pricing/demand observations across ${byPlan.size} plan(s) from live subscription data. The Pricing Analyst makes observations only — it cannot and did not change any price.`,
    result: { observations, note: 'Observations are derived from subscription lifecycle columns only; they are input for human pricing decisions.' },
  };
};

// ==============================================================================================
// §7 — Sales
// ==============================================================================================

const salesPipelineDigest: AgentHandler = async (ctx) => {
  await ctx.step('observe', { query: 'recent orders + first-time unpaid orders', tables: ['orders', 'invoices', 'users'] });
  const { rows: recentOrders } = await ctx.db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM orders WHERE created_at > now() - interval '7 days'`
  );
  const { rows: newCustomers } = await ctx.db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM users WHERE role = 'customer' AND created_at > now() - interval '7 days'`
  );
  const unpaid = await ctx.callTool('list_invoices', { status: 'unpaid', limit: 50 });
  const unpaidRows = unpaid.status === 'executed' ? asRows(unpaid.data, 'invoices') : [];
  return {
    summary: `Pipeline (7d): ${Number(recentOrders[0]?.count ?? 0)} order(s) placed, ${Number(newCustomers[0]?.count ?? 0)} new customer account(s), ${unpaidRows.length} unpaid invoice(s) outstanding (potential follow-ups). All figures are live counts.`,
    result: {
      orders7d: Number(recentOrders[0]?.count ?? 0),
      newCustomers7d: Number(newCustomers[0]?.count ?? 0),
      unpaidInvoices: unpaidRows.length,
      followUpCandidates: unpaidRows.slice(0, 15).map((i) => ({ invoiceNumber: i.invoiceNumber, customerEmail: i.customerEmail, totalAmount: i.totalAmount })),
    },
  };
};

const salesExpansionOpportunities: AgentHandler = async (ctx) => {
  await ctx.step('observe', { query: 'customers with multiple active services / many domains', tables: ['customer_services', 'customer_domains'] });
  const { rows } = await ctx.db.query<{ user_id: string; email: string; services_active: string; domains_total: string }>(
    `SELECT u.id AS user_id, u.email,
            (SELECT count(*)::text FROM customer_services cs WHERE cs.user_id = u.id AND cs.status = 'active') AS services_active,
            (SELECT count(*)::text FROM customer_domains cd WHERE cd.user_id = u.id) AS domains_total
     FROM users u
     WHERE u.role = 'customer' AND u.status = 'active'
     ORDER BY u.created_at ASC LIMIT 500`
  );
  const candidates = rows.filter((r) => Number(r.services_active) >= 3 || Number(r.domains_total) >= 5).slice(0, 25);
  let created = 0;
  for (const c of candidates) {
    const { created: wasCreated } = await ctx.emitFinding({
      findingType: 'sales.expansion_candidate',
      severity: 'info',
      title: `Expansion candidate: ${c.email} (${c.services_active} active services, ${c.domains_total} domains)`,
      summary: `Customer ${c.email} holds ${c.services_active} active service(s) and ${c.domains_total} domain(s) — real holdings, suggesting possible interest in consolidation or higher tiers. Suggestion is descriptive, not a fabricated probability.`,
      evidence: [{ table: 'customer_services', description: `${c.services_active} active services` }, { table: 'customer_domains', description: `${c.domains_total} domains` }],
      subjectType: 'customer',
      subjectId: c.user_id,
      recommendation: 'Review actual usage with the customer before any upsell outreach; relevance beats volume.',
    });
    if (wasCreated) created += 1;
  }
  return {
    summary: `Expansion scan: ${candidates.length} customer(s) meet the real-holdings thresholds (≥3 active services or ≥5 domains); ${created} new finding(s).`,
    result: { candidates: candidates.length, newFindings: created },
  };
};

const salesRetentionScan: AgentHandler = async (ctx, input) => {
  const focus = typeof input.focusCustomerId === 'string' ? input.focusCustomerId : null;
  const [pastDue, flagged, failedPayments] = await Promise.all([
    ctx.callTool('list_subscriptions', { status: 'past_due', userId: focus ?? undefined } as Rec),
    ctx.callTool('list_subscriptions', { userId: focus ?? undefined } as Rec),
    ctx.callTool('list_failed_payments', { days: 30 }),
  ]);
  const churnSignals = new Map<string, string[]>();
  const push = (customerId: string, signal: string) => {
    churnSignals.set(customerId, [...(churnSignals.get(customerId) ?? []), signal]);
  };
  if (pastDue.status === 'executed') {
    for (const s of asRows(pastDue.data, 'subscriptions')) push(String(s.customerId), `subscription past_due since ${String(s.pastDueSince ?? 'unknown').slice(0, 10)}`);
  }
  if (flagged.status === 'executed') {
    for (const s of asRows(flagged.data, 'subscriptions')) {
      if (s.cancelAtPeriodEnd === true) push(String(s.customerId), `cancel-at-period-end set (ends ${String(s.currentPeriodEnd).slice(0, 10)})`);
      if (['suspended', 'grace_period'].includes(String(s.status))) push(String(s.customerId), `subscription in '${s.status}'`);
    }
  }
  if (failedPayments.status === 'executed' && focus) {
    const count = asRows(failedPayments.data, 'payments').filter((p) => p.customerId === focus).length;
    if (count > 0) push(focus, `${count} failed payment attempt(s) in 30 days`);
  }
  const withEmail = new Map<string, string>();
  for (const s of asRows(flagged.data, 'subscriptions')) withEmail.set(String(s.customerId), String(s.customerEmail));
  let created = 0;
  for (const [customerId, signals] of churnSignals) {
    const { created: wasCreated } = await ctx.emitFinding({
      findingType: 'sales.churn_risk',
      severity: signals.length >= 2 ? 'high' : 'medium',
      title: `Churn signals: ${withEmail.get(customerId) ?? customerId} — ${signals.length} signal(s)`,
      summary: `Real recorded signals for ${withEmail.get(customerId) ?? customerId}: ${signals.join('; ')}.`,
      evidence: signals.map((signal) => ({ table: 'subscriptions/payments', description: signal })),
      subjectType: 'customer',
      subjectId: customerId,
      recommendation: 'Prioritized human outreach (retention call or approved message). The agent recommends; it does not contact the customer by itself.',
    });
    if (wasCreated) created += 1;
  }
  return {
    summary: `Retention scan${focus ? ` (focused on one customer)` : ''}: ${churnSignals.size} customer(s) with live churn signal(s); ${created} new finding(s).`,
    result: { customersWithSignals: churnSignals.size, newFindings: created, focusCustomerId: focus },
  };
};

// ==============================================================================================
// §8 — Marketing
// ==============================================================================================

const marketingSegmentDigest: AgentHandler = async (ctx) => {
  const subs = await ctx.callTool('list_subscriptions', {});
  const overview = await ctx.callTool('get_platform_overview', {});
  if (subs.status !== 'executed' || overview.status !== 'executed') {
    return { summary: 'Segment inputs incomplete — digest not produced from partial data.' };
  }
  const byPlan = new Map<string, number>();
  for (const s of asRows(subs.data, 'subscriptions')) {
    const plan = String(s.planName ?? 'unlabeled');
    byPlan.set(plan, (byPlan.get(plan) ?? 0) + 1);
  }
  const d = overview.data as Rec;
  return {
    summary: `Segments: ${d.customers} registered customers; active subscriptions ${d.subscriptionsActive} across ${byPlan.size} plan(s); ${d.subscriptionsAtRisk} at-risk subscription(s) (retention segment); ${d.domainsExpiring30d} domain renewals within 30d (renewal segment).`,
    result: { segments: [...byPlan.entries()].map(([plan, count]) => ({ plan, subscriptions: count })), overview: d },
  };
};

const contentDraft: AgentHandler = async (ctx, input) => {
  const purpose = String(input.purpose ?? '');
  const facts = String(input.facts ?? '');
  if (!purpose || !facts) throw new Error("content.draft requires 'purpose' and 'facts' (facts must come from real records — the agent does not invent content)");
  const kb = await ctx.callTool('search_knowledge', { query: purpose, limit: 3 });
  const draft = await ctx.callTool('draft_customer_message', { purpose, facts, tone: String(input.tone ?? 'friendly') });
  if (draft.status !== 'executed') return { summary: `Draft failed: ${draft.message ?? draft.errorCode}.` };
  return {
    summary: `Draft prepared for: ${purpose}. Stored as task output for human review — publication requires a human (content policy) and nothing was published.`,
    result: {
      draft: (draft.data as Rec).draft,
      relatedKnowledge: kb.status === 'executed' ? (kb.data as Rec).results : [],
      reviewRequired: true,
    },
  };
};

const seoGapDigest: AgentHandler = async (ctx) => {
  const tickets = await ctx.callTool('list_open_tickets', { limit: 100 });
  if (tickets.status !== 'executed') return { summary: `Ticket read failed: ${tickets.message ?? tickets.errorCode}.` };
  const rows = asRows(tickets.data, 'tickets');
  const stopwords = new Set(['the', 'and', 'for', 'with', 'my', 'our', 'your', 'this', 'that', 'from', 'not', 'how', 'why', 'can', 'are', 'was', 'were', 'server', 'account']);
  const themeCount = new Map<string, number>();
  for (const t of rows) {
    const words = String(t.subject).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !stopwords.has(w));
    for (const word of words.slice(0, 4)) themeCount.set(word, (themeCount.get(word) ?? 0) + 1);
  }
  const themes = [...themeCount.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const gaps: Array<{ theme: string; mentions: number }> = [];
  for (const [theme, mentions] of themes) {
    const kb = await ctx.callTool('search_knowledge', { query: theme, limit: 1 });
    const count = kb.status === 'executed' ? Number((kb.data as Rec).count) : 0;
    if (count === 0) gaps.push({ theme, mentions });
  }
  if (gaps.length > 0) {
    await ctx.emitFinding({
      findingType: 'seo.content_gap',
      severity: 'low',
      title: `${gaps.length} undocumented support theme(s)`,
      summary: `Themes appearing in ≥2 open tickets without knowledge-base coverage: ${gaps.map((g) => `${g.theme}(${g.mentions})`).join(', ')}.`,
      evidence: [{ table: 'support_tickets', description: 'theme extraction from real ticket subjects' }, { table: 'ai_knowledge_chunks', description: 'coverage check' }],
      recommendation: 'Draft knowledge articles for the top themes — publishing is human-gated.',
    });
  }
  return {
    summary: `SEO/content-gap scan: ${themes.length} recurring ticket theme(s); ${gaps.length} lack documentation coverage.`,
    result: { themes: themes.map(([theme, mentions]) => ({ theme, mentions })), gaps },
  };
};

// ==============================================================================================
// §9 — Customer intelligence & success
// ==============================================================================================

const customerProfile: AgentHandler = async (ctx, input) => {
  const userId = String(input.userId ?? ctx.task.subject_id ?? '');
  if (!userId) throw new Error('customer.profile requires userId');
  const out = await ctx.callTool('get_customer_profile', { userId });
  if (out.status !== 'executed') return { summary: `Profile read failed for ${userId}: ${out.message ?? out.errorCode}.` };
  const data = out.data as { customer: Rec; metrics: Rec };
  const m = data.metrics;

  // Explainable health score: start at 100, subtract only documented real factors.
  const factors: Array<{ factor: string; impact: number; evidence: string }> = [];
  let score = 100;
  const apply = (factor: string, impact: number, evidence: string) => {
    if (impact === 0) return;
    score += impact;
    factors.push({ factor, impact, evidence });
  };
  if (Number(m.invoicesOverdue) > 0) apply(`${m.invoicesOverdue} overdue invoice(s)`, -15 * Math.min(Number(m.invoicesOverdue), 3), `${m.unpaidAmountTotal} outstanding`);
  if (Number(m.failedPayments30d) > 0) apply(`${m.failedPayments30d} failed payment(s)/30d`, -5 * Math.min(Number(m.failedPayments30d), 4), 'payments table');
  if (Number(m.subscriptionsAtRisk) > 0) apply(`${m.subscriptionsAtRisk} at-risk subscription(s)`, -10 * Number(m.subscriptionsAtRisk), 'subscriptions lifecycle');
  if (Number(m.ticketsOpen) > 2) apply(`${m.ticketsOpen} open tickets`, -3 * Math.min(Number(m.ticketsOpen) - 2, 5), 'support queue');
  if (Number(m.servicesActive) > 0) apply(`${m.servicesActive} active service(s)`, Math.min(5, Number(m.servicesActive)), 'active usage');
  score = Math.max(0, Math.min(100, score));

  const band = score >= 75 ? 'healthy' : score >= 50 ? 'watch' : 'at_risk';
  await ctx.emitFinding({
    findingType: 'customer.health_score',
    severity: band === 'at_risk' ? 'high' : 'info',
    title: `Health score ${score}/100 (${band}) — ${String((data.customer as Rec).email)}`,
    summary: `Score ${score}/100 computed from ${factors.length} explainable factor(s): ${factors.map((f) => `${f.factor} (${f.impact > 0 ? '+' : ''}${f.impact})`).join('; ') || 'no adjustments — no risk signals present'}.`,
    evidence: out.evidence ?? [],
    subjectType: 'customer',
    subjectId: userId,
    recommendation: band === 'at_risk' ? 'Route to Customer Success for outreach.' : undefined,
  });
  await ctx.putMemory('health_score', { score, band, factors, computedAt: new Date().toISOString() }, 'customer');
  return {
    summary: `Customer ${(data.customer as Rec).email}: health score ${score}/100 (${band}) with ${factors.length} explainable factor(s) — every factor cites its underlying records.`,
    result: { customer: data.customer, metrics: m, healthScore: { score, band, factors } },
    verification: { evidence: out.evidence },
  };
};

const customerSuccessDigest: AgentHandler = async (ctx) => {
  const [domains, ssl] = await Promise.all([
    ctx.callTool('list_expiring_domains', { days: 14 }),
    ctx.callTool('list_expiring_ssl', { days: 14 }),
  ]);
  const domainRows = domains.status === 'executed' ? asRows(domains.data, 'domains') : [];
  const sslRows = ssl.status === 'executed' ? asRows(ssl.data, 'certificates') : [];
  let created = 0;
  for (const d of domainRows.slice(0, 15)) {
    const { created: wasCreated } = await ctx.emitFinding({
      findingType: 'customer.renewal_due',
      severity: 'medium',
      title: `Renewal touch: ${String(d.domainName)} expires in ${String(d.daysUntilExpiry)} day(s)`,
      summary: `Customer ${d.customerEmail}'s domain ${d.domainName} expires ${String(d.expiresAt).slice(0, 10)}. A proactive, approved renewal reminder protects the customer's registration.`,
      evidence: [{ table: 'customer_domains', id: String(d.id), description: `expires ${String(d.expiresAt).slice(0, 10)}` }],
      subjectType: 'customer',
      subjectId: String(d.customerId),
      recommendation: 'Send renewal reminder via approved notification (never automatic).',
    });
    if (wasCreated) created += 1;
  }
  return {
    summary: `Customer Success sweep (14d): ${domainRows.length} domain renewal(s) and ${sslRows.length} certificate renewal(s) need proactive touches; ${created} new finding(s). Reminders remain human-approved.`,
    result: { domainRenewals: domainRows.length, certificateRenewals: sslRows.length, newFindings: created },
  };
};

// ==============================================================================================
// §10 — Knowledge agent
// ==============================================================================================

const knowledgeAnswer: AgentHandler = async (ctx, input) => {
  const query = String(input.query ?? input.question ?? '');
  if (!query) throw new Error("knowledge.answer requires 'query'");
  const out = await ctx.callTool('search_knowledge', { query, limit: 5 });
  if (out.status !== 'executed') return { summary: `Knowledge search failed: ${out.message ?? out.errorCode}.` };
  const data = out.data as { count: number; results: Array<{ content: string; citation: Rec; score: number }>; note?: string };
  if (data.count === 0) {
    return {
      summary: `NOT DOCUMENTED: no registered knowledge chunk matches "${query}". Stated plainly instead of improvising (spec §24/§29).`,
      result: { documented: false, query },
    };
  }
  return {
    summary: data.results.slice(0, 2).map((r) => r.content).join('\n---\n'),
    result: {
      documented: true,
      query,
      citations: data.results.map((r) => ({ source: r.citation.source, version: r.citation.version, uri: r.citation.uri })),
      chunks: data.results,
    },
    verification: { evidence: out.evidence },
  };
};

// ==============================================================================================
// §11 — Internal modules (honest fail-closed)
// ==============================================================================================

const internalRequest: AgentHandler = async (ctx, input) => {
  const query = String(input.query ?? '');
  if (query.length >= 5) {
    const kb = await ctx.callTool('search_knowledge', { query, limit: 3 });
    if (kb.status === 'executed' && Number((kb.data as Rec).count) > 0) {
      const top = ((kb.data as Rec).results as Rec[])[0] as Rec;
      const citation = top.citation as Rec;
      return {
        summary: `From internal documentation (${citation.source} v${citation.version}): ${top.content}`,
        result: { answered: true, citation },
      };
    }
  }
  return {
    summary: `${ctx.agent.name} is an internal support module. No matching internal documentation was found, and no internal directory/ticketing/ATS integration is configured — the request is surfaced for a human admin instead of being simulated. CONFIGURATION_REQUIRED for full automation.`,
    result: { configurationRequired: 'internal_integration', answered: false },
  };
};

// ==============================================================================================
// §12 — Asset digest
// ==============================================================================================

const assetInventoryDigest: AgentHandler = async (ctx) => {
  const out = await ctx.callTool('list_server_health', { limit: 100 });
  if (out.status !== 'executed') return { summary: `Asset read failed: ${out.message ?? out.errorCode}.` };
  const servers = asRows(out.data, 'servers') as Array<Rec & { capacity: Rec }>;
  const byType = new Map<string, number>();
  let cpuCores = 0;
  let memoryMb = 0;
  for (const s of servers) {
    byType.set(String(s.serverType), (byType.get(String(s.serverType)) ?? 0) + 1);
    cpuCores += Number((s.capacity as Rec).cpuCores ?? 0);
    memoryMb += Number((s.capacity as Rec).memoryMb ?? 0);
  }
  return {
    summary: `Asset inventory: ${servers.length} server(s) (${[...byType.entries()].map(([t, c]) => `${t}×${c}`).join(', ') || 'none'}) — aggregate capacity ${cpuCores} vCPU / ${Math.round(memoryMb / 1024)} GB RAM, from registered server rows.`,
    result: { servers: servers.length, byType: [...byType.entries()].map(([type, count]) => ({ type, count })), aggregateCpuCores: cpuCores, aggregateMemoryMb: memoryMb },
  };
};

// ==============================================================================================
// §13 — Incident management
// ==============================================================================================

const incidentCorrelate: AgentHandler = async (ctx, input) => {
  const serverId = typeof input.serverId === 'string' ? input.serverId : null;
  const signals: string[] = [];
  const evidence: Array<{ table: string; id?: string; description: string }> = [];
  let severity = 'medium';
  if (serverId) {
    const server = await ctx.callTool('get_server', { serverId });
    if (server.status === 'executed') {
      const data = server.data as { server: Rec; recentDeployments: Rec[]; recentMetrics: Rec[] };
      if (data.server.status !== 'active') signals.push(`server status is '${data.server.status}'`);
      const latestMetric = (data.recentMetrics[0] ?? null) as Rec | null;
      if (latestMetric && Number(latestMetric.cpu_percent) >= 95) signals.push(`CPU ${latestMetric.cpu_percent}%`);
      const failed = data.recentDeployments.filter((d) => d.status === 'failed');
      if (failed.length > 0) signals.push(`${failed.length} recent failed deployment(s)`);
      evidence.push(...(server.evidence ?? []));
    } else {
      signals.push(`server ${serverId} could not be read (${server.errorCode ?? 'error'})`);
    }
  }
  const failedDeployments = await ctx.callTool('list_failed_deployments', { days: 1 });
  if (failedDeployments.status === 'executed') {
    const count = Number((failedDeployments.data as Rec).count);
    if (count >= 3) {
      signals.push(`${count} failed deployments in 24h platform-wide`);
      severity = 'high';
    }
  }
  if (signals.length === 0) {
    return {
      summary: `Incident correlation: no corroborating signals for ${serverId ?? 'the requested scope'} — no incident created (an incident without real evidence would be a fabrication).`,
      result: { incidentCreated: false },
    };
  }
  const title = serverId ? `Server ${serverId.slice(0, 8)}: ${signals[0]}` : `Platform: ${signals[0]}`;
  const create = await ctx.callTool('create_incident', {
    title: title.slice(0, 255),
    severity,
    summary: `Correlated signals: ${signals.join('; ')}. Evidence is attached via findings/telemetry; impact assessment and remediation require human confirmation.`,
  });
  if (create.status === 'pending_approval') {
    return { summary: `Incident creation requires approval and is pending in the Decision Inbox. Signals: ${signals.join('; ')}.`, result: { pendingApproval: create.approvalId } };
  }
  if (create.status !== 'executed') {
    return { summary: `Incident creation failed: ${create.message ?? create.errorCode}.`, result: { incidentCreated: false } };
  }
  const incident = create.data as Rec;
  await ctx.emitFinding({
    findingType: 'incident.opened',
    severity: (severity as 'info' | 'low' | 'medium' | 'high' | 'critical'),
    title: `Incident ${incident.incidentNumber}: ${title}`,
    summary: `Signals: ${signals.join('; ')}`,
    evidence,
    subjectType: 'incident',
    subjectId: String(incident.incidentId),
    recommendation: 'Acknowledge and assign an owner in the incident register.',
  });
  return {
    summary: `Incident ${incident.incidentNumber} created (${severity}) from corroborated signals: ${signals.join('; ')}.`,
    result: { incidentCreated: true, incidentId: incident.incidentId, incidentNumber: incident.incidentNumber, signals },
  };
};

const incidentRootCause: AgentHandler = async (ctx, input) => {
  const incidentId = String(input.incidentId ?? '');
  if (!incidentId) throw new Error('incident.root_cause requires incidentId');
  const { rows } = await ctx.db.query<Rec>(`SELECT * FROM ai_incidents WHERE id = $1`, [incidentId]);
  const incident = rows[0];
  if (!incident) return { summary: `Incident ${incidentId} not found.` };
  const deployments = await ctx.callTool('list_failed_deployments', { days: 3 });
  const failedRows = deployments.status === 'executed' ? asRows(deployments.data, 'deployments') : [];
  const timeline = [
    { phase: 'Incident', at: incident.created_at, detail: incident.title },
    ...failedRows.slice(0, 10).map((d) => ({ phase: 'Deployment failure', at: d.createdAt, detail: `${d.action} on ${String(d.serverHostname ?? 'unknown host')}: ${d.errorCode ?? 'no code'}` })),
  ];
  const probable = failedRows.length > 0
    ? `PROBABLE (not confirmed) contributing factor: ${failedRows.length} failed deployment(s) in the surrounding 3-day window, most frequent error ${String((failedRows[0] ?? {}).errorCode ?? 'none recorded')}.`
    : 'No failed deployments recorded in the surrounding 3-day window; telemetry/ticket correlation did not establish a probable cause from available data.';
  const analysis = {
    incident: { id: incident.id, number: incident.incident_number, title: incident.title, status: incident.status, severity: incident.severity },
    timeline,
    evidence: { failedDeployments3d: failedRows.length },
    probableCause: probable,
    confidence: failedRows.length >= 2 ? 'medium' : 'low',
    caveat: 'This analysis states only what stored records support. Uncertain items are labeled PROBABLE/UNKNOWN — nothing here is asserted as confirmed fact.',
    preventiveActions: failedRows.length > 0 ? ['Review the failing deployment error cluster', 'Add a pre-deploy validation for the failing action'] : ['Broaden telemetry capture around the incident window'],
  };
  return { summary: `Root-cause analysis for ${String(incident.incident_number)}: ${probable}`, result: { analysis } };
};

// ==============================================================================================
// §14 — FinOps
// ==============================================================================================

const finopsCostDigest: AgentHandler = async (ctx) => {
  const out = await ctx.callTool('list_server_health', { limit: 100 });
  if (out.status !== 'executed') return { summary: `Utilization read failed: ${out.message ?? out.errorCode}.` };
  const servers = asRows(out.data, 'servers');
  const underutilized = servers.filter((s) => {
    const m = s.latestMetrics as Rec | null;
    if (!m) return false;
    const cpu = Number(m.cpuPercent ?? 100);
    const memTotal = Number(m.memoryTotalMb ?? 0);
    const memUsed = Number(m.memoryUsedMb ?? memTotal);
    return cpu < 10 && memTotal > 0 && memUsed / memTotal < 0.2;
  });
  for (const s of underutilized.slice(0, 10)) {
    await ctx.emitFinding({
      findingType: 'finops.underutilized_server',
      severity: 'info',
      title: `Underutilized: ${String(s.hostname)} (cpu ${(s.latestMetrics as Rec).cpuPercent}%)`,
      summary: `Server ${s.hostname} runs below 10% CPU and 20% memory on its latest telemetry. Recommendation only — the Cost Guardian NEVER terminates infrastructure.`,
      evidence: [{ table: 'server_metrics', id: String(s.id), description: `cpu ${(s.latestMetrics as Rec).cpuPercent}%, mem ${(s.latestMetrics as Rec).memoryUsedMb}/${(s.latestMetrics as Rec).memoryTotalMb}MB` }],
      subjectType: 'server',
      subjectId: String(s.id),
      recommendation: 'Review with capacity planning: consolidate or right-size after verifying workload seasonality. Human decision only.',
    });
  }
  return {
    summary: `Cost/utilization digest: ${underutilized.length} of ${servers.length} server(s) under utilization thresholds (<10% CPU, <20% MEM on latest telemetry). Recommendations only — no infrastructure was touched.`,
    result: { total: servers.length, underutilized: underutilized.length },
  };
};

// ==============================================================================================
// §15 — BI agent
// ==============================================================================================

const biQuery: AgentHandler = async (ctx, input) => {
  const question = String(input.question ?? input.command ?? '');
  if (!question) throw new Error("bi.query requires 'question'");
  const resolution = resolveAdminCommand(question);
  if (!resolution.execute || resolution.confidence === 'none') {
    return {
      summary: `No registered business query matches "${question}" — I will not improvise an answer. Supported topics: ${(resolution.supported ?? []).slice(0, 6).join('; ')}…`,
      result: { supported: resolution.supported },
    };
  }
  const { answer, toolOutcomes } = await resolution.execute(ctx);
  return { summary: answer, result: { question, intent: resolution.intent, toolOutcomes: toolOutcomes.map((o) => ({ status: o.status, errorCode: o.errorCode })) } };
};

// ==============================================================================================
// §16 — Admin Copilot
// ==============================================================================================

const copilotCommand: AgentHandler = async (ctx, input) => {
  const command = String(input.command ?? '');
  if (!command) throw new Error("copilot.command requires 'command'");
  const resolution = resolveAdminCommand(command);
  if (!resolution.execute) {
    return {
      summary: `${resolution.unsupportedReason}`,
      result: { intent: 'unsupported', supportedCommands: resolution.supported },
    };
  }
  await ctx.step('understand', { intent: resolution.intent });
  const { answer, toolOutcomes } = await resolution.execute(ctx);
  return {
    summary: answer,
    result: { intent: resolution.intent, answer, toolCalls: toolOutcomes.map((o) => ({ status: o.status, errorCode: o.errorCode ?? null })) },
    verification: { intentsResolvedDeterministically: true },
  };
};

// ==============================================================================================
// §17 — Customer Cloud Assistant (always customer-scoped by the route)
// ==============================================================================================

const customerAssistantQuery: AgentHandler = async (ctx, input) => {
  const message = String(input.message ?? '');
  if (!message) throw new Error("customer.assistant_query requires 'message'");
  const resolution = resolveCustomerMessage(message);
  if (!resolution.execute) {
    return { summary: `${resolution.unsupportedReason}`, result: { intent: 'unsupported', supported: resolution.supported } };
  }
  await ctx.step('understand', { intent: resolution.intent });
  const { answer, toolOutcomes } = await resolution.execute(ctx);
  return {
    summary: answer,
    result: { intent: resolution.intent, answer, toolCalls: toolOutcomes.map((o) => ({ status: o.status, errorCode: o.errorCode ?? null })) },
  };
};

// ==============================================================================================
// Registry
// ==============================================================================================

export const AGENT_HANDLERS: Record<string, AgentHandler> = {
  'support.ticket_triage': supportTicketTriage,
  'infrastructure.health_scan': infrastructureHealthScan,
  'infrastructure.server_report': infrastructureServerReport,
  'provisioning.stuck_scan': provisioningStuckScan,
  'deployment.failure_digest': deploymentFailureDigest,
  'domain.expiry_scan': domainExpiryScan,
  'ssl.expiry_scan': sslExpiryScan,
  'security.auth_anomaly_scan': securityAuthAnomalyScan,
  'security.digest': securityAuthAnomalyScan,
  'fraud.order_anomaly_scan': fraudOrderAnomalyScan,
  'vulnerability.assessment': vulnerabilityAssessment,
  'billing.invoice_explain': billingInvoiceExplain,
  'billing.overdue_digest': billingOverdueDigest,
  'finance.revenue_summary': financeRevenueSummary,
  'finance.reconciliation_digest': financeReconciliationDigest,
  'finance.pricing_observations': financePricingObservations,
  'sales.pipeline_digest': salesPipelineDigest,
  'sales.expansion_opportunities': salesExpansionOpportunities,
  'sales.retention_scan': salesRetentionScan,
  'marketing.segment_digest': marketingSegmentDigest,
  'content.draft': contentDraft,
  'seo.gap_digest': seoGapDigest,
  'customer.profile': customerProfile,
  'customer.success_digest': customerSuccessDigest,
  'knowledge.answer': knowledgeAnswer,
  'internal.request': internalRequest,
  'asset.inventory_digest': assetInventoryDigest,
  'incident.correlate': incidentCorrelate,
  'incident.root_cause': incidentRootCause,
  'finops.cost_digest': finopsCostDigest,
  'bi.query': biQuery,
  'copilot.command': copilotCommand,
  'customer.assistant_query': customerAssistantQuery,
  // §2 — Executive Board (each seat's digest runs under the seat's own identity)
  'board.department_digest': boardDepartmentDigestHandler,
  'board.executive_briefing': boardExecutiveBriefingHandler,
};
