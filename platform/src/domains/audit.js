/**
 * Audit log read endpoints.
 *
 * Ported from cloudhost247-node/src/routes/audit.ts. The audit log is append-only everywhere else;
 * this module only reads it, scoped to admins for the global view and to the caller for their own.
 */
'use strict';

const { asStaff } = require('../lib/auth');
const { authenticate } = require('../lib/auth');

const name = 'audit';

function publicAudit(row) {
  return {
    id: row.id,
    actorId: row.actor_id,
    actorRole: row.actor_role,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    ipAddress: row.ip_address,
    createdAt: row.created_at,
  };
}

function register(router, deps) {
  const { store } = deps;

  router.get('/api/v1/admin/audit-logs', async (ctx) => {
    await asStaff(ctx, deps);
    const limit = Math.min(Number(ctx.query.limit) || 100, 500);
    const predicate = {};
    if (ctx.query.actorId) predicate.actor_id = ctx.query.actorId;
    if (ctx.query.action) predicate.action = ctx.query.action;

    const { rows, total } = await store.table('audit_logs').find(predicate, { orderBy: '-created_at', limit });
    ctx.json({ auditLogs: rows.map(publicAudit), total });
  });

  router.get('/api/v1/audit-logs', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { rows, total } = await store.table('audit_logs').find(
      { actor_id: auth.id },
      { orderBy: '-created_at', limit: 100 }
    );
    ctx.json({ auditLogs: rows.map(publicAudit), total });
  });
}

module.exports = { name, register };
