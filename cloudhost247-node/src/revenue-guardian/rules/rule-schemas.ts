/**
 * Validated JSON schemas for database-stored rules (spec §5, §38).
 *
 * Conditions/actions are declarative data validated with zod on every write AND every read —
 * the database never stores executable code, and a malformed stored rule is skipped loudly
 * (logged + surfaced in the automation run report), never eval'd.
 */
import { z } from 'zod';

/** Conditions an automatic assignment rule can match on (spec §5). All are optional AND-ed. */
export const assignmentConditionsSchema = z
  .object({
    country: z.string().max(64).optional(),
    currency: z.string().length(3).optional(),
    customerType: z.enum(['new', 'existing']).optional(),
    minRecurringRevenue: z.number().nonnegative().optional(),
    maxRecurringRevenue: z.number().nonnegative().optional(),
    minLifetimeRevenue: z.number().nonnegative().optional(),
    minActiveServices: z.number().int().nonnegative().optional(),
    accountStatus: z.enum(['active', 'suspended', 'disabled']).optional(),
    /** Only assign when the customer has no active assignment of this type yet. */
    onlyUnassigned: z.boolean().optional(),
  })
  .strict();

export type AssignmentConditions = z.infer<typeof assignmentConditionsSchema>;

/** Candidate profile evaluated against assignment conditions — built from real stored data. */
export interface AssignmentCandidate {
  country: string | null;
  currency: string | null;
  isNewCustomer: boolean;
  recurringRevenue: number;
  lifetimeRevenue: number;
  activeServices: number;
  accountStatus: string;
  hasActiveAssignment: boolean;
}

export function matchesAssignmentConditions(candidate: AssignmentCandidate, conditions: AssignmentConditions): boolean {
  if (conditions.country && candidate.country?.toLowerCase() !== conditions.country.toLowerCase()) return false;
  if (conditions.currency && candidate.currency?.toUpperCase() !== conditions.currency.toUpperCase()) return false;
  if (conditions.customerType === 'new' && !candidate.isNewCustomer) return false;
  if (conditions.customerType === 'existing' && candidate.isNewCustomer) return false;
  if (conditions.minRecurringRevenue !== undefined && candidate.recurringRevenue < conditions.minRecurringRevenue) return false;
  if (conditions.maxRecurringRevenue !== undefined && candidate.recurringRevenue > conditions.maxRecurringRevenue) return false;
  if (conditions.minLifetimeRevenue !== undefined && candidate.lifetimeRevenue < conditions.minLifetimeRevenue) return false;
  if (conditions.minActiveServices !== undefined && candidate.activeServices < conditions.minActiveServices) return false;
  if (conditions.accountStatus && candidate.accountStatus !== conditions.accountStatus) return false;
  if (conditions.onlyUnassigned && candidate.hasActiveAssignment) return false;
  return true;
}

/** Automation rule conditions: threshold overrides applied per event type (spec §18). */
export const automationConditionsSchema = z
  .object({
    minAmount: z.number().nonnegative().optional(),
    minOverdueDays: z.number().int().nonnegative().optional(),
    currency: z.string().length(3).optional(),
    riskLevelAtLeast: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  })
  .strict();

export type AutomationConditions = z.infer<typeof automationConditionsSchema>;

/** Actions an automation rule may request. Validated vocabulary — never free-form code. */
export const automationActionsSchema = z.array(
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('create_case'), priority: z.enum(['low', 'normal', 'high', 'urgent']).optional() }),
    z.object({
      type: z.literal('create_follow_up'),
      followUpType: z
        .enum([
          'payment_reminder', 'invoice_due', 'invoice_overdue', 'renewal_reminder',
          'expiration_reminder', 'pre_suspension', 'pre_termination', 'failed_payment',
          'payment_promise', 'customer_check_in', 'escalation', 'custom',
        ])
        .optional(),
      priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
    }),
    z.object({ type: z.literal('send_email'), templateKey: z.string().max(64) }),
    z.object({ type: z.literal('escalate'), level: z.number().int().min(1).max(4).optional() }),
    z.object({ type: z.literal('notify_staff') }),
  ])
);

export type AutomationActions = z.infer<typeof automationActionsSchema>;
