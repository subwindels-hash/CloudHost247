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

function isTrusted(address: Address, subnets: Subnet[]): boolean {
  return subnets.some(([network, prefix]) => address.kind() === network.kind() && address.match(network, prefix));
}

/** Resolve only from a deployment-verified network boundary. Never consult Fastify's request.ip:
 * the main app currently trusts proxy headers globally, which is not a safe basis for this feature. */
export function resolveVisitorIp(peer: string | undefined, forwardedFor: string | undefined, mode: Env['VISITOR_IP_MODE'], proxyList?: string): string | null {
  if (mode === 'off' || !peer) return null;
  const socket = parseAddress(peer);
  if (!socket) return null;
  if (mode === 'direct') return socket.range() === 'unicast' ? socket.toString() : null;
  const subnets = trustedSubnets(proxyList);
  if (!subnets || !isTrusted(socket, subnets) || !forwardedFor || forwardedFor.length > 4096) return null;
  const chain = forwardedFor.split(',');
  if (chain.length > 16 || chain.some((item) => !parseAddress(item))) return null;
  // Traverse right-to-left from the known socket. The first untrusted hop is the visitor as seen
  // by the trusted proxy. Ignore any values the visitor supplied further to the left.
  for (let i = chain.length - 1; i >= 0; i--) {
    const address = parseAddress(chain[i]!);
    if (!address) return null;
    if (isTrusted(address, subnets)) continue;
    return address.range() === 'unicast' ? address.toString() : null;
  }
  return null;
}

export async function registerVisitorIpRoute(app: FastifyInstance, env: Env) {
  app.get('/api/v1/visitor/ip', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store, max-age=0');
    reply.header('Pragma', 'no-cache');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    const header = request.headers['x-forwarded-for'];
    const ip = resolveVisitorIp(request.raw.socket.remoteAddress, typeof header === 'string' ? header : undefined, env.VISITOR_IP_MODE, env.VISITOR_IP_TRUSTED_PROXIES);
    // There is no reliable VPN/proxy intelligence source configured; an address alone cannot prove
    // whether privacy protection is present or absent. Do not log, store or send the IP elsewhere.
    return { ip, privacyStatus: 'unknown' as const };
  });
}
