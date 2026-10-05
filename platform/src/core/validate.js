/**
 * Schema validation — replaces `zod` with a dependency-free, chainable DSL.
 *
 * Design goals:
 *   1. Same call shape zod users expect: v.string().min(1).email(), v.object({...}), v.array(...)
 *   2. .parse() throws a ParseError carrying every collected issue (not fail-fast), so an API
 *      client learns about all problems in one round trip.
 *   3. .safeParse() returns { success, data | error }.
 *   4. Supports default(), optional(), nullable(), transform(), refine(), coerce, and enum —
 *      the exact surface used by the env schema and the route schemas.
 *   5. Steps run in declaration order, so `v.string().trim().email()` trims BEFORE the email
 *      check — matching zod's interleaved behaviour.
 *
 * It intentionally implements only what this codebase needs; every method is exercised by
 * tests/validate.test.js.
 */
'use strict';

const { ValidationError } = require('./errors');

const UNSET = Symbol('unset');

class Issue {
  constructor(path, message, code = 'custom') {
    this.path = path;
    this.message = message;
    this.code = code;
  }

  toString() {
    return this.path.length > 0 ? `${this.path.join('.')}: ${this.message}` : this.message;
  }
}

class ParseError extends Error {
  constructor(issues) {
    super(issues.map((i) => i.toString()).join('; '));
    this.name = 'ParseError';
    this.issues = issues;
  }

  toHttpError() {
    return new ValidationError('Validation failed', this.issues.map((i) => ({
      path: i.path,
      message: i.message,
      code: i.code,
    })));
  }
}

class ParseResult {
  constructor(success, data, issues) {
    this.success = success;
    if (success) this.data = data;
    else this.error = new ParseError(issues);
  }
}

class Schema {
  constructor(kind) {
    this.kind = kind;
    this._steps = [];
    this._optional = false;
    this._nullable = false;
    this._default = UNSET;
  }

  _clone() {
    const copy = Object.create(Object.getPrototypeOf(this));
    Object.assign(copy, this);
    copy._steps = [...this._steps];
    return copy;
  }

  optional() { const c = this._clone(); c._optional = true; return c; }
  nullable() { const c = this._clone(); c._nullable = true; return c; }
  nullish() { return this.optional().nullable(); }

  default(value) {
    const c = this._clone();
    c._default = value;
    c._optional = true;
    return c;
  }

  transform(fn) {
    const c = this._clone();
    c._steps = [...c._steps, { kind: 'transform', fn }];
    return c;
  }

  refine(predicate, message = 'Invalid value') {
    const c = this._clone();
    c._steps = [...c._steps, { kind: 'refine', predicate, message }];
    return c;
  }

  superRefine(fn) { return this.refine(fn, 'Invalid value'); }
  describe() { return this; }

  /** Dispatch a step. Subclasses override to add their own kinds, calling super for the rest. */
  _step(step, value, path, issues) {
    if (step.kind === 'transform') return step.fn(value);
    if (step.kind === 'refine') {
      let ok = false;
      try { ok = Boolean(step.predicate(value)); } catch { ok = false; }
      if (!ok) issues.push(new Issue(path, step.message, 'custom'));
    }
    return value;
  }

  /** Type check / coercion. Returns the typed value, pushing an invalid_type issue on mismatch. */
  _base(value) {
    return value;
  }

  _parse(value, path, issues) {
    if (value === undefined) {
      if (this._default !== UNSET) {
        value = typeof this._default === 'function' ? this._default() : this._default;
      } else if (this._optional) {
        return undefined;
      } else {
        issues.push(new Issue(path, 'Required', 'invalid_type'));
        return undefined;
      }
    }

    if (value === null) {
      if (this._nullable) return null;
      issues.push(new Issue(path, 'Expected value, received null', 'invalid_type'));
      return undefined;
    }

    const before = issues.length;
    let result = this._base(value, path, issues);
    const typeFailed = issues.slice(before).some((i) => i.code === 'invalid_type');
    if (typeFailed) return undefined;

    for (const step of this._steps) result = this._step(step, result, path, issues);
    return result;
  }

  parse(value) {
    const issues = [];
    const data = this._parse(value, [], issues);
    if (issues.length > 0) throw new ParseError(issues);
    return data;
  }

  safeParse(value) {
    const issues = [];
    const data = this._parse(value, [], issues);
    return issues.length > 0 ? new ParseResult(false, undefined, issues) : new ParseResult(true, data);
  }

  parseHttp(value) {
    const issues = [];
    const data = this._parse(value, [], issues);
    if (issues.length > 0) throw new ParseError(issues).toHttpError();
    return data;
  }
}

class StringSchema extends Schema {
  constructor() { super('string'); }

  _base(value, path, issues) {
    if (typeof value !== 'string') {
      issues.push(new Issue(path, `Expected string, received ${typeof value}`, 'invalid_type'));
      return undefined;
    }
    return value;
  }

