import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { authenticate } from '../lib/require-auth';
import { requireRole } from '../lib/require-role';
import { auditRequest } from '../lib/audit';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors';
import {
  createOperatingSystem,
  createOperatingSystemVersion,
  createProductConfiguration,
  deleteOperatingSystemIfSafe,
  findOperatingSystem,
  findOperatingSystemVersion,
  listAvailableConfigurations,
  listOperatingSystems,
  listOperatingSystemVersions,
  listProductConfigurations,
  setProductConfigurationStatus,
  updateOperatingSystem,
  updateOperatingSystemVersion,
  type AvailableConfigurationRow,
} from '../db/operating-systems';
import {
  createDatacenter,
  createOsImage,
  createProvider,
  createRegion,
  deleteOsImage,
  findDatacenterById,
  findOsImageById,
  findProviderById,
  findRegionById,
  listDatacenters,
  listOsImages,
  listProviders,
  listRegions,
  updateDatacenter,
  updateOsImage,
  updateProvider,
  updateRegion,
} from '../db/infrastructure-providers';
import { findPlanById, listActivePlansForProduct } from '../db/catalog-plans';
import { listPublishedPricingForPlan } from '../db/catalog-pricing';
import { listAllProducts } from '../db/catalog-products';
import { createInfrastructureProviderAdapter } from '../infrastructure/providers/registry';
import { ProviderError } from '../infrastructure/providers/types';
import {
  cancelProvisioningJob,
  findProvisioningJobById,
  listProvisioningJobs,
  retryProvisioningJob,
} from '../db/server-provisioning';
import { listDeploymentEvents, listDeploymentSteps } from '../db/deployments';
import { listNotifications } from '../services/notification-service';

const id = z.string().uuid();
const slug = z.string().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const architecture = z.enum(['x86_64','arm64']);
const serverType = z.enum(['VPS','DEDICATED','CLOUD']);
const osStatus = z.enum(['ACTIVE','DISABLED','ARCHIVED']);
const versionStatus = z.enum(['ACTIVE','MAINTENANCE','EOL_WARNING','EOL','ARCHIVED','DISABLED']);
const providerStatus = z.enum(['ACTIVE','DISABLED','CONFIGURATION_REQUIRED','UNAVAILABLE']);
const imageStatus = z.enum(['DRAFT','VALIDATING','ACTIVE','DISABLED','INVALID']);

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError(result.error.issues.map((issue) => issue.message).join(', '));
  return result.data;
}

async function listCompatibleControlPanels(db: Queryable,planId: string,rows: AvailableConfigurationRow[]) {
  const versionIds = [...new Set(rows.map((row) => row.version_id))];
  if (versionIds.length === 0) return [];
  const result = await db.query<{ id: string; name: string; slug: string; operating_system_version_id: string; architecture: string }>(
    `SELECT DISTINCT cp.id,cp.name,cp.slug,c.operating_system_version_id,c.architecture
     FROM control_panels cp JOIN control_panel_compatibility c ON c.control_panel_id=cp.id
     WHERE cp.status='ACTIVE' AND c.status='ACTIVE' AND c.operating_system_version_id=ANY($1::uuid[])
       AND (c.plan_id IS NULL OR c.plan_id=$2)
     ORDER BY cp.name`,[versionIds,planId]
  );
  const panels = new Map<string,{ id: string;name: string;slug: string;availability: Array<{ operatingSystemVersionId: string;architecture: string }> }>();
  for (const row of result.rows) {
    const panel=panels.get(row.id)??{id:row.id,name:row.name,slug:row.slug,availability:[]};
    panel.availability.push({operatingSystemVersionId:row.operating_system_version_id,architecture:row.architecture});
    panels.set(row.id,panel);
  }
  return [...panels.values()];
}

