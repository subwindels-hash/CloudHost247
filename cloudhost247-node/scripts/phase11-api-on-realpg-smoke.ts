/**
 * Phase 11 — API booted against REAL PostgreSQL 16.2 (unix socket), not PGlite: tenant-isolation
 * and authz smoke. Local throwaway server/database only; no external calls.
 */
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app';
import { loadEnv } from '../src/config/env';
import { signAuthToken } from '../src/lib/jwt';
import { writeFileSync } from 'node:fs';

async function main() {
  const pool = new Pool({ host: '/tmp/pgdata-p10', user: 'postgres', database: 'postgres', max: 2 });
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://postgres@/postgres?host=/tmp/pgdata-p10',
    JWT_SECRET: 'f'.repeat(32),
    SERVER_AGENT_SHARED_SECRET: 's'.repeat(32),
    CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64),
  } as NodeJS.ProcessEnv);
  const app = buildApp(env, { serveFrontend: false, pool: pool as never });
  const results: Record<string, unknown> = { generatedAt: new Date().toISOString(), checks: [] as unknown[] };
  const checks = results.checks as Array<{ name: string; expected: string; observed: string; pass: boolean }>;
  const record = (name: string, expected: string, observed: string, pass: boolean) =>
    checks.push({ name, expected, observed, pass });

  const userA = randomUUID();
  const userB = randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, full_name, role, status) VALUES ($1,$2,'h','A','customer','active'),($3,$4,'h','B','customer','active')`,
    [userA, `p11a-${userA.slice(0, 4)}@example.com`, userB, `p11b-${userB.slice(0, 4)}@example.com`]
  );
  const tokenA = signAuthToken(env, { sub: userA, email: 'a@example.com', role: 'customer' });
  const tokenB = signAuthToken(env, { sub: userB, email: 'b@example.com', role: 'customer' });

  // 1) Health endpoint over the real PG pool.
  const health = await app.inject({ method: 'GET', url: '/health' });
  record('GET /api/health', '200', String(health.statusCode), health.statusCode === 200);

  // 2) Tenant isolation: A creates an SSL certificate; B must not see it.
  const create = await app.inject({
    method: 'POST', url: '/api/v1/ssl/certificates',
    headers: { authorization: `Bearer ${tokenA}` }, payload: { domainName: 'p11-iso.example.com', challengeType: 'HTTP_01' },
  });
  record('A creates SSL cert (real PG write)', '201', String(create.statusCode), create.statusCode === 201);
  const certId = JSON.parse(create.payload).certificate.id;

  const bList = await app.inject({ method: 'GET', url: '/api/v1/ssl/certificates', headers: { authorization: `Bearer ${tokenB}` } });
  const bCerts = JSON.parse(bList.payload).certificates ?? [];
  record('B cannot list A\'s certificate', 'no cross-tenant rows', `${bCerts.length} visible`, bCerts.every((c: { user_id?: string }) => c.user_id !== userA));

  const bRead = await app.inject({ method: 'GET', url: `/api/v1/ssl/certificates/${certId}`, headers: { authorization: `Bearer ${tokenB}` } });
  record('B cannot read A\'s certificate by id', '404', String(bRead.statusCode), bRead.statusCode === 404);

  // 3) Unauthorized routes refuse without token.
  const anon = await app.inject({ method: 'GET', url: '/api/v1/ssl/certificates' });
  record('anonymous is refused', '401', String(anon.statusCode), anon.statusCode === 401);

  results.allPassed = checks.every((c) => c.pass);
  await app.close();
  await pool.query(`DELETE FROM ssl_certificates WHERE domain_name = 'p11-iso.example.com'`).catch(() => undefined);
  await pool.query(`DELETE FROM users WHERE id IN ($1,$2)`, [userA, userB]).catch(() => undefined);
  await pool.end();
  writeFileSync('/home/user/CloudHost247/docs/staging/phase11-api-realpg-smoke-2026-11-09.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  process.exit(results.allPassed ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
