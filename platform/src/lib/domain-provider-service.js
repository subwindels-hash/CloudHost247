/**
 * The seam between `domains/domain-services.js` and the ported domain-provider adapters.
 *
 * One implementation answers three questions that were previously answered nowhere:
 *
 *  1. **Which provider row serves this capability?** A row of the requested `provider_type` whose
 *     status is `connected`. A `configured`-but-never-tested row is deliberately *not* usable: the
 *     operator has not yet proven the credentials work, and a lookup that fails at the provider
 *     would look like a registry outage rather than an unfinished setup.
 *  2. **Where do the credentials come from?** `credentials_encrypted`, decrypted through
 *     `lib/secret-box.js`, whose domain-provider salt is byte-identical to the legacy
 *     encrypt-only copy in `domains/admin-domain-services.js` — so ciphertext written before
 *     secret-box existed still opens. A row marked `connected` whose credentials are missing or
 *     unreadable is refused: a **database status never overrules the credential invariant**.
 *  3. **How does a provider failure become an HTTP answer?** Through
 *     `domainProviderErrorToHttpError`, which keeps the provider's own text server-side and returns
 *     the platform's neutral sentence plus the stable failure code.
 *
 * `rdap` needs no credentials at all — it is a public registry service — but it still requires a
 * tested provider row, because whether this deployment talks to registries is the operator's
 * decision, not a property of a lookup route.
 */
'use strict';

const { HttpError, ValidationError } = require('../core/errors');
const { uuidv7 } = require('./ids');
const { decryptSecret, describeSecret, PURPOSES } = require('./secret-box');
const { DomainProviderError, safeDomainProviderMessage, domainFailure } = require('./domain-providers/types');
const {
  createDomainProviderAdapter, registeredDomainProviderAdapters,
  domainProviderAdapterInstalled, assertDomainProviderAdapterInstalled,
} = require('./domain-providers/registry');
const { registerBuiltInDomainProviderAdapters } = require('./domain-providers/register-builtins');

// Importing the seam is enough to make the compiled adapter set available; it is idempotent.
registerBuiltInDomainProviderAdapters();

/** Provider types a caller may resolve. `auction` is the internal marketplace, not an adapter. */
const PROVIDER_TYPES = Object.freeze(['registrar', 'rdap', 'appraisal', 'auction']);

/**
 * The credentials stored on a provider row, or a refusal naming what is wrong with them.
 *
 * Returned object is never logged, never serialised into a response, and never attached to an error.
 */
function credentialsFor(row, secret) {
  if (!row?.credentials_encrypted) {
    throw new DomainProviderError('PROVIDER_NOT_CONFIGURED', `Domain provider '${row?.provider_key ?? row?.id}' has no stored credentials`, false);
  }
  const plaintext = decryptSecret(secret, PURPOSES.domainProvider, row.credentials_encrypted);
  if (plaintext === null) {
    // Wrong master secret, tampering, or a value from another deployment. All three mean "cannot
    // authenticate", and the operator's fix is to re-enter the credentials — not to retry.
    throw new DomainProviderError('PROVIDER_NOT_CONFIGURED', `Domain provider '${row.provider_key}' credentials could not be decrypted`, false);
  }
  let decoded;
  try {
    decoded = JSON.parse(plaintext);
  } catch {
    throw new DomainProviderError('PROVIDER_NOT_CONFIGURED', `Domain provider '${row.provider_key}' credentials are not a readable key/value object`, false);
  }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    throw new DomainProviderError('PROVIDER_NOT_CONFIGURED', `Domain provider '${row.provider_key}' credentials are not a key/value object`, false);
  }
  return decoded;
}

function configFrom(row, credentials) {
  return {
    id: row.id,
    key: row.provider_key,
    name: row.name,
    adapterKey: row.adapter_key,
    type: row.provider_type,
    environment: row.environment === 'sandbox' ? 'sandbox' : 'production',
    apiBaseUrl: row.api_base_url ?? null,
    capabilities: row.capabilities ?? {},
    configuration: row.configuration ?? {},
    credentials,
  };
}

/**
 * The row that serves one capability, or a refusal naming the fix.
 *
 * `rdap` is special-cased in exactly one respect: it needs no credentials, so a `connected` row is
 * usable with an empty credential set. Every other adapter must have readable credentials.
 */
async function resolveConnectedDomainProvider(store, providerType, options = {}) {
  if (!PROVIDER_TYPES.includes(providerType)) throw new ValidationError(`Unknown domain provider type '${providerType}'`);

  const secret = options.secret ?? 'ephemeral';
  const rows = (await store.table('domain_service_providers').all())
    .filter((row) => row.provider_type === providerType && row.status === 'connected')
    .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
  const row = rows[0];
  if (!row) {
    const installed = registeredDomainProviderAdapters();
    throw new DomainProviderError(
      'PROVIDER_NOT_CONFIGURED',
      `No connected ${providerType} domain provider is configured. Add one under Admin → Domain Services and run its connection test. Installed adapters: ${installed.join(', ') || 'none'}`,
      false,
      { providerType, installed },
    );
  }

  // Order matters: an adapter this build does not compile is refused before any credential is
  // touched, because re-entering a credential could never make it work.
  assertDomainProviderAdapterInstalled(row.adapter_key);
  const credentials = row.adapter_key === 'rdap' ? credentialsForOptional(row, secret) : credentialsFor(row, secret);
  const adapter = createDomainProviderAdapter(configFrom(row, credentials), {
    ...(options.adapterOptions ?? {}),
    // Only a `sandbox` provider may point at loopback. Staging accounts and the automated tests
    // drive a real adapter against a local fake that way; a production row never gets the escape
    // hatch, so `api_base_url` cannot be turned into an SSRF primitive by editing one field.
    allowLoopback: row.environment === 'sandbox',
  });
  return { provider: row, adapter, credentials };
}

