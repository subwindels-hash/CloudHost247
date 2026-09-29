import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';

describe('Migration 0024: create webhook_events and extend auth_audit_log', () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
  });

  afterEach(async () => {
    await db.close();
  });

  it('applies cleanly on a fresh database and creates webhook_events with all columns', async () => {
    const client = new PgliteClient(db);
    const result = await migrateUp(client, { isProduction: false });
    expect(result.applied).toContain('0024_create_webhook_events.sql');

    // Inspect columns of webhook_events
    const colsRes = await db.query<{ column_name: string; data_type: string; is_nullable: string }>(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'webhook_events'
      ORDER BY ordinal_position;
    `);

    const colNames = colsRes.rows.map((r) => r.column_name);
    expect(colNames).toEqual([
      'id',
      'gateway',
      'event_id',
      'transmission_id',
      'event_type',
      'provider_reference',
      'payment_id',
      'status',
      'payload_hash',
      'lease_expires_at',
      'processing_node_id',
      'error_message',
      'received_at',
      'processed_at',
    ]);

    // Verify updated_at is NOT in the table (confirming accurate schema spec)
    expect(colNames).not.toContain('updated_at');
  });

  it('enforces unique (gateway, event_id) constraint', async () => {
    const client = new PgliteClient(db);
    await migrateUp(client, { isProduction: false });

    await db.query(`
      INSERT INTO webhook_events (gateway, event_id, event_type, payload_hash, lease_expires_at)
      VALUES ('stripe', 'evt_123', 'payment.success', 'hash1', NOW() + INTERVAL '60s');
    `);

    // Duplicate insert must throw unique violation
    await expect(
      db.query(`
        INSERT INTO webhook_events (gateway, event_id, event_type, payload_hash, lease_expires_at)
        VALUES ('stripe', 'evt_123', 'payment.success', 'hash2', NOW() + INTERVAL '60s');
      `)
    ).rejects.toThrow();

    // Different gateway with same event_id is allowed
    await expect(
      db.query(`
        INSERT INTO webhook_events (gateway, event_id, event_type, payload_hash, lease_expires_at)
        VALUES ('paypal', 'evt_123', 'payment.success', 'hash2', NOW() + INTERVAL '60s');
      `)
    ).resolves.toBeDefined();
  });

  it('enforces webhook_events status CHECK constraint', async () => {
    const client = new PgliteClient(db);
    await migrateUp(client, { isProduction: false });

    const validStatuses = ['processing', 'completed', 'failed', 'rejected', 'ignored'];
    for (const status of validStatuses) {
      await db.query(`
        INSERT INTO webhook_events (gateway, event_id, event_type, status, payload_hash, lease_expires_at)
        VALUES ('stripe', 'evt_${status}', 'payment.success', '${status}', 'hash', NOW() + INTERVAL '60s');
      `);
    }

    // Invalid status must be rejected by CHECK constraint
    await expect(
      db.query(`
        INSERT INTO webhook_events (gateway, event_id, event_type, status, payload_hash, lease_expires_at)
        VALUES ('stripe', 'evt_invalid', 'payment.success', 'bogus_status', 'hash', NOW() + INTERVAL '60s');
      `)
    ).rejects.toThrow();
  });

  it('audit_log accepts all 12 pre-existing event types and the 2 new Phase 5D event types', async () => {
    const client = new PgliteClient(db);
    await migrateUp(client, { isProduction: false });

    const all14EventTypes = [
      'register',
      'login_success',
      'login_failure',
      'logout',
      'token_refresh',
      'profile_update',
      'password_change',
      'admin_status_change',
      'admin_role_change',
      'payment_initiated',
      'manual_payment_confirmed',
      'manual_payment_rejected',
      'webhook_payment_succeeded',
      'webhook_payment_failed',
    ];

    for (const eventType of all14EventTypes) {
      await db.query(`
        INSERT INTO auth_audit_log (id, event_type, metadata)
        VALUES ('${randomUUID()}', '${eventType}', '{}');
      `);
    }

    // Invalid event type rejected
    await expect(
      db.query(`
        INSERT INTO auth_audit_log (id, event_type, metadata)
        VALUES ('${randomUUID()}', 'arbitrary_invalid_event', '{}');
      `)
    ).rejects.toThrow();
  });

  it('verifies rollback drops webhook_events and restores 0022 audit log constraint', async () => {
    const client = new PgliteClient(db);
    await migrateUp(client, { isProduction: false });

    // Execute exact rollback SQL statements
    await db.query(`DROP TABLE IF EXISTS webhook_events CASCADE;`);
    await db.query(`ALTER TABLE auth_audit_log DROP CONSTRAINT IF EXISTS auth_audit_log_event_type_check;`);
    await db.query(`
      ALTER TABLE auth_audit_log ADD CONSTRAINT auth_audit_log_event_type_check CHECK (
        event_type IN (
          'register', 'login_success', 'login_failure', 'logout', 'token_refresh',
          'profile_update', 'password_change', 'admin_status_change', 'admin_role_change',
          'payment_initiated', 'manual_payment_confirmed', 'manual_payment_rejected'
        )
      );
    `);

    // Verify table dropped
    const tableRes = await db.query(`
      SELECT table_name FROM information_schema.tables WHERE table_name = 'webhook_events';
    `);
    expect(tableRes.rows).toHaveLength(0);

    // Verify 0022 event types still work
    await db.query(`INSERT INTO auth_audit_log (id, event_type, metadata) VALUES ('${randomUUID()}', 'payment_initiated', '{}')`);

    // Verify 5D event types are now rejected after rollback
    await expect(
      db.query(`INSERT INTO auth_audit_log (id, event_type, metadata) VALUES ('${randomUUID()}', 'webhook_payment_succeeded', '{}')`)
    ).rejects.toThrow();
  });
});
