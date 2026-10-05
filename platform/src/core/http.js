/**
 * HTTP request/response context — replaces Fastify's `request` / `reply` objects.
 *
 * A single `Ctx` is built per request and carries: the parsed URL and query, path params, the
 * parsed body (plus the untouched raw bytes, which webhook signature verification needs), the
 * client IP behind the cPanel/Apache reverse proxy, and the response builder.
 *
 * Everything here uses `node:http` primitives only.
 */
'use strict';

const { ValidationError, PayloadTooLargeError, HttpError } = require('./errors');

const MAX_BODY_BYTES = 8 * 1024 * 1024; // 8 MiB — generous for JSON APIs, bounded to avoid OOM.

/**
 * Read the full request body into a Buffer, enforcing a size cap.
 * Rejects as soon as the cap is crossed rather than buffering past it.
 */
function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      settled = true;
      req.resume(); // drain so the client sees the response promptly
      reject(new PayloadTooLargeError(`Request body exceeds ${limit} bytes`));
      return;
    }

    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        settled = true;
        req.resume();
        reject(new PayloadTooLargeError(`Request body exceeds ${limit} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!settled) resolve(Buffer.concat(chunks));
    });
    req.on('error', (err) => {
      if (!settled) reject(err);
    });
  });
}

function parseQuery(search) {
  const query = Object.create(null);
  if (!search) return query;

  for (const pair of search.replace(/^\?/, '').split('&')) {
    if (pair === '') continue;
    const eq = pair.indexOf('=');
    const rawKey = eq === -1 ? pair : pair.slice(0, eq);
    const rawValue = eq === -1 ? '' : pair.slice(eq + 1);
    const key = decode(rawKey.replace(/\+/g, ' '));
    const value = decode(rawValue.replace(/\+/g, ' '));

    // Repeated keys collapse into an array, matching querystring/Fastify behaviour.
    if (key in query) {
      if (Array.isArray(query[key])) query[key].push(value);
      else query[key] = [query[key], value];
    } else {
      query[key] = value;
    }
  }
  return query;
}

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseUrlEncoded(buffer) {
  return parseQuery(buffer.toString('utf8'));
}

function parseCookies(header) {
  const cookies = Object.create(null);
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (!key) continue;
    cookies[key] = decode(part.slice(eq + 1).trim());
  }
  return cookies;
}

/**
 * Client IP behind a reverse proxy (cPanel Apache / Passenger in front of this process).
 * Takes the left-most entry of X-Forwarded-For, which is the original client; subsequent hops are
 * proxies. Only trusted because the platform is documented as always sitting behind a proxy.
 */
function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim() !== '') {
    const first = forwarded.split(',')[0].trim();
    if (first) return stripZone(first);
  }
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim() !== '') return stripZone(realIp.trim());
  return stripZone(req.socket.remoteAddress ?? 'unknown');
}

function stripZone(ip) {
  // Node reports IPv4-mapped IPv6 as ::ffff:1.2.3.4 — normalise to plain IPv4.
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  return ip;
}

class Ctx {
  constructor(req, res, options = {}) {
    this.req = req;
    this.res = res;
    this.logger = options.logger ?? console;
    this.store = options.store ?? null;
    this.env = options.env ?? {};
    this.config = options.config ?? null;
    this.services = options.services ?? {};

    const url = new URL(req.url ?? '/', 'http://localhost');
    this.method = req.method ?? 'GET';
    this.pathname = url.pathname;
    this.url = url;
    this.query = parseQuery(url.search);
    this.params = {};
    this.headers = req.headers;
    this.cookies = parseCookies(req.headers.cookie);
    this.ip = clientIp(req);
    this.userAgent = req.headers['user-agent'] ?? null;

    this.body = undefined;
    this.rawBody = Buffer.alloc(0);

    this.user = null;
    this.locals = Object.create(null);

    this._statusCode = 200;
    this._headers = new Map();
    this._cookieJar = [];
    this._sent = false;

    this.requestId = req.headers['x-request-id'] ?? options.requestId ?? null;
  }

  // -- request helpers ------------------------------------------------------

  /** Parse the body according to Content-Type. Raw bytes are always retained on ctx.rawBody. */
  async parseBody(limit = MAX_BODY_BYTES) {
    if (this.body !== undefined) return this.body;

    this.rawBody = await readBody(this.req, limit);
    const contentType = (this.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();

    if (this.rawBody.length === 0) {
      // Empty body parses to {} for the content types that expect an object, so handlers can
      // destructure without null checks (this matches Fastify's behaviour).
      this.body = contentType === '' || contentType === 'application/json'
        || contentType === 'application/x-www-form-urlencoded'
        ? {}
        : this.rawBody;
      return this.body;
    }

    switch (contentType) {
      case 'application/json':
        try {
          this.body = JSON.parse(this.rawBody.toString('utf8'));
        } catch {
          throw new ValidationError('Invalid JSON body');
        }
        break;
      case 'application/x-www-form-urlencoded':
        this.body = parseUrlEncoded(this.rawBody);
        break;
      case 'text/plain':
        this.body = this.rawBody.toString('utf8');
        break;
      default:
        // multipart/form-data and anything binary is left as a Buffer for the handler; see
        // src/core/multipart.js for the parser.
        this.body = this.rawBody;
    }
    return this.body;
  }

  /** Convenience: parse then validate against a schema (throws 400 ValidationError). */
  async validate(schema, limit) {
    await this.parseBody(limit);
    return schema.parseHttp(this.body);
  }

  // -- response helpers -----------------------------------------------------

  code(status) {
    this._statusCode = status;
    return this;
  }

  status(status) {
    return this.code(status);
  }

  header(name, value) {
    if (value === undefined || value === null) {
      this._headers.delete(name.toLowerCase());
    } else {
      this._headers.set(name.toLowerCase(), { name, value });
    }
    return this;
  }

  type(contentType) {
    return this.header('Content-Type', contentType);
  }

  /**
   * Set-Cookie builder.
   * Defaults are deliberately strict: HttpOnly + SameSite=Lax + Path=/. `secure` is applied
   * automatically when the request arrived over HTTPS (or via the proxy's forwarded proto).
   */
  cookie(name, value, options = {}) {
    const parts = [`${name}=${encodeURIComponent(value)}`];
    parts.push(`Path=${options.path ?? '/'}`);
    if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
    if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
    if (options.domain) parts.push(`Domain=${options.domain}`);
    if (options.httpOnly !== false) parts.push('HttpOnly');

    const secure = options.secure ?? this.isSecure();
    if (secure) parts.push('Secure');
    parts.push(`SameSite=${options.sameSite ?? 'Lax'}`);

    this._cookieJar.push(parts.join('; '));
    return this;
  }

  clearCookie(name, options = {}) {
    return this.cookie(name, '', { ...options, maxAge: 0, expires: new Date(0) });
  }

  isSecure() {
    if (this.req.socket.encrypted) return true;
    const proto = this.headers['x-forwarded-proto'];
    return typeof proto === 'string' ? proto.split(',')[0].trim() === 'https' : false;
  }

  /** Send a JSON body (the default content type for this API). */
  json(data) {
    return this.send(data);
  }

  text(body) {
    this.header('Content-Type', 'text/plain; charset=utf-8');
    return this._write(typeof body === 'string' ? Buffer.from(body, 'utf8') : body);
  }

  html(body) {
    this.header('Content-Type', 'text/html; charset=utf-8');
    return this._write(Buffer.from(body, 'utf8'));
  }

  buffer(buf, contentType) {
    if (contentType) this.header('Content-Type', contentType);
    return this._write(buf);
  }

  noContent() {
    this._statusCode = 204;
    return this._write(null);
  }

  redirect(location, status = 302) {
    this._statusCode = status;
    this.header('Location', location);
    return this._write(null);
  }

  send(payload) {
    if (payload === undefined || payload === null) return this._write(null);
    if (Buffer.isBuffer(payload)) return this._write(payload);
    if (typeof payload === 'string') return this.html(payload);

    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    if (!this._headers.has('content-type')) {
      this.header('Content-Type', 'application/json; charset=utf-8');
    }
    return this._write(body);
  }

  /** Apply accumulated headers and cookies to the raw response. Shared by _write and the
   *  streaming static handler, which writes its own status line. */
  _applyHeaders() {
    for (const { name, value } of this._headers.values()) this.res.setHeader(name, value);
    // Set-Cookie is the one header that must be emitted as an array so multiple cookies survive;
    // setHeader would otherwise let the last one win.
    if (this._cookieJar.length > 0) this.res.setHeader('Set-Cookie', this._cookieJar);
  }

  _write(body) {
    if (this._sent) return this;
    this._sent = true;

    this._applyHeaders();

    if (this.method === 'HEAD' || this._statusCode === 204 || this._statusCode === 304) {
      this.res.writeHead(this._statusCode);
      this.res.end();
      return this;
    }

    if (body !== null && body !== undefined) {
      this.res.setHeader('Content-Length', body.length);
    }
    this.res.writeHead(this._statusCode);
    this.res.end(body ?? undefined);
    return this;
  }
}

/**
 * Serialise any thrown value into a JSON error response.
 * HttpError subclasses keep their code and status; everything else becomes an opaque 500 so
 * internal details (stack traces, SQL, provider payloads) never reach the client.
 */
function sendError(ctx, err, { exposeInternal = false } = {}) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'An unexpected error occurred';
  let details;

  if (err instanceof HttpError) {
    status = err.statusCode;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err && err.name === 'ParseError' && Array.isArray(err.issues)) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Validation failed';
    details = err.issues.map((i) => ({ path: i.path, message: i.message, code: i.code }));
  } else if (err && typeof err.statusCode === 'number') {
    status = err.statusCode;
    code = err.code ?? 'ERROR';
    message = err.message;
  } else if (exposeInternal && err instanceof Error) {
    message = err.message;
  }

  if (status === 405 && details?.allow) {
    ctx.header('Allow', details.allow.join(', '));
    details = undefined;
  }

  ctx.logger.error({ err, status, code, path: ctx.pathname, method: ctx.method }, 'request failed');

  const body = { error: code, message };
  if (details !== undefined) body.details = details;

  if (ctx._sent) return;
  ctx.code(status);
  ctx.header('Content-Type', 'application/json; charset=utf-8');
  ctx._write(Buffer.from(JSON.stringify(body), 'utf8'));
}

module.exports = { Ctx, readBody, parseQuery, parseCookies, clientIp, sendError, MAX_BODY_BYTES };
