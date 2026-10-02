/**
 * AI worker sweep (spec §9 worker cadence, §24 event bus).
 *
 * ONE bounded cycle per invocation (same discipline as the rest of the worker):
 *   1. seed the registry (idempotent)
 *   2. detection emitters — inspect REAL platform state and emit events with 24h fingerprint
 *      dedupe (invoice became overdue, domain/SSL close to expiry, stuck deployment, offline
 *      server, fresh failed payment). Detection is honest: it emits only for rows that exist.
 *   3. dispatch unprocessed events through the workflow engine
 *   4. expire stale approvals (an unanswered approval can never execute silently later)
 *   5. prune expired memories
 *   6. interval-gated scheduled scans (bucket-locked so concurrent sweeps don't double-run)
 *   7. idempotent daily executive briefing generation
 */
import type { Queryable } from '../../db/types';
import { emitEvent } from '../repositories/events-repo';
import { processPendingEvents } from '../workflows/engine';
import { expireStaleApprovals } from '../repositories/approvals-repo';
import { pruneExpiredMemories, getMemory, putMemory } from '../repositories/memory-knowledge-repo';
import { createTask } from '../repositories/tasks-repo';
import { getAgentBySlug } from '../repositories/registry-repo';
import { seedAgentRegistry } from '../registry/seed';
import { generateExecutiveBriefing } from '../board/board-service';
import { runTask } from '../runtime/executor';
import { recordAiAudit } from '../repositories/audit-repo';

export const AI_SWEEP_INTERVAL_MS = 5 * 60_000;

interface DetectionCounts {
  invoiceOverdue: number;
  sslExpiring: number;
  domainExpiring: number;
  deploymentStuck: number;
  serverUnhealthy: number;
  paymentFailed: number;
}

