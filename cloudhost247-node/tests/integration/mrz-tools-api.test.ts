import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { signAuthToken } from '../../src/lib/jwt';
import { hashPassword } from '../../src/lib/password';

describe('MRZ Developer Tool API, Security, Privacy & Super Admin Settings', () => {
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

  const ICAO_LINE_1 = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<';
  const ICAO_LINE_2 = 'L898902C36UTO7408122F1204159ZE184226B<<<<<10';

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
  });

  afterEach(async () => {
    await db.close();
  });

  function buildTestApp() {
    return buildApp(env, { serveFrontend: false, pool: db });
  }

  async function createUser(
    email: string,
    role: 'customer' | 'admin' | 'super_admin' = 'customer',
    fullName = 'Test User'
  ) {
    const id = randomUUID();
    const hash = await hashPassword('password123');
    await db.query(
      `INSERT INTO users (id, email, password_hash, full_name, role) VALUES ($1, $2, $3, $4, $5)`,
      [id, email, hash, fullName, role]
    );
    const token = signAuthToken(env, { sub: id, email, role });
    return { id, email, role, token };
  }

  it('generates, validates, parses, and explains TD3 MRZs without echoing or storing personal data', async () => {
    const app = buildTestApp();

    const genRes = await app.inject({
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

    expect(genRes.statusCode).toBe(200);
    expect(genRes.headers['cache-control']).toContain('no-store');
    const genBody = genRes.json();
    expect(genBody.success).toBe(true);
    expect(genBody.documentType).toBe('TD3');
    expect(genBody.mrz).toEqual({
      line1: ICAO_LINE_1,
      line2: ICAO_LINE_2,
    });
    expect(genBody.validation).toEqual({
      structure: true,
      checkDigits: true,
    });
    // Personal input fields are not echoed back in the generation response (spec §17)
    expect(genBody.surname).toBeUndefined();
    expect(genBody.givenNames).toBeUndefined();
    expect(genBody.documentNumber).toBeUndefined();
    expect(genBody.dateOfBirth).toBeUndefined();

    // Validate endpoint
    const valRes = await app.inject({
      method: 'POST',
      url: '/api/tools/mrz/validate',
      payload: {
        mrz: `${ICAO_LINE_1}\n${ICAO_LINE_2}`,
      },
    });
    expect(valRes.statusCode).toBe(200);
    const valBody = valRes.json();
    expect(valBody.valid).toBe(true);
    expect(valBody.status).toBe('VALID');
    expect(valBody.summary).toBe('MRZ structure is valid.');
    expect(valBody.authenticityVerified).toBe(false);

    // Parse endpoint
    const parseRes = await app.inject({
      method: 'POST',
      url: '/api/tools/mrz/parse',
      payload: {
        mrz: `${ICAO_LINE_1}\n${ICAO_LINE_2}`,
      },
    });
    expect(parseRes.statusCode).toBe(200);
    const parseBody = parseRes.json();
    expect(parseBody.success).toBe(true);
    expect(parseBody.parsedStatus).toBe('Successfully parsed');
    expect(parseBody.authenticityVerified).toBe(false);
    expect(parseBody.fields.surname).toBe('ERIKSSON');
    expect(parseBody.fields.givenNames).toBe('ANNA MARIA');
    expect(parseBody.fields.documentNumber).toBe('L898902C3');
    expect(parseBody.fields.checkDigitStatus).toBe('PASS');

    // Synthetic test-data endpoint
    const testDataRes = await app.inject({
      method: 'POST',
      url: '/api/tools/mrz/test-data',
      payload: { seedIndex: 0 },
    });
    expect(testDataRes.statusCode).toBe(200);
    const testDataBody = testDataRes.json();
    expect(testDataBody.synthetic).toBe(true);
    expect(testDataBody.label).toContain('SYNTHETIC TEST DATA');
    expect(testDataBody.mrz.line1).toHaveLength(44);
    expect(testDataBody.mrz.line2).toHaveLength(44);

    // AI explanation endpoint
    const explainRes = await app.inject({
      method: 'POST',
      url: '/api/tools/mrz/explain',
      payload: {
        topic: 'fields',
        mrz: { line1: ICAO_LINE_1, line2: ICAO_LINE_2 },
      },
    });
    expect(explainRes.statusCode).toBe(200);
    const explainBody = explainRes.json();
    expect(explainBody.success).toBe(true);
    expect(explainBody.explanation.authenticityVerified).toBe(false);

    // Default logging_level is 'none' -> zero rows written to audit_logs
    const auditRows = await db.query(`SELECT * FROM audit_logs WHERE resource_type = 'tool_mrz'`);
    expect(auditRows.rows).toHaveLength(0);
    await app.close();
  });

  it('rejects XSS payloads, oversized payloads, and malformed requests', async () => {
    const app = buildTestApp();

    // XSS payload in surname
    const xssRes = await app.inject({
      method: 'POST',
      url: '/api/tools/mrz/generate',
      payload: {
        documentType: 'P<',
        issuingState: 'UTO',
        surname: '<script>alert("xss")</script>',
        givenNames: 'TEST',
        nationality: 'UTO',
        dateOfBirth: '850115',
        sex: 'M',
        documentNumber: 'TEST10001',
        expiryDate: '321231',
      },
    });
    expect(xssRes.statusCode).toBe(400);

    // XSS payload in parser
    const xssParseRes = await app.inject({
      method: 'POST',
      url: '/api/tools/mrz/parse',
      payload: {
        mrz: '<img src=x onerror=alert(1)>',
      },
    });
    expect(xssParseRes.statusCode).toBe(400);

    // Oversized body (> 4 KB)
    const oversizedRes = await app.inject({
      method: 'POST',
      url: '/api/tools/mrz/validate',
      payload: {
        mrz: 'A'.repeat(5000),
      },
    });
    expect([400, 413]).toContain(oversizedRes.statusCode);

    // Malformed JSON
    const malformedRes = await app.inject({
      method: 'POST',
      url: '/api/tools/mrz/generate',
      headers: { 'content-type': 'application/json' },
      payload: '{"surname": "TEST", broken json',
    });
    expect(malformedRes.statusCode).toBe(400);

    await app.close();
  });

  it('enforces Super Admin settings, rate limiting, availability RBAC, and privacy redaction in operational logs', async () => {
    const app = buildTestApp();
    const customer = await createUser('dev@example.com', 'customer');
    const superAdmin = await createUser('admin@example.com', 'super_admin');

    // Customer cannot access admin MRZ settings
    const forbiddenGet = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/tools/mrz/settings',
      headers: { authorization: `Bearer ${customer.token}` },
    });
    expect(forbiddenGet.statusCode).toBe(403);

    // Super Admin cannot disable privacy protections
    const disablePrivacyRes = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/tools/mrz/settings',
      headers: { authorization: `Bearer ${superAdmin.token}` },
      payload: {
        disablePrivacy: true,
      },
    });
    expect(disablePrivacyRes.statusCode).toBe(400);
    expect(disablePrivacyRes.json().message).toContain('Privacy protections');

    // Super Admin updates settings: loggingLevel = minimal_operational, availability = authenticated, rateLimitPerMinute = 3
    const updateRes = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/tools/mrz/settings',
      headers: { authorization: `Bearer ${superAdmin.token}` },
      payload: {
        calculatorEnabled: true,
        parserEnabled: false,
        testDataEnabled: false,
        rateLimitPerMinute: 3,
        loggingLevel: 'minimal_operational',
        availability: 'authenticated',
      },
    });
    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json().settings.parserEnabled).toBe(false);
    expect(updateRes.json().settings.availability).toBe('authenticated');

    // Anonymous call is now rejected with 401 because availability = authenticated
    const anonRes = await app.inject({
      method: 'POST',
      url: '/api/tools/mrz/generate',
      payload: {
        documentType: 'P<',
        issuingState: 'UTO',
        surname: 'TEST',
        givenNames: 'PERSON',
        nationality: 'UTO',
        dateOfBirth: '850115',
        sex: 'M',
        documentNumber: 'TEST10001',
        expiryDate: '321231',
      },
    });
    expect(anonRes.statusCode).toBe(401);

    // Parser is disabled -> returns 403 even for authenticated user
    const disabledParserRes = await app.inject({
      method: 'POST',
      url: '/api/tools/mrz/parse',
      headers: { authorization: `Bearer ${customer.token}` },
      payload: { mrz: `${ICAO_LINE_1}\n${ICAO_LINE_2}` },
    });
    expect(disabledParserRes.statusCode).toBe(403);

    // Authenticated customer generates MRZ (3rd request within the 3 req/min window)
    const authGenRes = await app.inject({
      method: 'POST',
      url: '/api/tools/mrz/generate',
      headers: { authorization: `Bearer ${customer.token}` },
      payload: {
        documentType: 'P<',
        issuingState: 'UTO',
        surname: 'CONFIDENTIALSURNAME',
        givenNames: 'CONFIDENTIALGIVEN',
        nationality: 'UTO',
        dateOfBirth: '850115',
        sex: 'M',
        documentNumber: 'SECRET999',
        expiryDate: '321231',
      },
    });
    expect(authGenRes.statusCode).toBe(200);

    // 4th request exceeds rateLimitPerMinute = 3 -> returns 429 RATE_LIMITED
    const rateLimitedRes = await app.inject({
      method: 'POST',
      url: '/api/tools/mrz/validate',
      headers: { authorization: `Bearer ${customer.token}` },
      payload: { mrz: `${ICAO_LINE_1}\n${ICAO_LINE_2}` },
    });
    expect(rateLimitedRes.statusCode).toBe(429);
    expect(rateLimitedRes.json().error).toBe('RATE_LIMITED');

    // Verify operational audit logs contain ONLY non-sensitive metadata and NEVER personal/MRZ data
    const auditRes = await db.query<{ metadata: Record<string, unknown>; actor_id: string | null }>(
      `SELECT actor_id, metadata FROM audit_logs WHERE resource_type = 'tool_mrz'`
    );
    expect(auditRes.rows.length).toBeGreaterThanOrEqual(2);
    const serializedAudit = JSON.stringify(auditRes.rows);
    expect(serializedAudit).not.toContain('CONFIDENTIALSURNAME');
    expect(serializedAudit).not.toContain('CONFIDENTIALGIVEN');
    expect(serializedAudit).not.toContain('SECRET999');
    expect(serializedAudit).not.toContain('850115');
    expect(serializedAudit).not.toContain(ICAO_LINE_1);
    expect(serializedAudit).not.toContain(ICAO_LINE_2);

    for (const row of auditRes.rows) {
      expect(Object.keys(row.metadata).sort()).toEqual(
        ['errorCategory', 'operation', 'success', 'timestamp', 'tool'].sort()
      );
    }

    await app.close();
  });
});
