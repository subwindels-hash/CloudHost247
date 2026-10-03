/**
 * Tools Center — SMTP tester (spec §32).
 *
 * Speaks real SMTP to the domain's MX hosts through `tcpConnect` (so the SSRF rules and the
 * private-address refusal apply) and reports what each server actually said: greeting, EHLO
 * capabilities, STARTTLS support (and a real TLS handshake when offered), advertised AUTH methods
 * and SIZE limit.
 *
 * There is no "send a test message" mode, by design: sending mail requires DATA, and a public tool
 * that sends mail to arbitrary recipients is a spam cannon. The optional RCPT check requires an
 * explicit acknowledgement from the caller, uses an empty MAIL FROM (the standard null reverse-path
 * used for probes), and is rate limited by the tool's restricted profile.
 */
import net from 'node:net';
import tls from 'node:tls';
import { performance } from 'node:perf_hooks';
import type { Queryable } from '../../db/types';
import { invalidInput, ToolError, timeoutError } from '../core/errors';
import { capabilityReport } from '../core/capabilities';
import { tcpConnect } from '../core/ssrf';
import { pickResolver, queryType } from '../dns/common';

export interface SmtpTestInput {
  /** Domain whose MX records are tested, or an e-mail address whose domain is used. */
  target: string;
  port?: number;
  /** Opt in to a RCPT TO probe for `recipient`. Requires `acknowledgeRecipientCheck: true`. */
  recipient?: string;
  acknowledgeRecipientCheck?: boolean;
  timeoutMs?: number;
  /** Limit the number of MX hosts tested (default 2, max 4). */
  maxHosts?: number;
}

export interface SmtpServerResult {
  host: string;
  preference: number;
  address: string;
  connected: boolean;
  connectMs: number | null;
  greeting: { code: number | null; text: string | null };
  ehlo: { code: number | null; banner: string | null; capabilities: Record<string, string> };
  starttls: { advertised: boolean; negotiated: boolean; protocol: string | null; cipher: string | null; certificate: { subject: string | null; issuer: string | null; validTo: string | null; authorized: boolean } | null; detail: string };
  auth: { advertised: boolean; mechanisms: string[] };
  sizeLimit: number | null;
  recipientCheck: { recipient: string; code: number; text: string; accepted: boolean } | null;
  errors: string[];
  durationMs: number;
}

export interface SmtpTestResult {
  domain: string;
  mxRecords: Array<{ host: string; preference: number }>;
  servers: SmtpServerResult[];
  summary: string;
  assessment: { deliverable: boolean; starttlsCoverage: string; detail: string };
  capability: { status: string; detail: string };
  recommendations: string[];
  notes: string[];
  durationMs: number;
}

const MAX_GREETING_BYTES = 4096;

/** Minimal line-based SMTP client with an explicit timeout on every read. */
class SmtpSession {
  private socket: net.Socket;
  private buffer = '';
  private pendingLines: string[] = [];
  private waiters: Array<(line: string) => void> = [];
  readonly transcript: string[] = [];

  constructor(socket: net.Socket) {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      for (;;) {
        const index = this.buffer.indexOf('\n');
        if (index === -1) break;
        const line = this.buffer.slice(0, index).replace(/\r$/, '');
        this.buffer = this.buffer.slice(index + 1);
        this.transcript.push(`< ${line}`);
        if (this.transcript.join('').length > MAX_GREETING_BYTES * 4) {
          this.socket.destroy();
          return;
        }
        const waiter = this.waiters.shift();
        if (waiter) waiter(line);
        else this.pendingLines.push(line);
      }
    });
  }

  async read(timeoutMs: number): Promise<string> {
    const existing = this.pendingLines.shift();
    if (existing !== undefined) return existing;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(timeoutError('The SMTP server reply')), timeoutMs);
      this.waiters.push((line) => {
        clearTimeout(timer);
        resolve(line);
      });
    });
  }

  /** Reads a possibly multiline reply (250-… until 250 SP) and returns code, lines. */
  async readReply(timeoutMs: number): Promise<{ code: number; lines: string[] }> {
    const lines: string[] = [];
    for (;;) {
      const line = await this.read(timeoutMs);
      lines.push(line);
      const match = /^(\d{3})([ -])/.exec(line);
      if (!match) continue;
      if (match[2] === ' ') return { code: Number(match[1]), lines };
      if (lines.length > 40) return { code: Number(match[1] ?? 0), lines };
    }
  }

  async send(command: string, timeoutMs: number): Promise<{ code: number; lines: string[] }> {
    this.transcript.push(`> ${command}`);
    this.socket.write(`${command}\r\n`);
    return this.readReply(timeoutMs);
  }

  async startTls(host: string, timeoutMs: number): Promise<tls.TLSSocket> {
    return new Promise((resolve, reject) => {
      const secure = tls.connect({ socket: this.socket, servername: host, rejectUnauthorized: false }, () => {
        this.socket = secure;
        this.buffer = '';
        resolve(secure);
      });
      secure.setTimeout(timeoutMs, () => secure.destroy(timeoutError('The STARTTLS handshake')));
      secure.once('error', (error) => reject(new ToolError('PROVIDER_ERROR', `The STARTTLS handshake failed: ${error instanceof Error ? error.message : 'unknown error'}`)));
    });
  }

  close(): void {
    this.socket.destroy();
  }
}

