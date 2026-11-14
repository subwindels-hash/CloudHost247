import type { FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { Env } from '../config/env';

/**
 * Baseline security hardening. All of this runs inside the single Node process that cPanel
 * Passenger manages — no reliance on Nginx/Apache-level modules, so it must be correct here.
 */
export async function registerSecurityPlugins(app: FastifyInstance, env: Env) {
  const extraFrameAncestors = env.FRAME_ANCESTORS
    ? env.FRAME_ANCESTORS.trim().split(/\s+/).filter(Boolean)
    : [];

  await app.register(helmet, {
    frameguard: extraFrameAncestors.length > 0 ? false : undefined,
    // The SPA is served by this same app, so keep CSP permissive enough for same-origin assets
    // while still removing the most common risky defaults. Tightened further in later phases
    // once the frontend's asset hashing strategy is finalized.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        ...(extraFrameAncestors.length > 0
          ? { frameAncestors: ["'self'", ...extraFrameAncestors] }
          : {}),
        imgSrc: ["'self'", 'data:', 'https://www.facebook.com', 'https://www.google.com', 'https://www.googleadservices.com', 'https://googleads.g.doubleclick.net', 'https://www.googletagmanager.com', 'https://www.google-analytics.com', 'https://region1.google-analytics.com', 'https://analytics.tiktok.com'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        // Only explicitly used Meta, Google and TikTok origins; no script wildcards.
        //
        // 'wasm-unsafe-eval' lets a page compile WebAssembly, which the Barcode Scanner's decoder
        // is. It does not allow eval(), new Function() or a string passed to a timer: those stay
        // refused, because 'unsafe-eval' is not granted. The policy covers every page and not the
        // scanner alone, since the site is one document that changes its own address. See
        // docs/tools/SECURITY.md, "WebAssembly".
        scriptSrc: ["'self'", "'wasm-unsafe-eval'", 'https://connect.facebook.net', 'https://www.googletagmanager.com', 'https://analytics.tiktok.com'],
        connectSrc: ["'self'", 'https://connect.facebook.net', 'https://www.facebook.com', 'https://www.google.com', 'https://www.googleadservices.com', 'https://googleads.g.doubleclick.net', 'https://www.googletagmanager.com', 'https://www.google-analytics.com', 'https://region1.google-analytics.com', 'https://analytics.tiktok.com'],
      },
    },
  });

  await app.register(cors, {
    origin: env.APP_URL,
    credentials: true,
  });

  // Protects the auth foundation endpoints against brute force; every route can opt into a
  // stricter per-route limit via the `config.rateLimit` route option.
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    /**
     * Per-route buckets, not one shared bucket per IP.
     *
     * The default key is just the client IP, which means every route's `config.rateLimit` shares one
     * counter: nine requests to `/account/security-pin/view` would exhaust a 5-per-10-minutes route
     * limit *and* leave the login route already throttled. That turns a limit meant to protect one
     * sensitive action into a global ceiling, and (worse) lets traffic on a busy route deny service
     * to a different one. Keying on `routeOptions.url` gives each route its own window while still
     * keying by client IP within that route.
     *
     * The array-appended per-route config only *low*ers the ceiling (see @fastify/rate-limit's
     * mergeParams), so routes that opt in still inherit the global 300/minute as an outer bound.
     */
    keyGenerator: (request) => `${request.ip}|${request.routeOptions?.url ?? request.url.split(/[?#]/)[0]}`,
    // Content-hashed static bundles are not API traffic. A tool page pulls around twenty of them,
    // so counting them against the API ceiling made a single browser session fail mid-load: once the
    // minute's budget was spent, the JavaScript itself was refused and the page rendered blank.
    allowList: (request) => ((request.url ?? '').split(/[?#]/)[0] ?? '').startsWith('/assets/'),
  });
}
