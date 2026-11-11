/**
 * Fraud Sentinel settings — a thin, typed wrapper over the EXISTING `platform_settings` table.
 *
 * No second settings system (the Revenue Guardian rule): keys are `fraud_sentinel.*`, values are
 * jsonb, defaults are seeded by migration 0101 and mirrored here so a partially seeded database
 * still behaves deterministically. Every write goes through `setFsSetting`, which records who made
 * the change; the routes additionally write `audit_logs` and `fraud_sentinel_rule_history` for
 * scoring-relevant keys.
 */
import type { Queryable } from '../../db/types';
import { getSetting } from '../../db/ops-tables';
import type { RiskLevel } from '../types';
import { DEFAULT_FAMILY_CAPS, DEFAULT_RISK_THRESHOLDS, type RuleFamily } from '../rules/catalogue';

export interface FsRiskThresholds {
  medium: number;
  high: number;
  critical: number;
}

export type FsFamilyCaps = Record<RuleFamily, number>;

export interface FsSettings {
  enabled: boolean;
  lookbackDays: number;
  riskThresholds: FsRiskThresholds;
  familyCaps: FsFamilyCaps;
  alertMinLevel: RiskLevel;
  alertOnCriticalRule: boolean;
  notifyReviewerRoles: string[];
  scanBatchSize: number;
  eventBatchLimit: number;
  ingestBatchLimit: number;
  schedulerIntervalMinutes: number;
  retentionEventDays: number;
  retentionHistoryDays: number;
  retentionSupersededAssessmentDays: number;
  aiAssistEnabled: boolean;
  aiEngine: string;
}

export const FS_DEFAULT_SETTINGS: FsSettings = {
  enabled: true,
  lookbackDays: 30,
  riskThresholds: { ...DEFAULT_RISK_THRESHOLDS },
  familyCaps: { ...DEFAULT_FAMILY_CAPS },
  alertMinLevel: 'high',
  alertOnCriticalRule: true,
  notifyReviewerRoles: ['super_admin', 'admin'],
  scanBatchSize: 200,
  eventBatchLimit: 2000,
  ingestBatchLimit: 5000,
  schedulerIntervalMinutes: 15,
  retentionEventDays: 180,
  retentionHistoryDays: 730,
  retentionSupersededAssessmentDays: 365,
  aiAssistEnabled: false,
  aiEngine: 'deterministic',
};

const KEY_PREFIX = 'fraud_sentinel.';

const SETTING_KEYS: Record<keyof FsSettings, string> = {
  enabled: 'enabled',
  lookbackDays: 'lookback_days',
  riskThresholds: 'risk_thresholds',
  familyCaps: 'family_caps',
  alertMinLevel: 'alert_min_level',
  alertOnCriticalRule: 'alert_on_critical_rule',
  notifyReviewerRoles: 'notify_reviewer_roles',
  scanBatchSize: 'scan_batch_size',
  eventBatchLimit: 'event_batch_limit',
  ingestBatchLimit: 'ingest_batch_limit',
  schedulerIntervalMinutes: 'scheduler_interval_minutes',
  retentionEventDays: 'retention_event_days',
  retentionHistoryDays: 'retention_history_days',
  retentionSupersededAssessmentDays: 'retention_superseded_assessment_days',
  aiAssistEnabled: 'ai_assist_enabled',
  aiEngine: 'ai_engine',
};

/**
 * Keys whose change alters how a score is computed. Changing one is a scoring-rule change: it writes
 * an append-only rule-history row and an audit_logs entry, and every later assessment carries the
 * new rule_set_version fingerprint so old scores remain reproducible.
 */
export const SCORING_SETTING_KEYS: readonly (keyof FsSettings)[] = [
  'riskThresholds',
  'familyCaps',
  'alertMinLevel',
  'alertOnCriticalRule',
];

export function isScoringSetting(key: keyof FsSettings): boolean {
  return SCORING_SETTING_KEYS.includes(key);
}

/** Loads every `fraud_sentinel.*` setting in one round-trip, falling back to the code defaults. */
export async function loadFsSettings(db: Queryable): Promise<FsSettings> {
  const { rows } = await db.query<{ key: string; value: unknown }>(
    `SELECT key, value FROM platform_settings WHERE key LIKE $1`,
    [`${KEY_PREFIX}%`]
  );
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const settings: Record<string, unknown> = {};
  for (const [prop, suffix] of Object.entries(SETTING_KEYS)) {
    const stored = byKey.get(KEY_PREFIX + suffix);
    settings[prop] = stored !== undefined && stored !== null ? stored : FS_DEFAULT_SETTINGS[prop as keyof FsSettings];
  }
  const candidate = settings as unknown as FsSettings;
  return sanitizeSettings(candidate);
}

export async function getFsSetting<K extends keyof FsSettings>(db: Queryable, key: K): Promise<FsSettings[K]> {
  return getSetting(db, KEY_PREFIX + SETTING_KEYS[key], FS_DEFAULT_SETTINGS[key]);
}

