/**
 * Deployments (spec §24): list / detail / logs / cancel / execution plus a real-time SSE event stream.
 *
 * Ported from cloudhost247-node/src/routes/deployments.ts.
 *
 * Visibility: the list endpoint lets admin|super_admin see everything, while detail, logs and
 * cancel go through canSeeDeployment(), which only matches the requesting user (directly or through
 * the installation row). The cancel route additionally re-checks the role.
 *
 * CI/CD execution is handled by the deployment worker (platform/src/lib/deployment-worker.js),
 * which executes ordered pipeline steps and records logs and transitions.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError, ConflictError, ValidationError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { authenticate, asAdmin } = require('../lib/auth');
const { executeDeployment, runDeploymentCycle } = require('../lib/deployment-worker');

const name = 'deployments';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'rolled_back']);
const MAX_STREAM_MS = 10 * 60 * 1000;

function requireUuid(raw) {
  if (!UUID_RE.test(String(raw ?? ''))) throw new ValidationError('id must be a valid UUID');
  return String(raw);
}

function register(router, deps) {
  const { store } = deps;

  const deployments = () => store.table('deployments');
  const stepsOf = (id) => store.table('deployment_steps').find({ deployment_id: id }, { orderBy: ['step_order'] });
  const eventsOf = (id, since) => store.table('deployment_events').find(
    (row) => row.deployment_id === id && (!since || String(row.created_at) > String(since)),
    { orderBy: ['created_at'], limit: 500 },
  );

  /** Mirrors canCustomerSeeDeployment(): requested_by, or ownership through the installation. */
  async function canSeeDeployment(userId, deployment) {
    if (deployment.requested_by && deployment.requested_by === userId) return true;
    if (deployment.user_id && deployment.user_id === userId) return true;
    if (deployment.installation_id) {
      const installation = await store.table('application_installations').findById(deployment.installation_id);
      if (installation && installation.user_id === userId) return true;
    }
    return false;
  }

  const isStaff = (role) => role === 'admin' || role === 'super_admin';

  router.get('/api/v1/deployments', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const query = await ctx.validateQuery(v.object({
      installationId: v.string().regex(UUID_RE, 'installationId must be a valid UUID').optional(),
      status: v.string().max(24).optional(),
      action: v.string().max(24).optional(),
      limit: v.coerce.number().int().min(1).max(200).optional(),
    }));

    const limit = query.limit ?? 100;
    const { rows } = await deployments().find({}, { orderBy: ['-created_at'], limit });

    let visible = rows;
    if (!isStaff(auth.role)) {
      const ownedInstallations = new Set(
        (await store.table('application_installations').find({ user_id: auth.id })).rows.map((i) => i.id),
      );
      visible = rows.filter((d) => (d.installation_id && ownedInstallations.has(d.installation_id))
        || d.requested_by === auth.id || d.user_id === auth.id);
    }
    if (query.installationId) visible = visible.filter((d) => d.installation_id === query.installationId);
    if (query.status) visible = visible.filter((d) => d.status === query.status);
    if (query.action) visible = visible.filter((d) => d.action === query.action);

    ctx.json({ deployments: visible });
  });

  /** Detail with the ordered step pipeline and the full event log. */
  async function loadDetail(ctx) {
    const auth = await authenticate(ctx, deps);
    const id = requireUuid(ctx.params.id);
    const deployment = await deployments().findById(id);
    if (!deployment) throw new NotFoundError('No deployment was found with that id');
    if (!(await canSeeDeployment(auth.id, deployment))) {
      throw new NotFoundError('No deployment was found with that id');
    }
    return { auth, deployment, steps: (await stepsOf(id)).rows, events: (await eventsOf(id)).rows };
  }

  router.get('/api/v1/deployments/:id', async (ctx) => {
    const { deployment, steps, events } = await loadDetail(ctx);
    ctx.json({ deployment, steps, events });
  });

  router.get('/api/v1/deployments/:id/logs', async (ctx) => {
    const { deployment, steps } = await loadDetail(ctx);
    const query = await ctx.validateQuery(v.object({ since: v.string().datetime().optional() }));
    ctx.json({ events: (await eventsOf(deployment.id, query.since)).rows, steps });
  });

  router.post('/api/v1/deployments/:id/cancel', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const id = requireUuid(ctx.params.id);
    const deployment = await deployments().findById(id);
    if (!deployment) throw new NotFoundError('No deployment was found with that id');
    if (!(await canSeeDeployment(auth.id, deployment))) {
      throw new NotFoundError('No deployment was found with that id');
    }
    if (deployment.requested_by && deployment.requested_by !== auth.id && !isStaff(auth.role)) {
      throw new NotFoundError('No deployment was found with that id');
    }

    if (deployment.status !== 'queued') throw new ConflictError('Only queued deployments can be cancelled');
    const now = new Date().toISOString();
    const cancelled = await deployments().updateById(id, {
      status: 'cancelled', completed_at: now, updated_at: now,
    });
    await store.table('deployment_events').insert({
      id: uuidv7(), deployment_id: id, level: 'warn', message: 'Deployment cancelled by user', created_at: now,
    });
    ctx.json({ deployment: cancelled });
  });

  /** Trigger execution of a queued deployment pipeline */
  router.post('/api/v1/deployments/:id/execute', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const id = requireUuid(ctx.params.id);
    const deployment = await deployments().findById(id);
    if (!deployment) throw new NotFoundError('No deployment was found with that id');
    if (!(await canSeeDeployment(auth.id, deployment))) {
      throw new NotFoundError('No deployment was found with that id');
    }

    if (deployment.status !== 'queued') {
      throw new ConflictError('Only queued deployments can be executed');
    }

    const result = await executeDeployment(store, deployment);
    ctx.json({ ok: result.ok, deployment: result.deployment });
  });

  /** Admin sweep: process all pending/queued deployments */
  router.post('/api/v1/admin/deployments/sweep', async (ctx) => {
    await asAdmin(ctx, deps);
    const cycleResult = await runDeploymentCycle(store);
    ctx.json({ ok: true, ...cycleResult });
  });

  /**
   * SSE stream (spec §24). EventSource cannot send an Authorization header, so this one read-only
   * endpoint also accepts the same bearer token as ?token=.
   */
  router.get('/api/v1/deployments/:id/events', async (ctx) => {
    const queryToken = ctx.query?.token;
    const token = typeof queryToken === 'string' && queryToken.startsWith(' ') ? queryToken.slice(1) : queryToken;
    if (token && !ctx.headers.authorization) {
      ctx.headers.authorization = `Bearer ${token}`;
    }
    const auth = await authenticate(ctx, deps);

    const id = requireUuid(ctx.params.id);
    const deployment = await deployments().findById(id);
    if (!deployment) throw new NotFoundError('No deployment was found with that id');
    if (!(await canSeeDeployment(auth.id, deployment))) {
      throw new NotFoundError('No deployment was found with that id');
    }

    ctx.res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    ctx._sent = true;

    const send = (event, data) => ctx.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    let cursor;
    let closed = false;
    ctx.res.on('close', () => { closed = true; });

    const started = Date.now();
    try {
      while (!closed && Date.now() - started < MAX_STREAM_MS) {
        const current = await deployments().findById(id);
        if (!current) break;

        const { rows: events } = await eventsOf(id, cursor);
        if (events.length > 0) {
          cursor = events[events.length - 1]?.created_at;
          send('events', events);
        }
        const { rows: steps } = await stepsOf(id);
        send('state', {
          status: current.status,
          steps: steps.map((s) => ({ order: s.step_order, name: s.name, status: s.status, error: s.error })),
        });

        if (TERMINAL_STATUSES.has(current.status)) {
          send('done', {
            status: current.status,
            errorCode: current.error_code,
            errorMessage: current.error_message,
          });
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } finally {
      if (!closed) ctx.res.end();
    }
    return null;
  });

  /** Create a deployment record. */
  router.post('/api/v1/deployments', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(v.object({
      source: v.enum(['github', 'gitlab', 'bitbucket', 'git', 'artifact']),
      ref: v.string().trim().min(1).max(255),
      serviceId: v.string().optional(),
      installationId: v.string().optional(),
      action: v.string().max(24).optional(),
      autoExecute: v.boolean().optional(),
    }));

    let deployment = await deployments().insert({
      id: uuidv7(), user_id: auth.id, requested_by: auth.id,
      service_id: body.serviceId ?? null, installation_id: body.installationId ?? null,
      source: body.source, ref: body.ref, action: body.action ?? 'install',
      status: 'queued', idempotency_key: uuidv7(),
    });
    await store.table('deployment_events').insert({
      id: uuidv7(), deployment_id: deployment.id, level: 'info',
      message: `Deployment queued for ${body.source} ref ${body.ref}`,
    });

    if (body.autoExecute) {
      const execResult = await executeDeployment(store, deployment);
      deployment = execResult.deployment;
    }

    ctx.code(201).json({ deployment });
  });
}

module.exports = { name, register };
