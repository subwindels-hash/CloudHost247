import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';
import { chunkDocument } from './chunking';
import { releaseWorkerCycleLease, tryAcquireWorkerCycleLease } from '../worker/worker-lease';
import {
  discoverWebsiteDocuments,
  fingerprintOf,
  type DiscoveryResult,
  type DiscoveryOptions,
} from './website-discovery';
import {
  deleteSourcesNotIn,
  findSourceByKey,
  listWebsiteSources,
  markSourceExcluded,
  markSourceFailed,
  markSourceIndexed,
  markSourceSkipped,
  replaceChunks,
  upsertSource,
} from './website-knowledge-repo';
import { loadCatalogDocuments } from './live-facts';
import type { WebsiteSourceKind } from './types';

/**
 * Automatic knowledge synchronisation.
 *
 * Three entry points, one implementation:
 *
 *   • `syncWebsiteKnowledge()` — full reconciliation. Discovers everything, upserts, reindexes only
 *     what changed, and deletes what the website no longer publishes. Idempotent, so the worker can
 *     run it on a schedule and on startup without special-casing.
 *   • `syncSourceKeys()` — event-driven. Called after a content write (product published, price
 *     changed, page updated) with the keys that changed, so a single admin action costs one
 *     document, not four hundred.
 *   • `retryFailedSources()` — bounded retry of sources whose last attempt failed.
 *
 * Failure semantics, deliberately conservative: a failure on one document marks that document
 * `failed` with a plain-language note and a retry counter, and the run continues. The run itself is
 * then `partial`. Nothing rolls back the documents that did succeed, because a knowledge base that
 * refuses to learn anything because one page was malformed is worse than one with a visible gap.
 */

export type SyncTrigger = 'manual' | 'worker' | 'event' | 'startup' | 'api';

export interface SyncResult {
  runId: string;
  discovered: number;
  indexed: number;
  unchanged: number;
  skipped: number;
  excluded: number;
  removed: number;
  failed: number;
  durationMs: number;
  status: 'succeeded' | 'partial' | 'failed' | 'busy';
  /**
   * True when another sync already held the lock, so this call did no work and reported nothing
   * about the corpus. A `busy` result must never be read as "0 documents changed".
   */
  busy?: boolean;
  notes: string[];
}

const MAX_CONSECUTIVE_FAILURES = 5;

async function startRun(db: Queryable, trigger: SyncTrigger, triggeredBy: string | null): Promise<string> {
  const id = randomUUID();
  try {
    await db.query(
      `INSERT INTO ai_knowledge_sync_runs (id, trigger, status, triggered_by) VALUES ($1,$2,'running',$3)`,
      [id, trigger, triggeredBy]
    );
  } catch {
    // The ledger is diagnostics, not the work. If it cannot be written the sync still runs; the
    // result object carries the same counters to the caller.
  }
  return id;
}

async function finishRun(db: Queryable, result: SyncResult, notes: string[]): Promise<void> {
  try {
    await db.query(
      `UPDATE ai_knowledge_sync_runs
          SET status = $2, discovered = $3, indexed = $4, unchanged = $5, skipped = $6,
              excluded = $7, removed = $8, failed = $9, duration_ms = $10,
              notes = $11::jsonb, finished_at = now()
        WHERE id = $1`,
      [
        result.runId,
        result.status,
        result.discovered,
        result.indexed,
        result.unchanged,
        result.skipped,
        result.excluded,
        result.removed,
        result.failed,
        result.durationMs,
        JSON.stringify(notes.slice(0, 50)),
      ]
    );
  } catch {
    /* ledger unavailable — the caller still receives the counters */
  }
}

/** Loads administrator exclusion patterns. Failure to read them must not disable syncing. */
export async function loadExclusionPatterns(db: Queryable): Promise<string[]> {
  try {
    const { rows } = await db.query<{ pattern: string }>('SELECT pattern FROM ai_knowledge_exclusions ORDER BY created_at ASC');
    return rows.map((row) => row.pattern).filter(Boolean);
  } catch {
    return [];
  }
}

