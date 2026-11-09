/**
 * What can this mail server actually tell us?
 *
 * The capability report is the feature's honesty mechanism. It is computed from facts the collector
 * observed — a binary exists, a log file was readable, a queue command answered — and it is shown in
 * the UI unchanged, including the parts that say "we cannot see this". A mail host with no readable
 * Exim log must produce a source row that says so, rather than an empty timeline that looks like
 * "no email was sent".
 *
 * Nothing here asserts a delivery *outcome*. The strongest evidence a message log can give is that a
 * remote server answered with an SMTP acknowledgement, which is transport, not inbox placement.
 */
import type { EmailTraceCapabilityState } from './types';

export interface MailHostFacts {
  /** Did the server agent answer at all? */
  agentReachable: boolean;
  /** Does the agent expose the read-only `mail.trace` operation? */
  agentSupportsMailTrace: boolean;
  /** Was the Exim mainlog path found *and* readable by the agent's own (unprivileged) account? */
  mainlogReadable: boolean | null;
  /** Was a read-only queue listing command available? `exim -bp`, never anything that mutates. */
  queueListingAvailable: boolean | null;
  /** Free-text reasons reported by the agent (already redacted by it). */
  notes?: string[];
}

export interface EmailTraceCapability {
  mainlog: EmailTraceCapabilityState;
  queue: EmailTraceCapabilityState;
  /** Can we collect events from this server at all right now? */
  canCollect: boolean;
  /** Can we show a *current* queue rather than nothing? */
  canShowQueue: boolean;
  /** Always included, never optional: what this data can and cannot mean. */
  limitations: string[];
  /** One line for the UI, written to be read by a customer. */
  summary: string;
}

const TRANSPORT_CAVEAT =
  'Delivery status reflects the receiving mail server acknowledging the message over SMTP. It does not prove inbox placement, and this platform never reports whether a message was opened.';

/**
 * Derive the capability report from observed facts.
 *
 * Deliberately total: every combination returns a report, and anything that was not probed
 * (`null`) is reported as `unknown` rather than optimistically assumed to work.
 */
export function assessCapability(facts: MailHostFacts): EmailTraceCapability {
  const limitations: string[] = [TRANSPORT_CAVEAT];
  if (facts.notes?.length) {
    for (const note of facts.notes) limitations.push(note);
  }

  if (!facts.agentReachable) {
    return {
      mainlog: 'unknown',
      queue: 'unknown',
      canCollect: false,
      canShowQueue: false,
      limitations: [...limitations, 'The server agent did not respond, so no log or queue data could be read.'],
      summary: 'This server cannot be reached by the collector right now.',
    };
  }

  if (!facts.agentSupportsMailTrace) {
    return {
      mainlog: 'unsupported',
      queue: 'unsupported',
      canCollect: false,
      canShowQueue: false,
      limitations: [
        ...limitations,
        'The installed server agent predates the read-only mail trace operation; update the agent to enable collection.',
      ],
      summary: 'Mail trace collection is not available on this server because its agent is too old.',
    };
  }

  const mainlog: EmailTraceCapabilityState =
    facts.mainlogReadable === null ? 'unknown' : facts.mainlogReadable ? 'available' : 'unavailable';
  const queue: EmailTraceCapabilityState =
    facts.queueListingAvailable === null
      ? 'unknown'
      : facts.queueListingAvailable
        ? 'available'
        : 'unsupported';

  if (mainlog === 'unavailable') {
    limitations.push(
      'The Exim message log exists but was not readable by the agent. Granting log access is an administrator decision; the collector never escalates privileges on its own.'
    );
  }
  if (mainlog === 'unknown') {
    limitations.push('The Exim message log has not been probed yet, so no timeline can be promised for this server.');
  }
  if (queue !== 'available') {
    limitations.push('Queue monitoring is read-only and depends on a queue listing command being available; no message is ever removed or forced.');
  }

  const canCollect = mainlog === 'available';
  const canShowQueue = queue === 'available';

  let summary: string;
  if (canCollect && canShowQueue) {
    summary = 'Message log and read-only queue are both available on this server.';
  } else if (canCollect) {
    summary = 'Message log is available; queue monitoring is not available on this server.';
  } else if (mainlog === 'unavailable') {
    summary = 'The message log could not be read on this server, so no trace events are being collected.';
  } else {
    summary = 'Message log collection has not been confirmed on this server yet.';
  }

  return { mainlog, queue, canCollect, canShowQueue, limitations, summary };
}
