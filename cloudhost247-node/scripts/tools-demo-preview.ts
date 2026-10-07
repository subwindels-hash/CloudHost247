/**
 * DEVELOPMENT PREVIEW ONLY — never used in production.
 *
 * Boots the real CloudHost247 application (full migration chain, real route handlers, real tool
 * engine, real abuse/rate-limit/cache layers) against an EMBEDDED Postgres engine (PGlite — the
 * same engine the integration tests use), so the whole Tools Center can be explored end to end
 * without a PostgreSQL server.
 *
 * Why this exists: `npm run dev` starts the API on :3000 and Vite on :5173, and the SPA *is* the
 * tools page — so a preview that serves the built frontend without the application behind it shows
 * "The application did not answer /api/tools/catalog …" on every tools page. This script runs both
 * halves in one process, which is what a visitor's browser actually needs.
 *
 * Everything visible here is produced by the production code paths: the catalogue, every tool
 * execution, history, favorites, reports, monitors and the Super Admin control centre. The only
 * substitution is the database engine. Tools whose providers need real credentials (RDAP/WHOIS,
 * BIN, geolocation) report their honest CONFIGURATION_REQUIRED state, exactly as they do on a
 * deployment that has not configured them.
 *
 * Usage:
 *   npm run build:frontend && npx tsx scripts/tools-demo-preview.ts
 *
 * Logins (password "demo-password-123"):
 *   root@demo.cloudhost247.test   (super_admin — /admin/tools)
 *   amaka@demo-customer.test      (customer — history, favorites, reports, monitors)
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { loadEnv } from '../src/config/env';
import { buildApp } from '../src/app';
import { PgliteClient } from '../database/db-client';
import { migrateUp } from '../database/migrate';
import { hashPassword } from '../src/lib/password';

const PASSWORD = 'demo-password-123';

async function main() {
  const db = new PGlite();
  await migrateUp(new PgliteClient(db), { isProduction: false });

  process.env.DATABASE_URL = 'postgresql://embedded:embedded@localhost:5432/embedded';
  process.env.JWT_SECRET = 'demo-preview-secret-demo-preview-secret';
  process.env.CREDENTIAL_ENCRYPTION_KEY = 'a'.repeat(64);
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'development',
    PORT: process.env.PORT ?? '3000',
  } as NodeJS.ProcessEnv);

  const hash = await hashPassword(PASSWORD);
  const mkUser = async (email: string, role: string, name: string) => {
    const id = randomUUID();
    await db.query(
      `INSERT INTO users (id, email, password_hash, full_name, role) VALUES ($1,$2,$3,$4,$5)`,
      [id, email, hash, name, role]
    );
    return id;
  };
  await mkUser('root@demo.cloudhost247.test', 'super_admin', 'Root Admin (demo)');
  await mkUser('amaka@demo-customer.test', 'customer', 'Amaka Demo (customer)');

  const app = buildApp(env, {
    serveFrontend: true,
    publicDir: path.join(process.cwd(), 'public'),
    pool: db as never,
  });

  await app.listen({ port: env.PORT, host: '0.0.0.0' });

  const count = await app.inject({ method: 'GET', url: '/api/tools/catalog' });
  const catalog = count.json() as { count: number; tools: Array<{ path: string }> };
  const runnable = catalog.tools.filter((tool) => !tool.path.includes(':')).slice(0, 6);

  // eslint-disable-next-line no-console
  console.log(`
  CloudHost247 Tools Center — local preview
  ────────────────────────────────────────────────────────────────────────────
  Serving the built frontend AND the API from one origin, so /api/tools/* answers
  JSON — the deployment fault the tools page now reports by name.

    http://localhost:${env.PORT}/tools              — the Tools Center (${catalog.count} tools)
    http://localhost:${env.PORT}/api/tools/catalog  — the catalogue as JSON

  Try a few:
${runnable.map((tool) => `    http://localhost:${env.PORT}${tool.path}`).join('\n')}
    http://localhost:${env.PORT}/admin/tools        — Super Admin control centre

  Logins (password "${PASSWORD}"):
    root@demo.cloudhost247.test   (super_admin)
    amaka@demo-customer.test      (customer)
`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
