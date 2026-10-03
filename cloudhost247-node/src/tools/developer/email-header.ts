/**
 * Tools Center — e-mail header analyser (spec §33).
 *
 * Parses raw message headers and explains the delivery path: the Received chain (hop by hop, with
 * timestamps and delays), the authentication results the receiving server recorded (SPF/DKIM/DMARC),
 * envelope vs header sender, Message-ID/Date sanity, and the classic spoofing red flags.
 *
 * Two constraints:
 *   - The tool reports evidence, not a verdict. It never says "this is phishing": it says what the
 *     headers show and which checks failed, and it labels every inference as an inference.
 *   - Nothing is uploaded anywhere; parsing is entirely local to this process.
 */
import { invalidInput } from '../core/errors';
import { sanitizeUntrustedText } from '../core/validation';

export interface ParsedHeader {
  name: string;
  value: string;
  line: number;
}

export interface ReceivedHop {
  position: number;
  raw: string;
  from: string | null;
  by: string | null;
  withProtocol: string | null;
  id: string | null;
  for: string | null;
  timestamp: string | null;
  timestampIso: string | null;
  delaySeconds: number | null;
  sourceIp: string | null;
  tls: boolean;
  privateIp: boolean;
  notes: string[];
}

export interface AuthenticationResult {
  authservId: string | null;
  spf: string | null;
  dkim: string | null;
  dmarc: string | null;
  arc: string | null;
  raw: string;
}

export interface EmailHeaderResult {
  headers: ParsedHeader[];
  headerCount: number;
  subject: string | null;
  from: { display: string | null; address: string | null; domain: string | null };
  replyTo: { display: string | null; address: string | null; domain: string | null };
  returnPath: string | null;
  messageId: { value: string | null; domain: string | null; valid: boolean; detail: string };
  date: { value: string | null; parsedIso: string | null; skewMinutes: number | null; detail: string };
  received: { hops: ReceivedHop[]; totalDelaySeconds: number | null; suspicious: string[] };
  authentication: { results: AuthenticationResult[]; dkimSignatures: Array<{ domain: string | null; selector: string | null; algorithm: string | null; signedHeaders: string[]; bodyLength: string | null }> };
  indicators: Array<{ code: string; severity: 'info' | 'warning' | 'high'; detail: string; evidence: string | null }>;
  alignment: { fromDomain: string | null; returnPathDomain: string | null; dkimDomain: string | null; spfDomain: string | null; aligned: boolean; detail: string };
  notes: string[];
}

const HEADER_NAME = /^[!-9;-~]+$/;

/** Unfolds RFC 5322 continuation lines; every header keeps the line number it started on. */
export function parseHeaders(input: string): ParsedHeader[] {
  const headers: ParsedHeader[] = [];
  const lines = input.split(/\r?\n/);
  let current: ParsedHeader | null = null;
  let inBody = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (inBody) break;
    if (line.trim().length === 0) {
      inBody = true;
      continue;
    }
    if (/^[ \t]/.test(line) && current) {
      current.value += ` ${line.trim()}`;
      continue;
    }
    const match = /^([!-9;-~]+):[ \t]?(.*)$/.exec(line);
    if (!match || !HEADER_NAME.test(match[1] ?? '')) {
      if (current) headers.push(current);
      current = null;
      inBody = true;
      continue;
    }
    if (current) headers.push(current);
    current = { name: (match[1] ?? '').toLowerCase(), value: match[2] ?? '', line: index + 1 };
  }
  if (current) headers.push(current);
  return headers;
}

function firstHeader(headers: ParsedHeader[], name: string): string | null {
  return headers.find((header) => header.name === name)?.value ?? null;
}

function allHeaders(headers: ParsedHeader[], name: string): string[] {
  return headers.filter((header) => header.name === name).map((header) => header.value);
}

function parseAddress(value: string | null): { display: string | null; address: string | null; domain: string | null } {
  if (!value) return { display: null, address: null, domain: null };
  const angle = /<([^>]+)>/.exec(value);
  const address = (angle?.[1] ?? value.split(/\s+/).find((part) => part.includes('@')) ?? '').trim().replace(/^<|>$/g, '').toLowerCase() || null;
  const display = angle ? sanitizeUntrustedText(value.slice(0, value.indexOf('<')).replace(/^"|"$/g, '').trim(), { maxLength: 200 }) || null : null;
  return { display, address, domain: address?.includes('@') ? address.slice(address.lastIndexOf('@') + 1) : null };
}

