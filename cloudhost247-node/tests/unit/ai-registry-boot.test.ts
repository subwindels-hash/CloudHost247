import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { ensureAgentRegistrySeeded, seedAgentRegistry } from '../../src/ai-os/registry/seed';
import { AGENT_CATALOG } from '../../src/ai-os/registry/agent-catalog';
import type { Queryable } from '../../src/db/types';

/**
 * Boot must never depend on an AI registry write.
 *
 * The AI Control Plane used to seed its registry *inside route registration*, which runs while the
 * application is being built. That made "the database is unreachable right now" fatal to the whole
 * platform: `buildApp()`/`app.ready()` threw, so `/health` (contractually database-free), `/ready`
 * (whose entire job is to *report* an unreachable database) and every static/SPA route went down
 * with it, and Passenger kept restarting a process that could never come up while the database was
 * briefly unavailable.
 *
 * These tests pin the replacement contract:
 *   1. the app builds and becomes ready with the database unreachable, and still serves /health,
 *      /ready and JSON 404s — with the AI routes registered, not silently dropped;
 *   2. `ensureAgentRegistrySeeded` is single-flight (concurrent callers cannot double-run a seed
 *      that writes agent-version rows), a no-op after success, and RETRIES after a failure so a
 *      boot-time blip heals itself instead of leaving an empty registry for the process lifetime.
 */

const env = loadEnv({
  NODE_ENV: 'test',
  // Nothing is listening here on purpose: this is the "database is down" case.
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
  JWT_SECRET: 'a'.repeat(32),
} as NodeJS.ProcessEnv);

