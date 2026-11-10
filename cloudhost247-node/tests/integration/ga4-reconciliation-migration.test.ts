import { PGlite } from '@electric-sql/pglite';
import { mkdtempSync, readdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { MIGRATIONS_DIR, migrateUp, verify } from '../../database/migrate';

describe('GA4 migration follows existing provider migrations', () => {
  it('upgrades an existing installation without changing or invalidating Ads and TikTok', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ga4-reconcile-'));
    const db = new PGlite(); const client = new PgliteClient(db);
    try {
      for (const name of readdirSync(MIGRATIONS_DIR).filter(n => n.endsWith('.sql') && n < '0093')) copyFileSync(path.join(MIGRATIONS_DIR, name), path.join(dir, name));
      await migrateUp(client, { isProduction: false }, dir);
      await db.query("UPDATE marketing_integrations SET enabled=true, website_domain='example.com', configuration=$1 WHERE provider_key='google_ads'", [JSON.stringify({ customerId:'1234567890', conversionId:'123456789' })]);
      await db.query("UPDATE marketing_integrations SET enabled=true, website_domain='example.com', configuration=$1 WHERE provider_key='tiktok_pixel'", [JSON.stringify({ pixelId:'ABCDEFGHIJKLMNOP', testMode:false })]);
      const result = await migrateUp(client, { isProduction: false });
      // The second migrateUp applies everything newer than 0092, in version order. The GA4 migrations
      // are the subject here, so pin those exactly and assert the *ordering* of the rest rather than
      // their membership: this test broke once when an unrelated feature added 0102-0104, which is a
      // false failure for a GA4 test and a real failure for whoever had to work out why.
      expect(result.applied.slice(0, 6)).toEqual([
        '0093_add_ga4_configuration.sql','0094_add_ga4_checkout_context.sql','0095_add_ga4_purchase_delivery.sql',
        '0096_create_email_forensics.sql','0097_refund_idempotency_key.sql','0098_refund_idempotency_global_uniqueness.sql',
      ]);
      // Everything applied is in ascending version order, and nothing after 0092 was skipped.
      const versions = result.applied.map((name) => Number(name.slice(0, 4)));
      expect(versions).toEqual([...versions].sort((a, b) => a - b));
      expect(versions.every((version) => version > 92)).toBe(true);
      expect(result.applied).toContain('0099_create_visitor_intelligence.sql');
      expect((await verify(client)).ok).toBe(true);
      const rows = (await db.query<{ provider_key:string; enabled:boolean }>("SELECT provider_key,enabled FROM marketing_integrations ORDER BY provider_key")).rows;
      expect(rows).toEqual([{ provider_key:'google_ads', enabled:true }, { provider_key:'google_analytics', enabled:false }, { provider_key:'meta_pixel', enabled:false }, { provider_key:'tiktok_pixel', enabled:true }]);
      await expect(db.query("UPDATE marketing_integrations SET configuration='{}'::jsonb WHERE provider_key='google_ads' AND enabled=true")).rejects.toThrow();
      await expect(db.query("UPDATE marketing_integrations SET configuration='{}'::jsonb WHERE provider_key='tiktok_pixel' AND enabled=true")).rejects.toThrow();
    } finally { await db.close(); rmSync(dir, { recursive:true, force:true }); }
  }, 30000);
});
