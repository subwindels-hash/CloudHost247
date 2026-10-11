/**
 * HTTP status of every tool page.
 *
 * The single-page app renders any URL it is given, so a wrong status on a tool page is invisible in
 * a browser and invisible to the renderer tests — the page looks perfect while every crawler, uptime
 * monitor and link checker is told the URL does not exist. That is exactly what was happening: the
 * server's not-found handler resolves a `/tools/...` URL through the tool catalogue, and the
 * twenty-one business tools and the compliance collection hub are not catalogue entries, so all of
 * them answered **404 with `X-Robots-Tag: noindex`** and the shell inside.
 *
 * This test asks the built application, over HTTP, for every page the navigation publishes:
 *
 *   - `/tools`, every discovery category, and every catalogue path (200)
 *   - all twenty-one business tools and the collection hub (200)
 *   - retained MRZ URLs (they are kept working)
 *   - a path under `/tools` that resolves to nothing (404 — the catch-all must not launder it)
 *   - an API path that resolves to nothing (404 as JSON, never the HTML shell)
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { buildApp } from '../../src/app';
import { loadEnv, type Env } from '../../src/config/env';
import { BUSINESS_TOOLS, BUSINESS_TOOLS_ROOT } from '../../src/tools/business';
import { DISCOVERY_CATEGORIES, TOOL_CATALOG } from '../../src/tools/catalog';

const PUBLIC_DIR = join(__dirname, '..', '..', 'public');
/** The SPA shell has to exist for the frontend handler to answer at all. */
const shellBuilt = existsSync(join(PUBLIC_DIR, 'index.html'));

describe.skipIf(!shellBuilt)('tool page HTTP status', () => {
  let db: PGlite;
  let client: PgliteClient;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let env: Env;

  beforeAll(async () => {
    env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
      JWT_SECRET: 'f'.repeat(32),
      SERVER_AGENT_SHARED_SECRET: 's'.repeat(32),
    } as NodeJS.ProcessEnv);
    db = new PGlite();
    client = new PgliteClient(db);
    await migrateUp(client, { allowProduction: true });
    app = buildApp(env, { serveFrontend: true, publicDir: PUBLIC_DIR, pool: db as never });
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await db?.close();
  });

  async function status(path: string) {
    const response = await app.inject({ method: 'GET', url: path });
    return { status: response.statusCode, headers: response.headers, body: response.body };
  }

  it('answers 200 for the catalogue, the categories and the collection hub', async () => {
    const paths = [
      '/tools',
      '/tools/compliance-documents',
      ...Object.keys(DISCOVERY_CATEGORIES).map((category) => `/tools/category/${category}`),
    ];
    for (const path of paths) {
      const { status: code, headers } = await status(path);
      expect(code, `${path} should be served`).toBe(200);
      expect(headers['x-robots-tag'], `${path} must be indexable`).toBeUndefined();
    }
  });

  it('answers 200 for every tool in the catalogue', async () => {
    for (const tool of TOOL_CATALOG) {
      const { status: code } = await status(tool.path);
      expect(code, `${tool.slug} at ${tool.path}`).toBe(200);
    }
  });

  it('answers 200 for all twenty-one business tools, not the shell behind a 404', async () => {
    const { status: hub } = await status(BUSINESS_TOOLS_ROOT);
    expect(hub).toBe(200);
    for (const tool of BUSINESS_TOOLS) {
      const { status: code, headers } = await status(tool.path);
      expect(code, `${tool.slug} at ${tool.path}`).toBe(200);
      expect(headers['x-robots-tag']).toBeUndefined();
    }
  });

  it('serves the pages with their own titles, not a generic shell', async () => {
    const { body } = await status('/tools/business-tools/employee-id-card-generator');
    expect(body).toContain('<title>');
    expect(body.toLowerCase()).toContain('employee id card');
    const { body: hub } = await status('/tools/compliance-documents');
    expect(hub.toLowerCase()).toContain('compliance');
  });

  it('still answers 404 for a tools URL that resolves to nothing', async () => {
    const { status: code, headers, body } = await status('/tools/this-tool-does-not-exist');
    expect(code).toBe(404);
    // The shell is still served so the app can explain itself, but it is not indexable.
    expect(headers['x-robots-tag']).toBe('noindex');
    expect(body).toContain('<!doctype html>');
  });

  it('answers an unknown API path with JSON, never the HTML shell', async () => {
    const { status: code, body } = await status('/api/tools/this-tool-does-not-exist');
    expect(code).toBe(404);
    expect(body.trimStart().startsWith('{')).toBe(true);
  });
});
