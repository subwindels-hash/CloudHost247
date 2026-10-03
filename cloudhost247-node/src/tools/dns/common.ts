/**
 * Tools Center — shared DNS plumbing for the DNS tools.
 *
 * All DNS tools resolve against the managed registry (never the host's own resolver), so every
 * answer is attributable to a named resolver and the operator can add, disable or re-prioritise
 * resolvers without touching tool code.
 */
import type { Queryable } from '../../db/types';
import { invalidInput, serviceUnavailable, ToolError } from '../core/errors';
import { queryResolver, type DnsQueryOutcome, type ResolverProtocol } from '../core/dns-client';
import { listResolvers, toResolverTarget, type ResolverRow } from '../core/resolvers';
import { capabilityReport } from '../core/capabilities';
import type { ParsedRecord } from '../core/dns-wire';

export const DOMAIN_PATTERN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/** Validates and normalizes a user-supplied domain name. */
export function normalizeDomain(input: string): string {
  const trimmed = input.trim().toLowerCase().replace(/\.$/, '');
  const withoutScheme = trimmed.replace(/^https?:\/\//, '').split('/')[0] ?? trimmed;
  const host = withoutScheme.split(':')[0] ?? withoutScheme;
  if (host.length === 0) throw invalidInput('Enter a domain name to check.');
  if (!DOMAIN_PATTERN.test(host)) {
    throw invalidInput(
      `"${input}" is not a valid public domain name. Enter a registrable name such as example.com (no scheme, path or spaces).`
    );
  }
  return host;
}

/** Validates a DNS name that may include an underscore-prefixed service label (_dmarc, _domainkey). */
export function normalizeServiceName(input: string): string {
  const trimmed = input.trim().toLowerCase().replace(/\.$/, '');
  if (!/^(?=.{1,253}$)(_?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i.test(trimmed)) {
    throw invalidInput(`"${input}" is not a valid DNS name.`);
  }
  return trimmed;
}

export interface ResolverChoice {
  protocol?: ResolverProtocol;
  /** Explicit resolver id (admin/tests). */
  id?: string;
}

/**
 * Picks the resolver a single-answer tool should use: the highest-priority enabled resolver,
 * preferring UDP, and skipping IPv6 rows when the deployment has no IPv6 stack (which would fail
 * with an unhelpful socket error otherwise).
 */
export async function pickResolver(db: Queryable, choice: ResolverChoice = {}): Promise<ResolverRow> {
  const hasIpv6 = capabilityReport('ipv6-outbound').status === 'AVAILABLE';
  const rows = await listResolvers(db, {
    enabledOnly: true,
    includeIpv6: hasIpv6,
    ...(choice.protocol ? { protocols: [choice.protocol] } : {}),
    limit: 50,
  });
  const explicit = choice.id ? rows.find((row) => row.id === choice.id) : undefined;
  const selected = explicit ?? rows[0];
  if (!selected) {
    throw serviceUnavailable(
      'No DNS resolver is enabled in the CloudHost247 resolver registry, so DNS tools cannot run. A Super Admin can enable resolvers under Admin → Tools → Resolvers.'
    );
  }
  return selected;
}

export interface AnswerMeta {
  resolver: { id: string; name: string; provider: string; ip: string; protocol: ResolverProtocol; country: string | null };
  durationMs: number;
  rcode: string;
  authoritative: boolean;
  truncated: boolean;
  hasDnssecRecords: boolean;
}

export interface QueryAnswer<T = ParsedRecord> {
  records: T[];
  meta: AnswerMeta;
  /** Non-fatal problems the UI should show (e.g. "SERVFAIL from this resolver"). */
  warning?: string;
}

function metaOf(row: ResolverRow, outcome: DnsQueryOutcome): AnswerMeta {
  const durationMs = outcome.durationMs;
  return {
    resolver: {
      id: row.id,
      name: row.name,
      provider: row.provider,
      ip: row.ip_address,
      protocol: row.protocol,
      country: row.country,
    },
    durationMs,
    rcode: outcome.ok ? outcome.message.rcodeText : outcome.code,
    authoritative: outcome.ok ? outcome.message.authoritative : false,
    truncated: outcome.ok ? outcome.message.truncated : false,
    hasDnssecRecords: outcome.ok ? outcome.message.hasDnssecRecords : false,
  };
}

/**
 * Queries one record type. A resolver failure is surfaced as a ToolError carrying the resolver's
 * name and the failure code — a lookup tool must not pretend "no records" when the resolver never
 * answered.
 */
export async function queryType(
  row: ResolverRow,
  name: string,
  type: string,
  options: { timeoutMs?: number; dnssec?: boolean } = {}
): Promise<QueryAnswer> {
  const outcome = await queryResolver(toResolverTarget(row), name, type, options);
  if (!outcome.ok) {
    throw new ToolError(
      outcome.code === 'TIMEOUT' ? 'TIMEOUT' : 'DNS_LOOKUP_FAILED',
      `${row.name} (${row.ip_address}) could not answer the ${type} query for ${name}: ${outcome.message}`,
      { resolver: row.name, resolverIp: row.ip_address, failureCode: outcome.code }
    );
  }
  const meta = metaOf(row, outcome);
  const answers = outcome.message.answers.filter((record) => record.classCode === 1 || record.classCode === 3);
  return {
    records: answers,
    meta,
    ...(outcome.message.rcode === 3
      ? { warning: `${row.name} answered NXDOMAIN: the name ${name} does not exist in that resolver's view of the zone.` }
      : {}),
  };
}

/** Queries TXT and returns the concatenated values, including the empty-answer case. */
export async function queryTxt(row: ResolverRow, name: string, timeoutMs = 5000): Promise<{ values: string[]; meta: AnswerMeta }> {
  const outcome = await queryResolver(toResolverTarget(row), name, 'TXT', { timeoutMs });
  if (!outcome.ok) {
    throw new ToolError(
      outcome.code === 'TIMEOUT' ? 'TIMEOUT' : 'DNS_LOOKUP_FAILED',
      `${row.name} (${row.ip_address}) could not answer the TXT query for ${name}: ${outcome.message}`,
      { resolver: row.name, resolverIp: row.ip_address, failureCode: outcome.code }
    );
  }
  const values = outcome.message.answers
    .filter((record) => record.type === 'TXT')
    .map((record) => (typeof record.data.value === 'string' ? record.data.value : ''));
  return { values, meta: metaOf(row, outcome) };
}

/** Queries several types in sequence against one resolver, tolerating per-type failures. */
export async function queryMany(
  row: ResolverRow,
  name: string,
  types: string[],
  options: { timeoutMs?: number; dnssec?: boolean } = {}
): Promise<Record<string, { records: ParsedRecord[]; error: string | null; meta: AnswerMeta }>> {
  const output: Record<string, { records: ParsedRecord[]; error: string | null; meta: AnswerMeta }> = {};
  for (const type of types) {
    try {
      const answer = await queryType(row, name, type, options);
      output[type] = { records: answer.records, error: null, meta: answer.meta };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Lookup failed';
      output[type] = {
        records: [],
        error: message,
        meta: {
          resolver: {
            id: row.id,
            name: row.name,
            provider: row.provider,
            ip: row.ip_address,
            protocol: row.protocol,
            country: row.country,
          },
          durationMs: 0,
          rcode: error instanceof ToolError ? error.code : 'ERROR',
          authoritative: false,
          truncated: false,
          hasDnssecRecords: false,
        },
      };
    }
  }
  return output;
}

/** Parent zone of a domain (example.com → com), used for DS lookups. */
export function parentZone(domain: string): string {
  const labels = domain.split('.');
  if (labels.length <= 1) return domain;
  return labels.slice(1).join('.');
}

export interface FormattedRecord {
  name: string;
  type: string;
  ttl: number;
  priority: number | null;
  value: string;
  /** Extra structured fields (weights, flags, digest types) for the API consumer. */
  detail: Record<string, unknown>;
}

/** Normalizes a wire record into the flat shape the SPA tables and CSV exports expect. */
export function formatRecord(record: ParsedRecord): FormattedRecord {
  const priority =
    typeof record.data.preference === 'number'
      ? record.data.preference
      : typeof record.data.priority === 'number'
        ? record.data.priority
        : null;
  let value = record.display;
  if (record.type === 'TXT' && typeof record.data.value === 'string') value = record.data.value;
  if (record.type === 'CNAME' || record.type === 'NS' || record.type === 'PTR') value = String(record.data.target ?? '');
  if (record.type === 'A' || record.type === 'AAAA') value = String(record.data.address ?? '');
  return { name: record.name, type: record.type, ttl: record.ttl, priority, value, detail: record.data };
}
