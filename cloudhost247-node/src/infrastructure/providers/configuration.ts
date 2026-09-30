/**
 * Declarative description of what each infrastructure adapter needs before it may be used.
 *
 * This is the single source of truth behind:
 *  - the operator documentation in docs/SERVER_PROVISIONING.md,
 *  - the admin "provider configuration" panel, which reports *which* variables are missing
 *    without ever reading, returning, or logging a secret value,
 *  - the fail-closed CONFIGURATION_REQUIRED / PROVIDER_NOT_CONFIGURED states.
 */
import type { InfrastructureProviderRow, ProviderAdapterKind } from '../../db/infrastructure-providers';

export type AdapterKind = ProviderAdapterKind | 'mock';

export interface AdapterCredentialSpec {
  /** Suffix appended to the provider credential prefix, e.g. `_API_TOKEN`. */
  suffix: string;
  description: string;
  required: boolean;
  /** Global fallback variable name used when no per-provider prefix is set. */
  fallback?: string;
}

export interface AdapterPlanMetadataSpec {
  key: string;
  description: string;
  required: boolean;
}

export interface AdapterProfile {
  kind: AdapterKind;
  label: string;
  defaultEnvPrefix: string;
  defaultApiBaseUrl: string | null;
  /** True when the provider row must carry an explicit api_base_url (self-hosted panels). */
  requiresApiBaseUrl: boolean;
  credentials: AdapterCredentialSpec[];
  planMetadata: AdapterPlanMetadataSpec[];
  capabilities: {
    reinstall: boolean;
    snapshot: boolean;
    resize: boolean;
    console: boolean;
    metrics: boolean;
    rescue: boolean;
  };
  notes: string;
}

const RESOURCE_METADATA: AdapterPlanMetadataSpec[] = [
  { key: 'cpuCores', description: 'vCPU cores billed by the plan', required: true },
  { key: 'memoryMb', description: 'Memory in MB', required: true },
  { key: 'storageMb', description: 'Disk in MB', required: true },
];