/** A Queryable that records the SQL it is given and answers every statement successfully. */
function fakeDb(options: { failTimes?: number } = {}): Queryable & { sql: string[]; seedRuns: () => number } {
  let failures = options.failTimes ?? 0;
  const sql: string[] = [];
  return {
    sql,
    seedRuns: () => sql.filter((text) => text.includes('INSERT INTO ai_agents')).length,
    async query<T = Record<string, unknown>>(text: string): Promise<{ rows: T[] }> {
      sql.push(text);
      if (failures > 0 && text.includes('INSERT INTO ai_agents')) {
        failures -= 1;
        throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
      }
      return { rows: [{ id: 'agent-1', slug: 'collector' }] as T[] };
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('platform boot does not depend on the AI registry seed', () => {
  it('builds and becomes ready with the database unreachable', async () => {
    const app = buildApp(env, { serveFrontend: false });
    // The regression this pins: this line used to reject with ECONNREFUSED because route
    // registration awaited the seed.
    await expect(app.ready()).resolves.toBe(app);
    await app.close();
  });

  it('still serves /health, /ready and JSON 404s while the database is unreachable', async () => {
    const app = buildApp(env, { serveFrontend: false });
    await app.ready();

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: 'ok' });

    const ready = await app.inject({ method: 'GET', url: '/ready' });
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toEqual({ status: 'error', checks: { database: 'error' } });

    const unknown = await app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({ error: 'NOT_FOUND', message: 'Resource not found' });

    await app.close();
  });

  it('keeps the AI routes registered (they fail per request, they are not dropped at boot)', async () => {
    const app = buildApp(env, { serveFrontend: false });
    await app.ready();

    // 401 (missing credentials) proves the route exists and reached its own auth gate; a 404 would
    // mean the AI surface was silently skipped because its seed failed.
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/ai/agents' });
    expect(res.statusCode).toBe(401);

    await app.close();
  });

  it('reports a boot seed failure in the log instead of throwing it at the operator', async () => {
    const app = buildApp(env, { serveFrontend: false });
    const warnings: string[] = [];
    app.log.warn = ((obj: unknown, msg?: string) => {
      warnings.push(typeof msg === 'string' ? msg : JSON.stringify(obj));
    }) as never;

    await app.ready();
    await app.close();

    expect(warnings.some((line) => line.includes('AI registry seed skipped at boot'))).toBe(true);
  });
});

describe('ensureAgentRegistrySeeded', () => {
  it('seeds the whole catalog, the default workflows and the model configs', async () => {
    const db = fakeDb();
    const result = await ensureAgentRegistrySeeded(db);

    expect(result).toEqual({ agents: AGENT_CATALOG.length, workflows: 3, models: 4 });
    expect(db.seedRuns()).toBe(AGENT_CATALOG.length);
    expect(db.sql.some((text) => text.includes('INSERT INTO ai_workflows'))).toBe(true);
    expect(db.sql.some((text) => text.includes('INSERT INTO ai_model_configs'))).toBe(true);
    // The initial version row is stamped once per agent for a database that has never been seeded.
    expect(db.sql.filter((text) => text.includes('INSERT INTO ai_agent_versions'))).toHaveLength(AGENT_CATALOG.length);
  });

  it('is a no-op once a database has been seeded — no query at all', async () => {
    const db = fakeDb();
    await ensureAgentRegistrySeeded(db);
    const queriesAfterFirstSeed = db.sql.length;

    const second = await ensureAgentRegistrySeeded(db);
    const third = await ensureAgentRegistrySeeded(db);

    expect(second).toBeNull();
    expect(third).toBeNull();
    expect(db.sql).toHaveLength(queriesAfterFirstSeed);
  });

  it('is single-flight: concurrent first callers share ONE seed run', async () => {
    const db = fakeDb();
    // Ten authorized requests arriving before the first seed finishes must not produce ten
    // overlapping seeds — that is how duplicate agent-version rows used to be possible.
    const results = await Promise.all(Array.from({ length: 10 }, () => ensureAgentRegistrySeeded(db)));

    expect(db.seedRuns()).toBe(AGENT_CATALOG.length);
    expect(db.sql.filter((text) => text.includes('INSERT INTO ai_agent_versions'))).toHaveLength(AGENT_CATALOG.length);
    // Every caller that joined the in-flight run resolves with the very same result object.
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toEqual({ agents: AGENT_CATALOG.length, workflows: 3, models: 4 });
    // A caller arriving after success is answered from the memo without touching the database.
    expect(await ensureAgentRegistrySeeded(db)).toBeNull();
  });

  it('retries after a failure rather than remembering the process as seeded', async () => {
    const db = fakeDb({ failTimes: 1 });

    await expect(ensureAgentRegistrySeeded(db)).rejects.toThrow(/ECONNREFUSED/);
    expect(db.seedRuns()).toBe(1);

    // The recovery path: the next caller (the next authorized request, or the worker sweep) gets a
    // full seed, so a boot-time database blip does not leave an empty registry behind forever.
    const healed = await ensureAgentRegistrySeeded(db);
    expect(healed).toEqual({ agents: AGENT_CATALOG.length, workflows: 3, models: 4 });
    expect(db.seedRuns()).toBe(1 + AGENT_CATALOG.length);
  });

  it('does not let one database seeding mark another database as seeded', async () => {
    const first = fakeDb();
    const second = fakeDb();

    await ensureAgentRegistrySeeded(first);
    expect(await ensureAgentRegistrySeeded(first)).toBeNull();

    // The old process-global flag made this second database skip its version rows entirely.
    const result = await ensureAgentRegistrySeeded(second);
    expect(result).not.toBeNull();
    expect(second.seedRuns()).toBe(AGENT_CATALOG.length);
    expect(second.sql.filter((text) => text.includes('INSERT INTO ai_agent_versions'))).toHaveLength(AGENT_CATALOG.length);
  });

  it('still re-applies the catalog when the worker sweep calls seedAgentRegistry directly', async () => {
    const db = fakeDb();
    await ensureAgentRegistrySeeded(db);
    const before = db.seedRuns();

    // A sweep must keep re-asserting the code-owned catalog every cycle; only the *ensure* wrapper
    // is memoized, never the seed itself.
    await seedAgentRegistry(db);
    expect(db.seedRuns()).toBe(before + AGENT_CATALOG.length);
    // ...and it must not re-stamp version rows for a database that already has them.
    expect(db.sql.filter((text) => text.includes('INSERT INTO ai_agent_versions'))).toHaveLength(AGENT_CATALOG.length);
  });
});
