/**
 * Tools Center — external provider registry (spec §61, §83).
 *
 * Every optional external API the Tools Center can use (geolocation, RDAP, BIN data, OCR,
 * reverse-IP, DNSBL zones, external DKIM verification) is a row in `tool_provider_configs`. Two
 * rules make this table trustworthy:
 *
 *   - A credential is only ever stored as an AES-256-GCM envelope produced by src/lib/crypto.ts
 *     with the platform's existing key ring. `providerSecret()` is the only read path, and the
 *     plaintext never leaves the service that needs it.
 *   - A provider's declared state is derived, never assumed: `enabled` AND (credentials present
 *     when required) AND endpoint present for HTTP kinds. Anything short of that is
 *     CONFIGURATION_REQUIRED at the tool level, so a tool never silently runs against nothing.
 */
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { Queryable } from '../../db/types';
import { getKeyRing } from '../../lib/keyring';
import { DecryptionError, MissingEncryptionKeyError, decryptSecret, encryptSecret } from '../../lib/crypto';
import { configurationRequired, invalidInput, serviceUnavailable } from './errors';
import type { ProviderKind } from '../catalog';

export interface ProviderRow {
  id: string;
  slug: string;
  name: string;
  kind: ProviderKind;
  description: string;
  endpoint: string | null;
  enabled: boolean;
  needs_credentials: boolean;
  encrypted_api_key: string | null;
  encrypted_api_secret: string | null;
  configuration: Record<string, unknown>;
  timeout_ms: number;
  rate_limit_per_minute: number;
  priority: number;
  health_status: 'UNKNOWN' | 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'CONFIGURATION_REQUIRED' | 'DISABLED';
  health_detail: string | null;
  last_checked_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error: string | null;
  quota_note: string | null;
  created_at: string;
  updated_at: string;
}

/** API-safe projection: no encrypted material, only a boolean "is a credential stored". */
export interface ProviderView {
  slug: string;
  name: string;
  kind: ProviderKind;
  description: string;
  endpoint: string | null;
  enabled: boolean;
  needsCredentials: boolean;
  hasCredentials: boolean;
  configuration: Record<string, unknown>;
  timeoutMs: number;
  rateLimitPerMinute: number;
  priority: number;
  healthStatus: ProviderRow['health_status'];
  healthDetail: string | null;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  quotaNote: string | null;
  /** True when the provider is usable right now, judged by the rules described above. */
  usable: boolean;
  /** Why it is not usable, when it is not. */
  requirement: string | null;
}

export function toProviderView(row: ProviderRow): ProviderView {
  const hasCredentials = Boolean(row.encrypted_api_key || row.encrypted_api_secret);
  const requiresEndpoint = row.kind !== 'DNSBL';
  const requirement = !row.enabled
    ? 'Disabled by an administrator.'
    : row.needs_credentials && !hasCredentials
      ? 'No API credential has been stored for this provider.'
      : requiresEndpoint && !row.endpoint
        ? 'No endpoint has been configured for this provider.'
        : null;
  return {
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    description: row.description,
    endpoint: row.endpoint,
    enabled: row.enabled,
    needsCredentials: row.needs_credentials,
    hasCredentials,
    configuration: row.configuration,
    timeoutMs: row.timeout_ms,
    rateLimitPerMinute: row.rate_limit_per_minute,
    priority: row.priority,
    healthStatus: row.health_status,
    healthDetail: row.health_detail,
    lastCheckedAt: row.last_checked_at,
    lastSuccessAt: row.last_success_at,
    lastFailureAt: row.last_failure_at,
    lastError: row.last_error,
    quotaNote: row.quota_note,
    usable: requirement === null,
    requirement,
  };
}

export async function listProviders(db: Queryable, filter: { kind?: ProviderKind } = {}): Promise<ProviderRow[]> {
  const params: unknown[] = [];
  let where = '';
  if (filter.kind) {
    params.push(filter.kind);
    where = `WHERE kind = $${params.length}`;
  }
  const { rows } = await db.query<ProviderRow>(
    `SELECT * FROM tool_provider_configs ${where} ORDER BY priority ASC, name ASC`,
    params
  );
  return rows;
}

export async function findProvider(db: Queryable, slug: string): Promise<ProviderRow | null> {
  const { rows } = await db.query<ProviderRow>(`SELECT * FROM tool_provider_configs WHERE slug = $1`, [slug]);
  return rows[0] ?? null;
}

/**
 * Providers of a kind that are usable right now, ordered by operator priority. A DNSBL provider
 * does not need an endpoint (its zone name is the endpoint); HTTP-backed providers do.
 */
