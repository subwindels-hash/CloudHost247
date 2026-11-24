import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import { getPool } from '../db/pool';
import {
  listControlPanels,
  findControlPanelById,
  findControlPanelBySlug,
  getControlPanelWithPlans,
  createControlPanel,
  updateControlPanel,
  deleteControlPanel,
  listControlPanelPlans,
  findControlPanelPlanById,
  createControlPanelPlan,
  updateControlPanelPlan,
  deleteControlPanelPlan,
} from '../db/control-panels';
import { requireRole } from '../lib/require-role';
import { NotFoundError, ValidationError } from '../lib/errors';
import { catalogIdSchema } from '../lib/identifier-contract';
import { auditRequest } from '../lib/audit';
import { listControlPanelAdapters } from '../control-panels/registry';
import { controlPanelMethodImplemented, getControlPanelReadiness, type ControlPanelManagementMethod } from '../control-panels/readiness';
import { loadManifestCatalog, validatedManifests } from '../marketplace/manifest-loader';
import platformCatalog from '../../shared/platform-catalog.json';

// Control-panel rows are seeded deterministic catalogue ids (see identifier-contract.ts).
const idSchema = catalogIdSchema;
const slugSchema = z.string().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const createPanelSchema = z.object({
  name: z.string().min(1).max(160),
  slug: slugSchema,
  description: z.string().max(2000).nullable().optional(),
  category: z.enum(['SERVER_PANEL', 'APPLICATION_DEPLOYMENT_PLATFORM', 'SERVER_MANAGEMENT', 'OTHER'] as const).optional(),
  logoUrl: z.string().max(512).nullable().optional(),
  websiteUrl: z.string().url().max(512).nullable().optional(),
  documentationUrl: z.string().url().max(512).nullable().optional(),
  status: z.enum(['ACTIVE', 'DISABLED', 'ARCHIVED'] as const).optional(),
  installationMethod: z.enum(['SCRIPT', 'CLOUD_INIT', 'AGENT', 'DOCKER', 'API', 'MANUAL'] as const).optional(),
  requiresLicense: z.boolean().optional(),
  licenseProvider: z.string().max(64).optional(),
  minimumRamMb: z.number().int().min(256).max(131072).optional(),
  minimumCpuCores: z.number().int().min(1).max(128).optional(),
  minimumDiskGb: z.number().int().min(1).max(10000).optional(),
  supportedOs: z.array(z.string().min(1).max(64)).optional(),
  capabilities: z.record(z.string(), z.boolean()).optional(),
  sortOrder: z.number().int().optional(),
});

const patchPanelSchema = createPanelSchema.omit({ slug: true }).partial();

