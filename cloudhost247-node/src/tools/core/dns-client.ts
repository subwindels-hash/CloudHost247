/**
 * Tools Center — DNS transports (UDP, TCP, DNS-over-TLS, DNS-over-HTTPS).
 *
 * Every query is issued against an explicit resolver from the managed registry
 * (database/migrations/0067_create_tools_center.sql → tool_resolvers). The platform never uses the
 * operating system's configured resolver for propagation results, because "the answer I got from
 * my local resolver" is not a global propagation signal — each row in a propagation table is
 * attributable to a named resolver.
 *
 * Failure is a first-class result, not an exception: a resolver that times out or refuses returns
 * `ok: false` with a code, so propagation/health output distinguishes "no answer" from "answered
 * with NXDOMAIN" instead of collapsing both into an empty record list.
 */
import dgram from 'node:dgram';
import net from 'node:net';
import tls from 'node:tls';
import { performance } from 'node:perf_hooks';
import { encodeQuery, parseMessage, TYPE_BY_NAME, type ParsedMessage } from './dns-wire';
import { fetchWithGuard } from './ssrf';

export type ResolverProtocol = 'UDP' | 'TCP' | 'DOT' | 'DOH';

export interface ResolverTarget {
  id: string;
  name: string;
  provider: string;
  ipAddress: string;
  protocol: ResolverProtocol;
  version: 'IPv4' | 'IPv6';
  endpoint: string | null;
  country: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
}

export interface DnsQueryOk {
  ok: true;
  message: ParsedMessage;
  transport: ResolverProtocol;
  durationMs: number;
  /** True when a UDP answer was truncated and the query was retried over TCP. */
  tcpFallback: boolean;
}

export interface DnsQueryFailure {
  ok: false;
  code:
    | 'TIMEOUT'
    | 'NETWORK_ERROR'
    | 'SERVFAIL'
    | 'REFUSED'
    | 'FORMERR'
    | 'NOTIMP'
    | 'MALFORMED_RESPONSE'
    | 'NO_RESPONSE'
    | 'TLS_ERROR';
  message: string;
  durationMs: number;
  rcodeText?: string;
}

export type DnsQueryOutcome = DnsQueryOk | DnsQueryFailure;

const DEFAULT_TIMEOUT_MS = 3000;

function fail(code: DnsQueryFailure['code'], message: string, durationMs: number, rcodeText?: string): DnsQueryFailure {
  return { ok: false, code, message, durationMs, ...(rcodeText ? { rcodeText } : {}) };
}

/** Maps a non-NOERROR/NXDOMAIN rcode to a failure, leaving NXDOMAIN as a successful answer. */
function outcomeFromMessage(message: ParsedMessage, transport: ResolverProtocol, durationMs: number, tcpFallback: boolean): DnsQueryOutcome {
  if (message.rcode === 0 || message.rcode === 3) {
    return { ok: true, message, transport, durationMs, tcpFallback };
  }
  const code = message.rcodeText === 'SERVFAIL' ? 'SERVFAIL' : message.rcodeText === 'REFUSED' ? 'REFUSED' : message.rcodeText === 'FORMERR' ? 'FORMERR' : message.rcodeText === 'NOTIMP' ? 'NOTIMP' : 'MALFORMED_RESPONSE';
  return fail(code, `The resolver answered ${message.rcodeText}.`, durationMs, message.rcodeText);
}

function queryUdp(resolver: ResolverTarget, name: string, type: string, timeoutMs: number, dnssec: boolean): Promise<DnsQueryOutcome> {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const query = encodeQuery(name, type, { dnssecOk: dnssec, ednsUdpSize: 1232 });
    const queryId = query.readUInt16BE(0);
    const socketType = resolver.version === 'IPv6' ? 'udp6' : 'udp4';
    const socket = dgram.createSocket(socketType);
    let settled = false;

    const finish = (outcome: DnsQueryOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // already closed
      }
      resolve(outcome);
    };

    const timer = setTimeout(() => {
      finish(fail('TIMEOUT', `No response from ${resolver.ipAddress} within ${timeoutMs} ms.`, Math.round(performance.now() - startedAt)));
    }, timeoutMs);

    socket.on('message', (reply: Buffer) => {
      const durationMs = Math.round(performance.now() - startedAt);
      let message: ParsedMessage;
      try {
        message = parseMessage(reply);
      } catch (error) {
        finish(fail('MALFORMED_RESPONSE', error instanceof Error ? error.message : 'Malformed DNS response', durationMs));
        return;
      }
      if (message.id !== queryId) return; // late/mismatched datagram — keep waiting
      finish(outcomeFromMessage(message, 'UDP', durationMs, false));
    });

    socket.on('error', (error: NodeJS.ErrnoException) => {
      finish(fail('NETWORK_ERROR', error.code === 'EAFNOSUPPORT' ? 'This deployment has no IPv6 route to the resolver.' : `UDP socket error: ${error.code ?? error.message}`, Math.round(performance.now() - startedAt)));
    });

    socket.send(query, 53, resolver.ipAddress, (error) => {
      if (error) {
        finish(fail('NETWORK_ERROR', `UDP send failed: ${error.message}`, Math.round(performance.now() - startedAt)));
      }
    });
  });
}

