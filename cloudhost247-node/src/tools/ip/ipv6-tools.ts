/**
 * IPv6 helpers for the Local IPv6 Address Generator and the IPv6 Compatibility Checker.
 */
import { randomBytes } from 'node:crypto';
import { isIPv6 } from 'node:net';

export interface UlaResult {
  prefix: string;
  globalId: string;
  subnetId: string;
  subnetPrefix: string;
  sampleAddress: string;
  explanation: string;
}

/**
 * RFC 4193 unique local address: fd00::/8 prefix, a pseudo-random 40-bit Global ID, a 16-bit
 * subnet ID. ULA addresses are for private networks and are not routed on the public internet.
 * `random` is injectable so tests can check the layout deterministically.
 */
export function generateUla(
  subnetIdHex = '0000',
  random: (size: number) => Buffer = randomBytes
): UlaResult {
  const subnetId = subnetIdHex.trim().toLowerCase().padStart(4, '0');
  if (!/^[0-9a-f]{1,4}$/.test(subnetId)) throw new Error('Subnet ID must be 1 to 4 hexadecimal digits (0000 to ffff).');
  const globalBytes = random(5);
  if (globalBytes.length !== 5) throw new Error('Random source returned the wrong number of bytes.');
  const globalHex = globalBytes.toString('hex'); // 10 hex digits = 40 bits
  const groups = [`fd${globalHex.slice(0, 2)}`, globalHex.slice(2, 6), globalHex.slice(6, 10)];
  const prefix = `${groups.join(':')}::/48`;
  const subnetPrefix = `${groups.join(':')}:${subnetId}::/64`;
  const sampleAddress = `${groups.join(':')}:${subnetId}::1`;
  return {
    prefix,
    globalId: globalHex,
    subnetId,
    subnetPrefix,
    sampleAddress,
    explanation:
      'Unique local addresses (RFC 4193) are for private use: internal networks, labs and services that never leave your premises. They are not routed on the public internet, and the Global ID is random so separately generated prefixes are unlikely to collide.',
  };
}

export type Ipv6Verdict = 'IPV6_ADDRESSES_PUBLISHED' | 'IPV4_ONLY' | 'NO_ADDRESS_RECORDS';

export interface Ipv6Classification {
  verdict: Ipv6Verdict;
  ipv6Addresses: string[];
  ipv4Addresses: string[];
  explanation: string;
}

/**
 * Classifies the published address records. An AAAA record shows the name publishes an IPv6
 * address; it does not prove the address answers connections, so the explanation says that.
 */
export function classifyIpv6(aaaaValues: string[], aValues: string[]): Ipv6Classification {
  const ipv6Addresses = [...new Set(aaaaValues.map((v) => v.trim()).filter((v) => isIPv6(v)))];
  const ipv4Addresses = [...new Set(aValues.map((v) => v.trim()).filter((v) => /^\d{1,3}(\.\d{1,3}){3}$/.test(v)))];
  if (ipv6Addresses.length > 0) {
    return {
      verdict: 'IPV6_ADDRESSES_PUBLISHED',
      ipv6Addresses,
      ipv4Addresses,
      explanation: 'The name publishes at least one AAAA (IPv6) record. This confirms the DNS publication only; it does not prove that the address accepts connections on port 80 or 443.',
    };
  }
  if (ipv4Addresses.length > 0) {
    return {
      verdict: 'IPV4_ONLY',
      ipv6Addresses,
      ipv4Addresses,
      explanation: 'The name publishes IPv4 (A) records but no AAAA record, so IPv6-only clients cannot reach it through this name.',
    };
  }
  return {
    verdict: 'NO_ADDRESS_RECORDS',
    ipv6Addresses,
    ipv4Addresses,
    explanation: 'No A or AAAA records were returned for this name, so neither protocol can reach it through the DNS as queried.',
  };
}