const createPlanSchema = z.object({
  controlPanelId: catalogIdSchema,
  name: z.string().min(1).max(160),
  description: z.string().max(2000).nullable().optional(),
  billingCycle: z.enum(['one_time', 'monthly', 'quarterly', 'semi_annually', 'annually'] as const).optional(),
  price: z.coerce.number().min(0).max(100000),
  currency: z.string().length(3).optional(),
  setupFee: z.coerce.number().min(0).max(10000).optional(),
  licenseType: z.string().min(1).max(64).optional(),
  includedDomains: z.number().int().min(1).nullable().optional(),
  includedAccounts: z.number().int().min(1).nullable().optional(),
  status: z.enum(['ACTIVE', 'DISABLED', 'ARCHIVED'] as const).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const patchPlanSchema = createPlanSchema.omit({ controlPanelId: true }).partial();

// The legacy /control-panels endpoint remains database-only. The catalogue
// endpoint merges its live rows with the shared static project directory and
// transfers just one requested slice to the browser at a time.
const catalogPageSchema = z.object({
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  limit: z.coerce.number().int().min(1).max(48).default(24),
  category: z.enum(['OPERATING_SYSTEM', 'SERVER_PANEL', 'APPLICATION_DEPLOYMENT_PLATFORM', 'SERVER_MANAGEMENT', 'OTHER']).optional(),
  license: z.enum(['FREE', 'COMMERCIAL']).optional(),
  search: z.string().max(160).optional(),
}).strict();

type CatalogSearchItem = {
  slug: string;
  name: string;
  category: string;
  description: string | null;
  requiresLicense: boolean;
  supportedOs: string[];
  catalogSource?: 'configured' | 'directory';
  hasValidatedManifest?: boolean;
  hasPanelBootstrapAdapter?: boolean;
  panelBootstrapProviderVerified?: boolean;
  panelManagementAvailable?: boolean;
  panelManagementProviderVerified?: boolean;
  operationallySupported?: boolean;
  hasPublishedMarketplaceApp?: boolean;
  planCount?: number;
  startingPrice?: number | null;
};

const panelManagementMethods: Array<{ operation: string; method: ControlPanelManagementMethod }> = [
  { operation: 'Install', method: 'install' },
  { operation: 'Uninstall', method: 'uninstall' },
  { operation: 'Configure', method: 'configure' },
  { operation: 'Read status', method: 'getStatus' },
  { operation: 'Health check', method: 'healthCheck' },
  { operation: 'Create account', method: 'createAccount' },
  { operation: 'Suspend account', method: 'suspendAccount' },
  { operation: 'Unsuspend account', method: 'unsuspendAccount' },
  { operation: 'Terminate account', method: 'terminateAccount' },
  { operation: 'Create domain', method: 'createDomain' },
  { operation: 'Delete domain', method: 'deleteDomain' },
  { operation: 'Create subdomain', method: 'createSubdomain' },
  { operation: 'Create database', method: 'createDatabase' },
  { operation: 'Delete database', method: 'deleteDatabase' },
  { operation: 'Create email account', method: 'createEmailAccount' },
  { operation: 'Delete email account', method: 'deleteEmailAccount' },
  { operation: 'Create DNS record', method: 'createDNSRecord' },
  { operation: 'Delete DNS record', method: 'deleteDNSRecord' },
  { operation: 'Issue SSL', method: 'issueSSL' },
  { operation: 'Renew SSL', method: 'renewSSL' },
  { operation: 'Read usage', method: 'getUsage' },
  { operation: 'Restart service', method: 'restartService' },
];

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError(result.error.issues.map((i) => i.message).join(', '));
  return result.data;
}

export async function registerControlPanelsRoutes(
  app: FastifyInstance,
  env: Env,
  overridePool?: Queryable
) {
  const pool = overridePool ?? getPool(env);
  const validatedManifestSlugs = new Set(
    validatedManifests(loadManifestCatalog(undefined, env.MARKETPLACE_MANIFESTS_DIR))
      .map((manifest) => manifest.id)
  );
  const adaptersBySlug = new Map(listControlPanelAdapters().map((adapter) => [adapter.slug, adapter]));

  const listPublishedMarketplaceSlugs = async (): Promise<Set<string>> => {
    const { rows } = await pool.query<{ slug: string }>(
      `SELECT DISTINCT a.slug
       FROM applications a
       JOIN application_versions v ON v.application_id = a.id
       WHERE a.status = 'published' AND v.status = 'published'`
    );
    return new Set(rows.map((row) => row.slug));
  };

  const listPanelManagementOperations = (slug: string) => {
    const adapter = adaptersBySlug.get(slug);
    return panelManagementMethods.map(({ operation, method }) => {
      const implemented = controlPanelMethodImplemented(slug, method);
      return {
        operation,
        implemented,
        providerVerified: false,
        reason: implemented
          ? 'An adapter method exists, but provider-backed acceptance has not been recorded.'
          : adapter
            ? 'This operation is not implemented by the CloudHost247 control-panel adapter.'
            : 'No CloudHost247 control-panel adapter is registered for this entry.',
      };
    });
  };

  const supportMetadata = (
    slug: string,
    catalogSource: 'configured' | 'directory',
    hasPublishedMarketplaceApp = false
  ) => {
    return {
      catalogSource,
      hasValidatedManifest: validatedManifestSlugs.has(slug),
      hasPublishedMarketplaceApp,
      ...getControlPanelReadiness(slug),
    };
  };

  const listPublicPanelSummaries = async (category?: string, publishedAppSlugs?: Set<string>) => {
    const published = publishedAppSlugs ?? await listPublishedMarketplaceSlugs();
    const panels = await listControlPanels(pool, { status: 'ACTIVE', category });
    const plans = panels.length ? await listControlPanelPlans(pool, { status: 'ACTIVE' }) : [];
    const plansByPanel = new Map<string, typeof plans>();
    for (const plan of plans) {
      const list = plansByPanel.get(plan.control_panel_id) ?? [];
      list.push(plan);
      plansByPanel.set(plan.control_panel_id, list);
    }
    return panels.map((panel) => {
      const panelPlans = plansByPanel.get(panel.id) ?? [];
      const startingPrice = panelPlans.length ? Math.min(...panelPlans.map((p) => Number(p.price))) : null;
      return {
        ...supportMetadata(panel.slug, 'configured', published.has(panel.slug)),
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
        supportedOs: panel.supported_os,
        capabilities: panel.capabilities,
        startingPrice,
        currency: panelPlans[0]?.currency ?? 'USD',
        billingCycle: panelPlans[0]?.billing_cycle ?? 'monthly',
        planCount: panelPlans.length,
      };
    });
  };

  const registerHandlers = (prefix: string) => {
    // --- Public Marketplace Endpoints -----------------------------------------------------------

    /**
     * List all active control panels for the public marketplace with multi-attribute filtering.
     */
    app.get(`${prefix}/control-panels`, async (request) => {
      const query = request.query as {
        category?: string;
        os?: string;
        search?: string;
        license?: string;
        minRamMb?: string;
        maxRamMb?: string;
        minCpu?: string;
        deploymentType?: string;
      };

      let items = await listPublicPanelSummaries(query.category);

      // Apply extra filtering if specified
      if (query.os) {
        const osTarget = query.os.toLowerCase();
        items = items.filter((p) => p.supportedOs.some((os) => os.toLowerCase().includes(osTarget)));
      }

      if (query.license) {
        if (query.license.toUpperCase() === 'FREE') items = items.filter((p) => !p.requiresLicense);
        if (query.license.toUpperCase() === 'COMMERCIAL') items = items.filter((p) => p.requiresLicense);
      }

      if (query.deploymentType) {
        items = items.filter((p) => p.installationMethod === query.deploymentType?.toUpperCase());
      }

      if (query.search) {
        const s = query.search.toLowerCase();
        items = items.filter(
          (p) =>
            p.name.toLowerCase().includes(s) ||
            (p.description ?? '').toLowerCase().includes(s) ||
            p.supportedOs.some((os) => os.toLowerCase().includes(s))
        );
      }

      return { controlPanels: items };
    });

    /** Return a single catalogue slice; filters and counts cover the *whole* directory. */
    app.get(`${prefix}/control-panels/catalog`, async (request) => {
      const query = parseOrThrow(catalogPageSchema, request.query);
      const publishedAppSlugs = await listPublishedMarketplaceSlugs();
      const dbPanels = await listPublicPanelSummaries(undefined, publishedAppSlugs);
      const seen = new Set(dbPanels.map((panel) => panel.slug));
      // DB rows override the corresponding static listing without duplicating it.
      // This is the same order previously used by the browser's full-list merge.
      const directoryEntries = platformCatalog
        .filter((panel) => !seen.has(panel.slug))
        .map((panel) => ({
          ...panel,
          ...supportMetadata(panel.slug, 'directory', publishedAppSlugs.has(panel.slug)),
          planCount: 0,
          startingPrice: null,
        }));
      const all: CatalogSearchItem[] = [...dbPanels, ...directoryEntries];
      const categoryCounts = {
        ALL: all.length,
        OPERATING_SYSTEM: all.filter((panel) => panel.category === 'OPERATING_SYSTEM').length,
        SERVER_PANEL: all.filter((panel) => panel.category === 'SERVER_PANEL').length,
        APPLICATION_DEPLOYMENT_PLATFORM: all.filter((panel) => panel.category === 'APPLICATION_DEPLOYMENT_PLATFORM').length,
        SERVER_MANAGEMENT: all.filter((panel) => panel.category === 'SERVER_MANAGEMENT').length,
      };
      const search = query.search?.trim().toLowerCase();
      const matches = all.filter((panel) =>
        (!query.category || panel.category === query.category) &&
        (!query.license || (query.license === 'FREE' ? !panel.requiresLicense : panel.requiresLicense)) &&
        (!search || panel.name.toLowerCase().includes(search) ||
          (panel.description ?? '').toLowerCase().includes(search) ||
          panel.supportedOs.some((os) => os.toLowerCase().includes(search)))
      );
      return {
        controlPanels: matches.slice(query.offset, query.offset + query.limit),
        total: matches.length,
        categoryCounts,
      };
    });

    /**
     * Get single control panel with its active commercial plans by slug or UUID.
     */
    app.get<{ Params: { slug: string } }>(`${prefix}/control-panels/:slug`, async (request) => {
      const slugOrId = request.params.slug;
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slugOrId);

      let panel = null;
      if (isUuid) {
        const base = await findControlPanelById(pool, slugOrId);
        if (base) {
          panel = await getControlPanelWithPlans(pool, base.slug);
        }
      } else {
        panel = await getControlPanelWithPlans(pool, slugOrId);
      }

      if (panel?.status === 'ARCHIVED') {
        throw new NotFoundError('Control panel not found');
      }

      if (!panel) {
        const directoryEntry = !isUuid
          ? platformCatalog.find((item) => item.slug === slugOrId)
          : undefined;
        if (!directoryEntry) throw new NotFoundError('Control panel not found');
        const publishedAppSlugs = await listPublishedMarketplaceSlugs();
        return {
          controlPanel: {
            ...directoryEntry,
            ...supportMetadata(directoryEntry.slug, 'directory', publishedAppSlugs.has(directoryEntry.slug)),
            panelOperations: listPanelManagementOperations(directoryEntry.slug),
            status: 'DIRECTORY_ONLY',
            planCount: 0,
            startingPrice: null,
            plans: [],
          },
        };
      }

      const startingPrice = panel.plans.length
        ? Math.min(...panel.plans.map((p) => Number(p.price)))
        : null;
      const publishedAppSlugs = await listPublishedMarketplaceSlugs();

      return {
        controlPanel: {
          ...supportMetadata(panel.slug, 'configured', publishedAppSlugs.has(panel.slug)),
          panelOperations: listPanelManagementOperations(panel.slug),
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
          supportedOs: panel.supported_os,
          capabilities: panel.capabilities,
          planCount: panel.plans.length,
          startingPrice,
          billingCycle: panel.plans[0]?.billing_cycle ?? 'monthly',
          plans: panel.plans.map((p) => ({
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
          })),
        },
      };
    });

    /**
     * List available plans for a panel.
     */
    app.get(`${prefix}/control-panel-plans`, async (request) => {
      const query = request.query as { panelId?: string };
      const plans = await listControlPanelPlans(pool, { panelId: query.panelId, status: 'ACTIVE' });
      return { plans };
    });

    // --- Admin Management Endpoints -------------------------------------------------------------

    app.get(`${prefix}/admin/control-panels`, async (request) => {
      await requireRole(request, env, pool, ['admin', 'super_admin']);
      const panels = await listControlPanels(pool);
      const plans = await listControlPanelPlans(pool);
      return { controlPanels: panels, plans };
    });

    app.get<{ Params: { id: string } }>(`${prefix}/admin/control-panels/:id`, async (request) => {
      await requireRole(request, env, pool, ['admin', 'super_admin']);
      const id = parseOrThrow(idSchema, request.params.id);
      const panel = await findControlPanelById(pool, id);
      if (!panel) throw new NotFoundError('Control panel not found');
      const plans = await listControlPanelPlans(pool, { panelId: id });
      return { controlPanel: panel, plans };
    });

    app.post(`${prefix}/admin/control-panels`, async (request, reply) => {
      const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
      const input = parseOrThrow(createPanelSchema, request.body);
      const existing = await findControlPanelBySlug(pool, input.slug);
      if (existing) throw new ValidationError('A control panel with that slug already exists');

      const panel = await createControlPanel(pool, input);
      await auditRequest(pool, request, auth.userId, {
        action: 'CONTROL_PANEL_CREATED',
        resourceType: 'control_panel',
        resourceId: panel.id,
        metadata: { slug: panel.slug, name: panel.name },
      });
      reply.code(201);
      return { controlPanel: panel };
    });

    app.patch<{ Params: { id: string } }>(`${prefix}/admin/control-panels/:id`, async (request) => {
      const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
      const id = parseOrThrow(idSchema, request.params.id);
      const input = parseOrThrow(patchPanelSchema, request.body);
      const updated = await updateControlPanel(pool, id, input);
      if (!updated) throw new NotFoundError('Control panel not found');

      await auditRequest(pool, request, auth.userId, {
        action: 'CONTROL_PANEL_UPDATED',
        resourceType: 'control_panel',
        resourceId: id,
        metadata: { changes: Object.keys(input) },
      });
      return { controlPanel: updated };
    });

    app.delete<{ Params: { id: string } }>(`${prefix}/admin/control-panels/:id`, async (request, reply) => {
      const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
      const id = parseOrThrow(idSchema, request.params.id);
      const deleted = await deleteControlPanel(pool, id);
      if (!deleted) throw new NotFoundError('Control panel not found');

      await auditRequest(pool, request, auth.userId, {
        action: 'CONTROL_PANEL_DELETED',
        resourceType: 'control_panel',
        resourceId: id,
      });
      reply.code(204);
      return null;
    });

    // Admin Control Panel Plans
    app.post(`${prefix}/admin/control-panel-plans`, async (request, reply) => {
      const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
      const input = parseOrThrow(createPlanSchema, request.body);
      const panel = await findControlPanelById(pool, input.controlPanelId);
      if (!panel) throw new NotFoundError('Control panel not found');

      const plan = await createControlPanelPlan(pool, input);
      await auditRequest(pool, request, auth.userId, {
        action: 'CONTROL_PANEL_PLAN_CREATED',
        resourceType: 'control_panel_plan',
        resourceId: plan.id,
        metadata: { panelId: plan.control_panel_id, name: plan.name },
      });
      reply.code(201);
      return { plan };
    });

    app.patch<{ Params: { id: string } }>(`${prefix}/admin/control-panel-plans/:id`, async (request) => {
      const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
      const id = parseOrThrow(idSchema, request.params.id);
      const input = parseOrThrow(patchPlanSchema, request.body);
      const updated = await updateControlPanelPlan(pool, id, input);
      if (!updated) throw new NotFoundError('Control panel plan not found');

      await auditRequest(pool, request, auth.userId, {
        action: 'CONTROL_PANEL_PLAN_UPDATED',
        resourceType: 'control_panel_plan',
        resourceId: id,
        metadata: { changes: Object.keys(input) },
      });
      return { plan: updated };
    });

    app.delete<{ Params: { id: string } }>(`${prefix}/admin/control-panel-plans/:id`, async (request, reply) => {
      const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
      const id = parseOrThrow(idSchema, request.params.id);
      const deleted = await deleteControlPanelPlan(pool, id);
      if (!deleted) throw new NotFoundError('Control panel plan not found');

      await auditRequest(pool, request, auth.userId, {
        action: 'CONTROL_PANEL_PLAN_DELETED',
        resourceType: 'control_panel_plan',
        resourceId: id,
      });
      reply.code(204);
      return null;
    });
  };

  registerHandlers('/api/v1');
  registerHandlers('/api');
}
