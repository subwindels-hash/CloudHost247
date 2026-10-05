/**
 * Zero-dependency JSON file store — the default backend when DATABASE_URL is not set.
 *
 * Design:
 *   - Each table is one JSON file: <DATA_DIR>/<table>.json
 *   - Tables are loaded into memory on first access; reads are synchronous lookups.
 *   - Writes go through a serialised queue and land atomically (write to a temp file, fsync,
 *     rename). A crash mid-write therefore leaves the previous valid file intact.
 *   - Unique indexes from src/store/schema.js are enforced here, so application code gets the
 *     same ConflictError it would from Postgres.
 *   - transaction() snapshots the touched tables and restores them on error, giving real
 *     rollback semantics for multi-table operations.
 *
 * This is not a database: it is single-process and holds everything in RAM. It is the right
 * default for development, evaluation and small single-node deployments. Point DATABASE_URL at
 * PostgreSQL (src/store/pg-store.js) for concurrent multi-process hosting.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getTable, primaryKey } = require('./schema');
const { uuidv7 } = require('../lib/ids');
const { ConflictError, NotFoundError } = require('../core/errors');

const nowIso = () => new Date().toISOString();

function applyDefault(def) {
  if (def.default === undefined) return undefined;
  if (def.default === 'uuidv7') return uuidv7();
  if (def.default === 'now') return nowIso();
  // Deep-copy object/array defaults so two rows never share a reference.
  if (typeof def.default === 'object' && def.default !== null) {
    return JSON.parse(JSON.stringify(def.default));
  }
  return def.default;
}

function coerce(column, value) {
  if (value === null || value === undefined) return null;
  switch (column.type) {
    case 'integer':
    case 'bigint': {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) ? Math.trunc(n) : null;
    }
    case 'numeric': {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
    }
    case 'boolean':
      return value === true || value === 'true' || value === 1 || value === '1';
    case 'timestamptz': {
      const d = value instanceof Date ? value : new Date(value);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    case 'jsonb':
    case 'textArray':
      return typeof value === 'string' ? safeJsonParse(value) : value;
    default:
      return typeof value === 'string' ? value : String(value);
  }
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

class JsonStore {
  constructor(options) {
    this.dir = options.dir;
    this.logger = options.logger ?? console;
    this.backend = 'json';
    this.tables = new Map();       // name -> { rows: Map<pk, row> }
    this.dirty = new Set();        // table names with unflushed writes
    this.writeQueue = Promise.resolve();
    this.flushTimer = null;
    this.flushDelayMs = options.flushDelayMs ?? 10;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  async connect() {
    return this;
  }

  async close() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    await this.writeQueue;
    this.flushSync();
  }

  /** Health probe used by GET /ready. */
  async ping() {
    try {
      fs.accessSync(this.dir, fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  _load(name) {
    if (this.tables.has(name)) return this.tables.get(name);
    const table = getTable(name);
    const pk = primaryKey(name);
    const file = path.join(this.dir, `${name}.json`);
    const rows = new Map();

    if (fs.existsSync(file)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        const list = Array.isArray(parsed) ? parsed : (parsed.rows ?? []);
        for (const row of list) rows.set(String(row[pk]), row);
      } catch (err) {
        // A corrupt table must not take the whole platform down at boot; quarantine the file so
        // the data is recoverable and start from an empty table.
        const quarantine = `${file}.corrupt-${Date.now()}`;
        fs.renameSync(file, quarantine);
        this.logger.error({ table: name, quarantine, err }, 'quarantined unreadable data file');
      }
    } else {
      // Seed rows declared in the schema (e.g. the four RBAC roles).
      for (const seed of table.seed ?? []) {
        const row = this._materialize(name, seed);
        rows.set(String(row[pk]), row);
        this.dirty.add(name);
      }
    }

    const entry = { name, pk, rows };
    this.tables.set(name, entry);
    if (this.dirty.has(name)) this._scheduleFlush();
    return entry;
  }

  /** Build a complete row: apply defaults, coerce types, stamp timestamps, check required fields. */
  _materialize(name, input) {
    const table = getTable(name);
    const row = {};
    const timestamp = nowIso();

    for (const [column, def] of Object.entries(table.columns)) {
      const provided = input[column] !== undefined;
      let value = provided ? input[column] : applyDefault(def);

      if (value === undefined && def.default === undefined) {
        if (def.required) throw new Error(`${name}.${column} is required`);
        value = def.nullable ? null : (def.primaryKey ? applyDefault({ default: 'uuidv7' }) : null);
      }

      row[column] = def.primaryKey && !provided
        ? uuidv7()
        : coerce(def, value);
    }

    if ('created_at' in table.columns && !input.created_at) row.created_at = timestamp;
    if ('updated_at' in table.columns) row.updated_at = timestamp;
    return row;
  }

  _checkUnique(name, candidate, excludePk) {
    const table = getTable(name);
    const entry = this.tables.get(name) ?? this._load(name);

    for (const index of table.indexes ?? []) {
      if (!index.unique) continue;
      const values = index.columns.map((col) => {
        const raw = candidate[col];
        if (raw === null || raw === undefined) return null;
        return index.ci ? String(raw).toLowerCase() : String(raw);
      });

      // A unique index with a NULL in any column does not conflict (SQL semantics). Indexes marked
      // `sparse` behave this way explicitly, e.g. users.customer_id before it is assigned.
      if (values.some((v) => v === null)) continue;

      for (const [pk, existing] of entry.rows) {
        if (excludePk !== undefined && pk === String(excludePk)) continue;
        const other = index.columns.map((col) => {
          const raw = existing[col];
          if (raw === null || raw === undefined) return null;
          return index.ci ? String(raw).toLowerCase() : String(raw);
        });
        if (other.every((v, i) => v === values[i])) {
          throw new ConflictError(`Duplicate value for ${index.columns.join(', ')} on ${name}`);
        }
      }
    }
  }

  _scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.writeQueue = this.writeQueue.then(() => this.flushSync()).catch((err) => {
        this.logger.error({ err }, 'failed to flush data to disk');
      });
    }, this.flushDelayMs);
  }

  /** Persist every dirty table. Each file is written atomically. */
  flushSync() {
    for (const name of this.dirty) {
      const entry = this.tables.get(name);
      if (!entry) continue;
      const file = path.join(this.dir, `${name}.json`);
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      const payload = JSON.stringify([...entry.rows.values()], null, 2);

      const fd = fs.openSync(tmp, 'w');
      try {
        fs.writeSync(fd, payload);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(tmp, file);
      this.dirty.delete(name);
    }
  }

  /** Force all pending writes to disk immediately (used by tests and graceful shutdown). */
  async flush() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.writeQueue;
    this.flushSync();
  }

  // -- repository API -------------------------------------------------------

  table(name) {
    return new JsonTable(this, name);
  }

  /**
   * Run `fn` with rollback. Snapshots the tables the callback touches; on throw the in-memory
   * state is restored and nothing is flushed, so the change never reaches disk.
   */
  async transaction(fn) {
    const snapshot = new Map();
    const originalLoad = this._load.bind(this);

    this._load = (tableName) => {
      const entry = originalLoad(tableName);
      if (!snapshot.has(tableName)) {
        snapshot.set(tableName, new Map(entry.rows));
      }
      return entry;
    };

    try {
      const result = await fn(new JsonTransaction(this));
      this._load = originalLoad;
      return result;
    } catch (err) {
      for (const [tableName, rows] of snapshot) {
        const entry = this.tables.get(tableName);
        if (entry) entry.rows = new Map(rows);
      }
      this._load = originalLoad;
      throw err;
    }
  }
}

