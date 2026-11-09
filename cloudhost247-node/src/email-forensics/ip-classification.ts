/**
 * IP address classification for the forensics analyzer.
 *
 * Classifies an IPv4/IPv6 address as private, reserved, loopback, multicast, or public, using
 * only local logic and `ipaddr.js` — no external lookup. This is the *computed* classification
 * of an address's address space, independent of any geolocation database.
 *
 * RFC references applied locally:
 *   - IPv4 private: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16  (RFC 1918)
 *   - IPv4 loopback: 127.0.0.0/8                              (RFC 1122 / RFC 5735)
 *   - IPv4 link-local: 169.254.0.0/16                         (RFC 3927) -> reserved
 *   - IPv4 multicast: 224.0.0.0/4                             (RFC 5771)
 *   - IPv4 reserved: 0.0.0.0/8, TEST-NET ranges, 240.0.0.0/4  (RFC 5735)
 *   - IPv6 loopback: ::1/128                                  (RFC 4291)
 *   - IPv6 link-local: fe80::/10                              (RFC 4291) -> reserved
 *   - IPv6 unique local: fc00::/7                             (RFC 4193) -> private
 *   - IPv6 multicast: ff00::/8                                (RFC 4291)
 *   - IPv6 documentation: 2001:db8::/32                       (RFC 3849) -> reserved
 */

import ipaddr from 'ipaddr.js';

type IPAddress = ReturnType<typeof ipaddr.parse>;

/** Address classes this module produces. */
export type AddressClass =
  | 'private'
  | 'reserved'
  | 'loopback'
  | 'multicast'
  | 'public'
  | 'unavailable';

const RULES: Array<{ cidr: string; label: AddressClass }> = [
  // IPv4
  { cidr: '127.0.0.0/8', label: 'loopback' },
  { cidr: '10.0.0.0/8', label: 'private' },
  { cidr: '172.16.0.0/12', label: 'private' },
  { cidr: '192.168.0.0/16', label: 'private' },
  { cidr: '169.254.0.0/16', label: 'reserved' }, // link-local
  { cidr: '0.0.0.0/8', label: 'reserved' },
  { cidr: '192.0.2.0/24', label: 'reserved' },   // TEST-NET-1
  { cidr: '198.51.100.0/24', label: 'reserved' }, // TEST-NET-2
  { cidr: '203.0.113.0/24', label: 'reserved' },  // TEST-NET-3
  { cidr: '224.0.0.0/4', label: 'multicast' },
  { cidr: '240.0.0.0/4', label: 'reserved' },
  // IPv6
  { cidr: '::1/128', label: 'loopback' },
  { cidr: 'fe80::/10', label: 'reserved' }, // link-local
  { cidr: 'fc00::/7', label: 'private' },   // unique local
  { cidr: 'ff00::/8', label: 'multicast' },
  { cidr: '2001:db8::/32', label: 'reserved' }, // documentation
];

/** Parse the CIDR rules once into network address + prefix. */
const PARSED_RULES: Array<{ network: IPAddress; prefix: number; label: AddressClass }> =
  RULES.map(({ cidr, label }) => {
    const [network, prefix] = ipaddr.parseCIDR(cidr);
    return { network, prefix, label };
  });

/** Validate an IP string (IPv4 or IPv6). Returns null when invalid. */
export function validateIp(ip: string): string | null {
  if (typeof ip !== 'string' || ip.trim() === '') return null;
  try {
    return ipaddr.isValid(ip) ? ip : null;
  } catch {
    return null;
  }
}

/** Return 'ipv4' | 'ipv6' for a valid IP, or null when invalid. */
export function ipVersion(ip: string): 'ipv4' | 'ipv6' | null {
  const cleaned = validateIp(ip);
  if (!cleaned) return null;
  try {
    return ipaddr.parse(cleaned).kind() === 'ipv6' ? 'ipv6' : 'ipv4';
  } catch {
    return null;
  }
}

/** Test whether `ip` falls within the CIDR `network/prefix`. */
function isInCidr(ip: IPAddress, network: IPAddress, prefix: number): boolean {
  if (ip instanceof ipaddr.IPv4 && network instanceof ipaddr.IPv4) {
    const ipInt = octetsToInt(ip.octets);
    const netInt = octetsToInt(network.octets);
    const mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
    return (ipInt & mask) === (netInt & mask);
  }
  if (ip instanceof ipaddr.IPv6 && network instanceof ipaddr.IPv6) {
    // IPv6: compare part by part (16-bit groups) with bit masking.
    const ipSegs = (ip as unknown as { parts: number[] }).parts;
    const netSegs = (network as unknown as { parts: number[] }).parts;
    let remaining = prefix;
    for (let i = 0; i < 8; i += 1) {
      if (remaining <= 0) break;
      const bits = Math.min(16, remaining);
      const mask = bits === 16 ? 0xFFFF : ((0xFFFF << (16 - bits)) & 0xFFFF);
      if ((ipSegs[i]! & mask) !== (netSegs[i]! & mask)) return false;
      remaining -= bits;
    }
    return true;
  }
  return false;
}

function octetsToInt(octets: number[]): number {
  return (
    ((octets[0]! * 0x1000000 + octets[1]! * 0x10000 + octets[2]! * 0x100 + octets[3]!) >>> 0)
  );
}

/**
 * Classify a single IP address into an address class.
 *
 * Returns 'unavailable' when the address cannot be parsed at all. Never throws.
 */
export function classifyAddress(ip: string): AddressClass {
  const cleaned = validateIp(ip);
  if (!cleaned) return 'unavailable';
  try {
    const parsed = ipaddr.parse(cleaned);
    for (const { network, prefix, label } of PARSED_RULES) {
      if (isInCidr(parsed, network, prefix)) return label;
    }
    return 'public';
  } catch {
    return 'unavailable';
  }
}

/**
 * Classify many addresses at once. Returns a map keyed by the original input string so callers
 * can keep the raw header value alongside its class.
 */
export function classifyAddresses(ips: string[]): Record<string, AddressClass> {
  const out: Record<string, AddressClass> = {};
  for (const ip of ips) out[ip] = classifyAddress(ip);
  return out;
}

/** True when an address class is one of the non-public (internal/hidden) classes. */
export function isNonPublic(addressClass: AddressClass): boolean {
  return addressClass !== 'public' && addressClass !== 'unavailable';
}

/** True when an address class represents a private/internal network. */
export function isPrivate(addressClass: AddressClass): boolean {
  return addressClass === 'private';
}

/** True when an address class is loopback. */
export function isLoopback(addressClass: AddressClass): boolean {
  return addressClass === 'loopback';
}
