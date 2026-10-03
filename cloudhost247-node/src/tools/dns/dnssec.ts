/**
 * Tools Center — DNSSEC inspection: DNSKEY (spec §12) and DS (spec §13).
 *
 * Honesty rules applied here:
 *   - A DNSKEY record's presence proves only that a key is published. Whether signatures validate
 *     is a separate question this platform cannot answer without a validating resolver, so the
 *     tools report exactly which pieces of the chain were observed (DS at the parent, DNSKEY at
 *     the child, a matching key tag, RRSIG in the answers) and leave validation unstated.
 *   - Key tags are computed locally from the RDATA (RFC 4034 §5.1.4), so the DS↔DNSKEY comparison
 *     is a real comparison rather than a restatement of the provider's fields.
 */
import type { Queryable } from '../../db/types';
import { invalidInput, ToolError } from '../core/errors';
import type { ResolverRow } from '../core/resolvers';
import { normalizeDomain, parentZone, pickResolver, queryType, type AnswerMeta } from './common';
import { algorithmName, computeKeyTag, describeDnskey, type DnskeyInfo } from './records';

export interface DnskeyRecordView {
  keyTag: number;
  flags: number;
  protocol: number;
  algorithm: number;
  algorithmName: string;
  keyType: 'KSK' | 'ZSK' | 'Unknown';
  publicKey: string;
  ttl: number;
  /** True when a DS record in the parent zone references this key tag. */
  referencedByDs: boolean | null;
}

export interface DnskeyLookupResult {
  domain: string;
  zone: string;
  keys: DnskeyRecordView[];
  /** DS records observed at the parent, used for the reference column. */
  parentDs: Array<{ keyTag: number; algorithm: number; digestType: number; digest: string }>;
  dnssecStatus: {
    dnskeyPublished: boolean;
    dsPublishedAtParent: boolean;
    /** 'chain_observed' | 'dnskey_without_ds' | 'ds_without_matching_key' | 'no_dnssec_observed' */
    state: 'chain_observed' | 'dnskey_without_ds' | 'ds_without_matching_key' | 'no_dnssec_observed';
    explanation: string;
  };
  resolver: AnswerMeta['resolver'];
  warnings: string[];
}

function keyTypeOf(info: DnskeyInfo): DnskeyRecordView['keyType'] {
  if (!info.zoneKey) return 'Unknown';
  return info.secureEntryPoint ? 'KSK' : 'ZSK';
}

export async function dnskeyLookup(db: Queryable, input: { domain: string; resolverId?: string }): Promise<DnskeyLookupResult> {
  const domain = normalizeDomain(input.domain);
  const resolver = await pickResolver(db, { id: input.resolverId });
  const answer = await queryType(resolver, domain, 'DNSKEY', { timeoutMs: 7000, dnssec: true });

  const keys = answer.records
    .filter((record) => record.type === 'DNSKEY')
    .map((record) => {
      const info = describeDnskey(record.raw);
      return {
        keyTag: info.keyTag,
        flags: info.flags,
        protocol: info.protocol,
        algorithm: info.algorithm,
        algorithmName: info.algorithmName,
        keyType: keyTypeOf(info),
        publicKey: info.publicKey,
        ttl: record.ttl,
        referencedByDs: null as boolean | null,
      };
    });

  // Apex DNSKEY lives in the zone itself; DS lives in the parent (or in the zone, for a TLD).
  const parent = parentZone(domain);
  const dsAtParent =
    parent === domain
      ? await queryType(resolver, domain, 'DS', { timeoutMs: 7000, dnssec: true }).catch(() => null)
      : await queryType(resolver, parent, 'DS', { timeoutMs: 7000, dnssec: true }).catch(() => null);

  const parentDsAll = (dsAtParent?.records ?? [])
    .filter((record) => record.type === 'DS')
    .map((record) => ({
      keyTag: Number(record.data.keyTag ?? 0),
      algorithm: Number(record.data.algorithm ?? 0),
      digestType: Number(record.data.digestType ?? 0),
      digest: String(record.data.digest ?? ''),
      owner: record.name,
    }));

  const relevantDs = parentDsAll.filter((record) => record.owner.toLowerCase() === domain.toLowerCase());
  const dsTags = new Set(relevantDs.map((record) => record.keyTag));
  for (const key of keys) {
    key.referencedByDs = relevantDs.length > 0 ? dsTags.has(key.keyTag) : null;
  }

  const warnings: string[] = [];
  if (answer.warning) warnings.push(answer.warning);
  if (keys.length === 0) {
    warnings.push(`No DNSKEY records were returned for ${domain}. If the zone is signed, the resolver may not have the DO bit honoured, or DNSSEC may not be enabled.`);
  }

  const dnskeyPublished = keys.length > 0;
  const dsPublishedAtParent = relevantDs.length > 0;
  let state: DnskeyLookupResult['dnssecStatus']['state'];
  let explanation: string;
  if (dnskeyPublished && dsPublishedAtParent && keys.some((key) => key.referencedByDs)) {
    state = 'chain_observed';
    explanation = 'A DNSKEY is published at the zone and a DS record at the parent references one of its key tags. That is the delegation material a validator needs; whether validation succeeds also depends on signatures and the parent\'s own security.';
  } else if (dnskeyPublished && !dsPublishedAtParent) {
    state = 'dnskey_without_ds';
    explanation = 'The zone publishes DNSKEY records but the parent publishes no matching DS record, so validators have no chain to follow. This is the normal state for an "island of security" — signed but not validated by the parent.';
  } else if (!dnskeyPublished && dsPublishedAtParent) {
    state = 'ds_without_matching_key';
    explanation = 'The parent publishes DS records for this domain but no DNSKEY was returned. Validators will fail to build the chain; if you have just submitted a DS to your registrar, allow for propagation.';
  } else {
    state = 'no_dnssec_observed';
    explanation = 'Neither DS records at the parent nor DNSKEY records at the zone were observed, so DNSSEC does not appear to be enabled for this domain.';
  }

  return {
    domain,
    zone: domain,
    keys,
    parentDs: parentDsAll,
    dnssecStatus: { dnskeyPublished, dsPublishedAtParent, state, explanation },
    resolver: answer.meta.resolver,
    warnings,
  };
}