function groupConfiguration(rows: AvailableConfigurationRow[]) {
  const regions = new Map<string,{ id: string; code: string; name: string; provider: { id: string; name: string }; regionWideAvailable: boolean; datacenters: Array<{ id: string; code: string; name: string }> }>();
  const systems = new Map<string,{ id: string; name: string; slug: string; vendor: string | null; description: string | null; logoUrl: string | null; versions: Map<string,{ id: string; version: string; displayName: string; releaseName: string | null; status: string; lts: boolean; recommended: boolean; default: boolean; architectures: Set<string>; availability: Array<{ configurationId: string; providerId: string; regionId: string; datacenterId: string | null; architecture: string }> }> }>();
  for (const row of rows) {
    const regionKey = `${row.provider_id}:${row.region_id}`;
    let region = regions.get(regionKey);
    if (!region) {
      region = { id: row.region_id,code: row.region_code,name: row.region_name,provider: { id: row.provider_id,name: row.provider_name },regionWideAvailable: false,datacenters: [] };
      regions.set(regionKey,region);
    }
    if (!row.datacenter_id) region.regionWideAvailable = true;
    if (row.datacenter_id && !region.datacenters.some((item) => item.id === row.datacenter_id)) {
      region.datacenters.push({ id: row.datacenter_id,code: row.datacenter_code ?? '',name: row.datacenter_name ?? row.datacenter_code ?? '' });
    }
    let os = systems.get(row.operating_system_id);
    if (!os) {
      os = { id: row.operating_system_id,name: row.os_name,slug: row.os_slug,vendor: row.os_vendor,description: row.os_description,logoUrl: row.logo_url,versions: new Map() };
      systems.set(row.operating_system_id,os);
    }
    let version = os.versions.get(row.version_id);
    if (!version) {
      version = { id: row.version_id,version: row.version,displayName: row.display_name,releaseName: row.release_name,status: row.version_status,lts: row.is_lts,recommended: row.is_recommended,default: row.is_default,architectures: new Set(),availability: [] };
      os.versions.set(row.version_id,version);
    }
    version.architectures.add(row.architecture);
    version.availability.push({ configurationId: row.configuration_id,providerId: row.provider_id,regionId: row.region_id,datacenterId: row.datacenter_id,architecture: row.architecture });
  }
  return {
    regions: [...regions.values()],
    operatingSystems: [...systems.values()].map((os) => ({ ...os,versions: [...os.versions.values()].map((version) => ({ ...version,architectures: [...version.architectures] })) })),
  };
}

const createOsSchema = z.object({
  name: z.string().min(1).max(160),slug,osReleaseIds:z.array(z.string().min(1).max(64).regex(/^[a-z0-9._-]+$/)).max(8).optional(),vendor: z.string().max(160).nullable().optional(),
  description: z.string().max(4000).nullable().optional(),logoUrl: z.string().max(1000).nullable().optional(),
  status: osStatus.optional(),sortOrder: z.number().int().optional(),isVpsSupported: z.boolean().optional(),
  isDedicatedSupported: z.boolean().optional(),isCloudSupported: z.boolean().optional(),isReinstallSupported: z.boolean().optional(),
});
const patchOsSchema = createOsSchema.omit({ slug: true }).partial();
const versionSchema = z.object({
  version: z.string().min(1).max(64),displayName: z.string().min(1).max(200),releaseName: z.string().max(160).nullable().optional(),
  architectureSupport: z.array(architecture).min(1).max(2),status: versionStatus.optional(),isDefault: z.boolean().optional(),
  isRecommended: z.boolean().optional(),isLts: z.boolean().optional(),releaseDate: z.string().date().nullable().optional(),endOfLifeDate: z.string().date().nullable().optional(),
});
const patchVersionSchema = versionSchema.omit({ version: true }).partial();
const providerSchema = z.object({
  name: z.string().min(1).max(160),slug,
  providerType: z.enum(['OVH','HETZNER','AWS','DIGITALOCEAN','VULTR','CONTABO','PROXMOX','VIRTUALIZOR','SOLUSVM','OPENSTACK','GENERIC_HTTP','OTHER']),
  adapter: z.enum(['hetzner','ovh','aws','digitalocean','vultr','contabo','proxmox','virtualizor','solusvm','openstack','generic_http']),
  status: providerStatus.optional(),apiBaseUrl: z.string().url().nullable().optional(),credentialEnvPrefix: z.string().max(64).regex(/^[A-Z][A-Z0-9_]*$/).nullable().optional(),
  capabilities: z.record(z.unknown()).optional(),metadata: z.record(z.unknown()).optional(),
});
const patchProviderSchema = providerSchema.omit({ slug: true,providerType: true,adapter: true }).partial();
const regionSchema = z.object({ providerId: id,code: z.string().min(1).max(96),name: z.string().min(1).max(160),countryCode: z.string().length(2).nullable().optional(),status: z.enum(['ACTIVE','DISABLED','ARCHIVED']).optional(),metadata: z.record(z.unknown()).optional() });
const datacenterSchema = z.object({ regionId: id,code: z.string().min(1).max(96),name: z.string().min(1).max(160),status: z.enum(['ACTIVE','DISABLED','ARCHIVED']).optional(),metadata: z.record(z.unknown()).optional() });
const imageSchema = z.object({
  providerId: id,operatingSystemVersionId: id,providerImageId: z.string().max(512).nullable().optional(),providerTemplateId: z.string().max(512).nullable().optional(),
  architecture,regionId: id.nullable().optional(),datacenterId: id.nullable().optional(),metadata: z.record(z.unknown()).optional(),
}).refine((value) => !!value.providerImageId || !!value.providerTemplateId,{ message: 'providerImageId or providerTemplateId is required' });
const patchImageSchema = z.object({
  providerImageId: z.string().max(512).nullable().optional(),providerTemplateId: z.string().max(512).nullable().optional(),architecture: architecture.optional(),
  regionId: id.nullable().optional(),datacenterId: id.nullable().optional(),status: imageStatus.optional(),metadata: z.record(z.unknown()).optional(),
});

