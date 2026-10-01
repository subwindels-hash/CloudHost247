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
import { auditRequest } from '../lib/audit';

const idSchema = z.string().uuid();
const slugSchema = z.string().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const createPanelSchema = z.object({
  name: z.string().min(1).max(160),
  slug: slugSchema,
  description: z.string().max(2000).nullable().optional(),
  category: z.enum(['SERVER_PANEL', 'APPLICATION_DEPLOYMENT_PLATFORM', 'SERVER_MANAGEMENT', 'OTHER']).optional(),
  logoUrl: z.string().max(512).nullable().optional(),
  websiteUrl: z.string().url().max(512).nullable().optional(),
  documentationUrl: z.string().url().max(512).nullable().optional(),
  status: z.enum(['ACTIVE', 'DISABLED', 'ARCHIVED']).optional(),
  installationMethod: z.enum(['SCRIPT', 'CLOUD_INIT', 'AGENT', 'DOCKER', 'API', 'MANUAL']).optional(),
  requiresLicense: z.boolean().optional(),
  licenseProvider: z.string().max(64).optional(),
  minimumRamMb: z.number().int().min(256).max(131072).optional(),
  minimumCpuCores: z.number().int().min(1).max(128).optional(),
  minimumDiskGb: z.number().int().min(1).max(10000).optional(),
  supportedOs: z.array(z.string().min(1).max(64)).optional(),
  capabilities: z.record(z.boolean()).optional(),
  sortOrder: z.number().int().optional(),
});

const patchPanelSchema = createPanelSchema.omit({ slug: true }).partial();

const createPlanSchema = z.object({
  controlPanelId: z.string().uuid(),
  name: z.string().min(1).max(160),
  description: z.string().max(2000).nullable().optional(),
  billingCycle: z.enum(['one_time', 'monthly', 'quarterly', 'semi_annually', 'annually']).optional(),
  price: z.coerce.number().min(0).max(100000),
  currency: z.string().length(3).optional(),
  setupFee: z.coerce.number().min(0).max(10000).optional(),
  licenseType: z.string().min(1).max(64).optional(),
  includedDomains: z.number().int().min(1).nullable().optional(),
  includedAccounts: z.number().int().min(1).nullable().optional(),
  status: z.enum(['ACTIVE', 'DISABLED', 'ARCHIVED']).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const patchPlanSchema = createPlanSchema.omit({ controlPanelId: true }).partial();

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

      const panels = await listControlPanels(pool, { status: 'ACTIVE', category: query.category });
      const panelIds = panels.map((p) => p.id);
      const plans = panelIds.length ? await listControlPanelPlans(pool, { status: 'ACTIVE' }) : [];

      const plansByPanel = new Map<string, typeof plans>();
      for (const plan of plans) {
        const list = plansByPanel.get(plan.control_panel_id) ?? [];
        list.push(plan);
        plansByPanel.set(plan.control_panel_id, list);
      }

      let items = panels.map((panel) => {
        const panelPlans = plansByPanel.get(panel.id) ?? [];
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
          supportedOs: panel.supported_os,
          capabilities: panel.capabilities,
          startingPrice,
          billingCycle: panelPlans[0]?.billing_cycle ?? 'monthly',
        };
      });

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

      if (!panel || panel.status === 'ARCHIVED') {
        throw new NotFoundError('Control panel not found');
      }

      const startingPrice = panel.plans.length
        ? Math.min(...panel.plans.map((p) => Number(p.price)))
        : 0;

      return {
        controlPanel: {
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
