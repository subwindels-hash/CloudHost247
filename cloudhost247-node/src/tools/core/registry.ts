/**
 * Tools Center — the effective tool registry (spec §60, §72).
 *
 * Effective definition = catalogue (src/tools/catalog.ts) ⊕ operator override row
 * (`tool_definitions`). Everything the API and the SPA display about a tool's availability comes
 * from `resolveTool()` here, so there is exactly one place that can decide a tool is disabled,
 * in maintenance, missing a provider or missing a runtime capability.
 *
 * Status semantics (spec §72):
 *   ACTIVE                 — runnable now
 *   DISABLED               — an operator (or the master switch) turned it off
 *   MAINTENANCE            — an operator paused it; message is shown verbatim
 *   CONFIGURATION_REQUIRED — the tool is fine but its provider/endpoint is not configured
 *   SERVICE_UNAVAILABLE    — this deployment cannot perform the operation (capability check)
 *
 * A tool is never reported ACTIVE when any of those conditions hold, which is what keeps the UI
 * from offering a button that would return invented data (spec §89).
 */
import { findConnectedDomainServiceProvider } from '../../db/domain-services';
import type { Queryable } from '../../db/types';
import { getSetting } from '../../db/ops-tables';
import { TOOL_CATALOG, catalogEntry, type ToolCatalogEntry, type ToolVisibility, type RateLimitProfile } from '../catalog';
import { capabilityReport } from './capabilities';
import { listProviders, toProviderView, type ProviderRow } from './providers';

export type ToolStatus = 'ACTIVE' | 'DISABLED' | 'MAINTENANCE' | 'CONFIGURATION_REQUIRED' | 'SERVICE_UNAVAILABLE';