function parseCapabilities(lines: string[]): Record<string, string> {
  const capabilities: Record<string, string> = {};
  for (const line of lines) {
    const match = /^250[ -]([A-Za-z0-9][A-Za-z0-9-]*)(?:\s+(.*))?$/.exec(line);
    if (!match) continue;
    const keyword = (match[1] ?? '').toUpperCase();
    if (keyword === 'CLOUDHOST247' || /^[A-Z]/.test(keyword) === false) continue;
    capabilities[keyword] = (match[2] ?? '').trim();
  }
  return capabilities;
}

async function testServer(
  host: string,
  preference: number,
  address: string,
  options: { port: number; recipient: string | null; timeoutMs: number }
): Promise<SmtpServerResult> {
  const started = performance.now();
  const errors: string[] = [];
  const connect = await tcpConnect(host, options.port, options.timeoutMs);
  if (!connect.ok) {
    return {
      host,
      preference,
      address,
      connected: false,
      connectMs: connect.latencyMs,
      greeting: { code: null, text: null },
      ehlo: { code: null, banner: null, capabilities: {} },
      starttls: { advertised: false, negotiated: false, protocol: null, cipher: null, certificate: null, detail: 'Not attempted: no TCP connection.' },
      auth: { advertised: false, mechanisms: [] },
      sizeLimit: null,
      recipientCheck: null,
      errors: [`TCP connection to ${host}:${options.port} failed: ${connect.error}. Many hosting providers block outbound port 25; see the recommendations.`],
      durationMs: Math.round(performance.now() - started),
    };
  }

  const raw = net.connect({ host: address, port: options.port });
  raw.setTimeout(options.timeoutMs, () => raw.destroy(timeoutError('The SMTP connection')));
  const session = new SmtpSession(raw);
  await new Promise<void>((resolve, reject) => {
    raw.once('connect', () => resolve());
    raw.once('error', (error: Error) => reject(new ToolError('PROVIDER_ERROR', `The SMTP connection failed: ${error.message}`)));
    raw.once('timeout', () => reject(timeoutError('The SMTP connection')));
  });

  let greeting: SmtpServerResult['greeting'] = { code: null, text: null };
  let ehlo: SmtpServerResult['ehlo'] = { code: null, banner: null, capabilities: {} };
  let starttls: SmtpServerResult['starttls'] = { advertised: false, negotiated: false, protocol: null, cipher: null, certificate: null, detail: 'The server did not advertise STARTTLS.' };
  let recipientCheck: SmtpServerResult['recipientCheck'] = null;
  let mechanisms: string[] = [];

  try {
    const greetingReply = await session.readReply(options.timeoutMs);
    greeting = { code: greetingReply.code, text: greetingReply.lines.join(' ').slice(0, 300) };

    const ehloReply = await session.send('EHLO cloudhost247.com', options.timeoutMs);
    ehlo = { code: ehloReply.code, banner: ehloReply.lines.join(' ').slice(0, 300), capabilities: parseCapabilities(ehloReply.lines) };

    const advertised = Object.keys(ehlo.capabilities);
    const starttlsAdvertised = advertised.includes('STARTTLS');
    if (starttlsAdvertised || options.port === 587 || options.port === 465) {
      if (starttlsAdvertised) {
        const starttlsReply = await session.send('STARTTLS', options.timeoutMs);
        if (starttlsReply.code === 220) {
          try {
            const secure = await session.startTls(host, options.timeoutMs);
            const certificate = secure.getPeerCertificate(false);
            const protocol = secure.getProtocol();
            const cipher = secure.getCipher()?.name ?? null;
            starttls = {
              advertised: true,
              negotiated: true,
              protocol,
              cipher,
              certificate: {
                subject: typeof certificate.subject?.CN === 'string' ? certificate.subject.CN : null,
                issuer: typeof certificate.issuer?.O === 'string' ? certificate.issuer.O : typeof certificate.issuer?.CN === 'string' ? certificate.issuer.CN : null,
                validTo: certificate.valid_to ?? null,
                authorized: secure.authorized,
              },
              detail: `TLS negotiated after STARTTLS (${protocol ?? 'unknown protocol'}, ${cipher ?? 'unknown cipher'}).`,
            };
            const postTls = await session.send('EHLO cloudhost247.com', options.timeoutMs);
            ehlo = { code: postTls.code, banner: postTls.lines.join(' ').slice(0, 300), capabilities: parseCapabilities(postTls.lines) };
          } catch (error) {
            starttls = { advertised: true, negotiated: false, protocol: null, cipher: null, certificate: null, detail: error instanceof Error ? error.message : 'The STARTTLS handshake failed.' };
            errors.push('STARTTLS was advertised but the handshake failed.');
          }
        } else {
          starttls = { advertised: true, negotiated: false, protocol: null, cipher: null, certificate: null, detail: `The server refused STARTTLS (${starttlsReply.code}).` };
        }
      } else {
        starttls = { advertised: false, negotiated: false, protocol: null, cipher: null, certificate: null, detail: 'The server does not advertise STARTTLS, so this connection would carry mail in plaintext.' };
      }
    }

    const authLine = Object.entries(ehlo.capabilities).find(([keyword]) => keyword === 'AUTH');
    mechanisms = authLine ? (authLine[1] ?? '').split(/\s+/).filter(Boolean) : [];

    if (options.recipient) {
      const mailFrom = await session.send('MAIL FROM:<>', options.timeoutMs);
      if (mailFrom.code >= 200 && mailFrom.code < 300) {
        const rcpt = await session.send(`RCPT TO:<${options.recipient}>`, options.timeoutMs);
        recipientCheck = { recipient: options.recipient, code: rcpt.code, text: rcpt.lines.join(' ').slice(0, 300), accepted: rcpt.code >= 200 && rcpt.code < 300 };
        await session.send('RSET', options.timeoutMs).catch(() => undefined);
      } else {
        errors.push(`MAIL FROM:<> was rejected with ${mailFrom.code}; the recipient check was skipped.`);
      }
    }

    await session.send('QUIT', 2000).catch(() => undefined);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'The SMTP conversation failed.');
  } finally {
    session.close();
  }

  return {
    host,
    preference,
    address,
    connected: true,
    connectMs: connect.latencyMs,
    greeting,
    ehlo,
    starttls,
    auth: { advertised: Object.keys(ehlo.capabilities).includes('AUTH'), mechanisms },
    sizeLimit: ehlo.capabilities.SIZE ? Number.parseInt(ehlo.capabilities.SIZE, 10) || null : null,
    recipientCheck,
    errors,
    durationMs: Math.round(performance.now() - started),
  };
}

