/**
 * The collector: reads a slice of evidence from one mail server, turns it into trace events, and
 * records exactly what happened.
 *
 * Every run is a claim that can be checked afterwards: `email_trace_collection_runs` stores how many
 * lines were seen, how many became events, how many were rejected, the queue snapshot that was taken
 * and the checkpoint reached. A run that fails leaves the checkpoint untouched, so the next attempt
 * re-reads the same window rather than silently skipping it.
 *
 * Order is deliberate:
 *   checkpoint → read → parse → normalise → attribute → insert → advance checkpoint → close run.
 * The checkpoint only moves after the rows are committed. That can duplicate a little work (the
 * dedupe constraint makes it harmless) but can never lose mail.
 */
import type { Queryable } from '../db/types';
import {
  completeEmailTraceCollectionRun,
  ensureEmailTraceSource,
  findEmailTraceSourceByServer,
  insertEmailTraceEvents,
  markEmailTraceSourceFailure,
  markEmailTraceSourceSuccess,
  startEmailTraceCollectionRun,
  type EmailTraceEventInsert,
  type EmailTraceSourceRow,
} from '../db/email-trace';
import { findServerById } from '../db/servers';
import { assessCapability, type EmailTraceCapability } from './capability';
import { classifyAgentError, factsFromResponse, type EximTraceAdapter, type MailServerRef } from './adapters/exim-agent';
import { parseMainlog } from './exim/mainlog-parser';
import { normaliseEvent } from './exim/normalizer';
import { parseEximQueue } from './exim/queue-parser';
import { sanitiseFreeText } from './exim/normalizer';
import type { QueueSnapshot } from './types';

/** 2 MiB per run: enough for a busy shared host's five-minute window, small enough to stay cheap. */
export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

export type CollectionTrigger = 'schedule' | 'manual' | 'admin';
export type CollectionStatus = 'ok' | 'partial' | 'failed' | 'skipped';

export interface CollectServerOptions {
  serverId: string;
  trigger: CollectionTrigger;
  /** Admin user id when a human asked for this run; null for the scheduler. */
  actorId?: string | null;
  maxBytes?: number;
  includeQueue?: boolean;
}

export interface CollectionResult {
  serverId: string;
  runId: string | null;
  status: CollectionStatus;
  /** Machine-readable reason for `skipped`/`failed`; null on success. */
  reason: string | null;
  capability: EmailTraceCapability | null;
  seen: number;
  collected: number;
  duplicates: number;
  rejected: number;
  unattributed: number;
  ambiguous: number;
  queue: QueueSnapshot | null;
  checkpointAfter: Record<string, unknown>;
}

interface Checkpoint {
  offset?: number;
  inode?: string | null;
  mainlogPath?: string | null;
}

function readCheckpoint(source: EmailTraceSourceRow | null): Checkpoint {
  const raw = source?.checkpoint;
  if (!raw || typeof raw !== 'object') return {};
  const value = raw as Record<string, unknown>;
  const offset = typeof value.offset === 'number' && Number.isFinite(value.offset) && value.offset >= 0 ? value.offset : 0;
  return {
    offset,
    inode: typeof value.inode === 'string' ? value.inode : null,
    mainlogPath: typeof value.mainlogPath === 'string' ? value.mainlogPath : null,
  };
}

/**
 * Domain → owning customer. Built from the staff-maintained `customer_domains` records, which is the
 * only ownership information this platform actually has. A domain claimed by two different customers
 * attributes to *neither* (counted as ambiguous) rather than guessing.
 */
interface DomainOwnership {
  owners: Map<string, string | null>;
}

async function loadDomainOwnership(db: Queryable): Promise<DomainOwnership> {
  const { rows } = await db.query<{ domain_name: string; user_id: string }>(
    `SELECT lower(domain_name) AS domain_name, user_id FROM customer_domains WHERE status = 'active'`
  );
  const owners = new Map<string, string | null>();
  for (const row of rows) {
    if (owners.has(row.domain_name)) owners.set(row.domain_name, null);
    else owners.set(row.domain_name, row.user_id);
  }
  return { owners };
}