export interface ToolDefinitionOverrideRow {
  id: string;
  slug: string;
  name: string | null;
  category: string | null;
  description: string | null;
  enabled: boolean | null;
  visibility: ToolVisibility | null;
  status_override: ToolStatus | null;
  maintenance_message: string | null;
  provider_slug: string | null;
  rate_limit_profile: RateLimitProfile | null;
  timeout_ms: number | null;
  cache_seconds: number | null;
  configuration: Record<string, unknown>;
  feature_flags: Record<string, unknown>;
  abuse_thresholds: Record<string, unknown>;
  logging_enabled: boolean | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EffectiveTool {
  legacyPaths?: string[];
  discoveryCategories?: string[];
  seoTitle?: string;
  relatedTools?: string[];
  resultMode?: string;
  slug: string;
  name: string;
  category: string;
  summary: string;
  description: string;
  icon: string;
  path: string;
  apiPath: string;
  methods: Array<'GET' | 'POST' | 'DELETE'>;
  visibility: ToolVisibility;
  /** True when this caller must be signed in (catalogue requirement or anonymous access off). */
  authRequired: boolean;
  status: ToolStatus;
  /** Human-readable reason for a non-ACTIVE status. */
  statusMessage: string | null;
  capability: string | null;
  capabilityStatus: string | null;
  providerKind: string | null;
  providerSlug: string | null;
  providerOptional: boolean;
  requiresOwnership: boolean;
  rateLimitProfile: RateLimitProfile;
  cacheSeconds: number;
  timeoutMs: number;
  keywords: string[];
  notes: string[];
  featureFlags: Record<string, unknown>;
  loggingEnabled: boolean;
  /** Where the effective values came from, so the admin UI can show "customised". */
  hasOverride: boolean;
  updatedAt: string | null;
}

export interface RegistryContext {
  whoisConfigured?: boolean;
  masterEnabled: boolean;
  anonymousAccess: boolean;
  overrides: Map<string, ToolDefinitionOverrideRow>;
  providers: ProviderRow[];
}

export async function loadRegistryContext(db: Queryable): Promise<RegistryContext> {
  const [masterEnabled, anonymousAccess, overrideResult, providers] = await Promise.all([
    getSetting<boolean>(db, 'tools.enabled', true),
    getSetting<boolean>(db, 'tools.anonymous_access', true),
    db.query<ToolDefinitionOverrideRow>(`SELECT * FROM tool_definitions`),
    listProviders(db),
  ]);
  return {
    masterEnabled,
    anonymousAccess,
    overrides: new Map(overrideResult.rows.map((row) => [row.slug, row])),
    providers,
  };
}

function providerSatisfies(entry: ToolCatalogEntry, override: ToolDefinitionOverrideRow | undefined, context: RegistryContext): { satisfied: boolean; reason: string | null } {
  if (!entry.providerKind) return { satisfied: true, reason: null };

  const candidates = context.providers.filter((row) => row.kind === entry.providerKind);
  const bound = override?.provider_slug ? candidates.find((row) => row.slug === override.provider_slug) : undefined;
  const pool = bound ? [bound] : candidates;
  const usable = pool.map(toProviderView).filter((view) => view.usable);

  if (usable.length > 0) return { satisfied: true, reason: null };
  if (entry.providerOptional) return { satisfied: true, reason: null };
  if (pool.length === 0) {
    return {
      satisfied: false,
      reason: `No ${entry.providerKind.toLowerCase()} provider is configured. Add one under Admin → Tools → Providers.`,
    };
  }
  const first = pool[0];
  return {
    satisfied: false,
    reason: toProviderView(first!).requirement ?? 'The configured provider is not usable.',
  };
}

export function resolveTool(
  entry: ToolCatalogEntry,
  context: RegistryContext
): EffectiveTool {
  const override = context.overrides.get(entry.slug);
  const featureFlags = override?.feature_flags ?? {};

  const provider = providerSatisfies(entry, override, context);
  const capability = entry.capability ? capabilityReport(entry.capability) : null;

  let status: ToolStatus = 'ACTIVE';
  let statusMessage: string | null = null;

  if (!context.masterEnabled) {
    status = 'DISABLED';
    statusMessage = 'The Tools Center is disabled platform-wide by an administrator.';
  } else if (override?.status_override && override.status_override !== 'ACTIVE') {
    status = override.status_override;
    statusMessage =
      status === 'MAINTENANCE'
        ? (override.maintenance_message ?? 'This tool is temporarily in maintenance.')
        : status === 'DISABLED'
          ? 'This tool is disabled by an administrator.'
          : status === 'CONFIGURATION_REQUIRED'
            ? (override.maintenance_message ?? provider.reason ?? 'This tool needs configuration before it can run.')
            : (override.maintenance_message ?? 'This tool is unavailable in this deployment.');
  } else if (override?.enabled === false) {
    status = 'DISABLED';
    statusMessage = 'This tool is disabled by an administrator.';
  } else if (featureFlags.maintenance === true) {
    status = 'MAINTENANCE';
    statusMessage = override?.maintenance_message ?? 'This tool is temporarily in maintenance.';
  } else if (entry.slug === 'whois' && context.whoisConfigured === false) {
    status = 'CONFIGURATION_REQUIRED';
    statusMessage = 'Connect a Domain Services RDAP provider to use WHOIS.';
  } else if (!provider.satisfied) {
    status = 'CONFIGURATION_REQUIRED';
    statusMessage = provider.reason;
  } else if (capability && capability.status !== 'AVAILABLE') {
    status = 'SERVICE_UNAVAILABLE';
    statusMessage = capability.detail;
  }

  const visibility: ToolVisibility = override?.visibility ?? entry.visibility;
  const authRequired = entry.authRequired || visibility !== 'public' || !context.anonymousAccess;

  return {
    legacyPaths: entry.legacyPaths, discoveryCategories: entry.discoveryCategories, seoTitle: entry.seoTitle, relatedTools: entry.relatedTools, resultMode: entry.resultMode,
    slug: entry.slug,
    name: override?.name ?? entry.name,
    category: override?.category ?? entry.category,
    summary: override?.description ?? entry.summary,
    description: override?.description ?? entry.description,
    icon: entry.icon,
    path: entry.path,
    apiPath: entry.apiPath,
    methods: entry.methods,
    visibility,
    authRequired,
    status,
    statusMessage,
    capability: entry.capability ?? null,
    capabilityStatus: capability?.status ?? null,
    providerKind: entry.providerKind ?? null,
    providerSlug: override?.provider_slug ?? null,
    providerOptional: entry.providerOptional === true,
    requiresOwnership: entry.requiresOwnership === true,
    rateLimitProfile: override?.rate_limit_profile ?? entry.rateLimitProfile,
    cacheSeconds: entry.cacheSeconds === 0 || entry.requiresOwnership ? 0 : (override?.cache_seconds ?? entry.cacheSeconds),
    timeoutMs: override?.timeout_ms ?? entry.timeoutMs,
    keywords: entry.keywords,
    notes: entry.notes ?? [],
    featureFlags,
    loggingEnabled: override?.logging_enabled !== false,
    hasOverride: Boolean(override),
    updatedAt: override?.updated_at ?? null,
  };
}

/** All tools with their effective state. */
export async function listEffectiveTools(db: Queryable): Promise<{ tools: EffectiveTool[]; masterEnabled: boolean; anonymousAccess: boolean }> {
  const context = await loadRegistryContext(db);
  context.whoisConfigured = Boolean(await findConnectedDomainServiceProvider(db, 'rdap'));
  return {
    tools: TOOL_CATALOG.map((entry) => resolveTool(entry, context)),
    masterEnabled: context.masterEnabled,
    anonymousAccess: context.anonymousAccess,
  };
}

export async function effectiveTool(db: Queryable, slug: string): Promise<EffectiveTool | null> {
  const entry = catalogEntry(slug);
  if (!entry) return null;
  const context = await loadRegistryContext(db);
  context.whoisConfigured = Boolean(await findConnectedDomainServiceProvider(db, 'rdap'));
  return resolveTool(entry, context);
}

export interface UpsertOverrideInput {
  slug: string;
  name?: string | null;
  category?: string | null;
  description?: string | null;
  enabled?: boolean | null;
  visibility?: ToolVisibility | null;
  statusOverride?: ToolStatus | null;
  maintenanceMessage?: string | null;
  providerSlug?: string | null;
  rateLimitProfile?: RateLimitProfile | null;
  timeoutMs?: number | null;
  cacheSeconds?: number | null;
  configuration?: Record<string, unknown>;
  featureFlags?: Record<string, unknown>;
  abuseThresholds?: Record<string, unknown>;
  loggingEnabled?: boolean | null;
  actorUserId: string | null;
}

/**
 * Writes the operator override layer. Columns that are not supplied are left untouched — this is an
 * override patch, not a replacement of the catalogue row.
 */
export async function upsertToolOverride(db: Queryable, input: UpsertOverrideInput): Promise<ToolDefinitionOverrideRow> {
  const entry = catalogEntry(input.slug);
  if (!entry) throw new Error(`upsertToolOverride: unknown tool "${input.slug}"`);

  const { rows } = await db.query<ToolDefinitionOverrideRow>(
    `INSERT INTO tool_definitions (
       id, slug, name, category, description, enabled, visibility, status_override,
       maintenance_message, provider_slug, rate_limit_profile, timeout_ms, cache_seconds,
       configuration, feature_flags, abuse_thresholds, logging_enabled, updated_by
     ) VALUES (
       gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
       COALESCE($13::jsonb, '{}'::jsonb), COALESCE($14::jsonb, '{}'::jsonb), COALESCE($15::jsonb, '{}'::jsonb), $16, $17
     )
     ON CONFLICT (slug) DO UPDATE SET
       name = COALESCE($2, tool_definitions.name),
       category = COALESCE($3, tool_definitions.category),
       description = COALESCE($4, tool_definitions.description),
       enabled = $5,
       visibility = $6,
       status_override = $7,
       maintenance_message = $8,
       provider_slug = $9,
       rate_limit_profile = $10,
       timeout_ms = $11,
       cache_seconds = $12,
       configuration = COALESCE($13::jsonb, tool_definitions.configuration),
       feature_flags = COALESCE($14::jsonb, tool_definitions.feature_flags),
       abuse_thresholds = COALESCE($15::jsonb, tool_definitions.abuse_thresholds),
       logging_enabled = $16,
       updated_by = $17,
       updated_at = now()
     RETURNING *`,
    [
      input.slug,
      input.name ?? null,
      input.category ?? null,
      input.description ?? null,
      input.enabled ?? null,
      input.visibility ?? null,
      input.statusOverride ?? null,
      input.maintenanceMessage ?? null,
      input.providerSlug ?? null,
      input.rateLimitProfile ?? null,
      input.timeoutMs ?? null,
      input.cacheSeconds ?? null,
      input.configuration ? JSON.stringify(input.configuration) : null,
      input.featureFlags ? JSON.stringify(input.featureFlags) : null,
      input.abuseThresholds ? JSON.stringify(input.abuseThresholds) : null,
      input.loggingEnabled ?? null,
      input.actorUserId,
    ]
  );
  const row = rows[0];
  if (!row) throw new Error('upsertToolOverride: upsert returned no row');
  return row;
}

/** Removes every override for a tool, returning it to catalogue defaults. */
export async function resetToolOverride(db: Queryable, slug: string): Promise<boolean> {
  const { rows } = await db.query<{ slug: string }>(`DELETE FROM tool_definitions WHERE slug = $1 RETURNING slug`, [slug]);
  return rows.length > 0;
}

export interface ToolMetrics {
  totalExecutions: number;
  executionsToday: number;
  activeTools: number;
  disabledTools: number;
  failedExecutions: number;
  rateLimitEvents: number;
  blockedEvents: number;
  perTool: Array<{ slug: string; executions: number; failures: number; avgDurationMs: number | null; lastRunAt: string | null }>;
  daily: Array<{ day: string; executions: number; failures: number }>;
}

/** Aggregate execution metrics for the admin dashboard (spec §82). */
export async function toolMetrics(db: Queryable, days = 14): Promise<ToolMetrics> {
  const { rows: totals } = await db.query<{ total: string; today: string; failed: string; rate_limited: string; blocked: string }>(
    `SELECT
       count(*)::text AS total,
       count(*) FILTER (WHERE created_at >= date_trunc('day', now()))::text AS today,
       count(*) FILTER (WHERE status NOT IN ('SUCCESS','BLOCKED'))::text AS failed,
       count(*) FILTER (WHERE status = 'RATE_LIMITED')::text AS rate_limited,
       count(*) FILTER (WHERE status = 'BLOCKED')::text AS blocked
     FROM tool_execution_logs`
  );
  const { rows: perTool } = await db.query<{ tool_slug: string; executions: string; failures: string; avg_ms: string | null; last_run: string | null }>(
    `SELECT tool_slug,
            count(*)::text AS executions,
            count(*) FILTER (WHERE status <> 'SUCCESS')::text AS failures,
            avg(duration_ms)::text AS avg_ms,
            max(created_at)::text AS last_run
       FROM tool_execution_logs
      WHERE created_at > now() - ($1::int * interval '1 day')
      GROUP BY tool_slug
      ORDER BY count(*) DESC`,
    [Math.min(Math.max(days, 1), 90)]
  );
  const { rows: daily } = await db.query<{ day: string; executions: string; failures: string }>(
    `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
            count(*)::text AS executions,
            count(*) FILTER (WHERE status <> 'SUCCESS')::text AS failures
       FROM tool_execution_logs
      WHERE created_at > now() - ($1::int * interval '1 day')
      GROUP BY date_trunc('day', created_at)
      ORDER BY date_trunc('day', created_at) ASC`,
    [Math.min(Math.max(days, 1), 90)]
  );
  const tools = await listEffectiveTools(db);
  const row = totals[0];
  return {
    totalExecutions: Number.parseInt(row?.total ?? '0', 10),
    executionsToday: Number.parseInt(row?.today ?? '0', 10),
    activeTools: tools.tools.filter((tool) => tool.status === 'ACTIVE').length,
    disabledTools: tools.tools.filter((tool) => tool.status !== 'ACTIVE').length,
    failedExecutions: Number.parseInt(row?.failed ?? '0', 10),
    rateLimitEvents: Number.parseInt(row?.rate_limited ?? '0', 10),
    blockedEvents: Number.parseInt(row?.blocked ?? '0', 10),
    perTool: perTool.map((entry) => ({
      slug: entry.tool_slug,
      executions: Number.parseInt(entry.executions, 10),
      failures: Number.parseInt(entry.failures, 10),
      avgDurationMs: entry.avg_ms ? Math.round(Number.parseFloat(entry.avg_ms)) : null,
      lastRunAt: entry.last_run,
    })),
    daily: daily.map((entry) => ({
      day: entry.day,
      executions: Number.parseInt(entry.executions, 10),
      failures: Number.parseInt(entry.failures, 10),
    })),
  };
}
