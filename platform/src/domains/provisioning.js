/**
 * Provisioning jobs.
 *
 * Ported from cloudhost247-node/src/routes/provisioning.ts. Jobs are queued work items for the
 * infrastructure adapters. Customers see their own jobs; admins see all and can cancel. The
 * reconciliation sweep marks jobs stuck in a non-terminal state as failed (no live workers here).
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError } = require('../core/errors');
const { authenticate, asAdmin, asStaff } = require('../lib/auth');

const name = 'provisioning';

const TERMINAL = ['completed', 'failed', 'cancelled'];

function publicJob(row) {
  return {
    id: row.id, kind: row.kind, resourceType: row.resource_type, resourceId: row.resource_id,
    status: row.status, error: row.error, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function register(router, deps) {
  const { store } = deps;

  router.get('/api/v1/provisioning/jobs', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { rows, total } = await store.table('provisioning_jobs').find({ user_id: auth.id }, { orderBy: '-created_at' });
    ctx.json({ jobs: rows.map(publicJob), total });
  });

  router.get('/api/v1/admin/provisioning/jobs', async (ctx) => {
    await asAdmin(ctx, deps);
    const query = await ctx.validateQuery(v.object({ status: v.string().optional() }));
    const where = query.status ? { status: query.status } : {};
    const { rows, total } = await store.table('provisioning_jobs').find(where, { orderBy: '-created_at', limit: 200 });
    ctx.json({ jobs: rows.map((j) => ({ ...publicJob(j), userId: j.user_id })), total });
  });

  router.post('/api/v1/admin/provisioning/jobs/:id/cancel', async (ctx) => {
    await asStaff(ctx, deps);
    const job = await store.table('provisioning_jobs').findById(ctx.params.id);
    if (!job) throw new NotFoundError('Job not found');
    if (TERMINAL.includes(job.status)) throw new NotFoundError('Job already finished');
    const updated = await store.table('provisioning_jobs').updateById(job.id, { status: 'cancelled' });
    ctx.json({ job: publicJob(updated) });
  });

  router.get('/api/v1/admin/provisioning/metrics', async (ctx) => {
    await asAdmin(ctx, deps);
    const rows = await store.table('provisioning_jobs').all();
    const byStatus = {};
    for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    ctx.json({ total: rows.length, byStatus });
  });

  router.post('/api/v1/admin/provisioning/reconcile', async (ctx) => {
    await asAdmin(ctx, deps);
    const rows = await store.table('provisioning_jobs').all();
    let reconciled = 0;
    for (const job of rows) {
      if (!TERMINAL.includes(job.status)) {
        await store.table('provisioning_jobs').updateById(job.id, { status: 'failed', error: 'reconciled: no active worker' });
        reconciled += 1;
      }
    }
    ctx.json({ reconciled });
  });
}

module.exports = { name, register };
