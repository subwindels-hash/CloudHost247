/**
 * Tools Center — DNS message encoding/decoding (RFC 1035, RFC 3596, RFC 6891).
 *
 * This is a real wire-format implementation rather than a wrapper around `dig`: cPanel/Passenger
 * deployments cannot be assumed to have a DNS client binary, and the platform must be able to say
 * exactly which question was asked and exactly what came back. Every parse path is defensive — a
 * malformed or truncated message raises a `ToolError` instead of inventing records.
 *
 * Supported RR types: A, AAAA, NS, CNAME, SOA, PTR, MX, TXT, SRV, CAA, DS, DNSKEY, RRSIG, NSEC,
 * TLSA, DNS-MX-related and OPT (EDNS0). Unknown types are preserved as hex and labelled as such.
 */

export const TYPE_CODES: Record<string, number> = {
  A: 1,
  NS: 2,
  CNAME: 5,
  SOA: 6,
  PTR: 12,
  HINFO: 13,
  MX: 15,
  TXT: 16,
  AAAA: 28,
  SRV: 33,
  NAPTR: 35,
  DS: 43,
  SSHFP: 44,
  RRSIG: 46,
  NSEC: 47,
  DNSKEY: 48,
  NSEC3: 50,
  TLSA: 52,
  CAA: 257,
  OPT: 41,
  ANY: 255,
};

export const CODE_TYPES: Record<number, string> = Object.fromEntries(Object.entries(TYPE_CODES).map(([name, code]) => [code, name]));

export const RCODE_NAMES: Record<number, string> = {
  0: 'NOERROR',
  1: 'FORMERR',
  2: 'SERVFAIL',
  3: 'NXDOMAIN',
  4: 'NOTIMP',
  5: 'REFUSED',
  6: 'YXDOMAIN',
  7: 'YXRRSET',
  8: 'NXRRSET',
  9: 'NOTAUTH',
  10: 'NOTZONE',
  16: 'BADVERS',
};

export const OPCODE_NAMES: Record<number, string> = { 0: 'QUERY', 1: 'IQUERY', 2: 'STATUS', 4: 'NOTIFY', 5: 'UPDATE' };

export interface DnsQuestion {
  name: string;
  /** Record type name, e.g. "A". */
  type: string;
  typeCode: number;
  class: number;
}

export interface DnsRecord {
  name: string;
  /** Record type name, e.g. "A" or "TXT" (unknown types become "TYPE65"). */
  type: string;
  /** Numeric record type code. */
  typeCode: number;
  /** Numeric class code (1 = IN, 3 = CH). */
  classCode: number;
  ttl: number;
  rdataLength: number;
  /** Type-specific decoded data; unknown types keep only `raw`. */
  data: Record<string, unknown>;
  /** Presentation form of the RDATA (like `dig` prints it). */
  text: string;
  /** The RDATA as the value a user cares about (address, target host, TXT value…). */
  display: string;
  raw: Buffer;
}

export interface DnsMessage {
  id: number;
  /** Numeric RCODE of the response (0 = NOERROR, 3 = NXDOMAIN, …). */
  rcode: number;
  rcodeText: string;
  authoritative: boolean;
  truncated: boolean;
  /** True when the answer/additional sections carry DNSSEC records (RRSIG/DNSKEY/DS/NSEC). */
  hasDnssecRecords: boolean;
  flags: {
    qr: boolean;
    opcode: number;
    opcodeName: string;
    authoritative: boolean;
    truncated: boolean;
    recursionDesired: boolean;
    recursionAvailable: boolean;
    authenticatedData: boolean;
    checkingDisabled: boolean;
    rcode: number;
    rcodeName: string;
  };
  questions: DnsQuestion[];
  answers: DnsRecord[];
  authorities: DnsRecord[];
  additionals: DnsRecord[];
  /** EDNS0 UDP payload size advertised by the responder, when an OPT record is present. */
  edns: { present: boolean; udpPayloadSize: number | null; extendedRcode: number | null; dnssecOk: boolean } | null;
  bytes: number;
}

