/**
 * Operating systems catalogue + admin CRUD (infrastructure §OS).
 *
 * Ported from the operating-systems cluster of cloudhost247-node/src/routes/infrastructure.ts.
 * Customer reads expose only ACTIVE operating systems and their installable versions; admin routes
 * manage the OS definitions, versions and uploaded logos. Logos are stored base64-encoded and served
 * with an ETag (304 on match). Statuses follow the original uppercase enum (ACTIVE/DISABLED/
 * ARCHIVED for OS; ACTIVE/MAINTENANCE/EOL_WARNING/EOL/ARCHIVED/DISABLED for versions).
 *
 * The original customer list/versions queries filter to combinations backed by a verified provider
 * image + active product configuration. That full availability join spans the whole infrastructure
 * catalog (providers/regions/datacenters/os-images/server-product-configurations); this port returns
 * the ACTIVE OS/version definitions directly and leaves the provider-mapping filter to the deferred
 * provisioning layer, which is honest about what is seeded.
 */
'use strict';

const crypto = require('node:crypto');
const { v } = require('../core/validate');
const { NotFoundError, ConflictError, ValidationError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { asAdmin } = require('../lib/auth');

const name = 'operating-systems';

const OS_STATUSES = ['ACTIVE', 'DISABLED', 'ARCHIVED'];
const VERSION_STATUSES = ['ACTIVE', 'MAINTENANCE', 'EOL_WARNING', 'EOL', 'ARCHIVED', 'DISABLED'];
const ARCHITECTURES = ['x86_64', 'arm64'];
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_OS_LOGO_BYTES = 512 * 1024;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const slugSchema = () => v.string().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

function hasBytes(buf, bytes, offset = 0) {
  if (buf.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i += 1) if (buf[offset + i] !== bytes[i]) return false;
  return true;
}
function validateOsLogoBytes(contentType, content) {
  if (content.length === 0 || content.length > MAX_OS_LOGO_BYTES) throw new Error(`Logo must be between 1 byte and ${MAX_OS_LOGO_BYTES} bytes`);
  const valid = contentType === 'image/png'
    ? hasBytes(content, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    : contentType === 'image/jpeg'
      ? hasBytes(content, [0xff, 0xd8, 0xff])
      : hasBytes(content, [0x52, 0x49, 0x46, 0x46]) && hasBytes(content, [0x57, 0x45, 0x42, 0x50], 8);
  if (!valid) throw new Error(`Uploaded bytes are not a valid ${contentType} image`);
}
const isActive = (os) => String(os?.status ?? '').toUpperCase() === 'ACTIVE';
const osDto = (o) => ({
  id: o.id, slug: o.slug, name: o.name, family: o.family ?? null, vendor: o.vendor ?? null, description: o.description ?? null,
  logoUrl: o.logo_url ?? null, isVpsSupported: o.is_vps_supported, isDedicatedSupported: o.is_dedicated_supported,
  isCloudSupported: o.is_cloud_supported, isReinstallSupported: o.is_reinstall_supported, sortOrder: o.sort_order ?? 0,
  status: o.status, eolAt: o.eol_at ?? null, createdAt: o.created_at,
});
const versionDto = (ver) => ({
  id: ver.id, operatingSystemId: ver.operating_system_id, version: ver.version, displayName: ver.display_name ?? null,
  releaseName: ver.release_name ?? null, architectureSupport: ver.architecture_support ?? [], isDefault: ver.is_default,
  isRecommended: ver.is_recommended, isLts: ver.is_lts, releaseDate: ver.release_date ?? null, endOfLifeDate: ver.end_of_life_date ?? null,
  status: ver.status,
});

function register(router, deps) {
  const { store } = deps;

  async function audit(ctx, action, resourceType, resourceId, metadata) {
    await store.table('audit_logs').insert({
      id: uuidv7(), actor_id: ctx.user.id, actor_role: ctx.user.role, action,
      entity_type: resourceType, entity_id: resourceId ?? null,
      ip_address: ctx.ip, user_agent: ctx.userAgent, after: metadata ?? null,
    });
  }

  const createOsSchema = () => v.object({
    name: v.string().min(1).max(160),
    slug: slugSchema(),
    osReleaseIds: v.array(v.string().min(1).max(64)).max(8).optional(),
    vendor: v.string().max(160).nullable().optional(),
    description: v.string().max(4000).nullable().optional(),
    logoUrl: v.string().max(1000).nullable().optional(),
    status: v.enum(OS_STATUSES).optional(),
    sortOrder: v.coerce.number().int().optional(),
    isVpsSupported: v.boolean().optional(),
    isDedicatedSupported: v.boolean().optional(),
    isCloudSupported: v.boolean().optional(),
    isReinstallSupported: v.boolean().optional(),
  });
  const versionSchema = () => v.object({
    version: v.string().min(1).max(64),
    displayName: v.string().min(1).max(200),
    releaseName: v.string().max(160).nullable().optional(),
    architectureSupport: v.array(v.enum(ARCHITECTURES)).min(1).max(2),
    status: v.enum(VERSION_STATUSES).optional(),
    isDefault: v.boolean().optional(),
    isRecommended: v.boolean().optional(),
    isLts: v.boolean().optional(),
    releaseDate: v.string().regex(DATE_RE).nullable().optional(),
    endOfLifeDate: v.string().regex(DATE_RE).nullable().optional(),
  });

  // ---------------------------------------------------------- customer reads
  router.get('/api/v1/operating-systems/:id', async (ctx) => {
    const os = await store.table('operating_systems').findById(ctx.params.id);
    if (!os || !isActive(os)) throw new NotFoundError('No operating system was found with that id');
    ctx.json({ operatingSystem: osDto(os) });
  });

  router.get('/api/v1/operating-systems/:id/logo', async (ctx) => {
    const os = await store.table('operating_systems').findById(ctx.params.id);
    if (!os) throw new NotFoundError('No operating system was found with that id');
    const asset = await store.table('operating_system_logos').findOne({ operating_system_id: os.id });
    if (!asset) throw new NotFoundError('No uploaded logo was found for that operating system');
    const etag = `"${asset.sha256}"`;
    if (ctx.req.headers['if-none-match'] === etag) { ctx.code(304); return ctx.send(null); }
    ctx.header('Content-Type', asset.content_type);
    ctx.header('Cache-Control', 'public, max-age=3600, must-revalidate');
    ctx.header('ETag', etag);
    ctx.header('X-Content-Type-Options', 'nosniff');
    ctx.send(Buffer.from(asset.content, 'base64'));
  });

  router.get('/api/v1/operating-systems/:id/versions', async (ctx) => {
    const os = await store.table('operating_systems').findById(ctx.params.id);
    if (!os || !isActive(os)) throw new NotFoundError('No operating system was found with that id');
    const versions = (await store.table('operating_system_versions').all())
      .filter((ver) => ver.operating_system_id === os.id && ['ACTIVE', 'MAINTENANCE', 'EOL_WARNING'].includes(String(ver.status).toUpperCase()));
    versions.sort((a, b) => (b.is_default - a.is_default) || (b.is_recommended - a.is_recommended) || String(b.display_name ?? '').localeCompare(String(a.display_name ?? '')));
    ctx.json({ operatingSystem: osDto(os), versions: versions.map(versionDto) });
  });

  // ------------------------------------------------------------- admin CRUD
  router.get('/api/v1/admin/operating-systems', async (ctx) => {
    await asAdmin(ctx, deps);
    const rows = await store.table('operating_systems').all();
    rows.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name));
    ctx.json({ operatingSystems: rows.map(osDto) });
  });

  router.post('/api/v1/admin/operating-systems', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const input = await ctx.validate(createOsSchema());
    const existing = await store.table('operating_systems').findOne({ slug: input.slug });
    if (existing) throw new ConflictError('An operating system with that slug already exists');
    const os = await store.table('operating_systems').insert({
      id: uuidv7(), slug: input.slug, name: input.name, family: input.vendor ?? null, vendor: input.vendor ?? null,
      description: input.description ?? null, logo_url: input.logoUrl ?? null, status: input.status ?? 'ACTIVE',
      sort_order: input.sortOrder ?? 0, is_vps_supported: input.isVpsSupported ?? true,
      is_dedicated_supported: input.isDedicatedSupported ?? true, is_cloud_supported: input.isCloudSupported ?? true,
      is_reinstall_supported: input.isReinstallSupported ?? true,
    });
    await audit(ctx, 'OS_CREATED', 'operating_system', os.id, null);
    ctx.code(201).json({ operatingSystem: osDto(os) });
  });

  router.patch('/api/v1/admin/operating-systems/:id', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const id = ctx.params.id;
    const patch = await ctx.validate(createOsSchema().omit(['slug']).partial());
    const current = await store.table('operating_systems').findById(id);
    if (!current) throw new NotFoundError('No operating system was found with that id');
    const fields = {};
    if (patch.name !== undefined) fields.name = patch.name;
    if (patch.vendor !== undefined) { fields.vendor = patch.vendor; fields.family = patch.vendor; }
    if (patch.description !== undefined) fields.description = patch.description;
    if (patch.logoUrl !== undefined) fields.logo_url = patch.logoUrl;
    if (patch.status !== undefined) fields.status = patch.status;
    if (patch.sortOrder !== undefined) fields.sort_order = patch.sortOrder;
    if (patch.isVpsSupported !== undefined) fields.is_vps_supported = patch.isVpsSupported;
    if (patch.isDedicatedSupported !== undefined) fields.is_dedicated_supported = patch.isDedicatedSupported;
    if (patch.isCloudSupported !== undefined) fields.is_cloud_supported = patch.isCloudSupported;
    if (patch.isReinstallSupported !== undefined) fields.is_reinstall_supported = patch.isReinstallSupported;
    const os = await store.table('operating_systems').updateById(id, fields);
    await audit(ctx, 'OS_UPDATED', 'operating_system', id, { status: os.status });
    ctx.json({ operatingSystem: osDto(os) });
  });

  router.delete('/api/v1/admin/operating-systems/:id', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const id = ctx.params.id;
    const existing = await store.table('operating_systems').findById(id);
    if (!existing) throw new NotFoundError('No operating system was found with that id');
    if (String(existing.status).toUpperCase() !== 'ARCHIVED') throw new ConflictError('Archive the operating system before deleting it');
    const versions = (await store.table('operating_system_versions').all()).filter((ver) => ver.operating_system_id === id);
    if (versions.length > 0) throw new ConflictError('This OS has version or server history and must remain archived');
    await store.table('operating_systems').deleteById(id);
    await audit(ctx, 'OS_DELETED', 'operating_system', id, null);
    ctx.noContent();
  });

  // ------------------------------------------------------------- admin logo
  router.post('/api/v1/admin/operating-systems/:id/logo', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const osId = ctx.params.id;
    const os = await store.table('operating_systems').findById(osId);
    if (!os) throw new NotFoundError('No operating system was found with that id');
    const input = await ctx.validate(v.object({
      fileName: v.string().trim().min(1).max(255),
      contentType: v.enum(LOGO_TYPES),
      contentBase64: v.string().min(4).max(Math.ceil(MAX_OS_LOGO_BYTES / 3) * 4 + 8),
    }));
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.contentBase64) || input.contentBase64.length % 4 !== 0) throw new ValidationError('Logo content must be canonical base64');
    const content = Buffer.from(input.contentBase64, 'base64');
    try { validateOsLogoBytes(input.contentType, content); } catch (error) { throw new ValidationError(error instanceof Error ? error.message : 'Invalid logo image'); }
    const logoUrl = `/api/v1/operating-systems/${osId}/logo`;
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    const existingLogo = await store.table('operating_system_logos').findOne({ operating_system_id: osId });
    const assetFields = {
      operating_system_id: osId, content_type: input.contentType, content: input.contentBase64,
      byte_size: content.length, sha256, original_filename: input.fileName, uploaded_by: auth.id,
    };
    if (existingLogo) await store.table('operating_system_logos').updateById(existingLogo.id, assetFields);
    else await store.table('operating_system_logos').insert({ id: uuidv7(), ...assetFields });
    await store.table('operating_systems').updateById(osId, { logo_url: logoUrl });
    await audit(ctx, 'OS_LOGO_UPLOADED', 'operating_system', osId, { contentType: input.contentType, byteSize: content.length, sha256 });
    ctx.code(201).json({ logo: { url: logoUrl, contentType: input.contentType, byteSize: content.length, sha256 } });
  });

  router.delete('/api/v1/admin/operating-systems/:id/logo', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const osId = ctx.params.id;
    const os = await store.table('operating_systems').findById(osId);
    if (!os) throw new NotFoundError('No operating system was found with that id');
    const logo = await store.table('operating_system_logos').findOne({ operating_system_id: osId });
    if (!logo) throw new NotFoundError('No uploaded logo was found for that operating system');
    await store.table('operating_system_logos').deleteById(logo.id);
    if (os.logo_url === `/api/v1/operating-systems/${osId}/logo`) await store.table('operating_systems').updateById(osId, { logo_url: null });
    await audit(ctx, 'OS_LOGO_DELETED', 'operating_system', osId, null);
    ctx.noContent();
  });

  // ---------------------------------------------------------- admin versions
  router.get('/api/v1/admin/operating-systems/:id/versions', async (ctx) => {
    await asAdmin(ctx, deps);
    const os = await store.table('operating_systems').findById(ctx.params.id);
    if (!os) throw new NotFoundError('No operating system was found with that id');
    const versions = (await store.table('operating_system_versions').all()).filter((ver) => ver.operating_system_id === os.id);
    const images = (await store.table('os_images').all()).filter((i) => i.os_id === os.id);
    const out = versions.map((ver) => {
      const matching = images.filter((i) => i.version === ver.version);
      const active = matching.filter((i) => String(i.status).toUpperCase() === 'ACTIVE');
      return {
        ...versionDto(ver),
        provider_image_count: matching.length,
        active_image_count: active.length,
        available_region_count: new Set(active.map((i) => i.region_id).filter(Boolean)).size,
      };
    });
    ctx.json({ operatingSystem: osDto(os), versions: out });
  });

  router.post('/api/v1/admin/operating-systems/:id/versions', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const osId = ctx.params.id;
    const os = await store.table('operating_systems').findById(osId);
    if (!os) throw new NotFoundError('No operating system was found with that id');
    const input = await ctx.validate(versionSchema());
    const ver = await store.table('operating_system_versions').insert({
      id: uuidv7(), operating_system_id: osId, version: input.version, display_name: input.displayName,
      release_name: input.releaseName ?? null, architecture_support: input.architectureSupport,
      status: input.status ?? 'ACTIVE', is_default: input.isDefault ?? false, is_recommended: input.isRecommended ?? false,
      is_lts: input.isLts ?? false, release_date: input.releaseDate ?? null, end_of_life_date: input.endOfLifeDate ?? null,
    });
    await audit(ctx, 'OS_VERSION_CREATED', 'operating_system_version', ver.id, null);
    ctx.code(201).json({ version: versionDto(ver) });
  });

  router.patch('/api/v1/admin/operating-system-versions/:id', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const versionId = ctx.params.id;
    const patch = await ctx.validate(versionSchema().omit(['version']).partial());
    const existing = await store.table('operating_system_versions').findById(versionId);
    if (!existing) throw new NotFoundError('No operating system version was found with that id');
    if (patch.status === 'ACTIVE') {
      const os = await store.table('operating_systems').findById(existing.operating_system_id);
      if (!os || !isActive(os)) throw new ValidationError('Operating system must be active before a version can be activated');
    }
    const fields = {};
    if (patch.displayName !== undefined) fields.display_name = patch.displayName;
    if (patch.releaseName !== undefined) fields.release_name = patch.releaseName;
    if (patch.architectureSupport !== undefined) fields.architecture_support = patch.architectureSupport;
    if (patch.status !== undefined) fields.status = patch.status;
    if (patch.isDefault !== undefined) fields.is_default = patch.isDefault;
    if (patch.isRecommended !== undefined) fields.is_recommended = patch.isRecommended;
    if (patch.isLts !== undefined) fields.is_lts = patch.isLts;
    if (patch.releaseDate !== undefined) fields.release_date = patch.releaseDate;
    if (patch.endOfLifeDate !== undefined) fields.end_of_life_date = patch.endOfLifeDate;
    const ver = await store.table('operating_system_versions').updateById(versionId, fields);
    await audit(ctx, 'OS_VERSION_UPDATED', 'operating_system_version', versionId, { status: ver.status });
    ctx.json({ version: versionDto(ver) });
  });
}

module.exports = { name, register };
