/**
 * Tools Center — email authentication DNS tools: SPF, DMARC, DKIM, BIMI (spec §8, §9, §10, §49)
 * and the DMARC record generator (spec §11).
 *
 * SPF is analysed with its include/redirect tree actually walked — the RFC 7208 §4.6.4 lookup
 * limit applies to the whole tree, not just the first record, so a record with two includes that
 * each pull in four more lookups is over the limit even though the top-level record looks small.
 */
import { performance } from 'node:perf_hooks';
import type { Queryable } from '../../db/types';
import { invalidInput, ToolError } from '../core/errors';
import type { ResolverRow } from '../core/resolvers';
import { normalizeDomain, pickResolver, queryTxt, type AnswerMeta } from './common';
import {
  buildDmarcRecord,
  parseBimiRecord,
  parseDkimRecord,
  parseDmarcRecords,
  parseSpfRecords,
  type BimiAnalysis,
  type DkimAnalysis,
  type DmarcAnalysis,
  type DmarcDraft,
  type DmarcDraftInput,
  type SpfAnalysis,
} from './records';

export interface SpfIncludeNode {
  domain: string;
  record: string | null;
  lookups: number;
  mechanisms: string[];
  /** Nested includes discovered inside this record. */
  children: SpfIncludeNode[];
  error: string | null;
}

export interface SpfCheckResult {
  domain: string;
  analysis: SpfAnalysis;
  /** Real lookup count including the include tree (compare with analysis.lookupCount, which is the top-level static count). */
  totalLookupCount: number;
  includeTree: SpfIncludeNode[];
  resolver: AnswerMeta['resolver'];
  durationMs: number;
  status: 'VALID' | 'WARNING' | 'ERROR';
  summary: string;
  recommendations: string[];
  /** Evidence lines that the AI explainer and support tickets can quote verbatim. */
  facts: string[];
}

const MAX_INCLUDE_DEPTH = 5;
const MAX_TOTAL_QUERIES = 30;

async function walkIncludes(
  resolver: ResolverRow,
  domain: string,
  depth: number,
  budget: { remaining: number },
  seen: Set<string>
): Promise<{ node: SpfIncludeNode; lookups: number }> {
  if (depth > MAX_INCLUDE_DEPTH) {
    return {
      node: { domain, record: null, lookups: 0, mechanisms: [], children: [], error: `Include depth limit (${MAX_INCLUDE_DEPTH}) reached.` },
      lookups: 0,
    };
  }
  if (seen.has(domain)) {
    return {
      node: { domain, record: null, lookups: 0, mechanisms: [], children: [], error: 'This domain is already part of the include chain (loop detected).' },
      lookups: 0,
    };
  }
  seen.add(domain);

  if (budget.remaining <= 0) {
    return {
      node: { domain, record: null, lookups: 0, mechanisms: [], children: [], error: 'Lookup budget for the include tree was exhausted; the reported total is a lower bound.' },
      lookups: 0,
    };
  }

  budget.remaining -= 1;
  let values: string[];
  try {
    values = (await queryTxt(resolver, domain, 5000)).values;
  } catch (error) {
    return {
      node: { domain, record: null, lookups: 0, mechanisms: [], children: [], error: error instanceof Error ? error.message : 'Lookup failed' },
      lookups: 0,
    };
  }

  const analysis = parseSpfRecords(values);
  const record = analysis.record;
  const children: SpfIncludeNode[] = [];
  let lookups = analysis.lookupCount;

  if (record) {
    const includeTargets = analysis.mechanisms.filter((mechanism) => mechanism.type === 'include').map((mechanism) => mechanism.value.trim().toLowerCase());
    const redirect = analysis.modifiers.find((modifier) => modifier.name === 'redirect');
    if (redirect) includeTargets.push(redirect.value.trim().toLowerCase());

    for (const target of includeTargets) {
      if (!/^[a-z0-9.-]+$/i.test(target) || !target.includes('.')) {
        children.push({ domain: target, record: null, lookups: 0, mechanisms: [], children: [], error: 'Not a resolvable domain name.' });
        continue;
      }
      const child = await walkIncludes(resolver, target, depth + 1, budget, seen);
      children.push(child.node);
      lookups += child.lookups;
    }
  }

  return {
    node: {
      domain,
      record,
      lookups: analysis.lookupCount,
      mechanisms: analysis.mechanisms.map((mechanism) => mechanism.raw),
      children,
      error: null,
    },
    lookups,
  };
}

