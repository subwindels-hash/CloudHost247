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
 *                  (untrusted peer, missing/invalid/oversized forwarding chain, or an allowlist
 *                  that could not be parsed).
 * - `not_public` — an address was verified but it is loopback, private, link-local or otherwise
 *                  not globally routable, so it is not presented as a visitor's public IP.
 */
export type VisitorIpReason = 'detected' | 'disabled' | 'unverified' | 'not_public';

export interface VisitorIpResolution {
  ip: string | null;
  reason: VisitorIpReason;
}

/** Plain-language explanation for each reason, shared by the header widget and the IP tool. */
export const VISITOR_IP_REASON_EXPLANATION: Record<VisitorIpReason, string> = {
  detected: 'Verified against this deployment\'s trusted network boundary.',
  disabled: 'IP detection is switched off on this server (VISITOR_IP_MODE=off), so no address is read from your connection.',
  unverified: 'IP detection is on, but the network boundary for this connection could not be verified, so no address is claimed.',
  not_public: 'The address observed for this connection is not a public one (loopback, private or reserved), so it is not reported as your IP.',
};

/**
 * Resolve only from a deployment-verified network boundary. Never consult Fastify's request.ip:
 * the main app currently trusts proxy headers globally, which is not a safe basis for this feature.
 */
export function resolveVisitorIpDetail(
  peer: string | undefined,
  forwardedFor: string | undefined,
  mode: Env['VISITOR_IP_MODE'],
  proxyList?: string
): VisitorIpResolution {
  if (mode === 'off') return { ip: null, reason: 'disabled' };
  if (!peer) return { ip: null, reason: 'unverified' };
  const socket = parseAddress(peer);
  if (!socket) return { ip: null, reason: 'unverified' };
  if (mode === 'direct') {
    return socket.range() === 'unicast'
      ? { ip: socket.toString(), reason: 'detected' }
      : { ip: null, reason: 'not_public' };
  }
  const subnets = trustedSubnets(proxyList);
  if (!subnets || !isTrusted(socket, subnets) || !forwardedFor || forwardedFor.length > 4096) {
    return { ip: null, reason: 'unverified' };
  }
  const chain = forwardedFor.split(',');
  if (chain.length > 16 || chain.some((item) => !parseAddress(item))) return { ip: null, reason: 'unverified' };
  // Traverse right-to-left from the known socket. The first untrusted hop is the visitor as seen
  // by the trusted proxy. Ignore any values the visitor supplied further to the left.
  for (let i = chain.length - 1; i >= 0; i--) {
    const address = parseAddress(chain[i]!);
    if (!address) return { ip: null, reason: 'unverified' };
    if (isTrusted(address, subnets)) continue;
    return address.range() === 'unicast'
      ? { ip: address.toString(), reason: 'detected' }
      : { ip: null, reason: 'not_public' };
  }
  return { ip: null, reason: 'unverified' };
}

/** Address-only view of {@link resolveVisitorIpDetail}, for callers that just need the IP. */
export function resolveVisitorIp(peer: string | undefined, forwardedFor: string | undefined, mode: Env['VISITOR_IP_MODE'], proxyList?: string): string | null {
  return resolveVisitorIpDetail(peer, forwardedFor, mode, proxyList).ip;
}

/** Reads the visitor IP the same way on every request path: socket peer plus one forwarding header. */
export function resolveVisitorIpFromRequest(
  request: { raw: { socket: { remoteAddress?: string } }; headers: Record<string, string | string[] | undefined> },
  env: Env
): VisitorIpResolution {
  const forwarded = request.headers['x-forwarded-for'];
  return resolveVisitorIpDetail(
    request.raw.socket.remoteAddress,
    typeof forwarded === 'string' ? forwarded : undefined,
    env.VISITOR_IP_MODE,
    env.VISITOR_IP_TRUSTED_PROXIES
  );
}

export async function registerVisitorIpRoute(app: FastifyInstance, env: Env) {
  app.get('/api/v1/visitor/ip', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store, max-age=0');
    reply.header('Pragma', 'no-cache');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    // The answer depends on the forwarding header, so any cache in front must key on it. Matches
    // /api/v1/currency/geo-country, which resolves the visitor address the same way.
    reply.header('Vary', 'X-Forwarded-For');
    // There is no reliable VPN/proxy intelligence source configured; an address alone cannot prove
    // whether privacy protection is present or absent. Do not log, store or send the IP elsewhere.
    const { ip, reason } = resolveVisitorIpFromRequest(request, env);
    return { ip, reason, privacyStatus: 'unknown' as const };
  });
}
