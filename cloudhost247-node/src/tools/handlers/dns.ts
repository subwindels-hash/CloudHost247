/**
 * Tools Center — DNS category handlers (spec §2–§14).
 *
 * Every handler is a thin adapter: parse the HTTP input, call the service that already owns the
 * protocol logic, return the result untouched. The services carry the resolver, timing and evidence
 * fields, so the UI never has to reconstruct what happened.
 */
import { dnsLookup, mxLookup, reverseDnsLookup } from '../dns/lookup';
import { runPropagation } from '../dns/propagation';
import { dnsHealthCheck } from '../dns/health';
import { spfCheck, dmarcCheck, dmarcGenerate, dkimCheck, bimiCheck } from '../dns/email-auth';
import { dnskeyLookup, dsLookup } from '../dns/dnssec';
import { reverseIpLookup } from '../ip/reverse-ip';
import type { ToolHandler } from './kit';
import { bool, maybeNum, maybeStr, oneOf, str, strArray, targetLabel } from './kit';

/** Selectors tried when the caller does not know theirs; each one is reported whether or not it exists. */
const DEFAULT_DKIM_SELECTORS = ['default', 'google', 'selector1', 'selector2', 'k1', 'mail', 'dkim', 's1', 's2', 'zoho'];

const MATCH_MODES = ['exact', 'contains', 'regex'] as const;

export const dnsHandlers: Record<string, ToolHandler> = {
  'nameserver-lookup': async (input, context) => dnsLookup(context.db, { name: str(input, 'domain', { required: true, max: 253 }), type: 'NS' }),
  'cname-lookup': async (input, context) => dnsLookup(context.db, { name: str(input, 'domain', { required: true, max: 253 }), type: 'CNAME' }),
  'dns-propagation': async (input, context) => {
    const domain = str(input, 'domain', { required: true, max: 253 });
    const recordType = str(input, 'type', { max: 12 }) || str(input, 'recordType', { max: 12 }) || 'A';
    return runPropagation(context.db, {
      domain,
      recordType,
      expectedValue: maybeStr(input, 'expected', { max: 2000 }) ?? maybeStr(input, 'expectedValue', { max: 2000 }) ?? null,
      matchMode: oneOf(input, 'matchMode', MATCH_MODES, { default: 'exact' }),
      country: maybeStr(input, 'country', { max: 60 }),
      region: maybeStr(input, 'region', { max: 60 }),
      protocol: maybeStr(input, 'protocol', { max: 20 }),
      version: input.version === 'IPv6' ? 'IPv6' : input.version === 'IPv4' ? 'IPv4' : undefined,
      maxResolvers: maybeNum(input, 'maxResolvers', { min: 1, max: 60 }),
      persist: bool(input, 'persist', true),
      userId: context.caller.userId,
    });
  },

  'dns-lookup': async (input, context) =>
    dnsLookup(context.db, {
      name: str(input, 'name', { max: 253 }) || str(input, 'domain', { required: true, max: 253 }),
      type: str(input, 'type', { max: 12 }) || 'A',
      resolverId: maybeStr(input, 'resolverId'),
      timeoutMs: maybeNum(input, 'timeoutMs', { min: 500, max: 15_000 }),
      dnssec: maybeBool(input, 'dnssec'),
    }),

  'dns-health': async (input, context) =>
    dnsHealthCheck(context.db, {
      domain: str(input, 'domain', { required: true, max: 253 }),
      dkimSelectors: strArray(input, 'selectors', { max: 12 }),
      extended: bool(input, 'extended', false),
      resolverId: maybeStr(input, 'resolverId'),
    }),

  'mx-lookup': async (input, context) =>
    mxLookup(context.db, {
      domain: str(input, 'domain', { required: true, max: 253 }),
      resolverId: maybeStr(input, 'resolverId'),
      checkPort25: maybeBool(input, 'checkPort25'),
    }),

  'spf-checker': async (input, context) =>
    spfCheck(context.db, {
      domain: str(input, 'domain', { required: true, max: 253 }),
      resolverId: maybeStr(input, 'resolverId'),
      followIncludes: maybeBool(input, 'followIncludes'),
    }),

  'dmarc-checker': async (input, context) =>
    dmarcCheck(context.db, {
      domain: str(input, 'domain', { required: true, max: 253 }),
      resolverId: maybeStr(input, 'resolverId'),
    }),

  'dmarc-generator': async (input) => {
    const failureOptions = strArray(input, 'failureOptions', { max: 8 }) ?? [];
    return dmarcGenerate({
      domain: str(input, 'domain', { required: true, max: 253 }),
      policy: oneOf(input, 'policy', ['none', 'quarantine', 'reject'] as const, { default: 'none' }),
      subdomainPolicy: oneOf(input, 'subdomainPolicy', ['', 'none', 'quarantine', 'reject'] as const, { default: '' }),
      percentage: maybeNum(input, 'percentage', { min: 0, max: 100 }),
      aggregateReports: maybeStr(input, 'rua', { max: 500 }) ?? maybeStr(input, 'aggregateReports', { max: 500 }),
      forensicReports: maybeStr(input, 'ruf', { max: 500 }) ?? maybeStr(input, 'forensicReports', { max: 500 }),
      alignmentDkim: oneOf(input, 'adkim', ['', 'r', 's'] as const, { default: '' }),
      alignmentSpf: oneOf(input, 'aspf', ['', 'r', 's'] as const, { default: '' }),
      failureOptions: failureOptions.map((option) => option.toUpperCase()),
      reportInterval: maybeNum(input, 'ri', { min: 0 }) ?? maybeNum(input, 'reportInterval', { min: 0 }),
    });
  },

  'dkim-checker': async (input, context) => {
    const selectors = strArray(input, 'selectors', { max: 12 });
    return dkimCheck(context.db, {
      domain: str(input, 'domain', { required: true, max: 253 }),
      selectors: selectors && selectors.length > 0 ? selectors : DEFAULT_DKIM_SELECTORS,
      resolverId: maybeStr(input, 'resolverId'),
      externalVerification: null,
    });
  },

  'bimi-checker': async (input, context) =>
    bimiCheck(context.db, {
      domain: str(input, 'domain', { required: true, max: 253 }),
      resolverId: maybeStr(input, 'resolverId'),
    }),

  'dnskey-lookup': async (input, context) =>
    dnskeyLookup(context.db, {
      domain: str(input, 'domain', { required: true, max: 253 }),
      resolverId: maybeStr(input, 'resolverId'),
    }),

  'ds-lookup': async (input, context) =>
    dsLookup(context.db, {
      domain: str(input, 'domain', { required: true, max: 253 }),
      resolverId: maybeStr(input, 'resolverId'),
    }),

  'reverse-dns': async (input, context) => {
    const address = str(input, 'address', { max: 60 }) || str(input, 'ip', { required: true, max: 60 });
    return reverseDnsLookup(context.db, { address, resolverId: maybeStr(input, 'resolverId') });
  },

  'reverse-ip': async (input, context) => {
    const address = str(input, 'address', { max: 60 }) || str(input, 'ip', { required: true, max: 60 });
    return reverseIpLookup(context.db, { address, resolverId: maybeStr(input, 'resolverId') });
  },
};

