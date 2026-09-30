import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { buildApp } from '../../src/app';
import { loadEnv } from '../../src/config/env';

describe('public operating-system availability boundaries',()=>{
  let db:PGlite;
  const env=loadEnv({NODE_ENV:'test',DATABASE_URL:'postgresql://test:test@localhost/test',JWT_SECRET:'a'.repeat(32)} as NodeJS.ProcessEnv);
  beforeAll(async()=>{db=new PGlite();await migrateUp(new PgliteClient(db),{isProduction:false});});
  afterAll(async()=>{await db.close();});

  it('publishes only public active products with coherent active datacenter scopes',async()=>{
    const productId=randomUUID(),planId=randomUUID(),providerId=randomUUID(),regionId=randomUUID();
    const otherProviderId=randomUUID(),foreignRegionId=randomUUID();
    const otherRegionId=randomUUID(),datacenterId=randomUUID(),imageId=randomUUID(),configurationId=randomUUID();
    await db.query(`UPDATE operating_system_versions SET status='ACTIVE' WHERE id='20000000-0000-0000-0000-000000000006'`);
    await db.query(`INSERT INTO products(id,slug,name,product_type,status,visibility) VALUES($1,$2,'Availability product','hosting','active','public')`,[productId,`availability-${productId}`]);
    await db.query(`INSERT INTO product_plans(id,product_id,slug,name,status) VALUES($1,$2,$3,'Availability plan','active')`,[planId,productId,`availability-${planId}`]);
    await db.query(`INSERT INTO infrastructure_providers(id,name,slug,provider_type,adapter,status) VALUES($1,'Availability provider',$2,'OTHER','generic_http','ACTIVE'),($3,'Foreign provider',$4,'OTHER','generic_http','ACTIVE')`,[providerId,`availability-${providerId}`,otherProviderId,`foreign-${otherProviderId}`]);
    await db.query(`INSERT INTO infrastructure_regions(id,provider_id,code,name,status) VALUES($1,$3,'primary','Primary','ACTIVE'),($2,$3,'other','Other','ACTIVE'),($4,$5,'foreign','Foreign','ACTIVE')`,[regionId,otherRegionId,providerId,foreignRegionId,otherProviderId]);
    await db.query(`INSERT INTO infrastructure_datacenters(id,region_id,code,name,status) VALUES($1,$2,'dc-1','Datacenter 1','ACTIVE')`,[datacenterId,regionId]);
    await db.query(`INSERT INTO server_os_images(id,provider_id,operating_system_version_id,provider_image_id,architecture,status,verified_at) VALUES($1,$2,'20000000-0000-0000-0000-000000000006','ubuntu-24.04','x86_64','ACTIVE',now())`,[imageId,providerId]);
    await db.query(`INSERT INTO server_product_configurations(id,plan_id,provider_id,region_id,datacenter_id,operating_system_version_id,architecture,server_type,status,metadata) VALUES($1,$2,$3,$4,$5,'20000000-0000-0000-0000-000000000006','x86_64','VPS','ACTIVE',$6)`,[configurationId,planId,providerId,regionId,datacenterId,JSON.stringify({cpuCores:2,memoryMb:2048,storageMb:20000})]);

    const app=buildApp(env,{serveFrontend:false,pool:db});
    expect((await app.inject({method:'GET',url:'/api/v1/operating-systems'})).json().operatingSystems).toHaveLength(1);
    expect((await app.inject({method:'GET',url:`/api/v1/server-products/${planId}/configuration`})).json().operatingSystems).toHaveLength(1);

    await db.query(`UPDATE infrastructure_datacenters SET status='DISABLED' WHERE id=$1`,[datacenterId]);
    expect((await app.inject({method:'GET',url:'/api/v1/operating-systems'})).json().operatingSystems).toEqual([]);
    expect((await app.inject({method:'GET',url:`/api/v1/server-products/${planId}/configuration`})).json().operatingSystems).toEqual([]);

    await db.query(`UPDATE infrastructure_datacenters SET status='ACTIVE' WHERE id=$1`,[datacenterId]);
    await db.query(`UPDATE infrastructure_regions SET status='DISABLED' WHERE id=$1`,[regionId]);
    expect((await app.inject({method:'GET',url:'/api/v1/operating-systems'})).json().operatingSystems).toEqual([]);
    expect((await app.inject({method:'GET',url:`/api/v1/operating-systems/10000000-0000-0000-0000-000000000001/versions`})).json().versions).toEqual([]);
    expect((await app.inject({method:'GET',url:`/api/v1/server-products/${planId}/configuration`})).json().operatingSystems).toEqual([]);

    // Even malformed legacy rows remain private: datacenters must belong to the configured region,
    // and regions must belong to the configured provider.
    await db.query(`UPDATE infrastructure_regions SET status='ACTIVE' WHERE id=$1`,[regionId]);
    await db.query(`UPDATE server_product_configurations SET region_id=$2 WHERE id=$1`,[configurationId,otherRegionId]);
    expect((await app.inject({method:'GET',url:'/api/v1/operating-systems'})).json().operatingSystems).toEqual([]);
    await db.query(`UPDATE server_product_configurations SET region_id=$2,datacenter_id=NULL WHERE id=$1`,[configurationId,foreignRegionId]);
    expect((await app.inject({method:'GET',url:'/api/v1/operating-systems'})).json().operatingSystems).toEqual([]);
    expect((await app.inject({method:'GET',url:`/api/v1/server-products/${planId}/configuration`})).json().operatingSystems).toEqual([]);

    await db.query(`UPDATE server_product_configurations SET region_id=$2,datacenter_id=$3 WHERE id=$1`,[configurationId,regionId,datacenterId]);
    await db.query(`UPDATE products SET visibility='private' WHERE id=$1`,[productId]);
    expect((await app.inject({method:'GET',url:'/api/v1/operating-systems'})).json().operatingSystems).toEqual([]);
    expect((await app.inject({method:'GET',url:`/api/v1/server-products/${planId}/configuration`})).statusCode).toBe(404);
    await app.close();
  });
});
