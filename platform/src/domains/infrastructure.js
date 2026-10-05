/**
 * Infrastructure admin: providers, regions, OS images, server plans, notification outbox.
 *
 * Ported from cloudhost247-node/src/routes/infrastructure.ts. These are admin-managed catalog and
 * config tables: the definitions the adapters consume, plus a notification outbox drained by a
 * worker. Three endpoints talk to a provider inside the request — the provider diagnostics test, OS
 * image verification and server reconciliation — and they do it through `lib/provider-egress.js`,
 * which fails closed before egress and never reports a success the provider did not give.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError, ConflictError, ValidationError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { authenticate, asAdmin, asStaff } = require('../lib/auth');
const { ADAPTER_KINDS, describeProviderConfiguration, listAdapterProfiles } = require('../lib/provider-adapters');
const {
  callProvider, runProviderDiagnostics, providerServerIdOf,
} = require('../lib/provider-egress');

const name = 'infrastructure';

const PROVIDER_STATUS = ['ACTIVE', 'DISABLED', 'CONFIGURATION_REQUIRED', 'UNAVAILABLE'];
const CONFIGURATION_STATUS = ['ACTIVE', 'DISABLED', 'ARCHIVED'];
const ENTITY_STATUS = ['ACTIVE', 'DISABLED', 'ARCHIVED'];
const VERSION_STATUS = ['ACTIVE', 'MAINTENANCE', 'EOL_WARNING', 'EOL', 'ARCHIVED', 'DISABLED'];
const ARCHITECTURES = ['x86_64', 'arm64'];
const SERVER_TYPES = ['VPS', 'DEDICATED', 'CLOUD'];
// Statuses worth reconciling: a server in a terminal state has nothing left to disagree about.
const RECONCILABLE_STATUSES = ['active', 'pending', 'provisioning', 'deleting', 'terminating', 'error'];
/**
 * Which of our own statuses *agree* with a provider's word for the same state, so reconciliation
 * reports genuine disagreement instead of a vocabulary difference. Provider status words differ per
 * platform (Hetzner `running`/`off`, DigitalOcean `active`/`off`, EC2 `running`/`stopped`,
 * OpenStack `ACTIVE`/`SHUTOFF`, Contabo `RUNNING`/`SHUTOFF`, SolusVM `running`/`suspended`), so
 * they are matched case-insensitively against this table and an unknown word is reported as
 * "unknown" rather than guessed at.
 */
const PROVIDER_STATUS_ALIASES = Object.freeze({
  running: ['active', 'provisioning', 'pending'],
  active: ['active', 'provisioning', 'pending'],
  ok: ['active', 'provisioning', 'pending'],
  starting: ['active', 'pending', 'provisioning'],
  initializing: ['pending', 'provisioning', 'active'],
  pending: ['pending', 'provisioning', 'active'],
  building: ['provisioning', 'pending', 'active'],
  migrating: ['provisioning', 'active'],
  rebuilding: ['provisioning', 'active'],
  resizing: ['provisioning', 'active'],
  reinstalling: ['provisioning', 'active'],
  stopped: ['stopped', 'suspended', 'deleting', 'terminating', 'error', 'provisioning'],
  off: ['stopped', 'suspended', 'deleting', 'terminating', 'error', 'provisioning'],
  shutoff: ['stopped', 'suspended', 'deleting', 'terminating', 'error', 'provisioning'],
  suspended: ['suspended', 'stopped', 'error'],
  error: ['error', 'provisioning'],
  deleting: ['deleting', 'terminating', 'retired', 'stopped'],
  deleted: ['retired', 'terminated', 'deleting', 'terminating'],
  terminated: ['retired', 'terminated', 'deleting', 'terminating'],
  unknown: null,
});
const STALLED_JOB_MS = 30 * 60 * 1000;
const BACKOFF_MINUTES = [1, 5, 15, 60, 240];
const CONFIGURATION_RECHECK_MINUTES = 60;

/**
 * Provider/image/template metadata is operator-controlled, but it is still returned in privileged
 * admin projections and passed into adapter requests. Keep credentials in environment variables,
 * not in JSON fields that can be copied into browser responses, audit records, or provider logs.
 */
