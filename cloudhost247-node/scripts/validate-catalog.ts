/**
 * Phase 6 dev utility: validates every manifest in the catalog directory against the schema
 * without touching the database. Run with: npx tsx scripts/validate-catalog.ts
 */
import { loadManifestCatalog, validatedManifests } from '../src/marketplace/manifest-loader';

const result = loadManifestCatalog('manifests');
console.log('dir:', result.dir);
console.log('valid:', result.loaded.length, 'invalid:', result.invalid.length);
for (const inv of result.invalid) {
  console.log('INVALID', inv.source, inv.errors.slice(0, 3));
}
if (result.invalid.length > 0) process.exit(1);
const categories = new Set<string>(validatedManifests(result).map((m) => m.category));
console.log('categories used:', [...categories].sort().join(', '));
