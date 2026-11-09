/**
 * Unit tests for IP classification and extraction.
 */
import { describe, expect, it } from 'vitest';
import {
  classifyAddress, classifyAddresses, ipVersion, validateIp,
  type AddressClass,
} from '../../src/email-forensics/ip-classification';
import { extractIpCandidates, summarizeOriginIp } from '../../src/email-forensics/ip-extraction';

describe('classifyAddress', () => {
  const cases: Array<[string, AddressClass]> = [
    ['10.0.0.1', 'private'],
    ['172.16.0.1', 'private'],
    ['192.168.1.1', 'private'],
    ['127.0.0.1', 'loopback'],
    ['169.254.0.1', 'reserved'],
    ['0.0.0.0', 'reserved'],
    ['224.0.0.1', 'multicast'],
    ['240.0.0.1', 'reserved'],
    ['8.8.8.8', 'public'],
    ['198.51.100.1', 'reserved'],
    ['2001:db8::1', 'reserved'],
    ['::1', 'loopback'],
    ['fe80::1', 'reserved'],
    ['fc00::1', 'private'],
    ['ff02::1', 'multicast'],
    ['2001:4860:4860::8888', 'public'],
    ['not-an-ip', 'unavailable'],
    ['', 'unavailable'],
  ];

  it.each(cases)('classifies %s as %s', (ip, expected) => {
    expect(classifyAddress(ip)).toBe(expected);
  });

  it('returns correct ip version', () => {
    expect(ipVersion('10.0.0.1')).toBe('ipv4');
    expect(ipVersion('2001:db8::1')).toBe('ipv6');
    expect(ipVersion('not-an-ip')).toBeNull();
  });

  it('validates IPs', () => {
    expect(validateIp('10.0.0.1')).toBe('10.0.0.1');
    expect(validateIp('not-an-ip')).toBeNull();
  });

  it('classifies many addresses', () => {
    const result = classifyAddresses(['10.0.0.1', '8.8.8.8', '::1']);
    expect(result['10.0.0.1']).toBe('private');
    expect(result['8.8.8.8']).toBe('public');
    expect(result['::1']).toBe('loopback');
  });
});

describe('extractIpCandidates', () => {
  it('extracts IPs from Received headers with hop numbers', () => {
    const parsed = {
      received: [
        'from mx.example.com ([8.8.8.8]) by receiver.example.com; Tue, 15 Sep 2026 14:30:00 +0000',
        'from mail.example.com ([1.2.3.4]) by mx.example.com; Tue, 15 Sep 2026 14:25:00 +0000',
      ],
      xOriginatingIp: null,
    };
    const candidates = extractIpCandidates(parsed);
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    // hop 1 is the topmost Received (closest to receiver)
    const hop1 = candidates.find((c) => c.hopNumber === 1 && c.ipAddress === '8.8.8.8');
    expect(hop1).toBeDefined();
    expect(hop1!.addressClass).toBe('public');
    expect(hop1!.trustClassification).toBe('trusted_receiving_server');
    expect(hop1!.confidenceLevel).toBe('high');
  });

  it('extracts X-Originating-IP as unverified upstream', () => {
    const parsed = {
      received: [],
      xOriginatingIp: '8.8.8.8',
    };
    const candidates = extractIpCandidates(parsed);
    const xip = candidates.find((c) => c.sourceHeader === 'X-Originating-IP');
    expect(xip).toBeDefined();
    expect(xip!.trustClassification).toBe('unverified_upstream');
  });

  it('classifies private IPs as private_internal', () => {
    const parsed = {
      received: ['from internal ([10.0.0.1]) by mx.example.com; Tue, 15 Sep 2026 14:30:00 +0000'],
      xOriginatingIp: null,
    };
    const candidates = extractIpCandidates(parsed);
    const priv = candidates.find((c) => c.ipAddress === '10.0.0.1');
    expect(priv).toBeDefined();
    expect(priv!.addressClass).toBe('private');
    expect(priv!.trustClassification).toBe('private_internal');
  });

  it('reports origin IP unavailable when no public IP exists', () => {
    const parsed = {
      received: ['from internal ([10.0.0.1]) by mx.example.com; Tue, 15 Sep 2026 14:30:00 +0000'],
      xOriginatingIp: null,
    };
    const candidates = extractIpCandidates(parsed);
    const summary = summarizeOriginIp(candidates);
    expect(summary.originIpAvailable).toBe(false);
    expect(summary.originIpMessage).toBe(
      'Original sender IP not available in the supplied headers.',
    );
  });
});
