/**
 * Detection rule storage — configuration, versioning and the audit trail of every change.
 *
 * A rule's weight and parameters are the scoring model, so changing one is a governed act:
 *   * the change is written to `fraud_sentinel_rules` (the live configuration),
 *   * an append-only snapshot goes to `fraud_sentinel_rule_history`,
 *   * the caller writes an `audit_logs` entry (services/rule-service.ts), and
 *   * every later assessment carries a new `rule_set_version` fingerprint, so scores produced before
 *     the change remain reproducible against the weights that were in force at the time.
 *
 * `syncCatalogue` only ever INSERTs rule codes that do not exist. It never overwrites a tuned weight:
 * an administrator's deliberate configuration always wins over the code default.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../../db/types';
import type { EngineRuleConfig } from '../rules/engine';
import type { RuleDefinition, RuleFamily } from '../rules/catalogue';
import type { FraudCategory, FraudRuleHistoryRow, FraudRuleRow, RuleChangeType, SubjectType } from '../types';

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function toRuleRow(row: Record<string, unknown>): FraudRuleRow {
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    description: String(row.description),
    category: row.category as FraudCategory,
    family: String(row.family),
    version: Number(row.version),
    enabled: row.enabled === true,
    weight: Number(row.weight),
    severity: row.severity as FraudRuleRow['severity'],
    parameters: (row.parameters && typeof row.parameters === 'object' ? row.parameters : {}) as Record<string, unknown>,
    recommendation: String(row.recommendation ?? ''),
    data_sources: asStringArray(row.data_sources),
    applies_to: asStringArray(row.applies_to) as SubjectType[],
    updated_by: row.updated_by === null ? null : String(row.updated_by),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export async function listRules(db: Queryable, options: { category?: FraudCategory | null; enabledOnly?: boolean } = {}): Promise<FraudRuleRow[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.category) {
    params.push(options.category);
    clauses.push(`category = $${params.length}`);
  }
  if (options.enabledOnly) clauses.push('enabled = true');
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT * FROM fraud_sentinel_rules ${where} ORDER BY category ASC, code ASC`,
    params
  );
  return rows.map(toRuleRow);
}

export async function findRuleByCode(db: Queryable, code: string): Promise<FraudRuleRow | null> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT * FROM fraud_sentinel_rules WHERE code = $1`,
    [code]
  );
  return rows[0] ? toRuleRow(rows[0]) : null;
}

export async function findRuleById(db: Queryable, id: string): Promise<FraudRuleRow | null> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT * FROM fraud_sentinel_rules WHERE id = $1::uuid`,
    [id]
  );
  return rows[0] ? toRuleRow(rows[0]) : null;
}

/** Maps stored rows onto the scoring engine's input shape. */
export function toEngineConfigs(rules: readonly FraudRuleRow[]): EngineRuleConfig[] {
  return rules.map((rule) => ({
    code: rule.code,
    name: rule.name,
    version: rule.version,
    enabled: rule.enabled,
    weight: rule.weight,
    severity: rule.severity,
    family: rule.family as RuleFamily,
    category: rule.category,
    parameters: rule.parameters,
    recommendation: rule.recommendation,
    appliesTo: rule.applies_to,
  }));
}

/* -------------------------------------------------------------------------- */
/* Rule history                                                                */
/* -------------------------------------------------------------------------- */

export function ruleSnapshot(rule: FraudRuleRow): Record<string, unknown> {
  return {
    code: rule.code,
    name: rule.name,
    category: rule.category,
    family: rule.family,
    version: rule.version,
    enabled: rule.enabled,
    weight: rule.weight,
    severity: rule.severity,
    parameters: rule.parameters,
    recommendation: rule.recommendation,
    dataSources: rule.data_sources,
    appliesTo: rule.applies_to,
    description: rule.description,
  };
}

export async function insertRuleHistory(
  db: Queryable,
  entry: { ruleId: string; code: string; version: number; changeType: RuleChangeType; snapshot: Record<string, unknown>; changedBy: string | null; reason?: string | null }
): Promise<void> {
  await db.query(
    `INSERT INTO fraud_sentinel_rule_history (id, rule_id, code, version, change_type, snapshot, changed_by, reason)
     VALUES ($1, $2::uuid, $3, $4, $5, $6::jsonb, $7, $8)`,
    [
      randomUUID(),
      entry.ruleId,
      entry.code,
      entry.version,
      entry.changeType,
      JSON.stringify(entry.snapshot),
      entry.changedBy,
      entry.reason ?? null,
    ]
  );
}

