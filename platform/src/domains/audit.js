/**
 * Audit log read endpoint.
 *
 * Ported from cloudhost247-node/src/routes/audit.ts. The log is append-only everywhere else; this
 * module only reads it. The original mounts the single handler under both '/api/v1' and '/api'.
 *
 * Note this is an admin|super_admin view of the *whole* log, not a self-scoped feed — that is the
 * original's contract. Column names differ from the source schema: this platform stores
 * entity_type/entity_id/after where the original stores resource_type/resource_id/metadata, so the
 * query parameters keep the original's names and are mapped on the way in.
 */
'use strict';

const { v } = require('../core/validate');
const { requireRole } = require('../lib/auth');

const name = 'audit';

const ADMIN_ROLES = ['admin', 'super_admin'];

function register(router, deps) {
  const { store } = deps;

  const auditLogs = async (ctx) => {
    await requireRole(ADMIN_ROLES, ctx, deps);

    const query = await ctx.validateQuery(v.object({
      actorId: v.string().max(64).optional(),
      resourceType: v.string().max(64).optional(),
      resourceId: v.string().max(128).optional(),
      action: v.string().max(120).optional(),
      limit: v.coerce.number().int().min(1).max(200).optional(),
      offset: v.coerce.number().int().min(0).optional(),
    }));

    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    // Filter first, then page — the original applies WHERE before LIMIT/OFFSET and reports the
    // untruncated match count separately.
    const { rows: matched } = await store.table('audit_logs').find((row) => {
      if (query.actorId && row.actor_id !== query.actorId) return false;
      if (query.resourceType && row.entity_type !== query.resourceType) return false;
      if (query.resourceId && row.entity_id !== query.resourceId) return false;
      // upper(a.action) LIKE %ACTION%
      if (query.action && !String(row.action ?? '').toUpperCase().includes(query.action.toUpperCase())) return false;
      return true;
    }, { orderBy: ['-created_at'] });

    const total = matched.length;
    const page = matched.slice(offset, offset + limit);

    // LEFT JOIN users u ON u.id = a.actor_id
    const users = await store.table('users').all();
    const byId = new Map(users.map((u) => [u.id, u]));

    ctx.json({
      logs: page.map((r) => {
        const actor = byId.get(r.actor_id);
        return {
          id: r.id,
          actorId: r.actor_id,
          actorEmail: actor?.email ?? null,
          actorName: actor?.full_name ?? null,
          action: r.action,
          resourceType: r.entity_type ?? null,
          resourceId: r.entity_id ?? null,
          ipAddress: r.ip_address ?? null,
          userAgent: r.user_agent ?? null,
          metadata: r.after ?? null,
          createdAt: r.created_at,
        };
      }),
      total,
      limit,
      offset,
    });
  };

  router.get('/api/v1/audit-logs', auditLogs);
  router.get('/api/audit-logs', auditLogs);

  // Platform extension (no counterpart in the original): the narrower staff-facing view used by
  // the admin console, which also admits the 'staff' role.
  router.get('/api/v1/admin/audit-logs', async (ctx) => {
    await requireRole(['staff', 'admin', 'super_admin'], ctx, deps);
    const limit = Math.min(Number(ctx.query.limit) || 100, 500);
    const predicate = {};
    if (ctx.query.actorId) predicate.actor_id = ctx.query.actorId;
    if (ctx.query.action) predicate.action = ctx.query.action;

    const { rows, total } = await store.table('audit_logs').find(predicate, { orderBy: '-created_at', limit });
    ctx.json({
      auditLogs: rows.map((row) => ({
        id: row.id, actorId: row.actor_id, actorRole: row.actor_role, action: row.action,
        entityType: row.entity_type, entityId: row.entity_id, ipAddress: row.ip_address,
        createdAt: row.created_at,
      })),
      total,
    });
  });
}

module.exports = { name, register };
