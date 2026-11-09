import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it, vi } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { loadEnv, resetEnvCache } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { defaultGa4 } from '../../src/marketing/ga4-config';
import { ga4PurchaseCredentials } from '../../src/marketing/ga4-purchase-config';
import { drainGa4Purchases, queueGa4Purchase } from '../../src/marketing/ga4-purchase-delivery';
import type { Queryable } from '../../src/db/types';

const env=loadEnv({NODE_ENV:'test',APP_URL:'http://localhost:3000',DATABASE_URL:'postgresql://test:test@localhost/test',JWT_SECRET:'j'.repeat(32),
  CREDENTIAL_ENCRYPTION_KEY:'a'.repeat(64),GA4_PURCHASE_DELIVERY_ENABLED:'true',GA4_PURCHASE_STAGING_AUTHORIZED:'true',
  GA4_PURCHASE_MEASUREMENT_ID:'G-1234567890',GA4_PURCHASE_API_SECRET:'dummy-test-secret',LOG_LEVEL:'silent'} as NodeJS.ProcessEnv);

describe('GA4 purchase safety interlock (unmocked)', () => {
  it('fails closed before any database or transport call even if all deployment flags are enabled', async () => {
    const db: Queryable = { query: vi.fn(async () => { throw new Error('should not query'); }) };
    const fetchImpl=vi.fn(async () => new Response(null,{status:204}));
    expect(ga4PurchaseCredentials(env,'G-1234567890')).toBeNull();
    expect(await queueGa4Purchase(db,env,'not-used')).toBe(false);
    expect(await drainGa4Purchases(db,env,{fetchImpl:fetchImpl as unknown as typeof fetch})).toEqual({claimed:0,httpAccepted:0,unknown:0,cancelled:0});
    expect(db.query).not.toHaveBeenCalled(); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('does not advertise or store browser IDs and still allows analytics withdrawal', async () => {
    process.env.DATABASE_URL=env.DATABASE_URL; process.env.JWT_SECRET=env.JWT_SECRET; process.env.CREDENTIAL_ENCRYPTION_KEY=env.CREDENTIAL_ENCRYPTION_KEY; resetEnvCache();
    const db=new PGlite(); await migrateUp(new PgliteClient(db),{isProduction:false});
    const app=buildApp(env,{pool:db,serveFrontend:false});
    try {
      await db.query("UPDATE marketing_integrations SET enabled=true,website_domain='localhost',configuration=$1 WHERE provider_key='google_analytics'",[JSON.stringify({...defaultGa4,enabled:true,websiteDomain:'localhost',measurementId:'G-1234567890',streamReviewed:true,userDataReviewed:true})]);
      const bootstrap=await app.inject({method:'GET',url:'/api/v1/marketing/bootstrap',headers:{host:'localhost:3000'}});
      expect(bootstrap.json().analytics.purchaseCapture).toBe(false); expect(bootstrap.body).not.toContain(env.GA4_PURCHASE_API_SECRET);
      const cookie=String(bootstrap.headers['set-cookie']).split(';')[0]!;
      const headers={host:'localhost:3000',origin:'http://localhost:3000',cookie,'x-consent-csrf':bootstrap.json().consent.csrfToken};
      const consent=await app.inject({method:'PUT',url:'/api/v1/marketing/consent',headers,payload:{action:'save_preferences',policyVersion:1,preferences:{essential:true,analytics:true,marketing:false}}});
      expect(consent.statusCode).toBe(200);
      const capture=await app.inject({method:'POST',url:'/api/v1/marketing/ga4-client-id',headers,payload:{clientId:'123.456',revision:1,consentRevision:consent.json().consent.analyticsRevision}});
      expect(capture.statusCode).toBe(403); expect((await db.query('SELECT * FROM ga4_browser_ids')).rows).toHaveLength(0);
      const withdraw=await app.inject({method:'PUT',url:'/api/v1/marketing/consent',headers,payload:{action:'withdraw',policyVersion:1}});
      expect(withdraw.statusCode).toBe(200); expect(withdraw.json().consent.preferences.analytics).toBe(false);
    } finally {await app.close(); await db.close();}
  },30000);
});
