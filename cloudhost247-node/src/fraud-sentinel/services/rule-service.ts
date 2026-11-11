/**
 * Rule and settings administration.
 *
 * A rule change is a scoring change, so every write here is versioned and attributed:
 *
 *   * `updateRuleForRequest` bumps `fraud_sentinel_rules.version`, writes an append-only
 *     `fraud_sentinel_rule_history` snapshot of the rule AFTER the change, and writes an `audit_logs`
 *     row naming the actor — all in one transaction, so a rule can never be changed without its
 *     history. Every assessment stores the rule version and weight it used plus a `rule_set_version`
 *     fingerprint, so an old score stays reproducible after the rule that produced it is retuned.
 *
 *   * `updateSettingsForRequest` writes `audit_logs` with the before/after value for each key.
 *     Settings have no rule id, so they cannot appear in `fraud_sentinel_rule_history` (its `rule_id`
 *     is NOT NULL); the audit row is their attribution, and the scoring keys that affect a score are
 *     additionally visible in every later assessment's changed `rule_set_version`.
 *
 * Validation is explicit and closed: an unknown family, an out-of-range weight, an unknown severity or
 * a subject type outside the module's vocabulary is rejected before anything is written. The catalogue
 * in code is the reviewed default; `syncCatalogueForRequest` inserts rules the database is missing and
 * NEVER overwrites one an operator has tuned.
 */
import type { Queryable } from '../../db/types';
import { withTransaction } from '../../db/transaction';
import { recordAudit, type AuditContext } from '../../lib/audit';
import { ValidationError } from '../../lib/errors';
import { RULE_CATALOGUE, RULE_FAMILIES, findRuleDefinition, type RuleDefinition, type RuleFamily } from '../rules/catalogue';
import { detectorCodes } from '../rules/detectors';
import {
  findRuleByCode,
  insertRuleHistory,
  listRuleHistory,
  listRules,
  ruleSnapshot,
  syncCatalogue,
  updateRule,
  type RulePatch,
} from '../repositories/rules-repo';
import {
  FS_DEFAULT_SETTINGS,
  SCORING_SETTING_KEYS,
  isScoringSetting,
  loadFsSettings,
  sanitizeSettings,
  setFsSetting,
  type FsSettings,
} from '../utils/settings';
import {
  RISK_LEVELS,
  RULE_SEVERITIES,
  SUBJECT_TYPES,
  type FraudCategory,
  type FraudRuleHistoryRow,
  type FraudRuleRow,
  type Paginated,
  type RuleChangeType,
  type RuleSeverity,
  type SubjectType,
} from '../types';
import { FRAUD_CATEGORIES } from '../types';
import type { Actor } from './alert-service';

/** A rule as configured in the database, next to the reviewed default it may have drifted from. */
export interface RuleWithDefault extends FraudRuleRow {
  /** The code default, or null for a rule that exists only in the database. */
  catalogueDefault: RuleDefinition | null;
  /** Fields whose stored value differs from the code default — what "tuned" means, concretely. */
  drift: string[];
  /** True when this build has an evaluator for the rule; false means it can never contribute. */
  hasEvaluator: boolean;
}

const DRIFT_FIELDS = ['name', 'description', 'weight', 'severity', 'enabled', 'recommendation', 'family'] as const;

/**
 * Serializes a value with its object keys sorted, for comparing a stored jsonb value with its code
 * default.
 *
 * jsonb does not preserve key order: it reorders object keys on the way in, so a `parameters` value
 * written as `{windowHours: 24, minFailures: 3}` is read back as `{"minFailures":3,"windowHours":24}`.
 * A raw `JSON.stringify` comparison therefore reports "parameters" drift on every rule with more than
 * one parameter — on a freshly migrated database where nobody has tuned anything. Drift is the signal
 * an operator uses to find what a colleague changed; a report that cries drift on all forty rules is
 * worse than no report at all.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0
    );
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** A rule may not be weighted above this: the family caps assume weights in a bounded range. */
export const MAX_RULE_WEIGHT = 30;
export const MIN_RULE_WEIGHT = 1;

const EVALUATOR_CODES = new Set<string>(detectorCodes());

