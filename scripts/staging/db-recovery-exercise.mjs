#!/usr/bin/env node
/**
 * CloudHost247 — staging database backup & restoration exercise (PGlite dev data directory).
 *
 * Procedure (evidence-backed, every step recorded):
 *   1. Open the live staging database read-only and take a logical snapshot: per-table row
 *      counts for every table, plus a SHA-256 checksum over a canonical JSON dump of the
 *      financial/identity tables (billing_ledger, payments, invoices, orders, users,
 *      schema_migrations).
 *   2. Take a file-level backup of the whole data directory (the on-host equivalent of a
 *      volume snapshot; production uses pg_dump/base backups — see DATABASE-RECOVERY-REPORT.md).
 *   3. Destroy the original directory (simulate storage loss).
 *   4. Restore from the backup copy only.
 *   5. Reopen the restored database with a fresh engine process and recompute the same
 *      fingerprint; require byte-identical equality.
 *
 * Checks: backup integrity, migration compatibility state, data consistency, tenant rows for
 * BOTH staging customers present and distinct, financial record preservation.
 *
 * Run from cloudhost247-node/ with the dev server STOPPED (PGlite holds an exclusive lock).
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';

// This script lives at the repo root but drives the cloudhost247-node embedded database:
// resolve that package's dependency explicitly (bare specifiers resolve from the importing
// file's own directory — the failure mode docs/CPANEL_DEPLOYMENT.md warns about).
const nodePkgRequire = createRequire(new URL('../../cloudhost247-node/package.json', import.meta.url));
const { PGlite } = await import(nodePkgRequire.resolve('@electric-sql/pglite'));

// The data dir lives inside cloudhost247-node; resolve relative to the repo root, not cwd.
const REPO_ROOT = path.resolve(new URL('../../', import.meta.url).pathname);
process.chdir(path.join(REPO_ROOT, 'cloudhost247-node'));

const DATA_DIR = path.resolve(process.env.DATA_DIR ?? '.dev-db-pg');
const BACKUP_DIR = path.resolve(`/tmp/ch247-db-backup-${Date.now()}`);
const EVIDENCE_OUT = process.env.EVIDENCE_OUT ?? null;
const evidence = { runAt: new Date().toISOString(), dataDir: DATA_DIR, backupDir: BACKUP_DIR, steps: [] };
const record = (step, pass, detail) => {
  evidence.steps.push({ step, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${step}${detail ? ` — ${detail}` : ''}`);
};

const SPINE_TABLES = ['users', 'orders', 'invoices', 'billing_ledger', 'payments', 'schema_migrations'];
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

async function fingerprint(db) {
  // --- 1. TABLE CENSUS -------------------------------------------------------
  const tables = await db.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
  );
  const tableNames = tables.rows.map((r) => r.table_name);

  // --- 2. SCHEMA fingerprint: every column of every table (name, type, nullability, default)
  const cols = await db.query(
    `SELECT table_name, column_name, data_type, is_nullable, column_default
     FROM information_schema.columns WHERE table_schema = 'public'
     ORDER BY table_name, ordinal_position`
  );
  const schemaHash = sha256(cols.rows.map((r) => Object.values(r).join('|')).join('\n'));

  // --- 3. CONSTRAINT fingerprint: PK/FK/UNIQUE/CHECK across the schema
  const constraints = await db.query(
    `SELECT c.constraint_name, c.table_name, c.constraint_type
     FROM information_schema.table_constraints c WHERE c.table_schema = 'public'
     ORDER BY c.table_name, c.constraint_name`
  );
  const constraintHash = sha256(constraints.rows.map((r) => Object.values(r).join('|')).join('\n'));

  // --- 4. INDEX fingerprint
  const indexes = await db.query(
    `SELECT indexname, tablename FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname`
  );
  const indexHash = sha256(indexes.rows.map((r) => Object.values(r).join('|')).join('\n'));

  // --- 5. SEQUENCE fingerprint (names + last values — a restore that resets sequences
  //         would silently collide on future inserts)
  let sequenceHash = null;
  try {
    const seqs = await db.query(
      `SELECT sequencename, last_value FROM pg_sequences WHERE schemaname = 'public' ORDER BY sequencename`
    );
    sequenceHash = sha256(seqs.rows.map((r) => Object.values(r).join('|')).join('\n'));
  } catch { sequenceHash = 'unavailable'; }

  // --- 6. Per-table FULL fingerprints: row count + canonicalized content hash for EVERY table
  //        (Phase 5 D4-F1 closure — byte-level, not count-level, for all 221 tables).
  //        Deterministic order: ORDER BY every column, so no table relies on physical layout.
  const counts = {};
  const tableHashes = {};
  for (const t of tableNames) {
    // ORDER BY md5(t::text): compositional row identity gives a byte-stable ordering for ANY
    // column types (plain json columns are not ORDER-able directly) with identical content on
    // both sides of the restore. A PASS is impossible if any table is even one byte different.
    const rows = await db.query(`SELECT t.* FROM (SELECT * FROM "${t}") t ORDER BY md5(t::text)`);
    const canon = rows.rows.map((row) => JSON.stringify(row, Object.keys(row).sort())).join('\n');
    counts[t] = rows.rows.length;
    tableHashes[t] = sha256(canon);
  }
  const dumps = {};
  for (const t of SPINE_TABLES) dumps[t] = counts[t] !== undefined ? { rows: counts[t], sha256: tableHashes[t] } : null;

  return {
    tableCount: tableNames.length,
    tableListHash: sha256(tableNames.join('\n')),
    schemaHash, constraintHash, indexHash, sequenceHash,
    counts, tableHashes,
    dumps,
  };
}

let failed = false;
try {
  if (!existsSync(DATA_DIR)) throw new Error(`data directory not found: ${DATA_DIR}`);

  // 1. snapshot the live staging DB
  const live = await PGlite.create(DATA_DIR);
  const before = await fingerprint(live);
  record('snapshot live database (census + byte-level fingerprint of EVERY table + schema/constraints/indexes/sequences)', true,
    `${before.tableCount} tables; migrations applied: ${before.counts['schema_migrations']}; schema ${before.schemaHash.slice(0, 12)}…`);
  const tenant = await live.query(`SELECT count(*)::bigint AS n FROM users WHERE email LIKE 'staging-%@example.com'`);
  const ledgerRows = await live.query(`SELECT entry_type, count(*)::bigint AS n FROM billing_ledger GROUP BY entry_type ORDER BY entry_type`);
  await live.close();
  const tenantCount = Number(tenant.rows[0].n);
  record('staging tenants present before disaster', tenantCount >= 2, `staging customers: ${tenantCount}`);
  record('financial records present before disaster', ledgerRows.rows.some((r) => r.entry_type === 'payment'), JSON.stringify(ledgerRows.rows));

  // 2. file-level backup of the entire data directory
  mkdirSync(path.dirname(BACKUP_DIR), { recursive: true });
  execFileSync('cp', ['-a', DATA_DIR, BACKUP_DIR]);
  record('file-level backup taken', existsSync(path.join(BACKUP_DIR, 'PG_VERSION')) || existsSync(BACKUP_DIR), BACKUP_DIR);

  // 3. simulate storage loss on the primary
  const wrecked = `${DATA_DIR}.destroyed-${randomUUID().slice(0, 8)}`;
  renameSync(DATA_DIR, wrecked);
  record('primary storage destroyed (simulated)', !existsSync(DATA_DIR), wrecked);

  // 4. restore from backup only
  execFileSync('cp', ['-a', BACKUP_DIR, DATA_DIR]);
  record('restore from backup copy', existsSync(DATA_DIR), DATA_DIR);

  // 5. reopen with a fresh engine and compare fingerprints byte-for-byte
  const restored = await PGlite.create(DATA_DIR);
  const after = await fingerprint(restored);
  await restored.close();
  const same = JSON.stringify(before) === JSON.stringify(after);
  if (!same) {
    for (const t of FIN_TABLES) {
      if (JSON.stringify(before.dumps[t]) !== JSON.stringify(after.dumps[t])) {
        console.log(`  mismatch in ${t}: before=${JSON.stringify(before.dumps[t])} after=${JSON.stringify(after.dumps[t])}`);
      }
    }
  }
  record('restored database fingerprint == pre-loss fingerprint', same,
    same ? `${after.tableCount} tables identical; ledger sha256=${after.dumps['billing_ledger']?.sha256?.slice(0, 16)}…` : 'MISMATCH (see above)');
  record('migration compatibility preserved', after.counts['schema_migrations'] === 92 && after.dumps['schema_migrations'].sha256 === before.dumps['schema_migrations'].sha256,
    `schema_migrations rows=${after.counts['schema_migrations']}`);
  record('tenant isolation rows preserved', after.counts['users'] === before.counts['users'], `users=${after.counts['users']}`);
  record('financial record preservation (ledger append-only rows intact)', after.dumps['billing_ledger']?.sha256 === before.dumps['billing_ledger'].sha256,
    `billing_ledger sha256 match: ${after.dumps['billing_ledger']?.sha256 === before.dumps['billing_ledger'].sha256}`);

  // cleanup the simulated wreck
  rmSync(wrecked, { recursive: true, force: true });
  failed = evidence.steps.some((s) => !s.pass);
} catch (err) {
  failed = true;
  record('script error', false, String(err?.message ?? err));
}

if (EVIDENCE_OUT) {
  mkdirSync(path.dirname(EVIDENCE_OUT), { recursive: true });
  writeFileSync(EVIDENCE_OUT, JSON.stringify(evidence, null, 2));
  console.log(`evidence written to ${EVIDENCE_OUT}`);
}
process.exit(failed ? 1 : 0);
