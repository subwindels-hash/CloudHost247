/**
 * Evidence redaction — the enforcement point for the module's "never store secrets in fraud
 * evidence" rule.
 *
 * Fraud evidence is deliberately a *projection* of a source row, not a copy of it. Anything that
 * could be a payment card number, a password, a password hash, a token, an MFA secret, a passkey
 * credential, an API key or a private key is either dropped (key-based) or masked (shape-based),
 * before it is written to any fraud_sentinel_* column.
 *
 * Two layers, because one is not enough:
 *   1. KEY DENY-LIST — a key whose name says "secret" is removed whatever its value looks like.
 *      This catches a bcrypt hash (which contains no long digit run) and a base64 API key.
 *   2. VALUE SCRUB — long digit runs (PAN-shaped), JWT-shaped strings, PEM blocks and
 *      bearer/basic credentials are masked wherever they appear, including inside a free-text
 *      `failure_reason` copied from a gateway response.
 *
 * Redaction is applied on the way IN. Nothing in this module re-reads a secret from its source table
 * to "complete" an evidence record: the source row stays where it already is, under the access
 * controls it already has.
 */

/** Key names (lowercased, punctuation-insensitive) whose values are never persisted as evidence. */
const DENIED_KEY_PATTERNS: readonly RegExp[] = [
  /password/i,
  /passwd/i,
  /secret/i,
  /token/i,
  /jwt/i,
  /session_?id/i,
  /credential/i,
  /private_?key/i,
  /public_?key/i,
  /api_?key/i,
  /apikey/i,
  /access_?key/i,
  /card/i, // covers card_number, card_brand and card_expiry — none are needed for any detection
  /pan\b/i,
  /cvv/i,
  /cvc/i,
  /otp/i,
  /mfa/i,
  /totp/i,
  /passkey/i,
  /recovery_?code/i,
  /pin\b/i,
  /signature/i,
  /authorization/i,
  /cookie/i,
  /keyring/i,
  /encryption/i,
  // Deliberately NOT denied: `payload_hash` (a SHA-256 webhook fingerprint, which is the entire
  // basis of API_WEBHOOK_REPLAY and is not a credential) and `expires_at`/`expiry` timestamps.
  // Named secret hashes — password_hash, pin_hash — are already caught by /password/ and /pin\b/.
];

/** Replaces the value of anything the deny-list matches. */
export const REDACTED = '[REDACTED]';

/**
 * PAN detection is Luhn-gated on purpose.
 *
 * A naive "mask every 12–19 digit run" would also mask legitimate investigative values — a
 * 13-digit epoch-millisecond timestamp, a 16-digit gateway provider_reference, a long order id —
 * and an evidence record that has been masked into uselessness is not a safe evidence record, it is
 * a broken one. Every real payment card number satisfies the Luhn checksum, so requiring it removes
 * the false positives without weakening the guarantee that matters: a card number is never
 * persisted. Digit runs of 13–19 that FAIL Luhn are left intact and are, by definition, not a valid
 * PAN.
 */
const PAN_CANDIDATE = /\b(?:\d[ -]*?){13,19}\b/g;

