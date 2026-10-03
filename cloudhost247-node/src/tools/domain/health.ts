/**
 * Tools Center — Domain Health Center (spec §88, `/domains/:domain/health`).
 *
 * One report that answers "is this domain healthy?" by composing checks that already exist and
 * naming, explicitly, the ones that could not run. The aggregator never averages away a failure and
 * never invents a score for a check that did not happen: each section carries its own verdict, and
 * the overall verdict is the worst section verdict that actually produced evidence.
 *
 * The hosting context is read from CloudHost247's own tables (is this domain in the customer's
 * account, is there a DNS zone, which server serves it), so the page can offer the native actions —
 * open DNS management, open cPanel, order SSL — instead of a generic tool page.
 */
import { performance } from 'node:perf_hooks';
import type { Queryable } from '../../db/types';
import { normalizeDomain } from '../dns/common';
import { dnsHealthCheck, type DnsHealthResult } from '../dns/health';
import { sslCheck, type SslCheckResult } from '../security/ssl';
import { listMonitors, type MonitorRow } from '../diagnostics/monitors';

export type HealthSectionStatus = 'PASS' | 'WARNING' | 'ERROR' | 'NOT_CHECKED' | 'UNKNOWN';

export interface HealthSection {
  id: 'dns' | 'email-auth' | 'dnssec' | 'tls' | 'hosting' | 'monitoring';
  label: string;
  status: HealthSectionStatus;
  summary: string;
  detail: string | null;
  checked: boolean;
  durationMs: number | null;
  evidence: unknown;
}

export interface DomainHealthCenterResult {
  domain: string;
  generatedAt: string;
  verdict: { status: HealthSectionStatus; summary: string; sectionsChecked: number; sectionsFailed: number };
  sections: HealthSection[];
  hostingContext: {
    owned: boolean;
    domainId: string | null;
    zoneId: string | null;
    serverName: string | null;
    serverIp: string | null;
    customerServiceId: string | null;
    actions: Array<{ label: string; href: string; kind: 'dns' | 'cpanel' | 'ssl' | 'support' | 'monitor' }>;
  };
  monitors: Array<{ id: string; kind: MonitorRow['kind']; target: string; enabled: boolean; lastStatus: MonitorRow['last_status']; lastCheckedAt: string | null }>;
  recommendations: string[];
  notes: string[];
  durationMs: number;
}

const SECTION_LABELS: Record<HealthSection['id'], string> = {
  dns: 'DNS records',
  'email-auth': 'E-mail authentication (SPF/DKIM/DMARC)',
  dnssec: 'DNSSEC',
  tls: 'TLS certificate',
  hosting: 'CloudHost247 hosting',
  monitoring: 'Monitoring',
};

function worstStatus(statuses: HealthSectionStatus[]): HealthSectionStatus {
  const order: HealthSectionStatus[] = ['ERROR', 'WARNING', 'UNKNOWN', 'NOT_CHECKED', 'PASS'];
  for (const status of order) {
    if (statuses.includes(status)) return status;
  }
  return 'UNKNOWN';
}

/** Verdicts from the DNS health module map 1:1; this converts the section shape it reports. */
function sectionFromDns(id: HealthSection['id'], label: string, status: HealthSectionStatus, summary: string, detail: string | null, evidence: unknown, durationMs: number | null): HealthSection {
  return { id, label, status, summary, detail, checked: status !== 'NOT_CHECKED' && status !== 'UNKNOWN', durationMs, evidence };
}

