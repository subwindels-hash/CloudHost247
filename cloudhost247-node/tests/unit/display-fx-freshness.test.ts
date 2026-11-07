import { describe, expect, it } from 'vitest';
import { buildDisplayCurrencyStatus, type FxSnapshot } from '../../src/services/fx-service';

const now = new Date('2026-11-07T12:00:00Z');
const snapshot: FxSnapshot = {
  runId: 1, observedAt: new Date('2026-11-07T11:00:00Z'), fetchedAt: now,
  rates: [
    { code: 'NGN', rate: 1500, observedAt: new Date('2026-11-07T11:00:00Z') },
    { code: 'EUR', rate: 0.9, observedAt: new Date('2026-11-07T10:00:00Z') },
    { code: 'GBP', rate: 0.8, observedAt: new Date('2026-11-04T10:00:00Z') },
    { code: 'JPY', rate: 150, observedAt: new Date('2026-11-08T10:00:00Z') },
  ],
};
describe('display FX freshness', () => {
  it('filters stale and future individual rates and labels the oldest included observation', () => {
    const result = buildDisplayCurrencyStatus(snapshot, now, 48 * 3600_000);
    expect(result.currencies.map(r => r.code)).toEqual(['EUR', 'NGN']);
    expect(result.asOf).toBe('2026-11-07T10:00:00.000Z');
  });
  it('withholds all rates when none is current', () => {
    expect(buildDisplayCurrencyStatus(snapshot, now, 1000)).toMatchObject({ available: false, reason: 'stale', currencies: [] });
  });
});
