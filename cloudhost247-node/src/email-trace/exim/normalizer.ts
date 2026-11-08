/**
 * Normalisation: a parsed Exim event becomes a row that is safe to store.
 *
 * This is where the storage rules are enforced, not in the collector:
 *
 *   - **Control characters and newlines are stripped** from every free-text field. A mail log is
 *     attacker-influenced text (a sender chooses its own SMTP banner and error string), so a
 *     newline smuggled into `smtp_response_text` must never reach a log file or a UI as a second
 *     line. This is the log-injection boundary.
 *   - **Credentials are redacted.** Exim records the submitting identity (`A=dovecot_login:user`)
 *     and operators sometimes put tokens in error text. Neither is email-trace evidence, so both
 *     are removed here rather than trusted to every downstream consumer.
 *   - **Addresses are validated, not assumed.** A line whose recipient is not address-shaped is
 *     rejected with a reason instead of being stored as a guess.
 *   - **The sender is never invented.** A delivery line does not repeat the sender, so the caller
 *     must supply the sender it learned from the trace's submission line. With neither, the event
 *     is rejected — storing `<>` would falsely describe the message as a bounce.
 */
import { buildSourceEventHash } from '../dedupe';
import { resolveDeliveryStatus } from '../status-resolver';
import type { NormaliseResult, NormalisedTraceEvent, NormaliseOptions, RawEximEvent } from '../types';

const DEFAULT_MAX_SMTP_TEXT = 500;
const DEFAULT_MAX_HOSTNAME = 255;

/** Collapses all whitespace (including newlines and NUL) to single spaces and trims the result. */
export function stripControlCharacters(value: string): string {
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Removes anything that looks like a credential from free text.
 *
 * Covers Exim's `A=<mechanism>:<identity>` authenticator field and the key/value shapes operators
 * paste into error messages. The result keeps the sentence readable — the point is to remove the
 * secret, not to blank the evidence.
 */
export function redactSecrets(value: string): string {
  return value
    .replace(/\bA=[A-Za-z0-9_.-]+:\S*/g, 'A=[redacted]')
    .replace(/\b(password|passwd|pwd|secret|token|api[-_]?key)\b\s*[=:]\s*\S+/gi, '$1=[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._-]{8,}/g, 'Bearer [redacted]');
}

/** Clamps free text to the width of its column, after redaction and stripping. */
export function sanitiseFreeText(value: string | null, maxLength: number): string | null {
  if (value === null) return null;
  const cleaned = redactSecrets(stripControlCharacters(value));
  if (cleaned.length === 0) return null;
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned;
}

export interface ParsedAddress {
  /** The address as it should be stored (local part preserved, domain lower-cased). */
  address: string;
  /** Lower-cased domain, or `''` for the null reverse-path `<>`. */
  domain: string;
}

/**
 * Parses an address out of a log token.
 *
 * Returns `null` for anything that is not address-shaped. `<>` — the null reverse-path a bounce is
 * sent from — is a legal value and is preserved verbatim with an empty domain.
 */
export function parseAddress(raw: string | null | undefined): ParsedAddress | null {
  if (!raw) return null;
  let value = raw.trim();
  if (value === '<>') return { address: '<>', domain: '' };
  // `<addr>` forms appear on forwarded and aliased deliveries.
  while (value.length >= 2 && value.startsWith('<') && value.endsWith('>')) {
    value = value.slice(1, -1).trim();
  }
  if (value === '') return null;

  const at = value.lastIndexOf('@');
  if (at <= 0 || at === value.length - 1) return null;

  const localPart = value.slice(0, at);
  const domain = value.slice(at + 1).replace(/[.,;:]+$/, '').toLowerCase();
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(localPart)) return null;
  if (!/^[a-z0-9.-]+$/.test(domain) || !domain.includes('.')) return null;
  if (value.length > 320) return null;

  return { address: `${localPart}@${domain}`, domain };
}

/**
 * Turns one parsed event into a storable row, computing the dedupe hash on the way through.
 *
 * The server id is part of the hash, so it is a required input: two servers observing the same
 * message are two pieces of evidence and must never collapse into one row.
 */
export function normaliseEvent(
  raw: RawEximEvent,
  sourceServerId: string,
  options: NormaliseOptions = {}
): NormaliseResult {
  const maxSmtpText = options.maxSmtpText ?? DEFAULT_MAX_SMTP_TEXT;
  const maxHostname = options.maxHostname ?? DEFAULT_MAX_HOSTNAME;

  if (!Number.isFinite(raw.timestamp.getTime())) {
    return { ok: false, reason: 'The timestamp could not be parsed.' };
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{5,127}$/.test(raw.messageId)) {
    return { ok: false, reason: 'The message id contains characters the trace cannot store.' };
  }

  const recipient = parseAddress(raw.recipient);
  if (!recipient) {
    return { ok: false, reason: 'The recipient on this line is not an address.' };
  }

  // The sender comes from the line itself (a submission or a bounce), or from the trade's own
  // submission record supplied by the caller. Never from an assumption.
  const senderSource = raw.sender ?? options.senderFallback ?? null;
  if (senderSource === null) {
    return { ok: false, reason: 'The sender for this event is unknown; pass the trace sender explicitly.' };
  }
  const sender = parseAddress(senderSource);
  if (!sender) {
    return { ok: false, reason: 'The sender on this line is not an address.' };
  }

  const resolution = resolveDeliveryStatus(raw);
  const eventTimestamp = new Date(Math.floor(raw.timestamp.getTime() / 1000) * 1000);

  const event: NormalisedTraceEvent = {
    traceId: raw.messageId,
    providerMessageId: raw.messageId,
    sender: sender.address,
    recipient: recipient.address,
    senderDomain: sender.domain,
    recipientDomain: recipient.domain,
    eventType: raw.eventType,
    deliveryStatus: resolution.status,
    smtpResponseCode: raw.smtpResponseCode,
    smtpResponseText: sanitiseFreeText(raw.smtpResponseText, maxSmtpText),
    remoteHostname: sanitiseFreeText(raw.remoteHostname, maxHostname),
    eventTimestamp,
    sourceEventHash: buildSourceEventHash({
      sourceServerId,
      messageId: raw.messageId,
      eventType: raw.eventType,
      eventTimestamp,
      recipient: recipient.address,
      smtpResponseCode: raw.smtpResponseCode,
    }),
  };

  return { ok: true, event };
}