class JsonTransaction {
  constructor(store) {
    this.store = store;
  }

  table(name) {
    return new JsonTable(this.store, name);
  }
}

/**
 * Per-table repository. Mirrors the subset of behaviour the domains use from the Postgres
 * repositories in cloudhost247-node/src/db/*.ts.
 */
class JsonTable {
  constructor(store, name) {
    this.store = store;
    this.name = name;
    this.table = getTable(name);
    this.entry = store._load(name);
    this.pk = this.entry.pk;
  }

  _rows() {
    // Re-resolve in case a transaction rollback swapped the Map instance.
    this.entry = this.store.tables.get(this.name);
    return this.entry.rows;
  }

  async insert(input) {
    const row = this.store._materialize(this.name, input);
    this.store._checkUnique(this.name, row);
    this._rows().set(String(row[this.pk]), row);
    this.store.dirty.add(this.name);
    this.store._scheduleFlush();
    return { ...row };
  }

  async insertMany(inputs) {
    const out = [];
    for (const input of inputs) out.push(await this.insert(input));
    return out;
  }

  async findById(id) {
    const row = this._rows().get(String(id));
    return row ? { ...row } : null;
  }

  async findOne(predicate) {
    const match = typeof predicate === 'function' ? predicate : (row) => matches(row, predicate);
    for (const row of this._rows().values()) {
      if (match(row)) return { ...row };
    }
    return null;
  }

  /** Case-insensitive lookup on a single column — the `lower(email) = lower($1)` equivalent. */
  async findOneCi(column, value) {
    const needle = String(value).toLowerCase();
    for (const row of this._rows().values()) {
      if (String(row[column] ?? '').toLowerCase() === needle) return { ...row };
    }
    return null;
  }

