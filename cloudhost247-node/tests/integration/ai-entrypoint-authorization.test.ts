import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { signAuthToken } from '../../src/lib/jwt';
import { seedAgentRegistry } from '../../src/ai-os/registry/seed';

const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://u:p@localhost/test', JWT_SECRET: 'z'.repeat(32), LOG_LEVEL: 'silent' });

describe('orchestration HTTP entry-point authorization', () => {
  let db: PGlite;
  let app: ReturnType<typeof buildApp>;
  let customer: { id: string; token: string }, other: { id: string; token: string };
  let staff: { id: string; token: string }, admin: { id: string; token: string }, superAdmin: { id: string; token: string }, demoted: { id: string; token: string };

  async function createUser(role: string) {
    const id = randomUUID(), email = `${id}@entry-auth.test`;
    await db.query(`INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'hash','Test User',$3)`, [id, email, role]);
    return { id, token: signAuthToken(env, { sub: id, role, email }) };
  }
  beforeAll(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
    await seedAgentRegistry(db);
    customer = await createUser('customer'); other = await createUser('customer'); staff = await createUser('staff');
    admin = await createUser('admin'); superAdmin = await createUser('super_admin'); demoted = await createUser('admin');
    await db.query(`UPDATE users SET role = 'staff' WHERE id = $1`, [demoted.id]);
    app = buildApp(env, { serveFrontend: false, pool: db });
  });
  afterAll(async () => { await app.close(); await db.close(); });

  const entries = [
    { url: '/api/v1/admin/ai/tasks', payload: { agentSlug: 'collector', taskType: 'billing.overdue_digest' } },
    { url: '/api/v1/admin/ai/copilot', payload: { command: 'show billing' } },
    { url: '/api/v1/admin/ai/board/briefings', payload: { type: 'daily' } },
    { url: '/api/v1/admin/ai/events', payload: { eventType: 'customer.created', processNow: false } },
  ];
  const inject = (url: string, payload: unknown, token?: string) => app.inject({ method: 'POST', url, payload, ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}) });
  async function counts() {
    const { rows } = await db.query<{ tasks: number; runs: number; events: number; reports: number }>(`SELECT
      (SELECT count(*)::int FROM ai_tasks) AS tasks, (SELECT count(*)::int FROM ai_runs) AS runs,
      (SELECT count(*)::int FROM ai_events) AS events, (SELECT count(*)::int FROM ai_executive_reports) AS reports`);
    return rows[0];
  }

  it('rejects unauthenticated, customer, staff and demoted-admin attempts before task or event creation', async () => {
    const before = await counts();
    for (const { url, payload } of entries) {
      for (const actor of [undefined, customer.token, staff.token, demoted.token]) {
        expect((await inject(url, payload, actor)).statusCode, `${url}: ${actor ? 'authenticated' : 'anonymous'}`).toBe(actor ? 403 : 401);
      }
    }
    expect(await counts()).toEqual(before);
  });

  it('allows admin and super-admin through permission gates but rejects malformed inputs before dispatch', async () => {
    const before = await counts();
    for (const { url } of entries) {
      for (const actor of [admin.token, superAdmin.token]) expect((await inject(url, {}, actor)).statusCode, url).toBe(400);
    }
    expect(await counts()).toEqual(before);
  });

  it('uses the current database role for an authorized event emission', async () => {
    await db.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [demoted.id]);
    try {
      const result = await inject('/api/v1/admin/ai/events', { eventType: 'customer.created', processNow: false }, demoted.token);
      expect(result.statusCode).toBe(200);
      const event = result.json().event;
      expect(event.source).toBe('admin');
      expect(result.json().dispatch).toBeNull();
      const audit = await db.query(`SELECT actor_id FROM audit_logs WHERE action = 'ai.event.emitted' AND resource_id = $1`, [event.id]);
      expect(audit.rows).toEqual([{ actor_id: demoted.id }]);
    } finally {
      await db.query(`UPDATE users SET role = 'staff' WHERE id = $1`, [demoted.id]);
    }
  });

  it('derives customer assistant task scope from authentication rather than client-supplied identity', async () => {
    const path = '/api/v1/account/ai/assistant';
    const body = { message: 'What is my account status?', customerId: other.id, actorUserId: other.id, entryPoint: 'admin.task' };
    expect((await inject(path, body)).statusCode).toBe(401);
    const result = await inject(path, body, customer.token);
    expect(result.statusCode).toBe(200);
    const taskId = result.json().taskId;
    const { rows } = await db.query(`SELECT requested_by_type, requested_by, customer_id, entry_point FROM ai_tasks WHERE id = $1`, [taskId]);
    expect(rows).toEqual([{ requested_by_type: 'customer', requested_by: customer.id, customer_id: customer.id, entry_point: 'customer.account_assistant' }]);
  });
});
