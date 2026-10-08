/**
 * Cloudflare API v4 client — the live egress this platform's Cloudflare surface was missing.
 *
 * Both `domains/cloudflare.js` and `domains/admin-cloudflare.js` described every provider-side
 * behaviour as "deferred": DNS records were written to a local table with a **fabricated**
 * `cf-rec-<uuid>` identifier, "Test Connection" could only report `unavailable`, cache purges were
 * queued as durable jobs nobody executed, and analytics answered `DATA_UNAVAILABLE` on purpose. This
 * module implements the provider side so those routes can act for real.
 *
 * The rules it inherits from `lib/provider-egress.js` — the seam the infrastructure adapters use —
 * are the same three, applied to a second provider boundary:
 *
 *  1. **Fail closed before egress.** No stored token, an unreadable token, or a non-HTTPS base URL
 *     is refused locally with a `CloudflareError` that names what is wrong. No request is attempted,
 *     so a configuration fault can never be reported as a Cloudflare outage.
 *  2. **Never fake a result.** A provider rejection is a rejection. Nothing here synthesises an id,
 *     a nameserver pair, a DNSSEC record or a traffic figure that Cloudflare did not return.
 *  3. **Cloudflare's own error text never reaches a browser.** The API's `errors[].message` can name
 *     account ids, zone ids and internal paths, so it is logged server-side and the caller gets the
 *     stable numeric code plus a neutral sentence from `cloudflareErrorToHttpError`.
 *
 * Auth is a bearer **API token** (`Authorization: Bearer`), which is what
 * `cloudflare_accounts.encrypted_api_token` stores. Global-key auth (`X-Auth-Email` + `X-Auth-Key`)
 * is deliberately not implemented: it grants account-wide scope and Cloudflare itself recommends
 * scoped tokens for exactly this reason.
 *
 * Every call is reported to an optional `onCall` hook so the platform's own
 * `cloudflare_api_logs` table — which `GET /api/v1/admin/cloudflare` already counts errors from —
 * records real provider traffic instead of staying empty. The hook receives the path only, never
 * the token, and never a request body.
 *
 * What remains unproven here, stated rather than implied: no call has been made to a real Cloudflare
 * account from the environment this was written in. The wire contracts (URL, method, auth header,
 * body shape, envelope handling, error classification, pagination, purge/analytics payloads) are
 * covered by `tests/cloudflare-client.test.js` over real loopback HTTP against a fake Cloudflare
 * API; Cloudflare's acceptance of those requests is not claimed.
 */
'use strict';

const { requireSecureBaseUrl } = require('./providers/common');
const { ProviderError } = require('./providers/types');
const { HttpError, ValidationError, NotFoundError, ForbiddenError, ServiceUnavailableError, UpstreamError } = require('../core/errors');
const { decryptSecret, describeSecret, PURPOSES } = require('./secret-box');

const DEFAULT_BASE_URL = 'https://api.cloudflare.com/client/v4';
const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Stable failure vocabulary. Codes are the platform's own — deliberately not Cloudflare's numeric
 * ones — so a caller can branch on a behaviour ("was this retryable?", "were we rejected?") without
 * learning a provider's numbering.
 */
const CLOUDFLARE_FAILURE_CODES = Object.freeze([
  'CLOUDFLARE_NOT_CONFIGURED',
  'CLOUDFLARE_CREDENTIAL_UNREADABLE',
  'CLOUDFLARE_INSECURE_BASE_URL',
  'CLOUDFLARE_AUTHENTICATION_FAILED',
  'CLOUDFLARE_FORBIDDEN',
  'CLOUDFLARE_NOT_FOUND',
  'CLOUDFLARE_REJECTED',
  'CLOUDFLARE_RATE_LIMITED',
  'CLOUDFLARE_TIMEOUT',
  'CLOUDFLARE_UNAVAILABLE',
  'CLOUDFLARE_INVALID_RESPONSE',
  'CLOUDFLARE_ERROR',
]);

