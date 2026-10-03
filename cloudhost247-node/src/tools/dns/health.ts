/**
 * Tools Center — DNS Health Checker (spec §6) and the DNS half of the Domain Health Center (§81).
 *
 * Each check is independent, labelled PASS / WARNING / ERROR / NOT_CHECKED / UNKNOWN, and carries
 * the fact that produced it. The overall status is a count of those checks plus an explicit
 * statement of what was and was not examined — the tool never converts "records exist" into
 * "the domain is secure" (spec §6, last line).
 */
import { performance } from 'node:perf_hooks';
import type { Queryable } from '../../db/types';
import { ToolError } from '../core/errors';
import { listResolvers } from '../core/resolvers';
import { capabilityReport } from '../core/capabilities';
import { normalizeDomain, parentZone, pickResolver, queryType, type AnswerMeta } from './common';
import { parseDmarcRecords } from './records';
import { spfCheck } from './email-auth';

export type CheckStatus = 'PASS' | 'WARNING' | 'ERROR' | 'NOT_CHECKED' | 'UNKNOWN';

export interface HealthCheck {
  id: string;
  section: 'dns' | 'email' | 'web' | 'network' | 'security';
  title: string;
  status: CheckStatus;
  /** One-line fact that determines the status. */
  detail: string;
  /** Evidence: the actual records/values observed. */
  evidence: string[];
  recommendations: string[];
  /** Extended technical explanation for the "why" panel and the AI explainer. */
  explanation: string;
}

export interface DnsHealthResult {
  domain: string;
  status: CheckStatus;
  summary: string;
  checks: HealthCheck[];
  counts: Record<CheckStatus, number>;
  resolversUsed: Array<{ name: string; ip: string; protocol: string; country: string | null }>;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  /** What this run did NOT cover — stated explicitly rather than implied. */
  notCovered: string[];
  recommendations: string[];
}

export interface DnsHealthOptions {
  domain: string;
  dkimSelectors?: string[];
  /** Include the (slower) BIMI and DNSSEC checks. */
  extended?: boolean;
  resolverId?: string;
}

function check(
  id: string,
  section: HealthCheck['section'],
  title: string,
  status: CheckStatus,
  detail: string,
  evidence: string[],
  explanation: string,
  recommendations: string[] = []
): HealthCheck {
  return { id, section, title, status, detail, evidence, recommendations, explanation };
}

const TTL_DRIFT_TOLERANCE_PERCENT = 25;

