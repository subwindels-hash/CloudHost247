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
  await app.register(helmet, {
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
  });
}
