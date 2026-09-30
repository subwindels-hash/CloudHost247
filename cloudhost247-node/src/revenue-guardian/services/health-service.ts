/**
 * Module health diagnostics (spec §70) — read-only checks over real system state; nothing here
 * mutates anything.
 */
import type { Queryable } from '../../db/types';
import { getWhatsAppStatus } from '../notifications/whatsapp';
import { getRgSetting } from '../utils/settings';

export interface ModuleHealth {
  database: 'ok' | 'error';
  moduleEnabled: boolean;
  billingIntegration: { invoices: number; ledgerEntries: number; state: 'ok' | 'empty' };
  paymentIntegration: { payments: number; state: 'ok' | 'empty' };
  emailIntegration: { state: 'ok' | 'configuration_required' | 'unknown'; pendingOutbox: number; failedOutbox: number };
  whatsappIntegration: { state: string; provider: string | null };
  scheduler: {
    lastSuccessfulRun: string | null;
    lastFailedRun: string | null;
    runningJobs: number;
    failedRuns24h: number;
    completedRuns24h: number;
  };
  workflow: { openCases: number; pendingFollowUps: number; pendingPromises: number };
}

export async function getModuleHealth(db: Queryable): Promise<ModuleHealth> {
  let database: 'ok' | 'error' = 'ok';
  try {
    await db.query('SELECT 1');
  } catch {
    database = 'error';
  }

  const counts = await db.query<Record<string, string>>(
    `SELECT
       (SELECT count(*) FROM invoices) AS invoices,
       (SELECT count(*) FROM billing_ledger) AS ledger,
       (SELECT count(*) FROM payments) AS payments,
       (SELECT count(*) FROM notification_outbox WHERE status = 'PENDING') AS outbox_pending,
       (SELECT count(*) FROM notification_outbox WHERE status = 'FAILED') AS outbox_failed,
       (SELECT count(*) FROM notification_outbox WHERE status = 'CONFIGURATION_REQUIRED') AS outbox_config,
       (SELECT max(finished_at)::text FROM revenue_guardian_automation_runs WHERE status = 'completed') AS last_success,
       (SELECT max(finished_at)::text FROM revenue_guardian_automation_runs WHERE status = 'failed') AS last_failed,
       (SELECT count(*) FROM revenue_guardian_automation_runs WHERE status = 'running') AS running,
       (SELECT count(*) FROM revenue_guardian_automation_runs WHERE status = 'failed' AND started_at > now() - interval '24 hours') AS failed_24h,
       (SELECT count(*) FROM revenue_guardian_automation_runs WHERE status = 'completed' AND started_at > now() - interval '24 hours') AS completed_24h,
       (SELECT count(*) FROM revenue_guardian_recovery_cases WHERE closed_at IS NULL) AS open_cases,
       (SELECT count(*) FROM revenue_guardian_follow_ups WHERE status IN ('pending','snoozed')) AS pending_followups,
       (SELECT count(*) FROM revenue_guardian_payment_promises WHERE status = 'pending') AS pending_promises`
  );
  const c = counts.rows[0] ?? {};
  const n = (k: string) => Number(c[k] ?? 0);
  const whatsapp = await getWhatsAppStatus(db);
  const enabled = await getRgSetting(db, 'enabled');

  return {
    database,
    moduleEnabled: Boolean(enabled),
    billingIntegration: { invoices: n('invoices'), ledgerEntries: n('ledger'), state: n('invoices') > 0 ? 'ok' : 'empty' },
    paymentIntegration: { payments: n('payments'), state: n('payments') > 0 ? 'ok' : 'empty' },
    emailIntegration: {
      state: n('outbox_config') > 0 ? 'configuration_required' : 'ok',
      pendingOutbox: n('outbox_pending'),
      failedOutbox: n('outbox_failed'),
    },
    whatsappIntegration: { state: whatsapp.state, provider: whatsapp.provider },
    scheduler: {
      lastSuccessfulRun: (c['last_success'] as string | null) ?? null,
      lastFailedRun: (c['last_failed'] as string | null) ?? null,
      runningJobs: n('running'),
      failedRuns24h: n('failed_24h'),
      completedRuns24h: n('completed_24h'),
    },
    workflow: {
      openCases: n('open_cases'),
      pendingFollowUps: n('pending_followups'),
      pendingPromises: n('pending_promises'),
    },
  };
}
