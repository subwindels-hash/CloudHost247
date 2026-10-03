/**
 * Tools Center — deterministic IP arithmetic (spec §22, §23).
 *
 * Everything here is pure and unit-tested: decimal ↔ IP conversions, IPv4 ↔ IPv6 forms that are
 * actually defined (IPv4-mapped, 6to4, NAT64), IPv6 compression/expansion, subnet information and
 * CIDR ↔ range both ways. The IPv6 additions and aggregations use BigInt, so nothing depends on
 * host byte order or on the 32-bit bitwise limits that make naive IPv6 code wrong.
 *
 * Where a conversion is not mathematically defined (converting a global IPv6 address to IPv4), the
 * function returns a documented `applicable: false` result instead of inventing an answer.
 */
import { formatIpv4, formatIpv6, parseIp, type ParsedIp } from '../core/ssrf';
import { invalidInput } from '../core/errors';

export interface AddressBytes {
  version: 4 | 6;
  bytes: number[];
  normalized: string;
}

export function toBytes(input: string): AddressBytes {
  const parsed = parseIp(input);
  if (!parsed) throw invalidInput(`"${input}" is not a valid IPv4 or IPv6 address.`);
  return { version: parsed.version, bytes: parsed.bytes, normalized: parsed.normalized };
}

export function toBigInt(parsed: ParsedIp): bigint {
  let value = 0n;
  for (const byte of parsed.bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}

export function fromBigInt(value: bigint, version: 4 | 6): string {
  const byteLength = version === 4 ? 4 : 16;
  const bytes: number[] = new Array(byteLength).fill(0);
  let remaining = value;
  for (let index = byteLength - 1; index >= 0; index -= 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return version === 4 ? formatIpv4(bytes) : formatIpv6(bytes);
}

// ---------------------------------------------------------------------------------------------
// Decimal conversions
// ---------------------------------------------------------------------------------------------

export function ipv4ToDecimal(address: string): { address: string; decimal: string; hex: string; binary: string } {
  const parsed = parseIp(address);
  if (!parsed || parsed.version !== 4) throw invalidInput(`"${address}" is not a valid IPv4 address.`);
  const value = toBigInt(parsed);
  return {
    address: parsed.normalized,
    decimal: value.toString(10),
    hex: `0x${value.toString(16).toUpperCase()}`,
    binary: parsed.bytes.map((byte) => byte.toString(2).padStart(8, '0')).join('.'),
  };
}

export function decimalToIpv4(decimal: string): { decimal: string; address: string } {
  const trimmed = decimal.trim();
  if (!/^\d{1,10}$/.test(trimmed)) throw invalidInput('A decimal IPv4 value must be a whole number between 0 and 4294967295.');
  const value = BigInt(trimmed);
  if (value > 0xffffffffn) throw invalidInput('That decimal value is larger than 4294967295, the largest IPv4 address.');
  return { decimal: value.toString(10), address: fromBigInt(value, 4) };
}

export function ipv6ToDecimal(address: string): { address: string; decimal: string; hex: string } {
  const parsed = parseIp(address);
  if (!parsed || parsed.version !== 6) throw invalidInput(`"${address}" is not a valid IPv6 address.`);
  const value = toBigInt(parsed);
  return { address: parsed.normalized, decimal: value.toString(10), hex: `0x${value.toString(16).toUpperCase()}` };
}

export function decimalToIpv6(decimal: string): { decimal: string; address: string } {
  const trimmed = decimal.trim();
  if (!/^\d{1,39}$/.test(trimmed)) throw invalidInput('A decimal IPv6 value must be a whole number between 0 and 2^128 − 1.');
  const value = BigInt(trimmed);
  if (value > (1n << 128n) - 1n) throw invalidInput('That decimal value is larger than 2^128 − 1, the largest IPv6 address.');
  return { decimal: value.toString(10), address: fromBigInt(value, 6) };
}

// ---------------------------------------------------------------------------------------------
// IPv4 ↔ IPv6 forms
// ---------------------------------------------------------------------------------------------

export interface Ipv4ToIpv6Result {
  ipv4: string;
  mapped: string;
  compatible: string;
  sixToFour: string;
  nat64: string;
  explanation: string;
}

export function ipv4ToIpv6Forms(address: string): Ipv4ToIpv6Result {
  const parsed = parseIp(address);
  if (!parsed || parsed.version !== 4) throw invalidInput(`"${address}" is not a valid IPv4 address.`);
  const [a = 0, b = 0, c = 0, d = 0] = parsed.bytes;
  const mapped = `::ffff:${address}`;
  const compatible = `::${address}`;
  const sixToFour = formatIpv6([0x20, 0x02, a, b, c, d, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const nat64 = formatIpv6([0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0, a, b, c, d]);
  return {
    ipv4: parsed.normalized,
    mapped,
    compatible,
    sixToFour,
    nat64,
    explanation:
      'IPv4-mapped addresses (::ffff:a.b.c.d) are how IPv4 endpoints appear on an IPv6 socket. 6to4 (2002::/16) and NAT64 (64:ff9b::/96) embed the IPv4 address in a defined position. The deprecated IPv4-compatible form (::a.b.c.d) is shown for completeness only.',
  };
}

export interface Ipv6ToIpv4Result {
  address: string;
  applicable: boolean;
  form: 'ipv4-mapped' | '6to4' | 'nat64' | 'teredo' | null;
  ipv4: string | null;
  explanation: string;
}

/** Section §22 "IPv6 → IPv4 where technically applicable". */
export function ipv6ToIpv4(address: string): Ipv6ToIpv4Result {
  const parsed = parseIp(address);
  if (!parsed || parsed.version !== 6) throw invalidInput(`"${address}" is not a valid IPv6 address.`);
  const bytes = parsed.bytes;

  const isMapped = bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  if (isMapped) {
    return {
      address: parsed.normalized,
      applicable: true,
      form: 'ipv4-mapped',
      ipv4: formatIpv4(bytes.slice(12, 16)),
      explanation: 'This is an IPv4-mapped IPv6 address; the IPv4 address is stored in the last four bytes.',
    };
  }
  if (bytes[0] === 0x20 && bytes[1] === 0x02) {
    return {
      address: parsed.normalized,
      applicable: true,
      form: '6to4',
      ipv4: formatIpv4(bytes.slice(2, 6)),
      explanation: 'This is a 6to4 address; the embedded IPv4 address follows the 2002::/16 prefix.',
    };
  }
  const nat64Prefix = [0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0];
  if (nat64Prefix.every((byte, index) => bytes[index] === byte)) {
    return {
      address: parsed.normalized,
      applicable: true,
      form: 'nat64',
      ipv4: formatIpv4(bytes.slice(12, 16)),
      explanation: 'This is a NAT64 address; the embedded IPv4 address is in the last four bytes.',
    };
  }
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) {
    const embedded = bytes.slice(12, 16).map((byte) => byte ^ 0xff);
    return {
      address: parsed.normalized,
      applicable: true,
      form: 'teredo',
      ipv4: formatIpv4(embedded),
      explanation: 'This is a Teredo address; the client IPv4 address is the last four bytes with each bit inverted.',
    };
  }

  return {
    address: parsed.normalized,
    applicable: false,
    form: null,
    ipv4: null,
    explanation:
      'This address does not contain an embedded IPv4 address. Converting an ordinary (global unicast) IPv6 address to IPv4 is not defined — the two are separate address families, so no equivalent IPv4 address exists.',
  };
}

// ---------------------------------------------------------------------------------------------
// IPv6 compression / expansion
// ---------------------------------------------------------------------------------------------

export function expandIpv6(address: string): { address: string; expanded: string; groups: string[] } {
  const parsed = parseIp(address);
  if (!parsed || parsed.version !== 6) throw invalidInput(`"${address}" is not a valid IPv6 address.`);
  const groups: string[] = [];
  for (let index = 0; index < 16; index += 2) {
    groups.push((((parsed.bytes[index] ?? 0) << 8) | (parsed.bytes[index + 1] ?? 0)).toString(16).padStart(4, '0'));
  }
  return { address: parsed.normalized, expanded: groups.join(':'), groups };
}

export function compressIpv6(address: string): { address: string; compressed: string; removedZeros: number } {
  const parsed = parseIp(address);
  if (!parsed || parsed.version !== 6) throw invalidInput(`"${address}" is not a valid IPv6 address.`);
  const expanded = expandIpv6(address).expanded;
  const compressed = formatIpv6(parsed.bytes);
  return {
    address: parsed.normalized,
    compressed,
    removedZeros: expanded.length - compressed.length,
  };
}

// ---------------------------------------------------------------------------------------------
// CIDR ↔ range
// ---------------------------------------------------------------------------------------------

export interface CidrRange {
  cidr: string;
  version: 4 | 6;
  networkAddress: string;
  firstAddress: string;
  lastAddress: string;
  /** Inclusive count of addresses in the block, as a decimal string (BigInt for IPv6). */
  addressCount: string;
  prefixLength: number;
}

export function cidrToRange(cidr: string): CidrRange {
  const [addressPart, prefixPart] = cidr.trim().split('/');
  if (!addressPart || prefixPart === undefined) throw invalidInput('Enter a CIDR block such as 192.0.2.0/24 or 2001:db8::/32.');
  const parsed = parseIp(addressPart);
  if (!parsed) throw invalidInput(`"${addressPart}" is not a valid IPv4 or IPv6 address.`);
  const maxPrefix = parsed.version === 4 ? 32 : 128;
  if (!/^\d{1,3}$/.test(prefixPart.trim())) throw invalidInput('The prefix length must be a whole number.');
  const prefixLength = Number(prefixPart.trim());
  if (prefixLength < 0 || prefixLength > maxPrefix) {
    throw invalidInput(`The prefix length for IPv${parsed.version} must be between 0 and ${maxPrefix}.`);
  }

  const value = toBigInt(parsed);
  const hostBits = BigInt(maxPrefix - prefixLength);
  const mask = hostBits === 0n ? ((1n << BigInt(maxPrefix)) - 1n) : (~((1n << hostBits) - 1n) & ((1n << BigInt(maxPrefix)) - 1n));
  const network = value & mask;
  const broadcast = network | ((1n << hostBits) - 1n);

  return {
    cidr: `${fromBigInt(network, parsed.version)}/${prefixLength}`,
    version: parsed.version,
    networkAddress: fromBigInt(network, parsed.version),
    firstAddress: fromBigInt(network, parsed.version),
    lastAddress: fromBigInt(broadcast, parsed.version),
    addressCount: (1n << hostBits).toString(10),
    prefixLength,
  };
}

export interface CidrBlock {
  cidr: string;
  firstAddress: string;
  lastAddress: string;
  addressCount: string;
  prefixLength: number;
}

/**
 * Aggregates an address range into the minimal set of CIDR blocks that exactly cover it
 * (spec §22 "IPv6 Range → CIDR"; the same algorithm is correct for IPv4).
 */
export function rangeToCidr(startAddress: string, endAddress: string): { version: 4 | 6; blocks: CidrBlock[]; totalAddresses: string; explanation: string } {
  const start = parseIp(startAddress);
  const end = parseIp(endAddress);
  if (!start || !end) throw invalidInput('Enter a valid start and end address.');
  if (start.version !== end.version) throw invalidInput('The start and end addresses must be the same family (both IPv4 or both IPv6).');

  const maxBits = start.version === 4 ? 32 : 128;
  let startValue = toBigInt(start);
  let endValue = toBigInt(end);
  if (startValue > endValue) [startValue, endValue] = [endValue, startValue];

  const total = endValue - startValue + 1n;
  const blocks: CidrBlock[] = [];
  let cursor = startValue;

  while (cursor <= endValue) {
    // Largest aligned block that starts at `cursor` and does not run past `endValue`.
    let size = 1n;
    // Alignment: the number of trailing zero bits in cursor limits the block size.
    let alignmentBits = 0;
    while (alignmentBits < maxBits && ((cursor >> BigInt(alignmentBits)) & 1n) === 0n) {
      alignmentBits += 1;
    }
    const remaining = endValue - cursor + 1n;
    while (size * 2n <= remaining && size * 2n <= 1n << BigInt(alignmentBits)) {
      size *= 2n;
    }
    const prefixLength = maxBits - (size.toString(2).length - 1);
    const last = cursor + size - 1n;
    blocks.push({
      cidr: `${fromBigInt(cursor, start.version)}/${prefixLength}`,
      firstAddress: fromBigInt(cursor, start.version),
      lastAddress: fromBigInt(last, start.version),
      addressCount: size.toString(10),
      prefixLength,
    });
    cursor = last + 1n;
  }

  return {
    version: start.version,
    blocks,
    totalAddresses: total.toString(10),
    explanation: `The range covers ${total.toString(10)} addresses, represented here by ${blocks.length} CIDR block(s). This is the smallest exact representation (RFC 4632 aggregation).`,
  };
}

// ---------------------------------------------------------------------------------------------
// Subnet calculator
// ---------------------------------------------------------------------------------------------

export interface SubnetInfo {
  input: string;
  version: 4 | 6;
  prefixLength: number;
  cidr: string;
  networkAddress: string;
  broadcastAddress: string | null;
  firstUsableAddress: string | null;
  lastUsableAddress: string | null;
  totalAddresses: string;
  usableHosts: string | null;
  subnetMask: string;
  wildcardMask: string | null;
  binary: { network: string; mask: string };
  isPrivate: boolean;
  notes: string[];
}

export function subnetInfo(input: string): SubnetInfo {
  const [addressPart, prefixPart] = input.includes('/') ? input.trim().split('/') : [input.trim(), null];
  const parsed = parseIp(addressPart ?? '');
  if (!parsed) throw invalidInput(`"${addressPart}" is not a valid IPv4 or IPv6 address.`);
  const maxBits = parsed.version === 4 ? 32 : 128;
  const prefixLength = prefixPart === null || prefixPart === '' ? maxBits : Number(prefixPart);
  if (!Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > maxBits) {
    throw invalidInput(`The prefix length must be between 0 and ${maxBits}.`);
  }

  const value = toBigInt(parsed);
  const hostBits = BigInt(maxBits - prefixLength);
  const allOnes = (1n << BigInt(maxBits)) - 1n;
  const mask = hostBits === 0n ? allOnes : allOnes ^ ((1n << hostBits) - 1n);
  const network = value & mask;
  const last = network | ((1n << hostBits) - 1n);
  const total = 1n << hostBits;

  const notes: string[] = [];
  let broadcastAddress: string | null = null;
  let firstUsable: string | null = null;
  let lastUsable: string | null = null;
  let usable: string | null = null;
  let wildcardMask: string | null = null;

  if (parsed.version === 4) {
    broadcastAddress = fromBigInt(last, 4);
    wildcardMask = fromBigInt(allOnes ^ mask, 4);
    if (prefixLength <= 30) {
      firstUsable = fromBigInt(network + 1n, 4);
      lastUsable = fromBigInt(last - 1n, 4);
      usable = (total - 2n).toString(10);
      notes.push('Two addresses are reserved in an IPv4 subnet: the network address and the broadcast address.');
    } else if (prefixLength === 31) {
      // RFC 3021: /31 point-to-point links have two usable addresses and no broadcast address.
      firstUsable = fromBigInt(network, 4);
      lastUsable = fromBigInt(last, 4);
      usable = '2';
      notes.push('A /31 is treated as an RFC 3021 point-to-point link: both addresses are usable and there is no broadcast address.');
    } else {
      firstUsable = fromBigInt(network, 4);
      lastUsable = fromBigInt(network, 4);
      usable = '1';
      notes.push('A /32 represents a single host.');
    }
  } else {
    // IPv6 has no broadcast address and no network/broadcast reservation.
    firstUsable = fromBigInt(network, 6);
    lastUsable = fromBigInt(last, 6);
    usable = total.toString(10);
    notes.push('IPv6 has no broadcast address; every address in the prefix is assignable.');
    if (prefixLength === 128) notes.push('A /128 identifies a single interface.');
    if (prefixLength < 64) {
      notes.push('Prefixes shorter than /64 break stateless address autoconfiguration and are not recommended for a subnet.');
    }
  }

  const binary = {
    network: parsed.version === 4 ? networkBinary(parsed.bytes, mask, 4) : networkBinary(parsed.bytes, mask, 6),
    mask: parsed.version === 4 ? networkBinary(bytesOf(mask, 4), mask, 4) : networkBinary(bytesOf(mask, 6), mask, 6),
  };

  return {
    input,
    version: parsed.version,
    prefixLength,
    cidr: `${fromBigInt(network, parsed.version)}/${prefixLength}`,
    networkAddress: fromBigInt(network, parsed.version),
    broadcastAddress,
    firstUsableAddress: firstUsable,
    lastUsableAddress: lastUsable,
    totalAddresses: total.toString(10),
    usableHosts: usable,
    subnetMask: parsed.version === 4 ? fromBigInt(mask, 4) : fromBigInt(mask, 6),
    wildcardMask,
    binary,
    isPrivate: isPrivateAddress(parsed.normalized),
    notes,
  };
}

function bytesOf(value: bigint, version: 4 | 6): number[] {
  const byteLength = version === 4 ? 4 : 16;
  const bytes: number[] = new Array(byteLength).fill(0);
  let remaining = value;
  for (let index = byteLength - 1; index >= 0; index -= 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

function networkBinary(bytes: number[], mask: bigint, version: 4 | 6): string {
  const maskBytes = bytesOf(mask, version);
  const octets: string[] = [];
  for (let index = 0; index < bytes.length; index += 1) {
    const masked = (bytes[index] ?? 0) & (maskBytes[index] ?? 0);
    octets.push(masked.toString(2).padStart(8, '0'));
  }
  return octets.join(version === 4 ? '.' : ' ');
}

export function isPrivateAddress(address: string): boolean {
  const parsed = parseIp(address);
  if (!parsed) return false;
  if (parsed.version === 4) {
    const [a = 0, b = 0] = parsed.bytes;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  const [first = 0, second = 0] = parsed.bytes;
  if ((first & 0xfe) === 0xfc) return true;
  if (first === 0xfe && (second & 0xc0) === 0x80) return true;
  if (parsed.bytes.slice(0, 15).every((byte) => byte === 0) && parsed.bytes[15] === 1) return true;
  return false;
}

export interface SubnetSplitResult {
  parent: SubnetInfo;
  newPrefixLength: number;
  subnets: SubnetInfo[];
  truncated: boolean;
  explanation: string;
}

/** Splits a network into equal subnets (spec §23 "Support subnet splitting"). */
export function splitSubnet(input: string, newPrefixLength: number, maxSubnets = 256): SubnetSplitResult {
  const parent = subnetInfo(input);
  const maxBits = parent.version === 4 ? 32 : 128;
  if (!Number.isInteger(newPrefixLength) || newPrefixLength <= parent.prefixLength || newPrefixLength > maxBits) {
    throw invalidInput(`The new prefix length must be greater than ${parent.prefixLength} and at most ${maxBits}.`);
  }
  const bits = newPrefixLength - parent.prefixLength;
  const count = 1n << BigInt(bits);
  const truncated = count > BigInt(maxSubnets);
  const limit = truncated ? BigInt(maxSubnets) : count;

  const parentNetwork = toBigInt(toBytes(parent.networkAddress));
  const step = 1n << BigInt(maxBits - newPrefixLength);
  const subnets: SubnetInfo[] = [];
  for (let index = 0n; index < limit; index += 1n) {
    const address = parentNetwork + index * step;
    subnets.push(subnetInfo(`${fromBigInt(address, parent.version)}/${newPrefixLength}`));
  }

  return {
    parent,
    newPrefixLength,
    subnets,
    truncated,
    explanation: truncated
      ? `Splitting ${parent.cidr} into /${newPrefixLength} produces ${count.toString(10)} subnets; the first ${maxSubnets} are listed.`
      : `Splitting ${parent.cidr} into /${newPrefixLength} produces ${count.toString(10)} subnets, all listed.`,
  };
}
