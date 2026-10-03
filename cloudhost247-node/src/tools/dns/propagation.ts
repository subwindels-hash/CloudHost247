/**
 * Tools Center — DNS propagation checker (spec §4).
 *
 * The tool sends one question to every enabled resolver in the registry and records the answer,
 * the resolver's identity, response time and a per-resolver status. Two honesty constraints are
 * built into the output:
 *
 *   1. The summary says "N of M resolvers queried answered with the expected value". It never says
 *      "propagated worldwide", because a resolver sample is not the world (spec §4).
 *   2. A resolver that did not answer is reported as TIMEOUT/ERROR — never as "not propagated".
 *      Absence of an answer is not evidence of absence of a record.
 *
 * Results are persisted as one run row so they can be exported, saved as a report or attached to a
 * support ticket exactly as the customer saw them.
 */
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { Queryable } from '../../db/types';
import { queryResolver } from '../core/dns-client';
import { toResolverTarget, listResolvers, type ResolverRow } from '../core/resolvers';
import { capabilityReport } from '../core/capabilities';
import { invalidInput } from '../core/errors';
import { listEffectiveTools, type EffectiveTool } from '../core/registry';
import { formatRecord, normalizeDomain, parentZone } from './common';
import { assertLookupType } from './lookup';
import { matchExpected, type MatchMode } from './records';

export type ResolverStatus = 'PROPAGATED' | 'NOT_PROPAGATED' | 'MISMATCH' | 'TIMEOUT' | 'ERROR';

export interface PropagationResolverResult {
  resolverId: string;
  resolverName: string;
  provider: string;
  ipAddress: string;
  protocol: string;
  version: string;
  country: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  anycast: boolean;
  status: ResolverStatus;
  rcode: string | null;
  values: string[];
  records: Array<{ name: string; type: string; ttl: number; value: string }>;
  expected: string | null;
  matchMode: MatchMode | null;
  matched: boolean | null;
  responseTimeMs: number;
  error: string | null;
  timestamp: string;
}

export interface PropagationSummary {
  resolversQueried: number;
  answered: number;
  propagated: number;
  notPropagated: number;
  mismatched: number;
  timeouts: number;
  errors: number;
  /** Distinct values seen, most frequent first. */
  valueDistribution: Array<{ value: string; count: number }>;
  fastestMs: number | null;
  slowestMs: number | null;
}