export async function spfCheck(db: Queryable, input: { domain: string; resolverId?: string; followIncludes?: boolean }): Promise<SpfCheckResult> {
  const domain = normalizeDomain(input.domain);
  const resolver = await pickResolver(db, { id: input.resolverId });
  const startedAt = performance.now();

  const { values, meta } = await queryTxt(resolver, domain, 6000);
  const analysis = parseSpfRecords(values);

  let totalLookupCount = analysis.lookupCount;
  const includeTree: SpfIncludeNode[] = [];
  if (analysis.found && analysis.record && input.followIncludes !== false) {
    const budget = { remaining: MAX_TOTAL_QUERIES };
    const seen = new Set<string>([domain]);
    const includeTargets = analysis.mechanisms.filter((mechanism) => mechanism.type === 'include').map((mechanism) => mechanism.value.trim().toLowerCase());
    const redirect = analysis.modifiers.find((modifier) => modifier.name === 'redirect');
    if (redirect) includeTargets.push(redirect.value.trim().toLowerCase());

    for (const target of includeTargets) {
      if (!/^[a-z0-9.-]+$/i.test(target) || !target.includes('.')) {
        includeTree.push({ domain: target, record: null, lookups: 0, mechanisms: [], children: [], error: 'Not a resolvable domain name.' });
        continue;
      }
      const child = await walkIncludes(resolver, target, 1, budget, seen);
      includeTree.push(child.node);
      totalLookupCount += child.lookups;
    }
  }

  const errors = [...analysis.errors];
  const recommendations: string[] = [];
  const facts: string[] = [];

  if (analysis.found && totalLookupCount > analysis.lookupLimit) {
    errors.push(
      `The full include tree needs ${totalLookupCount} DNS lookups, above the RFC 7208 limit of ${analysis.lookupLimit}. The static top-level count is ${analysis.lookupCount}; the extra lookups come from the include chain, which is why a record can look compliant and still fail.`
    );
  }
  if (errors.some((error) => error.includes('no SPF record'))) {
    recommendations.push('Publish a TXT record at the domain apex, for example: v=spf1 include:_spf.yourprovider.example -all');
  }
  if (analysis.records.length > 1) recommendations.push('Delete every SPF record except one — multiple records are a permanent error for receivers.');
  if (analysis.mechanisms.some((mechanism) => mechanism.type === 'ptr')) recommendations.push('Replace the ptr mechanism with explicit ip4/ip6 or include: mechanisms.');
  if (totalLookupCount > 10) recommendations.push('Reduce lookups by flattening frequently used includes into ip4/ip6 entries, or by removing unused include targets.');
  if (!analysis.mechanisms.some((mechanism) => mechanism.type === 'all')) recommendations.push('End the record with an explicit terminal mechanism, usually -all.');

  facts.push(`SPF records found: ${analysis.records.length}`);
  if (analysis.record) facts.push(`SPF record: ${analysis.record}`);
  if (analysis.found) facts.push(`DNS lookups required (top-level / full include tree): ${analysis.lookupCount} / ${totalLookupCount} of ${analysis.lookupLimit}`);

  const status: SpfCheckResult['status'] = errors.length > 0 ? 'ERROR' : analysis.warnings.length > 0 ? 'WARNING' : 'VALID';
  const summary =
    status === 'ERROR'
      ? 'The SPF configuration has errors that can cause receivers to reject or fail your mail.'
      : status === 'WARNING'
        ? 'The SPF record parses, with warnings worth addressing.'
        : analysis.found
          ? 'The SPF record parses and stays within the RFC 7208 lookup limit.'
          : 'No SPF record is published.';

  return {
    domain,
    analysis,
    totalLookupCount,
    includeTree,
    resolver: meta.resolver,
    durationMs: Math.round(performance.now() - startedAt),
    status,
    summary,
    recommendations,
    facts,
  };
}

