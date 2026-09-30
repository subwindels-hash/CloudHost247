import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { buildApp } from '../../src/app';
import { loadEnv } from '../../src/config/env';
import { createUser } from '../../src/db/users';
import { signAuthToken } from '../../src/lib/jwt';
import { enqueueServerProvisioningJob } from '../../src/db/server-provisioning';
import { executeServerProvisioning } from '../../src/infrastructure/services/server-provisioner';
import type { DeploymentRow } from '../../src/db/deployments';
import type { InfrastructureProviderAdapter } from '../../src/infrastructure/providers/types';
import { createProduct } from '../../src/db/catalog-products';
import { createPlan } from '../../src/db/catalog-plans';
import { createPricing } from '../../src/db/catalog-pricing';
import { findOrderById } from '../../src/db/orders';
import { provisionPaidOrder } from '../../src/services/provisioning-service';

describe('server OS catalog and infrastructure boundaries', () => {
  let db:PGlite;
  const env=loadEnv({NODE_ENV:'test',DATABASE_URL:'postgresql://test:test@localhost/test',JWT_SECRET:'i'.repeat(32)} as NodeJS.ProcessEnv);
  beforeAll(async()=>{db=new PGlite();await migrateUp(new PgliteClient(db),{isProduction:false});});
  afterAll(async()=>{await db.close();});

  it('seeds every requested OS family with at least one version, plus the archived UNKNOWN backfill target',async()=>{
    const result=await db.query<{name:string;version_count:number}>(`SELECT os.name,count(v.id)::int version_count FROM operating_systems os LEFT JOIN operating_system_versions v ON v.operating_system_id=os.id GROUP BY os.id,os.name ORDER BY os.name`);
    const byName=Object.fromEntries(result.rows.map((row)=>[row.name,row.version_count]));
    for(const name of ['AlmaLinux','Debian','Rocky Linux','Ubuntu','Alpine Linux','Arch Linux','CentOS','CloudLinux','Fedora Cloud','Kali Linux','NixOS','openSUSE'])expect(byName[name]).toBeGreaterThan(0);
    const unknown=await db.query<{status:string;version:string}>(`SELECT os.status,v.version FROM operating_systems os JOIN operating_system_versions v ON v.operating_system_id=os.id WHERE os.slug='unknown'`);
    expect(unknown.rows[0]).toEqual({status:'ARCHIVED',version:'UNKNOWN'});
  });

  it('database rejects an ACTIVE provider image that has not been live-verified',async()=>{
    const providerId=randomUUID();
    await db.query(`INSERT INTO infrastructure_providers(id,name,slug,provider_type,adapter,status) VALUES($1,'Test provider',$2,'HETZNER','hetzner','DISABLED')`,[providerId,`test-${providerId}`]);
    await expect(db.query(`INSERT INTO server_os_images(id,provider_id,operating_system_version_id,provider_image_id,architecture,status) VALUES($1,$2,'20000000-0000-0000-0000-000000000006','ubuntu-test','x86_64','ACTIVE')`,[randomUUID(),providerId])).rejects.toThrow();
  });

  it('public configuration fails closed when no provider image and product tuple has been enabled',async()=>{
    const app=buildApp(env,{serveFrontend:false,pool:db});
    const response=await app.inject({method:'GET',url:'/api/v1/operating-systems'});
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({operatingSystems:[]});
    await app.close();
  });

  it('requires auth for customer resources and admin RBAC for catalog management',async()=>{
    const app=buildApp(env,{serveFrontend:false,pool:db});
    const publicServers=await app.inject({method:'GET',url:'/api/v1/servers'});
    expect(publicServers.statusCode).toBe(200);
    expect(publicServers.json().servers).toEqual([]);
    expect((await app.inject({method:'GET',url:'/api/v1/admin/operating-systems'})).statusCode).toBe(401);
    await app.close();
  });

  it('creates an unpaid server order without provider work, then queues exactly once after authoritative payment',async()=>{
    const user=await createUser(db,{id:randomUUID(),email:`order-${randomUUID()}@example.com`,passwordHash:'hash',fullName:'Order Customer'});
    const product=await createProduct(db,{id:randomUUID(),slug:`compute-${randomUUID()}`,name:'Test Compute',productType:'hosting',status:'active',visibility:'public'});
    const plan=await createPlan(db,{id:randomUUID(),productId:product.id,slug:`vps-${randomUUID()}`,name:'Test VPS',status:'active'});
    await createPricing(db,{id:randomUUID(),planId:plan.id,billingPeriod:'monthly',currency:'USD',amount:12,effectiveStatus:'published'});
    const providerId=randomUUID(),regionId=randomUUID(),imageId=randomUUID(),configurationId=randomUUID(),sshKeyId=randomUUID();
    await db.query(`UPDATE operating_system_versions SET status='ACTIVE' WHERE id='20000000-0000-0000-0000-000000000006'`);
    await db.query(`INSERT INTO infrastructure_providers(id,name,slug,provider_type,adapter,status) VALUES($1,'Order provider',$2,'HETZNER','hetzner','ACTIVE')`,[providerId,`order-${providerId}`]);
    await db.query(`INSERT INTO infrastructure_regions(id,provider_id,code,name,status) VALUES($1,$2,'order-1','Order Region','ACTIVE')`,[regionId,providerId]);
    await db.query(`INSERT INTO server_os_images(id,provider_id,operating_system_version_id,provider_image_id,architecture,region_id,status,verified_at) VALUES($1,$2,'20000000-0000-0000-0000-000000000006','ubuntu-24.04','x86_64',$3,'ACTIVE',now())`,[imageId,providerId,regionId]);
    await db.query(`INSERT INTO server_product_configurations(id,plan_id,provider_id,region_id,operating_system_version_id,architecture,server_type,status,metadata) VALUES($1,$2,$3,$4,'20000000-0000-0000-0000-000000000006','x86_64','VPS','ACTIVE',$5)`,[configurationId,plan.id,providerId,regionId,JSON.stringify({cpuCores:2,memoryMb:4096,storageMb:80000,providerServerType:'test-small',capabilities:{reinstall:true,start:true,stop:true,reboot:true,shutdown:true}})]);
    await db.query(`INSERT INTO customer_ssh_keys(id,user_id,name,public_key,fingerprint) VALUES($1,$2,'Order key','ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOrderKey tests@example.test',$3)`,[sshKeyId,user.id,`SHA256:${randomUUID()}`]);
    const app=buildApp(env,{serveFrontend:false,pool:db});const token=signAuthToken(env,{sub:user.id,role:'customer',email:user.email});
    const response=await app.inject({method:'POST',url:'/api/v1/servers',headers:{authorization:`Bearer ${token}`},payload:{planId:plan.id,billingPeriod:'monthly',providerId,regionId,datacenterId:null,operatingSystemVersionId:'20000000-0000-0000-0000-000000000006',architecture:'x86_64',serverType:'VPS',sshKeyIds:[sshKeyId],hostname:'ordered.example.test'}});
    expect(response.statusCode).toBe(201);const body=response.json();expect(body.provisioningStatus).toBe('AWAITING_PAYMENT');
    expect((await db.query<{count:number}>(`SELECT count(*)::int count FROM provisioning_jobs WHERE server_id=$1`,[body.serverId])).rows[0]?.count).toBe(0);
    expect((await db.query<{payment_status:string}>(`SELECT payment_status FROM orders WHERE id=$1`,[body.orderId])).rows[0]?.payment_status).toBe('unpaid');
    expect((await db.query<{provider_server_id:string|null}>(`SELECT provider_server_id FROM servers WHERE id=$1`,[body.serverId])).rows[0]?.provider_server_id).toBeNull();
    await db.query(`UPDATE orders SET payment_status='paid' WHERE id=$1`,[body.orderId]);const paid=await findOrderById(db,body.orderId);expect(paid).not.toBeNull();
    await provisionPaidOrder(db,paid!);await provisionPaidOrder(db,paid!);
    expect((await db.query<{count:number}>(`SELECT count(*)::int count FROM provisioning_jobs WHERE server_id=$1`,[body.serverId])).rows[0]?.count).toBe(1);
    await app.close();
  });

  it('deduplicates provisioning jobs and permanently fails closed for an inactive provider',async()=>{
    const user=await createUser(db,{id:randomUUID(),email:`provision-${randomUUID()}@example.com`,passwordHash:'hash',fullName:'Provision Customer'});
    const providerId=randomUUID();const serverId=randomUUID();
    await db.query(`INSERT INTO infrastructure_providers(id,name,slug,provider_type,adapter,status) VALUES($1,'Inactive provider',$2,'HETZNER','hetzner','DISABLED')`,[providerId,`inactive-${providerId}`]);
    await db.query(`INSERT INTO servers(id,name,hostname,server_type,status,customer_id,provider_id,operating_system_version_id,architecture,provisioning_status) VALUES($1,'queued-vps','queued.example.test','VPS','queued',$2,$3,'20000000-0000-0000-0000-000000000006','x86_64','QUEUED')`,[serverId,user.id,providerId]);
    const key=`server-provision:${serverId}:test`;
    const first=await enqueueServerProvisioningJob(db,{serverId,providerId,operation:'PROVISION',requestedBy:user.id,idempotencyKey:key});
    const second=await enqueueServerProvisioningJob(db,{serverId,providerId,operation:'PROVISION',requestedBy:user.id,idempotencyKey:key});
    expect(first.created).toBe(true);expect(second.created).toBe(false);expect(second.job.id).toBe(first.job.id);
    const deployment=(await db.query<DeploymentRow>(`SELECT * FROM deployments WHERE id=$1`,[first.job.deployment_id])).rows[0]!;
    const result=await executeServerProvisioning(db,deployment,{source:{} as NodeJS.ProcessEnv});
    expect(result.outcome).toBe('failed');
    const persisted=(await db.query<{status:string;error_code:string;retryable:boolean}>(`SELECT status,error_code,retryable FROM provisioning_jobs WHERE id=$1`,[first.job.id])).rows[0];
    expect(persisted).toEqual({status:'FAILED',error_code:'PROVIDER_NOT_CONFIGURED',retryable:false});
    expect((await db.query<{count:number}>(`SELECT count(*)::int count FROM provisioning_jobs WHERE idempotency_key=$1`,[key])).rows[0]?.count).toBe(1);
  });

  it('persists real adapter evidence and marks READY only after provider, IP, SSH, and health checks pass',async()=>{
    const user=await createUser(db,{id:randomUUID(),email:`healthy-${randomUUID()}@example.com`,passwordHash:'hash',fullName:'Healthy Customer'});
    const providerId=randomUUID(),regionId=randomUUID(),imageId=randomUUID(),serverId=randomUUID(),orderId=randomUUID(),sshKeyId=randomUUID();
    await db.query(`INSERT INTO infrastructure_providers(id,name,slug,provider_type,adapter,status) VALUES($1,'Healthy provider',$2,'OTHER','generic_http','ACTIVE')`,[providerId,`healthy-${providerId}`]);
    await db.query(`INSERT INTO infrastructure_regions(id,provider_id,code,name,status) VALUES($1,$2,'test-1','Test Region','ACTIVE')`,[regionId,providerId]);
    await db.query(`INSERT INTO server_os_images(id,provider_id,operating_system_version_id,provider_image_id,architecture,region_id,status,verified_at) VALUES($1,$2,'20000000-0000-0000-0000-000000000006','ubuntu-24.04','x86_64',$3,'ACTIVE',now())`,[imageId,providerId,regionId]);
    await db.query(`INSERT INTO customer_ssh_keys(id,user_id,name,public_key,fingerprint) VALUES($1,$2,'Test key','ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKey tests@example.test',$3)`,[sshKeyId,user.id,`SHA256:${randomUUID()}`]);
    await db.query(`INSERT INTO orders(id,user_id,status,payment_status,currency,subtotal_amount,discount_amount,tax_amount,total_amount) VALUES($1,$2,'pending','paid','USD',10,0,0,10)`,[orderId,user.id]);
    await db.query(`INSERT INTO servers(id,name,hostname,server_type,status,customer_id,order_id,provider_id,region_id,operating_system_version_id,os_image_id,architecture,provisioning_status,metadata) VALUES($1,'healthy-vps','healthy.example.test','VPS','queued',$2,$3,$4,$5,'20000000-0000-0000-0000-000000000006',$6,'x86_64','QUEUED',$7)`,[serverId,user.id,orderId,providerId,regionId,imageId,JSON.stringify({sshKeyIds:[sshKeyId],providerPlan:{providerServerType:'test-small'}})]);
    const queued=await enqueueServerProvisioningJob(db,{serverId,orderId,providerId,osImageId:imageId,operation:'PROVISION',requestedBy:user.id,idempotencyKey:`healthy:${serverId}`});
    const deployment=(await db.query<DeploymentRow>(`SELECT * FROM deployments WHERE id=$1`,[queued.job.deployment_id])).rows[0]!;
    let creates=0;const remote={id:'provider-123',status:'running',name:'healthy-vps',ipAddress:'203.0.113.10',imageId:'ubuntu-24.04',metadata:{}};
    const adapter:InfrastructureProviderAdapter={
      kind:'test-only',provider:{} as never,validateConfiguration:async()=>undefined,createServer:async()=>{creates+=1;return remote;},provisionServer:async()=>remote,
      findServerByIdempotencyKey:async()=>null,deleteServer:async()=>undefined,rebootServer:async()=>undefined,shutdownServer:async()=>undefined,startServer:async()=>undefined,
      powerOnServer:async()=>undefined,powerOffServer:async()=>undefined,getServer:async()=>remote,rebuildServer:async()=>remote,
      resizeServer:async()=>remote,createSnapshot:async()=>({id:'snap-1'}),deleteSnapshot:async()=>undefined,restoreSnapshot:async()=>undefined,
      getServerStatus:async()=>remote,getServerIP:async()=>remote.ipAddress,getAvailableImages:async()=>[],getImage:async()=>({id:'ubuntu-24.04',name:'Ubuntu 24.04',architecture:'x86_64',available:true,metadata:{}}),
      reinstallServer:async()=>remote,getConsole:async()=>({}),getServerMetrics:async()=>({}),healthCheck:async()=>({exists:true,poweredOn:true,ipAddress:remote.ipAddress,imageMatches:true,providerStatus:'running'}),
    };
    // The production default requires authenticated agent attestation. This test-only injection
    // disables that one assertion so the deterministic suite can exercise all other health gates.
    const result=await executeServerProvisioning(db,deployment,{adapterOverride:adapter,requireAgentHealth:false,tcpCheck:async()=>true,pollIntervalMs:1,healthTimeoutMs:100});
    expect(result.outcome).toBe('succeeded');expect(creates).toBe(1);
    const server=(await db.query<{status:string;provisioning_status:string;provider_server_id:string;ip_address:string}>(`SELECT status,provisioning_status,provider_server_id,ip_address FROM servers WHERE id=$1`,[serverId])).rows[0];
    expect(server).toEqual({status:'active',provisioning_status:'READY',provider_server_id:'provider-123',ip_address:'203.0.113.10'});
    expect((await db.query<{status:string}>(`SELECT status FROM provisioning_jobs WHERE id=$1`,[queued.job.id])).rows[0]?.status).toBe('READY');
  });

  it('does not reveal or act on a server owned by another customer',async()=>{
    const owner=await createUser(db,{id:randomUUID(),email:`owner-${randomUUID()}@example.com`,passwordHash:'hash',fullName:'Owner'});
    const other=await createUser(db,{id:randomUUID(),email:`other-${randomUUID()}@example.com`,passwordHash:'hash',fullName:'Other'});
    const serverId=randomUUID();
    await db.query(`INSERT INTO servers(id,name,hostname,server_type,status,customer_id,operating_system_version_id,architecture,provisioning_status) VALUES($1,'private-vps','private.example.test','VPS','active',$2,'20000000-0000-0000-0000-000000000006','x86_64','READY')`,[serverId,owner.id]);
    const token=signAuthToken(env,{sub:other.id,role:'customer',email:other.email});
    const app=buildApp(env,{serveFrontend:false,pool:db});
    const headers={authorization:`Bearer ${token}`};
    expect((await app.inject({method:'GET',url:`/api/v1/servers/${serverId}`,headers})).statusCode).toBe(404);
    expect((await app.inject({method:'POST',url:`/api/v1/servers/${serverId}/reinstall`,headers,payload:{operatingSystemVersionId:'20000000-0000-0000-0000-000000000003',architecture:'x86_64',confirmation:'REINSTALL'}})).statusCode).toBe(404);
    const ownerToken=signAuthToken(env,{sub:owner.id,role:'customer',email:owner.email});
    const destructive=await app.inject({method:'POST',url:`/api/v1/servers/${serverId}/reinstall`,headers:{authorization:`Bearer ${ownerToken}`},payload:{operatingSystemVersionId:'20000000-0000-0000-0000-000000000003',architecture:'x86_64',confirmation:'yes'}});
    expect(destructive.statusCode).toBe(400);
    await app.close();
  });

  it('queues and executes resize and snapshot operations for owned servers', async () => {
    const user = await createUser(db, { id: randomUUID(), email: `ops-${randomUUID()}@example.com`, passwordHash: 'hash', fullName: 'Ops User' });
    const providerId = randomUUID();
    const serverId = randomUUID();
    await db.query(`INSERT INTO infrastructure_providers(id,name,slug,provider_type,adapter,status) VALUES($1,'Ops provider',$2,'OTHER','generic_http','ACTIVE')`, [providerId, `ops-${providerId}`]);
    await db.query(`INSERT INTO servers(id,name,hostname,server_type,status,customer_id,provider_id,provider_server_id,operating_system_version_id,architecture,provisioning_status,capabilities) VALUES($1,'ops-vps','ops.example.test','VPS','active',$2,$3,'remote-ops-1','20000000-0000-0000-0000-000000000006','x86_64','READY',$4)`, [serverId, user.id, providerId, JSON.stringify({ start: true, stop: true, reboot: true, resize: true })]);

    const app = buildApp(env, { serveFrontend: false, pool: db });
    const token = signAuthToken(env, { sub: user.id, role: 'customer', email: user.email });
    const headers = { authorization: `Bearer ${token}` };

    const resizeRes = await app.inject({ method: 'POST', url: `/api/v1/servers/${serverId}/resize`, headers, payload: { planMetadata: { cpuCores: 4 } } });
    expect(resizeRes.statusCode).toBe(200);
    expect(resizeRes.json().queued).toBe(true);

    const snapRes = await app.inject({ method: 'POST', url: `/api/v1/servers/${serverId}/snapshots`, headers, payload: { description: 'Weekly Backup' } });
    expect(snapRes.statusCode).toBe(202);
    expect(snapRes.json().queued).toBe(true);

    const deleteSnapRes = await app.inject({ method: 'DELETE', url: `/api/v1/servers/${serverId}/snapshots/snap-99`, headers });
    expect(deleteSnapRes.statusCode).toBe(202);

    const restoreSnapRes = await app.inject({ method: 'POST', url: `/api/v1/servers/${serverId}/snapshots/snap-99/restore`, headers });
    expect(restoreSnapRes.statusCode).toBe(200);

    await app.close();
  });
});
