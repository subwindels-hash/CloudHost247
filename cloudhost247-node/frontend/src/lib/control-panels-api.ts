import { apiFetch } from './api';
import { PLATFORM_CATALOG } from '../data/platform-catalog';

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
  startingPrice: string;
  currency: string;
  billingCycle: string;
  planCount: number;
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

export interface ControlPanelDetail extends ControlPanelSummary {
  plans: ControlPanelPlan[];
}

export async function fetchControlPanels(category?: string): Promise<ControlPanelSummary[]> {
  const query = category ? `?category=${encodeURIComponent(category)}` : '';
  try {
    const data = await apiFetch<{ controlPanels: ControlPanelSummary[] }>(`/api/v1/control-panels${query}`);
    const dbPanels = data.controlPanels ?? [];
    const seen = new Set(dbPanels.map((p) => p.slug));
    const extras = PLATFORM_CATALOG.filter((p) => !seen.has(p.slug) && (!category || p.category === category));
    return [...dbPanels, ...extras];
  } catch {
    return category ? PLATFORM_CATALOG.filter((p) => p.category === category) : PLATFORM_CATALOG;
  }
}

export async function fetchControlPanel(slug: string): Promise<ControlPanelDetail> {
  try {
    const data = await apiFetch<{ controlPanel: ControlPanelDetail }>(`/api/v1/control-panels/${encodeURIComponent(slug)}`);
    return data.controlPanel;
  } catch {
    const found = PLATFORM_CATALOG.find((p) => p.slug === slug);
    if (!found) {
      throw new Error(`Platform "${slug}" not found`);
    }
    return {
      ...found,
      plans: [
        {
          id: `${found.id}-standard`,
          name: `${found.name} Standard`,
          description: `Managed ${found.name} deployment on CloudHost247.`,
          billingCycle: found.billingCycle,
          price: found.startingPrice,
          currency: found.currency,
          setupFee: '0',
          licenseType: found.requiresLicense ? 'COMMERCIAL' : 'OPEN_SOURCE',
          includedDomains: null,
          includedAccounts: null,
          status: 'ACTIVE',
        },
      ],
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
