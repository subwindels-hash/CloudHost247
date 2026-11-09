/**
 * Raw email header parser for the forensics analyzer.
 *
 * Accepts either complete raw email headers (pasted) or the textual content of an `.eml`
 * file. Produces a normalized `ParsedEmail` containing only header-derived fields — never the
 * body, never attachments.
 *
 * Handles folded headers, duplicate headers, multiple Received entries, IPv4/IPv6, missing or
 * malformed headers, and differing mail-server formats. The original header values are preserved
 * for forensic review.
 *
 * Design rule: never assume the first IP address found is the original sender. The parser only
 * extracts; the extraction engine decides trust and confidence.
 */

import ipaddr from 'ipaddr.js';

import type { ParsedEmail } from './types';

/** Header names the analyzer cares about, canonicalized to lower case. */
const KNOWN_HEADERS = new Set([
  'received',
  'return-path',
  'from',
  'sender',
  'reply-to',
  'to',
  'date',
  'subject',
  'message-id',
  'authentication-results',
  'received-spf',
  'dkim-signature',
  'mime-version',
  'content-type',
  'x-originating-ip',
]);

const X_HEADER_PREFIX = 'x-';

/**
 * Maximum size of input the parser will accept, in bytes. `.eml` uploads and pasted headers are
 * both capped here so a huge body can never exhaust memory. The header block itself is usually
 * well under 100 KB.
 */
const MAX_INPUT_BYTES = 2_000_000;

/** A single parsed header: canonical name, original name, and value. */
interface RawHeader {
  name: string;        // canonical lower-case name
  originalName: string; // exactly as it appeared
  value: string;       // unfolded (joined) value
}

/**
 * Split raw text into header lines, unfolding folded headers per RFC 5322 §2.2.3: a header
 * continues when the next line begins with whitespace (WSP). Lines are joined with a single
 * space. The blank line terminates the header block (everything after is body, ignored).
 *
 * Returns the raw headers plus a flag indicating whether any folding was present.
 */
function unfoldHeaders(text: string): { headers: RawHeader[]; folded: boolean } {
  const lines = text.split(/\r?\n/);
  const headers: RawHeader[] = [];
  let folded = false;
  let i = 0;

  while (i < lines.length) {
    // i < lines.length guarantees lines[i] is defined; the indexer returns `string | undefined`
    // under noUncheckedIndexedAccess, so assert non-null here.
    const line = lines[i]!;

    // Blank line ends the header block.
    if (line.trim() === '') break;

    // A folded continuation line (starts with WSP) belongs to the previous header.
    if ((line.startsWith(' ') || line.startsWith('\t')) && headers.length > 0) {
      folded = true;
      const last = headers[headers.length - 1]!;
      last.value += ' ' + line.trim();
      i += 1;
      continue;
    }

    // A real header line: "Name: value".
    const colon = line.indexOf(':');
    if (colon === -1) {
      // Malformed line with no colon — skip it, do not treat as a header.
      i += 1;
      continue;
    }

    const originalName = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    i += 1;

    // Consume any folded continuations immediately following this header.
    while (i < lines.length) {
      const next = lines[i]!;
      if (next.startsWith(' ') || next.startsWith('\t')) {
        folded = true;
        value += ' ' + next.trim();
        i += 1;
      } else {
        break;
      }
    }

    headers.push({ name: originalName.toLowerCase(), originalName, value });
  }

  return { headers, folded };
}

/**
 * Parse raw email text into a ParsedEmail.
 *
 * Throws plain errors (string messages) when the input is empty or too large; callers convert
 * those to HTTP errors.
 */
