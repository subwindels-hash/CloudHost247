/**
 * Declarative description of what each infrastructure adapter needs before it may be used.
 *
 * Ported from cloudhost247-node/src/infrastructure/providers/configuration.ts. This is the single
 * source of truth behind the admin "provider configuration" panel, which reports *which* variables
 * are missing without ever reading, returning, or logging a secret value, and behind the
 * fail-closed CONFIGURATION_REQUIRED state.
 *
 * The live adapters themselves (AWS SigV4, live Cloudflare, …) stay at the adapter boundary and are
 * not part of this build; what ships here is the registry, so an operator can see what a provider
 * needs and the platform can refuse to promise an operation no adapter implements.
 */
'use strict';

const RESOURCE_METADATA = [
  { key: 'cpuCores', description: 'vCPU cores billed by the plan', required: true },
  { key: 'memoryMb', description: 'Memory in MB', required: true },
  { key: 'storageMb', description: 'Disk in MB', required: true },
];

const ALWAYS_AVAILABLE_CAPABILITIES = ['start', 'stop', 'reboot', 'shutdown', 'delete'];
const NO_CAPABILITIES = { reinstall: false, snapshot: false, resize: false, console: false, metrics: false, rescue: false };

const ADAPTER_PROFILES = {
  hetzner: {
    kind: 'hetzner', label: 'Hetzner Cloud', defaultEnvPrefix: 'HETZNER',
    defaultApiBaseUrl: 'https://api.hetzner.cloud/v1', requiresApiBaseUrl: false,
    credentials: [{ suffix: '_API_TOKEN', description: 'Hetzner Cloud project API token', required: true, fallback: 'HETZNER_API_TOKEN' }],
    planMetadata: [{ key: 'providerServerType', description: 'Hetzner server type, e.g. cx22', required: true }, ...RESOURCE_METADATA],
    capabilities: { reinstall: true, snapshot: true, resize: true, console: true, metrics: true, rescue: true },
    notes: 'Native API. Idempotency uses the cloudhost247_idempotency label plus lookup-before-create.',
  },
  digitalocean: {
    kind: 'digitalocean', label: 'DigitalOcean', defaultEnvPrefix: 'DIGITALOCEAN',
    defaultApiBaseUrl: 'https://api.digitalocean.com/v2', requiresApiBaseUrl: false,
    credentials: [{ suffix: '_API_TOKEN', description: 'DigitalOcean personal access token', required: true, fallback: 'DIGITALOCEAN_API_TOKEN' }],
    planMetadata: [{ key: 'providerServerType', description: 'Droplet size slug', required: true }, ...RESOURCE_METADATA],
    capabilities: { reinstall: true, snapshot: true, resize: true, console: false, metrics: true, rescue: false },
    notes: 'Native droplet API with user-data, rebuild, resize and snapshots. There is no console: API v2 has no console operation.',
  },
  vultr: {
    kind: 'vultr', label: 'Vultr', defaultEnvPrefix: 'VULTR',
    defaultApiBaseUrl: 'https://api.vultr.com/v2', requiresApiBaseUrl: false,
    credentials: [{ suffix: '_API_KEY', description: 'Vultr API key', required: true, fallback: 'VULTR_API_KEY' }],
    planMetadata: [{ key: 'providerServerType', description: 'Vultr plan id', required: true }, ...RESOURCE_METADATA],
    capabilities: { reinstall: true, snapshot: true, resize: true, console: true, metrics: true, rescue: true },
    notes: 'Native instance API. Metrics are bandwidth-only because that is all Vultr exposes; CPU/memory/filesystem/load are left to the CloudHost247 server agent.',
  },
  aws: {
    kind: 'aws', label: 'Amazon EC2', defaultEnvPrefix: 'AWS', defaultApiBaseUrl: null, requiresApiBaseUrl: false,
    credentials: [
      { suffix: '_ACCESS_KEY_ID', description: 'IAM access key id', required: true, fallback: 'AWS_ACCESS_KEY_ID' },
      { suffix: '_SECRET_ACCESS_KEY', description: 'IAM secret access key', required: true, fallback: 'AWS_SECRET_ACCESS_KEY' },
      { suffix: '_REGION', description: 'Default EC2 region', required: true, fallback: 'AWS_REGION' },
    ],
    planMetadata: [{ key: 'providerServerType', description: 'EC2 instance type', required: true }, ...RESOURCE_METADATA],
    capabilities: { reinstall: false, snapshot: true, resize: true, console: true, metrics: true, rescue: false },
    notes: 'Native EC2 adapter uses the AWS Signature Version 4 client, which is deferred at the adapter boundary in this build.',
  },
  contabo: {
    kind: 'contabo', label: 'Contabo', defaultEnvPrefix: 'CONTABO',
    defaultApiBaseUrl: 'https://api.contabo.com/v1', requiresApiBaseUrl: false,
    credentials: [
      { suffix: '_CLIENT_ID', description: 'OAuth client id', required: true, fallback: 'CONTABO_CLIENT_ID' },
      { suffix: '_CLIENT_SECRET', description: 'OAuth client secret', required: true, fallback: 'CONTABO_CLIENT_SECRET' },
      { suffix: '_API_USER', description: 'API user', required: true, fallback: 'CONTABO_API_USER' },
      { suffix: '_API_PASSWORD', description: 'API password', required: true, fallback: 'CONTABO_API_PASSWORD' },
      { suffix: '_API_URL', description: 'Compute API base URL override', required: false, fallback: 'CONTABO_API_URL' },
      { suffix: '_TOKEN_URL', description: 'OAuth2 token URL override', required: false, fallback: 'CONTABO_TOKEN_URL' },
    ],
    planMetadata: [{ key: 'providerServerType', description: 'Contabo instance type', required: true }, ...RESOURCE_METADATA],
    capabilities: { reinstall: true, snapshot: true, resize: false, console: false, metrics: false, rescue: true },
    notes: 'OAuth2 client-credentials API. Resize and console are not offered by the compute API.',
  },
  ovh: {
    kind: 'ovh', label: 'OVHcloud Public Cloud', defaultEnvPrefix: 'OVH',
    defaultApiBaseUrl: 'https://eu.api.ovh.com/1.0', requiresApiBaseUrl: false,
    credentials: [
      { suffix: '_APPLICATION_KEY', description: 'OVH application key', required: true, fallback: 'OVH_APPLICATION_KEY' },
      { suffix: '_APPLICATION_SECRET', description: 'OVH application secret', required: true, fallback: 'OVH_APPLICATION_SECRET' },
      { suffix: '_CONSUMER_KEY', description: 'OVH consumer key', required: true, fallback: 'OVH_CONSUMER_KEY' },
      { suffix: '_CLOUD_PROJECT_ID', description: 'Public Cloud project id', required: true, fallback: 'OVH_CLOUD_PROJECT_ID' },
      { suffix: '_API_ENDPOINT', description: 'API endpoint override', required: false, fallback: 'OVH_API_ENDPOINT' },
    ],
    planMetadata: [{ key: 'providerServerType', description: 'OVH flavor id', required: true }, ...RESOURCE_METADATA],
    capabilities: { reinstall: true, snapshot: true, resize: true, console: true, metrics: true, rescue: true },
    notes: 'Native Public Cloud API signed with the OVH consumer-key scheme.',
  },
  proxmox: {
    kind: 'proxmox', label: 'Proxmox VE', defaultEnvPrefix: 'PROXMOX', defaultApiBaseUrl: null, requiresApiBaseUrl: true,
    credentials: [
      { suffix: '_API_TOKEN', description: 'API token (user@realm!tokenid)', required: true, fallback: 'PROXMOX_API_TOKEN' },
      { suffix: '_API_URL', description: 'Cluster API base URL', required: false, fallback: 'PROXMOX_API_URL' },
    ],
    planMetadata: [{ key: 'providerServerType', description: 'Proxmox node name', required: true }, ...RESOURCE_METADATA],
    capabilities: { reinstall: true, snapshot: true, resize: true, console: true, metrics: true, rescue: false },
    notes: 'Self-hosted: the provider row must carry an explicit https api_base_url.',
  },
  virtualizor: {
    kind: 'virtualizor', label: 'Virtualizor', defaultEnvPrefix: 'VIRTUALIZOR', defaultApiBaseUrl: null, requiresApiBaseUrl: true,
    credentials: [
      { suffix: '_API_KEY', description: 'Virtualizor API key', required: true, fallback: 'VIRTUALIZOR_API_KEY' },
      { suffix: '_API_SECRET', description: 'Virtualizor API pass', required: true, fallback: 'VIRTUALIZOR_API_SECRET' },
      { suffix: '_API_URL', description: 'Panel base URL', required: false, fallback: 'VIRTUALIZOR_API_URL' },
    ],
    planMetadata: [{ key: 'providerServerType', description: 'Virtualizor plan id', required: true }, ...RESOURCE_METADATA],
    capabilities: { reinstall: true, snapshot: true, resize: true, console: true, metrics: true, rescue: false },
    notes: 'Self-hosted: the provider row must carry an explicit https api_base_url.',
  },
  solusvm: {
    kind: 'solusvm', label: 'SolusVM 1', defaultEnvPrefix: 'SOLUSVM', defaultApiBaseUrl: null, requiresApiBaseUrl: true,
    credentials: [
      { suffix: '_API_ID', description: 'SolusVM API key id', required: true, fallback: 'SOLUSVM_API_ID' },
      { suffix: '_API_KEY', description: 'SolusVM API key', required: true, fallback: 'SOLUSVM_API_KEY' },
      { suffix: '_API_URL', description: 'Master base URL', required: false, fallback: 'SOLUSVM_API_URL' },
    ],
    planMetadata: [{ key: 'providerServerType', description: 'SolusVM plan id', required: true }, ...RESOURCE_METADATA],
    capabilities: { reinstall: true, snapshot: false, resize: true, console: true, metrics: true, rescue: true },
    notes: 'Self-hosted: the provider row must carry an explicit https api_base_url.',
  },
  openstack: {
    kind: 'openstack', label: 'OpenStack', defaultEnvPrefix: 'OPENSTACK', defaultApiBaseUrl: null, requiresApiBaseUrl: false,
    credentials: [
      { suffix: '_AUTH_URL', description: 'Keystone auth URL (password login)', required: false, fallback: 'OPENSTACK_AUTH_URL' },
      { suffix: '_USERNAME', description: 'Keystone user (password login)', required: false, fallback: 'OPENSTACK_USERNAME' },
      { suffix: '_PASSWORD', description: 'Keystone password (password login)', required: false, fallback: 'OPENSTACK_PASSWORD' },
      { suffix: '_PROJECT_ID', description: 'Keystone project id (password login)', required: false, fallback: 'OPENSTACK_PROJECT_ID' },
      { suffix: '_API_URL', description: 'Nova base URL (token login)', required: false, fallback: 'OPENSTACK_API_URL' },
      { suffix: '_API_TOKEN', description: 'Pre-issued Keystone token (token login)', required: false, fallback: 'OPENSTACK_API_TOKEN' },
    ],
    planMetadata: [{ key: 'providerServerType', description: 'Nova flavor id', required: true }, ...RESOURCE_METADATA],
    capabilities: { reinstall: true, snapshot: true, resize: true, console: true, metrics: true, rescue: true },
    notes: 'Accepts either a Keystone password login or a pre-issued token, so completeness is evaluated per login mode.',
  },
  generic_http: {
    kind: 'generic_http', label: 'Operator provider bridge (HTTPS)', defaultEnvPrefix: 'PROVIDER_BRIDGE', defaultApiBaseUrl: null, requiresApiBaseUrl: true,
    credentials: [
      { suffix: '_API_TOKEN', description: 'Bearer token presented to the bridge', required: true, fallback: 'PROVIDER_BRIDGE_API_TOKEN' },
      { suffix: '_UNUSED', description: 'Reserved for a future second credential', required: false },
    ],
    planMetadata: [{ key: 'providerServerType', description: 'Bridge template id', required: true }, ...RESOURCE_METADATA],
    capabilities: { reinstall: true, snapshot: true, resize: true, console: true, metrics: true, rescue: true },
    notes: 'Lets an operator front any panel with a small HTTPS bridge that speaks the CloudHost247 provider contract.',
  },
  mock: {
    kind: 'mock', label: 'Mock provider (development only)', defaultEnvPrefix: 'MOCK', defaultApiBaseUrl: null, requiresApiBaseUrl: false,
    credentials: [{ suffix: '_API_TOKEN', description: 'Any non-empty value', required: true, fallback: 'MOCK_API_TOKEN' }],
    planMetadata: [{ key: 'providerServerType', description: 'Mock template id', required: true }, ...RESOURCE_METADATA],
    capabilities: { reinstall: true, snapshot: true, resize: true, console: false, metrics: false, rescue: true },
    notes: 'Never selected automatically and disabled in production. Console and metrics are refused rather than simulated: inventing either would teach a developer to trust a reading no provider produced.',
  },
};

