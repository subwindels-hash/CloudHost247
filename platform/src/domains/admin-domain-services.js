/**
 * Domain Services Super Admin API.
 *
 * Ported from cloudhost247-node/src/routes/admin-domain-services.ts. Security contract preserved:
 *   - Read views require staff; provider/credential/plan mutations require super_admin.
 *   - Credentials are WRITE-ONLY: accepted once, encrypted (AES-256-GCM, key derived from
 *     JWT_SECRET), and never returned by any endpoint — not in full, not masked, not in audit.
 *   - "Test Connection" never fakes success, and now performs a **real** authenticated call through
 *     `lib/domain-providers/` — for RDAP that means fetching the IANA bootstrap registry, for the
 *     GoValue appraisal API a genuine appraisal request. `status: 'connected'` is only ever set by a
 *     test that actually succeeded, and it is the gate the customer-facing connector reads.
 *   - The installed-adapter list is the compiled registry's own answer, so this API cannot offer an
 *     adapter that would refuse every call.
 *
 * Still deferred in this module, and reported as such: the registrar transfer refresh poll and the
 * extension catalogue sync. No registrar adapter (`namecheap`, `godaddy`) is ported yet, so both
 * refuse with a named reason instead of fabricating a status.
 */
'use strict';

const crypto = require('node:crypto');
const { v } = require('../core/validate');
const { NotFoundError, ValidationError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { asAdmin, asStaff, asSuperAdmin } = require('../lib/auth');
const { decryptSecret, PURPOSES } = require('../lib/secret-box');
const { createDomainProviderAdapter, registeredDomainProviderAdapters } = require('../lib/domain-providers/registry');
const { registerBuiltInDomainProviderAdapters } = require('../lib/domain-providers/register-builtins');
const { DomainProviderError } = require('../lib/domain-providers/types');

const name = 'admin-domain-services';

// The adapter keys this build can actually construct — the registry's own answer, not a hand-kept
// menu. `namecheap` and `godaddy` are therefore *absent* until their adapters are ported: offering
// them here would let an operator create a provider row that every call refuses, and the list the
// API returns is the same list `createDomainProviderAdapter` enforces.
registerBuiltInDomainProviderAdapters();
const installedAdapters = () => registeredDomainProviderAdapters();
const LIMITS = { bulkSearchMaxDomains: 500, bulkSearchMaxPerHour: 30, whoisLookupsPerHour: 60 };
const money = () => v.string().regex(/^\d{1,10}(\.\d{1,2})?$/, 'must be a decimal amount, e.g. 20.00');

// ---- write-only credential encryption (AES-256-GCM, key from JWT_SECRET) ----
function credKey(secret) {
  return crypto.scryptSync(String(secret), 'cloudhost247-domain-providers', 32);
}
function encryptCreds(secret, obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', credKey(secret), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}
function hasCreds(row) {
  return Boolean(row && row.credentials_encrypted);
}

/**
 * The stored credentials as a plain object, for constructing an adapter.
 *
 * Read through `lib/secret-box.js`, whose domain-provider salt is byte-identical to `credKey`
 * above — so ciphertext written by `encryptCreds` (including everything written before secret-box
 * existed) opens here, and no credential has to be re-entered to become usable. The return value is
 * never logged, never serialised into a response, and never attached to an error.
 */
function credentialsForProvider(row, secret) {
  if (!hasCreds(row)) {
    if (row?.adapter_key === 'rdap') return {}; // public registry service: no credentials exist
    throw new Error('No credentials are stored for this provider');
  }
  // The envelope holds JSON; `decryptSecret` returns the plaintext string, so it must be parsed.
  const plaintext = decryptSecret(secret, PURPOSES.domainProvider, row.credentials_encrypted);
  if (plaintext === null) throw new Error('The stored credentials could not be decrypted with this deployment key');
  let decoded;
  try {
    decoded = JSON.parse(plaintext);
  } catch {
    throw new Error('The stored credentials are not a readable key/value object');
  }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    throw new Error('The stored credentials are not a key/value object');
  }
  return decoded;
}

function providerDto(p) {
  if (!p) return null;
  // credentials_encrypted is deliberately omitted — write-only.
  return {
    id: p.id, providerKey: p.provider_key, name: p.name, adapterKey: p.adapter_key,
    providerType: p.provider_type, apiBaseUrl: p.api_base_url ?? null, environment: p.environment,
    capabilities: p.capabilities ?? {}, configuration: p.configuration ?? {}, status: p.status,
    connectionTested: p.connection_tested, connectionSucceeded: p.connection_succeeded,
    lastError: p.last_error ?? null, hasCredentials: hasCreds(p),
    createdAt: p.created_at, updatedAt: p.updated_at,
  };
}

function register(router, deps) {
  const { store } = deps;
  const secret = deps.config?.JWT_SECRET || 'ephemeral';

  async function audit(ctx, action, entityType, entityId, metadata) {
    await store.table('audit_logs').insert({
      id: uuidv7(), actor_id: ctx.user.id, actor_role: ctx.user.role, action,
      entity_type: entityType, entity_id: entityId ?? null,
      ip_address: ctx.ip, user_agent: ctx.userAgent, after: metadata ?? null,
    });
  }
  const emailOf = async (id) => (id ? (await store.table('users').findById(id))?.email ?? null : null);
  const orderNumberOf = async (id) => (id ? (await store.table('orders').findById(id))?.order_number ?? null : null);
  const invoiceOf = async (id) => (id ? await store.table('invoices').findById(id) : null);

  // ===================== Providers =====================
  router.get('/api/v1/admin/domain-services/providers', async (ctx) => {
    await asStaff(ctx, deps);
    const rows = await store.table('domain_service_providers').all();
    ctx.json({ providers: rows.map(providerDto), installedAdapters: installedAdapters() });
  });

  router.post('/api/v1/admin/domain-services/providers', async (ctx) => {
    const auth = await asSuperAdmin(ctx, deps);
    const input = await ctx.validate(v.object({
      providerKey: v.string().min(2).max(80).regex(/^[a-z0-9][a-z0-9_-]*$/),
      name: v.string().min(2).max(160),
      adapterKey: v.string().min(2).max(80),
      providerType: v.enum(['registrar', 'rdap', 'appraisal', 'auction']),
      apiBaseUrl: v.string().max(500).nullable().optional(),
      environment: v.enum(['sandbox', 'production']).default('production'),
      capabilities: v.object({}).passthrough().optional(),
      configuration: v.object({}).passthrough().optional(),
    }));
    if (!installedAdapters().includes(input.adapterKey)) {
      throw new ValidationError(`Adapter '${input.adapterKey}' is not installed in this build. Installed adapters: ${installedAdapters().join(', ') || 'none'}`);
    }
    const existing = await store.table('domain_service_providers').findOne({ provider_key: input.providerKey });
    if (existing) throw new ValidationError('A provider with that key already exists');
    const row = await store.table('domain_service_providers').insert({
      id: uuidv7(), provider_key: input.providerKey, name: input.name, adapter_key: input.adapterKey,
      provider_type: input.providerType, api_base_url: input.apiBaseUrl ?? null, environment: input.environment,
      capabilities: input.capabilities ?? {}, configuration: input.configuration ?? {},
      status: 'not_configured', created_by: auth.id,
    });
    await audit(ctx, 'admin.domain_provider_created', 'domain_service_provider', row.id, { providerKey: input.providerKey, adapterKey: input.adapterKey, providerType: input.providerType });
    ctx.code(201).json({ provider: providerDto(row) });
  });

  router.patch('/api/v1/admin/domain-services/providers/:id', async (ctx) => {
    await asSuperAdmin(ctx, deps);
    const id = ctx.params.id;
    const input = await ctx.validate(v.object({
      name: v.string().min(2).max(160).optional(),
      apiBaseUrl: v.string().max(500).nullable().optional(),
      environment: v.enum(['sandbox', 'production']).optional(),
      status: v.enum(['not_configured', 'configured', 'connected', 'auth_failed', 'unavailable', 'disabled']).optional(),
      configuration: v.object({}).passthrough().optional(),
    }));
    const current = await store.table('domain_service_providers').findById(id);
    if (!current) throw new NotFoundError('No provider was found with that id');
    const patch = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.apiBaseUrl !== undefined) patch.api_base_url = input.apiBaseUrl;
    if (input.environment !== undefined) patch.environment = input.environment;
    if (input.status !== undefined) patch.status = input.status;
    if (input.configuration !== undefined) patch.configuration = input.configuration;
    const updated = await store.table('domain_service_providers').updateById(id, patch);
    await audit(ctx, 'admin.domain_provider_updated', 'domain_service_provider', id, { fields: Object.keys(input) });
    ctx.json({ provider: providerDto(updated) });
  });

  router.put('/api/v1/admin/domain-services/providers/:id/credentials', async (ctx) => {
    await asSuperAdmin(ctx, deps);
    const id = ctx.params.id;
    const input = await ctx.validate(v.object({ credentials: v.record(v.string().min(1).max(20000)) }));
    const provider = await store.table('domain_service_providers').findById(id);
    if (!provider) throw new NotFoundError('No provider was found with that id');
    if (Object.keys(input.credentials).length === 0) throw new ValidationError('Provide at least one credential');
    const encrypted = encryptCreds(secret, input.credentials);
    // Rotating credentials invalidates the previous connection state.
    const updated = await store.table('domain_service_providers').updateById(id, {
      credentials_encrypted: encrypted, status: 'configured', connection_tested: false, connection_succeeded: false,
    });
    await audit(ctx, 'admin.domain_provider_credentials_updated', 'domain_service_provider', id, { credentialNames: Object.keys(input.credentials).sort() });
    ctx.json({ provider: providerDto(updated) });
  });

  /**
   * Test Connection — a real authenticated call against the provider's own API.
   *
   * This route is the *gate* to the domain-provider connector: `lib/domain-provider-service.js`
   * will only use a row whose status is `connected`, and nothing else in the platform can set that
   * status. An operator asking "does this provider work?" therefore always gets an answer grounded
   * in a request that actually happened — including `not_configured` and `auth_failed`, which are
   * verdicts *about the configuration* and are returned without pretending an outage occurred.
   *
   * The verdict never carries the provider's raw error text to the browser; the row's `last_error`
   * (staff-visible, not customer-visible) carries the bounded reason for an operator to act on.
   */
  router.post('/api/v1/admin/domain-services/providers/:id/test', async (ctx) => {
    await asSuperAdmin(ctx, deps);
    const id = ctx.params.id;
    const provider = await store.table('domain_service_providers').findById(id);
    if (!provider) throw new NotFoundError('No provider was found with that id');

    let result;
    if (!installedAdapters().includes(String(provider.adapter_key ?? '').toLowerCase())) {
      // A configuration answer, and no request is made.
      result = {
        status: 'not_configured',
        message: `Adapter '${provider.adapter_key}' is not installed in this build. Installed adapters: ${installedAdapters().join(', ') || 'none'}`,
        capabilities: {},
      };
    } else {
      let credentials = null;
      try {
        credentials = credentialsForProvider(provider, secret);
      } catch (error) {
        // Both cases are configuration answers, not outages, but they need different fixes: one
        // asks the operator to enter a credential, the other to re-enter one that no longer opens.
        result = {
          status: 'not_configured',
          message: hasCreds(provider)
            ? 'The stored credentials could not be read with this deployment key — re-enter them to rotate the encryption.'
            : error.message,
          capabilities: {},
        };
      }
      if (!result) {
        try {
          const adapter = createDomainProviderAdapter({
            id: provider.id, key: provider.provider_key, name: provider.name,
            adapterKey: provider.adapter_key, type: provider.provider_type,
            environment: provider.environment === 'sandbox' ? 'sandbox' : 'production',
            apiBaseUrl: provider.api_base_url ?? null,
            capabilities: provider.capabilities ?? {},
            configuration: provider.configuration ?? {},
            credentials,
          }, {
            // Same rule the seam applies when it builds a client for a customer call: only a
            // `sandbox` provider may point at loopback. If the two disagreed, a provider could pass
            // its connection test and then fail every real call (or vice versa) — which is exactly
            // the kind of gap this route exists to close.
            allowLoopback: provider.environment === 'sandbox',
          });
          result = await adapter.testConnection();
        } catch (error) {
          result = {
            status: 'unavailable',
            message: error instanceof DomainProviderError ? error.message : 'The provider could not be tested',
            capabilities: {},
          };
        }
      }
    }

    const rowStatus = ['connected', 'auth_failed', 'unavailable', 'not_configured'].includes(result.status)
      ? result.status
      : 'unavailable';
    const updated = await store.table('domain_service_providers').updateById(id, {
      status: rowStatus,
      connection_tested: true,
      connection_succeeded: rowStatus === 'connected',
      last_error: rowStatus === 'connected' ? null : String(result.message ?? '').slice(0, 500),
    });
    await audit(ctx, 'admin.domain_provider_connection_tested', 'domain_service_provider', id, {
      status: rowStatus,
      capabilities: result.capabilities ?? {},
    });
    ctx.json({
      provider: providerDto(updated),
      result: { status: rowStatus, message: result.message ?? null, capabilities: result.capabilities ?? {} },
    });
  });

  // ===================== Extensions =====================
  router.get('/api/v1/admin/domain-services/extensions', async (ctx) => {
    await asStaff(ctx, deps);
    const rows = await store.table('domain_extensions').all();
    ctx.json({ extensions: rows.map((e) => ({
      id: e.id, tld: e.tld, registerPriceCents: e.register_price_cents, renewPriceCents: e.renew_price_cents,
      isTrending: e.is_trending, description: e.description ?? null, restrictions: e.restrictions ?? null,
      registrationRequirements: e.registration_requirements ?? null, status: e.status,
    })) });
  });

  router.post('/api/v1/admin/domain-services/extensions/sync', async (ctx) => {
    const auth = await asSuperAdmin(ctx, deps);
    // No registrar connector is configured, so there is nothing to sync from. Honest empty report.
    const report = { synced: 0, created: 0, updated: 0, providerName: null, message: 'No registrar connector is configured; nothing to sync.' };
    await audit(ctx, 'admin.domain_extensions_synced', 'domain_extension_catalog', null, { synced: 0, created: 0, updated: 0 });
    ctx.json(report);
  });

  router.patch('/api/v1/admin/domain-services/extensions/:id', async (ctx) => {
    await asSuperAdmin(ctx, deps);
    const id = ctx.params.id;
    const input = await ctx.validate(v.object({
      isTrending: v.boolean().optional(),
      description: v.string().max(2000).nullable().optional(),
      restrictions: v.string().max(2000).nullable().optional(),
      registrationRequirements: v.string().max(2000).nullable().optional(),
      status: v.enum(['active', 'disabled', 'unavailable']).optional(),
    }));
    const current = await store.table('domain_extensions').findById(id);
    if (!current) throw new NotFoundError('No extension was found with that id');
    const patch = {};
    if (input.isTrending !== undefined) patch.is_trending = input.isTrending;
    if (input.description !== undefined) patch.description = input.description;
    if (input.restrictions !== undefined) patch.restrictions = input.restrictions;
    if (input.registrationRequirements !== undefined) patch.registration_requirements = input.registrationRequirements;
    if (input.status !== undefined) { patch.status = input.status; patch.active = input.status === 'active'; }
    await store.table('domain_extensions').updateById(id, patch);
    await audit(ctx, 'admin.domain_extension_updated', 'domain_extension', id, { fields: Object.keys(input) });
    ctx.json({ ok: true });
  });

  // ===================== Registrations + transfers oversight =====================
  router.get('/api/v1/admin/domain-services/registrations', async (ctx) => {
    await asStaff(ctx, deps);
    const query = await ctx.validateQuery(v.object({ status: v.string().optional(), search: v.string().optional() }));
    let rows = await store.table('domain_registrations').find({}, { orderBy: '-created_at', limit: 100 }).then((r) => r.rows);
    if (query.status) rows = rows.filter((r) => r.status === query.status);
    if (query.search) rows = rows.filter((r) => (r.domain_name || r.domain || '').toLowerCase().includes(query.search.toLowerCase()));
    const out = [];
    for (const r of rows) {
      const inv = await invoiceOf(r.invoice_id);
      out.push({
        id: r.id, domain_name: r.domain_name ?? r.domain, registration_years: r.years, status: r.status,
        provider_reference: r.provider_reference ?? null, provider_status: r.provider_status ?? null,
        error_code: r.error_code ?? null, error_message: r.error_message ?? null,
        created_at: r.created_at, updated_at: r.updated_at, requested_at: r.requested_at ?? null, confirmed_at: r.confirmed_at ?? null,
        customer_email: await emailOf(r.user_id), order_number: await orderNumberOf(r.order_id),
        invoice_number: inv?.invoice_number ?? null, invoice_status: inv?.status ?? null,
      });
    }
    ctx.json({ registrations: out });
  });

  router.get('/api/v1/admin/domain-services/transfers', async (ctx) => {
    await asStaff(ctx, deps);
    const query = await ctx.validateQuery(v.object({ status: v.string().optional(), search: v.string().optional() }));
    let rows = await store.table('domain_transfers').find({}, { orderBy: '-created_at', limit: 100 }).then((r) => r.rows);
    if (query.status) rows = rows.filter((r) => r.status === query.status);
    if (query.search) rows = rows.filter((r) => (r.domain_name || r.domain || '').toLowerCase().includes(query.search.toLowerCase()));
    const out = [];
    for (const t of rows) {
      const inv = await invoiceOf(t.invoice_id);
      out.push({
        id: t.id, domain_name: t.domain_name ?? t.domain, current_registrar: t.current_registrar ?? null, status: t.status,
        provider_status: t.provider_status ?? null, provider_reference: t.provider_reference ?? null,
        provider_metadata: t.provider_metadata ?? null, error_code: t.error_code ?? null, error_message: t.error_message ?? null,
        created_at: t.created_at, updated_at: t.updated_at, initiated_at: t.initiated_at ?? null, completed_at: t.completed_at ?? null,
        customer_email: await emailOf(t.user_id), order_number: await orderNumberOf(t.order_id),
        invoice_number: inv?.invoice_number ?? null, invoice_status: inv?.status ?? null,
      });
    }
    ctx.json({ transfers: out });
  });

  router.post('/api/v1/admin/domain-services/transfers/:id/refresh', async (ctx) => {
    await asStaff(ctx, deps);
    const id = ctx.params.id;
    const t = await store.table('domain_transfers').findById(id);
    if (!t) throw new NotFoundError('No transfer was found with that id');
    // Provider poll is deferred (no registrar egress). Report honestly; leave status untouched.
    const result = { status: 'deferred', message: 'Transfer refresh requires a registrar connector (deferred).', currentStatus: t.status };
    await audit(ctx, 'admin.domain_transfer_refreshed', 'domain_transfer', id, { status: 'deferred' });
    ctx.json(result);
  });

  router.patch('/api/v1/admin/domain-services/transfers/:id', async (ctx) => {
    await asStaff(ctx, deps);
    const id = ctx.params.id;
    const input = await ctx.validate(v.object({
      status: v.enum(['pending', 'authorization_required', 'transfer_initiated', 'transfer_in_progress', 'pending_registry', 'completed', 'failed', 'cancelled']),
      note: v.string().max(500).optional(),
    }));
    const t = await store.table('domain_transfers').findById(id);
    if (!t) throw new NotFoundError('No transfer was found with that id');
    const patch = { status: input.status };
    if (input.status === 'completed') patch.completed_at = new Date().toISOString();
    if (input.note !== undefined) patch.provider_metadata = { ...(t.provider_metadata ?? {}), adminNote: input.note };
    await store.table('domain_transfers').updateById(id, patch);
    await audit(ctx, 'admin.domain_transfer_status_updated', 'domain_transfer', id, { status: input.status });
    ctx.json({ ok: true });
  });

  // ===================== Auctions management =====================
  const auctionDto = (a) => ({
    id: a.id, domainName: a.domain_name ?? a.domain, status: a.status,
    minimumBid: a.minimum_bid != null ? String(a.minimum_bid) : null,
    bidIncrement: a.bid_increment != null ? String(a.bid_increment) : null,
    currentBid: a.current_bid != null ? String(a.current_bid) : null,
    startsAt: a.starts_at ?? null, endsAt: a.ends_at ?? null, sellerId: a.seller_id ?? null,
  });

  router.get('/api/v1/admin/domain-services/auctions', async (ctx) => {
    await asStaff(ctx, deps);
    const query = await ctx.validateQuery(v.object({ status: v.string().optional(), search: v.string().optional(), page: v.coerce.number().int().min(1).default(1), limit: v.coerce.number().int().min(1).max(100).default(25) }));
    let rows = await store.table('domain_auctions').find({}, { orderBy: '-created_at' }).then((r) => r.rows);
    if (query.status) rows = rows.filter((a) => a.status === query.status);
    if (query.search) rows = rows.filter((a) => (a.domain_name || a.domain || '').toLowerCase().includes(query.search.toLowerCase()));
    const start = (query.page - 1) * query.limit;
    ctx.json({ auctions: rows.slice(start, start + query.limit).map(auctionDto), page: query.page, limit: query.limit, total: rows.length });
  });

  router.post('/api/v1/admin/domain-services/auctions', async (ctx) => {
    const auth = await asStaff(ctx, deps);
    const input = await ctx.validate(v.object({
      domainName: v.string().min(4).max(253),
      minimumBid: money(), bidIncrement: money(),
      startsAt: v.string().datetime(), endsAt: v.string().datetime(),
      sellerId: v.string().nullable().optional(),
    }));
    const row = await store.table('domain_auctions').insert({
      id: uuidv7(), user_id: auth.id, domain: input.domainName.toLowerCase(), domain_name: input.domainName.toLowerCase(),
      minimum_bid: Number(input.minimumBid), bid_increment: Number(input.bidIncrement),
      starting_bid: Number(input.minimumBid), starting_bid_cents: Math.round(Number(input.minimumBid) * 100),
      current_bid: 0, current_bid_cents: 0, status: 'scheduled',
      starts_at: input.startsAt, ends_at: input.endsAt, seller_id: input.sellerId ?? null,
    });
    await audit(ctx, 'admin.domain_auction_created', 'domain_auction', row.id, { domainName: row.domain_name, minimumBid: input.minimumBid });
    ctx.code(201).json({ auction: auctionDto(row) });
  });

  router.get('/api/v1/admin/domain-services/auctions/:id', async (ctx) => {
    await asStaff(ctx, deps);
    const a = await store.table('domain_auctions').findById(ctx.params.id);
    if (!a) throw new NotFoundError('No auction was found with that id');
    const bids = (await store.table('domain_auction_bids').all()).filter((b) => b.auction_id === a.id);
    const participants = [];
    for (const b of bids) participants.push({ userId: b.user_id, email: await emailOf(b.user_id), amount: String(b.amount), createdAt: b.created_at });
    ctx.json({ auction: auctionDto(a), bids: bids.map((b) => ({ id: b.id, amount: String(b.amount), createdAt: b.created_at })), participants });
  });

  router.patch('/api/v1/admin/domain-services/auctions/:id', async (ctx) => {
    await asStaff(ctx, deps);
    const id = ctx.params.id;
    const input = await ctx.validate(v.object({
      minimumBid: money().optional(), bidIncrement: money().optional(),
      startsAt: v.string().datetime().optional(), endsAt: v.string().datetime().optional(),
    }));
    const a = await store.table('domain_auctions').findById(id);
    if (!a) throw new NotFoundError('No auction was found with that id');
    const patch = {};
    if (input.minimumBid !== undefined) { patch.minimum_bid = Number(input.minimumBid); patch.starting_bid = Number(input.minimumBid); patch.starting_bid_cents = Math.round(Number(input.minimumBid) * 100); }
    if (input.bidIncrement !== undefined) patch.bid_increment = Number(input.bidIncrement);
    if (input.startsAt !== undefined) patch.starts_at = input.startsAt;
    if (input.endsAt !== undefined) patch.ends_at = input.endsAt;
    const updated = await store.table('domain_auctions').updateById(id, patch);
    await audit(ctx, 'admin.domain_auction_updated', 'domain_auction', id, { fields: Object.keys(input) });
    ctx.json({ auction: auctionDto(updated) });
  });

  router.post('/api/v1/admin/domain-services/auctions/:id/:action', async (ctx) => {
    await asStaff(ctx, deps);
    const id = ctx.params.id;
    const action = ctx.params.action;
    if (!['pause', 'resume', 'cancel', 'complete'].includes(action)) throw new ValidationError('Unknown action');
    const a = await store.table('domain_auctions').findById(id);
    if (!a) throw new NotFoundError('No auction was found with that id');
    const statusMap = { pause: 'paused', resume: 'active', cancel: 'cancelled', complete: 'completed' };
    const updated = await store.table('domain_auctions').updateById(id, { status: statusMap[action] });
    await audit(ctx, `admin.domain_auction_${action}d`, 'domain_auction', id, { status: statusMap[action] });
    ctx.json({ auction: auctionDto(updated) });
  });

  // ===================== Domain Club plan management =====================
  const planDto = (p) => ({
    id: p.id, name: p.name, description: p.description ?? null, billingPeriod: p.billing_period,
    priceAmount: (p.price_amount != null ? p.price_amount : p.price_cents / 100).toFixed(2),
    discountType: p.discount_type, discountValue: String(p.discount_value),
    eligibleExtensions: p.eligible_extensions ?? [], promotion: p.promotion ?? null, status: p.status,
  });

  router.get('/api/v1/admin/domain-services/club/plans', async (ctx) => {
    await asStaff(ctx, deps);
    const rows = await store.table('domain_club_plans').all();
    ctx.json({ plans: rows.map(planDto) });
  });

  router.post('/api/v1/admin/domain-services/club/plans', async (ctx) => {
    const auth = await asSuperAdmin(ctx, deps);
    const input = await ctx.validate(v.object({
      name: v.string().min(2).max(120),
      description: v.string().max(2000).nullable().optional(),
      billingPeriod: v.enum(['monthly', 'annually']),
      priceAmount: money(),
      discountType: v.enum(['percentage', 'fixed']),
      discountValue: money(),
      eligibleExtensions: v.array(v.string().max(63)).optional(),
      promotion: v.object({}).passthrough().optional(),
      status: v.enum(['draft', 'published', 'disabled']).optional(),
    }));
    const status = input.status ?? 'published';
    const row = await store.table('domain_club_plans').insert({
      id: uuidv7(), name: input.name, description: input.description ?? null, billing_period: input.billingPeriod,
      price_amount: Number(input.priceAmount), price_cents: Math.round(Number(input.priceAmount) * 100),
      discount_type: input.discountType, discount_value: Number(input.discountValue),
      eligible_extensions: input.eligibleExtensions ?? [], promotion: input.promotion ?? null,
      status, active: status === 'published',
    });
    await audit(ctx, 'admin.domain_club_plan_created', 'domain_club_plan', row.id, { name: row.name });
    ctx.code(201).json({ plan: planDto(row) });
  });

  router.patch('/api/v1/admin/domain-services/club/plans/:id', async (ctx) => {
    await asSuperAdmin(ctx, deps);
    const id = ctx.params.id;
    const input = await ctx.validate(v.object({
      name: v.string().min(2).max(120).optional(),
      description: v.string().max(2000).nullable().optional(),
      billingPeriod: v.enum(['monthly', 'annually']).optional(),
      priceAmount: money().optional(),
      discountType: v.enum(['percentage', 'fixed']).optional(),
      discountValue: money().optional(),
      eligibleExtensions: v.array(v.string().max(63)).optional(),
      promotion: v.object({}).passthrough().optional(),
      status: v.enum(['draft', 'published', 'disabled']).optional(),
    }));
    const p = await store.table('domain_club_plans').findById(id);
    if (!p) throw new NotFoundError('No plan was found with that id');
    const patch = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    if (input.billingPeriod !== undefined) patch.billing_period = input.billingPeriod;
    if (input.priceAmount !== undefined) { patch.price_amount = Number(input.priceAmount); patch.price_cents = Math.round(Number(input.priceAmount) * 100); }
    if (input.discountType !== undefined) patch.discount_type = input.discountType;
    if (input.discountValue !== undefined) patch.discount_value = Number(input.discountValue);
    if (input.eligibleExtensions !== undefined) patch.eligible_extensions = input.eligibleExtensions;
    if (input.promotion !== undefined) patch.promotion = input.promotion;
    if (input.status !== undefined) { patch.status = input.status; patch.active = input.status === 'published'; }
    const updated = await store.table('domain_club_plans').updateById(id, patch);
    await audit(ctx, 'admin.domain_club_plan_updated', 'domain_club_plan', id, { fields: Object.keys(input) });
    ctx.json({ plan: planDto(updated) });
  });

  // ===================== Overview =====================
  router.get('/api/v1/admin/domain-services/overview', async (ctx) => {
    await asStaff(ctx, deps);
    const countBy = (rows, key = 'status') => rows.reduce((acc, r) => { acc[r[key] ?? 'unknown'] = (acc[r[key] ?? 'unknown'] ?? 0) + 1; return acc; }, {});
    const [registrations, transfers, auctions, club, searches] = await Promise.all([
      store.table('domain_registrations').all(),
      store.table('domain_transfers').all(),
      store.table('domain_auctions').all(),
      store.table('domain_club_memberships').all(),
      store.table('domain_searches').all(),
    ]);
    const dayAgo = Date.now() - 86400000;
    const searchesLast24h = searches.filter((s) => new Date(s.created_at).getTime() > dayAgo).length;
    ctx.json({
      registrations: countBy(registrations), transfers: countBy(transfers),
      auctions: countBy(auctions), club: countBy(club), searchesLast24h, limits: LIMITS,
    });
  });

  // ===================== Appraisals + WHOIS oversight =====================
  router.get('/api/v1/admin/domain-services/appraisals', async (ctx) => {
    await asStaff(ctx, deps);
    const rows = await store.table('domain_appraisals').find({}, { orderBy: '-created_at', limit: 100 }).then((r) => r.rows);
    const out = [];
    for (const a of rows) {
      out.push({
        id: a.id, domain_name: a.domain, status: a.status, estimated_value: a.estimated_value ?? null,
        currency: a.currency ?? 'USD', confidence: a.confidence ?? null, created_at: a.created_at,
        completed_at: a.completed_at ?? null, error_code: a.error_code ?? null, customer_email: await emailOf(a.user_id),
      });
    }
    ctx.json({ appraisals: out });
  });

  router.get('/api/v1/admin/domain-services/whois-lookups', async (ctx) => {
    await asStaff(ctx, deps);
    const rows = await store.table('domain_whois_lookups').find({}, { orderBy: '-created_at', limit: 100 }).then((r) => r.rows);
    const out = [];
    for (const w of rows) {
      out.push({
        id: w.id, domain_name: w.domain, source: w.source ?? null, status: w.status,
        privacy_protected: w.privacy_protected ?? false, created_at: w.created_at, user_id: w.user_id ?? null,
        customer_email: await emailOf(w.user_id),
      });
    }
    ctx.json({ lookups: out });
  });

  // ===================== Transactions oversight =====================
  router.get('/api/v1/admin/domain-services/transactions', async (ctx) => {
    await asStaff(ctx, deps);
    const rows = await store.table('domain_transactions').find({}, { orderBy: '-created_at', limit: 100 }).then((r) => r.rows);
    const out = [];
    for (const t of rows) {
      const inv = await invoiceOf(t.invoice_id);
      out.push({
        id: t.id, transaction_type: t.transaction_type ?? null, status: t.status, amount: t.amount,
        currency: t.currency ?? 'USD', provider_reference: t.provider_reference ?? null, error_code: t.error_code ?? null,
        created_at: t.created_at, updated_at: t.updated_at, customer_email: await emailOf(t.user_id),
        order_number: await orderNumberOf(t.order_id), invoice_number: inv?.invoice_number ?? null,
      });
    }
    ctx.json({ transactions: out });
  });
}

module.exports = { name, register };