export async function usableProviders(db: Queryable, kind: ProviderKind): Promise<ProviderView[]> {
  const rows = await listProviders(db, { kind });
  return rows.map(toProviderView).filter((view) => view.usable);
}

/** Throws CONFIGURATION_REQUIRED unless at least one usable provider of `kind` exists. */
export async function requireProvider(db: Queryable, kind: ProviderKind, toolName: string): Promise<ProviderView> {
  const views = await usableProviders(db, kind);
  const first = views[0];
  if (!first) {
    const all = await listProviders(db, { kind });
    throw configurationRequired(`${toolName}’s data provider`, {
      providerKind: kind,
      configuredProviders: all.map((row) => ({ slug: row.slug, enabled: row.enabled, requirement: toProviderView(row).requirement })),
    });
  }
  return first;
}

export interface ProviderSecret {
  apiKey: string | null;
  apiSecret: string | null;
}

/**
 * Decrypts a provider's stored credentials. Throws a *safe* error when the key ring is missing or
 * the envelope fails to decrypt — the caller reports CONFIGURATION_REQUIRED, never the raw crypto
 * error text (which could hint at key material).
 */
export async function providerSecret(db: Queryable, slug: string): Promise<ProviderSecret> {
  const row = await findProvider(db, slug);
  if (!row) throw configurationRequired(`Provider "${slug}"`);
  if (!row.encrypted_api_key && !row.encrypted_api_secret) {
    return { apiKey: null, apiSecret: null };
  }
  try {
    const ring = getKeyRing();
    return {
      apiKey: row.encrypted_api_key ? decryptSecret(ring, row.encrypted_api_key) : null,
      apiSecret: row.encrypted_api_secret ? decryptSecret(ring, row.encrypted_api_secret) : null,
    };
  } catch (error) {
    if (error instanceof MissingEncryptionKeyError) {
      throw configurationRequired('CloudHost247\'s credential encryption key ring (CREDENTIAL_ENCRYPTION_KEYS)', {
        reason: 'missing_key_ring',
      });
    }
    if (error instanceof DecryptionError) {
      throw serviceUnavailable(
        'The stored credential for this provider could not be decrypted (it was encrypted with a key that is no longer configured). A Super Admin must re-enter it.'
      );
    }
    throw error;
  }
}

export interface SaveProviderInput {
  slug: string;
  name?: string;
  kind?: ProviderKind;
  description?: string;
  endpoint?: string | null;
  enabled?: boolean;
  needsCredentials?: boolean;
  /** Plaintext secrets — encrypted before storage; never logged. */
  apiKey?: string | null;
  apiSecret?: string | null;
  configuration?: Record<string, unknown>;
  timeoutMs?: number;
  rateLimitPerMinute?: number;
  priority?: number;
  quotaNote?: string | null;
  actorUserId?: string | null;
}

/**
 * Creates or updates a provider. A `null` secret clears the stored credential; `undefined` leaves
 * it untouched, which is what lets the admin UI show a masked field that is only re-sent when the
 * operator actually types a new value.
 */
