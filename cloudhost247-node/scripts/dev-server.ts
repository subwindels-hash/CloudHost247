/**
 * Local development server with an embedded Postgres.
 *
 * `npm run dev:server` runs `src/server.ts`, which connects through `pg` to a DATABASE_URL — that
 * needs a real Postgres instance. On a machine with none, this script mounts the same Fastify app
 * (`buildApp`) on an embedded @electric-sql/pglite database after running the real committed
 * migrations, exactly as tests/integration/*.test.ts does. Nothing in `src/` changes: `buildApp`
 * already accepts an injected Queryable, and PGlite is a real Postgres engine, not a mock.
 *
 * Development convenience ONLY. No production code path imports this; it is never deployed.
 */
import { PGlite } from '@electric-sql/pglite';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnv } from '../src/config/env';
import { buildApp } from '../src/app';
import { PgliteClient } from '../database/db-client';
import { migrateUp } from '../database/migrate';
import { syncWebsiteKnowledge } from '../src/ai-website/knowledge-sync';
import { knowledgeIndexReady } from '../src/ai-website/website-knowledge-repo';

const DATA_DIR = process.env.PGLITE_DATA_DIR ?? path.join(process.cwd(), '.dev-db-pg');
const PORT = Number(process.env.PORT ?? 3000);

/**
 * Development/preview only: make the menu-bar IP detector actually able to detect.
 *
 * `npm run dev` and the hosted preview sit behind at least one proxy (the Vite dev server, and in
 * Arena one more edge in front of it). With the production default `VISITOR_IP_MODE=off` the header
 * can therefore only ever say "not enabled", which makes the feature untestable by simply running
 * the app. Here — and only here, this file is never deployed — an unset mode becomes
 * `trusted-proxy` trusting the local hops, so whatever address the outer proxy carries (edge header
 * or appended chain) is verified and shown. Set VISITOR_IP_MODE explicitly to override, including
 * back to `off`. Production (`server.js` / `src/server.ts`) keeps the fail-closed default.
 */
const DEV_TRUSTED_PROXIES = '127.0.0.1/32,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,169.254.0.0/16,100.64.0.0/10';
if (!process.env.VISITOR_IP_MODE) {
  process.env.VISITOR_IP_MODE = 'trusted-proxy';
  process.env.VISITOR_IP_TRUSTED_PROXIES ??= DEV_TRUSTED_PROXIES;
  // eslint-disable-next-line no-console
  console.log('[dev-server] VISITOR_IP_MODE unset: using trusted-proxy with local hops only, so the');
  // eslint-disable-next-line no-console
  console.log('[dev-server] menu-bar IP detector can verify addresses the dev/preview proxy carries.');
  // eslint-disable-next-line no-console
  console.log('[dev-server] Production keeps VISITOR_IP_MODE=off until the real boundary is configured.');
}

async function main() {
  const env = loadEnv();
  const db = await PGlite.create(DATA_DIR);
  const result = await migrateUp(new PgliteClient(db), { isProduction: false });
  // eslint-disable-next-line no-console
  console.log(`[dev-server] embedded Postgres at ${DATA_DIR} — ${result.applied.length} migration(s) applied this run`);

  // The catalogue is empty after `migrate up` by design (real pricing comes from the admin API).
  // On a fresh local database, load the committed dev fixture so the plans UI has something to
  // render. The seed is idempotent and explicitly marked "not a real price" in every row.
  const seedPath = path.join(process.cwd(), 'database', 'seed', 'dev-catalog-seed.sql');
  if (existsSync(seedPath)) {
    const { rows } = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM products');
    if (rows[0]?.count === '0') {
      await db.exec(readFileSync(seedPath, 'utf8'));
      // eslint-disable-next-line no-console
      console.log('[dev-server] catalogue was empty — loaded database/seed/dev-catalog-seed.sql (dev fixtures, not real prices)');
    }
  }

  // Deliberately no Domain Services fixture: nothing in the repository may seed the extension
  // catalogue (tests/security/test_domain_data_provenance.py, and the release-candidate gate that
  // runs it). A local database with no registrar connected therefore renders the honest empty
  // state, exactly as a fresh install does.

  // The AI support agent answers from the website-knowledge index (`ai_knowledge_sources` /
  // `ai_knowledge_chunks`). `migrate up` creates those tables empty, and on a real deployment an
  // administrator (or the knowledge worker) builds the index. Nothing does that locally, so the
  // agent on a fresh dev database refuses every question with `knowledge_unavailable` — it looks
  // broken, but it is simply unindexed. Build it here, once, using the same committed projection and
  // the same idempotent sync production uses. Subsequent boots are a no-op (unchanged sources are
  // skipped). Set DEV_SKIP_KNOWLEDGE_SYNC=1 to skip it.
  if (process.env.DEV_SKIP_KNOWLEDGE_SYNC !== '1') {
    try {
      const ready = await knowledgeIndexReady(db);
      if (!ready) {
        const started = Date.now();
        // eslint-disable-next-line no-console
        console.log('[dev-server] knowledge index empty — building it from the website projection (first run only)…');
        const sync = await syncWebsiteKnowledge(db, { trigger: 'manual' });
        // eslint-disable-next-line no-console
        console.log(
          `[dev-server] knowledge index ready: ${sync.indexed} source(s) indexed, ${sync.unchanged} unchanged, ` +
          `${sync.failed} failed (${Date.now() - started} ms) — the AI support agent can now answer from the site`,
        );
      }
    } catch (error) {
      // A failed index build must not stop the API from booting: the agent degrades to escalation,
      // which is exactly the behaviour it has on an unindexed production install.
      // eslint-disable-next-line no-console
      console.error('[dev-server] knowledge index build failed; the AI agent will escalate instead of answering:', error);
    }
  }

  // API-only by default (the Vite dev server on :5173 is the app in `npm run dev:stack`). Set
  // DEV_SERVE_FRONTEND=1 to additionally serve the built frontend from public/ on this port with
  // SPA fallback — the same behaviour as the production server, and what the port-3000 preview
  // needs. Requires `npm run build:frontend` to have produced public/index.html.
  const serveFrontend = process.env.DEV_SERVE_FRONTEND === '1';
  const app = buildApp(env, { serveFrontend, publicDir: path.join(process.cwd(), 'public'), pool: db });
  await app.listen({ port: PORT, host: '0.0.0.0' });
  // eslint-disable-next-line no-console
  console.log(`[dev-server] API listening on 0.0.0.0:${PORT}`);

  const shutdown = async () => {
    await app.close();
    await db.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[dev-server] failed to start', error);
  process.exit(1);
});
