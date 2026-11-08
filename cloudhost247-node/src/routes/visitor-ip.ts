import type { FastifyInstance } from 'fastify';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import type { Env } from '../config/env';

type Address = ipaddr.IPv4 | ipaddr.IPv6;
type Subnet = [Address, number];

function parseAddress(value: string): Address | null {
  const raw = value.trim();
  // Node's strict parser avoids abbreviated/octal IPv4, ports, zone IDs and injected values.
  if (!isIP(raw)) return null;
  try { return ipaddr.process(raw); } catch { return null; }
}

/** Strips the quoting/bracketing/port syntax RFC 7239 and proxy conventions allow around an address. */
function bareAddress(token: string): string {
  let value = token.trim();
  if (value.startsWith('"') && value.endsWith('"') && value.length > 1) value = value.slice(1, -1);
  if (value.startsWith('[')) {
    const close = value.indexOf(']');
    if (close > 0) value = value.slice(1, close);
  } else if (value.includes(':') && value.split(':').length === 2 && isIP(value.split(':')[0]!) === 4) {
    value = value.split(':')[0]!; // IPv4:port
  }
  return value.trim();
}

function trustedSubnets(value: string | undefined): Subnet[] | null {
  if (!value) return null;
  const tokens = value.split(',').map((part) => part.trim());
  if (!tokens.length || tokens.length > 64 || tokens.some((token) => !token)) return null;
  try {
    return tokens.map((token) => {
      const slash = token.indexOf('/');
      if (slash === -1) {
        const ip = parseAddress(token);
        if (!ip) throw new Error('invalid address');
        return [ip, ip.kind() === 'ipv4' ? 32 : 128] as Subnet;
      }
      const raw = token.slice(0, slash);
      if (!isIP(raw) || raw.includes('%')) throw new Error('invalid subnet');
      const subnet = ipaddr.parseCIDR(token);
      if (subnet[1] === 0) throw new Error('all addresses cannot be trusted');
      return subnet;
    });
  } catch { return null; }
}

/**
 * Whether a configured `VISITOR_IP_TRUSTED_PROXIES` value is usable. Exported for the operator
 * pre-flight (`npm run env:check`), where an invalid allowlist is a hard error: the resolver fails
 * closed, so a typo silently turns the header's IP detector off instead of crashing anything.
 */
export function trustedProxyAllowlistIsValid(value: string | undefined): boolean {
  return trustedSubnets(value) !== null;
}

function isTrusted(address: Address, subnets: Subnet[]): boolean {
  return subnets.some(([network, prefix]) => address.kind() === network.kind() && address.match(network, prefix));
}

/**
 * Why a detection produced no address, as the public endpoint and the "What Is My IP" tool report
 * it. Deliberately coarse: it must let the UI explain itself honestly without disclosing the
 * configured allowlist, the peer address, or which hop in a forwarding chain failed.
 *
 * - `detected`   — a verified public address was found and is returned beside this reason.
 * - `disabled`   — `VISITOR_IP_MODE=off`. The deployment has not turned detection on.
 * - `unverified` — detection is on but this connection's network boundary could not be verified
 *                  (untrusted peer, or no forwarding/edge header carried an address at all).
 * - `not_public` — an address was verified but it is loopback, private, link-local or otherwise
 *                  not globally routable, so it is not presented as a visitor's public IP.
 */
export type VisitorIpReason = 'detected' | 'disabled' | 'unverified' | 'not_public';

/** Which header the verified address came from, for logs and tests. Never an address. */
export type VisitorIpSource = 'cf-connecting-ip' | 'x-real-ip' | 'forwarded' | 'x-forwarded-for' | null;

export interface VisitorIpResolution {
  ip: string | null;
  reason: VisitorIpReason;
  /** Present in the request and consulted; null when nothing carried an address. */
  source: VisitorIpSource;
  /** Whether the connecting peer matched VISITOR_IP_TRUSTED_PROXIES (always true in direct mode). */
  peerTrusted: boolean;
}

/** Plain-language explanation for each reason, shared by the header widget and the IP tool. */
export const VISITOR_IP_REASON_EXPLANATION: Record<VisitorIpReason, string> = {
  detected: 'Verified against this deployment\'s trusted network boundary.',
  disabled: 'IP detection is switched off on this server (VISITOR_IP_MODE=off), so no address is read from your connection.',
  unverified: 'IP detection is on, but the network path to this server could not be verified for your connection, so no address is claimed.',
  not_public: 'The address observed for this connection is not a public one (loopback, private or reserved), so it is not reported as your IP.',
};

/**
 * Single-value headers a correctly configured edge *overwrites* rather than appends to, so unlike
 * an X-Forwarded-For chain they cannot be polluted by a client even if the edge is misconfigured.
 * Cloudflare sets CF-Connecting-IP; nginx and Apache mod_remoteip setups conventionally set
 * X-Real-IP. Both are consulted only after the peer itself passed the allowlist, so an untrusted
 * caller asserting either is ignored exactly like a spoofed chain.
 */
const EDGE_HEADERS = ['cf-connecting-ip', 'x-real-ip'] as const;

function chainAddresses(header: string | undefined, rfc7239: boolean): Address[] | null {
  if (!header || header.length > 4096) return null;
  const entries = header.split(',');
  if (entries.length > 16) return null;
  const addresses: Address[] = [];
  for (const entry of entries) {
    let token = entry.trim();
    if (!token) return null;
    if (rfc7239) {
      // `Forwarded: for=192.0.2.43;by=203.0.113.1, for="[2001:db8::1]:8080"` — take each for=.
      const directive = token.split(';').map((part) => part.trim()).find((part) => part.toLowerCase().startsWith('for='));
      if (!directive) return null;
      token = directive.slice(4);
    }
    const address = parseAddress(bareAddress(token));
    if (!address) return null;
    addresses.push(address);
  }
  return addresses.length ? addresses : null;
}

