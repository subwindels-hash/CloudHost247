/**
 * Who may see which email trace, and which mail domains they may ask about.
 *
 * The repository accepts a scope and treats an *empty* scope as "matches nothing", so the only way
 * a customer can ever read another customer's mail trace is if this module hands out the wrong
 * scope. That is why it is a separate, small, testable module rather than a filter sprinkled
 * through route handlers.
 *
 * Rules:
 *  - Customers (and staff, who have no tenant-wide mail authority) are scoped to their own user id.
 *    A trace that belongs to someone else is *not* 403: it is 404, identical to a trace that does
 *    not exist, because "this message exists but is not yours" is itself a disclosure.
 *  - Administrators see across tenants — that is the point of the admin view — and their reads are
 *    audited separately (src/email-trace/audit.ts) rather than being silently unscoped.
 *  - A delegated support session is the customer's session: `auth.userId` is already the customer,
 *    so the support-mode admin sees exactly what that customer sees, never more.
 */
import type { Queryable } from '../db/types';
import type { EmailTraceScope } from '../db/email-trace';

/** The caller's identity as established by authenticate()/requireRole() — never from the request body. */
export interface EmailTraceActor {
  userId: string;
  role: string;
  supportSessionId: string | null;
  actingAdminId: string | null;
}

/** Roles that may read across tenants and run collection. */
export const EMAIL_TRACE_ADMIN_ROLES = ['admin', 'super_admin'] as const;

export function isEmailTraceAdmin(actor: EmailTraceActor): boolean {
  return (EMAIL_TRACE_ADMIN_ROLES as readonly string[]).includes(actor.role);
}

/**
 * Scope for every customer-facing read (`/api/v1/email-trace*`).
 *
 * Always exactly one customer id — the caller's own, whatever their role. An administrator who opens
 * the customer page therefore sees their own (empty) mailbox history, not the platform's, and a
 * delegated support session sees the supported customer because `auth.userId` is already that
 * customer. `{}` (unrestricted) is never returned from here: the repository treats an empty
 * `customerIds` array as a closed scope, so failing closed is the only failure mode.
 */
export function scopeForOwnMail(actor: EmailTraceActor): EmailTraceScope {
  return { customerIds: [actor.userId] };
}

/**
 * Scope for the admin console (`/api/v1/admin/email-trace*`). Unrestricted, and deliberately a
 * separate function from `scopeForOwnMail` so no route can pick up cross-tenant visibility by
 * accident: calling this requires having already passed requireRole(EMAIL_TRACE_ADMIN_ROLES).
 */
export function scopeForAdminConsole(): EmailTraceScope {
  return {};
}

/**
 * True when this actor may read a specific stored event row, given the tenant columns it carries.
 * Used for defence in depth on single-record reads; the SQL already filters, but a repository bug
 * must not turn into a cross-tenant read.
 */
export function actorMayReadEvent(
  actor: EmailTraceActor,
  event: { customer_id: string | null; hosting_account_id: string | null },
  actorHostingAccountIds: readonly string[]
): boolean {
  if (isEmailTraceAdmin(actor)) return true;
  if (event.customer_id) return event.customer_id === actor.userId;
  if (event.hosting_account_id) return actorHostingAccountIds.includes(event.hosting_account_id);
  // Unattributed event: staff-only. A customer is never shown mail the platform could not attribute.
  return false;
}

export interface DomainAccess {
  domainId: string;
  domainName: string;
  scope: EmailTraceScope;
}

/**
 * Resolve `GET /domains/:domainId` for the caller.
 *
 * Returns `null` when the domain does not exist *or* belongs to someone else — the route turns both
 * into 404. Admin lookups still return the domain's own scope so the SQL stays tenant-filtered even
 * for an unrestricted caller (passing the domain name is a filter, not a permission grant).
 */
export async function resolveDomainAccess(
  db: Queryable,
  actor: EmailTraceActor,
  domainId: string
): Promise<DomainAccess | null> {
  const result = await db.query<{ id: string; domain_name: string; user_id: string | null }>(
    `SELECT id, domain_name, user_id FROM customer_domains WHERE id = $1`,
    [domainId]
  );
  const row = result.rows[0];
  if (!row) return null;

  const scope = isEmailTraceAdmin(actor) ? scopeForAdminConsole() : scopeForOwnMail(actor);
  if (!isEmailTraceAdmin(actor)) {
    // Someone else's domain is indistinguishable from a domain that does not exist.
    if (row.user_id !== actor.userId) return null;
  }

  return { domainId: row.id, domainName: row.domain_name, scope };
}

/**
 * The hosting account ids a customer may legitimately see mail for: the `customer_services` rows
 * they own. Admins get an unrestricted scope, so the list is only consulted for customers.
 *
 * A customer with no hosting services gets `[]`, which — together with the boolean rule in
 * `actorMayReadEvent` — means an unattributed event is never shown to them.
 */
export async function listActorHostingAccountIds(db: Queryable, actor: EmailTraceActor): Promise<string[]> {
  if (isEmailTraceAdmin(actor)) return [];
  const result = await db.query<{ id: string }>(
    `SELECT id FROM customer_services WHERE user_id = $1`,
    [actor.userId]
  );
  return result.rows.map((row) => row.id);
}
