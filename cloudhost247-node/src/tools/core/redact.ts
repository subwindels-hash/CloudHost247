/**
 * Tools Center — redaction of anything that must never reach a log, a report or a support ticket.
 *
 * Two rules, both enforced in one place:
 *   1. Key-based: any key whose name matches a credential pattern is replaced wholesale.
 *   2. Value-based: email bodies, credentials-in-URLs and very long free text are truncated.
 *
 * This is deliberately conservative. A field that *might* be a secret is dropped, because the cost
 * of a dropped diagnostic field is one support question and the cost of a leaked SMTP password is
 * an incident (spec §32, §56, §70, §78).
 */

const SENSITIVE_KEY_PATTERN =
  /(pass(word|wd|phrase)?|secret|token|api[_-]?key|apikey|authorization|cookie|set-cookie|private[_-]?key|client[_-]?secret|credential|card[_-]?number|pan|cvc|cvv|ssn|otp|totp|refresh[_-]?token|access[_-]?token|dtrace|signature|hash)/i;

/** Keys whose *presence* is useful to report, even though the value must not be. */
export const MASK = '«redacted»';

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

const MAX_STRING = 2000;
const MAX_DEPTH = 8;
const MAX_ARRAY = 200;

export interface RedactOptions {
  /** Truncate strings longer than this (default 2000). */
  maxString?: number;
  maxDepth?: number;
  /** Replaces sensitive values with this marker. */
  mask?: string;
}

/**
 * Returns a structurally-similar copy with credential-shaped keys masked and oversized values
 * truncated. Never mutates the input.
 */
export function redact(value: unknown, options: RedactOptions = {}, depth = 0): unknown {
  const maxString = options.maxString ?? MAX_STRING;
  const mask = options.mask ?? MASK;
  if (depth > (options.maxDepth ?? MAX_DEPTH)) return '[truncated: depth]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > maxString ? `${value.slice(0, maxString)}…[truncated ${value.length - maxString} chars]` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[buffer ${value.length} bytes]`;
  if (Array.isArray(value)) {
    const mapped = value.slice(0, MAX_ARRAY).map((item) => redact(item, options, depth + 1));
    if (value.length > MAX_ARRAY) mapped.push(`[truncated ${value.length - MAX_ARRAY} items]`);
    return mapped;
  }
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(key)) {
        if (item === null || item === undefined || item === '' || item === false) {
          output[key] = item;
        } else {
          output[key] = mask;
        }
        continue;
      }
      output[key] = redact(item, options, depth + 1);
    }
    return output;
  }
  return String(value);
}

/** Redacts a header map, preserving which headers were present. */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    output[key] = isSensitiveKey(key) ? MASK : value.length > 500 ? `${value.slice(0, 500)}…` : value;
  }
  return output;
}

/**
 * Redacts a raw email header for storage in a report: the analysis output is what gets saved, and
 * this guarantees that a Message-ID/Received chain never carries a credential into the database.
 */
export function redactEmailHeader(header: string): string {
  return header
    .split('\n')
    .filter((line) => !/^\s*(authorization|proxy-authorization|x-auth-token)\s*:/i.test(line))
    .join('\n')
    .slice(0, 20_000);
}

/**
 * Builds a short, safe label for the "target" column of history/execution logs (spec §56): a
 * hostname, IP or URL host — never a full URL with a query string, never a credential.
 */
export function safeTargetLabel(input: string, maxLength = 255): string {
  let value = input.trim();
  if (value.length === 0) return '';
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    // Host only: drops userinfo, path, query and fragment in one step.
    value = url.host;
  } catch {
    value = value.split(/[\s,;]/)[0] ?? value;
    value = value.replace(/[?#].*$/, '');
    if (value.includes('@')) value = value.slice(value.indexOf('@') + 1);
  }
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}
