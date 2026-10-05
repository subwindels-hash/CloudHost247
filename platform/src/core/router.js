/**
 * HTTP router — replaces Fastify's radix-tree router with a dependency-free implementation.
 *
 * Features:
 *   - Static, parameterised (:id) and wildcard (*) segments
 *   - Method-aware dispatch with correct 405 METHOD_NOT_ALLOWED (rather than 404) when the path
 *     matches but the verb does not
 *   - Per-route middleware chains and global hooks (onRequest, preHandler, onError)
 *   - Route listing for the auto-generated API index at GET /api
 *
 * Matching is a linear scan over a route list rather than a trie. The platform registers on the
 * order of a few hundred routes, and the scan is a cheap string comparison per route; this keeps
 * the code small enough to audit, which matters more here than trie asymptotics.
 */
'use strict';

const { NotFoundError, HttpError } = require('./errors');

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

function compilePath(pattern) {
  // Trailing slash is insignificant: "/users/" and "/users" are the same route.
  const normalized = pattern.length > 1 ? pattern.replace(/\/+$/, '') : pattern;
  const segments = normalized === '' ? [] : normalized.split('/').filter((s) => s !== '');

  // `params` is a position-aware list so resolve() can map each captured value back to the exact
  // path segment that produced it. Indexing by key order alone is a bug when a pattern has static
  // segments before a param (e.g. /api/v1/catalog/products/:slug).
  const params = [];
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (segment.startsWith(':')) params.push({ name: segment.slice(1), index: i });
    else if (segment === '*') params.push({ name: '*', index: i, wildcard: true });
  }

  const match = (pathname) => {
    const parts = pathname.split('/').filter((s) => s !== '');

    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i];
      if (segment === '*') {
        return parts.slice(i).join('/');
      }
      if (i >= parts.length) return null;
      if (segment.startsWith(':')) continue;
      if (segment !== parts[i]) return null;
    }
    if (parts.length !== segments.length) return null;
    return true;
  };

  return { pattern, segments, params, match };
}

/**
 * Per-segment specificity: a literal segment is more specific than a parameter, which is more
 * specific than a wildcard. Routes are resolved most-specific-first so a literal route like
 * /tools/history is never shadowed by an earlier-registered /tools/:slug. Ties fall back to
 * registration order, so non-overlapping routes keep their original precedence.
 */
function segmentRank(segment) {
  if (segment === '*') return 0;
  if (segment.startsWith(':')) return 1;
  return 2;
}

function compareSpecificity(a, b) {
  const shared = Math.min(a.segments.length, b.segments.length);
  for (let i = 0; i < shared; i += 1) {
    const delta = segmentRank(b.segments[i]) - segmentRank(a.segments[i]);
    if (delta !== 0) return delta; // higher rank (more specific) sorts first
  }
  if (a.segments.length !== b.segments.length) return b.segments.length - a.segments.length;
  return a.order - b.order; // stable: preserve registration order on ties
}

class Router {
  constructor() {
    this.routes = [];
    this._sorted = false;
    this.hooks = { onRequest: [], preHandler: [], onSend: [], onError: [] };
  }

  add(method, pattern, ...handlers) {
    if (handlers.length === 0) throw new Error(`route ${method} ${pattern} has no handler`);
    const compiled = compilePath(pattern);
    this.routes.push({
      method,
      pattern,
      ...compiled,
      order: this.routes.length,
      middleware: handlers.slice(0, -1),
      handler: handlers[handlers.length - 1],
    });
    this._sorted = false;
    return this;
  }

  /** Sort routes most-specific-first once, lazily, after all domains have registered. */
  _ensureSorted() {
    if (this._sorted) return;
    this.routes.sort(compareSpecificity);
    this._sorted = true;
  }

  get(pattern, ...handlers) { return this.add('GET', pattern, ...handlers); }
  post(pattern, ...handlers) { return this.add('POST', pattern, ...handlers); }
  put(pattern, ...handlers) { return this.add('PUT', pattern, ...handlers); }
  patch(pattern, ...handlers) { return this.add('PATCH', pattern, ...handlers); }
  delete(pattern, ...handlers) { return this.add('DELETE', pattern, ...handlers); }
  head(pattern, ...handlers) { return this.add('HEAD', pattern, ...handlers); }
  options(pattern, ...handlers) { return this.add('OPTIONS', pattern, ...handlers); }
  all(pattern, ...handlers) {
    for (const method of HTTP_METHODS) this.add(method, pattern, ...handlers);
    return this;
  }

  /** Register a route group under a common prefix without repeating it at every call site. */
  group(prefix, register) {
    const scoped = {
      get: (p, ...h) => this.add('GET', join(prefix, p), ...h),
      post: (p, ...h) => this.add('POST', join(prefix, p), ...h),
      put: (p, ...h) => this.add('PUT', join(prefix, p), ...h),
      patch: (p, ...h) => this.add('PATCH', join(prefix, p), ...h),
      delete: (p, ...h) => this.add('DELETE', join(prefix, p), ...h),
      options: (p, ...h) => this.add('OPTIONS', join(prefix, p), ...h),
      all: (p, ...h) => { for (const m of HTTP_METHODS) this.add(m, join(prefix, p), ...h); },
      group: (sub, fn) => this.group(join(prefix, sub), fn),
    };
    register(scoped);
    return this;
  }

  hook(name, fn) {
    if (!this.hooks[name]) throw new Error(`unknown hook: ${name}`);
    this.hooks[name].push(fn);
    return this;
  }

  /**
   * Resolve a request to a route.
   * @returns {{ route, params }} or throws NotFoundError / HttpError(405)
   */
  resolve(method, pathname) {
    this._ensureSorted();
    const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') || '/' : pathname;
    let pathMatched = false;

    for (const route of this.routes) {
      const params = route.match(normalized === '/' ? '' : normalized);
      if (params === null) continue;
      pathMatched = true;

      // HEAD falls back to GET so a GET route is reachable by HEAD, matching HTTP semantics and
      // what Fastify does for us today.
      if (route.method === method || (method === 'HEAD' && route.method === 'GET')) {
        const parts = normalized.split('/').filter((s) => s !== '');
        const resolved = {};

        if (typeof params === 'string') {
          // The wildcard route matched; `params` is the captured remainder.
          resolved['*'] = params;
        } else {
          for (const param of route.params) {
            if (param.wildcard) resolved['*'] = parts.slice(param.index).join('/');
            else resolved[param.name] = safeDecode(parts[param.index] ?? '');
          }
        }

        return { route, params: resolved };
      }
    }

    if (pathMatched) {
      const allowed = [...new Set(
        this.routes.filter((r) => r.match(normalized === '/' ? '' : normalized) !== null).map((r) => r.method)
      )];
      throw new HttpError(405, `Method ${method} not allowed`, 'METHOD_NOT_ALLOWED', { allow: allowed });
    }

    throw new NotFoundError(`Cannot ${method} ${pathname}`);
  }

  /** Machine-readable route table (used by GET /api and tests). */
  list() {
    return this.routes.map((r) => ({ method: r.method, path: r.pattern }));
  }
}

function join(prefix, path) {
  const a = prefix.replace(/\/+$/, '');
  const b = path.startsWith('/') ? path : `/${path}`;
  if (b === '/') return a || '/';
  return `${a}${b}`;
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

module.exports = { Router, compilePath, HTTP_METHODS };
