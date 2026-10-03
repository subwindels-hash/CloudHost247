/**
 * Tools Center — DNS record semantics: TXT-based policy parsing and expected-value matching.
 *
 * Pure functions only. Every parser here reports what the record says and what is wrong with it; it
 * never upgrades "the record exists" into "the configuration is correct" (spec §6: "Do not label a
 * domain 'secure' solely because individual records exist").
 */

export type MatchMode = 'exact' | 'contains' | 'regex';

export interface MatchResult {
  matched: boolean;
  mode: MatchMode;
  /** Explanation of the comparison that was performed. */
  detail: string;
  /** Set when a regex mode was requested but the pattern is not a valid regex. */
  invalidPattern?: string;
}

/** Normalizes a DNS TXT value for comparison: trims, collapses whitespace, lowercases. */
export function normalizeTxtValue(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Compares a resolver's answer with the expected value. Matching is case-insensitive and
 * whitespace-normalized by default, because DNS TXT values are case-preserving but semantically
 * case-insensitive for the policies these tools check.
 */
export function matchExpected(actual: string, expected: string, mode: MatchMode): MatchResult {
  const normalizedActual = normalizeTxtValue(actual);
  const normalizedExpected = normalizeTxtValue(expected);
  if (normalizedExpected.length === 0) {
    return { matched: true, mode, detail: 'No expected value was supplied, so only presence was checked.' };
  }
  switch (mode) {
    case 'contains':
      return {
        matched: normalizedActual.includes(normalizedExpected),
        mode,
        detail: `Checked whether the answer contains "${expected}".`,
      };
    case 'regex': {
      try {
        const expression = new RegExp(expected, 'i');
        return { matched: expression.test(actual), mode, detail: `Evaluated the regular expression /${expected}/i against the answer.` };
      } catch {
        return {
          matched: false,
          mode,
          detail: `"${expected}" is not a valid regular expression.`,
          invalidPattern: expected,
        };
      }
    }
    case 'exact':
    default:
      return {
        matched: normalizedActual === normalizedExpected,
        mode,
        detail: `Compared the normalized answer with the normalized expected value.`,
      };
  }
}

// ---------------------------------------------------------------------------------------------
// SPF (RFC 7208)
// ---------------------------------------------------------------------------------------------

export interface SpfMechanism {
  qualifier: '+' | '-' | '~' | '?';
  type: string;
  value: string;
  /** True when this mechanism costs a DNS lookup against the RFC 7208 §4.6.4 limit of 10. */
  countsTowardLookupLimit: boolean;
  raw: string;
}

export interface SpfModifier {
  name: string;
  value: string;
  raw: string;
}

export interface SpfAnalysis {
  found: boolean;
  /** Every SPF TXT record found for the domain (more than one is a hard RFC 7208 error). */
  records: string[];
  record: string | null;
  parsed: boolean;
  mechanisms: SpfMechanism[];
  modifiers: SpfModifier[];
  qualifiers: { pass: number; fail: number; softfail: number; neutral: number };
  /** Static count of mechanisms that require a DNS lookup (include/a/mx/ptr/exists + redirect). */
  lookupCount: number;
  lookupLimit: number;
  errors: string[];
  warnings: string[];
  /** Facts to explain in the UI, one per line. */
  explanations: string[];
}

const SPF_LOOKUP_MECHANISMS = new Set(['include', 'a', 'mx', 'ptr', 'exists']);

export function parseSpfRecords(txtValues: string[]): SpfAnalysis {
  const records = txtValues.filter((value) => /^v=spf1(\s|$)/i.test(value.trim()));
  const errors: string[] = [];
  const warnings: string[] = [];
  const explanations: string[] = [];

  if (records.length === 0) {
    return {
      found: false,
      records,
      record: null,
      parsed: false,
      mechanisms: [],
      modifiers: [],
      qualifiers: { pass: 0, fail: 0, softfail: 0, neutral: 0 },
      lookupCount: 0,
      lookupLimit: 10,
      errors: ['No SPF record was found. Without SPF, receivers have no published list of senders for this domain.'],
      warnings,
      explanations: [],
    };
  }

  if (records.length > 1) {
    errors.push(
      `The domain publishes ${records.length} SPF records. RFC 7208 §3.2 permits exactly one; receivers must treat multiple records as a permanent error (permerror).`
    );
  }

  const record = records[0]!.trim();
  const tokens = record.split(/\s+/).slice(1);
  const mechanisms: SpfMechanism[] = [];
  const modifiers: SpfModifier[] = [];
  const qualifiers = { pass: 0, fail: 0, softfail: 0, neutral: 0 };
  let lookupCount = 0;

  for (const raw of tokens) {
    if (raw.length === 0) continue;
    if (raw.includes('=')) {
      const [name, ...rest] = raw.split('=');
      const value = rest.join('=');
      const normalized = (name ?? '').toLowerCase();
      if (!/^[a-z][a-z0-9_.-]*$/.test(normalized)) {
        errors.push(`"${raw}" is not a valid SPF modifier name.`);
      }
      if (normalized === 'redirect') lookupCount += 1;
      if (normalized !== 'redirect' && normalized !== 'exp') {
        warnings.push(`The modifier "${normalized}" is unknown; unknown modifiers must be ignored by receivers.`);
      }
      modifiers.push({ name: normalized, value, raw });
      continue;
    }

    const qualifierMatch = /^([+\-~?]?)(.*)$/.exec(raw);
    const qualifier = (qualifierMatch?.[1] || '+') as SpfMechanism['qualifier'];
    const body = qualifierMatch?.[2] ?? raw;
    const [typeRaw, ...valueParts] = body.split(':');
    const type = (typeRaw ?? '').toLowerCase().split('/')[0] ?? '';
    const value = valueParts.join(':');

    if (!['all', 'include', 'a', 'mx', 'ptr', 'ip4', 'ip6', 'exists'].includes(type)) {
      errors.push(`"${raw}" uses the unknown mechanism "${typeRaw ?? raw}".`);
      continue;
    }

    if (type === 'ptr') {
      warnings.push('The ptr mechanism is deprecated by RFC 7208 §5.5 and is slow and unreliable at receivers; remove it.');
    }
    if (type === 'ip4' || type === 'ip6') {
      const address = value.split('/')[0] ?? '';
      const family = type === 'ip4' ? 4 : 6;
      if (!isValidAddressForFamily(address, family)) {
        errors.push(`"${raw}" does not contain a valid ${type === 'ip4' ? 'IPv4' : 'IPv6'} address.`);
      }
    }
    if (type === 'all' && value.length > 0) {
      errors.push(`"${raw}" must be written without a value.`);
    }

    const countsTowardLookupLimit = SPF_LOOKUP_MECHANISMS.has(type);
    if (countsTowardLookupLimit) lookupCount += 1;
    if (qualifier === '+') qualifiers.pass += 1;
    if (qualifier === '-') qualifiers.fail += 1;
    if (qualifier === '~') qualifiers.softfail += 1;
    if (qualifier === '?') qualifiers.neutral += 1;

    mechanisms.push({ qualifier, type, value, countsTowardLookupLimit, raw });
  }

  const terminal = mechanisms.find((mechanism) => mechanism.type === 'all');
  if (!terminal) {
    warnings.push(
      'The record has no "all" mechanism, so receivers fall back to a neutral result for unlisted senders. Most policies end with -all (reject) or ~all (softfail).'
    );
  } else if (terminal.qualifier === '+') {
    errors.push('The record ends with "+all", which authorises every sender on the internet. This is equivalent to publishing no SPF protection.');
  } else if (terminal.qualifier === '?') {
    warnings.push('The record ends with "?all" (neutral), which provides no protection for unlisted senders.');
  }

  const redirect = modifiers.find((modifier) => modifier.name === 'redirect');
  if (redirect && mechanisms.some((mechanism) => mechanism.type === 'all')) {
    warnings.push('The record has both a redirect modifier and an all mechanism; the all mechanism wins in most evaluations, making redirect ineffective.');
  }

  if (lookupCount > 10) {
    errors.push(
      `The record requires ${lookupCount} DNS lookups, exceeding the RFC 7208 §4.6.4 limit of 10. Receivers must return permerror, which typically means mail is rejected or fails SPF.`
    );
  } else if (lookupCount >= 8) {
    warnings.push(`The record requires ${lookupCount} DNS lookups; it is close to the limit of 10.`);
  }

  explanations.push(
    `The record is evaluated top to bottom: the first mechanism that matches decides the result. The terminal "all" mechanism gives the default for every sender not matched earlier.`
  );
  if (mechanisms.some((mechanism) => mechanism.type === 'include')) {
    explanations.push(
      `Each include: directive imports another domain's SPF record, and every DNS lookup that record needs also counts against this domain's limit of 10.`
    );
  }

  return {
    found: true,
    records,
    record,
    parsed: errors.length === 0,
    mechanisms,
    modifiers,
    qualifiers,
    lookupCount,
    lookupLimit: 10,
    errors,
    warnings,
    explanations,
  };
}

function isValidAddressForFamily(address: string, family: 4 | 6): boolean {
  if (family === 4) {
    const parts = address.split('.');
    return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
  }
  return /^[0-9a-f:]+$/i.test(address) && address.includes(':');
}

// ---------------------------------------------------------------------------------------------
// DMARC (RFC 7489)
// ---------------------------------------------------------------------------------------------

export interface DmarcTag {
  name: string;
  value: string;
  /** 'valid' | 'warning' | 'error' plus a plain-language explanation. */
  state: 'valid' | 'warning' | 'error';
  detail: string;
}

export interface DmarcAnalysis {
  found: boolean;
  record: string | null;
  records: string[];
  tags: DmarcTag[];
  policy: string | null;
  subdomainPolicy: string | null;
  percentage: number | null;
  aggregateReports: string[];
  forensicReports: string[];
  alignmentDkim: string | null;
  alignmentSpf: string | null;
  failureOptions: string[];
  reportInterval: number | null;
  errors: string[];
  warnings: string[];
  explanations: string[];
}

const DMARC_VALID_TAGS = new Set(['v', 'p', 'sp', 'pct', 'rua', 'ruf', 'adkim', 'aspf', 'fo', 'rf', 'ri']);

export function parseDmarcRecords(txtValues: string[], options: { domain: string } = { domain: '' }): DmarcAnalysis {
  const records = txtValues.filter((value) => /^\s*v=DMARC1/i.test(value.trim()));
  const errors: string[] = [];
  const warnings: string[] = [];
  const explanations: string[] = [];
  const tags: DmarcTag[] = [];

  if (records.length === 0) {
    return {
      found: false,
      record: null,
      records,
      tags,
      policy: null,
      subdomainPolicy: null,
      percentage: null,
      aggregateReports: [],
      forensicReports: [],
      alignmentDkim: null,
      alignmentSpf: null,
      failureOptions: [],
      reportInterval: null,
      errors: ['No DMARC record was found at _dmarc.' + (options.domain || 'this domain') + '.'],
      warnings,
      explanations: [
        'Without DMARC, receivers have no instruction for messages that fail SPF and DKIM, and you receive no aggregate reports about who is sending as your domain.',
      ],
    };
  }

  if (records.length > 1) {
    errors.push(`Multiple DMARC records were found (${records.length}). RFC 7489 §6.6.3 requires exactly one; receivers treat multiple records as invalid.`);
  }

  const record = records[0]!.trim();
  const parts = record.split(';').map((part) => part.trim()).filter(Boolean);

  for (const part of parts) {
    const separator = part.indexOf('=');
    if (separator === -1) {
      errors.push(`"${part}" is not a tag=value pair.`);
      continue;
    }
    const name = part.slice(0, separator).trim().toLowerCase();
    const value = part.slice(separator + 1).trim();
    if (!DMARC_VALID_TAGS.has(name)) {
      warnings.push(`"${name}" is not a recognised DMARC tag and will be ignored by receivers.`);
      tags.push({ name, value, state: 'warning', detail: 'Unknown tag — receivers must ignore it.' });
      continue;
    }

    switch (name) {
      case 'v':
        if (value.toLowerCase() !== 'dmarc1') {
          errors.push(`The version tag must be exactly "DMARC1" (found "${value}").`);
          tags.push({ name, value, state: 'error', detail: 'The version tag must be DMARC1.' });
        } else {
          tags.push({ name, value, state: 'valid', detail: 'Identifies the record as DMARC, version 1.' });
        }
        break;
      case 'p': {
        const policy = value.toLowerCase();
        if (!['none', 'quarantine', 'reject'].includes(policy)) {
          errors.push(`The requested policy ("${value}") must be none, quarantine or reject.`);
          tags.push({ name, value, state: 'error', detail: 'Must be none, quarantine or reject.' });
        } else {
          tags.push({
            name,
            value,
            state: 'valid',
            detail:
              policy === 'none'
                ? 'Requests monitoring only: failing messages are still delivered, and aggregate reports are sent. This is the correct starting point, not a protection level.'
                : policy === 'quarantine'
                  ? 'Asks receivers to place failing messages in quarantine (spam/junk) rather than the inbox.'
                  : 'Asks receivers to reject failing messages outright. This is the strongest policy.',
          });
        }
        break;
      }
      case 'sp': {
        const policy = value.toLowerCase();
        if (!['none', 'quarantine', 'reject'].includes(policy)) {
          errors.push(`The subdomain policy ("${value}") must be none, quarantine or reject.`);
          tags.push({ name, value, state: 'error', detail: 'Must be none, quarantine or reject.' });
        } else {
          tags.push({
            name,
            value,
            state: 'valid',
            detail: `Subdomains of ${options.domain || 'the domain'} use the "${policy}" policy instead of the main policy.`,
          });
        }
        break;
      }
      case 'pct': {
        const pct = Number(value);
        if (!Number.isInteger(pct) || pct < 0 || pct > 100) {
          errors.push(`The percentage ("${value}") must be an integer between 0 and 100.`);
          tags.push({ name, value, state: 'error', detail: 'Must be an integer 0–100.' });
        } else {
          tags.push({
            name,
            value,
            state: pct === 100 ? 'valid' : 'warning',
            detail:
              pct === 100
                ? 'The policy applies to 100% of failing messages.'
                : `Only ${pct}% of failing messages are subject to the policy; the rest are monitored.`,
          });
          if (pct !== 100) warnings.push(`pct=${pct} means the policy is only applied to ${pct}% of failing messages.`);
        }
        break;
      }
      case 'rua':
      case 'ruf': {
        const addresses = value.split(',').map((entry) => entry.trim()).filter(Boolean);
        const invalid = addresses.filter((address) => !/^mailto:[^@\s]+@[^@\s]+$/i.test(address));
        if (invalid.length > 0) {
          errors.push(`The ${name} tag contains values that are not mailto: URIs: ${invalid.join(', ')}`);
        }
        tags.push({
          name,
          value,
          state: invalid.length > 0 ? 'error' : 'valid',
          detail:
            name === 'rua'
              ? `${addresses.length} aggregate report destination(s). Aggregate reports contain counts by sending source, not message contents.`
              : `${addresses.length} forensic (failure) report destination(s). ${addresses.length === 0 ? '' : 'Forensic reports may include message contents — check the receiver\'s policy before relying on them, and check your privacy obligations.'}`,
        });
        break;
      }
      case 'adkim':
      case 'aspf': {
        const mode = value.toLowerCase();
        if (!['r', 's'].includes(mode)) {
          errors.push(`The ${name} tag ("${value}") must be "r" (relaxed) or "s" (strict).`);
          tags.push({ name, value, state: 'error', detail: 'Must be r (relaxed) or s (strict).' });
        } else {
          tags.push({
            name,
            value,
            state: 'valid',
            detail:
              mode === 'r'
                ? 'Relaxed alignment: the organisational domain must match, subdomains are allowed to differ.'
                : 'Strict alignment: the domain must match exactly, including subdomains.',
          });
        }
        break;
      }
      case 'fo': {
        const options_ = value.split(':').map((entry) => entry.trim()).filter(Boolean);
        const invalid = options_.filter((entry) => !['0', '1', 'd', 's'].includes(entry));
        if (invalid.length > 0) {
          errors.push(`The fo tag contains unknown values: ${invalid.join(', ')}`);
        }
        tags.push({ name, value, state: invalid.length > 0 ? 'error' : 'valid', detail: 'Controls which failure conditions generate forensic reports.' });
        break;
      }
      case 'rf':
        if (!['afrf', 'iodef'].includes(value.toLowerCase())) {
          errors.push(`The rf tag ("${value}") must be afrf or iodef.`);
          tags.push({ name, value, state: 'error', detail: 'Must be afrf or iodef.' });
        } else {
          tags.push({ name, value, state: 'valid', detail: 'Selects the report format for forensic reports.' });
        }
        break;
      case 'ri': {
        const seconds = Number(value);
        if (!Number.isInteger(seconds) || seconds < 0) {
          errors.push(`The ri tag ("${value}") must be a non-negative integer number of seconds.`);
          tags.push({ name, value, state: 'error', detail: 'Must be a non-negative integer of seconds.' });
        } else {
          tags.push({ name, value, state: 'valid', detail: `Aggregate reports are requested every ${seconds} seconds.` });
        }
        break;
      }
      default:
        break;
    }
  }

  const policy = tags.find((tag) => tag.name === 'p')?.value?.toLowerCase() ?? null;
  const tagsByName = new Map(tags.map((tag) => [tag.name, tag]));

  explanations.push(
    'DMARC tells receivers what to do when a message fails both SPF and DKIM for your domain, and where to send reports about it.'
  );
  if (policy === 'p=none' || policy === 'none') {
    explanations.push(
      'p=none is monitoring mode: nothing is blocked. It is a valid first stage while you collect reports, but on its own it does not stop spoofing.'
    );
  }
  if (!tagsByName.has('rua')) {
    warnings.push('No rua tag is published, so you will not receive aggregate reports and cannot see who is sending as your domain.');
  }

  return {
    found: true,
    record,
    records,
    tags,
    policy,
    subdomainPolicy: tagsByName.get('sp')?.value ?? null,
    percentage: tagsByName.has('pct') ? Number(tagsByName.get('pct')!.value) : 100,
    aggregateReports: (tagsByName.get('rua')?.value ?? '').split(',').map((v) => v.trim()).filter(Boolean),
    forensicReports: (tagsByName.get('ruf')?.value ?? '').split(',').map((v) => v.trim()).filter(Boolean),
    alignmentDkim: tagsByName.get('adkim')?.value ?? null,
    alignmentSpf: tagsByName.get('aspf')?.value ?? null,
    failureOptions: (tagsByName.get('fo')?.value ?? '').split(':').map((v) => v.trim()).filter(Boolean),
    reportInterval: tagsByName.has('ri') ? Number(tagsByName.get('ri')!.value) : null,
    errors,
    warnings,
    explanations,
  };
}

export interface DmarcDraftInput {
  domain: string;
  policy: 'none' | 'quarantine' | 'reject';
  subdomainPolicy?: 'none' | 'quarantine' | 'reject' | '';
  percentage?: number;
  aggregateReports?: string;
  forensicReports?: string;
  alignmentDkim?: 'r' | 's' | '';
  alignmentSpf?: 'r' | 's' | '';
  failureOptions?: string[];
  reportInterval?: number | null;
}

export interface DmarcDraft {
  recordName: string;
  recordType: 'TXT';
  value: string;
  ttlRecommendation: number;
  notes: string[];
}

/** Deterministic DMARC record builder (spec §11). Validates before emitting. */
export function buildDmarcRecord(input: DmarcDraftInput): DmarcDraft {
  const parts: string[] = ['v=DMARC1', `p=${input.policy}`];
  if (input.subdomainPolicy) parts.push(`sp=${input.subdomainPolicy}`);
  if (input.percentage !== undefined && input.percentage !== 100) {
    parts.push(`pct=${Math.min(Math.max(Math.trunc(input.percentage), 0), 100)}`);
  }
  const rua = (input.aggregateReports ?? '')
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => (entry.startsWith('mailto:') ? entry : `mailto:${entry}`));
  if (rua.length > 0) parts.push(`rua=${rua.join(',')}`);
  const ruf = (input.forensicReports ?? '')
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => (entry.startsWith('mailto:') ? entry : `mailto:${entry}`));
  if (ruf.length > 0) parts.push(`ruf=${ruf.join(',')}`);
  if (input.alignmentDkim) parts.push(`adkim=${input.alignmentDkim}`);
  if (input.alignmentSpf) parts.push(`aspf=${input.alignmentSpf}`);
  if (input.failureOptions && input.failureOptions.length > 0) parts.push(`fo=${input.failureOptions.join(':')}`);
  if (input.reportInterval !== undefined && input.reportInterval !== null) parts.push(`ri=${Math.trunc(input.reportInterval)}`);

  const value = parts.join('; ');
  const notes: string[] = [
    'Publish this as a TXT record; DNS managers that split long values into 255-character strings must keep the concatenated value byte-identical to this string.',
  ];
  if (rua.length === 0) {
    notes.push('Without rua you will receive no aggregate reports, so you cannot see who is sending as your domain.');
  }
  if (input.policy === 'reject' || input.policy === 'quarantine') {
    notes.push(
      `Enforcing p=${input.policy} before every legitimate sender is aligned will cause those messages to be quarantined or rejected. Start with p=none, review the aggregate reports, then tighten.`
    );
  }
  if (input.percentage !== undefined && input.percentage !== 100) {
    notes.push(`pct=${input.percentage} applies the policy to only that percentage of failing messages.`);
  }

  const dmarc = parseDmarcRecords([value], { domain: input.domain });
  if (dmarc.errors.length > 0) {
    notes.push(`Validation warning: ${dmarc.errors.join(' ')}`);
  }

  return {
    recordName: '_dmarc',
    recordType: 'TXT',
    value,
    ttlRecommendation: 3600,
    notes,
  };
}

