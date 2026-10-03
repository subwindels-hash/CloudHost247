/**
 * Tools Center — ping and traceroute (spec §24, §25).
 *
 * Security posture (this is the file where a "diagnostics platform" usually becomes an abuse
 * platform):
 *   - Targets are validated by the SSRF layer, so private, link-local, loopback, multicast and
 *     metadata ranges are refused outright.
 *   - The binaries are executed with `execFile` and an argument array — never a shell — and every
 *     argument is either a fixed flag or a strictly validated hostname/IP.
 *   - Packet counts, hop counts, per-hop timeouts and total runtime are hard-capped here, not by
 *     the caller.
 *   - If the ICMP binary is unavailable (the normal case on cPanel shared hosting), ping degrades
 *     to TCP connect timing and says so explicitly. Traceroute reports
 *     UNAVAILABLE_IN_THIS_ENVIRONMENT rather than inventing hops.
 */
import { execFile } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { binaryPath, capabilityReport } from '../core/capabilities';
import { invalidInput, capabilityUnavailable, targetBlocked, ToolError } from '../core/errors';
import { parseIp, resolvePublicAddresses, tcpConnect } from '../core/ssrf';

export interface PingProbe {
  sequence: number;
  rttMs: number | null;
  status: 'OK' | 'TIMEOUT' | 'ERROR';
  detail: string;
}

export interface PingResult {
  target: string;
  resolvedAddresses: string[];
  method: 'ICMP' | 'TCP';
  port: number | null;
  packetsSent: number;
  packetsReceived: number;
  packetLossPercent: number;
  rtt: { minMs: number | null; maxMs: number | null; avgMs: number | null; jitterMs: number | null };
  probes: PingProbe[];
  capability: { status: string; detail: string };
  explanation: string;
  warnings: string[];
}

const MAX_PACKET_COUNT = 5;
const ICMP_TIMEOUT_SECONDS = 2;

function validateTarget(target: string): string {
  const trimmed = target.trim();
  if (trimmed.length === 0) throw invalidInput('Enter a hostname or IP address to ping.');
  const literal = parseIp(trimmed.replace(/^\[|\]$/g, ''));
  if (literal) return literal.normalized;
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(trimmed)) {
    throw invalidInput('Enter a public hostname or IP address (no scheme, path, port or spaces).');
  }
  return trimmed.toLowerCase();
}

function runBinary(file: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string; code: number | null; timedOut: boolean }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 256 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      // execFile sets `killed` when the timeout fired; the flag is not in the public type surface.
      const timedOut = Boolean(error && (error as { killed?: boolean }).killed);
      resolve({
        stdout: stdout ?? '',
        stderr: stderr ?? '',
        code: error && typeof (error as { code?: unknown }).code === 'number' ? ((error as { code?: number }).code ?? null) : null,
        timedOut,
      });
    });
  });
}

/**
 * Parses ping output across the common implementations (iputils, busybox, BSD/macOS) without
 * assuming a locale: the statistics line always contains the numbers we need.
 */