export function parseEmail(text: string): ParsedEmail {
  if (typeof text !== 'string') throw new Error('Email input must be a string');
  if (text.trim() === '') throw new Error('No email content provided');
  if (Buffer.byteLength(text, 'utf8') > MAX_INPUT_BYTES) {
    throw new Error('Email content exceeds the maximum allowed size');
  }

  const { headers, folded } = unfoldHeaders(text);

  const byName = new Map<string, string[]>();
  for (const header of headers) {
    const existing = byName.get(header.name) ?? [];
    existing.push(header.value);
    byName.set(header.name, existing);
  }

  const getFirst = (name: string): string | null => {
    const values = byName.get(name);
    return values && values.length > 0 ? (values[0] ?? null) : null;
  };
  const getAll = (name: string): string[] => byName.get(name) ?? [];

  const received = getAll('received');
  const xHeaders: Record<string, string[]> = {};
  for (const [name, values] of byName) {
    if (name.startsWith(X_HEADER_PREFIX) && name !== 'x-originating-ip') {
      xHeaders[name] = values;
    }
  }

  return {
    headers: Object.fromEntries(byName),
    folded,
    received,
    returnPath: getFirst('return-path'),
    from: getFirst('from'),
    sender: getFirst('sender'),
    replyTo: getFirst('reply-to'),
    to: getFirst('to'),
    date: getFirst('date'),
    subject: getFirst('subject'),
    messageId: getFirst('message-id'),
    authenticationResults: getFirst('authentication-results'),
    receivedSpf: getFirst('received-spf'),
    dkimSignature: getFirst('dkim-signature'),
    mimeVersion: getFirst('mime-version'),
    contentType: getFirst('content-type'),
    xOriginatingIp: getFirst('x-originating-ip'),
    xHeaders,
  };
}

/**
 * Broad token pattern: matches anything that could be an IP address, including bracketed and
 * unbracketed IPv4/IPv6 forms. Candidates are validated with ipaddr.js in
 * `findIpCandidatesInValue`, so this pattern only needs to be inclusive.
 */
const IP_TOKEN_BRACKETED = /\[([^\]]+)\]/g;
const IP_TOKEN_PLAIN = /(?:^|[^\d\w:])((?:\d{1,3}\.){3}\d{1,3}|(?:[0-9a-fA-F]{1,4}:){1,7}[0-9a-fA-F]{0,4}|::(?:[0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{0,4})(?=[^\d\w:]|$)/g;

/**
 * Find all IP-looking tokens in a header value. Each result carries the matched text and the
 * offset within the value so callers can preserve context for forensic review.
 *
 * Candidates are validated with ipaddr.js so malformed tokens (e.g. "999.999.999.999") are
 * rejected. Bracketed forms ([192.0.2.1], [2001:db8::1]) are matched first, then plain forms.
 */
export function findIpCandidatesInValue(value: string): Array<{ ip: string; raw: string; start: number; end: number }> {
  const out: Array<{ ip: string; raw: string; start: number; end: number }> = [];

  // Bracketed form: [192.0.2.1] or [2001:db8::1]
  let match: RegExpExecArray | null;
  IP_TOKEN_BRACKETED.lastIndex = 0;
  while ((match = IP_TOKEN_BRACKETED.exec(value)) !== null) {
    const raw = match[0];
    const ip = match[1]!;
    if (!ip || !ipaddr.isValid(ip)) continue;
    out.push({ ip, raw, start: match.index!, end: match.index! + raw.length });
  }

  // Plain (unbracketed) form: 192.0.2.1 or 2001:db8::1
  IP_TOKEN_PLAIN.lastIndex = 0;
  while ((match = IP_TOKEN_PLAIN.exec(value)) !== null) {
    const raw = match[0];
    const ip = match[1];
    if (!ip) continue;
    // Skip if this plain match is already covered by a bracketed match (same span).
    const matchIndex = match.index!;
    const alreadyCovered = out.some(
      (o) => o.start === matchIndex || (o.start < matchIndex && o.end > matchIndex + raw.length)
    );
    if (alreadyCovered) continue;
    if (ipaddr.isValid(ip)) {
      out.push({ ip, raw, start: matchIndex, end: matchIndex + raw.length });
    }
  }

  // Sort by position and de-duplicate identical IPs at the same position.
  out.sort((a, b) => a.start - b.start);
  return out;
}
