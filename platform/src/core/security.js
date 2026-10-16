/**
 * Security headers — replaces @fastify/helmet.
 *
 * Emits a strict default set. `contentSecurityPolicy` is tuned for this app: the Vanilla JS
 * public site uses no inline scripts, but the built React SPA and the legacy templates may, so
 * the CSP is reported in Report-Only unless explicitly enforced.
 */
'use strict';

/** The framing directive this process sends when no ancestor list is configured. */
const DEFAULT_FRAME_ANCESTORS = "'none'";

function buildCsp(frameAncestors) {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    `frame-ancestors ${frameAncestors}`,
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

const DEFAULT_CSP = buildCsp(DEFAULT_FRAME_ANCESTORS);

function securityHeaders(options = {}) {
  /**
   * A space-separated CSP ancestor list (for example `https://*.example.com https://other.test`).
   * Unset — the production default — means the app refuses to be framed at all. It exists because
   * a sandbox/preview host legitimately embeds the app in an iframe, and `X-Frame-Options` cannot
   * express a list of ancestors, so a configured list is enforced through CSP instead.
   */
  const frameAncestors = options.frameAncestors ?? null;
  const csp = options.contentSecurityPolicy
    ?? (frameAncestors ? buildCsp(frameAncestors) : DEFAULT_CSP);
  const enforceCsp = options.enforceCsp ?? false;
  const hsts = options.hsts ?? true;
  const crossOriginPolicy = options.crossOriginPolicy ?? false;

  return function applySecurityHeaders(ctx) {
    ctx.header('X-Content-Type-Options', 'nosniff');
    if (frameAncestors) {
      /**
       * An ancestor list replaces `X-Frame-Options` (which only knows DENY/SAMEORIGIN). Policies
       * combine by intersection, so this header adds the framing rule to whatever the report-only
       * (or, in production, enforced) policy above already says — nothing else is relaxed.
       */
      ctx.header('Content-Security-Policy', `frame-ancestors ${frameAncestors}`);
    } else {
      ctx.header('X-Frame-Options', 'DENY');
    }
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
