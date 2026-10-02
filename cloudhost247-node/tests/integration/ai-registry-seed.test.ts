import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { signAuthToken } from '../../src/lib/jwt';
import { hashPassword } from '../../src/lib/password';
import { seedAgentRegistry } from '../../src/ai-os/registry/seed';
import { AGENT_CATALOG } from '../../src/ai-os/registry/agent-catalog';
import type { Queryable } from '../../src/db/types';

/**
 * Registry seeding against a real embedded PostgreSQL engine (PGlite) running the committed
 * migrations — the parts that only real SQL can prove:
 *
 *   1. every database gets its own agent-version history. The seed used to guard the initial
 *      `ai_agent_versions` insert with a process-global boolean, so the second and every later
 *      database seeded by the same process (exactly what a test suite does, and what a worker
 *      repointed at another pool does) silently got agents with no version rows at all;
 *   2. re-seeding never duplicates version rows — the catalog is re-asserted, the history is not;
 *   3. end-to-end self-heal: a boot whose seed failed still comes up, refuses to present an empty
 *      registry as the truth, and repairs itself on the next AUTHORIZED request;
 *   4. that repair is authorization-gated — an anonymous or non-staff caller can never be the thing
 *      that triggers registry writes.
 */

const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
  JWT_SECRET: 'h'.repeat(32),
} as NodeJS.ProcessEnv);

const REGISTRY_TABLES = ['ai_agents', 'ai_workflows', 'ai_model_configs'];

