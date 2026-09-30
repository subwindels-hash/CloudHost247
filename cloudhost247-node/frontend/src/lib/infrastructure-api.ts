import { apiFetch } from './api';

export interface ServerPlan {
  id: string;
  name: string;
  description: string | null;
  product: { id: string; name: string; slug: string };
  serverTypes: Array<'VPS'|'DEDICATED'|'CLOUD'>;
  pricing: Array<{ billingPeriod: 'one_time'|'monthly'|'quarterly'|'semi_annually'|'annually'; currency: string; amount: string; setupFee: string | null }>;
}

export interface AvailableRegion {
  id: string;
  code: string;
  name: string;
  provider: { id: string; name: string };
  regionWideAvailable: boolean;
  datacenters: Array<{ id: string; code: string; name: string }>;
}

export interface AvailableOsVersion {
  id: string;
  version: string;
  displayName: string;
  releaseName: string | null;
  status: string;
  lts: boolean;
  recommended: boolean;
  default: boolean;
  architectures: Array<'x86_64'|'arm64'>;
  availability: Array<{ configurationId: string; providerId: string; regionId: string; datacenterId: string | null; architecture: 'x86_64'|'arm64' }>;
}

export interface AvailableOperatingSystem {
  id: string;
  name: string;
  slug: string;
  vendor: string | null;
  description: string | null;
  logoUrl: string | null;
  versions: AvailableOsVersion[];
}

export interface ServerConfiguration {
  plan: { id: string; name: string; description: string | null };
  regions: AvailableRegion[];
  operatingSystems: AvailableOperatingSystem[];
  controlPanels?: Array<{ id: string; name: string; slug: string; availability: Array<{ operatingSystemVersionId: string; architecture: string }> }>;
}

export interface CustomerServer {
  id: string;
  plan_id: string | null;
  provider_id: string | null;
  region_id: string | null;
  datacenter_id: string | null;
  operating_system_version_id: string | null;
  name: string;
  hostname: string;
  ip_address: string | null;
  server_type: string;
  architecture: string | null;
  status: string;
  provisioning_status: string | null;
  provider_name: string | null;
  region_name: string | null;
  datacenter_name: string | null;
  os_name: string | null;
  os_logo_url: string | null;
  os_display_name: string | null;
  control_panel_id?: string | null;
  control_panel_name?: string | null;
  control_panel_slug?: string | null;
  control_panel_logo_url?: string | null;
  control_panel_category?: string | null;
  control_panel_installation_method?: string | null;
  control_panel_capabilities?: Record<string, boolean> | null;
  cpu_cores: number;
  memory_mb: number;
  storage_mb: number;
  bandwidth_gb: number | null;
  renewal_date: string | null;
  capabilities: Record<string,boolean>;
  created_at: string;
}

export interface SshKey {
  id: string;
  name: string;
  fingerprint: string;
  created_at?: string;
}

export function fetchServerPlans() {
  return apiFetch<{ plans: ServerPlan[] }>('/api/v1/server-products');
}

export function fetchServerConfiguration(planId: string,serverType?: string) {
  const query = serverType ? `?serverType=${encodeURIComponent(serverType)}` : '';
  return apiFetch<ServerConfiguration>(`/api/v1/server-products/${planId}/configuration${query}`);
}

export function fetchSshKeys() { return apiFetch<{ sshKeys: SshKey[] }>('/api/v1/ssh-keys'); }
export function addSshKey(name: string,publicKey: string) {
  return apiFetch<{ sshKey: SshKey }>('/api/v1/ssh-keys',{ method: 'POST',body: JSON.stringify({ name,publicKey }) });
}
export function orderServer(input: {
  planId: string; billingPeriod: string; providerId: string; regionId: string; datacenterId?: string | null;
  operatingSystemVersionId: string; architecture: string; serverType: string; sshKeyIds: string[];
  hostname: string; controlPanelId?: string | null;
}) {
  return apiFetch<{ serverId: string; orderId: string; orderNumber: string; invoiceId: string; invoiceNumber: string; totalAmount: string; currency: string; paymentRequired: boolean; provisioningStatus: string }>(
    '/api/v1/servers',{ method: 'POST',body: JSON.stringify(input) }
  );
}

export function fetchCustomerServers() { return apiFetch<{ servers: CustomerServer[] }>('/api/v1/servers'); }
export function fetchCustomerServer(id: string) { return apiFetch<{ server: CustomerServer }>(`/api/v1/servers/${id}`); }
export function serverAction(id: string,action: string,body: unknown = {}) {
  return apiFetch<{ jobId: string; status: string; queued: boolean }>(`/api/v1/servers/${id}/${action}`,{ method: 'POST',headers: { 'Idempotency-Key': crypto.randomUUID() },body: JSON.stringify(body) });
}
