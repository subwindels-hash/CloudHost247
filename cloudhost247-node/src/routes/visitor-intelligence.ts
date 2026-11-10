import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isIP } from 'node:net';
import { z } from 'zod';
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import { withTransaction } from '../db/transaction';
import { getPool } from '../db/pool';
import { authenticate } from '../lib/require-auth';
import { requireRole } from '../lib/require-role';
import { auditRequest } from '../lib/audit';
import { ValidationError } from '../lib/errors';
import { assertConsentRequest, CONSENT_COOKIE, cookieValue, requestConsent } from '../marketing/consent-service';
import { analyticsConsentGranted } from '../marketing/ga4-checkout-context';
import { resolveVisitorIpFromRequest } from './visitor-ip';
import { classifyClient, isAutomatedAgent, resolveApproximateGeo } from '../visitor-intelligence/geo';
import {
  getCities,
  getCountries,
  getCountryDetail,
  getDimensionStats,
  getMapData,
  getOnlineVisitors,
  getOverview,
  getReferrerStats,
  getTimeseries,
  getTopPages,
  getVisitorSettings,
  getVisitorsForStream,
  recordVisitorHeartbeat,
  recordVisitorPageview,
  resolveDateWindow,
  updateVisitorSettings,
  type DateWindow,
  type VisitorIdentityInput,
} from '../visitor-intelligence/service';

const BASE = '/api/v1/visitor-intelligence';
const ADMIN = '/api/v1/admin/visitor-intelligence';
const STAFF_ROLES = ['admin', 'super_admin'] as const;

const uuid = z.string().uuid();
const identitySchema = z.object({
  visitorId: uuid,
  sessionId: uuid,
  tabId: uuid,
  pagePath: z.string().min(1).max(2048),
  referrerHost: z.string().max(255).nullable().optional(),
}).strict();
const pageviewSchema = identitySchema;
const heartbeatSchema = identitySchema.extend({ active: z.boolean() }).strict();
const dateQuerySchema = z.object({
  range: z.enum(['live', 'today', 'yesterday', '7d', '30d', 'custom']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
}).strict();

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError(result.error.issues.map((issue) => issue.message).join(', '));
  return result.data;
}

const EXCLUDED_PAGE_ROUTE_ROOTS = new Set(['admin', 'api', 'health', 'ready']);

/** Decode ASCII path syntax for route-exclusion checks, even when the segment has malformed trailing data. */
function canonicalRoutePath(input: string): string {
  let path = input;
  for (let depth = 0; depth < 5; depth += 1) {
    const next = path.replace(/%([0-9a-f]{2})/gi, (encoded, hex: string) => {
      const byte = Number.parseInt(hex, 16);
      return byte < 0x80 ? String.fromCharCode(byte) : encoded;
    });
    if (next === path) break;
    path = next;
  }
  return path.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
}