export function parsePingOutput(stdout: string): { transmitted: number; received: number; lossPercent: number; min: number | null; avg: number | null; max: number | null; mdev: number | null } | null {
  const packets = /(\d+)\s+packets transmitted,\s+(\d+)\s+(?:packets )?received/i.exec(stdout);
  const legacy = /(\d+)\s+packets transmitted,\s+(\d+)\s+received/i.exec(stdout);
  const loss = /([\d.]+)%\s*(?:packet )?loss/i.exec(stdout);
  const timing = /=\s*([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+)\s*ms/.exec(stdout);

  const groups = packets ?? legacy;
  if (!groups) return null;
  return {
    transmitted: Number.parseInt(groups[1] ?? '0', 10),
    received: Number.parseInt(groups[2] ?? '0', 10),
    lossPercent: loss ? Number.parseFloat(loss[1] ?? '0') : groups[1] && groups[2] ? ((Number(groups[1]) - Number(groups[2])) / Number(groups[1])) * 100 : 0,
    min: timing ? Number.parseFloat(timing[1] ?? '0') : null,
    avg: timing ? Number.parseFloat(timing[2] ?? '0') : null,
    max: timing ? Number.parseFloat(timing[3] ?? '0') : null,
    mdev: timing ? Number.parseFloat(timing[4] ?? '0') : null,
  };
}

export interface PingOptions {
  target: string;
  count?: number;
  /** When ICMP is unavailable, the TCP port used for connect timing (default 443). */
  tcpPort?: number;
  /** Force TCP mode even when ICMP is available. */
  forceTcp?: boolean;
}

export async function ping(options: PingOptions): Promise<PingResult> {
  const target = validateTarget(options.target);
  const count = Math.min(Math.max(options.count ?? 4, 1), MAX_PACKET_COUNT);
  const tcpPort = options.tcpPort ?? 443;
  if (!Number.isInteger(tcpPort) || tcpPort < 1 || tcpPort > 65535) throw invalidInput('The TCP port must be between 1 and 65535.');

  // Refuses private/reserved targets before a single packet is sent.
  const addresses = await resolvePublicAddresses(target);
  const capability = capabilityReport('icmp-ping');
  const warnings: string[] = [];
  const useIcmp = capability.status === 'AVAILABLE' && options.forceTcp !== true && addresses.every((address) => parseIp(address)?.version === 4);

  if (useIcmp) {
    const file = binaryPath('ping');
    if (!file) throw capabilityUnavailable('ICMP ping', capability.detail);
    const args = ['-n', '-c', String(count), '-W', String(ICMP_TIMEOUT_SECONDS), target];
    const run = await runBinary(file, args, (count * (ICMP_TIMEOUT_SECONDS + 1) + 3) * 1000);
    const parsed = parsePingOutput(run.stdout);
    if (!parsed) {
      throw new ToolError('PROVIDER_ERROR', `ping did not return a recognisable result${run.stderr ? `: ${run.stderr.trim().slice(0, 200)}` : ''}.`);
    }
    const probes: PingProbe[] = [];
    const rttLines = [...run.stdout.matchAll(/icmp_seq=(\d+).*?time=([\d.]+)\s*ms/gi)];
    for (const line of rttLines) {
      probes.push({ sequence: Number.parseInt(line[1] ?? '0', 10), rttMs: Number.parseFloat(line[2] ?? '0'), status: 'OK', detail: 'Echo reply received.' });
    }
    for (let sequence = 1; sequence <= parsed.transmitted; sequence += 1) {
      if (!probes.some((probe) => probe.sequence === sequence)) {
        probes.push({ sequence, rttMs: null, status: 'TIMEOUT', detail: `No echo reply within ${ICMP_TIMEOUT_SECONDS}s.` });
      }
    }
    return {
      target,
      resolvedAddresses: addresses,
      method: 'ICMP',
      port: null,
      packetsSent: parsed.transmitted,
      packetsReceived: parsed.received,
      packetLossPercent: Math.round(parsed.lossPercent * 100) / 100,
      rtt: { minMs: parsed.min, maxMs: parsed.max, avgMs: parsed.avg, jitterMs: parsed.mdev },
      probes,
      capability,
      explanation: 'ICMP echo measures round-trip time from this CloudHost247 server to the target. Blocking ICMP is common, so a timeout does not necessarily mean the host is down.',
      warnings,
    };
  }

  // TCP connect fallback — explicitly labelled, never presented as ICMP.
  warnings.push(
    capability.status === 'AVAILABLE'
      ? `TCP mode was requested, so this measures TCP handshake latency on port ${tcpPort} rather than ICMP.`
      : `${capability.detail} Falling back to TCP connect timing on port ${tcpPort} — the numbers below are TCP handshake latency, not ICMP round-trip time.`
  );
  const probes: PingProbe[] = [];
  const rtts: number[] = [];
  for (let attempt = 1; attempt <= count; attempt += 1) {
    const result = await tcpConnect(target, tcpPort, 3000);
    if (result.ok) {
      probes.push({ sequence: attempt, rttMs: result.latencyMs, status: 'OK', detail: `TCP handshake completed with ${result.ip}:${tcpPort}.` });
      rtts.push(result.latencyMs);
    } else {
      probes.push({
        sequence: attempt,
        rttMs: null,
        status: result.error === 'TIMEOUT' ? 'TIMEOUT' : 'ERROR',
        detail: result.error === 'TIMEOUT' ? `No TCP handshake within 3s.` : `Connection failed: ${result.error}.`,
      });
    }
  }

  const received = probes.filter((probe) => probe.status === 'OK').length;
  const avg = rtts.length > 0 ? rtts.reduce((sum, value) => sum + value, 0) / rtts.length : null;

  return {
    target,
    resolvedAddresses: addresses,
    method: 'TCP',
    port: tcpPort,
    packetsSent: count,
    packetsReceived: received,
    packetLossPercent: Math.round(((count - received) / count) * 10000) / 100,
    rtt: {
      minMs: rtts.length > 0 ? Math.min(...rtts) : null,
      maxMs: rtts.length > 0 ? Math.max(...rtts) : null,
      avgMs: avg === null ? null : Math.round(avg * 100) / 100,
      jitterMs: rtts.length > 1 ? Math.round((Math.max(...rtts) - Math.min(...rtts)) * 100) / 100 : null,
    },
    probes,
    capability,
    explanation:
      'TCP connect timing measures how long a full TCP handshake takes from this CloudHost247 server. It proves reachability of that port only; other ports may be filtered.',
    warnings,
  };
}

export interface TracerouteHop {
  hop: number;
  address: string | null;
  hostname: string | null;
  rttMs: number[];
  status: 'OK' | 'TIMEOUT' | 'ERROR';
  raw: string;
}

export interface TracerouteResult {
  target: string;
  method: 'ICMP' | 'UDP';
  maxHops: number;
  hops: TracerouteHop[];
  reachedTarget: boolean;
  capability: { status: string; detail: string };
  explanation: string;
  warnings: string[];
}

/** Parses `traceroute -n` / `tracert -d` output, preserving timeouts as explicit hops. */
export function parseTracerouteOutput(stdout: string): TracerouteHop[] {
  const hops: TracerouteHop[] = [];
  for (const line of stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!match) continue;
    const hopNumber = Number.parseInt(match[1] ?? '0', 10);
    const rest = (match[2] ?? '').trim();
    if (rest.length === 0) continue;
    const addresses = [...rest.matchAll(/(\d{1,3}(?:\.\d{1,3}){3})/g)].map((entry) => entry[1] ?? '');
    const rtts = [...rest.matchAll(/([\d.]+)\s*ms/g)].map((entry) => Number.parseFloat(entry[1] ?? '0'));
    const isTimeout = /\*\s*\*\s*\*|Request timed out/i.test(rest) && addresses.length === 0;
    hops.push({
      hop: hopNumber,
      address: addresses[0] ?? null,
      hostname: null,
      rttMs: rtts,
      status: isTimeout ? 'TIMEOUT' : addresses.length > 0 ? 'OK' : 'ERROR',
      raw: rest,
    });
  }
  return hops;
}

