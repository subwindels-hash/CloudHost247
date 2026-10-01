import { describe, expect, it } from 'vitest';
import {
  extensionOf,
  isValidDomainName,
  isValidExtension,
  normalizeDomainName,
  parseDomainQuery,
  registrableLabelOf,
} from '../../src/domain-services/domain-name';

/**
 * Guards the domain-name grammar every Domain Services endpoint depends on. A previous version
 * of DOMAIN_PATTERN embedded an anchored label regex inside a larger expression, which made
 * every multi-label domain (e.g. `example.com`) invalid — search, quote, registration, transfer,
 * WHOIS, appraisal and auctions all rejected legitimate input. These tests pin the fix.
 */
describe('domain-name grammar', () => {
  it('accepts syntactically valid registrable domains', () => {
    for (const valid of ['example.com', 'example.co.uk', 'a.io', 'my-brand.example', 'xn--nxasmq6b.example', '9numbers.example']) {
      expect(isValidDomainName(valid), valid).toBe(true);
    }
  });

  it('rejects invalid domains with clear rules', () => {
    for (const invalid of [
      '-bad.com',           // leading hyphen
      'bad-.com',           // trailing hyphen
      'exa mple.com',       // whitespace
      'example..com',       // empty label
      'exa_mple.com',       // underscore is not a DNS label char
      'exam%20ple.com',     // URL-encoded characters are not label characters
    ]) {
      expect(isValidDomainName(invalid), invalid).toBe(false);
    }
  });

  it('normalizes case and trailing dots before validating', () => {
    expect(normalizeDomainName('  EXAMPLE.com. ')).toBe('example.com');
    expect(isValidDomainName('EXAMPLE.COM')).toBe(true);
    expect(isValidDomainName('example.com.')).toBe(true);
  });

  it('parses an explicit domain query versus a bare term', () => {
    expect(parseDomainQuery('example.com')).toEqual({ domainName: 'example.com', term: null });
    expect(parseDomainQuery('mybrand')).toEqual({ domainName: null, term: 'mybrand' });
    const rejected = parseDomainQuery('not a domain!');
    expect(rejected.domainName).toBeNull();
    expect(rejected.term).toBeNull();
    expect(rejected.error).toBeTruthy();
  });

  it('extracts extension (last label) and registrable label', () => {
    expect(extensionOf('example.com')).toBe('.com');
    expect(extensionOf('example.co.uk')).toBe('.uk'); // the public-suffix nuance is handled by the catalogue, not the parser
    expect(registrableLabelOf('example.com')).toBe('example');
    expect(registrableLabelOf('example.co.uk')).toBe('example.co');
  });

  it('validates extensions independently of domains', () => {
    expect(isValidExtension('com')).toBe(true);
    expect(isValidExtension('.com')).toBe(true);
    expect(isValidExtension('xn--p1ai')).toBe(true);
    expect(isValidExtension('')).toBe(false);
    expect(isValidExtension('bad_extension')).toBe(false);
  });
});
