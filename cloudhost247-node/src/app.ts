import path from 'node:path';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { Env } from './config/env';
import { registerSecurityPlugins } from './plugins/security';
import { registerHealthRoutes } from './routes/health';
import { registerAuthRoutes } from './routes/auth';
import { registerPublicCatalogRoutes } from './routes/catalog-public';
import { registerCatalogAdminRoutes } from './routes/catalog-admin';
import { registerAccountRoutes } from './routes/account';
import { registerAdminCustomerRoutes } from './routes/admin-customers';
import { registerCommerceRoutes } from './routes/commerce';
import { registerBillingRoutes } from './routes/billing';
import { HttpError } from './lib/errors';
import { createLogger } from './lib/logger';
import type { Queryable } from './db/types';

export interface BuildAppOptions {
  /** Serve the built frontend (public/) and SPA-fallback unmatched GET routes to it. */
  serveFrontend?: boolean;
  publicDir?: string;
  /** Test-only: substitute a real embedded Postgres engine instead of the live pg Pool. */
  pool?: Queryable;
}

/**
 * Builds (but does not start) the Fastify application. Kept separate from server.ts so tests can
 * use `app.inject()` without binding a real TCP port.
 */
export function buildApp(env: Env, options: BuildAppOptions = {}): FastifyInstance {
  const { serveFrontend = true, publicDir = path.join(__dirname, '..', '..', 'public'), pool } = options;

  const app = Fastify({
    // Cast: pino's Logger type is a structural superset of Fastify's FastifyBaseLogger but TS's
    // strict structural check trips on an unrelated optional property (`msgPrefix`) — this is a
    // known friction point between the `pino` and `fastify` type packages, not a runtime issue.
    loggerInstance: createLogger(env) as unknown as FastifyBaseLogger,
    trustProxy: true, // cPanel/Apache sits in front of this process via Passenger's reverse proxy
  });

  app.setErrorHandler((rawError, request, reply) => {
    const error = rawError as Error & { validation?: unknown; statusCode?: number; code?: string };
    if (error instanceof HttpError) {
      reply.code(error.statusCode).send({ error: error.code, message: error.message });
      return;
    }
    // Validation errors thrown by fastify's own schema layer, if used later.
    if (error.validation) {
      reply.code(400).send({ error: 'VALIDATION_ERROR', message: error.message });
      return;
    }
    // Errors thrown by trusted Fastify ecosystem plugins (e.g. @fastify/rate-limit's 429,
    // @fastify/static's 404s) already carry a safe, client-facing statusCode + message.
    // Anything without an explicit 4xx statusCode is treated as an unexpected server error and
    // never has its raw message/stack exposed to the client.
    if (typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
      reply.code(error.statusCode).send({ error: error.code ?? 'ERROR', message: error.message });
      return;
    }
    request.log.error({ err: error }, 'unhandled error');
    reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
  });

  // Security plugins + API routes are registered inside a *single* avvio plugin/context, in
  // strict sequence. This matters: @fastify/rate-limit (and helmet/cors) are themselves wrapped
  // with `fastify-plugin`, which makes them attach their hooks/decorators to their immediate
  // parent context. If security plugins and routes were registered as separate sibling
  // `app.register()` calls, the hooks would attach to one sibling context and never reach routes
  // declared in a different sibling — routes would silently end up with no rate limiting applied.
  // Registering everything as descendants of one shared context, in order, guarantees security
  // plugins are fully mounted (hooks attached to this exact context) before any route is added.
  app.register(async (instance) => {
    await registerSecurityPlugins(instance, env);
    await registerHealthRoutes(instance, env);
    await registerAuthRoutes(instance, env, pool);
    await registerPublicCatalogRoutes(instance, env, pool);
    await registerCatalogAdminRoutes(instance, env, pool);
    await registerAccountRoutes(instance, env, pool);
    await registerAdminCustomerRoutes(instance, env, pool);
    await registerCommerceRoutes(instance, env, pool);
    await registerBillingRoutes(instance, env, pool);
  });

  if (serveFrontend) {
    // Registered directly on the root `app` (not nested inside the block above) so that the
    // `reply.sendFile` decorator it adds is visible to the root-level notFoundHandler below —
    // decorators only flow down to child contexts, never sideways between separate sibling ones.
    app.register(fastifyStatic, {
      root: publicDir,
      index: false, // handled explicitly by the notFoundHandler below so client routes work too
      wildcard: false,
    });
  }

  app.setNotFoundHandler((request, reply) => {
    const isApiRoute = request.raw.url?.startsWith('/api') || request.raw.url === '/health' || request.raw.url === '/ready';
    if (!serveFrontend || isApiRoute || request.method !== 'GET') {
      reply.code(404).send({ error: 'NOT_FOUND', message: 'Resource not found' });
      return;
    }
    // React Router (client-side) routes: always resolve to the SPA shell so direct navigation
    // and browser refreshes work when this app is reached through cPanel/Apache/Passenger.
    reply.type('text/html').sendFile('index.html');
  });

  return app;
}