function assertCollectablePageRoute(raw: string): void {
  const routePath = canonicalRoutePath(raw).split(/[?#]/, 1)[0] ?? '';
  const routeSegments = routePath.split('/');
  if (routeSegments.some((segment) => segment === '.' || segment === '..')) {
    throw new ValidationError('Page paths cannot contain dot segments');
  }
  const root = routeSegments[1] ?? '';
  // More than five layers of ASCII percent-encoding are ambiguous; fail closed rather than let
  // an encoded route root such as %2561dmin fall through to the anonymous :id replacement.
  if (/%[0-7][0-9a-f]/i.test(root)) {
    throw new ValidationError('This route is not collected by Visitor Intelligence');
  }
  const routeRoot = root.split(/[&=;%]/, 1)[0]?.toLowerCase() ?? '';
  if (EXCLUDED_PAGE_ROUTE_ROOTS.has(routeRoot)) {
    throw new ValidationError('This route is not collected by Visitor Intelligence');
  }
}

/** Strip queries/fragments and replace likely identifiers embedded in URL path segments. */
export function sanitizePagePath(input: string): string {
  const raw = input.split(/[?#]/, 1)[0] ?? '';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.length > 2048) {
    throw new ValidationError('Page path must be an origin-relative website path');
  }
  assertCollectablePageRoute(raw);
  const segments = raw.split('/');
  const canonical: string[] = [];
  const safe = segments.map((segment, index) => {
    if (index === 0 || segment === '') {
      return '';
    }
    let decoded = segment;
    try {
      // Decode repeatedly so double-encoded delimiters cannot evade the privacy checks below.
      // Any still-encoded octet after this bounded pass is treated as opaque and redacted.
      for (let depth = 0; depth < 5; depth += 1) {
        const next = decodeURIComponent(decoded);
        if (next === decoded) break;
        decoded = next;
      }
    } catch {
      canonical.push(':id');
      return ':id';
    }
    if (/%[0-9a-f]{2}/i.test(decoded)) {
      canonical.push(':id');
      return ':id';
    }
    if (decoded === '.' || decoded === '..') {
      throw new ValidationError('Page paths cannot contain dot segments');
    }
    const hostnameLike = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(decoded);
    const hasControlCharacter = /[\u0000-\u001f\u007f]/u.test(decoded);
    // Encoded query/hash delimiters and key/value separators are data, not route names. Redact the
    // entire segment so tokens or other query-like values cannot survive in the stored path.
    if (decoded.includes('/') || decoded.includes('\\') || decoded.includes('?') || decoded.includes('#') ||
        decoded.includes('&') || decoded.includes('=') || hasControlCharacter || decoded.includes('@') ||
        decoded.length > 96 || isIP(decoded) || hostnameLike) {
      canonical.push(':id');
      return ':id';
    }
    if (/^(?:\d+|[0-9a-f]{8}-[0-9a-f-]{27,}|[0-9a-f]{24}|[A-Za-z0-9_-]{24,}|(?:cus|customer|client|user|usr|invoice|inv|order|ord|ticket|service|srv|server|subscription|sub|account|acct|session|sess|site|project|conversation|conv|id)_[A-Za-z0-9_-]{6,})$/i.test(decoded)) {
      canonical.push(':id');
      return ':id';
    }
    if (!/^[\p{L}\p{N}._~!$&'()+,;=:@%-]+$/u.test(segment)) {
      canonical.push(':id');
      return ':id';
    }
    canonical.push(decoded);
    return segment;
  });
  let path = safe.join('/').replace(/\/{2,}/g, '/');
  if (path.length > 512) {
    path = path.slice(0, 512);
    const lastEscape = path.lastIndexOf('%');
    if (lastEscape >= path.length - 2) path = path.slice(0, lastEscape);
  }
  path ||= '/';
  const canonicalPath = canonical.join('/').replace(/\/{2,}/g, '/');
  if (canonicalPath === '/admin' || canonicalPath.startsWith('/admin/') || canonicalPath === '/api' || canonicalPath.startsWith('/api/') ||
      canonicalPath === '/health' || canonicalPath.startsWith('/health/') || canonicalPath === '/ready' || canonicalPath.startsWith('/ready/')) {
    throw new ValidationError('This route is not collected by Visitor Intelligence');
  }
  return path;
}
const TWO_PART_PUBLIC_SUFFIXES = new Set([
  'ac.uk', 'co.uk', 'gov.uk', 'net.uk', 'org.uk', 'com.au', 'edu.au', 'gov.au', 'net.au', 'org.au',
  'co.nz', 'net.nz', 'org.nz', 'com.ng', 'edu.ng', 'gov.ng', 'net.ng', 'org.ng', 'com.za', 'net.za', 'org.za',
  'com.br', 'com.cn', 'com.hk', 'com.mx', 'com.my', 'com.ph', 'com.pk', 'com.sg', 'com.tr', 'com.tw', 'com.vn',
  'co.in', 'firm.in', 'net.in', 'org.in', 'co.jp', 'ne.jp', 'or.jp', 'co.kr', 'or.kr', 'co.id', 'or.id',
]);

function reportableHost(host: string) {
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  const suffix = labels.slice(-2).join('.');
  return labels.slice(-(TWO_PART_PUBLIC_SUFFIXES.has(suffix) ? 3 : 2)).join('.');
}

/** Accept only a coarse hostname; never persist a referring URL, subdomain identifier, query, fragment or credentials. */
export function sanitizeReferrerHost(input: unknown, requestHost?: string): string | null {
  if (typeof input !== 'string' || !input.trim() || input.length > 1024) return null;
  let parsed: URL;
  try {
    parsed = new URL(input.includes('://') ? input : `https://${input}`);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  const addressHost = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (!host || isIP(addressHost) || host.length > 253 || !/^[a-z0-9.-]+$/.test(host) || host.includes('..')) return null;
  const reportedHost = reportableHost(host);
  const currentHost = reportableHost((requestHost ?? '').toLowerCase().split(':')[0]?.replace(/^www\./, '') ?? '');
  if (reportedHost === currentHost || reportedHost.replace(/^www\./, '') === currentHost) return null;
  return reportedHost;
}

function parseIdentity(raw: unknown, request: FastifyRequest): VisitorIdentityInput {
  const value = parseOrThrow(identitySchema, raw);
  return {
    visitorId: value.visitorId,
    sessionId: value.sessionId,
    tabId: value.tabId,
    pagePath: sanitizePagePath(value.pagePath),
    referrerHost: sanitizeReferrerHost(value.referrerHost, request.hostname),
  };
}

function parseWindow(request: FastifyRequest): DateWindow {
  const query = parseOrThrow(dateQuerySchema, request.query);
  try {
    return resolveDateWindow(query);
  } catch (error) {
    throw new ValidationError(error instanceof Error ? error.message : 'Invalid date range');
  }
}

function privateResponse(reply: FastifyReply) {
  reply.header('Cache-Control', 'private, no-store, max-age=0');
  reply.header('Pragma', 'no-cache');
  reply.header('X-Content-Type-Options', 'nosniff');
}

/** Record report access using only the report surface/range, never visitor identifiers or results. */
async function auditVisitorRead(
  db: Queryable,
  request: FastifyRequest,
  actorId: string,
  surface: string,
  metadata: Record<string, unknown> = {}
) {
  const settingsRead = surface === 'settings';
  await auditRequest(db, request, actorId, {
    action: settingsRead ? 'visitor_intelligence.settings_viewed' : 'visitor_intelligence.report_read',
    resourceType: settingsRead ? 'visitor_intelligence_settings' : 'visitor_intelligence_report',
    resourceId: surface,
    metadata: { surface, ...metadata },
  });
}

async function auditVisitorStream(db: Queryable, request: FastifyRequest, actorId: string) {
  await auditRequest(db, request, actorId, {
    action: 'visitor_intelligence.stream_opened',
    resourceType: 'visitor_intelligence_stream',
    resourceId: 'live_presence',
    metadata: { surface: 'live_presence' },
  });
}

async function staffOrBot(request: FastifyRequest, env: Env, pool: Queryable): Promise<boolean> {
  if (isAutomatedAgent(request.headers['user-agent'])) return true;
  const authorization = request.headers.authorization;
  if (typeof authorization !== 'string') return false;
  // If a bearer credential is present but invalid/stale, fail closed for analytics without changing
  // the visitor-facing page. For a valid customer token, use it only to distinguish staff; no user
  // id, account id, email or token is passed to the analytics service.
  try {
    const auth = await authenticate(request, env, pool);
    const user = (await pool.query<{ role: string }>('SELECT role FROM users WHERE id=$1 AND status=\'active\'', [auth.userId])).rows[0];
    return !user || ['staff', 'admin', 'super_admin'].includes(user.role);
  } catch {
    return true;
  }
}

async function ingestContext(request: FastifyRequest, env: Env, pool: Queryable) {
  const settings = await getVisitorSettings(pool);
  if (!settings.enabled || await staffOrBot(request, env, pool)) return null;
  const consent = await requestConsent(pool, request);
  if (!analyticsConsentGranted(consent)) return null;
  const consentToken = cookieValue(request, CONSENT_COOKIE);
  if (!consentToken) return null;
  // Pageview and heartbeat writes are consent-bound POSTs: validate the same-origin boundary and
  // the HMAC-backed CSRF token exposed by the existing preference runtime before accepting them.
  assertConsentRequest(request, consentToken, env);
  // Resolve only from the existing verified proxy boundary. The raw address is a transient local
  // variable and is discarded immediately after this in-process GeoIP lookup.
  const ip = resolveVisitorIpFromRequest(request, env).ip;
  const geo = resolveApproximateGeo(ip);
  const client = classifyClient(request.headers['user-agent']);
  return { consentSessionId: consent!.id, geo, client };
}

async function registerPublicRoutes(app: FastifyInstance, env: Env, pool: Queryable) {
  app.get(`${BASE}/status`, { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (_request, reply) => {
    privateResponse(reply);
    const settings = await getVisitorSettings(pool);
    return {
      enabled: settings.enabled,
      heartbeatSeconds: 30,
      idleAfterSeconds: settings.idleAfterSeconds,
      onlineTimeoutSeconds: settings.onlineTimeoutSeconds,
    };
  });

  app.post(`${BASE}/pageview`, { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    privateResponse(reply);
    let input: VisitorIdentityInput;
    try { input = parseIdentity(request.body, request); }
    catch (error) {
      // Common route exclusions (admin/health paths) are quiet no-ops. Malformed external input
      // remains a 400 so clients can diagnose their integration without storing anything.
      if (error instanceof ValidationError && /not collected/.test(error.message)) return reply.code(204).send();
      throw error;
    }
    const context = await ingestContext(request, env, pool);
    if (!context) return reply.code(204).send();
    const result = await recordVisitorPageview(pool, input, context);
    if (result === 'session_expired') return reply.code(409).send({ error: 'SESSION_EXPIRED' });
    if (result !== 'recorded') return reply.code(204).send();
    return reply.code(202).send({ accepted: true });
  });

  app.post(`${BASE}/heartbeat`, { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    privateResponse(reply);
    let body: z.infer<typeof heartbeatSchema>;
    try { body = parseOrThrow(heartbeatSchema, request.body); }
    catch (error) { throw error; }
    let input: VisitorIdentityInput;
    const { active: _active, ...identity } = body;
    try { input = parseIdentity(identity, request); }
    catch (error) {
      if (error instanceof ValidationError && /not collected/.test(error.message)) return reply.code(204).send();
      throw error;
    }
    const context = await ingestContext(request, env, pool);
    if (!context) return reply.code(204).send();
    const result = await recordVisitorHeartbeat(pool, input, context, body.active);
    if (result === 'session_expired') return reply.code(409).send({ error: 'SESSION_EXPIRED' });
    return reply.code(204).send();
  });
}

async function registerAdminRoutes(app: FastifyInstance, env: Env, pool: Queryable) {
  const authorize = (request: FastifyRequest) => requireRole(request, env, pool, STAFF_ROLES);

  app.get(`${ADMIN}/overview`, async (request, reply) => {
    const auth = await authorize(request);
    privateResponse(reply);
    const window = parseWindow(request);
    const overview = await getOverview(pool, window);
    await auditVisitorRead(pool, request, auth.userId, 'overview', { range: window.label });
    return overview;
  });

  app.get(`${ADMIN}/online`, async (request, reply) => {
    const auth = await authorize(request);
    privateResponse(reply);
    const settings = await getVisitorSettings(pool);
    const visitors = await getOnlineVisitors(pool, settings);
    const result = { generatedAt: new Date().toISOString(), visitors, count: visitors.length };
    await auditVisitorRead(pool, request, auth.userId, 'online');
    return result;
  });

  app.get(`${ADMIN}/map`, async (request, reply) => {
    const auth = await authorize(request);
    privateResponse(reply);
    const window = parseWindow(request);
    const result = { range: { label: window.label, from: window.from.toISOString(), to: window.to.toISOString() }, ...(await getMapData(pool, window)) };
    await auditVisitorRead(pool, request, auth.userId, 'map', { range: window.label });
    return result;
  });

  app.get(`${ADMIN}/countries`, async (request, reply) => {
    const auth = await authorize(request);
    privateResponse(reply);
    const window = parseWindow(request);
    const result = { countries: (await getCountries(pool, window)).slice(0, 10) };
    await auditVisitorRead(pool, request, auth.userId, 'countries', { range: window.label });
    return result;
  });

  app.get<{ Params: { countryCode: string } }>(`${ADMIN}/countries/:countryCode`, async (request, reply) => {
    const auth = await authorize(request);
    privateResponse(reply);
    const countryCode = z.string().regex(/^[A-Z]{2}$/).safeParse(request.params.countryCode.toUpperCase());
    if (!countryCode.success) throw new ValidationError('Country code must be two letters');
    const window = parseWindow(request);
    const result = await getCountryDetail(pool, window, countryCode.data);
    await auditVisitorRead(pool, request, auth.userId, 'country_detail', { range: window.label });
    return result;
  });

  app.get(`${ADMIN}/cities`, async (request, reply) => {
    const auth = await authorize(request);
    privateResponse(reply);
    const query = z.object({ ...dateQuerySchema.shape, countryCode: z.string().regex(/^[A-Z]{2}$/).optional() }).strict().safeParse(request.query);
    if (!query.success) throw new ValidationError(query.error.issues.map((issue) => issue.message).join(', '));
    const window = resolveWindowOrThrow(query.data);
    const result = { cities: await getCities(pool, window, query.data.countryCode) };
    await auditVisitorRead(pool, request, auth.userId, 'cities', { range: window.label });
    return result;
  });

  app.get(`${ADMIN}/pages`, async (request, reply) => {
    const auth = await authorize(request);
    privateResponse(reply);
    const window = parseWindow(request);
    const result = { pages: await getTopPages(pool, window, 100) };
    await auditVisitorRead(pool, request, auth.userId, 'pages', { range: window.label });
    return result;
  });

  app.get(`${ADMIN}/devices`, async (request, reply) => {
    const auth = await authorize(request);
    privateResponse(reply);
    const window = parseWindow(request);
    const [devices, browsers, operatingSystems] = await Promise.all([
      getDimensionStats(pool, window, 'device_category'),
      getDimensionStats(pool, window, 'browser_family'),
      getDimensionStats(pool, window, 'os_family'),
    ]);
    const result = { devices, browsers, operatingSystems };
    await auditVisitorRead(pool, request, auth.userId, 'devices', { range: window.label });
    return result;
  });

  app.get(`${ADMIN}/referrers`, async (request, reply) => {
    const auth = await authorize(request);
    privateResponse(reply);
    const window = parseWindow(request);
    const result = { referrers: await getReferrerStats(pool, window) };
    await auditVisitorRead(pool, request, auth.userId, 'referrers', { range: window.label });
    return result;
  });

  app.get(`${ADMIN}/timeseries`, async (request, reply) => {
    const auth = await authorize(request);
    privateResponse(reply);
    const window = parseWindow(request);
    const result = { timeseries: await getTimeseries(pool, window) };
    await auditVisitorRead(pool, request, auth.userId, 'timeseries', { range: window.label });
    return result;
  });

  app.get(`${ADMIN}/settings`, async (request, reply) => {
    const auth = await authorize(request);
    privateResponse(reply);
    const settings = await getVisitorSettings(pool);
    await auditVisitorRead(pool, request, auth.userId, 'settings');
    return { settings };
  });

  app.patch(`${ADMIN}/settings`, async (request, reply) => {
    const auth = await authorize(request);
    privateResponse(reply);
    const parsed = z.object({
      enabled: z.boolean().optional(),
      retentionDays: z.number().int().min(7).max(365).optional(),
      idleAfterSeconds: z.number().int().min(60).max(3600).optional(),
      onlineTimeoutSeconds: z.number().int().min(60).max(600).optional(),
    }).strict().refine((value) => Object.keys(value).length > 0, 'Supply at least one setting').safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join(', '));
    const updated = await withTransaction(pool, async (tx) => {
      // Serialize partial patches before reading omitted values; otherwise a stale full-row write
      // could undo another administrator's setting (including a collection disable).
      await tx.query('SELECT id FROM visitor_intelligence_settings WHERE id=1 FOR UPDATE');
      const before = await getVisitorSettings(tx);
      const next = await updateVisitorSettings(tx, auth.userId, {
        enabled: parsed.data.enabled ?? before.enabled,
        retentionDays: parsed.data.retentionDays ?? before.retentionDays,
        idleAfterSeconds: parsed.data.idleAfterSeconds ?? before.idleAfterSeconds,
        onlineTimeoutSeconds: parsed.data.onlineTimeoutSeconds ?? before.onlineTimeoutSeconds,
      });
      const changedFields = Object.keys(parsed.data) as Array<'enabled' | 'retentionDays' | 'idleAfterSeconds' | 'onlineTimeoutSeconds'>;
      const beforeValues = Object.fromEntries(changedFields.map((field) => [field, before[field]]));
      const afterValues = Object.fromEntries(changedFields.map((field) => [field, next[field]]));
      await auditRequest(tx, request, auth.userId, {
        action: 'visitor_intelligence.settings_updated',
        resourceType: 'visitor_intelligence_settings',
        resourceId: '1',
        metadata: { changedFields, before: beforeValues, after: afterValues },
      });
      return next;
    });
    return { settings: updated };
  });

  app.get(`${ADMIN}/stream`, async (request, reply) => {
    const auth = await authorize(request);
    await auditVisitorStream(pool, request, auth.userId);
    privateResponse(reply);
    reply.hijack();
    const response = reply.raw;
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'private, no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      Vary: 'Authorization',
      'X-Content-Type-Options': 'nosniff',
    });
    response.flushHeaders?.();
    response.write('retry: 5000\n\n');
    let closed = false;
    let sending = false;
    const send = async () => {
      if (closed || sending || response.destroyed) return;
      sending = true;
      try {
        const snapshot = await getVisitorsForStream(pool);
        if (!closed && !response.destroyed) response.write(`event: visitor-update\ndata: ${JSON.stringify(snapshot)}\n\n`);
      } catch {
        if (!closed && !response.destroyed) response.write(': visitor snapshot unavailable\n\n');
      } finally { sending = false; }
    };
    const timer = setInterval(() => { void send(); }, 10_000);
    const heartbeat = setInterval(() => { if (!closed && !response.destroyed) response.write(': keep-alive\n\n'); }, 15_000);
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      clearInterval(heartbeat);
      request.raw.off('aborted', cleanup);
      response.off('close', cleanup);
      response.off('error', cleanup);
    };
    request.raw.once('aborted', cleanup);
    response.once('close', cleanup);
    response.once('error', cleanup);
    await send();
  });
}

function resolveWindowOrThrow(input: { range?: string; from?: string; to?: string }): DateWindow {
  try { return resolveDateWindow(input); }
  catch (error) { throw new ValidationError(error instanceof Error ? error.message : 'Invalid date range'); }
}

export async function registerVisitorIntelligenceRoutes(
  app: FastifyInstance,
  env: Env,
  overridePool?: Queryable
) {
  const pool = overridePool ?? getPool(env);
  await registerPublicRoutes(app, env, pool);
  await registerAdminRoutes(app, env, pool);
}