/** Emits platform-meaningful events only for rows that actually exist right now. */
export async function detectPlatformEvents(db: Queryable): Promise<DetectionCounts> {
  const counts: DetectionCounts = { invoiceOverdue: 0, sslExpiring: 0, domainExpiring: 0, deploymentStuck: 0, serverUnhealthy: 0, paymentFailed: 0 };
  const day = new Date().toISOString().slice(0, 10);

  const { rows: overdue } = await db.query<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM invoices WHERE status = 'unpaid' AND due_date < CURRENT_DATE LIMIT 200`
  );
  for (const row of overdue) {
    const { created } = await emitEvent(db, {
      eventType: 'invoice.overdue',
      source: 'detection',
      fingerprint: `invoice.overdue:${row.id}:${day}`,
      payload: { invoiceId: row.id, customerId: row.user_id },
    });
    if (created) counts.invoiceOverdue += 1;
  }

  const { rows: ssl } = await db.query<{ id: string; user_id: string; domain_name: string }>(
    `SELECT id, user_id, domain_name FROM ssl_certificates
     WHERE expires_at IS NOT NULL AND expires_at < now() + interval '7 days' AND status IN ('ISSUED','PENDING','VALIDATING')
     LIMIT 100`
  );
  for (const row of ssl) {
    const { created } = await emitEvent(db, {
      eventType: 'ssl.expiring',
      source: 'detection',
      fingerprint: `ssl.expiring:${row.id}:${day}`,
      payload: { certificateId: row.id, customerId: row.user_id, domainName: row.domain_name },
    });
    if (created) counts.sslExpiring += 1;
  }

  const { rows: domains } = await db.query<{ id: string; user_id: string; domain_name: string }>(
    `SELECT id, user_id, domain_name FROM customer_domains
     WHERE expires_at IS NOT NULL AND expires_at::date < CURRENT_DATE + 7 AND status = 'active'
     LIMIT 100`
  );
  for (const row of domains) {
    const { created } = await emitEvent(db, {
      eventType: 'domain.expiring',
      source: 'detection',
      fingerprint: `domain.expiring:${row.id}:${day}`,
      payload: { domainId: row.id, customerId: row.user_id, domainName: row.domain_name },
    });
    if (created) counts.domainExpiring += 1;
  }

  const { rows: stuck } = await db.query<{ id: string; server_id: string | null; action: string }>(
    `SELECT id, server_id, action FROM deployments
     WHERE status IN ('queued','running') AND COALESCE(started_at, created_at) < now() - interval '2 hours'
     LIMIT 100`
  );
  for (const row of stuck) {
    const { created } = await emitEvent(db, {
      eventType: 'deployment.stuck',
      source: 'detection',
      fingerprint: `deployment.stuck:${row.id}:${day}`,
      payload: { deploymentId: row.id, serverId: row.server_id, action: row.action },
    });
    if (created) counts.deploymentStuck += 1;
  }

  const { rows: offline } = await db.query<{ id: string; hostname: string }>(
    `SELECT id, hostname FROM servers WHERE status = 'offline' LIMIT 100`
  );
  for (const row of offline) {
    const { created } = await emitEvent(db, {
      eventType: 'server.unhealthy',
      source: 'detection',
      fingerprint: `server.unhealthy:${row.id}:${day}`,
      payload: { serverId: row.id, hostname: row.hostname, reason: 'status_offline' },
    });
    if (created) counts.serverUnhealthy += 1;
  }

  const { rows: failedPayments } = await db.query<{ id: string; user_id: string; invoice_id: string }>(
    `SELECT id, user_id, invoice_id FROM payments
     WHERE status = 'failed' AND created_at > now() - interval '24 hours'
     LIMIT 100`
  );
  for (const row of failedPayments) {
    const { created } = await emitEvent(db, {
      eventType: 'payment.failed',
      source: 'detection',
      fingerprint: `payment.failed:${row.id}`,
      payload: { paymentId: row.id, customerId: row.user_id, invoiceId: row.invoice_id },
    });
    if (created) counts.paymentFailed += 1;
  }

  return counts;
}

/** Bucket-locked scheduled task launcher: at most one task per (name, bucket) platform-wide. */
async function runScheduledScan(db: Queryable, name: string, agentSlug: string, taskType: string, input: Record<string, unknown>, bucketMs: number): Promise<boolean> {
  const bucket = Math.floor(Date.now() / bucketMs);
  const mem = await getMemory(db, 'organizational', null, 'sweeps', `last:${name}`);
  if (mem && typeof (mem.value as Record<string, unknown>).bucket === 'number' && ((mem.value as Record<string, number>).bucket ?? 0) >= bucket) {
    return false;
  }
  const agent = await getAgentBySlug(db, agentSlug);
  if (!agent || !agent.enabled) return false;
  const { task, created } = await createTask(db, {
    agentId: agent.id,
    taskType,
    context: input,
    requestedByType: 'schedule',
    idempotencyKey: `scan:${name}:${bucket}`,
  });
  await putMemory(db, { scope: 'organizational', agentSlug: 'sweeps', key: `last:${name}`, value: { bucket } });
  if (!created && task.status !== 'queued') return false;
  await runTask(db, task.id, {});
  return true;
}

export interface AiSweepResult {
  detected: DetectionCounts;
  eventsProcessed: number;
  workflowsDispatched: number;
  approvalsExpired: number;
  memoriesPruned: number;
  scansLaunched: string[];
  briefing: { attempted: boolean; created?: boolean; runStatus?: string };
}

export async function runAiSweep(db: Queryable): Promise<AiSweepResult> {
  await seedAgentRegistry(db);

  const detected = await detectPlatformEvents(db);
  const queue = await processPendingEvents(db, runTask);
  const approvalsExpired = await expireStaleApprovals(db);
  const memoriesPruned = await pruneExpiredMemories(db);
  const scansLaunched: string[] = [];

  if (await runScheduledScan(db, 'provisioning.stuck', 'provisioning-agent', 'provisioning.stuck_scan', { minutes: 60 }, 60 * 60_000)) {
    scansLaunched.push('provisioning.stuck');
  }
  if (await runScheduledScan(db, 'infrastructure.health', 'infrastructure-guardian', 'infrastructure.health_scan', {}, 2 * 60 * 60_000)) {
    scansLaunched.push('infrastructure.health');
  }
  if (await runScheduledScan(db, 'lifecycle.expiry', 'dns-domain-agent', 'domain.expiry_scan', { days: 30 }, 6 * 60 * 60_000)) {
    scansLaunched.push('lifecycle.expiry:domains');
  }
  if (await runScheduledScan(db, 'lifecycle.ssl', 'ssl-guardian', 'ssl.expiry_scan', { days: 30 }, 6 * 60 * 60_000)) {
    scansLaunched.push('lifecycle.expiry:ssl');
  }
  if (await runScheduledScan(db, 'security.auth', 'security-sentinel', 'security.auth_anomaly_scan', { hours: 24 }, 6 * 60 * 60_000)) {
    scansLaunched.push('security.auth');
  }
  if (await runScheduledScan(db, 'billing.overdue', 'collector', 'billing.overdue_digest', { limit: 25 }, 12 * 60 * 60_000)) {
    scansLaunched.push('billing.overdue');
  }

  // Daily briefing — idempotent per period, so attempting it every sweep is harmless.
  let briefing: AiSweepResult['briefing'] = { attempted: false };
  try {
    const outcome = await generateExecutiveBriefing(db, 'daily', null, runTask);
    briefing = { attempted: true, created: outcome.created, runStatus: outcome.runStatus };
  } catch (err) {
    briefing = { attempted: true, created: false, runStatus: 'error' };
    await recordAiAudit(db, {
      action: 'ai.briefing.failed',
      status: 'error',
      errorCode: 'BRIEFING_ERROR',
      arguments: { error: err instanceof Error ? err.message : 'unknown' },
    });
  }

  return {
    detected,
    eventsProcessed: queue.processed,
    workflowsDispatched: queue.dispatched,
    approvalsExpired,
    memoriesPruned,
    scansLaunched,
    briefing,
  };
}
