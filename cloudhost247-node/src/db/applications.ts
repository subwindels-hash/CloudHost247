/**
 * Phase 6 — repository for the applications catalog (spec §8) and application_versions (spec §9).
 *
 * Reads used by the public marketplace go through src/services/marketplace-service.ts, which is
 * the single place "only published applications / published versions" is enforced, mirroring how
 * catalog-service.ts guards the hosting-product catalog.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from './types';
import type { ApplicationManifest, HostingType } from '../marketplace/manifest-schema';

export interface ApplicationRow {
  id: string;
  category_id: string | null;
  name: string;
  slug: string;
  description: string;
  long_description: string | null;
  logo_url: string | null;
  website_url: string | null;
  repository_url: string | null;
  documentation_url: string | null;
  license: string | null;
  deployment_type: string;
  status: string;
  featured: boolean;
  popularity: number;
  requires_admin_approval: boolean;
  min_cpu: number;
  min_memory_mb: number;
  min_storage_mb: number;
  recommended_cpu: number;
  recommended_memory_mb: number;
  recommended_storage_mb: number;
  gpu_required: boolean;
  supported_hosting_types: HostingType[];
  created_at: string;
  updated_at: string;
}

export interface ApplicationVersionRow {
  id: string;
  application_id: string;
  version: string;
  docker_image: string | null;
  manifest: ApplicationManifest;
  minimum_cpu: number;
  minimum_memory_mb: number;
  minimum_storage_mb: number;
  release_notes: string | null;
  status: string;
  is_stable: boolean;
  created_at: string;
  updated_at: string;
}

export interface UpsertApplicationInput {
  id?: string;
  categoryId?: string | null;
  name: string;
  slug: string;
  description: string;
  longDescription?: string | null;
  logoUrl?: string | null;
  websiteUrl?: string | null;
  repositoryUrl?: string | null;
  documentationUrl?: string | null;
  license?: string | null;
  deploymentType?: string;
  status?: string;
  featured?: boolean;
  popularity?: number;
  requiresAdminApproval?: boolean;
  minCpu?: number;
  minMemoryMb?: number;
  minStorageMb?: number;
  recommendedCpu?: number;
  recommendedMemoryMb?: number;
  recommendedStorageMb?: number;
  gpuRequired?: boolean;
  supportedHostingTypes?: HostingType[];
}

export async function createApplication(db: Queryable, input: UpsertApplicationInput): Promise<ApplicationRow> {
  const { rows } = await db.query<ApplicationRow>(
    `INSERT INTO applications (
       id, category_id, name, slug, description, long_description, logo_url, website_url,
       repository_url, documentation_url, license, deployment_type, status, featured, popularity,
       requires_admin_approval, min_cpu, min_memory_mb, min_storage_mb, recommended_cpu,
       recommended_memory_mb, recommended_storage_mb, gpu_required, supported_hosting_types
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
     RETURNING *`,
    [
      input.id ?? randomUUID(),
      input.categoryId ?? null,
      input.name,
      input.slug,
      input.description,
      input.longDescription ?? null,
      input.logoUrl ?? null,
      input.websiteUrl ?? null,
      input.repositoryUrl ?? null,
      input.documentationUrl ?? null,
      input.license ?? null,
      input.deploymentType ?? 'docker_compose',
      input.status ?? 'draft',
      input.featured ?? false,
      input.popularity ?? 0,
      input.requiresAdminApproval ?? false,
      input.minCpu ?? 1,
      input.minMemoryMb ?? 512,
      input.minStorageMb ?? 5120,
      input.recommendedCpu ?? 2,
      input.recommendedMemoryMb ?? 2048,
      input.recommendedStorageMb ?? 20480,
      input.gpuRequired ?? false,
      input.supportedHostingTypes ?? ['docker'],
    ]
  );
  const row = rows[0];
  if (!row) throw new Error('createApplication: insert returned no row');
  return row;
}

export async function updateApplication(
  db: Queryable,
  id: string,
  patch: Partial<UpsertApplicationInput>
): Promise<ApplicationRow | null> {
  const existingResult = await db.query<ApplicationRow>(`SELECT * FROM applications WHERE id = $1 FOR UPDATE`, [id]);
  const existing = existingResult.rows[0];
  if (!existing) return null;
  const { rows } = await db.query<ApplicationRow>(
    `UPDATE applications SET
       category_id = $2, name = $3, description = $4, long_description = $5, logo_url = $6,
       website_url = $7, repository_url = $8, documentation_url = $9, license = $10,
       deployment_type = $11, status = $12, featured = $13, popularity = $14,
       requires_admin_approval = $15, min_cpu = $16, min_memory_mb = $17, min_storage_mb = $18,
       recommended_cpu = $19, recommended_memory_mb = $20, recommended_storage_mb = $21,
       gpu_required = $22, supported_hosting_types = $23, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [
      id,
      patch.categoryId !== undefined ? patch.categoryId : existing.category_id,
      patch.name ?? existing.name,
      patch.description ?? existing.description,
      patch.longDescription !== undefined ? patch.longDescription : existing.long_description,
      patch.logoUrl !== undefined ? patch.logoUrl : existing.logo_url,
      patch.websiteUrl !== undefined ? patch.websiteUrl : existing.website_url,
      patch.repositoryUrl !== undefined ? patch.repositoryUrl : existing.repository_url,
      patch.documentationUrl !== undefined ? patch.documentationUrl : existing.documentation_url,
      patch.license !== undefined ? patch.license : existing.license,
      patch.deploymentType ?? existing.deployment_type,
      patch.status ?? existing.status,
      patch.featured ?? existing.featured,
      patch.popularity ?? existing.popularity,
      patch.requiresAdminApproval ?? existing.requires_admin_approval,
      patch.minCpu ?? existing.min_cpu,
      patch.minMemoryMb ?? existing.min_memory_mb,
      patch.minStorageMb ?? existing.min_storage_mb,
      patch.recommendedCpu ?? existing.recommended_cpu,
      patch.recommendedMemoryMb ?? existing.recommended_memory_mb,
      patch.recommendedStorageMb ?? existing.recommended_storage_mb,
      patch.gpuRequired ?? existing.gpu_required,
      patch.supportedHostingTypes ?? existing.supported_hosting_types,
    ]
  );
  return rows[0] ?? null;
}

export async function findApplicationBySlug(db: Queryable, slug: string): Promise<ApplicationRow | null> {
  const { rows } = await db.query<ApplicationRow>(
    `SELECT * FROM applications WHERE lower(slug) = lower($1)`,
    [slug]
  );
  return rows[0] ?? null;
}

export async function findApplicationById(db: Queryable, id: string): Promise<ApplicationRow | null> {
  const { rows } = await db.query<ApplicationRow>(`SELECT * FROM applications WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export interface ApplicationListFilters {
  categoryId?: string;
  categorySlug?: string;
  search?: string;
  featuredOnly?: boolean;
  /** Undefined = all statuses (admin); 'published' = public marketplace. */
  status?: string;
  limit?: number;
  offset?: number;
  sort?: 'popular' | 'recent' | 'name';
}