interface SyncOptions {
  trigger?: SyncTrigger;
  triggeredBy?: string | null;
  /** Restrict the run to these source keys (event-driven path). */
  sourceKeys?: readonly string[];
  /** Inject a pre-built discovery result (tests, and the "dry run" preview in the console). */
  discovery?: DiscoveryResult;
  /** Skip the removal pass (used by a targeted event sync). */
  pruneMissing?: boolean;
  discoveryOptions?: DiscoveryOptions;
}

function addNote(notes: string[], note: string): void {
  if (notes.length < 50) notes.push(note.slice(0, 300));
}

/**
 * Synchronises one document. Returns what happened, so the caller can count it.
 */
async function syncDocument(
  db: Queryable,
  page: NonNullable<DiscoveryResult['pages'][number]>,
  notes: string[]
): Promise<'indexed' | 'unchanged' | 'skipped' | 'failed'> {
  const fingerprint = fingerprintOf(page);

  if (!page.publishable) {
    const existing = await findSourceByKey(db, page.sourceKey);
    const note = page.exclusionReason ?? 'Not retrievable';
    try {
      if (existing) {
        if (existing.sync_status === 'skipped' && existing.sync_note === note) return 'unchanged';
        await markSourceSkipped(db, existing.id, note);
      } else {
        const created = await upsertSource(db, {
          sourceKey: page.sourceKey,
          title: page.title,
          kind: page.kind,
          surface: page.surface,
          url: page.url,
          aliases: page.aliases,
          section: page.section,
          category: page.category,
          fingerprint,
          wordCount: 0,
        });
        await markSourceSkipped(db, created.id, note);
      }
      return 'skipped';
    } catch (error) {
      addNote(notes, `${page.sourceKey}: ${(error as Error).message}`);
      return 'failed';
    }
  }

  try {
    const existing = await findSourceByKey(db, page.sourceKey);
    if (existing && existing.sync_status === 'indexed' && existing.fingerprint === fingerprint) {
      return 'unchanged';
    }
    if (existing && existing.failure_count >= MAX_CONSECUTIVE_FAILURES && existing.fingerprint === fingerprint) {
      // A document that has failed five times with the same content will keep failing. Leave it
      // visible as failed rather than burning every sweep on it; a content change resets the count.
      return 'unchanged';
    }

    const content = page.content;
    // A page the discovery step could not read is a failure, not a success. Indexing an empty
    // document would record the source as "indexed" with zero retrievable knowledge and hide the
    // real problem: the admin console would show a healthy corpus while that page silently answered
    // nothing. Throwing routes it through the normal failure path (counter, note, last_error_at).
    const bodyText = (content?.body ?? '').trim();
    if (bodyText.length === 0) {
      throw new Error('No readable content was discovered for this page');
    }
    const chunks = chunkDocument(content!);
    const words = bodyText.split(/\s+/).filter(Boolean).length;

    const upserted = await upsertSource(db, {
      sourceKey: page.sourceKey,
      title: page.title,
      kind: page.kind,
      surface: page.surface,
      url: page.url,
      aliases: page.aliases,
      section: page.section,
      category: page.category,
      fingerprint,
      wordCount: words,
    });

    if (!upserted.changed && existing?.sync_status === 'indexed') return 'unchanged';

    await replaceChunks(db, upserted.id, chunks, {
      url: page.url,
      pageTitle: page.title,
      kind: page.kind,
      category: page.category,
      fingerprint,
    });
    await markSourceIndexed(db, upserted.id);
    return 'indexed';
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown indexing failure';
    addNote(notes, `${page.sourceKey}: ${message}`);
    try {
      const existing = await findSourceByKey(db, page.sourceKey);
      if (existing) await markSourceFailed(db, existing.id, message);
      else {
        // The failure has to survive the very failure that caused it. If the insert itself is what
        // went wrong, still leave a row so the admin console lists the page as failed rather than
        // showing a corpus that simply never mentions it.
        const created = await upsertSource(db, {
          sourceKey: page.sourceKey,
          title: page.title,
          kind: page.kind,
          surface: page.surface,
          url: page.url,
          aliases: page.aliases,
          section: page.section,
          category: page.category,
          fingerprint,
          wordCount: 0,
        }).catch(async () => {
          const { rows } = await db.query<{ id: string }>(
            `INSERT INTO ai_knowledge_sources
               (id, title, source_type, source_kind, source_key, surface, url, fingerprint, word_count, sync_status)
             VALUES (gen_random_uuid(), $1, 'doc', $2, $3, $4, $5, $6, 0, 'failed')
             ON CONFLICT (source_key) DO UPDATE SET updated_at = now()
             RETURNING id`,
            [page.title.slice(0, 255), page.kind, page.sourceKey, page.surface ?? 'spa', page.url, fingerprint]
          );
          return { id: rows[0]!.id, created: true, changed: true };
        });
        await markSourceFailed(db, created.id, message);
      }
    } catch (recordError) {
      // The note above already records the original failure; this adds why the ledger row could not
      // be updated, so a broken failure path is visible instead of silently looking healthy.
      addNote(notes, `${page.sourceKey}: could not record failure (${(recordError as Error).message})`);
    }
    return 'failed';
  }
}

