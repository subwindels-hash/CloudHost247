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
import { registerAccountIdentityRoutes } from './routes/account-identity';
import { registerAdminUserRoutes } from './routes/admin-users';
import { registerCommerceRoutes } from './routes/commerce';
import { registerBillingRoutes } from './routes/billing';
import { registerPaymentRoutes } from './routes/payments';
import { registerAdminBillingRoutes } from './routes/admin-billing';
import { registerWebhookRoutes } from './routes/webhooks';
import { registerDomainBrokerageRoutes } from './routes/domain-brokerage';
import { registerMarketplaceRoutes } from './routes/marketplace';
import { registerMarketplaceAdminRoutes } from './routes/marketplace-admin';
import { registerAppInstallationRoutes } from './routes/app-installations';
import { registerDeploymentRoutes } from './routes/deployments';
import { registerServerRoutes } from './routes/servers';
import { registerDomainRoutes } from './routes/domains';
import { registerDomainServiceRoutes } from './routes/domain-services';
import { registerAdminDomainServiceRoutes } from './routes/admin-domain-services';
import {
  DomainProviderError,
  safeDomainProviderMessage,
} from './domain-services/providers/types';
import { registerAgentRoutes } from './routes/agent';
import { registerAdminPlatformRoutes } from './routes/admin-platform';
import { registerInfrastructureRoutes } from './routes/infrastructure';
import { registerControlPanelsRoutes } from './routes/control-panels';
import { registerServicesRoutes } from './routes/services';
import { registerLicenseRoutes } from './routes/licenses';
import { registerMonitoringRoutes } from './routes/monitoring';
import { registerProvisioningRoutes } from './routes/provisioning';
import { registerAuditRoutes } from './routes/audit';
import { registerDnsRoutes } from './routes/dns';
import type { DnsPropagationOptions } from './dns/propagation';
import { registerSslRoutes } from './routes/ssl';
import { registerFirewallRoutes } from './routes/firewall';
import { registerRevenueGuardianRoutes } from './revenue-guardian/controllers/routes';
import { registerCloudflareRoutes } from './routes/cloudflare';
import { registerAdminCloudflareRoutes } from './routes/admin-cloudflare';
import { registerAiSupportRoutes } from './routes/ai-support';
import { registerAiControlPlaneRoutes } from './ai-os/controllers/routes';
import { registerToolsRoutes } from './tools/routes';
import { registerMrzToolRoutes } from './routes/mrz-tools';
import { HttpError, ValidationError } from './lib/errors';
import { createLogger } from './lib/logger';
import type { Queryable } from './db/types';

export interface BuildAppOptions {
  /** Serve the built frontend (public/) and SPA-fallback unmatched GET routes to it. */
  serveFrontend?: boolean;
  publicDir?: string;
  /** Test-only: substitute a real embedded Postgres engine instead of the live pg Pool. */
  pool?: Queryable;
  /**
   * DNS provider propagation options. Production leaves this unset so the real
   * Cloudflare/Route53 connectors are built from credentials at call time; tests inject a provider
   * so the genuine route handlers run against a scripted provider.
   */
  dnsPropagation?: DnsPropagationOptions;
}

/**
 * Builds (but does not start) the Fastify application. Kept separate from server.ts so tests can
 * use `app.inject()` without binding a real TCP port.
 */
