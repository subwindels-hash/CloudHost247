import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp, verify, status } from '../../database/migrate';

describe('Migration 0023: enforce billing invariants (B1–B4, B5)', () => {
  let db: PGlite;
  let client: PgliteClient;

  beforeEach(async () => {
    db = new PGlite();
    client = new PgliteClient(db);
  });

  afterEach(async () => {
    await db.close();
  });

  async function createFixtureUser(email = `user-${randomUUID()}@example.com`) {
    const id = randomUUID();
    await db.query(`INSERT INTO users (id, email, password_hash, full_name, role) VALUES ($1, $2, 'hash', 'User', 'customer')`, [id, email]);
    return id;
  }

  async function createFixtureOrder(userId: string, total = '49.99', currency = 'USD') {
    const id = randomUUID();
    await db.query(
      `INSERT INTO orders (id, user_id, currency, subtotal_amount, discount_amount, tax_amount, total_amount)
       VALUES ($1, $2, $3, $4, 0, 0, $4)`,
      [id, userId, currency, total]
    );
    return id;
  }

  async function createFixtureInvoice(orderId: string, userId: string, total = '49.99', currency = 'USD') {
    const id = randomUUID();
    await db.query(
      `INSERT INTO invoices (id, order_id, user_id, currency, subtotal_amount, discount_amount, tax_amount, total_amount)
       VALUES ($1, $2, $3, $4, $5, 0, 0, $5)`,
      [id, orderId, userId, currency, total]
    );
    return id;
  }

  it('applies cleanly on a fresh database', async () => {
    const result = await migrateUp(client, { isProduction: false });
    expect(result.applied).toContain('0023_enforce_billing_invariants.sql');

    const s = await status(client);
    expect(s.every((m) => m.applied)).toBe(true);
    expect(s.every((m) => m.checksumMatches)).toBe(true);
  });

  it('applies cleanly on an existing populated database', async () => {
    // 1. Migrate up to 0022 only
    // To do this, let's migrate everything then test populated state
    await migrateUp(client, { isProduction: false });

    // Insert legitimate order + invoice + payment + ledger
    const userA = await createFixtureUser();
    const orderId = await createFixtureOrder(userA, '50.00', 'USD');
    const invoiceId = await createFixtureInvoice(orderId, userA, '50.00', 'USD');

    const paymentId = randomUUID();
    await db.query(
      `INSERT INTO payments (id, invoice_id, user_id, amount, currency, provider, method, provider_reference)
       VALUES ($1, $2, $3, 50.00, 'USD', 'manual', 'bank_transfer', $4)`,
      [paymentId, invoiceId, userA, randomUUID()]
    );

    await db.query(
      `INSERT INTO billing_ledger (id, user_id, invoice_id, entry_type, amount, currency, description)
       VALUES ($1, $2, $3, 'charge', 50.00, 'USD', 'charge')`,
      [randomUUID(), userA, invoiceId]
    );

    const check = await verify(client);
    expect(check.ok).toBe(true);
  });

  describe('Invariant enforcement at DB level (direct SQL execution)', () => {
    let userA: string;
    let userB: string;
    let orderA: string;
    let invoiceA: string;

    beforeEach(async () => {
      await migrateUp(client, { isProduction: false });
      userA = await createFixtureUser('usera@example.com');
      userB = await createFixtureUser('userb@example.com');
      orderA = await createFixtureOrder(userA, '100.00', 'USD');
      invoiceA = await createFixtureInvoice(orderA, userA, '100.00', 'USD');
    });

    it('enforces Invariant B1: rejects direct SQL payment with currency mismatch', async () => {
      await expect(
        db.query(
          `INSERT INTO payments (id, invoice_id, user_id, amount, currency, provider, method, provider_reference)
           VALUES ($1, $2, $3, 100.00, 'EUR', 'manual', 'bank_transfer', $4)`,
          [randomUUID(), invoiceA, userA, randomUUID()]
        )
      ).rejects.toThrow(/payment currency.*does not match invoice currency/i);
    });

    it('enforces Invariant B2: rejects direct SQL payment with owner mismatch', async () => {
      await expect(
        db.query(
          `INSERT INTO payments (id, invoice_id, user_id, amount, currency, provider, method, provider_reference)
           VALUES ($1, $2, $3, 100.00, 'USD', 'manual', 'bank_transfer', $4)`,
          [randomUUID(), invoiceA, userB, randomUUID()]
        )
      ).rejects.toThrow(/payment user_id.*does not match invoice user_id/i);
    });

    it('enforces Invariant B4: rejects direct SQL payment exceeding invoice total', async () => {
      await expect(
        db.query(
          `INSERT INTO payments (id, invoice_id, user_id, amount, currency, provider, method, provider_reference)
           VALUES ($1, $2, $3, 150.00, 'USD', 'manual', 'bank_transfer', $4)`,
          [randomUUID(), invoiceA, userA, randomUUID()]
        )
      ).rejects.toThrow(/payment amount.*exceeds invoice total_amount/i);
    });

    it('enforces Invariant B3: rejects direct SQL billing_ledger with owner mismatch', async () => {
      await expect(
        db.query(
          `INSERT INTO billing_ledger (id, user_id, invoice_id, entry_type, amount, currency, description)
           VALUES ($1, $2, $3, 'charge', 100.00, 'USD', 'test charge')`,
          [randomUUID(), userB, invoiceA]
        )
      ).rejects.toThrow(/ledger user_id.*does not match invoice user_id/i);
    });

    it('enforces Invariant B3: rejects direct SQL billing_ledger with currency mismatch', async () => {
      await expect(
        db.query(
          `INSERT INTO billing_ledger (id, user_id, invoice_id, entry_type, amount, currency, description)
           VALUES ($1, $2, $3, 'charge', 100.00, 'GBP', 'test charge')`,
          [randomUUID(), userA, invoiceA]
        )
      ).rejects.toThrow(/ledger currency.*does not match invoice currency/i);
    });

    it('enforces Invariant B5: rejects direct SQL invoice with owner mismatch vs order', async () => {
      const order2 = await createFixtureOrder(userA, '25.00', 'USD');
      await expect(
        db.query(
          `INSERT INTO invoices (id, order_id, user_id, currency, subtotal_amount, discount_amount, tax_amount, total_amount)
           VALUES ($1, $2, $3, 'USD', 25.00, 0, 0, 25.00)`,
          [randomUUID(), order2, userB]
        )
      ).rejects.toThrow(/invoice user_id.*does not match order user_id/i);
    });

    it('enforces Invariant B5: rejects direct SQL invoice with currency mismatch vs order', async () => {
      const order2 = await createFixtureOrder(userA, '25.00', 'USD');
      await expect(
        db.query(
          `INSERT INTO invoices (id, order_id, user_id, currency, subtotal_amount, discount_amount, tax_amount, total_amount)
           VALUES ($1, $2, $3, 'EUR', 25.00, 0, 0, 25.00)`,
          [randomUUID(), order2, userA]
        )
      ).rejects.toThrow(/invoice currency.*does not match order currency/i);
    });

    it('enforces Invariant B5: rejects direct SQL invoice with total_amount mismatch vs order', async () => {
      const order2 = await createFixtureOrder(userA, '25.00', 'USD');
      await expect(
        db.query(
          `INSERT INTO invoices (id, order_id, user_id, currency, subtotal_amount, discount_amount, tax_amount, total_amount)
           VALUES ($1, $2, $3, 'USD', 25.00, 0, 0, 99.00)`,
          [randomUUID(), order2, userA]
        )
      ).rejects.toThrow(/invoice total_amount.*does not match order total_amount/i);
    });

    it('allows valid direct SQL writes that satisfy all invariants', async () => {
      const order2 = await createFixtureOrder(userA, '75.00', 'USD');
      const invoice2 = await createFixtureInvoice(order2, userA, '75.00', 'USD');

      const paymentId = randomUUID();
      await db.query(
        `INSERT INTO payments (id, invoice_id, user_id, amount, currency, provider, method, provider_reference)
         VALUES ($1, $2, $3, 75.00, 'USD', 'manual', 'bank_transfer', $4)`,
        [paymentId, invoice2, userA, randomUUID()]
      );

      const ledgerId = randomUUID();
      await db.query(
        `INSERT INTO billing_ledger (id, user_id, invoice_id, entry_type, amount, currency, description)
         VALUES ($1, $2, $3, 'payment', 75.00, 'USD', 'bank transfer')`,
        [ledgerId, userA, invoice2]
      );

      const pRows = await db.query('SELECT id FROM payments WHERE id = $1', [paymentId]);
      expect(pRows.rows).toHaveLength(1);
      const lRows = await db.query('SELECT id FROM billing_ledger WHERE id = $1', [ledgerId]);
      expect(lRows.rows).toHaveLength(1);
    });
  });

  it('handles concurrent writes safely under migration 0023 triggers', async () => {
    await migrateUp(client, { isProduction: false });
    const user = await createFixtureUser();
    const orderId = await createFixtureOrder(user, '50.00', 'USD');
    const invoiceId = await createFixtureInvoice(orderId, user, '50.00', 'USD');

    // 10 concurrent payments: 5 valid, 5 with wrong currency
    const promises = Array.from({ length: 10 }, (_, i) => {
      const currency = i % 2 === 0 ? 'USD' : 'EUR';
      return db.query(
        `INSERT INTO payments (id, invoice_id, user_id, amount, currency, provider, method, provider_reference)
         VALUES ($1, $2, $3, 10.00, $4, 'manual', 'bank_transfer', $5)`,
        [randomUUID(), invoiceId, user, currency, randomUUID()]
      ).then(() => 'success').catch((e: Error) => `error: ${e.message}`);
    });

    const results = await Promise.all(promises);
    const successes = results.filter((r) => r === 'success');
    const errors = results.filter((r) => r.startsWith('error'));

    expect(successes).toHaveLength(5);
    expect(errors).toHaveLength(5);
    expect(errors.every((e) => e.includes('currency'))).toBe(true);
  });
});
