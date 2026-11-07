import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { buildApp } from '../../src/app';
import { loadEnv } from '../../src/config/env';

describe('public contact form', () => {
  it('stores the selected department and message in the staff inbox and rejects invalid input', async () => {
    const db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
    const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247', JWT_SECRET: 'a'.repeat(32) } as NodeJS.ProcessEnv);
    const app = buildApp(env, { serveFrontend: false, pool: db });
    try {
      const payload = { name: 'Ada', email: 'ada@example.com', department: 'Billing', subject: 'Invoice question', message: 'Please help with my invoice.' };
      const bad = await app.inject({ method: 'POST', url: '/api/v1/contact', payload: { ...payload, department: 'Unknown' } });
      expect(bad.statusCode).toBe(400);
      const response = await app.inject({ method: 'POST', url: '/api/v1/contact', payload });
      expect(response.statusCode).toBe(201);
      const { rows } = await db.query<{ subject: string; contact_email: string; body: string; unread_for_staff: number }>(
        `SELECT c.subject, c.contact_email, c.unread_for_staff, m.body FROM inbox_conversations c JOIN inbox_messages m ON m.conversation_id = c.id`
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ subject: '[Billing] Invoice question', contact_email: 'ada@example.com', body: payload.message, unread_for_staff: 1 });
    } finally {
      await app.close();
      await db.close();
    }
  }, 60000);
});
