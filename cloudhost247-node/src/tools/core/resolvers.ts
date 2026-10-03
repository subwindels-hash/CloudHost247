/**
 * Tools Center — the managed DNS resolver registry (spec §66).
 *
 * Resolvers are rows in `tool_resolvers`, seeded with publicly documented recursive resolvers and
 * manageable by a Super Admin. Every propagation row is attributable to one of these rows, which is
 * what makes "which resolvers answered" a fact rather than a claim.
 *
 * Health checking is a real query (`example.com` A) with the resolver's own protocol — never a TCP
 * port ping, which would say nothing about whether DNS answers.
 */
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../../db/types';
import { queryResolver, type ResolverProtocol, type ResolverTarget } from './dns-client';
import { invalidInput } from './errors';

export interface ResolverRow {
  id: string;
  name: string;
  provider: string;
  ip_address: string;
  protocol: ResolverProtocol;
  version: 'IPv4' | 'IPv6';
  country: string | null;
  country_code: string | null;
  region: string | null;
  city: string | null;
  latitude: string | null;
  longitude: string | null;
  endpoint: string | null;
  anycast: boolean;
  enabled: boolean;
  priority: number;
  health_status: 'UNKNOWN' | 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'DISABLED';
  health_detail: string | null;
  last_checked_at: string | null;
  last_latency_ms: number | null;
  created_at: string;
  updated_at: string;
}

export function toResolverTarget(row: ResolverRow): ResolverTarget {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    ipAddress: row.ip_address,
    protocol: row.protocol,
    version: row.version,
    endpoint: row.endpoint,
    country: row.country,
    countryCode: row.country_code,
    region: row.region,
    city: row.city,
  };
}

export interface ListResolversOptions {
  enabledOnly?: boolean;
  protocols?: ResolverProtocol[];
  limit?: number;
  /** IPv6 resolvers are filtered out when the deployment has no IPv6 stack. */
  includeIpv6?: boolean;
}

export async function listResolvers(db: Queryable, options: ListResolversOptions = {}): Promise<ResolverRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (options.enabledOnly) conditions.push('enabled = true');
  if (options.protocols && options.protocols.length > 0) {
    params.push(options.protocols);
    conditions.push(`protocol = ANY($${params.length}::text[])`);
  }
  if (options.includeIpv6 === false) conditions.push(`version = 'IPv4'`);
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const { rows } = await db.query<ResolverRow>(
    `SELECT * FROM tool_resolvers ${where} ORDER BY priority ASC, name ASC LIMIT ${limit}`,
    params
  );
  return rows;
}

export async function findResolver(db: Queryable, id: string): Promise<ResolverRow | null> {
  const { rows } = await db.query<ResolverRow>(`SELECT * FROM tool_resolvers WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export interface ResolverInput {
  name: string;
  provider: string;
  ipAddress: string;
  protocol: ResolverProtocol;
  version: 'IPv4' | 'IPv6';
  country?: string | null;
  countryCode?: string | null;
  region?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  endpoint?: string | null;
  anycast?: boolean;
  enabled?: boolean;
  priority?: number;
}

export async function createResolver(db: Queryable, input: ResolverInput): Promise<ResolverRow> {
  if (input.protocol === 'DOH' && !input.endpoint) {
    throw invalidInput('A DNS-over-HTTPS resolver needs an https:// endpoint.');
  }
  if (input.protocol === 'DOT' && !input.endpoint) {
    throw invalidInput('A DNS-over-TLS resolver needs a tls:// endpoint (host:port).');
  }
  const { rows } = await db.query<ResolverRow>(
    `INSERT INTO tool_resolvers
       (id, name, provider, ip_address, protocol, version, country, country_code, region, city,
        latitude, longitude, endpoint, anycast, enabled, priority, health_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'UNKNOWN')
     ON CONFLICT (ip_address, protocol) DO UPDATE SET
       name = EXCLUDED.name, provider = EXCLUDED.provider, version = EXCLUDED.version,
       country = EXCLUDED.country, country_code = EXCLUDED.country_code, region = EXCLUDED.region,
       city = EXCLUDED.city, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
       endpoint = EXCLUDED.endpoint, anycast = EXCLUDED.anycast, enabled = EXCLUDED.enabled,
       priority = EXCLUDED.priority, updated_at = now()
     RETURNING *`,
    [
      randomUUID(),
      input.name,
      input.provider,
      input.ipAddress,
      input.protocol,
      input.version,
      input.country ?? null,
      input.countryCode ?? null,
      input.region ?? null,
      input.city ?? null,
      input.latitude ?? null,
      input.longitude ?? null,
      input.endpoint ?? null,
      input.anycast ?? false,
      input.enabled ?? true,
      input.priority ?? 100,
    ]
  );
  const created = rows[0];
  if (!created) throw new Error('createResolver: upsert returned no row');
  return created;
}

export interface UpdateResolverInput {
  name?: string;
  provider?: string;
  country?: string | null;
  countryCode?: string | null;
  region?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  endpoint?: string | null;
  anycast?: boolean;
  enabled?: boolean;
  priority?: number;
}

export async function updateResolver(db: Queryable, id: string, input: UpdateResolverInput): Promise<ResolverRow> {
  const { rows } = await db.query<ResolverRow>(
    `UPDATE tool_resolvers SET
       name = COALESCE($2, name),
       provider = COALESCE($3, provider),
       country = $4,
       country_code = $5,
       region = $6,
       city = $7,
       latitude = $8,
       longitude = $9,
       endpoint = $10,
       anycast = COALESCE($11, anycast),
       enabled = COALESCE($12, enabled),
       priority = COALESCE($13, priority),
       health_status = CASE WHEN $12 IS FALSE THEN 'DISABLED' ELSE health_status END,
       updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [
      id,
      input.name ?? null,
      input.provider ?? null,
      input.country === undefined ? null : input.country,
      input.countryCode === undefined ? null : input.countryCode,
      input.region === undefined ? null : input.region,
      input.city === undefined ? null : input.city,
      input.latitude === undefined ? null : input.latitude,
      input.longitude === undefined ? null : input.longitude,
      input.endpoint === undefined ? null : input.endpoint,
      input.anycast ?? null,
      input.enabled ?? null,
      input.priority ?? null,
    ]
  );
  const updated = rows[0];
  if (!updated) throw invalidInput('Resolver not found');
  return updated;
}

