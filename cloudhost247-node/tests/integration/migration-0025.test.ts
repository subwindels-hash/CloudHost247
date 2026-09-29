import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';

describe('migration 0025: extend auth_audit_log for admin billing events', () => {
  let db: PGlite;
  let client: PgliteClient;

  beforeEach(async () => {
    db = new PGlite();
    client = new PgliteClient(db);
    await migrateUp(client, { isProduction: false });
  });

  afterEach(async () => {
    await db.close();
  });

  it('accepts admin_invoice_refunded and admin_invoice_cancelled in auth_audit_log', async () => {
    const userRes = await client.query<{ id: string }>(
      `INSERT INTO users (id, email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [randomUUID(), 'staff@example.com', 'hash', 'Staff Admin', 'admin']
    );
    const userId = userRes.rows[0].id;

    // Test admin_invoice_refunded
    await expect(
      client.query(
        `INSERT INTO auth_audit_log (id, user_id, event_type, ip_address, metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), userId, 'admin_invoice_refunded', '127.0.0.1', JSON.stringify({ amount: '50.00' })]
      )
    ).resolves.toBeDefined();

    // Test admin_invoice_cancelled
    await expect(
      client.query(
        `INSERT INTO auth_audit_log (id, user_id, event_type, ip_address, metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), userId, 'admin_invoice_cancelled', '127.0.0.1', JSON.stringify({ reason: 'Abandoned' })]
      )
    ).resolves.toBeDefined();
  });

  it('rejects unrecognized audit event types', async () => {
    const userRes = await client.query<{ id: string }>(
      `INSERT INTO users (id, email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [randomUUID(), 'staff2@example.com', 'hash', 'Staff Admin', 'admin']
    );
    const userId = userRes.rows[0].id;

    await expect(
      client.query(
        `INSERT INTO auth_audit_log (id, user_id, event_type, ip_address, metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), userId, 'unauthorized_random_event', '127.0.0.1', '{}']
      )
    ).rejects.toThrow();
  });
});