function toRuleWithDefault(rule: FraudRuleRow): RuleWithDefault {
  const definition = findRuleDefinition(rule.code) ?? null;
  const drift: string[] = [];
  if (definition) {
    for (const field of DRIFT_FIELDS) {
      if (rule[field] !== definition[field]) drift.push(field);
    }
    if (canonicalJson(rule.parameters) !== canonicalJson(definition.parameters)) drift.push('parameters');
    if (rule.version !== definition.version) drift.push('version');
  }
  return { ...rule, catalogueDefault: definition, drift, hasEvaluator: EVALUATOR_CODES.has(rule.code) };
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listRulesForRequest(
  db: Queryable,
  options: { category?: FraudCategory | null; enabledOnly?: boolean; family?: RuleFamily | null; search?: string | null } = {}
): Promise<RuleWithDefault[]> {
  const rules = await listRules(db, {
    ...(options.category ? { category: options.category } : {}),
    ...(options.enabledOnly === undefined ? {} : { enabledOnly: options.enabledOnly }),
  });
  const enriched = rules.map(toRuleWithDefault);
  const filtered = options.family ? enriched.filter((rule) => rule.family === options.family) : enriched;
  if (!options.search) return filtered;
  const needle = options.search.toLowerCase();
  return filtered.filter(
    (rule) =>
      rule.code.toLowerCase().includes(needle) ||
      rule.name.toLowerCase().includes(needle) ||
      rule.description.toLowerCase().includes(needle)
  );
}

export async function getRuleDetail(
  db: Queryable,
  code: string,
  options: { historyLimit?: number } = {}
): Promise<{ rule: RuleWithDefault; history: FraudRuleHistoryRow[] } | null> {
  const rule = await findRuleByCode(db, code);
  if (!rule) return null;
  const { items } = await listRuleHistory(db, {
    code,
    limit: Math.min(200, Math.max(1, Math.floor(options.historyLimit ?? 50))),
    offset: 0,
  });
  return { rule: toRuleWithDefault(rule), history: items };
}

export async function listRuleHistoryForRequest(
  db: Queryable,
  options: { code?: string | null; page: number; limit: number }
): Promise<Paginated<FraudRuleHistoryRow>> {
  const { items, total } = await listRuleHistory(db, {
    ...(options.code ? { code: options.code } : {}),
    limit: options.limit,
    offset: (options.page - 1) * options.limit,
  });
  return { items, total, page: options.page, limit: options.limit, totalPages: Math.max(1, Math.ceil(total / options.limit)) };
}

/**
 * Rules the build knows about that the database does not have, and database rules this build cannot
 * evaluate. Both are configuration defects an operator needs to see, and neither is silently fixed.
 */
export async function ruleDriftReport(db: Queryable): Promise<{
  missingInDatabase: string[];
  withoutEvaluator: Array<{ code: string; enabled: boolean }>;
  tuned: Array<{ code: string; drift: string[] }>;
}> {
  const rules = await listRules(db);
  const codes = new Set(rules.map((rule) => rule.code));
  return {
    missingInDatabase: RULE_CATALOGUE.filter((definition) => !codes.has(definition.code)).map((definition) => definition.code),
    withoutEvaluator: rules
      .filter((rule) => !EVALUATOR_CODES.has(rule.code))
      .map((rule) => ({ code: rule.code, enabled: rule.enabled })),
    tuned: rules.map(toRuleWithDefault).filter((rule) => rule.drift.length > 0).map((rule) => ({ code: rule.code, drift: rule.drift })),
  };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export interface RuleUpdateInput {
  code: string;
  patch: RulePatch;
  /** Why the rule is being changed. Recorded on the history row; required for weight changes. */
  reason?: string | null;
}

/** Validates a patch against the module's own vocabulary before anything is written. */
export function validateRulePatch(patch: RulePatch): RulePatch {
  const out: RulePatch = {};
  const keys = Object.keys(patch);
  if (keys.length === 0) throw new ValidationError('No rule changes supplied');

  if (patch.weight !== undefined) {
    const weight = Number(patch.weight);
    if (!Number.isFinite(weight) || !Number.isInteger(weight) || weight < MIN_RULE_WEIGHT || weight > MAX_RULE_WEIGHT) {
      throw new ValidationError(`weight must be an integer between ${MIN_RULE_WEIGHT} and ${MAX_RULE_WEIGHT}`);
    }
    out.weight = weight;
  }
  if (patch.enabled !== undefined) {
    if (typeof patch.enabled !== 'boolean') throw new ValidationError('enabled must be a boolean');
    out.enabled = patch.enabled;
  }
  if (patch.severity !== undefined) {
    if (!RULE_SEVERITIES.includes(patch.severity as RuleSeverity)) {
      throw new ValidationError(`severity must be one of ${RULE_SEVERITIES.join(', ')}`);
    }
    out.severity = patch.severity as RuleSeverity;
  }
  if (patch.family !== undefined) {
    if (!RULE_FAMILIES.includes(patch.family)) throw new ValidationError(`family must be one of ${RULE_FAMILIES.join(', ')}`);
    out.family = patch.family;
  }
  if (patch.appliesTo !== undefined) {
    if (!Array.isArray(patch.appliesTo) || patch.appliesTo.length === 0) {
      throw new ValidationError('appliesTo must be a non-empty list of subject types');
    }
    for (const subjectType of patch.appliesTo) {
      if (!SUBJECT_TYPES.includes(subjectType as SubjectType)) {
        throw new ValidationError(`appliesTo contains an unknown subject type: ${String(subjectType)}`);
      }
    }
    out.appliesTo = [...patch.appliesTo] as SubjectType[];
  }
  if (patch.parameters !== undefined) {
    const parameters = patch.parameters;
    if (typeof parameters !== 'object' || parameters === null || Array.isArray(parameters)) {
      throw new ValidationError('parameters must be a JSON object');
    }
    for (const [key, value] of Object.entries(parameters)) {
      // A parameter is read by a detector with a numeric or string expectation; an object or array
      // value would be silently ignored, which is worse than refused.
      const kind = typeof value;
      if (value !== null && kind !== 'number' && kind !== 'string' && kind !== 'boolean') {
        throw new ValidationError(`parameter ${key} must be a number, string, boolean or null`);
      }
    }
    out.parameters = { ...parameters };
  }
  for (const field of ['name', 'description', 'recommendation'] as const) {
    const value = patch[field];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.trim().length < 4) {
      throw new ValidationError(`${field} must be a string of at least 4 characters`);
    }
    if (value.length > 4000) throw new ValidationError(`${field} must be 4000 characters or fewer`);
    out[field] = value.trim();
  }
  if (patch.dataSources !== undefined) {
    if (!Array.isArray(patch.dataSources)) throw new ValidationError('dataSources must be a list of table names');
    out.dataSources = patch.dataSources.map((source) => String(source));
  }
  return out;
}

/** Which history change_type a patch represents — the most specific one that applies. */
export function changeTypeFor(patch: RulePatch, before: FraudRuleRow): RuleChangeType {
  if (patch.enabled !== undefined && patch.enabled !== before.enabled) return patch.enabled ? 'enabled' : 'disabled';
  if (patch.parameters !== undefined) return 'parameters_changed';
  return 'updated';
}

export async function updateRuleForRequest(
  db: Queryable,
  input: RuleUpdateInput,
  actor: Actor
): Promise<{ rule: RuleWithDefault; history: FraudRuleHistoryRow[]; changeType: RuleChangeType }> {
  const patch = validateRulePatch(input.patch);
  const reason = input.reason?.trim() ?? null;
  // A weight change moves every future score, so it must carry a stated reason.
  if (patch.weight !== undefined && !reason) {
    throw new ValidationError('A reason is required to change a rule weight');
  }

  return withTransaction(db, async (tx) => {
    const before = await findRuleByCode(tx, input.code);
    if (!before) throw new ValidationError(`Unknown rule code: ${input.code}`);

    const changeType = changeTypeFor(patch, before);
    const updated = await updateRule(tx, before.id, patch, actor.userId);
    if (!updated) throw new ValidationError(`Unknown rule code: ${input.code}`);

    await insertRuleHistory(tx, {
      ruleId: updated.id,
      code: updated.code,
      version: updated.version,
      changeType,
      snapshot: ruleSnapshot(updated),
      changedBy: actor.userId,
      reason,
    });

    if (actor.userId) {
      await recordAudit(
        tx,
        {
          actorId: actor.userId,
          action: `fraud_sentinel.rule_${changeType}`,
          resourceType: 'fraud_sentinel_rule',
          resourceId: updated.id,
          metadata: {
            code: updated.code,
            fromVersion: before.version,
            toVersion: updated.version,
            changedFields: Object.keys(patch),
            weightBefore: before.weight,
            weightAfter: updated.weight,
            enabledBefore: before.enabled,
            enabledAfter: updated.enabled,
            reason,
          },
        },
        actor.audit ?? {}
      );
    }

    const detail = await getRuleDetail(tx, updated.code);
    if (!detail) throw new ValidationError(`Unknown rule code: ${updated.code}`);
    return { ...detail, changeType };
  });
}

/**
 * Inserts catalogue rules the database is missing. Existing rules are left exactly as an operator
 * tuned them: a redeploy must never silently reset a weight.
 */
export async function syncCatalogueForRequest(db: Queryable, actor: Actor): Promise<{ inserted: string[] }> {
  return withTransaction(db, async (tx) => {
    const inserted = await syncCatalogue(tx, RULE_CATALOGUE);
    for (const code of inserted) {
      const rule = await findRuleByCode(tx, code);
      if (!rule) continue;
      await insertRuleHistory(tx, {
        ruleId: rule.id,
        code: rule.code,
        version: rule.version,
        changeType: 'created',
        snapshot: ruleSnapshot(rule),
        changedBy: actor.userId,
        reason: 'Inserted from the reviewed code catalogue by an administrator sync',
      });
    }
    if (actor.userId) {
      await recordAudit(
        tx,
        {
          actorId: actor.userId,
          action: 'fraud_sentinel.rules_synced',
          resourceType: 'fraud_sentinel_rule',
          metadata: { inserted, catalogueSize: RULE_CATALOGUE.length },
        },
        actor.audit ?? {}
      );
    }
    return { inserted };
  });
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */

export interface SettingsView {
  settings: FsSettings;
  defaults: FsSettings;
  /** Keys whose value differs from the shipped default. */
  overridden: string[];
  /** Keys that change how a score is computed — the ones an operator should treat as rule changes. */
  scoringKeys: readonly string[];
  /** The fingerprint the current configuration would produce, so a change is visible before it is made. */
  levels: typeof RISK_LEVELS;
  categories: typeof FRAUD_CATEGORIES;
  families: typeof RULE_FAMILIES;
}

export async function getSettingsForRequest(db: Queryable): Promise<SettingsView> {
  const settings = await loadFsSettings(db);
  const overridden = (Object.keys(FS_DEFAULT_SETTINGS) as Array<keyof FsSettings>).filter((key) => {
    return JSON.stringify(settings[key]) !== JSON.stringify(FS_DEFAULT_SETTINGS[key]);
  });
  return {
    settings,
    defaults: FS_DEFAULT_SETTINGS,
    overridden,
    scoringKeys: SCORING_SETTING_KEYS,
    levels: RISK_LEVELS,
    categories: FRAUD_CATEGORIES,
    families: RULE_FAMILIES,
  };
}

export interface SettingsUpdateInput {
  /**
   * The requested change, as it arrived from the API. Typed as unknown values on purpose: this is
   * admin-editable input from outside the process, and `sanitizeSettings` — not the caller — decides
   * what is honoured. A key whose value is out of range falls back to the reviewed default, and the
   * audit row records both the requested and the stored value so a clamp is visible.
   */
  patch: Partial<Record<keyof FsSettings, unknown>>;
  reason?: string | null;
}

/**
 * Applies a settings patch.
 *
 * Values go through `sanitizeSettings` — the same clamp the read path applies — so an out-of-range
 * threshold or a negative retention horizon is corrected to the reviewed default rather than stored.
 * The audit row records the requested value AND the stored one, so an operator can see that a clamp
 * happened instead of wondering why their input did not take effect.
 */
export async function updateSettingsForRequest(
  db: Queryable,
  input: SettingsUpdateInput,
  actor: Actor
): Promise<SettingsView> {
  const requested = input.patch ?? {};
  const keys = Object.keys(requested) as Array<keyof FsSettings>;
  if (keys.length === 0) throw new ValidationError('No settings changes supplied');
  for (const key of keys) {
    if (!(key in FS_DEFAULT_SETTINGS)) throw new ValidationError(`Unknown setting: ${String(key)}`);
  }
  const reason = input.reason?.trim() ?? null;
  const scoringKeysChanged = keys.filter((key) => isScoringSetting(key));
  if (scoringKeysChanged.length > 0 && !reason) {
    throw new ValidationError(
      `A reason is required to change scoring settings (${scoringKeysChanged.join(', ')}): they change how every future score is computed`
    );
  }

  const before = await loadFsSettings(db);
  const sanitized = sanitizeSettings({ ...before, ...requested } as Partial<FsSettings>);

  return withTransaction(db, async (tx) => {
    const changes: Array<{ key: string; from: unknown; to: unknown; requested: unknown; scoring: boolean }> = [];
    for (const key of keys) {
      const value = sanitized[key];
      if (JSON.stringify(value) === JSON.stringify(before[key])) continue;
      await setFsSetting(tx, key, value, actor.userId);
      changes.push({ key, from: before[key], to: value, requested: requested[key], scoring: isScoringSetting(key) });
    }

    if (actor.userId && changes.length > 0) {
      await recordAudit(
        tx,
        {
          actorId: actor.userId,
          action: 'fraud_sentinel.settings_updated',
          resourceType: 'platform_setting',
          metadata: { changes, reason },
        },
        actor.audit ?? {}
      );
    }

    return getSettingsForRequest(tx);
  });
}

/** The audit context shape re-exported so controllers do not import from two places. */
export type { AuditContext };
