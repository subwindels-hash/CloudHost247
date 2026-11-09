import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { signAuthToken } from '../../src/lib/jwt';
import { recordMessage } from '../../src/inbox/inbox-service';
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
      expect(response.json().received).toBe(true);
      const { rows } = await db.query<{ subject: string; contact_email: string; body: string; unread_for_staff: number }>(
        `SELECT c.subject, c.contact_email, c.unread_for_staff, m.body FROM inbox_conversations c JOIN inbox_messages m ON m.conversation_id = c.id`
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ subject: '[Billing] Invoice question', contact_email: 'ada@example.com', body: payload.message, unread_for_staff: 1 });

      const adminId = randomUUID();
      const customerId = randomUUID();
      await db.query(`INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,'admin@example.com','unused','Admin','admin'), ($2,'customer@example.com','unused','Customer','customer')`, [adminId, customerId]);
      const admin = { authorization: `Bearer ${signAuthToken(env, { sub: adminId, email: 'admin@example.com', role: 'admin' })}` };
      const customer = { authorization: `Bearer ${signAuthToken(env, { sub: customerId, email: 'customer@example.com', role: 'customer' })}` };
      const list = await app.inject({ method: 'GET', url: '/api/v1/inbox/conversations', headers: admin });
      expect(list.statusCode).toBe(200);
      const conversation = list.json().conversations[0];
      expect(conversation.contact_email).toBe(payload.email);
      const url = `/api/v1/inbox/conversations/${conversation.id}/messages`;
      expect((await app.inject({ method: 'POST', url, headers: customer, payload: { body: 'not allowed' } })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST', url, payload: { body: 'not allowed' } })).statusCode).toBe(401);

      vi.stubEnv('NOTIFICATION_EMAIL_WEBHOOK_URL', 'https://mailer.example.test/send');
      vi.stubEnv('NOTIFICATION_EMAIL_WEBHOOK_TOKEN', 'test-token');
      const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
      vi.stubGlobal('fetch', fetchMock);
      const sent = await app.inject({ method: 'POST', url, headers: admin, payload: { body: 'We can help.', visibility: 'public' } });
      expect(sent.statusCode).toBe(201);
      expect(sent.json()).toMatchObject({ deliveryStatus: 'sent', delivered: true });
      const [mailerUrl, request] = fetchMock.mock.calls[0];
      expect(mailerUrl).toBe('https://mailer.example.test/send');
      expect(JSON.parse(request.body)).toMatchObject({ to: payload.email, subject: '[Billing] Invoice question', text: 'We can help.', template: 'unified_inbox_reply' });
      const note = await app.inject({ method: 'POST', url, headers: admin, payload: { body: 'Private note', visibility: 'internal' } });
      expect(note.json().deliveryStatus).toBe('not_applicable');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
      const failed = await app.inject({ method: 'POST', url, headers: admin, payload: { body: 'Another reply' } });
      expect(failed.json()).toMatchObject({ deliveryStatus: 'failed', delivered: false });
      vi.stubEnv('NOTIFICATION_EMAIL_WEBHOOK_URL', '');
      const manual = await app.inject({ method: 'POST', url, headers: admin, payload: { body: 'Try later' } });
      expect(manual.json()).toMatchObject({ deliveryStatus: 'manual', delivered: false });
      expect(manual.json().deliveryNote).toMatch(/not sent/i);
      const stored = await db.query<{ delivery_status: string }>(`SELECT delivery_status FROM inbox_messages WHERE conversation_id = $1 AND direction = 'outbound' ORDER BY created_at`, [conversation.id]);
      expect(stored.rows.map((row) => row.delivery_status)).toEqual(['sent', 'not_applicable', 'failed', 'manual']);

      // Older Contact Us submissions used a department prefix without a source reference.
      const legacy = await recordMessage(db, { channelKind: 'web_form', subject: '[Legal] Previous enquiry', contactEmail: 'old@example.com', body: 'Hello' });
      vi.stubEnv('NOTIFICATION_EMAIL_WEBHOOK_URL', 'https://mailer.example.test/send');
      const legacyReply = await app.inject({ method: 'POST', url: `/api/v1/inbox/conversations/${legacy.conversationId}/messages`, headers: admin, payload: { body: 'Reply to old enquiry' } });
      expect(legacyReply.json().deliveryStatus).toBe('sent');
      const builder = await recordMessage(db, { channelKind: 'web_form', externalReference: 'builder-form:123', subject: '[Billing] A builder form', contactEmail: 'visitor@example.com', body: 'Hello' });
      const builderReply = await app.inject({ method: 'POST', url: `/api/v1/inbox/conversations/${builder.conversationId}/messages`, headers: admin, payload: { body: 'Manual reply' } });
      expect(builderReply.json().deliveryStatus).toBe('manual');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      await app.close();
      await db.close();
    }
  }, 60000);
});
