/**
 * Event-identity hashing.
 *
 * The database enforces `UNIQUE (source_server_id, source_event_hash)`, so this hash is the only
 * thing standing between "collected twice" and "counted twice". It therefore has to be:
 *
 *   - **deterministic** — the same log line always produces the same hash, so a re-read after a
 *     crash, a rotated file, or an operator-triggered run collapses into `ON CONFLICT DO NOTHING`;
 *   - **server-scoped** — the same message seen on two servers is two pieces of evidence, not one;
 *   - **narrow on purpose** — only the fields that identify the event participate. Free text
 *     (an SMTP reply's wording) changes between retries and must not create a second event.
 */
import { createHash } from 'node:crypto';
import type { TraceEventType } from './types';

export interface SourceEventIdentity {
  /** The server the evidence came from; identical events on two servers are two events. */
  sourceServerId: string;
  messageId: string;
  eventType: TraceEventType;
  /** The source timestamp, to whole seconds — sub-second noise must not split an event. */
  eventTimestamp: Date;
  recipient: string;
  smtpResponseCode: number | null;
}

/**
 * Builds the 64-character hex identity of one collected event.
 *
 * The timestamp is truncated to seconds and written in ISO form (UTC) so that two parses of the
 * same line — one from a `Date`, one from a string round trip — hash identically.
 */
export function buildSourceEventHash(identity: SourceEventIdentity): string {
  const timestamp = new Date(Math.floor(identity.eventTimestamp.getTime() / 1000) * 1000).toISOString();
  const parts = [
    identity.sourceServerId,
    identity.messageId,
    identity.eventType,
    timestamp,
    identity.recipient.toLowerCase(),
    identity.smtpResponseCode === null ? '' : String(identity.smtpResponseCode),
  ];
  // NUL is a legal separator here because none of the fields can contain it.
  return createHash('sha256').update(parts.join('\u0000'), 'utf8').digest('hex');
}