export async function smtpTest(db: Queryable, input: SmtpTestInput): Promise<SmtpTestResult> {
  const started = performance.now();
  const target = (input.target ?? '').trim().toLowerCase();
  if (target.length === 0) throw invalidInput('Enter a domain (example.com) or an e-mail address.');
  const domain = target.includes('@') ? target.slice(target.lastIndexOf('@') + 1) : target;
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) throw invalidInput('Enter a valid domain or e-mail address.');
  const port = input.port ?? 25;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw invalidInput('The port must be between 1 and 65535.');
  const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 8000, 2000), 15_000);
  const maxHosts = Math.min(Math.max(input.maxHosts ?? 2, 1), 4);

  if (input.recipient && input.acknowledgeRecipientCheck !== true) {
    throw invalidInput('Checking a recipient sends a RCPT TO probe to the remote server. Set acknowledgeRecipientCheck to true to confirm you are authorised to test that mailbox.');
  }
  if (input.recipient && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.recipient)) throw invalidInput('The recipient must be a complete e-mail address.');

  const capability = capabilityReport('smtp-client');
  const resolver = await pickResolver(db);
  const mxAnswer = await queryType(resolver, domain, 'MX');
  const mxRecords = mxAnswer.records
    .map((record) => ({ host: String(record.data.exchange ?? '').replace(/\.$/, ''), preference: Number(record.data.preference ?? 0) }))
    .filter((record) => record.host.length > 0)
    .sort((a, b) => a.preference - b.preference);

  if (mxRecords.length === 0) {
    const a = await queryType(resolver, domain, 'A').catch(() => null);
    if (!a || a.records.length === 0) {
      throw new ToolError('NOT_FOUND', `${domain} has no MX records and no A record, so it cannot receive e-mail.`);
    }
    mxRecords.push({ host: domain, preference: 0 });
    mxAnswer.warning = `${domain} has no MX record; per RFC 5321 the A record is used as an implicit mail host.`;
  }

  const servers: SmtpServerResult[] = [];
  for (const mx of mxRecords.slice(0, maxHosts)) {
    const addresses = await tcpConnect(mx.host, port, timeoutMs);
    const address = addresses.ok ? addresses.ip : mx.host;
    servers.push(await testServer(mx.host, mx.preference, address, { port, recipient: input.recipient ?? null, timeoutMs }));
  }

  const reachable = servers.filter((server) => server.connected);
  const starttlsNegotiated = reachable.filter((server) => server.starttls.negotiated).length;
  const deliverable = reachable.length > 0;

  const recommendations: string[] = [];
  if (!deliverable) {
    recommendations.push('No MX host accepted a connection on the tested port. Outbound port 25 is blocked by many hosting providers (and by some ISPs); if that applies here, SMTP checks must run from a host with port 25 open. This does not mean the destination is broken.');
  }
  if (reachable.length > 0 && starttlsNegotiated === 0) {
    recommendations.push('No server negotiated STARTTLS. Mail to this domain is delivered in plaintext, which allows content to be read or modified in transit.');
  }
  const rejectedRecipient = servers.find((server) => server.recipientCheck && !server.recipientCheck.accepted);
  if (rejectedRecipient?.recipientCheck) {
    recommendations.push(`${rejectedRecipient.host} rejected ${rejectedRecipient.recipientCheck.recipient} with ${rejectedRecipient.recipientCheck.code}. Some servers reject at RCPT and accept later, and catch-all servers accept everything — a rejection is a hint, not proof the mailbox is invalid.`);
  }
  if (input.recipient && servers.some((server) => server.recipientCheck?.accepted)) {
    recommendations.push('At least one server accepted the recipient. Because many servers accept-all addresses to avoid being used for harvesting, treat this as "the domain accepts mail", not "the mailbox exists".');
  }

  return {
    domain,
    mxRecords,
    servers,
    summary: deliverable
      ? `${reachable.length} of ${servers.length} MX host(s) answered; ${starttlsNegotiated} negotiated STARTTLS.`
      : `None of the ${servers.length} tested MX host(s) accepted a TCP connection on port ${port}.`,
    assessment: {
      deliverable,
      starttlsCoverage: reachable.length === 0 ? 'unknown' : starttlsNegotiated === reachable.length ? 'all responding hosts support STARTTLS' : starttlsNegotiated > 0 ? 'some responding hosts support STARTTLS' : 'no responding host supports STARTTLS',
      detail:
        'This tool tests the receiving side only. It cannot tell you whether your own server can deliver to this domain (that requires sending a message), and it does not test SPF, DKIM or DMARC — use the dedicated e-mail authentication tools for those.',
    },
    capability,
    recommendations,
    notes: [
      'Every server is contacted only over the ports you asked for, with the SSRF layer refusing private targets, and the session ends with QUIT. No message body is ever sent: there is no DATA command in this implementation.',
      'Capabilities (STARTTLS, AUTH, SIZE) are self-reported by the server and can change between connections or be filtered by an upstream gateway.',
    ],
    durationMs: Math.round(performance.now() - started),
  };
}