  _step(step, value, path, issues) {
    switch (step.kind) {
      case 'min':
        if (value.length < step.value) issues.push(new Issue(path, `Must be at least ${step.value} character(s)`, 'too_small'));
        return value;
      case 'max':
        if (value.length > step.value) issues.push(new Issue(path, `Must be at most ${step.value} character(s)`, 'too_big'));
        return value;
      case 'regex':
        if (!step.value.test(value)) issues.push(new Issue(path, step.message ?? 'Invalid format', 'invalid_string'));
        return value;
      default:
        return super._step(step, value, path, issues);
    }
  }

  _add(kind, value, message) {
    const c = this._clone();
    c._steps = [...c._steps, { kind, value, message }];
    return c;
  }

  min(n) { return this._add('min', n); }
  max(n) { return this._add('max', n); }
  length(n) { return this.min(n).max(n); }
  regex(re, message) { return this._add('regex', re, message); }

  email() {
    return this.regex(/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/, 'Invalid email address');
  }

  url() {
    return this.refine((v) => {
      try {
        const u = new URL(v);
        return u.protocol === 'http:' || u.protocol === 'https:';
      } catch {
        return false;
      }
    }, 'Invalid URL');
  }

  uuid() {
    return this.regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, 'Invalid UUID');
  }

  datetime() {
    // ISO-8601 date-time, matching zod's .datetime(): YYYY-MM-DDTHH:mm:ss with optional
    // fractional seconds and a Z or ±HH:MM offset.
    return this.regex(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
      'Invalid ISO datetime',
    );
  }

  trim() { return this.transform((v) => v.trim()); }
  toLowerCase() { return this.transform((v) => v.toLowerCase()); }
  nonempty() { return this.min(1); }
}

class NumberSchema extends Schema {
  constructor(coerce = false) { super('number'); this._coerce = coerce; }

  _clone() { const c = super._clone(); c._coerce = this._coerce; return c; }

  _base(value, path, issues) {
    let n = value;
    if (this._coerce && typeof n !== 'number') {
      n = typeof n === 'string' && n.trim() !== '' ? Number(n) : Number.NaN;
    }
    if (typeof n !== 'number' || Number.isNaN(n)) {
      issues.push(new Issue(path, `Expected number, received ${typeof value}`, 'invalid_type'));
      return undefined;
    }
    return n;
  }

  _step(step, value, path, issues) {
    switch (step.kind) {
      case 'gte': if (!(value >= step.value)) issues.push(new Issue(path, `Must be >= ${step.value}`, 'too_small')); return value;
      case 'lte': if (!(value <= step.value)) issues.push(new Issue(path, `Must be <= ${step.value}`, 'too_big')); return value;
      case 'gt': if (!(value > step.value)) issues.push(new Issue(path, `Must be > ${step.value}`, 'too_small')); return value;
      case 'lt': if (!(value < step.value)) issues.push(new Issue(path, `Must be < ${step.value}`, 'too_big')); return value;
      case 'int': if (!Number.isInteger(value)) issues.push(new Issue(path, 'Must be an integer', 'invalid_type')); return value;
      case 'positive': if (!(value > 0)) issues.push(new Issue(path, 'Must be positive', 'too_small')); return value;
      default: return super._step(step, value, path, issues);
    }
  }

  _add(kind, value) { const c = this._clone(); c._steps = [...c._steps, { kind, value }]; return c; }

  int() { return this._add('int'); }
  positive() { return this._add('positive'); }
  min(n) { return this._add('gte', n); }
  max(n) { return this._add('lte', n); }
  gt(n) { return this._add('gt', n); }
  gte(n) { return this._add('gte', n); }
  lt(n) { return this._add('lt', n); }
  lte(n) { return this._add('lte', n); }
}

class BooleanSchema extends Schema {
  _base(value, path, issues) {
    if (this._coerce) {
      if (value === 'true' || value === '1' || value === true) return true;
      if (value === 'false' || value === '0' || value === false) return false;
    }
    if (typeof value !== 'boolean') {
      issues.push(new Issue(path, `Expected boolean, received ${typeof value}`, 'invalid_type'));
      return undefined;
    }
    return value;
  }
}

class EnumSchema extends Schema {
  constructor(values) { super('enum'); this.values = values; }
  _clone() { const c = super._clone(); c.values = this.values; return c; }
  _base(value, path, issues) {
    if (!this.values.includes(value)) {
      issues.push(new Issue(path, `Must be one of: ${this.values.join(', ')}`, 'invalid_enum_value'));
      return undefined;
    }
    return value;
  }
}

class LiteralSchema extends Schema {
  constructor(value) { super('literal'); this.expected = value; }
  _clone() { const c = super._clone(); c.expected = this.expected; return c; }
  _base(value, path, issues) {
    if (value !== this.expected) {
      issues.push(new Issue(path, `Expected ${JSON.stringify(this.expected)}`, 'invalid_literal'));
      return undefined;
    }
    return value;
  }
}

class ArraySchema extends Schema {
  constructor(element) { super('array'); this.element = element; }
  _clone() { const c = super._clone(); c.element = this.element; return c; }

