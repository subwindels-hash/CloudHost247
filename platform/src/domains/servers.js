/**
 * Customer servers (VPS/dedicated instances) and the admin server console.
 *
 * Ported from cloudhost247-node/src/routes/servers.ts. Lifecycle actions (power, resize, snapshot,
 * reinstall, rebuild, rescue, termination) are recorded as provisioning jobs and audited; the
 * actual hypervisor/provider call is an infrastructure adapter that is deferred, so an action
 * returns the queued job rather than pretending the provider ran. Reads return stored state.
 * Credentials are write-only: secrets are stored but never returned.
 */
'use strict';

const crypto = require('node:crypto');
const { v } = require('../core/validate');
const { NotFoundError, ValidationError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { authenticate, asAdmin, asStaff } = require('../lib/auth');

const name = 'servers';

const POWER_ACTIONS = {
  start: 'START', 'power-on': 'START',
  stop: 'STOP', 'power-off': 'SHUTDOWN',
  reboot: 'REBOOT', shutdown: 'SHUTDOWN',
};

function publicServer(row) {
  return {
    id: row.id, name: row.name, hostname: row.hostname, ip: row.ip_address,
    planId: row.plan_id, status: row.status, regionId: row.region_id, osId: row.os_id,
    provider: row.provider, panel: row.panel, createdAt: row.created_at,
  };
}

function publicJob(row) {
  return { jobId: row.id, kind: row.kind, status: row.status, createdAt: row.created_at };
}

async function ownedServer(store, auth, id) {
  const server = await store.table('servers').findOne({ id, user_id: auth.id });
  if (!server) throw new NotFoundError('No server was found with that id');
  return server;
}

/** Queue a provisioning job for a server action and return the job handle. */
async function queueAction(store, auth, server, operation, payload) {
  const job = await store.table('provisioning_jobs').insert({
    id: uuidv7(), user_id: auth.id, kind: operation,
    resource_type: 'servers', resource_id: server.id, server_id: server.id,
    status: 'queued', payload: payload ?? {},
  });
  return { jobId: job.id, status: job.status, queued: true };
}

function register(router, deps) {
  const { store } = deps;

  // ---- reference ----------------------------------------------------------
  router.get('/api/v1/operating-systems', async (ctx) => {
    const rows = await store.table('operating_systems').all();
    ctx.json({ operatingSystems: rows.map((o) => ({ id: o.id, name: o.name, slug: o.slug, family: o.family, active: o.active })) });
  });

  // ---- customer: list / create / get / patch / delete ---------------------
  router.get('/api/v1/servers', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { rows, total } = await store.table('servers').find({ user_id: auth.id }, { orderBy: '-created_at' });
    ctx.json({ servers: rows.map(publicServer), total });
  });

  router.post('/api/v1/servers', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(v.object({
      name: v.string().trim().min(1).max(120),
      hostname: v.string().trim().max(253).optional(),
      planId: v.string().optional(),
      regionId: v.string().optional(),
      osId: v.string().optional(),
    }));
    const server = await store.table('servers').insert({
      id: uuidv7(), user_id: auth.id, name: body.name, hostname: body.hostname ?? null,
      plan_id: body.planId ?? null, region_id: body.regionId ?? null, os_id: body.osId ?? null,
      status: 'provisioning',
    });
    await store.table('provisioning_jobs').insert({
      id: uuidv7(), user_id: auth.id, kind: 'CREATE', resource_type: 'servers',
      resource_id: server.id, server_id: server.id, status: 'queued', payload: {},
    });
    ctx.code(201).json({ server: publicServer(server) });
  });

  router.get('/api/v1/servers/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await ownedServer(store, auth, ctx.params.id);
    ctx.json({ server: publicServer(server) });
  });

  router.patch('/api/v1/servers/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await ownedServer(store, auth, ctx.params.id);
    const body = await ctx.validate(v.object({ name: v.string().trim().min(1).max(120), hostname: v.string().trim().max(253).optional() }));
    const patch = { name: body.name };
    if (body.hostname !== undefined) patch.hostname = body.hostname;
    const updated = await store.table('servers').updateById(server.id, patch);
    ctx.json({ server: publicServer(updated) });
  });

  router.delete('/api/v1/servers/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await ownedServer(store, auth, ctx.params.id);
    await queueAction(store, auth, server, 'DELETE');
    await store.table('servers').updateById(server.id, { status: 'terminating' });
    ctx.json({ ok: true, status: 'terminating' });
  });

  // ---- customer: power actions -------------------------------------------
  for (const [path, operation] of Object.entries(POWER_ACTIONS)) {
    router.post(`/api/v1/servers/:id/${path}`, async (ctx) => {
      const auth = await authenticate(ctx, deps);
      const server = await ownedServer(store, auth, ctx.params.id);
      ctx.code(202).json(await queueAction(store, auth, server, operation));
    });
  }

  // ---- customer: resize ---------------------------------------------------
  router.get('/api/v1/servers/:id/resize-options', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await ownedServer(store, auth, ctx.params.id);
    const plans = await store.table('server_plans').all();
    ctx.json({
      serverId: server.id,
      options: plans.filter((p) => p.active).map((p) => ({ planId: p.id, name: p.name, priceCents: p.price_cents })),
    });
  });

  router.post('/api/v1/servers/:id/resize', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await ownedServer(store, auth, ctx.params.id);
    const body = await ctx.validate(v.object({ targetPlanId: v.string().min(1) }));
    const result = await queueAction(store, auth, server, 'RESIZE', { targetPlanId: body.targetPlanId });
    ctx.code(202).json(result);
  });

  // ---- customer: snapshots ------------------------------------------------
  router.get('/api/v1/servers/:id/snapshots', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await ownedServer(store, auth, ctx.params.id);
    const jobs = await store.table('provisioning_jobs').all();
    const snaps = jobs.filter((j) => j.server_id === server.id && j.kind === 'SNAPSHOT_CREATE');
    ctx.json({ snapshots: snaps.map((j) => ({ id: j.id, status: j.status, description: j.payload?.description ?? null, createdAt: j.created_at })) });
  });

  router.post('/api/v1/servers/:id/snapshots', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await ownedServer(store, auth, ctx.params.id);
    const body = await ctx.validate(v.object({ description: v.string().trim().max(200).optional() }));
    const result = await queueAction(store, auth, server, 'SNAPSHOT_CREATE', { description: body.description ?? null });
    ctx.code(202).json(result);
  });

  router.delete('/api/v1/servers/:id/snapshots/:snapshotId', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await ownedServer(store, auth, ctx.params.id);
    const result = await queueAction(store, auth, server, 'SNAPSHOT_DELETE', { snapshotId: ctx.params.snapshotId });
    ctx.code(202).json(result);
  });

  router.post('/api/v1/servers/:id/snapshots/:snapshotId/restore', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await ownedServer(store, auth, ctx.params.id);
    const result = await queueAction(store, auth, server, 'SNAPSHOT_RESTORE', { snapshotId: ctx.params.snapshotId });
    ctx.code(202).json(result);
  });

  // ---- customer: reinstall / rebuild --------------------------------------
  router.post('/api/v1/servers/:id/reinstall', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await ownedServer(store, auth, ctx.params.id);
    const body = await ctx.validate(v.object({ osId: v.string().optional() }));
    ctx.code(202).json(await queueAction(store, auth, server, 'REINSTALL', { osId: body.osId ?? server.os_id }));
  });

  router.post('/api/v1/servers/:id/rebuild', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await ownedServer(store, auth, ctx.params.id);
    ctx.code(202).json(await queueAction(store, auth, server, 'REBUILD'));
  });

  // ---- customer: status / logs -------------------------------------------
  router.get('/api/v1/servers/:id/status', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await ownedServer(store, auth, ctx.params.id);
    ctx.json({ id: server.id, status: server.status });
  });

  router.get('/api/v1/servers/:id/provisioning-status', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await ownedServer(store, auth, ctx.params.id);
    const jobs = await store.table('provisioning_jobs').all();
    const mine = jobs.filter((j) => j.server_id === server.id).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    ctx.json({ serverId: server.id, latestJob: mine.length ? publicJob(mine[mine.length - 1]) : null });
  });

  router.get('/api/v1/servers/:id/logs', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await ownedServer(store, auth, ctx.params.id);
    const jobs = await store.table('provisioning_jobs').all();
    const logs = jobs.filter((j) => j.server_id === server.id).map((j) => ({ jobId: j.id, kind: j.kind, status: j.status, error: j.error, at: j.created_at }));
    ctx.json({ serverId: server.id, logs });
  });

  // ---- customer: termination (cancel) -------------------------------------
  router.post('/api/v1/servers/:id/cancel', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await ownedServer(store, auth, ctx.params.id);
    const body = await ctx.validate(v.object({ reason: v.string().trim().max(500).optional() }));
    const updated = await store.table('servers').updateById(server.id, { status: 'cancellation_requested', metadata: { ...(server.metadata || {}), cancellation: { reason: body.reason ?? null, requestedAt: new Date().toISOString() } } });
    ctx.json({ id: updated.id, status: updated.status });
  });

  router.delete('/api/v1/servers/:id/cancel', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await ownedServer(store, auth, ctx.params.id);
    const meta = { ...(server.metadata || {}) };
    delete meta.cancellation;
    const updated = await store.table('servers').updateById(server.id, { status: 'active', metadata: meta });
    ctx.json({ id: updated.id, status: updated.status });
  });

  // ---- customer: console / rescue -----------------------------------------
  router.post('/api/v1/servers/:id/console', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await ownedServer(store, auth, ctx.params.id);
    // A real console URL requires a provider session (deferred); issue a short-lived token only.
    ctx.json({ serverId: server.id, consoleToken: crypto.randomBytes(16).toString('base64url'), provider: 'deferred', note: 'Live console requires a provider adapter (deferred).' });
  });

  router.post('/api/v1/servers/:id/rescue', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await ownedServer(store, auth, ctx.params.id);
    await store.table('servers').updateById(server.id, { status: 'rescue' });
    ctx.code(202).json(await queueAction(store, auth, server, 'RESCUE_ENABLE'));
  });

  router.delete('/api/v1/servers/:id/rescue', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await ownedServer(store, auth, ctx.params.id);
    await store.table('servers').updateById(server.id, { status: 'active' });
    ctx.code(202).json(await queueAction(store, auth, server, 'RESCUE_DISABLE'));
  });

  // ---- customer: metrics / health / applications --------------------------
  router.get('/api/v1/servers/:id/metrics', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await ownedServer(store, auth, ctx.params.id);
    const query = await ctx.validateQuery(v.object({ limit: v.coerce.number().int().min(1).max(500).default(60) }));
    const rows = await store.table('server_metrics').all();
    const metrics = rows.filter((m) => m.server_id === server.id)
      .sort((a, b) => String(a.collected_at).localeCompare(String(b.collected_at))).slice(-query.limit);
    ctx.json({ serverId: server.id, metrics });
  });

  router.get('/api/v1/servers/:id/health', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await ownedServer(store, auth, ctx.params.id);
    const rows = await store.table('server_metrics').all();
    const mine = rows.filter((m) => m.server_id === server.id).sort((a, b) => String(a.collected_at).localeCompare(String(b.collected_at)));
    const latest = mine[mine.length - 1] ?? null;
    ctx.json({
      serverId: server.id, status: server.status,
      cpuPercent: latest ? latest.cpu_percent : null,
      memoryPercent: latest ? latest.memory_percent : null,
      diskPercent: latest ? latest.disk_percent : null,
      online: server.status === 'active',
    });
  });

  router.get('/api/v1/servers/:id/applications', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await ownedServer(store, auth, ctx.params.id);
    const rows = await store.table('application_installations').all();
    ctx.json({ serverId: server.id, applications: rows.filter((i) => i.server_id === server.id).map((i) => ({ id: i.id, applicationId: i.application_id, status: i.status, url: i.url })) });
  });

  // ---- customer: credentials + ssh keys -----------------------------------
  router.get('/api/v1/servers/:id/credentials', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await ownedServer(store, auth, ctx.params.id);
    const { rows } = await store.table('server_credentials').find({ server_id: server.id });
    ctx.json({ credentials: rows.map((c) => ({ id: c.id, kind: c.kind, username: c.username, createdAt: c.created_at })) });
  });

  router.post('/api/v1/servers/:id/credentials', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await ownedServer(store, auth, ctx.params.id);
    const body = await ctx.validate(v.object({
      kind: v.enum(['password', 'ssh_key']).default('password'),
      username: v.string().trim().min(1).max(64),
      secret: v.string().min(1).max(4096),
    }));
    const cred = await store.table('server_credentials').insert({ id: uuidv7(), server_id: server.id, kind: body.kind, username: body.username, secret: body.secret });
    ctx.code(201).json({ credential: { id: cred.id, kind: cred.kind, username: cred.username } });
  });

  router.delete('/api/v1/servers/:id/credentials/:credId', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    await ownedServer(store, auth, ctx.params.id);
    await store.table('server_credentials').deleteById(ctx.params.credId);
    ctx.json({ ok: true });
  });

  router.get('/api/v1/ssh-keys', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { rows } = await store.table('ssh_keys').find({ user_id: auth.id }, { orderBy: '-created_at' });
    ctx.json({ keys: rows.map((k) => ({ id: k.id, name: k.name, fingerprint: k.fingerprint, createdAt: k.created_at })) });
  });

  router.post('/api/v1/ssh-keys', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(v.object({ name: v.string().trim().min(1).max(120), publicKey: v.string().min(1).max(8192) }));
    const fingerprint = crypto.createHash('sha256').update(body.publicKey).digest('hex').slice(0, 47);
    const key = await store.table('ssh_keys').insert({ id: uuidv7(), user_id: auth.id, name: body.name, public_key: body.publicKey, fingerprint });
    ctx.code(201).json({ key: { id: key.id, name: key.name, fingerprint: key.fingerprint } });
  });

  router.delete('/api/v1/ssh-keys/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const key = await store.table('ssh_keys').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!key) throw new NotFoundError('Key not found');
    await store.table('ssh_keys').deleteById(key.id);
    ctx.json({ ok: true });
  });

  // ---- admin --------------------------------------------------------------
  router.get('/api/v1/admin/servers', async (ctx) => {
    await asAdmin(ctx, deps);
    const { rows, total } = await store.table('servers').find({}, { orderBy: '-created_at', limit: 200 });
    ctx.json({ servers: rows.map((s) => ({ ...publicServer(s), userId: s.user_id })), total });
  });

  router.get('/api/v1/admin/servers/:id', async (ctx) => {
    await asAdmin(ctx, deps);
    const server = await store.table('servers').findById(ctx.params.id);
    if (!server) throw new NotFoundError('Server not found');
    ctx.json({ server: { ...publicServer(server), userId: server.user_id } });
  });

  router.patch('/api/v1/admin/servers/:id', async (ctx) => {
    await asStaff(ctx, deps);
    const server = await store.table('servers').findById(ctx.params.id);
    if (!server) throw new NotFoundError('Server not found');
    const body = await ctx.validate(v.object({ status: v.string().optional(), name: v.string().trim().max(120).optional(), ipAddress: v.string().trim().max(64).optional() }));
    const patch = {};
    if (body.status) patch.status = body.status;
    if (body.name) patch.name = body.name;
    if (body.ipAddress) patch.ip_address = body.ipAddress;
    const updated = await store.table('servers').updateById(server.id, patch);
    ctx.json({ server: publicServer(updated) });
  });

  router.delete('/api/v1/admin/servers/:id', async (ctx) => {
    await asAdmin(ctx, deps);
    const server = await store.table('servers').findById(ctx.params.id);
    if (!server) throw new NotFoundError('Server not found');
    await store.table('servers').updateById(server.id, { status: 'retired' });
    ctx.json({ ok: true, status: 'retired' });
  });

  router.post('/api/v1/admin/servers/:id/rotate-credentials', async (ctx) => {
    await asStaff(ctx, deps);
    const server = await store.table('servers').findById(ctx.params.id);
    if (!server) throw new NotFoundError('Server not found');
    const { rows } = await store.table('server_credentials').find({ server_id: server.id });
    for (const c of rows) {
      await store.table('server_credentials').updateById(c.id, { secret: crypto.randomBytes(24).toString('base64url') });
    }
    ctx.json({ ok: true, rotated: rows.length });
  });

  router.get('/api/v1/admin/servers/:id/credentials', async (ctx) => {
    await asAdmin(ctx, deps);
    const server = await store.table('servers').findById(ctx.params.id);
    if (!server) throw new NotFoundError('Server not found');
    const { rows } = await store.table('server_credentials').find({ server_id: server.id });
    ctx.json({ credentials: rows.map((c) => ({ id: c.id, kind: c.kind, username: c.username, createdAt: c.created_at })) });
  });

  router.post('/api/v1/admin/servers/trim-metrics', async (ctx) => {
    await asAdmin(ctx, deps);
    const body = await ctx.validate(v.object({ olderThanDays: v.coerce.number().int().min(1).max(365).default(30) }));
    const cutoff = Date.now() - body.olderThanDays * 86400_000;
    const rows = await store.table('server_metrics').all();
    let trimmed = 0;
    for (const m of rows) {
      if (new Date(m.collected_at).getTime() < cutoff) { await store.table('server_metrics').deleteById(m.id); trimmed += 1; }
    }
    ctx.json({ trimmed });
  });
}

module.exports = { name, register };
