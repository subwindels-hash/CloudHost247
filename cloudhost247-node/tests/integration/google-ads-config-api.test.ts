import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {loadEnv,resetEnvCache} from '../../src/config/env';
import {buildApp} from '../../src/app';
import {PgliteClient} from '../../database/db-client';
import {migrateUp} from '../../database/migrate';
import {signAuthToken} from '../../src/lib/jwt';
import {defaultGoogleAdsConfiguration} from '../../src/marketing/google-ads';
const BASE='/api/v1/admin/marketing-integrations/google-ads';
const env=loadEnv({NODE_ENV:'test',DATABASE_URL:'postgresql://test:test@localhost/test',JWT_SECRET:'g'.repeat(32),LOG_LEVEL:'silent'} as NodeJS.ProcessEnv);
describe('Google Ads admin configuration',()=>{
 let db:PGlite;let app:ReturnType<typeof buildApp>;let admin:string;let customer:string;
 beforeEach(async()=>{process.env.DATABASE_URL=env.DATABASE_URL;process.env.JWT_SECRET=env.JWT_SECRET;resetEnvCache();db=new PGlite();await migrateUp(new PgliteClient(db),{isProduction:false});app=buildApp(env,{pool:db,serveFrontend:false});admin=await token('admin');customer=await token('customer');});
 afterEach(async()=>{await app.close();await db.close();});
 async function token(role:'admin'|'customer'){const id=randomUUID();await db.query(`INSERT INTO users(id,email,password_hash,full_name,role) VALUES($1,$2,'unused',$3,$4)`,[id,`${role}-${id}@example.test`,role,role]);return signAuthToken(env,{sub:id,email:`${role}@example.test`,role});}
 const auth=(token:string)=>({authorization:`Bearer ${token}`});
 const valid=()=>({...defaultGoogleAdsConfiguration,websiteDomain:'cloudhost247.com',customerId:'1234567890',conversionId:'12345678901',actions:{...defaultGoogleAdsConfiguration.actions,purchase:{label:'AbC_123-x',primary:true},lead:{label:'L3ad_09',primary:false}}});
 it('restricts changes and diagnostics to admins',async()=>{expect((await app.inject({method:'GET',url:BASE})).statusCode).toBe(401);expect((await app.inject({method:'PUT',url:BASE,headers:auth(customer),payload:{expectedRevision:1,configuration:valid()}})).statusCode).toBe(403);expect((await app.inject({method:'GET',url:BASE,headers:auth(admin)})).json().configuration.enabled).toBe(false);});
 it('validates IDs, labels, domains, action classification and consent-gated feature flags',async()=>{const bad=[{...valid(),enabled:true,customerId:'1234'},{...valid(),enabled:true,conversionId:'bad'},{...valid(),websiteDomain:'https://cloudhost247.com'},{...valid(),actions:{...valid().actions,purchase:{label:'<script>',primary:true}}},{...valid(),enhancedConversionsEnabled:true}];for(const configuration of bad)expect((await app.inject({method:'PUT',url:BASE,headers:auth(admin),payload:{expectedRevision:1,configuration}})).statusCode).toBe(400);});
 it('persists a valid destination, diagnoses locally without sending a conversion, and audits changes',async()=>{const configuration={...valid(),enabled:true,remarketingEnabled:true};const saved=await app.inject({method:'PUT',url:BASE,headers:auth(admin),payload:{expectedRevision:1,configuration}});expect(saved.statusCode, saved.body).toBe(200);expect(saved.json().configuration).toMatchObject({enabled:true,customerId:'1234567890',conversionId:'12345678901',actions:{purchase:{label:'AbC_123-x',primary:true}}});expect(saved.body).not.toContain('token');expect((await app.inject({method:'PUT',url:BASE,headers:auth(admin),payload:{expectedRevision:1,configuration}})).statusCode).toBe(409);const test=await app.inject({method:'POST',url:`${BASE}/test`,headers:auth(admin)});expect(test.json()).toMatchObject({status:'CONFIGURATION_VALID',providerContacted:false,conversionSent:false});const audit=await app.inject({method:'GET',url:`${BASE}/audit`,headers:auth(admin)});expect(audit.json().entries.map((e:{action:string})=>e.action)).toEqual(expect.arrayContaining(['marketing.google_ads.configuration_saved','marketing.google_ads.configuration_tested']));});
 it('keeps Ads runtime disabled until host matches and only exposes valid public config',async()=>{const config={...valid(),enabled:true};await app.inject({method:'PUT',url:BASE,headers:auth(admin),payload:{expectedRevision:1,configuration:config}});const bootstrap=await app.inject({method:'GET',url:'/api/v1/marketing/bootstrap',headers:{host:'elsewhere.example'}});expect(bootstrap.json().googleAds).toMatchObject({enabled:false,destination:null,diagnostic:'domain_mismatch'});});
});