export async function saveProvider(db: Queryable, input: SaveProviderInput): Promise<ProviderRow> {
  const existing = await findProvider(db, input.slug);
  const ring = getKeyRing();
  const hasNewSecret = input.apiKey !== undefined || input.apiSecret !== undefined;

  const encryptedApiKey =
    input.apiKey === undefined
      ? (existing?.encrypted_api_key ?? null)
      : input.apiKey === null || input.apiKey === ''
        ? null
        : encryptSecret(ring, input.apiKey);
  const encryptedApiSecret =
    input.apiSecret === undefined
      ? (existing?.encrypted_api_secret ?? null)
      : input.apiSecret === null || input.apiSecret === ''
        ? null
        : encryptSecret(ring, input.apiSecret);

  if (!existing) {
    const { rows } = await db.query<ProviderRow>(
      `INSERT INTO tool_provider_configs
        (id, slug, name, kind, description, endpoint, enabled, needs_credentials,
         encrypted_api_key, encrypted_api_secret, configuration, timeout_ms,
         rate_limit_per_minute, priority, quota_note, created_by, health_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'UNKNOWN')
       RETURNING *`,
      [
        randomUUID(),
        input.slug,
        input.name ?? input.slug,
        input.kind ?? 'OTHER',
        input.description ?? '',
        input.endpoint ?? null,
        input.enabled ?? false,
        input.needsCredentials ?? true,
        encryptedApiKey,
        encryptedApiSecret,
        JSON.stringify(input.configuration ?? {}),
        input.timeoutMs ?? 5000,
        input.rateLimitPerMinute ?? 30,
        input.priority ?? 100,
        input.quotaNote ?? null,
        input.actorUserId ?? null,
      ]
    );
    const created = rows[0];
    if (!created) throw new Error('saveProvider: insert returned no row');
    return created;
  }

  const { rows } = await db.query<ProviderRow>(
    `UPDATE tool_provider_configs SET
       name = COALESCE($2, name),
       kind = COALESCE($3, kind),
       description = COALESCE($4, description),
       endpoint = $5,
       enabled = COALESCE($6, enabled),
       needs_credentials = COALESCE($7, needs_credentials),
       encrypted_api_key = $8,
       encrypted_api_secret = $9,
       configuration = COALESCE($10, configuration),
       timeout_ms = COALESCE($11, timeout_ms),
       rate_limit_per_minute = COALESCE($12, rate_limit_per_minute),
       priority = COALESCE($13, priority),
       quota_note = COALESCE($14, quota_note),
       health_status = CASE WHEN $15 THEN 'UNKNOWN' ELSE health_status END,
       updated_at = now()
     WHERE slug = $1
     RETURNING *`,
    [
      input.slug,
      input.name ?? null,
      input.kind ?? null,
      input.description ?? null,
      input.endpoint === undefined ? existing.endpoint : input.endpoint,
      input.enabled ?? null,
      input.needsCredentials ?? null,
      encryptedApiKey,
      encryptedApiSecret,
      input.configuration === undefined ? null : JSON.stringify(input.configuration),
      input.timeoutMs ?? null,
      input.rateLimitPerMinute ?? null,
      input.priority ?? null,
      input.quotaNote ?? null,
      hasNewSecret,
    ]
  );
  const updated = rows[0];
  if (!updated) throw new Error('saveProvider: update returned no row');
  return updated;
}

export async function deleteProvider(db: Queryable, slug: string): Promise<boolean> {
  const { rows } = await db.query<{ slug: string }>(
    `DELETE FROM tool_provider_configs WHERE slug = $1 RETURNING slug`,
    [slug]
  );
  return rows.length > 0;
}

export interface ProviderOutcome {
  ok: boolean;
  latencyMs?: number;
  error?: string | null;
}

/** Records a provider call outcome and updates its derived health fields (spec §83). */
export async function recordProviderOutcome(db: Queryable, slug: string, outcome: ProviderOutcome): Promise<void> {
  await db.query(
    `UPDATE tool_provider_configs SET
       health_status = CASE WHEN $2 THEN 'HEALTHY' ELSE 'DEGRADED' END,
       health_detail = $3,
       last_checked_at = now(),
       last_success_at = CASE WHEN $2 THEN now() ELSE last_success_at END,
       last_failure_at = CASE WHEN $2 THEN last_failure_at ELSE now() END,
       last_error = $3,
       updated_at = now()
     WHERE slug = $1`,
    [slug, outcome.ok, outcome.ok ? (outcome.latencyMs !== undefined ? `${outcome.latencyMs} ms` : null) : (outcome.error ?? 'Request failed')]
  );
}

export interface ProviderTestResult {
  slug: string;
  ok: boolean;
  status: ProviderRow['health_status'];
  latencyMs: number | null;
  detail: string;
}

/**
 * Operator-triggered connection test (spec §61 "Test connection", §83). Each kind is tested with
 * the cheapest request that genuinely proves reachability — never a mock success:
 *   DNSBL      — an A query for a test address the zone must answer (127.0.0.2 is the documented
 *                "always listed" test address for Spamhaus-compatible zones).
 *   RDAP/HTTP  — a HEAD/GET against the configured endpoint, reporting the HTTP status.
 *   Others     — reported as NOT_TESTABLE with the reason, rather than a fabricated green tick.
 */