export const ADAPTER_PROFILES: Record<AdapterKind, AdapterProfile> = {
  hetzner: {
    kind: 'hetzner',
    label: 'Hetzner Cloud',
    defaultEnvPrefix: 'HETZNER',
    defaultApiBaseUrl: 'https://api.hetzner.cloud/v1',
    requiresApiBaseUrl: false,
    credentials: [{ suffix: '_API_TOKEN', description: 'Hetzner Cloud project API token', required: true, fallback: 'HETZNER_API_TOKEN' }],
    planMetadata: [
      { key: 'providerServerType', description: 'Hetzner server type, e.g. cx22', required: true },
      ...RESOURCE_METADATA,
    ],
    capabilities: { reinstall: true, snapshot: true, resize: true, console: true, metrics: true, rescue: false },
    notes: 'Native API. Idempotency uses the cloudhost247_idempotency label plus lookup-before-create.',
  },
  digitalocean: {
    kind: 'digitalocean',
    label: 'DigitalOcean',
    defaultEnvPrefix: 'DIGITALOCEAN',
    defaultApiBaseUrl: 'https://api.digitalocean.com/v2',
    requiresApiBaseUrl: false,
    credentials: [{ suffix: '_API_TOKEN', description: 'DigitalOcean personal access token', required: true, fallback: 'DIGITALOCEAN_API_TOKEN' }],
    planMetadata: [{ key: 'providerServerType', description: 'Droplet size slug', required: true }, ...RESOURCE_METADATA],
    capabilities: { reinstall: true, snapshot: true, resize: true, console: true, metrics: false, rescue: false },
    notes: 'Native droplet API with user-data, rebuild, resize and snapshots.',
  },
  vultr: {
    kind: 'vultr',
    label: 'Vultr',
    defaultEnvPrefix: 'VULTR',
    defaultApiBaseUrl: 'https://api.vultr.com/v2',
    requiresApiBaseUrl: false,
    credentials: [{ suffix: '_API_KEY', description: 'Vultr API key', required: true, fallback: 'VULTR_API_KEY' }],
    planMetadata: [{ key: 'providerServerType', description: 'Vultr plan id', required: true }, ...RESOURCE_METADATA],
    capabilities: { reinstall: true, snapshot: true, resize: true, console: true, metrics: false, rescue: false },
    notes: 'Native instance API.',
  },
  aws: {
    kind: 'aws',
    label: 'Amazon EC2',
    defaultEnvPrefix: 'AWS',
    defaultApiBaseUrl: null,
    requiresApiBaseUrl: false,
    credentials: [
      { suffix: '_ACCESS_KEY_ID', description: 'IAM access key id', required: true, fallback: 'AWS_ACCESS_KEY_ID' },
      { suffix: '_SECRET_ACCESS_KEY', description: 'IAM secret access key', required: true, fallback: 'AWS_SECRET_ACCESS_KEY' },
      { suffix: '_REGION', description: 'Default EC2 region', required: true, fallback: 'AWS_REGION' },
    ],
    planMetadata: [{ key: 'providerServerType', description: 'EC2 instance type', required: true }, ...RESOURCE_METADATA],
    capabilities: { reinstall: false, snapshot: true, resize: true, console: false, metrics: true, rescue: false },
    notes: 'SigV4 EC2 API.',
  },
  contabo: {
    kind: 'contabo',
    label: 'Contabo',
    defaultEnvPrefix: 'CONTABO',
    defaultApiBaseUrl: 'https://api.contabo.com/v1',
    requiresApiBaseUrl: false,
    credentials: [
      { suffix: '_CLIENT_ID', description: 'OAuth client id', required: true, fallback: 'CONTABO_CLIENT_ID' },
      { suffix: '_CLIENT_SECRET', description: 'OAuth client secret', required: true, fallback: 'CONTABO_CLIENT_SECRET' },
      { suffix: '_API_USER', description: 'API user', required: true, fallback: 'CONTABO_API_USER' },
      { suffix: '_API_PASSWORD', description: 'API password', required: true, fallback: 'CONTABO_API_PASSWORD' },
    ],
    planMetadata: [{ key: 'providerServerType', description: 'Contabo product id', required: true }, ...RESOURCE_METADATA],
    capabilities: { reinstall: true, snapshot: true, resize: false, console: false, metrics: false, rescue: false },
    notes: 'OAuth2 client-credentials API.',
  },
  ovh: {
    kind: 'ovh',
    label: 'OVHcloud Public Cloud',
    defaultEnvPrefix: 'OVH',
    defaultApiBaseUrl: 'https://eu.api.ovh.com/1.0',
    requiresApiBaseUrl: false,
    credentials: [
      { suffix: '_APPLICATION_KEY', description: 'OVH application key', required: true, fallback: 'OVH_APPLICATION_KEY' },
      { suffix: '_APPLICATION_SECRET', description: 'OVH application secret', required: true, fallback: 'OVH_APPLICATION_SECRET' },
      { suffix: '_CONSUMER_KEY', description: 'OVH consumer key with /cloud access', required: true, fallback: 'OVH_CONSUMER_KEY' },
      { suffix: '_CLOUD_PROJECT_ID', description: 'Public Cloud project (service name) that owns the instances', required: true, fallback: 'OVH_CLOUD_PROJECT_ID' },
      { suffix: '_API_ENDPOINT', description: 'Regional API endpoint when it is not set on the provider row', required: false, fallback: 'OVH_API_ENDPOINT' },
    ],
    planMetadata: [
      { key: 'providerFlavorId', description: 'OVH flavor id for the plan', required: true },
      { key: 'providerSshKeyId', description: 'Optional OVH SSH key id injected in addition to customer keys', required: false },
      ...RESOURCE_METADATA,
    ],
    capabilities: { reinstall: true, snapshot: true, resize: true, console: true, metrics: true, rescue: false },
    notes: 'Signed OVH v1 API against /cloud/project/{id}/instance. Instances are named from the job idempotency key and looked up before creation.',
  },
  proxmox: {
    kind: 'proxmox',
    label: 'Proxmox VE',
    defaultEnvPrefix: 'PROXMOX',
    defaultApiBaseUrl: null,
    requiresApiBaseUrl: true,
    credentials: [
      { suffix: '_API_TOKEN', description: 'API token in the form user@realm!tokenid=uuid', required: true, fallback: 'PROXMOX_API_TOKEN' },
      { suffix: '_API_URL', description: 'https URL of the PVE API when it is not set on the provider row', required: false, fallback: 'PROXMOX_API_URL' },
    ],
    planMetadata: [
      { key: 'providerNode', description: 'Target PVE node (or set provider metadata defaultNode)', required: true },
      { key: 'providerStorage', description: 'Storage for the cloned disk / container rootfs', required: false },
      { key: 'providerBridge', description: 'Network bridge, default vmbr0', required: false },
      { key: 'providerSnippetStorage', description: 'Snippet storage used for cloud-init user data', required: false },
      ...RESOURCE_METADATA,
    ],
    capabilities: { reinstall: true, snapshot: true, resize: true, console: true, metrics: true, rescue: false },
    notes: 'QEMU full clone from a template VMID, or LXC from a vztmpl volume. Provider server ids are node/type/vmid.',
  },
  virtualizor: {
    kind: 'virtualizor',
    label: 'Virtualizor',
    defaultEnvPrefix: 'VIRTUALIZOR',
    defaultApiBaseUrl: null,
    requiresApiBaseUrl: true,
    credentials: [
      { suffix: '_API_KEY', description: 'Virtualizor admin API key', required: true, fallback: 'VIRTUALIZOR_API_KEY' },
      { suffix: '_API_SECRET', description: 'Virtualizor admin API password', required: true, fallback: 'VIRTUALIZOR_API_SECRET' },
      { suffix: '_API_URL', description: 'https URL of the admin panel when it is not set on the provider row', required: false, fallback: 'VIRTUALIZOR_API_URL' },
    ],
    planMetadata: [
      { key: 'providerVirtType', description: 'Virtualization type: kvm, openvz, lxc, proxk, proxl', required: true },
      { key: 'providerNode', description: 'Virtualizor server id (or providerNodeGroup)', required: false },
      { key: 'providerUserId', description: 'Virtualizor user id that owns created VPSes', required: false },
      { key: 'providerPlanId', description: 'Virtualizor plan id', required: false },
      ...RESOURCE_METADATA,
    ],
    capabilities: { reinstall: true, snapshot: true, resize: true, console: true, metrics: true, rescue: false },
    notes: 'Admin API. The selected OS template must have cloud-init enabled so the agent, SSH keys and hostname are applied.',
  },
  solusvm: {
    kind: 'solusvm',
    label: 'SolusVM 1',
    defaultEnvPrefix: 'SOLUSVM',
    defaultApiBaseUrl: null,
    requiresApiBaseUrl: true,
    credentials: [
      { suffix: '_API_ID', description: 'SolusVM admin API id', required: true, fallback: 'SOLUSVM_API_ID' },
      { suffix: '_API_KEY', description: 'SolusVM admin API key', required: true, fallback: 'SOLUSVM_API_KEY' },
      { suffix: '_API_URL', description: 'https URL of the SolusVM master when it is not set on the provider row', required: false, fallback: 'SOLUSVM_API_URL' },
    ],
    planMetadata: [
      { key: 'providerVirtType', description: 'openvz, xen, xen hvm or kvm', required: true },
      { key: 'providerClientId', description: 'SolusVM username that owns created servers', required: true },
      { key: 'providerPlanId', description: 'SolusVM plan name', required: true },
      { key: 'providerNode', description: 'SolusVM node (or providerNodeGroup)', required: false },
      ...RESOURCE_METADATA,
    ],
    capabilities: { reinstall: true, snapshot: false, resize: true, console: true, metrics: true, rescue: false },
    notes: 'Admin API v1 (api/admin/command.php). Snapshots are not exposed by SolusVM 1.',
  },
  openstack: {
    kind: 'openstack',
    label: 'OpenStack',
    defaultEnvPrefix: 'OPENSTACK',
    defaultApiBaseUrl: null,
    requiresApiBaseUrl: false,
    credentials: [
      { suffix: '_AUTH_URL', description: 'Keystone v3 URL (password login)', required: false, fallback: 'OPENSTACK_AUTH_URL' },
      { suffix: '_USERNAME', description: 'Keystone user (password login)', required: false, fallback: 'OPENSTACK_USERNAME' },
      { suffix: '_PASSWORD', description: 'Keystone password (password login)', required: false, fallback: 'OPENSTACK_PASSWORD' },
      { suffix: '_PROJECT_ID', description: 'Project id (or _PROJECT_NAME)', required: false, fallback: 'OPENSTACK_PROJECT_ID' },
      { suffix: '_API_URL', description: 'Nova compute endpoint (token login)', required: false, fallback: 'OPENSTACK_API_URL' },
      { suffix: '_API_TOKEN', description: 'Pre-issued Keystone token (token login)', required: false, fallback: 'OPENSTACK_API_TOKEN' },
    ],
    planMetadata: [
      { key: 'providerFlavorId', description: 'Nova flavor id', required: true },
      { key: 'providerNetworkId', description: 'Neutron network id attached at boot', required: false },
      { key: 'providerKeypairName', description: 'Optional Nova keypair injected in addition to customer keys', required: false },
      ...RESOURCE_METADATA,
    ],
    capabilities: { reinstall: true, snapshot: true, resize: true, console: true, metrics: false, rescue: false },
    notes: 'Keystone v3 + Nova + Glance. Either password login or a pre-issued token is required.',
  },
  generic_http: {
    kind: 'generic_http',
    label: 'Operator provider bridge (HTTPS)',
    defaultEnvPrefix: 'PROVIDER_BRIDGE',
    defaultApiBaseUrl: null,
    requiresApiBaseUrl: true,
    credentials: [{ suffix: '_API_TOKEN', description: 'Bearer token for the operator-owned bridge', required: true }],
    planMetadata: [{ key: 'providerServerType', description: 'Plan identifier understood by the bridge', required: false }, ...RESOURCE_METADATA],
    capabilities: { reinstall: true, snapshot: false, resize: false, console: true, metrics: true, rescue: false },
    notes: 'For providers without a native adapter. The bridge is a real integration, never a simulator.',
  },
  mock: {
    kind: 'mock',
    label: 'Mock provider (development only)',
    defaultEnvPrefix: 'MOCK',
    defaultApiBaseUrl: null,
    requiresApiBaseUrl: false,
    credentials: [
      { suffix: '_UNUSED', description: 'No credentials. Requires ALLOW_MOCK_PROVIDER=true and a non-production NODE_ENV.', required: false },
    ],
    planMetadata: RESOURCE_METADATA,
    capabilities: { reinstall: true, snapshot: true, resize: true, console: false, metrics: false, rescue: false },
    notes: 'Never selected automatically and disabled in production. Mock resources are labelled mock:true with mock- ids.',
  },
};

