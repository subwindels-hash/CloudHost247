/**
 * Security headers — replaces @fastify/helmet.
 *
 * Emits a strict default set. `contentSecurityPolicy` is tuned for this app: the Vanilla JS
 * public site uses no inline scripts, but the built React SPA and the legacy templates may, so
 * the CSP is reported in Report-Only unless explicitly enforced.
 */
'use strict';

const DEFAULT_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

function securityHeaders(options = {}) {
  const csp = options.contentSecurityPolicy ?? DEFAULT_CSP;
  const enforceCsp = options.enforceCsp ?? false;
  const hsts = options.hsts ?? true;
  const crossOriginPolicy = options.crossOriginPolicy ?? false;

  return function applySecurityHeaders(ctx) {
    ctx.header('X-Content-Type-Options', 'nosniff');
    ctx.header('X-Frame-Options', 'DENY');
    ctx.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    ctx.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=(self)');
    ctx.header('X-DNS-Prefetch-Control', 'off');
    ctx.header('Cross-Origin-Opener-Policy', 'same-origin');

    if (crossOriginPolicy) {
      ctx.header('Cross-Origin-Embedder-Policy', 'require-corp');
      ctx.header('Cross-Origin-Resource-Policy', 'same-origin');
    }

    if (enforceCsp) ctx.header('Content-Security-Policy', csp);
    else ctx.header('Content-Security-Policy-Report-Only', csp);

    // HSTS is only meaningful over HTTPS; sending it over plain HTTP is ignored by browsers and
    // is noise in logs.
    if (hsts && ctx.isSecure()) {
      ctx.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }
  };
}

module.exports = { securityHeaders, DEFAULT_CSP };