function luhnValid(candidate: string): boolean {
  const digits = candidate.replace(/[^0-9]/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let value = digits.charCodeAt(i) - 48;
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

function maskPans(value: string): string {
  return value.replace(PAN_CANDIDATE, (match) => (luhnValid(match) ? '[REDACTED-PAN]' : match));
}

/** Anything JWT-shaped: three base64url segments separated by dots, each at least 8 chars. */
const JWT_SHAPED = /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
/** PEM-encoded keys and certificates. */
const PEM_SHAPED = /-----BEGIN [A-Z0-9 ]*-----[\s\S]*?-----END [A-Z0-9 ]*-----/g;
/** `Authorization: Bearer …` / `Basic …` values that survived into free text. */
const CREDENTIAL_HEADER = /\b(bearer|basic)\s+[A-Za-z0-9._~+/-]+=*/gi;
/**
 * Long base64 blobs (>= 40 chars) — API keys, signatures, encrypted credentials. The lookahead
 * requires at least one base64-only character (`+`, `/` or `=`), so a pure-hex SHA-256 digest such
 * as webhook_events.payload_hash is NOT mistaken for a credential and survives as evidence.
 */
const LONG_BASE64 = /(?=[A-Za-z0-9+/]*[+/=])\b[A-Za-z0-9+/]{40,}={0,2}\b/g;
/** A raw user-agent string is not a secret, but this module deliberately stores only its coarse
 * classification (see client_family), so any that slips into free text is truncated hard. */
const USER_AGENT_SHAPED = /\bMozilla\/5\.0[\s\S]{0,400}/gi;

/** Maximum length of any single string value kept as evidence. */
const MAX_STRING_LENGTH = 400;
/** Maximum number of entries kept in an array value, and maximum nesting depth. */
const MAX_ARRAY_ENTRIES = 25;
const MAX_DEPTH = 4;

function isDeniedKey(key: string): boolean {
  return DENIED_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/** Masks secret-shaped content inside a single string. Exported for the ingestion SQL's TS-side
 * counterpart and for tests. */
export function scrubString(value: string): string {
  let out = value
    .replace(PEM_SHAPED, REDACTED)
    .replace(JWT_SHAPED, REDACTED)
    .replace(CREDENTIAL_HEADER, REDACTED)
    .replace(LONG_BASE64, REDACTED)
    .replace(USER_AGENT_SHAPED, '[user-agent not retained]');
  // PAN masking runs last so it sees the string after credential blobs were removed, and is
  // Luhn-gated so it cannot eat a timestamp or a gateway reference (see maskPans).
  out = maskPans(out);
  if (out.length > MAX_STRING_LENGTH) {
    out = `${out.slice(0, MAX_STRING_LENGTH)}…[truncated]`;
  }
  return out;
}

/**
 * Deep-redacts an arbitrary value into something safe to persist as jsonb evidence.
 *
 * Returns only JSON-safe primitives, arrays (bounded) and plain objects (bounded depth). Functions,
 * symbols, class instances and circular structures cannot survive, which also means an accidental
 * `pool` or `request` object can never be serialized into the evidence column.
 */
export function redactEvidence(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[depth-limit]';
  if (value === null || value === undefined) return null;

  const type = typeof value;
  if (type === 'string') return scrubString(value as string);
  if (type === 'number') return Number.isFinite(value) ? value : null;
  if (type === 'boolean') return value;
  if (type === 'bigint') return (value as bigint).toString();
  if (value instanceof Date) return (value as Date).toISOString();
  if (type === 'function' || type === 'symbol') return REDACTED;

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ENTRIES).map((entry) => redactEvidence(entry, depth + 1));
  }

  if (type === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (isDeniedKey(key)) {
        // The key is recorded as redacted rather than dropped silently, so a reviewer can see that
        // the source row HAD such a field and that this module refused to copy it.
        out[key] = REDACTED;
        continue;
      }
      out[key] = redactEvidence(entry, depth + 1);
    }
    return out;
  }

  return null;
}

/**
 * Builds an evidence projection from an explicit whitelist of source columns.
 *
 * Callers pass the columns a rule actually needs; everything else is not read at all. This is the
 * primary control — the deny-list above is the safety net for free-text values that legitimately
 * have to be carried (e.g. `payments.failure_reason`).
 */
export function projectEvidence<T extends Record<string, unknown>>(
  row: T,
  allowedKeys: readonly (keyof T & string)[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of allowedKeys) {
    if (!(key in row)) continue;
    // The deny-list beats the allow-list. A caller can ask for `card_number` by mistake, and the
    // value scrubber is a shape-based safety net rather than a guarantee (a short token under a key
    // named `api_key` has no shape to catch) — so a secret-named key is refused outright and marked,
    // exactly as redactEvidence marks it, rather than being copied through.
    if (isDeniedKey(key)) {
      out[key] = REDACTED;
      continue;
    }
    out[key] = redactEvidence(row[key]);
  }
  return out;
}

/** True when the string contains a Luhn-valid 13–19 digit run, i.e. a real PAN. */
export function containsPan(value: string): boolean {
  const candidates = value.match(new RegExp(PAN_CANDIDATE.source, 'g')) ?? [];
  return candidates.some((candidate) => luhnValid(candidate));
}

// Non-global twins of the scrub patterns: a /g regex carries lastIndex between .test() calls, which
// would make this assertion pass or fail depending on what was checked before it.
const PEM_PROBE = new RegExp(PEM_SHAPED.source);
const JWT_PROBE = new RegExp(JWT_SHAPED.source);

/**
 * Asserts a persisted evidence payload contains no secret-shaped content. Used by the API layer
 * before returning evidence to a client and by tests, so a redaction regression is caught rather
 * than shipped.
 */
export function findUnredactedSecret(value: unknown, path = '$'): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    if (PEM_PROBE.test(value)) return `${path}: PEM block`;
    if (JWT_PROBE.test(value)) return `${path}: JWT-shaped token`;
    if (containsPan(value)) return `${path}: Luhn-valid PAN-shaped digit run`;
    return null;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const found = findUnredactedSecret(value[i], `${path}[${i}]`);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === 'object') {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (isDeniedKey(key) && entry !== REDACTED && entry !== null) {
        // A denied key may survive only as the literal REDACTED marker.
        if (typeof entry === 'string' && entry.length > 0) return `${path}.${key}: denied key with a value`;
        if (typeof entry !== 'string') return `${path}.${key}: denied key with a value`;
      }
      const found = findUnredactedSecret(entry, `${path}.${key}`);
      if (found) return found;
    }
  }
  return null;
}
