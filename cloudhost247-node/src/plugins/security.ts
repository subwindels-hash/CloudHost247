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
  // The development preview harnesses (`scripts/*-demo-preview.ts`) run the real app inside an
  // editor/IDE preview iframe whose parent page is a different origin, so clickjacking protection
  // has to permit that framing while they run. `test` and `production` are untouched: helmet's
  // SAMEORIGIN default and `frame-ancestors 'self'` stay exactly as they are, which is what
  // tests/unit/spa-security-headers.test.ts pins.
  const allowPreviewFraming = env.NODE_ENV === 'development';

  await app.register(helmet, {
    ...(allowPreviewFraming ? { frameguard: false as const } : {}),
    // The SPA is served by this same app, so keep CSP permissive enough for same-origin assets
    // while still removing the most common risky defaults. Tightened further in later phases
    // once the frontend's asset hashing strategy is finalized.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        ...(allowPreviewFraming ? { frameAncestors: ['*'] } : {}),
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
    // Content-hashed static bundles are not API traffic. A tool page pulls around twenty of them,
    // so counting them against the API ceiling made a single browser session fail mid-load: once the
    // minute's budget was spent, the JavaScript itself was refused and the page rendered blank.
    allowList: (request) => ((request.url ?? '').split(/[?#]/)[0] ?? '').startsWith('/assets/'),
  });
}
