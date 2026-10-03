import { describe, expect, it } from 'vitest';
import { encodeQuery, parseMessage, TYPE_BY_NAME, isSubdomainOf, formatRecordText, encodeName } from '../../src/tools/core/dns-wire';

/** Builds a response message from a question packet plus hand-written answer records. */
function buildResponse(query: Buffer, answers: Array<{ type: number; ttl: number; rdata: Buffer; namePointer?: number }>): Buffer {
  const header = Buffer.alloc(12);
  query.copy(header, 0, 0, 2); // reuse the query id
  header.writeUInt16BE(0x8180, 2); // QR, RD, RA, NOERROR
  header.writeUInt16BE(1, 4); // qdcount
  header.writeUInt16BE(answers.length, 6); // ancount
  header.writeUInt16BE(0, 8);
  header.writeUInt16BE(0, 10);
  const question = query.subarray(12, query.length - 11); // strip the OPT pseudo-record
  const records = answers.map((answer) => {
    const name = Buffer.from([0xc0, answer.namePointer ?? 12]);
    const fixed = Buffer.alloc(10);
    fixed.writeUInt16BE(answer.type, 0);
    fixed.writeUInt16BE(1, 2);
    fixed.writeUInt32BE(answer.ttl, 4);
    fixed.writeUInt16BE(answer.rdata.length, 8);
    return Buffer.concat([name, fixed, answer.rdata]);
  });
  return Buffer.concat([header, question, ...records]);
}

function ipv4(address: string): Buffer {
  return Buffer.from(address.split('.').map((part) => Number(part)));
}

describe('dns-wire: query encoding', () => {
  it('encodes a well-formed query with an EDNS0 OPT record', () => {
    const query = encodeQuery('example.com', 'A', { id: 0x1234, dnssecOk: true });
    expect(query.readUInt16BE(0)).toBe(0x1234);
    expect(query.readUInt16BE(2) & 0x0100).toBe(0x0100); // RD set
    expect(query.readUInt16BE(4)).toBe(1); // one question
    expect(query.readUInt16BE(10)).toBe(1); // one additional (OPT)
    const parsed = parseMessage(query);
    expect(parsed.questions).toHaveLength(1);
    expect(parsed.questions[0]?.name).toBe('example.com');
    expect(parsed.questions[0]?.type).toBe('A');
    expect(parsed.questions[0]?.typeCode).toBe(1);
    expect(parsed.edns?.present).toBe(true);
    expect(parsed.edns?.dnssecOk).toBe(true);
  });

  it('rejects an unknown query type instead of guessing one', () => {
    expect(() => encodeQuery('example.com', 'NOTATYPE')).toThrow(/Unsupported query type/);
  });

  it('rejects labels longer than 63 bytes', () => {
    expect(() => encodeName(`${'a'.repeat(64)}.com`)).toThrow(/Invalid DNS label/);
  });

  it('exposes the type registry used by the transport layer', () => {
    expect(TYPE_BY_NAME.A).toBe(1);
    expect(TYPE_BY_NAME.AAAA).toBe(28);
    expect(TYPE_BY_NAME.TXT).toBe(16);
    expect(TYPE_BY_NAME.DNSKEY).toBe(48);
  });
});

