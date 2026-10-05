/**
 * Marketplace admin — manage application categories and applications.
 *
 * Ported from cloudhost247-node/src/routes/marketplace-admin.ts. Admin/staff CRUD over the
 * catalogue the public marketplace browses.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError, ConflictError, ValidationError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { asAdmin, asStaff, asSuperAdmin } = require('../lib/auth');
const {
  resolveManifestsDir, loadManifestCatalog, validateManifestYaml, validatedManifests,
  ensureCanonicalCategories, importManifests,
} = require('../lib/manifest-catalog');

const name = 'marketplace-admin';

const slugSchema = () => v.string().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const HOSTING_TYPES = ['shared', 'cpanel', 'vps', 'dedicated', 'docker', 'kubernetes'];
const APP_STATUSES = ['draft', 'validating', 'testing', 'approved', 'published', 'suspended', 'deprecated'];
// Approval-workflow transitions an admin may make (spec §47); the server enforces them.
const WORKFLOW_TRANSITIONS = {
  draft: ['validating', 'testing', 'deprecated'],
  validating: ['testing', 'draft', 'deprecated'],
  testing: ['approved', 'draft', 'deprecated'],
  approved: ['published', 'draft', 'suspended', 'deprecated'],
  published: ['suspended', 'deprecated'],
  suspended: ['approved', 'published', 'deprecated'],
  deprecated: [],
};
const VERSION_TRANSITIONS = { draft: ['published', 'deprecated'], published: ['deprecated'], deprecated: [] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function publicApp(row) {
  return { id: row.id, name: row.name, slug: row.slug, categoryId: row.category_id, version: row.version, priceCents: row.price_cents, active: row.active };
}

function register(router, deps) {
  const { store, config = {} } = deps;
  const manifestsDir = () => resolveManifestsDir(config.MARKETPLACE_MANIFESTS_DIR, config.CWD ?? process.cwd());

  /**
   * The original's category surface (marketplace-admin.ts). Unlike the platform's
   * /admin/marketplace/categories aliases below, these list every category including inactive
   * ones, order by sort_order then name, and treat the slug as case-insensitively unique.
   */
  const categorySchema = v.object({
    name: v.string().min(1).max(80),
    slug: v.string().min(1).max(160).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    description: v.string().max(500).optional(),
    iconUrl: v.string().url().optional(),
    sortOrder: v.coerce.number().int().min(0).max(1000).optional(),
    active: v.boolean().optional(),
  });

  router.get('/api/v1/admin/app-categories', async (ctx) => {
    await asAdmin(ctx, deps);
    const { rows } = await store.table('application_categories').find({}, { orderBy: ['sort_order', 'name'] });
    ctx.json({ categories: rows });
  });

  router.post('/api/v1/admin/app-categories', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const input = await ctx.validate(categorySchema);

    if (await store.table('application_categories').findOne({ slug: input.slug.toLowerCase() })) {
      throw new ConflictError(`Category "${input.slug}" already exists`);
    }

    const category = await store.table('application_categories').insert({
      id: uuidv7(),
      name: input.name,
      slug: input.slug,
      description: input.description ?? null,
      icon_url: input.iconUrl ?? null,
      sort_order: input.sortOrder ?? 0,
      active: input.active ?? true,
    });

    await store.table('audit_logs').insert({
      id: uuidv7(), actor_id: auth.id, actor_role: auth.role,
      action: 'app_category.created', entity_type: 'application_category', entity_id: category.id,
      ip_address: ctx.ip, user_agent: ctx.userAgent, after: { slug: category.slug },
    });
    ctx.code(201).json({ category });
  });

  router.patch('/api/v1/admin/app-categories/:id', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    if (!UUID_RE.test(String(ctx.params.id ?? ''))) throw new ValidationError('id must be a valid UUID');
    const patch = await ctx.validate(categorySchema.partial());

    const existing = await store.table('application_categories').findById(ctx.params.id);
    if (!existing) throw new NotFoundError('No category was found with that id');

    const fields = {};
    if (patch.name !== undefined) fields.name = patch.name;
    if (patch.description !== undefined) fields.description = patch.description;
    if (patch.iconUrl !== undefined) fields.icon_url = patch.iconUrl;
    if (patch.sortOrder !== undefined) fields.sort_order = patch.sortOrder;
    if (patch.active !== undefined) fields.active = patch.active;
    if (patch.slug !== undefined) {
      const clash = await store.table('application_categories').findOne({ slug: patch.slug.toLowerCase() });
      if (clash && clash.id !== existing.id) throw new ConflictError(`Category "${patch.slug}" already exists`);
      fields.slug = patch.slug;
    }

    const category = await store.table('application_categories').updateById(existing.id, fields);
    await store.table('audit_logs').insert({
      id: uuidv7(), actor_id: auth.id, actor_role: auth.role,
      action: 'app_category.updated', entity_type: 'application_category', entity_id: existing.id,
      ip_address: ctx.ip, user_agent: ctx.userAgent, after: patch,
    });
    ctx.json({ category });
  });

  // ---- categories ---------------------------------------------------------
  router.get('/api/v1/admin/marketplace/categories', async (ctx) => {
    await asAdmin(ctx, deps);
    const rows = await store.table('application_categories').all();
    ctx.json({ categories: rows });
  });

  router.post('/api/v1/admin/marketplace/categories', async (ctx) => {
    await asStaff(ctx, deps);
    const body = await ctx.validate(v.object({ name: v.string().trim().min(1).max(120), slug: v.string().trim().min(1).max(120) }));
    const row = await store.table('application_categories').insert({ id: uuidv7(), name: body.name, slug: body.slug, active: true });
    ctx.code(201).json({ category: row });
  });

  router.delete('/api/v1/admin/marketplace/categories/:id', async (ctx) => {
    await asAdmin(ctx, deps);
    await store.table('application_categories').deleteById(ctx.params.id);
    ctx.json({ ok: true });
  });

  // ---- applications -------------------------------------------------------
  router.get('/api/v1/admin/marketplace/apps', async (ctx) => {
    await asAdmin(ctx, deps);
    const { rows, total } = await store.table('applications').find({}, { orderBy: '-created_at', limit: 200 });
    ctx.json({ apps: rows.map(publicApp), total });
  });

  router.post('/api/v1/admin/marketplace/apps', async (ctx) => {
    await asStaff(ctx, deps);
    const body = await ctx.validate(v.object({
      name: v.string().trim().min(1).max(120),
      slug: v.string().trim().min(1).max(120),
      categoryId: v.string().optional(),
      version: v.string().trim().max(40).optional(),
      description: v.string().trim().max(2000).optional(),
      priceCents: v.coerce.number().int().min(0).default(0),
    }));
    const app = await store.table('applications').insert({
      id: uuidv7(), name: body.name, slug: body.slug, category_id: body.categoryId ?? null,
      version: body.version ?? null, description: body.description ?? null,
      price_cents: body.priceCents, active: true,
    });
    ctx.code(201).json({ app: publicApp(app) });
  });

  router.patch('/api/v1/admin/marketplace/apps/:id', async (ctx) => {
    await asStaff(ctx, deps);
    const app = await store.table('applications').findById(ctx.params.id);
    if (!app) throw new NotFoundError('Application not found');
    const body = await ctx.validate(v.object({
      name: v.string().trim().min(1).max(120).optional(),
      version: v.string().trim().max(40).optional(),
      priceCents: v.coerce.number().int().min(0).optional(),
      active: v.boolean().optional(),
      description: v.string().trim().max(2000).optional(),
    }));
    const patch = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.version !== undefined) patch.version = body.version;
    if (body.priceCents !== undefined) patch.price_cents = body.priceCents;
    if (body.active !== undefined) patch.active = body.active;
    if (body.description !== undefined) patch.description = body.description;
    const updated = await store.table('applications').updateById(app.id, patch);
    ctx.json({ app: publicApp(updated) });
  });

  router.delete('/api/v1/admin/marketplace/apps/:id', async (ctx) => {
    await asAdmin(ctx, deps);
    await store.table('applications').deleteById(ctx.params.id);
    ctx.json({ ok: true });
  });

  // ===========================================================================
  // Original marketplace-admin /admin/apps surface (approval workflow, spec §43/§47).
  // ===========================================================================

  async function audit(ctx, action, resourceType, resourceId, metadata) {
    await store.table('audit_logs').insert({
      id: uuidv7(), actor_id: ctx.user.id, actor_role: ctx.user.role, action,
      entity_type: resourceType, entity_id: resourceId ?? null,
      ip_address: ctx.ip, user_agent: ctx.userAgent, after: metadata ?? null,
    });
  }
  const appDto = (a) => ({
    id: a.id, slug: a.slug, name: a.name, categoryId: a.category_id ?? null, description: a.description ?? null,
    longDescription: a.long_description ?? null, websiteUrl: a.website_url ?? null, repositoryUrl: a.repository_url ?? null,
    documentationUrl: a.documentation_url ?? null, license: a.license ?? null, logoUrl: a.logo_url ?? null,
    deploymentType: a.deployment_type ?? 'docker_compose', supportedHostingTypes: a.supported_hosting_types ?? [],
    minCpu: a.min_cpu ?? 1, minMemoryMb: a.min_memory_mb ?? 512, minStorageMb: a.min_storage_mb ?? 5120,
    featured: a.featured ?? false, requiresAdminApproval: a.requires_admin_approval ?? false, status: a.status,
    createdAt: a.created_at, updatedAt: a.updated_at,
  });
  const versionDto = (ver) => ({
    id: ver.id, applicationId: ver.application_id, version: ver.version, releaseNotes: ver.release_notes ?? null,
    isStable: ver.is_stable ?? false, status: ver.status, createdAt: ver.created_at, updatedAt: ver.updated_at,
  });
  async function appDetail(id) {
    const application = await store.table('applications').findById(id);
    if (!application) throw new NotFoundError('No application was found with that id');
    const versions = (await store.table('application_versions').all()).filter((ver) => ver.application_id === id);
    const installCount = (await store.table('application_installations').all()).filter((i) => i.application_id === id).length;
    return { application: appDto(application), versions: versions.map(versionDto), installCount };
  }

  const createAppSchema = () => v.object({
    slug: slugSchema(),
    name: v.string().min(1).max(160),
    categorySlug: v.string().min(1).max(80),
    description: v.string().min(10).max(500),
    longDescription: v.string().max(8000).optional(),
    websiteUrl: v.string().max(500).optional(),
    repositoryUrl: v.string().max(500).optional(),
    documentationUrl: v.string().max(500).optional(),
    license: v.string().max(64).optional(),
    logoUrl: v.string().max(500).optional(),
    deploymentType: v.enum(['docker_compose', 'cpanel', 'kubernetes']).default('docker_compose'),
    supportedHostingTypes: v.array(v.enum(HOSTING_TYPES)).min(1),
    minCpu: v.coerce.number().int().min(1).default(1),
    minMemoryMb: v.coerce.number().int().min(64).default(512),
    minStorageMb: v.coerce.number().int().min(512).default(5120),
    featured: v.boolean().default(false),
    requiresAdminApproval: v.boolean().default(false),
  });

  router.get('/api/v1/admin/apps', async (ctx) => {
    await asAdmin(ctx, deps);
    const query = await ctx.validateQuery(v.object({ search: v.string().max(120).optional(), category: v.string().max(80).optional() }));
    let rows = await store.table('applications').all();
    if (query.search) { const s = query.search.trim().toLowerCase(); rows = rows.filter((a) => `${a.name} ${a.slug}`.toLowerCase().includes(s)); }
    if (query.category) {
      const cat = await store.table('application_categories').findOne({ slug: query.category });
      rows = rows.filter((a) => a.category_id === cat?.id);
    }
    ctx.json({ applications: rows.map(appDto), total: rows.length });
  });

  router.post('/api/v1/admin/apps', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const input = await ctx.validate(createAppSchema());
    if (await store.table('applications').findOne({ slug: input.slug })) throw new ConflictError(`Application "${input.slug}" already exists`);
    const category = await store.table('application_categories').findOne({ slug: input.categorySlug });
    if (!category) throw new ValidationError(`Category "${input.categorySlug}" does not exist`);
    const application = await store.table('applications').insert({
      id: uuidv7(), slug: input.slug, name: input.name, category_id: category.id, description: input.description,
      long_description: input.longDescription ?? null, website_url: input.websiteUrl ?? null, repository_url: input.repositoryUrl ?? null,
      documentation_url: input.documentationUrl ?? null, license: input.license ?? null, logo_url: input.logoUrl ?? null,
      deployment_type: input.deploymentType, supported_hosting_types: input.supportedHostingTypes,
      min_cpu: input.minCpu, min_memory_mb: input.minMemoryMb, min_storage_mb: input.minStorageMb,
      featured: input.featured, requires_admin_approval: input.requiresAdminApproval, status: 'draft',
    });
    await audit(ctx, 'app.created', 'application', application.id, { slug: application.slug });
    ctx.code(201).json({ application: appDto(application) });
  });

  router.get('/api/v1/admin/apps/:id', async (ctx) => {
    await asAdmin(ctx, deps);
    ctx.json(await appDetail(ctx.params.id));
  });

  router.patch('/api/v1/admin/apps/:id', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const id = ctx.params.id;
    const patch = await ctx.validate(createAppSchema().omit(['slug', 'categorySlug', 'deploymentType']).partial().extend({
      categorySlug: v.string().min(1).max(80).optional(),
    }));
    const current = await store.table('applications').findById(id);
    if (!current) throw new NotFoundError('No application was found with that id');
    const fields = {};
    for (const [k, col] of [['name', 'name'], ['description', 'description'], ['longDescription', 'long_description'], ['websiteUrl', 'website_url'], ['repositoryUrl', 'repository_url'], ['documentationUrl', 'documentation_url'], ['license', 'license'], ['logoUrl', 'logo_url'], ['supportedHostingTypes', 'supported_hosting_types'], ['minCpu', 'min_cpu'], ['minMemoryMb', 'min_memory_mb'], ['minStorageMb', 'min_storage_mb'], ['featured', 'featured'], ['requiresAdminApproval', 'requires_admin_approval']]) {
      if (patch[k] !== undefined) fields[col] = patch[k];
    }
    if (patch.categorySlug !== undefined) {
      const category = await store.table('application_categories').findOne({ slug: patch.categorySlug });
      if (!category) throw new ValidationError(`Category "${patch.categorySlug}" does not exist`);
      fields.category_id = category.id;
    }
    const application = await store.table('applications').updateById(id, fields);
    await audit(ctx, 'app.updated', 'application', id, patch);
    ctx.json({ application: appDto(application) });
  });

  router.post('/api/v1/admin/apps/:id/status', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const id = ctx.params.id;
    const { status } = await ctx.validate(v.object({ status: v.enum(APP_STATUSES) }));
    const detail = await appDetail(id);
    const current = detail.application.status;
    if (current === status) return ctx.json({ application: detail.application });
    if (!(WORKFLOW_TRANSITIONS[current] ?? []).includes(status)) throw new ConflictError(`Illegal application workflow transition: ${current} → ${status}`);
    if (status === 'published' && !detail.versions.some((ver) => ver.status === 'published')) throw new ValidationError('Publish an application version before publishing the application');
    const application = await store.table('applications').updateById(id, { status });
    await audit(ctx, `app.status.${status}`, 'application', id, { from: current, to: status });
    ctx.json({ application: appDto(application) });
  });

  router.patch('/api/v1/admin/apps/:id/versions/:versionId', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const id = ctx.params.id;
    const versionId = ctx.params.versionId;
    const patch = await ctx.validate(v.object({
      status: v.enum(['draft', 'published', 'deprecated']).optional(),
      isStable: v.boolean().optional(),
      releaseNotes: v.string().max(4000).nullable().optional(),
    }));
    const version = (await store.table('application_versions').all()).find((ver) => ver.id === versionId && ver.application_id === id);
    if (!version) throw new NotFoundError('No application version was found with that id');
    if (patch.status && patch.status !== version.status && !(VERSION_TRANSITIONS[version.status] ?? []).includes(patch.status)) throw new ConflictError(`Illegal version transition: ${version.status} → ${patch.status}`);
    const resultingStatus = patch.status ?? version.status;
    if (patch.isStable && resultingStatus !== 'published') throw new ValidationError('Publish the version before marking it stable');
    // "One stable" invariant: marking a version stable demotes every other version of the app.
    if (patch.isStable) {
      for (const other of (await store.table('application_versions').all()).filter((ver) => ver.application_id === id && ver.id !== versionId && ver.is_stable)) {
        await store.table('application_versions').updateById(other.id, { is_stable: false });
      }
    }
    const fields = {};
    if (patch.status !== undefined) fields.status = patch.status;
    if (patch.isStable !== undefined) fields.is_stable = patch.isStable;
    if (patch.releaseNotes !== undefined) fields.release_notes = patch.releaseNotes;
    const updated = await store.table('application_versions').updateById(versionId, fields);
    await audit(ctx, 'app.version.updated', 'application_version', versionId, { applicationId: id, version: updated.version, ...patch });
    ctx.json({ version: versionDto(updated) });
  });

  router.delete('/api/v1/admin/apps/:id', async (ctx) => {
    const auth = await asSuperAdmin(ctx, deps);
    const id = ctx.params.id;
    const detail = await appDetail(id);
    if (detail.installCount > 0) throw new ConflictError(`${detail.installCount} installation(s) exist for this application — mark it deprecated instead (installations and audit history must survive)`);
    await store.table('applications').deleteById(id);
    await audit(ctx, 'app.deleted', 'application', id, { slug: detail.application.slug });
    ctx.noContent();
  });

  // ---- manifests (spec §10, §46) ------------------------------------------
  /**
   * Validates a manifest without importing anything. The YAML is parsed by the dependency-free
   * subset parser in lib/yaml.js, so a document using an unsupported construct is reported as a
   * parse error rather than being silently misread.
   */
  router.post('/api/v1/admin/manifests/validate', async (ctx) => {
    await asAdmin(ctx, deps);
    const body = await ctx.validate(v.object({ manifestYaml: v.string().min(1).max(200000) }));
    const result = validateManifestYaml(body.manifestYaml);
    ctx.json({ valid: result.valid, errors: result.errors });
  });

  /**
   * Imports the whole on-disk catalog. The original refuses to import when any file in the
   * directory is invalid — a partially imported catalog is harder to reason about than none.
   */
  router.post('/api/v1/admin/manifests/import', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const catalog = loadManifestCatalog(manifestsDir());
    if (catalog.invalid.length > 0) {
      throw new ValidationError(
        `Refusing to import: ${catalog.invalid.length} invalid manifest(s): `
        + catalog.invalid.map((i) => `${i.source} (${i.errors[0]})`).join('; '),
      );
    }
    if (catalog.loaded.length === 0) throw new ValidationError(`No manifests found in ${catalog.dir}`);
    const report = await importManifests(store, validatedManifests(catalog));
    await audit(ctx, 'marketplace.imported', 'marketplace', null, { ...report, dir: catalog.dir });
    ctx.json({ imported: catalog.loaded.length, report });
  });

  /** Seeds the canonical category tree (spec §7); existing rows, including admin edits, are kept. */
  router.post('/api/v1/admin/manifests/seed-categories', async (ctx) => {
    await asAdmin(ctx, deps);
    ctx.json({ created: await ensureCanonicalCategories(store) });
  });
}

module.exports = { name, register };
