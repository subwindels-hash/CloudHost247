import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { EnvValidationError, loadRuntimeEnv, resetEnvCache } from '../../src/config/env';
import { createUnconfiguredPool, startServer } from '../../src/server';

const APP_ROOT = path.resolve(__dirname, '..', '..');

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
    srv.on('error', reject);
  });
}

function httpGet(options: http.RequestOptions): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(options, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
  });
}

async function waitForHttp(
  options: http.RequestOptions,
  timeoutMs = 15_000,
): Promise<{ statusCode: number; body: string }> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await httpGet(options);
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  throw lastError ?? new Error('Timed out waiting for HTTP listener');
}

describe('cPanel / Passenger startup resilience against 503 crashes', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    resetEnvCache();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('boots cleanly and serves pages when JWT_SECRET and DATABASE_URL are unset', async () => {
    const publicDir = mkdtempSync(path.join(tmpdir(), 'ch247-cpanel-pub-'));
    tempDirs.push(publicDir);
    writeFileSync(
      path.join(publicDir, 'index.html'),
      '<!doctype html><html><head><title>CloudHost247</title><meta name="description" content="CloudHost247"></head><body>SPA OK</body></html>',
    );

    const { env, databaseConfigured, jwtSecretEphemeral, warnings } = loadRuntimeEnv({
      NODE_ENV: 'production',
      APP_URL: 'try.vortexprecisionit.com',
    } as NodeJS.ProcessEnv);

    expect(databaseConfigured).toBe(false);
    expect(jwtSecretEphemeral).toBe(true);
    expect(warnings.length).toBe(2);

    const app = buildApp(env, {
      serveFrontend: true,
      publicDir,
      pool: createUnconfiguredPool(),
    });

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: 'ok' });

    const ready = await app.inject({ method: 'GET', url: '/ready' });
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toEqual({ status: 'error', checks: { database: 'error' } });

    const status = await app.inject({ method: 'GET', url: '/api/v1/public/status' });
    expect(status.statusCode).toBe(200);
    const dbComponent = status.json().components.find((c: { id: string }) => c.id === 'database');
    expect(dbComponent?.state).toBe('degraded');

    const home = await app.inject({ method: 'GET', url: '/' });
    expect(home.statusCode).toBe(200);
    expect(home.body).toContain('SPA OK');

    const plans = await app.inject({ method: 'GET', url: '/api/v1/catalog/products/vps/plans' });
    expect(plans.statusCode).toBe(503);
    expect(plans.json().error).toBe('DATABASE_NOT_CONFIGURED');

    await app.close();
  });

  it('does not crash startup when public/ directory has not been built yet', async () => {
    const missingPublicDir = path.join(tmpdir(), `ch247-missing-pub-${Date.now()}`);
    const { env } = loadRuntimeEnv({ NODE_ENV: 'production' } as NodeJS.ProcessEnv);

    const app = buildApp(env, {
      serveFrontend: true,
      publicDir: missingPublicDir,
      pool: createUnconfiguredPool(),
    });

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);

    const home = await app.inject({ method: 'GET', url: '/' });
    expect(home.statusCode).toBe(503);
    expect(home.body).toContain('public/index.html');

    await app.close();
  });

  it('enters secret-free diagnostic mode instead of exiting when an explicit env var is malformed', async () => {
    const port = await getFreePort();
    const prevEnv = { ...process.env };
    try {
      process.env.NODE_ENV = 'production';
      process.env.PORT = String(port);
      process.env.HOST = '127.0.0.1';
      process.env.DATABASE_URL = 'mysql://secretuser:supersecretpass@localhost:3306/db';
      delete process.env.JWT_SECRET;

      expect(() => loadRuntimeEnv(process.env)).toThrow(EnvValidationError);

      const handle = await startServer();
      try {
        expect(handle.mode).toBe('diagnostic');
        const health = await httpGet({ host: '127.0.0.1', port, path: '/health' });
        expect(health.statusCode).toBe(200);
        expect(JSON.parse(health.body).status).toBe('degraded');

        const page = await httpGet({ host: '127.0.0.1', port, path: '/' });
        expect(page.statusCode).toBe(503);
        expect(page.body).toContain('Environment Configuration Invalid');
        expect(page.body).not.toContain('supersecretpass');
      } finally {
        await handle.close();
      }
    } finally {
      for (const k of Object.keys(process.env)) {
        if (!(k in prevEnv)) delete process.env[k];
      }
      Object.assign(process.env, prevEnv);
    }
  });

  it.skipIf(!existsSync(path.join(APP_ROOT, 'dist', 'src', 'server.js')))(
    'spawns server.js over a Passenger Unix domain socket in PORT with zero env secrets',
    async () => {
      const sockDir = mkdtempSync(path.join(tmpdir(), 'ch247-sock-'));
      tempDirs.push(sockDir);
      const sockPath = path.join(sockDir, 'passenger.sock');

      const child = spawn(process.execPath, [path.join(APP_ROOT, 'server.js')], {
        cwd: APP_ROOT,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          NODE_ENV: 'production',
          PORT: sockPath,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      try {
        const health = await waitForHttp({ socketPath: sockPath, path: '/health' });
        expect(health.statusCode).toBe(200);
        expect(JSON.parse(health.body)).toEqual({ status: 'ok' });

        const home = await httpGet({ socketPath: sockPath, path: '/' });
        expect(home.statusCode).toBe(200);
        expect(home.body.toLowerCase()).toContain('<!doctype html');
      } finally {
        child.kill('SIGTERM');
        await new Promise((resolve) => child.once('exit', resolve));
      }
    },
  );
});
