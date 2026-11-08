/**
 * Normaliser + event identity.
 *
 * These tests cover the three things that must never reach the database: an injected newline, a
 * credential, and a duplicated event. They also pin the rules for addresses (`<>` is legal, a
 * malformed recipient is refused) and for the sender (never assumed).
 */
import { describe, expect, it } from 'vitest';
import {
  normaliseEvent,
  parseAddress,
  redactSecrets,
  sanitiseFreeText,
  stripControlCharacters,
} from '../../src/email-trace/exim/normalizer';
import { buildSourceEventHash } from '../../src/email-trace/dedupe';
import type { RawEximEvent } from '../../src/email-trace/types';

const SERVER_A = '11111111-1111-4111-8111-111111111111';
const SERVER_B = '22222222-2222-4222-8222-222222222222';

function raw(overrides: Partial<RawEximEvent> = {}): RawEximEvent {
  return {
    timestamp: new Date('2026-11-08T09:14:03.456Z'),
    messageId: '1xYzAb-000123-CD',
    flag: '=>',
    eventType: 'delivery',
    sender: 'sender@example.com',
    recipient: 'recipient@example.org',
    originalRecipient: null,
    remoteHostname: 'mx.example.org',
    smtpResponseCode: 250,
    smtpResponseText: '250 2.0.0 Ok: queued as 4Wx9',
    transport: 'remote_smtp',
    router: 'dnslookup',
    reason: null,
    ...overrides,
  };
}

describe('stripControlCharacters / redactSecrets / sanitiseFreeText', () => {
  it('collapses a smuggled newline so a forged "second log line" cannot survive storage', () => {
    const injected = '250 2.0.0 Ok\r\n2026-11-08 00:00:00 1xYzAb-000999-ZZ => attacker@evil.example';
    const cleaned = stripControlCharacters(injected);
    expect(cleaned).not.toContain('\n');
    expect(cleaned.split('=>').length).toBe(2);
    expect(cleaned.startsWith('250 2.0.0 Ok 2026-11-08')).toBe(true);
  });

  it('removes Exim authenticator identities and key/value secrets', () => {
    expect(redactSecrets('A=dovecot_login:sender@example.com rejected')).toBe('A=[redacted] rejected');
    expect(redactSecrets('auth failed password=hunter2 for user')).toContain('password=[redacted]');
    expect(redactSecrets('token: abc123def456')).toBe('token=[redacted]');
    expect(redactSecrets('Authorization: Bearer abcdef123456')).toContain('Bearer [redacted]');
  });

  it('truncates to the column width with an ellipsis instead of failing the insert', () => {
    const long = 'x'.repeat(900);
    const stored = sanitiseFreeText(long, 500);
    expect(stored).not.toBeNull();
    expect(stored!.length).toBe(500);
    expect(stored!.endsWith('…')).toBe(true);
  });

  it('turns an empty or whitespace-only field into null rather than an empty string', () => {
    expect(sanitiseFreeText('   ', 100)).toBeNull();
    expect(sanitiseFreeText(null, 100)).toBeNull();
  });
});

describe('parseAddress', () => {
  it('accepts angle-bracketed, mixed-case and null reverse-path addresses', () => {
    expect(parseAddress('<Recipient@Example.ORG>')).toEqual({
      address: 'Recipient@example.org',
      domain: 'example.org',
    });
    expect(parseAddress('<>')).toEqual({ address: '<>', domain: '' });
    expect(parseAddress('blocked@example.org:')).toEqual({ address: 'blocked@example.org', domain: 'example.org' });
  });

  it('refuses anything that is not an address', () => {
    expect(parseAddress('')).toBeNull();
    expect(parseAddress('not-an-address')).toBeNull();
    expect(parseAddress('@example.org')).toBeNull();
    expect(parseAddress('user@')).toBeNull();
    expect(parseAddress('user@localhost')).toBeNull();
    expect(parseAddress('user name@example.org')).toBeNull();
  });
});

