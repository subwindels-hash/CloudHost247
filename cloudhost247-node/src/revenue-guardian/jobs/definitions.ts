/**
 * Revenue Guardian automation jobs (spec §18–§19, §50).
 *
 * Every job is idempotent by construction:
 *  - recovery cases: one open case per invoice (DB unique index);
 *  - follow-ups: deterministic dedupe_key (DB unique index);
 *  - emails: deterministic dedupe_key on the communication log + the notification pipeline's
 *    own (user,type,resource) idempotency;
 *  - runs themselves: run_key lock in revenue_guardian_automation_runs (jobs/runner.ts).
 * Running any job twice creates nothing new the second time.
 */
import type { Queryable } from '../../db/types';
import { fromCents } from '../../lib/money';
import { emptyJobResult, type JobResult } from '../types';
import { loadRgSettings } from '../utils/settings';
import { listOverdueInvoices, listInvoicesDueIn, getInvoiceFinancials } from '../repositories/billing-facts';
import { listOpenInvoiceCases, updateCase, findCaseById } from '../repositories/cases-repo';
import { insertFollowUp } from '../repositories/follow-ups-repo';
import { listDuePromises } from '../repositories/promises-repo';
import { listUpcomingRenewals, listLifecycleRisk } from '../repositories/insights-repo';
import { recordActivity } from '../repositories/automation-repo';
import { createRecoveryCase, reconcileCaseWithLedger } from '../services/case-service';
import { reconcilePromise } from '../services/promise-service';
import { applyAssignmentRules } from '../services/assignment-service';
import { assessRisk } from '../rules/risk';
import { determineEscalationLevel } from '../rules/escalation';
import { getCustomerFinancialProfile } from '../repositories/billing-facts';
import { sendRgEmail } from '../notifications/email';
import { createNotification } from '../../services/notification-service';
import { getSetting } from '../../db/ops-tables';
import { toIsoDateString } from '../utils/dates';

export type RgJob = (db: Queryable, now?: Date) => Promise<JobResult>;

const SYSTEM_ACTOR = { userId: null, actorType: 'system' as const };

/** Overdue invoices → recovery cases + overdue notice + staff follow-up (spec §18). */
export const processOverdueInvoices: RgJob = async (db) => {
  const result = emptyJobResult();
  const settings = await loadRgSettings(db);
  const invoices = await listOverdueInvoices(db, settings.overdueThresholdDays);

  for (const invoice of invoices) {
    result.processed += 1;
    try {
      const { recoveryCase, created } = await createRecoveryCase(
        db,
        { customerId: invoice.user_id, invoiceId: invoice.id, orderId: invoice.order_id, source: 'automation:process_overdue_invoices' },
        SYSTEM_ACTOR
      );
      if (created) result.created += 1;
      else result.skipped += 1;

      // Overdue notice (once per invoice).
      const emailOutcome = await sendRgEmail(db, {
        userId: invoice.user_id,
        recipient: invoice.customer_email,
        templateKey: 'invoice_overdue',
        variables: {
          customerName: invoice.customer_name,
          invoiceNumber: invoice.invoice_number,
          amount: invoice.total_amount,
          currency: invoice.currency,
          dueDate: invoice.due_date.slice(0, 10),
        },
        customerId: invoice.user_id,
        invoiceId: invoice.id,
        caseId: recoveryCase.id,
        dedupeKey: `email:invoice_overdue:${invoice.id}`,
      });
      if (emailOutcome === 'queued') result.notificationsSent += 1;

      // Staff follow-up once the invoice is overdue past the configured window.
      if (invoice.days_overdue >= settings.overdueFollowupDays) {
        const followUp = await insertFollowUp(db, {
          caseId: recoveryCase.id,
          customerId: invoice.user_id,
          invoiceId: invoice.id,
          assignedStaffId: recoveryCase.assigned_staff_id,
          type: 'invoice_overdue',
          priority: 'high',
          channel: 'email',
          scheduledAt: new Date(),
          notes: `Invoice ${invoice.invoice_number} is ${invoice.days_overdue} day(s) overdue (${invoice.total_amount} ${invoice.currency}).`,
          dedupeKey: `overdue-followup:${invoice.id}`,
        });
        if (followUp) result.created += 1;
      }
    } catch {
      result.failed += 1;
    }
  }
  return result;
};

