/**
 * Domain diagnostics composition.
 *
 * The runners are fakes, so these tests say nothing about real DNS. What they pin down is the
 * vocabulary discipline: a check that fails to run must appear as NOT_CHECKED (never disappear,
 * never become PASS), a missing record is NOT_FOUND rather than a soft success, and the response can
 * never be read as a statement about whether a message was delivered.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_DKIM_SELECTORS,
  diagnoseDomain,
  type DiagnosticCheck,
  type DiagnosticRunners,
  type DiagnosticStatus,
} from '../../src/email-trace/diagnostics';
import type { MxLookupResult } from '../../src/tools/dns/lookup';
import type { SmtpTestResult } from '../../src/tools/developer/smtp';

const VALID_STATUSES: DiagnosticStatus[] = ['PASS', 'WARNING', 'ERROR', 'NOT_FOUND', 'NOT_CHECKED', 'UNKNOWN'];

function mxResult(overrides: Partial<MxLookupResult> = {}): MxLookupResult {
  return {
    domain: 'alpha.example',
    records: [{ host: 'mx1.alpha.example', priority: 10, ttl: 300 }],
    hosts: [
      {
        host: 'mx1.alpha.example',
        priority: 10,
        addresses: { v4: ['192.0.2.10'], v6: [] },
        reverseDns: ['mx1.alpha.example'],
        reverseConfirmed: true,
        reachable: { port25: null, detail: 'not requested' },
        provider: null,
      },
    ],
    implicitMx: false,
    resolver: { id: 'r1', name: 'test', provider: 'test', ip: '192.0.2.53', protocol: 'udp', country: null },
    explanation: 'Lowest preference first.',
    warnings: [],
    ...overrides,
  };
}

function smtpResult(overrides: Partial<SmtpTestResult> = {}): SmtpTestResult {
  return {
    domain: 'alpha.example',
    mxRecords: [{ host: 'mx1.alpha.example', preference: 10 }],
    servers: [
      {
        host: 'mx1.alpha.example',
        preference: 10,
        address: '192.0.2.10',
        connected: true,
        connectMs: 12,
        greeting: { code: 220, text: 'mx1.alpha.example ESMTP ready' },
        ehlo: { code: 250, banner: 'mx1.alpha.example', capabilities: { STARTTLS: '', SIZE: '10240000' } },
        starttls: {
          advertised: true,
          negotiated: true,
          protocol: 'TLSv1.3',
          cipher: 'TLS_AES_256_GCM_SHA384',
          certificate: { subject: 'mx1.alpha.example', issuer: 'Test CA', validTo: '2027-01-01', authorized: true },
          detail: 'negotiated',
        },
        auth: { advertised: false, mechanisms: [] },
        sizeLimit: 10_240_000,
        recipientCheck: null,
        errors: [],
        durationMs: 40,
      },
    ],
    summary: '1 host tested.',
    assessment: { deliverable: true, starttlsCoverage: '1 of 1', detail: 'greeting received' },
    capability: { status: 'AVAILABLE', detail: 'ok' },
    recommendations: [],
    notes: [],
    durationMs: 55,
    ...overrides,
  };
}

function runners(overrides: Partial<DiagnosticRunners> = {}): DiagnosticRunners {
  return {
    spf: async () => ({
      found: true,
      record: 'v=spf1 include:_spf.alpha.example -all',
      errors: [],
      warnings: [],
      lookupCount: 1,
      lookupLimit: 10,
    }),
    dmarc: async () => ({ status: 'VALID', summary: 'DMARC policy published.', facts: ['p=quarantine'] }),
    dkim: async () => [{ selector: 'default', status: 'VALID', recordName: 'default._domainkey.alpha.example' }],
    mx: async () => mxResult(),
    smtp: async () => smtpResult(),
    ...overrides,
  };
}

function byId(checks: DiagnosticCheck[], id: string) {
  const check = checks.find((entry) => entry.id === id);
  if (!check) throw new Error(`missing check ${id}`);
  return check;
}

describe('diagnoseDomain', () => {
  it('reports every configured check when everything is published', async () => {
    const result = await diagnoseDomain({ domain: 'Alpha.Example' }, runners());
    expect(result.domain).toBe('alpha.example');
    // Every configured check appears, including the ones that could not run.
    expect(result.checks.map((check) => check.id).sort()).toEqual(
      ['dkim', 'dmarc', 'mx', 'ptr', 'smtp_banner', 'spf'].sort()
    );
    expect(byId(result.checks, 'spf').status).toBe('PASS');
    expect(byId(result.checks, 'dmarc').status).toBe('PASS');
    expect(byId(result.checks, 'dkim').status).toBe('PASS');
    expect(byId(result.checks, 'mx').status).toBe('PASS');
    expect(byId(result.checks, 'ptr').status).toBe('PASS');
    // Banner reading is opt-in: not requesting it is not a failure and not a pass.
    expect(byId(result.checks, 'smtp_banner')).toMatchObject({ status: 'NOT_CHECKED', unavailable: false });
  });

  it('distinguishes a missing record from an invalid one', async () => {
    const missing = await diagnoseDomain(
      { domain: 'alpha.example' },
      runners({
        spf: async () => ({ found: false, record: null, errors: [], warnings: [], lookupCount: 0, lookupLimit: 10 }),
        dmarc: async () => ({ status: 'NOT_FOUND', summary: 'No DMARC record.', facts: [] }),
      })
    );
    expect(byId(missing.checks, 'spf').status).toBe('NOT_FOUND');
    expect(byId(missing.checks, 'dmarc').status).toBe('NOT_FOUND');

    const invalid = await diagnoseDomain(
      { domain: 'alpha.example' },
      runners({
        spf: async () => ({
          found: true,
          record: 'v=spf1 -all -all',
          errors: ['Multiple all mechanisms'],
          warnings: [],
          lookupCount: 0,
          lookupLimit: 10,
        }),
      })
    );
    expect(byId(invalid.checks, 'spf').status).toBe('ERROR');
    expect(byId(invalid.checks, 'spf').detail.join(' ')).toContain('Multiple all mechanisms');
  });

  it('warns on an implicit MX and on incomplete reverse DNS instead of passing them', async () => {
    const result = await diagnoseDomain(
      { domain: 'alpha.example' },
      runners({
        mx: async () =>
          mxResult({
            implicitMx: true,
            hosts: [
              {
                host: 'alpha.example',
                priority: 0,
                addresses: { v4: ['192.0.2.11'], v6: [] },
                reverseDns: [],
                reverseConfirmed: false,
                reachable: { port25: null, detail: 'not requested' },
                provider: null,
              },
            ],
          }),
      })
    );
    expect(byId(result.checks, 'mx').status).toBe('WARNING');
    expect(byId(result.checks, 'ptr').status).toBe('NOT_FOUND');
  });

  it('keeps a failing check in the list as NOT_CHECKED rather than dropping it', async () => {
    const result = await diagnoseDomain(
      { domain: 'alpha.example' },
      runners({
        spf: async () => {
          throw new Error('resolver unreachable');
        },
        dkim: async () => {
          throw new Error('resolver timeout');
        },
      })
    );

    expect(result.checks).toHaveLength(6);
    expect(byId(result.checks, 'spf')).toMatchObject({ status: 'NOT_CHECKED', unavailable: true });
    expect(byId(result.checks, 'spf').summary).toContain('resolver unreachable');
    expect(byId(result.checks, 'dkim').status).toBe('NOT_CHECKED');
    // The checks that did run are unaffected.
    expect(byId(result.checks, 'dmarc').status).toBe('PASS');
    expect(result.checks.every((check) => VALID_STATUSES.includes(check.status))).toBe(true);
  });

  it('does not check PTR when the MX lookup itself failed', async () => {
    const result = await diagnoseDomain(
      { domain: 'alpha.example' },
      runners({
        mx: async () => {
          throw new Error('SERVFAIL');
        },
      })
    );
    expect(byId(result.checks, 'mx').status).toBe('NOT_CHECKED');
    expect(byId(result.checks, 'ptr')).toMatchObject({ status: 'NOT_CHECKED', unavailable: true });
    expect(byId(result.checks, 'ptr').summary).toContain('no hosts to check');
  });

  it('reads the SMTP banner only when asked, and reports an unreachable host honestly', async () => {
    const banner = await diagnoseDomain({ domain: 'alpha.example', includeSmtpBanner: true }, runners());
    expect(byId(banner.checks, 'smtp_banner').status).toBe('PASS');
    expect(byId(banner.checks, 'smtp_banner').detail.join(' ')).toContain('220');

    const blocked = await diagnoseDomain(
      { domain: 'alpha.example', includeSmtpBanner: true },
      runners({
        smtp: async () =>
          smtpResult({
            servers: [
              {
                ...smtpResult().servers[0]!,
                connected: false,
                greeting: { code: null, text: null },
                ehlo: { code: null, banner: null, capabilities: {} },
                errors: ['connect ECONNREFUSED'],
              },
            ],
          }),
      })
    );
    expect(byId(blocked.checks, 'smtp_banner')).toMatchObject({ status: 'NOT_CHECKED', unavailable: true });
    expect(byId(blocked.checks, 'smtp_banner').summary).toContain('does not prove the mail server is down');
  });

  it('marks every checked selector when no DKIM key is published', async () => {
    const result = await diagnoseDomain(
      { domain: 'alpha.example' },
      runners({
        dkim: async () =>
          DEFAULT_DKIM_SELECTORS.map((selector) => ({
            selector,
            status: 'NOT_FOUND' as const,
            recordName: `${selector}._domainkey.alpha.example`,
          })),
      })
    );
    expect(byId(result.checks, 'dkim').status).toBe('NOT_FOUND');
    expect(byId(result.checks, 'dkim').detail).toHaveLength(DEFAULT_DKIM_SELECTORS.length);
  });

  it('never presents the result as evidence about a specific message', async () => {
    const result = await diagnoseDomain({ domain: 'alpha.example' }, runners());
    const text = [result.caveat, ...result.notes, ...result.checks.map((check) => check.summary)].join(' ');

    expect(result.caveat).toContain('cannot say whether any individual message was delivered');
    expect(result.caveat.toLowerCase()).toContain('filtered or read');
    expect(text.toLowerCase()).not.toContain('delivered successfully');
    expect(text.toLowerCase()).not.toContain('inbox');
    expect(result.notes.join(' ')).toContain('NOT_CHECKED result means the check did not run');
  });

  it('reports a hung check as NOT_CHECKED after the per-check ceiling instead of hanging', async () => {
    const result = await diagnoseDomain(
      { domain: 'alpha.example', perCheckTimeoutMs: 20 },
      runners({
        spf: () => new Promise(() => {}),
        dmarc: () => new Promise(() => {}),
      })
    );

    expect(result.checks).toHaveLength(6);
    expect(byId(result.checks, 'spf')).toMatchObject({ status: 'NOT_CHECKED', unavailable: true });
    expect(byId(result.checks, 'spf').summary).toContain('did not complete within');
    expect(byId(result.checks, 'dmarc').status).toBe('NOT_CHECKED');
    // Independent checks still answer.
    expect(byId(result.checks, 'mx').status).toBe('PASS');
  });

  it('runs the independent lookups concurrently rather than one after another', async () => {
    let started = 0;
    let peak = 0;
    const slow = <T,>(value: T) => async () => {
      started += 1;
      peak = Math.max(peak, started);
      await new Promise((resolve) => setTimeout(resolve, 10));
      started -= 1;
      return value;
    };

    await diagnoseDomain(
      { domain: 'alpha.example' },
      runners({
        spf: slow({
          found: true,
          record: 'v=spf1 -all',
          errors: [],
          warnings: [],
          lookupCount: 0,
          lookupLimit: 10,
        }),
        dmarc: slow({ status: 'VALID' as const, summary: 'ok', facts: [] }),
        dkim: slow([{ selector: 'default', status: 'VALID' as const, recordName: 'default._domainkey.alpha.example' }]),
        mx: slow(mxResult()),
      })
    );

    expect(peak).toBeGreaterThan(1);
  });

  it('uses the default selector set when none is supplied', async () => {
    const dkim = vi.fn(async () => [{ selector: 'default', status: 'VALID' as const, recordName: 'default._domainkey.alpha.example' }]);
    await diagnoseDomain({ domain: 'alpha.example' }, runners({ dkim }));
    expect(DEFAULT_DKIM_SELECTORS).toEqual(['default', 'google', 'selector1']);
    expect(dkim).toHaveBeenCalledTimes(1);
  });
});
