#!/usr/bin/env node
/**
 * CloudHost247 platform — single entry point.
 *
 * A dependency-free monolith built on node:http. This file owns process lifecycle only:
 * configuration, storage connection, the HTTP listener, and graceful shutdown. All application
 * logic lives under src/.
 *
 * Runtime: Node.js >=22.20.0 <25. Core modules only — http, fs, path, crypto (plus the ones
 * src/core/* and src/lib/* need). The single optional dependency is pg@8.16.3, loaded lazily and
 * only when DATABASE_URL is set.
 *
 * Binding: the host supplies PORT (cPanel Passenger / Application Manager injects it). This file
 * never hardcodes a production port; 3000 is a development-only fallback declared in .env.
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const { loadConfig } = require('./src/core/config');
const { createLogger } = require('./src/core/logger');
const { buildApp } = require('./src/app');

const MIN_NODE = [22, 20, 0];

function checkNodeVersion() {
  const [major, minor, patch] = process.versions.node.split('.').map(Number);
  const current = [major, minor, patch];
  const ok = current[0] > MIN_NODE[0]
    || (current[0] === MIN_NODE[0] && (current[1] > MIN_NODE[1]
      || (current[1] === MIN_NODE[1] && current[2] >= MIN_NODE[2])));
  const tooNew = current[0] >= 25;

  if (!ok || tooNew) {
    process.stderr.write(
      `[server] Node.js ${MIN_NODE.join('.')} or newer (but below 25) is required; `
      + `this process is running ${process.versions.node}.\n`
    );
    process.exit(1);
  }
}

async function main() {
  checkNodeVersion();

  let config;
  let logger;
  try {
    const loaded = loadConfig({ cwd: __dirname });
    config = loaded.config;
    logger = createLogger({
      level: config.LOG_LEVEL,
      pretty: config.NODE_ENV !== 'production',
      base: { app: 'cloudhost247' },
    });
    for (const warning of loaded.warnings) logger.warn(warning);
  } catch (err) {
    process.stderr.write(`[server] configuration error: ${err.message}\n`);
    process.exit(1);
  }

  if (config.JWT_SECRET_EPHEMERAL) {
    logger.warn(
      'JWT_SECRET is not set. An ephemeral secret was generated for this process; '
      + 'every session will be invalidated on restart. Set a permanent JWT_SECRET before deploying.'
    );
  }

  let app;
  try {
    app = await buildApp(config, { logger });
  } catch (err) {
    logger.fatal({ err }, 'failed to start application');
    process.exit(1);
  }

  const server = http.createServer((req, res) => {
    // handle() never rejects: it converts every throw into an error response. The catch here is
    // a last-resort guard so a bug in the pipeline cannot leave a socket hanging open.
    app.handle(req, res).catch((err) => {
      logger.fatal({ err }, 'unhandled error in request pipeline');
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      }
      res.end(JSON.stringify({ error: 'INTERNAL_ERROR', message: 'An unexpected error occurred' }));
    });
  });

  // cPanel/Apache fronts this process; the kernel backlog and Node's defaults are fine, but an
  // explicit keep-alive timeout prevents slow clients holding sockets open indefinitely.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;
  server.requestTimeout = 120_000;

  const listenOptions = config.SOCKET_PATH
    ? { path: config.SOCKET_PATH }
    : { port: config.PORT, host: config.HOST };

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenOptions, resolve);
  });

  const address = server.address();
  logger.info(
    {
      env: config.NODE_ENV,
      url: config.SOCKET_PATH
        ? `unix:${config.SOCKET_PATH}`
        : `http://${config.HOST === '0.0.0.0' ? 'localhost' : config.HOST}:${address.port}`,
      storage: app.store.backend,
      pid: process.pid,
    },
    'CloudHost247 platform started'
  );

  let shuttingDown = false;

  /**
   * Graceful shutdown. cPanel/Passenger sends SIGTERM on restart and deploy; stopping the
   * listener first lets in-flight requests finish, then pending writes are flushed to disk.
   */
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');

    // Hard deadline: never let a hung connection block a deploy forever.
    const deadline = setTimeout(() => {
      logger.error('graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 10_000);
    deadline.unref();

    await new Promise((resolve) => server.close(resolve));
    try {
      await app.close();
    } catch (err) {
      logger.error({ err }, 'error while closing application');
    }
    logger.info('shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandled promise rejection');
  });
  process.on('uncaughtException', (err) => {
    // Log and exit: continuing after an uncaught exception risks serving corrupt state. The
    // process manager (Passenger/systemd/pm2) restarts us.
    logger.fatal({ err }, 'uncaught exception, exiting');
    void shutdown('uncaughtException');
  });

  // Flush the JSON store before the process is killed by anything we can observe.
  process.on('beforeExit', () => {
    try {
      if (app.store?.flushSync) app.store.flushSync();
    } catch {
      // Best effort on the way out.
    }
  });

  // Useful in development: touching this file asks the server to re-read static assets.
  if (config.NODE_ENV === 'development' && process.env.WATCH_PUBLIC) {
    const watchDir = path.resolve(config.PUBLIC_DIR);
    if (fs.existsSync(watchDir)) {
      fs.watch(watchDir, { recursive: true }, () => logger.debug('public assets changed'));
    }
  }

  return { server, app };
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[server] fatal startup error: ${err instanceof Error ? err.stack : err}\n`);
    process.exit(1);
  });
}

module.exports = { main };
