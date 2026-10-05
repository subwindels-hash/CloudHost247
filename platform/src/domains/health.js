/**
 * Health and readiness probes.
 *
 * Ported from cloudhost247-node/src/routes/health.ts.
 *
 *   GET /health  liveness  — process is up and answering HTTP. No storage access, so an
 *                            unreachable database never makes this fail. Uptime monitors rely
 *                            on that distinction.
 *   GET /ready   readiness — storage is reachable. 503 when it is not. Never returns
 *                            connection strings, credentials or stack traces.
 */
'use strict';

const os = require('node:os');

const name = 'health';

function register(router, deps) {
  const { store, config } = deps;

  router.get('/health', (ctx) => {
    ctx.json({ status: 'ok' });
  });

  router.get('/healthz', (ctx) => ctx.json({ status: 'ok' }));

  router.get('/ready', async (ctx) => {
    const ok = await store.ping();
    ctx.code(ok ? 200 : 503);
    ctx.json({ status: ok ? 'ok' : 'error', checks: { storage: ok ? 'ok' : 'error' } });
  });

  // Detailed diagnostics. Deliberately exposes no secrets, paths or version fingerprints beyond
  // what the deployment already discloses, and is restricted to staff in production.
  router.get('/api/v1/system/status', async (ctx) => {
    const storageOk = await store.ping();
    const memory = process.memoryUsage();

    ctx.json({
      status: storageOk ? 'ok' : 'degraded',
      checks: { storage: storageOk ? 'ok' : 'error' },
      backend: store.backend,
      uptimeSeconds: Math.round(process.uptime()),
      nodeVersion: process.version,
      memory: {
        rssMb: Math.round(memory.rss / 1048576),
        heapUsedMb: Math.round(memory.heapUsed / 1048576),
        heapTotalMb: Math.round(memory.heapTotal / 1048576),
      },
      cpuCount: os.cpus().length,
      loadAverage: os.loadavg().map((n) => Math.round(n * 100) / 100),
      environment: config.NODE_ENV,
    });
  });
}

module.exports = { name, register };
