import type { Queryable } from '../db/types';
import { pruneVisitorIntelligence } from './service';

export const VISITOR_INTELLIGENCE_RETENTION_INTERVAL_MS = 24 * 60 * 60_000;
export const VISITOR_INTELLIGENCE_RETENTION_RETRY_INTERVAL_MS = 15 * 60_000;

export interface VisitorIntelligenceRetentionSchedule {
  lastVisitorIntelligenceRetention: number;
}

export interface VisitorIntelligenceRetentionLogger {
  log(message: string): void;
  error(message: string): void;
}

type Prune = (db: Queryable) => ReturnType<typeof pruneVisitorIntelligence>;

/** Run the bounded retention task and arrange a prompt retry for backlog or database failure. */
export async function runVisitorIntelligenceRetentionCycle(
  db: Queryable,
  schedule: VisitorIntelligenceRetentionSchedule,
  logger: VisitorIntelligenceRetentionLogger,
  now = Date.now(),
  prune: Prune = pruneVisitorIntelligence
): Promise<{ ran: boolean; didWork: boolean }> {
  if (now - schedule.lastVisitorIntelligenceRetention < VISITOR_INTELLIGENCE_RETENTION_INTERVAL_MS) {
    return { ran: false, didWork: false };
  }

  try {
    const result = await prune(db);
    if (result.pageviews || result.presence || result.sessions || result.hasMore) {
      logger.log(`visitor intelligence retention: ${result.pageviews} pageviews, ${result.presence} stale tabs, ${result.sessions} sessions pruned; batches=${JSON.stringify(result.batches)}, more=${result.hasMore}`);
    }
    schedule.lastVisitorIntelligenceRetention = result.hasMore
      ? now - VISITOR_INTELLIGENCE_RETENTION_INTERVAL_MS + VISITOR_INTELLIGENCE_RETENTION_RETRY_INTERVAL_MS
      : now;
    return {
      ran: true,
      didWork: Boolean(result.pageviews || result.presence || result.sessions),
    };
  } catch (error) {
    schedule.lastVisitorIntelligenceRetention = now - VISITOR_INTELLIGENCE_RETENTION_INTERVAL_MS + VISITOR_INTELLIGENCE_RETENTION_RETRY_INTERVAL_MS;
    logger.error(`visitor intelligence retention unavailable; retry scheduled: ${error instanceof Error ? error.message : String(error)}`);
    return { ran: true, didWork: false };
  }
}