  async find(predicate = {}, options = {}) {
    const match = typeof predicate === 'function' ? predicate : (row) => matches(row, predicate);
    let rows = [...this._rows().values()].filter(match);

    if (options.orderBy) {
      const entries = Array.isArray(options.orderBy) ? options.orderBy : [options.orderBy];
      rows.sort((a, b) => compareRows(a, b, entries));
    } else {
      rows.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
    }

    const total = rows.length;
    if (options.offset) rows = rows.slice(options.offset);
    if (options.limit !== undefined) rows = rows.slice(0, options.limit);

    return { rows: rows.map((r) => ({ ...r })), total };
  }

  async all() {
    return [...this._rows().values()].map((r) => ({ ...r }));
  }

  async count(predicate = {}) {
    const match = typeof predicate === 'function' ? predicate : (row) => matches(row, predicate);
    let n = 0;
    for (const row of this._rows().values()) if (match(row)) n += 1;
    return n;
  }

  async exists(predicate) {
    return (await this.findOne(predicate)) !== null;
  }

  async updateById(id, patch) {
    const rows = this._rows();
    const key = String(id);
    const current = rows.get(key);
    if (!current) return null;

    const merged = { ...current };
    for (const [column, value] of Object.entries(patch)) {
      if (!(column in this.table.columns)) continue; // ignore unknown keys rather than corrupting rows
      merged[column] = coerce(this.table.columns[column], value);
    }
    if ('updated_at' in this.table.columns) merged.updated_at = nowIso();

    this.store._checkUnique(this.name, merged, key);
    rows.set(key, merged);
    this.store.dirty.add(this.name);
    this.store._scheduleFlush();
    return { ...merged };
  }

  /** Patch every row matching a predicate. Returns the number of rows changed. */
  async updateMany(predicate, patch) {
    const { rows } = await this.find(predicate);
    for (const row of rows) await this.updateById(row[this.pk], patch);
    return rows.length;
  }

  async deleteById(id) {
    const deleted = this._rows().delete(String(id));
    if (deleted) {
      this.store.dirty.add(this.name);
      this.store._scheduleFlush();
    }
    return deleted;
  }

  async deleteMany(predicate = {}) {
    const { rows } = await this.find(predicate);
    for (const row of rows) this._rows().delete(String(row[this.pk]));
    if (rows.length > 0) {
      this.store.dirty.add(this.name);
      this.store._scheduleFlush();
    }
    return rows.length;
  }

  async requireById(id, message) {
    const row = await this.findById(id);
    if (!row) throw new NotFoundError(message ?? `${this.name} not found`);
    return row;
  }

  async truncate() {
    this._rows().clear();
    this.store.dirty.add(this.name);
    this.store._scheduleFlush();
  }
}

/**
 * Predicate matching.
 * A plain object means "all of these keys equal" — except a null value, which matches null/undefined.
 * Supports the small operator set the domains need: $in, $ne, $gt, $gte, $lt, $lte, $like, $exists.
 */
function matches(row, predicate) {
  for (const [key, expected] of Object.entries(predicate)) {
    const actual = row[key];

    if (expected !== null && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof Date)) {
      const ops = expected;
      if ('$in' in ops && !ops.$in.map(String).includes(String(actual))) return false;
      if ('$ne' in ops && String(actual) === String(ops.$ne)) return false;
      if ('$gt' in ops && !(actual > ops.$gt)) return false;
      if ('$gte' in ops && !(actual >= ops.$gte)) return false;
      if ('$lt' in ops && !(actual < ops.$lt)) return false;
      if ('$lte' in ops && !(actual <= ops.$lte)) return false;
      if ('$exists' in ops && (actual !== null && actual !== undefined) !== ops.$exists) return false;
      if ('$like' in ops) {
        const re = new RegExp(`^${String(ops.$like).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')}$`, 'i');
        if (!re.test(String(actual ?? ''))) return false;
      }
      continue;
    }

    if (expected === null) {
      if (actual !== null && actual !== undefined) return false;
      continue;
    }
    if (String(actual) !== String(expected)) return false;
  }
  return true;
}

function compareRows(a, b, entries) {
  for (const entry of entries) {
    const key = typeof entry === 'string' ? entry.replace(/^[-+]/, '') : entry.column ?? entry.field;
    const desc = typeof entry === 'string' ? entry.startsWith('-') : entry.direction === 'desc';
    const av = a[key];
    const bv = b[key];
    if (av === bv) continue;
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    const cmp = typeof av === 'number' && typeof bv === 'number'
      ? av - bv
      : String(av).localeCompare(String(bv));
    if (cmp !== 0) return desc ? -cmp : cmp;
  }
  return 0;
}

module.exports = { JsonStore, JsonTable, matches, applyDefault, coerce };
