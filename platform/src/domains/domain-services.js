/**
 * Domain Services — search, registration, transfer, WHOIS, appraisal, auctions, the Discount
 * Domain Club, availability watches and transactions.
 *
 * Ported from cloudhost247-node/src/routes/domain-services.ts.
 *
 * **What changed here (2026-10-08).** This module used to answer an availability search with a
 * regular expression over the domain name — `/google|facebook/` meant "taken", everything else meant
 * "available" — and labelled the result an `estimate`. A guessed answer presented as a lookup is
 * worse than a refusal, because the customer acts on it. Search and WHOIS now resolve the
 * authoritative registry through the ported RDAP connector and report only what it returned:
 *
 *   - the registry holds a record  → `registered`, definitive;
 *   - the registry answers 404     → `available`, *labelled as evidence* (`confidence: 'indicative'`),
 *     because a name with no registry record can still be premium, reserved or policy-blocked, and
 *     only a registrar account can price it;
 *   - nothing could be established → `available: null` with the failure code, never a boolean.
 *
 * A deployment with no connected provider is not broken by this: it refuses with
 * `provider_not_configured` and names the admin screen that fixes it, which is the honest answer.
 * Registrations and transfers are still recorded and queued — there is no registrar adapter in this
 * build yet (see `lib/domain-providers/register-builtins.js`), so they are accepted as *requests*
 * and never reported as completed. Ownership rule: "exists but isn't yours" is a 404, never a 403.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError, ValidationError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { authenticate } = require('../lib/auth');
const {
  domainProviderReadiness,
  resolveConnectedDomainProvider,
  assertCapabilitySupported,
  domainFailure,
} = require('../lib/domain-provider-service');
const { lookupAvailability } = require('../lib/domain-availability');
const { DomainProviderError, CUSTOMER_MESSAGES, FALLBACK_MESSAGE } = require('../lib/domain-providers/types');
const { isValidDomainName, normalizeDomainName } = require('../lib/domain-name');

/** Shown with every stored valuation, so no number can be read as an offer or a guarantee. */
const APPRAISAL_DISCLAIMER = 'This valuation is produced by an automated third-party model. It is not a guaranteed selling price, an offer, or an appraisal for legal, tax, or lending purposes.';

const name = 'domain-services';

// One definition of "a domain name", shared with the provider adapters: at least two labels, IDN
// normalised to punycode. The regex this replaced accepted a single label, so a bulk search would
// look up the word `domain` and a customer could "search" for something no registry can answer.
const domainName = () => v.string().trim().min(1).max(253).refine(
  (value) => isValidDomainName(value),
  'must be a domain name with a TLD, e.g. example.com',
);
const money = () => v.coerce.number().min(0);

