/**
 * Unit tests for the email header parser.
 */
import { describe, expect, it } from 'vitest';
import { parseEmail, findIpCandidatesInValue } from '../../src/email-forensics/parser';

describe('parseEmail', () => {
  it('parses basic headers', () => {
    const email = `From: sender@example.com
To: recipient@example.com
Subject: Hello
Date: Tue, 15 Sep 2026 14:30:00 +0000
Message-ID: <abc123@example.com>

body here`;
    const parsed = parseEmail(email);
    expect(parsed.from).toBe('sender@example.com');
    expect(parsed.to).toBe('recipient@example.com');
    expect(parsed.subject).toBe('Hello');
    expect(parsed.messageId).toBe('<abc123@example.com>');
    expect(parsed.folded).toBe(false);
  });

  it('handles folded headers', () => {
    const email = `From: sender@example.com
Subject: This is a
	continued subject line
Date: Tue, 15 Sep 2026 14:30:00 +0000`;
    const parsed = parseEmail(email);
    expect(parsed.folded).toBe(true);
    expect(parsed.subject).toBe('This is a continued subject line');
  });

  it('handles multiple Received headers', () => {
    const email = `Received: from mail1.example.com ([198.51.100.1]) by mx.example.com; Tue, 15 Sep 2026 14:30:00 +0000
Received: from mail2.example.com ([203.0.113.5]) by mail1.example.com; Tue, 15 Sep 2026 14:25:00 +0000
From: sender@example.com`;
    const parsed = parseEmail(email);
    expect(parsed.received.length).toBe(2);
  });

  it('parses authentication headers', () => {
    const email = `Authentication-Results: spf=pass smtp.mailfrom=sender@example.com; dkim=pass header.d=example.com; dmarc=pass header.from=example.com
Received-SPF: pass
DKIM-Signature: v=1; a=rsa-sha256; d=example.com; s=selector1;
From: sender@example.com`;
    const parsed = parseEmail(email);
    expect(parsed.authenticationResults).toContain('spf=pass');
    expect(parsed.receivedSpf).toBe('pass');
    expect(parsed.dkimSignature).toContain('v=1');
  });

  it('parses X-Originating-IP', () => {
    const email = `X-Originating-IP: [203.0.113.10]
From: sender@example.com`;
    const parsed = parseEmail(email);
    expect(parsed.xOriginatingIp).toBe('[203.0.113.10]');
  });

  it('captures X-* headers', () => {
    const email = `X-Custom-Header: value1
X-Another: value2
From: sender@example.com`;
    const parsed = parseEmail(email);
    expect(parsed.xHeaders['x-custom-header']).toEqual(['value1']);
    expect(parsed.xHeaders['x-another']).toEqual(['value2']);
  });

  it('rejects empty input', () => {
    expect(() => parseEmail('')).toThrow();
    expect(() => parseEmail('   ')).toThrow();
  });

  it('rejects oversized input', () => {
    const big = 'A'.repeat(3_000_000);
    expect(() => parseEmail(big)).toThrow();
  });
});

describe('findIpCandidatesInValue', () => {
  it('finds IPv4 addresses', () => {
    const result = findIpCandidatesInValue('from mail.example.com ([198.51.100.1])');
    expect(result.length).toBe(1);
    expect(result[0].ip).toBe('198.51.100.1');
  });

  it('finds IPv6 addresses', () => {
    const result = findIpCandidatesInValue('from [2001:db8::1]');
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.some((r) => r.ip === '2001:db8::1')).toBe(true);
  });

  it('handles bracketed and unbracketed IPs', () => {
    const result = findIpCandidatesInValue('by mx with [203.0.113.5] and 198.51.100.1');
    expect(result.length).toBe(2);
  });

  it('returns empty for no IPs', () => {
    const result = findIpCandidatesInValue('from mail.example.com');
    expect(result.length).toBe(0);
  });
});