export async function dnsHealthCheck(db: Queryable, options: DnsHealthOptions): Promise<DnsHealthResult> {
  const domain = normalizeDomain(options.domain);
  const startedAt = new Date();
  const checks: HealthCheck[] = [];
  const resolversUsed: DnsHealthResult['resolversUsed'] = [];

  const primary = await pickResolver(db, { id: options.resolverId });
  resolversUsed.push({ name: primary.name, ip: primary.ip_address, protocol: primary.protocol, country: primary.country });

  const hasIpv6 = capabilityReport('ipv6-outbound').status === 'AVAILABLE';
  const enabled = await listResolvers(db, { enabledOnly: true, includeIpv6: hasIpv6, limit: 20 });
  const secondary = enabled.find((row) => row.id !== primary.id && row.country_code !== primary.country_code) ?? enabled.find((row) => row.id !== primary.id);
  if (secondary) resolversUsed.push({ name: secondary.name, ip: secondary.ip_address, protocol: secondary.protocol, country: secondary.country });

  const parent = parentZone(domain);

  // --- NS / delegation ------------------------------------------------------------------------
  const apexNs = await queryType(primary, domain, 'NS', { timeoutMs: 6000 }).catch((error: unknown) => ({ error } as const));
  const parentNs = parent === domain ? null : await queryType(primary, parent, 'NS', { timeoutMs: 6000 }).catch(() => null);

  if ('error' in apexNs) {
    checks.push(
      check(
        'resolution',
        'dns',
        'Name resolves at all',
        'ERROR',
        `The A/NS lookup failed: ${(apexNs.error as Error).message}`,
        [],
        'Every other check depends on the zone being reachable, so everything else below is unreliable until this resolves.'
      )
    );
  }

  const apexNsValues = 'error' in apexNs ? [] : apexNs.records.filter((record) => record.type === 'NS').map((record) => String(record.data.target ?? ''));
  // The parent delegation must be queried at the TLD nameserver; querying the parent zone through a
  // recursive resolver returns the parent's own NS set, so we additionally ask a resolver for the
  // child's NS records with the recursion the resolver provides.
  if (apexNsValues.length === 0) {
    checks.push(
      check(
        'nameservers',
        'dns',
        'Authoritative nameservers',
        'ERROR',
        'No NS records were returned at the zone apex.',
        [],
        'NS records at the apex are what tell the world which servers are authoritative for the zone. Without them the domain cannot be delegated.'
      )
    );
  } else {
    checks.push(
      check(
        'nameservers',
        'dns',
        'Authoritative nameservers',
        'PASS',
        `${apexNsValues.length} authoritative nameserver(s) respond for the apex.`,
        apexNsValues,
        'At least two nameservers on separate networks is the long-standing operational recommendation; one alone means an outage takes the domain off the internet.'
      )
    );
    if (apexNsValues.length < 2) {
      checks.push(
        check(
          'nameserver-count',
          'dns',
          'Nameserver redundancy',
          'WARNING',
          'Only one nameserver is published for this zone.',
          apexNsValues,
          'A single nameserver is a single point of failure for the whole domain.',
          ['Publish at least two nameservers, ideally in different networks/regions.']
        )
      );
    }
  }

  // --- SOA ------------------------------------------------------------------------------------
  const soa = await queryType(primary, domain, 'SOA', { timeoutMs: 6000 }).catch(() => null);
  const soaRecord = soa?.records.find((record) => record.type === 'SOA');
  if (soaRecord) {
    const refresh = Number(soaRecord.data.refresh ?? 0);
    const retry = Number(soaRecord.data.retry ?? 0);
    const expire = Number(soaRecord.data.expire ?? 0);
    const minimum = Number(soaRecord.data.minimum ?? 0);
    const evidence = [
      `primary (MNAME): ${String(soaRecord.data.mname ?? '')}`,
      `responsible (RNAME): ${String(soaRecord.data.rname ?? '')}`,
      `serial: ${String(soaRecord.data.serial ?? '')}`,
      `refresh: ${refresh}s, retry: ${retry}s, expire: ${expire}s, minimum: ${minimum}s`,
    ];
    checks.push(
      check(
        'soa',
        'dns',
        'SOA record',
        'PASS',
        'The zone publishes an SOA record with readable timing parameters.',
        evidence,
        'The SOA identifies the primary nameserver and how long secondaries wait between refreshes, retries and expiry.'
      )
    );
    const primaryHost = String(soaRecord.data.mname ?? '');
    if (apexNsValues.length > 0 && primaryHost && !apexNsValues.some((ns) => ns.toLowerCase() === primaryHost.toLowerCase())) {
      checks.push(
        check(
          'soa-mname',
          'dns',
          'SOA primary is one of the nameservers',
          'WARNING',
          `The SOA MNAME (${primaryHost}) is not in the zone's NS set.`,
          apexNsValues,
          'RFC 1035 expects the SOA MNAME to name a host that is authoritative for the zone. Mismatches usually indicate a partially completed nameserver migration.',
          ['Update the SOA MNAME to one of the published nameservers.']
        )
      );
    }
  } else {
    checks.push(
      check('soa', 'dns', 'SOA record', 'WARNING', 'No SOA record could be retrieved.', [], 'Every zone must publish an SOA record; some resolvers refuse to serve a zone without one.')
    );
  }

  // --- A / AAAA / CNAME -----------------------------------------------------------------------
  const a = await queryType(primary, domain, 'A', { timeoutMs: 6000 }).catch(() => null);
  const aaaa = await queryType(primary, domain, 'AAAA', { timeoutMs: 6000 }).catch(() => null);
  const cname = await queryType(primary, domain, 'CNAME', { timeoutMs: 6000 }).catch(() => null);
  const aValues = (a?.records ?? []).filter((r) => r.type === 'A').map((r) => String(r.data.address ?? ''));
  const aaaaValues = (aaaa?.records ?? []).filter((r) => r.type === 'AAAA').map((r) => String(r.data.address ?? ''));
  const cnameValues = (cname?.records ?? []).filter((r) => r.type === 'CNAME').map((r) => String(r.data.target ?? ''));

  checks.push(
    aValues.length > 0 || aaaaValues.length > 0
      ? check(
          'address',
          'dns',
          'Address records (A / AAAA)',
          'PASS',
          `${aValues.length} IPv4 and ${aaaaValues.length} IPv6 address record(s) are published.`,
          [...aValues, ...aaaaValues],
          'Address records are what browsers connect to. Publishing AAAA alongside A makes the site reachable over IPv6 where the client prefers it.'
        )
      : check(
          'address',
          'dns',
          'Address records (A / AAAA)',
          'WARNING',
          'The apex publishes no A or AAAA record.',
          cnameValues,
          'A missing address record at the apex means the bare domain does not resolve; the zone may only serve subdomains.',
          ['Add an A/AAAA record for the apex if the bare domain should load.']
        )
  );

  if (cnameValues.length > 0 && (aValues.length > 0 || aaaaValues.length > 0)) {
    checks.push(
      check(
        'cname-conflict',
        'dns',
        'CNAME conflicts',
        'ERROR',
        'A CNAME exists at the apex alongside other record types, which RFC 1034 §3.6.2 forbids.',
        [...cnameValues, ...aValues],
        'A CNAME must be the only record at its name. Some resolvers silently ignore the other records, producing intermittent resolution failures.',
        ['Remove the apex CNAME and use A/AAAA records (or a provider-specific ALIAS/ANAME record).']
      )
    );
  }

  // --- NS consistency across resolvers ---------------------------------------------------------
  if (secondary) {
    const secondaryNs = await queryType(secondary, domain, 'NS', { timeoutMs: 6000 }).catch(() => null);
    const secondaryNsValues = (secondaryNs?.records ?? []).filter((r) => r.type === 'NS').map((r) => String(r.data.target ?? '')).sort();
    if (secondaryNsValues.length > 0 && apexNsValues.length > 0) {
      const same = secondaryNsValues.length === [...apexNsValues].sort().length && secondaryNsValues.every((value, index) => value === [...apexNsValues].sort()[index]);
      checks.push(
        same
          ? check(
              'ns-consistency',
              'dns',
              'Nameserver consistency',
              'PASS',
              `${primary.name} and ${secondary.name} return the same NS set.`,
              apexNsValues,
              'Consistent answers from independent resolvers indicate the delegation is settled rather than mid-change.'
            )
          : check(
              'ns-consistency',
              'dns',
              'Nameserver consistency',
              'WARNING',
              'Two resolvers returned different NS sets.',
              [`${primary.name}: ${apexNsValues.join(', ')}`, `${secondary.name}: ${secondaryNsValues.join(', ')}`],
              'Different resolvers disagreeing about the NS set usually means a delegation change is still propagating, or two separate zones exist for the same name.',
              ['Confirm which nameservers your registrar is delegated to, then remove the stale set.']
            )
      );
    }

    // --- TTL consistency ------------------------------------------------------------------------
    const secondaryA = await queryType(secondary, domain, 'A', { timeoutMs: 6000 }).catch(() => null);
    const secondaryATtl = (secondaryA?.records ?? []).find((r) => r.type === 'A')?.ttl ?? null;
    const primaryATtl = (a?.records ?? []).find((r) => r.type === 'A')?.ttl ?? null;
    if (primaryATtl !== null && secondaryATtl !== null) {
      const drift = Math.abs(primaryATtl - secondaryATtl) / Math.max(primaryATtl, 1) * 100;
      checks.push(
        drift <= TTL_DRIFT_TOLERANCE_PERCENT
          ? check(
              'ttl-consistency',
              'dns',
              'TTL consistency',
              'PASS',
              `Both resolvers report TTL ${primaryATtl}s / ${secondaryATtl}s (cached TTLs legitimately count down, so small differences are normal).`,
              [`${primary.name}: ${primaryATtl}s`, `${secondary.name}: ${secondaryATtl}s`],
              'Recursive resolvers return the remaining TTL of their cached copy, so identical values are not expected; large unexplained differences are.'
            )
          : check(
              'ttl-consistency',
              'dns',
              'TTL consistency',
              'WARNING',
              `TTLs differ notably between resolvers: ${primaryATtl}s vs ${secondaryATtl}s.`,
              [`${primary.name}: ${primaryATtl}s`, `${secondary.name}: ${secondaryATtl}s`],
              'A large TTL difference can indicate two different zones or a recent TTL change still cycling through caches.',
              ['Confirm the record TTL in your DNS host matches what resolvers are serving.']
            )
      );
    }
  }

  // --- CAA ------------------------------------------------------------------------------------
  const caa = await queryType(primary, domain, 'CAA', { timeoutMs: 6000 }).catch(() => null);
  const caaValues = (caa?.records ?? []).filter((r) => r.type === 'CAA').map((r) => `${String(r.data.tag ?? '')}="${String(r.data.value ?? '')}"`);
  checks.push(
    caaValues.length > 0
      ? check(
          'caa',
          'dns',
          'CAA record',
          'PASS',
          `${caaValues.length} CAA record(s) restrict certificate issuance.`,
          caaValues,
          'A CAA record tells certificate authorities which of them may issue for this domain. It reduces the blast radius of a mis-issued certificate.'
        )
      : check(
          'caa',
          'dns',
          'CAA record',
          'WARNING',
          'No CAA record is published, so any public CA may issue for this domain.',
          [],
          'CAA is optional, but publishing it is a cheap control: without it, any trusted CA may issue a certificate for your domain if it is tricked into believing you asked.',
          ['Publish CAA records naming your certificate authority, for example: 0 issue "letsencrypt.org"']
        )
  );

  // --- SPF ------------------------------------------------------------------------------------
  const spf = await spfCheck(db, { domain, resolverId: options.resolverId }).catch(() => null);
  if (spf) {
    const status: CheckStatus = spf.status === 'ERROR' ? 'ERROR' : spf.status === 'WARNING' ? 'WARNING' : 'PASS';
    checks.push(
      check(
        'spf',
        'email',
        'SPF',
        status,
        spf.analysis.found ? `SPF record present; ${spf.analysis.lookupCount} top-level / ${spf.totalLookupCount} total DNS lookups.` : 'No SPF record is published.',
        [spf.analysis.record ?? '', ...spf.facts].filter(Boolean),
        'SPF lists which servers may send mail for the domain. Receivers check it against the SMTP envelope sender, which is why alignment with From matters for DMARC.',
        spf.recommendations
      )
    );
  } else {
    checks.push(check('spf', 'email', 'SPF', 'UNKNOWN', 'The SPF check could not be completed.', [], 'The lookup failed; re-run the health check.'));
  }

  // --- DMARC ----------------------------------------------------------------------------------
  const dmarcValues = await queryType(primary, `_dmarc.${domain}`, 'TXT', { timeoutMs: 6000 }).catch(() => null);
  const dmarc = parseDmarcRecords(
    (dmarcValues?.records ?? []).filter((r) => r.type === 'TXT').map((r) => String(r.data.value ?? '')),
    { domain }
  );
  checks.push(
    check(
      'dmarc',
      'email',
      'DMARC',
      !dmarc.found ? 'ERROR' : dmarc.errors.length > 0 ? 'ERROR' : dmarc.policy === 'none' ? 'WARNING' : 'PASS',
      dmarc.found
        ? `Policy p=${dmarc.policy ?? 'unset'}${dmarc.percentage !== null ? `, pct=${dmarc.percentage}` : ''}.`
        : 'No DMARC record is published.',
      [dmarc.record ?? ''],
      'DMARC tells receivers what to do when SPF and DKIM both fail for your domain, and where to report it. Without it, spoofing your domain is easier and you receive no visibility.',
      dmarc.found
        ? dmarc.policy === 'none'
          ? ['p=none monitors only. Once reports show only legitimate senders, tighten to quarantine and then reject.']
          : []
        : [`Publish a TXT record at _dmarc.${domain} starting with: v=DMARC1; p=none; rua=mailto:dmarc@${domain}`]
    )
  );

  // --- DKIM -----------------------------------------------------------------------------------
  const selectors = (options.dkimSelectors ?? []).map((selector) => selector.trim()).filter(Boolean);
  if (selectors.length > 0) {
    const found: string[] = [];
    const missing: string[] = [];
    for (const selector of selectors.slice(0, 10)) {
      const record = await queryType(primary, `${selector}._domainkey.${domain}`, 'TXT', { timeoutMs: 5000 }).catch(() => null);
      const values = (record?.records ?? []).filter((r) => r.type === 'TXT').map((r) => String(r.data.value ?? ''));
      if (values.some((value) => /v=DKIM1|p=/i.test(value))) found.push(selector);
      else missing.push(selector);
    }
    checks.push(
      check(
        'dkim',
        'email',
        'DKIM selectors',
        missing.length === 0 ? 'PASS' : found.length > 0 ? 'WARNING' : 'ERROR',
        `Checked ${selectors.length} selector(s): ${found.length} published a key, ${missing.length} did not.`,
        [`with keys: ${found.join(', ') || 'none'}`, `missing: ${missing.join(', ') || 'none'}`],
        'DKIM signs outgoing mail with a private key; the matching public key is published at <selector>._domainkey.<domain>. A missing selector means those messages cannot be verified.',
        missing.length > 0 ? [`Confirm the selector names used by your mail platform, then publish the keys it provided for: ${missing.join(', ')}`] : []
      )
    );
  } else {
    checks.push(
      check(
        'dkim',
        'email',
        'DKIM selectors',
        'NOT_CHECKED',
        'No selectors were supplied, so DKIM was not checked.',
        [],
        'DKIM keys are published under a selector name chosen by the mail platform, so the selector has to be supplied (common ones: default, google, selector1, mail).'
      )
    );
  }

  // --- BIMI (extended) ------------------------------------------------------------------------
  if (options.extended) {
    const bimi = await queryType(primary, `default._bimi.${domain}`, 'TXT', { timeoutMs: 6000 }).catch(() => null);
    const bimiValues = (bimi?.records ?? []).filter((r) => r.type === 'TXT').map((r) => String(r.data.value ?? ''));
    const hasBimi = bimiValues.some((value) => /v=BIMI1/i.test(value));
    checks.push(
      check(
        'bimi',
        'email',
        'BIMI',
        hasBimi ? 'PASS' : 'WARNING',
        hasBimi ? 'A BIMI record is published.' : 'No BIMI record is published.',
        bimiValues,
        'BIMI controls whether a mailbox provider can display your brand logo. It requires an enforcing DMARC policy and, at most large providers, a Verified Mark Certificate.',
        hasBimi ? [] : ['Optional. Publish default._bimi.<domain> once DMARC enforces and you have a logo (and ideally a VMC).']
      )
    );
  }

  // --- DNSSEC (extended) ----------------------------------------------------------------------
  if (options.extended) {
    const dnskey = await queryType(primary, domain, 'DNSKEY', { timeoutMs: 7000, dnssec: true }).catch(() => null);
    const keys = (dnskey?.records ?? []).filter((r) => r.type === 'DNSKEY');
    const dsAnswer = await queryType(primary, parent, 'DS', { timeoutMs: 7000, dnssec: true }).catch(() => null);
    const dsRecords = (dsAnswer?.records ?? []).filter((r) => r.type === 'DS' && r.name.toLowerCase() === domain.toLowerCase());
    const signed = keys.length > 0;
    const chained = dsRecords.length > 0;
    checks.push(
      check(
        'dnssec',
        'security',
        'DNSSEC',
        signed && chained ? 'PASS' : signed && !chained ? 'WARNING' : !signed && chained ? 'ERROR' : 'WARNING',
        signed && chained
          ? `${keys.length} DNSKEY record(s) at the zone and ${dsRecords.length} DS record(s) at the parent.`
          : signed
            ? 'The zone publishes DNSKEY records but the parent publishes no DS record, so validators cannot chain the trust.'
            : chained
              ? 'The parent publishes DS records but no DNSKEY was observed at the zone; validators would fail.'
              : 'Neither DNSKEY nor DS records were observed.',
        [...keys.map((r) => String(r.data.publicKey ?? '').slice(0, 40) + '…'), ...dsRecords.map((r) => `DS keyTag ${String(r.data.keyTag ?? '')}`)],
        'This check reports the presence of the DNSSEC chain material. It does not assert that signatures validate: that requires a validating resolver, which this platform deliberately does not impersonate.',
        signed && !chained ? ['Ask your registrar to publish the DS record for your key so the chain from the parent is complete.'] : []
      )
    );
  } else {
    checks.push(
      check(
        'dnssec',
        'security',
        'DNSSEC',
        'NOT_CHECKED',
        'The DNSSEC check was not run (extended mode is off).',
        [],
        'DNSKEY/DS lookups are slower, so they are only included in extended mode.',
        ['Re-run with extended checks enabled to inspect DNSSEC.']
      )
    );
  }

  // --- Assembled result -----------------------------------------------------------------------
  const completedAt = new Date();
  const counts: Record<CheckStatus, number> = { PASS: 0, WARNING: 0, ERROR: 0, NOT_CHECKED: 0, UNKNOWN: 0 };
  for (const item of checks) counts[item.status] += 1;

  const status: CheckStatus = counts.ERROR > 0 ? 'ERROR' : counts.WARNING > 0 ? 'WARNING' : counts.NOT_CHECKED > 0 ? 'WARNING' : 'PASS';
  const summary =
    counts.ERROR > 0
      ? `${counts.ERROR} check(s) failed, ${counts.WARNING} raised warnings, ${counts.PASS} passed.`
      : counts.WARNING > 0
        ? `${counts.WARNING} check(s) raised warnings and ${counts.PASS} passed.`
        : `${counts.PASS} check(s) passed.`;

  const recommendations = [...new Set(checks.flatMap((item) => item.recommendations))];

  return {
    domain,
    status,
    summary,
    checks,
    counts,
    resolversUsed,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    notCovered: [
      'Mailbox deliverability and sending reputation (this is a DNS-level check only).',
      options.extended ? 'Whether DNSSEC signatures actually validate (no validating resolver is used).' : 'DNSSEC, BIMI and DKIM (extended mode was off).',
      'Certificate and web-server configuration — see the SSL Checker and Domain Health Center.',
    ],
    recommendations,
  };
}