/** Upcoming invoice reminders at each configured window (spec §18 "invoice due"). */
export const processUpcomingInvoices: RgJob = async (db) => {
  const result = emptyJobResult();
  const settings = await loadRgSettings(db);
  for (const daysAhead of settings.upcomingInvoiceReminderDays) {
    const invoices = await listInvoicesDueIn(db, daysAhead);
    for (const invoice of invoices) {
      result.processed += 1;
      try {
        const outcome = await sendRgEmail(db, {
          userId: invoice.user_id,
          recipient: invoice.customer_email,
          templateKey: 'invoice_due',
          variables: {
            customerName: invoice.customer_name,
            invoiceNumber: invoice.invoice_number,
            amount: invoice.total_amount,
            currency: invoice.currency,
            dueDate: invoice.due_date.slice(0, 10),
          },
          customerId: invoice.user_id,
          invoiceId: invoice.id,
          dedupeKey: `email:invoice_due:${invoice.id}:${daysAhead}`,
          notificationTypeSuffix: `${daysAhead}D`,
        });
        if (outcome === 'queued') result.notificationsSent += 1;
        else result.skipped += 1;
      } catch {
        result.failed += 1;
      }
    }
  }
  return result;
};

/** Promise reconciliation: fulfill/break from the ledger; broken → follow-up + notice. */
export const processPaymentPromises: RgJob = async (db, now = new Date()) => {
  const result = emptyJobResult();
  const due = await listDuePromises(db);
  for (const promise of due) {
    result.processed += 1;
    try {
      // Staff nudge on the due day itself, before the deadline passes.
      if (promise.assigned_staff_id && toIsoDateString(promise.promised_date) === now.toISOString().slice(0, 10)) {
        const staffNotification = await createNotification(db, {
          userId: promise.assigned_staff_id,
          type: 'RG_PROMISE_DUE',
          title: 'Payment promise due today',
          message: `A payment promise of ${promise.promised_amount} ${promise.currency} is due today.`,
          resourceType: 'rg_promise',
          resourceId: promise.id,
        });
        if (staffNotification) result.notificationsSent += 1;
      }

      const { promise: updated, changed } = await reconcilePromise(db, promise, now);
      if (!changed) {
        result.skipped += 1;
        continue;
      }
      result.created += 1;

      if (updated.status === 'broken') {
        const followUp = await insertFollowUp(db, {
          caseId: updated.case_id,
          customerId: updated.customer_id,
          invoiceId: updated.invoice_id,
          assignedStaffId: updated.assigned_staff_id,
          type: 'payment_promise',
          priority: 'urgent',
          channel: 'phone',
          scheduledAt: now,
          notes: `Payment promise of ${updated.promised_amount} ${updated.currency} (due ${toIsoDateString(updated.promised_date)}) was broken.`,
          dedupeKey: `broken-promise-followup:${updated.id}`,
        });
        if (followUp) result.created += 1;
        if (updated.case_id) {
          const linkedCase = await findCaseById(db, updated.case_id);
          if (linkedCase && !linkedCase.closed_at) {
            await updateCase(db, updated.case_id, { escalationLevel: linkedCase.escalation_level + 1 });
            await recordActivity(db, {
              customerId: updated.customer_id,
              caseId: updated.case_id,
              promiseId: updated.id,
              actorType: 'system',
              eventType: 'escalation',
              description: `Case escalated after broken payment promise`,
            });
          }
        }
      }
    } catch {
      result.failed += 1;
    }
  }
  return result;
};

/** Renewal reminders at each configured window + rescue follow-ups inside 14 days (spec §12). */
export const processRenewals: RgJob = async (db) => {
  const result = emptyJobResult();
  const settings = await loadRgSettings(db);
  const maxWindow = Math.max(...settings.renewalReminderDays, 0);
  const renewals = await listUpcomingRenewals(db, { withinDays: maxWindow, limit: 500 });

  for (const renewal of renewals) {
    result.processed += 1;
    try {
      if (settings.renewalReminderDays.includes(renewal.days_remaining)) {
        const outcome = await sendRgEmail(db, {
          userId: renewal.customer_id,
          recipient: renewal.customer_email,
          templateKey: 'renewal_reminder',
          variables: {
            customerName: renewal.customer_name,
            serviceLabel: renewal.label,
            expiryDate: renewal.expires_at.slice(0, 10),
            daysRemaining: String(renewal.days_remaining),
          },
          customerId: renewal.customer_id,
          dedupeKey: `email:renewal:${renewal.kind}:${renewal.reference_id}:${renewal.days_remaining}`,
          notificationTypeSuffix: `${renewal.days_remaining}D`,
        });
        if (outcome === 'queued') result.notificationsSent += 1;
        else result.skipped += 1;
      }
      if (renewal.days_remaining <= 14) {
        const followUp = await insertFollowUp(db, {
          customerId: renewal.customer_id,
          type: 'renewal_reminder',
          priority: renewal.days_remaining <= 3 ? 'urgent' : 'high',
          channel: 'email',
          scheduledAt: new Date(),
          notes: `${renewal.kind === 'domain' ? 'Domain' : 'Subscription'} "${renewal.label}" expires ${renewal.expires_at.slice(0, 10)} (${renewal.days_remaining} day(s)).`,
          dedupeKey: `renewal-followup:${renewal.kind}:${renewal.reference_id}:${renewal.expires_at.slice(0, 10)}`,
        });
        if (followUp) result.created += 1;
      }
    } catch {
      result.failed += 1;
    }
  }
  return result;
};

