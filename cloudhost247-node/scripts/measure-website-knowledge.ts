/**
 * Measures the website-knowledge corpus, cold and warm.
 *
 * The audit report quotes corpus numbers (documents discovered, sources indexed,
 * chunks written, cold/warm sync timings). Those numbers used to come from a
 * one-off harness that was deleted after use, which meant they could be quoted
 * but not re-derived. This script exists so they can be re-derived at any time:
 *
 *   npx tsx scripts/measure-website-knowledge.ts
 *
 * It runs against PGlite with the real migrations, so it needs no database
 * server and touches nothing outside the process. It is a measurement tool, not
 * a test: nothing here asserts, and a regression in sync counts will show up as
 * different printed numbers rather than a failed suite. The suite that asserts
 * behaviour is tests/unit/ai-website-audit-regressions.test.ts.
 */
import { PGlite } from '@electric-sql/pglite';

import { PgliteClient } from '../database/db-client';
import { migrateUp } from '../database/migrate';
import { syncWebsiteKnowledge } from '../src/ai-website/knowledge-sync';
import { WEBSITE_PROJECTION } from '../src/ai-website/website-discovery';

function report(result: { discovered: number; indexed: number; unchanged: number; skipped: number; excluded: number; removed: number; failed: number; status: string }): void {
  const fields: Array<[string, number | string]> = [
    ['discovered', result.discovered],
    ['indexed', result.indexed],
    ['unchanged', result.unchanged],
    ['skipped', result.skipped],
    ['excluded', result.excluded],
    ['removed', result.removed],
    ['failed', result.failed],
    ['status', result.status],
  ];
  for (const [label, value] of fields) console.log(`${label.padEnd(18)} ${value}`);
}

async function scalar(db: PGlite, sql: string): Promise<number> {
  const result = await db.query<{ n: string }>(sql);
  return Number(result.rows[0]?.n ?? 0);
}

async function main(): Promise<void> {
  const documents = WEBSITE_PROJECTION.documents ?? [];
  const routes = WEBSITE_PROJECTION.routes ?? [];
  const projectionBytes = documents.reduce((total, doc) => total + JSON.stringify(doc).length, 0);

  console.log('--- projection (no database) ---');
  console.log(`documents          ${documents.length}`);
  console.log(`routes             ${routes.length}`);
  console.log(`projection size    ${Math.round(projectionBytes / 1024)} kB of JSON`);

  const db = new PGlite();
  try {
    await migrateUp(new PgliteClient(db), { isProduction: false });

    const coldStart = Date.now();
    const cold = await syncWebsiteKnowledge(db, { trigger: 'manual' });
    const coldMs = Date.now() - coldStart;

    const warmStart = Date.now();
    const warm = await syncWebsiteKnowledge(db, { trigger: 'manual' });
    const warmMs = Date.now() - warmStart;

    console.log('\n--- cold sync (empty knowledge tables) ---');
    report(cold);
    console.log(`wall clock         ${coldMs} ms`);

    console.log('\n--- warm sync (nothing changed) ---');
    report(warm);
    console.log(`wall clock         ${warmMs} ms`);

    console.log('\n--- tables after sync ---');
    console.log(`sources            ${await scalar(db, 'select count(*)::text as n from ai_knowledge_sources')}`);
    console.log(`chunks             ${await scalar(db, 'select count(*)::text as n from ai_knowledge_chunks')}`);
    // Skipped sources are recorded with sync_status = 'skipped' and no chunks. That is
    // deliberate: a page that is not retrievable is recorded rather than silently dropped,
    // so the admin console can show what was left out and why. It is not a defect.
    console.log(
      `skipped (recorded) ${await scalar(
        db,
        "select count(*)::text as n from ai_knowledge_sources where sync_status = 'skipped'",
      )}`,
    );
    console.log(
      `sources w/o chunks ${await scalar(
        db,
        'select count(*)::text as n from ai_knowledge_sources s where not exists (select 1 from ai_knowledge_chunks c where c.source_id = s.id)',
      )}`,
    );
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