describe('dns-wire: response parsing', () => {
  it('decodes an A answer with name compression', () => {
    const query = encodeQuery('example.com', 'A');
    const response = parseMessage(buildResponse(query, [{ type: 1, ttl: 300, rdata: ipv4('93.184.216.34') }]));
    expect(response.rcode).toBe(0);
    expect(response.rcodeText).toBe('NOERROR');
    expect(response.answers).toHaveLength(1);
    const answer = response.answers[0];
    expect(answer?.name).toBe('example.com');
    expect(answer?.type).toBe('A');
    expect(answer?.classCode).toBe(1);
    expect(answer?.ttl).toBe(300);
    expect(answer?.data.address).toBe('93.184.216.34');
    expect(answer?.display).toBe('93.184.216.34');
    expect(formatRecordText(answer!)).toBe('example.com 300 IN A 93.184.216.34');
  });

  it('concatenates multi-part TXT strings into one value (RFC 7208 semantics)', () => {
    const query = encodeQuery('example.com', 'TXT');
    const first = Buffer.from('v=spf1 include:_spf.example.com ');
    const second = Buffer.from('-all');
    const rdata = Buffer.concat([Buffer.from([first.length]), first, Buffer.from([second.length]), second]);
    const response = parseMessage(buildResponse(query, [{ type: 16, ttl: 60, rdata }]));
    const answer = response.answers[0];
    expect(answer?.type).toBe('TXT');
    expect(answer?.data.value).toBe('v=spf1 include:_spf.example.com -all');
    expect(answer?.data.parts).toHaveLength(2);
  });

  it('decodes MX preference and exchange', () => {
    const query = encodeQuery('example.com', 'MX');
    const exchange = encodeName('mail.example.com');
    const rdata = Buffer.concat([Buffer.from([0x00, 0x0a]), exchange]);
    const response = parseMessage(buildResponse(query, [{ type: 15, ttl: 3600, rdata }]));
    const answer = response.answers[0];
    expect(answer?.data.preference).toBe(10);
    expect(answer?.data.exchange).toBe('mail.example.com');
    expect(answer?.display).toBe('10 mail.example.com');
  });

  it('flags NXDOMAIN and truncation rather than returning an empty answer silently', () => {
    const query = encodeQuery('does-not-exist.example', 'A');
    const response = parseMessage(buildResponse(query, []).fill(0, 0, 0));
    // rebuild properly: clear the answer count and set rcode 3 + TC
    const header = buildResponse(encodeQuery('does-not-exist.example', 'A'), []);
    header.writeUInt16BE(0x8383, 2); // QR|TC|RD|RA|NXDOMAIN
    const parsed = parseMessage(header);
    expect(parsed.rcode).toBe(3);
    expect(parsed.rcodeText).toBe('NXDOMAIN');
    expect(parsed.truncated).toBe(true);
    expect(parsed.answers).toHaveLength(0);
    expect(response.questions[0]?.name).toBe('does-not-exist.example');
  });

  it('marks DNSSEC presence from RRSIG/DNSKEY records in the answer', () => {
    const query = encodeQuery('example.com', 'DNSKEY', { dnssecOk: true });
    const rdata = Buffer.concat([Buffer.from([0x01, 0x01, 0x03, 0x08]), Buffer.from([1, 2, 3, 4])]);
    const response = parseMessage(buildResponse(query, [{ type: 48, ttl: 3600, rdata }]));
    expect(response.hasDnssecRecords).toBe(true);
    expect(response.answers[0]?.type).toBe('DNSKEY');
    expect(response.answers[0]?.data.flags).toBe(0x0101);
    expect(response.answers[0]?.data.algorithm).toBe(8);
  });

  it('keeps an undecodable record as raw data instead of dropping the answer', () => {
    const query = encodeQuery('example.com', 'A');
    // Type 1 (A) with 5 bytes is invalid; the record must survive with a decode note.
    const response = parseMessage(buildResponse(query, [{ type: 1, ttl: 10, rdata: Buffer.from([1, 2, 3, 4, 5]) }]));
    expect(response.answers).toHaveLength(1);
    expect(response.answers[0]?.data.raw).toBe('0102030405');
    expect(response.answers[0]?.data.decodeError).toBeDefined();
  });

  it('throws on a truncated message rather than inventing records', () => {
    const query = encodeQuery('example.com', 'A');
    expect(() => parseMessage(query.subarray(0, 20))).toThrow();
  });
});

describe('dns-wire: helpers', () => {
  it('detects subdomain relationships case-insensitively', () => {
    expect(isSubdomainOf('www.example.com', 'example.com')).toBe(true);
    expect(isSubdomainOf('example.com', 'example.com')).toBe(true);
    expect(isSubdomainOf('notexample.com', 'example.com')).toBe(false);
    expect(isSubdomainOf('example.com.evil.test', 'example.com')).toBe(false);
  });
});
