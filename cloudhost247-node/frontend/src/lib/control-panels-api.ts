import { apiFetch, ApiRequestError } from './api';

export interface ControlPanelSummary {
  id: string;
  name: string;
  slug: string;
  category: string;
  description: string | null;
  logoUrl: string | null;
  websiteUrl: string | null;
  documentationUrl: string | null;
  status: string;
  installationMethod: string;
  requiresLicense: boolean;
  licenseProvider: string;
  minimumRequirements: {
    ramMb: number;
    cpuCores: number;
    diskGb: number;
  };
  supportedOs: string[];
  capabilities: Record<string, boolean>;
  startingPrice: string | number | null;
  currency: string;
  billingCycle: string;
  planCount: number;
  /** `configured` is a database-backed offer; `directory` is reference metadata only. */
  catalogSource?: 'configured' | 'directory';
  /** A validated manifest file exists; this does not mean it is published or provider-tested. */
  hasValidatedManifest?: boolean;
  /** A bootstrap-script adapter exists; this does not imply provider-accepted installation. */
  hasPanelBootstrapAdapter?: boolean;
  /** True only when a provider-backed bootstrap acceptance result has been recorded. */
  panelBootstrapProviderVerified?: boolean;
  panelManagementAvailable?: boolean;
  /** True only when provider-backed management acceptance has been recorded. */
  panelManagementProviderVerified?: boolean;
  /** All bootstrap, verification, lifecycle, and provider-acceptance gates passed. */
  operationallySupported?: boolean;
  /** A published app/version exists in the application marketplace; host compatibility is checked on install. */
  hasPublishedMarketplaceApp?: boolean;
}

export interface ControlPanelPlan {
  id: string;
  name: string;
  description: string | null;
  billingCycle: string;
  price: string;
  currency: string;
  setupFee: string;
  licenseType: string;
  includedDomains: number | null;
  includedAccounts: number | null;
  status: string;
}

export interface ControlPanelOperationStatus {
  operation: string;
  implemented: boolean;
  providerVerified: boolean;
  reason: string | null;
}

export interface ControlPanelDetail extends ControlPanelSummary {
  plans: ControlPanelPlan[];
  /** Method presence is not provider-backed acceptance; every operation also reports verification state. */
  panelOperations?: ControlPanelOperationStatus[];
}

export interface ControlPanelPage {
  controlPanels: ControlPanelSummary[];
  total: number;
  categoryCounts: Record<'ALL' | 'OPERATING_SYSTEM' | 'SERVER_PANEL' | 'APPLICATION_DEPLOYMENT_PLATFORM' | 'SERVER_MANAGEMENT', number>;
}

export interface ControlPanelPageQuery {
  offset: number;
  limit: number;
  category?: string;
  license?: 'FREE' | 'COMMERCIAL';
  search?: string;
  signal?: AbortSignal;
}

