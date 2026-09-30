/**
 * Recovery-case state machine (spec §8, §52–§54).
 *
 * Valid transitions are declared once here; case-service.ts enforces them plus the
 * ledger-backed guards: 'recovered' / 'partially_recovered' can never be entered by a button
 * alone — the underlying invoice/ledger state must confirm the money (spec §52). 'written_off'
 * requires the elevated write-off permission plus a reason (spec §54), and 'disputed' requires
 * a dispute reason (spec §53).
 */
import type { CaseStatus } from '../types';

const TRANSITIONS: Record<CaseStatus, readonly CaseStatus[]> = {
  new: ['contact_required', 'contacted', 'escalated', 'disputed', 'closed', 'written_off', 'partially_recovered', 'recovered'],
  contact_required: ['contacted', 'escalated', 'disputed', 'closed', 'written_off', 'partially_recovered', 'recovered'],
  contacted: ['awaiting_customer', 'payment_promised', 'payment_pending', 'contact_required', 'escalated', 'disputed', 'closed', 'written_off', 'partially_recovered', 'recovered'],
  awaiting_customer: ['contacted', 'payment_promised', 'payment_pending', 'contact_required', 'escalated', 'disputed', 'closed', 'written_off', 'partially_recovered', 'recovered'],
  payment_promised: ['payment_pending', 'contacted', 'contact_required', 'escalated', 'disputed', 'closed', 'written_off', 'partially_recovered', 'recovered'],
  payment_pending: ['payment_promised', 'contacted', 'contact_required', 'escalated', 'disputed', 'closed', 'written_off', 'partially_recovered', 'recovered'],
  partially_recovered: ['recovered', 'contacted', 'contact_required', 'payment_promised', 'payment_pending', 'escalated', 'disputed', 'closed', 'written_off'],
  recovered: ['closed'],
  escalated: ['contacted', 'contact_required', 'awaiting_customer', 'payment_promised', 'payment_pending', 'disputed', 'closed', 'written_off', 'partially_recovered', 'recovered'],
  disputed: ['contacted', 'contact_required', 'escalated', 'closed', 'written_off', 'partially_recovered', 'recovered'],
  closed: [],
  written_off: [],
};

/** Statuses that end a case (set closed_at). */
export const TERMINAL_STATUSES: readonly CaseStatus[] = ['recovered', 'closed', 'written_off'];

/** Statuses that may only be entered when the billing ledger confirms the money (spec §52). */
export const LEDGER_GUARDED_STATUSES: readonly CaseStatus[] = ['recovered', 'partially_recovered'];

export function isValidTransition(from: CaseStatus, to: CaseStatus): boolean {
  if (from === to) return false;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function allowedTransitions(from: CaseStatus): readonly CaseStatus[] {
  return TRANSITIONS[from] ?? [];
}
