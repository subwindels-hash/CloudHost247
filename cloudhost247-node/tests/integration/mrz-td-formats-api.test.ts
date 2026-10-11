import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';

// Integration coverage for the TD1/TD2 branches of the MRZ routes. The TD3 path is covered by
// mrz-tools-api.test.ts.
describe('MRZ TD1/TD2 API routes', () => {
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

  const TD1_LINES = [
    'I<UTOD231458907<<<<<<<<<<<<<<<',
    '7408122F1204159UTO<<<<<<<<<<<6',
    'ERIKSSON<<ANNA<MARIA<<<<<<<<<<',
  ];
  const TD2_LINES = [
    'I<UTOERIKSSON<<ANNA<MARIA'.padEnd(36, '<'),
    'D231458907UTO7408122F1204159'.padEnd(35, '<') + '6',
  ];

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
  });

  afterEach(async () => {
    await db.close();
  });

  const buildTestApp = () => buildApp(env, { serveFrontend: false, pool: db });

  it('generates a TD1 MRZ, returns three lines, and marks it as not officially valid', async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/mrz/generate',
      payload: {
        format: 'TD1',
        documentType: 'I<',
        issuingState: 'UTO',
        surname: 'Eriksson',
        givenNames: 'Anna Maria',
        nationality: 'UTO',
        dateOfBirth: '740812',
        sex: 'F',
        documentNumber: 'D23145890',
        expiryDate: '120415',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('no-store');
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.format).toBe('TD1');
    expect(body.lines).toHaveLength(3);
    expect(body.lines[1]).toBe(TD1_LINES[1]);
    expect(body.validation.valid).toBe(true);
    expect(body.authenticityNotice).toMatch(/does NOT verify/);
  });

  it('generates a TD2 MRZ when format is TD2', async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/mrz/generate',
      payload: {
        format: 'TD2',
        documentType: 'P<',
        issuingState: 'UTO',
        surname: 'Eriksson',
        givenNames: 'Anna Maria',
        nationality: 'UTO',
        dateOfBirth: '740812',
        sex: 'F',
        documentNumber: 'D23145890',
        expiryDate: '120415',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().lines.every((line: string) => line.length === 36)).toBe(true);
  });

  it('returns 400 with field errors for TD1 input that cannot be encoded', async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/mrz/generate',
      payload: {
        format: 'TD1',
        issuingState: 'NIGERIA',
        surname: 'Eriksson',
        givenNames: 'Anna',
        nationality: 'UTO',
        dateOfBirth: '740812',
        sex: 'F',
        documentNumber: 'D23145890',
        expiryDate: '120415',
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.errors.map((e: { field: string }) => e.field)).toContain('issuingState');
  });

  it('keeps TD3 generation as the default when no format is given', async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/mrz/generate',
      payload: {
        documentType: 'P<',
        issuingState: 'UTO',
        surname: 'Eriksson',
        givenNames: 'Anna Maria',
        nationality: 'UTO',
        dateOfBirth: '740812',
        sex: 'Female',
        documentNumber: 'L898902C3',
        expiryDate: '120415',
        optionalData: 'ZE184226B',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().documentType).toBe('TD3');
  });

  it('validates a three-line TD1 posted as line1, line2 and line3', async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/mrz/validate',
      payload: { line1: TD1_LINES[0], line2: TD1_LINES[1], line3: TD1_LINES[2] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.format).toBe('TD1');
    expect(body.valid).toBe(true);
    expect(body.checkDigits).toHaveLength(4);
  });

  it('validates a TD2 posted as a newline-separated mrz string and reports a bad check digit', async () => {
    const app = buildTestApp();
    const bad = TD2_LINES[1]!.slice(0, 35) + '0';
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/mrz/validate',
      payload: { mrz: `${TD2_LINES[0]}\n${bad}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.format).toBe('TD2');
    expect(body.valid).toBe(false);
    expect(body.checks.compositeCheck).toBe('FAIL');
  });

  it('parses a TD1 and returns fields, and returns 400 when the layout is unrecognised', async () => {
    const app = buildTestApp();
    const ok = await app.inject({
      method: 'POST',
      url: '/api/tools/mrz/parse',
      payload: { line1: TD1_LINES[0], line2: TD1_LINES[1], line3: TD1_LINES[2] },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().fields.surname).toBe('ERIKSSON');

    const bad = await app.inject({
      method: 'POST',
      url: '/api/tools/mrz/parse',
      payload: { line1: 'short', line2: 'x' },
    });
    expect(bad.statusCode).toBe(400);
  });
});