/**
 * Full reconciliation. This is the operation the worker runs and the operation the administrator's
 * "Reindex everything" button runs — the difference is only who is recorded as the trigger.
 */
/**
 * Lease name for the website-knowledge sync. Reuses the platform's existing database-backed
 * worker lease (0058) rather than introducing a second locking mechanism: it already provides
 * expiry, crash recovery and holder-checked release.
 */
export const KNOWLEDGE_SYNC_LEASE_NAME = 'ai-knowledge-sync';
const KNOWLEDGE_SYNC_LEASE_MS = 120_000;

export async function syncWebsiteKnowledge(db: Queryable, options: SyncOptions = {}): Promise<SyncResult> {
  const startedAt = Date.now();
  const trigger = options.trigger ?? 'manual';
  const notes: string[] = [];

  // Serialise the whole reconciliation. Two overlapping runs used to interleave their
  // read-then-write passes and report a misleading `failed=2` for what were really upsert
  // conflicts — the corpus healed, but the ledger recorded failures that never happened.
  // A caller that cannot get the lease does no work and says so, instead of reporting zeros.
  const lease = { name: KNOWLEDGE_SYNC_LEASE_NAME, holder: randomUUID(), leaseMs: KNOWLEDGE_SYNC_LEASE_MS };
  if (!(await tryAcquireWorkerCycleLease(db, lease))) {
    return {
      runId: 'not-started',
      discovered: 0,
      indexed: 0,
      unchanged: 0,
      skipped: 0,
      excluded: 0,
      removed: 0,
      failed: 0,
      durationMs: Date.now() - startedAt,
      status: 'busy',
      busy: true,
      notes: ['Another website-knowledge sync is already running, so this run did nothing.'],
    };
  }

  try {
    return await runSync(db, options, trigger, notes, startedAt);
  } finally {
    await releaseWorkerCycleLease(db, lease).catch(() => undefined);
  }
}