async function lifecycleJob(db: Queryable, phase: 'pre_suspension' | 'pre_termination'): Promise<JobResult> {
  const result = emptyJobResult();
  const settings = await loadRgSettings(db);
  const graceDays = await getSetting<number>(db, 'subscription.grace_period_days', 7);
  const suspendAfterDays = await getSetting<number>(db, 'subscription.suspend_after_days', 7);
  const rows = await listLifecycleRisk(db, phase, {
    graceDays,
    suspendAfterDays,
    terminateAfterDays: settings.terminateAfterSuspensionDays,
  });
  const alertDays = phase === 'pre_suspension' ? settings.preSuspensionAlertDays : settings.preTerminationAlertDays;

  for (const row of rows) {
    result.processed += 1;
    if (row.days_remaining === null || row.days_remaining > alertDays) {
      result.skipped += 1;
      continue;
    }
    try {
      const followUp = await insertFollowUp(db, {
        customerId: row.customer_id,
        type: phase,
        priority: 'urgent',
        channel: 'phone',
        scheduledAt: new Date(),
        notes: `${row.plan_label}: projected ${phase === 'pre_suspension' ? 'suspension' : 'termination'} on ${row.projected_date?.slice(0, 10)} (${row.days_remaining} day(s)). Outstanding: ${row.outstanding} ${row.currency}.`,
        dedupeKey: `${phase}-followup:${row.subscription_id}:${row.projected_date?.slice(0, 10)}`,
      });
      if (followUp) result.created += 1;

      const outcome = await sendRgEmail(db, {
        userId: row.customer_id,
        recipient: row.customer_email,
        templateKey: phase,
        variables: { customerName: row.customer_name, serviceLabel: row.plan_label },
        customerId: row.customer_id,
        dedupeKey: `email:${phase}:${row.subscription_id}:${row.projected_date?.slice(0, 10)}`,
      });
      if (outcome === 'queued') result.notificationsSent += 1;

      if (phase === 'pre_termination') {
        // Escalate any open case for the customer to at least level 3 (spec §14, §55).
        const { rows: openCases } = await db.query<{ id: string; escalation_level: number; case_number: string }>(
          `SELECT id, escalation_level, case_number FROM revenue_guardian_recovery_cases
            WHERE customer_id = $1 AND closed_at IS NULL AND escalation_level < 3`,
          [row.customer_id]
        );
        for (const openCase of openCases) {
          await updateCase(db, openCase.id, { escalationLevel: 3 });
          await recordActivity(db, {
            customerId: row.customer_id,
            caseId: openCase.id,
            actorType: 'system',
            eventType: 'escalation',
            description: `Case ${openCase.case_number} escalated to level 3: service approaching termination`,
          });
        }
      }
    } catch {
      result.failed += 1;
    }
  }
  return result;
}

export const processPreSuspension: RgJob = (db) => lifecycleJob(db, 'pre_suspension');
export const processPreTermination: RgJob = (db) => lifecycleJob(db, 'pre_termination');