/** The public catalogue requests only the next page of metadata from the API. */
export async function fetchControlPanelsPage({ offset, limit, category, license, search, signal }: ControlPanelPageQuery): Promise<ControlPanelPage> {
  const params = new URLSearchParams({ offset: String(offset), limit: String(limit) });
  if (category && category !== 'ALL') params.set('category', category);
  if (license) params.set('license', license);
  if (search?.trim()) params.set('search', search.trim());
  try {
    return await apiFetch<ControlPanelPage>(`/api/v1/control-panels/catalog?${params}`, { signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    // Keep the offline preview usable; load the shared full directory only when
    // the API is down, never in the normal paged network path.
    const { PLATFORM_CATALOG } = await import('../data/platform-catalog');
    if (signal?.aborted) throw error;
    const categoryCounts = {
      ALL: PLATFORM_CATALOG.length,
      OPERATING_SYSTEM: PLATFORM_CATALOG.filter((p) => p.category === 'OPERATING_SYSTEM').length,
      SERVER_PANEL: PLATFORM_CATALOG.filter((p) => p.category === 'SERVER_PANEL').length,
      APPLICATION_DEPLOYMENT_PLATFORM: PLATFORM_CATALOG.filter((p) => p.category === 'APPLICATION_DEPLOYMENT_PLATFORM').length,
      SERVER_MANAGEMENT: PLATFORM_CATALOG.filter((p) => p.category === 'SERVER_MANAGEMENT').length,
    };
    const term = search?.trim().toLowerCase();
    const filtered = PLATFORM_CATALOG.filter((p) =>
      (!category || category === 'ALL' || p.category === category) &&
      (!license || (license === 'FREE' ? !p.requiresLicense : p.requiresLicense)) &&
      (!term || p.name.toLowerCase().includes(term) ||
        (p.description ?? '').toLowerCase().includes(term) ||
        p.supportedOs.some((os) => os.toLowerCase().includes(term)))
    );
    return {
      controlPanels: filtered.slice(offset, offset + limit).map((panel) => ({
        ...panel,
        catalogSource: 'directory' as const,
        planCount: 0,
        startingPrice: null,
      })),
      total: filtered.length,
      categoryCounts,
    };
  }
}

export async function fetchControlPanels(category?: string): Promise<ControlPanelSummary[]> {
  const { PLATFORM_CATALOG } = await import('../data/platform-catalog');
  const query = category ? `?category=${encodeURIComponent(category)}` : '';
  try {
    const data = await apiFetch<{ controlPanels: ControlPanelSummary[] }>(`/api/v1/control-panels${query}`);
    const dbPanels = data.controlPanels ?? [];
    const seen = new Set(dbPanels.map((p) => p.slug));
    const extras = PLATFORM_CATALOG
      .filter((p) => !seen.has(p.slug) && (!category || p.category === category))
      .map((p) => ({ ...p, catalogSource: 'directory' as const, planCount: 0, startingPrice: null }));
    return [...dbPanels, ...extras];
  } catch {
    const fallback = category ? PLATFORM_CATALOG.filter((p) => p.category === category) : PLATFORM_CATALOG;
    return fallback.map((p) => ({ ...p, catalogSource: 'directory' as const, planCount: 0, startingPrice: null }));
  }
}

export async function fetchControlPanel(slug: string): Promise<ControlPanelDetail> {
  try {
    const data = await apiFetch<{ controlPanel: ControlPanelDetail }>(`/api/v1/control-panels/${encodeURIComponent(slug)}`);
    return data.controlPanel;
  } catch (error) {
    // Only a 404 means "this directory entry has no configured database listing yet". Network,
    // authorization, and server errors must stay visible instead of silently turning into a fake offer.
    if (!(error instanceof ApiRequestError) || error.status !== 404) throw error;
    const { PLATFORM_CATALOG } = await import('../data/platform-catalog');
    const found = PLATFORM_CATALOG.find((p) => p.slug === slug);
    if (!found) throw error;
    return {
      ...found,
      catalogSource: 'directory',
      planCount: 0,
      startingPrice: null,
      plans: [],
    };
  }
}

export async function fetchAdminControlPanels(): Promise<{ controlPanels: any[]; plans: ControlPanelPlan[] }> {
  return apiFetch<{ controlPanels: any[]; plans: ControlPanelPlan[] }>('/api/v1/admin/control-panels');
}

export async function patchAdminControlPanel(id: string, patch: Record<string, unknown>): Promise<any> {
  return apiFetch(`/api/v1/admin/control-panels/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function createAdminControlPanel(input: Record<string, unknown>): Promise<any> {
  return apiFetch('/api/v1/admin/control-panels', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function createAdminControlPanelPlan(input: Record<string, unknown>): Promise<any> {
  return apiFetch('/api/v1/admin/control-panel-plans', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function patchAdminControlPanelPlan(id: string, patch: Record<string, unknown>): Promise<any> {
  return apiFetch(`/api/v1/admin/control-panel-plans/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}
