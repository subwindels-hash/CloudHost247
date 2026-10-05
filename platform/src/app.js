/**
 * Application assembly — the Fastify `buildApp()` equivalent.
 *
 * Wires together: configuration, storage, the zero-dependency core (router, security headers,
 * CORS, rate limiting, static files), every registered domain, and the request pipeline.
 *
 * Kept separate from server.js so tests can construct an app and drive it with real HTTP
 * requests on an ephemeral port, or call `handle()` directly without binding a socket at all.
 */
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');

const { Router } = require('./core/router');
const { Ctx, sendError } = require('./core/http');
const { createLogger } = require('./core/logger');
const { securityHeaders } = require('./core/security');
const { corsMiddleware } = require('./core/cors');
const { RateLimiter, rateLimit, userOrIp } = require('./core/ratelimit');
const { staticMiddleware } = require('./core/static');
const { NotFoundError } = require('./core/errors');
const { createStore } = require('./store');

const API_PREFIX = '/api/v1';

/**
 * Domains are registered in dependency order. Each module exports
 * `{ name, register(router, deps) }` and adds its own routes under API_PREFIX.
 */
const DOMAINS = [
  // Core
  require('./domains/health'),
  require('./domains/auth'),
  require('./domains/account'),
  require('./domains/account-identity'),
  require('./domains/catalog'),
  require('./domains/audit'),

  // Commerce & billing
  require('./domains/commerce'),
  require('./domains/billing'),
  require('./domains/payments'),
  require('./domains/webhooks'),
  require('./domains/admin-billing'),

  // Hosting & services
  require('./domains/services'),
  require('./domains/licenses'),
  require('./domains/control-panels'),
  require('./domains/marketplace'),
  require('./domains/marketplace-admin'),
  require('./domains/app-installations'),
  require('./domains/deployments'),

  // Domains & DNS & SSL
  require('./domains/domains'),
  require('./domains/dns'),
  require('./domains/ssl'),
  require('./domains/domain-services'),
  require('./domains/domain-brokerage'),
  require('./domains/admin-domain-services'),

  // Infrastructure & servers
  require('./domains/servers'),
  require('./domains/provisioning'),
  require('./domains/infrastructure'),
  require('./domains/monitoring'),
  require('./domains/firewall'),
  require('./domains/agent'),

  // Cloudflare
  require('./domains/cloudflare'),
  require('./domains/admin-cloudflare'),

  // Admin platform & customers & users
  require('./domains/admin-platform'),
  require('./domains/admin-customers'),
  require('./domains/admin-users'),

  // Revenue Guardian
  require('./domains/revenue-guardian'),

  // AI
  require('./domains/ai-support'),
  require('./domains/ai-os'),

  // Tools
  require('./domains/tools'),
  require('./domains/mrz-tools'),
  require('./domains/admin-tools'),
];

class App {
  constructor(config, options = {}) {
    this.config = config;
    this.logger = options.logger ?? createLogger({
      level: config.LOG_LEVEL,
      pretty: config.NODE_ENV !== 'production',
      base: { app: 'cloudhost247' },
    });
    this.store = options.store ?? null;
    this.startedAt = Date.now();
    this.router = new Router();
    this.limiter = new RateLimiter({
      windowMs: config.RATE_LIMIT_WINDOW_MS,
      max: config.RATE_LIMIT_MAX,
    });
    this.authLimiter = new RateLimiter({
      windowMs: config.RATE_LIMIT_WINDOW_MS,
      max: config.RATE_LIMIT_AUTH_MAX,
      sweep: false,
    });
    this.middlewares = [];
    this.staticHandlers = [];
  }

  /** Connect storage and register every domain. Safe to call more than once. */
  async init() {
    if (this._initialised) return this;

    if (!this.store) this.store = await createStore(this.config, this.logger);

    this.deps = {
      config: this.config,
      store: this.store,
      logger: this.logger,
      apiPrefix: API_PREFIX,
      limiter: this.limiter,
      authLimiter: this.authLimiter,
    };

    this._registerPipeline();

    for (const domain of DOMAINS) {
      domain.register(this.router, this.deps);
      this.logger.debug({ domain: domain.name }, 'registered domain');
    }

    this._registerStatic();
    this._registerApiIndex();

    this._initialised = true;
    return this;
  }

  _registerPipeline() {
    const applySecurity = securityHeaders({
      enforceCsp: this.config.NODE_ENV === 'production',
    });

    const cors = corsMiddleware({
      origins: (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean),
    });

    const globalLimit = rateLimit({ limiter: this.limiter, name: 'global' });

    // Order matters: identify -> secure -> allow origin -> throttle -> handle.
    this.middlewares.push(
      (ctx) => {
        if (!ctx.requestId) ctx.requestId = randomUUID();
        ctx.header('X-Request-Id', ctx.requestId);
        return false;
      },
      applySecurity,
      cors,
      globalLimit
    );
  }

