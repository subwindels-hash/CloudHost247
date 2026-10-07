import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { effectiveTool, listEffectiveTools, TOOLS_DEGRADED_REASON } from '../../src/tools/core/registry';
import { runTool } from '../../src/tools/core/executor';
import { isToolError } from '../../src/tools/core/errors';

/**
 * What the Tools Center does when the platform database is unreachable.
 *
 * This is not a hypothetical: production ran exactly this way (GET /ready returned
 * {"status":"error","checks":{"database":"error"}}) and the whole Tools Center answered HTTP 500
 * with "Tools are temporarily unavailable" — a dead end for the customer and for support, because
 * the catalogue is static and was available the entire time.
 *
 * The behaviour asserted here is fail-closed *and* informative:
 *   - discovery still answers 200 with the real, complete catalogue,
 *   - every tool is reported SERVICE_UNAVAILABLE with the reason attached (never ACTIVE, and never
 *     a fabricated "disabled by an administrator" that no operator ever set),
 *   - execution refuses *before* it reads the abuse-block/rate-limit tables, so no protective
 *     control is skipped and no tool runs on unverified policy.
 *
 * The database is made unreachable by closing a real embedded engine, so every query rejects with
 * a genuine connection error rather than a mock's guess at one.
 */
describe('Tools Center with an unreachable database', () => {
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
    JWT_SECRET: 't'.repeat(32),
  } as NodeJS.ProcessEnv);

  let db: PGlite;
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
    app = buildApp(env, { serveFrontend: false, pool: db });
    await app.ready();
    // Everything after this point talks to a database that no longer answers.
    await db.close();
  });

  afterAll(async () => {
    await app.close().catch(() => undefined);
  });

  it('serves the catalogue with HTTP 200 and an honest degraded flag', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tools/catalog' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      success: boolean;
      degraded: boolean;
      degradedReason: string;
      count: number;
      tools: Array<{ slug: string; status: string; statusMessage: string | null; name: string; path: string }>;
    };
    expect(body.success).toBe(true);
    expect(body.degraded).toBe(true);
    expect(body.degradedReason).toContain('database is unreachable');
    // The catalogue is static, so it is still complete — the page renders real tools.
    expect(body.count).toBeGreaterThan(20);
    expect(body.tools.length).toBeGreaterThan(20);
    expect(body.tools.every((tool) => tool.status === 'SERVICE_UNAVAILABLE')).toBe(true);
    expect(body.tools.every((tool) => (tool.statusMessage ?? '').includes('database is unreachable'))).toBe(true);
    // Names and paths are catalogue data, unaffected by the outage.
    expect(body.tools.some((tool) => tool.slug === 'dns-lookup' && tool.path.length > 0)).toBe(true);
  });

  it('never claims an operator disabled the tools', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tools/catalog' });
    const body = res.json() as { tools: Array<{ status: string; statusMessage: string | null }> };
    // DISABLED/MAINTENANCE are operator decisions. Reporting them while the override table is
    // unreadable would attribute a policy to an operator who never set one.
    expect(body.tools.some((tool) => tool.status === 'DISABLED')).toBe(false);
    expect(body.tools.some((tool) => tool.status === 'MAINTENANCE')).toBe(false);
  });

  it('serves the dashboard rather than failing', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tools/dashboard' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      degraded: boolean;
      popular: unknown[];
      recent: unknown[];
      favorites: unknown[];
      statusSummary: Record<string, number>;
    };
    expect(body.degraded).toBe(true);
    // Usage panels are unreadable in this state, so they are empty rather than invented.
    expect(body.popular).toEqual([]);
    expect(body.recent).toEqual([]);
    expect(body.favorites).toEqual([]);
    expect(body.statusSummary.SERVICE_UNAVAILABLE).toBeGreaterThan(20);
  });

  it('refuses execution with SERVICE_UNAVAILABLE instead of a 500', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/dns-lookup',
      payload: { domain: 'example.com' },
    });
    // The tool must not run, and the customer must be told why. A generic INTERNAL_ERROR here was
    // the original defect: it named neither the cause nor the fix.
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    const body = res.json() as { success?: boolean; code?: string; message?: string; error?: string };
    const text = JSON.stringify(body);
    expect(text).toMatch(/SERVICE_UNAVAILABLE|unavailable/i);
    expect(text).toMatch(/database is unreachable/i);
    expect(text).not.toMatch(/unexpected error/i);
  });

  it('degrades at the registry level, which is what makes the routes safe', async () => {
    const result = await listEffectiveTools(db);
    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toContain(TOOLS_DEGRADED_REASON);
    expect(result.tools.every((tool) => tool.status === 'SERVICE_UNAVAILABLE')).toBe(true);
  });

  it('fails closed in the executor before reading abuse or rate-limit state', async () => {
    const tool = await effectiveTool(db, 'dns-lookup');
    expect(tool).not.toBeNull();
    expect(tool?.status).toBe('SERVICE_UNAVAILABLE');

    // The same closed database serves as the executor's client: if runTool touched the abuse-block
    // table first, the raw connection error would surface instead of the ToolError below.
    let thrown: unknown;
    try {
      await runTool(
        { db: db as never, env, caller: { ip: '203.0.113.9', userId: null, accountId: null } } as never,
        { tool: tool!, input: { domain: 'example.com' }, run: async () => ({ ok: true }) } as never,
      );
    } catch (err) {
      thrown = err;
    }
    expect(isToolError(thrown)).toBe(true);
    expect((thrown as { code: string }).code).toBe('SERVICE_UNAVAILABLE');
  });
});
