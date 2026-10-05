/**
 * Test harness: boots the real application (buildApp) on an ephemeral port so tests exercise the
 * genuine HTTP pipeline — routing, middleware, static serving, error handling — exactly as
 * server.js runs it. No mocking of the request path.
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig } = require('../src/core/config');
const { buildApp } = require('../src/app');

async function startServer(overrides = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch247-test-'));

  const { config } = loadConfig({
    cwd: path.join(__dirname, '..'),
    overrides: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATA_DIR: dataDir,
      // The test binds its own ephemeral listener below; config.PORT is never used to listen here.
      ...overrides,
    },
  });

  const app = await buildApp(config);
  const server = http.createServer((req, res) => {
    app.handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  return {
    app,
    server,
    base,
    config,
    dataDir,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await app.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

async function jsonFetch(base, pathAndOptions, token) {
  const { method = 'GET', body, path } = pathAndOptions;
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data, headers: response.headers };
}

async function register(base, email = 'test@example.com', password = 'SuperSecret123!') {
  const res = await jsonFetch(base, {
    path: '/api/v1/auth/register',
    method: 'POST',
    body: { email, password, fullName: 'Test User' },
  });
  return res;
}

module.exports = { startServer, jsonFetch, register };
