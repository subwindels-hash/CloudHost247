/**
 * Preview server for the CloudHost247 Tools pages.
 *
 *   PORT=8099 node scripts/tools-preview-server.mjs
 *
 * Pages are rendered by scripts/php-wasm (a WASM PHP build driven by Node), so the preview needs no
 * system PHP and no licensed WHMCS runtime, and static assets are served straight from the working
 * tree. Every route is one the site really publishes — /tools, /tools/compliance-documents,
 * /tools/<slug>, /tools/category/<slug> — and the HTML comes from the real Catalog and View classes,
 * not from a mock.
 *
 * The base URL is derived from the request Host header, so relative links, the canonical URL and
 * the module script all resolve against whatever origin the browser is actually on.
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { extname, join, normalize, resolve } from 'node:path';
import { existsSync, statSync, readFileSync } from 'node:fs';

// The repository root, so the server can be started from anywhere.
const ROOT = resolve(import.meta.dirname, '..');
const PORT = Number(process.env.PORT || 8099);
const TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

function render(pathname, base) {
  return new Promise((done) => {
    const script = join(ROOT, 'tests/tools/preview-render.php');
    // scripts/php-wasm/php is a shell wrapper around a WASM PHP build; run it as an executable
    // rather than handing it to node, which would try to parse the shebang as JavaScript.
    const child = spawn(join(ROOT, 'scripts/php-wasm/php'), [script, pathname, base], { cwd: ROOT });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('close', (code) => done({ code, out, err }));
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://placeholder');
  const pathname = decodeURIComponent(url.pathname);
  const base = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;

  // Static files from the working tree, restricted to inside the repository.
  const filePath = normalize(join(ROOT, pathname));
  if (filePath.startsWith(ROOT) && existsSync(filePath) && statSync(filePath).isFile()) {
    res.writeHead(200, {
      'content-type': TYPES[extname(filePath)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(readFileSync(filePath));
    return;
  }

  const { code, out, err } = await render(pathname, base);
  const statusLine = out.match(/^STATUS (\d{3})\n/);
  if (code !== 0 || !statusLine) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`Renderer failed for ${pathname} (exit ${code})\n\n${err || out}`);
    return;
  }
  const status = Number(statusLine[1]);
  const body = out.slice(statusLine[0].length);
  if (status === 404) {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Not found | CloudHost247</title></head>'
      + `<body style="font:16px/1.6 system-ui,sans-serif;max-width:44rem;margin:4rem auto;padding:0 1.25rem">`
      + `<h1>404 — no tool at ${pathname.replace(/[<>&]/g, '')}</h1>`
      + '<p><a href="/tools">Back to all tools</a> · <a href="/tools/compliance-documents">Compliance &amp; Document Tools</a></p>'
      + '</body></html>');
    return;
  }
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Tools preview listening on http://0.0.0.0:${PORT}`);
});
