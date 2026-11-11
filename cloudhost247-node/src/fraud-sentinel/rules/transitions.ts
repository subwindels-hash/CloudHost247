/**
 * Alert lifecycle state machine — the single place that decides which investigation-status changes
 * are legal, so the API, the dashboard and the background jobs cannot each invent their own.
 *
 *   new ─────────────► under_review ─────► escalated
 *    │                     │  ▲                │
 *    │                     │  │                ▼
 *    ├─────────────────────┼──┴──────────► resolved ──► under_review (reopen)
 *    └─────────────────────┴────────────► false_positive ──► under_review (reopen)
 *
 * Terminal-ish states (`resolved`, `false_positive`) can be reopened — an investigation is a human
 * judgement and humans change their minds — but reopening is recorded in the timeline like everything
 * else. Nothing here deletes a state: the investigation history is append-only.
 *
 * Requiring a reason for `resolved` and `false_positive` is deliberate: closing a fraud alert without
 * saying why is how a real case disappears, and a false-positive report without a reason is useless as
 * rule-tuning feedback.
 */
import type { AlertStatus } from '../types';

const TRANSITIONS: Readonly<Record<AlertStatus, readonly AlertStatus[]>> = {
  new: ['under_review', 'escalated', 'resolved', 'false_positive'],
  under_review: ['escalated', 'resolved', 'false_positive', 'new'],
  escalated: ['under_review', 'resolved', 'false_positive'],
  resolved: ['under_review', 'new'],
  false_positive: ['under_review', 'new'],
};

/** Statuses that mean "a human is expected to look at this". */
export const OPEN_STATUSES: readonly AlertStatus[] = ['new', 'under_review', 'escalated'];

/** Statuses that require a written reason. */
export const REASON_REQUIRED_STATUSES: readonly AlertStatus[] = ['resolved', 'false_positive'];

export function allowedTransitions(from: AlertStatus): readonly AlertStatus[] {
  return TRANSITIONS[from] ?? [];
}

export function canTransition(from: AlertStatus, to: AlertStatus): boolean {
  if (from === to) return false;
  return allowedTransitions(from).includes(to);
}

export function isOpenStatus(status: AlertStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

export function requiresReason(to: AlertStatus): boolean {
  return REASON_REQUIRED_STATUSES.includes(to);
}

/** Reopening a closed alert. */
export function isReopen(from: AlertStatus, to: AlertStatus): boolean {
  return !isOpenStatus(from) && isOpenStatus(to);
}

export class IllegalTransitionError extends Error {
  readonly code = 'ILLEGAL_ALERT_TRANSITION';
  constructor(from: AlertStatus, to: AlertStatus) {
    super(
      `An alert in status '${from}' cannot move to '${to}'. Allowed next statuses: ${allowedTransitions(from).join(', ') || 'none'}.`
    );
    this.name = 'IllegalTransitionError';
  }
}

export function assertTransition(from: AlertStatus, to: AlertStatus): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}
