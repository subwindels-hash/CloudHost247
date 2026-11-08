/**
 * Email Trace Centre — the vocabulary shared by the parser, the resolver, the repository and the
 * API. Nothing in this file performs I/O, which is what makes every rule below testable from
 * fixtures without a mail server.
 *
 * The statuses are deliberately narrow. A submission is not a delivery; a remote 2xx is not an
 * inbox placement; an absent line is not a failure. Anything the evidence does not settle is
 * `UNKNOWN`, and the UI must render it as incomplete rather than guess.
 */

/**
 * The nine statuses of docs/EMAIL-TRACE-CENTRE-ARCHITECTURE.md §4.5.
 *
 * - `ACCEPTED`   our own MTA accepted the submission (`<=`)
 * - `QUEUED`     the message is in the queue (queue snapshot / no delivery attempt yet)
 * - `PROCESSING` a delivery attempt is in progress (or the trace is mid-flight)
 * - `DEFERRED`   temporary failure, will be retried (`==`)
 * - `DELIVERED`  the receiving server accepted the message (`=>`, `->`) — NOT inbox placement
 * - `BOUNCED`    returned as undeliverable (permanent remote 5xx on `**`)
 * - `REJECTED`   refused during the SMTP conversation (`<*`)
 * - `FAILED`     permanent local processing/delivery failure (`**` without a remote SMTP code)
 * - `UNKNOWN`    the evidence is insufficient to determine the result
 */
export const DELIVERY_STATUSES = [
  'ACCEPTED',
  'QUEUED',
  'PROCESSING',
  'DEFERRED',
  'DELIVERED',
  'BOUNCED',
  'REJECTED',
  'FAILED',
  'UNKNOWN',
] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** The kinds of line the collector can turn into an event. */
export const TRACE_EVENT_TYPES = [
  'submission',
  'routing',
  'delivery',
  'additional_delivery',
  'completion',
  'deferral',
  'bounce',
  'rejection',
  'queue_snapshot',
] as const;

export type TraceEventType = (typeof TRACE_EVENT_TYPES)[number];

/**
 * Exim's message-log flags, as documented in the Exim specification's "log files" chapter.
 *
 * `*>` (delivery suppressed by `-N`) is recognised but intentionally not turned into an event:
 * nothing was delivered and nothing failed, so decorating it with a status would invent an
 * outcome. The parser reports it as skipped with a reason instead.
 */
export const EXIM_FLAGS = ['<=', '=>', '->', '**', '==', '*>', '<*', '!!'] as const;

export type EximFlag = (typeof EXIM_FLAGS)[number];

/** One parsed mainlog line, before normalisation. No raw line text is kept — see §1 of the ADR. */
/**
 * How much a mail server can tell us about one collection channel. `unknown` means "not probed",
 * never "probably fine" — the UI renders it as a warning, not as success.
 */
export type EmailTraceCapabilityState = 'available' | 'unavailable' | 'unsupported' | 'unknown';

export interface RawEximEvent {
  /** UTC instant parsed from the line's leading timestamp. */
  timestamp: Date;
  /** The Exim message id as logged, e.g. `1xYzAb-000123-CD`. */
  messageId: string;
  flag: EximFlag;
  eventType: TraceEventType;
  /** Present on `<=` only (`<>` for the null reverse-path of a bounce). */
  sender: string | null;
  /** The address this line is about. */
  recipient: string | null;
  /** The original envelope recipient shown in `<...>` on forwarded/aliased deliveries. */
  originalRecipient: string | null;
  /** `H=` host or the `host <name> [<ip>]` form in an error text. */
  remoteHostname: string | null;
  /** A real SMTP reply code (100–599). Never the number inside `defer (-44)`. */
  smtpResponseCode: number | null;
  smtpResponseText: string | null;
  /** `T=` transport, e.g. `remote_smtp`, `local_delivery`. */
  transport: string | null;
  /** `R=` router, e.g. `dnslookup`. */
  router: string | null;
  /** The deferral/failure explanation, cleaned of control characters and truncated. */
  reason: string | null;
}

/** A line that could not become an event, with the reason it was rejected. */
export interface RejectedLine {
  lineNumber: number;
  reason: string;
}

export interface MainlogParseResult {
  events: RawEximEvent[];
  rejected: RejectedLine[];
  /** Lines that were recognised but deliberately produce no event (e.g. `Completed`, `*>`). */
  ignored: Array<{ lineNumber: number; reason: string }>;
}

/** A row ready to be inserted into `email_trace_events` (all server/ownership fields added later). */
export interface NormalisedTraceEvent {
  traceId: string;
  providerMessageId: string;
  sender: string;
  recipient: string;
  senderDomain: string;
  recipientDomain: string;
  eventType: TraceEventType;
  deliveryStatus: DeliveryStatus;
  smtpResponseCode: number | null;
  smtpResponseText: string | null;
  remoteHostname: string | null;
  eventTimestamp: Date;
  sourceEventHash: string;
}

export interface NormaliseOptions {
  /** Truncate free-text fields; the database columns are 500/255 characters wide. */
  maxSmtpText?: number;
  maxHostname?: number;
  /**
   * The sender the collector learned from the trace's submission line. Delivery, deferral and
   * bounce lines do not repeat it, and it is never assumed: without this, the event is rejected.
   */
  senderFallback?: string | null;
}

/** Result of normalising one parsed event. A rejection carries the reason it could not be stored. */
export type NormaliseResult =
  | { ok: true; event: NormalisedTraceEvent }
  | { ok: false; reason: string };

/** Output of `exim -bp`, reduced to what the queue view may show. */
export interface QueuedMessage {
  messageId: string;
  /** Age as parsed from the listing, in seconds; null when the token was not understood. */
  ageSeconds: number | null;
  /** The size token exactly as printed (`1.3K`), kept as text because it is informational only. */
  sizeText: string | null;
  sender: string | null;
  recipientCount: number;
  /** True when the listing carries an error line for this message (a deferral). */
  hasError: boolean;
}

export interface QueueSnapshot {
  messages: QueuedMessage[];
  count: number;
  oldestSeconds: number | null;
  deferred: number;
  /** Lines the parser did not understand. Reported, not hidden. */
  unparsedLines: number;
}