// ---------------------------------------------------------------------------------------------
// DKIM (RFC 6376)
// ---------------------------------------------------------------------------------------------

export interface DkimAnalysis {
  selector: string;
  recordName: string;
  found: boolean;
  records: string[];
  tags: Record<string, string>;
  keyType: string | null;
  /** 'rsa' | 'ed25519' — derived from the key type tag or the key material length. */
  keyAlgorithm: string | null;
  publicKeyPresent: boolean;
  publicKeyLength: number | null;
  keyBits: number | null;
  revoked: boolean;
  testing: boolean;
  errors: string[];
  warnings: string[];
  explanations: string[];
}

function base64KeyBytes(publicKey: string): number | null {
  try {
    return Buffer.from(publicKey.replace(/\s+/g, ''), 'base64').length;
  } catch {
    return null;
  }
}

export function parseDkimRecord(domain: string, selector: string, txtValues: string[]): DkimAnalysis {
  const recordName = `${selector}._domainkey.${domain}`;
  const records = txtValues.filter((value) => value.trim().length > 0);
  const errors: string[] = [];
  const warnings: string[] = [];
  const explanations: string[] = [];

  if (records.length === 0) {
    errors.push(`No TXT record was found at ${recordName}.`);
    return {
      selector,
      recordName,
      found: false,
      records,
      tags: {},
      keyType: null,
      keyAlgorithm: null,
      publicKeyPresent: false,
      publicKeyLength: null,
      keyBits: null,
      revoked: false,
      testing: false,
      errors,
      warnings,
      explanations: [
        'A DKIM record publishes the public half of the key that mail from this selector is signed with. Without it, receivers cannot verify DKIM for that selector.',
      ],
    };
  }

  if (records.length > 1) {
    warnings.push(`${records.length} TXT records exist at this name; receivers may use any one of them, which makes verification unpredictable.`);
  }

  const record = records[0]!;
  const tags: Record<string, string> = {};
  for (const part of record.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) {
      warnings.push(`"${trimmed}" is not a tag=value pair and will be ignored.`);
      continue;
    }
    tags[trimmed.slice(0, separator).trim().toLowerCase()] = trimmed.slice(separator + 1).trim();
  }

  const version = tags.v ?? null;
  if (version && version.toUpperCase() !== 'DKIM1') {
    errors.push(`The v tag must be DKIM1 (found "${version}").`);
  }

  const keyType = (tags.k ?? 'rsa').toLowerCase();
  if (!['rsa', 'ed25519'].includes(keyType)) {
    errors.push(`The k tag must be "rsa" or "ed25519" (found "${tags.k}").`);
  }

  const publicKey = (tags.p ?? '').replace(/\s+/g, '');
  const revoked = Object.prototype.hasOwnProperty.call(tags, 'p') && publicKey.length === 0;
  if (revoked) {
    warnings.push('The p tag is present but empty, which RFC 6376 defines as a revoked key: this selector is intentionally disabled.');
  }
  if (!Object.prototype.hasOwnProperty.call(tags, 'p')) {
    errors.push('The record has no p= tag, so it publishes no public key.');
  } else if (publicKey.length > 0 && !/^[A-Za-z0-9+/=]+$/.test(publicKey)) {
    errors.push('The public key contains characters that are not valid base64.');
  }

  let keyBits: number | null = null;
  const keyBytes = publicKey ? base64KeyBytes(publicKey) : null;
  if (keyType === 'rsa' && keyBytes) {
    // A SubjectPublicKeyInfo RSA key of N bits is roughly N/8 bytes plus ~38 bytes of DER header.
    keyBits = Math.round(((keyBytes - 38) * 8) / 8 / 8) * 8;
    if (keyBits > 0 && keyBits < 1024) {
      warnings.push(`The RSA key appears to be about ${keyBits} bits. Keys below 1024 bits are refused by several large receivers.`);
    }
  }

  if (tags.t === 'y') {
    warnings.push('The t=y flag marks this key as testing; some receivers ignore testing keys entirely.');
  }
  if (tags.s && !['email', '*'].includes(tags.s.toLowerCase())) {
    warnings.push(`The s tag ("${tags.s}") limits the key to a specific service type; receivers must ignore the key for other services.`);
  }
  if (!tags.h) {
    explanations.push('No h tag is published, so the key is acceptable for any hash algorithm the receiver supports.');
  }

  explanations.push('This tool validates the published record. It cannot confirm that a message actually verifies, because that requires the signature and the full message.');

  return {
    selector,
    recordName,
    found: true,
    records,
    tags,
    keyType,
    keyAlgorithm: keyType === 'ed25519' ? 'ed25519' : 'rsa',
    publicKeyPresent: publicKey.length > 0,
    publicKeyLength: publicKey.length > 0 ? publicKey.length : null,
    keyBits,
    revoked,
    testing: tags.t === 'y',
    errors,
    warnings,
    explanations,
  };
}