/** Every adapter kind this build knows, in one place, so an API value can never lack a profile. */
const ADAPTER_KINDS = Object.keys(ADAPTER_PROFILES);

function getAdapterProfile(adapter) {
  return ADAPTER_PROFILES[adapter] ?? null;
}

/**
 * Reports whether a provider row can be used, without exposing any secret material. Only variable
 * *names* and booleans leave this function, so the result is safe for the admin UI.
 */
function describeProviderConfiguration(provider, source = process.env) {
  const rawAdapter = provider.adapter ?? provider.config?.adapter ?? provider.type ?? null;
  const profile = getAdapterProfile(rawAdapter);
  const apiBaseUrl = provider.api_base_url ?? provider.config?.apiBaseUrl ?? null;
  const credentialEnvPrefix = provider.credential_env_prefix ?? provider.config?.credentialEnvPrefix ?? null;
  if (!profile) {
    return {
      adapter: rawAdapter, label: rawAdapter ?? 'unconfigured', envPrefix: credentialEnvPrefix ?? '',
      apiBaseUrl, apiBaseUrlRequired: true, apiBaseUrlConfigured: Boolean(apiBaseUrl),
      credentials: [], planMetadata: [], capabilities: { ...NO_CAPABILITIES },
      notes: 'No adapter implementation is registered for this provider; provisioning fails closed.',
      ready: false, missing: ['adapter implementation'],
    };
  }
  const prefix = credentialEnvPrefix || profile.defaultEnvPrefix;
  const credentials = profile.credentials.map((credential) => {
    const credentialName = `${prefix}${credential.suffix}`;
    const fallbackName = credential.fallback ?? null;
    const present = Boolean(source[credentialName] ?? (fallbackName ? source[fallbackName] : undefined));
    return { name: credentialName, fallbackName, description: credential.description, required: credential.required, present };
  });
  const configuredBaseUrl = apiBaseUrl ?? profile.defaultApiBaseUrl;
  let apiBaseUrlConfigured = Boolean(configuredBaseUrl);
  if (configuredBaseUrl) {
    try {
      const parsed = new URL(configuredBaseUrl);
      const loopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
      apiBaseUrlConfigured = parsed.protocol === 'https:' || (parsed.protocol === 'http:' && loopback);
    } catch {
      apiBaseUrlConfigured = false;
    }
  }
  const missing = credentials.filter((c) => c.required && !c.present).map((c) => c.name);
  if (configuredBaseUrl && !apiBaseUrlConfigured) missing.push('api_base_url must use https');
  else if (profile.requiresApiBaseUrl && !apiBaseUrlConfigured) missing.push('api_base_url');
  if (profile.kind === 'openstack') {
    const present = (suffix) => credentials.find((c) => c.name.endsWith(suffix))?.present === true;
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
    adapter: profile.kind, label: profile.label, envPrefix: prefix,
    apiBaseUrl: apiBaseUrl ?? profile.defaultApiBaseUrl,
    apiBaseUrlRequired: profile.requiresApiBaseUrl, apiBaseUrlConfigured,
    credentials, planMetadata: profile.planMetadata, capabilities: profile.capabilities,
    notes: profile.notes, ready: missing.length === 0, missing,
  };
}

/** The admin-facing adapter list: profiles with the env var names each one expects. */
function listAdapterProfiles() {
  return Object.values(ADAPTER_PROFILES).map((profile) => ({
    adapter: profile.kind, label: profile.label, defaultEnvPrefix: profile.defaultEnvPrefix,
    defaultApiBaseUrl: profile.defaultApiBaseUrl, apiBaseUrlRequired: profile.requiresApiBaseUrl,
    credentials: profile.credentials.map((credential) => ({
      name: `${profile.defaultEnvPrefix}${credential.suffix}`,
      description: credential.description,
      required: credential.required,
    })),
    planMetadata: profile.planMetadata, capabilities: profile.capabilities,
    notes: profile.notes, developmentOnly: profile.kind === 'mock',
  }));
}

module.exports = {
  ADAPTER_PROFILES, ADAPTER_KINDS, ALWAYS_AVAILABLE_CAPABILITIES, NO_CAPABILITIES,
  getAdapterProfile, describeProviderConfiguration, listAdapterProfiles,
};
