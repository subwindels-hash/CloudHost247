'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { v } = require('../src/core/validate');

test('string constraints', () => {
  assert.strictEqual(v.string().min(3).parse('hello'), 'hello');
  assert.throws(() => v.string().min(3).parse('hi'));
  assert.throws(() => v.string().email().parse('not-an-email'));
  assert.strictEqual(v.string().trim().toLowerCase().email().parse(' A@B.com '), 'a@b.com');
});

test('object strips unknown keys and applies defaults', () => {
  const schema = v.object({
    name: v.string().min(1),
    role: v.enum(['a', 'b']).default('a'),
  });
  const parsed = schema.parse({ name: 'x', hacker: 'yes' });
  assert.deepStrictEqual(parsed, { name: 'x', role: 'a' });
});

test('object collects every issue, not fail-fast', () => {
  const schema = v.object({
    email: v.string().email(),
    password: v.string().min(12),
    name: v.string().min(1),
  });
  const result = schema.safeParse({ email: 'bad', password: 'short', name: '' });
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.error.issues.length, 3);
});

test('required field missing errors', () => {
  const schema = v.object({ email: v.string() });
  assert.throws(() => schema.parse({}));
});

test('coerce number and boolean', () => {
  assert.strictEqual(v.coerce.number().int().positive().parse('42'), 42);
  assert.throws(() => v.coerce.number().positive().parse('-5'));
  assert.strictEqual(v.coerce.boolean().parse('true'), true);
  assert.strictEqual(v.coerce.boolean().parse('0'), false);
});

test('optional and nullable', () => {
  const schema = v.object({ a: v.string().optional(), b: v.string().nullable() });
  assert.deepStrictEqual(schema.parse({ b: null }), { b: null });
});

test('nested arrays and records', () => {
  const schema = v.object({
    items: v.array(v.object({ id: v.string() })),
    meta: v.record(v.string()),
  });
  const parsed = schema.parse({ items: [{ id: '1' }], meta: { k: 'v' } });
  assert.strictEqual(parsed.items[0].id, '1');
  assert.strictEqual(parsed.meta.k, 'v');
  assert.throws(() => schema.parse({ items: [{ nope: 1 }], meta: {} }));
});

test('refine and transform', () => {
  const slug = v.string().refine((s) => /^[a-z0-9-]+$/.test(s), 'bad slug');
  assert.throws(() => slug.parse('Bad Slug'));
  const upper = v.string().transform((s) => s.toUpperCase());
  assert.strictEqual(upper.parse('abc'), 'ABC');
});

test('union and literal', () => {
  const schema = v.union([v.literal('a'), v.literal('b')]);
  assert.strictEqual(schema.parse('a'), 'a');
  assert.throws(() => schema.parse('c'));
});
