/**
 * Phase 6 — admin marketplace management API (spec §22, §46, §47).
 *
 * Every route requires admin/super_admin, re-verified server-side per request (requireRole —
 * the frontend's role gate is convenience only). The approval workflow states are the only
 * legal status values an admin may move an application through:
 *
 *   draft → validating → testing → approved → published
 *   (any state) → suspended / deprecated
 *
 * 'publish' is refused while status is draft/validating/testing (spec §47: untested
 * applications must not become available to customers), and every transition is audit-logged.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { requireRole } from '../lib/require-role';
import { ValidationError, NotFoundError, ConflictError } from '../lib/errors';
import { auditRequest } from '../lib/audit';
import {
  createApplication,
  findApplicationBySlug,
  updateApplication,
} from '../db/applications';
import { createCategory, findCategoryBySlug, listCategories, updateCategory } from '../db/application-categories';
import { getAdminApplicationDetail, listAdminApplications } from '../services/marketplace-service';
import { loadManifestCatalog, validateManifestYaml, validatedManifests } from '../marketplace/manifest-loader';
import { importManifests, ensureCanonicalCategories } from '../marketplace/import-service';

const slugSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'slug must be lowercase letters, numbers, and single hyphens only');

const idSchema = z.string().uuid('id must be a valid UUID');

const createAppSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1).max(160),
  categorySlug: z.string().min(1).max(80),
  description: z.string().min(10).max(500),
  longDescription: z.string().max(8000).optional(),
  websiteUrl: z.string().url().optional(),
  repositoryUrl: z.string().url().optional(),
  documentationUrl: z.string().url().optional(),
  license: z.string().max(64).optional(),
  logoUrl: z.string().url().optional(),
  deploymentType: z.enum(['docker_compose', 'cpanel', 'kubernetes']).default('docker_compose'),
  supportedHostingTypes: z.array(z.enum(['shared', 'cpanel', 'vps', 'dedicated', 'docker', 'kubernetes'])).min(1),
  minCpu: z.coerce.number().int().min(1).default(1),
  minMemoryMb: z.coerce.number().int().min(64).default(512),
  minStorageMb: z.coerce.number().int().min(512).default(5120),
  featured: z.boolean().default(false),
  requiresAdminApproval: z.boolean().default(false),
});

const patchAppSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  categorySlug: z.string().min(1).max(80).optional(),
  description: z.string().min(10).max(500).optional(),
  longDescription: z.string().max(8000).nullable().optional(),
  websiteUrl: z.string().url().nullable().optional(),
  repositoryUrl: z.string().url().nullable().optional(),
  documentationUrl: z.string().url().nullable().optional(),
  license: z.string().max(64).nullable().optional(),
  logoUrl: z.string().url().nullable().optional(),
  supportedHostingTypes: z.array(z.enum(['shared', 'cpanel', 'vps', 'dedicated', 'docker', 'kubernetes'])).min(1).optional(),
  minCpu: z.coerce.number().int().min(1).optional(),
  minMemoryMb: z.coerce.number().int().min(64).optional(),
  minStorageMb: z.coerce.number().int().min(512).optional(),
  featured: z.boolean().optional(),
  requiresAdminApproval: z.boolean().optional(),
});

const categorySchema = z.object({
  name: z.string().min(1).max(80),
  slug: slugSchema,
  description: z.string().max(500).optional(),
  iconUrl: z.string().url().optional(),
  sortOrder: z.coerce.number().int().min(0).max(1000).optional(),
  active: z.boolean().optional(),
});

/** The approval-workflow states an admin can move an application to (spec §47). */
const WORKFLOW_TRANSITIONS: Record<string, string[]> = {
  draft: ['validating', 'testing', 'deprecated'],
  validating: ['testing', 'draft', 'deprecated'],
  testing: ['approved', 'draft', 'deprecated'],
  approved: ['published', 'draft', 'suspended', 'deprecated'],
  published: ['suspended', 'deprecated'],
  suspended: ['approved', 'published', 'deprecated'],
  deprecated: [],
};

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
  }
  return parsed.data;
}

