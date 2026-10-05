/**
 * Provisioning jobs.
 *
 * Ported from cloudhost247-node/src/routes/provisioning.ts. Jobs are queued work items for the
 * infrastructure adapters. Customers see their own jobs; admins see all and can cancel.
 *
 * The execution side lives in `lib/provisioning-worker.js`, and this module exposes it as one cycle
 * per request (`POST /admin/provisioning/worker/run`) so it can be driven by cron, by an operator or
 * by a test rather than depending on a process staying alive. Reconciliation now means what its name
 * says: it fails a job only when the worker's own lease rule agrees nobody is running it, and a
 * queued job is left alone as backlog instead of being destroyed to tidy a dashboard.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError, ConflictError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { authenticate, asAdmin, asStaff } = require('../lib/auth');
const { runProvisioningCycle, isClaimable } = require('../lib/provisioning-worker');

const name = 'provisioning';

const TERMINAL = ['completed', 'failed', 'cancelled'];

function publicJob(row) {
  return {
    id: row.id, kind: row.kind, resourceType: row.resource_type, resourceId: row.resource_id,
    status: row.status, error: row.error, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

// Admin-facing job projection: everything the operator needs to triage a stuck build.
function adminJob(row) {
  return {
    ...publicJob(row),
    userId: row.user_id ?? null, serverId: row.server_id ?? null, serviceId: row.service_id ?? null,
    type: row.type ?? null, attempts: row.attempts ?? 0, payload: row.payload ?? null,
    result: row.result ?? null, startedAt: row.started_at ?? null, finishedAt: row.finished_at ?? null,
  };
}

function register(router, deps) {
  const { store } = deps;

  // The original calls registerHandlers() for both '/api/v1' and the legacy '/api' prefix, so the
  // same handler instances are mounted twice. Only the routes the original dual-mounts go through
  // here; platform-specific extras stay on '/api/v1' alone.
  const dual = (method, path, handler) => {
    for (const prefix of ['/api/v1', '/api']) router[method](`${prefix}${path}`, handler);
  };


  dual('get', '/provisioning/jobs', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { rows, total } = await store.table('provisioning_jobs').find({ user_id: auth.id }, { orderBy: '-created_at' });
    ctx.json({ jobs: rows.map(publicJob), total });
  });

  // Customer job detail — owners see their own job; staff see any. The thin job model carries no
  // deployment step/event rows, so those arrays stay empty (contract parity).
  dual('get', '/provisioning/jobs/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const job = await store.table('provisioning_jobs').findById(ctx.params.id);
    if (!job) throw new NotFoundError('Provisioning job not found');
    const isStaff = ['admin', 'super_admin', 'staff'].includes(auth.role);
    if (!isStaff && job.user_id !== auth.id) throw new NotFoundError('Provisioning job not found');
    ctx.json({ job: adminJob(job), steps: [], events: [] });
  });

  // Retry/cancel on the customer surface are admin-gated in the original (requireRole admin/super_admin).
  dual('post', '/provisioning/jobs/:id/retry', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const job = await store.table('provisioning_jobs').findById(ctx.params.id);
    if (!job) throw new NotFoundError('Provisioning job not found');
    if (job.status !== 'failed') throw new ConflictError('Only retryable failed jobs can be retried');
    await store.table('provisioning_jobs').updateById(job.id, { status: 'queued', error: null, finished_at: null });
    await audit(ctx, 'PROVISIONING_JOB_RETRIED', job.id);
    ctx.json({ queued: true, message: 'Provisioning job queued for retry' });
  });

  dual('post', '/provisioning/jobs/:id/cancel', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const job = await store.table('provisioning_jobs').findById(ctx.params.id);
    if (!job) throw new NotFoundError('Provisioning job not found');
    if (job.status !== 'queued') throw new ConflictError('Only queued jobs can be cancelled');
    await store.table('provisioning_jobs').updateById(job.id, { status: 'cancelled', finished_at: new Date().toISOString() });
    await audit(ctx, 'PROVISIONING_JOB_CANCELLED', job.id);
    ctx.json({ cancelled: true, message: 'Provisioning job cancelled' });
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
    const nowMs = Date.now();
    const rows = await store.table('provisioning_jobs').all();
    let reconciled = 0;
    let leftQueued = 0;
    for (const job of rows) {
      if (job.status === 'queued') {
        // Backlog is not drift. Since the worker exists, a queued job is work waiting its turn, and
        // failing it here would destroy a customer's pending action to tidy a dashboard.
        leftQueued += 1;
        continue;
      }
      // `isClaimable` is the worker's own rule for "this lease has expired", so a job is only failed
      // here when the same code that would run it agrees nobody is running it.
      if (job.status === 'running' && isClaimable(job, nowMs)) {
        await store.table('provisioning_jobs').updateById(job.id, {
          status: 'failed', error: 'reconciled: the worker holding this job stopped responding',
          finished_at: new Date(nowMs).toISOString(), updated_at: new Date(nowMs).toISOString(),
        });
        reconciled += 1;
      }
    }
    ctx.json({ reconciled, leftQueued });
  });

  /**
   * Run one worker cycle.
   *
   * Exposed as a route rather than a background timer for the same reason as every other sweep on
   * this platform: it can be driven by cron, by an operator, and by a test over the real HTTP
   * pipeline, and nothing about it depends on a process staying alive. `runProvisioningCycle` is
   * exported for a deployment that would rather schedule it directly.
   */
  router.post('/api/v1/admin/provisioning/worker/run', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const body = await ctx.validate(v.object({
      limit: v.coerce.number().int().min(1).max(200).optional(),
    }).default({}));
    const cycle = await runProvisioningCycle(deps, { limit: body.limit ?? 25 });
    await store.table('audit_logs').insert({
      id: uuidv7(), actor_id: auth.id, actor_role: auth.role, action: 'PROVISIONING_WORKER_RAN',
      entity_type: 'provisioning_job', entity_id: null, ip_address: ctx.ip, user_agent: ctx.userAgent,
      after: {
        claimed: cycle.claimed, completed: cycle.completed, failed: cycle.failed,
        requeued: cycle.requeued, dead_lettered: cycle.dead_lettered,
      },
    });
    ctx.json({
      claimed: cycle.claimed, completed: cycle.completed, failed: cycle.failed,
      requeued: cycle.requeued, deadLettered: cycle.dead_lettered,
      results: cycle.results.map((r) => ({
        jobId: r.jobId, kind: r.kind, outcome: r.outcome,
        status: r.job?.status ?? null, error: r.job?.error ?? null, attempts: r.job?.attempts ?? 0,
      })),
    });
  });

  // ---- Original admin/provisioning-jobs surface (spec §infrastructure) -------------------------
  async function audit(ctx, action, jobId) {
    await store.table('audit_logs').insert({
      id: uuidv7(), actor_id: ctx.user.id, actor_role: ctx.user.role, action,
      entity_type: 'provisioning_job', entity_id: jobId ?? null,
      ip_address: ctx.ip, user_agent: ctx.userAgent, after: null,
    });
  }

  router.get('/api/v1/admin/provisioning-jobs', async (ctx) => {
    await asAdmin(ctx, deps);
    const query = await ctx.validateQuery(v.object({
      status: v.string().max(32).optional(),
      serverId: v.string().optional(),
      limit: v.coerce.number().int().min(1).max(200).optional(),
    }));
    const where = {};
    if (query.status) where.status = query.status;
    if (query.serverId) where.server_id = query.serverId;
    const { rows } = await store.table('provisioning_jobs').find(where, { orderBy: '-created_at', limit: query.limit ?? 100 });
    ctx.json({ jobs: rows.map(adminJob) });
  });

  router.get('/api/v1/admin/provisioning-jobs/:id', async (ctx) => {
    await asAdmin(ctx, deps);
    const job = await store.table('provisioning_jobs').findById(ctx.params.id);
    if (!job) throw new NotFoundError('Provisioning job not found');
    // The thin job model here carries no separate deployment step/event rows; the arrays are
    // returned for contract parity and stay empty until a deployment ledger is wired in.
    ctx.json({ job: adminJob(job), steps: [], events: [] });
  });

  router.post('/api/v1/admin/provisioning-jobs/:id/retry', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const job = await store.table('provisioning_jobs').findById(ctx.params.id);
    if (!job) throw new NotFoundError('Provisioning job not found');
    // Only a failed job can be retried (mirrors retryProvisioningJob's status='FAILED' guard).
    if (job.status !== 'failed') throw new ConflictError('Only retryable failed jobs can be retried');
    await store.table('provisioning_jobs').updateById(job.id, { status: 'queued', error: null, finished_at: null });
    await audit(ctx, 'PROVISIONING_JOB_RETRIED', job.id);
    ctx.json({ queued: true });
  });

  router.post('/api/v1/admin/provisioning-jobs/:id/cancel', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const job = await store.table('provisioning_jobs').findById(ctx.params.id);
    if (!job) throw new NotFoundError('Provisioning job not found');
    // Only a queued job can be cancelled (mirrors cancelProvisioningJob's status='QUEUED' guard).
    if (job.status !== 'queued') throw new ConflictError('Only queued jobs can be cancelled');
    await store.table('provisioning_jobs').updateById(job.id, { status: 'cancelled', finished_at: new Date().toISOString() });
    await audit(ctx, 'PROVISIONING_JOB_CANCELLED', job.id);
    ctx.json({ cancelled: true });
  });
}

module.exports = { name, register };
