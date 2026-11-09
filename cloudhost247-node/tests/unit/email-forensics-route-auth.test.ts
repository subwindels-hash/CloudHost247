/**
 * Unit tests for route reconstruction and authentication analysis.
 */
import { describe, expect, it } from 'vitest';
import { reconstructRoute } from '../../src/email-forensics/route-reconstruction';
import {
  buildAuthResults,
  parseReportedSpf,
  parseReportedDkim,
  parseReportedDmarc,
} from '../../src/email-forensics/auth-analysis';

describe('reconstructRoute', () => {
  it('reconstructs hops from Received headers', () => {
    const received = [
      'from mail1.example.com ([198.51.100.1]) by mx.example.com with ESMTP; Tue, 15 Sep 2026 14:30:00 +0000',
      'from mail2.example.com ([203.0.113.5]) by mail1.example.com; Tue, 15 Sep 2026 14:25:00 +0000',
    ];
    const { hops, chronological } = reconstructRoute(received);
    expect(hops.length).toBe(2);
    expect(hops[0].hopNumber).toBe(1);
    expect(hops[0].hostname).toBe('mx.example.com');
    expect(hops[0].ipAddress).toBe('198.51.100.1');
    expect(hops[0].trustClassification).toBe('verified_receiving_server');
    expect(hops[1].hopNumber).toBe(2);
    expect(hops[1].hostname).toBe('mail1.example.com');
    expect(chronological).toBe(true);
  });

  it('flags missing timestamps', () => {
    const received = ['from mail.example.com ([198.51.100.1]) by mx.example.com;'];
    const { hops, anomalies } = reconstructRoute(received);
    expect(hops[0].receivedTimestamp).toBeNull();
    expect(anomalies.some((a) => a.flag === 'missing_timestamp')).toBe(true);
  });

  it('flags contradictory timestamps without correcting them', () => {
    const received = [
      'from mx.example.com ([198.51.100.1]) by receiver.example.com; Tue, 15 Sep 2026 14:30:00 +0000',
      'from mail.example.com ([203.0.113.5]) by mx.example.com; Wed, 16 Sep 2026 10:00:00 +0000',
    ];
    const { chronological, anomalies } = reconstructRoute(received);
    expect(chronological).toBe(false);
    expect(anomalies.some((a) => a.flag === 'contradictory_timestamp')).toBe(true);
  });

  it('handles empty Received list', () => {
    const { hops } = reconstructRoute([]);
    expect(hops.length).toBe(0);
  });
});

describe('parseReportedSpf', () => {
  it('parses SPF pass', () => {
    const result = parseReportedSpf(
      'spf=pass smtp.mailfrom=sender@example.com',
      null,
    );
    expect(result.reportedResult).toBe('pass');
    expect(result.sendingDomain).toBe('sender@example.com');
  });

  it('parses SPF fail', () => {
    const result = parseReportedSpf('spf=fail', null);
    expect(result.reportedResult).toBe('fail');
  });

  it('returns null when no SPF info', () => {
    const result = parseReportedSpf(null, null);
    expect(result.reportedResult).toBeNull();
  });
});

describe('parseReportedDkim', () => {
  it('parses DKIM pass with domain and selector', () => {
    const result = parseReportedDkim(
      'dkim=pass header.d=example.com header.s=selector1',
      'v=1; a=rsa-sha256; d=example.com; s=selector1;',
    );
    expect(result.reportedResult).toBe('pass');
    expect(result.signingDomain).toBe('example.com');
    expect(result.selector).toBe('selector1');
  });

  it('marks present-not-verified when signature exists but no result', () => {
    const result = parseReportedDkim(null, 'v=1; d=example.com;');
    expect(result.reportedResult).toBe('present_not_verified');
  });

  it('returns missing when no signature and no result', () => {
    const result = parseReportedDkim(null, null);
    expect(result.reportedResult).toBe('missing');
  });
});

describe('parseReportedDmarc', () => {
  it('parses DMARC pass', () => {
    const result = parseReportedDmarc('dmarc=pass header.from=example.com');
    expect(result.reportedResult).toBe('pass');
  });

  it('parses DMARC fail', () => {
    const result = parseReportedDmarc('dmarc=fail');
    expect(result.reportedResult).toBe('fail');
  });
});

describe('buildAuthResults', () => {
  it('builds all auth result types', () => {
    const results = buildAuthResults({
      authenticationResults: 'spf=pass dkim=pass dmarc=pass',
      receivedSpf: 'pass',
      dkimSignature: 'v=1; d=example.com; s=s1;',
      from: 'sender@example.com',
      replyTo: 'sender@example.com',
      messageId: '<abc@example.com>',
    });
    const types = results.map((r) => r.authenticationType);
    expect(types).toContain('spf');
    expect(types).toContain('dkim');
    expect(types).toContain('dmarc');
    expect(types).toContain('return_path');
    expect(types).toContain('reply_to');
    expect(types).toContain('message_id');
  });

  it('flags From/Reply-To mismatch', () => {
    const results = buildAuthResults({
      authenticationResults: '',
      receivedSpf: null,
      dkimSignature: null,
      from: 'sender@example.com',
      replyTo: 'different@example.com',
      messageId: null,
    });
    const replyTo = results.find((r) => r.authenticationType === 'reply_to');
    expect(replyTo!.reportedResult).toBe('fail');
  });
});