// ---------------------------------------------------------------------------------------------
// BIMI
// ---------------------------------------------------------------------------------------------

export interface BimiAnalysis {
  found: boolean;
  record: string | null;
  recordName: string;
  tags: Record<string, string>;
  logoUrl: string | null;
  certificateUrl: string | null;
  errors: string[];
  warnings: string[];
  explanations: string[];
}

export function parseBimiRecord(domain: string, txtValues: string[]): BimiAnalysis {
  const recordName = `default._bimi.${domain}`;
  const records = txtValues.filter((value) => /^\s*v=BIMI1/i.test(value.trim()));
  const errors: string[] = [];
  const warnings: string[] = [];
  const explanations: string[] = [];

  if (records.length === 0) {
    return {
      found: false,
      record: null,
      recordName,
      tags: {},
      logoUrl: null,
      certificateUrl: null,
      errors: [`No BIMI record was found at ${recordName}.`],
      warnings,
      explanations: ['BIMI lets a mailbox provider display your logo next to authenticated mail; it requires a published logo and, for most providers, a Verified Mark Certificate.'],
    };
  }

  const record = records[0]!.trim();
  const tags: Record<string, string> = {};
  for (const part of record.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    tags[trimmed.slice(0, separator).trim().toLowerCase()] = trimmed.slice(separator + 1).trim();
  }

  const logoUrl = tags.l && tags.l.length > 0 ? tags.l : null;
  const certificateUrl = tags.a && tags.a.length > 0 ? tags.a : null;

  for (const [name, url] of [
    ['l', logoUrl],
    ['a', certificateUrl],
  ] as const) {
    if (url && !/^https:\/\//i.test(url)) {
      errors.push(`The ${name} tag must be an https:// URL (found "${url}").`);
    }
  }
  if (!logoUrl) errors.push('The record has no l= tag, so no logo is published.');

  explanations.push('Receivers only consider BIMI when the domain enforces a DMARC policy; a monitoring-only policy (p=none) is not sufficient for most providers.');

  return {
    found: true,
    record,
    recordName,
    tags,
    logoUrl,
    certificateUrl,
    errors,
    warnings,
    explanations,
  };
}