class CloudflareError extends Error {
  /**
   * @param {string} code     one of CLOUDFLARE_FAILURE_CODES
   * @param {string} message  a reason safe to log — never the provider's raw text
   * @param {object} [meta]   `{ retryable, status, providerCodes }`; `providerCodes` are Cloudflare's
   *                          own numeric error codes, kept because they are stable and diagnosable
   */
  constructor(code, message, meta = {}) {
    super(message);
    this.name = 'CloudflareError';
    this.code = CLOUDFLARE_FAILURE_CODES.includes(code) ? code : 'CLOUDFLARE_ERROR';
    this.retryable = Boolean(meta.retryable);
    this.status = meta.status ?? null;
    this.providerCodes = Array.isArray(meta.providerCodes) ? meta.providerCodes : [];
  }
}

/**
 * Cloudflare's own numeric codes that change what a caller should do. Everything unmapped is a
 * rejection, which is the safe default: the request reached Cloudflare and Cloudflare said no.
 */
const AUTH_CODES = new Set([10000, 9109, 9106, 9103, 6003]);
const NOT_FOUND_CODES = new Set([1002, 1049, 7003, 81044, 81057]);

function classifyProviderCodes(codes) {
  if (codes.some((code) => AUTH_CODES.has(code))) return 'CLOUDFLARE_AUTHENTICATION_FAILED';
  if (codes.some((code) => NOT_FOUND_CODES.has(code))) return 'CLOUDFLARE_NOT_FOUND';
  return null;
}

function classifyHttpStatus(status) {
  if (status === 401 || status === 403) return { code: 'CLOUDFLARE_AUTHENTICATION_FAILED', retryable: false };
  if (status === 404) return { code: 'CLOUDFLARE_NOT_FOUND', retryable: false };
  if (status === 429) return { code: 'CLOUDFLARE_RATE_LIMITED', retryable: true };
  if (status >= 500) return { code: 'CLOUDFLARE_UNAVAILABLE', retryable: true };
  return { code: 'CLOUDFLARE_REJECTED', retryable: false };
}

/**
 * The reason an account cannot be called, or `{ token }` when it can.
 *
 * A legacy plaintext `api_token` column is honoured because rows written before the encrypted column
 * existed are still in the tree; it is read, never written, and never echoed back in a DTO.
 */
function resolveAccountCredential(secret, account) {
  if (!account) return { token: null, reason: 'no account is configured for this Cloudflare service' };
  const envelope = account.encrypted_api_token ?? null;
  if (envelope) {
    const token = decryptSecret(secret, PURPOSES.cloudflareAccount, envelope);
    if (!token) {
      const { state } = describeSecret(secret, PURPOSES.cloudflareAccount, envelope);
      return {
        token: null,
        reason: state === 'unreadable'
          ? 'the stored Cloudflare API token could not be decrypted — it was encrypted with a different master secret, so it must be rotated'
          : 'no Cloudflare API token is stored for this account',
      };
    }
    return { token, source: 'encrypted' };
  }
  if (typeof account.api_token === 'string' && account.api_token.length > 0) {
    return { token: account.api_token, source: 'legacy-plaintext' };
  }
  return { token: null, reason: 'no Cloudflare API token is stored for this account' };
}

function resolveBaseUrl(account, config) {
  const configured = account?.api_base_url ?? config?.CLOUDFLARE_API_BASE_URL ?? DEFAULT_BASE_URL;
  try {
    // Reused rather than re-implemented: this is the same rule (https, or loopback for a local
    // TLS-terminating tunnel) the infrastructure adapters enforce, so the two cannot drift.
    return requireSecureBaseUrl('Cloudflare', configured);
  } catch (error) {
    if (error instanceof ProviderError) {
      throw new CloudflareError('CLOUDFLARE_INSECURE_BASE_URL', error.message, { retryable: false });
    }
    throw error;
  }
}

