import type { Queryable } from '../db/types';
import { retryFailedSources, syncWebsiteKnowledge, type SyncResult } from './knowledge-sync';

/**
 * Scheduled reconciliation of the website knowledge index.
 *
 * Reuses the existing worker loop and its cycle/lease discipline rather than introducing a second
 * scheduler. Two cadences run off one tick:
 *
 *   • a **full reconcile** every 15 minutes — discovery is a pure function over the compiled site
 *     projection, so this is cheap (no HTTP, no crawling) and it is what catches a page that was
 *     *removed*, a title that changed, or a document that failed to index last time;
 *   • **failed-source retries** on every tick, bounded, so a transient failure recovers without
 *     waiting for the next full pass.
 *
 * The interval is deliberately shorter than the content-publish path: a newly published service page
 * is picked up by the worker within one tick even if the publish-time event hook was missed (a
 * crashed request, a deploy that published from the CLI). The event hook makes it immediate; the
 * sweep makes it certain.
 */
export const WEBSITE_KNOWLEDGE_INTERVAL_MS = 15 * 60_000;

export async function sweepWebsiteKnowledge(db: Queryable): Promise<SyncResult & { retried: number; recovered: number }> {
  // Retries first: they are the cheapest way to turn a red status green, and a retry does not need a
  // full pass over the projection.
  const retry = await retryFailedSources(db, 25).catch(() => ({ attempted: 0, recovered: 0 }));
  const result = await syncWebsiteKnowledge(db, { trigger: 'worker' });
  return { ...result, retried: retry.attempted, recovered: retry.recovered };
}
