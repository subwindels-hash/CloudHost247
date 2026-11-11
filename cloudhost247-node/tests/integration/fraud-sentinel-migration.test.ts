/**
 * Fraud Sentinel migration 0101 — schema, seed parity, additivity and the documented rollback.
 *
 * Runs against a real embedded Postgres (PGlite) with the FULL committed migration chain applied, so
 * this validates 0101 the way production would meet it: after 100 other migrations, inside the
 * runner's transaction, with checksums.
 *
 * Four things are asserted, in increasing order of how badly they would hurt to get wrong:
 *   1. the objects exist with the constraints the code depends on;
 *   2. the seeded rule rows are BYTE-EQUIVALENT to the reviewed catalogue in code (a drift here means
 *      the dashboard documents one rule while the engine scores another);
 *   3. the migration is ADDITIVE — it cannot regress an existing workflow because it does not touch
 *      any pre-existing table's rows or definition;
 *   4. the rollback script documented in the migration header actually works, and leaves every
 *      pre-existing table in place.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { RULE_CATALOGUE, DEFAULT_FAMILY_CAPS, DEFAULT_RISK_THRESHOLDS } from '../../src/fraud-sentinel/rules/catalogue';
import { FS_DEFAULT_SETTINGS } from '../../src/fraud-sentinel/utils/settings';

const MIGRATION_FILE = path.join(process.cwd(), 'database', 'migrations', '0101_create_fraud_sentinel.sql');

const MODULE_TABLES = [
  'fraud_sentinel_events',
  'fraud_sentinel_rules',
  'fraud_sentinel_rule_history',
  'fraud_sentinel_assessments',
  'fraud_sentinel_alerts',
  'fraud_sentinel_investigations',
  'fraud_sentinel_risk_history',
  'fraud_sentinel_false_positives',
  'fraud_sentinel_runs',
] as const;

/** jsonb does not preserve key order, so equality is compared on canonicalised (sorted-key) JSON. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Strips `--` line comments so a test can reason about the statements a migration really runs. */
function executableSql(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
}

/** The rollback script exactly as documented in the migration's own header comment. */
function documentedRollbackScript(sql: string): string[] {
  const lines = sql.split('\n');
  const start = lines.findIndex((line) => line.includes('ROLLBACK STRATEGY'));
  expect(start, 'the migration must document its rollback strategy').toBeGreaterThan(-1);
  const statements: string[] = [];
  for (const line of lines.slice(start)) {
    const match = /^\s*--\s+(DROP TABLE IF EXISTS .*|DROP SEQUENCE IF EXISTS .*|DELETE FROM platform_settings .*|DELETE FROM schema_migrations .*);?\s*$/.exec(line);
    if (match?.[1]) statements.push(match[1].trim().replace(/;$/, ''));
  }
  return statements;
}