export async function domainHealthCenter(
  db: Queryable,
  input: { domain: string; userId?: string | null; dkimSelectors?: string[]; extended?: boolean; resolverId?: string }
): Promise<DomainHealthCenterResult> {
  const started = performance.now();
  const domain = normalizeDomain(input.domain);
  const sections: HealthSection[] = [];

  // --- DNS health -------------------------------------------------------------------------------
  let dnsResult: DnsHealthResult | null = null;
  let dnsError: string | null = null;
  const dnsStarted = performance.now();
  try {
    dnsResult = await dnsHealthCheck(db, {
      domain,
      dkimSelectors: input.dkimSelectors,
      extended: input.extended !== false,
      resolverId: input.resolverId,
    });
  } catch (error) {
    dnsError = error instanceof Error ? error.message : 'The DNS health check failed.';
  }
  const dnsDuration = Math.round(performance.now() - dnsStarted);

  if (dnsResult) {
    const dnsVerdict = dnsResult.status as HealthSectionStatus;
    sections.push(
      sectionFromDns(
        'dns',
        SECTION_LABELS.dns,
        dnsVerdict,
        dnsResult.summary,
        dnsResult.notCovered.length > 0 ? `Not covered by this run: ${dnsResult.notCovered.join('; ')}` : null,
        { checks: dnsResult.checks, resolversUsed: dnsResult.resolversUsed, counts: dnsResult.counts },
        dnsDuration
      )
    );
    const emailChecks = dnsResult.checks.filter((check) => check.id.startsWith('mail-') || check.id.includes('spf') || check.id.includes('dmarc') || check.id.includes('dkim') || check.id.includes('mx'));
    sections.push(
      sectionFromDns(
        'email-auth',
        SECTION_LABELS['email-auth'],
        emailChecks.length === 0 ? 'NOT_CHECKED' : worstStatus(emailChecks.map((check) => check.status as HealthSectionStatus)),
        emailChecks.length === 0 ? 'No e-mail checks were run for this domain.' : emailChecks.map((check) => `${check.title}: ${check.status}`).join(' · '),
        emailChecks.find((check) => check.status !== 'PASS')?.detail ?? emailChecks[0]?.detail ?? null,
        emailChecks,
        dnsDuration
      )
    );
    const dnssecCheck = dnsResult.checks.find((check) => check.id.includes('dnssec'));
    sections.push(
      sectionFromDns(
        'dnssec',
        SECTION_LABELS.dnssec,
        dnssecCheck ? (dnssecCheck.status as HealthSectionStatus) : 'NOT_CHECKED',
        dnssecCheck ? dnssecCheck.detail : 'The DNSSEC check did not run.',
        dnssecCheck?.detail ?? null,
        dnssecCheck ?? null,
        dnsDuration
      )
    );
  } else {
    sections.push(sectionFromDns('dns', SECTION_LABELS.dns, 'ERROR', 'The DNS health check could not run.', dnsError, null, dnsDuration));
    sections.push(sectionFromDns('email-auth', SECTION_LABELS['email-auth'], 'NOT_CHECKED', 'Skipped because the DNS check did not complete.', dnsError, null, null));
    sections.push(sectionFromDns('dnssec', SECTION_LABELS.dnssec, 'NOT_CHECKED', 'Skipped because the DNS check did not complete.', dnsError, null, null));
  }

  // --- TLS --------------------------------------------------------------------------------------
  const tlsStarted = performance.now();
  let sslResult: SslCheckResult | null = null;
  let sslError: string | null = null;
  try {
    sslResult = await sslCheck({ host: domain, port: 443 });
  } catch (error) {
    sslError = error instanceof Error ? error.message : 'The TLS check failed.';
  }
  const tlsDuration = Math.round(performance.now() - tlsStarted);
  if (sslResult) {
    const status: HealthSectionStatus =
      sslResult.status === 'VALID' ? 'PASS' : sslResult.status === 'EXPIRING_SOON' ? 'WARNING' : sslResult.status === 'CHAIN_NOT_TRUSTED' || sslResult.status === 'HOSTNAME_MISMATCH' ? 'ERROR' : 'ERROR';
    sections.push(
      sectionFromDns(
        'tls',
        SECTION_LABELS.tls,
        status,
        `${sslResult.status}: ${sslResult.statusDetail}`,
        sslResult.expiry.validTo ? `Valid to ${sslResult.expiry.validTo}.` : null,
        { status: sslResult.status, issuer: sslResult.certificate.issuer, validTo: sslResult.expiry.validTo, protocol: sslResult.connection.protocol, problems: sslResult.problems },
        tlsDuration
      )
    );
  } else {
    sections.push(
      sectionFromDns(
        'tls',
        SECTION_LABELS.tls,
        /no such host|ENOTFOUND|EAI_AGAIN/i.test(sslError ?? '') ? 'WARNING' : 'ERROR',
        'No TLS certificate could be read from port 443.',
        sslError,
        null,
        tlsDuration
      )
    );
  }

  // --- CloudHost247 hosting context -------------------------------------------------------------
  let hostingContext: DomainHealthCenterResult['hostingContext'] = {
    owned: false,
    domainId: null,
    zoneId: null,
    serverName: null,
    serverIp: null,
    customerServiceId: null,
    actions: [],
  };
  if (input.userId) {
    const { rows } = await db
      .query<{ id: string; zone_id: string | null; server_name: string | null; server_ip: string | null; service_id: string | null }>(
        `SELECT d.id,
                (SELECT z.id FROM dns_zones z WHERE lower(z.domain_name) = lower(d.domain_name) AND z.user_id = $2 LIMIT 1) AS zone_id,
                (SELECT s.name FROM servers s WHERE s.customer_id = $2 AND lower(COALESCE(s.hostname,'')) LIKE '%' || lower(d.domain_name) || '%' LIMIT 1) AS server_name,
                (SELECT s.ip_address FROM servers s WHERE s.customer_id = $2 AND lower(COALESCE(s.hostname,'')) LIKE '%' || lower(d.domain_name) || '%' LIMIT 1) AS server_ip,
                (SELECT sv.id FROM customer_services sv WHERE sv.user_id = $2 AND lower(COALESCE(sv.domain_name, sv.name, '')) LIKE '%' || lower(d.domain_name) || '%' LIMIT 1) AS service_id
           FROM customer_domains d
          WHERE d.user_id = $2 AND lower(d.domain_name) = lower($1)
          LIMIT 1`,
        [domain, input.userId]
      )
      .catch(() => ({ rows: [] as Array<{ id: string; zone_id: string | null; server_name: string | null; server_ip: string | null; service_id: string | null }> }));
    const row = rows[0];
    hostingContext = {
      owned: Boolean(row),
      domainId: row?.id ?? null,
      zoneId: row?.zone_id ?? null,
      serverName: row?.server_name ?? null,
      serverIp: row?.server_ip ?? null,
      customerServiceId: row?.service_id ?? null,
      actions: row
        ? [
            ...(row.zone_id ? [{ label: 'Open DNS management', href: `/domains/${domain}/dns`, kind: 'dns' as const }] : [{ label: 'Create a DNS zone', href: '/dns', kind: 'dns' as const }]),
            ...(row.service_id ? [{ label: 'Open cPanel', href: `/services/${row.service_id}`, kind: 'cpanel' as const }] : []),
            { label: 'Order or manage SSL', href: '/ssl', kind: 'ssl' as const },
            { label: 'Set up monitoring', href: `/tools/diagnostics/monitors?target=${domain}`, kind: 'monitor' as const },
            { label: 'Contact support', href: '/support/new?subject=Domain%20health%20check', kind: 'support' as const },
          ]
        : [
            { label: 'Search this domain in CloudHost247', href: `/domains?search=${domain}`, kind: 'dns' as const },
            { label: 'Order hosting for this domain', href: '/order', kind: 'cpanel' as const },
            { label: 'Contact support', href: '/support/new?subject=Domain%20health%20check', kind: 'support' as const },
          ],
    };
  }
  sections.push(
    sectionFromDns(
      'hosting',
      SECTION_LABELS.hosting,
      !input.userId ? 'NOT_CHECKED' : hostingContext.owned ? 'PASS' : 'UNKNOWN',
      !input.userId
        ? 'Sign in to see whether this domain is in your CloudHost247 account.'
        : hostingContext.owned
          ? `This domain is in your account${hostingContext.serverName ? ` and served by ${hostingContext.serverName}` : ''}${hostingContext.zoneId ? ' with a CloudHost247 DNS zone' : ' without a CloudHost247 DNS zone'}.`
          : 'This domain is not in your CloudHost247 account, so only public checks are available.',
      hostingContext.owned && !hostingContext.zoneId ? 'The domain is registered here but its DNS is not managed by CloudHost247. DNS changes must be made at the current nameserver provider.' : null,
      hostingContext,
      null
    )
  );

  // --- Existing monitors ------------------------------------------------------------------------
  let monitors: DomainHealthCenterResult['monitors'] = [];
  if (input.userId) {
    monitors = (await listMonitors(db, input.userId))
      .filter((monitor) => monitor.target.toLowerCase().includes(domain))
      .map((monitor) => ({ id: monitor.id, kind: monitor.kind, target: monitor.target, enabled: monitor.enabled, lastStatus: monitor.last_status, lastCheckedAt: monitor.last_checked_at }));
  }
  sections.push(
    sectionFromDns(
      'monitoring',
      SECTION_LABELS.monitoring,
      monitors.length > 0 ? 'PASS' : 'NOT_CHECKED',
      monitors.length > 0 ? `${monitors.length} monitor(s) cover this domain.` : input.userId ? 'No monitor watches this domain. Set one up so a broken certificate or DNS change notifies you before a visitor notices.' : 'Sign in to use monitoring.',
      null,
      monitors,
      null
    )
  );

  const checked = sections.filter((section) => section.checked);
  const failed = checked.filter((section) => section.status === 'ERROR');
  const warned = checked.filter((section) => section.status === 'WARNING');
  const verdictStatus = worstStatus(sections.map((section) => section.status));

  const recommendations: string[] = [];
  if (failed.length > 0) recommendations.push(`${failed.length} section(s) report an error: ${failed.map((section) => section.label).join(', ')}. Fix these first.`);
  if (warned.length > 0) recommendations.push(`${warned.length} section(s) report a warning: ${warned.map((section) => section.label).join(', ')}.`);
  if (dnsResult?.recommendations) recommendations.push(...dnsResult.recommendations);
  if (sslResult?.recommendations) recommendations.push(...sslResult.recommendations);
  if (monitors.length === 0 && input.userId) recommendations.push('Add an SSL-expiry or DNS-record monitor so this report is checked automatically instead of only when you open this page.');

  return {
    domain,
    generatedAt: new Date().toISOString(),
    verdict: {
      status: verdictStatus,
      summary:
        verdictStatus === 'PASS'
          ? `${domain} passed every check that could run.`
          : verdictStatus === 'WARNING'
            ? `${domain} works, but ${warned.length} section(s) need attention.`
            : verdictStatus === 'ERROR'
              ? `${domain} has ${failed.length} failing section(s).`
              : `${domain} could not be fully checked: ${sections.filter((section) => !section.checked).map((section) => section.label).join(', ') || 'no section produced evidence'}.`,
      sectionsChecked: checked.length,
      sectionsFailed: failed.length,
    },
    sections,
    hostingContext,
    monitors,
    recommendations: [...new Set(recommendations)],
    notes: [
      'Each section reports its own verdict with the evidence behind it; the overall verdict is the worst verdict that actually ran. Sections that could not run are marked NOT_CHECKED and never counted as passing.',
      'The public checks (DNS, TLS) look at what the internet sees right now. CloudHost247 account context is added only when you are signed in and own the domain.',
    ],
    durationMs: Math.round(performance.now() - started),
  };
}