/** Targets used for history/audit rows, so a run is always attributable to the thing it checked. */
export const dnsTargets: Record<string, (input: Record<string, unknown>) => string | null> = {
  'dns-propagation': (input) => targetLabel(typeof input.domain === 'string' ? input.domain : null),
  'dns-lookup': (input) => targetLabel(typeof input.name === 'string' ? input.name : typeof input.domain === 'string' ? input.domain : null),
  'dns-health': (input) => targetLabel(typeof input.domain === 'string' ? input.domain : null),
  'mx-lookup': (input) => targetLabel(typeof input.domain === 'string' ? input.domain : null),
  'spf-checker': (input) => targetLabel(typeof input.domain === 'string' ? input.domain : null),
  'dmarc-checker': (input) => targetLabel(typeof input.domain === 'string' ? input.domain : null),
  'dmarc-generator': (input) => targetLabel(typeof input.domain === 'string' ? input.domain : null),
  'dkim-checker': (input) => targetLabel(typeof input.domain === 'string' ? input.domain : null),
  'bimi-checker': (input) => targetLabel(typeof input.domain === 'string' ? input.domain : null),
  'dnskey-lookup': (input) => targetLabel(typeof input.domain === 'string' ? input.domain : null),
  'ds-lookup': (input) => targetLabel(typeof input.domain === 'string' ? input.domain : null),
  'reverse-dns': (input) => targetLabel(typeof input.address === 'string' ? input.address : null),
  'reverse-ip': (input) => targetLabel(typeof input.address === 'string' ? input.address : null),
};

function maybeBool(input: Record<string, unknown>, key: string): boolean | undefined {
  const value = input[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase());
}
