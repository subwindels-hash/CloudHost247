/**
 * Tools Center — TCP port checker (spec §26).
 *
 * Deliberately NOT a port scanner. The limits are enforced here, in the service, not in the UI:
 *   - one port, or an explicit short range (≤ 20 ports),
 *   - at most 5 concurrent connections, 3 s per port, 20 s total,
 *   - private/reserved/metadata targets refused by the shared SSRF validator,
 *   - every check is rate limited by the tool's `restricted` profile and logged,
 *   - the response never includes a banner read or any data from the service on the port: we only
 *     know whether the TCP handshake succeeded.
 */
import { performance } from 'node:perf_hooks';
import { invalidInput, ToolError } from '../core/errors';
import { resolvePublicAddresses, tcpConnect } from '../core/ssrf';

export type PortState = 'OPEN' | 'CLOSED' | 'FILTERED' | 'UNREACHABLE';

export interface PortResult {
  port: number;
  state: PortState;
  latencyMs: number | null;
  detail: string;
}

export interface PortCheckResult {
  host: string;
  resolvedAddress: string;
  ports: PortResult[];
  summary: { open: number; closed: number; filtered: number; unreachable: number; checked: number };
  durationMs: number;
  limits: { maxPorts: number; concurrency: number; perPortTimeoutMs: number };
  warnings: string[];
  explanation: string;
}

const MAX_PORTS_PER_REQUEST = 20;
const CONCURRENCY = 5;
const PER_PORT_TIMEOUT_MS = 3000;
const TOTAL_BUDGET_MS = 20_000;

/** Common ports offered as one-click choices in the UI (informational, not a scan list). */
export const COMMON_PORTS: Array<{ port: number; service: string }> = [
  { port: 21, service: 'FTP' },
  { port: 22, service: 'SSH' },
  { port: 25, service: 'SMTP' },
  { port: 53, service: 'DNS' },
  { port: 80, service: 'HTTP' },
  { port: 110, service: 'POP3' },
  { port: 143, service: 'IMAP' },
  { port: 443, service: 'HTTPS' },
  { port: 465, service: 'SMTPS' },
  { port: 587, service: 'Submission' },
  { port: 993, service: 'IMAPS' },
  { port: 995, service: 'POP3S' },
  { port: 3306, service: 'MySQL' },
  { port: 5432, service: 'PostgreSQL' },
  { port: 6379, service: 'Redis' },
  { port: 8080, service: 'HTTP alternative' },
  { port: 8443, service: 'HTTPS alternative' },
  { port: 27017, service: 'MongoDB' },
];

export interface PortCheckInput {
  host: string;
  port?: number;
  from?: number;
  to?: number;
  /** Optional registry of common port names for the explanation text. */
  ports?: number[];
}

export function parsePortList(input: PortCheckInput): number[] {
  if (input.ports && input.ports.length > 0) {
    const unique = [...new Set(input.ports)];
    if (unique.length > MAX_PORTS_PER_REQUEST) {
      throw invalidInput(`At most ${MAX_PORTS_PER_REQUEST} ports may be checked per request.`);
    }
    for (const port of unique) {
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw invalidInput(`"${port}" is not a valid port number.`);
    }
    return unique.sort((a, b) => a - b);
  }

  if (input.from === undefined && input.to === undefined) {
    if (input.port === undefined) throw invalidInput('Enter a port, or a small range of ports.');
    if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) throw invalidInput('The port must be between 1 and 65535.');
    return [input.port];
  }

  const from = input.from ?? input.to ?? 0;
  const to = input.to ?? input.from ?? 0;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > 65535 || from > to) {
    throw invalidInput('Enter a valid port range between 1 and 65535 (start must not exceed end).');
  }
  const count = to - from + 1;
  if (count > MAX_PORTS_PER_REQUEST) {
    throw invalidInput(
      `A range of ${count} ports exceeds the ${MAX_PORTS_PER_REQUEST}-port limit for a single check. CloudHost247 intentionally does not offer port scanning; check the ports you actually need.`
    );
  }
  return Array.from({ length: count }, (_, index) => from + index);
}

export async function portCheck(input: PortCheckInput): Promise<PortCheckResult> {
  const host = input.host.trim();
  if (host.length === 0) throw invalidInput('Enter a hostname or IP address to check.');
  const ports = parsePortList(input);

  const startedAt = performance.now();
  // resolvePublicAddresses refuses private/reserved/literal-blocked targets itself (SSRF layer),
  // so a failure here is already a safe, user-facing ToolError.
  const addresses = await resolvePublicAddresses(host.replace(/^\[|\]$/g, ''));
  const address = addresses[0];
  if (!address) throw new ToolError('DNS_LOOKUP_FAILED', `"${host}" does not resolve to a public address.`);

  const results: PortResult[] = new Array(ports.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= ports.length) return;
      const port = ports[index];
      if (port === undefined) return;
      if (performance.now() - startedAt > TOTAL_BUDGET_MS) {
        results[index] = {
          port,
          state: 'UNREACHABLE',
          latencyMs: null,
          detail: 'The overall time limit for this request was reached before this port was checked.',
        };
        continue;
      }
      const outcome = await tcpConnect(host, port, PER_PORT_TIMEOUT_MS);
      if (outcome.ok) {
        results[index] = {
          port,
          state: 'OPEN',
          latencyMs: outcome.latencyMs,
          detail: `A TCP handshake with ${outcome.ip} completed in ${outcome.latencyMs} ms.`,
        };
      } else if (outcome.error === 'TIMEOUT') {
        results[index] = {
          port,
          state: 'FILTERED',
          latencyMs: null,
          detail: `No response within ${PER_PORT_TIMEOUT_MS} ms. A firewall may be dropping the packets (filtered), or the host may be unreachable.`,
        };
      } else if (outcome.error === 'ECONNREFUSED') {
        results[index] = {
          port,
          state: 'CLOSED',
          latencyMs: outcome.latencyMs,
          detail: 'The host actively refused the connection (RST), which means nothing is listening on that port.',
        };
      } else {
        results[index] = {
          port,
          state: 'UNREACHABLE',
          latencyMs: outcome.latencyMs,
          detail: `The connection failed: ${outcome.error}.`,
        };
      }
    }
  };

  await Promise.all(new Array(Math.min(CONCURRENCY, ports.length)).fill(null).map(() => worker()));

  const durationMs = Math.round(performance.now() - startedAt);
  const warnings: string[] = [];
  if (durationMs > TOTAL_BUDGET_MS) warnings.push('The check hit its total time budget; some ports were not attempted.');

  return {
    host,
    resolvedAddress: address,
    ports: results,
    summary: {
      open: results.filter((result) => result.state === 'OPEN').length,
      closed: results.filter((result) => result.state === 'CLOSED').length,
      filtered: results.filter((result) => result.state === 'FILTERED').length,
      unreachable: results.filter((result) => result.state === 'UNREACHABLE').length,
      checked: results.length,
    },
    durationMs,
    limits: { maxPorts: MAX_PORTS_PER_REQUEST, concurrency: CONCURRENCY, perPortTimeoutMs: PER_PORT_TIMEOUT_MS },
    warnings,
    explanation:
      'A successful TCP handshake means something accepted the connection on that port. It does not identify the service, and it does not test UDP. A refusal means nothing is listening; a timeout usually means a firewall dropped the packet.',
  };
}