function attribute(ownership: DomainOwnership, senderDomain: string, recipientDomain: string): { customerId: string | null; ambiguous: boolean } {
  for (const domain of [recipientDomain, senderDomain]) {
    if (!domain) continue;
    if (!ownership.owners.has(domain)) continue;
    const owner = ownership.owners.get(domain) ?? null;
    return { customerId: owner, ambiguous: owner === null };
  }
  return { customerId: null, ambiguous: false };
}

function emptyResult(serverId: string, status: CollectionStatus, reason: string | null): CollectionResult {
  return {
    serverId,
    runId: null,
    status,
    reason,
    capability: null,
    seen: 0,
    collected: 0,
    duplicates: 0,
    rejected: 0,
    unattributed: 0,
    ambiguous: 0,
    queue: null,
    checkpointAfter: {},
  };
}

/**
 * Collect one server.
 *
 * Never throws for expected conditions (no source, collection disabled, agent unreachable, agent too
 * old): each becomes a recorded run status plus a source failure, because the operator needs to see
 * it in the UI rather than in a stack trace.
 */
export async function collectServerTrace(
  db: Queryable,
  adapter: EximTraceAdapter,
  options: CollectServerOptions
): Promise<CollectionResult> {
  const server = await findServerById(db, options.serverId);
  if (!server) return emptyResult(options.serverId, 'skipped', 'server_not_found');

  let source = await findEmailTraceSourceByServer(db, options.serverId);
  if (!source) {
    // A row is created only for a real server, and stays switched off until an admin enables it.
    source = await ensureEmailTraceSource(db, { serverId: options.serverId, collectionMethod: 'agent' });
  }
  if (!source.collection_enabled) {
    return { ...emptyResult(options.serverId, 'skipped', 'collection_disabled'), capability: null };
  }
  if (source.collection_method !== 'agent') {
    return emptyResult(options.serverId, 'skipped', `collection_method_unsupported:${source.collection_method}`);
  }

  const checkpoint = readCheckpoint(source);
  const run = await startEmailTraceCollectionRun(db, { sourceId: source.id, serverId: options.serverId });

  const serverRef: MailServerRef & { metadata?: Record<string, unknown> } = {
    id: server.id,
    agentId: server.agent_id ?? null,
    agentUrl: typeof server.metadata?.agent_url === 'string' ? server.metadata.agent_url : null,
  };

  let response;
  try {
    response = await adapter.read(serverRef, {
      mainlogPath: checkpoint.mainlogPath ?? null,
      offset: checkpoint.offset ?? 0,
      maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
      includeQueue: options.includeQueue ?? true,
    });
  } catch (err) {
    const code = classifyAgentError(err);
    const message = sanitiseFreeText((err as Error).message, 500) ?? 'The mail server agent could not be reached.';
    await completeEmailTraceCollectionRun(db, run.id, {
      status: 'failed',
      errorClass: code,
      errorMessage: message,
    });
    await markEmailTraceSourceFailure(db, source.id, code, message);
    return { ...emptyResult(options.serverId, 'failed', code), runId: run.id };
  }

  const capability = assessCapability(factsFromResponse(response));

  if (!response.supportsMailTrace) {
    const message = 'The installed server agent does not support the read-only mail trace operation.';
    await completeEmailTraceCollectionRun(db, run.id, { status: 'skipped', errorClass: 'agent_too_old', errorMessage: message });
    await markEmailTraceSourceFailure(db, source.id, 'agent_too_old', message);
    return { ...emptyResult(options.serverId, 'skipped', 'agent_too_old'), runId: run.id, capability };
  }

  // --- Log → events -----------------------------------------------------------------------------
  const logLines = response.mainlog?.lines ?? [];
  const parsed = parseMainlog(logLines.join('\n'));

  // A delivery line does not repeat the envelope sender; Exim logs it once, on the submission line.
  // Within one read we can carry it forward per message id. Across reads we cannot, and those lines
  // are rejected rather than attributed to a guessed sender.
  const sendersByMessage = new Map<string, string>();
  for (const event of parsed.events) {
    if (event.sender) sendersByMessage.set(event.messageId, event.sender);
  }

  const ownership = await loadDomainOwnership(db);
  const events: EmailTraceEventInsert[] = [];
  let rejected = parsed.rejected.length;
  let unattributed = 0;
  let ambiguous = 0;

  for (const raw of parsed.events) {
    const normalised = normaliseEvent(raw, options.serverId, {
      senderFallback: sendersByMessage.get(raw.messageId) ?? null,
    });
    if (!normalised.ok) {
      rejected += 1;
      continue;
    }
    const event = normalised.event;
    const owner = attribute(ownership, event.senderDomain, event.recipientDomain);
    if (owner.ambiguous) ambiguous += 1;
    else if (!owner.customerId) unattributed += 1;

    events.push({ ...event, customerId: owner.customerId, hostingAccountId: null });
  }

  const inserted = await insertEmailTraceEvents(db, options.serverId, events);

  // --- Queue ------------------------------------------------------------------------------------
  let queue: QueueSnapshot | null = null;
  if (response.queue?.output) {
    queue = parseEximQueue(response.queue.output);
  }

  // --- Checkpoint + run bookkeeping ---------------------------------------------------------------
  // A rotated log (or a file that shrank below our offset) resets to the start: the agent reports
  // the new identity, so we never keep reading a stale position against new content.
  const rotated =
    response.mainlog !== null &&
    (response.mainlog.inode !== null && checkpoint.inode !== null
      ? response.mainlog.inode !== checkpoint.inode
      : response.mainlog.fileSize < (checkpoint.offset ?? 0));

  const checkpointAfter: Record<string, unknown> = {
    offset: rotated ? 0 : (response.mainlog?.nextOffset ?? checkpoint.offset ?? 0),
    inode: response.mainlog?.inode ?? checkpoint.inode ?? null,
    mainlogPath: response.mainlog?.path ?? checkpoint.mainlogPath ?? null,
    collectedAt: new Date().toISOString(),
  };

  // Run status describes the *collection*, not the mail: a window full of connection-level spam
  // rejections is not a failed collection, while a window we could not read, or a window where
  // nothing at all could be turned into a row, is. Rejected lines are still counted and shown.
  const nothingStored = parsed.events.length > 0 && inserted.inserted === 0 && inserted.duplicates === 0;
  const status: CollectionStatus = capability.canCollect
    ? response.mainlog?.truncated || nothingStored
      ? 'partial'
      : 'ok'
    : 'partial';
  const reason = !capability.canCollect ? 'mainlog_unavailable' : nothingStored ? 'nothing_stored' : null;

  await completeEmailTraceCollectionRun(db, run.id, {
    status: status === 'ok' ? 'ok' : 'partial',
    recordsSeen: parsed.events.length + parsed.rejected.length,
    recordsCollected: inserted.inserted,
    recordsRejected: rejected,
    queueCount: queue?.count ?? null,
    queueOldestSeconds: queue?.oldestSeconds ?? null,
    queueDeferred: queue?.deferred ?? null,
    checkpointAfter,
  });

  if (capability.canCollect) {
    await markEmailTraceSourceSuccess(db, source.id, checkpointAfter, {
      mainlog: capability.mainlog,
      queue: capability.queue,
      summary: capability.summary,
    });
  } else {
    await markEmailTraceSourceFailure(db, source.id, 'mainlog_unavailable', capability.summary);
  }

  return {
    serverId: options.serverId,
    runId: run.id,
    status,
    reason,
    capability,
    seen: parsed.events.length + parsed.rejected.length,
    collected: inserted.inserted,
    duplicates: inserted.duplicates,
    rejected,
    unattributed,
    ambiguous,
    queue,
    checkpointAfter,
  };
}

/**
 * Collect every enabled source. Used by the worker sweep; one server's failure never stops the
 * others. Returns per-server results so the caller can log a single summary line.
 */
export async function collectEnabledServers(
  db: Queryable,
  adapter: EximTraceAdapter,
  options: { maxServers?: number } = {}
): Promise<CollectionResult[]> {
  const { rows } = await db.query<{ server_id: string }>(
    `SELECT server_id FROM email_trace_sources
      WHERE collection_enabled = true AND collection_method = 'agent'
      ORDER BY last_success_at ASC NULLS FIRST
      LIMIT $1`,
    [options.maxServers ?? 25]
  );

  const results: CollectionResult[] = [];
  for (const row of rows) {
    results.push(await collectServerTrace(db, adapter, { serverId: row.server_id, trigger: 'schedule' }));
  }
  return results;
}