export interface ProviderConfigurationReport {
  adapter: AdapterKind;
  label: string;
  envPrefix: string;
  apiBaseUrl: string | null;
  apiBaseUrlRequired: boolean;
  apiBaseUrlConfigured: boolean;
  /** Variable names and presence only — values are never read into this structure. */
  credentials: Array<{ name: string; fallbackName: string | null; description: string; required: boolean; present: boolean }>;
  planMetadata: AdapterPlanMetadataSpec[];
  capabilities: AdapterProfile['capabilities'];
  notes: string;
  ready: boolean;
  missing: string[];
}

export function getAdapterProfile(adapter: string): AdapterProfile | null {
  return ADAPTER_PROFILES[adapter as AdapterKind] ?? null;
}

/**
 * Reports whether a provider row can be used, without exposing any secret material. Only
 * variable *names* and booleans leave this function, so the result is safe for the admin UI.
 */
export function describeProviderConfiguration(
  provider: Pick<InfrastructureProviderRow, 'adapter' | 'api_base_url' | 'credential_env_prefix'>,
  source: NodeJS.ProcessEnv = process.env
): ProviderConfigurationReport {
  const profile = getAdapterProfile(provider.adapter);
  if (!profile) {
    return {
      adapter: provider.adapter as AdapterKind,
      label: provider.adapter,
      envPrefix: provider.credential_env_prefix ?? '',
      apiBaseUrl: provider.api_base_url,
      apiBaseUrlRequired: true,
      apiBaseUrlConfigured: Boolean(provider.api_base_url),
      credentials: [],
      planMetadata: [],
      capabilities: { reinstall: false, snapshot: false, resize: false, console: false, metrics: false, rescue: false },
      notes: 'No adapter implementation is registered for this provider; provisioning fails closed.',
      ready: false,
      missing: ['adapter implementation'],
    };
  }
  const prefix = provider.credential_env_prefix || profile.defaultEnvPrefix;
  const credentials = profile.credentials.map((credential) => {
    const name = `${prefix}${credential.suffix}`;
    const fallbackName = credential.fallback ?? null;
    const present = Boolean(source[name] ?? (fallbackName ? source[fallbackName] : undefined));
    return { name, fallbackName, description: credential.description, required: credential.required, present };
  });
  const apiBaseUrlConfigured = Boolean(provider.api_base_url ?? profile.defaultApiBaseUrl);
  const missing = credentials.filter((credential) => credential.required && !credential.present).map((credential) => credential.name);
  if (profile.requiresApiBaseUrl && !apiBaseUrlConfigured) missing.push('api_base_url');
  // OpenStack accepts either of two credential sets, so completeness is evaluated per login mode.
  if (profile.kind === 'openstack') {
    const present = (suffix: string) => credentials.find((credential) => credential.name.endsWith(suffix))?.present === true;
    const passwordLogin = present('_AUTH_URL') && present('_USERNAME') && present('_PASSWORD') && present('_PROJECT_ID');
    const tokenLogin = (present('_API_URL') || apiBaseUrlConfigured) && present('_API_TOKEN');
    missing.length = 0;
    if (!passwordLogin && !tokenLogin) {
      missing.push(`${prefix}_AUTH_URL + ${prefix}_USERNAME + ${prefix}_PASSWORD + ${prefix}_PROJECT_ID (or ${prefix}_API_URL + ${prefix}_API_TOKEN)`);
    }
  }
  if (profile.kind === 'mock') {
    missing.length = 0;
    if (source.NODE_ENV === 'production') missing.push('mock provider is disabled in production');
    else if (source.ALLOW_MOCK_PROVIDER !== 'true') missing.push('ALLOW_MOCK_PROVIDER=true');
  }
  return {
    adapter: profile.kind,
    label: profile.label,
    envPrefix: prefix,
    apiBaseUrl: provider.api_base_url ?? profile.defaultApiBaseUrl,
    apiBaseUrlRequired: profile.requiresApiBaseUrl,
    apiBaseUrlConfigured,
    credentials,
    planMetadata: profile.planMetadata,
    capabilities: profile.capabilities,
    notes: profile.notes,
    ready: missing.length === 0,
    missing,
  };
}