/** RDAP has no credentials; a row may still carry some (an IANA mirror with basic auth, say). */
function credentialsForOptional(row, secret) {
  try {
    return credentialsFor(row, secret);
  } catch {
    return {};
  }
}

/**
 * Public-safe readiness for the Domain Services UI.
 *
 * This is what replaces a hardcoded `configured: false` block: the answer now comes from the rows an
 * operator actually created, plus the compiled adapter set, so the UI cannot claim a capability is
 * unavailable while a working provider is configured — or claim it works when it is not.
 */
async function domainProviderReadiness(store, options = {}) {
  const rows = await store.table('domain_service_providers').all();
  const secret = options.secret ?? 'ephemeral';
  const installed = registeredDomainProviderAdapters();

  const forType = (providerType) => {
    const candidates = rows
      .filter((row) => row.provider_type === providerType && row.status !== 'disabled')
      .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
    const connected = candidates.find((row) => row.status === 'connected') ?? null;
    const configured = Boolean(connected);
    return {
      configured,
      // A capability can be configured and still unusable: unreadable credentials, or an adapter
      // this build does not compile. The UI must be able to say which, so both are reported.
      providerKey: connected?.provider_key ?? null,
      adapterInstalled: connected ? domainProviderAdapterInstalled(connected.adapter_key) : null,
      credentialState: connected ? describeSecret(secret, PURPOSES.domainProvider, connected.credentials_encrypted ?? null).state : null,
      providersConfigured: candidates.length,
    };
  };

  return {
    registrar: forType('registrar'),
    rdap: forType('rdap'),
    appraisal: forType('appraisal'),
    // The internal marketplace needs no external provider and has always been operational.
    auctions: { configured: true, providerKey: 'internal', adapterInstalled: true, credentialState: null, providersConfigured: 0 },
    installedAdapters: installed,
  };
}

/**
 * Refuse before egress when the adapter cannot perform the operation at all.
 *
 * A capability an adapter does not claim is a configuration mismatch, not an outage, and saying so
 * keeps the customer from retrying something that can only ever fail.
 */
function assertCapabilitySupported(adapter, capability) {
  if (adapter.capabilities?.[capability] === true) return adapter;
  throw new DomainProviderError(
    'UNSUPPORTED_OPERATION',
    `The ${adapter.key} domain provider does not support '${capability}'`,
    false,
    { adapterKey: adapter.key, capability },
  );
}

/** Provider failure -> the platform's HTTP vocabulary. Provider text never leaves the server. */
function domainProviderErrorToHttpError(error) {
  if (error instanceof HttpError) return error;
  if (!(error instanceof DomainProviderError)) {
    const wrapped = new HttpError(500, 'The domain service could not complete this request.', 'INTERNAL_ERROR');
    wrapped.details = { failureCode: 'PROVIDER_ERROR' };
    return wrapped;
  }

  const status = {
    PROVIDER_NOT_CONFIGURED: 503,
    ADAPTER_NOT_INSTALLED: 503,
    AUTHENTICATION_FAILED: 503,
    RATE_LIMITED: 429,
    NETWORK_TEMPORARY_FAILURE: 503,
    PROVIDER_UNAVAILABLE: 503,
    UNSUPPORTED_OPERATION: 400,
    INVALID_PROVIDER_RESPONSE: 503,
    NO_REGISTRY_RECORD: 404,
    PROVIDER_ERROR: 503,
  }[error.code] ?? 503;

  const translated = new HttpError(status, safeDomainProviderMessage(error), error.code);
  translated.details = { ...(translated.details ?? {}), failureCode: error.code, retryable: error.retryable };
  return translated;
}

/**
 * Resolve, run, translate. Use where a failure must stop the route; use `domainFailure` where the
 * failure *is* the answer (a lookup that honestly reports "no answer available").
 */
async function withDomainProvider(deps, providerType, fn, options = {}) {
  const secret = deps.config?.JWT_SECRET || 'ephemeral';
  const { provider, adapter } = await resolveConnectedDomainProvider(deps.store, providerType, {
    secret,
    adapterOptions: {
      transport: options.transport,
      whoisTransport: options.whoisTransport,
      timeoutMs: options.timeoutMs,
    },
  });
  try {
    return await fn(adapter, provider);
  } catch (error) {
    const translated = domainProviderErrorToHttpError(error);
    // Server-side only: the operator needs the real reason, the browser gets the stable code.
    deps.logger?.warn?.(
      { providerKey: provider.provider_key, providerType, failureCode: error?.code ?? null, reason: error?.message },
      'domain provider call failed',
    );
    throw translated;
  }
}

// Re-exported so domain modules import one module for the whole provider surface.
module.exports = {
  PROVIDER_TYPES,
  resolveConnectedDomainProvider,
  domainProviderReadiness,
  assertCapabilitySupported,
  domainProviderErrorToHttpError,
  withDomainProvider,
  domainFailure,
  uuidv7,
};