const TRANSFER_LABELS = { pending: 'Pending', awaiting_auth: 'Awaiting authorization', in_progress: 'In progress', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled' };

/** The variants a search offers alongside the literal term, exactly as the audited original does. */
const SEARCH_VARIANTS = [
  (term) => term,
  (term) => `get${term}`,
  (term) => `try${term}`,
];

/**
 * Turn one provider fact into the customer-facing availability row.
 *
 * The distinction that matters is between a *fact* and a *guess*: `registered` is what a provider
 * says, a registrar's `available` is what the seller says (with the price it quoted), the registry's
 * `no_registry_record` is public evidence that nothing is registered, and `unknown` is the platform
 * admitting it has no answer. There is no fifth case, and none of them is invented.
 *
 * Rows carry where the answer came from (`source`), because a registrar's offer and a registry's
 * record are not the same claim, and carry it at the *confidence it deserves*: a registrar that
 * answers definitively has settled the question, while a registry with no record — or a registrar
 * that told us its answer is not definitive — has not.
 */
function availabilityRow(domain, presence) {
  const source = presence.source === 'registrar' ? 'registrar' : presence.source === 'rdap' ? 'rdap' : null;

  if (presence.status === 'registered') {
    return {
      domain,
      status: 'registered',
      available: false,
      confidence: 'confirmed',
      source,
      reason: null,
      registryStatuses: presence.registryStatuses ?? [],
    };
  }

  if (presence.status === 'available') {
    // The registrar answered the question it sells the answer to.
    return {
      domain,
      status: 'available',
      available: true,
      // `confirmed` only when the registrar said its answer is definitive. GoDaddy's FAST check can
      // answer optimistically, and that is carried through rather than smoothed over.
      confidence: presence.definitive === false ? 'indicative' : 'confirmed',
      source,
      reason: null,
      ...(presence.premium ? { premium: true } : {}),
      // The registrar's quote, under a name that cannot be mistaken for this platform's selling price.
      ...(presence.providerQuote ? { providerQuote: presence.providerQuote } : {}),
      ...(presence.checkedAt ? { checkedAt: presence.checkedAt } : {}),
      ...(presence.definitive === false
        ? { caveat: 'The registrar answered without a definitive check. Final availability is confirmed at registration.' }
        : {}),
    };
  }

  if (presence.status === 'no_registry_record') {
    return {
      domain,
      status: 'available',
      available: true,
      // Deliberately not `confirmed`: the registry has no record, but registrability and price are
      // settled by a registrar at checkout, not by this lookup.
      confidence: 'indicative',
      source: 'rdap',
      reason: 'NO_REGISTRY_RECORD',
      caveat: 'No registry record exists for this name. Final availability and pricing are confirmed at registration.',
    };
  }

  return {
    domain,
    status: 'unknown',
    available: null,
    confidence: null,
    // The source is honoured, never defaulted: a row says 'rdap' only when the registry answered,
    // 'registrar' when the registrar did, and `null` when nobody did. (`NO_RDAP_SERVICE_FOR_TLD`
    // means there is no registry to ask for this TLD at all, so nothing is named there either.)
    source: presence.reason === 'NO_RDAP_SERVICE_FOR_TLD' ? null : source,
    reason: presence.reason ?? 'PROVIDER_ERROR',
  };
}

/**
 * How the stored search should be labelled, and why.
 *
 * `completed` means the provider answered. A search where *no* name could be answered is stored as
 * `provider_error` with the reason, even though the route returned 200 — the customer's history must
 * not read as a successful lookup that happened to find nothing. A name in a TLD with no RDAP
 * service is a data fact rather than a provider fault, so it does not by itself mark a search failed.
 */
function searchOutcome(rows, failure) {
  if (failure) return { status: 'provider_error', errorCode: failure.code, errorMessage: failure.message };
  const unresolved = rows.filter((row) => row.status === 'unknown');
  const providerFault = unresolved.find((row) => row.reason && row.reason !== 'NO_RDAP_SERVICE_FOR_TLD');
  if (unresolved.length === rows.length && providerFault) {
    // The sentence is looked up by code, never built from the provider's own text.
    return {
      status: 'provider_error',
      errorCode: providerFault.reason,
      errorMessage: CUSTOMER_MESSAGES[providerFault.reason] ?? FALLBACK_MESSAGE,
    };
  }
  return { status: 'completed', errorCode: null, errorMessage: null };
}

/** One search response body. `available: null` rows are counted so the UI can say so plainly. */
function searchPayload(rows, extra = {}) {
  return {
    status: 'live',
    estimate: false,
    results: rows,
    counts: {
      total: rows.length,
      registered: rows.filter((row) => row.status === 'registered').length,
      available: rows.filter((row) => row.status === 'available').length,
      unknown: rows.filter((row) => row.status === 'unknown').length,
    },
    ...extra,
  };
}

function register(router, deps) {
  const { store } = deps;

  async function queue(userId, kind, resourceType, resourceId, payload) {
    return store.table('provisioning_jobs').insert({ id: uuidv7(), user_id: userId, kind, resource_type: resourceType, resource_id: resourceId, status: 'queued', payload: payload ?? {} });
  }

  // ---- readiness (public) -------------------------------------------------
  /**
   * What this deployment can actually do, from the provider rows an operator created and the
   * adapters this build compiles — no hardcoded `false` block, and no claim of a capability that no
   * row can serve.
   */
  router.get('/api/v1/domain-services/readiness', async (ctx) => {
    const readiness = await domainProviderReadiness(store, { secret: deps.config?.JWT_SECRET || 'ephemeral' });
    ctx.json({
      registrar: { configured: readiness.registrar.configured, providerKey: readiness.registrar.providerKey },
      rdap: { configured: readiness.rdap.configured, providerKey: readiness.rdap.providerKey },
      appraisal: { configured: readiness.appraisal.configured, providerKey: readiness.appraisal.providerKey },
      auctions: { configured: true }, // internal marketplace, always operational
      installedAdapters: readiness.installedAdapters,
      credentialStates: {
        rdap: readiness.rdap.credentialState,
        registrar: readiness.registrar.credentialState,
        appraisal: readiness.appraisal.credentialState,
      },
    });
  });

  // ---- search / bulk-search / history -------------------------------------
  router.post('/api/v1/domain-services/search', async (ctx) => {
    const input = await ctx.validate(v.object({ query: domainName() }));
    let userId = null;
    try { userId = (await authenticate(ctx, { ...deps, allowMissing: true }))?.id ?? null; } catch { userId = null; }

    const term = normalizeDomainName(input.query);
    const candidates = SEARCH_VARIANTS.map((variant) => variant(term));
    const searchId = uuidv7();

    // A connected registrar answers authoritatively (and quotes a price); without one, the registry
    // lookup of module 2 answers. Either way the row says which of the two spoke.
    const lookup = await lookupAvailability(store, {
      secret: deps.config?.JWT_SECRET || 'ephemeral', names: candidates, logger: deps.logger,
    });
    const provider = lookup.provider;
    const failure = lookup.failure;
    const rows = candidates.map((domain, index) => availabilityRow(
      domain,
      lookup.presences[index] ?? { status: 'unknown', reason: 'PROVIDER_ERROR', source: lookup.source },
    ));

    const outcome = searchOutcome(rows, failure);
    if (userId) {
      await store.table('domain_searches').insert({
        id: searchId, user_id: userId, query: term, results: rows, kind: 'single',
        provider_id: provider?.id ?? null, status: outcome.status, error_code: outcome.errorCode,
        error_message: outcome.errorMessage, completed_at: new Date().toISOString(),
      });
    }

    ctx.json({
      ...searchPayload(rows, {
        searchId: userId ? searchId : null,
        query: term,
        providerKey: provider?.provider_key ?? null,
        answerSource: lookup.source,
        message: failure?.message ?? null,
      }),
      ...(failure ? { status: 'provider_unavailable', failure } : {}),
    });
  });

  router.post('/api/v1/domain-services/bulk-search', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const input = await ctx.validate(v.object({ content: v.string().min(1).max(100000), sourceType: v.enum(['text', 'csv', 'txt']).default('text') }));
    const tokens = input.content.split(/[\s,;]+/).map((t) => t.trim().toLowerCase()).filter(Boolean);
    const valid = tokens.filter((t) => isValidDomainName(t));
    const terms = valid.slice(0, 500);
    const rejectedCount = tokens.length - valid.length;
    const searchId = uuidv7();

    // Same evidence order as the single search, over a larger batch. Both adapters bound their own
    // request concurrency and batch size, and one unanswered name never discards the rest.
    const lookup = await lookupAvailability(store, {
      secret: deps.config?.JWT_SECRET || 'ephemeral', names: terms, logger: deps.logger,
    });
    const provider = lookup.provider;
    const failure = lookup.failure;
    const rows = terms.map((domain, index) => availabilityRow(
      domain,
      lookup.presences[index] ?? { status: 'unknown', reason: 'PROVIDER_ERROR', source: lookup.source },
    ));

    const outcome = searchOutcome(rows, failure);
    await store.table('domain_searches').insert({
      id: searchId, user_id: auth.id, query: `${terms.length} terms`, results: rows, kind: 'bulk',
      provider_id: provider?.id ?? null, status: outcome.status, error_code: outcome.errorCode,
      error_message: outcome.errorMessage, completed_at: new Date().toISOString(),
    });
    ctx.json({
      ...searchPayload(rows, {
        searchId,
        acceptedCount: terms.length,
        rejectedCount,
        providerKey: provider?.provider_key ?? null,
        answerSource: lookup.source,
        message: failure?.message ?? null,
      }),
      ...(failure ? { status: 'provider_unavailable', failure } : {}),
    });
  });

  router.get('/api/v1/domain-services/searches', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const rows = (await store.table('domain_searches').all()).filter((s) => s.user_id === auth.id && s.kind !== 'bulk');
    ctx.json({ searches: rows.map((s) => ({ id: s.id, query: s.query, createdAt: s.created_at })) });
  });

  router.get('/api/v1/domain-services/searches/bulk', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const rows = (await store.table('domain_searches').all()).filter((s) => s.user_id === auth.id && s.kind === 'bulk');
    ctx.json({ searches: rows.map((s) => ({ id: s.id, query: s.query, createdAt: s.created_at })) });
  });

  router.get('/api/v1/domain-services/searches/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const row = await store.table('domain_searches').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!row) throw new NotFoundError('No search was found with that id');
    ctx.json({ results: row.results ?? [] });
  });

  // ---- extensions directory (public) --------------------------------------
  router.get('/api/v1/domain-services/extensions', async (ctx) => {
    const query = await ctx.validateQuery(v.object({ search: v.string().optional() }));
    let rows = await store.table('domain_extensions').all();
    if (query.search) rows = rows.filter((e) => e.tld.includes(query.search.toLowerCase()));
    ctx.json({ extensions: rows.map((e) => ({ tld: e.tld, registerPriceCents: e.register_price_cents, renewPriceCents: e.renew_price_cents })) });
  });

  // ---- registration -------------------------------------------------------
  router.post('/api/v1/domain-services/registrations/quote', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const input = await ctx.validate(v.object({ domainName: domainName(), years: v.coerce.number().int().min(1).max(10).default(1) }));
    const tld = input.domainName.split('.').pop();
    const ext = (await store.table('domain_extensions').all()).find((e) => e.tld === tld);
    const perYear = ext ? ext.register_price_cents / 100 : 9.99;
    ctx.json({ quote: { domainName: input.domainName, years: input.years, currency: 'USD', total: Math.round(perYear * input.years * 100) / 100, estimate: !ext } });
  });

  router.post('/api/v1/domain-services/registrations', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const input = await ctx.validate(v.object({
      domainName: domainName(),
      years: v.coerce.number().int().min(1).max(10).default(1),
      contact: v.object({}).passthrough(),
    }));
    const id = uuidv7();
    await store.table('domain_registrations').insert({ id, user_id: auth.id, domain: input.domainName.toLowerCase(), domain_name: input.domainName.toLowerCase(), years: input.years, status: 'pending' });
    await queue(auth.id, 'register_domain', 'domain_registrations', id, { domainName: input.domainName, years: input.years });
    ctx.code(201).json({ registrationId: id, status: 'pending' });
  });

  router.get('/api/v1/domain-services/registrations', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const rows = (await store.table('domain_registrations').all()).filter((r) => r.user_id === auth.id);
    ctx.json({ registrations: rows.map((r) => ({ id: r.id, domainName: r.domain, years: r.years, status: r.status, createdAt: r.created_at })) });
  });

  router.get('/api/v1/domain-services/registrations/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const row = await store.table('domain_registrations').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!row) throw new NotFoundError('No registration was found with that id');
    ctx.json({ registration: { id: row.id, domainName: row.domain, years: row.years, status: row.status, createdAt: row.created_at } });
  });

  // ---- transfer -----------------------------------------------------------
  router.post('/api/v1/domain-services/transfers', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const input = await ctx.validate(v.object({
      domainName: domainName(),
      currentRegistrar: v.string().max(255).optional(),
      authCode: v.string().min(4).max(128),
      authorizationConfirmed: v.boolean(),
      contact: v.object({}).passthrough().optional(),
    }));
    if (input.authorizationConfirmed !== true) throw new ValidationError('You must confirm authorization');
    const id = uuidv7();
    await store.table('domain_transfers').insert({ id, user_id: auth.id, domain: input.domainName.toLowerCase(), domain_name: input.domainName.toLowerCase(), auth_code: input.authCode, status: 'pending' });
    await queue(auth.id, 'transfer_domain', 'domain_transfers', id, { domainName: input.domainName });
    ctx.code(201).json({ transferId: id, status: 'pending', statusLabel: TRANSFER_LABELS.pending });
  });

  router.get('/api/v1/domain-services/transfers', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const rows = (await store.table('domain_transfers').all()).filter((t) => t.user_id === auth.id);
    ctx.json({ transfers: rows.map((t) => ({ id: t.id, domainName: t.domain, status: t.status, statusLabel: TRANSFER_LABELS[t.status] ?? t.status, createdAt: t.created_at })) });
  });

  router.get('/api/v1/domain-services/transfers/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const row = await store.table('domain_transfers').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!row) throw new NotFoundError('No transfer was found with that id');
    ctx.json({ transfer: { id: row.id, domainName: row.domain, status: row.status, statusLabel: TRANSFER_LABELS[row.status] ?? row.status } });
  });

  // ---- WHOIS / RDAP (live) ------------------------------------------------
  /**
   * A real RDAP owner lookup through the authoritative registry.
   *
   * Whatever happens, the lookup is recorded — a completed record, a `not_found`, or the reason it
   * could not be made — so the customer's history shows what actually occurred rather than a row
   * that says `provider_unavailable` forever. The stored projection is public data only: registrar,
   * dates, statuses, nameservers, registry. Registrant details are never requested; a
   * privacy-protected registration is reported as protected.
   */
  router.post('/api/v1/domain-services/whois', async (ctx) => {
    const input = await ctx.validate(v.object({ domainName: domainName() }));
    let userId = null;
    try { userId = (await authenticate(ctx, { ...deps, allowMissing: true }))?.id ?? null; } catch { userId = null; }
    const domain = normalizeDomainName(input.domainName);
    const id = uuidv7();
    const secret = deps.config?.JWT_SECRET || 'ephemeral';

    const record = (fields) => store.table('domain_whois_lookups').insert({ id, user_id: userId, domain, ...fields });

    let resolved;
    try {
      resolved = await resolveConnectedDomainProvider(store, 'rdap', { secret });
    } catch (error) {
      const failure = domainFailure(error);
      await record({ status: 'provider_not_configured', error_code: failure.code, error_message: failure.message });
      return ctx.json({ lookupId: id, domainName: domain, status: 'provider_not_configured', message: failure.message, failure });
    }

    try {
      const info = await resolved.adapter.getDomainInfo(domain);
      await record({
        provider_id: resolved.provider.id,
        provider_reference: info.providerReference,
        status: 'completed',
        source: info.source,
        privacy_protected: info.privacyProtected === true,
        registrar: info.registrar,
        // The public projection. Never registrant data — the adapter has no field for it.
        raw: {
          createdAt: info.createdAt, updatedAt: info.updatedAt, expiresAt: info.expiresAt,
          statuses: info.statuses, nameservers: info.nameservers, registry: info.registry,
        },
        completed_at: new Date().toISOString(),
      });
      return ctx.json({
        lookupId: id,
        domainName: info.domainName,
        status: 'completed',
        source: info.source,
        result: {
          domainName: info.domainName,
          registrar: info.registrar,
          createdAt: info.createdAt,
          updatedAt: info.updatedAt,
          expiresAt: info.expiresAt,
          statuses: info.statuses,
          nameservers: info.nameservers,
          registry: info.registry,
          privacyProtected: info.privacyProtected,
          registrant: info.privacyProtected
            ? 'Registrant information is privacy protected or unavailable.'
            : 'Registrant details are not published by this registry.',
        },
      });
    } catch (error) {
      // A registry 404 is an answer, not a failure: there is no registration record.
      if (error instanceof DomainProviderError && error.code === 'NO_REGISTRY_RECORD') {
        await record({
          provider_id: resolved.provider.id, status: 'not_found', source: 'rdap',
          completed_at: new Date().toISOString(),
        });
        return ctx.json({
          lookupId: id, domainName: domain, status: 'not_found',
          message: `No registration record was found for ${domain}.`,
        });
      }

      const failure = domainFailure(error);
      await record({
        provider_id: resolved.provider.id,
        status: error?.code === 'RATE_LIMITED' ? 'rate_limited' : 'provider_error',
        error_code: failure.code,
        error_message: failure.message,
        completed_at: new Date().toISOString(),
      });
      deps.logger?.warn?.({ domain, failureCode: failure.code, reason: error?.message }, 'whois lookup failed');
      return ctx.json({
        lookupId: id, domainName: domain,
        status: error?.code === 'RATE_LIMITED' ? 'rate_limited' : 'provider_error',
        message: failure.message, failure,
      });
    }
  });

  router.get('/api/v1/domain-services/whois/history', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const rows = (await store.table('domain_whois_lookups').all()).filter((l) => l.user_id === auth.id);
    ctx.json({
      lookups: rows.map((l) => ({
        id: l.id, domain: l.domain, status: l.status, source: l.source ?? null,
        registrar: l.registrar ?? null, errorCode: l.error_code ?? null, createdAt: l.created_at,
      })),
    });
  });

  // ---- appraisal (live, provider-gated) -----------------------------------
  /**
   * A real appraisal from the connected appraisal provider — GoDaddy's GoValue API in this build.
   *
   * Two things this route will not do. It will not invent a valuation when no provider is
   * configured or the provider fails: it records the reason and returns it. And it will not
   * synthesise comparable sales, which is how a valuation becomes unfalsifiable — GoValue publishes
   * none, so the field is empty rather than populated with plausible-looking transactions.
   *
   * Difference from the audited Node build, recorded rather than hidden: there, an appraisal is a
   * paid service (`pending_payment`, its own order and invoice) unless the fee is switched off. This
   * port implements the fee-free path only. Gating it behind payment is a billing change, not a
   * provider change, and belongs with the billing module.
   */
  router.post('/api/v1/domain-services/appraisals', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const input = await ctx.validate(v.object({ domainName: domainName() }));
    const domain = normalizeDomainName(input.domainName);
    const id = uuidv7();
    const secret = deps.config?.JWT_SECRET || 'ephemeral';

    let resolved;
    try {
      resolved = await resolveConnectedDomainProvider(store, 'appraisal', { secret });
    } catch (error) {
      const failure = domainFailure(error);
      await store.table('domain_appraisals').insert({
        id, user_id: auth.id, domain, status: 'provider_not_configured',
        error_code: failure.code, error_message: failure.message,
      });
      deps.logger?.warn?.({ domain, failureCode: failure.code }, 'appraisal refused: no provider');
      return ctx.code(503).json({ appraisalId: id, domainName: domain, status: 'provider_not_configured', message: failure.message, failure });
    }

    try {
      assertCapabilitySupported(resolved.adapter, 'appraisal');
      const result = await resolved.adapter.appraiseDomain(domain);
      const valuation = {
        keywords: result.keywords,
        brandability: result.brandability,
        comparableSales: result.comparableSales,
        factors: result.factors,
        disclaimer: APPRAISAL_DISCLAIMER,
      };
      await store.table('domain_appraisals').insert({
        id, user_id: auth.id, provider_id: resolved.provider.id,
        provider_reference: result.providerReference, domain, status: 'completed',
        estimated_value: Number(result.estimatedValue.amount), currency: result.estimatedValue.currency,
        confidence: result.confidence, valuation, provider: resolved.provider.provider_key,
        completed_at: new Date().toISOString(),
      });
      ctx.code(201).json({
        appraisalId: id, domainName: domain, status: 'completed',
        estimatedValue: result.estimatedValue, confidence: result.confidence,
        tld: result.tld, domainLength: result.domainLength,
        comparableSales: result.comparableSales, factors: result.factors,
        providerKey: resolved.provider.provider_key, disclaimer: APPRAISAL_DISCLAIMER,
      });
    } catch (error) {
      const failure = domainFailure(error);
      await store.table('domain_appraisals').insert({
        id, user_id: auth.id, provider_id: resolved.provider.id, domain, status: 'provider_error',
        error_code: failure.code, error_message: failure.message,
      });
      deps.logger?.warn?.({ domain, failureCode: failure.code, reason: error?.message }, 'appraisal failed');
      const status = failure.code === 'UNSUPPORTED_OPERATION' ? 400 : 503;
      ctx.code(status).json({ appraisalId: id, domainName: domain, status: 'provider_error', message: failure.message, failure });
    }
  });

  router.get('/api/v1/domain-services/appraisals', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const rows = (await store.table('domain_appraisals').all()).filter((a) => a.user_id === auth.id);
    ctx.json({
      appraisals: rows.map((a) => ({
        id: a.id, domain: a.domain, status: a.status, estimatedValue: a.estimated_value,
        currency: a.currency ?? null, confidence: a.confidence ?? null, errorCode: a.error_code ?? null,
        createdAt: a.created_at,
      })),
    });
  });

  router.get('/api/v1/domain-services/appraisals/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const row = await store.table('domain_appraisals').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!row) throw new NotFoundError('No appraisal was found with that id');
    ctx.json({
      appraisal: {
        id: row.id, domain: row.domain, status: row.status,
        estimatedValue: row.estimated_value, currency: row.currency ?? null,
        confidence: row.confidence ?? null, valuation: row.valuation ?? {},
        providerKey: row.provider ?? null, errorCode: row.error_code ?? null,
        completedAt: row.completed_at ?? null,
      },
    });
  });

  // ---- auctions -----------------------------------------------------------
  router.get('/api/v1/domain-services/auctions', async (ctx) => {
    const query = await ctx.validateQuery(v.object({ status: v.string().optional(), search: v.string().optional(), page: v.coerce.number().int().min(1).default(1), limit: v.coerce.number().int().min(1).max(100).default(20) }));
    let rows = await store.table('domain_auctions').all();
    if (query.status) rows = rows.filter((a) => a.status === query.status);
    if (query.search) rows = rows.filter((a) => (a.domain || '').includes(query.search.toLowerCase()));
    const start = (query.page - 1) * query.limit;
    ctx.json({ auctions: rows.slice(start, start + query.limit).map((a) => ({ id: a.id, domain: a.domain, status: a.status, currentBid: a.current_bid, endsAt: a.ends_at })), page: query.page, limit: query.limit });
  });

  router.get('/api/v1/domain-services/auctions/:id', async (ctx) => {
    const auction = await store.table('domain_auctions').findById(ctx.params.id);
    if (!auction) throw new NotFoundError('No auction was found with that id');
    const bids = (await store.table('domain_auction_bids').all()).filter((b) => b.auction_id === auction.id);
    ctx.json({ auction: { id: auction.id, domain: auction.domain, status: auction.status, currentBid: auction.current_bid, endsAt: auction.ends_at }, bids: bids.map((b) => ({ id: b.id, amount: b.amount, createdAt: b.created_at })) });
  });

  router.post('/api/v1/domain-services/auctions/:id/bids', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const auction = await store.table('domain_auctions').findById(ctx.params.id);
    if (!auction) throw new NotFoundError('No auction was found with that id');
    if (auction.status !== 'active') throw new ValidationError('Auction is not active');
    const input = await ctx.validate(v.object({ amount: money(), idempotencyKey: v.string().min(8).max(128).optional() }));
    if (input.amount <= Number(auction.current_bid ?? 0)) throw new ValidationError('Bid must exceed the current bid');
    const bidId = uuidv7();
    await store.table('domain_auction_bids').insert({ id: bidId, auction_id: auction.id, user_id: auth.id, amount: input.amount, amount_cents: Math.round(input.amount * 100) });
    await store.table('domain_auctions').updateById(auction.id, { current_bid: input.amount, current_bid_cents: Math.round(input.amount * 100) });
    ctx.code(201).json({ bidId, amount: input.amount });
  });

  router.get('/api/v1/domain-services/auctions/my/bids', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const rows = (await store.table('domain_auction_bids').all()).filter((b) => b.user_id === auth.id);
    ctx.json({ bids: rows.map((b) => ({ id: b.id, auctionId: b.auction_id, amount: b.amount, createdAt: b.created_at })) });
  });

  router.get('/api/v1/domain-services/auctions/my/won', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const auctions = (await store.table('domain_auctions').all()).filter((a) => a.status === 'won' && a.user_id === auth.id);
    ctx.json({ auctions: auctions.map((a) => ({ id: a.id, domain: a.domain, status: a.status })) });
  });

  router.get('/api/v1/domain-services/auctions/my/lost', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const auctions = (await store.table('domain_auctions').all()).filter((a) => a.status === 'lost' && a.user_id === auth.id);
    ctx.json({ auctions: auctions.map((a) => ({ id: a.id, domain: a.domain, status: a.status })) });
  });

  router.post('/api/v1/domain-services/auctions/:id/pay', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const auction = await store.table('domain_auctions').findById(ctx.params.id);
    if (!auction) throw new NotFoundError('No auction was found with that id');
    const orderId = uuidv7();
    await store.table('domain_transactions').insert({ id: uuidv7(), user_id: auth.id, transaction_type: 'auction_payment', status: 'pending', amount: auction.current_bid ?? 0, order_id: orderId });
    ctx.code(201).json({ orderId, amount: auction.current_bid ?? 0 });
  });

  // ---- Discount Domain Club -----------------------------------------------
  router.get('/api/v1/domain-services/club/plans', async (ctx) => {
    const rows = (await store.table('domain_club_plans').all()).filter((p) => p.active);
    ctx.json({ plans: rows.map((p) => ({ id: p.id, name: p.name, priceCents: p.price_cents, discountType: p.discount_type, discountValue: p.discount_value })) });
  });

  router.post('/api/v1/domain-services/club/plans/:id/subscribe', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const plan = await store.table('domain_club_plans').findById(ctx.params.id);
    if (!plan || !plan.active) throw new NotFoundError('No plan was found with that id');
    const membershipId = uuidv7();
    await store.table('domain_club_memberships').insert({ id: membershipId, user_id: auth.id, plan_id: plan.id, status: 'active' });
    ctx.code(201).json({ membershipId, orderId: null, planId: plan.id });
  });

  router.get('/api/v1/domain-services/club/membership', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const row = (await store.table('domain_club_memberships').all()).find((m) => m.user_id === auth.id && m.status === 'active');
    ctx.json({ membership: row ? { id: row.id, planId: row.plan_id, status: row.status, startedAt: row.started_at } : null });
  });

  router.delete('/api/v1/domain-services/club/membership', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const row = (await store.table('domain_club_memberships').all()).find((m) => m.user_id === auth.id && m.status === 'active');
    if (!row) throw new NotFoundError('No membership was found');
    await store.table('domain_club_memberships').updateById(row.id, { status: 'cancelled', cancelled_at: new Date().toISOString() });
    ctx.noContent();
  });

  router.get('/api/v1/domain-services/club/pricing-preview', async (ctx) => {
    const query = await ctx.validateQuery(v.object({ standardPrice: v.string().optional() }));
    const standard = query.standardPrice && /^\d{1,10}(\.\d{1,2})?$/.test(query.standardPrice) ? Number(query.standardPrice) : null;
    if (standard === null) throw new ValidationError('Provide standardPrice as a decimal amount, e.g. 20.00');
    let userId = null;
    try { userId = (await authenticate(ctx, { ...deps, allowMissing: true }))?.id ?? null; } catch { userId = null; }

    let discount = null;
    if (userId) {
      const membership = (await store.table('domain_club_memberships').all()).find((m) => m.user_id === userId && m.status === 'active');
      if (membership) {
        const plan = await store.table('domain_club_plans').findById(membership.plan_id);
        if (plan) discount = plan;
      }
    }
    if (!discount) {
      const plans = (await store.table('domain_club_plans').all()).filter((p) => p.active).sort((a, b) => a.price_cents - b.price_cents);
      discount = plans[0] ?? null;
    }
    if (!discount) return ctx.json({ standardPrice: standard.toFixed(2), memberPrice: standard.toFixed(2), savings: '0.00', clubName: null });

    const standardCents = Math.round(standard * 100);
    const discountCents = discount.discount_type === 'percentage'
      ? Math.round((standardCents * Number(discount.discount_value)) / 100)
      : Math.min(Math.round(Number(discount.discount_value) * 100), standardCents);
    ctx.json({
      standardPrice: standard.toFixed(2),
      memberPrice: ((standardCents - discountCents) / 100).toFixed(2),
      savings: (discountCents / 100).toFixed(2),
      clubName: discount.name,
    });
  });

  // ---- availability watches -----------------------------------------------
  router.post('/api/v1/domain-services/watches', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const input = await ctx.validate(v.object({ domainName: domainName() }));
    const existing = await store.table('domain_watches').findOne({ user_id: auth.id, domain: input.domainName.toLowerCase() });
    if (existing) return ctx.code(201).json({ watch: { id: existing.id, domainName: existing.domain, status: existing.status } });
    const id = uuidv7();
    await store.table('domain_watches').insert({ id, user_id: auth.id, domain: input.domainName.toLowerCase(), domain_name: input.domainName.toLowerCase(), status: 'active' });
    ctx.code(201).json({ watch: { id, domainName: input.domainName.toLowerCase(), status: 'active' } });
  });

  router.get('/api/v1/domain-services/watches', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const rows = (await store.table('domain_watches').all()).filter((w) => w.user_id === auth.id);
    ctx.json({ watches: rows.map((w) => ({ id: w.id, domainName: w.domain, status: w.status, createdAt: w.created_at })) });
  });

  router.delete('/api/v1/domain-services/watches/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const row = await store.table('domain_watches').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!row) throw new NotFoundError('No watch was found with that id');
    await store.table('domain_watches').deleteById(row.id);
    ctx.noContent();
  });

  // ---- transactions (read-only) -------------------------------------------
  router.get('/api/v1/domain-services/transactions', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const rows = (await store.table('domain_transactions').all()).filter((t) => t.user_id === auth.id);
    ctx.json({ transactions: rows.map((t) => ({ id: t.id, type: t.transaction_type, status: t.status, amount: t.amount, currency: t.currency, orderId: t.order_id, createdAt: t.created_at })) });
  });
}

module.exports = { name, register };
