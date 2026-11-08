/**
 * Domain mail diagnostics — SPF, DKIM, DMARC, MX, PTR and the SMTP banner.
 *
 * This module deliberately contains **no DNS or SMTP implementation**. The Tools Center already has
 * carefully tested ones (`src/tools/dns/email-auth.ts`, `src/tools/dns/lookup.ts`,
 * `src/tools/developer/smtp.ts`) with resolver selection, lookup limits, SSRF refusal and timeouts.
 * Duplicating any of that for the Email Trace Centre would create a second, differently-behaved
 * answer to the same question, so this file only *composes* the existing checks and maps their
 * results into one vocabulary.
 *
 * The mapping rule matters more than the plumbing: a check that could not run is `NOT_CHECKED`, never
 * `PASS`. A domain with no SPF record is `NOT_FOUND`, not "probably fine". Nothing here looks at
 * message history — these are publishing and reachability checks, and the response says so.
 */
import type { Queryable } from '../db/types';
import { dkimCheck, dmarcCheck, spfCheck } from '../tools/dns/email-auth';
import { mxLookup, type MxLookupResult } from '../tools/dns/lookup';
import { smtpTest, type SmtpTestResult } from '../tools/developer/smtp';

export type DiagnosticStatus = 'PASS' | 'WARNING' | 'ERROR' | 'NOT_FOUND' | 'NOT_CHECKED' | 'UNKNOWN';

export type DiagnosticId = 'spf' | 'dkim' | 'dmarc' | 'mx' | 'ptr' | 'smtp_banner';

export interface DiagnosticCheck {
  id: DiagnosticId;
  label: string;
  status: DiagnosticStatus;
  summary: string;
  /** Facts a customer can act on (record contents, hostnames, banner text). Never fabricated. */
  detail: string[];
    /** True when the check needs DNS/TCP and the environment could not provide it. */
  unavailable: boolean;
}

export interface DomainDiagnostics {
  domain: string;
  checks: DiagnosticCheck[];
  notes: string[];
  /** One-line summary that cannot be read as a delivery guarantee. */
  caveat: string;
}

/** Default DKIM selectors: the ones cPanel/Exim, Google Workspace and Microsoft 365 publish. */
export const DEFAULT_DKIM_SELECTORS = ['default', 'google', 'selector1'];

export interface DiagnosticInput {
  domain: string;
  dkimSelectors?: string[];
  /** TCP banner read: off unless explicitly requested, because it opens outbound connections. */
  includeSmtpBanner?: boolean;
  resolverId?: string;
  /**
   * Per-check ceiling. A check that exceeds it is reported as NOT_CHECKED ("timed out") rather than
   * holding the whole page open or quietly disappearing. Defaults to 12s.
   */
  perCheckTimeoutMs?: number;
}

export const DIAGNOSTIC_CHECK_TIMEOUT_MS = 12_000;

