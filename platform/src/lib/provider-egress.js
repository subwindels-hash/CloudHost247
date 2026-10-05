/**
 * The seam between the domain layer and the ported provider adapters.
 *
 * `lib/providers/` implements real egress for all twelve adapter kinds, and until this module
 * existed nothing in `domains/` called it: every route answered from local rows and described the
 * provider side as "deferred". This is the only place a domain may construct an adapter, and it
 * enforces the three rules that make a provider call safe to run inside a request:
 *
 *  1. **Fail closed before egress.** A provider whose credentials, base URL or adapter
 *     implementation are missing is refused with the *variable names* that are missing — never a
 *     value, and never a call that can only fail at the provider.
 *  2. **Never fake a result.** A provider failure is reported as a failure. `runProviderDiagnostics`
 *     returns the honest verdict instead of throwing, so an operator asking "does this provider
 *     work?" gets an answer rather than a 502.
 *  3. **The provider's own message never reaches the browser.** Provider error text can name
 *     internal endpoints and account details, so it is logged server-side and the response carries
 *     only the stable failure code plus a neutral sentence — the same split
 *     `providers/error-mapping.js` already applies to customer-facing routes.
 *
 * What is still true of this build: no call has been made to a real provider account from the
 * environment it was developed in, so provider-side acceptance of these requests is unverified.
 * The wire contracts themselves are covered by `tests/provider-adapters.test.js` over real loopback
 * HTTP, and this seam by `tests/infrastructure-provider-egress.test.js`.
 */
'use strict';

const { ValidationError } = require('../core/errors');
const { ProviderError } = require('./providers/types');
const { createInfrastructureProviderAdapter } = require('./providers/registry');
const { providerErrorToHttpError, CUSTOMER_MESSAGES } = require('./providers/error-mapping');
const { describeProviderConfiguration } = require('./provider-adapters');
// Reused rather than re-implemented, so the capability gate cannot drift from the adapter.
const { replacementEnabled } = require('./providers/adapters/aws-replacement');

/** Neutral sentence for a failure code the customer-facing table does not name. */
const FALLBACK_MESSAGE = 'The infrastructure provider could not complete this request.';

/**
 * The one sentence it is safe to show for a provider failure. Deliberately derived from the code
 * and not from `error.message`: the provider's own text is untrusted and may leak internals.
 */
function customerMessage(code) {
  return CUSTOMER_MESSAGES[code] ?? FALLBACK_MESSAGE;
}

/**
 * Configuration readiness for one provider row, using the deployment's resolved config as the
 * credential source rather than `process.env` directly, so an operator's env override is what
 * decides readiness.
 */
function describeProvider(provider, config) {
  return describeProviderConfiguration(provider, config ?? process.env);
}

/**
 * Refuse before egress when the provider cannot possibly answer. Throws a 400 naming the missing
 * variables — the same refusal the provider-activation route already makes, so an operator sees the
 * identical reason from both places.
 */
function assertProviderReady(provider, config) {
  const description = describeProvider(provider, config);
  if (!description.ready) {
    throw new ValidationError(
      `The ${description.label} provider cannot be contacted: ${description.missing.join(', ')}`,
    );
  }
  return description;
}

/**
 * Build the adapter for a provider row. Throws `ValidationError` (never a provider call) when the
 * provider is not ready, so a half-configured row can never produce a request whose failure would
 * look like a provider outage.
 */
function resolveProviderAdapter(provider, options = {}) {
  const description = assertProviderReady(provider, options.config);
  const adapter = createInfrastructureProviderAdapter(provider, {
    source: options.config ?? process.env,
    transport: options.transport,
  });
  return { adapter, description };
}

/**
 * Run one provider call inside a request and translate its failure into the platform's HTTP
 * vocabulary. Use this where a failure must stop the route (image verification, reconciliation);
 * use `runProviderDiagnostics` where the failure *is* the answer.
 */