export interface DmarcCheckResult {
  domain: string;
  recordName: string;
  analysis: DmarcAnalysis;
  resolver: AnswerMeta['resolver'];
  durationMs: number;
  status: 'VALID' | 'WARNING' | 'ERROR' | 'NOT_FOUND';
  summary: string;
  policyMeaning: string;
  recommendations: string[];
  facts: string[];
  /** Whether the policy would satisfy BIMI's enforcement requirement (p=quarantine/reject with pct=100 and an sp). */
  bimiEligiblePolicy: boolean;
}

export async function dmarcCheck(db: Queryable, input: { domain: string; resolverId?: string }): Promise<DmarcCheckResult> {
  const domain = normalizeDomain(input.domain);
  const resolver = await pickResolver(db, { id: input.resolverId });
  const startedAt = performance.now();
  const recordName = `_dmarc.${domain}`;
  const { values, meta } = await queryTxt(resolver, recordName, 6000);
  const analysis = parseDmarcRecords(values, { domain });

  const recommendations: string[] = [];
  const facts: string[] = [];
  if (!analysis.found) {
    recommendations.push(`Publish a TXT record at ${recordName}, starting with: v=DMARC1; p=none; rua=mailto:dmarc@${domain}`);
  }
  if (analysis.records.length > 1) recommendations.push('Remove all but one DMARC record.');
  if (analysis.policy === 'none') {
    recommendations.push('p=none collects reports but does not stop spoofing; move to quarantine and then reject once the reports show only legitimate senders.');
  }
  if (analysis.aggregateReports.length === 0 && analysis.found) {
    recommendations.push('Add rua=mailto:... so you receive aggregate reports; without them you cannot tell legitimate senders from spoofers.');
  }
  if (analysis.found) {
    facts.push(`DMARC record: ${analysis.record}`);
    if (analysis.policy) facts.push(`Policy (p): ${analysis.policy}`);
    if (analysis.percentage !== null) facts.push(`Percentage (pct): ${analysis.percentage}`);
    facts.push(`Aggregate report destinations: ${analysis.aggregateReports.length}`);
  }

  const policyMeaning =
    analysis.policy === 'reject'
      ? 'Receivers are asked to reject messages that fail both SPF and DKIM alignment.'
      : analysis.policy === 'quarantine'
        ? 'Receivers are asked to treat failing messages as suspicious (usually spam/junk).'
        : analysis.policy === 'none'
          ? 'Receivers are asked to deliver failing messages normally and just send you reports. This is monitoring only.'
          : 'No policy is published, so receivers have no instruction.';

  const bimiEligiblePolicy =
    (analysis.policy === 'quarantine' || analysis.policy === 'reject') &&
    (analysis.percentage === null || analysis.percentage === 100) &&
    (analysis.subdomainPolicy === 'quarantine' || analysis.subdomainPolicy === 'reject' || analysis.subdomainPolicy === null);

  const status: DmarcCheckResult['status'] = !analysis.found
    ? 'NOT_FOUND'
    : analysis.errors.length > 0
      ? 'ERROR'
      : analysis.warnings.length > 0
        ? 'WARNING'
        : 'VALID';

  return {
    domain,
    recordName,
    analysis,
    resolver: meta.resolver,
    durationMs: Math.round(performance.now() - startedAt),
    status,
    summary:
      status === 'NOT_FOUND'
        ? 'No DMARC record is published for this domain.'
        : status === 'ERROR'
          ? 'The DMARC record has validation errors.'
          : status === 'WARNING'
            ? 'The DMARC record is valid with warnings.'
            : 'The DMARC record is valid.',
    policyMeaning,
    recommendations,
    facts,
    bimiEligiblePolicy,
  };
}

