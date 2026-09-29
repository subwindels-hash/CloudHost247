/**
 * Phase 6 dev/utility: import the on-disk manifest catalog into the database via the same
 * importer the admin API uses (src/marketplace/import-service.ts). Run after migrations:
 *
 *   npx tsx scripts/import-catalog.ts
 *
 * In production the admin route POST /api/v1/admin/manifests/import does the same thing; this
 * script exists so a fresh environment (CI, docker entrypoint) can bootstrap the catalog
 * without an admin token. It refuses to import if any manifest fails schema validation.
 */
import { loadManifestCatalog, validatedManifests } from '../src/marketplace/manifest-loader';
import { importManifests } from '../src/marketplace/import-service';
import { getPool } from '../src/db/pool';
import { loadEnv } from '../src/config/env';

async function main() {
  const env = loadEnv();
  const pool = getPool(env);
  try {
    const catalog = loadManifestCatalog('manifests');
    if (catalog.invalid.length > 0) {
      console.error(`Refusing to import: ${catalog.invalid.length} invalid manifest(s):`);
      for (const invalid of catalog.invalid) {
        console.error(`  ${invalid.source}: ${invalid.errors.join(', ')}`);
      }
      process.exitCode = 1;
      return;
    }
    const report = await importManifests(pool, validatedManifests(catalog));
    console.log(
      `Catalog import complete: ${report.applicationsCreated.length} created, ` +
        `${report.applicationsUpdated.length} updated, ${report.versionsUpserted} versions upserted, ` +
        `${report.categoriesCreated.length} categories created.`
    );
  } finally {
    await pool.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