class Reader {
  offset = 0;
  constructor(readonly buffer: Buffer) {}

  ensure(length: number): void {
    if (this.offset + length > this.buffer.length) throw new RangeError('Truncated DNS message');
  }

  uint8(): number {
    this.ensure(1);
    const value = this.buffer[this.offset] ?? 0;
    this.offset += 1;
    return value;
  }

  uint16(): number {
    this.ensure(2);
    const value = this.buffer.readUInt16BE(this.offset);
    this.offset += 2;
    return value;
  }

  uint32(): number {
    this.ensure(4);
    const value = this.buffer.readUInt32BE(this.offset);
    this.offset += 4;
    return value;
  }

  bytes(length: number): Buffer {
    this.ensure(length);
    const value = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }
}

/** Decodes a (possibly compressed) domain name and returns it plus the offset just past the name. */
function readName(reader: Reader): string {
  const labels: string[] = [];
  let offset = reader.offset;
  let jumped = false;
  let guard = 0;

  for (;;) {
    if (guard > 128) throw new RangeError('DNS name pointer loop');
    guard += 1;
    if (offset >= reader.buffer.length) throw new RangeError('Truncated DNS name');
    const length = reader.buffer[offset] ?? 0;

    if ((length & 0xc0) === 0xc0) {
      const pointer = ((length & 0x3f) << 8) | (reader.buffer[offset + 1] ?? 0);
      if (!jumped) reader.offset = offset + 2;
      jumped = true;
      offset = pointer;
      continue;
    }
    if ((length & 0xc0) !== 0) throw new RangeError('Invalid DNS label length');
    offset += 1;
    if (length === 0) break;
    if (offset + length > reader.buffer.length) throw new RangeError('Truncated DNS label');
    const label = reader.buffer.subarray(offset, offset + length);
    // RFC 4343: escape bytes that would confuse the presentation format.
    labels.push(label.toString('latin1').replace(/[^\x20-\x7e]/g, (character) => `\\${(character.charCodeAt(0)).toString().padStart(3, '0')}`).replace(/[."\\]/g, (character) => `\\${character}`));
    offset += length;
  }
  if (!jumped) reader.offset = offset;
  return labels.length === 0 ? '.' : labels.join('.');
}

function quoteTxt(text: string): string {
  return `"${text.replace(/([\\"])/g, '\\$1')}"`;
}

/** TXT records are a sequence of character-strings; RFC 7208 treats them as one concatenated value. */
function parseTxtParts(reader: Reader, length: number): { parts: string[]; consumed: number } {
  const parts: string[] = [];
  let consumed = 0;
  while (consumed < length) {
    const partLength = reader.uint8();
    consumed += 1;
    if (consumed + partLength > length) throw new RangeError('Truncated TXT string');
    parts.push(reader.bytes(partLength).toString('utf8'));
    consumed += partLength;
  }
  return { parts, consumed };
}

function formatCaaTag(tag: string): string {
  return tag.replace(/[^a-z0-9]/gi, (character) => `\\${character.charCodeAt(0)}`);
}

function parseRdata(type: number, rdata: Buffer, reader: Reader, rdataStart: number): { data: Record<string, unknown>; text: string } {
  const view = new Reader(rdata);
  switch (type) {
    case TYPE_CODES.A:
      if (rdata.length !== 4) throw new RangeError('A record is not 4 bytes');
      return { data: { address: Array.from(rdata).join('.') }, text: Array.from(rdata).join('.') };
    case TYPE_CODES.AAAA: {
      if (rdata.length !== 16) throw new RangeError('AAAA record is not 16 bytes');
      const groups: string[] = [];
      for (let index = 0; index < 16; index += 2) groups.push(rdata.readUInt16BE(index).toString(16));
      return { data: { address: groups.join(':') }, text: groups.join(':') };
    }
    case TYPE_CODES.NS:
    case TYPE_CODES.CNAME:
    case TYPE_CODES.PTR: {
      // Names inside RDATA may use compression, so parse from the message buffer at the RDATA offset.
      const saved = reader.offset;
      reader.offset = rdataStart;
      const name = readName(reader);
      reader.offset = saved;
      return { data: { target: name, name }, text: name };
    }
    case TYPE_CODES.MX: {
      const preference = view.uint16();
      const saved = reader.offset;
      reader.offset = rdataStart + 2;
      const exchange = readName(reader);
      reader.offset = saved;
      return { data: { preference, exchange }, text: `${preference} ${exchange}` };
    }
    case TYPE_CODES.SOA: {
      const saved = reader.offset;
      reader.offset = rdataStart;
      const mname = readName(reader);
      const rname = readName(reader);
      reader.offset = saved;
      const serial = view.uint32();
      const refresh = view.uint32();
      const retry = view.uint32();
      const expire = view.uint32();
      const minimum = view.uint32();
      return {
        data: { mname, rname, serial, refresh, retry, expire, minimum },
        text: `${mname} ${rname} ${serial} ${refresh} ${retry} ${expire} ${minimum}`,
      };
    }
    case TYPE_CODES.TXT: {
      const { parts } = parseTxtParts(view, rdata.length);
      return { data: { parts, value: parts.join('') }, text: parts.map(quoteTxt).join(' ') };
    }
    case TYPE_CODES.SRV: {
      const priority = view.uint16();
      const weight = view.uint16();
      const port = view.uint16();
      const saved = reader.offset;
      reader.offset = rdataStart + 6;
      const target = readName(reader);
      reader.offset = saved;
      return { data: { priority, weight, port, target }, text: `${priority} ${weight} ${port} ${target}` };
    }
    case TYPE_CODES.CAA: {
      const flags = view.uint8();
      const tagLength = view.uint8();
      const tag = view.bytes(tagLength).toString('ascii');
      const value = rdata.subarray(2 + tagLength).toString('utf8');
      return { data: { flags, tag, value }, text: `${flags} ${formatCaaTag(tag)} ${quoteTxt(value)}` };
    }
    case TYPE_CODES.DS: {
      const keyTag = view.uint16();
      const algorithm = view.uint8();
      const digestType = view.uint8();
      const digest = view.bytes(rdata.length - 4).toString('hex').toUpperCase();
      return { data: { keyTag, algorithm, digestType, digest }, text: `${keyTag} ${algorithm} ${digestType} ${digest}` };
    }
    case TYPE_CODES.DNSKEY: {
      const flags = view.uint16();
      const protocol = view.uint8();
      const algorithm = view.uint8();
      const publicKey = view.bytes(rdata.length - 4).toString('base64');
      return { data: { flags, protocol, algorithm, publicKey }, text: `${flags} ${protocol} ${algorithm} ${publicKey}` };
    }
    case TYPE_CODES.RRSIG: {
      const typeCovered = view.uint16();
      const algorithm = view.uint8();
      const labels = view.uint8();
      const originalTtl = view.uint32();
      const expiration = view.uint32();
      const inception = view.uint32();
      const keyTag = view.uint16();
      const saved = reader.offset;
      reader.offset = rdataStart + 18;
      const signerName = readName(reader);
      reader.offset = saved;
      const signature = rdata.subarray(rdata.length - (rdata.length - 18 - signerName.length - 1)).toString('base64');
      return {
        data: { typeCovered, typeCoveredName: CODE_TYPES[typeCovered] ?? String(typeCovered), algorithm, labels, originalTtl, expiration, inception, keyTag, signerName, signature },
        text: `${CODE_TYPES[typeCovered] ?? typeCovered} ${algorithm} ${labels} ${originalTtl} ${expiration} ${inception} ${keyTag} ${signerName} ${signature.slice(0, 24)}…`,
      };
    }
    case TYPE_CODES.NSEC: {
      const saved = reader.offset;
      reader.offset = rdataStart;
      const nextDomain = readName(reader);
      reader.offset = saved;
      const typeBitmap = rdata.subarray(nextDomain.length + 1);
      return { data: { nextDomain, typeBitmap: typeBitmap.toString('hex') }, text: `${nextDomain} (type bitmap ${typeBitmap.toString('hex')})` };
    }
    case TYPE_CODES.TLSA: {
      const usage = view.uint8();
      const selector = view.uint8();
      const matchingType = view.uint8();
      const certificate = view.bytes(rdata.length - 3).toString('hex').toUpperCase();
      return { data: { usage, selector, matchingType, certificateAssociationData: certificate }, text: `${usage} ${selector} ${matchingType} ${certificate}` };
    }
    default:
      return { data: { raw: rdata.toString('hex') }, text: `\\# ${rdata.length} ${rdata.toString('hex')}` };
  }
}

function parseRecord(reader: Reader): DnsRecord {
  const name = readName(reader);
  const type = reader.uint16();
  const cls = reader.uint16();
  const ttl = reader.uint32();
  const rdataLength = reader.uint16();
  const rdataStart = reader.offset;
  const rdata = reader.bytes(rdataLength);
  let parsed: { data: Record<string, unknown>; text: string };
  try {
    parsed = parseRdata(type, rdata, reader, rdataStart);
  } catch (error) {
    // A record we cannot decode is still a record: keep the raw bytes and say so, rather than
    // failing the whole answer (a single broken RR must not hide the rest of the zone).
    parsed = { data: { raw: rdata.toString('hex'), decodeError: error instanceof Error ? error.message : 'decode failed' }, text: `\\# ${rdataLength} ${rdata.toString('hex')}` };
  }
  const display =
    typeof parsed.data.target === 'string'
      ? parsed.data.target
      : typeof parsed.data.address === 'string'
        ? parsed.data.address
        : typeof parsed.data.value === 'string'
          ? parsed.data.value
          : parsed.text;
  return {
    name,
    type: CODE_TYPES[type] ?? `TYPE${type}`,
    typeCode: type,
    classCode: cls,
    ttl,
    rdataLength,
    data: parsed.data,
    text: parsed.text,
    display,
    raw: rdata,
  };
}

export function parseMessage(buffer: Buffer): DnsMessage {
  const reader = new Reader(buffer);
  const id = reader.uint16();
  const flagsWord = reader.uint16();
  const qdcount = reader.uint16();
  const ancount = reader.uint16();
  const nscount = reader.uint16();
  const arcount = reader.uint16();

  const flags = {
    qr: (flagsWord & 0x8000) !== 0,
    opcode: (flagsWord >> 11) & 0x0f,
    opcodeName: OPCODE_NAMES[(flagsWord >> 11) & 0x0f] ?? String((flagsWord >> 11) & 0x0f),
    authoritative: (flagsWord & 0x0400) !== 0,
    truncated: (flagsWord & 0x0200) !== 0,
    recursionDesired: (flagsWord & 0x0100) !== 0,
    recursionAvailable: (flagsWord & 0x0080) !== 0,
    authenticatedData: (flagsWord & 0x0020) !== 0,
    checkingDisabled: (flagsWord & 0x0010) !== 0,
    rcode: flagsWord & 0x0f,
    rcodeName: RCODE_NAMES[flagsWord & 0x0f] ?? String(flagsWord & 0x0f),
  };

  const questions: DnsQuestion[] = [];
  for (let index = 0; index < qdcount; index += 1) {
    const name = readName(reader);
    const type = reader.uint16();
    const cls = reader.uint16();
    questions.push({ name, type: CODE_TYPES[type] ?? `TYPE${type}`, typeCode: type, class: cls });
  }

  const readRecords = (count: number): DnsRecord[] => {
    const records: DnsRecord[] = [];
    for (let index = 0; index < count; index += 1) records.push(parseRecord(reader));
    return records;
  };

  const answers = readRecords(ancount);
  const authorities = readRecords(nscount);
  const additionals = readRecords(arcount);

  const opt = additionals.find((record) => record.typeCode === TYPE_CODES.OPT);
  const hasDnssecRecords = [...answers, ...authorities, ...additionals].some((record) =>
    ['RRSIG', 'DNSKEY', 'DS', 'NSEC', 'NSEC3'].includes(record.type)
  );
  const edns = opt
    ? {
        present: true,
        udpPayloadSize: (opt.classCode & 0xffff) || null,
        extendedRcode: (opt.ttl >> 24) & 0xff,
        dnssecOk: (opt.ttl & 0x8000) !== 0,
      }
    : null;

  return {
    id,
    rcode: flags.rcode,
    rcodeText: flags.rcodeName,
    authoritative: flags.authoritative,
    truncated: flags.truncated,
    hasDnssecRecords,
    flags,
    questions,
    answers,
    authorities,
    additionals,
    edns,
    bytes: buffer.length,
  };
}

export function encodeName(name: string): Buffer {
  const normalised = name === '.' ? '' : name.replace(/\.$/, '');
  const labels = normalised.length === 0 ? [] : normalised.split('.');
  const chunks: Buffer[] = [];
  for (const label of labels) {
    const bytes = Buffer.from(label, 'utf8');
    if (bytes.length === 0 || bytes.length > 63) throw new RangeError(`Invalid DNS label "${label}"`);
    chunks.push(Buffer.from([bytes.length]), bytes);
  }
  chunks.push(Buffer.from([0]));
  return Buffer.concat(chunks);
}

export interface EncodeQueryOptions {
  id?: number;
  rd?: boolean;
  dnssecOk?: boolean;
  udpPayloadSize?: number;
  /** Alias kept for the transport layer's call sites. */
  ednsUdpSize?: number;
  /** 0 = standard query. */
  opcode?: number;
}

export function encodeQuery(name: string, type: string | number, options: EncodeQueryOptions = {}): Buffer {
  const typeCode = typeof type === 'number' ? type : TYPE_CODES[type.toUpperCase()];
  if (!typeCode) throw new RangeError(`Unsupported query type "${type}"`);
  const id = options.id ?? Math.floor(Math.random() * 0xffff);
  const qname = encodeName(name);
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  const flags = ((options.opcode ?? 0) << 11) | (options.rd === false ? 0 : 0x0100);
  header.writeUInt16BE(flags, 2);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(0, 6);
  header.writeUInt16BE(0, 8);
  header.writeUInt16BE(1, 10); // one additional record: the OPT pseudo-RR

  const question = Buffer.concat([qname, Buffer.from([(typeCode >> 8) & 0xff, typeCode & 0xff, 0x00, 0x01])]);

  // EDNS0 OPT: root name, type 41, class = UDP payload size, TTL = extended rcode/flags.
  const opt = Buffer.alloc(11);
  opt.writeUInt8(0, 0);
  opt.writeUInt16BE(TYPE_CODES.OPT ?? 41, 1);
  opt.writeUInt16BE(Math.min(Math.max(options.udpPayloadSize ?? options.ednsUdpSize ?? 1232, 512), 4096), 3);
  opt.writeUInt32BE(options.dnssecOk ? 0x00008000 : 0, 5);
  opt.writeUInt16BE(0, 9);

  return Buffer.concat([header, question, opt]);
}

/** True when every label of `name` is under `zone` (used to check delegation / ownership). */
export function isSubdomainOf(name: string, zone: string): boolean {
  const a = name.replace(/\.$/, '').toLowerCase();
  const b = zone.replace(/\.$/, '').toLowerCase();
  return a === b || a.endsWith(`.${b}`);
}

/** The transport/service layer refers to these aliases by name. */
export const TYPE_BY_NAME: Record<string, number> = TYPE_CODES;
export type ParsedMessage = DnsMessage;
export type ParsedRecord = DnsRecord;

export function formatRecordText(record: DnsRecord): string {
  return `${record.name} ${record.ttl} IN ${record.type} ${record.text}`;
}
