import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { PGlite } from '@electric-sql/pglite';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { registerCurrencyRoutes } from '../../src/routes/currency';
import {
  buildDisplayCurrencyStatus,
  FxFeedError,
  loadLatestDisplaySnapshot,
  parseFxFeed,
  syncDisplayRates,
} from '../../src/services/fx-service';

/**
 * Display-currency conversion against a real embedded Postgres engine (PGlite), with the real
 * migrations. The WHMCS feed is replaced by a local HTTP server that serves the same JSON contract
 * as modules/addons/cloudhost247_currency/display-feed.php.
 */
const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
  JWT_SECRET: 'g'.repeat(32),
  FX_MAX_AGE_HOURS: '48',
} as NodeJS.ProcessEnv);
const TOKEN = 'feed-token-0123456789';

function feedBody(runId: number | null, observedAt = '2026-10-12T06:00:00+00:00') {
  return {
    base: 'USD',
    runId,
    rates: runId === null ? [] : [
      { code: 'EUR', rate: 0.9231, observedAt },
      { code: 'GBP', rate: 0.7844, observedAt },
    ],
  };
}

describe('display currency feed (WHMCS addon -> Node)', () => {
  let db: PGlite;
  let server: http.Server;
  let feedUrl: string;
  let currentBody: unknown;
  let lastAuth: string | undefined;
  let feedStatus = 200;

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
    currentBody = feedBody(101);
    server = http.createServer((req, res) => {
      lastAuth = req.headers.authorization;
      res.writeHead(feedStatus, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(currentBody));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    feedUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/feed`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.close();
  });

  it('stores a new run with its timestamps and reports it as available', async () => {
    const result = await syncDisplayRates(db, { url: feedUrl, token: TOKEN, allowInsecureHttp: true });
    expect(result).toEqual({ status: 'stored', runId: 101, count: 2 });
    expect(lastAuth).toBe(`Bearer ${TOKEN}`);

    const status = buildDisplayCurrencyStatus(await loadLatestDisplaySnapshot(db), new Date('2026-10-12T07:00:00Z'), 48 * 3600_000);
    expect(status.available).toBe(true);
    expect(status.reason).toBeNull();
    expect(status.asOf).toBe('2026-10-12T06:00:00.000Z');
    expect(status.currencies.map((c) => c.code)).toEqual(['EUR', 'GBP']);
    expect(status.currencies[0]?.rate).toBeCloseTo(0.9231, 10);
  });

  it('is idempotent: a run that is already stored is reported as unchanged, not duplicated', async () => {
    await syncDisplayRates(db, { url: feedUrl, token: TOKEN, allowInsecureHttp: true });
    const again = await syncDisplayRates(db, { url: feedUrl, token: TOKEN, allowInsecureHttp: true });
    expect(again).toEqual({ status: 'unchanged', runId: 101 });
    const rows = await db.query<{ n: string }>('SELECT COUNT(*) AS n FROM display_fx_rates');
    expect(Number(rows.rows[0]?.n)).toBe(2);
  });

  it('does not store anything when the addon has no successful run yet', async () => {
    currentBody = feedBody(null);
    const result = await syncDisplayRates(db, { url: feedUrl, token: TOKEN, allowInsecureHttp: true });
    expect(result).toEqual({ status: 'empty' });
    expect(await loadLatestDisplaySnapshot(db)).toBeNull();
  });

  it('keeps the last good snapshot when a later feed fails, and reports stale data as unavailable', async () => {
    await syncDisplayRates(db, { url: feedUrl, token: TOKEN, allowInsecureHttp: true });
    feedStatus = 401;
    await expect(syncDisplayRates(db, { url: feedUrl, token: TOKEN, allowInsecureHttp: true })).rejects.toThrow(/HTTP 401/);
    feedStatus = 200;

    const snapshot = await loadLatestDisplaySnapshot(db);
    const status = buildDisplayCurrencyStatus(snapshot, new Date('2026-10-20T00:00:00Z'), 48 * 3600_000);
    expect(status.available).toBe(false);
    expect(status.reason).toBe('stale');
    expect(status.currencies).toEqual([]);
  });

  it('refuses a plain-http feed unless explicitly allowed (production must use https)', async () => {
    await expect(syncDisplayRates(db, { url: 'http://example.test/feed', token: TOKEN })).rejects.toThrow(/https/);
  });

  it('serves the public status route with a cache header and no monetary authority', async () => {
    await syncDisplayRates(db, { url: feedUrl, token: TOKEN, allowInsecureHttp: true });
    const app = Fastify();
    await registerCurrencyRoutes(app, env, db);
    const res = await app.inject({ method: 'GET', url: '/api/v1/currency/rates' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=300');
    const body = res.json() as { base: string; available: boolean };
    expect(body.base).toBe('USD');
    expect(body.available).toBe(true);
    await app.close();
  });

  it('reports not_synced on a fresh database', async () => {
    const app = Fastify();
    await registerCurrencyRoutes(app, env, db);
    const res = await app.inject({ method: 'GET', url: '/api/v1/currency/rates' });
    expect(res.json()).toMatchObject({ available: false, reason: 'not_synced', currencies: [] });
    await app.close();
  });
});

describe('parseFxFeed validation', () => {
  const good = { base: 'USD', runId: 5, rates: [{ code: 'EUR', rate: 0.9, observedAt: '2026-10-12T00:00:00+00:00' }] };

  it('accepts a well-formed feed', () => {
    expect(parseFxFeed(good).rates[0]?.code).toBe('EUR');
  });

  it.each([
    ['a non-USD base', { ...good, base: 'EUR' }],
    ['a lowercase code', { ...good, rates: [{ code: 'eur', rate: 0.9, observedAt: '2026-10-12T00:00:00+00:00' }] }],
    ['a symbol instead of a code', { ...good, rates: [{ code: '€', rate: 0.9, observedAt: '2026-10-12T00:00:00+00:00' }] }],
    ['a zero rate', { ...good, rates: [{ code: 'EUR', rate: 0, observedAt: '2026-10-12T00:00:00+00:00' }] }],
    ['a negative rate', { ...good, rates: [{ code: 'EUR', rate: -1, observedAt: '2026-10-12T00:00:00+00:00' }] }],
    ['a NaN-like string rate', { ...good, rates: [{ code: 'EUR', rate: '0.9', observedAt: '2026-10-12T00:00:00+00:00' }] }],
    ['a timestamp without offset', { ...good, rates: [{ code: 'EUR', rate: 0.9, observedAt: '2026-10-12 00:00:00' }] }],
    ['the base currency listed as a rate', { ...good, rates: [{ code: 'USD', rate: 1, observedAt: '2026-10-12T00:00:00+00:00' }] }],
    ['a duplicated code', { ...good, rates: [good.rates[0], good.rates[0]] }],
    ['rates without a run id', { ...good, runId: null }],
  ])('rejects %s', (_label, payload) => {
    expect(() => parseFxFeed(payload)).toThrow(FxFeedError);
  });
});

describe('buildDisplayCurrencyStatus fallback', () => {
  it('offers nothing when there is no snapshot, so the site stays on USD', () => {
    expect(buildDisplayCurrencyStatus(null, new Date(), 1000)).toMatchObject({ available: false, reason: 'not_synced', base: 'USD' });
  });
});
