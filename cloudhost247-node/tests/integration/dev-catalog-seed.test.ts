import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';

/**
 * Regression check for database/seed/dev-catalog-seed.sql: not a migration, never run
 * automatically, but it must stay valid SQL against the real committed migrations and must stay
 * genuinely idempotent (safe to run twice), since a developer following the file's own header
 * instructions could reasonably do that by accident.
 */
describe('database/seed/dev-catalog-seed.sql', () => {
  it('applies cleanly against a freshly migrated database, and is idempotent when run a second time', async () => {
    const db = new PGlite();
    const client = new PgliteClient(db);
    await migrateUp(client, { isProduction: false });

    const sql = readFileSync(new URL('../../database/seed/dev-catalog-seed.sql', import.meta.url), 'utf8');

    await db.exec(sql);
    await db.exec(sql); // must not error or duplicate rows the second time

    const products: any = await db.query('SELECT slug, status, visibility FROM products ORDER BY slug');
    expect(products.rows).toEqual([
      { slug: 'dev-example-draft-product', status: 'draft', visibility: 'public' },
      { slug: 'dev-example-hosting', status: 'active', visibility: 'public' },
    ]);

    const pricing: any = await db.query("SELECT amount, effective_status FROM plan_pricing WHERE billing_period = 'monthly'");
    expect(pricing.rows).toEqual([{ amount: '1.23', effective_status: 'published' }]);

    await db.close();
  });
});