function isPrivateIp(ip: string): boolean {
  return /^(?:10\.|127\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(ip) || /^(?:fc|fd|fe80)/i.test(ip);
}

function parseHop(raw: string, position: number, previous: ReceivedHop | null): ReceivedHop {
  const notes: string[] = [];
  const from = /\bfrom\s+([^\s;()]+)(?:\s*\(([^)]*)\))?/i.exec(raw);
  const by = /\bby\s+([^\s;()]+)/i.exec(raw);
  const withProtocol = /\bwith\s+([A-Za-z0-9._-]+)/i.exec(raw);
  const id = /\bid\s+([^\s;]+)/i.exec(raw);
  const forValue = /\bfor\s+<([^>]+)>/i.exec(raw);
  const dateMatch = /;\s*(.+)$/.exec(raw);

  let timestampIso: string | null = null;
  if (dateMatch?.[1]) {
    const parsed = new Date(dateMatch[1].trim());
    if (!Number.isNaN(parsed.getTime())) timestampIso = parsed.toISOString();
    else notes.push('The timestamp on this Received line could not be parsed.');
  } else {
    notes.push('This Received line has no timestamp.');
  }

  const ipMatch = /\[((?:\d{1,3}\.){3}\d{1,3}|[0-9a-f:]{6,})\]/i.exec(raw) ?? /((?:\d{1,3}\.){3}\d{1,3})/.exec(raw);
  const sourceIp = ipMatch?.[1] ?? null;
  const privateIp = sourceIp ? isPrivateIp(sourceIp) : false;

  const delaySeconds = timestampIso && previous?.timestampIso ? Math.round((new Date(timestampIso).getTime() - new Date(previous.timestampIso).getTime()) / 1000) : null;

  return {
    position,
    raw: sanitizeUntrustedText(raw, { maxLength: 600 }),
    from: from?.[1] ? sanitizeUntrustedText(from[1], { maxLength: 200 }) : null,
    by: by?.[1] ? sanitizeUntrustedText(by[1], { maxLength: 200 }) : null,
    withProtocol: withProtocol?.[1] ? sanitizeUntrustedText(withProtocol[1], { maxLength: 60 }) : null,
    id: id?.[1] ? sanitizeUntrustedText(id[1], { maxLength: 100 }) : null,
    for: forValue?.[1] ? sanitizeUntrustedText(forValue[1], { maxLength: 200 }) : null,
    timestamp: dateMatch?.[1] ? sanitizeUntrustedText(dateMatch[1].trim(), { maxLength: 100 }) : null,
    timestampIso,
    delaySeconds,
    sourceIp,
    tls: /\b(?:ESMTPS|SMTPS|ESMTPSA)\b/i.test(raw) || /\(using\s+TLS|with\s+ESMTPS/i.test(raw),
    privateIp,
    notes,
  };
}

function parseAuthenticationResults(value: string): AuthenticationResult {
  const authservId = value.split(';')[0]?.trim() ?? null;
  const extract = (method: string): string | null => {
    const match = new RegExp(`\\b${method}\\s*=\\s*([a-z]+)`, 'i').exec(value);
    return match?.[1]?.toLowerCase() ?? null;
  };
  return {
    authservId: authservId ? sanitizeUntrustedText(authservId, { maxLength: 120 }) : null,
    spf: extract('spf'),
    dkim: extract('dkim'),
    dmarc: extract('dmarc'),
    arc: extract('arc'),
    raw: sanitizeUntrustedText(value, { maxLength: 600 }),
  };
}

export function analyseEmailHeaders(input: { headers: string }): EmailHeaderResult {
  const raw = input.headers ?? '';
  if (raw.trim().length === 0) throw invalidInput('Paste the full message headers (View → Show original / Show source).');
  if (raw.length > 512 * 1024) throw invalidInput('Header input is limited to 512 KB. Paste only the headers, not attachments.');

  const headers = parseHeaders(raw);
  if (headers.length === 0) throw invalidInput('No RFC 5322 headers were recognised. Paste the raw message source, starting with lines such as "Return-Path:" or "Received:".');

  const receivedRaw = allHeaders(headers, 'received');
  // Received lines are prepended by each hop, so the array is newest-first: reverse for chronology.
  const orderedRaw = [...receivedRaw].reverse();
  const hops: ReceivedHop[] = [];
  for (let index = 0; index < orderedRaw.length; index += 1) {
    hops.push(parseHop(orderedRaw[index] ?? '', index + 1, hops[index - 1] ?? null));
  }

  const firstTimestamp = hops.find((hop) => hop.timestampIso)?.timestampIso ?? null;
  const lastTimestamp = [...hops].reverse().find((hop) => hop.timestampIso)?.timestampIso ?? null;
  const totalDelaySeconds = firstTimestamp && lastTimestamp ? Math.round((new Date(lastTimestamp).getTime() - new Date(firstTimestamp).getTime()) / 1000) : null;

  const suspicious: string[] = [];
  for (const hop of hops) {
    if (hop.delaySeconds !== null && hop.delaySeconds < -60) suspicious.push(`Hop ${hop.position}: the timestamp is earlier than the previous hop by ${Math.abs(hop.delaySeconds)}s — clock skew or a hand-edited header.`);
    if (hop.delaySeconds !== null && hop.delaySeconds > 3600) suspicious.push(`Hop ${hop.position}: a delay of ${Math.round(hop.delaySeconds / 60)} minutes. Normal for a greylisted message, but worth noticing.`);
    if (hop.privateIp) suspicious.push(`Hop ${hop.position}: an internal/private address (${hop.sourceIp}) appears in the public path. This can be legitimate relaying but is also a sign of a forged header.`);
    if (hop.withProtocol && /^smtp$/i.test(hop.withProtocol)) suspicious.push(`Hop ${hop.position}: the hop used plain SMTP without TLS.`);
  }

  const dkimSignatures = allHeaders(headers, 'dkim-signature').map((signature) => {
    const tag = (name: string): string | null => {
      const match = new RegExp(`(?:^|;)\\s*${name}\\s*=\\s*([^;]+)`, 'i').exec(signature);
      return match?.[1]?.trim() ?? null;
    };
    return {
      domain: tag('d'),
      selector: tag('s'),
      algorithm: tag('a'),
      signedHeaders: (tag('h') ?? '').split(':').map((header) => header.trim().toLowerCase()).filter(Boolean),
      bodyLength: tag('l'),
    };
  });

  const from = parseAddress(firstHeader(headers, 'from'));
  const replyTo = parseAddress(firstHeader(headers, 'reply-to'));
  const returnPath = firstHeader(headers, 'return-path');
  const envelopeMatch = /<([^>]+)>/.exec(returnPath ?? '');
  const returnPathAddress = (envelopeMatch?.[1] ?? returnPath?.trim() ?? '').toLowerCase() || null;
  const returnPathDomain = returnPathAddress?.includes('@') ? returnPathAddress.slice(returnPathAddress.lastIndexOf('@') + 1) : null;

  const messageIdRaw = firstHeader(headers, 'message-id');
  const messageIdValue = messageIdRaw ? (/,*<([^>]+)>/.exec(messageIdRaw)?.[1] ?? messageIdRaw.trim()) : null;
  const messageIdDomain = messageIdValue?.includes('@') ? messageIdValue.slice(messageIdValue.lastIndexOf('@') + 1).toLowerCase() : null;

  const dateRaw = firstHeader(headers, 'date');
  const dateParsed = dateRaw ? new Date(dateRaw) : null;
  const dateValid = Boolean(dateParsed && !Number.isNaN(dateParsed.getTime()));
  const skewMinutes = dateValid && dateParsed ? Math.round((Date.now() - dateParsed.getTime()) / 60000) : null;

  const authenticationResults = allHeaders(headers, 'authentication-results').map(parseAuthenticationResults);
  const lastAuth = authenticationResults[authenticationResults.length - 1];

  const indicators: EmailHeaderResult['indicators'] = [];
  const domainAligned = from.domain !== null && returnPathDomain !== null && from.domain === returnPathDomain;
  if (from.domain && returnPathDomain && !domainAligned) {
    indicators.push({
      code: 'FROM_RETURNPATH_MISMATCH',
      severity: 'warning',
      detail: 'The visible From domain differs from the envelope sender (Return-Path). This is normal for mailing lists and bulk senders using a bounce domain — and is also what spoofing looks like when the checks above did not fail. Compare it with the SPF/DKIM results.',
      evidence: `From: ${from.domain} vs Return-Path: ${returnPathDomain}`,
    });
  }
  if (lastAuth?.dmarc && lastAuth.dmarc !== 'pass') {
    indicators.push({ code: 'DMARC_NOT_PASS', severity: 'high', detail: `The receiving server's Authentication-Results recorded DMARC=${lastAuth.dmarc.toUpperCase()}.`, evidence: lastAuth.raw });
  }
  if (lastAuth?.spf && lastAuth.spf !== 'pass') {
    indicators.push({ code: 'SPF_NOT_PASS', severity: 'warning', detail: `SPF=${lastAuth.spf.toUpperCase()} was recorded by the receiving server.`, evidence: lastAuth.raw });
  }
  if (!messageIdValue) {
    indicators.push({ code: 'NO_MESSAGE_ID', severity: 'warning', detail: 'The message has no Message-ID. Almost every legitimate mail client and MTA adds one; its absence is a weak signal of a scripted sender.', evidence: null });
  } else if (!/^[^@\s]+@[^@\s]+$/.test(messageIdValue)) {
    indicators.push({ code: 'MALFORMED_MESSAGE_ID', severity: 'warning', detail: 'The Message-ID is not in the expected id@domain form.', evidence: messageIdValue });
  }
  if (!dateValid) {
    indicators.push({ code: 'DATE_UNPARSEABLE', severity: 'warning', detail: 'The Date header is missing or could not be parsed.', evidence: dateRaw });
  } else if (skewMinutes !== null && skewMinutes < -5) {
    indicators.push({ code: 'DATE_IN_FUTURE', severity: 'warning', detail: `The Date header is ${Math.abs(skewMinutes)} minutes in the future relative to this server.`, evidence: dateRaw });
  }
  if (!returnPath && !firstHeader(headers, 'received-spf')) {
    indicators.push({ code: 'NO_ENVELOPE', severity: 'info', detail: 'Neither Return-Path nor Received-SPF is present. Copying headers by hand often drops them, so treat this as inconclusive.', evidence: null });
  }
  for (const hop of hops) {
    if (hop.privateIp) {
      indicators.push({ code: 'PRIVATE_IP_IN_PATH', severity: 'info', detail: `Hop ${hop.position} shows a private address (${hop.sourceIp}), which is normal for the first hop inside a sending organisation.`, evidence: hop.sourceIp });
    }
  }
  if (!lastAuth) {
    indicators.push({ code: 'NO_AUTHENTICATION_RESULTS', severity: 'info', detail: 'No Authentication-Results header is present — either the receiving server does not add them, or the header block is incomplete.', evidence: null });
  }

  const aligned = Boolean(from.domain && returnPathDomain && from.domain === returnPathDomain && (!dkimSignatures[0]?.domain || dkimSignatures[0].domain === from.domain));

  return {
    headers,
    headerCount: headers.length,
    subject: firstHeader(headers, 'subject') ? sanitizeUntrustedText(firstHeader(headers, 'subject'), { maxLength: 400 }) : null,
    from,
    replyTo,
    returnPath: returnPathAddress,
    messageId: {
      value: messageIdValue ? sanitizeUntrustedText(messageIdValue, { maxLength: 300 }) : null,
      domain: messageIdDomain,
      valid: Boolean(messageIdValue && /^[^@\s]+@[^@\s]+$/.test(messageIdValue)),
      detail: !messageIdValue ? 'Missing.' : /^[^@\s]+@[^@\s]+$/.test(messageIdValue) ? 'Well-formed (id@domain).' : 'Present but malformed.',
    },
    date: {
      value: dateRaw ? sanitizeUntrustedText(dateRaw, { maxLength: 120 }) : null,
      parsedIso: dateValid && dateParsed ? dateParsed.toISOString() : null,
      skewMinutes,
      detail: !dateRaw ? 'Missing.' : dateValid ? (skewMinutes !== null && Math.abs(skewMinutes) > 60 ? `Parsed, ${Math.abs(skewMinutes)} minutes ${skewMinutes > 0 ? 'in the past' : 'in the future'} relative to this server.` : 'Parsed and consistent with the current time.') : 'Could not be parsed as a date.',
    },
    received: { hops, totalDelaySeconds, suspicious },
    authentication: { results: authenticationResults, dkimSignatures },
    indicators,
    alignment: {
      fromDomain: from.domain,
      returnPathDomain,
      dkimDomain: dkimSignatures[0]?.domain ?? null,
      spfDomain: lastAuth?.spf === 'pass' ? returnPathDomain : null,
      aligned,
      detail: aligned
        ? 'The From domain, the envelope sender and the DKIM signing domain agree.'
        : 'The identity domains do not all agree. Read the individual SPF/DKIM/DMARC results before drawing a conclusion: forwarding and mailing lists legitimately break alignment.',
    },
    notes: [
      'Received headers are written by each server in the chain, newest first. A later server can only vouch for what the previous one told it, so the first (lowest) Received line is the only one an attacker could not have prepended.',
      'Authentication-Results is reported as recorded by the receiving server. It is exactly as trustworthy as that server, and different services apply different policies.',
      'This analysis cannot prove authenticity. It shows the evidence and the failed checks; whether a message is genuine depends on context this tool does not have.',
    ],
  };
}
