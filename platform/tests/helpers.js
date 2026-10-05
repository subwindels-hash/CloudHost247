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

/**
 * @param {object} [options] config overrides, plus an optional `seed` hook.
 *   `seed({ store, dir })` runs against the JSON store *before* the app is built, so fixtures are
 *   on disk when the app first reads them. (A second store opened afterwards would write to disk
 *   while the app's store keeps its own in-memory copy — seeding must happen first.)
 */
async function startServer(options = {}) {
  const { seed, ...overrides } = options;
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

  if (seed) {
    const { JsonStore } = require('../src/store/json-store');
    const seedStore = new JsonStore({ dir: dataDir, logger: { info() {}, warn() {}, error() {}, debug() {} } });
    await seedStore.connect();
    try {
      await seed({ store: seedStore, dir: dataDir });
    } finally {
      await seedStore.close(); // flushes to disk before the app loads it
    }
  }

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