function queryStream(
  connect: () => net.Socket | tls.TLSSocket,
  name: string,
  type: string,
  timeoutMs: number,
  dnssec: boolean,
  transport: ResolverProtocol
): Promise<DnsQueryOutcome> {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const query = encodeQuery(name, type, { dnssecOk: dnssec, ednsUdpSize: 4096 });
    const queryId = query.readUInt16BE(0);
    const socket = connect();
    let settled = false;
    const chunks: Buffer[] = [];
    let expected = -1;

    const finish = (outcome: DnsQueryOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(outcome);
    };

    const timer = setTimeout(() => {
      finish(fail('TIMEOUT', `No response within ${timeoutMs} ms.`, Math.round(performance.now() - startedAt)));
    }, timeoutMs);

    socket.on('connect', () => {
      const length = Buffer.alloc(2);
      length.writeUInt16BE(query.length, 0);
      socket.write(Buffer.concat([length, query]));
    });

    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      const buffer = Buffer.concat(chunks);
      if (expected === -1) {
        if (buffer.length < 2) return;
        expected = buffer.readUInt16BE(0) + 2;
      }
      if (buffer.length < expected) return;
      const durationMs = Math.round(performance.now() - startedAt);
      let message: ParsedMessage;
      try {
        message = parseMessage(buffer.subarray(2, expected));
      } catch (error) {
        finish(fail('MALFORMED_RESPONSE', error instanceof Error ? error.message : 'Malformed DNS response', durationMs));
        return;
      }
      if (message.id !== queryId) {
        finish(fail('MALFORMED_RESPONSE', 'The resolver returned a mismatched transaction id.', durationMs));
        return;
      }
      finish(outcomeFromMessage(message, transport, durationMs, false));
    });

    socket.on('error', (error: NodeJS.ErrnoException) => {
      const isTls = transport === 'DOT';
      finish(
        fail(
          isTls ? 'TLS_ERROR' : 'NETWORK_ERROR',
          `${isTls ? 'TLS' : 'TCP'} error: ${error.code ?? error.message}`,
          Math.round(performance.now() - startedAt)
        )
      );
    });

    socket.on('close', () => {
      finish(fail('NO_RESPONSE', 'The resolver closed the connection before answering.', Math.round(performance.now() - startedAt)));
    });
  });
}

async function queryDoh(resolver: ResolverTarget, name: string, type: string, timeoutMs: number, dnssec: boolean): Promise<DnsQueryOutcome> {
  const endpoint = resolver.endpoint;
  if (!endpoint) {
    return fail('NETWORK_ERROR', 'This resolver has no DNS-over-HTTPS endpoint configured.', 0);
  }
  const startedAt = performance.now();
  try {
    const query = encodeQuery(name, type, { dnssecOk: dnssec, ednsUdpSize: 4096 });
    const response = await fetchWithGuard(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/dns-message', accept: 'application/dns-message' },
      body: query,
      timeoutMs,
      maxBytes: 65535,
      userAgent: 'CloudHost247-ToolsCenter/1.0 (DNS-over-HTTPS diagnostics)',
    });
    const durationMs = Math.round(performance.now() - startedAt);
    if (response.status !== 200) {
      return fail('NETWORK_ERROR', `The DoH endpoint answered HTTP ${response.status}.`, durationMs);
    }
    const message = parseMessage(response.body);
    return outcomeFromMessage(message, 'DOH', durationMs, false);
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);
    const message = error instanceof Error ? error.message : 'DoH request failed';
    return fail(/timed out/i.test(message) ? 'TIMEOUT' : 'NETWORK_ERROR', message, durationMs);
  }
}

/**
 * Issues one query against one resolver, honouring the resolver's declared protocol. UDP answers
 * with the TC bit set are retried over TCP against the same resolver (standard practice; reported
 * via `tcpFallback: true`).
 */
export async function queryResolver(
  resolver: ResolverTarget,
  name: string,
  type: string,
  options: { timeoutMs?: number; dnssec?: boolean } = {}
): Promise<DnsQueryOutcome> {
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 250), 15_000);
  const dnssec = options.dnssec ?? false;
  if (TYPE_BY_NAME[type.toUpperCase()] === undefined) {
    throw new Error(`Unsupported DNS record type "${type}"`);
  }

  if (resolver.protocol === 'DOH') return queryDoh(resolver, name, type, timeoutMs, dnssec);

  if (resolver.protocol === 'DOT') {
    return queryStream(
      () => tls.connect({ host: resolver.ipAddress, port: 853, timeout: timeoutMs }),
      name,
      type,
      timeoutMs,
      dnssec,
      'DOT'
    );
  }

  if (resolver.protocol === 'TCP') {
    return queryStream(() => net.connect({ host: resolver.ipAddress, port: 53 }), name, type, timeoutMs, dnssec, 'TCP');
  }

  const udp = await queryUdp(resolver, name, type, timeoutMs, dnssec);
  if (udp.ok && udp.message.truncated) {
    const tcp = await queryStream(() => net.connect({ host: resolver.ipAddress, port: 53 }), name, type, timeoutMs, dnssec, 'TCP');
    if (tcp.ok) return { ...tcp, tcpFallback: true };
    return tcp;
  }
  return udp;
}
