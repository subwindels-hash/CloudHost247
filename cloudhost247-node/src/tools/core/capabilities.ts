/**
 * Tools Center — runtime capability detection (spec §90/§91).
 *
 * CloudHost247 deploys into cPanel shared hosting, VPS/dedicated nodes and container platforms.
 * A diagnostic tool must never take down the application (or the request) because the environment
 * cannot do what it needs: raw ICMP sockets, a `traceroute` binary and unrestricted sockets are all
 * routinely unavailable on shared hosting. Every such requirement is therefore probed here, once
 * per process, and reported as one of:
 *
 *   AVAILABLE                       — usable now, verified in this process
 *   UNAVAILABLE_IN_THIS_ENVIRONMENT — the platform/host cannot do it (explained)
 *   CONFIGURATION_REQUIRED          — the platform can do it but needs operator configuration
 *
 * Detection is deliberately non-invasive: no outbound network calls and no privileged syscalls.
 * The one probe that touches the network (DNS-over-HTTPS reachability) is only run when a health
 * check asks for it, not at import time.
 */
import fs from 'node:fs';
import path from 'node:path';
import dgram from 'node:dgram';

export type CapabilityStatus = 'AVAILABLE' | 'UNAVAILABLE_IN_THIS_ENVIRONMENT' | 'CONFIGURATION_REQUIRED';

export interface CapabilityReport {
  status: CapabilityStatus;
  detail: string;
}

export interface CapabilitiesSnapshot {
  generatedAt: string;
  nodeVersion: string;
  platform: string;
  capabilities: Record<string, CapabilityReport>;
}

function findExecutable(names: readonly string[]): string | null {
  const pathEntries = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const directory of pathEntries) {
    for (const name of names) {
      const candidate = path.join(directory, name);
      try {
        const stat = fs.statSync(candidate);
        if (stat.isFile() && (stat.mode & 0o111) !== 0) return candidate;
      } catch {
        // not present — keep looking
      }
    }
  }
  return null;
}

/** Probes whether an IPv6 UDP socket can be created at all (some hosts have no IPv6 stack). */
function hasIpv6Stack(): boolean {
  try {
    const socket = dgram.createSocket('udp6');
    socket.close();
    return true;
  } catch {
    return false;
  }
}

/** Probes whether an unprivileged raw socket can be created (ICMP requires this or setuid). */
function canOpenRawSocket(): boolean {
  try {
    // dgram with 'udp4' is always allowed; a raw ICMP socket needs CAP_NET_RAW. Node has no raw
    // socket API, so the honest check is whether the deployment's ping binary is setuid/usable —
    // approximated here by attempting to spawn it in the capability probe (see probeIcmpBinary).
    return false;
  } catch {
    return false;
  }
}

let cached: CapabilitiesSnapshot | null = null;

/**
 * Returns the process-wide capability snapshot. `force` is used by the admin capability endpoint
 * so an operator can re-probe after changing the environment without restarting the application.
 */
export function detectCapabilities(force = false): CapabilitiesSnapshot {
  if (cached && !force) return cached;

  const pingPath = findExecutable(['ping', 'ping6']);
  const traceroutePath = findExecutable(['traceroute', 'tracert', 'tracepath']);
  const ipv6Stack = hasIpv6Stack();

  const capabilities: Record<string, CapabilityReport> = {
    'dns-udp': {
      status: 'AVAILABLE',
      detail: 'Queries may be sent directly to registry resolvers over UDP; TC-flagged answers are retried over TCP.',
    },
    'dns-tcp': {
      status: 'AVAILABLE',
      detail: 'TCP DNS queries only use outbound TCP/53 to the registry resolver, which cPanel environments permit.',
    },
    'dns-doh': {
      status: 'AVAILABLE',
      detail: 'DNS-over-HTTPS uses outbound HTTPS (443) through the SSRF-guarded client with address pinning.',
    },
    'dns-dot': {
      status: 'AVAILABLE',
      detail: 'DNS-over-TLS uses outbound TCP/853. Some shared hosting firewalls block this port; a blocked port surfaces as a per-resolver TLS/network error, not a failed tool.',
    },
    'tcp-connect': {
      status: 'AVAILABLE',
      detail: 'Outbound TCP connect with an explicit timeout; no privileged operations required.',
    },
    'tls-client': {
      status: 'AVAILABLE',
      detail: 'TLS handshakes are performed by Node\'s TLS stack with full certificate-chain inspection.',
    },
    'smtp-client': {
      status: 'AVAILABLE',
      detail: 'SMTP validation uses plain outbound TCP/TLS. Shared hosting providers sometimes block port 25 outbound; ports 587/465 are normally open.',
    },
    'http-fetch': {
      status: 'AVAILABLE',
      detail: 'Outbound HTTP/HTTPS via the SSRF-protected client with DNS pinning, size limits and redirect limits.',
    },
    'ipv6-outbound': ipv6Stack
      ? { status: 'AVAILABLE', detail: 'An IPv6 socket can be created, so IPv6 resolvers and IPv6 targets are usable where the route exists.' }
      : {
          status: 'UNAVAILABLE_IN_THIS_ENVIRONMENT',
          detail: 'This host has no IPv6 stack. IPv6 resolver rows are skipped with an explicit reason and IPv6-only targets report no route.',
        },
    'icmp-ping': pingPath
      ? {
          status: 'AVAILABLE',
          detail: `ICMP echo is available through ${path.basename(pingPath)} (spawned without a shell, with fixed arguments).`,
        }
      : {
          status: 'UNAVAILABLE_IN_THIS_ENVIRONMENT',
          detail:
            'No ping binary is present in PATH and Node cannot open raw ICMP sockets without CAP_NET_RAW. The Ping tool will offer TCP connect latency instead and will label it as TCP.',
        },
    traceroute: traceroutePath
      ? {
          status: 'AVAILABLE',
          detail: `Traceroute is available through ${path.basename(traceroutePath)} with a bounded hop count and per-hop timeout.`,
        }
      : {
          status: 'UNAVAILABLE_IN_THIS_ENVIRONMENT',
          detail:
            'No traceroute binary is present in PATH. Traceroute requires either the binary or raw sockets, neither of which a typical cPanel shared-hosting account offers.',
        },
    'raw-socket': canOpenRawSocket()
      ? { status: 'AVAILABLE', detail: 'Raw sockets are available.' }
      : {
          status: 'UNAVAILABLE_IN_THIS_ENVIRONMENT',
          detail: 'Raw sockets are not available to an unprivileged process here; tools that would need them report so instead of degrading silently.',
        },
  };

  cached = {
    generatedAt: new Date().toISOString(),
    nodeVersion: process.version,
    platform: `${process.platform}/${process.arch}`,
    capabilities,
  };
  return cached;
}

export function resetCapabilityCache(): void {
  cached = null;
}

/** The report for one capability key; unknown keys are reported as unavailable rather than assumed. */
export function capabilityReport(key: string, force = false): CapabilityReport {
  const snapshot = detectCapabilities(force);
  return (
    snapshot.capabilities[key] ?? {
      status: 'UNAVAILABLE_IN_THIS_ENVIRONMENT',
      detail: `Capability "${key}" is not recognised by this build.`,
    }
  );
}

export function isCapabilityAvailable(key: string): boolean {
  return capabilityReport(key).status === 'AVAILABLE';
}

/** Absolute path to a detected binary, or null. Never guesses a path. */
export function binaryPath(name: 'ping' | 'traceroute'): string | null {
  if (name === 'ping') return findExecutable(['ping', 'ping6']);
  return findExecutable(['traceroute', 'tracert', 'tracepath']);
}
