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
    capabilities: { reinstall: true, snapshot: true, resize: true, console: true, metrics: true, rescue: true },
    notes: 'Native API. Idempotency uses the cloudhost247_idempotency label plus lookup-before-create. Rescue boots Hetzner\'s linux64 rescue system and returns a one-time root password.',
  },
  digitalocean: {
    kind: 'digitalocean',
    label: 'DigitalOcean',
    defaultEnvPrefix: 'DIGITALOCEAN',
    defaultApiBaseUrl: 'https://api.digitalocean.com/v2',
    requiresApiBaseUrl: false,
    credentials: [{ suffix: '_API_TOKEN', description: 'DigitalOcean personal access token', required: true, fallback: 'DIGITALOCEAN_API_TOKEN' }],
    planMetadata: [{ key: 'providerServerType', description: 'Droplet size slug', required: true }, ...RESOURCE_METADATA],
    capabilities: { reinstall: true, snapshot: true, resize: true, console: false, metrics: true, rescue: false },
    notes: 'Native droplet API with user-data, rebuild, resize and snapshots. Metrics read the documented Monitoring API (GET /v2/monitoring/metrics/droplet/{metric} with host_id/start/end): CPU utilisation is derived from the per-mode counters over a one-hour window, load and memory are read as gauges and filesystems are reported per provider mountpoint label; a metric the monitoring agent does not report is listed in `missing`, never zero-filled. There is no console: the Droplet Console and the out-of-band Recovery Console are Control Panel features and API v2 has no console operation.',
  },
  vultr: {
    kind: 'vultr',
    label: 'Vultr',
    defaultEnvPrefix: 'VULTR',
    defaultApiBaseUrl: 'https://api.vultr.com/v2',
    requiresApiBaseUrl: false,
    credentials: [{ suffix: '_API_KEY', description: 'Vultr API key', required: true, fallback: 'VULTR_API_KEY' }],
    planMetadata: [{ key: 'providerServerType', description: 'Vultr plan id', required: true }, ...RESOURCE_METADATA],
    capabilities: { reinstall: true, snapshot: true, resize: true, console: true, metrics: true, rescue: true },
    notes: 'Native instance API. Metrics are bandwidth-only because that is all Vultr exposes: GET /v2/instances/{id}/bandwidth returns per-UTC-day in/out byte counters (date_range 1-180 days) and Vultr documents that it should not be used for real-time metrics, so CPU/memory/filesystem/load are reported in `missing` and left to the CloudHost247 server agent. The console is real and is read from the instance itself: every API v2 instance carries `kvm`, "the server\'s current KVM URL", which Vultr documents as changing periodically and advises against caching — the adapter reads it fresh on each request and never stores it (bare metal has a separate /v2/bare-metals/{id}/vnc operation). Rescue uses the recovery path Vultr documents rather than a rescue endpoint: rescue mode is a bare-metal portal feature, while a cloud instance is repaired by booting SystemRescue from the public ISO library, so the adapter resolves the SystemRescue image from `GET /v2/iso-public` at call time, attaches it with `POST /v2/instances/{id}/iso/attach`, reboots, and detaches the ISO on the way out — which Vultr documents as rebooting the instance back into the installed system. SystemRescue signs the operator in at the console as root with no password, so nothing is stored.',
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
    capabilities: { reinstall: false, snapshot: true, resize: true, console: true, metrics: true, rescue: false },
    notes: 'Native EC2 adapter uses the AWS SDK Signature Version 4 client. Reinstall (replacement instance) and root-volume restore (snapshot onto the existing root device) are implemented but stay disabled until the deployment sets AWS_ALLOW_ROOT_VOLUME_REPLACEMENT=true; the previous instance is stopped, never terminated, and the detached root volume is kept. The console is the real interactive EC2 serial console: the adapter generates a one-time RSA key pair, pushes the public half through EC2 Instance Connect (SendSerialConsoleSSHPublicKey) and hands the private half to the caller with the 60-second expiry the API sets, so the key is never stored; the conditions the AWS API reports are surfaced as they occur (serial console access must be enabled for the account with EnableSerialConsoleAccess, only Nitro instance types are supported, the instance must be running, and one session per instance). CloudWatch metrics require separately scoped permissions. Metrics come from CloudWatch GetMetricStatistics (namespace AWS/EC2, dimension InstanceId, 300s period, basic monitoring); a metric with no datapoints is reported in the `missing` list rather than zero-filled.'
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
      { suffix: '_API_URL', description: 'Compute API base URL override', required: false, fallback: 'CONTABO_API_URL' },
      { suffix: '_TOKEN_URL', description: 'OAuth2 token URL override', required: false, fallback: 'CONTABO_TOKEN_URL' },
    ],
    planMetadata: [
      { key: 'providerServerType', description: 'Contabo VPS/VDS product id, e.g. V153', required: true },
      { key: 'providerSshKeyIds', description: 'Optional Contabo Secret ids for provider-side SSH-key injection', required: false },
      { key: 'contaboPeriodMonths', description: 'Initial contract period: 1, 12, or 24 months (default 1)', required: false },
      { key: 'contaboDefaultUser', description: 'root, admin, or administrator (default admin)', required: false },
      { key: 'contaboLicense', description: 'Optional Contabo license code', required: false },
      ...RESOURCE_METADATA,
    ],
    capabilities: { reinstall: true, snapshot: true, resize: false, console: false, metrics: false, rescue: true },
    notes: 'Native Compute API with cached in-memory OAuth2 tokens, lifecycle actions, image validation, in-place reinstall and snapshots. Rescue posts /compute/instances/{id}/actions/rescue; because Contabo takes secret ids (not key material or plaintext passwords) the adapter reuses the template SSH-key secrets when present, otherwise it stores a freshly generated one-time password as a Contabo secret. Leaving rescue is Contabo\'s next restart. The platform refuses scheduled Contabo cancellation as DELETE, because it is not immediate resource destruction.',
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
    capabilities: { reinstall: true, snapshot: true, resize: true, console: true, metrics: true, rescue: true },
    notes: 'Signed OVH v1 API against /cloud/project/{id}/instance. Instances are named from the job idempotency key and looked up before creation. Rescue is the instance boot mode (POST .../rescueMode with rescue:true/false); the one-time root password is read from the instance resource as rescuePassword and is never persisted.',
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
    capabilities: { reinstall: true, snapshot: false, resize: true, console: true, metrics: true, rescue: true },
    notes: 'Admin API v1 (api/admin/command.php). Snapshots are not exposed by SolusVM 1. Rescue uses the documented vserver-rescue action (rescueenable / rescuedisable) and returns the rescue login and one-time password; SolusVM offers only x86 rescue kernels, so an arm64 server is refused rather than booted into the wrong architecture.',
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
    capabilities: { reinstall: true, snapshot: true, resize: true, console: true, metrics: true, rescue: true },
    notes: 'Keystone v3 + Nova + Glance. Either password login or a pre-issued token is required. Rescue uses the native Nova rescue/unrescue actions. Metrics read Nova GET /servers/{id}/diagnostics, which is policy-gated per cloud: a project the policy does not allow gets a non-retryable UNSUPPORTED_OPERATION naming that reason at call time, never a fabricated reading, and the returned values are the hypervisor counters Nova reports (CPU times, memory, vda errors, rx/tx packets) rather than percentages.',
  },
  generic_http: {
    kind: 'generic_http',
    label: 'Operator provider bridge (HTTPS)',
    defaultEnvPrefix: 'PROVIDER_BRIDGE',
    defaultApiBaseUrl: null,
    requiresApiBaseUrl: true,
    credentials: [{ suffix: '_API_TOKEN', description: 'Bearer token for the operator-owned bridge', required: true }],
    planMetadata: [{ key: 'providerServerType', description: 'Plan identifier understood by the bridge', required: false }, ...RESOURCE_METADATA],
    capabilities: { reinstall: true, snapshot: true, resize: true, console: true, metrics: true, rescue: true },
    notes: 'For providers without a native adapter. The bridge is a real integration, never a simulator. Every operation is delegated on one contract: POST /v1/servers/{id}/{start,shutdown,reboot,reinstall,resize,rescue,unrescue,restore-snapshot}, POST /v1/servers/{id}/snapshots, DELETE /v1/servers/{id}/snapshots/{snapshotId} and GET /v1/servers/{id}/{health,console,metrics}. Resize, snapshots and rescue were already delegated but two of them were advertised as false, so a template could not offer an operation the adapter really performs; the flags now match the code. A bridge that does not implement an endpoint answers with its own HTTP failure — this adapter never invents a snapshot id, a resized plan or a rescue session.',
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
    capabilities: { reinstall: true, snapshot: true, resize: true, console: false, metrics: false, rescue: true },
    notes: 'Never selected automatically and disabled in production. Mock resources are labelled mock:true with mock- ids. Rescue is simulated in the same state machine so the full request flow can be exercised without a provider. Console and metrics are refused rather than simulated: the simulator issues no console session and measures nothing, and inventing either would teach a developer to trust a reading no provider produced.',
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

/**
 * Every adapter kind this build implements, in one place. The admin API's accepted values are
 * derived from this list (not from a second hand-kept copy), so a provider row can never be saved
 * with an adapter that has no implementation — and the registry's fail-closed fallback stays a
 * last-resort guard for rows that predate or bypass the API rather than the normal path.
 */
export const ADAPTER_KINDS = Object.keys(ADAPTER_PROFILES) as AdapterKind[];

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
  const configuredBaseUrl = provider.api_base_url ?? profile.defaultApiBaseUrl;
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
  const missing = credentials.filter((credential) => credential.required && !credential.present).map((credential) => credential.name);
  if (configuredBaseUrl && !apiBaseUrlConfigured) missing.push('api_base_url must use https');
  else if (profile.requiresApiBaseUrl && !apiBaseUrlConfigured) missing.push('api_base_url');
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