/** Recomputes risk + escalation for every open case from current stored data (spec §4, §55). */
export const recalculateRevenueRisk: RgJob = async (db) => {
  const result = emptyJobResult();
  const settings = await loadRgSettings(db);
  const cases = await listOpenInvoiceCases(db);
  for (const openCase of cases) {
    result.processed += 1;
    try {
      const profile = await getCustomerFinancialProfile(db, openCase.customer_id);
      const risk = assessRisk(
        {
          maxOverdueDays: profile.maxOverdueDays,
          overdueInvoiceCount: profile.overdueInvoiceCount,
          outstandingCents: profile.outstandingCents,
          failedPaymentCount: profile.failedPaymentCount,
          brokenPromiseCount: profile.brokenPromiseCount,
          hasPastDueSubscription: profile.hasPastDueSubscription,
          hasSuspendedSubscription: profile.hasSuspendedSubscription,
          daysToNextRenewal: profile.daysToNextRenewal,
          recurringRevenueCents: profile.recurringRevenueCents,
        },
        settings.riskThresholds
      );
      const escalation = determineEscalationLevel(
        {
          overdueDays: profile.maxOverdueDays,
          brokenPromiseCount: profile.brokenPromiseCount,
          isPreTermination: profile.hasSuspendedSubscription,
        },
        settings.escalationLevels
      );
      const changed =
        risk.score !== openCase.risk_score ||
        risk.level !== openCase.risk_level ||
        Math.max(escalation, openCase.escalation_level) !== openCase.escalation_level;
      if (changed) {
        await updateCase(db, openCase.id, {
          riskScore: risk.score,
          riskLevel: risk.level,
          riskReasons: risk.reasons,
          // Escalation only ratchets up automatically; de-escalation is a human decision.
          escalationLevel: Math.max(escalation, openCase.escalation_level),
        });
        result.created += 1;
      } else {
        result.skipped += 1;
      }
    } catch {
      result.failed += 1;
    }
  }
  return result;
};

/** Ledger reconciliation for open cases + integrity checks (spec §52, §76). */
export const reconcileRecoveryState: RgJob = async (db) => {
  const result = emptyJobResult();
  const cases = await listOpenInvoiceCases(db);
  for (const openCase of cases) {
    result.processed += 1;
    try {
      const updated = await reconcileCaseWithLedger(db, openCase);
      if (updated) result.created += 1;
      else result.skipped += 1;
    } catch {
      result.failed += 1;
    }
  }

  // Integrity check: fulfilled promises must have matching ledger payments (spec §76).
  const { rows: suspectPromises } = await db.query<{ id: string; invoice_id: string; created_at: string; fulfilled_amount: string }>(
    `SELECT id, invoice_id, created_at::text, fulfilled_amount::text FROM revenue_guardian_payment_promises
      WHERE status IN ('fulfilled', 'partially_fulfilled')`
  );
  for (const promise of suspectPromises) {
    const financials = await getInvoiceFinancials(db, promise.invoice_id);
    if (financials && financials.paidCents === 0 && Number(promise.fulfilled_amount) > 0) {
      result.failed += 1;
      await recordActivity(db, {
        invoiceId: promise.invoice_id,
        promiseId: promise.id,
        actorType: 'system',
        eventType: 'reconciliation_anomaly',
        description: 'Promise marked fulfilled but the ledger shows no payment for its invoice',
        metadata: { promiseId: promise.id },
      });
    }
  }
  return result;
};

/** Applies database-stored assignment rules (spec §5). */
export const runAssignmentRules: RgJob = async (db) => {
  const result = emptyJobResult();
  const ruleResult = await applyAssignmentRules(db);
  result.processed = ruleResult.evaluated;
  result.created = ruleResult.assigned;
  result.skipped = ruleResult.skipped;
  result.failed = ruleResult.invalidRules.length;
  return result;
};

export interface RgJobDefinition {
  name: string;
  description: string;
  run: RgJob;
}

export const RG_JOBS: RgJobDefinition[] = [
  { name: 'process_overdue_invoices', description: 'Open recovery cases, queue overdue notices and staff follow-ups for overdue invoices', run: processOverdueInvoices },
  { name: 'process_upcoming_invoices', description: 'Queue payment reminders for invoices approaching their due date', run: processUpcomingInvoices },
  { name: 'process_payment_promises', description: 'Reconcile due payment promises against the billing ledger; escalate broken promises', run: processPaymentPromises },
  { name: 'process_renewals', description: 'Queue renewal reminders and rescue follow-ups for expiring subscriptions and domains', run: processRenewals },
  { name: 'process_pre_suspension', description: 'Create urgent tasks and notices for services approaching suspension', run: processPreSuspension },
  { name: 'process_pre_termination', description: 'Create escalations and final notices for services approaching termination', run: processPreTermination },
  { name: 'recalculate_revenue_risk', description: 'Recompute risk scores and escalation levels for open cases from current billing data', run: recalculateRevenueRisk },
  { name: 'reconcile_recovery_state', description: 'Reconcile recovery cases and promises against the billing ledger; report anomalies', run: reconcileRecoveryState },
  { name: 'run_assignment_rules', description: 'Apply database-stored automatic customer assignment rules', run: runAssignmentRules },
];

export function findJob(name: string): RgJobDefinition | null {
  return RG_JOBS.find((j) => j.name === name) ?? null;
}
