import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';

// Page loads and API calls are limited separately. A browser session that loads several tool
// pages must not be answered with 429 by the bucket meant for API traffic, while the API keeps
// its own limit.
describe('rate limits: SPA page loads versus API routes', () => {
  let db: PGlite;
  process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/cloudhost247';
  process.env.JWT_SECRET ??= 'g'.repeat(32);
  process.env.CREDENTIAL_ENCRYPTION_KEY ??= 'a'.repeat(64);
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.DATABASE_URL,
    JWT_SECRET: process.env.JWT_SECRET,
    CREDENTIAL_ENCRYPTION_KEY: process.env.CREDENTIAL_ENCRYPTION_KEY,
  } as NodeJS.ProcessEnv);

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
  });

  afterEach(async () => {
    await db.close();
  });

  it('does not answer page loads with 429 at the old shared ceiling of 300 per minute', async () => {
    const app = buildApp(env, { serveFrontend: false, pool: db });
    let limited = 0;
    for (let i = 0; i < 350; i++) {
      const res = await app.inject({ method: 'GET', url: `/tools/mrz-generator?n=${i}` });
      if (res.statusCode === 429) limited++;
    }
    expect(limited).toBe(0);
    await app.close();
  });

  it('keeps the stricter 300-per-minute limit on API routes', async () => {
    const app = buildApp(env, { serveFrontend: false, pool: db });
    let limited = 0;
    for (let i = 0; i < 310; i++) {
      const res = await app.inject({ method: 'GET', url: '/api/tools/navigation' });
      if (res.statusCode === 429) limited++;
    }
    expect(limited).toBeGreaterThan(0);
    await app.close();
  });
});

describe('rate limits: static bundles', () => {
  let db: PGlite;
  process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/cloudhost247';
  process.env.JWT_SECRET ??= 'g'.repeat(32);
  process.env.CREDENTIAL_ENCRYPTION_KEY ??= 'a'.repeat(64);
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.DATABASE_URL,
    JWT_SECRET: process.env.JWT_SECRET,
    CREDENTIAL_ENCRYPTION_KEY: process.env.CREDENTIAL_ENCRYPTION_KEY,
  } as NodeJS.ProcessEnv);

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
  });

  afterEach(async () => {
    await db.close();
  });

  it('does not count static bundle requests against the API ceiling', async () => {
    const app = buildApp(env, { serveFrontend: false, pool: db });
    let limited = 0;
    for (let i = 0; i < 320; i++) {
      const res = await app.inject({ method: 'GET', url: `/assets/app-${i % 5}.js` });
      if (res.statusCode === 429) limited++;
    }
    expect(limited).toBe(0);
    await app.close();
  });
});