export async function deleteResolver(db: Queryable, id: string): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(`DELETE FROM tool_resolvers WHERE id = $1 RETURNING id`, [id]);
  return rows.length > 0;
}

export interface ResolverHealthResult {
  id: string;
  name: string;
  status: 'HEALTHY' | 'DEGRADED' | 'DOWN';
  latencyMs: number;
  detail: string;
}

const DEGRADED_AFTER_MS = 1500;

/**
 * Health-checks one resolver with a real DNS query and persists the result plus a health-history
 * row (spec §66 `health_status`/`last_checked`, §84 scheduled health checks).
 */
export async function checkResolverHealth(db: Queryable, row: ResolverRow, timeoutMs = 3000): Promise<ResolverHealthResult> {
  const startedAt = performance.now();
  const outcome = await queryResolver(toResolverTarget(row), 'example.com', 'A', { timeoutMs });
  const latencyMs = outcome.ok ? outcome.durationMs : Math.round(performance.now() - startedAt);

  let status: ResolverHealthResult['status'];
  let detail: string;
  if (outcome.ok) {
    if (outcome.message.rcode === 3) {
      status = 'DEGRADED';
      detail = 'The resolver answered NXDOMAIN for example.com — reachable but not resolving correctly.';
    } else if (latencyMs > DEGRADED_AFTER_MS) {
      status = 'DEGRADED';
      detail = `Answered in ${latencyMs} ms (slower than the ${DEGRADED_AFTER_MS} ms healthy threshold).`;
    } else {
      status = 'HEALTHY';
      detail = `Answered in ${latencyMs} ms${outcome.tcpFallback ? ' (TCP fallback after truncation)' : ''}.`;
    }
  } else {
    status = outcome.code === 'TIMEOUT' || outcome.code === 'NO_RESPONSE' ? 'DOWN' : 'DEGRADED';
    detail = `${outcome.code}: ${outcome.message}`;
  }

  await db.query(
    `UPDATE tool_resolvers SET health_status = $2, health_detail = $3, last_checked_at = now(), last_latency_ms = $4, updated_at = now() WHERE id = $1`,
    [row.id, status, detail, latencyMs]
  );
  await db.query(
    `INSERT INTO tool_health_checks (id, subject_type, subject_slug, status, latency_ms, detail) VALUES ($1,'resolver',$2,$3,$4,$5)`,
    [randomUUID(), row.name, status, latencyMs, detail]
  );

  return { id: row.id, name: row.name, status, latencyMs, detail };
}

export interface ResolverHealthSweepResult {
  checked: number;
  healthy: number;
  degraded: number;
  down: number;
  results: ResolverHealthResult[];
}

/** Checks the least-recently-checked enabled resolvers (bounded batch, cron-friendly). */
export async function sweepResolverHealth(db: Queryable, batch = 6): Promise<ResolverHealthSweepResult> {
  const { rows } = await db.query<ResolverRow>(
    `SELECT * FROM tool_resolvers
      WHERE enabled = true
      ORDER BY last_checked_at ASC NULLS FIRST, priority ASC
      LIMIT $1`,
    [Math.min(Math.max(batch, 1), 50)]
  );
  const results: ResolverHealthResult[] = [];
  for (const row of rows) {
    results.push(await checkResolverHealth(db, row));
  }
  return {
    checked: results.length,
    healthy: results.filter((r) => r.status === 'HEALTHY').length,
    degraded: results.filter((r) => r.status === 'DEGRADED').length,
    down: results.filter((r) => r.status === 'DOWN').length,
    results,
  };
}

/** Resolvers used by propagation when no explicit protocol filter is supplied. */
export async function propagationResolvers(db: Queryable, options: { includeIpv6: boolean } = { includeIpv6: true }): Promise<ResolverRow[]> {
  const rows = await listResolvers(db, { enabledOnly: true, includeIpv6: options.includeIpv6, limit: 200 });
  return rows.filter((row) => row.health_status !== 'DOWN' || row.last_checked_at === null);
}