/** The customer-safe sentence for a failure code. Never derived from Cloudflare's message. */
const CUSTOMER_MESSAGES = Object.freeze({
  CLOUDFLARE_NOT_CONFIGURED: 'This action is unavailable because the Cloudflare integration is not configured.',
  CLOUDFLARE_CREDENTIAL_UNREADABLE: 'This action is unavailable because the stored Cloudflare API token cannot be read.',
  CLOUDFLARE_INSECURE_BASE_URL: 'This action is unavailable because the Cloudflare API base URL is not configured securely.',
  CLOUDFLARE_AUTHENTICATION_FAILED: 'Cloudflare rejected our credentials. An administrator must check the API token.',
  CLOUDFLARE_FORBIDDEN: 'Cloudflare refused this action for our API token. An administrator must check its permissions.',
  CLOUDFLARE_NOT_FOUND: 'Cloudflare has no such resource for this service.',
  CLOUDFLARE_REJECTED: 'Cloudflare rejected this request.',
  CLOUDFLARE_RATE_LIMITED: 'Cloudflare is rate limiting requests. Please try again shortly.',
  CLOUDFLARE_TIMEOUT: 'Cloudflare did not respond in time. Please try again shortly.',
  CLOUDFLARE_UNAVAILABLE: 'Cloudflare is temporarily unavailable. Please try again shortly.',
  CLOUDFLARE_INVALID_RESPONSE: 'Cloudflare returned a response this platform could not read.',
});

/**
 * Translate a client failure into the platform's HTTP vocabulary. `CLOUDFLARE_REJECTED` carries
 * Cloudflare's numeric codes in `details` — the codes are stable and safe; the messages are not.
 */
function cloudflareErrorToHttpError(error) {
  // An HttpError thrown by a readiness guard (no account configured, no zone yet) is already the
  // right answer for a browser; re-wrapping it would turn a 400 that names the fault into an opaque
  // 502 that suggests Cloudflare was at fault.
  if (error instanceof HttpError) return error;
  if (error instanceof CloudflareError) {
    const detail = error.providerCodes.length > 0 ? { cloudflareErrorCodes: error.providerCodes } : undefined;
    switch (error.code) {
      case 'CLOUDFLARE_NOT_CONFIGURED':
      case 'CLOUDFLARE_CREDENTIAL_UNREADABLE':
      case 'CLOUDFLARE_INSECURE_BASE_URL':
        return new ValidationError(CUSTOMER_MESSAGES[error.code], detail);
      case 'CLOUDFLARE_AUTHENTICATION_FAILED':
        return new ServiceUnavailableError(CUSTOMER_MESSAGES[error.code]);
      case 'CLOUDFLARE_FORBIDDEN':
        return new ForbiddenError(CUSTOMER_MESSAGES[error.code]);
      case 'CLOUDFLARE_NOT_FOUND':
        return new NotFoundError(CUSTOMER_MESSAGES[error.code]);
      case 'CLOUDFLARE_REJECTED':
        return new ValidationError(CUSTOMER_MESSAGES[error.code], detail);
      default:
        return new ServiceUnavailableError(CUSTOMER_MESSAGES[error.code] ?? CUSTOMER_MESSAGES.CLOUDFLARE_UNAVAILABLE);
    }
  }
  return new UpstreamError('Cloudflare returned an unexpected response.');
}

/** Bounded, credential-free record of an unsuccessful call, safe to store and to log. */
function errorEvidence(error) {
  return {
    code: error instanceof CloudflareError ? error.code : 'CLOUDFLARE_ERROR',
    retryable: error instanceof CloudflareError ? error.retryable : false,
    providerCodes: error instanceof CloudflareError ? error.providerCodes : [],
  };
}

/**
 * Read a Cloudflare envelope: `{ success, errors: [{code,message}], result, result_info }`.
 *
 * `success: false` with an HTTP 200 is a real Cloudflare behaviour (the GraphQL endpoint and some
 * legacy routes do it), so the envelope is authoritative and the status is only a fallback. The
 * error *messages* are deliberately dropped here: they are attached to the thrown error as
 * `providerMessages` for server-side logging and are never part of a response body.
 */
function readEnvelope(body, status) {
  const isRecord = body !== null && typeof body === 'object' && !Array.isArray(body);
  if (!isRecord) return { ok: false, reason: 'not-an-envelope' };

  const errors = Array.isArray(body.errors) ? body.errors : [];
  const codes = errors.map((entry) => Number(entry?.code)).filter((code) => Number.isFinite(code));
  const messages = errors.map((entry) => String(entry?.message ?? '')).filter(Boolean);

  // A body that carries no `success` flag at all is not an envelope: treat 2xx as "the payload is
  // the result" only for endpoints that legitimately answer that way (none in v4), so this is a
  // strict read.
  if (body.success === true) return { ok: true, result: body.result ?? null, resultInfo: body.result_info ?? null };
  if (body.success === false) return { ok: false, codes, messages, status };
  return { ok: false, reason: 'missing-success-flag', codes, messages, status };
}