  _base(value, path, issues) {
    if (!Array.isArray(value)) {
      issues.push(new Issue(path, `Expected array, received ${typeof value}`, 'invalid_type'));
      return undefined;
    }
    if (this.element) {
      return value.map((item, i) => this.element._parse(item, [...path, String(i)], issues));
    }
    return value;
  }

  _step(step, value, path, issues) {
    if (step.kind === 'min' && value.length < step.value) {
      issues.push(new Issue(path, `Must contain at least ${step.value} item(s)`, 'too_small'));
      return value;
    }
    if (step.kind === 'max' && value.length > step.value) {
      issues.push(new Issue(path, `Must contain at most ${step.value} item(s)`, 'too_big'));
      return value;
    }
    return super._step(step, value, path, issues);
  }

  _add(kind, value) { const c = this._clone(); c._steps = [...c._steps, { kind, value }]; return c; }
  min(n) { return this._add('min', n); }
  max(n) { return this._add('max', n); }
  nonempty() { return this.min(1); }
}

class ObjectSchema extends Schema {
  constructor(shape) { super('object'); this.shape = shape ?? {}; this._stripUnknown = true; this._strict = false; }

  _clone() {
    const c = super._clone();
    c.shape = this.shape;
    c._stripUnknown = this._stripUnknown;
    c._strict = this._strict;
    return c;
  }

  _base(value, path, issues) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      issues.push(new Issue(path, `Expected object, received ${Array.isArray(value) ? 'array' : typeof value}`, 'invalid_type'));
      return undefined;
    }

    const out = {};
    for (const [key, schema] of Object.entries(this.shape)) {
      const parsed = schema._parse(value[key], [...path, key], issues);
      if (parsed !== undefined) out[key] = parsed;
    }

    for (const key of Object.keys(value)) {
      if (!(key in this.shape)) {
        if (this._strict) issues.push(new Issue([...path, key], 'Unrecognised key', 'unrecognized_keys'));
        else if (!this._stripUnknown) out[key] = value[key];
      }
    }
    return out;
  }

  passthrough() { const c = this._clone(); c._stripUnknown = false; return c; }
  strict() { const c = this._clone(); c._strict = true; return c; }

  partial() {
    const shape = {};
    for (const [k, s] of Object.entries(this.shape)) shape[k] = s.optional();
    const c = this._clone(); c.shape = shape; return c;
  }

  extend(extra) { const c = this._clone(); c.shape = { ...this.shape, ...extra }; return c; }

  pick(keys) {
    const shape = {};
    for (const k of keys) if (k in this.shape) shape[k] = this.shape[k];
    const c = this._clone(); c.shape = shape; return c;
  }

  omit(keys) {
    const shape = { ...this.shape };
    for (const k of keys) delete shape[k];
    const c = this._clone(); c.shape = shape; return c;
  }
}

class RecordSchema extends Schema {
  constructor(valueSchema) { super('record'); this.valueSchema = valueSchema; }
  _clone() { const c = super._clone(); c.valueSchema = this.valueSchema; return c; }
  _base(value, path, issues) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      issues.push(new Issue(path, 'Expected object', 'invalid_type'));
      return undefined;
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = this.valueSchema._parse(v, [...path, k], issues);
    return out;
  }
}

class UnionSchema extends Schema {
  constructor(options) { super('union'); this.options = options; }
  _clone() { const c = super._clone(); c.options = this.options; return c; }
  _base(value, path, issues) {
    for (const option of this.options) {
      const probe = [];
      const parsed = option._parse(value, path, probe);
      if (probe.length === 0) return parsed;
    }
    issues.push(new Issue(path, 'Value does not match any allowed variant', 'invalid_union'));
    return undefined;
  }
}

class AnySchema extends Schema {}

class DateSchema extends Schema {
  _base(value, path, issues) {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) {
      issues.push(new Issue(path, 'Invalid date', 'invalid_date'));
      return undefined;
    }
    return d;
  }
}

const v = {
  string: () => new StringSchema(),
  number: () => new NumberSchema(false),
  boolean: () => new BooleanSchema(),
  bigint: () => new AnySchema(),
  enum: (values) => new EnumSchema(values),
  literal: (value) => new LiteralSchema(value),
  array: (element) => new ArraySchema(element),
  object: (shape) => new ObjectSchema(shape ?? {}),
  record: (valueSchema) => new RecordSchema(valueSchema ?? new AnySchema()),
  union: (options) => new UnionSchema(options),
  any: () => new AnySchema(),
  unknown: () => new AnySchema(),
  date: () => new DateSchema(),
  void: () => new AnySchema(),

  coerce: {
    number: () => new NumberSchema(true),
    boolean: () => { const s = new BooleanSchema(); s._coerce = true; return s; },
    string: () => new AnySchema().transform(String),
  },
};

module.exports = { v, Schema, ParseError, Issue, StringSchema, ObjectSchema, ArraySchema };
