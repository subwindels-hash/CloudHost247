/**
 * Revenue-at-risk scoring (spec §4, §29).
 *
 * Pure, deterministic, and fully explainable: the score is a sum of documented factor weights,
 * every applied factor emits a human-readable reason, and every input is a real stored value
 * (invoice ages, ledger sums, payment rows, promise history). Nothing here fabricates data —
 * given empty inputs the score is 0 / 'low' with no reasons.
 */
import type { RiskLevel } from '../types';
import type { RgRiskThresholds } from '../utils/settings';

export interface RiskInput {
  /** Days the oldest unpaid invoice is past due (0 = none overdue). */
  maxOverdueDays: number;
  /** Count of unpaid invoices past their due date. */
  overdueInvoiceCount: number;
  /** Total unpaid balance across invoices, in cents. */
  outstandingCents: number;
  /** Failed payment attempts in the recent window (payments.status = 'failed'). */
  failedPaymentCount: number;
  /** Active broken payment promises (status = 'broken'). */
  brokenPromiseCount: number;
  /** Whether any subscription for the customer is past_due / grace_period. */
  hasPastDueSubscription: boolean;
  /** Whether any subscription is currently suspended. */
  hasSuspendedSubscription: boolean;
  /** Days until the nearest renewal/expiry (null = none upcoming). */
  daysToNextRenewal: number | null;
  /** Monthly recurring revenue in cents (sum of active subscription plan pricing). */
  recurringRevenueCents: number;
}

export interface RiskAssessment {
  score: number;
  level: RiskLevel;
  reasons: string[];
}

function centsToDisplay(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Documented weights. Each factor is capped so no single dimension saturates the score, and the
 * total is clamped to 0–100.
 */
export function assessRisk(input: RiskInput, thresholds: RgRiskThresholds): RiskAssessment {
  let score = 0;
  const reasons: string[] = [];

  // Overdue age: 2 points/day capped at 30.
  if (input.maxOverdueDays > 0) {
    score += Math.min(input.maxOverdueDays * 2, 30);
    reasons.push(`Oldest unpaid invoice is ${input.maxOverdueDays} day(s) overdue`);
  }

  // Multiple overdue invoices: 5 points each beyond the first, capped at 15.
  if (input.overdueInvoiceCount > 1) {
    score += Math.min((input.overdueInvoiceCount - 1) * 5, 15);
    reasons.push(`${input.overdueInvoiceCount} overdue invoices`);
  }

  // Outstanding balance: 1 point per $50 outstanding, capped at 20.
  if (input.outstandingCents > 0) {
    score += Math.min(Math.floor(input.outstandingCents / 5000), 20);
    reasons.push(`Outstanding balance of ${centsToDisplay(input.outstandingCents)}`);
  }

  // Failed payments: 5 points each, capped at 15.
  if (input.failedPaymentCount > 0) {
    score += Math.min(input.failedPaymentCount * 5, 15);
    reasons.push(`${input.failedPaymentCount} failed payment attempt(s)`);
  }

  // Broken promises: 10 points each, capped at 20.
  if (input.brokenPromiseCount > 0) {
    score += Math.min(input.brokenPromiseCount * 10, 20);
    reasons.push(`${input.brokenPromiseCount} broken payment promise(s)`);
  }

  if (input.hasSuspendedSubscription) {
    score += 15;
    reasons.push('Has a suspended subscription');
  } else if (input.hasPastDueSubscription) {
    score += 10;
    reasons.push('Has a past-due subscription');
  }

  // Imminent renewal while carrying overdue balance compounds the risk.
  if (input.daysToNextRenewal !== null && input.daysToNextRenewal <= 14) {
    score += 5;
    reasons.push(`Renewal due in ${input.daysToNextRenewal} day(s)`);
    if (input.outstandingCents > 0 && input.recurringRevenueCents > 0) {
      score += 5;
      reasons.push('Upcoming renewal while account carries an unpaid balance');
    }
  }

  score = Math.max(0, Math.min(100, score));
  return { score, level: levelForScore(score, thresholds), reasons };
}

export function levelForScore(score: number, thresholds: RgRiskThresholds): RiskLevel {
  if (score >= thresholds.critical) return 'critical';
  if (score >= thresholds.high) return 'high';
  if (score >= thresholds.medium) return 'medium';
  return 'low';
}