/** Resolves with the promise, or rejects with a message the check can report verbatim. */
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} did not complete within ${Math.round(ms / 1000)}s.`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The checks, injectable so the composition and status mapping can be tested without DNS.
 * The live implementations are built from the Tools Center functions in `defaultDiagnosticRunners()`.
 */
export interface DiagnosticRunners {
  spf(input: DiagnosticInput): Promise<{ found: boolean; record: string | null; errors: string[]; warnings: string[]; lookupCount: number; lookupLimit: number }>;
  dmarc(input: DiagnosticInput): Promise<{ status: 'VALID' | 'WARNING' | 'ERROR' | 'NOT_FOUND'; summary: string; facts: string[] }>;
  dkim(input: DiagnosticInput): Promise<Array<{ selector: string; status: 'VALID' | 'WARNING' | 'ERROR' | 'NOT_FOUND'; recordName: string }>>;
  mx(input: DiagnosticInput): Promise<MxLookupResult>;
  smtp(input: DiagnosticInput): Promise<SmtpTestResult>;
}

const CAVEAT =
  'These checks read public DNS and, when requested, the SMTP banner of the domain’s mail host. They show whether mail authentication and mail routing are published correctly. They cannot say whether any individual message was delivered, filtered or read.';

export function defaultDiagnosticRunners(db: Queryable): DiagnosticRunners {
  return {
    spf: async (input) => {
      const result = await spfCheck(db, { domain: input.domain, resolverId: input.resolverId });
      return {
        found: result.analysis.found,
        record: result.analysis.record,
        errors: result.analysis.errors,
        warnings: result.analysis.warnings,
        lookupCount: result.analysis.lookupCount,
        lookupLimit: result.analysis.lookupLimit,
      };
    },
    dmarc: async (input) => {
      const result = await dmarcCheck(db, { domain: input.domain, resolverId: input.resolverId });
      return { status: result.status, summary: result.summary, facts: result.facts };
    },
    dkim: async (input) => {
      const result = await dkimCheck(db, {
        domain: input.domain,
        selectors: input.dkimSelectors && input.dkimSelectors.length > 0 ? input.dkimSelectors : DEFAULT_DKIM_SELECTORS,
        resolverId: input.resolverId,
      });
      return result.selectors.map((entry) => ({
        selector: entry.selector,
        status: entry.status,
        recordName: `${entry.selector}._domainkey.${input.domain}`,
      }));
    },
    mx: (input) => mxLookup(db, { domain: input.domain, resolverId: input.resolverId }),
    smtp: (input) => smtpTest(db, { target: input.domain, maxHosts: 2 }),
  };
}

function notChecked(id: DiagnosticId, label: string, reason: string): DiagnosticCheck {
  return {
    id,
    label,
    status: 'NOT_CHECKED',
    summary: `This check could not be completed: ${reason}`,
    detail: [],
    unavailable: true,
  };
}

/**
 * Run every diagnostic and map the outcomes into one vocabulary.
 *
 * Each check is isolated: a resolver failure on SPF does not stop DKIM from being reported, and it
 * never silently disappears from the list — an absent check looks like a passing one.
 */
export async function diagnoseDomain(
  input: DiagnosticInput,
  runners: DiagnosticRunners
): Promise<DomainDiagnostics> {
  const domain = input.domain.trim().toLowerCase();
  const timeoutMs = input.perCheckTimeoutMs ?? DIAGNOSTIC_CHECK_TIMEOUT_MS;
  const scoped: DiagnosticInput = { ...input, domain };

  // SPF, DMARC, DKIM and MX are independent lookups: running them in sequence would make a slow
  // resolver delay every other answer. Each is bounded individually, so one hung check cannot hold
  // the page open — it becomes NOT_CHECKED with the reason.
  const [spfResult, dmarcResult, dkimResult, mxResult] = await Promise.allSettled([
    withTimeout(runners.spf(scoped), timeoutMs, 'The SPF check'),
    withTimeout(runners.dmarc(scoped), timeoutMs, 'The DMARC check'),
    withTimeout(runners.dkim(scoped), timeoutMs, 'The DKIM check'),
    withTimeout(runners.mx(scoped), timeoutMs, 'The MX lookup'),
  ]);

  // The banner check is the slowest (it opens TCP connections) and is independent of the rest.
  const bannerPromise = input.includeSmtpBanner
    ? withTimeout(runners.smtp(scoped), timeoutMs * 2, 'The SMTP banner check')
    : null;

  const checks: DiagnosticCheck[] = [];
  const notes: string[] = [];

  // --- SPF --------------------------------------------------------------------------------------
  try {
    if (spfResult.status === 'rejected') throw spfResult.reason;
    const spf = spfResult.value;
    const status: DiagnosticStatus = spf.errors.length > 0 ? 'ERROR' : !spf.found ? 'NOT_FOUND' : 'PASS';
    checks.push({
      id: 'spf',
      label: 'SPF',
      status,
      summary:
        status === 'PASS'
          ? 'An SPF record is published and parses.'
          : status === 'NOT_FOUND'
            ? 'No SPF record is published for this domain.'
            : 'An SPF record is published but has errors.',
      detail: [
        ...(spf.record ? [spf.record] : []),
        `DNS lookups used by this record: ${spf.lookupCount} of ${spf.lookupLimit}`,
        ...spf.errors,
        ...spf.warnings,
      ],
      unavailable: false,
    });
  } catch (error) {
    checks.push(notChecked('spf', 'SPF', (error as Error).message));
  }

  // --- DMARC ------------------------------------------------------------------------------------
  try {
    if (dmarcResult.status === 'rejected') throw dmarcResult.reason;
    const dmarc = dmarcResult.value;
    const status: DiagnosticStatus =
      dmarc.status === 'VALID' ? 'PASS' : dmarc.status === 'NOT_FOUND' ? 'NOT_FOUND' : dmarc.status === 'WARNING' ? 'WARNING' : 'ERROR';
    checks.push({
      id: 'dmarc',
      label: 'DMARC',
      status,
      summary: dmarc.summary,
      detail: dmarc.facts.slice(0, 6),
      unavailable: false,
    });
  } catch (error) {
    checks.push(notChecked('dmarc', 'DMARC', (error as Error).message));
  }

  // --- DKIM -------------------------------------------------------------------------------------
  try {
    if (dkimResult.status === 'rejected') throw dkimResult.reason;
    const selectors = dkimResult.value;
    const anyValid = selectors.some((entry) => entry.status === 'VALID');
    const allNotFound = selectors.length > 0 && selectors.every((entry) => entry.status === 'NOT_FOUND');
    const status: DiagnosticStatus = anyValid ? 'PASS' : allNotFound ? 'NOT_FOUND' : selectors.length === 0 ? 'NOT_CHECKED' : 'WARNING';
    checks.push({
      id: 'dkim',
      label: 'DKIM',
      status,
      summary: anyValid
        ? `A DKIM key is published (${selectors.filter((entry) => entry.status === 'VALID').map((entry) => entry.selector).join(', ')}).`
        : allNotFound
          ? 'No DKIM key was found at the selectors that were checked.'
          : 'DKIM selectors were checked but none produced a valid key.',
      detail: selectors.map((entry) => `${entry.recordName}: ${entry.status}`),
      unavailable: false,
    });
  } catch (error) {
    checks.push(notChecked('dkim', 'DKIM', (error as Error).message));
  }

  // --- MX + PTR (one lookup answers both) ---------------------------------------------------------
  let mx: MxLookupResult | null = null;
  try {
    if (mxResult.status === 'rejected') throw mxResult.reason;
    mx = mxResult.value;
    checks.push({
      id: 'mx',
      label: 'MX',
      status: mx.records.length > 0 ? (mx.implicitMx ? 'WARNING' : 'PASS') : 'NOT_FOUND',
      summary:
        mx.records.length === 0
          ? 'No MX record is published; mail for this domain has nowhere to go.'
          : mx.implicitMx
            ? 'Only an implicit MX (the A record) is available, which is fragile for mail delivery.'
            : `${mx.records.length} mail host(s) are published.`,
      detail: mx.hosts.map((host) => `${host.host} (priority ${host.priority})${host.provider ? ` — ${host.provider}` : ''}`),
      unavailable: false,
    });
  } catch (error) {
    checks.push(notChecked('mx', 'MX', (error as Error).message));
  }

  if (mx && mx.hosts.length > 0) {
    const withReverse = mx.hosts.filter((host) => host.reverseDns.length > 0);
    const confirmed = mx.hosts.filter((host) => host.reverseConfirmed);
    const status: DiagnosticStatus =
      withReverse.length === 0 ? 'NOT_FOUND' : confirmed.length === mx.hosts.length ? 'PASS' : 'WARNING';
    checks.push({
      id: 'ptr',
      label: 'PTR (reverse DNS)',
      status,
      summary:
        withReverse.length === 0
          ? 'No reverse DNS is published for the mail hosts.'
          : confirmed.length === mx.hosts.length
            ? 'Every mail host has a matching forward and reverse DNS entry.'
            : 'Some mail hosts do not have a matching forward and reverse DNS entry.',
      detail: mx.hosts.map(
        (host) =>
          `${host.host}: ${host.reverseDns.length > 0 ? host.reverseDns.join(', ') : 'no PTR'}${host.reverseConfirmed ? ' (confirmed)' : ''}`
      ),
      unavailable: false,
    });
  } else if (!mx) {
    checks.push(notChecked('ptr', 'PTR (reverse DNS)', 'the MX lookup did not complete, so there were no hosts to check.'));
  }

  // --- SMTP banner (opt-in; opens a TCP connection) ----------------------------------------------
  if (!input.includeSmtpBanner) {
    checks.push({
      id: 'smtp_banner',
      label: 'SMTP banner',
      status: 'NOT_CHECKED',
      summary: 'Not requested. The banner check opens a TCP connection to the mail host.',
      detail: [],
      unavailable: false,
    });
  } else {
    try {
      const smtp = await bannerPromise!;
      const contacted = smtp.servers.filter((server) => server.connected);
      if (contacted.length === 0) {
        checks.push({
          id: 'smtp_banner',
          label: 'SMTP banner',
          status: 'NOT_CHECKED',
          summary:
            'No mail host accepted a connection from this platform. Outbound port 25 is blocked on most hosting networks, so this does not prove the mail server is down.',
          detail: smtp.servers.flatMap((server) => server.errors),
          unavailable: true,
        });
      } else {
        const anyGreeting = contacted.some((server) => server.greeting.code !== null);
        checks.push({
          id: 'smtp_banner',
          label: 'SMTP banner',
          status: anyGreeting ? 'PASS' : 'WARNING',
          summary: anyGreeting
            ? 'A mail host answered with a greeting and announced its capabilities.'
            : 'A mail host accepted the connection but did not send a usable greeting.',
          detail: contacted.map(
            (server) =>
              `${server.host}: ${server.greeting.code ?? '—'} ${server.greeting.text ?? ''}${server.ehlo.banner ? ` / EHLO: ${server.ehlo.banner}` : ''}`.trim()
          ),
          unavailable: false,
        });
      }
    } catch (error) {
      checks.push(notChecked('smtp_banner', 'SMTP banner', (error as Error).message));
    }
  }

  if (mx?.warnings?.length) notes.push(...mx.warnings);
  notes.push('A NOT_CHECKED result means the check did not run. It is never displayed as a pass.');

  return { domain, checks, notes, caveat: CAVEAT };
}