async function callProvider(provider, options, method, ...args) {
  const { adapter } = resolveProviderAdapter(provider, options);
  try {
    return await adapter[method](...args);
  } catch (error) {
    throw providerErrorToHttpError(error);
  }
}

/**
 * Ask a provider whether it is actually reachable and accepting our credentials.
 *
 * Returns a verdict rather than throwing, because the whole point of the route that calls this is to
 * report the truth about a provider. The verdict carries the stable code, whether a retry could
 * help, and how long the call took; it never carries the provider's raw message or any credential.
 * The real message is logged server-side for the operator who needs it.
 */
async function runProviderDiagnostics(provider, options = {}) {
  const checkedAt = new Date().toISOString();
  const started = Date.now();
  const finish = (verdict) => ({ ...verdict, checkedAt, latencyMs: Date.now() - started });

  let adapter;
  let description;
  try {
    ({ adapter, description } = resolveProviderAdapter(provider, options));
  } catch (error) {
    // Not ready: no request was made, so this is a configuration answer, not an outage.
    const message = error instanceof ValidationError ? error.message : FALLBACK_MESSAGE;
    return finish({
      ok: false, attempted: false, code: 'CONFIGURATION_REQUIRED', retryable: false,
      message, adapter: provider.adapter ?? provider.config?.adapter ?? null,
    });
  }

  try {
    await adapter.validateConfiguration();
    return finish({
      ok: true, attempted: true, code: null, retryable: false,
      message: `The ${description.label} provider accepted the request.`,
      adapter: description.adapter,
    });
  } catch (error) {
    const code = error instanceof ProviderError ? error.code : 'PROVIDER_ERROR';
    const retryable = error instanceof ProviderError ? Boolean(error.retryable) : false;
    options.logger?.warn(
      { providerId: provider.id, adapter: description.adapter, code, retryable, reason: error.message },
      'provider diagnostics failed',
    );
    return finish({
      ok: false, attempted: true, code, retryable,
      message: customerMessage(code),
      adapter: description.adapter,
    });
  }
}

/**
 * The provider-side identifier a server row carries, if it has one.
 *
 * There is no `servers.provider_server_id` column: the id is written into metadata by whichever
 * path provisioned the machine, and several names are in use across the builds this platform was
 * ported from. Returning `null` means "this platform has no provider handle for that server", which
 * callers must report honestly instead of inferring a state.
 */
function providerServerIdOf(server) {
  const metadata = server?.metadata ?? {};
  const direct = metadata.providerServerId ?? metadata.provider_server_id
    ?? server?.provider_server_id ?? null;
  if (direct !== null && direct !== undefined && direct !== '') return String(direct);
  return null;
}

/**
 * The provider that owns a server's region — whether or not this platform holds a provider handle
 * for the machine yet. Provisioning needs this before the server exists on the provider's side.
 */
async function resolveOwningProvider(store, server, config) {
  if (!server.region_id) {
    return { provider: null, region: null, reason: 'That server is not assigned to a region, so the provider that owns it is unknown' };
  }
  const region = await store.table('regions').findById(server.region_id);
  const provider = region ? await store.table('infra_providers').findById(region.provider_id) : null;
  if (!provider) {
    return { provider: null, region: region ?? null, reason: 'The region that server belongs to has no provider record' };
  }
  return { provider, region, description: describeProvider(provider, config), reason: null };
}

/**
 * The provider that owns a server, plus the handle to talk to it about.
 *
 * Returns a reason whenever it cannot answer, because every caller has to tell an operator or a
 * customer *why* an action is impossible rather than failing with a bare "not found".
 */
async function resolveServerProvider(store, server, config) {
  const providerServerId = providerServerIdOf(server);
  if (!providerServerId) {
    return {
      provider: null, providerServerId: null,
      reason: 'This platform holds no provider record for that server, so no provider action can be sent to it',
    };
  }
  const owning = await resolveOwningProvider(store, server, config);
  if (!owning.provider) {
    return { provider: null, providerServerId, reason: owning.reason };
  }
  return {
    provider: owning.provider, providerServerId, region: owning.region,
    description: owning.description, reason: null,
  };
}