export function dmarcGenerate(input: DmarcDraftInput): DmarcDraft {
  if (!input.domain || !input.domain.includes('.')) {
    throw invalidInput('Enter the domain the policy applies to (for example example.com).');
  }
  if (input.percentage !== undefined && (input.percentage < 0 || input.percentage > 100)) {
    throw invalidInput('The percentage must be between 0 and 100.');
  }
  return buildDmarcRecord(input);
}

export interface DkimCheckResult {
  domain: string;
  selectors: Array<{
    selector: string;
    analysis: DkimAnalysis;
    status: 'VALID' | 'WARNING' | 'ERROR' | 'NOT_FOUND';
    resolver: AnswerMeta['resolver'];
  }>;
  durationMs: number;
  /** Present only when an external DKIM verification provider is configured (spec §61). */
  externalVerification: { available: boolean; detail: string };
  summary: string;
  recommendations: string[];
}

export async function dkimCheck(
  db: Queryable,
  input: { domain: string; selectors: string[]; resolverId?: string; externalVerification?: { provider: string; detail: string } | null }
): Promise<DkimCheckResult> {
  const domain = normalizeDomain(input.domain);
  const selectors = input.selectors.map((selector) => selector.trim().toLowerCase()).filter(Boolean);
  if (selectors.length === 0) throw invalidInput('Provide at least one DKIM selector (for example: default, google, selector1).');
  if (selectors.length > 10) throw invalidInput('Check at most 10 selectors at a time.');
  for (const selector of selectors) {
    if (!/^[a-z0-9][a-z0-9._-]{0,62}$/i.test(selector)) {
      throw invalidInput(`"${selector}" is not a valid DKIM selector label.`);
    }
  }

  const resolver = await pickResolver(db, { id: input.resolverId });
  const startedAt = performance.now();
  const results: DkimCheckResult['selectors'] = [];

  for (const selector of selectors) {
    const recordName = `${selector}._domainkey.${domain}`;
    let values: string[] = [];
    let meta: AnswerMeta = {
      resolver: { id: resolver.id, name: resolver.name, provider: resolver.provider, ip: resolver.ip_address, protocol: resolver.protocol, country: resolver.country },
      durationMs: 0,
      rcode: 'NOERROR',
      authoritative: false,
      truncated: false,
      hasDnssecRecords: false,
    };
    try {
      const answer = await queryTxt(resolver, recordName, 6000);
      values = answer.values;
      meta = answer.meta;
    } catch (error) {
      // A refused/failed lookup is reported as an error for that selector, not as "missing".
      results.push({
        selector,
        analysis: {
          ...parseDkimRecord(domain, selector, []),
          errors: [error instanceof Error ? error.message : 'The lookup failed.'],
        },
        status: 'ERROR',
        resolver: meta.resolver,
      });
      continue;
    }
    const analysis = parseDkimRecord(domain, selector, values);
    const status: DkimCheckResult['selectors'][number]['status'] = !analysis.found
      ? 'NOT_FOUND'
      : analysis.errors.length > 0
        ? 'ERROR'
        : analysis.warnings.length > 0
          ? 'WARNING'
          : 'VALID';
    results.push({ selector, analysis, status, resolver: meta.resolver });
  }

  const recommendations: string[] = [];
  const missing = results.filter((result) => result.status === 'NOT_FOUND').map((result) => result.selector);
  if (missing.length > 0) {
    recommendations.push(
      `No DKIM key was found for selector(s) ${missing.join(', ')}. Confirm the selector name with the system that signs your mail, then publish the public key your provider gave you.`
    );
  }
  if (results.some((result) => result.analysis.revoked)) recommendations.push('A selector publishes an empty p= tag, which revokes the key. Remove the record or publish the correct key.');
  if (results.some((result) => result.status === 'ERROR')) recommendations.push('Fix the malformed DKIM records listed below; receivers will treat a malformed record as a failed signature.');

  const external = input.externalVerification;
  return {
    domain,
    selectors: results,
    durationMs: Math.round(performance.now() - startedAt),
    externalVerification: external
      ? { available: true, detail: external.detail }
      : {
          available: false,
          detail:
            'No external DKIM verifier is configured, so this check validates the published record only. Confirming that a signature actually verifies requires an external verifier — configure one under Admin → Tools → Providers (kind: DKIM_VERIFY).',
        },
    summary:
      results.every((result) => result.status === 'VALID')
        ? 'Every checked selector publishes a well-formed DKIM key record.'
        : 'One or more selectors need attention.',
    recommendations,
  };
}

