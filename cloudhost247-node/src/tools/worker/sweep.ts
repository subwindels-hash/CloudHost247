/**
 * Tools Center — background maintenance (spec §85–§87, §92).
 *
 * Three independent jobs, each safe to run from the existing worker's `runWorkerCycle`:
 *   1. `providerHealthSweep`  — probes the external providers that are actually configured, using
 *      the same "cheapest real request" rule as the admin Test button, and records the outcome.
 *   2. `resolverHealthSweep`  — resolves a fixed domain through the resolver registry so a dead
 *      resolver is taken out of rotation before it produces misleading DNS answers.
 *   3. `monitorSweep`         — evaluates due customer monitors (SSL expiry, DNS record,
 *      e-mail configuration) and delivers the notifications through the platform's existing
 *      notification table, so they appear in the bell menu like every other notification.
 *
 * Every job reports what it did and what it skipped. A sweep that finds nothing to do is a success,
 * not a no-op to be hidden.
 */
import type { Queryable } from '../../db/types';
import { listProviders, testProviderConnection } from '../core/providers';
import { listResolvers, sweepResolverHealth } from '../core/resolvers';
import { queryType } from '../dns/common';
import { fetchWithGuard } from '../core/ssrf';
import { createNotification } from '../../services/notification-service';
import { dueMonitors, evaluateMonitor, applyMonitorEvaluation } from '../diagnostics/monitors';

export interface ProviderSweepResult {
  checked: number;
  healthy: number;
  failing: number;
  skipped: number;
  results: Array<{ slug: string; ok: boolean; status: string; latencyMs: number | null; detail: string }>;
}

export interface MonitorSweepResult {
  checked: number;
  changed: number;
  notified: number;
  errors: number;
  notifications: Array<{ monitorId: string; userId: string; severity: string; title: string }>;
}

export interface ToolsSweepResult {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  providers: ProviderSweepResult;
  resolvers: Awaited<ReturnType<typeof sweepResolverHealth>>;
  monitors: MonitorSweepResult;
}

/** Probes every enabled provider with the cheapest request that genuinely proves reachability. */
export async function providerHealthSweep(db: Queryable, batch = 10): Promise<ProviderSweepResult> {
  const providers = (await listProviders(db)).filter((provider) => provider.enabled).slice(0, Math.min(Math.max(batch, 1), 50));
  const results: ProviderSweepResult['results'] = [];

  const resolver = (await listResolvers(db, { enabledOnly: true }))[0] ?? null;
  for (const provider of providers) {
    const result = await testProviderConnection(db, provider.slug, {
      dnsQuery: resolver
        ? async (name, type, timeoutMs) => {
            const started = Date.now();
            try {
              const answer = await queryType(resolver, name, type, { timeoutMs });
              return { ok: true, message: `${answer.records.length} answer(s)`, durationMs: Date.now() - started };
            } catch (error) {
              return { ok: false, message: error instanceof Error ? error.message : 'query failed', durationMs: Date.now() - started };
            }
          }
        : undefined,
      fetchProbe: async (url, timeoutMs) => {
        const started = Date.now();
        const response = await fetchWithGuard(url, { method: 'GET', timeoutMs, maxBytes: 4096 });
        return { status: response.status, durationMs: Date.now() - started };
      },
    }).catch((error: unknown) => ({
      slug: provider.slug,
      ok: false,
      status: 'DOWN' as const,
      latencyMs: null,
      detail: error instanceof Error ? error.message : 'The provider probe failed.',
    }));
    results.push({ slug: result.slug, ok: result.ok, status: result.status, latencyMs: result.latencyMs, detail: result.detail });
  }

  return {
    checked: results.length,
    healthy: results.filter((result) => result.ok).length,
    failing: results.filter((result) => !result.ok).length,
    skipped: (await listProviders(db)).length - results.length,
    results,
  };
}

/** Evaluates the customer monitors that are due and delivers their notifications. */
export async function monitorSweep(db: Queryable, limit = 25): Promise<MonitorSweepResult> {
  const monitors = await dueMonitors(db, limit, 55);
  const summary: MonitorSweepResult = { checked: 0, changed: 0, notified: 0, errors: 0, notifications: [] };

  for (const monitor of monitors) {
    summary.checked += 1;
    try {
      const evaluation = await evaluateMonitor(db, monitor);
      if (evaluation.status === 'ERROR') summary.errors += 1;
      const notification = await applyMonitorEvaluation(db, monitor, evaluation);
      if (!notification) continue;
      summary.changed += 1;
      const created = await createNotification(db, {
        userId: notification.userId,
        type: `tool_monitor_${notification.severity}`,
        title: notification.title,
        message: notification.body,
        resourceType: 'tool_monitor',
        resourceId: notification.monitorId,
      });
      if (created) summary.notified += 1;
      summary.notifications.push({ monitorId: notification.monitorId, userId: notification.userId, severity: notification.severity, title: notification.title });
    } catch {
      // One failing monitor must not stop the sweep for everybody else; the next cycle retries it.
      summary.errors += 1;
    }
  }
  return summary;
}

export async function resolverHealthSweep(db: Queryable, batch = 6): Promise<Awaited<ReturnType<typeof sweepResolverHealth>>> {
  return sweepResolverHealth(db, batch);
}

export async function runToolsSweep(db: Queryable): Promise<ToolsSweepResult> {
  const startedAt = new Date();
  const providers = await providerHealthSweep(db);
  const resolvers = await resolverHealthSweep(db);
  const monitors = await monitorSweep(db);
  const finishedAt = new Date();
  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    providers,
    resolvers,
    monitors,
  };
}
