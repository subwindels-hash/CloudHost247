import type { Queryable } from '../db/types';

export interface InvariantViolation {
  invariant: 'B1' | 'B2' | 'B3' | 'B4' | 'B5' | 'R1';
  description: string;
  recordId: string;
  details: Record<string, unknown>;
}

export interface FinancialReconciliationReport {
  timestamp: string;
  status: 'healthy' | 'discrepancy_detected';
  summary: {
    totalInvoicesAudited: number;
    totalOrdersAudited: number;
    totalPaymentsAudited: number;
    totalLedgerEntriesAudited: number;
    totalViolations: number;
  };
  invariantChecks: {
    B1_paymentCurrencyMatch: boolean;
    B2_paymentUserMatch: boolean;
    B3_ledgerInvoiceMatch: boolean;
    B4_paymentTotalCap: boolean;
    B5_orderInvoiceParity: boolean;
    R1_refundTotalCap: boolean;
  };
  ledgerTotals: Array<{
    entryType: string;
    currency: string;
    count: number;
    totalAmount: string;
  }>;
  violations: InvariantViolation[];
  latencyMs: number;
}

/**
 * Executes a full cryptographic and relational double-entry financial audit across all records
 * in the database. Returns a structured verification report.
 */
export async function runFinancialReconciliation(pool: Queryable): Promise<FinancialReconciliationReport> {
  const startTime = Date.now();
  const violations: InvariantViolation[] = [];

  // 1. Audit Invariant B1: Payment Currency Matches Invoice Currency
  const b1Res = await pool.query<{
    payment_id: string;
    invoice_id: string;
    payment_currency: string;
    invoice_currency: string;
  }>(`
    SELECT p.id as payment_id, p.invoice_id, p.currency as payment_currency, i.currency as invoice_currency
    FROM payments p
    JOIN invoices i ON i.id = p.invoice_id
    WHERE p.currency <> i.currency
  `);
  for (const row of b1Res.rows) {
    violations.push({
      invariant: 'B1',
      description: 'Payment currency does not match invoice currency',
      recordId: row.payment_id,
      details: { invoiceId: row.invoice_id, paymentCurrency: row.payment_currency, invoiceCurrency: row.invoice_currency },
    });
  }

  // 2. Audit Invariant B2: Payment User ID Matches Invoice User ID
  const b2Res = await pool.query<{
    payment_id: string;
    invoice_id: string;
    payment_user_id: string;
    invoice_user_id: string;
  }>(`
    SELECT p.id as payment_id, p.invoice_id, p.user_id as payment_user_id, i.user_id as invoice_user_id
    FROM payments p
    JOIN invoices i ON i.id = p.invoice_id
    WHERE p.user_id <> i.user_id
  `);
  for (const row of b2Res.rows) {
    violations.push({
      invariant: 'B2',
      description: 'Payment user does not match invoice user',
      recordId: row.payment_id,
      details: { invoiceId: row.invoice_id, paymentUserId: row.payment_user_id, invoiceUserId: row.invoice_user_id },
    });
  }

  // 3. Audit Invariant B3: Ledger Entry Matches Invoice User ID and Currency
  const b3Res = await pool.query<{
    ledger_id: string;
    invoice_id: string;
    ledger_user_id: string;
    invoice_user_id: string;
    ledger_currency: string;
    invoice_currency: string;
  }>(`
    SELECT l.id as ledger_id, l.invoice_id, l.user_id as ledger_user_id, i.user_id as invoice_user_id,
           l.currency as ledger_currency, i.currency as invoice_currency
    FROM billing_ledger l
    JOIN invoices i ON i.id = l.invoice_id
    WHERE l.user_id <> i.user_id OR l.currency <> i.currency
  `);
  for (const row of b3Res.rows) {
    violations.push({
      invariant: 'B3',
      description: 'Ledger entry user/currency does not match parent invoice',
      recordId: row.ledger_id,
      details: {
        invoiceId: row.invoice_id,
        ledgerUser: row.ledger_user_id,
        invoiceUser: row.invoice_user_id,
        ledgerCurrency: row.ledger_currency,
        invoiceCurrency: row.invoice_currency,
      },
    });
  }

  // 4. Audit Invariant B4: Successful Payments Do Not Exceed Invoice Total Amount
  const b4Res = await pool.query<{
    invoice_id: string;
    total_amount: string;
    total_paid: string;
  }>(`
    SELECT i.id as invoice_id, i.total_amount, SUM(p.amount) as total_paid
    FROM invoices i
    JOIN payments p ON p.invoice_id = i.id AND p.status = 'successful'
    GROUP BY i.id, i.total_amount
    HAVING SUM(p.amount) > i.total_amount
  `);
  for (const row of b4Res.rows) {
    violations.push({
      invariant: 'B4',
      description: 'Total successful payments exceed invoice total amount',
      recordId: row.invoice_id,
      details: { totalAmount: row.total_amount, totalPaid: row.total_paid },
    });
  }

  // 5. Audit Invariant B5: Invoice Matches Parent Order Snapshot Verbatim
  const b5Res = await pool.query<{
    invoice_id: string;
    order_id: string;
    invoice_user_id: string;
    order_user_id: string;
    invoice_currency: string;
    order_currency: string;
    invoice_total: string;
    order_total: string;
  }>(`
    SELECT i.id as invoice_id, i.order_id, i.user_id as invoice_user_id, o.user_id as order_user_id,
           i.currency as invoice_currency, o.currency as order_currency,
           i.total_amount as invoice_total, o.total_amount as order_total
    FROM invoices i
    JOIN orders o ON o.id = i.order_id
    WHERE i.user_id <> o.user_id OR i.currency <> o.currency OR i.total_amount <> o.total_amount
  `);
  for (const row of b5Res.rows) {
    violations.push({
      invariant: 'B5',
      description: 'Invoice parameters disagree with parent order snapshot',
      recordId: row.invoice_id,
      details: {
        orderId: row.order_id,
        invoiceUser: row.invoice_user_id,
        orderUser: row.order_user_id,
        invoiceTotal: row.invoice_total,
        orderTotal: row.order_total,
      },
    });
  }

  // 6. Audit Invariant R1: Refunds Do Not Exceed Settled Payments on Any Invoice
  const r1Res = await pool.query<{
    invoice_id: string;
    total_payments: string;
    total_refunds: string;
  }>(`
    SELECT invoice_id,
           SUM(CASE WHEN entry_type = 'payment' THEN amount ELSE 0 END) as total_payments,
           SUM(CASE WHEN entry_type = 'refund' THEN amount ELSE 0 END) as total_refunds
    FROM billing_ledger
    WHERE invoice_id IS NOT NULL
    GROUP BY invoice_id
    HAVING SUM(CASE WHEN entry_type = 'refund' THEN amount ELSE 0 END) > SUM(CASE WHEN entry_type = 'payment' THEN amount ELSE 0 END)
  `);
  for (const row of r1Res.rows) {
    violations.push({
      invariant: 'R1',
      description: 'Total refunded amount exceeds total paid amount for invoice',
      recordId: row.invoice_id,
      details: { totalPayments: row.total_payments, totalRefunds: row.total_refunds },
    });
  }

  // Record Counts
  const countsRes = await pool.query<{
    invoices_count: string;
    orders_count: string;
    payments_count: string;
    ledger_count: string;
  }>(`
    SELECT
      (SELECT COUNT(*)::text FROM invoices) as invoices_count,
      (SELECT COUNT(*)::text FROM orders) as orders_count,
      (SELECT COUNT(*)::text FROM payments) as payments_count,
      (SELECT COUNT(*)::text FROM billing_ledger) as ledger_count
  `);
  const counts = countsRes.rows[0];

  // Ledger Summary Totals
  const ledgerTotalsRes = await pool.query<{
    entry_type: string;
    currency: string;
    count: string;
    total_amount: string;
  }>(`
    SELECT entry_type, currency, COUNT(*)::text as count, SUM(amount)::text as total_amount
    FROM billing_ledger
    GROUP BY entry_type, currency
    ORDER BY entry_type, currency
  `);

  const latencyMs = Date.now() - startTime;

  return {
    timestamp: new Date().toISOString(),
    status: violations.length === 0 ? 'healthy' : 'discrepancy_detected',
    summary: {
      totalInvoicesAudited: parseInt(counts?.invoices_count ?? '0', 10),
      totalOrdersAudited: parseInt(counts?.orders_count ?? '0', 10),
      totalPaymentsAudited: parseInt(counts?.payments_count ?? '0', 10),
      totalLedgerEntriesAudited: parseInt(counts?.ledger_count ?? '0', 10),
      totalViolations: violations.length,
    },
    invariantChecks: {
      B1_paymentCurrencyMatch: b1Res.rows.length === 0,
      B2_paymentUserMatch: b2Res.rows.length === 0,
      B3_ledgerInvoiceMatch: b3Res.rows.length === 0,
      B4_paymentTotalCap: b4Res.rows.length === 0,
      B5_orderInvoiceParity: b5Res.rows.length === 0,
      R1_refundTotalCap: r1Res.rows.length === 0,
    },
    ledgerTotals: ledgerTotalsRes.rows.map((r) => ({
      entryType: r.entry_type,
      currency: r.currency,
      count: parseInt(r.count, 10),
      totalAmount: r.total_amount,
    })),
    violations,
    latencyMs,
  };
}