describe('normaliseEvent', () => {
  it('stores the normalised fields and a 64-character identity hash', () => {
    const result = normaliseEvent(raw(), SERVER_A);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event).toMatchObject({
      traceId: '1xYzAb-000123-CD',
      sender: 'sender@example.com',
      recipient: 'recipient@example.org',
      senderDomain: 'example.com',
      recipientDomain: 'example.org',
      eventType: 'delivery',
      deliveryStatus: 'DELIVERED',
      smtpResponseCode: 250,
      remoteHostname: 'mx.example.org',
    });
    expect(result.event.sourceEventHash).toMatch(/^[0-9a-f]{64}$/);
    // Sub-second precision is dropped so two parses of one line agree.
    expect(result.event.eventTimestamp.toISOString()).toBe('2026-11-08T09:14:03.000Z');
  });

  it('produces the same identity for the same line and a different one per server, event or recipient', () => {
    const first = normaliseEvent(raw(), SERVER_A);
    const again = normaliseEvent(raw(), SERVER_A);
    const otherServer = normaliseEvent(raw(), SERVER_B);
    const otherRecipient = normaliseEvent(raw({ recipient: 'someone@example.org' }), SERVER_A);
    if (!first.ok || !again.ok || !otherServer.ok || !otherRecipient.ok) throw new Error('normalisation failed');

    expect(again.event.sourceEventHash).toBe(first.event.sourceEventHash);
    expect(otherServer.event.sourceEventHash).not.toBe(first.event.sourceEventHash);
    expect(otherRecipient.event.sourceEventHash).not.toBe(first.event.sourceEventHash);
  });

  it('ignores free-text differences when hashing, so a retried reply is not a second event', () => {
    const short = normaliseEvent(raw({ smtpResponseText: '250 Ok' }), SERVER_A);
    const long = normaliseEvent(raw({ smtpResponseText: '250 2.0.0 Ok: queued as 4Wx9' }), SERVER_A);
    if (!short.ok || !long.ok) throw new Error('normalisation failed');
    expect(short.event.sourceEventHash).toBe(long.event.sourceEventHash);
  });

  it('refuses a recipient that is not an address', () => {
    const result = normaliseEvent(raw({ recipient: 'not-an-address' }), SERVER_A);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('recipient');
  });

  it('refuses to invent a sender for a delivery line that does not repeat one', () => {
    const withoutSender = normaliseEvent(raw({ sender: null }), SERVER_A);
    expect(withoutSender.ok).toBe(false);
    if (!withoutSender.ok) expect(withoutSender.reason).toContain('sender');

    const withFallback = normaliseEvent(raw({ sender: null }), SERVER_A, { senderFallback: 'sender@example.com' });
    expect(withFallback.ok).toBe(true);
    if (withFallback.ok) expect(withFallback.event.sender).toBe('sender@example.com');
  });

  it('keeps the null reverse-path of a bounce as `<>` with no domain', () => {
    const result = normaliseEvent(raw({ eventType: 'submission', sender: '<>' }), SERVER_A);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.sender).toBe('<>');
      expect(result.event.senderDomain).toBe('');
    }
  });

  it('cleans the SMTP text on the way in, so the stored row cannot contain a newline', () => {
    const result = normaliseEvent(raw({ smtpResponseText: '250 Ok\nforged line' }), SERVER_A);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.smtpResponseText).not.toContain('\n');
      expect(result.event.smtpResponseText).toBe('250 Ok forged line');
    }
  });
});

describe('buildSourceEventHash', () => {
  it('is order-stable and separator-safe', () => {
    const base = {
      sourceServerId: SERVER_A,
      messageId: 'a@b',
      eventType: 'delivery' as const,
      eventTimestamp: new Date('2026-11-08T09:14:03.000Z'),
      recipient: 'x@example.org',
      smtpResponseCode: 250,
    };
    expect(buildSourceEventHash(base)).toBe(buildSourceEventHash({ ...base }));
    expect(buildSourceEventHash(base)).toMatch(/^[0-9a-f]{64}$/);
    expect(buildSourceEventHash(base)).not.toBe(buildSourceEventHash({ ...base, smtpResponseCode: null }));
  });
});