function createCloudflareClient(options = {}) {
  const {
    account,
    secret,
    config,
    transport,
    logger,
    onCall,
    timeoutMs = config?.CLOUDFLARE_API_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS,
  } = options;

  const onCallSink = typeof onCall === 'function' ? onCall : null;

  function record(entry) {
    if (!onCallSink) return;
    try {
      onCallSink({ accountId: account?.id ?? null, ...entry });
    } catch (error) {
      // Observability must never fail the operation it observes.
      logger?.warn?.({ reason: error.message }, 'cloudflare api log write failed');
    }
  }

  /**
   * One Cloudflare call. Returns the envelope's `result`.
   *
   * The token is read once per client (not per call) and is never attached to an error, logged, or
   * written to the call record — the record carries the method, the pathname and the outcome only.
   */
  async function request(method, path, body, requestOptions = {}) {
    const started = Date.now();

    // --- fail closed, before any network access ------------------------------------------------
    let token;
    try {
      const credential = resolveAccountCredential(secret, account);
      if (!credential.token) {
        throw new CloudflareError('CLOUDFLARE_NOT_CONFIGURED', `Cloudflare cannot be contacted: ${credential.reason}`, { retryable: false });
      }
      token = credential.token;
    } catch (error) {
      const failure = error instanceof CloudflareError ? error : new CloudflareError('CLOUDFLARE_NOT_CONFIGURED', error.message, { retryable: false });
      record({ method, path, statusCode: null, success: false, errorCode: failure.code, durationMs: Date.now() - started });
      throw failure;
    }

    const baseUrl = resolveBaseUrl(account, config);
    const url = `${baseUrl}${path}`;
    const send = transport ?? globalThis.fetch;
    if (typeof send !== 'function') {
      throw new CloudflareError('CLOUDFLARE_NOT_CONFIGURED', 'No HTTP transport is available for Cloudflare requests', { retryable: false });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestOptions.timeoutMs ?? timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    let response;
    let raw;
    try {
      response = await send(url, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      raw = await response.text();
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError';
      const failure = isAbort
        ? new CloudflareError('CLOUDFLARE_TIMEOUT', 'Cloudflare request timed out', { retryable: true })
        : new CloudflareError('CLOUDFLARE_UNAVAILABLE', 'Cloudflare API could not be reached', { retryable: true });
      logger?.warn?.({ path, reason: error.message }, 'cloudflare request failed');
      record({ method, path, statusCode: null, success: false, errorCode: failure.code, durationMs: Date.now() - started });
      throw failure;
    } finally {
      clearTimeout(timer);
    }

    let envelope;
    try {
      envelope = raw === '' ? { success: response.ok } : JSON.parse(raw);
    } catch {
      const failure = new CloudflareError('CLOUDFLARE_INVALID_RESPONSE', 'Cloudflare returned a body that is not JSON', {
        retryable: false, status: response.status,
      });
      logger?.warn?.({ path, status: response.status }, 'cloudflare returned an unreadable body');
      record({ method, path, statusCode: response.status, success: false, errorCode: failure.code, durationMs: Date.now() - started });
      throw failure;
    }

    const parsed = readEnvelope(envelope, response.status);
    if (parsed.ok) {
      record({ method, path, statusCode: response.status, success: true, errorCode: null, durationMs: Date.now() - started });
      return { result: parsed.result, resultInfo: parsed.resultInfo };
    }

    // Envelope said no. Prefer the numeric codes' meaning over the HTTP status: Cloudflare answers
    // 400 for a bad token as often as it answers 401.
    const byCodes = classifyProviderCodes(parsed.codes ?? []);
    const byStatus = classifyHttpStatus(response.status);
    const code = byCodes ?? byStatus.code;
    const retryable = byCodes ? false : byStatus.retryable;
    const failure = new CloudflareError(
      code,
      `Cloudflare rejected ${method} ${path}`,
      { retryable, status: response.status, providerCodes: parsed.codes ?? [] },
    );
    (failure.providerMessages = parsed.messages ?? []), (failure.providerReason = parsed.reason ?? null);
    // Server-side only: the operator gets Cloudflare's real words in the log, the browser never does.
    logger?.warn?.(
      { path, method, status: response.status, providerCodes: failure.providerCodes, providerMessages: failure.providerMessages },
      'cloudflare refused request',
    );
    record({
      method, path, statusCode: response.status, success: false, errorCode: code,
      durationMs: Date.now() - started,
    });
    throw failure;
  }

  async function requestAll(method, path, body, requestOptions = {}) {
    const { result, resultInfo } = await request(method, path, body, requestOptions);
    if (Array.isArray(result)) return { items: result, resultInfo };
    return { items: result === null || result === undefined ? [] : [result], resultInfo };
  }

  /**
   * Walk Cloudflare's page numbers. Bounded on purpose: a sync that follows an unbounded page count
   * against a zone with tens of thousands of records would hold a request open indefinitely. When the
   * bound is reached the caller is told, so a partial cache is never presented as the whole zone.
   */
  async function paginate(path, requestOptions = {}, maxPages = 20) {
    const items = [];
    let page = 1;
    let truncated = false;
    for (;;) {
      const separator = path.includes('?') ? '&' : '?';
      const { items: batch, resultInfo } = await requestAll('GET', `${path}${separator}page=${page}&per_page=100`, undefined, requestOptions);
      items.push(...batch);
      const totalPages = Number(resultInfo?.total_pages ?? 1);
      if (page >= totalPages || batch.length === 0) break;
      if (page >= maxPages) { truncated = true; break; }
      page += 1;
    }
    return { items, truncated, pages: page };
  }

  const api = {
    errors: { CloudflareError, CLOUDFLARE_FAILURE_CODES },
    /** The base URL in use, for diagnostics. Contains no credential. */
    baseUrl: () => resolveBaseUrl(account, config),

    // ------------------------------------------------------------------ identity / connectivity
    /**
     * `GET /user/tokens/verify` — the one endpoint that answers "is this token valid, and is it the
     * right token?" without reading any customer resource. It is what "Test Connection" needs.
     */
    async verifyToken() {
      const { result } = await request('GET', '/user/tokens/verify');
      const status = typeof result?.status === 'string' ? result.status : null;
      return {
        // Cloudflare answers `success: true` with `status: "active"` for a live token. Anything other
        // than "active" is reported as itself rather than rounded to a boolean.
        active: status === 'active',
        status,
        tokenId: typeof result?.id === 'string' ? result.id : null,
      };
    },

    // ------------------------------------------------------------------------------- zones
    async getZone(zoneId) {
      const { result } = await request('GET', `/zones/${encodeURIComponent(zoneId)}`);
      return normalizeZone(result);
    },

    async findZoneByName(name) {
      const { items } = await requestAll('GET', `/zones?name=${encodeURIComponent(name)}`);
      return items.length > 0 ? normalizeZone(items[0]) : null;
    },

    async createZone({ name, accountId, type = 'full', jumpStart = false }) {
      const { result } = await request('POST', '/zones', {
        name,
        account: { id: accountId },
        type,
        jump_start: jumpStart,
      });
      return normalizeZone(result);
    },

    async deleteZone(zoneId) {
      const { result } = await request('DELETE', `/zones/${encodeURIComponent(zoneId)}`);
      // Cloudflare's delete answers `result.id`; a body without one is not a deletion we can report.
      return { deleted: Boolean(result?.id), id: result?.id ?? null };
    },

    /**
     * Pause / resume a zone.
     *
     * Cloudflare's documented meaning of a paused zone is narrow — it serves DNS only, and the flag
     * is accepted for zones on a partial (CNAME) setup. That is the closest provider-side equivalent
     * of this platform's "suspend", so it is the operation the admin lifecycle uses; a zone type
     * Cloudflare will not pause is reported by Cloudflare, never worked around locally.
     */
    async setZonePaused(zoneId, paused) {
      const { result } = await request('PATCH', `/zones/${encodeURIComponent(zoneId)}`, { paused: Boolean(paused) });
      return normalizeZone(result);
    },

    // ------------------------------------------------------------------------- DNS records
    /**
     * Every record in the zone, normalized.
     *
     * The normalisation matters beyond tidiness: the sync path writes `ownership` and `ttl` from these
     * records straight into the local cache, so returning raw provider rows here would drop the
     * SYSTEM_MANAGED marker Cloudflare sets on integration-created records — and the customer would
     * then be offered edit and delete buttons for a record that is not theirs.
     */
    async listDnsRecords(zoneId, filter = {}) {
      const query = new URLSearchParams();
      if (filter.type) query.set('type', filter.type);
      if (filter.name) query.set('name', filter.name);
      const suffix = query.toString() ? `?${query}` : '';
      const { items, truncated, pages } = await paginate(`/zones/${encodeURIComponent(zoneId)}/dns_records${suffix}`);
      return { items: items.map(normalizeDnsRecord), truncated, pages };
    },

    async createDnsRecord(zoneId, record) {
      const { result } = await request('POST', `/zones/${encodeURIComponent(zoneId)}/dns_records`, dnsRecordBody(record));
      return normalizeDnsRecord(result);
    },

    async updateDnsRecord(zoneId, recordId, patch) {
      const { result } = await request(
        'PATCH',
        `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`,
        dnsRecordBody(patch),
      );
      return normalizeDnsRecord(result);
    },

    async deleteDnsRecord(zoneId, recordId) {
      const { result } = await request('DELETE', `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`);
      return { deleted: Boolean(result?.id), id: result?.id ?? null };
    },

    // ---------------------------------------------------------------------------- settings
    async listZoneSettings(zoneId) {
      const { items } = await paginate(`/zones/${encodeURIComponent(zoneId)}/settings`);
      const byId = {};
      for (const setting of items) {
        if (setting && typeof setting.id === 'string') {
          byId[setting.id] = { value: setting.value ?? null, editable: setting.editable !== false };
        }
      }
      return byId;
    },

    /**
     * `PATCH /zones/:id/settings/:settingId`.
     *
     * Cloudflare types setting values strictly (an `on`/`off` switch rejects `true`; a numeric TTL
     * rejects a string), so the value is sent exactly as the caller's own validator produced it and
     * a type complaint comes back as `CLOUDFLARE_REJECTED` rather than being coerced into a silent
     * success.
     */
    async patchZoneSetting(zoneId, settingId, value) {
      const { result } = await request(
        'PATCH',
        `/zones/${encodeURIComponent(zoneId)}/settings/${encodeURIComponent(settingId)}`,
        { value },
      );
      const record = result && typeof result === 'object' ? result : {};
      return { id: record.id ?? settingId, value: record.value ?? null };
    },

    // ------------------------------------------------------------------- firewall access rules
    async listAccessRules(zoneId) {
      const { items, truncated, pages } = await paginate(`/zones/${encodeURIComponent(zoneId)}/firewall/access_rules/rules`);
      return { items: items.map(normalizeAccessRule), truncated, pages };
    },

    async createAccessRule(zoneId, { mode, notes, target, value }) {
      const { result } = await request('POST', `/zones/${encodeURIComponent(zoneId)}/firewall/access_rules/rules`, {
        mode,
        notes: notes ?? undefined,
        configuration: { target, value },
      });
      return normalizeAccessRule(result);
    },

    async updateAccessRule(zoneId, ruleId, { mode, notes }) {
      const { result } = await request(
        'PATCH',
        `/zones/${encodeURIComponent(zoneId)}/firewall/access_rules/rules/${encodeURIComponent(ruleId)}`,
        { mode, notes: notes ?? undefined },
      );
      return normalizeAccessRule(result);
    },

    async deleteAccessRule(zoneId, ruleId) {
      const { result } = await request('DELETE', `/zones/${encodeURIComponent(zoneId)}/firewall/access_rules/rules/${encodeURIComponent(ruleId)}`);
      return { deleted: Boolean(result?.id), id: result?.id ?? null };
    },

    // ------------------------------------------------------------------------------ DNSSEC
    /**
     * `GET /zones/:id/dnssec` returns the zone's DNSSEC state *and the DS record* a registrar needs.
     * The platform's endpoint has always answered `dsRecord: null`; now it can answer with what
     * Cloudflare publishes, or with `null` only when Cloudflare itself reports nothing.
     */
    async getDnssec(zoneId) {
      const { result } = await request('GET', `/zones/${encodeURIComponent(zoneId)}/dnssec`);
      const record = result && typeof result === 'object' ? result : {};
      return {
        status: typeof record.status === 'string' ? record.status : 'unknown',
        algorithm: record.algorithm ?? null,
        digestAlgorithm: record.digest_algorithm ?? null,
        digestType: record.digest_type ?? null,
        ds: typeof record.ds === 'string' && record.ds.length > 0 ? record.ds : null,
        keyTag: record.key_tag ?? null,
        flags: record.flags ?? null,
        publicKey: record.public_key ?? null,
        modifiedOn: record.modified_on ?? null,
      };
    },

    async enableDnssec(zoneId) {
      const { result } = await request('POST', `/zones/${encodeURIComponent(zoneId)}/dnssec`, undefined);
      const record = result && typeof result === 'object' ? result : {};
      return { status: typeof record.status === 'string' ? record.status : 'pending', ds: record.ds ?? null };
    },

    async disableDnssec(zoneId) {
      const { result } = await request('PATCH', `/zones/${encodeURIComponent(zoneId)}/dnssec`, { status: 'disabled' });
      const record = result && typeof result === 'object' ? result : {};
      return { status: typeof record.status === 'string' ? record.status : 'disabled', ds: record.ds ?? null };
    },

    // ------------------------------------------------------------------------------- purge
    /**
     * `POST /zones/:id/purge_cache`. Cloudflare accepts exactly one purge target per call; sending
     * two is an error rather than a union, so the caller's choice is validated before egress.
     */
    async purgeCache(zoneId, options = {}) {
      const targets = [];
      if (options.everything === true) targets.push({ everything: true });
      if (Array.isArray(options.files) && options.files.length > 0) targets.push({ files: options.files });
      if (Array.isArray(options.tags) && options.tags.length > 0) targets.push({ tags: options.tags });
      if (Array.isArray(options.hosts) && options.hosts.length > 0) targets.push({ hosts: options.hosts });
      if (targets.length === 0) {
        throw new CloudflareError('CLOUDFLARE_REJECTED', 'A cache purge needs one target: everything, files, tags or hosts', { retryable: false });
      }
      if (targets.length > 1) {
        throw new CloudflareError('CLOUDFLARE_REJECTED', 'Cloudflare accepts exactly one purge target per request', { retryable: false });
      }
      const { result } = await request('POST', `/zones/${encodeURIComponent(zoneId)}/purge_cache`, targets[0]);
      return { purged: result?.id !== undefined || result === null || typeof result === 'object', id: result?.id ?? null };
    },

    // ---------------------------------------------------------------------------- analytics
    /**
     * Zone traffic for the last `days` days, from Cloudflare's own GraphQL analytics endpoint.
     *
     * The REST `/analytics/dashboard` route is deprecated, so this speaks the current one. GraphQL
     * answers errors with HTTP 200 and an `errors` array, which `readEnvelope` handles by treating
     * the body as authoritative — the failure surfaces as a `CloudflareError` rather than as an
     * empty-but-successful dashboard, which is precisely the lie the old `DATA_UNAVAILABLE` answer
     * was there to avoid.
     *
     * A metric Cloudflare reports no datapoints for stays `null` for that day and is counted in
     * `missingDays`; it is never zero-filled, because "no traffic recorded" and "zero requests" are
     * different facts.
     */
    async zoneAnalytics(zoneId, { days = 7 } = {}) {
      const boundedDays = Math.min(Math.max(Number(days) || 7, 1), 30);
      const query = `query ZoneTraffic($zoneTag: String!, $limit: Int!) {
  viewer {
    zones(filter: { zoneTag: $zoneTag }) {
      httpRequests1dGroups(limit: $limit, orderBy: [date_ASC]) {
        dimensions { date }
        sum { requests bytes threats cachedRequests }
      }
    }
  }
}`;
      const { result } = await request('POST', '/graphql', { query, variables: { zoneTag: zoneId, limit: boundedDays } });
      // GraphQL answers 200 with `errors[]`; the client's envelope read turns that into a throw, so a
      // body reaching here is a genuine payload. A payload *without* `data` is still not one.
      const groups = result?.data?.viewer?.zones?.[0]?.httpRequests1dGroups;
      if (!Array.isArray(groups)) {
        throw new CloudflareError('CLOUDFLARE_INVALID_RESPONSE', 'Cloudflare analytics returned no zone series', { retryable: false });
      }
      const timeseries = groups.map((group) => ({
        date: group?.dimensions?.date ?? null,
        requests: finiteOrNull(group?.sum?.requests),
        bandwidth: finiteOrNull(group?.sum?.bytes),
        threats: finiteOrNull(group?.sum?.threats),
        cached: finiteOrNull(group?.sum?.cachedRequests),
      }));
      const metrics = ['requests', 'bandwidth', 'threats', 'cached'];
      const totals = {};
      for (const metric of metrics) {
        const values = timeseries.map((point) => point[metric]).filter((value) => value !== null);
        totals[metric] = values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0);
      }
      return {
        totals,
        timeseries,
        days: boundedDays,
        missingDays: timeseries.filter((point) => metrics.some((metric) => point[metric] === null)).length,
      };
    },
  };

  return api;
}

/**
 * A metric Cloudflare did not report stays `null`.
 *
 * `Number(null)` is `0`, so a naive coercion turns "Cloudflare has no datapoints for this day" into
 * "zero requests" — a fabricated figure, and precisely the kind the previous `DATA_UNAVAILABLE`
 * answer existed to avoid. Absent, empty and non-numeric all mean the same thing here: not reported.
 */
function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Only the documented, writable fields cross the wire; `undefined` values are dropped by JSON. */
function dnsRecordBody(record = {}) {
  const body = {};
  for (const key of ['type', 'name', 'content', 'ttl', 'proxied', 'priority', 'comment']) {
    if (record[key] !== undefined) body[key] = record[key];
  }
  return body;
}

function normalizeZone(zone) {
  const record = zone && typeof zone === 'object' ? zone : {};
  const nameServers = Array.isArray(record.name_servers) ? record.name_servers.filter((ns) => typeof ns === 'string') : [];
  const status = typeof record.status === 'string' ? record.status : null;
  return {
    id: typeof record.id === 'string' ? record.id : null,
    name: typeof record.name === 'string' ? record.name : null,
    status,
    // Derived, never invented: Cloudflare serves traffic only once the zone reports `active`, and the
    // platform's `activation_status` column means exactly that.
    activationStatus: status === 'active' ? 'active' : 'pending',
    type: typeof record.type === 'string' ? record.type : null,
    paused: record.paused === true,
    nameServers,
    accountId: record.account?.id ?? null,
    plan: record.plan?.name ?? null,
    createdAt: record.created_on ?? null,
  };
}

function normalizeDnsRecord(record) {
  const row = record && typeof record === 'object' ? record : {};
  return {
    id: typeof row.id === 'string' ? row.id : null,
    type: typeof row.type === 'string' ? row.type : null,
    name: typeof row.name === 'string' ? row.name : null,
    content: row.content ?? null,
    ttl: Number.isFinite(Number(row.ttl)) ? Number(row.ttl) : null,
    proxied: row.proxied === true,
    priority: row.priority ?? null,
    comment: row.comment ?? null,
    // Read from Cloudflare's own ownership marker: a record it created for a hosting integration must
    // stay system-managed, and a record a customer added is theirs. Nothing is inferred locally.
    ownership: row.source === 'cloudflare' || row.meta?.managed_by_apps === true ? 'SYSTEM_MANAGED' : 'CUSTOMER_MANAGED',
  };
}

function normalizeAccessRule(rule) {
  const row = rule && typeof rule === 'object' ? rule : {};
  return {
    id: typeof row.id === 'string' ? row.id : null,
    target: row.configuration?.target ?? null,
    value: row.configuration?.value ?? null,
    mode: row.mode ?? null,
    notes: row.notes ?? null,
  };
}

module.exports = {
  createCloudflareClient,
  CloudflareError,
  CLOUDFLARE_FAILURE_CODES,
  CUSTOMER_MESSAGES,
  cloudflareErrorToHttpError,
  errorEvidence,
  resolveAccountCredential,
  resolveBaseUrl,
  normalizeZone,
  normalizeDnsRecord,
  DEFAULT_BASE_URL,
};
