import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';

describe('passkey registration foundation', () => {
  let db: PGlite;
  const env = loadEnv({ NODE_ENV:'test', DATABASE_URL:'postgresql://user:pass@localhost:5432/cloudhost247', JWT_SECRET:'p'.repeat(32), APP_URL:'https://app.example.test' } as NodeJS.ProcessEnv);
  beforeEach(async () => { db = new PGlite(); await migrateUp(new PgliteClient(db), { isProduction:false }); });
  afterEach(async () => db.close());

  it('requires password step-up and persists only a hash of a registration challenge', async () => {
    const app = buildApp(env, { serveFrontend:false, pool:db });
    const registered = await app.inject({ method:'POST',url:'/api/auth/register',payload:{email:'passkey@example.com',password:'correct-horse-battery',fullName:'Pass Key'} });
    const token = registered.json().token as string;
    const denied = await app.inject({ method:'POST',url:'/api/auth/passkeys/register/options',headers:{authorization:`Bearer ${token}`},payload:{password:'wrong'} });
    expect(denied.statusCode).toBe(400);
    const started = await app.inject({ method:'POST',url:'/api/auth/passkeys/register/options',headers:{authorization:`Bearer ${token}`},payload:{password:'correct-horse-battery'} });
    expect(started.statusCode).toBe(200);
    const body = started.json() as { challengeId:string; options:{ challenge:string; rp:{ id:string }; authenticatorSelection:{ userVerification:string } } };
    expect(body.options.rp.id).toBe('app.example.test');
    expect(body.options.authenticatorSelection.userVerification).toBe('required');
    const row = await db.query<Record<string,unknown>>(`SELECT * FROM webauthn_registration_challenges WHERE id=$1`, [body.challengeId]);
    expect(JSON.stringify(row.rows[0])).not.toContain(body.options.challenge);
    const listed = await app.inject({ method:'GET',url:'/api/auth/passkeys',headers:{authorization:`Bearer ${token}`} });
    expect(listed.json().passkeys).toEqual([]);
    await app.close();
  });
});
