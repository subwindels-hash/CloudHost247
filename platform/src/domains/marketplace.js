/**
 * Marketplace & catalog surface: applications, control panels, operating systems.
 *
 * Honesty contract (rebuild spec §53/§54): the database is the source of truth.
 *  - Applications are seeded from the REAL deployment manifests
 *    (cloudhost247-node/manifests/, docs/PHASE_6_MARKETPLACE_DEPLOYMENTS.md).
 *  - Control panels and OS entries start EMPTY: an operator must configure them,
 *    and only entries explicitly enabled ever publish. Nothing invents a product.
 * Writes are admin-gated and audited, matching the content domain.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError, ValidationError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { asAdmin } = require('../lib/auth');

const name = 'marketplace';

const CATEGORY_LABELS = {
  cms: 'CMS', 'e-commerce': 'E-commerce', database: 'Databases', analytics: 'Analytics',
  crm: 'CRM', business: 'Business', productivity: 'Productivity', 'developer-tools': 'Development',
  infrastructure: 'Infrastructure', monitoring: 'Monitoring', security: 'Security',
  networking: 'Networking', storage: 'Storage', communication: 'Communication',
  'project-management': 'Project Management', automation: 'Automation', ai: 'AI',
  media: 'Media', documents: 'Documents', education: 'Education', finance: 'Finance',
  'home-automation': 'Home Automation', 'system-administration': 'System Administration',
};

const slugSchema = v
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9.]+)*$/, 'slug must be lowercase letters, numbers, dots and single hyphens');

const appInputSchema = v.object({
  slug: slugSchema,
  name: v.string().min(1).max(120),
  category: v.string().min(1).max(60).default('general'),
  summary: v.string().max(500).optional(),
  featured: v.boolean().default(false),
  hostingTypes: v.array(v.string().max(40)).max(12).default([]),
  status: v.enum(['active', 'hidden']).default('active'),
});

const panelInputSchema = v.object({
  slug: slugSchema,
  name: v.string().min(1).max(120),
  summary: v.string().max(500).optional(),
  services: v.array(v.string().max(60)).max(12).default([]),
  status: v.enum(['active', 'hidden']).default('active'),
});

const osInputSchema = v.object({
  slug: slugSchema,
  family: v.enum(['linux', 'windows', 'specialized']),
  name: v.string().min(1).max(120),
  version: v.string().max(40).optional(),
  architectures: v.array(v.string().max(20)).max(6).default([]),
  products: v.array(v.string().max(60)).max(12).default([]),
  status: v.enum(['draft', 'enabled']).default('draft'),
});

function register(router, deps) {
  const { store } = deps;
  const apps = () => store.table('marketplace_applications');
  const panels = () => store.table('control_panels');
  const oses = () => store.table('operating_systems');

  const auditWrite = async (ctx, auth, action, entityType, entityId) => {
    await store.table('audit_logs').insert({
      id: uuidv7(), actor_id: auth.id, actor_role: auth.role,
      action, entity_type: entityType, entity_id: entityId,
      ip_address: ctx.ip, user_agent: ctx.userAgent,
    });
  };

  /* ---------------- public reads ---------------- */

  router.get('/api/v1/public/applications', async (ctx) => {
    const query = await ctx.validateQuery(v.object({
      category: v.string().max(60).optional(),
      q: v.string().max(120).optional(),
      featured: v.enum(['true']).optional(),
    }));
    let rows = (await apps().all()).filter((r) => r.status === 'active');
    if (query.category) rows = rows.filter((r) => r.category === query.category);
    if (query.featured) rows = rows.filter((r) => r.featured === true);
    if (query.q) {
      const needle = query.q.toLowerCase();
      rows = rows.filter((r) => [r.name, r.summary, r.category]
        .some((field) => String(field ?? '').toLowerCase().includes(needle)));
    }
    rows.sort((a, b) => ((b.featured === true) - (a.featured === true)) || String(a.name).localeCompare(String(b.name)));
    ctx.json({
      applications: rows.slice(0, 200).map((r) => ({
        slug: r.slug, name: r.name, category: r.category,
        categoryLabel: CATEGORY_LABELS[r.category] ?? r.category,
        summary: r.summary, featured: r.featured === true, hostingTypes: r.hosting_types ?? [],
      })),
      categories: Object.entries(CATEGORY_LABELS).map(([slug, label]) => ({ slug, label })),
    });
  });

  router.get('/api/v1/public/control-panels', async (ctx) => {
    const rows = (await panels().all()).filter((r) => r.status === 'active');
    rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    ctx.json({ panels: rows.map((r) => ({ slug: r.slug, name: r.name, summary: r.summary, services: r.services ?? [] })) });
  });

  router.get('/api/v1/public/operating-systems', async (ctx) => {
    // Only ENABLED OS versions publish — drafts/unverified images never leak.
    const rows = (await oses().all()).filter((r) => r.status === 'enabled');
    rows.sort((a, b) => String(a.family).localeCompare(String(b.family)) || String(a.name).localeCompare(String(b.name)));
    ctx.json({
      operatingSystems: rows.map((r) => ({
        slug: r.slug, family: r.family, name: r.name, version: r.version,
        architectures: r.architectures ?? [], products: r.products ?? [],
      })),
    });
  });

  /* ---------------- admin: applications ---------------- */

  router.get('/api/v1/admin/applications', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    ctx.json({ who: auth.id, applications: await apps().all() });
  });

  router.post('/api/v1/admin/applications', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const input = await ctx.validate(appInputSchema);
    const clash = (await apps().all()).find((r) => r.slug === input.slug);
    if (clash) throw new ValidationError('slug is already in use');
    const row = {
      id: uuidv7(), slug: input.slug, name: input.name, category: input.category,
      summary: input.summary ?? null, featured: input.featured === true,
      hosting_types: input.hostingTypes ?? [], status: input.status,
    };
    await apps().insert(row);
    await auditWrite(ctx, auth, 'application_create', 'marketplace_applications', row.id);
    ctx.code(201).json({ application: row });
  });

  router.patch('/api/v1/admin/applications/:id', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const existing = await apps().findById(ctx.params.id);
    if (!existing) throw new NotFoundError('Application not found');
    const input = await ctx.validate(appInputSchema.partial());
    if (input.slug && input.slug !== existing.slug) {
      const clash = (await apps().all()).find((r) => r.slug === input.slug);
      if (clash) throw new ValidationError('slug is already in use');
    }
    const patch = {};
    for (const key of ['slug', 'name', 'category', 'summary', 'status']) {
      if (input[key] !== undefined) patch[key] = input[key];
    }
    if (input.featured !== undefined) patch.featured = input.featured;
    if (input.hostingTypes !== undefined) patch.hosting_types = input.hostingTypes;
    await apps().updateById(ctx.params.id, patch);
    await auditWrite(ctx, auth, 'application_update', 'marketplace_applications', ctx.params.id);
    ctx.json({ application: await apps().findById(ctx.params.id) });
  });

  router.delete('/api/v1/admin/applications/:id', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const existing = await apps().findById(ctx.params.id);
    if (!existing) throw new NotFoundError('Application not found');
    await apps().deleteById(ctx.params.id);
    await auditWrite(ctx, auth, 'application_delete', 'marketplace_applications', ctx.params.id);
    ctx.json({ ok: true });
  });

  /* ---------------- admin: control panels ---------------- */

  router.get('/api/v1/admin/control-panels', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    ctx.json({ who: auth.id, panels: await panels().all() });
  });

  router.post('/api/v1/admin/control-panels', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const input = await ctx.validate(panelInputSchema);
    const clash = (await panels().all()).find((r) => r.slug === input.slug);
    if (clash) throw new ValidationError('slug is already in use');
    const row = {
      id: uuidv7(), slug: input.slug, name: input.name, summary: input.summary ?? null,
      services: input.services ?? [], status: input.status,
    };
    await panels().insert(row);
    await auditWrite(ctx, auth, 'control_panel_create', 'control_panels', row.id);
    ctx.code(201).json({ panel: row });
  });

  router.delete('/api/v1/admin/control-panels/:id', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const existing = await panels().findById(ctx.params.id);
    if (!existing) throw new NotFoundError('Panel not found');
    await panels().deleteById(ctx.params.id);
    await auditWrite(ctx, auth, 'control_panel_delete', 'control_panels', ctx.params.id);
    ctx.json({ ok: true });
  });

  /* ---------------- admin: operating systems ---------------- */

  router.get('/api/v1/admin/operating-systems', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    ctx.json({ who: auth.id, operatingSystems: await oses().all() });
  });

  router.post('/api/v1/admin/operating-systems', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const input = await ctx.validate(osInputSchema);
    const clash = (await oses().all()).find((r) => r.slug === input.slug);
    if (clash) throw new ValidationError('slug is already in use');
    const row = {
      id: uuidv7(), slug: input.slug, family: input.family, name: input.name,
      version: input.version ?? null, architectures: input.architectures ?? [],
      products: input.products ?? [], status: input.status,
    };
    await oses().insert(row);
    await auditWrite(ctx, auth, 'operating_system_create', 'operating_systems', row.id);
    ctx.code(201).json({ operatingSystem: row });
  });

  router.patch('/api/v1/admin/operating-systems/:id', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const existing = await oses().findById(ctx.params.id);
    if (!existing) throw new NotFoundError('OS entry not found');
    const input = await ctx.validate(osInputSchema.partial());
    if (input.slug && input.slug !== existing.slug) {
      const clash = (await oses().all()).find((r) => r.slug === input.slug);
      if (clash) throw new ValidationError('slug is already in use');
    }
    const patch = {};
    for (const key of ['slug', 'family', 'name', 'version', 'status']) {
      if (input[key] !== undefined) patch[key] = input[key];
    }
    if (input.architectures !== undefined) patch.architectures = input.architectures;
    if (input.products !== undefined) patch.products = input.products;
    await oses().updateById(ctx.params.id, patch);
    await auditWrite(ctx, auth, 'operating_system_update', 'operating_systems', ctx.params.id);
    ctx.json({ operatingSystem: await oses().findById(ctx.params.id) });
  });

  router.delete('/api/v1/admin/operating-systems/:id', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const existing = await oses().findById(ctx.params.id);
    if (!existing) throw new NotFoundError('OS entry not found');
    await oses().deleteById(ctx.params.id);
    await auditWrite(ctx, auth, 'operating_system_delete', 'operating_systems', ctx.params.id);
    ctx.json({ ok: true });
  });
}

module.exports = { name, register, CATEGORY_LABELS };