export async function listRuleHistory(
  db: Queryable,
  options: { code?: string | null; limit: number; offset: number }
): Promise<{ items: FraudRuleHistoryRow[]; total: number }> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.code) {
    params.push(options.code);
    clauses.push(`code = $${params.length}`);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT h.*, u.full_name AS changed_by_name
     FROM fraud_sentinel_rule_history h
     LEFT JOIN users u ON u.id = h.changed_by
     ${where}
     ORDER BY h.created_at DESC, h.id DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, options.limit, options.offset]
  );
  const { rows: countRows } = await db.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM fraud_sentinel_rule_history h ${where}`,
    params
  );
  return {
    items: rows.map((row) => ({
      id: String(row.id),
      rule_id: String(row.rule_id),
      code: String(row.code),
      version: Number(row.version),
      change_type: row.change_type as RuleChangeType,
      snapshot: (row.snapshot && typeof row.snapshot === 'object' ? row.snapshot : {}) as Record<string, unknown>,
      changed_by: row.changed_by === null ? null : String(row.changed_by),
      reason: row.reason === null ? null : String(row.reason),
      created_at: String(row.created_at),
      ...(row.changed_by_name ? { changed_by_name: String(row.changed_by_name) } : {}),
    })) as FraudRuleHistoryRow[],
    total: countRows[0]?.total ?? 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export interface RulePatch {
  name?: string;
  description?: string;
  weight?: number;
  severity?: FraudRuleRow['severity'];
  enabled?: boolean;
  parameters?: Record<string, unknown>;
  recommendation?: string;
  family?: RuleFamily;
  appliesTo?: SubjectType[];
  dataSources?: string[];
}

/**
 * Applies a configuration patch, bumps the rule's `version`, and writes the history row — in the
 * caller's transaction, so a rule can never be changed without its audit snapshot.
 */
export async function updateRule(
  db: Queryable,
  ruleId: string,
  patch: RulePatch,
  updatedBy: string | null
): Promise<FraudRuleRow | null> {
  const sets: string[] = ['updated_at = now()', 'version = version + 1', 'updated_by = $2'];
  const params: unknown[] = [ruleId, updatedBy];

  const push = (column: string, value: unknown, cast = '') => {
    params.push(value);
    sets.push(`${column} = $${params.length}${cast}`);
  };

  if (patch.name !== undefined) push('name', patch.name);
  if (patch.description !== undefined) push('description', patch.description);
  if (patch.weight !== undefined) push('weight', patch.weight);
  if (patch.severity !== undefined) push('severity', patch.severity);
  if (patch.enabled !== undefined) push('enabled', patch.enabled);
  if (patch.recommendation !== undefined) push('recommendation', patch.recommendation);
  if (patch.family !== undefined) push('family', patch.family);
  if (patch.parameters !== undefined) push('parameters', JSON.stringify(patch.parameters), '::jsonb');
  if (patch.appliesTo !== undefined) push('applies_to', JSON.stringify(patch.appliesTo), '::jsonb');
  if (patch.dataSources !== undefined) push('data_sources', JSON.stringify(patch.dataSources), '::jsonb');

  const { rows } = await db.query<Record<string, unknown>>(
    `UPDATE fraud_sentinel_rules SET ${sets.join(', ')} WHERE id = $1::uuid RETURNING *`,
    params
  );
  return rows[0] ? toRuleRow(rows[0]) : null;
}

/**
 * Inserts any catalogue rule the database does not have yet. Idempotent, and it never touches a rule
 * that already exists — an operator's tuned weight is authoritative.
 *
 * Returns the codes it inserted, so the caller can audit "the build added these rules".
 */
export async function syncCatalogue(db: Queryable, catalogue: readonly RuleDefinition[]): Promise<string[]> {
  const existing = await listRules(db);
  const existingCodes = new Set(existing.map((rule) => rule.code));
  const missing = catalogue.filter((definition) => !existingCodes.has(definition.code));
  const inserted: string[] = [];

  for (const definition of missing) {
    const id = randomUUID();
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO fraud_sentinel_rules
         (id, code, name, description, category, family, version, enabled, weight, severity,
          parameters, recommendation, data_sources, applies_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13::jsonb,$14::jsonb)
       ON CONFLICT (code) DO NOTHING
       RETURNING id`,
      [
        id,
        definition.code,
        definition.name,
        definition.description,
        definition.category,
        definition.family,
        definition.version,
        definition.enabled,
        definition.weight,
        definition.severity,
        JSON.stringify(definition.parameters),
        definition.recommendation,
        JSON.stringify(definition.dataSources),
        JSON.stringify(definition.appliesTo),
      ]
    );
    if (rows[0]) {
      inserted.push(definition.code);
      const created = await findRuleById(db, rows[0].id);
      if (created) {
        await insertRuleHistory(db, {
          ruleId: created.id,
          code: created.code,
          version: created.version,
          changeType: 'created',
          snapshot: ruleSnapshot(created),
          changedBy: null,
          reason: 'Added by rule-catalogue sync: the deployed build implements a rule the database did not have.',
        });
      }
    }
  }
  return inserted;
}
