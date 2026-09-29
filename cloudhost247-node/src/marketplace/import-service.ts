/**
 * Phase 6 — manifest catalog importer (spec §8: "The catalog supplied must be imported into this
 * system… the catalog must be database-driven").
 *
 * Upsert semantics — importing is repeatable and non-destructive:
 *   - Categories: missing canonical/category-referenced rows are inserted; existing rows are
 *     never overwritten (admins may have renamed/reordered them).
 *   - Applications: inserted when the slug is new; otherwise metadata fields are refreshed and
 *     requirements/hosting-type/compatibility updated to the manifest. `status` is NEVER touched
 *     on existing rows — an admin's publish/suspend decision survives re-imports (spec §47:
 *     untested applications must not silently become available).
 *   - Versions: upserted on (application_id, version) with the manifest document snapshotted.
 *
 * The importer refuses to run at all when ANY manifest in the directory is invalid — a catalog
 * that half-imports is worse than one that doesn't import.
 */
import type { Queryable } from '../db/types';
import { withTransaction } from '../db/transaction';
import { CANONICAL_CATEGORIES } from './categories';
import type { ApplicationManifest } from './manifest-schema';
import { createCategory, findCategoryBySlug, listCategories } from '../db/application-categories';
import {
  createApplication,
  findApplicationBySlug,
  updateApplication,
  upsertApplicationVersion,
} from '../db/applications';

export interface ImportReport {
  categoriesCreated: string[];
  applicationsCreated: string[];
  applicationsUpdated: string[];
  versionsUpserted: number;
}

/** Idempotently ensures the canonical category rows exist (also used by the seed script). */
export async function ensureCanonicalCategories(db: Queryable): Promise<string[]> {
  const created: string[] = [];
  for (const canonical of CANONICAL_CATEGORIES) {
    const existing = await findCategoryBySlug(db, canonical.slug);
    if (!existing) {
      await createCategory(db, {
        name: canonical.name,
        slug: canonical.slug,
        description: canonical.description,
        sortOrder: canonical.sortOrder,
        active: true,
      });
      created.push(canonical.slug);
    }
  }
  return created;
}

/** Imports one validated manifest. Returns which entities were created vs updated. */
export async function importManifest(db: Queryable, manifest: ApplicationManifest): Promise<ImportReport> {
  return withTransaction(db, async (tx) => {
    const report: ImportReport = {
      categoriesCreated: [],
      applicationsCreated: [],
      applicationsUpdated: [],
      versionsUpserted: 0,
    };

    // Category: create when referenced but missing (non-canonical categories get sortOrder 500).
    let category = await findCategoryBySlug(tx, manifest.category);
    if (!category) {
      const canonical = CANONICAL_CATEGORIES.find((c) => c.slug === manifest.category);
      category = await createCategory(tx, {
        name: canonical?.name ?? manifest.category,
        slug: manifest.category,
        description: canonical?.description ?? null,
        sortOrder: canonical?.sortOrder ?? 500,
        active: true,
      });
      report.categoriesCreated.push(category.slug);
    }

    const existing = await findApplicationBySlug(tx, manifest.id);
    const fields = {
      categoryId: category.id,
      name: manifest.name,
      description: manifest.description,
      longDescription: manifest.longDescription ?? null,
      logoUrl: manifest.logo ?? null,
      websiteUrl: manifest.website ?? null,
      repositoryUrl: manifest.repository ?? null,
      documentationUrl: manifest.documentation ?? null,
      license: manifest.license ?? null,
      deploymentType: manifest.deployment.engine === 'cpanel' ? 'cpanel' : manifest.deployment.engine === 'kubernetes' ? 'kubernetes' : 'docker_compose',
      featured: manifest.featured,
      popularity: manifest.popularity,
      requiresAdminApproval: manifest.requiresAdminApproval,
      minCpu: manifest.requirements.cpu,
      minMemoryMb: manifest.requirements.memory,
      minStorageMb: manifest.requirements.storage,
      recommendedCpu: manifest.requirements.recommendedCpu ?? manifest.requirements.cpu,
      recommendedMemoryMb: manifest.requirements.recommendedMemory ?? manifest.requirements.memory,
      recommendedStorageMb: manifest.requirements.recommendedStorage ?? manifest.requirements.storage,
      gpuRequired: manifest.requirements.gpu ?? false,
      supportedHostingTypes: manifest.supportedHostingTypes,
    };

    let applicationId: string;
    if (!existing) {
      // Newly imported applications start in draft: the approval workflow (spec §47) — not the
      // importer — moves them to published.
      const created = await createApplication(tx, { ...fields, slug: manifest.id, status: 'draft' });
      applicationId = created.id;
      report.applicationsCreated.push(created.slug);
    } else {
      const updated = await updateApplication(tx, existing.id, fields);
      applicationId = updated?.id ?? existing.id;
      report.applicationsUpdated.push(existing.slug);
    }

    for (const version of manifest.versions) {
      await upsertApplicationVersion(tx, {
        applicationId,
        version: version.version,
        dockerImage: version.image,
        manifest,
        minimumCpu: version.requirements?.cpu ?? manifest.requirements.cpu,
        minimumMemoryMb: version.requirements?.memory ?? manifest.requirements.memory,
        minimumStorageMb: version.requirements?.storage ?? manifest.requirements.storage,
        releaseNotes: version.releaseNotes ?? null,
        // Version publication also follows the approval workflow: imported versions are drafts.
        status: 'draft',
        isStable: version.stable ?? false,
      });
      report.versionsUpserted += 1;
    }

    return report;
  });
}

/**
 * Imports a full set of validated manifests. First ensures every canonical category exists, then
 * imports each manifest in its own transaction (one bad manifest cannot roll back the others —
 * the caller pre-validates the whole directory, so reaching here means every manifest validated).
 */
export async function importManifests(
  db: Queryable,
  manifests: ApplicationManifest[]
): Promise<ImportReport> {
  const combined: ImportReport = {
    categoriesCreated: [],
    applicationsCreated: [],
    applicationsUpdated: [],
    versionsUpserted: 0,
  };

  const canonicalCreated = await ensureCanonicalCategories(db);
  combined.categoriesCreated.push(...canonicalCreated);

  for (const manifest of manifests) {
    const report = await importManifest(db, manifest);
    combined.categoriesCreated.push(...report.categoriesCreated);
    combined.applicationsCreated.push(...report.applicationsCreated);
    combined.applicationsUpdated.push(...report.applicationsUpdated);
    combined.versionsUpserted += report.versionsUpserted;
  }
  return combined;
}
