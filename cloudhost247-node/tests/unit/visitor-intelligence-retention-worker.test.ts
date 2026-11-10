import { describe, expect, it, vi } from 'vitest';
import type { Queryable } from '../../src/db/types';
import { pruneVisitorIntelligence } from '../../src/visitor-intelligence/service';
import {
  VISITOR_INTELLIGENCE_RETENTION_INTERVAL_MS,
  VISITOR_INTELLIGENCE_RETENTION_RETRY_INTERVAL_MS,
  runVisitorIntelligenceRetentionCycle,
} from '../../src/visitor-intelligence/retention-worker';

type RetentionResult = Awaited<ReturnType<typeof pruneVisitorIntelligence>>;
const emptyResult: RetentionResult = {
  pageviews: 0,
  presence: 0,
  sessions: 0,
  batches: { pageviews: 0, presence: 0, sessions: 0 },
  hasMore: false,
};
const logger = { log: vi.fn(), error: vi.fn() };
const db = { query: vi.fn() } as unknown as Queryable;
const NOW = Date.parse('2026-11-09T12:00:00.000Z');

describe('Visitor Intelligence retention worker scheduling', () => {
  it('retries a bounded backlog after the short retry interval, then resumes the daily cadence', async () => {
    const schedule = { lastVisitorIntelligenceRetention: NOW - VISITOR_INTELLIGENCE_RETENTION_INTERVAL_MS };
    const prune = vi.fn<() => Promise<RetentionResult>>()
      .mockResolvedValueOnce({ ...emptyResult, pageviews: 12, hasMore: true })
      .mockResolvedValueOnce(emptyResult);

    const first = await runVisitorIntelligenceRetentionCycle(db, schedule, logger, NOW, prune);
    expect(first).toEqual({ ran: true, didWork: true });
    expect(schedule.lastVisitorIntelligenceRetention).toBe(
      NOW - VISITOR_INTELLIGENCE_RETENTION_INTERVAL_MS + VISITOR_INTELLIGENCE_RETENTION_RETRY_INTERVAL_MS
    );
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('more=true'));

    const tooSoon = await runVisitorIntelligenceRetentionCycle(
      db, schedule, logger, NOW + VISITOR_INTELLIGENCE_RETENTION_RETRY_INTERVAL_MS - 1, prune
    );
    expect(tooSoon).toEqual({ ran: false, didWork: false });
    expect(prune).toHaveBeenCalledTimes(1);

    const retry = await runVisitorIntelligenceRetentionCycle(
      db, schedule, logger, NOW + VISITOR_INTELLIGENCE_RETENTION_RETRY_INTERVAL_MS, prune
    );
    expect(retry).toEqual({ ran: true, didWork: false });
    expect(prune).toHaveBeenCalledTimes(2);
    expect(schedule.lastVisitorIntelligenceRetention).toBe(NOW + VISITOR_INTELLIGENCE_RETENTION_RETRY_INTERVAL_MS);
  });

  it('schedules a retry after database failure instead of marking retention complete for the day', async () => {
    const schedule = { lastVisitorIntelligenceRetention: NOW - VISITOR_INTELLIGENCE_RETENTION_INTERVAL_MS };
    const prune = vi.fn<() => Promise<RetentionResult>>()
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce(emptyResult);

    const failed = await runVisitorIntelligenceRetentionCycle(db, schedule, logger, NOW, prune);
    expect(failed).toEqual({ ran: true, didWork: false });
    expect(schedule.lastVisitorIntelligenceRetention).toBe(
      NOW - VISITOR_INTELLIGENCE_RETENTION_INTERVAL_MS + VISITOR_INTELLIGENCE_RETENTION_RETRY_INTERVAL_MS
    );
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('retry scheduled: database unavailable'));

    const retried = await runVisitorIntelligenceRetentionCycle(
      db, schedule, logger, NOW + VISITOR_INTELLIGENCE_RETENTION_RETRY_INTERVAL_MS, prune
    );
    expect(retried).toEqual({ ran: true, didWork: false });
    expect(prune).toHaveBeenCalledTimes(2);
    expect(schedule.lastVisitorIntelligenceRetention).toBe(NOW + VISITOR_INTELLIGENCE_RETENTION_RETRY_INTERVAL_MS);
  });
});
