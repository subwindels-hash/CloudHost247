/**
 * Tests for spa/src/lib/format.js.
 *
 * The SPA is ESM (spa/package.json sets "type": "module"), so these files import directly by path.
 * JSX components are covered by the production build and the API-client tests; the pure formatting
 * logic gets real assertions here, including the awkward inputs (missing currency, null dates,
 * over-paid invoices) that a browser test would rarely hit.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'spa/src/lib/format.js')).href);

test('spa formatters', async (t) => {
  const fmt = await load();

  await t.test('money uses the invoice currency and survives a bad code', () => {
    assert.strictEqual(fmt.formatMoney(12.5, 'USD'), '$12.50');
    assert.strictEqual(fmt.formatMoney(1234.5, 'EUR'), '€1,234.50');
    assert.strictEqual(fmt.formatMoney(9, 'NOT-A-CODE'), '9.00', 'unknown currency still shows the amount');
    assert.strictEqual(fmt.formatMoney(null, 'USD'), '—');
    assert.strictEqual(fmt.formatMoney(undefined, 'USD'), '—');
    assert.strictEqual(fmt.formatMoney('abc', 'USD'), '—');
    assert.strictEqual(fmt.formatMoney(0, 'USD'), '$0.00', 'zero is an amount, not a blank');
  });

  await t.test('dates render in one format and never as "Invalid Date"', () => {
    assert.match(fmt.formatDate('2026-10-05T09:30:00.000Z'), /^0?5 Oct 2026$|^5 Oct 2026$/);
    assert.strictEqual(fmt.formatDate(null), '—');
    assert.strictEqual(fmt.formatDate('not a date'), '—');
    assert.notStrictEqual(fmt.formatDate('2026-10-05T09:30:00.000Z', { withTime: true }), '—');
    assert.match(fmt.formatDate('2026-10-05T09:30:00.000Z', { withTime: true }), /2026/);
  });

  await t.test('the balance is what is still owed, never negative and never a float artefact', () => {
    assert.strictEqual(fmt.invoiceBalance({ total: 100, amountPaid: 25 }), 75);
    assert.strictEqual(fmt.invoiceBalance({ total: 100, amountPaid: 100 }), 0);
    assert.strictEqual(fmt.invoiceBalance({ total: 100, amountPaid: 150 }), 0, 'over-payment is not a credit here');
    assert.strictEqual(fmt.invoiceBalance({ total: 0.3, amountPaid: 0.1 }), 0.2, 'no 0.19999999999999998');
    assert.strictEqual(fmt.invoiceBalance(null), 0);
    assert.strictEqual(fmt.invoiceBalance({ total: 'nope', amountPaid: 0 }), 0);
  });

  await t.test('overdue needs an unpaid invoice past its due date', () => {
    const past = new Date(Date.now() - 86400_000).toISOString();
    const future = new Date(Date.now() + 86400_000).toISOString();
    assert.strictEqual(fmt.isOverdue({ status: 'unpaid', total: 10, amountPaid: 0, dueAt: past }), true);
    assert.strictEqual(fmt.isOverdue({ status: 'paid', total: 10, amountPaid: 10, dueAt: past }), false);
    assert.strictEqual(fmt.isOverdue({ status: 'unpaid', total: 10, amountPaid: 0, dueAt: future }), false);
    assert.strictEqual(fmt.isOverdue({ status: 'unpaid', total: 10, amountPaid: 0, dueAt: null }), false);
    assert.strictEqual(fmt.isOverdue(null), false);
  });

  await t.test('statuses are humanised and map to a badge class', () => {
    assert.strictEqual(fmt.humanizeStatus('past_due'), 'Past due');
    assert.strictEqual(fmt.humanizeStatus('unpaid'), 'Unpaid');
    assert.strictEqual(fmt.humanizeStatus(''), '—');
    assert.strictEqual(fmt.humanizeStatus(null), '—');
    assert.strictEqual(fmt.statusClass('active'), 'status status-active');
    assert.strictEqual(fmt.statusClass('past_due'), 'status status-past_due');
    assert.strictEqual(fmt.statusClass(null), 'status status-unknown');
    assert.strictEqual(fmt.statusClass('"><script>'), 'status status-script', 'class names cannot break out');
  });
});