  _registerStatic() {
    const spaExists = fs.existsSync(path.join(this.config.SPA_DIR, 'index.html'));

    // 1. Built React SPA assets — fingerprinted filenames, so they are immutable. The SPA is
    //    mounted at /app, hence the /app/assets prefix.
    if (spaExists) {
      this.staticHandlers.push(staticMiddleware({
        root: path.join(this.config.SPA_DIR, 'assets'),
        prefix: '/app/assets',
        maxAge: 31536000,
        immutable: true,
      }));
    }

    // 2. Vanilla JS public site (hand-written, no build step).
    if (fs.existsSync(this.config.PUBLIC_DIR)) {
      this.staticHandlers.push(staticMiddleware({
        root: this.config.PUBLIC_DIR,
        maxAge: this.config.STATIC_MAX_AGE,
      }));
    }

    // 3. SPA shell — served for /app/* and, when enabled, as the fallback for unknown GETs so
    //    client-side routes survive a refresh.
    if (spaExists && this.config.SERVE_SPA) {
      const spa = staticMiddleware({
        root: this.config.SPA_DIR,
        prefix: '/app',
        maxAge: 0,
        spaFallback: true,
      });
      this.staticHandlers.push(spa);
      this.staticHandlers.push((ctx) => {
        if (!ctx.pathname.startsWith('/app')) return false;
        return spa(ctx);
      });
    }
  }

  /** GET /api — machine-readable index of every registered route. */
  _registerApiIndex() {
    this.router.get('/api', (ctx) => {
      ctx.json({
        name: 'CloudHost247 Platform API',
        version: '1.0.0',
        prefix: API_PREFIX,
        storage: this.store.backend,
        routes: this.router.list().filter((r) => r.path.startsWith(API_PREFIX)),
      });
    });

    this.router.get(`${API_PREFIX}/meta`, (ctx) => {
      ctx.json({
        name: 'CloudHost247 Platform',
        version: '1.0.0',
        node: process.version,
        storage: this.store.backend,
        uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
        domains: DOMAINS.map((d) => d.name),
      });
    });
  }

  /**
   * Core dispatch. Runs middleware, static handlers, then the matched route.
   * Returns the Ctx; the caller owns the socket.
   */
  async handle(req, res) {
    const ctx = new Ctx(req, res, {
      logger: this.logger,
      store: this.store,
      env: this.config,
      config: this.config,
    });

    const started = process.hrtime.bigint();

    try {
      for (const middleware of this.middlewares) {
        if (await middleware(ctx, this.deps) === true) return ctx;
        if (ctx._sent) return ctx;
      }

      // Static assets are tried before routing so a file on disk always wins over a route.
      for (const handler of this.staticHandlers) {
        if (handler(ctx) === true) {
          this._logRequest(ctx, 200, started);
          return ctx;
        }
        if (ctx._sent) {
          this._logRequest(ctx, ctx._statusCode, started);
          return ctx;
        }
      }

      const { route, params } = this.router.resolve(ctx.method, ctx.pathname);
      ctx.params = params;

      for (const middleware of route.middleware) {
        await middleware(ctx, this.deps);
        if (ctx._sent) return ctx;
      }

      const result = await route.handler(ctx, this.deps);

      // A handler that returns a value (rather than calling ctx.send itself) gets it serialised,
      // which keeps simple handlers to one line. `null` means "already handled".
      if (result !== undefined && result !== null && !ctx._sent) {
        ctx.send(result);
      } else if (!ctx._sent) {
        ctx.noContent();
      }

      this._logRequest(ctx, ctx._statusCode, started);
    } catch (err) {
      sendError(ctx, err, { exposeInternal: this.config.NODE_ENV !== 'production' });
      this._logRequest(ctx, ctx._statusCode, started, err);
    }

    return ctx;
  }

  _logRequest(ctx, status, started, err) {
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    const fields = {
      method: ctx.method,
      path: ctx.pathname,
      status,
      durationMs: Math.round(durationMs * 100) / 100,
      ip: ctx.ip,
      requestId: ctx.requestId,
    };
    if (err) this.logger.error({ ...fields, err }, 'request failed');
    else if (status >= 500) this.logger.error(fields, 'server error');
    else if (status >= 400) this.logger.warn(fields, 'client error');
    else this.logger.info(fields, 'request');
  }

  async close() {
    this.limiter.stop();
    this.authLimiter.stop();
    if (this.store) await this.store.close();
  }
}

/** Build (but do not start) an application. */
async function buildApp(config, options = {}) {
  const app = new App(config, options);
  await app.init();
  return app;
}

module.exports = { App, buildApp, API_PREFIX, NotFoundError };