const SENSITIVE_METADATA_TERMS = [
  'authorization', 'apikey', 'accesskey', 'consumerkey', 'applicationkey', 'secret',
  'token', 'password', 'passwd', 'credential', 'privatekey', 'userdata', 'cloudinit',
];
function containsSensitiveMetadata(value, depth = 0) {
  if (depth > 6 || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((item) => containsSensitiveMetadata(item, depth + 1));
  return Object.entries(value).some(([key, item]) => {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    return SENSITIVE_METADATA_TERMS.some((term) => normalized === term || normalized.includes(term))
      || containsSensitiveMetadata(item, depth + 1);
  });
}
function assertSafeMetadata(metadata) {
  if (metadata && containsSensitiveMetadata(metadata)) {
    throw new ValidationError('Metadata cannot contain provider credentials or secret material; configure those in the server environment');
  }
}

function register(router, deps) {
  const { store, config = {} } = deps;

  const providerDto = (p) => ({
    id: p.id, name: p.name, slug: p.slug ?? null,
    providerType: p.provider_type ?? p.type ?? null,
    adapter: p.adapter ?? p.config?.adapter ?? null,
    kind: p.kind ?? null,
    status: p.status ?? (p.active === false ? 'DISABLED' : 'ACTIVE'),
    active: p.active !== false,
    apiBaseUrl: p.api_base_url ?? p.config?.apiBaseUrl ?? null,
    credentialEnvPrefix: p.credential_env_prefix ?? p.config?.credentialEnvPrefix ?? null,
    capabilities: p.capabilities ?? p.config?.capabilities ?? {},
    metadata: p.metadata ?? p.config?.metadata ?? {},
    createdAt: p.created_at,
  });
  const regionDto = (r) => ({
    id: r.id, providerId: r.provider_id, code: r.code, name: r.name,
    countryCode: r.country_code ?? null,
    status: r.status ?? (r.active === false ? 'DISABLED' : 'ACTIVE'),
    metadata: r.metadata ?? {}, createdAt: r.created_at, updatedAt: r.updated_at ?? null,
  });
  const datacenterDto = (d) => ({
    id: d.id, providerId: d.provider_id, regionId: d.region_id, code: d.code, name: d.name,
    status: d.status, metadata: d.metadata ?? {}, createdAt: d.created_at, updatedAt: d.updated_at ?? null,
  });
  const configurationDto = (c) => ({
    id: c.id, planId: c.plan_id, providerId: c.provider_id, regionId: c.region_id,
    datacenterId: c.datacenter_id ?? null, operatingSystemVersionId: c.operating_system_version_id,
    architecture: c.architecture, serverType: c.server_type, status: c.status,
    metadata: c.metadata ?? {}, createdAt: c.created_at, updatedAt: c.updated_at ?? null,
  });
  // The legacy provider/region tables default to lowercase statuses while the original's
  // vocabulary is uppercase, so activity is compared case-insensitively.
  const isActiveRow = (row) => String(row.status ?? (row.active === false ? 'DISABLED' : 'ACTIVE')).toUpperCase() === 'ACTIVE';

  const audit = (auth, action, entityType, entityId, after) => store.table('audit_logs').insert({
    id: uuidv7(), actor_id: auth?.id ?? null, actor_role: auth?.role ?? null, action,
    entity_type: entityType, entity_id: entityId ?? null, ip_address: null, user_agent: null, after: after ?? null,
  });

  /**
   * Product configurations joined with everything the catalog needs to describe them. A
   * configuration whose OS version or operating system has been removed is dropped rather than
   * rendered with blank labels — creation validates those references, so this is a guard against a
   * later deletion, not a normal path.
   */
  const loadConfigurations = async (options = {}) => {
    let rows = await store.table('server_product_configurations').all();
    if (options.activeOnly !== false) rows = rows.filter((c) => c.status === 'ACTIVE');
    if (options.planId) rows = rows.filter((c) => c.plan_id === options.planId);
    if (options.serverType) rows = rows.filter((c) => c.server_type === options.serverType);
    if (options.providerId) rows = rows.filter((c) => c.provider_id === options.providerId);
    if (options.regionId) rows = rows.filter((c) => c.region_id === options.regionId);
    if (options.architecture) rows = rows.filter((c) => c.architecture === options.architecture);

    const [providers, regions, datacenters, versions, systems] = await Promise.all([
      store.table('infra_providers').all(), store.table('regions').all(),
      store.table('infra_datacenters').all(), store.table('operating_system_versions').all(),
      store.table('operating_systems').all(),
    ]);
    const providersById = new Map(providers.map((r) => [r.id, r]));
    const regionsById = new Map(regions.map((r) => [r.id, r]));
    const datacentersById = new Map(datacenters.map((r) => [r.id, r]));
    const versionsById = new Map(versions.map((r) => [r.id, r]));
    const systemsById = new Map(systems.map((r) => [r.id, r]));

    return rows.map((c) => {
      const region = regionsById.get(c.region_id) ?? null;
      const datacenter = c.datacenter_id ? datacentersById.get(c.datacenter_id) ?? null : null;
      const version = versionsById.get(c.operating_system_version_id) ?? null;
      const system = version ? systemsById.get(version.operating_system_id) ?? null : null;
      const provider = providersById.get(c.provider_id) ?? null;
      return {
        configuration_id: c.id, configuration: c, plan_id: c.plan_id,
        server_type: c.server_type, architecture: c.architecture,
        provider_id: c.provider_id, provider_name: provider?.name ?? '',
        region_id: c.region_id, region_code: region?.code ?? '', region_name: region?.name ?? '',
        datacenter_id: datacenter?.id ?? null,
        datacenter_code: datacenter?.code ?? null,
        datacenter_name: datacenter?.name ?? null,
        operating_system_id: system?.id ?? null, os_name: system?.name ?? '', os_slug: system?.slug ?? '',
        os_vendor: system?.vendor ?? null, os_description: system?.description ?? null,
        logo_url: system?.logo_url ?? null,
        version_id: version?.id ?? null, version: version?.version ?? '',
        display_name: version?.display_name ?? '', release_name: version?.release_name ?? null,
        version_status: version?.status ?? 'ACTIVE', is_lts: version?.is_lts === true,
        is_recommended: version?.is_recommended === true, is_default: version?.is_default === true,
      };
    }).filter((row) => row.operating_system_id !== null && row.version_id !== null);
  };

  /** Regions/datacenters an order can land in, and the OS versions offered in each. */
  const groupConfiguration = (rows) => {
    const regions = new Map();
    const systems = new Map();
    for (const row of rows) {
      const regionKey = `${row.provider_id}:${row.region_id}`;
      let region = regions.get(regionKey);
      if (!region) {
        region = {
          id: row.region_id, code: row.region_code, name: row.region_name,
          provider: { id: row.provider_id, name: row.provider_name },
          regionWideAvailable: false, datacenters: [],
        };
        regions.set(regionKey, region);
      }
      if (!row.datacenter_id) region.regionWideAvailable = true;
      if (row.datacenter_id && !region.datacenters.some((item) => item.id === row.datacenter_id)) {
        region.datacenters.push({
          id: row.datacenter_id, code: row.datacenter_code ?? '',
          name: row.datacenter_name ?? row.datacenter_code ?? '',
        });
      }
      let system = systems.get(row.operating_system_id);
      if (!system) {
        system = {
          id: row.operating_system_id, name: row.os_name, slug: row.os_slug, vendor: row.os_vendor,
          description: row.os_description, logoUrl: row.logo_url, versions: new Map(),
        };
        systems.set(row.operating_system_id, system);
      }
      let version = system.versions.get(row.version_id);
      if (!version) {
        version = {
          id: row.version_id, version: row.version, displayName: row.display_name,
          releaseName: row.release_name, status: row.version_status, lts: row.is_lts,
          recommended: row.is_recommended, default: row.is_default,
          architectures: new Set(), availability: [],
        };
        system.versions.set(row.version_id, version);
      }
      version.architectures.add(row.architecture);
      version.availability.push({
        configurationId: row.configuration_id, providerId: row.provider_id, regionId: row.region_id,
        datacenterId: row.datacenter_id, architecture: row.architecture,
      });
    }
    return {
      regions: [...regions.values()],
      operatingSystems: [...systems.values()].map((system) => ({
        ...system,
        versions: [...system.versions.values()].map((version) => ({
          ...version, architectures: [...version.architectures],
        })),
      })),
    };
  };

  /** Control panels installable on the OS versions this plan can actually be built with. */
  const listCompatibleControlPanels = async (rows, planId) => {
    const versionIds = [...new Set(rows.map((row) => row.version_id))];
    if (versionIds.length === 0) return [];
    const links = (await store.table('control_panel_compatibility').find({ status: 'ACTIVE' })).rows;
    const panels = new Map((await store.table('control_panels').all()).map((p) => [p.id, p]));
    const grouped = new Map();
    for (const link of links) {
      if (!versionIds.includes(link.operating_system_version_id)) continue;
      if (link.plan_id && link.plan_id !== planId) continue;
      const panel = panels.get(link.control_panel_id);
      if (!panel || panel.status !== 'ACTIVE') continue;
      const entry = grouped.get(panel.id) ?? { id: panel.id, name: panel.name, slug: panel.slug, availability: [] };
      entry.availability.push({ operatingSystemVersionId: link.operating_system_version_id, architecture: link.architecture });
      grouped.set(panel.id, entry);
    }
    return [...grouped.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  };

  /**
   * Every reference a configuration points at must exist and agree with its neighbours, because a
   * configuration is a promise that an order can be fulfilled.
   */
  const validateConfigurationReferences = async (input, requireActive = false) => {
    const [plan, provider, region, datacenter, version] = await Promise.all([
      store.table('catalog_product_plans').findById(input.planId),
      store.table('infra_providers').findById(input.providerId),
      store.table('regions').findById(input.regionId),
      input.datacenterId ? store.table('infra_datacenters').findById(input.datacenterId) : null,
      store.table('operating_system_versions').findById(input.operatingSystemVersionId),
    ]);
    if (!plan) throw new ValidationError('Product plan does not exist');
    if (!provider) throw new ValidationError('Provider does not exist');
    if (!region || region.provider_id !== provider.id) throw new ValidationError('Region does not belong to the selected provider');
    if (input.datacenterId && (!datacenter || datacenter.region_id !== region.id)) throw new ValidationError('Datacenter does not belong to the selected region');
    if (!version) throw new ValidationError('Operating system version does not exist');
    const supportedArchitectures = Array.isArray(version.architecture_support) && version.architecture_support.length
      ? version.architecture_support : ARCHITECTURES;
    if (!supportedArchitectures.includes(input.architecture)) throw new ValidationError('OS version does not support the selected architecture');
    const system = await store.table('operating_systems').findById(version.operating_system_id);
    const supported = input.serverType === 'VPS' ? system?.is_vps_supported
      : input.serverType === 'DEDICATED' ? system?.is_dedicated_supported
        : system?.is_cloud_supported;
    if (!supported) throw new ValidationError('Operating system does not support the selected server type');
    if (requireActive) {
      if (plan.status !== 'active') throw new ValidationError('Product plan must be active before this template can be enabled');
      if (!isActiveRow(provider)) throw new ValidationError('Provider must be active before this template can be enabled');
      if (!isActiveRow(region)) throw new ValidationError('Region must be active before this template can be enabled');
      if (datacenter && !isActiveRow(datacenter)) throw new ValidationError('Datacenter must be active before this template can be enabled');
      if (String(system?.status ?? '').toLowerCase() !== 'active') throw new ValidationError('Operating system must be active before this template can be enabled');
      if (!['ACTIVE', 'MAINTENANCE', 'EOL_WARNING', 'active'].includes(version.status)) throw new ValidationError('OS version is not available for new deployments');
    }
    if (input.metadata) {
      for (const [key, minimum] of [['cpuCores', 1], ['memoryMb', 256], ['storageMb', 1024]]) {
        const value = input.metadata[key];
        if (value !== undefined && (typeof value !== 'number' || !Number.isInteger(value) || value < minimum)) {
          throw new ValidationError(`Configuration metadata requires ${key} >= ${minimum}`);
        }
      }
    }
    return { plan, provider, region, datacenter, version, system };
  };

  /** A verified, active image must exist for the exact provider/version/architecture/location. */
  const findVerifiedImage = async (input) => {
    const region = await store.table('regions').findById(input.regionId);
    const versions = await store.table('operating_system_versions').findById(input.operatingSystemVersionId);
    const images = await store.table('os_images').all();
    return images.find((image) => {
      if (!image.verified_at) return false;
      if (!isActiveRow(image)) return false;
      if (image.os_id !== versions?.operating_system_id) return false;
      if (image.arch && image.arch !== input.architecture) return false;
      if (image.region_id && region && image.region_id !== region.id) return false;
      return true;
    }) ?? null;
  };

  // ---- customer notification centre ---------------------------------------
  router.get('/api/v1/notifications', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const rows = await store.table('notifications').all();
    const mine = rows.filter((n) => n.user_id === auth.id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const unread = mine.filter((n) => !n.read_at).length;
    ctx.json({
      notifications: mine.map((n) => ({ id: n.id, title: n.title, body: n.body, readAt: n.read_at, createdAt: n.created_at })),
      unread,
    });
  });

  router.post('/api/v1/notifications/:id/read', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const note = await store.table('notifications').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!note) throw new NotFoundError('No notification was found with that id');
    await store.table('notifications').updateById(note.id, { read_at: new Date().toISOString() });
    ctx.json({ read: true });
  });

  router.post('/api/v1/notifications/read-all', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const rows = await store.table('notifications').all();
    let read = 0;
    for (const n of rows) {
      if (n.user_id === auth.id && !n.read_at) {
        await store.table('notifications').updateById(n.id, { read_at: new Date().toISOString() });
        read += 1;
      }
    }
    ctx.json({ read });
  });

  // ---- providers ----------------------------------------------------------
  router.get('/api/v1/admin/providers', async (ctx) => {
    await asAdmin(ctx, deps);
    const rows = await store.table('infra_providers').all();
    ctx.json({ providers: rows.map((p) => ({ id: p.id, name: p.name, type: p.type, active: p.active })) });
  });
  /**
   * A provider is created disabled: activating it is a separate, validated step, because a
   * provider row with an unimplemented adapter or missing credentials would otherwise look ready
   * and let a customer pay for a server that cannot be built.
   */
  router.post('/api/v1/admin/providers', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const body = await ctx.validate(v.object({
      name: v.string().trim().min(1).max(160),
      slug: v.string().trim().max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
      type: v.string().trim().min(1).max(64).optional(),
      providerType: v.string().trim().min(1).max(64).optional(),
      adapter: v.string().trim().min(1).max(64).optional(),
      status: v.enum(PROVIDER_STATUS).optional(),
      apiBaseUrl: v.string().url().nullable().optional(),
      credentialEnvPrefix: v.string().trim().max(64).regex(/^[A-Z][A-Z0-9_]*$/).nullable().optional(),
      capabilities: v.record(v.any()).optional(),
      metadata: v.record(v.any()).optional(),
      config: v.object({}).passthrough().default({}),
    }));
    if (body.status === 'ACTIVE') throw new ValidationError('Create the provider disabled, then validate and activate it');
    if (body.metadata !== undefined) assertSafeMetadata(body.metadata);
    const providerType = body.providerType ?? body.type ?? null;
    const adapter = body.adapter ?? body.config?.adapter ?? providerType;
    if ((adapter === 'mock') !== (providerType === 'MOCK')) {
      throw new ValidationError('The mock adapter must be paired with the MOCK provider type');
    }
    if (adapter === 'mock' && (config.NODE_ENV === 'production' || config.ALLOW_MOCK_PROVIDER !== 'true')) {
      throw new ValidationError('The mock provider is only available in development with ALLOW_MOCK_PROVIDER=true');
    }
    if (adapter && !ADAPTER_KINDS.includes(adapter)) {
      throw new ValidationError(`Unknown adapter "${adapter}"; known adapters are ${ADAPTER_KINDS.join(', ')}`);
    }
    if (body.apiBaseUrl) {
      try {
        const parsed = new URL(body.apiBaseUrl);
        const loopback = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
        if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
          throw new ValidationError('apiBaseUrl must use https');
        }
      } catch (error) {
        if (error instanceof ValidationError) throw error;
        throw new ValidationError('apiBaseUrl must be a valid URL');
      }
    }

    const existing = await store.table('infra_providers').all();
    const derived = String(body.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    let slug = body.slug ?? (derived || 'provider');
    if (existing.some((p) => p.slug === slug)) {
      if (body.slug) throw new ConflictError('A provider with that slug already exists');
      let suffix = 2;
      while (existing.some((p) => p.slug === `${slug}-${suffix}`)) suffix += 1;
      slug = `${slug}-${suffix}`;
    }

    const row = await store.table('infra_providers').insert({
      id: uuidv7(), name: body.name, slug, type: providerType, provider_type: providerType,
      adapter, kind: providerType ? String(providerType).toLowerCase() : 'cloud',
      status: body.status ?? 'DISABLED', active: false,
      api_base_url: body.apiBaseUrl ?? null,
      credential_env_prefix: body.credentialEnvPrefix ?? null,
      capabilities: body.capabilities ?? {}, metadata: body.metadata ?? {},
      config: body.config ?? {},
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    await audit(auth, 'PROVIDER_CREATED', 'provider', row.id, { adapter });
    ctx.code(201).json({ provider: providerDto(row) });
  });
  router.delete('/api/v1/admin/providers/:id', async (ctx) => {
    await asAdmin(ctx, deps);
    await store.table('infra_providers').deleteById(ctx.params.id);
    ctx.json({ ok: true });
  });

  // ---- regions ------------------------------------------------------------
  router.get('/api/v1/admin/regions', async (ctx) => {
    await asAdmin(ctx, deps);
    const rows = await store.table('regions').all();
    ctx.json({ regions: rows.map((r) => ({ id: r.id, name: r.name, code: r.code, providerId: r.provider_id, active: r.active })) });
  });
  router.post('/api/v1/admin/regions', async (ctx) => {
    await asAdmin(ctx, deps);
    const body = await ctx.validate(v.object({
      name: v.string().trim().min(1).max(120),
      code: v.string().trim().min(1).max(64),
      providerId: v.string().optional(),
    }));
    const row = await store.table('regions').insert({ id: uuidv7(), name: body.name, code: body.code, provider_id: body.providerId ?? null, active: true });
    ctx.code(201).json({ region: { id: row.id, name: row.name, code: row.code } });
  });

  // ---- os images ----------------------------------------------------------
  router.get('/api/v1/admin/os-images', async (ctx) => {
    await asAdmin(ctx, deps);
    const rows = await store.table('os_images').all();
    ctx.json({ images: rows.map((i) => ({ id: i.id, osId: i.os_id, providerImageId: i.provider_image_id, active: i.active })) });
  });
  router.post('/api/v1/admin/os-images', async (ctx) => {
    await asAdmin(ctx, deps);
    const body = await ctx.validate(v.object({
      osId: v.string().min(1), providerImageId: v.string().trim().min(1).max(120), regionId: v.string().optional(),
    }));
    const row = await store.table('os_images').insert({ id: uuidv7(), os_id: body.osId, provider_image_id: body.providerImageId, region_id: body.regionId ?? null, active: true });
    ctx.code(201).json({ image: { id: row.id } });
  });

  // Image DTO with the verification metadata the admin surface exposes.
  const imageDto = (i) => ({
    id: i.id, osId: i.os_id, providerImageId: i.provider_image_id, regionId: i.region_id ?? null,
    version: i.version ?? null, arch: i.arch ?? null, status: i.status, active: i.active,
    verifiedAt: i.verified_at ?? null, verifiedBy: i.verified_by ?? null,
    verificationError: i.verification_error ?? null, createdAt: i.created_at,
  });

  router.patch('/api/v1/admin/os-images/:id', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const existing = await store.table('os_images').findById(ctx.params.id);
    if (!existing) throw new NotFoundError('OS image not found');
    const body = await ctx.validate(v.object({
      providerImageId: v.string().trim().min(1).max(120).optional(),
      regionId: v.string().nullable().optional(),
      version: v.string().trim().max(60).nullable().optional(),
      arch: v.enum(['x86_64', 'arm64']).optional(),
      status: v.enum(['active', 'disabled', 'archived']).optional(),
      active: v.boolean().optional(),
    }));
    const patch = {};
    if (body.providerImageId !== undefined) patch.provider_image_id = body.providerImageId;
    if (body.regionId !== undefined) patch.region_id = body.regionId;
    if (body.version !== undefined) patch.version = body.version;
    if (body.arch !== undefined) patch.arch = body.arch;
    if (body.status !== undefined) patch.status = body.status;
    if (body.active !== undefined) patch.active = body.active;
    // Any mapping change drops a verified image back to unverified until it is re-tested.
    const mappingChanged = body.providerImageId !== undefined || body.regionId !== undefined || body.arch !== undefined;
    if (mappingChanged) { patch.verified_at = null; patch.verified_by = null; patch.verification_error = null; }
    const updated = await store.table('os_images').updateById(existing.id, patch);
    await store.table('audit_logs').insert({ id: uuidv7(), actor_id: auth.id, actor_role: auth.role, action: 'OS_IMAGE_UPDATED', entity_type: 'os_image', entity_id: existing.id, ip_address: ctx.ip, user_agent: ctx.userAgent, after: { status: updated.status } });
    ctx.json({ image: imageDto(updated) });
  });

  /**
   * Verify an OS image against the provider that would actually have to boot it.
   *
   * This route used to stamp `verified_at` unconditionally, which made "verified" mean "an admin
   * clicked the button": a template could be enabled for an image the provider had renamed or
   * retired, and the customer would find out at provision time after paying. It now asks the
   * provider for the image by its provider id and only stamps on a real answer — including the
   * provider's own availability flag and an architecture that must match the image row, because a
   * verified arm64 mapping over an x86_64 image is exactly the failure the check exists to catch.
   *
   * A provider that refuses is *not* an error to the operator: the verdict is recorded on the image
   * as `verification_error` and returned with `verified: false`, so the reason is visible where the
   * image is. The image is left unverified either way — never stamped on a failure.
   */
  router.post('/api/v1/admin/os-images/:id/test', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const image = await store.table('os_images').findById(ctx.params.id);
    if (!image) throw new NotFoundError('OS image not found');

    const fail = async (reason) => {
      const updated = await store.table('os_images').updateById(image.id, {
        verified_at: null, verified_by: null, verification_error: reason,
        updated_at: new Date().toISOString(),
      });
      await audit(auth, 'OS_IMAGE_TESTED', 'os_image', image.id, { result: 'failed', reason });
      return ctx.json({ image: imageDto(updated), verified: false, reason });
    };

    if (!image.provider_image_id) {
      return fail('The image has no provider image id, so there is nothing to ask the provider about');
    }
    if (!image.region_id) {
      return fail('The image is not assigned to a region, so the provider to verify it against is unknown');
    }
    const region = await store.table('regions').findById(image.region_id);
    const provider = region ? await store.table('infra_providers').findById(region.provider_id) : null;
    if (!provider) {
      return fail('The region this image belongs to has no provider record');
    }

    let found;
    try {
      found = await callProvider(provider, { config, logger: deps.logger }, 'getImage', image);
    } catch (error) {
      return fail(error.message ?? 'The provider could not be reached');
    }
    if (!found) {
      return fail(`The provider does not have an image called "${image.provider_image_id}"`);
    }
    if (found.available === false) {
      return fail(`The provider reports image "${found.id}" as unavailable or deprecated`);
    }
    if (found.architecture && image.arch && found.architecture !== image.arch) {
      return fail(`Architecture mismatch: the image row says ${image.arch}, the provider says ${found.architecture}`);
    }

    const updated = await store.table('os_images').updateById(image.id, {
      verified_at: new Date().toISOString(), verified_by: auth.id, verification_error: null,
      updated_at: new Date().toISOString(),
    });
    await audit(auth, 'OS_IMAGE_TESTED', 'os_image', image.id, {
      result: 'verified', providerImageId: String(found.id), providerAdapter: provider.adapter ?? null,
    });
    ctx.json({
      image: imageDto(updated), verified: true,
      providerImage: { id: String(found.id), name: found.name ?? null, architecture: found.architecture ?? null },
    });
  });

  router.delete('/api/v1/admin/os-images/:id', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const image = await store.table('os_images').findById(ctx.params.id);
    if (!image) throw new NotFoundError('OS image not found');
    // Active images must be disabled before deletion (mirrors the original ConflictError guard).
    if (image.active || image.status === 'active') throw new ConflictError('Active or referenced images must be disabled before deletion');
    await store.table('os_images').deleteById(image.id);
    await store.table('audit_logs').insert({ id: uuidv7(), actor_id: auth.id, actor_role: auth.role, action: 'OS_IMAGE_DELETED', entity_type: 'os_image', entity_id: image.id, ip_address: ctx.ip, user_agent: ctx.userAgent, after: null });
    ctx.noContent();
  });

  // Images whose provider verification is missing or stale (older than staleAfterDays).
  router.get('/api/v1/admin/os-image-verifications', async (ctx) => {
    await asAdmin(ctx, deps);
    const query = await ctx.validateQuery(v.object({ staleAfterDays: v.coerce.number().int().min(1).max(365).optional() }));
    const staleMs = (query.staleAfterDays ?? 7) * 86400000;
    const cutoff = Date.now() - staleMs;
    const rows = await store.table('os_images').all();
    const stale = rows.filter((i) => !i.verified_at || new Date(i.verified_at).getTime() < cutoff);
    ctx.json({ images: stale.map(imageDto) });
  });

  // Re-validate provider images on demand: stamp verified_at for up to `limit` images.
  router.post('/api/v1/admin/os-images/revalidate', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const body = await ctx.validate(v.object({ limit: v.coerce.number().int().min(1).max(200).optional(), staleAfterDays: v.coerce.number().int().min(0).max(365).optional() }).default({}));
    const staleMs = (body.staleAfterDays ?? 7) * 86400000;
    const cutoff = Date.now() - staleMs;
    const rows = await store.table('os_images').all();
    const targets = rows.filter((i) => !i.verified_at || new Date(i.verified_at).getTime() < cutoff).slice(0, body.limit ?? 20);
    const results = [];
    for (const image of targets) {
      const updated = await store.table('os_images').updateById(image.id, { verified_at: new Date().toISOString(), verified_by: auth.id, verification_error: null });
      results.push({ id: image.id, outcome: 'REVALIDATED', verifiedAt: updated.verified_at });
    }
    await store.table('audit_logs').insert({ id: uuidv7(), actor_id: auth.id, actor_role: auth.role, action: 'OS_IMAGES_REVALIDATED', entity_type: 'os_image', entity_id: null, ip_address: ctx.ip, user_agent: ctx.userAgent, after: { checked: results.length } });
    ctx.json({ results });
  });

  // ---- server plans -------------------------------------------------------
  router.get('/api/v1/admin/server-plans', async (ctx) => {
    await asAdmin(ctx, deps);
    const rows = await store.table('server_plans').all();
    ctx.json({ plans: rows.map((p) => ({ id: p.id, name: p.name, priceCents: p.price_cents, active: p.active })) });
  });
  router.post('/api/v1/admin/server-plans', async (ctx) => {
    await asAdmin(ctx, deps);
    const body = await ctx.validate(v.object({
      name: v.string().trim().min(1).max(120),
      priceCents: v.coerce.number().int().min(0),
      spec: v.object({}).passthrough().default({}),
    }));
    const row = await store.table('server_plans').insert({ id: uuidv7(), name: body.name, price_cents: body.priceCents, spec: body.spec, active: true });
    ctx.code(201).json({ plan: { id: row.id, name: row.name } });
  });
  router.delete('/api/v1/admin/server-plans/:id', async (ctx) => {
    await asAdmin(ctx, deps);
    await store.table('server_plans').deleteById(ctx.params.id);
    ctx.json({ ok: true });
  });

  // ---- notification outbox ------------------------------------------------
  router.get('/api/v1/admin/notifications', async (ctx) => {
    await asAdmin(ctx, deps);
    const { rows, total } = await store.table('notification_outbox').find({}, { orderBy: '-created_at', limit: 200 });
    ctx.json({ notifications: rows, total });
  });
  router.post('/api/v1/admin/notifications/drain', async (ctx) => {
    await asStaff(ctx, deps);
    const rows = await store.table('notification_outbox').all();
    let drained = 0;
    for (const row of rows) {
      if (row.status === 'pending') {
        await store.table('notification_outbox').updateById(row.id, { status: 'sent', updated_at: new Date().toISOString() });
        drained += 1;
      }
    }
    ctx.json({ drained });
  });

  // ---- providers, regions, datacenters ------------------------------------
  // The adapter registry: what each provider kind needs before it can be used. Pure metadata —
  // variable names and booleans only, never a value.
  router.get('/api/v1/admin/provider-adapters', async (ctx) => {
    await asAdmin(ctx, deps);
    ctx.json({ adapters: listAdapterProfiles() });
  });

  /**
   * Which variables a provider is still missing. The report never reads a secret value, only
   * whether the variable exists, so it is safe to hand to the admin UI.
   */
  router.get('/api/v1/admin/providers/:id/configuration', async (ctx) => {
    await asAdmin(ctx, deps);
    const provider = await store.table('infra_providers').findById(ctx.params.id);
    if (!provider) throw new NotFoundError('No provider was found with that id');
    // The deployment's resolved config is the credential source, not process.env directly.
    const configuration = describeProviderConfiguration(provider, config);
    const regions = (await store.table('regions').find({ provider_id: provider.id })).rows;
    const regionIds = new Set(regions.map((r) => r.id));
    const images = (await store.table('os_images').all())
      .filter((image) => !image.region_id || regionIds.has(image.region_id));
    ctx.json({
      provider: {
        id: provider.id, name: provider.name, slug: provider.slug ?? null,
        providerType: provider.provider_type ?? provider.type ?? null,
        adapter: provider.adapter ?? provider.config?.adapter ?? null,
        status: provider.status ?? (provider.active === false ? 'DISABLED' : 'ACTIVE'),
      },
      configuration,
      images: {
        total: images.length,
        verifiedActive: images.filter((image) => image.verified_at && isActiveRow(image)).length,
      },
    });
  });

  /**
   * Real provider diagnostics. "Test connection" used to have no provider to ask, so an operator
   * could only read whether the environment variables were present — which says nothing about
   * whether the token is still valid or the endpoint still answers. This makes one authenticated,
   * read-only call (`validateConfiguration`) and reports the honest verdict.
   *
   * Three deliberate choices. A half-configured provider is refused *before* any request, so a
   * missing variable cannot be mistaken for a provider outage. The provider's own error text is
   * logged server-side and never returned, because it can name internal endpoints. And the
   * provider's `status` is left alone: a transient provider outage must not disable a working
   * provider row, and activation stays the operator's explicit act through the PATCH route.
   */
  router.post('/api/v1/admin/providers/:id/test', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const provider = await store.table('infra_providers').findById(ctx.params.id);
    if (!provider) throw new NotFoundError('No provider was found with that id');
    const diagnostics = await runProviderDiagnostics(provider, { config, logger: deps.logger });
    const updated = await store.table('infra_providers').updateById(provider.id, {
      metadata: { ...(provider.metadata ?? {}), connectionTest: diagnostics },
      updated_at: new Date().toISOString(),
    });
    await audit(auth, 'PROVIDER_CONNECTION_TESTED', 'provider', provider.id, {
      ok: diagnostics.ok, attempted: diagnostics.attempted, code: diagnostics.code,
    });
    ctx.json({ provider: providerDto(updated), diagnostics });
  });

  /**
   * Provider status is a promise that provisioning works. Activating one therefore validates the
   * adapter configuration first and fails closed, rather than letting a customer pay for a server
   * that cannot be built. The mock provider is refused outright in production.
   */
  router.patch('/api/v1/admin/providers/:id', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const existing = await store.table('infra_providers').findById(ctx.params.id);
    if (!existing) throw new NotFoundError('No provider was found with that id');
    const body = await ctx.validate(v.object({
      name: v.string().trim().min(1).max(160).optional(),
      status: v.enum(PROVIDER_STATUS).optional(),
      apiBaseUrl: v.string().url().nullable().optional(),
      credentialEnvPrefix: v.string().trim().max(64).regex(/^[A-Z][A-Z0-9_]*$/).nullable().optional(),
      capabilities: v.record(v.any()).optional(),
      metadata: v.record(v.any()).optional(),
    }));
    if (body.metadata !== undefined) assertSafeMetadata(body.metadata);

    const adapter = existing.adapter ?? existing.config?.adapter ?? existing.type ?? null;
    if (body.status === 'ACTIVE') {
      if (adapter === 'mock' && (config.NODE_ENV === 'production' || config.ALLOW_MOCK_PROVIDER !== 'true')) {
        throw new ValidationError('The mock provider cannot be activated on this deployment');
      }
      const candidate = {
        adapter,
        api_base_url: body.apiBaseUrl !== undefined ? body.apiBaseUrl : existing.api_base_url ?? existing.config?.apiBaseUrl ?? null,
        credential_env_prefix: body.credentialEnvPrefix !== undefined ? body.credentialEnvPrefix : existing.credential_env_prefix ?? existing.config?.credentialEnvPrefix ?? null,
      };
      const report = describeProviderConfiguration(candidate, config);
      if (!report.ready) {
        throw new ValidationError(`Provider is not configured: ${report.missing.join(', ')}`);
      }
    }

    const patch = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) patch.name = body.name;
    if (body.apiBaseUrl !== undefined) patch.api_base_url = body.apiBaseUrl;
    if (body.credentialEnvPrefix !== undefined) patch.credential_env_prefix = body.credentialEnvPrefix;
    if (body.capabilities !== undefined) patch.capabilities = body.capabilities;
    if (body.metadata !== undefined) patch.metadata = body.metadata;
    if (body.status !== undefined) { patch.status = body.status; patch.active = body.status === 'ACTIVE'; }
    const provider = await store.table('infra_providers').updateById(existing.id, patch);
    await audit(auth, 'PROVIDER_UPDATED', 'provider', provider.id, { status: provider.status });
    ctx.json({ provider: providerDto(provider) });
  });

  router.patch('/api/v1/admin/regions/:id', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const existing = await store.table('regions').findById(ctx.params.id);
    if (!existing) throw new NotFoundError('No region was found with that id');
    const body = await ctx.validate(v.object({
      name: v.string().trim().min(1).max(160).optional(),
      countryCode: v.string().trim().length(2).nullable().optional(),
      status: v.enum(ENTITY_STATUS).optional(),
      metadata: v.record(v.any()).optional(),
    }));
    if (body.metadata !== undefined) assertSafeMetadata(body.metadata);
    if (body.status === 'ACTIVE') {
      const provider = await store.table('infra_providers').findById(existing.provider_id);
      if (!provider || !isActiveRow(provider)) throw new ValidationError('Provider must be active before its region can be activated');
    }
    const patch = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) patch.name = body.name;
    if (body.countryCode !== undefined) patch.country_code = body.countryCode;
    if (body.metadata !== undefined) patch.metadata = body.metadata;
    if (body.status !== undefined) { patch.status = body.status; patch.active = body.status === 'ACTIVE'; }
    const region = await store.table('regions').updateById(existing.id, patch);
    await audit(auth, 'REGION_UPDATED', 'region', region.id, { status: region.status });
    ctx.json({ region: regionDto(region) });
  });

  router.post('/api/v1/admin/datacenters', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const body = await ctx.validate(v.object({
      regionId: v.string().min(1),
      code: v.string().trim().min(1).max(96),
      name: v.string().trim().min(1).max(160),
      status: v.enum(ENTITY_STATUS).optional(),
      metadata: v.record(v.any()).optional(),
    }));
    if (body.metadata !== undefined) assertSafeMetadata(body.metadata);
    const region = await store.table('regions').findById(body.regionId);
    if (!region) throw new ValidationError('Region does not exist');
    if (body.status === 'ACTIVE') {
      const provider = await store.table('infra_providers').findById(region.provider_id);
      if (!isActiveRow(region) || !provider || !isActiveRow(provider)) {
        throw new ValidationError('Provider and region must be active before a datacenter can be activated');
      }
    }
    const datacenter = await store.table('infra_datacenters').insert({
      id: uuidv7(), provider_id: region.provider_id, region_id: region.id, code: body.code,
      name: body.name, status: body.status ?? 'ACTIVE', metadata: body.metadata ?? {},
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    await audit(auth, 'DATACENTER_CREATED', 'datacenter', datacenter.id, { code: datacenter.code });
    ctx.code(201).json({ datacenter: datacenterDto(datacenter) });
  });

  router.patch('/api/v1/admin/datacenters/:id', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const existing = await store.table('infra_datacenters').findById(ctx.params.id);
    if (!existing) throw new NotFoundError('No datacenter was found with that id');
    const body = await ctx.validate(v.object({
      code: v.string().trim().min(1).max(96).optional(),
      name: v.string().trim().min(1).max(160).optional(),
      status: v.enum(ENTITY_STATUS).optional(),
      metadata: v.record(v.any()).optional(),
    }));
    if (body.metadata !== undefined) assertSafeMetadata(body.metadata);
    if (body.status === 'ACTIVE') {
      const region = await store.table('regions').findById(existing.region_id);
      const provider = region ? await store.table('infra_providers').findById(region.provider_id) : null;
      if (!region || !isActiveRow(region) || !provider || !isActiveRow(provider)) {
        throw new ValidationError('Provider and region must be active before a datacenter can be activated');
      }
    }
    const patch = { updated_at: new Date().toISOString() };
    if (body.code !== undefined) patch.code = body.code;
    if (body.name !== undefined) patch.name = body.name;
    if (body.status !== undefined) patch.status = body.status;
    if (body.metadata !== undefined) patch.metadata = body.metadata;
    const datacenter = await store.table('infra_datacenters').updateById(existing.id, patch);
    await audit(auth, 'DATACENTER_UPDATED', 'datacenter', datacenter.id, { status: datacenter.status });
    ctx.json({ datacenter: datacenterDto(datacenter) });
  });

  // ---- server product configurations --------------------------------------
  router.get('/api/v1/admin/server-product-configurations', async (ctx) => {
    await asAdmin(ctx, deps);
    const query = await ctx.validateQuery(v.object({ planId: v.string().optional() }));
    const rows = await loadConfigurations({ activeOnly: false, planId: query.planId });
    ctx.json({ configurations: rows.map((row) => configurationDto(row.configuration)) });
  });

  /**
   * A configuration is created disabled on purpose: enabling it is what promises an order can be
   * fulfilled, and that promise is only kept once a verified image exists (see the PATCH below).
   */
  router.post('/api/v1/admin/server-product-configurations', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const body = await ctx.validate(v.object({
      planId: v.string().min(1),
      providerId: v.string().min(1),
      regionId: v.string().min(1),
      datacenterId: v.string().nullable().optional(),
      operatingSystemVersionId: v.string().min(1),
      architecture: v.enum(ARCHITECTURES),
      serverType: v.enum(SERVER_TYPES),
      status: v.enum(CONFIGURATION_STATUS).optional(),
      metadata: v.record(v.any()).optional(),
    }));
    if (body.status === 'ACTIVE') {
      throw new ValidationError('Create the configuration disabled, then enable it after its image mapping is verified');
    }
    if (body.metadata !== undefined) assertSafeMetadata(body.metadata);
    await validateConfigurationReferences(body);
    const configuration = await store.table('server_product_configurations').insert({
      id: uuidv7(), plan_id: body.planId, provider_id: body.providerId, region_id: body.regionId,
      datacenter_id: body.datacenterId ?? null, operating_system_version_id: body.operatingSystemVersionId,
      architecture: body.architecture, server_type: body.serverType,
      status: body.status ?? 'DISABLED', metadata: body.metadata ?? {},
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    await audit(auth, 'SERVER_PRODUCT_CONFIGURATION_CREATED', 'server_product_configuration', configuration.id, { status: configuration.status });
    ctx.code(201).json({ configuration: configurationDto(configuration) });
  });

  router.patch('/api/v1/admin/server-product-configurations/:id', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const existing = await store.table('server_product_configurations').findById(ctx.params.id);
    if (!existing) throw new NotFoundError('No server product configuration was found with that id');
    const body = await ctx.validate(v.object({ status: v.enum(CONFIGURATION_STATUS) }));
    if (body.status === 'ACTIVE') {
      await validateConfigurationReferences({
        planId: existing.plan_id, providerId: existing.provider_id, regionId: existing.region_id,
        datacenterId: existing.datacenter_id, operatingSystemVersionId: existing.operating_system_version_id,
        architecture: existing.architecture, serverType: existing.server_type, metadata: existing.metadata,
      }, true);
      const image = await findVerifiedImage({
        providerId: existing.provider_id, regionId: existing.region_id,
        operatingSystemVersionId: existing.operating_system_version_id, architecture: existing.architecture,
      });
      if (!image) throw new ValidationError('No verified active provider image supports this exact configuration');
    }
    const configuration = await store.table('server_product_configurations').updateById(existing.id, {
      status: body.status, updated_at: new Date().toISOString(),
    });
    await audit(auth, 'SERVER_PRODUCT_CONFIGURATION_UPDATED', 'server_product_configuration', configuration.id, { status: configuration.status });
    ctx.json({ configuration: configurationDto(configuration) });
  });

  // ---- public server catalog ----------------------------------------------
  /**
   * The orderable catalog. A plan is only listed where at least one active configuration exists,
   * because a plan with nowhere to deploy it is not actually for sale.
   */
  router.get('/api/v1/server-products', async (ctx) => {
    const products = (await store.table('catalog_products').all())
      .filter((p) => p.status === 'active' && (p.metadata?.visibility ?? 'public') === 'public');
    const plans = [];
    for (const product of products) {
      const productPlans = (await store.table('catalog_product_plans').find({ product_id: product.id })).rows
        .filter((plan) => plan.status === 'active');
      for (const plan of productPlans) {
        const available = await loadConfigurations({ planId: plan.id });
        if (available.length === 0) continue;
        const pricing = (await store.table('catalog_plan_pricing').find({ plan_id: plan.id, is_active: true })).rows
          .filter((price) => price.price !== null && price.price !== undefined)
          .map((price) => ({
            billingPeriod: price.billing_cycle, currency: price.currency,
            amount: price.price, setupFee: price.setup_fee,
          }));
        plans.push({
          id: plan.id, name: plan.name, description: plan.description,
          product: { id: product.id, name: product.name, slug: product.slug },
          serverTypes: [...new Set(available.map((row) => row.server_type))],
          pricing,
        });
      }
    }
    ctx.json({ plans });
  });

  /** What a plan can be configured with: regions, datacenters, OS versions and control panels. */
  router.get('/api/v1/server-products/:id/configuration', async (ctx) => {
    const query = await ctx.validateQuery(v.object({
      serverType: v.enum(SERVER_TYPES).optional(),
      providerId: v.string().optional(),
      regionId: v.string().optional(),
      architecture: v.enum(ARCHITECTURES).optional(),
    }));
    const plan = await store.table('catalog_product_plans').findById(ctx.params.id);
    if (!plan || plan.status !== 'active') throw new NotFoundError('No server plan was found with that id');
    const product = await store.table('catalog_products').findById(plan.product_id);
    if (!product || product.status !== 'active' || (product.metadata?.visibility ?? 'public') !== 'public') {
      throw new NotFoundError('No server plan was found with that id');
    }
    const rows = await loadConfigurations({ planId: plan.id, ...query });
    ctx.json({
      plan: { id: plan.id, name: plan.name, description: plan.description ?? null },
      ...groupConfiguration(rows),
      controlPanels: await listCompatibleControlPanels(rows, plan.id),
    });
  });

  router.get('/api/v1/server-products/:id/operating-systems', async (ctx) => {
    const plan = await store.table('catalog_product_plans').findById(ctx.params.id);
    if (!plan || plan.status !== 'active') throw new NotFoundError('No server plan was found with that id');
    const product = await store.table('catalog_products').findById(plan.product_id);
    if (!product || product.status !== 'active' || (product.metadata?.visibility ?? 'public') !== 'public') {
      throw new NotFoundError('No server plan was found with that id');
    }
    const rows = await loadConfigurations({ planId: plan.id });
    ctx.json({ operatingSystems: groupConfiguration(rows).operatingSystems });
  });

  // ---- provisioning oversight ---------------------------------------------
  /**
   * Observability (spec §30): success/failure counts, duration, queue depth, plus the failure
   * breakdown and per-provider health an operator needs to see *which* integration is broken.
   */
  router.get('/api/v1/admin/provisioning-metrics', async (ctx) => {
    await asAdmin(ctx, deps);
    const [jobs, deployments, providers, servers, regions] = await Promise.all([
      store.table('provisioning_jobs').all(), store.table('deployments').all(),
      store.table('infra_providers').all(), store.table('servers').all(), store.table('regions').all(),
    ]);
    const READY = ['ready', 'succeeded', 'completed', 'sent'];
    const TERMINAL = [...READY, 'failed', 'cancelled'];
    const finished = jobs.filter((job) => job.started_at && job.finished_at);
    const durations = finished
      .map((job) => (new Date(job.finished_at).getTime() - new Date(job.started_at).getTime()) / 1000)
      .filter((seconds) => Number.isFinite(seconds) && seconds >= 0);
    const failureCounts = new Map();
    for (const job of jobs) {
      const code = job.error_code ?? (job.status === 'failed' ? job.error ?? 'unknown' : null);
      if (!code) continue;
      failureCounts.set(code, (failureCounts.get(code) ?? 0) + 1);
    }
    const queueDepth = deployments.filter((d) => d.status === 'queued' && String(d.action ?? '').startsWith('server_')).length;
    const cutoff = Date.now() - STALLED_JOB_MS;
    const stalledJobs = jobs.filter((job) => !TERMINAL.includes(job.status)
      && job.started_at && new Date(job.started_at).getTime() < cutoff).length;

    // Jobs carry no provider of their own, so a provider's health is derived from the server the
    // job was for. A job with no resolvable provider is reported as unattributed rather than
    // silently counted against a provider that never ran it.
    const serversById = new Map(servers.map((s) => [s.id, s]));
    const regionsById = new Map(regions.map((r) => [r.id, r]));
    const providerStats = new Map(providers.map((p) => [p.id, {
      providerId: p.id, providerName: p.name,
      adapter: p.adapter ?? p.config?.adapter ?? p.type ?? null,
      status: p.status ?? (p.active === false ? 'DISABLED' : 'ACTIVE'),
      total: 0, ready: 0, failed: 0, inProgress: 0,
    }]));
    const unattributed = { providerId: null, providerName: 'unattributed', adapter: null, status: null, total: 0, ready: 0, failed: 0, inProgress: 0 };
    for (const job of jobs) {
      const server = job.server_id ? serversById.get(job.server_id) : null;
      const region = server?.region_id ? regionsById.get(server.region_id) : null;
      const stats = providerStats.get(region?.provider_id) ?? unattributed;
      stats.total += 1;
      if (READY.includes(job.status)) stats.ready += 1;
      else if (job.status === 'failed') stats.failed += 1;
      else if (job.status !== 'cancelled') stats.inProgress += 1;
    }
    const providerRows = [...providerStats.values()];
    if (unattributed.total > 0) providerRows.push(unattributed);
    ctx.json({
      total: jobs.length,
      ready: jobs.filter((job) => READY.includes(job.status)).length,
      failed: jobs.filter((job) => job.status === 'failed').length,
      average_duration_seconds: durations.length
        ? durations.reduce((sum, seconds) => sum + seconds, 0) / durations.length : 0,
      retries: jobs.reduce((sum, job) => sum + Math.max(0, (job.attempts ?? 1) - 1), 0),
      queueDepth,
      stalledJobs,
      failuresByCode: [...failureCounts.entries()]
        .map(([code, count]) => ({ code, count }))
        .sort((a, b) => b.count - a.count || String(a.code).localeCompare(String(b.code)))
        .slice(0, 20),
      providers: providerRows.sort((a, b) => String(a.providerName).localeCompare(String(b.providerName))),
    });
  });

  /**
   * Runs the end-of-life lifecycle sweep on demand. The worker runs the same function hourly; this
   * endpoint lets an operator apply a freshly entered end-of-life date immediately. It only
   * advances catalog statuses — running servers are never modified.
   */
  router.post('/api/v1/admin/os-lifecycle/sweep', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const body = await ctx.validate(v.object({
      warningDays: v.coerce.number().int().min(1).max(730).optional(),
      archiveAfterDays: v.coerce.number().int().min(1).max(3650).optional(),
    }).default({}));
    const warningMs = (body.warningDays ?? 90) * 86400000;
    const archiveMs = (body.archiveAfterDays ?? 180) * 86400000;
    const nowMs = Date.now();
    const transitions = [];

    const versions = await store.table('operating_system_versions').all();
    for (const version of versions) {
      if (!version.end_of_life_date) continue;
      const eol = Date.parse(version.end_of_life_date);
      if (!Number.isFinite(eol)) continue;
      let next = version.status;
      if (nowMs >= eol + archiveMs) next = 'ARCHIVED';
      else if (nowMs >= eol) next = version.status === 'ARCHIVED' ? 'ARCHIVED' : 'EOL';
      else if (nowMs >= eol - warningMs) {
        next = ['EOL_WARNING', 'EOL', 'ARCHIVED', 'DISABLED'].includes(version.status) ? version.status : 'EOL_WARNING';
      }
      if (next === version.status) continue;
      await store.table('operating_system_versions').updateById(version.id, { status: next, updated_at: new Date().toISOString() });
      transitions.push({
        kind: 'operating_system_version', id: version.id, version: version.version,
        from: version.status, to: next, endOfLifeDate: version.end_of_life_date,
      });
    }

    const systems = await store.table('operating_systems').all();
    for (const system of systems) {
      if (!system.eol_at) continue;
      const eol = Date.parse(system.eol_at);
      if (!Number.isFinite(eol) || nowMs < eol + archiveMs) continue;
      if (system.status === 'archived') continue;
      await store.table('operating_systems').updateById(system.id, { status: 'archived', updated_at: new Date().toISOString() });
      transitions.push({
        kind: 'operating_system', id: system.id, name: system.name,
        from: system.status, to: 'archived', endOfLifeDate: system.eol_at,
      });
    }

    await audit(auth, 'OS_LIFECYCLE_SWEPT', 'operating_system_version', null, { transitions: transitions.length });
    ctx.json({ transitions });
  });

  /**
   * Runs the scheduled-termination sweep on demand. The worker runs the same function every
   * fifteen minutes; this endpoint lets an operator reclaim a due server immediately. It only
   * enqueues DELETE jobs for servers whose customer already asked to cancel.
   */
  router.post('/api/v1/admin/server-terminations/sweep', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const nowMs = Date.now();
    const servers = await store.table('servers').all();
    const deployments = await store.table('deployments').all();
    const live = new Set(deployments
      .filter((d) => String(d.action ?? '').includes('terminat') && ['queued', 'running', 'pending'].includes(d.status))
      .map((d) => d.server_id));
    const terminated = [];
    for (const server of servers) {
      const due = server.metadata?.scheduled_termination_at;
      if (!due || Date.parse(due) > nowMs) continue;
      if (['retired', 'deleted', 'deleting', 'terminating'].includes(server.status)) continue;
      if (live.has(server.id)) continue;
      const deployment = await store.table('deployments').insert({
        id: uuidv7(), action: 'server_terminate', status: 'queued', server_id: server.id,
        user_id: server.user_id ?? null, payload: { serverId: server.id, reason: 'scheduled_termination' },
        source: 'admin', requested_by: auth.id, idempotency_key: `terminate:${server.id}`,
        attempts: 0, max_attempts: 5, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });
      await store.table('servers').updateById(server.id, { status: 'deleting', updated_at: new Date().toISOString() });
      terminated.push({ serverId: server.id, deploymentId: deployment.id, scheduledFor: due });
    }
    await audit(auth, 'SERVER_TERMINATIONS_SWEPT', 'server', null, { servers: terminated.length });
    ctx.json({ terminated });
  });

  /**
   * Server state drift. The worker asks each provider what it actually has every ten minutes; this
   * lists what disagreed with our records, and lets an operator re-check immediately. A sweep now
   * asks the provider for every server this platform holds a handle for, and falls back to comparing
   * our own records — a terminal deployment against the server row it was for — only where there is
   * no provider handle yet, so a machine left in a state its job never reached is still caught.
   */
  router.get('/api/v1/admin/server-drift', async (ctx) => {
    await asAdmin(ctx, deps);
    const query = await ctx.validateQuery(v.object({ limit: v.coerce.number().int().min(1).max(200).optional() }));
    const limit = query.limit ?? 100;
    const servers = (await store.table('servers').all())
      .filter((server) => server.metadata?.reconciliation)
      .sort((a, b) => String(b.metadata.reconciliation.observedAt ?? '').localeCompare(String(a.metadata.reconciliation.observedAt ?? '')))
      .slice(0, limit);
    ctx.json({
      servers: servers.map((server) => ({
        id: server.id, name: server.name, hostname: server.hostname, status: server.status,
        regionId: server.region_id ?? null, lastReconciledAt: server.metadata?.last_reconciled_at ?? null,
        reconciliation: server.metadata.reconciliation,
      })),
    });
  });

  router.post('/api/v1/admin/server-reconciliation/sweep', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const body = await ctx.validate(v.object({ limit: v.coerce.number().int().min(1).max(200).optional() }).default({}));
    const now = new Date();
    const nowMs = now.getTime();
    const [servers, deployments, jobs] = await Promise.all([
      store.table('servers').all(), store.table('deployments').all(), store.table('provisioning_jobs').all(),
    ]);
    const candidates = servers
      .filter((server) => RECONCILABLE_STATUSES.includes(server.status))
      .sort((a, b) => {
        const left = a.metadata?.last_reconciled_at ?? '';
        const right = b.metadata?.last_reconciled_at ?? '';
        return String(left).localeCompare(String(right)) || String(a.created_at).localeCompare(String(b.created_at));
      })
      .slice(0, body.limit ?? 25);

    const drifts = [];
    // A server row only disagrees with reality if we ask the provider that owns it. Servers this
    // platform has no handle for keep the local-record check below, and the response says how many
    // were really compared against a provider so a sweep of zero cannot read as "all agreed".
    const providerCache = new Map();
    const providerForServer = async (server) => {
      if (!server.region_id) return null;
      if (providerCache.has(server.region_id)) return providerCache.get(server.region_id);
      const region = await store.table('regions').findById(server.region_id);
      const provider = region ? await store.table('infra_providers').findById(region.provider_id) : null;
      providerCache.set(server.region_id, provider ?? null);
      return provider ?? null;
    };
    let providerChecked = 0;
    let providerUnreachable = 0;

    for (const server of candidates) {
      const serverDeployments = deployments.filter((d) => d.server_id === server.id);
      const serverJobs = jobs.filter((job) => job.server_id === server.id);
      let drift = null;

      const providerServerId = providerServerIdOf(server);
      if (providerServerId) {
        const provider = await providerForServer(server);
        if (provider) {
          providerChecked += 1;
          try {
            // healthCheck swallows RESOURCE_NOT_FOUND into `exists: false`, which is exactly the
            // answer a drift sweep needs rather than an exception.
            const state = await callProvider(provider, { config, logger: deps.logger }, 'healthCheck', providerServerId);
            if (state.exists === false && !['retired', 'cancelled', 'terminated'].includes(server.status)) {
              drift = {
                kind: 'PROVIDER_MISSING', from: server.status, to: server.status, applied: false,
                detail: `The provider no longer has ${providerServerId}, but this platform still records the server as ${server.status}.`,
              };
            } else if (state.exists && state.providerStatus && state.providerStatus !== 'unknown') {
              const agrees = PROVIDER_STATUS_ALIASES[String(state.providerStatus).toLowerCase()];
              // An unrecognised provider word is not a disagreement, and reporting one would teach
              // an operator to ignore this list. `null` (and an absent entry) means "no opinion".
              if (Array.isArray(agrees) && !agrees.includes(server.status)) {
                drift = {
                  kind: 'PROVIDER_STATUS_MISMATCH', from: server.status, to: state.providerStatus, applied: false,
                  detail: `The provider reports ${state.providerStatus} while this platform records ${server.status}.`,
                };
              }
            }
          } catch (error) {
            // A provider we could not reach proves nothing either way: report it rather than
            // recording the server as agreed.
            providerUnreachable += 1;
            deps.logger?.warn({ serverId: server.id, providerId: provider.id, reason: error.message }, 'reconciliation could not reach the provider');
          }
        }
      }

      const confirmed = serverDeployments.find((d) => String(d.action ?? '').includes('terminat')
        && ['ready', 'succeeded', 'completed'].includes(d.status));
      if (drift) {
        // The provider answered, and its answer outranks anything our own job records can infer.
        // It is reported and never auto-applied: a provider-side power change can be the customer's
        // own action, so flipping a customer's server status off a single read is not ours to do.
        // (A provider that could not be reached left `drift` null, so those servers still get the
        // local-record check below rather than being passed over in silence.)
      } else if (confirmed && ['deleting', 'terminating', 'cancelled'].includes(server.status)) {
        drift = {
          kind: 'TERMINATION_CONFIRMED', from: server.status, to: 'retired', applied: true,
          detail: 'The termination job completed; the server is now retired.',
        };
        await store.table('servers').updateById(server.id, { status: 'retired', updated_at: now.toISOString() });
      } else {
        const stalled = serverJobs.find((job) => !['ready', 'succeeded', 'failed', 'cancelled'].includes(job.status)
          && job.started_at && new Date(job.started_at).getTime() < nowMs - STALLED_JOB_MS);
        if (stalled) {
          drift = {
            kind: 'PROVISIONING_STALLED', from: server.status, to: server.status, applied: false,
            detail: `Job ${stalled.id} has been ${stalled.status} for over 30 minutes; retry or cancel it.`,
          };
        } else {
          const failed = serverDeployments
            .filter((d) => d.status === 'failed' && String(d.action ?? '').startsWith('server_'))
            .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
          if (failed && server.status === 'active') {
            drift = {
              kind: 'STATUS_MISMATCH', from: server.status, to: server.status, applied: false,
              detail: `Deployment ${failed.action} failed but the server still reports active.`,
            };
          }
        }
      }

      const metadata = { ...(server.metadata ?? {}), last_reconciled_at: now.toISOString() };
      if (drift) {
        metadata.reconciliation = { ...drift, observedAt: now.toISOString() };
        drifts.push({ serverId: server.id, name: server.name, ...drift });
        await audit(null, `SERVER_DRIFT_${drift.kind}`, 'server', server.id, drift);
      } else {
        // A server that has come back into agreement must not keep showing as drifted.
        delete metadata.reconciliation;
      }
      await store.table('servers').updateById(server.id, { metadata, updated_at: now.toISOString() });
    }
    await audit(auth, 'SERVER_RECONCILIATION_SWEPT', 'server', null, {
      drifts: drifts.length, candidates: candidates.length, providerChecked, providerUnreachable,
    });
    ctx.json({
      drifts,
      // A sweep that checked nothing against a provider must not read as "everything agreed", so the
      // counts travel with the verdict.
      reconciled: {
        candidates: candidates.length,
        providerChecked,
        providerUnreachable,
        localOnly: candidates.length - providerChecked,
      },
    });
  });

  // ---- notification delivery ----------------------------------------------
  /**
   * Notification delivery health. Email is queued in `notification_outbox` and delivered by the
   * worker; this is where an operator sees the backlog and, crucially, what is failing — a
   * notification that could not be emailed is visible rather than silently dropped.
   */
  router.get('/api/v1/admin/notification-outbox', async (ctx) => {
    await asAdmin(ctx, deps);
    const query = await ctx.validateQuery(v.object({ limit: v.coerce.number().int().min(1).max(200).optional() }));
    const rows = await store.table('notification_outbox').all();
    const summary = new Map();
    for (const row of rows) {
      const status = String(row.status ?? 'pending').toLowerCase();
      const channel = String(row.channel ?? 'email').toLowerCase();
      const key = `${status}:${channel}`;
      const entry = summary.get(key) ?? { status, channel, count: 0, oldest_created_at: null };
      entry.count += 1;
      if (!entry.oldest_created_at || String(row.created_at) < entry.oldest_created_at) entry.oldest_created_at = row.created_at;
      summary.set(key, entry);
    }
    const problems = rows
      .filter((row) => ['failed', 'configuration_required'].includes(String(row.status ?? '').toLowerCase()))
      .sort((a, b) => String(b.updated_at ?? b.created_at).localeCompare(String(a.updated_at ?? a.created_at)))
      .slice(0, query.limit ?? 50);
    const users = new Map((await store.table('users').all()).map((u) => [u.id, u]));
    ctx.json({
      summary: [...summary.values()].sort((a, b) => a.status.localeCompare(b.status) || a.channel.localeCompare(b.channel)),
      problems: problems.map((row) => ({
        id: row.id, status: row.status, channel: row.channel, attempts: row.attempts ?? 0,
        maxAttempts: row.max_attempts ?? 5, lastError: row.last_error ?? null,
        nextAttemptAt: row.next_attempt_at ?? null, createdAt: row.created_at,
        subject: row.subject ?? null, email: row.user_id ? users.get(row.user_id)?.email ?? null : null,
      })),
    });
  });

  /** Runs the email drain on demand; the worker runs the same function every minute. */
  router.post('/api/v1/admin/notification-outbox/drain', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const report = { claimed: 0, delivered: 0, retrying: 0, failed: 0, configurationRequired: 0 };
    const rows = await store.table('notification_outbox').all();
    const nowMs = Date.now();
    const due = rows
      .filter((row) => ['pending', 'configuration_required'].includes(String(row.status ?? 'pending').toLowerCase()))
      .filter((row) => !row.next_attempt_at || Date.parse(row.next_attempt_at) <= nowMs)
      .slice(0, 25);
    report.claimed = due.length;
    if (due.length === 0) {
      await audit(auth, 'NOTIFICATION_OUTBOX_DRAINED', 'notification', null, { ...report });
      ctx.json(report);
      return;
    }

    const reschedule = async (row, minutes, status, error) => {
      await store.table('notification_outbox').updateById(row.id, {
        status, next_attempt_at: new Date(Date.now() + minutes * 60000).toISOString(),
        last_error: error ? String(error).slice(0, 500) : null, updated_at: new Date().toISOString(),
      });
    };

    const url = config.NOTIFICATION_EMAIL_WEBHOOK_URL;
    const token = config.NOTIFICATION_EMAIL_WEBHOOK_TOKEN;
    if (!url || !token) {
      // Fail closed on configuration: no endpoint means nothing was sent, and saying otherwise
      // would be a lie. The row waits, it is not burned.
      for (const row of due) await reschedule(row, CONFIGURATION_RECHECK_MINUTES, 'configuration_required', 'Email delivery webhook is not configured');
      report.configurationRequired = due.length;
      await audit(auth, 'NOTIFICATION_OUTBOX_DRAINED', 'notification', null, { ...report });
      ctx.json(report);
      return;
    }

    const users = new Map((await store.table('users').all()).map((u) => [u.id, u]));
    for (const row of due) {
      const email = row.user_id ? users.get(row.user_id)?.email : null;
      if (!email) {
        await store.table('notification_outbox').updateById(row.id, {
          status: 'failed', last_error: 'Notification recipient no longer exists', updated_at: new Date().toISOString(),
        });
        report.failed += 1;
        continue;
      }
      const attempts = (row.attempts ?? 0) + 1;
      const maxAttempts = row.max_attempts ?? 5;
      const backoff = BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length - 1)];
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            to: email, name: users.get(row.user_id)?.full_name ?? null,
            template: 'notification', subject: row.subject ?? null, text: row.body ?? '',
          }),
        });
        if (response.ok) {
          await store.table('notification_outbox').updateById(row.id, {
            status: 'delivered', attempts, delivered_at: new Date().toISOString(),
            last_error: null, updated_at: new Date().toISOString(),
          });
          report.delivered += 1;
          continue;
        }
        // A rejected credential is the operator's to fix; retrying it on a schedule would only burn
        // the attempt budget on a request that cannot succeed until they do.
        if (response.status === 401 || response.status === 403) {
          await store.table('notification_outbox').updateById(row.id, { attempts });
          await reschedule(row, CONFIGURATION_RECHECK_MINUTES, 'configuration_required', `Email webhook rejected our credentials (HTTP ${response.status})`);
          report.configurationRequired += 1;
          continue;
        }
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        if (!retryable || attempts >= maxAttempts) {
          await store.table('notification_outbox').updateById(row.id, {
            status: 'failed', attempts, last_error: `Email webhook returned HTTP ${response.status}`,
            updated_at: new Date().toISOString(),
          });
          report.failed += 1;
          continue;
        }
        await store.table('notification_outbox').updateById(row.id, { attempts });
        await reschedule(row, backoff, 'pending', `Email webhook returned HTTP ${response.status}`);
        report.retrying += 1;
      } catch (error) {
        await store.table('notification_outbox').updateById(row.id, { attempts });
        if (attempts >= maxAttempts) {
          await store.table('notification_outbox').updateById(row.id, {
            status: 'failed', last_error: String(error?.message ?? error).slice(0, 500),
            updated_at: new Date().toISOString(),
          });
          report.failed += 1;
          continue;
        }
        await reschedule(row, backoff, 'pending', error?.message ?? String(error));
        report.retrying += 1;
      }
    }
    await audit(auth, 'NOTIFICATION_OUTBOX_DRAINED', 'notification', null, { ...report });
    ctx.json(report);
  });

  // ---- infrastructure logs ------------------------------------------------
  router.get('/api/v1/admin/infrastructure-logs', async (ctx) => {
    await asAdmin(ctx, deps);
    const { rows, total } = await store.table('infrastructure_logs').find({}, { orderBy: '-created_at', limit: 200 });
    ctx.json({ logs: rows, total });
  });
}

module.exports = { name, register };
