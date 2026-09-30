import { randomUUID } from 'node:crypto';
import type { Queryable } from './types';

export interface OperatingSystemRow {
  id: string;
  name: string;
  slug: string;
  os_release_ids: string[];
  vendor: string | null;
  description: string | null;
  logo_url: string | null;
  status: 'ACTIVE' | 'DISABLED' | 'ARCHIVED';
  sort_order: number;
  is_vps_supported: boolean;
  is_dedicated_supported: boolean;
  is_cloud_supported: boolean;
  is_reinstall_supported: boolean;
  created_at: string;
  updated_at: string;
}

export interface OperatingSystemVersionRow {
  id: string;
  operating_system_id: string;
  version: string;
  display_name: string;
  release_name: string | null;
  architecture_support: Array<'x86_64' | 'arm64'>;
  status: 'ACTIVE' | 'MAINTENANCE' | 'EOL_WARNING' | 'EOL' | 'ARCHIVED' | 'DISABLED';
  is_default: boolean;
  is_recommended: boolean;
  is_lts: boolean;
  release_date: string | null;
  end_of_life_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface ServerProductConfigurationRow {
  id: string;
  plan_id: string;
  provider_id: string;
  region_id: string;
  datacenter_id: string | null;
  operating_system_version_id: string;
  architecture: 'x86_64' | 'arm64';
  server_type: 'VPS' | 'DEDICATED' | 'CLOUD';
  status: string;
  metadata: Record<string, unknown>;
  plan_name?: string;
  provider_name?: string;
  region_name?: string;
  datacenter_name?: string | null;
  os_display_name?: string;
  created_at: string;
  updated_at: string;
}

export interface AvailableConfigurationRow {
  configuration_id: string;
  plan_id: string;
  server_type: string;
  architecture: 'x86_64' | 'arm64';
  provider_id: string;
  provider_name: string;
  provider_status: string;
  region_id: string;
  region_code: string;
  region_name: string;
  datacenter_id: string | null;
  datacenter_code: string | null;
  datacenter_name: string | null;
  operating_system_id: string;
  os_name: string;
  os_slug: string;
  os_vendor: string | null;
  os_description: string | null;
  logo_url: string | null;
  version_id: string;
  version: string;
  display_name: string;
  release_name: string | null;
  version_status: string;
  is_default: boolean;
  is_recommended: boolean;
  is_lts: boolean;
  end_of_life_date: string | null;
  image_id: string;
  configuration_metadata: Record<string, unknown>;
}

export async function listOperatingSystems(
  db: Queryable,
  options: { includeArchived?: boolean; onlyActive?: boolean } = {}
): Promise<OperatingSystemRow[]> {
  const conditions: string[] = [];
  if (!options.includeArchived) conditions.push(`status <> 'ARCHIVED'`);
  if (options.onlyActive) conditions.push(`status = 'ACTIVE'`);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await db.query<OperatingSystemRow>(
    `SELECT * FROM operating_systems ${where} ORDER BY sort_order ASC, name ASC`
  );
  return rows;
}

export async function findOperatingSystem(db: Queryable, idOrSlug: string): Promise<OperatingSystemRow | null> {
  const { rows } = await db.query<OperatingSystemRow>(
    `SELECT * FROM operating_systems WHERE id::text=$1 OR lower(slug)=lower($1) LIMIT 1`, [idOrSlug]
  );
  return rows[0] ?? null;
}

export async function createOperatingSystem(
  db: Queryable,
  input: {
    name: string; slug: string; osReleaseIds?: string[]; vendor?: string | null; description?: string | null; logoUrl?: string | null;
    status?: OperatingSystemRow['status']; sortOrder?: number; isVpsSupported?: boolean;
    isDedicatedSupported?: boolean; isCloudSupported?: boolean; isReinstallSupported?: boolean;
  }
): Promise<OperatingSystemRow> {
  const { rows } = await db.query<OperatingSystemRow>(
    `INSERT INTO operating_systems
       (id,name,slug,os_release_ids,vendor,description,logo_url,status,sort_order,is_vps_supported,is_dedicated_supported,is_cloud_supported,is_reinstall_supported)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [randomUUID(),input.name,input.slug,input.osReleaseIds??[],input.vendor ?? null,input.description ?? null,input.logoUrl ?? null,input.status ?? 'DISABLED',input.sortOrder ?? 0,input.isVpsSupported ?? false,input.isDedicatedSupported ?? false,input.isCloudSupported ?? false,input.isReinstallSupported ?? false]
  );
  const row = rows[0];
  if (!row) throw new Error('createOperatingSystem: insert returned no row');
  return row;
}

export async function updateOperatingSystem(
  db: Queryable,
  id: string,
  patch: Partial<{
    name: string; osReleaseIds: string[]; vendor: string | null; description: string | null; logoUrl: string | null;
    status: OperatingSystemRow['status']; sortOrder: number; isVpsSupported: boolean;
    isDedicatedSupported: boolean; isCloudSupported: boolean; isReinstallSupported: boolean;
  }>
): Promise<OperatingSystemRow | null> {
  const current = await findOperatingSystem(db, id);
  if (!current) return null;
  const { rows } = await db.query<OperatingSystemRow>(
    `UPDATE operating_systems SET name=$2,os_release_ids=$3,vendor=$4,description=$5,logo_url=$6,status=$7,
       sort_order=$8,is_vps_supported=$9,is_dedicated_supported=$10,is_cloud_supported=$11,
       is_reinstall_supported=$12,updated_at=now() WHERE id=$1 RETURNING *`,
    [id,
      patch.name ?? current.name,
      patch.osReleaseIds ?? current.os_release_ids,
      patch.vendor !== undefined ? patch.vendor : current.vendor,
      patch.description !== undefined ? patch.description : current.description,
      patch.logoUrl !== undefined ? patch.logoUrl : current.logo_url,
      patch.status ?? current.status,
      patch.sortOrder ?? current.sort_order,
      patch.isVpsSupported ?? current.is_vps_supported,
      patch.isDedicatedSupported ?? current.is_dedicated_supported,
      patch.isCloudSupported ?? current.is_cloud_supported,
      patch.isReinstallSupported ?? current.is_reinstall_supported,
    ]
  );
  return rows[0] ?? null;
}

/** Hard delete only when no version/server history exists; otherwise archive at the route layer. */
export async function deleteOperatingSystemIfSafe(db: Queryable, id: string): Promise<boolean> {
  const result = await db.query(
    `DELETE FROM operating_systems os
     WHERE os.id=$1
       AND NOT EXISTS (SELECT 1 FROM operating_system_versions v WHERE v.operating_system_id=os.id)
     RETURNING id`, [id]
  );
  return result.rows.length > 0;
}

export async function listOperatingSystemVersions(
  db: Queryable,
  operatingSystemId: string,
  options: { selectableOnly?: boolean; includeArchived?: boolean } = {}
): Promise<OperatingSystemVersionRow[]> {
  const conditions = [`operating_system_id=$1`];
  if (options.selectableOnly) conditions.push(`status IN ('ACTIVE','MAINTENANCE','EOL_WARNING')`);
  else if (!options.includeArchived) conditions.push(`status <> 'ARCHIVED'`);
  const { rows } = await db.query<OperatingSystemVersionRow>(
    `SELECT * FROM operating_system_versions WHERE ${conditions.join(' AND ')}
     ORDER BY is_default DESC,is_recommended DESC,release_date DESC NULLS LAST,display_name DESC`, [operatingSystemId]
  );
  return rows;
}

export async function findOperatingSystemVersion(db: Queryable, id: string): Promise<OperatingSystemVersionRow | null> {
  const { rows } = await db.query<OperatingSystemVersionRow>(`SELECT * FROM operating_system_versions WHERE id=$1`, [id]);
  return rows[0] ?? null;
}

export async function createOperatingSystemVersion(
  db: Queryable,
  input: {
    operatingSystemId: string; version: string; displayName: string; releaseName?: string | null;
    architectureSupport: Array<'x86_64' | 'arm64'>; status?: OperatingSystemVersionRow['status'];
    isDefault?: boolean; isRecommended?: boolean; isLts?: boolean; releaseDate?: string | null; endOfLifeDate?: string | null;
  }
): Promise<OperatingSystemVersionRow> {
  if (input.isDefault) {
    await db.query(`UPDATE operating_system_versions SET is_default=false,updated_at=now() WHERE operating_system_id=$1`, [input.operatingSystemId]);
  }
  const { rows } = await db.query<OperatingSystemVersionRow>(
    `INSERT INTO operating_system_versions
       (id,operating_system_id,version,display_name,release_name,architecture_support,status,is_default,is_recommended,is_lts,release_date,end_of_life_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [randomUUID(),input.operatingSystemId,input.version,input.displayName,input.releaseName ?? null,input.architectureSupport,input.status ?? 'DISABLED',input.isDefault ?? false,input.isRecommended ?? false,input.isLts ?? false,input.releaseDate ?? null,input.endOfLifeDate ?? null]
  );
  const row = rows[0];
  if (!row) throw new Error('createOperatingSystemVersion: insert returned no row');
  return row;
}

export async function updateOperatingSystemVersion(
  db: Queryable,
  id: string,
  patch: Partial<{
    displayName: string; releaseName: string | null; architectureSupport: Array<'x86_64' | 'arm64'>;
    status: OperatingSystemVersionRow['status']; isDefault: boolean; isRecommended: boolean;
    isLts: boolean; releaseDate: string | null; endOfLifeDate: string | null;
  }>
): Promise<OperatingSystemVersionRow | null> {
  const current = await findOperatingSystemVersion(db, id);
  if (!current) return null;
  if (patch.isDefault === true) {
    await db.query(`UPDATE operating_system_versions SET is_default=false,updated_at=now() WHERE operating_system_id=$1 AND id<>$2`, [current.operating_system_id,id]);
  }
  const { rows } = await db.query<OperatingSystemVersionRow>(
    `UPDATE operating_system_versions SET display_name=$2,release_name=$3,architecture_support=$4,
       status=$5,is_default=$6,is_recommended=$7,is_lts=$8,release_date=$9,end_of_life_date=$10,updated_at=now()
     WHERE id=$1 RETURNING *`,
    [id,patch.displayName ?? current.display_name,patch.releaseName !== undefined ? patch.releaseName : current.release_name,patch.architectureSupport ?? current.architecture_support,patch.status ?? current.status,patch.isDefault ?? current.is_default,patch.isRecommended ?? current.is_recommended,patch.isLts ?? current.is_lts,patch.releaseDate !== undefined ? patch.releaseDate : current.release_date,patch.endOfLifeDate !== undefined ? patch.endOfLifeDate : current.end_of_life_date]
  );
  return rows[0] ?? null;
}

export async function listAvailableConfigurations(
  db: Queryable,
  input: { planId: string; serverType?: string; providerId?: string; regionId?: string; architecture?: string }
): Promise<AvailableConfigurationRow[]> {
  const params: unknown[] = [input.planId];
  const conditions = [
    `c.plan_id=$1`, `c.status='ACTIVE'`, `p.status='ACTIVE'`, `r.status='ACTIVE'`,
    `os.status='ACTIVE'`, `v.status IN ('ACTIVE','MAINTENANCE','EOL_WARNING')`,
    `((c.server_type='VPS' AND os.is_vps_supported=true) OR (c.server_type='DEDICATED' AND os.is_dedicated_supported=true) OR (c.server_type='CLOUD' AND os.is_cloud_supported=true))`,
    `img.status='ACTIVE'`, `img.verified_at IS NOT NULL`,
    `img.provider_id=c.provider_id`, `img.operating_system_version_id=c.operating_system_version_id`,
    `img.architecture=c.architecture`,
    `(img.region_id IS NULL OR img.region_id=c.region_id)`,
    `(img.datacenter_id IS NULL OR img.datacenter_id=c.datacenter_id)`,
  ];
  const add = (fragment: string, value: unknown) => { params.push(value); conditions.push(fragment.replace('?', `$${params.length}`)); };
  if (input.serverType) add(`c.server_type=?`, input.serverType);
  if (input.providerId) add(`c.provider_id=?`, input.providerId);
  if (input.regionId) add(`c.region_id=?`, input.regionId);
  if (input.architecture) add(`c.architecture=?`, input.architecture);
  const { rows } = await db.query<AvailableConfigurationRow>(
    `SELECT DISTINCT ON (c.id)
       c.id configuration_id,c.plan_id,c.server_type,c.architecture,
       p.id provider_id,p.name provider_name,p.status provider_status,
       r.id region_id,r.code region_code,r.name region_name,
       dc.id datacenter_id,dc.code datacenter_code,dc.name datacenter_name,
       os.id operating_system_id,os.name os_name,os.slug os_slug,os.vendor os_vendor,
       os.description os_description,os.logo_url,
       v.id version_id,v.version,v.display_name,v.release_name,v.status version_status,
       v.is_default,v.is_recommended,v.is_lts,v.end_of_life_date,
       img.id image_id,c.metadata configuration_metadata
     FROM server_product_configurations c
     JOIN infrastructure_providers p ON p.id=c.provider_id
     JOIN infrastructure_regions r ON r.id=c.region_id
     LEFT JOIN infrastructure_datacenters dc ON dc.id=c.datacenter_id
     JOIN operating_system_versions v ON v.id=c.operating_system_version_id
     JOIN operating_systems os ON os.id=v.operating_system_id
     JOIN server_os_images img ON ${conditions.slice(7, 13).join(' AND ')}
     WHERE ${conditions.slice(0, 7).concat(conditions.slice(13)).join(' AND ')}
     ORDER BY c.id,
       CASE WHEN img.datacenter_id=c.datacenter_id THEN 1 ELSE 0 END DESC,
       CASE WHEN img.region_id=c.region_id THEN 1 ELSE 0 END DESC`, params
  );
  return rows;
}

export async function resolveAvailableConfiguration(
  db: Queryable,
  input: {
    planId: string; providerId: string; regionId: string; datacenterId?: string | null;
    operatingSystemVersionId: string; architecture: string; serverType: string;
  }
): Promise<AvailableConfigurationRow | null> {
  const rows = await listAvailableConfigurations(db, {
    planId: input.planId,
    serverType: input.serverType,
    providerId: input.providerId,
    regionId: input.regionId,
    architecture: input.architecture,
  });
  return rows.find((row) =>
    row.version_id === input.operatingSystemVersionId &&
    (input.datacenterId ? row.datacenter_id === input.datacenterId : row.datacenter_id === null)
  ) ?? null;
}

export async function listProductConfigurations(db: Queryable, planId?: string): Promise<ServerProductConfigurationRow[]> {
  const { rows } = await db.query<ServerProductConfigurationRow>(
    `SELECT c.*,p.name plan_name,ip.name provider_name,r.name region_name,d.name datacenter_name,v.display_name os_display_name
     FROM server_product_configurations c
     JOIN product_plans p ON p.id=c.plan_id
     JOIN infrastructure_providers ip ON ip.id=c.provider_id
     JOIN infrastructure_regions r ON r.id=c.region_id
     LEFT JOIN infrastructure_datacenters d ON d.id=c.datacenter_id
     JOIN operating_system_versions v ON v.id=c.operating_system_version_id
     WHERE ($1::uuid IS NULL OR c.plan_id=$1::uuid)
     ORDER BY c.created_at DESC`, [planId ?? null]
  );
  return rows;
}

export async function createProductConfiguration(
  db: Queryable,
  input: {
    planId: string; providerId: string; regionId: string; datacenterId?: string | null;
    operatingSystemVersionId: string; architecture: 'x86_64' | 'arm64'; serverType: 'VPS' | 'DEDICATED' | 'CLOUD';
    status?: string; metadata?: Record<string, unknown>;
  }
): Promise<ServerProductConfigurationRow> {
  const { rows } = await db.query<ServerProductConfigurationRow>(
    `INSERT INTO server_product_configurations
       (id,plan_id,provider_id,region_id,datacenter_id,operating_system_version_id,architecture,server_type,status,metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [randomUUID(),input.planId,input.providerId,input.regionId,input.datacenterId ?? null,input.operatingSystemVersionId,input.architecture,input.serverType,input.status ?? 'DISABLED',JSON.stringify(input.metadata ?? {})]
  );
  const row = rows[0];
  if (!row) throw new Error('createProductConfiguration: insert returned no row');
  return row;
}

export async function setProductConfigurationStatus(db: Queryable, id: string, status: string): Promise<ServerProductConfigurationRow | null> {
  const { rows } = await db.query<ServerProductConfigurationRow>(
    `UPDATE server_product_configurations SET status=$2,updated_at=now() WHERE id=$1 RETURNING *`, [id,status]
  );
  return rows[0] ?? null;
}
