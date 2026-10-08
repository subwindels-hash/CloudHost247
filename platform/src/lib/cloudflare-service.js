/**
 * Wiring a Cloudflare *service* to a Cloudflare *account* — one implementation for both domains.
 *
 * Two questions have exactly one answer in this platform, and both used to be answered nowhere:
 *
 *  - **Which account authenticates a service's calls?** `cloudflare_services.account_id` if it is set,
 *    otherwise the oldest active account, which is then written onto the service row so the *next*
 *    call uses the same one. Nothing is guessed from the zone name; a deployment with no active
 *    account is refused by name before any request. The choice is sticky on purpose: a service whose
 *    calls silently moved between accounts would make the API log unreadable and could provision a
 *    zone into the wrong Cloudflare account.
 *  - **Where do the calls get recorded?** Every call is written to `cloudflare_api_logs`, which the
 *    admin overview already counts 24-hour errors from. Before this module that table was always
 *    empty, so the error counter was structurally zero.
 *
 * The log record carries the method, the pathname, the status and the timing. It never carries a
 * token, a request body or a query string.
 */
'use strict';

const { ValidationError } = require('../core/errors');
const { createCloudflareClient, cloudflareErrorToHttpError } = require('./cloudflare-client');

/**
 * The account a service's provider calls should authenticate as.
 *
 * @param {object} store
 * @param {object} service        the `cloudflare_services` row
 * @param {object} [options]      `{ persist }` — write the chosen account onto the service row
 */
async function resolveServiceAccount(store, service, options = {}) {
  const { persist = true } = options;

  if (service.account_id) {
    const existing = await store.table('cloudflare_accounts').findById(service.account_id);
    if (existing) return existing;
    // A service pointing at a deleted account is a real fault, not a reason to silently pick another
    // one: the zone may live in a different Cloudflare account entirely.
    throw new ValidationError(
      'The Cloudflare account recorded for this service no longer exists — an administrator must re-link it before any provider action',
    );
  }

  const candidates = (await store.table('cloudflare_accounts').all())
    .filter((account) => (account.status ?? 'active') === 'active')
    .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
  const chosen = candidates[0];
  if (!chosen) {
    throw new ValidationError(
      'No active Cloudflare account is configured, so this service cannot reach Cloudflare — add an account under Admin → Cloudflare first',
    );
  }
  if (persist) await store.table('cloudflare_services').updateById(service.id, { account_id: chosen.id });
  return chosen;
}

/**
 * Build a client bound to one account, with every call appended to `cloudflare_api_logs`.
 *
 * The `serviceId` is bound here so the log row can be attributed without every call site passing it.
 */
function clientForAccount(deps, account, serviceId = null) {
  const secret = deps.config?.JWT_SECRET || 'ephemeral';
  return createCloudflareClient({
    account,
    secret,
    config: deps.config,
    logger: deps.logger,
    onCall: async (entry) => {
      await deps.store.table('cloudflare_api_logs').insert({
        id: require('./ids').uuidv7(),
        account_id: entry.accountId ?? null,
        service_id: serviceId,
        method: entry.method ?? null,
        path: entry.path ?? null,
        status_code: entry.statusCode ?? null,
        success: entry.success === true,
        error_code: entry.errorCode ?? null,
        duration_ms: entry.durationMs ?? null,
      });
    },
  });
}

/**
 * Resolve the account, build the client, run `fn`, and translate a provider failure into the
 * platform's HTTP vocabulary on the way out.
 *
 * The provider's *own* failure code is attached to the translated error's `details` so a caller
 * writing an audit row records what Cloudflare said rather than the HTTP shape of it.
 */
async function withServiceClient(deps, service, fn, options = {}) {
  const account = await resolveServiceAccount(deps.store, service, options);
  const client = clientForAccount(deps, account, service.id);
  try {
    return await fn(client, account);
  } catch (error) {
    const translated = cloudflareErrorToHttpError(error);
    translated.details = { ...(translated.details ?? {}), failureCode: error?.code ?? null };
    throw translated;
  }
}

module.exports = { resolveServiceAccount, clientForAccount, withServiceClient };