export function buildApp(env: Env, options: BuildAppOptions = {}): FastifyInstance {
  const { serveFrontend = true, publicDir = path.join(__dirname, '..', '..', 'public'), pool, dnsPropagation } = options;

  const app = Fastify({
    // Cast: pino's Logger type is a structural superset of Fastify's FastifyBaseLogger but TS's
    // strict structural check trips on an unrelated optional property (`msgPrefix`) — this is a
    // known friction point between the `pino` and `fastify` type packages, not a runtime issue.
    loggerInstance: createLogger(env) as unknown as FastifyBaseLogger,
    trustProxy: true, // cPanel/Apache sits in front of this process via Passenger's reverse proxy
  });

  // Capture raw request body bytes for cryptographic webhook signature verification
  // while still parsing JSON for route handlers.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    (req as unknown as { rawBody?: Buffer }).rawBody = Buffer.isBuffer(body)
      ? body
      : typeof body === 'string'
        ? Buffer.from(body)
        : Buffer.alloc(0);
    if (!body || body.length === 0) {
      done(null, {});
      return;
    }
    try {
      const json = JSON.parse(body.toString('utf8'));
      done(null, json);
    } catch {
      done(new ValidationError('Invalid JSON body'), undefined);
    }
  });

  app.setErrorHandler((rawError, request, reply) => {
    const error = rawError as Error & { validation?: unknown; statusCode?: number; code?: string };
    if (error instanceof HttpError) {
      reply.code(error.statusCode).send({ error: error.code, message: error.message });
      return;
    }
    // Domain provider failures are expected operational states (provider down, rate limited, or
    // not yet configured by an admin) — they must surface as a safe, specific message, never as
    // an opaque 500 and never leaking provider detail (see safeDomainProviderMessage).
    if (error instanceof DomainProviderError) {
      const status = error.code === 'RATE_LIMITED' ? 429 : 503;
      reply
        .code(status)
        .send({ error: `DOMAIN_${error.code}`, message: safeDomainProviderMessage(error) });
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
  // strict sequence.
  app.register(async (instance) => {
    await registerSecurityPlugins(instance, env);
    await registerHealthRoutes(instance, env);
    await registerAuthRoutes(instance, env, pool);
    await registerPublicCatalogRoutes(instance, env, pool);
    await registerCatalogAdminRoutes(instance, env, pool);
    await registerAccountRoutes(instance, env, pool);
    await registerAccountIdentityRoutes(instance, env, pool);
    await registerAdminCustomerRoutes(instance, env, pool);
    await registerAdminUserRoutes(instance, env, pool);
    await registerCommerceRoutes(instance, env, pool);
    await registerBillingRoutes(instance, env, pool);
    await registerPaymentRoutes(instance, env, pool);
    await registerAdminBillingRoutes(instance, env, pool);
    await registerWebhookRoutes(instance, env, pool);
    await registerDomainBrokerageRoutes(instance, env, pool);

    // Phase 6 — marketplace, deployments, servers, domains, agent API, subscriptions, audit.
    await registerMarketplaceRoutes(instance, env, pool);
    await registerMarketplaceAdminRoutes(instance, env, pool);
    await registerAppInstallationRoutes(instance, env, pool);
    await registerDeploymentRoutes(instance, env, pool);
    await registerServerRoutes(instance, env, pool);
    await registerDomainRoutes(instance, env, pool);
    await registerAgentRoutes(instance, env, pool);
    await registerAdminPlatformRoutes(instance, env, pool);
    await registerInfrastructureRoutes(instance, env, pool);
    await registerControlPanelsRoutes(instance, env, pool);
    await registerServicesRoutes(instance, env, pool);
    await registerLicenseRoutes(instance, env, pool);
    await registerMonitoringRoutes(instance, env, pool);
    await registerProvisioningRoutes(instance, env, pool);
    await registerAuditRoutes(instance, env, pool);
    await registerDnsRoutes(instance, env, pool, dnsPropagation ?? {});
    await registerSslRoutes(instance, env, pool);
    await registerFirewallRoutes(instance, env, pool);

    // Domain Services platform (search, registration, transfer, extensions, auctions, appraisal,
    // club, WHOIS/RDAP, bulk search) + its Super Admin controls.
    await registerDomainServiceRoutes(instance, env, pool);
    await registerAdminDomainServiceRoutes(instance, env, pool);

    // Revenue Guardian — revenue recovery management layer over the existing billing engine.
    await registerRevenueGuardianRoutes(instance, env, pool);

    // Cloudflare reseller & management subsystem.
    await registerCloudflareRoutes(instance, env, pool);
    await registerAdminCloudflareRoutes(instance, env, pool);
    await registerAiSupportRoutes(instance, env, pool);

    // AI Control Plane — the shared AI operating system (agent registry, gated tool executor,
    // approvals, events/workflows, executive board, copilots, customer AI transparency).
    await registerAiControlPlaneRoutes(instance, env, pool);

    // Tools Center — DNS/IP/network/developer/webmaster/security/diagnostics tooling with its own
    // Super Admin control centre. Reuses this platform's auth, RBAC, audit log, notifications and
    // worker rather than introducing a parallel stack.
    //
    // Registered before the Document Tools module on purpose: this plugin owns the generic
    // /api/tools/:slug execution route, while the MRZ module registers its own static
    // /api/tools/mrz/* paths. find-my-way prefers static segments, so both coexist regardless of
    // order — the ordering here is only so the more general registration is the one that reads
    // first when someone traces the routes.
    await registerToolsRoutes(instance, env, pool);

    // Native Developer / Document Tools — ePassport MRZ Calculator, Validator, Parser & Super Admin settings.
    await registerMrzToolRoutes(instance, env, pool);

    // The frontend (static assets + SPA fallback) MUST be registered inside this same
    // encapsulated context. Hooks added by registerSecurityPlugins (helmet headers, CORS, rate
    // limiting) do not propagate to a parent/sibling context, so registering these on the root
    // instance served every HTML/JS/CSS response without CSP, HSTS, X-Frame-Options, etc.
    // Pinned by tests/unit/spa-security-headers.test.ts.
    if (serveFrontend) {
      await instance.register(fastifyStatic, {
        root: publicDir,
        index: false,
        wildcard: false,
      });
    }

    // @fastify/rate-limit attaches per-route (onRoute), so the not-found handler — which serves
    // every SPA page — needs the limiter wired in explicitly.
    instance.setNotFoundHandler({ preHandler: instance.rateLimit() }, (request, reply) => {
      const isApiRoute =
        request.raw.url?.startsWith('/api') || request.raw.url === '/health' || request.raw.url === '/ready';
      if (!serveFrontend || isApiRoute || request.method !== 'GET') {
        reply.code(404).send({ error: 'NOT_FOUND', message: 'Resource not found' });
        return;
      }
      reply.type('text/html').sendFile('index.html');
    });
  });

  return app;
}