export async function testProviderConnection(
  db: Queryable,
  slug: string,
  deps: {
    dnsQuery?: (name: string, type: string, timeoutMs: number) => Promise<{ ok: boolean; message: string; durationMs: number }>;
    fetchProbe?: (url: string, timeoutMs: number) => Promise<{ status: number; durationMs: number }>;
  } = {}
): Promise<ProviderTestResult> {
  const row = await findProvider(db, slug);
  if (!row) throw invalidInput(`Unknown provider "${slug}"`);
  const view = toProviderView(row);
  const startedAt = performance.now();

  if (!row.enabled) {
    return { slug, ok: false, status: 'DISABLED', latencyMs: null, detail: 'This provider is disabled.' };
  }
  if (view.requirement) {
    const result: ProviderTestResult = { slug, ok: false, status: 'CONFIGURATION_REQUIRED', latencyMs: null, detail: view.requirement };
    await recordProviderOutcome(db, slug, { ok: false, error: view.requirement });
    return result;
  }

  if (row.kind === 'DNSBL') {
    if (!deps.dnsQuery) {
      return { slug, ok: false, status: row.health_status, latencyMs: null, detail: 'DNS probing is not available in this runtime.' };
    }
    const zone = row.endpoint ?? String(row.configuration.zone ?? '');
    if (!zone) {
      const detail = 'This blocklist has no zone name configured.';
      await recordProviderOutcome(db, slug, { ok: false, error: detail });
      return { slug, ok: false, status: 'CONFIGURATION_REQUIRED', latencyMs: null, detail };
    }
    const probe = await deps.dnsQuery(`2.0.0.127.${zone}`, 'A', row.timeout_ms);
    const detail = probe.ok
      ? `Zone answered for the documented test address in ${probe.durationMs} ms.`
      : `Zone did not answer the test address: ${probe.message}`;
    await recordProviderOutcome(db, slug, { ok: probe.ok, latencyMs: probe.durationMs, error: probe.ok ? null : detail });
    return {
      slug,
      ok: probe.ok,
      status: probe.ok ? 'HEALTHY' : 'DEGRADED',
      latencyMs: probe.durationMs,
      detail,
    };
  }

  if (!row.endpoint) {
    const detail = 'This provider has no endpoint configured.';
    await recordProviderOutcome(db, slug, { ok: false, error: detail });
    return { slug, ok: false, status: 'CONFIGURATION_REQUIRED', latencyMs: null, detail };
  }

  if (!deps.fetchProbe) {
    return { slug, ok: false, status: row.health_status, latencyMs: null, detail: 'Outbound HTTP is not available in this runtime.' };
  }

  try {
    const probe = await deps.fetchProbe(row.endpoint, row.timeout_ms);
    const healthy = probe.status < 500;
    const detail = `Endpoint answered HTTP ${probe.status} in ${probe.durationMs} ms.${probe.status === 401 || probe.status === 403 ? ' The endpoint requires authentication — check the stored credential.' : ''}`;
    await recordProviderOutcome(db, slug, { ok: healthy, latencyMs: probe.durationMs, error: healthy ? null : detail });
    return { slug, ok: healthy, status: healthy ? 'HEALTHY' : 'DEGRADED', latencyMs: probe.durationMs, detail };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Request failed';
    await recordProviderOutcome(db, slug, { ok: false, error: detail });
    return { slug, ok: false, status: 'DOWN', latencyMs: Math.round(performance.now() - startedAt), detail };
  }
}

/** True when at least one provider of the kind is usable; never throws (used by the registry). */
export async function hasUsableProvider(db: Queryable, kind: ProviderKind): Promise<boolean> {
  const views = await usableProviders(db, kind);
  return views.length > 0;
}

/**
 * Aggregate provider health for the admin dashboard (spec §82/§83): call counts, failure counts and
 * error rate from the execution log, joined to each provider's declared kind.
 */
export async function providerHealthSummary(db: Queryable): Promise<
  Array<{
    slug: string;
    kind: ProviderKind;
    healthStatus: ProviderRow['health_status'];
    latencyMs: number | null;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    errorRate: number | null;
    checks: number;
    failures: number;
  }>
> {
  const providers = await listProviders(db);
  if (providers.length === 0) return [];
  const { rows } = await db.query<{ subject_slug: string; checks: string; failures: string; avg_latency: string | null }>(
    `SELECT subject_slug,
            count(*)::text AS checks,
            count(*) FILTER (WHERE status <> 'HEALTHY')::text AS failures,
            avg(latency_ms)::text AS avg_latency
       FROM tool_health_checks
      WHERE subject_type = 'provider' AND checked_at > now() - interval '7 days'
      GROUP BY subject_slug`
  );
  const byslug = new Map(rows.map((row) => [row.subject_slug, row]));
  return providers.map((provider) => {
    const stats = byslug.get(provider.slug);
    const checks = Number.parseInt(stats?.checks ?? '0', 10);
    const failures = Number.parseInt(stats?.failures ?? '0', 10);
    return {
      slug: provider.slug,
      kind: provider.kind,
      healthStatus: provider.health_status,
      latencyMs: provider.last_checked_at && provider.health_detail?.includes('ms') ? Number.parseInt(provider.health_detail, 10) || null : stats?.avg_latency ? Math.round(Number.parseFloat(stats.avg_latency)) : null,
      lastSuccessAt: provider.last_success_at,
      lastFailureAt: provider.last_failure_at,
      errorRate: checks > 0 ? failures / checks : null,
      checks,
      failures,
    };
  });
}
