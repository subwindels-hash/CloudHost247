/**
 * CORS — replaces @fastify/cors.
 *
 * The public site, the SPA and the native apps are all same-origin in production (the monolith
 * serves them), so the default origin list is empty: same-origin only. Set CORS_ORIGINS to a
 * comma-separated list to open specific origins (e.g. the Capacitor app running from
 * capacitor://localhost).
 *
 * Credentials are only ever enabled for an explicitly listed origin — never for `*`, which
 * browsers reject for credentialed requests anyway.
 */
'use strict';

function corsMiddleware(options = {}) {
  const allowList = (options.origins ?? []).map((o) => String(o).trim()).filter(Boolean);
  const allowAll = allowList.includes('*');
  const methods = options.methods ?? ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
  const allowHeaders = options.allowedHeaders ?? ['Content-Type', 'Authorization', 'X-Request-Id', 'X-CSRF-Token'];
  const exposeHeaders = options.exposedHeaders ?? ['X-Request-Id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'];
  const maxAge = options.maxAge ?? 600;
  const credentials = options.credentials ?? true;

  return function cors(ctx) {
    const origin = ctx.headers.origin;

    if (origin) {
      const allowed = allowAll || allowList.includes(origin);
      if (allowed) {
        // Echo the request origin rather than `*` so credentials keep working.
        ctx.header('Access-Control-Allow-Origin', origin);
        ctx.header('Vary', 'Origin');
        if (credentials) ctx.header('Access-Control-Allow-Credentials', 'true');
      }
    }

    if (ctx.method === 'OPTIONS') {
      ctx.header('Access-Control-Allow-Methods', methods.join(', '));
      ctx.header('Access-Control-Allow-Headers', allowHeaders.join(', '));
      ctx.header('Access-Control-Expose-Headers', exposeHeaders.join(', '));
      ctx.header('Access-Control-Max-Age', String(maxAge));
      ctx.code(204)._write(null);
      return true; // preflight handled; do not continue to the route
    }

    ctx.header('Access-Control-Expose-Headers', exposeHeaders.join(', '));
    return false;
  };
}

module.exports = { corsMiddleware };
