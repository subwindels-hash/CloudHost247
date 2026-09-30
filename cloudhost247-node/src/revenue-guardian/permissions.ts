/**
 * Revenue Guardian RBAC (spec §42, §68).
 *
 * The platform's single source of truth for authorization is `users.role`, re-read from the
 * database on every privileged request (src/lib/require-role.ts) — Revenue Guardian deliberately
 * does NOT introduce a second RBAC engine (spec §78). Instead it defines an explicit, named
 * permission vocabulary and maps the platform's canonical roles onto it in ONE place, enforced
 * server-side on every route. A `staff` account gets a deliberately limited operational subset
 * and is additionally scoped to its OWN portfolio (customers assigned to it) by the repositories
 * — it never receives unrestricted financial access (spec §42) or other staff members'
 * performance data (spec §68).
 */
import type { FastifyRequest } from 'fastify';
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import { requireRole, type AuthorizedRequestContext } from '../lib/require-role';
import { ForbiddenError } from '../lib/errors';

export const RG_PERMISSIONS = [
  'revenue_guardian.view',
  'revenue_guardian.manage',
  'revenue_guardian.assign',
  'revenue_guardian.followups',
  'revenue_guardian.promises',
  'revenue_guardian.reports',
  'revenue_guardian.automation',
  'revenue_guardian.settings',
  'revenue_guardian.export',
  'revenue_guardian.staff_performance',
  'revenue_guardian.view_all_customers',
  'revenue_guardian.view_financials',
  'revenue_guardian.manual_run',
  'revenue_guardian.write_off',
] as const;

export type RgPermission = (typeof RG_PERMISSIONS)[number];

const STAFF_PERMISSIONS: readonly RgPermission[] = [
  'revenue_guardian.view',
  'revenue_guardian.followups',
  'revenue_guardian.promises',
];

const ADMIN_PERMISSIONS: readonly RgPermission[] = RG_PERMISSIONS.filter(
  // Write-off is the one financially destructive decision reserved for super_admin (spec §54
  // "elevated permission").
  (p) => p !== 'revenue_guardian.write_off'
);

const ROLE_PERMISSIONS: Record<string, readonly RgPermission[]> = {
  super_admin: RG_PERMISSIONS,
  admin: ADMIN_PERMISSIONS,
  staff: STAFF_PERMISSIONS,
};

/** Roles allowed to touch any Revenue Guardian endpoint at all. */
export const RG_ROLES = ['staff', 'admin', 'super_admin'] as const;

export function permissionsForRole(role: string): readonly RgPermission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function roleHasPermission(role: string, permission: RgPermission): boolean {
  return permissionsForRole(role).includes(permission);
}

export interface RgRequestContext extends AuthorizedRequestContext {
  permissions: readonly RgPermission[];
  /**
   * When set, every repository query MUST be limited to this staff member's own portfolio
   * (their active assignments + cases/follow-ups assigned to them). Null means the caller holds
   * revenue_guardian.view_all_customers.
   */
  scopeStaffId: string | null;
}

/**
 * Authenticates the caller, re-verifies their role against the database (never the JWT claim
 * alone — same guarantee as every other privileged route), and asserts the named permission.
 */
export async function requireRgPermission(
  request: FastifyRequest,
  env: Env,
  pool: Queryable,
  permission: RgPermission
): Promise<RgRequestContext> {
  const auth = await requireRole(request, env, pool, RG_ROLES);
  const permissions = permissionsForRole(auth.role);
  if (!permissions.includes(permission)) {
    throw new ForbiddenError(`Missing permission: ${permission}`);
  }
  const scopeStaffId = permissions.includes('revenue_guardian.view_all_customers') ? null : auth.userId;
  return { ...auth, permissions, scopeStaffId };
}
