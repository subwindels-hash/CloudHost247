/**
 * App installations.
 *
 * Ported from cloudhost247-node/src/routes/app-installations.ts. Installing an app creates an
 * installation row and a provisioning job; actual deployment is an adapter concern that is
 * deferred, so installations start as 'queued'.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { authenticate } = require('../lib/auth');

const name = 'app-installations';

function publicInstallation(row) {
  return {
    id: row.id, applicationId: row.application_id, status: row.status,
    config: row.config, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function register(router, deps) {
  const { store } = deps;

  router.get('/api/v1/apps', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { rows, total } = await store.table('application_installations').find({ user_id: auth.id }, { orderBy: '-created_at' });
    ctx.json({ installations: rows.map(publicInstallation), total });
  });

  router.post('/api/v1/apps/install', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(v.object({
      applicationId: v.string().min(1),
      config: v.object({}).passthrough().default({}),
    }));

    const app = await store.table('applications').findById(body.applicationId);
    if (!app || !app.active) throw new NotFoundError('Application not found');

    const jobId = uuidv7();
    await store.transaction(async (tx) => {
      await tx.table('application_installations').insert({
        id: jobId, user_id: auth.id, application_id: app.id,
        config: body.config, status: 'queued',
      });
      await tx.table('provisioning_jobs').insert({
        id: uuidv7(), kind: 'install_application', resource_type: 'application_installations',
        resource_id: jobId, user_id: auth.id, status: 'queued', payload: { applicationId: app.id, config: body.config },
      });
    });
    ctx.code(201).json({ installation: { id: jobId, status: 'queued' } });
  });

  router.get('/api/v1/apps/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const inst = await store.table('application_installations').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!inst) throw new NotFoundError('Installation not found');
    ctx.json({ installation: publicInstallation(inst) });
  });

  router.delete('/api/v1/apps/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const inst = await store.table('application_installations').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!inst) throw new NotFoundError('Installation not found');
    await store.table('application_installations').deleteById(inst.id);
    ctx.json({ ok: true });
  });
}

module.exports = { name, register };