describe('AI registry seeding (real SQL)', () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
  });

  afterEach(async () => {
    await db.close();
  });

  async function createUser(role: 'customer' | 'super_admin', email: string): Promise<string> {
    const userId = randomUUID();
    const passwordHash = await hashPassword('correct-horse-battery');
    await db.query(`INSERT INTO users (id, email, password_hash, full_name, role) VALUES ($1,$2,$3,$4,$5)`, [
      userId, email, passwordHash, 'Test User', role,
    ]);
    return signAuthToken(env, { sub: userId, role, email });
  }

  /** Wraps PGlite so registry writes can be made to fail on demand (auth queries always pass). */
  function flakyRegistry(target: PGlite): Queryable & { failRegistryWrites: boolean; attempts: number } {
    const wrapper = {
      failRegistryWrites: true,
      attempts: 0,
      async query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }> {
        const touchesRegistry = REGISTRY_TABLES.some((table) => text.includes(table));
        if (touchesRegistry && text.trimStart().toUpperCase().startsWith('INSERT')) {
          wrapper.attempts += 1;
          if (wrapper.failRegistryWrites) {
            throw new Error('relation "ai_agents" is not available in this test');
          }
        }
        return target.query<T>(text, params as never);
      },
    };
    return wrapper;
  }

  it('gives every database in the process its own agent-version history', async () => {
    const second = new PGlite();
    await migrateUp(new PgliteClient(second), { isProduction: false });
    try {
      await seedAgentRegistry(db);
      await seedAgentRegistry(second);

      for (const target of [db, second]) {
        const { rows: agents } = await target.query<{ id: string }>(`SELECT id FROM ai_agents`);
        expect(agents).toHaveLength(AGENT_CATALOG.length);

        const { rows: versions } = await target.query<{ agent_id: string; version: number }>(
          `SELECT agent_id, version FROM ai_agent_versions`
        );
        // One version-1 row per agent — the audit trail of the initial code-catalog stamp.
        expect(versions).toHaveLength(AGENT_CATALOG.length);
        expect(new Set(versions.map((v) => v.agent_id)).size).toBe(AGENT_CATALOG.length);
        expect(versions.every((v) => v.version === 1)).toBe(true);
      }
    } finally {
      await second.close();
    }
  });

  it('re-applies the catalog on a re-seed without duplicating history or resurrecting a kill switch', async () => {
    await seedAgentRegistry(db);
    const { rows: [agent] } = await db.query<{ id: string; slug: string }>(
      `SELECT id, slug FROM ai_agents ORDER BY slug LIMIT 1`
    );
    // The operator kill switch: disabling an agent must survive the next sweep's re-seed.
    await db.query(`UPDATE ai_agents SET enabled = false WHERE id = $1`, [agent.id]);
    await db.query(`UPDATE ai_agents SET name = 'hand-edited name' WHERE id = $1`, [agent.id]);

    await seedAgentRegistry(db);

    const { rows: versions } = await db.query<{ agent_id: string }>(`SELECT agent_id FROM ai_agent_versions`);
    expect(versions).toHaveLength(AGENT_CATALOG.length);

    const { rows: [after] } = await db.query<{ enabled: boolean; name: string }>(
      `SELECT enabled, name FROM ai_agents WHERE id = $1`, [agent.id]
    );
    expect(after.enabled).toBe(false);
    // ...while code-owned catalog fields are re-asserted, never left as a hand edit.
    expect(after.name).not.toBe('hand-edited name');
  });

  it('boots through a failed seed, refuses to present an empty registry, then heals on an authorized request', async () => {
    const flaky = flakyRegistry(db);
    const app = buildApp(env, { serveFrontend: false, pool: flaky });
    const superAdmin = await createUser('super_admin', 'root@example.test');

    // 1. Boot succeeds even though the registry seed failed (this is the whole point).
    await expect(app.ready()).resolves.toBe(app);
    expect(flaky.attempts).toBeGreaterThan(0);
    const { rows: emptyAgents } = await db.query(`SELECT id FROM ai_agents`);
    expect(emptyAgents).toHaveLength(0);

    // 2. While the registry still cannot be written, the AI surface errors — it never answers 200
    //    with an empty workforce, which an operator would read as "we have no agents".
    const blocked = await app.inject({
      method: 'GET', url: '/api/v1/admin/ai/agents', headers: { authorization: `Bearer ${superAdmin}` },
    });
    expect(blocked.statusCode).toBe(500);
    expect(blocked.json()).not.toHaveProperty('agents');

    // 3. The database recovers; the very next authorized request re-seeds and answers fully.
    flaky.failRegistryWrites = false;
    const healed = await app.inject({
      method: 'GET', url: '/api/v1/admin/ai/agents', headers: { authorization: `Bearer ${superAdmin}` },
    });
    expect(healed.statusCode).toBe(200);
    expect(healed.json().count).toBe(AGENT_CATALOG.length);

    const { rows: workflows } = await db.query<{ slug: string }>(`SELECT slug FROM ai_workflows`);
    expect(workflows).toHaveLength(3);
    const { rows: versions } = await db.query<{ agent_id: string }>(`SELECT agent_id FROM ai_agent_versions`);
    expect(versions).toHaveLength(AGENT_CATALOG.length);

    await app.close();
  });

  it('never lets an unauthorized caller be the thing that triggers registry writes', async () => {
    const flaky = flakyRegistry(db);
    const app = buildApp(env, { serveFrontend: false, pool: flaky });
    const customer = await createUser('customer', 'customer@example.test');

    await app.ready();
    const attemptsAfterBoot = flaky.attempts;

    // Anonymous: rejected at the auth gate, no seed attempted.
    const anonymous = await app.inject({ method: 'GET', url: '/api/v1/admin/ai/agents' });
    expect(anonymous.statusCode).toBe(401);
    expect(flaky.attempts).toBe(attemptsAfterBoot);

    // Authenticated but not staff: rejected by the role check, still no seed attempted.
    const wrongRole = await app.inject({
      method: 'GET', url: '/api/v1/admin/ai/agents', headers: { authorization: `Bearer ${customer}` },
    });
    expect(wrongRole.statusCode).toBe(403);
    expect(flaky.attempts).toBe(attemptsAfterBoot);

    // Only after authorization does the registry write path become reachable.
    flaky.failRegistryWrites = false;
    const superAdmin = await createUser('super_admin', 'root2@example.test');
    const authorized = await app.inject({
      method: 'GET', url: '/api/v1/admin/ai/agents', headers: { authorization: `Bearer ${superAdmin}` },
    });
    expect(authorized.statusCode).toBe(200);
    expect(flaky.attempts).toBeGreaterThan(attemptsAfterBoot);

    await app.close();
  });
});
