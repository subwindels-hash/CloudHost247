/**
 * Support-mode guardrails (spec §38).
 *
 * While an administrator is acting inside a customer's account, a specific, centrally defined
 * list of sensitive actions stays blocked. The list lives here — one place — so that a new route
 * cannot accidentally become reachable in support mode just because its author did not know the
 * rule existed, and so the restrictions are testable in isolation.
 *
 * Attempting a restricted action is not a silent no-op: it is refused with 403 *and* audited,
 * because "an admin tried to change a customer's password while impersonating them" is exactly
 * the sort of event an audit trail exists for.
 */
import type { FastifyRequest } from 'fastify';
import type { Queryable } from '../db/types';
import { recordAuditBestEffort, requestAuditContext } from './audit';
import { ForbiddenError } from './errors';
import type { AuthenticatedRequestContext } from './require-auth';

export const SUPPORT_MODE_RESTRICTED_ACTIONS = [
  'password.change',
  'security_number.reveal',
  'security_number.change',
  'payment_method.change',
  'account.delete',
  'account.email_change',
  'role.change',
] as const;

export type SupportModeRestrictedAction = (typeof SUPPORT_MODE_RESTRICTED_ACTIONS)[number];

export function isSupportModeRestricted(action: string): boolean {
  return (SUPPORT_MODE_RESTRICTED_ACTIONS as readonly string[]).includes(action);
}

/**
 * Refuses `action` when the caller is inside a delegated support session. Safe to call on every
 * sensitive route: for a normal (non-delegated) caller it does nothing at all.
 */
export async function guardSupportMode(
  db: Queryable,
  request: FastifyRequest,
  auth: AuthenticatedRequestContext,
  action: SupportModeRestrictedAction
): Promise<void> {
  if (!auth.supportSessionId) return;

  await recordAuditBestEffort(
    db,
    {
      actorId: auth.actingAdminId ?? null,
      action: 'admin_customer_account_switch_action_blocked',
      resourceType: 'user',
      resourceId: auth.userId,
      metadata: {
        blockedAction: action,
        switchSessionId: auth.supportSessionId,
        customerId: auth.customerId ?? null,
      },
    },
    requestAuditContext(request)
  );

  throw new ForbiddenError(
    `This action (${action}) is not available while an administrator is signed in to this account in support mode.`
  );
}
