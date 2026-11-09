import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv, resetEnvCache } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { signAuthToken } from '../../src/lib/jwt';
import { defaultGa4 } from '../../src/marketing/ga4-config';

const BASE = '/api/v1/admin/marketing-integrations/google-analytics';
const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@localhost/test', JWT_SECRET: 'j'.repeat(32), LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv);
describe('GA4 configuration slice', () => {
  let db: PGlite; let app: ReturnType<typeof buildApp>; let admin: string; let customer: string;
  beforeEach(async () => {
    process.env.DATABASE_URL = env.DATABASE_URL; process.env.JWT_SECRET = env.JWT_SECRET; resetEnvCache();
    db = new PGlite(); await migrateUp(new PgliteClient(db), { isProduction: false });
    app = buildApp(env, { pool: db, serveFrontend: false });
    async function user(role: 'admin' | 'customer') {
      const id = randomUUID(); const email = `${id}@example.test`;
      await db.query(`INSERT INTO users(id,email,password_hash,full_name,role) VALUES($1,$2,'unused',$3,$3)`, [id, email, role]);
      return `Bearer ${signAuthToken(env, { sub: id, email, role })}`;
    }
    admin = await user('admin'); customer = await user('customer');
  });
  afterEach(async () => { await app.close(); await db.close(); });
  const cfg = { ...defaultGa4, websiteDomain: 'www.example.com', measurementId: 'G-1234567890', enabled: false };
  async function save(configuration: unknown, revision = 1, authorization = admin) {
    return app.inject({ method: 'PUT', url: BASE, headers: { authorization }, payload: { configuration, expectedRevision: revision } });
  }
  it('enforces current admin role and does not authenticate with consent cookies', async () => {
    expect((await app.inject({ method: 'GET', url: BASE })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: `${BASE}/audit` })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: `${BASE}/audit`, headers: { authorization: customer } })).statusCode).toBe(403);
    expect((await save(cfg, 1, customer)).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `${BASE}/test`, headers: { authorization: customer } })).statusCode).toBe(403);
    const incomplete = await app.inject({ method: 'POST', url: `${BASE}/test`, headers: { authorization: admin } });
    expect(incomplete.json()).toMatchObject({ status: 'configuration_incomplete', providerContacted: false, trackingVerified: false });
    expect((await app.inject({ method: 'GET', url: BASE, headers: { authorization: admin } })).json().configuration.lastSuccessfulLocalTestAt).toBeNull();
    await db.query("UPDATE users SET role='customer' WHERE role='admin'");
    expect((await save(cfg)).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `${BASE}/audit`, headers: { authorization: admin } })).statusCode).toBe(403);
  });
  it('validates input, persists with revision, audits and reports no installation or receipt', async () => {
    for (const measurementId of ['G-123', '<script>alert(1)</script>', 'G-1234567890X', 'UA-1234567890']) expect((await save({ ...cfg, measurementId })).statusCode).toBe(400);
    expect((await save({ ...cfg, enabled: true, streamReviewed: false })).statusCode).toBe(400);
    expect((await save({ ...cfg, enabled: true, measurementId: null, streamReviewed: true, userDataReviewed: true })).statusCode).toBe(400);
    expect((await save({ ...cfg, enabled: true, streamReviewed: true, userDataReviewed: false })).statusCode).toBe(400);
    expect((await save({ ...cfg, websiteDomain: 'https://example.com/path' })).statusCode).toBe(400);
    expect((await save({ ...cfg, script: 'bad' })).statusCode).toBe(400);
    const saved = await save(cfg); expect(saved.statusCode).toBe(200);
    expect(saved.json().configuration).toMatchObject({ measurementId: 'G-1234567890', websiteDomain: 'example.com', revision: 2, installationStatus: 'code_installed', connectionStatus: 'not_verified' });
    expect((await save(cfg)).statusCode).toBe(409);
    const enabled = await save({ ...cfg, enabled: true, streamReviewed: true, userDataReviewed: true }, 2);
    expect(enabled.statusCode).toBe(200);
    const bootstrap = await app.inject({ method: 'GET', url: '/api/v1/marketing/bootstrap', headers: { host: 'example.com' } });
    expect(bootstrap.json().analytics).toMatchObject({ enabled: true, measurementId: 'G-1234567890' });
    const wrongHost = await app.inject({ method: 'GET', url: '/api/v1/marketing/bootstrap', headers: { host: 'other.example' } });
    expect(wrongHost.json().analytics).toMatchObject({ enabled: false, measurementId: null });
    const reloaded = await app.inject({ method: 'GET', url: BASE, headers: { authorization: admin } });
    expect(reloaded.headers['cache-control']).toBe('private, no-store');
    expect(reloaded.json().configuration.measurementId).toBe('G-1234567890');
    expect(reloaded.json().configuration.lastSuccessfulLocalTestAt).toBeNull();
    const tested = await app.inject({ method: 'POST', url: `${BASE}/test`, headers: { authorization: admin } });
    expect(tested.json()).toMatchObject({ status: 'configuration_valid_only', providerContacted: false, trackingVerified: false });
    const afterTest = await app.inject({ method: 'GET', url: BASE, headers: { authorization: admin } });
    expect(afterTest.json().configuration.lastSuccessfulLocalTestAt).toBeTruthy();
    await db.query(`INSERT INTO audit_logs(id,action,resource_type,resource_id,metadata) VALUES($1,'marketing.meta_pixel.configuration_saved','marketing_integration','meta_pixel',$2)`, [randomUUID(), JSON.stringify({ secret: 'do-not-expose' })]);
    const history = await app.inject({ method: 'GET', url: `${BASE}/audit`, headers: { authorization: admin } });
    expect(history.headers['cache-control']).toBe('private, no-store'); expect(history.json().entries).toHaveLength(3);
    expect(history.json().entries.map((entry: { action: string }) => entry.action)).toContain('marketing.google_analytics.configuration_tested');
    for (const entry of history.json().entries) expect(Object.keys(entry).sort()).toEqual(['action', 'actor_id', 'created_at', 'id']);
    expect(history.body).not.toContain('do-not-expose');
    expect((await db.query("SELECT action FROM audit_logs WHERE resource_id='google_analytics' ORDER BY created_at")).rows).toHaveLength(3);
    const reset = await app.inject({ method: 'POST', url: `${BASE}/reset`, headers: { authorization: admin }, payload: { expectedRevision: 3, confirmation: 'RESET' } });
    expect(reset.json().configuration).toMatchObject({ measurementId: null, enabled: false, revision: 4, lastSuccessfulLocalTestAt: null });
    const resetReload = await app.inject({ method: 'GET', url: BASE, headers: { authorization: admin } });
    expect(resetReload.json().configuration.lastSuccessfulLocalTestAt).toBeNull();
    expect((await app.inject({ method: 'GET', url: `${BASE}/audit`, headers: { authorization: admin } })).json().entries).toHaveLength(4);
  });
  it('fails closed for a previously enabled configuration without the new privacy review', async () => {
    const old = { ...cfg, websiteDomain: 'example.com', enabled: true, streamReviewed: true };
    delete (old as Partial<typeof old>).userDataReviewed;
    await db.query(`UPDATE marketing_integrations SET enabled=true, website_domain='example.com', configuration=$1 WHERE provider_key='google_analytics'`, [JSON.stringify(old)]);
    const bootstrap = await app.inject({ method: 'GET', url: '/api/v1/marketing/bootstrap', headers: { host: 'example.com' } });
    expect(bootstrap.json().analytics).toMatchObject({ enabled: false, measurementId: null });
  });
  it('retains Meta constraints and rolls back if audit fails', async () => {
    await expect(db.query("UPDATE marketing_integrations SET enabled=true, website_domain='example.com', configuration='{}' WHERE provider_key='meta_pixel'")).rejects.toThrow();
    await db.exec(`CREATE FUNCTION reject_ga_audit() RETURNS trigger AS $$ BEGIN IF NEW.resource_id='google_analytics' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql; CREATE TRIGGER reject_ga_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_ga_audit();`);
    expect((await save(cfg)).statusCode).toBe(500);
    expect((await app.inject({ method: 'GET', url: BASE, headers: { authorization: admin } })).json().configuration).toMatchObject({ revision: 1, enabled: false });
  });
});
