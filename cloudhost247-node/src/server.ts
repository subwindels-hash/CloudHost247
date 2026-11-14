/**
 * Production/development server entry point (compiled to dist/src/server.js and loaded by the
 * repository-root server.js, which is what cPanel Passenger/Application Manager is configured
 * to start — see docs/CPANEL_DEPLOYMENT.md).
 *
 * Port binding: cPanel's Node.js Application Manager (Passenger) assigns and injects PORT (or a
 * Unix domain socket) into the process environment and reverse-proxies Apache/LiteSpeed traffic to
 * it. We must always bind to whatever PORT/socket is provided and never hardcode a production port.
 */
import http from 'node:http';
import path from 'node:path';
import dotenv from 'dotenv';
import { EnvValidationError, loadRuntimeEnv, type Env } from './config/env';
import { buildApp } from './app';
import { closePool } from './db/pool';
import type { Queryable } from './db/types';
import { HttpError } from './lib/errors';

// Load .env from <APP_ROOT>/.env first (regardless of cwd), then fallback to cwd/.env.
// dotenv never overwrites variables already injected by cPanel / Passenger.
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });
dotenv.config();

function isTruthyFlag(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes';
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Explicit fail-closed database handle used when DATABASE_URL is not yet configured on cPanel.
 * Public pages, navigation, legal docs, and stateless tools remain online (200 OK), while any
 * database-backed endpoint returns an honest 503 DATABASE_NOT_CONFIGURED JSON response rather than
 * crashing the entire Node worker with a host-level 503 error page.
 */
export function createUnconfiguredPool(): Queryable & { connect: () => Promise<never> } {
  const makeError = () =>
    new HttpError(
      503,
      'Database is not configured. Set DATABASE_URL in your environment variables and restart the application.',
      'DATABASE_NOT_CONFIGURED',
    );
  return {
    async query() {
      throw makeError();
    },
    async connect() {
      throw makeError();
    },
  };
}

export interface RuntimeAppBundle {
  app: ReturnType<typeof buildApp>;
  env: Env;
  warnings: string[];
  databaseConfigured: boolean;
}

export function createRuntimeApp(): RuntimeAppBundle {
  const { env, warnings, databaseConfigured } = loadRuntimeEnv(process.env);
  const pool = databaseConfigured ? undefined : createUnconfiguredPool();
  const app = buildApp(env, { pool });

  for (const warning of warnings) {
    // eslint-disable-next-line no-console
    console.warn(`[server] ${warning}`);
    app.log.warn(warning);
  }

  return { app, env, warnings, databaseConfigured };
}

function resolveRawListenTarget(): { path: string } | { port: number; host: string } {
  const explicitSocket = process.env.SOCKET_PATH?.trim();
  if (explicitSocket) return { path: explicitSocket };

  const rawPort = process.env.PORT?.trim();
  if (rawPort && /^(\/|unix:|\\\\\.\\pipe\\)/i.test(rawPort)) {
    return { path: rawPort.replace(/^unix:/i, '') };
  }

  const parsedPort = Number(rawPort);
  const port = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : 3000;
  return { port, host: '0.0.0.0' };
}

function startConfigDiagnosticServer(err: EnvValidationError): Promise<http.Server> {
  const issues = err.issues;
  const server = http.createServer((req, res) => {
    const pathname = (req.url ?? '/').split(/[?#]/)[0] || '/';
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ status: 'degraded', error: 'CONFIGURATION_ERROR' }));
      return;
    }

    if (pathname === '/ready' || pathname.startsWith('/api')) {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          status: 'error',
          error: 'CONFIGURATION_ERROR',
          message: 'Invalid environment configuration. Check application environment variables.',
          issues,
        }),
      );
      return;
    }

    const issueItems = issues.map((item) => `<li><code>${escapeHtml(item)}</code></li>`).join('');
    const html =
      '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<meta name="robots" content="noindex">' +
      '<title>Configuration Required | CloudHost247</title>' +
      '<style>body{margin:0;background:#101e2c;color:#fff;font:16px/1.65 system-ui,-apple-system,sans-serif}' +
      'main{max-width:760px;margin:8vh auto;padding:32px}h1{font-size:clamp(28px,4vw,40px);margin:0 0 12px}' +
      '.badge{display:inline-block;background:#1d354d;color:#b4f2cd;padding:4px 10px;border-radius:4px;font-size:13px;font-weight:600;margin-bottom:16px}' +
      '.card{background:#16283a;border:1px solid #294661;border-radius:8px;padding:20px;margin:20px 0}' +
      'code{background:#0b1520;color:#b4f2cd;padding:2px 6px;border-radius:4px;font-size:14px}' +
      'ul{margin:8px 0 0;padding-left:20px}li{margin:6px 0}p{color:#c6d3dd}</style></head>' +
      '<body><main><span class="badge">CloudHost247 Setup Check</span>' +
      '<h1>Environment Configuration Invalid</h1>' +
      '<p>The Node.js process is running, but one or more environment variables failed validation:</p>' +
      `<div class="card"><ul>${issueItems}</ul></div>` +
      '<p>Update these values in <strong>cPanel &rarr; Setup Node.js App &rarr; Environment variables</strong> (or <code>.env</code>), then click <strong>Restart</strong>.</p>' +
      '</main></body></html>';

    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  const target = resolveRawListenTarget();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(target, () => {
      // eslint-disable-next-line no-console
      console.error('[server] started in configuration-diagnostic mode until invalid environment variables are fixed.');
      const shutdown = () => {
        server.close(() => process.exit(0));
      };
      process.once('SIGTERM', shutdown);
      process.once('SIGINT', shutdown);
      resolve(server);
    });
  });
}

export interface ServerHandle {
  mode: 'live' | 'diagnostic';
  close: () => Promise<void>;
}

export async function startServer(): Promise<ServerHandle> {
  let bundle: RuntimeAppBundle;
  try {
    bundle = createRuntimeApp();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[server] fatal startup error:', err instanceof Error ? err.message : err);
    if (
      err instanceof EnvValidationError &&
      !isTruthyFlag(process.env.FAIL_FAST_STARTUP) &&
      !isTruthyFlag(process.env.DISABLE_AUTO_BUILD)
    ) {
      const diagServer = await startConfigDiagnosticServer(err);
      return {
        mode: 'diagnostic',
        close: () =>
          new Promise<void>((resolve, reject) => {
            diagServer.close((closeErr) => (closeErr ? reject(closeErr) : resolve()));
          }),
      };
    }
    process.exit(1);
  }

  const { app, env, databaseConfigured } = bundle;
  const listenOptions = env.SOCKET_PATH ? { path: env.SOCKET_PATH } : { port: env.PORT, host: '0.0.0.0' };

  await app.listen(listenOptions as never);
  app.log.info(
    {
      env: env.NODE_ENV,
      port: env.SOCKET_PATH ? undefined : env.PORT,
      socket: env.SOCKET_PATH,
      databaseConfigured,
    },
    'CloudHost247 server started',
  );

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
      await closePool();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };

  // cPanel/Passenger sends SIGTERM on restart/deploy; handle it gracefully so in-flight requests
  // finish and the DB pool is closed cleanly rather than the process being hard-killed.
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));

  return {
    mode: 'live',
    close: async () => {
      await app.close();
      await closePool();
    },
  };
}

const shouldAutoStart =
  !isTruthyFlag(process.env.CH247_DEFER_AUTORUN) &&
  (require.main === module || !process.env.VITEST);

if (shouldAutoStart) {
  startServer().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[server] fatal startup error:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
