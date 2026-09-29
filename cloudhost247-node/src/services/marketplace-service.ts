/**
 * Phase 6 — public marketplace business logic (spec §41, §42).
 *
 * The single enforcement point for marketplace visibility: only applications with status
 * 'published' (and versions with status 'published') are ever returned by these functions.
 * Draft/validating/testing/suspended/deprecated applications are invisible to customers —
 * spec §47: untested applications never become available to customers.
 */
import type { Queryable } from '../db/types';
import { NotFoundError } from '../lib/errors';
import {
  countInstallationsForApplication,
  findApplicationBySlug,
  listApplications,
  listApplicationVersions,
  type ApplicationRow,
} from '../db/applications';
import { listCategories, findCategoryBySlug, type ApplicationCategoryRow } from '../db/application-categories';
import { toAppCardDTO, toAppDetailDTO, toCategoryDTO, type MarketplaceAppCardDTO, type MarketplaceCategoryDTO, type MarketplaceAppDetailDTO } from '../dto/marketplace';

async function categoryMap(db: Queryable): Promise<Map<string, ApplicationCategoryRow>> {
  const categories = await listCategories(db, false);
  return new Map(categories.map((c) => [c.id, c]));
}

export interface MarketplaceListOptions {
  category?: string;
  search?: string;
  featured?: boolean;
  sort?: 'popular' | 'recent' | 'name';
  limit?: number;
  offset?: number;
}

export async function listMarketplaceApps(
  db: Queryable,
  options: MarketplaceListOptions = {}
): Promise<{ apps: MarketplaceAppCardDTO[]; total: number }> {
  const categories = await categoryMap(db);
  let categoryId: string | undefined;
  if (options.category) {
    const category = await findCategoryBySlug(db, options.category);
    if (!category) return { apps: [], total: 0 };
    categoryId = category.id;
  }

  const { applications, total } = await listApplications(db, {
    status: 'published',
    categoryId,
    search: options.search,
    featuredOnly: options.featured,
    sort: options.sort,
    limit: options.limit,
    offset: options.offset,
  });

  const apps = await Promise.all(
    applications.map(async (app) => {
      const stable = (await listApplicationVersions(db, app.id, true)).find((v) => v.is_stable);
      const installCount = await countInstallationsForApplication(db, app.id);
      return toAppCardDTO(app, categories.get(app.category_id ?? '') ?? null, stable?.version ?? null, installCount);
    })
  );
  return { apps, total };
}

export async function listMarketplaceCategories(db: Queryable): Promise<MarketplaceCategoryDTO[]> {
  const categories = await listCategories(db, true);
  return categories.map(toCategoryDTO);
}

export async function getMarketplaceApp(db: Queryable, slug: string): Promise<MarketplaceAppDetailDTO> {
  const application = await findApplicationBySlug(db, slug);
  if (!application || application.status !== 'published') {
    // 404, never 403: an unpublished app's existence is not customer-visible information.
    throw new NotFoundError('No application was found with that identifier');
  }
  const categories = await categoryMap(db);
  const versions = await listApplicationVersions(db, application.id, true);
  const installCount = await countInstallationsForApplication(db, application.id);
  return toAppDetailDTO(
    application,
    categories.get(application.category_id ?? '') ?? null,
    versions,
    installCount
  );
}

/** Admin-facing listing (any status) — used by the admin applications page. */
export async function listAdminApplications(
  db: Queryable,
  options: MarketplaceListOptions = {}
): Promise<{ applications: ApplicationRow[]; total: number }> {
  return listApplications(db, {
    categorySlug: options.category,
    search: options.search,
    featuredOnly: options.featured,
    sort: options.sort,
    limit: options.limit,
    offset: options.offset,
  });
}

export async function getAdminApplicationDetail(db: Queryable, idOrSlug: string): Promise<{
  application: ApplicationRow;
  category: ApplicationCategoryRow | null;
  versions: Awaited<ReturnType<typeof listApplicationVersions>>;
  installCount: number;
}> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
  const application = isUuid
    ? (await findApplicationBySlug(db, idOrSlug)) ??
      (await db.query<ApplicationRow>(`SELECT * FROM applications WHERE id = $1`, [idOrSlug])).rows[0] ??
      null
    : await findApplicationBySlug(db, idOrSlug);
  if (!application) throw new NotFoundError('No application was found with that identifier');
  const categories = await categoryMap(db);
  return {
    application,
    category: categories.get(application.category_id ?? '') ?? null,
    versions: await listApplicationVersions(db, application.id, false),
    installCount: await countInstallationsForApplication(db, application.id),
  };
}
