import { describe, expect, it } from 'vitest';
import { diagnose, parseTarget, placeholderSignals } from '../../src/config/db-doctor';

/**
 * The doctor's value is entirely in the diagnosis it prints, and that diagnosis is the difference
 * between an operator fixing production in five minutes and opening a support ticket. These tests
 * pin the two halves that decide it: recognising the `.env.example` placeholder that production is
 * most likely still carrying, and translating each driver error into the right actionable cause.
 *
 * They are deliberately written against the message *intent* ("does this tell me about the
 * allowlist?", "does this say the password is wrong?") rather than exact prose, so the wording can
 * be improved without the tests fighting it.
 */
describe('db:doctor — reading DATABASE_URL', () => {
  it('extracts the target without needing to print the password', () => {
    const target = parseTarget('postgresql://ch247_user:s3cret-p%40ss@db.example.com:6543/cloudhost247');
    expect(target).not.toBeNull();
    expect(target).toMatchObject({
      host: 'db.example.com',
      port: '6543',
      database: 'cloudhost247',
      user: 'ch247_user',
    });
    // Kept only so it can be compared against the known placeholders — never printed by the CLI.
    expect(target?.password).toBe('s3cret-p@ss');
  });

  it('defaults the port to 5432 when the URL omits it', () => {
    expect(parseTarget('postgres://u:p@db.example.com/app')?.port).toBe('5432');
  });

  it('returns null for a value that is not a connection URL', () => {
    expect(parseTarget('not-a-url')).toBeNull();
  });
});

describe('db:doctor — placeholder detection', () => {
  it('flags the values that ship in .env.example', () => {
    const signals = placeholderSignals(parseTarget('postgresql://USER:PASSWORD@HOST:5432/DATABASE_NAME')!);
    expect(signals).toContain('password');
    expect(signals).toContain('user');
    expect(signals).toContain('database name');
  });

  it('flags an empty password', () => {
    expect(placeholderSignals(parseTarget('postgresql://ch247:strongpw@db.example.com/app')!)).toEqual([]);
    expect(placeholderSignals(parseTarget('postgresql://ch247:@db.example.com/app')!)).toContain('password (empty)');
  });

  it('stays quiet for a real-looking connection string', () => {
    const target = parseTarget('postgresql://ch247_rw:9f3a2b7c1d@db.provider.net:5432/ch247_production')!;
    expect(placeholderSignals(target)).toEqual([]);
  });
});

describe('db:doctor — error diagnosis', () => {
  const target = parseTarget('postgresql://ch247_rw:pw@db.provider.net:5432/ch247_production')!;
  const said = (err: NodeJS.ErrnoException & { code?: string }): string => diagnose(err, target).join(' ');

  it('names DNS when the host does not resolve', () => {
    const text = said(Object.assign(new Error('getaddrinfo ENOTFOUND db.provider.net'), { code: 'ENOTFOUND' }));
    expect(text).toMatch(/DNS/i);
    expect(text).toMatch(/typo/i);
  });

  it('names the firewall/allowlist when the connection times out', () => {
    const text = said(Object.assign(new Error('timeout expired'), { code: 'ETIMEDOUT' }));
    expect(text).toMatch(/timed out/i);
    expect(text).toMatch(/allowlist/i);
  });

  it('distinguishes a refused connection from a timeout', () => {
    const text = said(Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), { code: 'ECONNREFUSED' }));
    expect(text).toMatch(/Nothing is accepting connections/i);
    expect(text).not.toMatch(/allowlist/i);
  });

  it('explains a self-signed certificate instead of blaming credentials', () => {
    const text = said(Object.assign(new Error('self signed certificate in certificate chain'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' }));
    expect(text).toMatch(/certificate could not be verified/i);
    expect(text).toMatch(/DATABASE_SSL_REJECT_UNAUTHORIZED=false/);
  });

  it('tells the operator to re-read the environment when the password is rejected', () => {
    const text = said(Object.assign(new Error('password authentication failed for user "ch247_rw"'), { code: '28P01' }));
    expect(text).toMatch(/Authentication failed/i);
    expect(text).toMatch(/URL-encoded|encoding/i);
    expect(text).toMatch(/Restart the application/i);
  });

  it('names a missing database as such', () => {
    const text = said(Object.assign(new Error('database "ch247_production" does not exist'), { code: '3D000' }));
    expect(text).toMatch(/does not exist/i);
  });

  it('falls back to the driver message for an unrecognised failure', () => {
    const text = said(Object.assign(new Error('something nobody has seen before'), { code: 'XX999' }));
    expect(text).toContain('something nobody has seen before');
  });
});