/**
 * The capabilities an adapter will actually honour for this deployment.
 *
 * `describeProviderConfiguration` returns the profile's documented defaults, which are correct for
 * every kind except one: AWS `reinstall` is deployment-scoped, enabled by
 * `<PREFIX>_ALLOW_ROOT_VOLUME_REPLACEMENT`. Re-implementing that rule here would let this gate drift
 * away from the adapter — exactly how a capability flag stops being trustworthy — so it reuses the
 * adapter's own `replacementEnabled` predicate instead.
 */
function effectiveCapabilities(description, config) {
  const capabilities = { ...(description.capabilities ?? {}) };
  if (description.adapter === 'aws' && capabilities.reinstall === false) {
    if (replacementEnabled(config ?? process.env, description.envPrefix || 'AWS')) capabilities.reinstall = true;
  }
  return capabilities;
}

/**
 * Refuse a queued action the provider will never perform.
 *
 * Without this, a customer on a provider that documents no rescue system gets a `202` and a job that
 * can only fail, and a server row left in the state the refused action would have set. The refusal
 * is a 400 naming the provider and the capability; it is thrown before any state is written.
 */
function assertCapabilitySupported(provider, config, capability) {
  const description = describeProvider(provider, config);
  const capabilities = effectiveCapabilities(description, config);
  if (capabilities[capability] === false) {
    throw new ValidationError(
      `The ${description.label} provider does not offer ${capability} for this server through its API`,
    );
  }
  return capabilities;
}

/**
 * The fields a console session may carry, as an explicit whitelist.
 *
 * Adapters return provider-shaped records — Hetzner hands back a raw action record with `wss_url`
 * and a one-time `password`, Vultr a `{url, type}` pair, EC2 a generated `privateKey`. A whitelist
 * means a future adapter cannot add a field and have it reach a browser unnoticed, and it is what
 * keeps `consoleSessionEvidence` below safe to audit.
 */
const CONSOLE_SESSION_FIELDS = Object.freeze([
  'type', 'url', 'username', 'password', 'privateKey', 'expiresAt', 'notes',
]);

/** Normalize any adapter's console record into one shape for the customer. */
function normalizeConsoleSession(session) {
  const record = session && typeof session === 'object' ? session : {};
  const url = typeof record.url === 'string' ? record.url
    : (typeof record.wss_url === 'string' ? record.wss_url : null);
  const out = { type: record.type ?? (url ? 'web-console' : 'provider-session') };
  if (url) out.url = url;
  for (const field of CONSOLE_SESSION_FIELDS) {
    if (field === 'type' || field === 'url') continue;
    if (typeof record[field] === 'string' && record[field].length > 0) out[field] = record[field];
  }
  return out;
}

/**
 * What may be written to an audit log about a console session: the shape of it, never its contents.
 *
 * A console session is an interactive login to a customer's own machine, and the EC2 one carries a
 * private key that exists nowhere else. Recording the fact that a session was issued — and what kind
 * — is what an operator needs; recording the key would put a live credential in a table every staff
 * account can read.
 */
function consoleSessionEvidence(session) {
  return {
    type: session?.type ?? null,
    hasUrl: Boolean(session?.url),
    credentialKind: session?.privateKey ? 'private-key' : (session?.password ? 'one-time-password' : null),
  };
}

module.exports = {
  customerMessage,
  describeProvider,
  assertProviderReady,
  resolveProviderAdapter,
  callProvider,
  runProviderDiagnostics,
  providerServerIdOf,
  resolveServerProvider,
  resolveOwningProvider,
  effectiveCapabilities,
  assertCapabilitySupported,
  normalizeConsoleSession,
  consoleSessionEvidence,
  CONSOLE_SESSION_FIELDS,
};
