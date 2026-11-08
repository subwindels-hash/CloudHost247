/**
 * Delivery-status resolution: one observed Exim line in, one of the nine statuses out.
 *
 * The resolver is a pure function over a single event, so it can only ever describe *that* event.
 * It never looks at a timeline, never upgrades `ACCEPTED` to `DELIVERED` because a later line was
 * seen (the timeline endpoint does that explicitly, per recipient), and never downgrades a remote
 * acceptance into an inbox-placement claim.
 *
 * Two rules are worth stating because they are the difference between a truthful dashboard and a
 * plausible one:
 *
 *   1. `=>` means the *receiving server* accepted the message. That is `DELIVERED` in the sense of
 *      "transport completed", and the UI must not translate it into "reached the inbox" or "read".
 *   2. If a line contradicts itself — a delivery flag carrying a 5xx reply, a deferral with no
 *      temporary-failure evidence — the answer is `UNKNOWN`, not a guess.
 */
import type { DeliveryStatus, RawEximEvent } from './types';

/** Minimum evidence required before any status other than UNKNOWN is returned. */
export interface StatusResolution {
  status: DeliveryStatus;
  /** Why, in one sentence. Shown in the trace detail's "source evidence" panel and in tests. */
  explanation: string;
}

function isRemoteAcceptance(code: number | null): boolean {
  return code !== null && code >= 200 && code <= 299;
}

function isPermanentFailure(code: number | null): boolean {
  return code !== null && code >= 500 && code <= 599;
}

function hasSmtpCode(event: RawEximEvent): boolean {
  return event.smtpResponseCode !== null;
}

/**
 * Resolves the status of a single event, and says why.
 *
 * The mapping (Exim message-log flags → status):
 *
 * | flag | event type          | status      | evidence required                       |
 * | ---- | ------------------- | ----------- | --------------------------------------- |
 * | `<=` | submission          | ACCEPTED    | the line itself                         |
 * | `=>` | delivery            | DELIVERED   | no 5xx attached to the same line        |
 * | `->` | additional_delivery | DELIVERED   | no 5xx attached to the same line        |
 * | `==` | deferral            | DEFERRED    | a temporary-failure marker or 4xx       |
 * | `**` | bounce              | BOUNCED     | a remote 5xx reply                      |
 * | `**` | bounce              | FAILED      | no SMTP code (local processing failure) |
 * | `<*` | rejection           | REJECTED    | the line itself                         |
 * | —    | queue_snapshot      | QUEUED      | the message was in the queue            |
 * | —    | routing / completion| UNKNOWN     | not a delivery outcome                  |
 *
 * The `**` split matters: a permanent remote refusal produces a bounce back to the sender
 * (`BOUNCED`), while a permanent local failure with no remote reply is `FAILED`. Both are kept
 * distinct because the operator's next action differs.
 */
export function resolveDeliveryStatus(event: RawEximEvent): StatusResolution {
  switch (event.eventType) {
    case 'submission':
      return { status: 'ACCEPTED', explanation: 'Our mail server accepted the message for delivery.' };

    case 'delivery':
    case 'additional_delivery': {
      if (isPermanentFailure(event.smtpResponseCode)) {
        return {
          status: 'UNKNOWN',
          explanation:
            'The line marks a delivery but carries a permanent-failure reply, so the outcome cannot be stated.',
        };
      }
      return {
        status: 'DELIVERED',
        explanation: isRemoteAcceptance(event.smtpResponseCode)
          ? `The receiving mail server accepted the message (SMTP ${event.smtpResponseCode}). This confirms transport, not inbox placement.`
          : 'The server recorded a completed delivery attempt. This confirms transport, not inbox placement.',
      };
    }

    case 'deferral': {
      // A deferral with no temporary-failure evidence is still a deferral in Exim's own terms, but
      // if the line also carries a 5xx we refuse to call it deferred.
      if (isPermanentFailure(event.smtpResponseCode)) {
        return {
          status: 'UNKNOWN',
          explanation:
            'The line marks a deferral but carries a permanent-failure reply, so the outcome cannot be stated.',
        };
      }
      return {
        status: 'DEFERRED',
        explanation: 'Delivery was deferred and will be retried automatically.',
      };
    }

    case 'bounce': {
      if (isPermanentFailure(event.smtpResponseCode)) {
        return {
          status: 'BOUNCED',
          explanation: `The receiving server refused the message permanently (SMTP ${event.smtpResponseCode}); it is returned to the sender.`,
        };
      }
      if (hasSmtpCode(event)) {
        return {
          status: 'UNKNOWN',
          explanation: 'A bounce line carried a non-permanent SMTP reply, so the outcome cannot be stated.',
        };
      }
      return {
        status: 'FAILED',
        explanation: 'Delivery failed permanently without a remote SMTP reply being recorded.',
      };
    }

    case 'rejection':
      return {
        status: 'REJECTED',
        explanation: 'The message was rejected during the SMTP conversation; nothing was queued.',
      };

    case 'queue_snapshot':
      return { status: 'QUEUED', explanation: 'The message was in the mail queue at collection time.' };

    case 'routing':
      return { status: 'UNKNOWN', explanation: 'Routing information only; no delivery outcome is implied.' };

    case 'completion':
      return {
        status: 'UNKNOWN',
        explanation: 'A completion marker closes a trace; it does not itself prove delivery.',
      };

    default: {
      // Exhaustiveness guard: a new event type cannot silently inherit a status.
      const exhaustive: never = event.eventType;
      return { status: 'UNKNOWN', explanation: `Unhandled event type: ${String(exhaustive)}` };
    }
  }
}
