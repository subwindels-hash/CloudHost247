#!/usr/bin/env node
/**
 * CloudHost247 Server Agent — HTTP entrypoint (spec §30, §31).
 *
 * Inbound API (all requests HMAC-signed by the control plane; see src/auth.js):
 *   GET  /v1/ping                       liveness + version
 *   GET  /v1/system/report              one system metrics snapshot
 *   POST /v1/apps/:project/deploy       write compose+.env, pull, up --detach
 *   POST /v1/apps/:project/teardown     down (+volumes) and remove the project dir
 *   POST /v1/apps/:project/start|stop|restart
 *   GET  /v1/apps/:project/status       container states
 *   GET  /v1/apps/:project/logs?tail=N
 *   POST /v1/apps/:project/healthcheck  manifest-declared probe
 *   POST /v1/apps/:project/backup       tar.gz volumes + db dump → backup dir
 *   POST /v1/apps/:project/restore      restore an archive from the backup dir
 *
 * Outbound (signed with the same secret):
 *   POST {control}/api/v1/agent/report  periodic metrics
 *   POST {control}/api/v1/agent/health  out-of-band health transitions
 *
 * There is deliberately NO endpoint that executes arbitrary commands, reads arbitrary paths, or
 * exposes the Docker socket. Adding one is a security review event, not a pull request.
 */
import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { AGENT_VERSION, loadConfig } from './config.js';
import { NonceCache, verifyRequest, signOutbound } from './auth.js';
import {
  appLogs,
  appStatus,
  deployApp,
  restartApp,
  runHealthcheck,
  startApp,
  stopApp,
  teardownApp,
  assertProjectName,
} from './docker.js';
import { runBackup, restoreBackup, systemReport } from './backups.js';

const config = loadConfig();
const nonceCache = new NonceCache(config.maxSkewSeconds);

function provisioningAttestation() {
  let fields = {};
  try {
    fields = Object.fromEntries(
      readFileSync('/etc/os-release', 'utf8')
        .split('\n')
        .filter((line) => line.includes('='))
        .map((line) => {
          const at = line.indexOf('=');
          return [line.slice(0, at), line.slice(at + 1).replace(/^"|"$/g, '')];
        })
    );
  } catch {
    // The control plane treats missing OS fields as an incomplete health check; never invent them.
  }
  return {
    osId: fields.ID,
    osVersion: fields.VERSION_ID ?? fields.BUILD_ID,
    hostname: hostname(),
    securityConfigured: existsSync('/var/lib/cloudhost247/security-configured'),
    monitoringRunning: true,
  };
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const rawBody = await readBody(req);

  const auth = verifyRequest({
    config,
    headers: req.headers,
    method: req.method,
    path: url.pathname,
    rawBody: rawBody.toString('utf8'),
    nonceCache,
  });
  if (!auth.ok) {
    send(res, 401, { error: 'UNAUTHORIZED', message: `request rejected: ${auth.reason}` });
    return;
  }

  // Route table — every handler is a fixed operation; nothing generic.
  try {
    // ---- liveness / metrics ---------------------------------------------------------------
    if (req.method === 'GET' && url.pathname === '/v1/ping') {
      send(res, 200, { ok: true, version: AGENT_VERSION, time: new Date().toISOString() });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/v1/system/report') {
      send(res, 200, { ...(await systemReport()), agentVersion: AGENT_VERSION, ...provisioningAttestation() });
      return;
    }

    // ---- per-project operations ------------------------------------------------------------
    const appMatch = /^\/v1\/apps\/([a-z0-9][a-z0-9_-]{3,63})\/([a-z]+)$/.exec(url.pathname);
    if (appMatch) {
      const project = assertProjectName(appMatch[1] ?? '');
      const operation = appMatch[2] ?? '';
      const body = rawBody.length > 0 ? JSON.parse(rawBody.toString('utf8')) : {};

      switch (`${req.method}:${operation}`) {
        case 'POST:deploy': {
          if (typeof body.composeYaml !== 'string' || typeof body.environment !== 'object') {
            send(res, 400, { error: 'BAD_REQUEST', message: 'composeYaml and environment are required' });
            return;
          }
          const result = await deployApp(config.appsDir, project, body);
          send(res, 200, result);
          return;
        }
        case 'POST:teardown': {
          send(res, 200, await teardownApp(config.appsDir, project, body.removeVolumes !== false));
          return;
        }
        case 'POST:start':
          send(res, 200, await startApp(config.appsDir, project));
          return;
        case 'POST:stop':
          send(res, 200, await stopApp(config.appsDir, project));
          return;
        case 'POST:restart':
          send(res, 200, await restartApp(config.appsDir, project));
          return;
        case 'GET:status':
          send(res, 200, await appStatus(config.appsDir, project));
          return;
        case 'GET:logs': {
          const tail = Number.parseInt(url.searchParams.get('tail') ?? '200', 10);
          send(res, 200, await appLogs(config.appsDir, project, Number.isFinite(tail) ? tail : 200));
          return;
        }
        case 'POST:healthcheck': {
          const check = body.check ?? {};
          send(res, 200, await runHealthcheck(config.appsDir, project, body.service ?? 'app', check));
          return;
        }
        case 'POST:backup': {
          const result = await runBackup(config.appsDir, config.backupDir, project, {
            includeVolumes: body.includeVolumes !== false,
            includeDatabases: body.includeDatabases !== false,
          });
          send(res, 200, result);
          return;
        }
        case 'POST:restore': {
          if (typeof body.archivePath !== 'string') {
            send(res, 400, { error: 'BAD_REQUEST', message: 'archivePath is required' });
            return;
          }
          send(res, 200, await restoreBackup(config.appsDir, config.backupDir, project, body.archivePath));
          return;
        }
        default:
          send(res, 404, { error: 'NOT_FOUND', message: `unknown operation ${req.method} ${operation}` });
          return;
      }
    }

    send(res, 404, { error: 'NOT_FOUND', message: 'no such endpoint' });
  } catch (err) {
    send(res, 500, { error: 'OPERATION_FAILED', message: String(err?.message ?? err).slice(0, 500) });
  }
});

server.listen(config.port, config.bind, () => {
  process.stdout.write(
    `[cloudhost247-agent] v${AGENT_VERSION} listening on ${config.bind}:${config.port} (apps: ${config.appsDir})\n`
  );
});

// --- Outbound metrics reporting loop -------------------------------------------------------------
if (config.reportSeconds > 0) {
  const report = async () => {
    try {
      const payload = JSON.stringify({ ...(await systemReport()), agentVersion: AGENT_VERSION, ...provisioningAttestation() });
      const headers = signOutbound(config, 'POST', '/api/v1/agent/report', payload);
      const response = await fetch(`${config.controlUrl}/api/v1/agent/report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: payload,
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        process.stderr.write(`[cloudhost247-agent] report failed: HTTP ${response.status}\n`);
      }
    } catch (err) {
      process.stderr.write(`[cloudhost247-agent] report error: ${err?.message ?? err}\n`);
    }
  };
  setInterval(report, config.reportSeconds * 1000);
  setTimeout(report, 3_000); // first report shortly after boot
}

const shutdown = (signal) => {
  process.stdout.write(`[cloudhost247-agent] ${signal} — closing\n`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
