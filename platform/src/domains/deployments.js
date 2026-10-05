/**
 * Deployments.
 *
 * Ported from cloudhost247-node/src/routes/deployments.ts. A deployment record tracks a release
 * (git ref, source, status) against a customer service. Actual CI/CD execution is an adapter
 * concern that is deferred, so deployments start as 'queued'.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { authenticate } = require('../lib/auth');

const name = 'deployments';

function publicDeployment(row) {
  return {
    id: row.id, serviceId: row.service_id, source: row.source, ref: row.ref,
    status: row.status, url: row.url, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function register(router, deps) {
  const { store } = deps;

  router.get('/api/v1/deployments', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { rows, total } = await store.table('deployments').find({ user_id: auth.id }, { orderBy: '-created_at' });
    ctx.json({ deployments: rows.map(publicDeployment), total });
  });

  router.post('/api/v1/deployments', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(v.object({
      source: v.enum(['github', 'gitlab', 'bitbucket', 'git', 'artifact']),
      ref: v.string().trim().min(1).max(255),
      serviceId: v.string().optional(),
    }));

    const deployment = await store.table('deployments').insert({
      id: uuidv7(), user_id: auth.id, service_id: body.serviceId ?? null,
      source: body.source, ref: body.ref, status: 'queued',
    });
    ctx.code(201).json({ deployment: publicDeployment(deployment) });
  });

  router.get('/api/v1/deployments/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const dep = await store.table('deployments').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!dep) throw new NotFoundError('Deployment not found');
    ctx.json({ deployment: publicDeployment(dep) });
  });
}

module.exports = { name, register };
