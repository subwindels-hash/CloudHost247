'use strict';

/**
 * Pure-function coverage of the PostgreSQL adapter. A live server is not required (and is not
 * present in CI); these verify the SQL the adapter would emit, which is the risky, hand-rolled
 * part. Identifier quoting is allowlisted, so injection via request input is impossible by
 * construction.
 */

const test = require('node:test');
const assert = require('node:assert');
const { buildWhere, fromDriverRow, q } = require('../src/store/pg-store');
const { getTable } = require('../src/store/schema');

test('q quotes identifiers and rejects injection', () => {
  assert.strictEqual(q('users'), '"users"');
  assert.throws(() => q('users; DROP TABLE users'));
  assert.throws(() => q('weird"name'));
});

test('buildWhere emits parameterised SQL for equality', () => {
  const { clause, params } = buildWhere({ user_id: 'u1', status: 'active' });
  assert.strictEqual(clause, 'WHERE "user_id" = $1 AND "status" = $2');
  assert.deepStrictEqual(params, ['u1', 'active']);
});

test('buildWhere handles null as IS NULL and operators', () => {
  const { clause, params } = buildWhere({ deleted_at: null, price: { $gte: 5 }, name: { $like: '%web%' } });
  assert.ok(clause.includes('"deleted_at" IS NULL'));
  assert.ok(clause.includes('"price" >= $'));
  assert.ok(clause.includes('"name" ILIKE $'));
  assert.deepStrictEqual(params, [5, '%web%']);
});

test('buildWhere rejects function predicates (must run in SQL)', () => {
  assert.throws(() => buildWhere(() => true));
});

test('fromDriverRow normalises NUMERIC strings and JSONB', () => {
  const table = getTable('catalog_plan_pricing');
  const row = fromDriverRow(table, {
    id: 'x', plan_id: 'p', currency: 'USD', billing_cycle: 'monthly',
    price: '7.99', setup_fee: '0', is_active: true,
  });
  assert.strictEqual(row.price, 7.99, 'NUMERIC string -> number, same as JSON store');
  assert.strictEqual(row.is_active, true);
});

test('fromDriverRow parses JSONB strings and timestamps', () => {
  const table = getTable('catalog_product_plans');
  const row = fromDriverRow(table, {
    id: 'x', product_id: 'p', slug: 's', name: 'N', limits: '{"a":1}', metadata: '{}',
    created_at: new Date('2024-01-02T03:04:05Z'),
  });
  assert.deepStrictEqual(row.limits, { a: 1 });
  assert.strictEqual(row.created_at, '2024-01-02T03:04:05.000Z');
});
