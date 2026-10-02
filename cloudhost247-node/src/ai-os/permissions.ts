/**
 * AI Control Plane RBAC (spec §20).
 *
 * Like Revenue Guardian, this does NOT introduce a second RBAC engine: the platform's
 * `users.role`, re-read from the database on every privileged request (src/lib/require-role.ts),
 * stays the single source of truth. What this module defines is the *named AI permission
 * vocabulary* (`ai.*`) and the one place where platform roles map onto it, enforced server-side
 * on every /api/v1/admin/ai route and customer-scoped /api/v1/account/ai route.
 *
 * Two distinct layers exist and must not be conflated:
 *  1. HUMAN permissions (here): which staff member may view/govern the AI system.
 *  2. AGENT permissions (registry): which tools/data classes an agent may touch — consulted by
 *     the tool executor (src/ai-os/runtime/executor.ts), never by route code.
 */
import type { FastifyRequest } from 'fastify';
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import { requireRole, type AuthorizedRequestContext } from '../lib/require-role';
import { ForbiddenError } from '../lib/errors';

export const AI_PERMISSIONS = [
  // Operator-facing governance permissions
  'ai.view',
  'ai.agents.manage',
  'ai.tasks.run',
  'ai.approvals.view',
  'ai.approvals.manage',
  'ai.board.view',
  'ai.board.briefings',
  'ai.workflows.manage',
  'ai.events.view',
  'ai.audit.view',
  'ai.observability.view',
  'ai.knowledge.view',
  'ai.knowledge.manage',
  'ai.models.view',
  'ai.models.manage',
  'ai.evaluations.view',
  'ai.evaluations.write',
  'ai.copilot.execute',
  'ai.incidents.manage',
  'ai.findings.manage',
  // Agent tool-permission vocabulary (granted to AGENTS via the registry, never to humans).
  'ai.customer.read',
  'ai.billing.read',
  'ai.billing.write',
  'ai.support.read',
  'ai.support.write',
  'ai.server.read',
  'ai.infrastructure.read',
  'ai.infrastructure.execute',
  'ai.security.read',
  'ai.security.remediate',
  'ai.catalog.read',
  'ai.marketing.draft',
  'ai.knowledge.read',
  'ai.incident.manage',
  'ai.observability.read',
  'ai.admin.execute',
] as const;

export type AiPermission = (typeof AI_PERMISSIONS)[number];

/** Agent-facing permissions — everything except the operator governance set. */
export const AGENT_TOOL_PERMISSIONS: readonly AiPermission[] = [
  'ai.customer.read',
  'ai.billing.read',
  'ai.billing.write',
  'ai.support.read',
  'ai.support.write',
  'ai.server.read',
  'ai.infrastructure.read',
  'ai.infrastructure.execute',
  'ai.security.read',
  'ai.security.remediate',
  'ai.catalog.read',
  'ai.marketing.draft',
  'ai.knowledge.read',
  'ai.incident.manage',
  'ai.observability.read',
  'ai.admin.execute',
];

const STAFF_PERMISSIONS: readonly AiPermission[] = [
  'ai.view',
  'ai.board.view',
  'ai.knowledge.view',
  'ai.evaluations.write',
];

/** Model/router and agent-registry management are super_admin-only: they change what the AI
 *  workforce itself is allowed to do, the same way role management is elevated elsewhere. */
const ADMIN_PERMISSIONS: readonly AiPermission[] = AI_PERMISSIONS.filter(
  (p) =>
    !AGENT_TOOL_PERMISSIONS.includes(p) &&
    p !== 'ai.agents.manage' &&
    p !== 'ai.models.manage'
);

const SUPER_ADMIN_PERMISSIONS: readonly AiPermission[] = AI_PERMISSIONS.filter(
  (p) => !AGENT_TOOL_PERMISSIONS.includes(p)
);

const ROLE_PERMISSIONS: Record<string, readonly AiPermission[]> = {
  super_admin: SUPER_ADMIN_PERMISSIONS,
  admin: ADMIN_PERMISSIONS,
  staff: STAFF_PERMISSIONS,
};

/** Roles allowed to touch the admin AI surface at all. */
export const AI_ADMIN_ROLES = ['staff', 'admin', 'super_admin'] as const;

export function permissionsForRole(role: string): readonly AiPermission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function roleHasPermission(role: string, permission: AiPermission): boolean {
  return permissionsForRole(role).includes(permission);
}

export interface AiRequestContext extends AuthorizedRequestContext {
  permissions: readonly AiPermission[];
}

/**
 * Authenticates the caller, re-verifies their role against the database (never the JWT claim
 * alone — same guarantee as every other privileged route), and asserts the named AI permission.
 */
export async function requireAiPermission(
  request: FastifyRequest,
  env: Env,
  pool: Queryable,
  permission: AiPermission
): Promise<AiRequestContext> {
  const auth = await requireRole(request, env, pool, AI_ADMIN_ROLES);
  const permissions = permissionsForRole(auth.role);
  if (!permissions.includes(permission)) {
    throw new ForbiddenError(`Missing permission: ${permission}`);
  }
  return { ...auth, permissions };
}