// ---------------------------------------------------------------------------------------------
// DNSSEC helpers
// ---------------------------------------------------------------------------------------------

export interface DnskeyInfo {
  keyTag: number;
  flags: number;
  protocol: number;
  algorithm: number;
  algorithmName: string;
  publicKey: string;
  /** True when the SEP bit (flags & 0x0001) is set — the key normally referenced by DS. */
  secureEntryPoint: boolean;
  zoneKey: boolean;
}

const DNSSEC_ALGORITHMS: Record<number, string> = {
  1: 'RSAMD5',
  3: 'DSA',
  5: 'RSASHA1',
  6: 'DSA-NSEC3-SHA1',
  7: 'RSASHA1-NSEC3-SHA1',
  8: 'RSASHA256',
  10: 'RSASHA512',
  12: 'ECC-GOST',
  13: 'ECDSAP256SHA256',
  14: 'ECDSAP384SHA384',
  15: 'ED25519',
  16: 'ED448',
};

export function algorithmName(code: number): string {
  return DNSSEC_ALGORITHMS[code] ?? `Unknown (${code})`;
}

/**
 * Computes the RFC 4034 §5.1.4 key tag — the value a DS record references. This is a real
 * computation over the RDATA, not an echo of the provider's field, so the DS/DNSKEY comparison in
 * the DNSSEC tools is meaningful.
 */
export function computeKeyTag(rdata: Buffer): number {
  let accumulator = 0;
  for (let i = 0; i < rdata.length; i += 1) {
    accumulator += i & 1 ? rdata[i]! : rdata[i]! << 8;
  }
  accumulator += (accumulator >> 16) & 0xffff;
  return accumulator & 0xffff;
}

export function describeDnskey(rdata: Buffer): DnskeyInfo {
  const flags = ((rdata[0] ?? 0) << 8) | (rdata[1] ?? 0);
  const protocol = rdata[2] ?? 0;
  const algorithm = rdata[3] ?? 0;
  return {
    keyTag: computeKeyTag(rdata),
    flags,
    protocol,
    algorithm,
    algorithmName: algorithmName(algorithm),
    publicKey: rdata.subarray(4).toString('base64'),
    secureEntryPoint: (flags & 0x0001) !== 0,
    zoneKey: (flags & 0x0100) !== 0,
  };
}
