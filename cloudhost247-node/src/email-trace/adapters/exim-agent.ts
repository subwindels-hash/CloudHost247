/**
 * Exim adapter — the *only* way the collector talks to a mail server.
 *
 * The adapter is an interface with one implementation today (`agent`), which calls the server
 * agent's read-only `POST /v1/mail/trace` operation. Keeping it behind an interface has two
 * purposes: the collector can be tested without a mail server, and a future transport (for example
 * a WHM API that returns the same historical report) has to be *added deliberately* rather than
 * appearing as an extra branch inside collection logic.
 *
 * What the adapter may ask for:
 *   - read new bytes from the end of one configured Exim message log, from a checkpoint offset;
 *   - read the current queue listing read-only.
 * It cannot ask for a path, a command, a shell, a file deletion, a restart, a queue flush or a
 * forced delivery: the request shape has no field for any of those, and the agent validates the
 * path against its own configuration.
 */
import type { Queryable } from '../../db/types';
import { agentRequest, AgentUnavailableError } from '../../deployments/agent-client';
import type { MailHostFacts } from '../capability';

/** The subset of `servers` the adapter needs. Passed in, never looked up from request data. */
export interface MailServerRef {
  id: string;
  agentId: string | null;
  agentUrl: string | null;
}

export interface MailTraceRequest {
  /** Absolute path from the *source configuration*; the agent rejects anything outside its allowlist. */
  mainlogPath: string | null;
  /** Byte offset of the last completely processed line. */
  offset: number;
  /** Upper bound on bytes read in one call, so one collection cannot read a gigabyte of log. */
  maxBytes: number;
  /** Ask for the queue listing in the same round trip. */
  includeQueue: boolean;
}

export interface MailTraceResponse {
  agentVersion: string;
  /** False for an agent that predates the operation; reported, not treated as an error. */
  supportsMailTrace: boolean;
  capability: {
    mainlogReadable: boolean | null;
    mainlogPath: string | null;
    queueListingAvailable: boolean | null;
    notes: string[];
  };
  mainlog: {
    path: string;
    /** Offset the agent started reading from. */
    offset: number;
    /** Offset immediately after the last *complete* line returned. */
    nextOffset: number;
    fileSize: number;
    /** Opaque file identity, so a rotated log resets the checkpoint instead of misaligning it. */
    inode: string | null;
    lines: string[];
    truncated: boolean;
  } | null;
  queue: { output: string } | null;
}

export interface EximTraceAdapter {
  /** Reads the next slice of log (and optionally the queue) from one server. */
  read(server: MailServerRef, request: MailTraceRequest): Promise<MailTraceResponse>;
}

/** Facts derived from a response, for `assessCapability()`. */
export function factsFromResponse(response: MailTraceResponse): MailHostFacts {
  return {
    agentReachable: true,
    agentSupportsMailTrace: response.supportsMailTrace,
    mainlogReadable: response.capability.mainlogReadable,
    queueListingAvailable: response.capability.queueListingAvailable,
    notes: response.capability.notes,
  };
}

/**
 * The live implementation. `db` is only used to decrypt the server's agent secret for the signed
 * request; nothing else is read or written here.
 */
export function createAgentEximTraceAdapter(db: Queryable): EximTraceAdapter {
  return {
    read(server: MailServerRef, request: MailTraceRequest): Promise<MailTraceResponse> {
      return agentRequest<MailTraceResponse>(db, server, 'POST', '/v1/mail/trace', request);
    },
  };
}

/** Splits a rotation/reachability failure from a normal "agent said no" answer, for run status. */
export function classifyAgentError(err: unknown): 'agent_unavailable' | 'agent_rejected' {
  return err instanceof AgentUnavailableError ? 'agent_unavailable' : 'agent_rejected';
}
