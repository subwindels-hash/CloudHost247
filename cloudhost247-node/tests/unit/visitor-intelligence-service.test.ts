import { describe, expect, it } from 'vitest';
import type { Queryable } from '../../src/db/types';
import {
  pruneVisitorIntelligence,
  recordVisitorPageview,
  updateVisitorSettings,
  type VisitorIdentityInput,
  type VisitorIngestContext,
} from '../../src/visitor-intelligence/service';

function queryable(handler: (sql: string, params: unknown[]) => Promise<unknown[]>): Queryable {
  return {
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      return { rows: (await handler(sql, params)) as T[] };
    },
  };
}

describe('Visitor Intelligence server session boundary', () => {
  it('rejects the existing session at exactly 30 minutes instead of refreshing it', async () => {
    const now = new Date('2026-11-09T12:00:00.000Z');
    const lastSeenAt = new Date(now.getTime() - 30 * 60 * 1000);
    const statements: string[] = [];
    const consent = {
      id: 'consent-1',
      token_hash: 'hash',
      preferences: { essential: true, analytics: true, marketing: false },
      decided: true,
      jurisdiction: null,
      policy_version: 1,
      expires_at: '2099-01-01T00:00:00.000Z',
      updated_at: '2026-11-09T12:00:00.000Z',
      ga4_consent_revision: 0,
    };
    const tx = queryable(async (sql) => {
      statements.push(sql);
      if (sql.includes('SELECT enabled FROM visitor_intelligence_settings')) return [{ enabled: true }];
      if (sql === 'SELECT * FROM marketing_consent_sessions WHERE id=$1 FOR SHARE') return [consent];
      if (sql.startsWith('INSERT INTO visitor_sessions')) return [];
      if (sql.includes('SELECT last_seen_at, now() AS checked_at')) return [{ last_seen_at: lastSeenAt, checked_at: now }];
      throw new Error(`Unexpected SQL in session-boundary test: ${sql}`);
    });
    const db = {
      query: tx.query.bind(tx),
      transaction: async <T>(callback: (transaction: Queryable) => Promise<T>) => callback(tx),
    } as unknown as Queryable;
    const input: VisitorIdentityInput = {
      visitorId: 'visitor-1', sessionId: 'session-1', tabId: 'tab-1', pagePath: '/hosting', referrerHost: null,
    };
    const context: VisitorIngestContext = {
      consentSessionId: 'consent-1',
      geo: { countryName: null, countryCode: null, regionName: null, cityName: null, latitude: null, longitude: null, timezone: null },
      client: { deviceCategory: 'desktop', browserFamily: 'Other', osFamily: 'Other' },
    };

    await expect(recordVisitorPageview(db, input, context)).resolves.toBe('session_expired');
    const upsert = statements.find((sql) => sql.startsWith('INSERT INTO visitor_sessions'));
    expect(upsert).toMatch(/last_seen_at > now\(\) - \(\$16::int \* interval '1 second'\)/);
  });
});

describe('Visitor Intelligence settings cleanup', () => {
  it('removes live-presence rows after a successful disable update', async () => {
    const statements: string[] = [];
    let livePresenceRows = ['tab-1'];
    const db = queryable(async (sql, params) => {
      statements.push(sql);
      if (sql.startsWith('UPDATE visitor_intelligence_settings')) {
        const [enabled, retentionDays, idleAfterSeconds, onlineTimeoutSeconds] = params;
        return [{
          enabled,
          retention_days: retentionDays,
          idle_after_seconds: idleAfterSeconds,
          online_timeout_seconds: onlineTimeoutSeconds,
          updated_at: new Date('2026-11-09T12:00:00.000Z'),
        }];
      }
      if (sql === 'DELETE FROM visitor_presence') {
        livePresenceRows = [];
        return [];
      }
      throw new Error(`Unexpected SQL in settings test: ${sql}`);
    });

    const updated = await updateVisitorSettings(db, 'admin-1', {
      enabled: false,
      retentionDays: 90,
      idleAfterSeconds: 120,
      onlineTimeoutSeconds: 120,
    });

    expect(updated.enabled).toBe(false);
    expect(livePresenceRows).toHaveLength(0);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toMatch(/^UPDATE visitor_intelligence_settings/);
    expect(statements[1]).toBe('DELETE FROM visitor_presence');
  });
});

describe('Visitor Intelligence retention concurrency safety', () => {
  it('rechecks eligibility when a presence row is refreshed concurrently and keeps draining stale rows', async () => {
    const presenceDeleteStatements: string[] = [];
    let presenceDeleteCount = 0;
    let anotherStalePresenceRemains = false;
    const db = queryable(async (sql) => {
      if (sql.includes('FROM visitor_intelligence_settings')) {
        return [{
          enabled: true,
          retention_days: 90,
          idle_after_seconds: 120,
          online_timeout_seconds: 120,
          updated_at: new Date('2026-11-09T12:00:00.000Z'),
        }];
      }
      if (sql.includes('DELETE FROM visitor_pageviews')) return [];
      if (sql.includes('SELECT EXISTS (SELECT 1 FROM visitor_pageviews')) return [{ has_more: false }];
      if (sql.includes('DELETE FROM visitor_presence p USING stale s')) {
        presenceDeleteStatements.push(sql);
        presenceDeleteCount += 1;
        if (presenceDeleteCount === 1) {
          // The first stale candidate got a live heartbeat after it was selected. Its outer DELETE
          // predicate must reject that row, while a separate stale row remains eligible.
          anotherStalePresenceRemains = true;
          return [];
        }
        // The next batch removes the still-expired row; the concurrently refreshed row is kept.
        anotherStalePresenceRemains = false;
        return [{ tab_id: 'still-stale-tab' }];
      }
      if (sql.includes('SELECT EXISTS (SELECT 1 FROM visitor_presence')) {
        return [{ has_more: anotherStalePresenceRemains }];
      }
      if (sql.includes('DELETE FROM visitor_sessions')) return [];
      if (sql.includes('SELECT EXISTS (SELECT 1 FROM visitor_sessions')) return [{ has_more: false }];
      throw new Error(`Unexpected SQL in retention test: ${sql}`);
    });

    const result = await pruneVisitorIntelligence(db, 1, 2);

    expect(presenceDeleteCount).toBe(2);
    expect(presenceDeleteStatements).toHaveLength(2);
    expect(presenceDeleteStatements.every((sql) => /p\.heartbeat_at < now\(\) - interval '1 day'/.test(sql))).toBe(true);
    expect(result).toMatchObject({ presence: 1, batches: { presence: 2 }, hasMore: false });
  });
});