/**
 * Resolve only from a deployment-verified network boundary. Never consult Fastify's request.ip:
 * the main app currently trusts proxy headers globally, which is not a safe basis for this feature.
 */
export function resolveVisitorIpDetail(
  peer: string | undefined,
  headers: Record<string, string | string[] | undefined>,
  mode: Env['VISITOR_IP_MODE'],
  proxyList?: string
): VisitorIpResolution {
  const headerOf = (name: string): string | undefined => {
    const value = headers[name];
    return typeof value === 'string' ? value : undefined;
  };
  if (mode === 'off') return { ip: null, reason: 'disabled', source: null, peerTrusted: false };
  if (!peer) return { ip: null, reason: 'unverified', source: null, peerTrusted: false };
  const socket = parseAddress(peer);
  if (!socket) return { ip: null, reason: 'unverified', source: null, peerTrusted: false };
  if (mode === 'direct') {
    return socket.range() === 'unicast'
      ? { ip: socket.toString(), reason: 'detected', source: null, peerTrusted: true }
      : { ip: null, reason: 'not_public', source: null, peerTrusted: true };
  }
  const subnets = trustedSubnets(proxyList);
  if (!subnets || !isTrusted(socket, subnets)) {
    return { ip: null, reason: 'unverified', source: null, peerTrusted: false };
  }

  // The first source present decides. An edge that states the client address outright is preferred
  // over an append-only chain; falling through to a second header would let one override the other.
  for (const name of EDGE_HEADERS) {
    const raw = headerOf(name);
    if (raw === undefined) continue;
    const address = parseAddress(bareAddress(raw));
    if (!address) return { ip: null, reason: 'unverified', source: name, peerTrusted: true };
    return address.range() === 'unicast'
      ? { ip: address.toString(), reason: 'detected', source: name, peerTrusted: true }
      : { ip: null, reason: 'not_public', source: name, peerTrusted: true };
  }

  for (const [name, rfc7239] of [['forwarded', true], ['x-forwarded-for', false]] as const) {
    const raw = headerOf(name);
    if (raw === undefined) continue;
    const chain = chainAddresses(raw, rfc7239);
    // An explicitly-present but malformed preferred chain is a hard no; do not let a second,
    // potentially unsanitized chain override it.
    if (!chain) return { ip: null, reason: 'unverified', source: name, peerTrusted: true };
    // Traverse right-to-left from the known socket. The first untrusted hop is the visitor as seen
    // by the trusted proxy. Ignore any values the visitor supplied further to the left.
    for (let i = chain.length - 1; i >= 0; i--) {
      const address = chain[i]!;
      if (isTrusted(address, subnets)) continue;
      return address.range() === 'unicast'
        ? { ip: address.toString(), reason: 'detected', source: name, peerTrusted: true }
        : { ip: null, reason: 'not_public', source: name, peerTrusted: true };
    }
    return { ip: null, reason: 'unverified', source: name, peerTrusted: true };
  }

  return { ip: null, reason: 'unverified', source: null, peerTrusted: true };
}

/** Address-only view of {@link resolveVisitorIpDetail}, for callers that just need the IP. */
export function resolveVisitorIp(peer: string | undefined, headers: Record<string, string | string[] | undefined>, mode: Env['VISITOR_IP_MODE'], proxyList?: string): string | null {
  return resolveVisitorIpDetail(peer, headers, mode, proxyList).ip;
}

/** Reads the visitor IP the same way on every request path: socket peer plus the edge headers. */
export function resolveVisitorIpFromRequest(
  request: { raw: { socket: { remoteAddress?: string } }; headers: Record<string, string | string[] | undefined> },
  env: Env
): VisitorIpResolution {
  return resolveVisitorIpDetail(request.raw.socket.remoteAddress, request.headers, env.VISITOR_IP_MODE, env.VISITOR_IP_TRUSTED_PROXIES);
}

/** Headers whose value can change the answer, so any cache in front must key on all of them. */
export const VISITOR_IP_VARY = 'CF-Connecting-IP, X-Real-IP, Forwarded, X-Forwarded-For';

export async function registerVisitorIpRoute(app: FastifyInstance, env: Env) {
  app.get('/api/v1/visitor/ip', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store, max-age=0');
    reply.header('Pragma', 'no-cache');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    // The answer depends on these headers, so an intermediary cache must key on them. Matches
    // /api/v1/currency/geo-country, which resolves the visitor address the same way.
    reply.header('Vary', VISITOR_IP_VARY);
    const resolution = resolveVisitorIpFromRequest(request, env);
    // Address-free diagnostics: which header carried the answer (or that none did), never the
    // address itself, so an operator can see why a deployment reports nothing without the log
    // becoming a record of visitor addresses.
    request.log.info(
      { visitorIp: { mode: env.VISITOR_IP_MODE, peerTrusted: resolution.peerTrusted, source: resolution.source, reason: resolution.reason } },
      'visitor ip boundary'
    );
    // There is no reliable VPN/proxy intelligence source configured; an address alone cannot prove
    // whether privacy protection is present or absent. Do not log, store or send the IP elsewhere.
    return { ip: resolution.ip, reason: resolution.reason, privacyStatus: 'unknown' as const };
  });
}