export interface BimiCheckResult {
  domain: string;
  recordName: string;
  analysis: BimiAnalysis;
  resolver: AnswerMeta['resolver'];
  dmarc: { found: boolean; policy: string | null; policySatisfiesBimi: boolean };
  status: 'VALID' | 'WARNING' | 'ERROR' | 'NOT_FOUND';
  summary: string;
  recommendations: string[];
}

export async function bimiCheck(db: Queryable, input: { domain: string; resolverId?: string }): Promise<BimiCheckResult> {
  const domain = normalizeDomain(input.domain);
  const resolver = await pickResolver(db, { id: input.resolverId });
  const recordName = `default._bimi.${domain}`;
  const { values, meta } = await queryTxt(resolver, recordName, 6000);
  const analysis = parseBimiRecord(domain, values);

  const dmarcValues = await queryTxt(resolver, `_dmarc.${domain}`, 6000).catch(() => ({ values: [] as string[], meta }));
  const dmarc = parseDmarcRecords(dmarcValues.values, { domain });
  const policySatisfiesBimi = dmarc.policy === 'quarantine' || dmarc.policy === 'reject';

  const recommendations: string[] = [];
  if (!analysis.found) recommendations.push(`Publish a TXT record at ${recordName}, for example: v=BIMI1; l=https://example.com/logo.svg`);
  if (!policySatisfiesBimi) {
    recommendations.push(
      `BIMI requires an enforcing DMARC policy. The current policy is ${dmarc.policy ?? 'none published'}. Most mailbox providers only display the logo with p=quarantine or p=reject.`
    );
  }
  if (analysis.certificateUrl === null && analysis.found) {
    recommendations.push('Add a Verified Mark Certificate (a= tag) if you want Gmail and Apple Mail to display the logo; without it, only some providers will.');
  }

  const status: BimiCheckResult['status'] = !analysis.found
    ? 'NOT_FOUND'
    : analysis.errors.length > 0
      ? 'ERROR'
      : policySatisfiesBimi
        ? 'VALID'
        : 'WARNING';

  return {
    domain,
    recordName,
    analysis,
    resolver: meta.resolver,
    dmarc: { found: dmarc.found, policy: dmarc.policy, policySatisfiesBimi },
    status,
    summary: !analysis.found
      ? 'No BIMI record is published.'
      : policySatisfiesBimi
        ? 'The BIMI record is published and the DMARC policy enforces alignment.'
        : 'The BIMI record exists, but the DMARC policy is not enforcing, so most providers will not display the logo.',
    recommendations,
  };
}

/** Helper for routes: turns a resolver lookup failure into a tool error with resolver context. */
export function rethrowDnsFailure(error: unknown, context: string): never {
  if (error instanceof ToolError) throw error;
  throw new ToolError('DNS_LOOKUP_FAILED', `${context}: ${error instanceof Error ? error.message : 'unknown error'}`);
}
