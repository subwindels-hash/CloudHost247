/** Phase 6 — marketplace, installation, and deployment API types + client helpers. */
import { apiFetch } from './api';

// --- Marketplace (spec §41, §42) -----------------------------------------------------------------

export interface MarketplaceCategory {
  slug: string;
  name: string;
  description: string | null;
}

export interface MarketplaceApp {
  slug: string;
  name: string;
  description: string;
  logoUrl: string | null;
  category: { slug: string; name: string } | null;
  license: string | null;
  featured: boolean;
  popularity: number;
  installCount: number;
  requirements: {
    minCpu: number;
    minMemoryMb: number;
    minStorageMb: number;
    recommendedCpu: number;
    recommendedMemoryMb: number;
    recommendedStorageMb: number;
    gpu: boolean;
  };
  supportedHostingTypes: string[];
  stableVersion: string | null;
}

export interface MarketplaceAppDetail extends MarketplaceApp {
  longDescription: string | null;
  websiteUrl: string | null;
  repositoryUrl: string | null;
  documentationUrl: string | null;
  deploymentType: string;
  versions: Array<{ id: string; version: string; releaseNotes: string | null; stable: boolean; requirements: { minCpu: number; minMemoryMb: number; minStorageMb: number } }>;
  environment: {
    required: Array<{ key: string; label: string | null; description: string | null; secret: boolean }>;
    optional: Array<{ key: string; label: string | null; description: string | null; secret: boolean; default: string | null }>;
  };
  domainRequired: boolean;
  sslSupported: boolean;
  backupsSupported: boolean;
}

export async function fetchMarketplaceApps(params: { category?: string; search?: string; sort?: string } = {}) {
  const query = new URLSearchParams();
  if (params.category) query.set('category', params.category);
  if (params.search) query.set('search', params.search);
  if (params.sort) query.set('sort', params.sort);
  const qs = query.toString();
  return apiFetch<{ apps: MarketplaceApp[]; total: number }>(`/api/v1/apps${qs ? `?${qs}` : ''}`);
}

export async function fetchMarketplaceCategories() {
  return apiFetch<{ categories: MarketplaceCategory[] }>('/api/v1/app-categories');
}

export async function fetchMarketplaceApp(slug: string) {
  return apiFetch<{ app: MarketplaceAppDetail }>(`/api/v1/apps/${slug}`);
}

// --- Installations (spec §23, §44) ---------------------------------------------------------------

export interface MyInstallation {
  id: string;
  name: string;
  application: { name: string; slug: string; logoUrl: string | null } | null;
  version: string | null;
  server: { name: string; type: string } | null;
  status: string;
  domain: string | null;
  health: string;
  cpuLimit: number | null;
  memoryLimitMb: number | null;
  storageLimitMb: number | null;
  restartCount: number;
  lastBackupAt: string | null;
  createdAt: string;
}

export interface InstallationRequestResult {
  installationId: string;
  orderId: string;
  orderNumber: string;
  invoiceId: string;
  invoiceNumber: string;
  totalAmount: string;
  currency: string;
  paymentRequired: boolean;
  status: string;
}

export async function requestInstallation(input: {
  applicationId: string;
  versionId?: string;
  serverId?: string;
  name?: string;
  domain?: string | null;
  environment?: Record<string, string>;
}) {
  return apiFetch<InstallationRequestResult>('/api/v1/app-installations', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function fetchMyInstallations() {
  return apiFetch<{ installations: MyInstallation[] }>('/api/v1/app-installations');
}

export async function installationAction(id: string, action: string, body?: unknown) {
  return apiFetch<{ deploymentId: string; status: string; queued: boolean }>(
    `/api/v1/app-installations/${id}/${action}`,
    { method: 'POST', body: JSON.stringify(body ?? {}) }
  );
}

export async function deleteInstallation(id: string) {
  return apiFetch<{ deploymentId: string; status: string }>(`/api/v1/app-installations/${id}`, {
    method: 'DELETE',
  });
}

// --- Deployments (spec §24) -----------------------------------------------------------------------

export interface DeploymentStep {
  order: number;
  name: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
  error: string | null;
}

export interface DeploymentSummary {
  id: string;
  installation_id: string | null;
  server_id: string | null;
  action: string;
  status: string;
  attempts: number;
  max_attempts: number;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface DeploymentEvent {
  id: string;
  level: string;
  message: string;
  created_at: string;
}

export async function fetchDeployment(id: string) {
  return apiFetch<{ deployment: DeploymentSummary; steps: Array<DeploymentStep & { id: string }>; events: DeploymentEvent[] }>(
    `/api/v1/deployments/${id}`
  );
}

export async function fetchInstallationsDeployments(id: string) {
  return apiFetch<{ deployments: DeploymentSummary[] }>(`/api/v1/app-installations/${id}/deployments`);
}

/**
 * Live deployment stream over Server-Sent Events with a polling fallback: the spec's
 * "Deploying… ✓ Validating order ● Pulling image" console (spec §24). EventSource cannot send
 * the Authorization header, so the token rides as a query parameter on this read-only stream.
 */
export function subscribeToDeployment(
  deploymentId: string,
  handlers: {
    onEvents: (events: DeploymentEvent[]) => void;
    onState: (state: { status: string; steps: DeploymentStep[] }) => void;
    onDone: (outcome: { status: string }) => void;
    onError?: (message: string) => void;
  }
): () => void {
  const token = localStorage.getItem('ch247_token');
  const source = new EventSource(`/api/v1/deployments/${deploymentId}/events?token=${encodeURIComponent(token ?? '')}`);
  source.addEventListener('events', (event) => handlers.onEvents(JSON.parse((event as MessageEvent).data)));
  source.addEventListener('state', (event) => handlers.onState(JSON.parse((event as MessageEvent).data)));
  source.addEventListener('done', (event) => {
    handlers.onDone(JSON.parse((event as MessageEvent).data));
    source.close();
  });
  source.onerror = () => {
    // EventSource retries automatically; surface a single notice only if it stays broken.
    handlers.onError?.('Live connection interrupted — retrying');
  };
  return () => source.close();
}

// --- Servers (wizard step 3) ---------------------------------------------------------------------

export interface PublicServer {
  id: string;
  name: string;
  serverType: string;
  region: string | null;
  status: string;
  dockerEnabled: boolean;
  kubernetesEnabled: boolean;
  cpanelEnabled: boolean;
  cpuCores: number;
  memoryMb: number;
  storageMb: number;
}

export async function fetchPublicServers() {
  return apiFetch<{ servers: PublicServer[] }>('/api/v1/servers');
}

export async function payInvoice(invoiceId: string, gateway = 'sandbox') {
  return apiFetch<{ payment: { id: string; status: string; instructions?: string | null } }>(
    `/api/v1/invoices/${invoiceId}/payments`,
    { method: 'POST', body: JSON.stringify({ gateway }) }
  );
}
