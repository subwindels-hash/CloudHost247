/**
 * Email Verifier: syntax rules, routing verdicts, and the handler contract. Expected results were
 * written from RFC 5321/5322 and RFC 7505 (null MX), not from the implementation.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { classifyEmailRouting, validateEmailSyntax, MAILBOX_NOT_VERIFIED } from '../../src/tools/email/verify';
import { handlerFor } from '../../src/tools/handlers';

vi.mock('../../src/tools/dns/lookup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/tools/dns/lookup')>();
  return { ...actual, mxLookup: vi.fn() };
});

const ctx = { db: {} } as never;
const resolved = { v4: ['203.0.113.25'], v6: [] };

describe('email syntax', () => {
  it.each(['name@example.com', 'first.last+tag@sub.example.co.ng', "o'brien@example.org", 'a@b.co'])('accepts %s', (email) => {
    const result = validateEmailSyntax(email);
    expect(result.ok).toBe(true);
    expect(result.reason).toBeNull();
  });

  it('splits the local part and the normalised domain', () => {
    const result = validateEmailSyntax('  Name@Example.COM ');
    expect(result).toMatchObject({ ok: true, localPart: 'Name', domain: 'example.com' });
  });

  it.each([
    ['', 'empty'],
    ['no-at-sign', '@'],
    ['a@', 'text on both sides'],
    ['@b.com', 'text on both sides'],
    ['a@@b.com', 'more than one @'],
    ['a..b@c.com', 'doubled dot'],
    ['.a@b.com', 'doubled dot'],
    ['a.@b.com', 'doubled dot'],
    ['a b@c.com', 'whitespace'],
    ['"quoted"@c.com', 'Quoted local parts'],
    ['a@localhost', 'valid public hostname'],
    ['a@exa_mple.com', 'valid public hostname'],
    ['a@b\u00fccher.de', 'punycode'],
    [`${'a'.repeat(65)}@x.com`, '64 characters'],
    [`${'a'.repeat(250)}@x.com`, '254 characters'],
    ['a(b)@c.com', 'not allowed'],
  ])('rejects %j', (email, message) => {
    const result = validateEmailSyntax(email);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain(message);
  });
});

describe('routing classification', () => {
  it('accepts mail when MX hosts resolve', () => {
    expect(classifyEmailRouting({ records: [{ host: 'mx.example.com', priority: 10 }], implicitMx: false, hosts: [{ addresses: resolved }] }).verdict).toBe('ACCEPTS_MAIL');
  });

  it('identifies a null MX (RFC 7505)', () => {
    expect(classifyEmailRouting({ records: [{ host: '.', priority: 0 }], implicitMx: false, hosts: [] }).verdict).toBe('NULL_MX');
  });

  it('identifies the implicit address fallback', () => {
    expect(classifyEmailRouting({ records: [{ host: 'example.com', priority: 0 }], implicitMx: true, hosts: [{ addresses: resolved }] }).verdict).toBe('IMPLICIT_MX_ONLY');
  });

  it('reports MX names that do not resolve rather than a working route', () => {
    expect(classifyEmailRouting({ records: [{ host: 'mx.gone.example', priority: 10 }], implicitMx: false, hosts: [{ addresses: { v4: [], v6: [] } }] }).verdict).toBe('MX_UNRESOLVABLE');
  });

  it('reports a domain with no mail routing at all', () => {
    expect(classifyEmailRouting({ records: [], implicitMx: false, hosts: [] }).verdict).toBe('NO_MAIL_HOST');
  });
});

describe('email-verifier handler', () => {
  beforeEach(async () => {
    const lookup = await import('../../src/tools/dns/lookup');
    vi.mocked(lookup.mxLookup).mockReset();
  });

  it('returns INVALID_SYNTAX without any DNS query', async () => {
    const lookup = await import('../../src/tools/dns/lookup');
    const out = (await handlerFor('email-verifier')!({ email: 'nope' }, ctx)) as { verdict: string; mailboxVerified: boolean; note: string };
    expect(out.verdict).toBe('INVALID_SYNTAX');
    expect(out.mailboxVerified).toBe(false);
    expect(out.note).toBe(MAILBOX_NOT_VERIFIED);
    expect(vi.mocked(lookup.mxLookup)).not.toHaveBeenCalled();
  });

  it('queries MX without the port-25 probe and never claims the mailbox was verified', async () => {
    const lookup = await import('../../src/tools/dns/lookup');
    vi.mocked(lookup.mxLookup).mockResolvedValue({
      domain: 'example.com',
      records: [{ host: 'mx.example.com', priority: 10, ttl: 300 }],
      hosts: [{ host: 'mx.example.com', priority: 10, addresses: resolved, reverseDns: [], reverseConfirmed: false, reachable: { port25: null, detail: '' }, provider: null }],
      implicitMx: false,
      resolver: { id: 'r1', name: 'Test' } as never,
      explanation: '',
      warnings: [],
    } as never);
    const out = (await handlerFor('email-verifier')!({ email: 'name@example.com' }, ctx)) as { verdict: string; mailboxVerified: boolean };
    expect(out.verdict).toBe('ACCEPTS_MAIL');
    expect(out.mailboxVerified).toBe(false);
    expect(vi.mocked(lookup.mxLookup).mock.calls[0]![1]).toMatchObject({ domain: 'example.com', checkPort25: false });
  });

  it('propagates a resolver failure', async () => {
    const lookup = await import('../../src/tools/dns/lookup');
    vi.mocked(lookup.mxLookup).mockRejectedValue(new Error('resolver down'));
    await expect(handlerFor('email-verifier')!({ email: 'name@example.com' }, ctx)).rejects.toThrow('resolver down');
  });
});