/** Upserts one setting into platform_settings, recording who changed it. */
export async function setFsSetting<K extends keyof FsSettings>(
  db: Queryable,
  key: K,
  value: FsSettings[K],
  updatedBy: string | null
): Promise<void> {
  await db.query(
    `INSERT INTO platform_settings (key, value, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, now())
     ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_by = $3, updated_at = now()`,
    [KEY_PREFIX + SETTING_KEYS[key], JSON.stringify(value), updatedBy]
  );
}

/**
 * Clamps whatever came out of the database into a safe, usable shape.
 *
 * A setting is admin-editable jsonb, so it must be treated as untrusted input on the way back out:
 * a threshold of 0 would make every subject critical, a negative retention would delete everything,
 * and a missing family key would remove a cap. Anything out of range falls back to the reviewed
 * default rather than being honoured.
 */
export function sanitizeSettings(input: Partial<FsSettings>): FsSettings {
  const defaults = FS_DEFAULT_SETTINGS;

  const positiveInt = (value: unknown, fallback: number, min = 1, max = 100_000): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    const rounded = Math.round(parsed);
    if (rounded < min || rounded > max) return fallback;
    return rounded;
  };

  const thresholdsInput = (input.riskThresholds ?? defaults.riskThresholds) as Partial<FsRiskThresholds>;
  const riskThresholds: FsRiskThresholds = {
    medium: positiveInt(thresholdsInput.medium, defaults.riskThresholds.medium, 1, 99),
    high: positiveInt(thresholdsInput.high, defaults.riskThresholds.high, 2, 100),
    critical: positiveInt(thresholdsInput.critical, defaults.riskThresholds.critical, 3, 100),
  };
  // Keep the ladder monotonic; a misconfigured inverted ladder would make the level meaningless.
  if (riskThresholds.high < riskThresholds.medium) riskThresholds.high = riskThresholds.medium;
  if (riskThresholds.critical < riskThresholds.high) riskThresholds.critical = riskThresholds.high;

  const capsInput = (input.familyCaps ?? defaults.familyCaps) as Partial<Record<RuleFamily, number>>;
  const familyCaps = { ...defaults.familyCaps };
  for (const family of Object.keys(defaults.familyCaps) as RuleFamily[]) {
    familyCaps[family] = positiveInt(capsInput[family], defaults.familyCaps[family], 0, 100);
  }

  const alertMinLevel: RiskLevel = ['medium', 'high', 'critical'].includes(input.alertMinLevel as RiskLevel)
    ? (input.alertMinLevel as RiskLevel)
    : defaults.alertMinLevel;

  const notifyReviewerRoles = Array.isArray(input.notifyReviewerRoles)
    ? input.notifyReviewerRoles.filter((role): role is string =>
        typeof role === 'string' && ['staff', 'admin', 'super_admin'].includes(role)
      )
    : [...defaults.notifyReviewerRoles];

  const aiEngine = typeof input.aiEngine === 'string' && /^[a-z0-9_-]{1,48}$/i.test(input.aiEngine)
    ? input.aiEngine
    : defaults.aiEngine;

  return {
    enabled: input.enabled === true,
    lookbackDays: positiveInt(input.lookbackDays, defaults.lookbackDays, 1, 365),
    riskThresholds,
    familyCaps,
    alertMinLevel,
    alertOnCriticalRule: input.alertOnCriticalRule !== false,
    notifyReviewerRoles: notifyReviewerRoles.length > 0 ? notifyReviewerRoles : [...defaults.notifyReviewerRoles],
    scanBatchSize: positiveInt(input.scanBatchSize, defaults.scanBatchSize, 1, 5_000),
    eventBatchLimit: positiveInt(input.eventBatchLimit, defaults.eventBatchLimit, 10, 100_000),
    ingestBatchLimit: positiveInt(input.ingestBatchLimit, defaults.ingestBatchLimit, 10, 200_000),
    schedulerIntervalMinutes: positiveInt(input.schedulerIntervalMinutes, defaults.schedulerIntervalMinutes, 5, 10_080),
    retentionEventDays: positiveInt(input.retentionEventDays, defaults.retentionEventDays, 1, 3_650),
    retentionHistoryDays: positiveInt(input.retentionHistoryDays, defaults.retentionHistoryDays, 1, 3_650),
    retentionSupersededAssessmentDays: positiveInt(
      input.retentionSupersededAssessmentDays,
      defaults.retentionSupersededAssessmentDays,
      1,
      3_650
    ),
    aiAssistEnabled: input.aiAssistEnabled === true,
    aiEngine,
  };
}

export function levelForScore(score: number, thresholds: FsRiskThresholds): RiskLevel {
  if (score >= thresholds.critical) return 'critical';
  if (score >= thresholds.high) return 'high';
  if (score >= thresholds.medium) return 'medium';
  return 'low';
}

/** True when `level` is at least `minimum` on the low < medium < high < critical ladder. */
export function levelAtLeast(level: RiskLevel, minimum: RiskLevel): boolean {
  const order: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };
  return order[level] >= order[minimum];
}
