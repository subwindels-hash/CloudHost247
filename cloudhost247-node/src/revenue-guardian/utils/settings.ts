/**
 * Revenue Guardian settings — thin, typed wrapper over the EXISTING platform_settings table
 * (spec §69, §78 "no duplicate systems"). Defaults are seeded by migration 0054 and mirrored
 * here so a partially-seeded database still behaves deterministically.
 */
import type { Queryable } from '../../db/types';
import { getSetting } from '../../db/ops-tables';

export interface RgRiskThresholds {
  medium: number;
  high: number;
  critical: number;
}

export interface RgHighValueThresholds {
  lifetimeRevenue: number;
  recurringRevenue: number;
  activeServices: number;
}

export interface RgEscalationLevel {
  level: number;
  overdueDays: number;
}

export interface RgSettings {
  enabled: boolean;
  timezone: string;
  reportingCurrency: string;
  overdueThresholdDays: number;
  upcomingInvoiceReminderDays: number[];
  overdueFollowupDays: number;
  renewalReminderDays: number[];
  preSuspensionAlertDays: number;
  preTerminationAlertDays: number;
  terminateAfterSuspensionDays: number;
  riskThresholds: RgRiskThresholds;
  highValueThresholds: RgHighValueThresholds;
  agingBuckets: number[];
  escalationLevels: RgEscalationLevel[];
  schedulerIntervalMinutes: number;
  whatsapp: { enabled: boolean; provider: string | null; [key: string]: unknown };
  emailTemplates: Record<string, { subject?: string; html?: string; text?: string; enabled?: boolean }>;
}

export const RG_DEFAULT_SETTINGS: RgSettings = {
  enabled: true,
  timezone: 'UTC',
  reportingCurrency: 'USD',
  overdueThresholdDays: 1,
  upcomingInvoiceReminderDays: [7, 3, 1],
  overdueFollowupDays: 3,
  renewalReminderDays: [60, 30, 14, 7, 3, 1, 0],
  preSuspensionAlertDays: 5,
  preTerminationAlertDays: 7,
  terminateAfterSuspensionDays: 30,
  riskThresholds: { medium: 25, high: 50, critical: 75 },
  highValueThresholds: { lifetimeRevenue: 1000, recurringRevenue: 100, activeServices: 3 },
  agingBuckets: [7, 30, 60, 90],
  escalationLevels: [
    { level: 1, overdueDays: 7 },
    { level: 2, overdueDays: 21 },
    { level: 3, overdueDays: 45 },
    { level: 4, overdueDays: 90 },
  ],
  schedulerIntervalMinutes: 60,
  whatsapp: { enabled: false, provider: null },
  emailTemplates: {},
};

const KEY_PREFIX = 'revenue_guardian.';

const SETTING_KEYS: Record<keyof RgSettings, string> = {
  enabled: 'enabled',
  timezone: 'timezone',
  reportingCurrency: 'reporting_currency',
  overdueThresholdDays: 'overdue_threshold_days',
  upcomingInvoiceReminderDays: 'upcoming_invoice_reminder_days',
  overdueFollowupDays: 'overdue_followup_days',
  renewalReminderDays: 'renewal_reminder_days',
  preSuspensionAlertDays: 'pre_suspension_alert_days',
  preTerminationAlertDays: 'pre_termination_alert_days',
  terminateAfterSuspensionDays: 'terminate_after_suspension_days',
  riskThresholds: 'risk_thresholds',
  highValueThresholds: 'high_value_thresholds',
  agingBuckets: 'aging_buckets',
  escalationLevels: 'escalation_levels',
  schedulerIntervalMinutes: 'scheduler_interval_minutes',
  whatsapp: 'whatsapp',
  emailTemplates: 'email_templates',
};

/** Loads the full settings object in one round-trip per key group. */
export async function loadRgSettings(db: Queryable): Promise<RgSettings> {
  const { rows } = await db.query<{ key: string; value: unknown }>(
    `SELECT key, value FROM platform_settings WHERE key LIKE $1`,
    [`${KEY_PREFIX}%`]
  );
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const settings: Record<string, unknown> = {};
  for (const [prop, suffix] of Object.entries(SETTING_KEYS)) {
    const stored = byKey.get(KEY_PREFIX + suffix);
    settings[prop] = stored !== undefined ? stored : RG_DEFAULT_SETTINGS[prop as keyof RgSettings];
  }
  return settings as unknown as RgSettings;
}

export async function getRgSetting<K extends keyof RgSettings>(db: Queryable, key: K): Promise<RgSettings[K]> {
  return getSetting(db, KEY_PREFIX + SETTING_KEYS[key], RG_DEFAULT_SETTINGS[key]);
}

/** Upserts one setting into platform_settings, recording who changed it. */
export async function setRgSetting<K extends keyof RgSettings>(
  db: Queryable,
  key: K,
  value: RgSettings[K],
  updatedBy: string | null
): Promise<void> {
  await db.query(
    `INSERT INTO platform_settings (key, value, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, now())
     ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_by = $3, updated_at = now()`,
    [KEY_PREFIX + SETTING_KEYS[key], JSON.stringify(value), updatedBy]
  );
}