export async function traceroute(input: { target: string; maxHops?: number }): Promise<TracerouteResult> {
  const capability = capabilityReport('traceroute');
  if (capability.status !== 'AVAILABLE') {
    throw capabilityUnavailable('Traceroute', capability.detail);
  }
  const target = validateTarget(input.target);
  const maxHops = Math.min(Math.max(input.maxHops ?? 15, 1), 20);
  const addresses = await resolvePublicAddresses(target);
  if (addresses.length === 0) throw targetBlocked(`"${target}" does not resolve to a public address.`);

  const file = binaryPath('traceroute');
  if (!file) throw capabilityUnavailable('Traceroute', capability.detail);
  const isWindows = process.platform === 'win32';
  const args = isWindows
    ? ['-d', '-h', String(maxHops), '-w', '2000', target]
    : ['-n', '-m', String(maxHops), '-w', '2', '-q', '1', target];

  const startedAt = performance.now();
  const run = await runBinary(file, args, maxHops * 2500 + 5000);
  const hops = parseTracerouteOutput(run.stdout);
  const warnings: string[] = [];
  if (run.timedOut) warnings.push(`The traceroute run was stopped after ${Math.round(performance.now() - startedAt)} ms; the hop list is partial.`);
  if (hops.filter((hop) => hop.status === 'TIMEOUT').length > 0) {
    warnings.push('Some hops did not answer. Routers frequently rate-limit or drop traceroute probes, so "* * *" does not mean the path is broken.');
  }
  const lastAddress = [...hops].reverse().find((hop) => hop.address)?.address ?? null;
  const reachedTarget = lastAddress !== null && addresses.includes(lastAddress);

  return {
    target,
    method: process.platform === 'win32' ? 'ICMP' : 'UDP',
    maxHops,
    hops,
    reachedTarget,
    capability,
    explanation:
      'Each hop is one router decrementing the packet TTL. Times are per-probe measurements, so a single high value may be an ICMP rate limit rather than congestion.',
    warnings,
  };
}
