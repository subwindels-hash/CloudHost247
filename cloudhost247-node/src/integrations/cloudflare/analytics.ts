/**
 * Zone analytics via Cloudflare's GraphQL Analytics API (spec §17, §59) — the current
 * replacement for the deprecated zone-analytics dashboard endpoint.
 *
 * Honesty rule: if the API cannot provide a metric, its value is null and the route reports
 * DATA_UNAVAILABLE — nothing is fabricated (spec §66–§67).
 */
import type { CloudflareClient } from './client';
import { CloudflareError } from './errors';
import type { CfAnalyticsTotals } from './types';

interface GraphQlGroup {
  sum?: {
    requests?: number;
    cachedRequests?: number;
    bytes?: number;
    cachedBytes?: number;
    threats?: number;
    pageViews?: number;
  };
  uniq?: { uniques?: number };
  dimensions?: { date?: string };
}

interface GraphQlResponse {
  data?: { viewer?: { zones?: Array<{ httpRequests1dGroups?: GraphQlGroup[] }> } };
  errors?: Array<{ message?: string }> | null;
}

export interface ZoneAnalytics {
  rangeDays: number;
  since: string;
  until: string;
  totals: CfAnalyticsTotals;
  daily: Array<{ date: string; requests: number | null; bytes: number | null; threats: number | null; cachedRequests: number | null }>;
}

export async function getZoneAnalytics(client: CloudflareClient, zoneId: string, rangeDays: number): Promise<ZoneAnalytics> {
  const days = Math.min(30, Math.max(1, rangeDays));
  const until = new Date();
  const since = new Date(until.getTime() - days * 86_400_000);
  const sinceDate = since.toISOString().slice(0, 10);
  const untilDate = until.toISOString().slice(0, 10);

  const query = `
    query ZoneAnalytics($zoneTag: String!, $since: String!, $until: String!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequests1dGroups(limit: 31, filter: { date_geq: $since, date_leq: $until }, orderBy: [date_ASC]) {
            sum { requests cachedRequests bytes cachedBytes threats pageViews }
            uniq { uniques }
            dimensions { date }
          }
        }
      }
    }`;

  const { result } = await client.request<GraphQlResponse | null>('analytics.graphql', 'POST', '/graphql', {
    query,
    variables: { zoneTag: zoneId, since: sinceDate, until: untilDate },
  }).catch(async (error: unknown) => {
    // The GraphQL endpoint wraps errors differently from REST; on a hard failure we surface
    // DATA_UNAVAILABLE via the FEATURE_NOT_SUPPORTED code rather than pretending zeros.
    if (error instanceof CloudflareError) throw error;
    throw new CloudflareError('CLOUDFLARE_API_ERROR', 'analytics query failed');
  });

  const groups = result?.data?.viewer?.zones?.[0]?.httpRequests1dGroups;
  if (!groups) {
    return {
      rangeDays: days,
      since: sinceDate,
      until: untilDate,
      totals: { requests: null, cachedRequests: null, bytes: null, cachedBytes: null, threats: null, pageViews: null, uniques: null },
      daily: [],
    };
  }

  const totals: CfAnalyticsTotals = { requests: 0, cachedRequests: 0, bytes: 0, cachedBytes: 0, threats: 0, pageViews: 0, uniques: 0 };
  const daily: ZoneAnalytics['daily'] = [];
  for (const group of groups) {
    totals.requests = (totals.requests ?? 0) + (group.sum?.requests ?? 0);
    totals.cachedRequests = (totals.cachedRequests ?? 0) + (group.sum?.cachedRequests ?? 0);
    totals.bytes = (totals.bytes ?? 0) + (group.sum?.bytes ?? 0);
    totals.cachedBytes = (totals.cachedBytes ?? 0) + (group.sum?.cachedBytes ?? 0);
    totals.threats = (totals.threats ?? 0) + (group.sum?.threats ?? 0);
    totals.pageViews = (totals.pageViews ?? 0) + (group.sum?.pageViews ?? 0);
    totals.uniques = Math.max(totals.uniques ?? 0, group.uniq?.uniques ?? 0);
    daily.push({
      date: group.dimensions?.date ?? '',
      requests: group.sum?.requests ?? null,
      bytes: group.sum?.bytes ?? null,
      threats: group.sum?.threats ?? null,
      cachedRequests: group.sum?.cachedRequests ?? null,
    });
  }
  return { rangeDays: days, since: sinceDate, until: untilDate, totals, daily };
}
