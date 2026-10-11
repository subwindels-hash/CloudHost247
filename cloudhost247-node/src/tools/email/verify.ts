/**
 * Email address verification, limited to what DNS can establish.
 *
 * What this checks:
 *   - syntax of the address (RFC 5321/5322 dot-atom form; quoted local parts are reported as
 *     unsupported rather than guessed at);
 *   - that the domain publishes mail routing (MX, null MX, or the RFC 5321 implicit A/AAAA fallback);
 *   - whether the mail hosts resolve to addresses.
 *
 * What it does NOT check: whether the mailbox exists. That needs an SMTP conversation with the
 * recipient's server (RCPT TO probing). Many providers block it, it is unreliable, and it can be
 * used to harvest addresses, so this tool does not do it and says so in every result.
 */
import { DOMAIN_PATTERN } from '../dns/common';

export interface EmailSyntaxResult {
  ok: boolean;
  localPart: string;
  domain: string;
  reason: string | null;
}

const ATEXT = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+$/;

export function validateEmailSyntax(raw: string): EmailSyntaxResult {
  const email = raw.trim();
  const fail = (reason: string): EmailSyntaxResult => ({ ok: false, localPart: '', domain: '', reason });
  if (email.length === 0) return fail('The address is empty.');
  if (email.length > 254) return fail('The address is longer than 254 characters (RFC 5321 limit).');
  if (/\s/.test(email)) return fail('The address contains a space or other whitespace.');
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return fail('The address must contain one @ with text on both sides.');
  const localPart = email.slice(0, at);
  const domainPart = email.slice(at + 1);
  if (localPart.includes('@')) return fail('The address contains more than one @.');
  if (localPart.startsWith('"') || localPart.endsWith('"')) {
    return fail('Quoted local parts (for example "a b"@example.com) are not supported by this check.');
  }
  if (localPart.length > 64) return fail('The part before @ is longer than 64 characters (RFC 5321 limit).');
  if (localPart.split('.').some((label) => label.length === 0)) {
    return fail('The part before @ has a leading, trailing or doubled dot.');
  }
  if (!localPart.split('.').every((label) => ATEXT.test(label))) {
    return fail('The part before @ contains a character that is not allowed in an address.');
  }
  if (/[^\x00-\x7f]/.test(domainPart)) {
    return fail('The domain uses non-ASCII characters. Convert it to punycode first (the Punycode tool does this).');
  }
  // Check the pattern directly: normalizeDomain throws for invalid names, and a syntax check must
  // return a reason rather than raise an input error.
  const domain = domainPart.toLowerCase();
  if (!DOMAIN_PATTERN.test(domain)) return fail('The domain after @ is not a valid public hostname (it needs at least one dot and a valid top-level label).');
  return { ok: true, localPart, domain, reason: null };
}

export type EmailRoutingVerdict = 'ACCEPTS_MAIL' | 'IMPLICIT_MX_ONLY' | 'NULL_MX' | 'MX_UNRESOLVABLE' | 'NO_MAIL_HOST';

export interface EmailRoutingClassification {
  verdict: EmailRoutingVerdict;
  explanation: string;
}

/**
 * Classifies the routing answer from the MX lookup. `hosts` carry resolved addresses, so a domain
 * whose MX names do not resolve is reported as such rather than as a working mail route.
 */
export function classifyEmailRouting(input: {
  records: Array<{ host: string; priority: number }>;
  implicitMx: boolean;
  hosts: Array<{ addresses: { v4: string[]; v6: string[] } }>;
}): EmailRoutingClassification {
  const { records, implicitMx, hosts } = input;
  if (records.length === 1 && !implicitMx && (records[0]!.host === '' || records[0]!.host === '.')) {
    return {
      verdict: 'NULL_MX',
      explanation: 'The domain publishes a null MX record (RFC 7505), which states that it does not accept email.',
    };
  }
  if (records.length === 0) {
    return {
      verdict: 'NO_MAIL_HOST',
      explanation: 'No MX record and no address record were found, so this domain cannot receive mail.',
    };
  }
  const anyResolved = hosts.some((host) => host.addresses.v4.length > 0 || host.addresses.v6.length > 0);
  if (!anyResolved) {
    return {
      verdict: 'MX_UNRESOLVABLE',
      explanation: 'The domain publishes MX records, but none of the mail host names resolve to an address.',
    };
  }
  if (implicitMx) {
    return {
      verdict: 'IMPLICIT_MX_ONLY',
      explanation: 'No MX records are published. RFC 5321 delivers mail to the address record instead, but most providers treat that as a misconfiguration.',
    };
  }
  return {
    verdict: 'ACCEPTS_MAIL',
    explanation: 'The domain publishes MX records whose hosts resolve, so mail for this domain can be routed to it. The mailbox itself was not checked.',
  };
}

export const MAILBOX_NOT_VERIFIED =
  'Mailbox existence was not verified. This tool checks syntax and DNS routing only; it does not contact the recipient mail server.';
