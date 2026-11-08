import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { signAuthToken } from '../../src/lib/jwt';
import { resetEnvCache } from '../../src/config/env';
import { defaultConfiguration } from '../../src/marketing/types';

const BASE = '/api/v1/admin/marketing-integrations/meta-pixel';
const TOKEN = 'TEST_META_ACCESS_TOKEN_0123456789';
const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@localhost/test', JWT_SECRET: 'j'.repeat(32), CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64), LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv);

describe('canonical Meta Pixel configuration', () => {
  let db: PGlite;
  let app: ReturnType<typeof buildApp>;
  let admin: string;
  let customer: string;
  beforeEach(async () => {
    process.env.DATABASE_URL = env.DATABASE_URL;
    process.env.JWT_SECRET = env.JWT_SECRET;
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'a'.repeat(64);
    resetEnvCache();
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
    app = buildApp(env, { pool: db, serveFrontend: false });
    admin = await user('admin'); customer = await user('customer');
  });
  afterEach(async () => { await app.close(); await db.close(); });
  async function user(role: 'admin' | 'customer' | 'staff' | 'super_admin') {
    const id = randomUUID();
    await db.query(`INSERT INTO users(id,email,password_hash,full_name,role) VALUES($1,$2,'unused',$3,$4)`, [id, `${role}-${id}@example.test`, role, role]);
    return signAuthToken(env, { sub: id, email: `${role}@example.test`, role });
  }
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  async function save(revision: number, overrides = {}, extra = {}) {
    return app.inject({ method: 'PUT', url: BASE, headers: auth(admin), payload: { expectedRevision: revision, configuration: { ...defaultConfiguration, pixelId: '123456789012345', websiteDomain: 'cloudhost247.com', enabled: true, ...overrides }, ...extra } });
  }
  it('requires authentication and fresh admin authorization on every endpoint', async () => {
    expect((await app.inject({ method: 'GET', url: BASE })).statusCode).toBe(401);
    for (const role of ['customer', 'staff'] as const) expect((await app.inject({ method: 'GET', url: BASE, headers: auth(await user(role)) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: BASE, headers: auth(admin) })).json().configuration.enabled).toBe(false);
    await db.query(`UPDATE users SET role='customer' WHERE role='admin'`);
    expect((await app.inject({ method: 'GET', url: BASE, headers: auth(admin) })).statusCode).toBe(403);
  });
  it('validates IDs, domains, test codes and enable prerequisites server-side', async () => {
    for (const pixelId of ['abc', '123', '0123456789', '<script>', '1'.repeat(33)]) expect((await save(1, { pixelId })).statusCode).toBe(400);
    expect((await save(1, { pixelId: null })).statusCode).toBe(400);
    expect((await save(1, { websiteDomain: 'https://cloudhost247.com/path' })).statusCode).toBe(400);
    expect((await save(1, { testMode: true, testEventCode: null })).statusCode).toBe(400);
    expect((await save(1, { unknown: true })).statusCode).toBe(400);
    expect((await save(99)).statusCode).toBe(409);
    expect((await db.query('SELECT revision,enabled FROM marketing_integrations')).rows[0]).toEqual({ revision: 1, enabled: false });
  });
  it('saves, tests honestly, detects stale writes, audits and resets only with confirmation', async () => {
    const saved = await save(1, { testMode: true, testEventCode: 'TEST123' });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().configuration.revision).toBe(2);
    expect((await save(1)).statusCode).toBe(409);
    const test = await app.inject({ method: 'POST', url: `${BASE}/test`, headers: auth(admin) });
    expect(test.json()).toMatchObject({ status: 'CONFIGURATION_VALID', providerContacted: false, metaReceiptVerified: false });
    expect((await app.inject({ method: 'POST', url: `${BASE}/reset`, headers: auth(admin), payload: { expectedRevision: 2, confirmation: 'no' } })).statusCode).toBe(400);
    const reset = await app.inject({ method: 'POST', url: `${BASE}/reset`, headers: auth(admin), payload: { expectedRevision: 2, confirmation: 'RESET' } });
    expect(reset.statusCode).toBe(200);
    expect(reset.json().configuration).toMatchObject({ enabled: false, pixelId: null, testMode: false, revision: 3 });
    const audit = await app.inject({ method: 'GET', url: `${BASE}/audit`, headers: auth(admin) });
    expect(audit.json().entries.map((e: { action: string }) => e.action)).toEqual(expect.arrayContaining(['marketing.meta_pixel.configuration_saved','marketing.meta_pixel.configuration_reset']));
    expect(audit.body).not.toContain('TEST_META');
  });
  it('encrypts CAPI secrets separately, never returns them, and cannot enable without a token', async () => {
    expect((await save(1, { capi: { enabled: true, apiVersion: 'v26.0' } })).statusCode).toBe(400);
    const saved = await save(1, { capi: { enabled: true, apiVersion: 'v26.0' } }, { capiAccessToken: TOKEN });
    expect(saved.statusCode).toBe(200);
    expect(saved.body).not.toContain(TOKEN);
    expect(saved.json().configuration.capi.hasToken).toBe(true);
    const stored = (await db.query<{ encrypted_value: string }>('SELECT encrypted_value FROM marketing_integration_secrets')).rows[0]!;
    expect(stored.encrypted_value).toMatch(/^v1:/);
    expect(stored.encrypted_value).not.toContain(TOKEN);
    for (const url of [BASE, `${BASE}/audit`, `${BASE}/activity`]) expect((await app.inject({ method: 'GET', url, headers: auth(admin) })).body).not.toContain(TOKEN);
    expect((await save(2, { capi: { enabled: true, apiVersion: 'v26.0' } }, { removeCapiToken: true })).statusCode).toBe(400);
    await save(2, { capi: { enabled: false, apiVersion: 'v26.0' } }, { removeCapiToken: true });
    expect((await db.query('SELECT * FROM marketing_integration_secrets')).rows).toHaveLength(0);
  });
  it('imports the legacy identifier disabled, without changing the legacy theme setting', async () => {
    const result = await app.inject({ method: 'POST', url: `${BASE}/import-legacy`, headers: auth(admin), payload: { pixelId: '123456789012345', websiteDomain: 'www.cloudhost247.com', expectedRevision: 1, confirmImport: true } });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ importedFrom: 'facebook_pixel_code', enabled: false });
    expect(result.json().configuration).toMatchObject({ enabled: false, websiteDomain: 'cloudhost247.com' });
  });
  it('rolls back configuration when the audit write fails', async () => {
    await db.exec(`CREATE FUNCTION reject_marketing_audit() RETURNS trigger AS $$ BEGIN IF NEW.resource_type='marketing_integration' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_marketing_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_marketing_audit();`);
    expect((await save(1)).statusCode).toBe(500);
    expect((await db.query('SELECT revision,enabled FROM marketing_integrations')).rows[0]).toEqual({ revision: 1, enabled: false });
  });
  it('fails closed when no encryption key is available', async () => {
    const old = process.env.CREDENTIAL_ENCRYPTION_KEY;
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    resetEnvCache();
    try { expect((await save(1, {}, { capiAccessToken: TOKEN })).statusCode).toBe(503); }
    finally { if (old) process.env.CREDENTIAL_ENCRYPTION_KEY = old; resetEnvCache(); }
    expect((await db.query('SELECT * FROM marketing_integration_secrets')).rows).toHaveLength(0);
  });
});
