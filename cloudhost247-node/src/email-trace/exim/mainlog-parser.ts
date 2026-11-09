/**
 * Exim message-log parser.
 *
 * What this does: turns one line of `/var/log/exim_mainlog` into one structured event, or explains
 * why it will not (rejected) or why it deliberately produced nothing (ignored).
 *
 * What this is **not**: proof that production logs parse. Every fixture in `tests/fixtures/email-trace`
 * is synthetic, written from Exim's documented message-log format. Until the parser has been run
 * against a real cPanel host, its fidelity to the deployed Exim build is
 * `IMPLEMENTED — NOT LIVE-VERIFIED` (see docs/EMAIL-TRACE-CENTRE-ARCHITECTURE.md §12).
 *
 * Deliberate limits:
 *   - **No subject and no message content.** Submission lines can carry `T="subject"`; it is
 *     dropped here, before anything could store it.
 *   - **No authenticator identity.** `A=` (e.g. `dovecot_login:user@example.com`) is not collected.
 *   - **No raw line.** The parser's output is structured fields only, so there is no code path that
 *     could persist a log line.
 *   - **No guessed SMTP code.** `defer (-44)` is Exim's internal error number, not an SMTP reply;
 *     it is never read as one.
 *   - **No inferred statuses.** A line whose meaning is uncertain is parsed, but the resolver is
 *     allowed to answer `UNKNOWN`.
 */
import type {
  EximFlag,
  MainlogParseResult,
  RawEximEvent,
  RejectedLine,
  TraceEventType,
} from '../types';

/** `2026-11-08 10:12:33` (UTC), with an optional fractional second. */
const TIMESTAMP_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?\s+/;

/** Exim message ids look like `1xYzAb-000123-CD`. */
const MESSAGE_ID_RE = /^([A-Za-z0-9]{6}-[A-Za-z0-9]{6}-[A-Za-z0-9]{2})(?=\s|$)/;

const FLAG_RE = /^(<=|=>|->|\*\*|==|!!|<\*|\*>) /;

const FLAG_EVENT_TYPE: Record<EximFlag, TraceEventType> = {
  '<=': 'submission',
  '=>': 'delivery',
  '->': 'additional_delivery',
  '**': 'bounce',
  '==': 'deferral',
  '<*': 'rejection',
  '*>': 'completion',
  '!!': 'completion',
};

/** A real SMTP reply: three digits, optionally followed by an enhanced status (`250 2.0.0 Ok`). */
const SMTP_ENHANCED_RE = /\b([2-5]\d\d)[ -]([245]\.\d{1,3}\.\d{1,3})\b/;
const SMTP_LEADING_RE = /^([2-5]\d\d)(?=\s|$)/;

/** `host mx.example.org [198.51.100.9]` — the shape Exim uses when reporting a remote reply. */
const HOST_IN_TEXT_RE = /\bhost\s+([A-Za-z0-9._-]+)(?:\s+\[[0-9a-fA-F:.]+\])?/;
/** `H=mx.example.org [198.51.100.9]` on a delivery line. */
const HOST_TOKEN_RE = /(?:^|\s)H=([A-Za-z0-9._-]+)/;
const ROUTER_TOKEN_RE = /(?:^|\s)R=([A-Za-z0-9_.-]+)/;
const TRANSPORT_TOKEN_RE = /(?:^|\s)T=([A-Za-z0-9_.-]+)/;

export type LineOutcome =
  | { kind: 'event'; event: RawEximEvent }
  | { kind: 'ignored'; reason: string }
  | { kind: 'rejected'; reason: string };

function parseTimestamp(text: string): { date: Date; rest: string } | null {
  const match = TIMESTAMP_RE.exec(text);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const ms = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  return { date, rest: text.slice(match[0].length) };
}

/** Pulls the first `KEY="..."` value out of a line and returns the line without it. */
function extractQuoted(body: string, key: string): { value: string | null; rest: string } {
  const re = new RegExp(`(?:^|\\s)${key}="([^"]*)"`);
  const match = re.exec(body);
  if (!match) return { value: null, rest: body };
  const index = match.index ?? 0;
  return { value: match[1] ?? null, rest: `${body.slice(0, index)} ${body.slice(index + match[0].length)}` };
}

/** Exim terminates an address with `:` in some lines (`<* addr: 550 …`); the colon is not the address. */
function cleanToken(token: string): string {
  return token.replace(/[.,;:]+$/, '');
}

function extractToken(body: string, re: RegExp): string | null {
  const match = re.exec(body);
  return match ? (match[1] ?? null) : null;
}

/**
 * Reads an SMTP reply code out of a line, and only when the evidence supports it.
 *
 * Exim writes remote replies as `C="250 2.0.0 Ok ..."` on delivery lines and inside error text as
 * `host mx.example.org [1.2.3.4]: 550 5.1.1 no such user`. A bare three-digit run elsewhere in the
 * line (`defer (-44)`, a queue id, a size) is not treated as a reply.
 */
function extractSmtpCode(...candidates: Array<string | null>): number | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const enhanced = SMTP_ENHANCED_RE.exec(candidate);
    if (enhanced) return Number(enhanced[1]);
    const leading = SMTP_LEADING_RE.exec(candidate.trim());
    if (leading) return Number(leading[1]);
  }
  return null;
}