async function validateProductConfigurationReferences(
  db: Queryable,
  input: { planId:string;providerId:string;regionId:string;datacenterId?:string|null;operatingSystemVersionId:string;architecture:'x86_64'|'arm64';serverType:'VPS'|'DEDICATED'|'CLOUD';metadata?:Record<string,unknown> }
) {
  const [plan,provider,region,datacenter,version]=await Promise.all([
    findPlanById(db,input.planId),findProviderById(db,input.providerId),findRegionById(db,input.regionId),
    input.datacenterId?findDatacenterById(db,input.datacenterId):null,
    findOperatingSystemVersion(db,input.operatingSystemVersionId),
  ]);
  if(!plan)throw new ValidationError('Product plan does not exist');
  if(!provider)throw new ValidationError('Provider does not exist');
  if(!region||region.provider_id!==provider.id)throw new ValidationError('Region does not belong to the selected provider');
  if(input.datacenterId&&(!datacenter||datacenter.region_id!==region.id))throw new ValidationError('Datacenter does not belong to the selected region');
  if(!version||!version.architecture_support.includes(input.architecture))throw new ValidationError('OS version does not support the selected architecture');
  const os=await findOperatingSystem(db,version.operating_system_id);
  const supported=input.serverType==='VPS'?os?.is_vps_supported:input.serverType==='DEDICATED'?os?.is_dedicated_supported:os?.is_cloud_supported;
  if(!supported)throw new ValidationError('Operating system does not support the selected server type');
  if(input.metadata){
    for(const [key,min] of [['cpuCores',1],['memoryMb',256],['storageMb',1024]] as const){
      const value=input.metadata[key];
      if(typeof value!=='number'||!Number.isInteger(value)||value<min)throw new ValidationError(`Configuration metadata requires ${key} >= ${min}`);
    }
  }
}