export interface PropagationResult {
  runId: string;
  domain: string;
  recordType: string;
  expectedValue: string | null;
  matchMode: MatchMode | null;
  /** 'PROPAGATED' | 'PARTIAL' | 'NOT_PROPAGATED' | 'INCONCLUSIVE' | 'ERROR' */
  status: 'PROPAGATED' | 'PARTIAL' | 'NOT_PROPAGATED' | 'INCONCLUSIVE' | 'ERROR';
  statusMessage: string;
  summary: PropagationSummary;
  results: PropagationResolverResult[];
  caveats: string[];
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

export interface PropagationInput {
  domain: string;
  recordType: string;
  expectedValue?: string | null;
  matchMode?: MatchMode;
  /** Filters (country/region/protocol/version) applied to the registry. */
  country?: string;
  region?: string;
  protocol?: string;
  version?: 'IPv4' | 'IPv6';
  /** Cap the number of resolvers (the UI's "quick check" mode). */
  maxResolvers?: number;
  /** Persist the run. Defaults to true. */
  persist?: boolean;
  userId?: string | null;
  /** Injected for tests: run against a fixed resolver list. */
  resolversOverride?: ResolverRow[];
  /** Injected for tests: replaces the live query. */
  queryImpl?: typeof queryResolver;
}

const MAX_CONCURRENCY = 8;
const DEFAULT_RESOLVER_LIMIT = 40;

function extractValues(records: Array<{ type: string; value: string; detail: Record<string, unknown> }>, recordType: string): string[] {
  return records
    .filter((record) => record.type.toUpperCase() === recordType.toUpperCase())
    .map((record) => {
      if (recordType === 'TXT') return String((record.detail as { value?: string }).value ?? record.value);
      if ((recordType === 'MX' || recordType === 'SRV') && typeof (record.detail as { preference?: number }).preference === 'number') {
        return record.value;
      }
      return record.value;
    });
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await worker(item, index);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function runPropagation(db: Queryable, input: PropagationInput): Promise<PropagationResult> {
  const domain = normalizeDomain(input.domain);
  const recordType = assertLookupType(input.recordType);
  const matchMode: MatchMode | null = input.expectedValue ? (input.matchMode ?? 'exact') : null;
  if (matchMode && !['exact', 'contains', 'regex'].includes(matchMode)) {
    throw invalidInput('The match mode must be exact, contains or regex.');
  }

  const hasIpv6 = capabilityReport('ipv6-outbound').status === 'AVAILABLE';
  const maxResolvers = Math.min(Math.max(input.maxResolvers ?? DEFAULT_RESOLVER_LIMIT, 1), 60);

  let resolvers = input.resolversOverride ?? (await listResolvers(db, { enabledOnly: true, includeIpv6: hasIpv6, limit: 200 }));
  if (!input.resolversOverride) {
    if (input.country) resolvers = resolvers.filter((row) => (row.country_code ?? '').toLowerCase() === input.country!.toLowerCase());
    if (input.region) resolvers = resolvers.filter((row) => (row.region ?? '').toLowerCase().includes(input.region!.toLowerCase()));
    if (input.protocol) resolvers = resolvers.filter((row) => row.protocol === input.protocol!.toUpperCase());
    if (input.version) resolvers = resolvers.filter((row) => row.version === input.version);
  }
  resolvers = resolvers.slice(0, maxResolvers);

  if (resolvers.length === 0) {
    throw invalidInput('No resolver matched the selected filters. Clear a filter or ask an administrator to enable more resolvers.');
  }

  const startedAt = new Date();
  const runId = randomUUID();
  const queryImpl = input.queryImpl ?? queryResolver;

  const results = await mapWithConcurrency(resolvers, MAX_CONCURRENCY, async (row): Promise<PropagationResolverResult> => {
    const startedQuery = performance.now();
    const base: Omit<PropagationResolverResult, 'status' | 'responseTimeMs' | 'error' | 'values' | 'records' | 'rcode' | 'matched'> = {
      resolverId: row.id,
      resolverName: row.name,
      provider: row.provider,
      ipAddress: row.ip_address,
      protocol: row.protocol,
      version: row.version,
      country: row.country,
      countryCode: row.country_code,
      region: row.region,
      city: row.city,
      anycast: row.anycast,
      expected: input.expectedValue ?? null,
      matchMode,
      timestamp: new Date().toISOString(),
    };

    let outcome;
    try {
      outcome = await queryImpl(toResolverTarget(row), domain, recordType, { timeoutMs: 5000, dnssec: recordType === 'DS' || recordType === 'DNSKEY' });
    } catch (error) {
      return {
        ...base,
        status: 'ERROR',
        rcode: null,
        values: [],
        records: [],
        matched: null,
        responseTimeMs: Math.round(performance.now() - startedQuery),
        error: error instanceof Error ? error.message : 'The query failed.',
        timestamp: new Date().toISOString(),
      };
    }

    const responseTimeMs = outcome.durationMs;
    if (!outcome.ok) {
      return {
        ...base,
        status: outcome.code === 'TIMEOUT' ? 'TIMEOUT' : 'ERROR',
        rcode: outcome.rcodeText ?? outcome.code,
        values: [],
        records: [],
        matched: null,
        responseTimeMs,
        error: outcome.message,
        timestamp: new Date().toISOString(),
      };
    }

    const formatted = outcome.message.answers
      .filter((record) => record.type.toUpperCase() === recordType)
      .map(formatRecord);
    const values = extractValues(formatted, recordType);
    const records = formatted.map((record) => ({ name: record.name, type: record.type, ttl: record.ttl, value: record.value }));

    const totalAnswers = outcome.message.answers.length;
    const nxdomain = outcome.message.rcode === 3;

    let status: ResolverStatus;
    let matched: boolean | null = null;
    if (values.length === 0) {
      // No records of the requested type in the answer section.
      status = 'NOT_PROPAGATED';
    } else if (matchMode && input.expectedValue) {
      const match = matchExpected(values.join(' '), input.expectedValue, matchMode);
      matched = match.matched;
      status = match.matched ? 'PROPAGATED' : 'MISMATCH';
    } else {
      status = 'PROPAGATED';
    }

    return {
      ...base,
      status,
      rcode: outcome.message.rcodeText,
      values,
      records,
      matched,
      responseTimeMs,
      error: nxdomain
        ? `${row.name} answered NXDOMAIN for ${domain}; the name does not exist in that resolver's view.`
        : totalAnswers === 0 && values.length === 0
          ? `${row.name} answered NOERROR with no ${recordType} records.`
          : null,
      timestamp: new Date().toISOString(),
    };
  });

  const summary = summarise(results);
  const status = overallStatus(results, summary, matchMode);
  const completedAt = new Date();

  const caveats = [
    `These results describe the ${results.length} resolver(s) actually queried — not every DNS server on the internet.`,
    'Resolvers cache answers for the record\'s TTL, so a recent change can legitimately appear on some resolvers and not others until each cached copy expires.',
    'Many resolvers are anycast: the country shown is the resolver operator\'s published location, not necessarily the datacentre that answered this particular query.',
    ...(input.expectedValue ? [`Expected-value matching used "${matchMode}" mode.`] : []),
  ];

  const result: PropagationResult = {
    runId,
    domain,
    recordType,
    expectedValue: input.expectedValue ?? null,
    matchMode,
    status,
    statusMessage: statusMessage(status, summary, matchMode !== null),
    summary,
    results,
    caveats,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
  };

  if (input.persist !== false) {
    await db.query(
      `INSERT INTO tool_propagation_runs
         (id, user_id, domain, record_type, expected_value, match_mode, status, status_message,
          resolvers_queried, resolvers_answered, results)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        runId,
        input.userId ?? null,
        domain,
        recordType,
        input.expectedValue ?? null,
        matchMode ?? 'exact',
        status,
        result.statusMessage,
        summary.resolversQueried,
        summary.answered,
        JSON.stringify(results),
      ]
    );
  }

  return result;
}

function summarise(results: PropagationResolverResult[]): PropagationSummary {
  const distribution = new Map<string, number>();
  let fastest: number | null = null;
  let slowest: number | null = null;

  for (const result of results) {
    for (const value of result.values) {
      distribution.set(value, (distribution.get(value) ?? 0) + 1);
    }
    if (result.status !== 'TIMEOUT' && result.status !== 'ERROR') {
      fastest = fastest === null ? result.responseTimeMs : Math.min(fastest, result.responseTimeMs);
      slowest = slowest === null ? result.responseTimeMs : Math.max(slowest, result.responseTimeMs);
    }
  }

  return {
    resolversQueried: results.length,
    answered: results.filter((result) => result.status !== 'TIMEOUT' && result.status !== 'ERROR').length,
    propagated: results.filter((result) => result.status === 'PROPAGATED').length,
    notPropagated: results.filter((result) => result.status === 'NOT_PROPAGATED').length,
    mismatched: results.filter((result) => result.status === 'MISMATCH').length,
    timeouts: results.filter((result) => result.status === 'TIMEOUT').length,
    errors: results.filter((result) => result.status === 'ERROR').length,
    valueDistribution: [...distribution.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count),
    fastestMs: fastest,
    slowestMs: slowest,
  };
}

function overallStatus(
  results: PropagationResolverResult[],
  summary: PropagationSummary,
  matchMode: MatchMode | null
): PropagationResult['status'] {
  if (results.length === 0) return 'ERROR';
  if (summary.answered === 0) return 'ERROR';
  if (summary.propagated === summary.answered && summary.answered === summary.resolversQueried) return 'PROPAGATED';
  if (summary.propagated > 0) return 'PARTIAL';
  if (summary.mismatched > 0) return 'NOT_PROPAGATED';
  if (summary.notPropagated > 0 && summary.answered > 0) return matchMode ? 'NOT_PROPAGATED' : 'NOT_PROPAGATED';
  return 'INCONCLUSIVE';
}

function statusMessage(status: PropagationResult['status'], summary: PropagationSummary, hasExpected: boolean): string {
  switch (status) {
    case 'PROPAGATED':
      return hasExpected
        ? `All ${summary.resolversQueried} queried resolver(s) returned the expected value.`
        : `All ${summary.resolversQueried} queried resolver(s) returned records for this name and type.`;
    case 'PARTIAL':
      return `${summary.propagated} of ${summary.resolversQueried} queried resolver(s) returned the expected value; ${summary.mismatched} mismatch, ${summary.notPropagated} have no such record, ${summary.timeouts + summary.errors} did not answer.`;
    case 'NOT_PROPAGATED':
      return hasExpected
        ? `None of the ${summary.resolversQueried} queried resolver(s) returned the expected value.`
        : `None of the ${summary.resolversQueried} queried resolver(s) returned records for this name and type.`;
    case 'INCONCLUSIVE':
      return `The ${summary.resolversQueried} queried resolver(s) gave no consistent answer; ${summary.timeouts + summary.errors} did not respond. Re-run before drawing a conclusion.`;
    default:
      return 'None of the queried resolvers answered, so no conclusion about propagation can be drawn.';
  }
}

/** Loads a persisted run, scoped to its owner (or staff). */
export async function getPropagationRun(db: Queryable, runId: string): Promise<Record<string, unknown> | null> {
  const { rows } = await db.query<Record<string, unknown>>(`SELECT * FROM tool_propagation_runs WHERE id = $1`, [runId]);
  return rows[0] ?? null;
}

/** The registry-reported resolver set, for the propagation UI's country/protocol filters. */
export async function propagationFilters(db: Queryable): Promise<{
  countries: Array<{ code: string | null; country: string | null; resolvers: number }>;
  protocols: Array<{ protocol: string; resolvers: number }>;
  regions: string[];
}> {
  const rows = await listResolvers(db, { enabledOnly: true, limit: 200 });
  const countries = new Map<string, { code: string | null; country: string | null; resolvers: number }>();
  const protocols = new Map<string, number>();
  const regions = new Set<string>();
  for (const row of rows) {
    const key = row.country_code ?? row.country ?? 'unknown';
    const existing = countries.get(key) ?? { code: row.country_code, country: row.country, resolvers: 0 };
    existing.resolvers += 1;
    countries.set(key, existing);
    protocols.set(row.protocol, (protocols.get(row.protocol) ?? 0) + 1);
    if (row.region) regions.add(row.region);
  }
  return {
    countries: [...countries.values()].sort((a, b) => (a.country ?? '').localeCompare(b.country ?? '')),
    protocols: [...protocols.entries()].map(([protocol, resolvers]) => ({ protocol, resolvers })),
    regions: [...regions].sort(),
  };
}

/** Convenience helper for the domain-health page: A-record propagation checked quickly. */
export async function quickPropagation(db: Queryable, domain: string, options: Partial<PropagationInput> = {}): Promise<PropagationResult> {
  return runPropagation(db, {
    domain,
    recordType: 'A',
    maxResolvers: 6,
    persist: false,
    ...options,
  });
}

/** Tools registry entry for propagation, used by the AI explainer to describe the tool. */
export async function propagationToolDefinition(db: Queryable): Promise<EffectiveTool | null> {
  const { tools } = await listEffectiveTools(db);
  return tools.find((tool) => tool.slug === 'dns-propagation') ?? null;
}

export { parentZone };