describe('Fraud Sentinel migration 0101', () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
  });

  afterEach(async () => {
    await db.close();
  });

  async function tableExists(name: string): Promise<boolean> {
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = $1`,
      [name]
    );
    return Number(rows[0]?.n ?? 0) > 0;
  }

  async function columnsOf(table: string): Promise<string[]> {
    const { rows } = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
      [table]
    );
    return rows.map((row) => row.column_name);
  }

  it('creates every module table and nothing outside its own prefix', async () => {
    for (const table of MODULE_TABLES) {
      expect(await tableExists(table), `${table} was not created`).toBe(true);
    }
    const { rows } = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name LIKE 'fraud_sentinel%' ORDER BY table_name`
    );
    expect(rows.map((row) => row.table_name).sort()).toEqual([...MODULE_TABLES].sort());
  });

  it('stores the columns the repositories read and write', async () => {
    // Each of these is load-bearing: dropping one silently breaks a repository's SELECT *.
    expect(await columnsOf('fraud_sentinel_events')).toEqual(
      expect.arrayContaining(['dedupe_key', 'source_table', 'source_id', 'source_event_type', 'category', 'subject_type', 'subject_id', 'customer_id', 'channel', 'ip_address', 'client_family', 'amount', 'currency', 'occurred_at', 'evidence', 'ingested_at'])
    );
    expect(await columnsOf('fraud_sentinel_assessments')).toEqual(
      expect.arrayContaining([
        'subject_type', 'subject_id', 'subject_label', 'customer_id', 'risk_score', 'risk_level',
        'previous_score', 'previous_level', 'previous_assessment_id', 'triggered_rules',
        'family_contributions', 'evidence', 'recommendations', 'confidence', 'data_quality',
        'rule_set_version', 'scoring_version', 'window_started_at', 'window_ended_at',
        'events_examined', 'status', 'ai_summary', 'ai_assisted', 'ai_engine', 'assessed_at',
      ])
    );
    expect(await columnsOf('fraud_sentinel_alerts')).toEqual(
      expect.arrayContaining([
        'alert_number', 'assessment_id', 'customer_id', 'subject_type', 'subject_id', 'subject_label',
        'dedupe_key', 'category', 'risk_level', 'risk_score', 'title', 'explanation',
        'primary_rule_code', 'status', 'assigned_reviewer_id', 'assigned_at', 'escalated_at',
        'resolved_at', 'resolution_note', 'recurrence_count', 'detected_at', 'last_assessed_at',
      ])
    );
    expect(await columnsOf('fraud_sentinel_runs')).toEqual(
      expect.arrayContaining(['job_name', 'run_key', 'trigger', 'triggered_by', 'status', 'subjects_scanned', 'events_ingested', 'assessments_created', 'alerts_created', 'alerts_updated', 'notifications_sent', 'records_pruned', 'failed_count', 'duration_ms', 'error'])
    );
  });

  it('enforces the CHECK constraints the module relies on', async () => {
    const { rows } = await db.query<{ conname: string; contype: string }>(
      `SELECT conname, contype FROM pg_constraint WHERE conname LIKE 'fs_%' ORDER BY conname`
    );
    const checks = rows.filter((row) => row.contype === 'c').map((row) => row.conname);
    for (const expected of [
      'fs_alerts_status_check',
      'fs_alerts_level_check',
      'fs_alerts_score_check',
      'fs_alerts_category_check',
      'fs_alerts_subject_type_check',
      'fs_alerts_assignment_check',
      'fs_alerts_resolution_check',
      'fs_assessments_ai_label_check',
      'fs_assessments_window_order_check',
      'fs_assessments_score_check',
      'fs_false_positives_explanation_check',
      'fs_false_positives_reason_check',
      'fs_investigations_action_check',
      'fs_runs_status_check',
      'fs_runs_counters_check',
    ]) {
      expect(checks, `${expected} is missing`).toContain(expected);
    }
  });

  it('enforces idempotency and dedupe through unique indexes', async () => {
    const { rows } = await db.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE indexname LIKE 'fs_%' ORDER BY indexname`
    );
    const indexByName = new Map(rows.map((row) => [row.indexname, row.indexdef]));
    const uniqueIndexes = rows.filter((row) => row.indexdef.includes('UNIQUE')).map((row) => row.indexname);

    // Event idempotency: the dedupe key is unique, so the same observable state change is stored once.
    expect(uniqueIndexes).toContain('fs_events_dedupe_unique_idx');
    // The run key IS the job lock.
    expect(uniqueIndexes).toContain('fs_runs_run_key_unique_idx');
    // One false-positive report per alert.
    expect(uniqueIndexes).toContain('fs_false_positives_alert_unique_idx');
    // Alert numbers are unique.
    expect(uniqueIndexes).toContain('fs_alerts_number_unique_idx');

    // The partial unique index IS the duplicate-alert suppression mechanism, so it must be partial
    // over the OPEN statuses only: a resolved alert must free its key so a genuine recurrence can
    // raise a new alert with its own number and timeline.
    const dedupe = indexByName.get('fs_alerts_open_dedupe_unique_idx') ?? '';
    expect(dedupe).toContain('UNIQUE');
    expect(dedupe).toContain('dedupe_key');
    expect(dedupe).toMatch(/WHERE.*status/);
    expect(dedupe).toContain('new');
    expect(dedupe).toContain('under_review');
    expect(dedupe).toContain('escalated');
    expect(dedupe).not.toContain('resolved');

    // Investigation and lookup indexes the authorization asks for.
    for (const expected of [
      'fs_investigations_alert_idx',
      'fs_assessments_customer_time_idx',
      'fs_assessments_active_customer_idx',
      'fs_events_customer_time_idx',
      'fs_events_ip_time_idx',
      'fs_events_channel_idx',
      'fs_alerts_status_time_idx',
      'fs_alerts_reviewer_idx',
      'fs_risk_history_customer_idx',
      'fs_rule_history_code_idx',
    ]) {
      expect(indexByName.has(expected), `${expected} is missing`).toBe(true);
    }
  });

  it('numbers alerts FS-00000001, FS-00000002 … from its own sequence', async () => {
    const { rows: seq } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_class WHERE relname = 'fraud_sentinel_alert_number_seq' AND relkind = 'S'`
    );
    expect(Number(seq[0]?.n)).toBe(1);

    // A minimal assessment to satisfy the alert's NOT NULL / RESTRICT reference.
    const assessmentId = 'aaaaaaaa-0000-4000-8000-000000000001';
    await db.query(
      `INSERT INTO fraud_sentinel_assessments
         (id, subject_type, risk_score, risk_level, rule_set_version, scoring_version, window_started_at, window_ended_at)
       VALUES ($1,'customer',10,'low','test',1, now() - interval '1 day', now())`,
      [assessmentId]
    );
    const numbers: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      const { rows } = await db.query<{ alert_number: string }>(
        `INSERT INTO fraud_sentinel_alerts
           (id, assessment_id, subject_type, dedupe_key, category, risk_level, risk_score, title, explanation)
         VALUES (gen_random_uuid(), $1, 'customer', $2, 'payment', 'high', 60, 't', 'e')
         RETURNING alert_number`,
        [assessmentId, `customer:x:RULE_${index}`]
      );
      numbers.push(String(rows[0]?.alert_number));
    }
    expect(numbers[0]).toMatch(/^FS-\d{8}$/);
    expect(Number(numbers[1]?.slice(3))).toBe(Number(numbers[0]?.slice(3)) + 1);
  });

  it('seeds rule rows that are equivalent to the reviewed catalogue in code', async () => {
    const { rows } = await db.query<Record<string, unknown>>(`SELECT * FROM fraud_sentinel_rules ORDER BY code`);
    expect(rows.length).toBe(RULE_CATALOGUE.length);

    const byCode = new Map(rows.map((row) => [String(row.code), row]));
    const mismatches: string[] = [];
    for (const rule of RULE_CATALOGUE) {
      const row = byCode.get(rule.code);
      if (!row) {
        mismatches.push(`${rule.code}: missing from the database`);
        continue;
      }
      const checks: Array<[string, unknown, unknown]> = [
        ['name', row.name, rule.name],
        ['description', row.description, rule.description],
        ['category', row.category, rule.category],
        ['family', row.family, rule.family],
        ['version', row.version, rule.version],
        ['enabled', row.enabled, rule.enabled],
        ['weight', row.weight, rule.weight],
        ['severity', row.severity, rule.severity],
        ['recommendation', row.recommendation, rule.recommendation],
        ['parameters', canonical(row.parameters), canonical(rule.parameters)],
        ['data_sources', canonical(row.data_sources), canonical(rule.dataSources)],
        ['applies_to', canonical(row.applies_to), canonical(rule.appliesTo)],
      ];
      for (const [field, actual, expected] of checks) {
        if (actual !== expected) mismatches.push(`${rule.code}.${field}: db=${String(actual)} code=${String(expected)}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('records one append-only history row per seeded rule', async () => {
    const { rows } = await db.query<{ code: string; change_type: string; version: number }>(
      `SELECT code, change_type, version FROM fraud_sentinel_rule_history ORDER BY code`
    );
    expect(rows.length).toBe(RULE_CATALOGUE.length);
    expect(new Set(rows.map((row) => row.code)).size).toBe(RULE_CATALOGUE.length);
    for (const row of rows) {
      expect(row.change_type).toBe('created');
      expect(row.version).toBe(1);
    }
    const { rows: snapshots } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM fraud_sentinel_rule_history WHERE snapshot ? 'code' AND snapshot ? 'weight'`
    );
    expect(Number(snapshots[0]?.n)).toBe(RULE_CATALOGUE.length);
  });

  it('seeds every module setting with the documented default', async () => {
    const { rows } = await db.query<{ key: string; value: unknown }>(
      `SELECT key, value FROM platform_settings WHERE key LIKE 'fraud_sentinel.%' ORDER BY key`
    );
    const seeded = new Map(rows.map((row) => [row.key.replace('fraud_sentinel.', ''), row.value]));
    expect(rows.length).toBe(Object.keys(FS_DEFAULT_SETTINGS).length);

    // The seeded jsonb must equal the code default, key by key: a database that disagrees with
    // FS_DEFAULT_SETTINGS would behave differently before and after its first settings write.
    expect(canonical(seeded.get('risk_thresholds'))).toBe(canonical(DEFAULT_RISK_THRESHOLDS));
    expect(canonical(seeded.get('family_caps'))).toBe(canonical(DEFAULT_FAMILY_CAPS));
    expect(seeded.get('enabled')).toBe(FS_DEFAULT_SETTINGS.enabled);
    expect(seeded.get('lookback_days')).toBe(FS_DEFAULT_SETTINGS.lookbackDays);
    expect(seeded.get('alert_min_level')).toBe(FS_DEFAULT_SETTINGS.alertMinLevel);
    expect(seeded.get('alert_on_critical_rule')).toBe(FS_DEFAULT_SETTINGS.alertOnCriticalRule);
    expect(canonical(seeded.get('notify_reviewer_roles'))).toBe(canonical(FS_DEFAULT_SETTINGS.notifyReviewerRoles));
    expect(seeded.get('scan_batch_size')).toBe(FS_DEFAULT_SETTINGS.scanBatchSize);
    expect(seeded.get('event_batch_limit')).toBe(FS_DEFAULT_SETTINGS.eventBatchLimit);
    expect(seeded.get('ingest_batch_limit')).toBe(FS_DEFAULT_SETTINGS.ingestBatchLimit);
    expect(seeded.get('scheduler_interval_minutes')).toBe(FS_DEFAULT_SETTINGS.schedulerIntervalMinutes);
    expect(seeded.get('retention_event_days')).toBe(FS_DEFAULT_SETTINGS.retentionEventDays);
    expect(seeded.get('retention_history_days')).toBe(FS_DEFAULT_SETTINGS.retentionHistoryDays);
    expect(seeded.get('retention_superseded_assessment_days')).toBe(FS_DEFAULT_SETTINGS.retentionSupersededAssessmentDays);
    // The AI layer is OFF by default and never mandatory.
    expect(seeded.get('ai_assist_enabled')).toBe(false);
    expect(seeded.get('ai_engine')).toBe('deterministic');
    // Every seeded key carries a description: settings are administrator-facing documentation.
    const { rows: described } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM platform_settings
       WHERE key LIKE 'fraud_sentinel.%' AND (description IS NULL OR length(description) < 20)`
    );
    expect(Number(described[0]?.n)).toBe(0);
  });

  it('is additive: it alters, drops, updates and deletes nothing that already existed', async () => {
    const sql = executableSql(readFileSync(MIGRATION_FILE, 'utf8'));
    const forbidden = [
      /\bALTER\s+TABLE\b/i,
      /\bDROP\s+TABLE\b/i,
      /\bDROP\s+INDEX\b/i,
      /\bDROP\s+COLUMN\b/i,
      /\bTRUNCATE\b/i,
      /\bUPDATE\s+(?!fraud_sentinel_)/i,
      /\bDELETE\s+FROM\s+(?!fraud_sentinel_)/i,
    ];
    for (const pattern of forbidden) {
      expect(pattern.test(sql), `migration executes a statement matching ${pattern}`).toBe(false);
    }
    // Every CREATE names a fraud_sentinel_* object (or its own sequence/index).
    const created = [...sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|SEQUENCE)(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-z_]+)/gi)].map(
      (match) => match[1] as string
    );
    expect(created.length).toBeGreaterThan(0);
    for (const name of created) {
      expect(name.startsWith('fraud_sentinel_') || name.startsWith('fs_'), `creates a non-module object: ${name}`).toBe(true);
    }
    // Every INSERT targets a module table or platform_settings (its own configuration keys).
    const inserts = [...sql.matchAll(/INSERT\s+INTO\s+([a-z_]+)/gi)].map((match) => match[1] as string);
    expect(inserts.length).toBeGreaterThan(0);
    for (const target of inserts) {
      expect(target.startsWith('fraud_sentinel_') || target === 'platform_settings', `inserts into ${target}`).toBe(true);
    }
  });

  it('rolls back cleanly with the script documented in its own header', async () => {
    const sql = readFileSync(MIGRATION_FILE, 'utf8');
    const statements = documentedRollbackScript(sql);
    // The documented script must cover every table it created, plus the sequence and the settings.
    expect(statements.length).toBeGreaterThanOrEqual(MODULE_TABLES.length + 3);
    for (const table of MODULE_TABLES) {
      expect(statements.some((statement) => statement.includes(`DROP TABLE IF EXISTS ${table}`)), `${table} not in the rollback script`).toBe(true);
    }

    const before = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
    );
    const beforeNames = before.rows.map((row) => row.table_name);

    // Write something into the module first: a rollback that only works on empty tables proves nothing.
    await db.query(
      `INSERT INTO fraud_sentinel_events (id, dedupe_key, source_table, source_id, source_event_type, category, subject_type, occurred_at)
       VALUES (gen_random_uuid(), 'payments:x:failed', 'payments', gen_random_uuid()::text, 'payment_failed', 'payment', 'customer', now())`
    );

    for (const statement of statements) {
      await db.query(statement);
    }

    for (const table of MODULE_TABLES) {
      expect(await tableExists(table), `${table} survived the documented rollback`).toBe(false);
    }
    const { rows: settings } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM platform_settings WHERE key LIKE 'fraud_sentinel.%'`
    );
    expect(Number(settings[0]?.n)).toBe(0);

    const after = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
    );
    const afterNames = after.rows.map((row) => row.table_name);
    // Everything that existed before, still exists: the rollback removes the module and nothing else.
    const removed = beforeNames.filter((name) => !afterNames.includes(name));
    expect(removed.sort()).toEqual([...MODULE_TABLES].sort());
    expect(afterNames.filter((name) => !beforeNames.includes(name))).toEqual([]);

    // A pre-existing table is still fully usable after the rollback.
    const { rows: users } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM users`);
    expect(Number(users[0]?.n)).toBeGreaterThanOrEqual(0);
  });
});
