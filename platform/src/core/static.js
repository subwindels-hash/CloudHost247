/**
 * Static file serving — replaces @fastify/static.
 *
 * Features:
 *   - ETag (mtime+size based) and Last-Modified, with 304 support
 *   - Range requests (needed for video/audio and for resumable downloads)
 *   - Content-Type from a built-in MIME table (no `mime` dependency)
 *   - Directory traversal protection: the resolved path must stay inside the root
 *   - Gzip/Brotli pre-compressed sibling files (.gz/.br) when present
 *   - SPA fallback: unknown GET requests can be handed the built React app's index.html
 *
 * Files are streamed, never buffered whole into memory.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.wasm': 'application/wasm',
  '.csv': 'text/csv; charset=utf-8',
};

function contentType(file) {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

function etagFor(stat) {
  return `W/"${stat.size.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}"`;
}

/**
 * Resolve a URL path to a filesystem path inside `root`, or null if it escapes the root.
 * Rejects encoded traversal (%2e%2e) and absolute paths before touching the disk.
 */
function resolveSafe(root, urlPath) {
  const cleaned = decodeURIComponentSafe(urlPath).replace(/^\/+/, '');
  if (cleaned.includes('\0')) return null;

  const resolved = path.resolve(root, cleaned);
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) return null;
  return resolved;
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Choose a pre-compressed sibling if the client accepts it and the file exists. */
function pickEncoding(file, acceptEncoding) {
  const accept = String(acceptEncoding ?? '');
  if (accept.includes('br')) {
    const br = `${file}.br`;
    if (fs.existsSync(br)) return { file: br, encoding: 'br' };
  }
  if (accept.includes('gzip')) {
    const gz = `${file}.gz`;
    if (fs.existsSync(gz)) return { file: gz, encoding: 'gzip' };
  }
  return { file, encoding: null };
}

function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match) return null;

  let start = match[1] === '' ? undefined : Number(match[1]);
  let end = match[2] === '' ? undefined : Number(match[2]);

  if (start === undefined && end === undefined) return null;
  // Suffix range: bytes=-500 means the last 500 bytes.
  if (start === undefined) start = Math.max(0, size - end);
  if (end === undefined) end = size - 1;

  if (start < 0 || end >= size || start > end) return { unsatisfiable: true, size };
  return { start, end, size };
}

/**
 * Serve a file. Returns true if a response was written, false if the caller should continue
 * (e.g. fall through to the SPA or the 404 handler).
 */
function serveFile(ctx, absolutePath, options = {}) {
  let stat;
  try {
    stat = fs.statSync(absolutePath);
  } catch {
    return false;
  }

  let target = absolutePath;
  if (stat.isDirectory()) {
    if (options.index === false) return false;
    target = path.join(absolutePath, options.index ?? 'index.html');
    try {
      stat = fs.statSync(target);
    } catch {
      return false;
    }
  }
  if (!stat.isFile()) return false;

  const etag = etagFor(stat);
  const lastModified = stat.mtime.toUTCString();

  // Conditional requests: answer 304 before doing any I/O.
  if (ctx.method === 'GET' || ctx.method === 'HEAD') {
    const ifNoneMatch = ctx.headers['if-none-match'];
    const ifModifiedSince = ctx.headers['if-modified-since'];
    if ((ifNoneMatch && ifNoneMatch.split(',').some((t) => t.trim() === etag))
      || (ifModifiedSince && new Date(ifModifiedSince) >= stat.mtime)) {
      ctx.code(304).header('ETag', etag).header('Cache-Control', cacheControl(options))._write(null);
      return true;
    }
  }

  const { file: encodedFile, encoding } = pickEncoding(target, ctx.headers['accept-encoding']);
  const isPrecompressed = encodedFile !== target;
  const sendStat = isPrecompressed ? fs.statSync(encodedFile) : stat;

  ctx.header('Content-Type', contentType(target));
  ctx.header('ETag', etag);
  ctx.header('Last-Modified', lastModified);
  ctx.header('Accept-Ranges', 'bytes');
  ctx.header('Cache-Control', cacheControl(options));
  if (encoding) ctx.header('Content-Encoding', encoding);

  const range = ctx.headers.range && !isPrecompressed
    ? parseRange(ctx.headers.range, sendStat.size)
    : null;

  if (range?.unsatisfiable) {
    ctx.code(416).header('Content-Range', `bytes */${range.size}`)._write(null);
    return true;
  }

  if (range) {
    ctx.code(206);
    ctx.header('Content-Range', `bytes ${range.start}-${range.end}/${range.size}`);
    ctx.header('Content-Length', String(range.end - range.start + 1));
    ctx._applyHeaders();
    ctx.res.writeHead(206);
    if (ctx.method === 'HEAD') {
      ctx.res.end();
    } else {
      fs.createReadStream(encodedFile, { start: range.start, end: range.end }).pipe(ctx.res);
    }
    ctx._sent = true;
    return true;
  }

  ctx.header('Content-Length', String(sendStat.size));
  ctx._applyHeaders();
  ctx.res.writeHead(ctx._statusCode);
  if (ctx.method === 'HEAD') {
    ctx.res.end();
  } else {
    fs.createReadStream(encodedFile).pipe(ctx.res);
  }
  ctx._sent = true;
  return true;
}

function cacheControl(options) {
  if (options.immutable) return `public, max-age=${options.maxAge ?? 31536000}, immutable`;
  if (options.maxAge === 0) return 'no-cache';
  return `public, max-age=${options.maxAge ?? 3600}`;
}

/**
 * Static file middleware factory.
 *
 * @param {object} options
 * @param {string} options.root      directory to serve
 * @param {string} [options.prefix]  URL prefix to strip (e.g. '/assets')
 * @param {number} [options.maxAge]  Cache-Control max-age in seconds
 * @param {boolean} [options.spaFallback] serve root/index.html for unmatched GET paths
 */
function staticMiddleware(options) {
  const root = path.resolve(options.root);
  const prefix = (options.prefix ?? '').replace(/\/+$/, '');
  const exists = fs.existsSync(root);

  return function serveStatic(ctx) {
    if (ctx.method !== 'GET' && ctx.method !== 'HEAD') return false;
    if (!exists) return false;

    let urlPath = ctx.pathname;
    if (prefix) {
      if (urlPath !== prefix && !urlPath.startsWith(`${prefix}/`)) return false;
      urlPath = urlPath.slice(prefix.length) || '/';
    }

    const absolute = resolveSafe(root, urlPath);
    if (!absolute) return false; // traversal attempt — let the 404/403 path handle it

    if (serveFile(ctx, absolute, options)) return true;

    // SPA fallback: any unmatched GET gets the app shell so client-side routes work on refresh.
    if (options.spaFallback && !path.extname(urlPath)) {
      const shell = path.join(root, 'index.html');
      return serveFile(ctx, shell, { ...options, maxAge: 0 });
    }
    return false;
  };
}

/** SHA-256 of a file, used to fingerprint build output for cache busting. */
function fileHash(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);
}

module.exports = { serveFile, staticMiddleware, resolveSafe, contentType, MIME, parseRange, fileHash };