/** Everything after `defer (<n>):` / after the transport marker — the explanation, not the evidence. */
function extractReason(body: string): string | null {
  const deferred = /defer\s*\(-?\d+\)\s*:\s*(.+)$/i.exec(body);
  if (deferred) return (deferred[1] ?? '').trim();
  const afterTransport = /\bT=[A-Za-z0-9_.-]+\s*:\s*(.+)$/.exec(body);
  if (afterTransport) return (afterTransport[1] ?? '').trim();
  return null;
}

/**
 * Parses a single line.
 *
 * `lineNumber` is only used for reporting; the line text itself is never returned, so a caller
 * cannot accidentally persist it.
 */
export function parseMainlogLine(line: string, lineNumber = 0): LineOutcome {
  const trimmed = line.trimEnd();
  if (trimmed.trim() === '') return { kind: 'ignored', reason: 'blank line' };

  const stamp = parseTimestamp(trimmed);
  if (!stamp) return { kind: 'rejected', reason: 'line does not begin with a UTC timestamp' };

  const idMatch = MESSAGE_ID_RE.exec(stamp.rest);
  if (!idMatch) {
    // Rejections that happen before Exim assigns an id, and non-message lines, land here. They are
    // counted as rejected, never guessed into an event with a made-up id.
    return { kind: 'rejected', reason: 'line has no Exim message id' };
  }
  const messageId = idMatch[1] ?? '';
  if (messageId === '') return { kind: 'rejected', reason: 'line has no Exim message id' };
  const afterId = stamp.rest.slice(idMatch[0].length).trimStart();

  if (/^Completed\b/.test(afterId)) {
    // A trace-level marker. It closes a message but proves nothing about a single recipient, so it
    // is not stored as an event; completeness is derived from terminal delivery/bounce lines.
    return { kind: 'ignored', reason: 'message completion marker (trace-level, not an event)' };
  }

  const flagMatch = FLAG_RE.exec(afterId);
  if (!flagMatch) {
    return { kind: 'rejected', reason: 'line has no recognised message-log flag' };
  }
  const flag = flagMatch[1] as EximFlag;
  const eventType = FLAG_EVENT_TYPE[flag];

  if (flag === '*>') {
    // `*>` means the delivery was suppressed by `-N`: nothing was delivered and nothing failed.
    return { kind: 'ignored', reason: 'delivery suppressed by -N (no delivery attempt)' };
  }
  if (flag === '!!') {
    return { kind: 'ignored', reason: 'unrecognised Exim flag; no evidence of an outcome' };
  }

  // Work on a copy with the quoted fields removed so token regexes cannot match inside them.
  let body = afterId.slice(flagMatch[0].length);
  const cField = extractQuoted(body, 'C');
  body = cField.rest;
  // Submission lines can carry the message subject as T="…". It is dropped, deliberately.
  const subjectField = extractQuoted(body, 'T');
  body = subjectField.rest;

  const tokens = body.trim().split(/\s+/);
  const first: string = tokens[0] ?? '';

  let sender: string | null = null;
  let recipient: string | null = null;
  let originalRecipient: string | null = null;

  if (flag === '<=') {
    sender = first === '' ? null : cleanToken(first);
    // `… for <recipient@example.org>` (single recipient) or `for a@x, b@y` (clipped by Exim).
    const forIndex = tokens.findIndex((token) => token === 'for');
    if (forIndex >= 0) {
      const candidate = tokens[forIndex + 1] ?? '';
      recipient = cleanToken(candidate);
    }
  } else {
    recipient = cleanToken(first);
    const second = tokens[1] ?? '';
    if (second.startsWith('<') && second.endsWith('>')) originalRecipient = second;
  }

  if (!recipient || recipient === '') {
    return { kind: 'rejected', reason: 'line has no recipient' };
  }
  if (flag === '<=' && (!sender || sender === '')) {
    return { kind: 'rejected', reason: 'submission line has no sender' };
  }

  const hostFromText = HOST_IN_TEXT_RE.exec(`${body} ${cField.value ?? ''}`);
  const remoteHostname = extractToken(body, HOST_TOKEN_RE) ?? (hostFromText ? (hostFromText[1] ?? null) : null);

  const smtpResponseCode = extractSmtpCode(cField.value, body);
  const smtpResponseText =
    cField.value !== null && cField.value.trim() !== '' ? cField.value.trim() : extractReason(body);
  const reason = extractReason(body);

  return {
    kind: 'event',
    event: {
      timestamp: stamp.date,
      messageId,
      flag,
      eventType,
      sender: sender === '<>' ? '<>' : sender,
      recipient,
      originalRecipient,
      remoteHostname,
      smtpResponseCode,
      smtpResponseText,
      transport: extractToken(body, TRANSPORT_TOKEN_RE),
      router: extractToken(body, ROUTER_TOKEN_RE),
      reason,
    },
  };
}

/** Parses a whole log file (or a chunk of one) and reports everything it saw. */
export function parseMainlog(text: string): MainlogParseResult {
  const events: RawEximEvent[] = [];
  const rejected: RejectedLine[] = [];
  const ignored: Array<{ lineNumber: number; reason: string }> = [];

  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (line.trim() === '') continue;
    const outcome = parseMainlogLine(line, index + 1);
    if (outcome.kind === 'event') events.push(outcome.event);
    else if (outcome.kind === 'rejected') rejected.push({ lineNumber: index + 1, reason: outcome.reason });
    else ignored.push({ lineNumber: index + 1, reason: outcome.reason });
  }

  return { events, rejected, ignored };
}