export async function listApplications(
  db: Queryable,
  filters: ApplicationListFilters = {}
): Promise<{ applications: ApplicationRow[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const add = (fragment: string, value: unknown) => {
    params.push(value);
    conditions.push(fragment.replace('?', `$${params.length}`));
  };

  if (filters.status) add('a.status = ?', filters.status);
  if (filters.categoryId) add('a.category_id = ?', filters.categoryId);
  if (filters.categorySlug) add('c.slug = lower(?)', filters.categorySlug);
  if (filters.featuredOnly) conditions.push('a.featured = true');
  if (filters.search) {
    params.push(`%${filters.search.toLowerCase()}%`);
    conditions.push(`(lower(a.name) LIKE $${params.length} OR lower(a.description) LIKE $${params.length})`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const orderBy =
    filters.sort === 'recent' ? 'a.created_at DESC' : filters.sort === 'name' ? 'a.name ASC' : 'a.popularity DESC, a.name ASC';

  const countResult = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM applications a
     LEFT JOIN application_categories c ON c.id = a.category_id
     ${where}`,
    params
  );
  const { rows } = await db.query<ApplicationRow>(
    `SELECT a.* FROM applications a
     LEFT JOIN application_categories c ON c.id = a.category_id
     ${where}
     ORDER BY ${orderBy}
     LIMIT ${filters.limit ?? 60} OFFSET ${filters.offset ?? 0}`,
    params
  );
  return { applications: rows, total: Number.parseInt(countResult.rows[0]?.count ?? '0', 10) };
}

// --- Versions ------------------------------------------------------------------------------------

export interface UpsertVersionInput {
  id?: string;
  applicationId: string;
  version: string;
  dockerImage?: string | null;
  manifest: ApplicationManifest;
  minimumCpu?: number;
  minimumMemoryMb?: number;
  minimumStorageMb?: number;
  releaseNotes?: string | null;
  status?: string;
  isStable?: boolean;
}

export async function upsertApplicationVersion(db: Queryable, input: UpsertVersionInput): Promise<ApplicationVersionRow> {
  const { rows } = await db.query<ApplicationVersionRow>(
    `INSERT INTO application_versions (
       id, application_id, version, docker_image, manifest, minimum_cpu, minimum_memory_mb,
       minimum_storage_mb, release_notes, status, is_stable
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (application_id, version) DO UPDATE SET
       docker_image = EXCLUDED.docker_image,
       manifest = EXCLUDED.manifest,
       minimum_cpu = EXCLUDED.minimum_cpu,
       minimum_memory_mb = EXCLUDED.minimum_memory_mb,
       minimum_storage_mb = EXCLUDED.minimum_storage_mb,
       release_notes = EXCLUDED.release_notes,
       is_stable = EXCLUDED.is_stable,
       updated_at = now()
     RETURNING *`,
    [
      input.id ?? randomUUID(),
      input.applicationId,
      input.version,
      input.dockerImage ?? null,
      JSON.stringify(input.manifest),
      input.minimumCpu ?? 1,
      input.minimumMemoryMb ?? 512,
      input.minimumStorageMb ?? 5120,
      input.releaseNotes ?? null,
      input.status ?? 'draft',
      input.isStable ?? false,
    ]
  );
  const row = rows[0];
  if (!row) throw new Error('upsertApplicationVersion: upsert returned no row');
  return row;
}

export async function listApplicationVersions(
  db: Queryable,
  applicationId: string,
  onlyPublished = false
): Promise<ApplicationVersionRow[]> {
  const { rows } = await db.query<ApplicationVersionRow>(
    `SELECT * FROM application_versions
     WHERE application_id = $1 ${onlyPublished ? `AND status = 'published'` : ''}
     ORDER BY is_stable DESC, created_at DESC`,
    [applicationId]
  );
  return rows;
}

export async function findApplicationVersionById(
  db: Queryable,
  id: string
): Promise<ApplicationVersionRow | null> {
  const { rows } = await db.query<ApplicationVersionRow>(`SELECT * FROM application_versions WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function findStableVersion(
  db: Queryable,
  applicationId: string
): Promise<ApplicationVersionRow | null> {
  const { rows } = await db.query<ApplicationVersionRow>(
    `SELECT * FROM application_versions
     WHERE application_id = $1 AND is_stable = true AND status = 'published'
     LIMIT 1`,
    [applicationId]
  );
  return rows[0] ?? null;
}

export async function countInstallationsForApplication(db: Queryable, applicationId: string): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM application_installations
     WHERE application_id = $1 AND status <> 'deleted'`,
    [applicationId]
  );
  return Number.parseInt(rows[0]?.count ?? '0', 10);
}
