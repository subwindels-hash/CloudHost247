/**
 * Production/development server entry point (compiled to dist/src/server.js and loaded by the
 * repository-root server.js, which is what cPanel Passenger/Application Manager is configured
 * to start — see docs/CPANEL_DEPLOYMENT.md).
 *
 * Port binding: cPanel's Node.js Application Manager (Passenger) assigns and injects PORT into
 * the process environment and reverse-proxies Apache traffic to it. We must always bind to
 * whatever PORT is provided and must never hardcode a production port. A fallback of 3000 is
 * only used for local `npm run dev`, where no hosting-provided PORT exists.
 */
import 'dotenv/config';
import { loadEnv } from './config/env';
import { buildApp } from './app';
import { closePool } from './db/pool';

async function main() {
  const env = loadEnv();
  const app = buildApp(env);

  const listenOptions = env.SOCKET_PATH ? { path: env.SOCKET_PATH } : { port: env.PORT, host: '0.0.0.0' };

  await app.listen(listenOptions as never);
  app.log.info({ env: env.NODE_ENV, port: env.SOCKET_PATH ? undefined : env.PORT }, 'CloudHost247 server started');

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
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[server] fatal startup error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