export interface DsLookupResult {
  domain: string;
  parentZone: string;
  /** DS records whose owner name is the queried domain. */
  records: Array<{
    name: string;
    ttl: number;
    keyTag: number;
    algorithm: number;
    algorithmName: string;
    digestType: number;
    digestTypeName: string;
    digest: string;
    matchesChildKey: boolean | null;
  }>;
  childKeys: Array<{ keyTag: number; algorithm: number; algorithmName: string; keyType: string }>;
  chain: {
    dsFound: boolean;
    childKeyFound: boolean;
    matchingKeyTag: boolean | null;
    explanation: string;
  };
  resolver: AnswerMeta['resolver'];
  warnings: string[];
}

const DIGEST_TYPES: Record<number, string> = {
  1: 'SHA-1 (deprecated)',
  2: 'SHA-256',
  3: 'GOST R 34.11-94',
  4: 'SHA-384',
};

export async function dsLookup(db: Queryable, input: { domain: string; resolverId?: string }): Promise<DsLookupResult> {
  const domain = normalizeDomain(input.domain);
  const parent = parentZone(domain);
  const resolver = await pickResolver(db, { id: input.resolverId });
  const startedLookup = parent === domain ? domain : parent;

  const dsAnswer = await queryType(resolver, startedLookup, 'DS', { timeoutMs: 7000, dnssec: true });
  const dsRecords = dsAnswer.records.filter((record) => record.type === 'DS' && record.name.toLowerCase() === domain.toLowerCase());

  const dnskeyAnswer = await queryType(resolver, domain, 'DNSKEY', { timeoutMs: 7000, dnssec: true }).catch(() => null);
  const childKeys = (dnskeyAnswer?.records ?? [])
    .filter((record) => record.type === 'DNSKEY')
    .map((record) => {
      const info = describeDnskey(record.raw);
      return { keyTag: info.keyTag, algorithm: info.algorithm, algorithmName: algorithmName(info.algorithm), keyType: keyTypeOf(info), rdata: record.raw };
    });

  const childTags = new Set(childKeys.map((key) => key.keyTag));

  const records = dsRecords.map((record) => {
    const keyTag = Number(record.data.keyTag ?? 0);
    const algorithm = Number(record.data.algorithm ?? 0);
    const digestType = Number(record.data.digestType ?? 0);
    return {
      name: record.name,
      ttl: record.ttl,
      keyTag,
      algorithm,
      algorithmName: algorithmName(algorithm),
      digestType,
      digestTypeName: DIGEST_TYPES[digestType] ?? `Unknown (${digestType})`,
      digest: String(record.data.digest ?? ''),
      matchesChildKey: childKeys.length > 0 ? childTags.has(keyTag) : null,
    };
  });

  const warnings: string[] = [];
  if (dsAnswer.warning) warnings.push(dsAnswer.warning);
  if (records.length === 0) {
    warnings.push(
      parent === domain
        ? `No DS records were returned for ${domain}.`
        : `No DS records were found for ${domain} in the parent zone ${parent}. The domain is not chained into DNSSEC from above.`
    );
  }
  if (records.some((record) => record.digestType === 1)) {
    warnings.push('At least one DS record uses digest type 1 (SHA-1), which is deprecated and refused by newer validators.');
  }
  if (records.length > 0 && childKeys.length > 0 && !records.some((record) => record.matchesChildKey)) {
    warnings.push('No DS record\'s key tag matches any DNSKEY published by the child zone — validators will fail to build the chain.');
  }

  const matchingKeyTag = records.length > 0 && childKeys.length > 0 ? records.some((record) => record.matchesChildKey === true) : null;

  return {
    domain,
    parentZone: parent,
    records,
    childKeys: childKeys.map(({ keyTag, algorithm, algorithmName: name, keyType }) => ({ keyTag, algorithm, algorithmName: name, keyType })),
    chain: {
      dsFound: records.length > 0,
      childKeyFound: childKeys.length > 0,
      matchingKeyTag,
      explanation:
        matchingKeyTag === true
          ? 'The DS record\'s key tag matches a DNSKEY published by the child zone, so the material for the chain is present and consistent.'
          : matchingKeyTag === false
            ? 'DS records exist but none of their key tags match the child\'s DNSKEY records, so validation would fail until the DS set is corrected at the registrar.'
            : 'The chain could not be fully compared: either no DS was found, or the child\'s DNSKEYs could not be retrieved.',
    },
    resolver: dsAnswer.meta.resolver,
    warnings,
  };
}

/** Recomputes a key tag from raw DNSKEY RDATA — exposed for the unit tests. */
export { computeKeyTag };
