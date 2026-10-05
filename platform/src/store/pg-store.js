/**
 * PostgreSQL adapter — presents exactly the same repository API as src/store/json-store.js.
 *
 * This is the only place `pg` (the platform's single dependency) is imported, and the import is
 * lazy: a deployment that never sets DATABASE_URL never loads the module, so the dependency can
 * be absent entirely and the platform still runs on the JSON store.
 *
 * SQL is generated from src/store/schema.js, so a new table needs no hand-written queries.
 * All values are bound as parameters — no identifier or value is ever interpolated from request
 * input. Identifiers come from the schema registry only.
 */
'use strict';

const { getTable, primaryKey, TYPES } = require('./schema');
const { uuidv7 } = require('../lib/ids');
const { ConflictError, NotFoundError } = require('../core/errors');

const nowIso = () => new Date().toISOString();

/** Quote an identifier. Only ever called with names from the schema registry. */
function q(identifier) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) {
    throw new Error(`Refusing to build SQL for suspicious identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function applyDefault(def) {
  if (def.default === undefined) return undefined;
  if (def.default === 'uuidv7') return uuidv7();
  if (def.default === 'now') return nowIso();
  if (typeof def.default === 'object' && def.default !== null) {
    return JSON.parse(JSON.stringify(def.default));
  }
  return def.default;
}

function toDriverValue(def, value) {
  if (value === null || value === undefined) return null;
  if (def.type === 'jsonb' || def.type === 'textArray') return JSON.stringify(value);
  if (def.type === 'timestamptz' && !(value instanceof Date)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (def.type === 'numeric' && typeof value === 'string') return Number(value);
  return value;
}

/** Turn parsed Postgres rows into the same JS shape the JSON store returns. */
function fromDriverRow(table, row) {
  const out = {};
  for (const [column, def] of Object.entries(table.columns)) {
    let value = row[column];
    if (value === null || value === undefined) {
      out[column] = null;
      continue;
    }
    if (def.type === 'jsonb' || def.type === 'textArray') {
      out[column] = typeof value === 'string' ? JSON.parse(value) : value;
    } else if (def.type === 'numeric') {
      // node-postgres returns NUMERIC as a string to avoid float precision loss. The JSON store
      // returns a number, so normalise here to keep both backends interchangeable.
      out[column] = Number(value);
    } else if (def.type === 'timestamptz') {
      out[column] = value instanceof Date ? value.toISOString() : value;
    } else {
      out[column] = value;
    }
  }
  return out;
}

/** Build a WHERE clause + params from a predicate object. Function predicates are rejected. */
function buildWhere(predicate, startIndex = 1) {
  if (predicate === undefined || predicate === null) return { clause: '', params: [] };
  if (typeof predicate === 'function') {
    throw new Error(
      'PgTable does not support function predicates — pass a plain object so the filter runs in SQL'
    );
  }

  const conditions = [];
  const params = [];
  let index = startIndex;

  for (const [key, expected] of Object.entries(predicate)) {
    const column = q(key);

    if (expected !== null && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof Date)) {
      const ops = expected;
      if ('$in' in ops) {
        params.push(ops.$in);
        conditions.push(`${column} = ANY($${index++})`);
      }
      if ('$ne' in ops) { params.push(ops.$ne); conditions.push(`${column} <> $${index++}`); }
      if ('$gt' in ops) { params.push(ops.$gt); conditions.push(`${column} > $${index++}`); }
      if ('$gte' in ops) { params.push(ops.$gte); conditions.push(`${column} >= $${index++}`); }
      if ('$lt' in ops) { params.push(ops.$lt); conditions.push(`${column} < $${index++}`); }
      if ('$lte' in ops) { params.push(ops.$lte); conditions.push(`${column} <= $${index++}`); }
      if ('$exists' in ops) {
        conditions.push(ops.$exists ? `${column} IS NOT NULL` : `${column} IS NULL`);
      }
      if ('$like' in ops) { params.push(ops.$like); conditions.push(`${column} ILIKE $${index++}`); }
      continue;
    }

    if (expected === null) {
      conditions.push(`${column} IS NULL`);
      continue;
    }
    params.push(expected);
    conditions.push(`${column} = $${index++}`);
  }

  return {
    clause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

class PgStore {
  constructor(options) {
    this.config = options.config;
    this.logger = options.logger ?? console;
    this.backend = 'postgres';
    this.pool = null;
  }

  async connect() {
    // Lazy require: the only place the single optional dependency is loaded.
    let pg;
    try {
      // eslint-disable-next-line global-require
      pg = require('pg');
    } catch (err) {
      throw new Error(
        'DATABASE_URL is set but the "pg" package is not installed. '
        + 'Run `npm install pg@8.16.3`, or unset DATABASE_URL to use the JSON file store.'
      );
    }

    this.pool = new pg.Pool({
      connectionString: this.config.DATABASE_URL,
      max: this.config.DATABASE_POOL_MAX,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: this.config.DATABASE_SSL
        ? { rejectUnauthorized: this.config.DATABASE_SSL_REJECT_UNAUTHORIZED }
        : undefined,
    });

    // An error on an idle client must not crash the process.
    this.pool.on('error', (err) => this.logger.error({ err }, 'unexpected idle pg client error'));

    await this.pool.query('SELECT 1');
    return this;
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  async ping() {
    if (!this.pool) return false;
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  query(text, params) {
    return this.pool.query(text, params);
  }

  table(name) {
    return new PgTable(this, name);
  }

  /** Run `fn` on a single dedicated client inside BEGIN/COMMIT, rolling back on throw. */
  async transaction(fn) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(new PgTransaction(client));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        this.logger.error({ err: rollbackErr }, 'failed to roll back transaction');
      }
      throw err;
    } finally {
      client.release();
    }
  }

  /** CREATE TABLE / CREATE INDEX for every table in the schema registry (idempotent). */
  async migrate() {
    const statements = [];
    for (const [name, table] of Object.entries(require('./schema').TABLES)) {
      const columns = Object.entries(table.columns).map(([column, def]) => {
        const parts = [q(column), TYPES[def.type] ?? 'TEXT'];
        if (def.primaryKey) parts.push('PRIMARY KEY');
        if (def.required) parts.push('NOT NULL');
        if (def.default !== undefined && def.default !== 'uuidv7' && def.default !== 'now') {
          parts.push(`DEFAULT ${typeof def.default === 'string' ? `'${def.default}'` : JSON.stringify(def.default)}`);
        }
        if (def.default === 'now') parts.push('DEFAULT now()');
        return parts.join(' ');
      });
      statements.push(`CREATE TABLE IF NOT EXISTS ${q(name)} (${columns.join(', ')})`);

      for (const index of table.indexes ?? []) {
        if (index.expression) continue; // expression indexes are declared in SQL migrations
        const cols = index.columns.map(q).join(', ');
        statements.push(
          `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${q(index.name)} `
          + `ON ${q(name)} (${cols})${index.sparse ? ` WHERE ${q(index.columns[0])} IS NOT NULL` : ''}`
        );
      }
    }
    for (const sql of statements) await this.pool.query(sql);
    return statements.length;
  }
}

class PgTransaction {
  constructor(client) {
    this.client = client;
  }

  table(name) {
    return new PgTable(this, name, this.client);
  }
}

class PgTable {
  constructor(store, name, client) {
    this.store = store;
    this.name = name;
    this.table = getTable(name);
    this.pk = primaryKey(name);
    this.client = client ?? store.pool;
  }

  _query(text, params) {
    return this.client.query(text, params);
  }

  async insert(input) {
    const columns = [];
    const values = [];
    const params = [];

    for (const [column, def] of Object.entries(this.table.columns)) {
      let value = input[column] !== undefined ? input[column] : applyDefault(def);
      if (value === undefined) value = def.nullable ? null : null;

      columns.push(q(column));
      if (value === null || value === undefined) {
        values.push('NULL');
      } else {
        params.push(toDriverValue(def, value));
        values.push(`$${params.length}`);
      }
    }

    const sql = `INSERT INTO ${q(this.name)} (${columns.join(', ')}) VALUES (${values.join(', ')}) RETURNING *`;
    try {
      const { rows } = await this._query(sql, params);
      return fromDriverRow(this.table, rows[0]);
    } catch (err) {
      if (err.code === '23505') {
        throw new ConflictError(`Duplicate value on ${this.name}: ${err.detail ?? err.message}`);
      }
      throw err;
    }
  }

  async insertMany(inputs) {
    const out = [];
    for (const input of inputs) out.push(await this.insert(input));
    return out;
  }

  async findById(id) {
    const { rows } = await this._query(
      `SELECT * FROM ${q(this.name)} WHERE ${q(this.pk)} = $1 LIMIT 1`,
      [id]
    );
    return rows[0] ? fromDriverRow(this.table, rows[0]) : null;
  }

  async findOne(predicate) {
    const { clause, params } = buildWhere(predicate);
    const { rows } = await this._query(
      `SELECT * FROM ${q(this.name)} ${clause} LIMIT 1`,
      params
    );
    return rows[0] ? fromDriverRow(this.table, rows[0]) : null;
  }

  /** `lower(col) = lower($1)` — the exact query the Fastify users repository uses. */
  async findOneCi(column, value) {
    const { rows } = await this._query(
      `SELECT * FROM ${q(this.name)} WHERE lower(${q(column)}) = lower($1) LIMIT 1`,
      [value]
    );
    return rows[0] ? fromDriverRow(this.table, rows[0]) : null;
  }

  async find(predicate = {}, options = {}) {
    const { clause, params } = buildWhere(predicate);
    const orderSql = this._orderBy(options.orderBy);

    const countResult = await this._query(
      `SELECT count(*)::int AS count FROM ${q(this.name)} ${clause}`,
      params
    );
    const total = countResult.rows[0]?.count ?? 0;

    const listParams = [...params];
    let sql = `SELECT * FROM ${q(this.name)} ${clause} ${orderSql}`;
    if (options.limit !== undefined) {
      listParams.push(options.limit);
      sql += ` LIMIT $${listParams.length}`;
    }
    if (options.offset) {
      listParams.push(options.offset);
      sql += ` OFFSET $${listParams.length}`;
    }

    const { rows } = await this._query(sql, listParams);
    return { rows: rows.map((r) => fromDriverRow(this.table, r)), total };
  }

  _orderBy(orderBy) {
    if (!orderBy) return this.table.columns.created_at ? 'ORDER BY created_at DESC' : '';
    const entries = Array.isArray(orderBy) ? orderBy : [orderBy];
    const parts = entries.map((entry) => {
      if (typeof entry === 'string') {
        const desc = entry.startsWith('-');
        return `${q(entry.replace(/^[-+]/, ''))} ${desc ? 'DESC' : 'ASC'}`;
      }
      return `${q(entry.column ?? entry.field)} ${entry.direction === 'desc' ? 'DESC' : 'ASC'}`;
    });
    return `ORDER BY ${parts.join(', ')}`;
  }

  async all() {
    const { rows } = await this._query(`SELECT * FROM ${q(this.name)}`);
    return rows.map((r) => fromDriverRow(this.table, r));
  }

  async count(predicate = {}) {
    const { clause, params } = buildWhere(predicate);
    const { rows } = await this._query(`SELECT count(*)::int AS count FROM ${q(this.name)} ${clause}`, params);
    return rows[0]?.count ?? 0;
  }

  async exists(predicate) {
    return (await this.count(predicate)) > 0;
  }

  async updateById(id, patch) {
    const sets = [];
    const params = [];
    for (const [column, value] of Object.entries(patch)) {
      if (!(column in this.table.columns)) continue;
      params.push(toDriverValue(this.table.columns[column], value));
      sets.push(`${q(column)} = $${params.length}`);
    }
    if (this.table.columns.updated_at) {
      params.push(nowIso());
      sets.push(`${q('updated_at')} = $${params.length}`);
    }
    if (sets.length === 0) return this.findById(id);

    params.push(id);
    try {
      const { rows } = await this._query(
        `UPDATE ${q(this.name)} SET ${sets.join(', ')} WHERE ${q(this.pk)} = $${params.length} RETURNING *`,
        params
      );
      return rows[0] ? fromDriverRow(this.table, rows[0]) : null;
    } catch (err) {
      if (err.code === '23505') {
        throw new ConflictError(`Duplicate value on ${this.name}: ${err.detail ?? err.message}`);
      }
      throw err;
    }
  }

  async updateMany(predicate, patch) {
    const { clause, params } = buildWhere(predicate);
    const sets = [];
    for (const [column, value] of Object.entries(patch)) {
      if (!(column in this.table.columns)) continue;
      params.push(toDriverValue(this.table.columns[column], value));
      sets.push(`${q(column)} = $${params.length}`);
    }
    if (this.table.columns.updated_at) {
      params.push(nowIso());
      sets.push(`${q('updated_at')} = $${params.length}`);
    }
    if (sets.length === 0) return 0;

    const { rowCount } = await this._query(
      `UPDATE ${q(this.name)} SET ${sets.join(', ')} ${clause}`,
      params
    );
    return rowCount ?? 0;
  }

  async deleteById(id) {
    const { rowCount } = await this._query(`DELETE FROM ${q(this.name)} WHERE ${q(this.pk)} = $1`, [id]);
    return (rowCount ?? 0) > 0;
  }

  async deleteMany(predicate = {}) {
    const { clause, params } = buildWhere(predicate);
    const { rowCount } = await this._query(`DELETE FROM ${q(this.name)} ${clause}`, params);
    return rowCount ?? 0;
  }

  async requireById(id, message) {
    const row = await this.findById(id);
    if (!row) throw new NotFoundError(message ?? `${this.name} not found`);
    return row;
  }

  async truncate() {
    await this._query(`TRUNCATE ${q(this.name)} RESTART IDENTITY CASCADE`);
  }
}

module.exports = { PgStore, PgTable, buildWhere, fromDriverRow, q };
