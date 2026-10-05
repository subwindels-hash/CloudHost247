/**
 * Free tools — a catalogue of small utilities (formatters, encoders, checkers) plus history,
 * favorites, saved reports and uptime monitors.
 *
 * Ported from cloudhost247-node/src/tools/routes.ts. Tool execution is deterministic and local
 * (no external calls); speed-test endpoints return synthetic figures and say so.
 */
'use strict';

const crypto = require('node:crypto');
const { v } = require('../core/validate');
const { NotFoundError, ValidationError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { authenticate } = require('../lib/auth');

const name = 'tools';

const CATALOG = [
  { slug: 'json-format', name: 'JSON Formatter', category: 'developers', description: 'Pretty-print or minify JSON.' },
  { slug: 'base64', name: 'Base64 Encode/Decode', category: 'developers', description: 'Encode or decode Base64.' },
  { slug: 'hash', name: 'Hash Generator', category: 'developers', description: 'SHA-256/SHA-1/MD5 of a string.' },
  { slug: 'uuid', name: 'UUID Generator', category: 'developers', description: 'Generate UUIDv7 identifiers.' },
  { slug: 'password', name: 'Password Generator', category: 'security', description: 'Generate a strong password.' },
  { slug: 'dns-lookup', name: 'DNS Lookup', category: 'network', description: 'Resolve DNS records (estimate).' },
];
const BY_SLUG = new Map(CATALOG.map((t) => [t.slug, t]));

function runTool(slug, input) {
  const text = String(input.text ?? '');
  switch (slug) {
    case 'json-format': {
      try { return { result: JSON.stringify(JSON.parse(text), null, input.minify ? 0 : 2) }; }
      catch { throw new ValidationError('Input is not valid JSON'); }
    }
    case 'base64':
      return input.decode
        ? { result: Buffer.from(text, 'base64').toString('utf8') }
        : { result: Buffer.from(text, 'utf8').toString('base64') };
    case 'hash': {
      const algo = String(input.algorithm || 'sha256').toLowerCase();
      if (!['sha256', 'sha1', 'md5'].includes(algo)) throw new ValidationError('Unsupported algorithm');
      return { result: crypto.createHash(algo).update(text).digest('hex') };
    }
    case 'uuid':
      return { result: Array.from({ length: Math.min(50, input.count || 1) }, () => uuidv7()) };
    case 'password': {
      const len = Math.min(128, Math.max(8, input.length || 20));
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';
      let out = '';
      const bytes = crypto.randomBytes(len);
      for (let i = 0; i < len; i += 1) out += chars[bytes[i] % chars.length];
      return { result: out };
    }
    case 'dns-lookup':
      // No resolver here — be honest that this is a placeholder, not a real lookup.
      return { result: null, estimate: true, note: 'Live DNS resolution requires a resolver connector (deferred).' };
    default:
      throw new NotFoundError('Unknown tool');
  }
}

function register(router, deps) {
  const { store } = deps;

  router.get('/api/v1/tools/catalog', async (ctx) => {
    ctx.json({ tools: CATALOG });
  });

  router.get('/api/v1/tools/dashboard', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const history = await store.table('tools_history').all();
    const mine = history.filter((h) => h.user_id === auth.id);
    ctx.json({ totalRuns: mine.length, tools: CATALOG.length });
  });

  // ---- speed test (synthetic) --------------------------------------------
  router.get('/api/v1/tools/speed-test/config', async (ctx) => {
    ctx.json({ synthetic: true, note: 'No measurement server configured; figures are illustrative.' });
  });
  router.get('/api/v1/tools/speed-test/latency', async (ctx) => {
    ctx.json({ synthetic: true, latencyMs: 0, jitterMs: 0 });
  });
  router.get('/api/v1/tools/speed-test/download', async (ctx) => {
    ctx.json({ synthetic: true, mbps: 0 });
  });
  router.post('/api/v1/tools/speed-test/upload', async (ctx) => {
    ctx.json({ synthetic: true, mbps: 0 });
  });

  // ---- run a tool ---------------------------------------------------------
  router.post('/api/v1/tools/:slug', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const tool = BY_SLUG.get(ctx.params.slug);
    if (!tool) throw new NotFoundError('Unknown tool');
    const body = await ctx.validate(v.object({}).passthrough());
    const out = runTool(ctx.params.slug, body);

    await store.table('tools_history').insert({
      id: uuidv7(), user_id: auth.id, tool_slug: tool.slug, input: body, output: out,
    });
    ctx.json({ tool: tool.slug, ...out });
  });

  router.get('/api/v1/tools/:slug', async (ctx) => {
    const tool = BY_SLUG.get(ctx.params.slug);
    if (!tool) throw new NotFoundError('Unknown tool');
    ctx.json({ tool });
  });

  router.post('/api/v1/tools/:slug/explain', async (ctx) => {
    const tool = BY_SLUG.get(ctx.params.slug);
    if (!tool) throw new NotFoundError('Unknown tool');
    ctx.json({ tool: tool.slug, explanation: tool.description });
  });

  router.post('/api/v1/tools/:slug/report', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const tool = BY_SLUG.get(ctx.params.slug);
    if (!tool) throw new NotFoundError('Unknown tool');
    const body = await ctx.validate(v.object({ title: v.string().trim().min(1).max(200), content: v.string().trim().max(8000).default('') }));
    const report = await store.table('tools_reports').insert({
      id: uuidv7(), user_id: auth.id, tool_slug: tool.slug, title: body.title, content: body.content,
    });
    ctx.code(201).json({ report: { id: report.id, title: report.title } });
  });

  router.post('/api/v1/tools/:slug/ticket', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const tool = BY_SLUG.get(ctx.params.slug);
    if (!tool) throw new NotFoundError('Unknown tool');
    const body = await ctx.validate(v.object({ subject: v.string().trim().min(1).max(200), message: v.string().trim().min(1).max(4000) }));
    const ticket = await store.table('support_tickets').insert({
      id: uuidv7(), user_id: auth.id, subject: `[${tool.name}] ${body.subject}`, status: 'open', priority: 'normal',
    });
    await store.table('support_ticket_messages').insert({
      id: uuidv7(), ticket_id: ticket.id, author_id: auth.id, author_role: auth.role, body: body.message,
    });
    ctx.code(201).json({ ticketId: ticket.id });
  });

  // ---- history ------------------------------------------------------------
  router.get('/api/v1/tools/history', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { rows } = await store.table('tools_history').find({ user_id: auth.id }, { orderBy: '-created_at', limit: 100 });
    ctx.json({ history: rows.map((h) => ({ id: h.id, toolSlug: h.tool_slug, createdAt: h.created_at })) });
  });
  router.delete('/api/v1/tools/history', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const rows = await store.table('tools_history').all();
    for (const r of rows) if (r.user_id === auth.id) await store.table('tools_history').deleteById(r.id);
    ctx.json({ ok: true });
  });
  router.delete('/api/v1/tools/history/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const row = await store.table('tools_history').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!row) throw new NotFoundError('History entry not found');
    await store.table('tools_history').deleteById(row.id);
    ctx.json({ ok: true });
  });

  // ---- favorites ----------------------------------------------------------
  router.get('/api/v1/tools/favorites', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { rows } = await store.table('tools_favorites').find({ user_id: auth.id });
    ctx.json({ favorites: rows.map((f) => f.tool_slug) });
  });
  router.post('/api/v1/tools/favorites', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(v.object({ slug: v.string().min(1) }));
    if (!BY_SLUG.has(body.slug)) throw new NotFoundError('Unknown tool');
    const existing = await store.table('tools_favorites').findOne({ user_id: auth.id, tool_slug: body.slug });
    if (existing) return ctx.json({ idempotent: true });
    await store.table('tools_favorites').insert({ id: uuidv7(), user_id: auth.id, tool_slug: body.slug });
    ctx.code(201).json({ ok: true });
  });
  router.delete('/api/v1/tools/favorites/:slug', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const row = await store.table('tools_favorites').findOne({ user_id: auth.id, tool_slug: ctx.params.slug });
    if (!row) throw new NotFoundError('Favorite not found');
    await store.table('tools_favorites').deleteById(row.id);
    ctx.json({ ok: true });
  });

  // ---- reports ------------------------------------------------------------
  router.get('/api/v1/tools/reports', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { rows } = await store.table('tools_reports').find({ user_id: auth.id }, { orderBy: '-created_at' });
    ctx.json({ reports: rows.map((r) => ({ id: r.id, toolSlug: r.tool_slug, title: r.title, createdAt: r.created_at })) });
  });
  router.post('/api/v1/tools/reports', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(v.object({ toolSlug: v.string().min(1), title: v.string().trim().min(1).max(200), content: v.string().trim().max(8000).default('') }));
    const report = await store.table('tools_reports').insert({ id: uuidv7(), user_id: auth.id, tool_slug: body.toolSlug, title: body.title, content: body.content });
    ctx.code(201).json({ report: { id: report.id, title: report.title } });
  });
  router.get('/api/v1/tools/reports/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const report = await store.table('tools_reports').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!report) throw new NotFoundError('Report not found');
    ctx.json({ report });
  });
  router.get('/api/v1/tools/reports/:id/export', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const report = await store.table('tools_reports').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!report) throw new NotFoundError('Report not found');
    ctx.header('content-type', 'text/plain; charset=utf-8');
    ctx.text(`# ${report.title}\n\nTool: ${report.tool_slug}\nCreated: ${report.created_at}\n\n${report.content}\n`);
  });
  router.delete('/api/v1/tools/reports/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const report = await store.table('tools_reports').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!report) throw new NotFoundError('Report not found');
    await store.table('tools_reports').deleteById(report.id);
    ctx.json({ ok: true });
  });

  // ---- monitors -----------------------------------------------------------
  router.get('/api/v1/tools/monitors', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { rows } = await store.table('tools_monitors').find({ user_id: auth.id }, { orderBy: '-created_at' });
    ctx.json({ monitors: rows.map((m) => ({ id: m.id, url: m.url, intervalSeconds: m.interval_seconds, status: m.status, lastCheckedAt: m.last_checked_at })) });
  });
  router.post('/api/v1/tools/monitors', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(v.object({ url: v.string().url(), intervalSeconds: v.coerce.number().int().min(30).max(86400).default(300) }));
    const monitor = await store.table('tools_monitors').insert({ id: uuidv7(), user_id: auth.id, url: body.url, interval_seconds: body.intervalSeconds, status: 'active' });
    ctx.code(201).json({ monitor: { id: monitor.id, url: monitor.url } });
  });
  router.patch('/api/v1/tools/monitors/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const monitor = await store.table('tools_monitors').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!monitor) throw new NotFoundError('Monitor not found');
    const body = await ctx.validate(v.object({ status: v.enum(['active', 'paused']).optional(), intervalSeconds: v.coerce.number().int().min(30).max(86400).optional() }));
    const patch = {};
    if (body.status) patch.status = body.status;
    if (body.intervalSeconds) patch.interval_seconds = body.intervalSeconds;
    const updated = await store.table('tools_monitors').updateById(monitor.id, patch);
    ctx.json({ monitor: { id: updated.id, status: updated.status, intervalSeconds: updated.interval_seconds } });
  });
  router.delete('/api/v1/tools/monitors/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const monitor = await store.table('tools_monitors').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!monitor) throw new NotFoundError('Monitor not found');
    await store.table('tools_monitors').deleteById(monitor.id);
    ctx.json({ ok: true });
  });
  router.post('/api/v1/tools/monitors/:id/check', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const monitor = await store.table('tools_monitors').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!monitor) throw new NotFoundError('Monitor not found');
    // No outbound HTTP from the monitor here; record the check time and report synthetic status.
    const updated = await store.table('tools_monitors').updateById(monitor.id, { last_checked_at: new Date().toISOString() });
    ctx.json({ synthetic: true, status: 'unknown', lastCheckedAt: updated.last_checked_at, note: 'Live HTTP checks require an egress connector (deferred).' });
  });
}

module.exports = { name, register };
