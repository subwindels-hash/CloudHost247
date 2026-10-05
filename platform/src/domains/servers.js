/**
 * Customer servers (VPS/dedicated instances) and the admin server console.
 *
 * Ported from cloudhost247-node/src/routes/servers.ts. Lifecycle actions (power, resize, snapshot,
 * reinstall, rebuild, rescue, termination) are recorded as provisioning jobs and audited, and an
 * action returns the queued job rather than pretending the provider ran — provisioning is durable
 * work and never runs in request scope. What the provider boundary does add here is honesty about
 * what can be queued at all: an action a provider documents no support for is refused before a job
 * is written, and the console route issues a real provider session instead of a token that leads
 * nowhere. Reads return stored state. Credentials are write-only: secrets are stored but never
 * returned, and a console session's key material is never written to an audit log.
 */
'use strict';

const crypto = require('node:crypto');
const { v } = require('../core/validate');
const { NotFoundError, ValidationError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { authenticate, asAdmin, asStaff } = require('../lib/auth');
const {
  callProvider, resolveServerProvider, assertCapabilitySupported,
  normalizeConsoleSession, consoleSessionEvidence,
} = require('../lib/provider-egress');
// One map for both the queue-time gate and the worker that executes the job, so they cannot drift.
const { PROVISIONING_CAPABILITY } = require('../lib/provisioning-worker');
// The same availability rule the OS versions route uses, so the two cannot disagree about an OS.
const { computeVersionAvailability } = require('../lib/os-availability');

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

function register(router, deps) {
  const { store, config = {}, logger } = deps;

  /**
   * Queue a provisioning job for a server action and return the job handle.
   *
   * Every lifecycle action goes through here, so the capability check lives here rather than in each
   * route: a route cannot forget it and queue work the provider will never perform. The check is
   * deliberately one-directional — it refuses only when a provider *is* resolved and that provider
   * documents the capability as absent. A server this platform holds no provider handle for is still
   * queued, because it may legitimately be mid-provision and the worker is what reports that.
   *
   * The action stays queued rather than running in request scope: provisioning is durable work, and
   * a request that outlives a provider timeout would leave a customer staring at a spinner.
   */
  async function queueAction(auth, server, operation, payload) {
    const capability = PROVISIONING_CAPABILITY[operation];
    if (capability) {
      const { provider } = await resolveServerProvider(store, server, config);
      if (provider) assertCapabilitySupported(provider, config, capability);
    }
    const job = await store.table('provisioning_jobs').insert({
      id: uuidv7(), user_id: auth.id, kind: operation,
      resource_type: 'servers', resource_id: server.id, server_id: server.id,
      status: 'queued', payload: payload ?? {},
    });
    return { jobId: job.id, status: job.status, queued: true };
  }

  // servers.ts registers these handlers twice — under '/api/v1' and under the legacy '/api'
  // prefix — so both mounts must serve the same handler instances.
  const dual = (method, path, handler) => {
    for (const prefix of ['/api/v1', '/api']) router[method](`${prefix}${path}`, handler);
  };

  // ---- reference ----------------------------------------------------------
  /**
   * The operating systems a customer can actually build a server from.
   *
   * This returned every row in the table — including disabled and archived ones, since it exposed
   * `active` as a field rather than filtering on it — so the order wizard offered choices no product
   * configuration or verified image could deliver. It now uses the same availability rule as the
   * versions route, and reports how many versions are orderable so a caller can tell an OS with one
   * mapping from one with twelve.
   */
  router.get('/api/v1/operating-systems', async (ctx) => {
    const [rows, versions, availability] = await Promise.all([
      store.table('operating_systems').all(),
      store.table('operating_system_versions').all(),
      computeVersionAvailability(store),
    ]);
    const orderableByOs = new Map();
    for (const version of versions) {
      if (!['ACTIVE', 'MAINTENANCE', 'EOL_WARNING'].includes(String(version.status ?? '').toUpperCase())) continue;
      if (availability.get(version.id)?.orderable !== true) continue;
      orderableByOs.set(version.operating_system_id, (orderableByOs.get(version.operating_system_id) ?? 0) + 1);
    }
    ctx.json({
      operatingSystems: rows
        .filter((o) => String(o.status ?? (o.active === false ? 'DISABLED' : 'ACTIVE')).toUpperCase() === 'ACTIVE')
        .filter((o) => orderableByOs.has(o.id))
        .map((o) => ({
          id: o.id, name: o.name, slug: o.slug, family: o.family, active: o.active,
          orderableVersions: orderableByOs.get(o.id),
        })),
    });
  });

  // ---- customer: list / create / get / patch / delete ---------------------
  dual('get', '/servers', async (ctx) => {
    // Platform deployment targets were public before customer compute existed and remain public
    // scheduling metadata — the app wizard needs them before anyone signs in. A customer's own
    // inventory is only ever returned to its owner.
    const auth = await authenticate(ctx, { ...deps, allowMissing: true });
    const owned = auth
      ? (await store.table('servers').find({ user_id: auth.id }, { orderBy: '-created_at' })).rows
      : [];
    const all = (await store.table('servers').find({}, { orderBy: '-created_at' })).rows;
    ctx.json({
      servers: owned.map(publicServer),
      total: owned.length,
      deploymentTargets: all.filter((s) => !s.user_id).map(publicServer),
    });
  });

  dual('post', '/servers', async (ctx) => {
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

  dual('get', '/servers/:id', async (ctx) => {
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

  dual('delete', '/servers/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await ownedServer(store, auth, ctx.params.id);
    await queueAction(auth, server, 'DELETE');
    await store.table('servers').updateById(server.id, { status: 'terminating' });
    ctx.json({ ok: true, status: 'terminating' });
  });

  // ---- customer: power actions -------------------------------------------
  for (const [path, operation] of Object.entries(POWER_ACTIONS)) {
    dual('post', `/servers/:id/${path}`, async (ctx) => {
      const auth = await authenticate(ctx, deps);
      const server = await ownedServer(store, auth, ctx.params.id);
      ctx.code(202).json(await queueAction(auth, server, operation));
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

  dual('post', '/servers/:id/resize', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await ownedServer(store, auth, ctx.params.id);
    const body = await ctx.validate(v.object({ targetPlanId: v.string().min(1) }));
    const result = await queueAction(auth, server, 'RESIZE', { targetPlanId: body.targetPlanId });
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
    const result = await queueAction(auth, server, 'SNAPSHOT_CREATE', { description: body.description ?? null });
    ctx.code(202).json(result);
  });

  router.delete('/api/v1/servers/:id/snapshots/:snapshotId', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await ownedServer(store, auth, ctx.params.id);
    const result = await queueAction(auth, server, 'SNAPSHOT_DELETE', { snapshotId: ctx.params.snapshotId });
    ctx.code(202).json(result);
  });

  router.post('/api/v1/servers/:id/snapshots/:snapshotId/restore', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await ownedServer(store, auth, ctx.params.id);
    const result = await queueAction(auth, server, 'SNAPSHOT_RESTORE', { snapshotId: ctx.params.snapshotId });
    ctx.code(202).json(result);
  });

  // ---- customer: reinstall / rebuild --------------------------------------
  dual('post', '/servers/:id/reinstall', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await ownedServer(store, auth, ctx.params.id);
    const body = await ctx.validate(v.object({ osId: v.string().optional() }));
    ctx.code(202).json(await queueAction(auth, server, 'REINSTALL', { osId: body.osId ?? server.os_id }));
  });

  dual('post', '/servers/:id/rebuild', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await ownedServer(store, auth, ctx.params.id);
    ctx.code(202).json(await queueAction(auth, server, 'REBUILD'));
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
  /**
   * A live console session from the provider that owns the machine.
   *
   * This used to hand back a random token and a placeholder provider name, which meant the platform
   * recorded a console being opened for a session that never existed and the customer's panel
   * rendered a login it could not complete. It now asks the provider. An adapter that documents no
   * console refuses before any network call, and that refusal *is* the answer: a button that cannot
   * work should never have been offered in the first place.
   *
   * The session is the customer's own credential to their own machine, so it is returned to them and
   * never logged — the audit row records that a session was issued and of what kind, and nothing that
   * could be replayed. The EC2 session carries a private key that exists nowhere else, and Hetzner's
   * carries a one-time password.
   */
  router.post('/api/v1/servers/:id/console', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await ownedServer(store, auth, ctx.params.id);
    const { provider, providerServerId, description, reason } = await resolveServerProvider(store, server, config);
    if (!provider) throw new ValidationError(reason);
    // Gated on the documented capability before any call, so the refusal names the provider and the
    // capability instead of arriving as a generic "not supported" from the adapter boundary.
    assertCapabilitySupported(provider, config, 'console');
    const session = normalizeConsoleSession(
      await callProvider(provider, { config, logger }, 'getConsole', providerServerId),
    );
    await store.table('audit_logs').insert({
      id: uuidv7(), actor_id: auth.id, actor_role: auth.role,
      action: 'server.console_opened', entity_type: 'server', entity_id: server.id,
      ip_address: ctx.ip, user_agent: ctx.userAgent,
      after: { adapter: description.adapter, ...consoleSessionEvidence(session) },
    });
    ctx.json({ serverId: server.id, provider: description.adapter, console: session });
  });

  /**
   * Rescue mode. The status is written *after* the job is accepted, not before: a refused action
   * used to leave the server row saying `rescue` when nothing had been asked of any provider.
   */
  router.post('/api/v1/servers/:id/rescue', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await ownedServer(store, auth, ctx.params.id);
    const result = await queueAction(auth, server, 'RESCUE_ENABLE');
    await store.table('servers').updateById(server.id, { status: 'rescue' });
    ctx.code(202).json(result);
  });

  router.delete('/api/v1/servers/:id/rescue', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await ownedServer(store, auth, ctx.params.id);
    const result = await queueAction(auth, server, 'RESCUE_DISABLE');
    await store.table('servers').updateById(server.id, { status: 'active' });
    ctx.code(202).json(result);
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

  dual('get', '/ssh-keys', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { rows } = await store.table('ssh_keys').find({ user_id: auth.id }, { orderBy: '-created_at' });
    ctx.json({ keys: rows.map((k) => ({ id: k.id, name: k.name, fingerprint: k.fingerprint, createdAt: k.created_at })) });
  });

  dual('post', '/ssh-keys', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(v.object({ name: v.string().trim().min(1).max(120), publicKey: v.string().min(1).max(8192) }));
    const fingerprint = crypto.createHash('sha256').update(body.publicKey).digest('hex').slice(0, 47);
    const key = await store.table('ssh_keys').insert({ id: uuidv7(), user_id: auth.id, name: body.name, public_key: body.publicKey, fingerprint });
    ctx.code(201).json({ key: { id: key.id, name: key.name, fingerprint: key.fingerprint } });
  });

  dual('delete', '/ssh-keys/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const key = await store.table('ssh_keys').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!key) throw new NotFoundError('Key not found');
    await store.table('ssh_keys').deleteById(key.id);
    ctx.json({ ok: true });
  });

  // ---- admin --------------------------------------------------------------
  /**
   * Register a platform deployment target (spec §5). The row is owned by nobody — a server with a
   * user_id is a customer's own machine. Agent/WHM secrets are stored write-only; a generated
   * agent secret is shown exactly once, here, and never returned again.
   */
  router.post('/api/v1/admin/servers', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const input = await ctx.validate(v.object({
      name: v.string().trim().min(1).max(255),
      hostname: v.string().trim().min(1).max(255),
      ipAddress: v.string().trim().max(64).nullable().optional(),
      serverType: v.enum(['VPS', 'DEDICATED', 'CPANEL', 'KUBERNETES', 'SHARED']),
      provider: v.string().trim().max(64).nullable().optional(),
      region: v.string().trim().max(64).nullable().optional(),
      cpuCores: v.coerce.number().int().min(1).max(1024),
      memoryMb: v.coerce.number().int().min(256).max(4_194_304),
      storageMb: v.coerce.number().int().min(1024).max(67_108_864),
      dockerEnabled: v.boolean().default(false),
      kubernetesEnabled: v.boolean().default(false),
      cpanelEnabled: v.boolean().default(false),
      agentUrl: v.string().url().optional(),
      whmUrl: v.string().url().optional(),
      whmUser: v.string().trim().max(64).optional(),
      agentSecret: v.string().min(24).max(512).optional(),
      whmApiToken: v.string().min(16).max(512).optional(),
    }));

    const metadata = {};
    if (input.agentUrl) metadata.agent_url = input.agentUrl;
    if (input.whmUrl) metadata.whm_url = input.whmUrl;
    if (input.whmUser) metadata.whm_user = input.whmUser;

    const agentId = (input.agentUrl || input.agentSecret)
      ? `agent-${crypto.randomBytes(4).toString('hex')}`
      : null;

    const server = await store.table('servers').insert({
      id: uuidv7(),
      user_id: null,
      name: input.name,
      hostname: input.hostname,
      ip_address: input.ipAddress ?? null,
      server_type: input.serverType,
      provider: input.provider ?? null,
      region: input.region ?? null,
      cpu_cores: input.cpuCores,
      memory_mb: input.memoryMb,
      storage_mb: input.storageMb,
      docker_enabled: input.dockerEnabled,
      kubernetes_enabled: input.kubernetesEnabled,
      cpanel_enabled: input.cpanelEnabled,
      agent_id: agentId,
      panel: input.cpanelEnabled ? 'cpanel' : null,
      status: 'active',
      metadata,
    });

    // Register the agent identity and secrets. Anything the caller supplied is stored as-is; when
    // only an agent URL was given, a secret is generated and returned once so the agent can be
    // configured — after this response it is unreadable.
    let agentSecret = null;
    if (input.agentSecret) {
      await store.table('server_credentials').insert({
        id: uuidv7(), server_id: server.id, kind: 'agent_secret', secret: input.agentSecret,
      });
    } else if (agentId) {
      agentSecret = crypto.randomBytes(32).toString('base64url');
      await store.table('server_credentials').insert({
        id: uuidv7(), server_id: server.id, kind: 'agent_secret', secret: agentSecret,
      });
    }
    if (input.whmApiToken) {
      await store.table('server_credentials').insert({
        id: uuidv7(), server_id: server.id, kind: 'whm_api_token', secret: input.whmApiToken,
      });
    }

    await store.table('audit_logs').insert({
      id: uuidv7(), actor_id: auth.id, actor_role: auth.role,
      action: 'server.registered', entity_type: 'server', entity_id: server.id,
      ip_address: ctx.ip, user_agent: ctx.userAgent,
      after: { name: server.name, serverType: input.serverType, agentId },
    });

    ctx.code(201).json({
      server: { ...publicServer(server), userId: null },
      ...(agentId ? { agentId } : {}),
      ...(agentSecret ? { agentSecret } : {}),
    });
  });

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
