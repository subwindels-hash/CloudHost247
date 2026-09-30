import { randomUUID } from 'node:crypto';
import type { Queryable } from './types';

export type ControlPanelCategory =
  | 'SERVER_PANEL'
  | 'APPLICATION_DEPLOYMENT_PLATFORM'
  | 'SERVER_MANAGEMENT'
  | 'OTHER';

export type ControlPanelStatus = 'ACTIVE' | 'DISABLED' | 'ARCHIVED';

export type ControlPanelInstallationMethod =
  | 'SCRIPT'
  | 'CLOUD_INIT'
  | 'AGENT'
  | 'DOCKER'
  | 'API'
  | 'MANUAL';

export interface ControlPanelRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: ControlPanelCategory;
  logo_url: string | null;
  website_url: string | null;
  documentation_url: string | null;
  status: ControlPanelStatus;
  installation_method: ControlPanelInstallationMethod;
  requires_license: boolean;
  license_provider: string;
  minimum_ram_mb: number;
  minimum_cpu_cores: number;
  minimum_disk_gb: number;
  supported_os: string[];
  capabilities: Record<string, boolean>;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ControlPanelPlanRow {
  id: string;
  control_panel_id: string;
  name: string;
  description: string | null;
  billing_cycle: 'one_time' | 'monthly' | 'quarterly' | 'semi_annually' | 'annually';
  price: string;
  currency: string;
  setup_fee: string;
  license_type: string;
  included_domains: number | null;
  included_accounts: number | null;
  status: 'ACTIVE' | 'DISABLED' | 'ARCHIVED';
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ControlPanelWithPlans extends ControlPanelRow {
  plans: ControlPanelPlanRow[];
}

export async function listControlPanels(
  db: Queryable,
  options: { status?: string; category?: string } = {}
): Promise<ControlPanelRow[]> {
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (options.status) {
    params.push(options.status);
    conditions.push(`status = $${params.length}`);
  }
  if (options.category) {
    params.push(options.category);
    conditions.push(`category = $${params.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await db.query<ControlPanelRow>(
    `SELECT * FROM control_panels ${whereClause} ORDER BY sort_order ASC, name ASC`,
    params
  );
  return rows;
}

export async function findControlPanelById(db: Queryable, id: string): Promise<ControlPanelRow | null> {
  const { rows } = await db.query<ControlPanelRow>(
    `SELECT * FROM control_panels WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function findControlPanelBySlug(db: Queryable, slug: string): Promise<ControlPanelRow | null> {
  const { rows } = await db.query<ControlPanelRow>(
    `SELECT * FROM control_panels WHERE lower(slug) = lower($1)`,
    [slug]
  );
  return rows[0] ?? null;
}

export async function getControlPanelWithPlans(
  db: Queryable,
  slugOrId: string
): Promise<ControlPanelWithPlans | null> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slugOrId);
  const panel = isUuid
    ? await findControlPanelById(db, slugOrId)
    : await findControlPanelBySlug(db, slugOrId);

  if (!panel) return null;

  const plans = await listControlPanelPlans(db, { panelId: panel.id, status: 'ACTIVE' });
  return { ...panel, plans };
}

export async function createControlPanel(
  db: Queryable,
  input: {
    name: string;
    slug: string;
    description?: string | null;
    category?: ControlPanelCategory;
    logoUrl?: string | null;
    websiteUrl?: string | null;
    documentationUrl?: string | null;
    status?: ControlPanelStatus;
    installationMethod?: ControlPanelInstallationMethod;
    requiresLicense?: boolean;
    licenseProvider?: string;
    minimumRamMb?: number;
    minimumCpuCores?: number;
    minimumDiskGb?: number;
    supportedOs?: string[];
    capabilities?: Record<string, boolean>;
    sortOrder?: number;
  }
): Promise<ControlPanelRow> {
  const id = randomUUID();
  const { rows } = await db.query<ControlPanelRow>(
    `INSERT INTO control_panels (
       id, name, slug, description, category, logo_url, website_url, documentation_url,
       status, installation_method, requires_license, license_provider, minimum_ram_mb,
       minimum_cpu_cores, minimum_disk_gb, supported_os, capabilities, sort_order
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
     ) RETURNING *`,
    [
      id,
      input.name,
      input.slug.toLowerCase(),
      input.description ?? null,
      input.category ?? 'SERVER_PANEL',
      input.logoUrl ?? null,
      input.websiteUrl ?? null,
      input.documentationUrl ?? null,
      input.status ?? 'ACTIVE',
      input.installationMethod ?? 'SCRIPT',
      input.requiresLicense ?? false,
      input.licenseProvider ?? 'NONE',
      input.minimumRamMb ?? 1024,
      input.minimumCpuCores ?? 1,
      input.minimumDiskGb ?? 20,
      input.supportedOs ?? [],
      JSON.stringify(input.capabilities ?? {}),
      input.sortOrder ?? 0,
    ]
  );
  return rows[0]!;
}

export async function updateControlPanel(
  db: Queryable,
  id: string,
  patch: Partial<{
    name: string;
    description: string | null;
    category: ControlPanelCategory;
    logoUrl: string | null;
    websiteUrl: string | null;
    documentationUrl: string | null;
    status: ControlPanelStatus;
    installationMethod: ControlPanelInstallationMethod;
    requiresLicense: boolean;
    licenseProvider: string;
    minimumRamMb: number;
    minimumCpuCores: number;
    minimumDiskGb: number;
    supportedOs: string[];
    capabilities: Record<string, boolean>;
    sortOrder: number;
  }>
): Promise<ControlPanelRow | null> {
  const current = await findControlPanelById(db, id);
  if (!current) return null;

  const { rows } = await db.query<ControlPanelRow>(
    `UPDATE control_panels SET
       name = $2,
       description = $3,
       category = $4,
       logo_url = $5,
       website_url = $6,
       documentation_url = $7,
       status = $8,
       installation_method = $9,
       requires_license = $10,
       license_provider = $11,
       minimum_ram_mb = $12,
       minimum_cpu_cores = $13,
       minimum_disk_gb = $14,
       supported_os = $15,
       capabilities = $16,
       sort_order = $17,
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [
      id,
      patch.name ?? current.name,
      patch.description !== undefined ? patch.description : current.description,
      patch.category ?? current.category,
      patch.logoUrl !== undefined ? patch.logoUrl : current.logo_url,
      patch.websiteUrl !== undefined ? patch.websiteUrl : current.website_url,
      patch.documentationUrl !== undefined ? patch.documentationUrl : current.documentation_url,
      patch.status ?? current.status,
      patch.installationMethod ?? current.installation_method,
      patch.requiresLicense !== undefined ? patch.requiresLicense : current.requires_license,
      patch.licenseProvider ?? current.license_provider,
      patch.minimumRamMb ?? current.minimum_ram_mb,
      patch.minimumCpuCores ?? current.minimum_cpu_cores,
      patch.minimumDiskGb ?? current.minimum_disk_gb,
      patch.supportedOs ?? current.supported_os,
      patch.capabilities !== undefined ? JSON.stringify(patch.capabilities) : JSON.stringify(current.capabilities),
      patch.sortOrder ?? current.sort_order,
    ]
  );
  return rows[0] ?? null;
}

export async function deleteControlPanel(db: Queryable, id: string): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(`DELETE FROM control_panels WHERE id = $1 RETURNING id`, [id]);
  return rows.length > 0;
}

export async function listControlPanelPlans(
  db: Queryable,
  options: { panelId?: string; status?: string } = {}
): Promise<ControlPanelPlanRow[]> {
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (options.panelId) {
    params.push(options.panelId);
    conditions.push(`control_panel_id = $${params.length}`);
  }
  if (options.status) {
    params.push(options.status);
    conditions.push(`status = $${params.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await db.query<ControlPanelPlanRow>(
    `SELECT * FROM control_panel_plans ${whereClause} ORDER BY price ASC, name ASC`,
    params
  );
  return rows;
}

export async function findControlPanelPlanById(db: Queryable, id: string): Promise<ControlPanelPlanRow | null> {
  const { rows } = await db.query<ControlPanelPlanRow>(
    `SELECT * FROM control_panel_plans WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function createControlPanelPlan(
  db: Queryable,
  input: {
    controlPanelId: string;
    name: string;
    description?: string | null;
    billingCycle?: 'one_time' | 'monthly' | 'quarterly' | 'semi_annually' | 'annually';
    price: number | string;
    currency?: string;
    setupFee?: number | string;
    licenseType?: string;
    includedDomains?: number | null;
    includedAccounts?: number | null;
    status?: 'ACTIVE' | 'DISABLED' | 'ARCHIVED';
    metadata?: Record<string, unknown>;
  }
): Promise<ControlPanelPlanRow> {
  const id = randomUUID();
  const { rows } = await db.query<ControlPanelPlanRow>(
    `INSERT INTO control_panel_plans (
       id, control_panel_id, name, description, billing_cycle, price, currency,
       setup_fee, license_type, included_domains, included_accounts, status, metadata
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
     ) RETURNING *`,
    [
      id,
      input.controlPanelId,
      input.name,
      input.description ?? null,
      input.billingCycle ?? 'monthly',
      input.price,
      input.currency ?? 'USD',
      input.setupFee ?? '0.00',
      input.licenseType ?? 'FREE',
      input.includedDomains ?? null,
      input.includedAccounts ?? null,
      input.status ?? 'ACTIVE',
      JSON.stringify(input.metadata ?? {}),
    ]
  );
  return rows[0]!;
}

export async function updateControlPanelPlan(
  db: Queryable,
  id: string,
  patch: Partial<{
    name: string;
    description: string | null;
    billingCycle: 'one_time' | 'monthly' | 'quarterly' | 'semi_annually' | 'annually';
    price: number | string;
    currency: string;
    setupFee: number | string;
    licenseType: string;
    includedDomains: number | null;
    includedAccounts: number | null;
    status: 'ACTIVE' | 'DISABLED' | 'ARCHIVED';
    metadata: Record<string, unknown>;
  }>
): Promise<ControlPanelPlanRow | null> {
  const current = await findControlPanelPlanById(db, id);
  if (!current) return null;

  const { rows } = await db.query<ControlPanelPlanRow>(
    `UPDATE control_panel_plans SET
       name = $2,
       description = $3,
       billing_cycle = $4,
       price = $5,
       currency = $6,
       setup_fee = $7,
       license_type = $8,
       included_domains = $9,
       included_accounts = $10,
       status = $11,
       metadata = $12,
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [
      id,
      patch.name ?? current.name,
      patch.description !== undefined ? patch.description : current.description,
      patch.billingCycle ?? current.billing_cycle,
      patch.price !== undefined ? patch.price : current.price,
      patch.currency ?? current.currency,
      patch.setupFee !== undefined ? patch.setupFee : current.setup_fee,
      patch.licenseType ?? current.license_type,
      patch.includedDomains !== undefined ? patch.includedDomains : current.included_domains,
      patch.includedAccounts !== undefined ? patch.includedAccounts : current.included_accounts,
      patch.status ?? current.status,
      patch.metadata !== undefined ? JSON.stringify(patch.metadata) : JSON.stringify(current.metadata),
    ]
  );
  return rows[0] ?? null;
}

export async function deleteControlPanelPlan(db: Queryable, id: string): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(`DELETE FROM control_panel_plans WHERE id = $1 RETURNING id`, [id]);
  return rows.length > 0;
}
