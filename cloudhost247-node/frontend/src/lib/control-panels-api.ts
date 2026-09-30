import { apiFetch } from './api';

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
  const data = await apiFetch<{ controlPanels: ControlPanelSummary[] }>(`/api/v1/control-panels${query}`);
  return data.controlPanels;
}

export async function fetchControlPanel(slug: string): Promise<ControlPanelDetail> {
  const data = await apiFetch<{ controlPanel: ControlPanelDetail }>(`/api/v1/control-panels/${encodeURIComponent(slug)}`);
  return data.controlPanel;
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