async function runSync(
  db: Queryable,
  options: SyncOptions,
  trigger: SyncTrigger,
  notes: string[],
  startedAt: number
): Promise<SyncResult> {
  const runId = await startRun(db, trigger, options.triggeredBy ?? null);

  let discovery: DiscoveryResult;
  const target = options.sourceKeys;
  try {
    if (options.discovery) {
      discovery = options.discovery;
    } else {
      const [exclusionPatterns, catalogDocuments] = await Promise.all([
        loadExclusionPatterns(db),
        loadCatalogDocuments(db),
      ]);
      discovery = discoverWebsiteDocuments({
        exclusionPatterns,
        extraDocuments: catalogDocuments,
        ...(options.discoveryOptions ?? {}),
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Discovery failed';
    addNote(notes, `Discovery failed: ${message}`);
    const failed: SyncResult = {
      runId,
      discovered: 0,
      indexed: 0,
      unchanged: 0,
      skipped: 0,
      excluded: 0,
      removed: 0,
      failed: 1,
      durationMs: Date.now() - startedAt,
      status: 'failed',
      notes,
    };
    await finishRun(db, failed, notes);
    return failed;
  }

  const selected = target && target.length > 0
    ? discovery.pages.filter((page) => target.includes(page.sourceKey))
    : discovery.pages;

  let indexed = 0;
  let unchanged = 0;
  let skipped = 0;
  let failed = 0;

  for (const page of selected) {
    const outcome = await syncDocument(db, page, notes);
    if (outcome === 'indexed') indexed += 1;
    else if (outcome === 'unchanged') unchanged += 1;
    else if (outcome === 'skipped') skipped += 1;
    else failed += 1;
  }

  // Excluded documents are recorded, not deleted: an administrator needs to see that a page exists
  // and why the AI ignores it.
  let excluded = 0;
  for (const entry of discovery.excluded) {
    excluded += 1;
    try {
      const existing = await findSourceByKey(db, entry.sourceKey);
      if (!existing) continue;
      if (existing.sync_status !== 'excluded' || existing.excluded_reason !== entry.reason) {
        await markSourceExcluded(db, existing.id, entry.reason);
      }
    } catch (error) {
      addNote(notes, `${entry.sourceKey}: ${(error as Error).message}`);
    }
  }

  let removed = 0;
  if (options.pruneMissing !== false && (!target || target.length === 0)) {
    try {
      removed = await deleteSourcesNotIn(db, discovery.pages.map((page) => page.sourceKey));
    } catch (error) {
      addNote(notes, `Removing stale sources failed: ${(error as Error).message}`);
    }
  }

  const status: SyncResult['status'] = failed === 0 ? 'succeeded' : indexed + unchanged > 0 ? 'partial' : 'failed';
  const result: SyncResult = {
    runId,
    discovered: options.discovery ? selected.length : discovery.stats.discovered,
    indexed,
    unchanged,
    skipped,
    excluded,
    removed,
    failed,
    durationMs: Date.now() - startedAt,
    status,
    notes,
  };
  await finishRun(db, result, notes);
  return result;
}

/**
 * Event-driven synchronisation.
 *
 * Content writes call this *after* their own transaction has committed, with the keys they touched.
 * It is not awaited on the request path — a published product must not fail because the AI index was
 * momentarily busy — and errors are swallowed after being recorded on the run ledger.
 */
export async function syncSourceKeys(
  db: Queryable,
  sourceKeys: readonly string[],
  options: { trigger?: SyncTrigger; triggeredBy?: string | null; sourceKinds?: WebsiteSourceKind[] } = {}
): Promise<SyncResult | null> {
  const keys = [...new Set(sourceKeys.filter(Boolean))];
  if (keys.length === 0) return null;
  try {
    // Catalogue documents live in the database, not in the compiled projection, so they must be
    // loaded whenever the event could be about one. Keying off the requested keys (not only an
    // explicit `sourceKinds`) is what makes the catalogue-admin hook work: it passes
    // `catalog:product:<slug>` and nothing else, and without this the event silently indexed nothing.
    const needsCatalog = Boolean(options.sourceKinds?.some((kind) => kind === 'product' || kind === 'service' || kind === 'catalog_page'))
      || keys.some((key) => key.startsWith('catalog:'));
    const [exclusionPatterns, catalogDocuments] = await Promise.all([
      loadExclusionPatterns(db),
      needsCatalog ? loadCatalogDocuments(db) : Promise.resolve([]),
    ]);
    const discovery = discoverWebsiteDocuments({ exclusionPatterns, extraDocuments: catalogDocuments });
    return await syncWebsiteKnowledge(db, {
      trigger: options.trigger ?? 'event',
      triggeredBy: options.triggeredBy ?? null,
      sourceKeys: keys,
      discovery,
      pruneMissing: false,
    });
  } catch {
    return null;
  }
}

/** Fire-and-forget wrapper for request handlers. Never throws, never blocks the response. */
export function scheduleKnowledgeSync(
  db: Queryable,
  sourceKeys: readonly string[],
  options: { triggeredBy?: string | null } = {}
): void {
  void syncSourceKeys(db, sourceKeys, { triggeredBy: options.triggeredBy ?? null }).catch(() => undefined);
}

/**
 * Retries sources whose last attempt failed and whose content has not changed since. Bounded, so a
 * permanently broken page cannot hold up the sweep forever.
 */
export async function retryFailedSources(db: Queryable, limit = 25): Promise<{ attempted: number; recovered: number }> {
  let rows: Array<{ source_key: string | null }>;
  try {
    const result = await db.query<{ source_key: string | null }>(
      `SELECT source_key FROM ai_knowledge_sources
        WHERE source_key IS NOT NULL AND sync_status = 'failed' AND failure_count < $1
        ORDER BY last_error_at ASC NULLS FIRST
        LIMIT $2`,
      [MAX_CONSECUTIVE_FAILURES, limit]
    );
    rows = result.rows;
  } catch {
    return { attempted: 0, recovered: 0 };
  }
  const keys = rows.map((row) => row.source_key).filter((key): key is string => Boolean(key));
  if (keys.length === 0) return { attempted: 0, recovered: 0 };
  const result = await syncSourceKeys(db, keys, { trigger: 'worker' });
  return { attempted: keys.length, recovered: result?.indexed ?? 0 };
}

export interface KnowledgeDrift {
  changed: string[];
  missing: string[];
  unexpected: string[];
}

/**
 * Compares the projection with the database without writing anything. Used by the worker sweep to
 * decide whether a full sync is worth running, and by the admin console's "check for drift" action.
 */
export async function detectDrift(db: Queryable): Promise<KnowledgeDrift> {
  const [exclusionPatterns, catalogDocuments] = await Promise.all([
    loadExclusionPatterns(db),
    loadCatalogDocuments(db),
  ]);
  const discovery = discoverWebsiteDocuments({ exclusionPatterns, extraDocuments: catalogDocuments });
  const stored = await listWebsiteSources(db);
  const storedByKey = new Map(stored.map((row) => [row.source_key ?? '', row]));
  const changed: string[] = [];
  for (const page of discovery.pages) {
    const existing = storedByKey.get(page.sourceKey);
    if (!existing) {
      changed.push(page.sourceKey);
      continue;
    }
    if (page.publishable && existing.fingerprint !== fingerprintOf(page)) changed.push(page.sourceKey);
    if (!page.publishable && existing.sync_status === 'indexed') changed.push(page.sourceKey);
  }
  const expected = new Set(discovery.pages.map((page) => page.sourceKey));
  const missing = stored.map((row) => row.source_key ?? '').filter((key) => key && !expected.has(key));
  const unexpected = discovery.pages.filter((page) => !storedByKey.has(page.sourceKey)).map((page) => page.sourceKey);
  return { changed, missing, unexpected };
}

/** Validates one document end to end without persisting it. Used by the console's preview. */
export function previewDocument(document: DiscoveryResult['pages'][number]): {
  fingerprint: string;
  chunks: number;
  words: number;
  retrievable: boolean;
  reason: string | null;
} {
  const content = document.content;
  const chunks = content ? chunkDocument(content) : [];
  return {
    fingerprint: fingerprintOf(document),
    chunks: chunks.length,
    words: (content?.body ?? '').split(/\s+/).filter(Boolean).length,
    retrievable: document.publishable,
    reason: document.publishable ? null : document.exclusionReason ?? null,
  };
}
