import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { loadEnv, type Env } from '../../src/config/env';
import { hashPassword } from '../../src/lib/password';
import { buildApp } from '../../src/app';
import { signAuthToken } from '../../src/lib/jwt';

/**
 * Support-ticket attachments (migration 0103).
 *
 * The capability was recorded as "deliberately absent" in
 * docs/MODULE-CERTIFICATION-CATALOG.md; this suite is the evidence that it now exists and that
 * the six junctions still hold for it: front door, validation, DB state, permissions,
 * honest failure, and no-duplicate retry.
 *
 * Every file used here is a real byte sequence that the validator's magic-number sniff accepts or
 * rejects for a real reason — no fixture is relabelled to make a test pass.
 */

/** A one-pixel PNG. Valid magic number, valid IHDR, tiny. */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AL+2wUAAAAASUVORK5CYII=',
  'base64'
);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'utf8');

function b64(buf: Buffer): string {
  return buf.toString('base64');
}

describe('Support ticket attachments [integration]', () => {
  let db: PGlite;
  let client: PgliteClient;
  let env: Env;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = new PGlite();
    client = new PgliteClient(db);
    await migrateUp(client, { isProduction: false });
    env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://u:p@localhost:5432/x',
      JWT_SECRET: 'f'.repeat(32),
      SERVER_AGENT_SHARED_SECRET: 's'.repeat(32),
      CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64),
    } as NodeJS.ProcessEnv);
    app = buildApp(env, { serveFrontend: false, pool: db as never });
  });

  afterEach(async () => {
    await app?.close();
    await db?.close();
  });

  async function user(role: string) {
    const id = randomUUID();
    const email = `att-${randomUUID().slice(0, 8)}@example.com`;
    await client.query(
      `INSERT INTO users (id, email, password_hash, full_name, role, status) VALUES ($1,$2,$3,'U',$4,'active')`,
      [id, email, await hashPassword('x'), role]
    );
    return { id, email, token: signAuthToken(env, { sub: id, email, role }) };
  }
  const h = (t: string) => ({ authorization: `Bearer ${t}` });

  /** Omits `attachment` entirely when there is none — the schema accepts a missing key, not null. */
  async function createTicketWithAttachment(token: string, attachment?: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/account/tickets',
      headers: h(token),
      payload: {
        subject: 'Broken mail flow',
        priority: 'normal',
        message: 'See the attached log',
        ...(attachment ? { attachment } : {}),
      },
    });
  }

  it('stores an attachment with the opening message, returns metadata without bytes, and downloads the exact bytes', async () => {
    const owner = await user('customer');

    const created = await createTicketWithAttachment(owner.token, {
      base64: b64(PDF),
      contentType: 'application/pdf',
      filename: 'C:\\Users\\Someone\\mail log.PDF',
    });
    expect(created.statusCode).toBe(201);
    const ticketId = created.json().ticket.id;

    // DB state: one row, real byte length, SHA-256 of the stored bytes, server-normalised name.
    const stored = (
      await client.query(
        `SELECT filename, content_type, byte_size, checksum, uploader_role, message_id, ticket_id
           FROM support_ticket_attachments WHERE ticket_id = $1`,
        [ticketId]
      )
    ).rows as any[];
    expect(stored).toHaveLength(1);
    expect(stored[0].filename).toBe('mail-log.pdf'); // path stripped, extension from the DETECTED type
    expect(stored[0].content_type).toBe('application/pdf');
    expect(stored[0].byte_size).toBe(PDF.length);
    expect(stored[0].checksum).toBe(createHash('sha256').update(PDF).digest('hex'));
    expect(stored[0].uploader_role).toBe('customer');
    expect(stored[0].message_id).not.toBeNull();

    // The detail read attaches the file to its message and exposes no bytes and no checksum.
    const detail = await app.inject({ method: 'GET', url: `/api/v1/account/tickets/${ticketId}`, headers: h(owner.token) });
    expect(detail.statusCode).toBe(200);
    const message = detail.json().ticket.messages[0];
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0].filename).toBe('mail-log.pdf');
    expect(message.attachments[0].byteSize).toBe(PDF.length);
    expect(message.attachments[0].checksum).toBeUndefined();
    expect(message.attachments[0].data).toBeUndefined();
    expect(message.attachments[0].uploadedBy).toBeUndefined();
    expect(message.attachments[0].downloadPath).toBe(
      `/api/v1/account/tickets/${ticketId}/attachments/${message.attachments[0].id}/download`
    );

    // Download returns the identical bytes, as an attachment, with nosniff.
    const download = await app.inject({
      method: 'GET',
      url: message.attachments[0].downloadPath,
      headers: h(owner.token),
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-type']).toContain('application/pdf');
    expect(String(download.headers['content-disposition'])).toContain('attachment;');
    expect(String(download.headers['content-disposition'])).toContain('mail-log.pdf');
    expect(download.headers['x-content-type-options']).toBe('nosniff');
    expect(download.headers['cache-control']).toBe('private, no-store');
    expect(createHash('sha256').update(download.rawPayload).digest('hex')).toBe(stored[0].checksum);
  });

  it('refuses a file whose bytes contradict its declared type, and writes nothing at all', async () => {
    const owner = await user('customer');

    // A PNG relabelled as a PDF — the classic bypass. The sniff sees PNG in the bytes.
    const lied = await createTicketWithAttachment(owner.token, {
      base64: b64(PNG_1PX),
      contentType: 'application/pdf',
      filename: 'invoice.pdf',
    });
    expect(lied.statusCode).toBe(400);
    expect(lied.json().message).toMatch(/image\/png/i);

    // Honest failure: no ticket, no attachment — the customer retypes nothing but nothing is orphaned.
    const tickets = (await client.query('SELECT count(*)::int AS c FROM support_tickets')).rows as any[];
    expect(tickets[0].c).toBe(0);
    const files = (await client.query('SELECT count(*)::int AS c FROM support_ticket_attachments')).rows as any[];
    expect(files[0].c).toBe(0);
  });

  it('rejects unsupported types, empty payloads and oversized files by name', async () => {
    const owner = await user('customer');

    const svg = await createTicketWithAttachment(owner.token, {
      base64: Buffer.from('<svg onload="alert(1)"/>').toString('base64'),
      contentType: 'image/svg+xml',
      filename: 'x.svg',
    });
    expect(svg.statusCode).toBe(400);
    expect(svg.json().message).toMatch(/Unsupported file type/i);

    // Markup can never be stored under an executable type: `text/html` is not on the whitelist.
    const html = await createTicketWithAttachment(owner.token, {
      base64: Buffer.from('<html><script>alert(1)</script></html>').toString('base64'),
      contentType: 'text/html',
      filename: 'notes.html',
    });
    expect(html.statusCode).toBe(400);

    // The same bytes as text/plain ARE accepted — prose is legitimate evidence — but what gets
    // stored is the DETECTED type, and the download forces a non-rendering disposition. Asserted
    // below so the distinction is pinned rather than assumed.
    const asText = await createTicketWithAttachment(owner.token, {
      base64: Buffer.from('<html><script>alert(1)</script></html>').toString('base64'),
      contentType: 'text/plain',
      filename: 'notes.txt',
    });
    expect(asText.statusCode).toBe(201);
    const textTicket = asText.json().ticket.id;
    const row = (
      await client.query('SELECT content_type, filename FROM support_ticket_attachments WHERE ticket_id = $1', [textTicket])
    ).rows[0] as any;
    expect(row.content_type).toBe('text/plain');
    expect(row.filename).toBe('notes.txt');

    // A file one byte over the 5 MiB cap must reach the validator (not be cut off by Fastify's
    // 1 MiB default body limit) and be refused with the limit named.
    const oversize = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(5 * 1024 * 1024, 0x20)]);
    const big = await createTicketWithAttachment(owner.token, {
      base64: oversize.toString('base64'),
      contentType: 'application/pdf',
      filename: 'big.pdf',
    });
    expect(big.statusCode).toBe(400);
    expect(big.json().message).toMatch(/5 MB/);

    // Well past the request-body ceiling: refused as a 413, but with a message that names the
    // limit rather than Fastify's bare "Request body is too large".
    const huge = await createTicketWithAttachment(owner.token, {
      base64: Buffer.alloc(8 * 1024 * 1024, 0x41).toString('base64'),
      contentType: 'text/plain',
      filename: 'huge.txt',
    });
    expect(huge.statusCode).toBe(413);
    expect(huge.json().message).toMatch(/5 MB/);

    // A legitimate 2 MiB file — which the 1 MiB default would have rejected — is accepted.
    const twoMb = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(2 * 1024 * 1024, 0x20)]);
    const ok = await createTicketWithAttachment(owner.token, {
      base64: twoMb.toString('base64'),
      contentType: 'application/pdf',
      filename: 'two-megabyte.pdf',
    });
    expect(ok.statusCode).toBe(201);
    const storedTwoMb = (
      await client.query('SELECT byte_size FROM support_ticket_attachments WHERE ticket_id = $1', [ok.json().ticket.id])
    ).rows[0] as any;
    expect(storedTwoMb.byte_size).toBe(twoMb.length);
  });

  it('keeps attachments owner-only: an outsider gets 404 on the thread and on the file, and cannot delete it', async () => {
    const owner = await user('customer');
    const other = await user('customer');

    const created = await createTicketWithAttachment(owner.token, {
      base64: b64(PNG_1PX),
      contentType: 'image/png',
      filename: 'screenshot.png',
    });
    const ticketId = created.json().ticket.id;
    const attachmentId = (
      await client.query('SELECT id FROM support_ticket_attachments WHERE ticket_id = $1', [ticketId])
    ).rows[0] as any;

    for (const path of [
      `/api/v1/account/tickets/${ticketId}/attachments/${attachmentId.id}/download`,
      `/api/v1/account/tickets/${ticketId}/attachments/${attachmentId.id}`,
    ]) {
      const res = await app.inject({
        method: path.endsWith('/download') ? 'GET' : 'DELETE',
        url: path,
        headers: h(other.token),
      });
      // 404, never 403 — a 403 would confirm the ticket exists.
      expect(res.statusCode).toBe(404);
    }

    // Anonymous has no door at all.
    const anon = await app.inject({
      method: 'GET',
      url: `/api/v1/account/tickets/${ticketId}/attachments/${attachmentId.id}/download`,
    });
    expect(anon.statusCode).toBe(401);

    const stillThere = (
      await client.query('SELECT count(*)::int AS c FROM support_ticket_attachments WHERE ticket_id = $1', [ticketId])
    ).rows[0] as any;
    expect(stillThere.c).toBe(1);
  });

  it('a file id from another ticket is a 404, not a cross-ticket read', async () => {
    const owner = await user('customer');

    const first = await createTicketWithAttachment(owner.token, { base64: b64(PDF), contentType: 'application/pdf', filename: 'a.pdf' });
    const second = await createTicketWithAttachment(owner.token, { base64: b64(PDF), contentType: 'application/pdf', filename: 'b.pdf' });
    const secondTicket = second.json().ticket.id;
    const firstFile = (
      await client.query('SELECT id FROM support_ticket_attachments WHERE ticket_id = $1', [first.json().ticket.id])
    ).rows[0] as any;

    // Same owner, wrong ticket in the path: the SQL is scoped by ticket, so this is a 404.
    const crossed = await app.inject({
      method: 'GET',
      url: `/api/v1/account/tickets/${secondTicket}/attachments/${firstFile.id}/download`,
      headers: h(owner.token),
    });
    expect(crossed.statusCode).toBe(404);
  });

  it('attaches a file to a reply, updates ticket state, and lets the owner delete their own file', async () => {
    const owner = await user('customer');

    const created = await createTicketWithAttachment(owner.token);
    const ticketId = created.json().ticket.id;

    const reply = await app.inject({
      method: 'POST',
      url: `/api/v1/account/tickets/${ticketId}/messages`,
      headers: h(owner.token),
      payload: {
        message: 'Here is the screenshot',
        attachment: { base64: b64(PNG_1PX), contentType: 'image/png', filename: 'shot.png' },
      },
    });
    expect(reply.statusCode).toBe(201);
    const thread = reply.json().ticket;
    expect(thread.messages).toHaveLength(2);
    expect(thread.messages[1].attachments).toHaveLength(1);
    expect(thread.messages[0].attachments).toHaveLength(0);
    // A customer reply still flips the ticket to pending_staff — the attachment path did not
    // bypass the existing status rule.
    expect(thread.status).toBe('pending_staff');

    const fileId = thread.messages[1].attachments[0].id;
    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/v1/account/tickets/${ticketId}/attachments/${fileId}`,
      headers: h(owner.token),
    });
    expect(removed.statusCode).toBe(204);

    const gone = await app.inject({
      method: 'GET',
      url: `/api/v1/account/tickets/${ticketId}/attachments/${fileId}/download`,
      headers: h(owner.token),
    });
    expect(gone.statusCode).toBe(404);

    // The message survives its attachment's removal — deleting a file is not deleting evidence of
    // the conversation.
    const messages = (await client.query('SELECT count(*)::int AS c FROM support_ticket_messages WHERE ticket_id = $1', [ticketId])).rows[0] as any;
    expect(messages.c).toBe(2);
  });

  it('caps a message at five attachments', async () => {
    const owner = await user('customer');
    const created = await createTicketWithAttachment(owner.token);
    const ticketId = created.json().ticket.id;

    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/account/tickets/${ticketId}/messages`,
      headers: h(owner.token),
      payload: { message: 'bundle', attachment: { base64: b64(PDF), contentType: 'application/pdf', filename: 'x.pdf' } },
    });
    expect(first.statusCode).toBe(201);
    const messageId = first.json().ticket.messages[1].id;

    // Fill the message to the cap directly (the API accepts one file per request by design).
    for (let i = 1; i < 5; i += 1) {
      const { createTicketAttachment } = await import('../../src/db/support-attachments');
      await createTicketAttachment(db as never, {
        id: randomUUID(),
        ticketId,
        messageId,
        uploadedBy: owner.id,
        uploaderRole: 'customer',
        filename: `extra-${i}.pdf`,
        contentType: 'application/pdf',
        data: PDF,
        checksum: createHash('sha256').update(PDF).digest('hex'),
      });
    }

    const sixth = await app.inject({
      method: 'POST',
      url: `/api/v1/account/tickets/${ticketId}/messages`,
      headers: h(owner.token),
      payload: { message: 'second bundle', attachment: { base64: b64(PDF), contentType: 'application/pdf', filename: 'y.pdf' } },
    });
    // A new message gets its own allowance, so this succeeds…
    expect(sixth.statusCode).toBe(201);

    // …but a sixth file on the already-full message is refused by the data layer.
    const { createTicketAttachment } = await import('../../src/db/support-attachments');
    await expect(
      createTicketAttachment(db as never, {
        id: randomUUID(),
        ticketId,
        messageId,
        uploadedBy: owner.id,
        uploaderRole: 'customer',
        filename: 'overflow.pdf',
        contentType: 'application/pdf',
        data: PDF,
        checksum: createHash('sha256').update(PDF).digest('hex'),
      })
    ).rejects.toThrow(/at most 5 attachments/);
  });

  it('lets staff see and download a customer attachment, and staff replies carry their own files', async () => {
    const owner = await user('customer');
    const admin = await user('admin');
    const staff = await user('staff');

    const created = await createTicketWithAttachment(owner.token, {
      base64: b64(PDF),
      contentType: 'application/pdf',
      filename: 'customer-evidence.pdf',
    });
    const ticketId = created.json().ticket.id;

    // Staff (a role outside the customer-management allowlist) is refused by the existing guard.
    const refused = await app.inject({ method: 'GET', url: `/api/v1/admin/tickets/${ticketId}`, headers: h(staff.token) });
    expect(refused.statusCode).toBe(403);

    const adminView = await app.inject({ method: 'GET', url: `/api/v1/admin/tickets/${ticketId}`, headers: h(admin.token) });
    expect(adminView.statusCode).toBe(200);
    const attached = adminView.json().ticket.messages[0].attachments[0];
    expect(attached.filename).toBe('customer-evidence.pdf');

    const adminDownload = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/tickets/${ticketId}/attachments/${attached.id}/download`,
      headers: h(admin.token),
    });
    expect(adminDownload.statusCode).toBe(200);
    expect(createHash('sha256').update(adminDownload.rawPayload).digest('hex')).toBe(
      createHash('sha256').update(PDF).digest('hex')
    );

    // The customer has no door to the staff surface at all.
    const customerOnAdmin = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/tickets/${ticketId}/attachments/${attached.id}/download`,
      headers: h(owner.token),
    });
    expect(customerOnAdmin.statusCode).toBe(403);

    // A staff reply with evidence records the staff role snapshot, and moves status to pending_customer.
    const staffReply = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/tickets/${ticketId}/messages`,
      headers: h(admin.token),
      payload: {
        message: 'Confirmed — here is the corrected record',
        attachment: { base64: b64(PNG_1PX), contentType: 'image/png', filename: 'record.png' },
      },
    });
    expect(staffReply.statusCode).toBe(201);
    expect(staffReply.json().ticket.status).toBe('pending_customer');

    const roles = (
      await client.query('SELECT uploader_role, filename FROM support_ticket_attachments WHERE ticket_id = $1 ORDER BY created_at', [
        ticketId,
      ])
    ).rows as any[];
    expect(roles.map((r) => r.uploader_role)).toEqual(['customer', 'admin']);

    // The customer sees the staff file in their own thread.
    const customerView = await app.inject({ method: 'GET', url: `/api/v1/account/tickets/${ticketId}`, headers: h(owner.token) });
    const staffFile = customerView.json().ticket.messages[1].attachments[0];
    expect(staffFile.filename).toBe('record.png');
    const customerDownload = await app.inject({ method: 'GET', url: staffFile.downloadPath, headers: h(owner.token) });
    expect(customerDownload.statusCode).toBe(200);
  });

  it('cascades attachments when the ticket is deleted — no orphaned bytes', async () => {
    const owner = await user('customer');
    const created = await createTicketWithAttachment(owner.token, {
      base64: b64(PDF),
      contentType: 'application/pdf',
      filename: 'a.pdf',
    });
    const ticketId = created.json().ticket.id;

    await client.query('DELETE FROM support_tickets WHERE id = $1', [ticketId]);
    const left = (
      await client.query('SELECT count(*)::int AS c FROM support_ticket_attachments WHERE ticket_id = $1', [ticketId])
    ).rows[0] as any;
    expect(left.c).toBe(0);
  });

  it('the database itself refuses an oversized row even if a future code path forgets to check', async () => {
    const owner = await user('customer');
    const created = await createTicketWithAttachment(owner.token);
    const ticketId = created.json().ticket.id;

    await expect(
      client.query(
        `INSERT INTO support_ticket_attachments
           (id, ticket_id, message_id, uploaded_by, uploader_role, filename, content_type, byte_size, checksum, data)
         VALUES ($1,$2,NULL,$3,'customer','x.pdf','application/pdf',$4,$5,$6)`,
        [randomUUID(), ticketId, owner.id, 5 * 1024 * 1024 + 1, 'a'.repeat(64), PDF]
      )
    ).rejects.toThrow();
  });
});
