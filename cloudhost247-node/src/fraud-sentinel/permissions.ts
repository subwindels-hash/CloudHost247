/**
 * Fraud Sentinel RBAC and read scoping.
 *
 * The platform's single source of truth for authorization is `users.role`, re-read from the database
 * on every privileged request (`src/lib/require-role.ts`). This module does not add a second RBAC
 * engine — it names an explicit permission vocabulary for fraud investigation and maps the platform's
 * canonical roles onto it in ONE place, exactly as `src/revenue-guardian/permissions.ts` does.
 *
 * Two decisions here are deliberate and worth stating, because both reduce who can see what:
 *
 *  1. ONLY admin and super_admin may reach any Fraud Sentinel endpoint. `staff` and `customer` are
 *     refused at the role gate. Fraud evidence is a concentrated view of payment declines, login
 *     origins, recovery attempts and administrative activity; and an alert says which rules fired and
 *     how strongly. Handing that to a suspected fraudster — or to a support agent with no fraud
 *     authority — would help them evade detection. `scopeForCaller` therefore returns a CLOSED scope
 *     for any role that does not hold `fraud_sentinel.view_all_customers`, and every repository treats
 *     a closed scope as "matches nothing", so a role-gate mistake cannot turn into a disclosure.
 *
 *  2. `fraud_sentinel.settings` is reserved for super_admin. Settings include the retention horizons
 *     that drive event/history PRUNING — i.e. deletion of evidence — plus the scheduler and the
 *     AI-assist switch. `admin` keeps `fraud_sentinel.rules` (enable/disable/retune one rule), because
 *     that is the day-to-day tuning act and every change is versioned, snapshotted into
 *     `fraud_sentinel_rule_history` and written to `audit_logs` with the actor.
 */
import type { FastifyRequest } from 'fastify';
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import { ForbiddenError } from '../lib/errors';
import { requireRole, type AuthorizedRequestContext } from '../lib/require-role';
import { CLOSED_SCOPE, type FraudScope } from './types';

export const FS_PERMISSIONS = [
  'fraud_sentinel.view',
  'fraud_sentinel.investigate',
  'fraud_sentinel.assign',
  'fraud_sentinel.rules',
  'fraud_sentinel.run_scan',
  'fraud_sentinel.settings',
  'fraud_sentinel.export',
  'fraud_sentinel.view_all_customers',
] as const;

export type FsPermission = (typeof FS_PERMISSIONS)[number];

/** Roles allowed to reach any Fraud Sentinel endpoint at all. */
export const FS_ROLES = ['admin', 'super_admin'] as const;

const ADMIN_PERMISSIONS: readonly FsPermission[] = FS_PERMISSIONS.filter(
  // Retention horizons drive pruning (deletion of evidence) and the scheduler/AI switches change how
  // the module runs — reserved for super_admin. See the header rationale.
  (permission) => permission !== 'fraud_sentinel.settings'
);

const ROLE_PERMISSIONS: Record<string, readonly FsPermission[]> = {
  super_admin: FS_PERMISSIONS,
  admin: ADMIN_PERMISSIONS,
  // Deliberately absent: staff and customer hold no Fraud Sentinel permissions and are refused by
  // FS_ROLES before any permission is consulted.
};

export function permissionsForRole(role: string): readonly FsPermission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function roleHasPermission(role: string, permission: FsPermission): boolean {
  return permissionsForRole(role).includes(permission);
}

export interface FsRequestContext extends AuthorizedRequestContext {
  permissions: readonly FsPermission[];
  /** The read scope every repository call for this request MUST be given. */
  scope: FraudScope;
}

/**
 * The read scope for a caller.
 *
 * Unrestricted only for a caller holding `fraud_sentinel.view_all_customers` (admin/super_admin, whose
 * role was just re-read from the database). Anything else — including a role that should never have
 * reached this function — gets `CLOSED_SCOPE`, which matches nothing. There is no code path from here
 * to a partial or accidentally-wide scope: failing closed is the only failure mode.
 */
export function scopeForCaller(actor: { userId: string; role: string; permissions?: readonly FsPermission[] }): FraudScope {
  const permissions = actor.permissions ?? permissionsForRole(actor.role);
  if (!permissions.includes('fraud_sentinel.view_all_customers')) return CLOSED_SCOPE;
  return { unrestricted: true, customerIds: [] };
}

/**
 * Authenticates the caller, re-verifies their role against the database (never the JWT claim alone —
 * the same guarantee every other privileged route in this codebase gives), asserts the named
 * permission, and returns the scope that request must use for every read.
 *
 * Throws 401 when the token is missing/invalid/revoked or the account is no longer active, and 403
 * when the role is not in FS_ROLES or lacks the permission. Neither message distinguishes "exists but
 * not yours" from "does not exist", so the gate cannot be used to enumerate alerts.
 */
export async function requireFsPermission(
  request: FastifyRequest,
  env: Env,
  pool: Queryable,
  permission: FsPermission
): Promise<FsRequestContext> {
  const auth = await requireRole(request, env, pool, FS_ROLES);
  const permissions = permissionsForRole(auth.role);
  if (!permissions.includes(permission)) {
    throw new ForbiddenError(`Missing permission: ${permission}`);
  }
  return { ...auth, permissions, scope: scopeForCaller({ userId: auth.userId, role: auth.role, permissions }) };
}

/**
 * Defence in depth for single-record reads.
 *
 * The SQL already filters by scope; this exists so a repository bug cannot turn into a
 * cross-customer read. An alert or assessment with no customer_id (an IP, gateway or administrator
 * subject) is platform-level: only an unrestricted caller may see it.
 */
export function scopeAllowsRead(scope: FraudScope, customerId: string | null): boolean {
  if (scope.unrestricted) return true;
  if (!customerId) return false;
  return scope.customerIds.includes(customerId);
}