async function validateImage(db: Queryable,imageId: string,actorId: string) {
  const image = await findOsImageById(db,imageId);
  if (!image) throw new NotFoundError('No OS image mapping was found with that id');
  const [provider,version,region,datacenter] = await Promise.all([
    findProviderById(db,image.provider_id),
    findOperatingSystemVersion(db,image.operating_system_version_id),
    image.region_id ? findRegionById(db,image.region_id) : null,
    image.datacenter_id ? findDatacenterById(db,image.datacenter_id) : null,
  ]);
  if (!provider) throw new ValidationError('Provider does not exist');
  if (provider.status !== 'ACTIVE') throw new ValidationError('Provider must be active before an image can be verified');
  if (!version) throw new ValidationError('Operating-system version does not exist');
  if (!version.architecture_support.includes(image.architecture)) throw new ValidationError('Architecture is not supported by the OS version');
  if (region && region.provider_id !== provider.id) throw new ValidationError('Region does not belong to the selected provider');
  if (datacenter && (!region || datacenter.region_id !== region.id)) throw new ValidationError('Datacenter does not belong to the selected region');
  const adapter = createInfrastructureProviderAdapter(provider);
  try {
    await adapter.validateConfiguration();
    const remote = await adapter.getImage(image);
    if (!remote?.available) throw new ProviderError('IMAGE_UNAVAILABLE','Provider image does not exist or is unavailable',false);
    if (remote.architecture && remote.architecture !== image.architecture) throw new ProviderError('INVALID_CONFIGURATION','Provider image architecture differs from the mapping',false);
    return await updateOsImage(db,image.id,{ status: 'DRAFT',verifiedAt: new Date().toISOString(),verifiedBy: actorId,verificationError: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Image validation failed';
    await updateOsImage(db,image.id,{ status: 'INVALID',verifiedAt: null,verifiedBy: actorId,verificationError: message });
    throw new ValidationError(message);
  }
}

export async function registerInfrastructureRoutes(app: FastifyInstance,env: Env,overridePool?: Queryable) {
  const db = overridePool ?? getPool(env);
  const admin = (request: FastifyRequest) => requireRole(request,env,db,['admin','super_admin']);

  // Public catalog: only combinations backed by an active, verified provider mapping.
  app.get('/api/v1/operating-systems',async () => {
    const rows = await db.query(
      `SELECT DISTINCT os.* FROM operating_systems os
       JOIN operating_system_versions v ON v.operating_system_id=os.id
       JOIN server_os_images img ON img.operating_system_version_id=v.id AND img.status='ACTIVE' AND img.verified_at IS NOT NULL
       JOIN infrastructure_providers p ON p.id=img.provider_id AND p.status='ACTIVE'
       JOIN server_product_configurations c ON c.operating_system_version_id=v.id AND c.provider_id=p.id
         AND c.architecture=img.architecture AND c.status='ACTIVE'
         AND (img.region_id IS NULL OR img.region_id=c.region_id)
         AND (img.datacenter_id IS NULL OR img.datacenter_id=c.datacenter_id)
       WHERE os.status='ACTIVE' AND v.status IN ('ACTIVE','MAINTENANCE','EOL_WARNING')
       ORDER BY os.sort_order,os.name`
    );
    return { operatingSystems: rows.rows };
  });
  app.get<{ Params: { id: string } }>('/api/v1/operating-systems/:id',async (request) => {
    const operatingSystem = await findOperatingSystem(db,request.params.id);
    if (!operatingSystem || operatingSystem.status !== 'ACTIVE') throw new NotFoundError('No operating system was found with that id');
    return { operatingSystem };
  });
  app.get<{ Params: { id: string } }>('/api/v1/operating-systems/:id/versions',async (request) => {
    const operatingSystem = await findOperatingSystem(db,request.params.id);
    if (!operatingSystem || operatingSystem.status !== 'ACTIVE') throw new NotFoundError('No operating system was found with that id');
    const result = await db.query(
      `SELECT DISTINCT v.id,v.version,v.display_name,v.release_name,v.architecture_support,v.status,v.is_default,v.is_recommended,v.is_lts,v.release_date,v.end_of_life_date
       FROM operating_system_versions v
       JOIN server_os_images img ON img.operating_system_version_id=v.id AND img.status='ACTIVE' AND img.verified_at IS NOT NULL
       JOIN infrastructure_providers p ON p.id=img.provider_id AND p.status='ACTIVE'
       JOIN server_product_configurations c ON c.operating_system_version_id=v.id AND c.provider_id=p.id
         AND c.architecture=img.architecture AND c.status='ACTIVE'
         AND (img.region_id IS NULL OR img.region_id=c.region_id)
         AND (img.datacenter_id IS NULL OR img.datacenter_id=c.datacenter_id)
       WHERE v.operating_system_id=$1 AND v.status IN ('ACTIVE','MAINTENANCE','EOL_WARNING')
       ORDER BY v.is_default DESC,v.is_recommended DESC,v.display_name DESC`,[operatingSystem.id]
    );
    return { operatingSystem,versions: result.rows };
  });

  app.get('/api/v1/server-products',async () => {
    const products = await listAllProducts(db);
    const plans = [];
    for (const product of products.filter((item) => item.status === 'active' && item.visibility === 'public')) {
      for (const plan of await listActivePlansForProduct(db,product.id)) {
        const available = await listAvailableConfigurations(db,{ planId: plan.id });
        if (available.length > 0) plans.push({
          id: plan.id,name: plan.name,description: plan.description,
          product: { id: product.id,name: product.name,slug: product.slug },
          serverTypes: [...new Set(available.map((row) => row.server_type))],
          pricing: (await listPublishedPricingForPlan(db,plan.id)).filter((price) => price.amount !== null).map((price) => ({ billingPeriod: price.billing_period,currency: price.currency,amount: price.amount,setupFee: price.setup_fee })),
        });
      }
    }
    return { plans };
  });
  app.get<{ Params: { id: string } }>('/api/v1/server-products/:id/configuration',async (request) => {
    const query = parse(z.object({ serverType: serverType.optional(),providerId: id.optional(),regionId: id.optional(),architecture: architecture.optional() }),request.query ?? {});
    const plan = await findPlanById(db,parse(id,request.params.id));
    if (!plan || plan.status !== 'active') throw new NotFoundError('No server plan was found with that id');
    const rows = await listAvailableConfigurations(db,{ planId: plan.id,...query });
    return {
      plan: { id: plan.id,name: plan.name,description: plan.description },
      ...groupConfiguration(rows),
      controlPanels: await listCompatibleControlPanels(db,plan.id,rows),
    };
  });
  app.get<{ Params: { id: string } }>('/api/v1/server-products/:id/operating-systems',async (request) => {
    const planId = parse(id,request.params.id);
    const rows = await listAvailableConfigurations(db,{ planId });
    return { operatingSystems: groupConfiguration(rows).operatingSystems };
  });

  app.get('/api/v1/notifications',async (request) => {
    const auth = await authenticate(request,env,db);
    return { notifications: await listNotifications(db,auth.userId) };
  });

  // Admin operating systems and versions.
  app.get('/api/v1/admin/operating-systems',async (request) => { await admin(request); return { operatingSystems: await listOperatingSystems(db,{ includeArchived: true }) }; });
  app.post('/api/v1/admin/operating-systems',async (request,reply) => {
    const auth = await admin(request); const input = parse(createOsSchema,request.body);
    const operatingSystem = await createOperatingSystem(db,input);
    await auditRequest(db,request,auth.userId,{ action: 'OS_CREATED',resourceType: 'operating_system',resourceId: operatingSystem.id });
    reply.code(201); return { operatingSystem };
  });
  app.patch<{ Params: { id: string } }>('/api/v1/admin/operating-systems/:id',async (request) => {
    const auth = await admin(request); const osId = parse(id,request.params.id); const patch = parse(patchOsSchema,request.body);
    const operatingSystem = await updateOperatingSystem(db,osId,patch);
    if (!operatingSystem) throw new NotFoundError('No operating system was found with that id');
    await auditRequest(db,request,auth.userId,{ action: 'OS_UPDATED',resourceType: 'operating_system',resourceId: osId,metadata: { status: operatingSystem.status } });
    return { operatingSystem };
  });
  app.delete<{ Params: { id: string } }>('/api/v1/admin/operating-systems/:id',async (request,reply) => {
    const auth = await admin(request); const osId = parse(id,request.params.id);
    const existing = await findOperatingSystem(db,osId); if (!existing) throw new NotFoundError();
    if (!await deleteOperatingSystemIfSafe(db,osId)) throw new ConflictError('This OS has version or server history and must be archived instead');
    await auditRequest(db,request,auth.userId,{ action: 'OS_DELETED',resourceType: 'operating_system',resourceId: osId }); reply.code(204); return null;
  });
  app.get<{ Params: { id: string } }>('/api/v1/admin/operating-systems/:id/versions',async (request) => {
    await admin(request); const operatingSystem = await findOperatingSystem(db,request.params.id); if (!operatingSystem) throw new NotFoundError();
    return { operatingSystem,versions: await listOperatingSystemVersions(db,operatingSystem.id,{ includeArchived: true }) };
  });
  app.post<{ Params: { id: string } }>('/api/v1/admin/operating-systems/:id/versions',async (request,reply) => {
    const auth = await admin(request); const osId = parse(id,request.params.id); if (!await findOperatingSystem(db,osId)) throw new NotFoundError();
    const version = await createOperatingSystemVersion(db,{ operatingSystemId: osId,...parse(versionSchema,request.body) });
    await auditRequest(db,request,auth.userId,{ action: 'OS_VERSION_CREATED',resourceType: 'operating_system_version',resourceId: version.id }); reply.code(201); return { version };
  });
  app.patch<{ Params: { id: string } }>('/api/v1/admin/operating-system-versions/:id',async (request) => {
    const auth = await admin(request); const versionId = parse(id,request.params.id); const version = await updateOperatingSystemVersion(db,versionId,parse(patchVersionSchema,request.body));
    if (!version) throw new NotFoundError(); await auditRequest(db,request,auth.userId,{ action: 'OS_VERSION_UPDATED',resourceType: 'operating_system_version',resourceId: versionId,metadata: { status: version.status } }); return { version };
  });

  // Providers / regions / datacenters. Secret values are never accepted by these schemas.
  app.get('/api/v1/admin/providers',async (request) => { await admin(request); return { providers: await listProviders(db),regions: await listRegions(db),datacenters: await listDatacenters(db) }; });
  app.post('/api/v1/admin/providers',async (request,reply) => { const auth=await admin(request);const input=parse(providerSchema,request.body);if(input.status==='ACTIVE')throw new ValidationError('Create the provider disabled, then validate and activate it');const provider=await createProvider(db,input);await auditRequest(db,request,auth.userId,{action:'PROVIDER_CREATED',resourceType:'provider',resourceId:provider.id});reply.code(201);return {provider}; });
  app.patch<{ Params: { id: string } }>('/api/v1/admin/providers/:id',async (request) => {
    const auth=await admin(request);const providerId=parse(id,request.params.id);const patch=parse(patchProviderSchema,request.body);const existing=await findProviderById(db,providerId);if(!existing)throw new NotFoundError();
    if(patch.status==='ACTIVE'){
      const candidate={
        ...existing,
        name:patch.name??existing.name,
        api_base_url:patch.apiBaseUrl!==undefined?patch.apiBaseUrl:existing.api_base_url,
        credential_env_prefix:patch.credentialEnvPrefix!==undefined?patch.credentialEnvPrefix:existing.credential_env_prefix,
      };
      try{await createInfrastructureProviderAdapter(candidate).validateConfiguration();}
      catch(error){throw new ValidationError(error instanceof Error?error.message:'Provider validation failed');}
    }
    const provider=await updateProvider(db,providerId,patch);await auditRequest(db,request,auth.userId,{action:'PROVIDER_UPDATED',resourceType:'provider',resourceId:providerId,metadata:{status:provider?.status}});return {provider};
  });
  app.post('/api/v1/admin/regions',async (request,reply) => {const auth=await admin(request);const input=parse(regionSchema,request.body);if(!await findProviderById(db,input.providerId))throw new ValidationError('Provider does not exist');const region=await createRegion(db,input);await auditRequest(db,request,auth.userId,{action:'REGION_CREATED',resourceType:'region',resourceId:region.id});reply.code(201);return {region};});
  app.patch<{ Params: { id: string } }>('/api/v1/admin/regions/:id',async(request)=>{const auth=await admin(request);const regionId=parse(id,request.params.id);const patch=parse(regionSchema.omit({providerId:true,code:true}).partial(),request.body);const region=await updateRegion(db,regionId,patch);if(!region)throw new NotFoundError();await auditRequest(db,request,auth.userId,{action:'REGION_UPDATED',resourceType:'region',resourceId:regionId});return{region};});
  app.post('/api/v1/admin/datacenters',async(request,reply)=>{const auth=await admin(request);const input=parse(datacenterSchema,request.body);const region=await findRegionById(db,input.regionId);if(!region)throw new ValidationError('Region does not exist');const datacenter=await createDatacenter(db,input);await auditRequest(db,request,auth.userId,{action:'DATACENTER_CREATED',resourceType:'datacenter',resourceId:datacenter.id});reply.code(201);return{datacenter};});
  app.patch<{Params:{id:string}}>('/api/v1/admin/datacenters/:id',async(request)=>{const auth=await admin(request);const datacenterId=parse(id,request.params.id);const patch=parse(datacenterSchema.omit({regionId:true,code:true}).partial(),request.body);const datacenter=await updateDatacenter(db,datacenterId,patch);if(!datacenter)throw new NotFoundError();await auditRequest(db,request,auth.userId,{action:'DATACENTER_UPDATED',resourceType:'datacenter',resourceId:datacenterId});return{datacenter};});

  // Provider image mappings: enabling always performs a live provider validation first.
  app.get('/api/v1/admin/os-images',async(request)=>{await admin(request);const query=parse(z.object({providerId:id.optional(),versionId:id.optional(),status:imageStatus.optional()}),request.query??{});return{images:await listOsImages(db,query)};});
  app.post('/api/v1/admin/os-images',async(request,reply)=>{
    const auth=await admin(request);const input=parse(imageSchema,request.body);
    const [provider,version,region,datacenter]=await Promise.all([findProviderById(db,input.providerId),findOperatingSystemVersion(db,input.operatingSystemVersionId),input.regionId?findRegionById(db,input.regionId):null,input.datacenterId?findDatacenterById(db,input.datacenterId):null]);
    if(!provider)throw new ValidationError('Provider does not exist');
    if(!version||!version.architecture_support.includes(input.architecture))throw new ValidationError('OS version does not support the selected architecture');
    if(input.regionId&&(!region||region.provider_id!==provider.id))throw new ValidationError('Region does not belong to the selected provider');
    if(input.datacenterId&&(!datacenter||!region||datacenter.region_id!==region.id))throw new ValidationError('Datacenter does not belong to the selected region');
    const image=await createOsImage(db,input);await auditRequest(db,request,auth.userId,{action:'OS_IMAGE_CREATED',resourceType:'os_image',resourceId:image.id});reply.code(201);return{image};
  });
  app.patch<{Params:{id:string}}>('/api/v1/admin/os-images/:id',async(request)=>{
    const auth=await admin(request);const imageId=parse(id,request.params.id);const patch=parse(patchImageSchema,request.body);const existing=await findOsImageById(db,imageId);if(!existing)throw new NotFoundError();
    const candidateImageId=patch.providerImageId!==undefined?patch.providerImageId:existing.provider_image_id;const candidateTemplateId=patch.providerTemplateId!==undefined?patch.providerTemplateId:existing.provider_template_id;if(!candidateImageId&&!candidateTemplateId)throw new ValidationError('providerImageId or providerTemplateId is required');
    const mappingChanged=patch.providerImageId!==undefined||patch.providerTemplateId!==undefined||patch.architecture!==undefined||patch.regionId!==undefined||patch.datacenterId!==undefined;
    if(mappingChanged&&patch.status==='ACTIVE')throw new ValidationError('Save mapping changes as draft, test them, then enable the image');
    if(patch.status==='ACTIVE')await validateImage(db,imageId,auth.userId);
    const image=await updateOsImage(db,imageId,mappingChanged?{...patch,status:'DRAFT',verifiedAt:null,verifiedBy:null,verificationError:null}:patch);
    if(!image)throw new NotFoundError();await auditRequest(db,request,auth.userId,{action:'OS_IMAGE_UPDATED',resourceType:'os_image',resourceId:imageId,metadata:{status:image.status}});return{image};
  });
  app.post<{Params:{id:string}}>('/api/v1/admin/os-images/:id/test',async(request)=>{const auth=await admin(request);const image=await validateImage(db,parse(id,request.params.id),auth.userId);await auditRequest(db,request,auth.userId,{action:'OS_IMAGE_TESTED',resourceType:'os_image',resourceId:image?.id,metadata:{result:'verified'}});return{image,verified:true};});
  app.delete<{Params:{id:string}}>('/api/v1/admin/os-images/:id',async(request,reply)=>{const auth=await admin(request);const imageId=parse(id,request.params.id);if(!await deleteOsImage(db,imageId))throw new ConflictError('Active or referenced images must be disabled before deletion');await auditRequest(db,request,auth.userId,{action:'OS_IMAGE_DELETED',resourceType:'os_image',resourceId:imageId});reply.code(204);return null;});

  app.get('/api/v1/admin/server-plans',async(request)=>{
    await admin(request);
    const result=await db.query(`SELECT p.id,p.name,p.description,p.status,pr.id product_id,pr.name product_name,pr.slug product_slug,pr.status product_status FROM product_plans p JOIN products pr ON pr.id=p.product_id ORDER BY pr.name,p.display_order,p.name`);
    return{plans:result.rows};
  });

  const productConfigSchema=z.object({planId:id,providerId:id,regionId:id,datacenterId:id.nullable().optional(),operatingSystemVersionId:id,architecture,serverType,status:z.enum(['ACTIVE','DISABLED','ARCHIVED']).optional(),metadata:z.record(z.unknown()).optional()});
  app.get('/api/v1/admin/server-product-configurations',async(request)=>{await admin(request);const query=parse(z.object({planId:id.optional()}),request.query??{});return{configurations:await listProductConfigurations(db,query.planId)};});
  app.post('/api/v1/admin/server-product-configurations',async(request,reply)=>{
    const auth=await admin(request);const input=parse(productConfigSchema,request.body);
    if(input.status==='ACTIVE')throw new ValidationError('Create the configuration disabled, then enable it after its image mapping is verified');
    await validateProductConfigurationReferences(db,input);
    const configuration=await createProductConfiguration(db,input);
    await auditRequest(db,request,auth.userId,{action:'SERVER_PRODUCT_CONFIGURATION_CREATED',resourceType:'server_product_configuration',resourceId:configuration.id});reply.code(201);return{configuration};
  });
  app.patch<{Params:{id:string}}>('/api/v1/admin/server-product-configurations/:id',async(request)=>{
    const auth=await admin(request);const configurationId=parse(id,request.params.id);
    const {status}=parse(z.object({status:z.enum(['ACTIVE','DISABLED','ARCHIVED'])}),request.body);
    if(status==='ACTIVE'){
      const current=await db.query<{plan_id:string;provider_id:string;region_id:string;datacenter_id:string|null;operating_system_version_id:string;architecture:'x86_64'|'arm64';server_type:'VPS'|'DEDICATED'|'CLOUD';metadata:Record<string,unknown>}>(`SELECT * FROM server_product_configurations WHERE id=$1`,[configurationId]);
      const row=current.rows[0];if(!row)throw new NotFoundError();
      await validateProductConfigurationReferences(db,{planId:row.plan_id,providerId:row.provider_id,regionId:row.region_id,datacenterId:row.datacenter_id,operatingSystemVersionId:row.operating_system_version_id,architecture:row.architecture,serverType:row.server_type,metadata:row.metadata});
      const images=await db.query(`SELECT 1 FROM server_os_images i WHERE i.provider_id=$1 AND i.operating_system_version_id=$2 AND i.architecture=$3 AND (i.region_id IS NULL OR i.region_id=$4) AND (i.datacenter_id IS NULL OR i.datacenter_id=$5) AND i.status='ACTIVE' AND i.verified_at IS NOT NULL`,[row.provider_id,row.operating_system_version_id,row.architecture,row.region_id,row.datacenter_id]);
      if(!images.rows[0])throw new ValidationError('No verified active provider image supports this exact configuration');
    }
    const configuration=await setProductConfigurationStatus(db,configurationId,status);if(!configuration)throw new NotFoundError();
    await auditRequest(db,request,auth.userId,{action:'SERVER_PRODUCT_CONFIGURATION_UPDATED',resourceType:'server_product_configuration',resourceId:configurationId,metadata:{status}});return{configuration};
  });

  // Provisioning oversight, logs, retries and cancellation.
  app.get('/api/v1/admin/provisioning-jobs',async(request)=>{await admin(request);const query=parse(z.object({status:z.string().max(32).optional(),serverId:id.optional(),limit:z.coerce.number().int().min(1).max(200).optional()}),request.query??{});return{jobs:await listProvisioningJobs(db,query)};});
  app.get<{Params:{id:string}}>('/api/v1/admin/provisioning-jobs/:id',async(request)=>{await admin(request);const job=await findProvisioningJobById(db,parse(id,request.params.id));if(!job)throw new NotFoundError();return{job,steps:await listDeploymentSteps(db,job.deployment_id),events:await listDeploymentEvents(db,job.deployment_id)};});
  app.post<{Params:{id:string}}>('/api/v1/admin/provisioning-jobs/:id/retry',async(request)=>{const auth=await admin(request);const jobId=parse(id,request.params.id);if(!await retryProvisioningJob(db,jobId))throw new ConflictError('Only retryable failed jobs can be retried');await auditRequest(db,request,auth.userId,{action:'PROVISIONING_JOB_RETRIED',resourceType:'provisioning_job',resourceId:jobId});return{queued:true};});
  app.post<{Params:{id:string}}>('/api/v1/admin/provisioning-jobs/:id/cancel',async(request)=>{const auth=await admin(request);const jobId=parse(id,request.params.id);if(!await cancelProvisioningJob(db,jobId))throw new ConflictError('Only queued jobs can be cancelled');await auditRequest(db,request,auth.userId,{action:'PROVISIONING_JOB_CANCELLED',resourceType:'provisioning_job',resourceId:jobId});return{cancelled:true};});
  app.get('/api/v1/admin/provisioning-metrics',async(request)=>{await admin(request);const summary=await db.query(`SELECT count(*)::int total,count(*) FILTER(WHERE status='READY')::int ready,count(*) FILTER(WHERE status='FAILED')::int failed,COALESCE(avg(EXTRACT(EPOCH FROM(completed_at-started_at))) FILTER(WHERE completed_at IS NOT NULL),0)::float average_duration_seconds,COALESCE(sum(attempts-1),0)::int retries FROM provisioning_jobs`);const queue=await db.query(`SELECT count(*)::int depth FROM deployments WHERE action LIKE 'server_%' AND status='queued'`);return{...summary.rows[0],queueDepth:queue.rows[0]?.depth??0};});
}