export async function registerMarketplaceAdminRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  // --- Categories (spec §22) -----------------------------------------------------------------
  app.get('/api/v1/admin/app-categories', async (request) => {
    await requireRole(request, env, pool, ['admin', 'super_admin']);
    return { categories: await listCategories(pool, false) };
  });

  app.post('/api/v1/admin/app-categories', async (request, reply) => {
    const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
    const input = parseOrThrow(categorySchema, request.body);
    if (await findCategoryBySlug(pool, input.slug)) {
      throw new ConflictError(`Category "${input.slug}" already exists`);
    }
    const category = await createCategory(pool, input);
    await auditRequest(pool, request, auth.userId, {
      action: 'app_category.created',
      resourceType: 'application_category',
      resourceId: category.id,
      metadata: { slug: category.slug },
    });
    reply.code(201);
    return { category };
  });

  app.patch<{ Params: { id: string } }>('/api/v1/admin/app-categories/:id', async (request) => {
    const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
    const id = parseOrThrow(idSchema, request.params.id);
    const patch = parseOrThrow(categorySchema.partial(), request.body);
    const category = await updateCategory(pool, id, patch);
    if (!category) throw new NotFoundError('No category was found with that id');
    await auditRequest(pool, request, auth.userId, {
      action: 'app_category.updated',
      resourceType: 'application_category',
      resourceId: id,
      metadata: patch as Record<string, unknown>,
    });
    return { category };
  });

  // --- Applications (spec §46) ----------------------------------------------------------------
  app.get('/api/v1/admin/apps', async (request) => {
    await requireRole(request, env, pool, ['admin', 'super_admin']);
    const query = parseOrThrow(
      z.object({ search: z.string().max(120).optional(), category: z.string().max(80).optional() }),
      request.query ?? {}
    );
    const { applications, total } = await listAdminApplications(pool, {
      search: query.search?.trim() || undefined,
      category: query.category,
    });
    return { applications, total };
  });

  app.post('/api/v1/admin/apps', async (request, reply) => {
    const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
    const input = parseOrThrow(createAppSchema, request.body);
    if (await findApplicationBySlug(pool, input.slug)) {
      throw new ConflictError(`Application "${input.slug}" already exists`);
    }
    const category = await findCategoryBySlug(pool, input.categorySlug);
    if (!category) throw new ValidationError(`Category "${input.categorySlug}" does not exist`);
    const application = await createApplication(pool, {
      ...input,
      categoryId: category.id,
      slug: input.slug,
      status: 'draft', // applications always enter through the approval workflow
    });
    await auditRequest(pool, request, auth.userId, {
      action: 'app.created',
      resourceType: 'application',
      resourceId: application.id,
      metadata: { slug: application.slug },
    });
    reply.code(201);
    return { application };
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/apps/:id', async (request) => {
    await requireRole(request, env, pool, ['admin', 'super_admin']);
    const id = parseOrThrow(idSchema, request.params.id);
    return await getAdminApplicationDetail(pool, id);
  });

  app.patch<{ Params: { id: string } }>('/api/v1/admin/apps/:id', async (request) => {
    const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
    const id = parseOrThrow(idSchema, request.params.id);
    const patch = parseOrThrow(patchAppSchema, request.body);

    const update: Record<string, unknown> = { ...patch };
    if (patch.categorySlug) {
      const category = await findCategoryBySlug(pool, patch.categorySlug);
      if (!category) throw new ValidationError(`Category "${patch.categorySlug}" does not exist`);
      update.categoryId = category.id;
      delete update.categorySlug;
    }

    const application = await updateApplication(pool, id, update);
    if (!application) throw new NotFoundError('No application was found with that id');
    await auditRequest(pool, request, auth.userId, {
      action: 'app.updated',
      resourceType: 'application',
      resourceId: id,
      metadata: patch as Record<string, unknown>,
    });
    return { application };
  });

  /**
   * Approval workflow transition (spec §47): draft → validating → testing → approved →
   * published. Publishing an application that has not passed the workflow is refused here —
   * the server, not the UI, enforces it.
   */
  app.post<{ Params: { id: string } }>('/api/v1/admin/apps/:id/status', async (request) => {
    const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
    const id = parseOrThrow(idSchema, request.params.id);
    const { status } = parseOrThrow(z.object({ status: z.enum(['draft', 'validating', 'testing', 'approved', 'published', 'suspended', 'deprecated']) }), request.body);

    const detail = await getAdminApplicationDetail(pool, id);
    const current = detail.application.status;
    if (current === status) return { application: detail.application };
    if (!(WORKFLOW_TRANSITIONS[current] ?? []).includes(status)) {
      throw new ConflictError(`Illegal application workflow transition: ${current} → ${status}`);
    }
    if (status === 'published') {
      // Publishing additionally requires at least one published version — an app with no
      // deployable version would 404 every install attempt.
      if (!detail.versions.some((v) => v.status === 'published')) {
        throw new ValidationError('Publish an application version before publishing the application');
      }
    }
    const application = await updateApplication(pool, id, { status });
    if (!application) throw new NotFoundError('No application was found with that id');
    await auditRequest(pool, request, auth.userId, {
      action: `app.status.${status}`,
      resourceType: 'application',
      resourceId: id,
      metadata: { from: current, to: status },
    });
    return { application };
  });

  // --- Version workflow (spec §43): draft → published → deprecated, one stable at a time ------
  const VERSION_TRANSITIONS: Record<string, string[]> = {
    draft: ['published', 'deprecated'],
    published: ['deprecated'],
    deprecated: [],
  };

  app.patch<{ Params: { id: string; versionId: string } }>('/api/v1/admin/apps/:id/versions/:versionId', async (request) => {
    const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
    const id = parseOrThrow(idSchema, request.params.id);
    const versionId = parseOrThrow(idSchema, (request.params as { versionId: string }).versionId);
    const patch = parseOrThrow(
      z.object({
        status: z.enum(['draft', 'published', 'deprecated']).optional(),
        isStable: z.boolean().optional(),
        releaseNotes: z.string().max(4000).nullable().optional(),
      }),
      request.body
    );

    const detail = await getAdminApplicationDetail(pool, id);
    const version = detail.versions.find((v) => v.id === versionId);
    if (!version) throw new NotFoundError('No application version was found with that id');

    if (patch.status && patch.status !== version.status) {
      if (!(VERSION_TRANSITIONS[version.status] ?? []).includes(patch.status)) {
        throw new ConflictError(`Illegal version transition: ${version.status} → ${patch.status}`);
      }
    }
    const resultingStatus = patch.status ?? version.status;
    if (patch.isStable && resultingStatus !== 'published') {
      // Only a published version can be the stable one customers install by default.
      throw new ValidationError('Publish the version before marking it stable');
    }

    // "One stable" invariant: marking a version stable demotes every other version of the app.
    if (patch.isStable) {
      await pool.query(
        `UPDATE application_versions SET is_stable = false, updated_at = now()
         WHERE application_id = $1 AND id <> $2 AND is_stable = true`,
        [id, versionId]
      );
    }
    const { rows } = await pool.query(
      `UPDATE application_versions SET
         status = COALESCE($2, status),
         is_stable = COALESCE($3, is_stable),
         release_notes = COALESCE($4, release_notes),
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [versionId, patch.status ?? null, patch.isStable ?? null, patch.releaseNotes ?? null]
    );
    const updated = rows[0];
    if (!updated) throw new NotFoundError('No application version was found with that id');
    await auditRequest(pool, request, auth.userId, {
      action: 'app.version.updated',
      resourceType: 'application_version',
      resourceId: versionId,
      metadata: { applicationId: id, version: updated.version, ...patch },
    });
    return { version: updated };
  });

  app.delete<{ Params: { id: string } }>('/api/v1/admin/apps/:id', async (request, reply) => {
    const auth = await requireRole(request, env, pool, ['super_admin']);
    const id = parseOrThrow(idSchema, request.params.id);
    const detail = await getAdminApplicationDetail(pool, id);
    if (detail.installCount > 0) {
      // Customers run this application — deprecate instead of delete; history must survive.
      throw new ConflictError(
        `${detail.installCount} installation(s) exist for this application — mark it deprecated instead (installations and audit history must survive)`
      );
    }
    await pool.query(`DELETE FROM applications WHERE id = $1`, [id]);
    await auditRequest(pool, request, auth.userId, {
      action: 'app.deleted',
      resourceType: 'application',
      resourceId: id,
      metadata: { slug: detail.application.slug },
    });
    reply.code(204);
    return null;
  });

  // --- Manifest tooling (spec §46: upload/validate/import) --------------------------------------
  app.post('/api/v1/admin/manifests/validate', async (request) => {
    await requireRole(request, env, pool, ['admin', 'super_admin']);
    const { manifestYaml } = parseOrThrow(z.object({ manifestYaml: z.string().min(1).max(200_000) }), request.body);
    const result = validateManifestYaml(manifestYaml);
    return { valid: result.valid, errors: result.errors };
  });

  app.post('/api/v1/admin/manifests/import', async (request, reply) => {
    const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
    const catalog = loadManifestCatalog(undefined, env.MARKETPLACE_MANIFESTS_DIR);
    if (catalog.invalid.length > 0) {
      throw new ValidationError(
        `Refusing to import: ${catalog.invalid.length} invalid manifest(s): ` +
          catalog.invalid.map((i) => `${i.source} (${i.errors[0]})`).join('; ')
      );
    }
    if (catalog.loaded.length === 0) {
      throw new ValidationError(`No manifests found in ${catalog.dir}`);
    }
    const report = await importManifests(pool, validatedManifests(catalog));
    await auditRequest(pool, request, auth.userId, {
      action: 'marketplace.imported',
      resourceType: 'marketplace',
      metadata: { ...report, dir: catalog.dir },
    });
    reply.code(200);
    return { imported: catalog.loaded.length, report };
  });

  app.post('/api/v1/admin/manifests/seed-categories', async (request) => {
    await requireRole(request, env, pool, ['admin', 'super_admin']);
    const created = await ensureCanonicalCategories(pool);
    return { created };
  });
}
