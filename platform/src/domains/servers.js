/**
 * Customer servers (VPS/dedicated instances).
 *
 * Ported from cloudhost247-node/src/routes/servers.ts. Customers manage their own servers and
 * credentials; admins see all. Operating systems are a read-only reference list. Server lifecycle
 * (boot/stop) is an infrastructure-adapter concern that is deferred, so status is stored, not
 * driven from a hypervisor here.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { authenticate, asAdmin } = require('../lib/auth');

const name = 'servers';

function publicServer(row) {
  return {
    id: row.id, name: row.name, hostname: row.hostname, ip: row.ip,
    planId: row.plan_id, status: row.status, regionId: row.region_id, osId: row.os_id,
    createdAt: row.created_at,
  };
}

function register(router, deps) {
  const { store } = deps;

  router.get('/api/v1/operating-systems', async (ctx) => {
    const rows = await store.table('operating_systems').all();
    ctx.json({ operatingSystems: rows.map((o) => ({ id: o.id, name: o.name, slug: o.slug, family: o.family, active: o.active })) });
  });

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
      id: uuidv7(), user_id: auth.id, name: body.name,
      hostname: body.hostname ?? null, plan_id: body.planId ?? null,
      region_id: body.regionId ?? null, os_id: body.osId ?? null,
      status: 'provisioning',
    });
    ctx.code(201).json({ server: publicServer(server) });
  });

  router.get('/api/v1/servers/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await store.table('servers').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!server) throw new NotFoundError('Server not found');
    ctx.json({ server: publicServer(server) });
  });

  router.patch('/api/v1/servers/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await store.table('servers').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!server) throw new NotFoundError('Server not found');

    const body = await ctx.validate(v.object({ name: v.string().trim().min(1).max(120) }));
    const updated = await store.table('servers').updateById(server.id, { name: body.name });
    ctx.json({ server: publicServer(updated) });
  });

  router.delete('/api/v1/servers/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await store.table('servers').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!server) throw new NotFoundError('Server not found');
    await store.table('servers').deleteById(server.id);
    ctx.json({ ok: true });
  });

  // ---- server credentials (passwords/keys) --------------------------------
  router.get('/api/v1/servers/:id/credentials', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await store.table('servers').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!server) throw new NotFoundError('Server not found');
    const { rows } = await store.table('server_credentials').find({ server_id: server.id });
    // Never return the secret back.
    ctx.json({ credentials: rows.map((c) => ({ id: c.id, kind: c.kind, username: c.username, createdAt: c.created_at })) });
  });

  router.post('/api/v1/servers/:id/credentials', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await store.table('servers').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!server) throw new NotFoundError('Server not found');
    const body = await ctx.validate(v.object({
      kind: v.enum(['password', 'ssh_key']).default('password'),
      username: v.string().trim().min(1).max(64),
      secret: v.string().min(1).max(4096),
    }));
    const cred = await store.table('server_credentials').insert({
      id: uuidv7(), server_id: server.id, kind: body.kind, username: body.username, secret: body.secret,
    });
    ctx.code(201).json({ credential: { id: cred.id, kind: cred.kind, username: cred.username } });
  });

  router.delete('/api/v1/servers/:id/credentials/:credId', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await store.table('servers').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!server) throw new NotFoundError('Server not found');
    await store.table('server_credentials').deleteById(ctx.params.credId);
    ctx.json({ ok: true });
  });

  // ---- ssh keys -----------------------------------------------------------
  router.get('/api/v1/ssh-keys', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { rows } = await store.table('ssh_keys').find({ user_id: auth.id }, { orderBy: '-created_at' });
    ctx.json({ keys: rows.map((k) => ({ id: k.id, name: k.name, fingerprint: k.fingerprint, createdAt: k.created_at })) });
  });

  router.post('/api/v1/ssh-keys', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(v.object({ name: v.string().trim().min(1).max(120), publicKey: v.string().min(1).max(8192) }));
    const crypto = require('node:crypto');
    const fingerprint = crypto.createHash('sha256').update(body.publicKey).digest('hex').slice(0, 47);
    const key = await store.table('ssh_keys').insert({
      id: uuidv7(), user_id: auth.id, name: body.name, public_key: body.publicKey, fingerprint,
    });
    ctx.code(201).json({ key: { id: key.id, name: key.name, fingerprint: key.fingerprint } });
  });

  router.delete('/api/v1/ssh-keys/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const key = await store.table('ssh_keys').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!key) throw new NotFoundError('Key not found');
    await store.table('ssh_keys').deleteById(key.id);
    ctx.json({ ok: true });
  });

  // ---- admin: all servers -------------------------------------------------
  router.get('/api/v1/admin/servers', async (ctx) => {
    await asAdmin(ctx, deps);
    const { rows, total } = await store.table('servers').find({}, { orderBy: '-created_at', limit: 200 });
    ctx.json({ servers: rows.map((s) => ({ ...publicServer(s), userId: s.user_id })), total });
  });
}

module.exports = { name, register };
