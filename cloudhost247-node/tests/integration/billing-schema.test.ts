import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { createUser } from '../../src/db/users';
import { createOrder } from '../../src/db/orders';
import { createInvoice, findInvoiceById, findInvoiceByOrderId, listInvoicesForUser, setInvoiceStatus } from '../../src/db/invoices';
import { listLedgerEntriesForInvoice, listLedgerEntriesForUser, recordLedgerEntry } from '../../src/db/billing-ledger';
import { createPayment, findPaymentByProviderReference, findPaymentById, listPaymentsForInvoice, updatePaymentStatus } from '../../src/db/payments';
import { withTransaction } from '../../src/db/transaction';

/**
 * Exercises the real Phase 5B schema (invoices, billing_ledger, payments) and its repository
 * functions against a real embedded Postgres engine (pglite) migrated with the actual committed
 * migration files — not mocks. Mirrors tests/integration/commerce-schema.test.ts's approach for
 * Phase 5A.
 */
describe('Phase 5B billing database schema and repositories', () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
  });

  afterEach(async () => {
    await db.close();
  });

  async function makeUser(email: string) {
    return createUser(db, { id: randomUUID(), email, passwordHash: 'hash', fullName: 'Test User' });
  }

  async function makeOrder(userId: string, totalAmount = '49.99') {
    const { order } = await createOrder(db, {
      id: randomUUID(),
      userId,
      currency: 'USD',
      subtotalAmount: totalAmount,
      discountAmount: '0.00',
      taxAmount: '0.00',
      totalAmount,
      items: [],
    });
    return order;
  }

  it('generates unique, sequential, zero-padded invoice numbers via invoice_number_seq', async () => {
    const user = await makeUser('inv1@example.com');
    const order1 = await makeOrder(user.id);
    const order2 = await makeOrder(user.id);

    const invoice1 = await createInvoice(db, {
      id: randomUUID(),
      orderId: order1.id,
      userId: user.id,
      currency: 'USD',
      subtotalAmount: '49.99',
      discountAmount: '0.00',
      taxAmount: '0.00',
      totalAmount: '49.99',
    });
    const invoice2 = await createInvoice(db, {
      id: randomUUID(),
      orderId: order2.id,
      userId: user.id,
      currency: 'USD',
      subtotalAmount: '49.99',
      discountAmount: '0.00',
      taxAmount: '0.00',
      totalAmount: '49.99',
    });

    expect(invoice1.invoice_number).toMatch(/^INV-\d{8}$/);
    expect(invoice2.invoice_number).toMatch(/^INV-\d{8}$/);
    expect(invoice1.invoice_number).not.toBe(invoice2.invoice_number);
    expect(invoice1.status).toBe('unpaid');
    expect(invoice1.due_date).toBeTruthy();
  });

  it('enforces one invoice per order (unique order_id)', async () => {
    const user = await makeUser('inv2@example.com');
    const order = await makeOrder(user.id);
    await createInvoice(db, {
      id: randomUUID(),
      orderId: order.id,
      userId: user.id,
      currency: 'USD',
      subtotalAmount: '10.00',
      discountAmount: '0.00',
      taxAmount: '0.00',
      totalAmount: '10.00',
    });

    await expect(
      createInvoice(db, {
        id: randomUUID(),
        orderId: order.id,
        userId: user.id,
        currency: 'USD',
        subtotalAmount: '10.00',
        discountAmount: '0.00',
        taxAmount: '0.00',
        totalAmount: '10.00',
      })
    ).rejects.toThrow();
  });

  it('rejects an invalid invoice status and a negative amount', async () => {
    const user = await makeUser('inv3@example.com');
    const order = await makeOrder(user.id);

    await expect(
      db.query(
        `INSERT INTO invoices (id, order_id, user_id, subtotal_amount, total_amount, status) VALUES ($1, $2, $3, 10, 10, 'overdue')`,
        [randomUUID(), order.id, user.id]
      )
    ).rejects.toThrow();

    await expect(
      db.query(`INSERT INTO invoices (id, order_id, user_id, subtotal_amount, total_amount) VALUES ($1, $2, $3, -5, -5)`, [
        randomUUID(),
        order.id,
        user.id,
      ])
    ).rejects.toThrow();
  });

  it('RESTRICTs deleting an order or user that has an invoice', async () => {
    const user = await makeUser('inv4@example.com');
    const order = await makeOrder(user.id);
    await createInvoice(db, {
      id: randomUUID(),
      orderId: order.id,
      userId: user.id,
      currency: 'USD',
      subtotalAmount: '10.00',
      discountAmount: '0.00',
      taxAmount: '0.00',
      totalAmount: '10.00',
    });

    await expect(db.query('DELETE FROM orders WHERE id = $1', [order.id])).rejects.toThrow();
    await expect(db.query('DELETE FROM users WHERE id = $1', [user.id])).rejects.toThrow();
  });

  it('finds an invoice by id and by order id, joined with the order number, and lists a user\'s invoices', async () => {
    const user = await makeUser('inv5@example.com');
    const order = await makeOrder(user.id);
    const invoice = await createInvoice(db, {
      id: randomUUID(),
      orderId: order.id,
      userId: user.id,
      currency: 'USD',
      subtotalAmount: '10.00',
      discountAmount: '0.00',
      taxAmount: '0.00',
      totalAmount: '10.00',
    });

    const byId = await findInvoiceById(db, invoice.id);
    expect(byId?.order_number).toBe(order.order_number);

    const byOrder = await findInvoiceByOrderId(db, order.id);
    expect(byOrder?.id).toBe(invoice.id);

    const forUser = await listInvoicesForUser(db, user.id);
    expect(forUser.map((i) => i.id)).toEqual([invoice.id]);
  });

  it('setInvoiceStatus updates status and updated_at (reserved for future phases, not called by 5B code)', async () => {
    const user = await makeUser('inv6@example.com');
    const order = await makeOrder(user.id);
    const invoice = await createInvoice(db, {
      id: randomUUID(),
      orderId: order.id,
      userId: user.id,
      currency: 'USD',
      subtotalAmount: '10.00',
      discountAmount: '0.00',
      taxAmount: '0.00',
      totalAmount: '10.00',
    });

    const updated = await setInvoiceStatus(db, invoice.id, 'paid');
    expect(updated?.status).toBe('paid');
  });

  describe('billing_ledger (append-only)', () => {
    it('records a charge entry and lists it for both the invoice and the user', async () => {
      const user = await makeUser('ledger1@example.com');
      const order = await makeOrder(user.id);
      const invoice = await createInvoice(db, {
        id: randomUUID(),
        orderId: order.id,
        userId: user.id,
        currency: 'USD',
        subtotalAmount: '10.00',
        discountAmount: '0.00',
        taxAmount: '0.00',
        totalAmount: '10.00',
      });

      const entry = await recordLedgerEntry(db, {
        id: randomUUID(),
        userId: user.id,
        invoiceId: invoice.id,
        entryType: 'charge',
        amount: '10.00',
        currency: 'USD',
        description: `Invoice ${invoice.invoice_number}`,
      });
      expect(entry.entry_type).toBe('charge');

      const forInvoice = await listLedgerEntriesForInvoice(db, invoice.id);
      expect(forInvoice.map((e) => e.id)).toEqual([entry.id]);
      const forUser = await listLedgerEntriesForUser(db, user.id);
      expect(forUser.map((e) => e.id)).toEqual([entry.id]);
    });

    it('rejects a zero/negative amount and an invalid entry_type', async () => {
      const user = await makeUser('ledger2@example.com');
      await expect(
        recordLedgerEntry(db, { id: randomUUID(), userId: user.id, invoiceId: null, entryType: 'credit', amount: '0.00', currency: 'USD', description: 'x' })
      ).rejects.toThrow();

      await expect(
        db.query(`INSERT INTO billing_ledger (id, user_id, entry_type, amount, currency, description) VALUES ($1, $2, 'chargeback', 10, 'USD', 'x')`, [
          randomUUID(),
          user.id,
        ])
      ).rejects.toThrow();
    });

    it('is enforced insert-only at the database level: UPDATE and DELETE both fail, even outside the repository layer', async () => {
      const user = await makeUser('ledger3@example.com');
      const entry = await recordLedgerEntry(db, {
        id: randomUUID(),
        userId: user.id,
        invoiceId: null,
        entryType: 'credit',
        amount: '5.00',
        currency: 'USD',
        description: 'Goodwill credit',
      });

      await expect(db.query('UPDATE billing_ledger SET amount = 999 WHERE id = $1', [entry.id])).rejects.toThrow(/append-only/);
      await expect(db.query('DELETE FROM billing_ledger WHERE id = $1', [entry.id])).rejects.toThrow(/append-only/);

      const { rows } = await db.query('SELECT amount FROM billing_ledger WHERE id = $1', [entry.id]);
      expect((rows[0] as { amount: string }).amount).toBe('5.00');
    });

    it('a mutation attempt inside a transaction rolls back cleanly instead of corrupting other writes in the same transaction', async () => {
      const user = await makeUser('ledger4@example.com');
      const entry = await recordLedgerEntry(db, {
        id: randomUUID(),
        userId: user.id,
        invoiceId: null,
        entryType: 'credit',
        amount: '5.00',
        currency: 'USD',
        description: 'Goodwill credit',
      });

      await expect(
        withTransaction(db, async (tx) => {
          await tx.query('UPDATE billing_ledger SET amount = 999 WHERE id = $1', [entry.id]);
        })
      ).rejects.toThrow(/append-only/);

      const { rows } = await db.query('SELECT amount FROM billing_ledger WHERE id = $1', [entry.id]);
      expect((rows[0] as { amount: string }).amount).toBe('5.00');
    });

    it('RESTRICTs deleting an invoice that has ledger entries', async () => {
      const user = await makeUser('ledger5@example.com');
      const order = await makeOrder(user.id);
      const invoice = await createInvoice(db, {
        id: randomUUID(),
        orderId: order.id,
        userId: user.id,
        currency: 'USD',
        subtotalAmount: '10.00',
        discountAmount: '0.00',
        taxAmount: '0.00',
        totalAmount: '10.00',
      });
      await recordLedgerEntry(db, {
        id: randomUUID(),
        userId: user.id,
        invoiceId: invoice.id,
        entryType: 'charge',
        amount: '10.00',
        currency: 'USD',
        description: 'x',
      });

      await expect(db.query('DELETE FROM invoices WHERE id = $1', [invoice.id])).rejects.toThrow();
    });
  });

  describe('payments (schema-only in Phase 5B — no route creates these yet)', () => {
    it('creates a payment row in "pending" status by default and enforces its status/amount checks', async () => {
      const user = await makeUser('pay1@example.com');
      const order = await makeOrder(user.id);
      const invoice = await createInvoice(db, {
        id: randomUUID(),
        orderId: order.id,
        userId: user.id,
        currency: 'USD',
        subtotalAmount: '10.00',
        discountAmount: '0.00',
        taxAmount: '0.00',
        totalAmount: '10.00',
      });

      const payment = await createPayment(db, { id: randomUUID(), invoiceId: invoice.id, userId: user.id, amount: '10.00', currency: 'USD' });
      expect(payment.status).toBe('pending');

      await expect(
        db.query(`INSERT INTO payments (id, invoice_id, user_id, amount, currency, status) VALUES ($1, $2, $3, 10, 'USD', 'approved')`, [
          randomUUID(),
          invoice.id,
          user.id,
        ])
      ).rejects.toThrow();

      await expect(
        db.query(`INSERT INTO payments (id, invoice_id, user_id, amount, currency) VALUES ($1, $2, $3, 0, 'USD')`, [randomUUID(), invoice.id, user.id])
      ).rejects.toThrow();
    });

    it('enforces idempotency: the same (provider, provider_reference) can never be recorded twice', async () => {
      const user = await makeUser('pay2@example.com');
      const order = await makeOrder(user.id);
      const invoice = await createInvoice(db, {
        id: randomUUID(),
        orderId: order.id,
        userId: user.id,
        currency: 'USD',
        subtotalAmount: '10.00',
        discountAmount: '0.00',
        taxAmount: '0.00',
        totalAmount: '10.00',
      });

      await createPayment(db, {
        id: randomUUID(),
        invoiceId: invoice.id,
        userId: user.id,
        amount: '10.00',
        currency: 'USD',
        provider: 'sandbox',
        providerReference: 'txn_123',
      });

      await expect(
        createPayment(db, {
          id: randomUUID(),
          invoiceId: invoice.id,
          userId: user.id,
          amount: '10.00',
          currency: 'USD',
          provider: 'sandbox',
          providerReference: 'txn_123',
        })
      ).rejects.toThrow();

      // A different provider_reference (or no reference at all — e.g. a manual gateway payment)
      // must still be allowed.
      const second = await createPayment(db, { id: randomUUID(), invoiceId: invoice.id, userId: user.id, amount: '10.00', currency: 'USD' });
      expect(second.provider_reference).toBeNull();

      const found = await findPaymentByProviderReference(db, 'sandbox', 'txn_123');
      expect(found?.invoice_id).toBe(invoice.id);
    });

    it('updatePaymentStatus transitions status and records a failure reason / completion time', async () => {
      const user = await makeUser('pay3@example.com');
      const order = await makeOrder(user.id);
      const invoice = await createInvoice(db, {
        id: randomUUID(),
        orderId: order.id,
        userId: user.id,
        currency: 'USD',
        subtotalAmount: '10.00',
        discountAmount: '0.00',
        taxAmount: '0.00',
        totalAmount: '10.00',
      });
      const payment = await createPayment(db, { id: randomUUID(), invoiceId: invoice.id, userId: user.id, amount: '10.00', currency: 'USD' });

      const failed = await updatePaymentStatus(db, payment.id, 'failed', { failureReason: 'card_declined' });
      expect(failed?.status).toBe('failed');
      expect(failed?.failure_reason).toBe('card_declined');

      const found = await findPaymentById(db, payment.id);
      expect(found?.status).toBe('failed');

      const forInvoice = await listPaymentsForInvoice(db, invoice.id);
      expect(forInvoice.map((p) => p.id)).toEqual([payment.id]);
    });

    it('RESTRICTs deleting an invoice that has a payment', async () => {
      const user = await makeUser('pay4@example.com');
      const order = await makeOrder(user.id);
      const invoice = await createInvoice(db, {
        id: randomUUID(),
        orderId: order.id,
        userId: user.id,
        currency: 'USD',
        subtotalAmount: '10.00',
        discountAmount: '0.00',
        taxAmount: '0.00',
        totalAmount: '10.00',
      });
      await createPayment(db, { id: randomUUID(), invoiceId: invoice.id, userId: user.id, amount: '10.00', currency: 'USD' });

      await expect(db.query('DELETE FROM invoices WHERE id = $1', [invoice.id])).rejects.toThrow();
    });

    it('confirms no code path in this codebase currently creates a payment row (Phase 5B has no gateway yet)', async () => {
      // This is a structural assertion, not a DB assertion: src/routes/*.ts must not reference
      // src/db/payments.ts's createPayment as of Phase 5B. Grepping the actual route sources is
      // the most direct way to prove this without relying on prose alone.
      const fs = await import('node:fs');
      const path = await import('node:path');
      const routesDir = path.join(__dirname, '..', '..', 'src', 'routes');
      const files = fs.readdirSync(routesDir);
      for (const file of files) {
        const content = fs.readFileSync(path.join(routesDir, file), 'utf-8');
        expect(content.includes('createPayment')).toBe(false);
      }
    });
  });
  // --- Cross-row financial invariants (independent audit findings B1-B4) -----------------------
  //
  // The audit found that `payments` and `billing_ledger` rows could be written with a currency,
  // an owner, or an amount that disagreed with the invoice they belong to. Nothing in the
  // application produced such a row — each of these tables has exactly one writer, and all of
  // them derive their values from the invoice — but the invariant was enforced only by that
  // convention, not by the write path itself. A future second writer (Phase 5D's webhook
  // receiver is the obvious one) would have had nothing stopping it.
  //
  // `createPayment` and `recordLedgerEntry` now read the invoice inside the caller's transaction
  // and derive `user_id`/`currency` from it, with the amount checked against the invoice total in
  // the same statement, so these are no longer "shouldn't happen" cases but "can't happen" ones.
  describe('cross-row invariants against the parent invoice', () => {
    async function invoiceFor(email: string, total = '49.99') {
      const user = await makeUser(email);
      const order = await makeOrder(user.id, total);
      const invoice = await createInvoice(db, {
        id: randomUUID(),
        orderId: order.id,
        userId: user.id,
        currency: 'USD',
        subtotalAmount: total,
        discountAmount: '0.00',
        taxAmount: '0.00',
        totalAmount: total,
      });
      return { user, order, invoice };
    }

    it('B1: refuses a payment denominated in a different currency from its invoice', async () => {
      const { user, invoice } = await invoiceFor('b1@example.com');
      await expect(
        withTransaction(db, (tx) =>
          createPayment(tx, {
            id: randomUUID(),
            invoiceId: invoice.id,
            userId: user.id,
            amount: invoice.total_amount,
            currency: 'EUR',
            provider: 'manual',
          })
        )
      ).rejects.toThrow(/mismatch/i);
      expect(await listPaymentsForInvoice(db, invoice.id)).toHaveLength(0);
    });

    it('B2: refuses a payment attributed to a different user than its invoice', async () => {
      const { invoice } = await invoiceFor('b2@example.com');
      const stranger = await makeUser('b2-stranger@example.com');
      await expect(
        withTransaction(db, (tx) =>
          createPayment(tx, {
            id: randomUUID(),
            invoiceId: invoice.id,
            userId: stranger.id,
            amount: invoice.total_amount,
            currency: 'USD',
            provider: 'manual',
          })
        )
      ).rejects.toThrow(/mismatch/i);
      expect(await listPaymentsForInvoice(db, invoice.id)).toHaveLength(0);
    });

    it('B3: refuses a ledger entry attributed to a different user or currency than its invoice', async () => {
      const { user, invoice } = await invoiceFor('b3@example.com');
      const stranger = await makeUser('b3-stranger@example.com');

      await expect(
        withTransaction(db, (tx) =>
          recordLedgerEntry(tx, {
            id: randomUUID(),
            userId: stranger.id,
            invoiceId: invoice.id,
            entryType: 'credit',
            amount: '5.00',
            currency: 'USD',
            description: 'misattributed credit',
          })
        )
      ).rejects.toThrow(/mismatch/i);

      await expect(
        withTransaction(db, (tx) =>
          recordLedgerEntry(tx, {
            id: randomUUID(),
            userId: user.id,
            invoiceId: invoice.id,
            entryType: 'credit',
            amount: '5.00',
            currency: 'GBP',
            description: 'wrong-currency credit',
          })
        )
      ).rejects.toThrow(/mismatch/i);

      expect(await listLedgerEntriesForInvoice(db, invoice.id)).toHaveLength(0);
    });

    it('B4: refuses a payment larger than the invoice total', async () => {
      const { user, invoice } = await invoiceFor('b4@example.com', '49.99');
      await expect(
        withTransaction(db, (tx) =>
          createPayment(tx, {
            id: randomUUID(),
            invoiceId: invoice.id,
            userId: user.id,
            amount: '999999.00',
            currency: 'USD',
            provider: 'manual',
          })
        )
      ).rejects.toThrow(/no invoice .* accepts an amount/i);
      expect(await listPaymentsForInvoice(db, invoice.id)).toHaveLength(0);

      // One cent over is still over — the boundary must not be fuzzy.
      await expect(
        withTransaction(db, (tx) =>
          createPayment(tx, {
            id: randomUUID(),
            invoiceId: invoice.id,
            userId: user.id,
            amount: '50.00',
            currency: 'USD',
            provider: 'manual',
          })
        )
      ).rejects.toThrow(/accepts an amount/i);
    });

    it('still accepts every legitimate write, including exact-total and partial payments', async () => {
      const { user, invoice } = await invoiceFor('bok@example.com', '49.99');

      const exact = await withTransaction(db, (tx) =>
        createPayment(tx, {
          id: randomUUID(),
          invoiceId: invoice.id,
          userId: user.id,
          amount: '49.99',
          currency: 'USD',
          provider: 'manual',
        })
      );
      expect(exact.amount).toBe('49.99');
      expect(exact.user_id).toBe(user.id);
      expect(exact.currency).toBe('USD');

      const partial = await withTransaction(db, (tx) =>
        createPayment(tx, {
          id: randomUUID(),
          invoiceId: invoice.id,
          userId: user.id,
          amount: '10.00',
          currency: 'USD',
          provider: 'sandbox',
          providerReference: `ref-${randomUUID()}`,
        })
      );
      expect(partial.amount).toBe('10.00');

      const entry = await withTransaction(db, (tx) =>
        recordLedgerEntry(tx, {
          id: randomUUID(),
          userId: user.id,
          invoiceId: invoice.id,
          entryType: 'payment',
          amount: '49.99',
          currency: 'USD',
          description: 'legitimate payment',
        })
      );
      expect(entry.user_id).toBe(user.id);
      expect(entry.currency).toBe('USD');

      // A standalone, invoice-less ledger entry has no invoice to derive from and must still work.
      const standalone = await withTransaction(db, (tx) =>
        recordLedgerEntry(tx, {
          id: randomUUID(),
          userId: user.id,
          invoiceId: null,
          entryType: 'credit',
          amount: '3.00',
          currency: 'USD',
          description: 'account-level credit',
        })
      );
      expect(standalone.invoice_id).toBeNull();
      expect(standalone.user_id).toBe(user.id);
    });

    it('rolls back a valid write sitting beside a rejected one', async () => {
      const { user, invoice } = await invoiceFor('brollback@example.com');
      const stranger = await makeUser('brollback-stranger@example.com');

      await expect(
        withTransaction(db, async (tx) => {
          await createPayment(tx, {
            id: randomUUID(),
            invoiceId: invoice.id,
            userId: user.id,
            amount: '1.50',
            currency: 'USD',
            provider: 'manual',
          });
          // ...and then a cross-row violation in the same transaction.
          await createPayment(tx, {
            id: randomUUID(),
            invoiceId: invoice.id,
            userId: stranger.id,
            amount: '1.00',
            currency: 'USD',
            provider: 'manual',
          });
        })
      ).rejects.toThrow(/mismatch/i);

      // Neither write may survive.
      expect(await listPaymentsForInvoice(db, invoice.id)).toHaveLength(0);
    });

    it('holds every invariant under concurrent writes against the same invoice', async () => {
      const { user, invoice } = await invoiceFor('bconcurrent@example.com', '49.99');
      const stranger = await makeUser('bconcurrent-stranger@example.com');

      // A mix of legitimate and invariant-violating writes, all issued at once against the same
      // invoice. The violations must fail regardless of interleaving — enforcement that only
      // holds when requests arrive one at a time is not enforcement.
      const attempts = [
        { label: 'valid-1', userId: user.id, amount: '10.00', currency: 'USD', valid: true },
        { label: 'wrong-currency', userId: user.id, amount: '10.00', currency: 'EUR', valid: false },
        { label: 'wrong-user', userId: stranger.id, amount: '10.00', currency: 'USD', valid: false },
        { label: 'over-total', userId: user.id, amount: '999999.00', currency: 'USD', valid: false },
        { label: 'valid-2', userId: user.id, amount: '5.00', currency: 'USD', valid: true },
      ];

      const results = await Promise.allSettled(
        attempts.map((a) =>
          withTransaction(db, (tx) =>
            createPayment(tx, {
              id: randomUUID(),
              invoiceId: invoice.id,
              userId: a.userId,
              amount: a.amount,
              currency: a.currency,
              provider: 'sandbox',
              providerReference: `conc-${a.label}-${randomUUID()}`,
            })
          )
        )
      );

      attempts.forEach((a, i) => {
        expect(results[i].status, `${a.label} should have ${a.valid ? 'succeeded' : 'failed'}`).toBe(
          a.valid ? 'fulfilled' : 'rejected'
        );
      });

      // Only the two legitimate rows may exist, and both must match the invoice exactly.
      const stored = await listPaymentsForInvoice(db, invoice.id);
      expect(stored).toHaveLength(2);
      for (const row of stored) {
        expect(row.user_id).toBe(user.id);
        expect(row.currency).toBe('USD');
        expect(Number(row.amount)).toBeLessThanOrEqual(Number(invoice.total_amount));
      }
    });

    it('never lets concurrent ledger writes attribute an entry to the wrong owner', async () => {
      const { user, invoice } = await invoiceFor('bledgerconc@example.com');
      const stranger = await makeUser('bledgerconc-stranger@example.com');

      const results = await Promise.allSettled([
        withTransaction(db, (tx) =>
          recordLedgerEntry(tx, {
            id: randomUUID(),
            userId: user.id,
            invoiceId: invoice.id,
            entryType: 'credit',
            amount: '1.00',
            currency: 'USD',
            description: 'legitimate',
          })
        ),
        withTransaction(db, (tx) =>
          recordLedgerEntry(tx, {
            id: randomUUID(),
            userId: stranger.id,
            invoiceId: invoice.id,
            entryType: 'credit',
            amount: '1.00',
            currency: 'USD',
            description: 'misattributed',
          })
        ),
      ]);

      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('rejected');

      const entries = await listLedgerEntriesForInvoice(db, invoice.id);
      expect(entries).toHaveLength(1);
      expect(entries[0].user_id).toBe(user.id);
      // The append-only ledger cannot be corrected after the fact, so a wrong row surviving here
      // would be permanent.
      expect(await listLedgerEntriesForUser(db, stranger.id)).toHaveLength(0);
    });

    it('refuses a payment against an invoice that does not exist', async () => {
      await expect(
        withTransaction(db, (tx) =>
          createPayment(tx, {
            id: randomUUID(),
            invoiceId: randomUUID(),
            userId: randomUUID(),
            amount: '1.00',
            currency: 'USD',
            provider: 'manual',
          })
        )
      ).rejects.toThrow(/no invoice/i);
    });
  });
});
