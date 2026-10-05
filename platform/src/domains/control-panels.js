/**
 * Control panels (cPanel, Plesk, DirectAdmin, CyberPanel, Coolify, …).
 *
 * Ported from cloudhost247-node/src/routes/control-panels.ts. The original registers every handler
 * twice — once under `/api/v1` and once under `/api` — so `registerHandlers` is called for both
 * prefixes here too, keeping the legacy mount alive.
 *
 * Three public marketplace endpoints (no auth) expose the ACTIVE catalogue with multi-attribute
 * filtering; the admin endpoints manage panels and their commercial licence tiers. Admin responses
 * return the stored rows verbatim, exactly as the original does, while the public endpoints return
 * the camelCase marketplace DTO.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError, ValidationError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { asAdmin } = require('../lib/auth');

const name = 'control-panels';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const CATEGORIES = ['SERVER_PANEL', 'APPLICATION_DEPLOYMENT_PLATFORM', 'SERVER_MANAGEMENT', 'OTHER'];
const STATUSES = ['ACTIVE', 'DISABLED', 'ARCHIVED'];
const INSTALL_METHODS = ['SCRIPT', 'CLOUD_INIT', 'AGENT', 'DOCKER', 'API', 'MANUAL'];
const BILLING_CYCLES = ['one_time', 'monthly', 'quarterly', 'semi_annually', 'annually'];

const slugSchema = v.string().min(1).max(120).regex(SLUG_RE, 'Slug must be lowercase kebab-case');

const createPanelSchema = v.object({
  name: v.string().min(1).max(160),
  slug: slugSchema,
  description: v.string().max(2000).nullable().optional(),
  category: v.enum(CATEGORIES).optional(),
  logoUrl: v.string().max(512).nullable().optional(),
  websiteUrl: v.string().max(512).nullable().optional(),
  documentationUrl: v.string().max(512).nullable().optional(),
  status: v.enum(STATUSES).optional(),
  installationMethod: v.enum(INSTALL_METHODS).optional(),
  requiresLicense: v.boolean().optional(),
  licenseProvider: v.string().max(64).optional(),
  minimumRamMb: v.coerce.number().int().min(256).max(131072).optional(),
  minimumCpuCores: v.coerce.number().int().min(1).max(128).optional(),
  minimumDiskGb: v.coerce.number().int().min(1).max(10000).optional(),
  supportedOs: v.array(v.string().min(1).max(64)).optional(),
  capabilities: v.record(v.boolean()).optional(),
  sortOrder: v.coerce.number().int().optional(),
});

// The original derives the patch schema by omitting `slug` and making everything partial, so a
// panel's slug is immutable once created.
const patchPanelSchema = createPanelSchema.omit(['slug']).partial();

const createPlanSchema = v.object({
  controlPanelId: v.string().min(1),
  name: v.string().min(1).max(160),
  description: v.string().max(2000).nullable().optional(),
  billingCycle: v.enum(BILLING_CYCLES).optional(),
  price: v.coerce.number().min(0).max(100000),
  currency: v.string().length(3).optional(),
  setupFee: v.coerce.number().min(0).max(10000).optional(),
  licenseType: v.string().min(1).max(64).optional(),
  includedDomains: v.coerce.number().int().min(1).nullable().optional(),
  includedAccounts: v.coerce.number().int().min(1).nullable().optional(),
  status: v.enum(STATUSES).optional(),
  metadata: v.record(v.any()).optional(),
});

const patchPlanSchema = createPlanSchema.omit(['controlPanelId']).partial();

function register(router, deps) {
  const { store } = deps;

  const panels = () => store.table('control_panels');
  const plans = () => store.table('control_panel_plans');

  async function audit(ctx, action, entityType, entityId, metadata) {
    await store.table('audit_logs').insert({
      id: uuidv7(), actor_id: ctx.user.id, actor_role: ctx.user.role, action,
      entity_type: entityType, entity_id: entityId ?? null,
      ip_address: ctx.ip, user_agent: ctx.userAgent, after: metadata ?? null,
    });
  }

  // ORDER BY sort_order ASC, name ASC (db/control-panels.ts listControlPanels)
  const listPanels = (filter = {}) => panels().find(filter, { orderBy: ['sort_order', 'name'] });
  // ORDER BY price ASC, name ASC (db/control-panels.ts listControlPanelPlans)
  const listPlans = (filter = {}) => plans().find(filter, { orderBy: ['price', 'name'] });

  /** lower(slug) = lower($1) — the original's slug lookup is case-insensitive. */
  const bySlug = (slug) => panels().find((row) => String(row.slug ?? '').toLowerCase() === String(slug).toLowerCase());

  /** Reject anything that is not a UUID, mirroring parseOrThrow(idSchema, …). */
  function requireUuid(raw) {
    if (!UUID_RE.test(String(raw ?? ''))) throw new ValidationError('Invalid control panel identifier');
    return String(raw);
  }

  /** The public marketplace DTO. */
  function publicPanel(panel, panelPlans) {
    const startingPrice = panelPlans.length
      ? Math.min(...panelPlans.map((p) => Number(p.price)))
      : 0;
    return {
      id: panel.id,
      name: panel.name,
      slug: panel.slug,
      category: panel.category,
      description: panel.description,
      logoUrl: panel.logo_url,
      websiteUrl: panel.website_url,
      documentationUrl: panel.documentation_url,
      status: panel.status,
      installationMethod: panel.installation_method,
      requiresLicense: panel.requires_license,
      licenseProvider: panel.license_provider,
      minimumRequirements: {
        ramMb: panel.minimum_ram_mb,
        cpuCores: panel.minimum_cpu_cores,
        diskGb: panel.minimum_disk_gb,
      },
      supportedOs: panel.supported_os ?? [],
      capabilities: panel.capabilities ?? {},
      startingPrice,
      billingCycle: panelPlans[0]?.billing_cycle ?? 'monthly',
    };
  }

  const publicPlan = (p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    billingCycle: p.billing_cycle,
    price: p.price,
    currency: p.currency,
    setupFee: p.setup_fee,
    licenseType: p.license_type,
    includedDomains: p.included_domains,
    includedAccounts: p.included_accounts,
    status: p.status,
  });

  const registerHandlers = (prefix) => {
    // --- Public marketplace endpoints ---------------------------------------

    /** List all ACTIVE control panels with multi-attribute filtering. No auth. */
    router.get(`${prefix}/control-panels`, async (ctx) => {
      const query = ctx.query ?? {};
      const filter = { status: 'ACTIVE' };
      if (query.category) filter.category = query.category;

      const { rows } = await listPanels(filter);
      const panelIds = rows.map((p) => p.id);
      const activePlans = panelIds.length ? (await listPlans({ status: 'ACTIVE' })).rows : [];

      const plansByPanel = new Map();
      for (const plan of activePlans) {
        const list = plansByPanel.get(plan.control_panel_id) ?? [];
        list.push(plan);
        plansByPanel.set(plan.control_panel_id, list);
      }

      let items = rows.map((panel) => publicPanel(panel, plansByPanel.get(panel.id) ?? []));

      if (query.os) {
        const osTarget = String(query.os).toLowerCase();
        items = items.filter((p) => (p.supportedOs ?? []).some((os) => String(os).toLowerCase().includes(osTarget)));
      }
      if (query.license) {
        const want = String(query.license).toUpperCase();
        if (want === 'FREE') items = items.filter((p) => !p.requiresLicense);
        if (want === 'COMMERCIAL') items = items.filter((p) => p.requiresLicense);
      }
      if (query.deploymentType) {
        items = items.filter((p) => p.installationMethod === String(query.deploymentType).toUpperCase());
      }
      if (query.search) {
        const s = String(query.search).toLowerCase();
        items = items.filter((p) => p.name.toLowerCase().includes(s)
          || String(p.description ?? '').toLowerCase().includes(s)
          || (p.supportedOs ?? []).some((os) => String(os).toLowerCase().includes(s)));
      }

      ctx.json({ controlPanels: items });
    });

    /** A single panel with its ACTIVE commercial plans, addressed by slug or UUID. */
    router.get(`${prefix}/control-panels/:slug`, async (ctx) => {
      const slugOrId = ctx.params.slug;
      let panel = null;
      if (UUID_RE.test(slugOrId)) {
        panel = await panels().findById(slugOrId);
      } else {
        const { rows } = await bySlug(slugOrId);
        panel = rows[0] ?? null;
      }
      if (!panel || panel.status === 'ARCHIVED') throw new NotFoundError('Control panel not found');

      const { rows: panelPlans } = await listPlans({ control_panel_id: panel.id, status: 'ACTIVE' });
      const dto = publicPanel(panel, panelPlans);
      dto.plans = panelPlans.map(publicPlan);
      ctx.json({ controlPanel: dto });
    });

    /** ACTIVE plans, optionally narrowed to one panel. */
    router.get(`${prefix}/control-panel-plans`, async (ctx) => {
      const filter = { status: 'ACTIVE' };
      if (ctx.query?.panelId) filter.control_panel_id = ctx.query.panelId;
      const { rows } = await listPlans(filter);
      ctx.json({ plans: rows });
    });

    // --- Admin management endpoints -----------------------------------------

    router.get(`${prefix}/admin/control-panels`, async (ctx) => {
      await asAdmin(ctx, deps);
      const panelRows = await listPanels();
      const planRows = await listPlans();
      ctx.json({ controlPanels: panelRows.rows, plans: planRows.rows });
    });

    router.get(`${prefix}/admin/control-panels/:id`, async (ctx) => {
      await asAdmin(ctx, deps);
      const id = requireUuid(ctx.params.id);
      const panel = await panels().findById(id);
      if (!panel) throw new NotFoundError('Control panel not found');
      const { rows } = await listPlans({ control_panel_id: id });
      ctx.json({ controlPanel: panel, plans: rows });
    });

    router.post(`${prefix}/admin/control-panels`, async (ctx) => {
      await asAdmin(ctx, deps);
      const input = await ctx.validate(createPanelSchema);

      const { rows: existing } = await bySlug(input.slug);
      if (existing.length) throw new ValidationError('A control panel with that slug already exists');

      const panel = await panels().insert({
        id: uuidv7(),
        name: input.name,
        slug: input.slug,
        description: input.description ?? null,
        category: input.category ?? 'SERVER_PANEL',
        logo_url: input.logoUrl ?? null,
        website_url: input.websiteUrl ?? null,
        documentation_url: input.documentationUrl ?? null,
        status: input.status ?? 'ACTIVE',
        installation_method: input.installationMethod ?? 'SCRIPT',
        requires_license: input.requiresLicense ?? false,
        license_provider: input.licenseProvider ?? 'NONE',
        minimum_ram_mb: input.minimumRamMb ?? 1024,
        minimum_cpu_cores: input.minimumCpuCores ?? 1,
        minimum_disk_gb: input.minimumDiskGb ?? 20,
        supported_os: input.supportedOs ?? ['ubuntu', 'debian'],
        capabilities: input.capabilities ?? {},
        sort_order: input.sortOrder ?? 100,
      });

      await audit(ctx, 'CONTROL_PANEL_CREATED', 'control_panel', panel.id, { slug: panel.slug, name: panel.name });
      ctx.code(201).json({ controlPanel: panel });
    });

    router.patch(`${prefix}/admin/control-panels/:id`, async (ctx) => {
      await asAdmin(ctx, deps);
      const id = requireUuid(ctx.params.id);
      const input = await ctx.validate(patchPanelSchema);

      const panel = await panels().findById(id);
      if (!panel) throw new NotFoundError('Control panel not found');

      const fieldMap = {
        name: 'name', description: 'description', category: 'category', logoUrl: 'logo_url',
        websiteUrl: 'website_url', documentationUrl: 'documentation_url', status: 'status',
        installationMethod: 'installation_method', requiresLicense: 'requires_license',
        licenseProvider: 'license_provider', minimumRamMb: 'minimum_ram_mb',
        minimumCpuCores: 'minimum_cpu_cores', minimumDiskGb: 'minimum_disk_gb',
        supportedOs: 'supported_os', capabilities: 'capabilities', sortOrder: 'sort_order',
      };
      const patch = {};
      for (const [camel, snake] of Object.entries(fieldMap)) {
        if (input[camel] !== undefined) patch[snake] = input[camel];
      }

      const updated = await panels().updateById(id, { ...patch, updated_at: new Date().toISOString() });
      await audit(ctx, 'CONTROL_PANEL_UPDATED', 'control_panel', id, { changes: Object.keys(input) });
      ctx.json({ controlPanel: updated });
    });

    router.delete(`${prefix}/admin/control-panels/:id`, async (ctx) => {
      await asAdmin(ctx, deps);
      const id = requireUuid(ctx.params.id);
      const panel = await panels().findById(id);
      if (!panel) throw new NotFoundError('Control panel not found');

      await panels().deleteById(id);
      await audit(ctx, 'CONTROL_PANEL_DELETED', 'control_panel', id, null);
      ctx.noContent();
    });

    // --- Admin commercial plans ---------------------------------------------

    router.post(`${prefix}/admin/control-panel-plans`, async (ctx) => {
      await asAdmin(ctx, deps);
      const input = await ctx.validate(createPlanSchema);

      const panel = await panels().findById(input.controlPanelId);
      if (!panel) throw new NotFoundError('Control panel not found');

      const plan = await plans().insert({
        id: uuidv7(),
        control_panel_id: input.controlPanelId,
        name: input.name,
        description: input.description ?? null,
        billing_cycle: input.billingCycle ?? 'monthly',
        price: input.price,
        currency: input.currency ?? 'USD',
        setup_fee: input.setupFee ?? 0,
        license_type: input.licenseType ?? 'FREE',
        included_domains: input.includedDomains ?? null,
        included_accounts: input.includedAccounts ?? null,
        status: input.status ?? 'ACTIVE',
        metadata: input.metadata ?? {},
      });

      await audit(ctx, 'CONTROL_PANEL_PLAN_CREATED', 'control_panel_plan', plan.id, {
        panelId: plan.control_panel_id, name: plan.name,
      });
      ctx.code(201).json({ plan });
    });

    router.patch(`${prefix}/admin/control-panel-plans/:id`, async (ctx) => {
      await asAdmin(ctx, deps);
      const id = requireUuid(ctx.params.id);
      const input = await ctx.validate(patchPlanSchema);

      const plan = await plans().findById(id);
      if (!plan) throw new NotFoundError('Control panel plan not found');

      const fieldMap = {
        name: 'name', description: 'description', billingCycle: 'billing_cycle', price: 'price',
        currency: 'currency', setupFee: 'setup_fee', licenseType: 'license_type',
        includedDomains: 'included_domains', includedAccounts: 'included_accounts',
        status: 'status', metadata: 'metadata',
      };
      const patch = {};
      for (const [camel, snake] of Object.entries(fieldMap)) {
        if (input[camel] !== undefined) patch[snake] = input[camel];
      }

      const updated = await plans().updateById(id, { ...patch, updated_at: new Date().toISOString() });
      await audit(ctx, 'CONTROL_PANEL_PLAN_UPDATED', 'control_panel_plan', id, { changes: Object.keys(input) });
      ctx.json({ plan: updated });
    });

    router.delete(`${prefix}/admin/control-panel-plans/:id`, async (ctx) => {
      await asAdmin(ctx, deps);
      const id = requireUuid(ctx.params.id);
      const plan = await plans().findById(id);
      if (!plan) throw new NotFoundError('Control panel plan not found');

      await plans().deleteById(id);
      await audit(ctx, 'CONTROL_PANEL_PLAN_DELETED', 'control_panel_plan', id, null);
      ctx.noContent();
    });
  };

  registerHandlers('/api/v1');
  registerHandlers('/api');
}

module.exports = { name, register };
