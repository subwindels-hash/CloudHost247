/**
 * ACME (RFC 8555) client — the certificate-issuance half of the SSL module.
 *
 * Written in-tree on `node:crypto` for the same reason the WebAuthn stack is: the ACME protocol is
 * a small, well-specified surface (JWS + a handful of JSON resources), and adding a dependency to
 * this deployment is a decision nobody has authorised. Nothing here is invented — every request
 * shape and every status value comes from RFC 8555 and is named in the comment above the code that
 * sends it.
 *
 * What this module is NOT allowed to do, by construction:
 *   - it never decides that a certificate is valid because a `200` came back. The certificate is
 *     re-parsed with `node:crypto`'s X509Certificate and its own `validTo`/`validFrom`/SANs are
 *     what get stored (see `parseIssuedCertificate` in ./certificate.ts);
 *   - it never claims a challenge "passed" on its own word — it only reports the authorization
 *     status ACME returned, and the caller stores exactly that;
 *   - it never fabricates a certificate. If there is no account, no reachable directory, or no
 *     completed challenge, the call fails with a named error and the row stays PENDING/FAILED.
 *
 * The transport is injectable (`fetchImpl`) so the whole flow can be exercised against a loopback
 * fake ACME server — which is the only way this repo allows provider behaviour to be verified
 * without a provider account (see tests/helpers/mock-cloudflare.ts for the established pattern).
 */
import { createHash, X509Certificate, createPrivateKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

/**
 * The JWK members ACME actually uses. Declared here rather than relying on the DOM `AcmeJwk`
 * global, which is not present in this project's TypeScript lib set (the server never assumes a
 * DOM), and rather than `any`, so a typo in `crv`/`x`/`y` is a compile error.
 */
export interface AcmeJwk {
  kty: 'EC' | 'RSA';
  crv?: string;
  x?: string;
  y?: string;
  n?: string;
  e?: string;
  [member: string]: unknown;
}

export type AcmeChallengeType = 'HTTP_01' | 'DNS_01';

export interface AcmeDirectory {
  newNonce: string;
  newAccount: string;
  newOrder: string;
  revokeCert?: string;
  keyChange?: string;
  /** RFC 8555 §7.3.3 — only present when the server supports it. */
  renewalInfo?: string;
  meta?: {
    termsOfService?: string;
    website?: string;
    caaIdentities?: string[];
    externalAccountRequired?: boolean;
  };
}

export interface AcmeAccountKey {
  /** The private key as a JWK (this is the only place the key exists; the caller encrypts it). */
  jwk: AcmeJwk;
  privateKey: KeyObject;
  /** RFC 7638 thumbprint, used as the `jwk`-less `kid` fallback and for DNS-01 TXT values. */
  thumbprint: string;
}

export interface AcmeOrder {
  url: string;
  status: string;
  expires?: string;
  identifiers: { type: string; value: string }[];
  authorizations: string[];
  finalize: string;
  certificate?: string;
  error?: { type: string; detail: string; status?: number };
}

export interface AcmeAuthorization {
  url: string;
  status: string;
  identifier: { type: string; value: string };
  expires?: string;
  challenges: AcmeChallenge[];
}

export interface AcmeChallenge {
  type: string;
  url: string;
  status: string;
  token: string;
  validated?: string;
  error?: { type: string; detail: string; status?: number };
}

export interface AcmeProblem {
  type: string;
  detail: string;
  status?: number;
  subproblems?: { type: string; detail: string; identifier?: { type: string; value: string } }[];
}

/**
 * A named, typed failure. The `code` is what the route maps to an HTTP status and what the test
 * asserts on, so a caller can never accidentally treat "the CA said no" as "the certificate is
 * pending".
 */
export class AcmeError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly problem: AcmeProblem | null;
  readonly retryable: boolean;

  constructor(
    code: string,
    message: string,
    opts: { status?: number | null; problem?: AcmeProblem | null; retryable?: boolean } = {}
  ) {
    super(message);
    this.name = 'AcmeError';
    this.code = code;
    this.status = opts.status ?? null;
    this.problem = opts.problem ?? null;
    this.retryable = opts.retryable ?? false;
  }
}

const b64url = (input: Buffer | string): string =>
  Buffer.from(input).toString('base64url');

/** RFC 7638 §3: SHA-256 over the canonical JSON of the required members, lexicographic order. */
export function jwkThumbprint(jwk: AcmeJwk): string {
  if (jwk.kty === 'EC') {
    const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
    return createHashSha256B64url(canonical);
  }
  if (jwk.kty === 'RSA') {
    const canonical = JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n });
    return createHashSha256B64url(canonical);
  }
  throw new AcmeError('UNSUPPORTED_ACCOUNT_KEY', `Only EC and RSA account keys are supported, got ${jwk.kty}`);
}

function createHashSha256B64url(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64url');
}

/**
 * Generates the P-256 account key. ES256 is the profile every public CA accepts and is far
 * smaller than an RSA key, which matters because it is encrypted and stored per account.
 */
export function generateAccountKey(): AcmeAccountKey {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = privateKey.export({ format: 'jwk' }) as AcmeJwk;
  return { jwk, privateKey, thumbprint: jwkThumbprint(jwk) };
}

/** Rehydrates a stored account key from its JWK (the private key is never reconstructed from PEM). */
export function accountKeyFromJwk(jwk: AcmeJwk): AcmeAccountKey {
  const privateKey = createPrivateKey({ key: jwk as never, format: 'jwk' });
  return { jwk, privateKey, thumbprint: jwkThumbprint(jwk) };
}

/**
 * RFC 8555 §6.2 — a flat JSON Web Signature over the request payload.
 *
 * `kid` is used once the account exists; `jwk` is used only for newAccount. Sending both is a
 * protocol error, so the two are mutually exclusive here by construction rather than by discipline.
 */
export function createJws(
  account: AcmeAccountKey,
  url: string,
  payload: unknown | null,
  opts: { kid?: string | null; nonce: string }
): { body: string; protectedHeader: Record<string, unknown> } {
  const protectedHeader: Record<string, unknown> = {
    alg: 'ES256',
    nonce: opts.nonce,
    url,
  };
  if (opts.kid) {
    protectedHeader.kid = opts.kid;
  } else {
    protectedHeader.jwk = account.jwk;
  }

  const protected64 = b64url(JSON.stringify(protectedHeader));
  // `null` payload means "POST-as-GET" (RFC 8555 §6.3) — an empty payload, NOT the string "null".
  const payload64 = payload === null ? '' : b64url(JSON.stringify(payload));
  const signingInput = `${protected64}.${payload64}`;

  // ES256 requires the raw 64-byte r||s form, not DER — `ieee-p1363` is exactly that.
  const signature = sign('sha256', Buffer.from(signingInput, 'utf8'), {
    key: account.privateKey,
    dsaEncoding: 'ieee-p1363',
  });

  return {
    body: JSON.stringify({ protected: protected64, payload: payload64, signature: b64url(signature) }),
    protectedHeader,
  };
}

/**
 * DNS-01 TXT value: `base64url(SHA-256(keyAuthorization))`, where keyAuthorization is
 * `token || '.' || thumbprint` (RFC 8555 §8.4 / §8.1).
 */
export function dns01TxtValue(token: string, thumbprint: string): string {
  return createHash('sha256').update(`${token}.${thumbprint}`, 'utf8').digest('base64url');
}

/** HTTP-01 body: the key authorization itself (RFC 8555 §8.3). */
export function http01ResponseBody(token: string, thumbprint: string): string {
  return `${token}.${thumbprint}`;
}

export interface AcmeClientOptions {
  /** Base directory URL, e.g. https://acme-v02.api.letsencrypt.org/directory */
  directoryUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Smallest interval the client will wait between order polls; the server's Retry-After wins. */
  pollIntervalMs?: number;
  maxPolls?: number;
  sleep?: (ms: number) => Promise<void>;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export class AcmeClient {
  private readonly directoryUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly maxPolls: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private directory: AcmeDirectory | null = null;
  private nonce: string | null = null;

  constructor(opts: AcmeClientOptions) {
    this.directoryUrl = opts.directoryUrl;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.pollIntervalMs = opts.pollIntervalMs ?? 1_000;
    this.maxPolls = opts.maxPolls ?? 30;
    // Real-time polling in production, injectable so tests do not wait.
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** RFC 8555 §7.1.1 — the directory is fetched once and cached for the client's lifetime. */
  async getDirectory(): Promise<AcmeDirectory> {
    if (this.directory) return this.directory;
    const res = await this.request('GET', this.directoryUrl, { signed: false });
    const json = res.json as Partial<AcmeDirectory> | null;
    if (!json?.newNonce || !json.newAccount || !json.newOrder) {
      throw new AcmeError('DIRECTORY_INVALID', 'ACME directory is missing newNonce/newAccount/newOrder', {
        status: res.status,
      });
    }
    this.directory = json as AcmeDirectory;
    return this.directory;
  }

  /**
   * RFC 8555 §7.2 — every response carries a fresh `Replay-Nonce`; reusing one is the single most
   * common ACME implementation bug. The nonce is consumed by the next signed request and refilled
   * from the response, or fetched from `newNonce` when we have none.
   */
  private async takeNonce(): Promise<string> {
    if (this.nonce) {
      const nonce = this.nonce;
      this.nonce = null;
      return nonce;
    }
    const directory = await this.getDirectory();
    const res = await this.request('HEAD', directory.newNonce, { signed: false });
    if (!res.nonce) throw new AcmeError('NONCE_MISSING', 'ACME server did not return a Replay-Nonce', { status: res.status });
    return res.nonce;
  }

  private async request(
    method: 'GET' | 'HEAD' | 'POST',
    url: string,
    opts: { signed: boolean; body?: string; accept?: string }
  ): Promise<{ status: number; json: unknown; text: string; nonce: string | null; location: string | null }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        method,
        headers: {
          ...(opts.signed ? { 'content-type': 'application/jose+json' } : {}),
          accept: opts.accept ?? 'application/json',
        },
        ...(method === 'POST' ? { body: opts.body } : {}),
        signal: controller.signal,
      });

      const text = method === 'HEAD' ? '' : await res.text();
      let json: unknown = null;
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
      }

      if (res.status >= 400) {
        const problem = (json && typeof json === 'object' ? json : null) as AcmeProblem | null;
        const retryable = RETRYABLE_STATUS.has(res.status);
        throw new AcmeError(
          problem?.type ? problemTypeCode(problem.type) : 'ACME_HTTP_ERROR',
          problem?.detail ?? `ACME request failed with HTTP ${res.status}`,
          { status: res.status, problem, retryable }
        );
      }

      return {
        status: res.status,
        json,
        text,
        nonce: res.headers.get('replay-nonce'),
        location: res.headers.get('location'),
      };
    } catch (err) {
      if (err instanceof AcmeError) throw err;
      // A transport failure is retryable but must never be reported as success.
      throw new AcmeError('ACME_UNREACHABLE', `Could not reach the ACME server: ${(err as Error).message}`, {
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async signedPost(
    account: AcmeAccountKey,
    url: string,
    payload: unknown | null,
    opts: { kid?: string | null; accept?: string } = {}
  ): Promise<{ status: number; json: unknown; text: string; nonce: string | null; location: string | null }> {
    const nonce = await this.takeNonce();
    const jws = createJws(account, url, payload, { kid: opts.kid ?? null, nonce });
    const res = await this.request('POST', url, { signed: true, body: jws.body, accept: opts.accept });
    if (res.nonce) this.nonce = res.nonce;
    return res;
  }

  /**
   * RFC 8555 §7.3 — create (or fetch, if the key is already registered) the account.
   *
   * `onlyReturnExisting: false` makes this idempotent: a second call with the same key returns the
   * same account URL with `200` rather than `201`, which is why the caller can safely retry.
   */
  async newAccount(
    account: AcmeAccountKey,
    opts: { contactEmail?: string; termsOfServiceAgreed?: boolean }
  ): Promise<{ url: string; status: string; created: boolean }> {
    const directory = await this.getDirectory();
    const payload: Record<string, unknown> = {
      termsOfServiceAgreed: opts.termsOfServiceAgreed ?? true,
    };
    if (opts.contactEmail) payload.contact = [`mailto:${opts.contactEmail}`];

    const res = await this.signedPost(account, directory.newAccount, payload);
    if (!res.location) {
      throw new AcmeError('ACCOUNT_URL_MISSING', 'ACME server did not return an account URL', { status: res.status });
    }
    const body = res.json as { status?: string } | null;
    return { url: res.location, status: body?.status ?? 'valid', created: res.status === 201 };
  }

  /** RFC 8555 §7.4 — submit an order for one or more identifiers. */
  async newOrder(
    account: AcmeAccountKey,
    accountUrl: string,
    identifiers: { type: 'dns'; value: string }[]
  ): Promise<AcmeOrder> {
    const directory = await this.getDirectory();
    const res = await this.signedPost(account, directory.newOrder, { identifiers }, { kid: accountUrl });
    if (!res.location) throw new AcmeError('ORDER_URL_MISSING', 'ACME server did not return an order URL', { status: res.status });
    return { ...(res.json as AcmeOrder), url: res.location };
  }

  /** POST-as-GET of an order (RFC 8555 §7.4 / §6.3). */
  async getOrder(account: AcmeAccountKey, accountUrl: string, orderUrl: string): Promise<AcmeOrder> {
    const res = await this.signedPost(account, orderUrl, null, { kid: accountUrl });
    return { ...(res.json as AcmeOrder), url: orderUrl };
  }

  /** POST-as-GET of one authorization (RFC 8555 §7.5). */
  async getAuthorization(account: AcmeAccountKey, accountUrl: string, authUrl: string): Promise<AcmeAuthorization> {
    const res = await this.signedPost(account, authUrl, null, { kid: accountUrl });
    return { ...(res.json as AcmeAuthorization), url: authUrl };
  }

  /**
   * RFC 8555 §7.5.1 — ask the server to validate a challenge.
   *
   * The returned status is the server's, verbatim. A `pending` here is not "almost done"; it is
   * "not done", and the caller polls (`pollAuthorization`) rather than guessing.
   */
  async acceptChallenge(account: AcmeAccountKey, accountUrl: string, challengeUrl: string): Promise<AcmeChallenge> {
    const res = await this.signedPost(account, challengeUrl, {}, { kid: accountUrl });
    return res.json as AcmeChallenge;
  }

  /**
   * Polls one authorization until it leaves `pending`, or the budget runs out.
   *
   * Returns the last observed authorization either way, so the caller can persist a truthful
   * intermediate state (`VALIDATING`) instead of inventing a verdict. The 60-second cap is
   * deliberately finite: a challenge that never resolves must surface as a failure the customer can
   * act on, not as a request that hangs.
   */
  async pollAuthorization(
    account: AcmeAccountKey,
    accountUrl: string,
    authUrl: string
  ): Promise<AcmeAuthorization> {
    let last: AcmeAuthorization | null = null;
    for (let attempt = 0; attempt < this.maxPolls; attempt += 1) {
      last = await this.getAuthorization(account, accountUrl, authUrl);
      if (last.status !== 'pending') return last;
      await this.sleep(this.pollIntervalMs);
    }
    if (!last) throw new AcmeError('AUTHORIZATION_MISSING', 'No authorization was returned for this order');
    return last;
  }

  /**
   * RFC 8555 §7.4 — submit the CSR. `payload.csr` is base64url DER, exactly as the spec requires.
   */
  async finalizeOrder(
    account: AcmeAccountKey,
    accountUrl: string,
    finalizeUrl: string,
    csrDer: Buffer
  ): Promise<AcmeOrder> {
    const res = await this.signedPost(account, finalizeUrl, { csr: b64url(csrDer) }, { kid: accountUrl });
    return { ...(res.json as AcmeOrder), url: finalizeUrl };
  }

  /**
   * Polls the order until it is `valid` (certificate issued) or `invalid`.
   *
   * On success the certificate URL from the order is downloaded and returned as PEM. The PEM is
   * then re-parsed by the caller with X509Certificate — this function does not certify its own
   * output.
   */
  async downloadCertificate(account: AcmeAccountKey, accountUrl: string, certificateUrl: string): Promise<string> {
    const res = await this.signedPost(account, certificateUrl, null, {
      kid: accountUrl,
      accept: 'application/pem-certificate-chain',
    });
    const pem = res.text.trim();
    if (!pem.includes('BEGIN CERTIFICATE')) {
      throw new AcmeError('CERTIFICATE_INVALID', 'ACME server returned a body that is not a PEM certificate chain');
    }
    return pem;
  }

  /**
   * Waits for an order to reach a terminal state after finalization, then downloads the chain.
   *
   * Returns `{ status, certificatePem }`: `certificatePem` is non-null ONLY when the order is
   * `valid` AND the chain parses. Every other terminal state returns the order's own status so the
   * caller can store it.
   */
  async awaitIssuance(
    account: AcmeAccountKey,
    accountUrl: string,
    orderUrl: string
  ): Promise<{ status: string; order: AcmeOrder; certificatePem: string | null }> {
    let order = await this.getOrder(account, accountUrl, orderUrl);
    for (let attempt = 0; attempt < this.maxPolls; attempt += 1) {
      if (order.status === 'valid' && order.certificate) {
        const pem = await this.downloadCertificate(account, accountUrl, order.certificate);
        // Parsing here is a guard, not a formality: an unparseable chain must not be stored as issued.
        try {
          new X509Certificate(pem);
        } catch {
          throw new AcmeError('CERTIFICATE_INVALID', 'The issued certificate chain could not be parsed');
        }
        return { status: 'valid', order, certificatePem: pem };
      }
      if (order.status === 'invalid') return { status: 'invalid', order, certificatePem: null };
      await this.sleep(this.pollIntervalMs);
      order = await this.getOrder(account, accountUrl, orderUrl);
    }
    return { status: order.status, order, certificatePem: null };
  }

  /** RFC 8555 §7.6 — revoke a certificate, signed by the account that owns it. */
  async revokeCertificate(
    account: AcmeAccountKey,
    accountUrl: string,
    certificatePem: string,
    reason = 0
  ): Promise<void> {
    const directory = await this.getDirectory();
    if (!directory.revokeCert) {
      throw new AcmeError('REVOCATION_UNSUPPORTED', 'This ACME server does not advertise revokeCert');
    }
    const der = pemToDer(certificatePem);
    await this.signedPost(
      account,
      directory.revokeCert,
      { certificate: b64url(der), reason },
      { kid: accountUrl }
    );
  }
}

/** Turns an ACME problem type URL into a stable code the API and tests can rely on. */
function problemTypeCode(type: string): string {
  const urnPrefix = 'urn:ietf:params:acme:error:';
  const short = type.startsWith(urnPrefix) ? type.slice(urnPrefix.length) : type.split('/').pop() ?? type;
  return `ACME_${short.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}`;
}

/** Strips the PEM armour and returns DER, which is what every ACME payload wants. */
export function pemToDer(pem: string): Buffer {
  const match = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/.exec(pem);
  if (!match?.[1]) throw new AcmeError('CERTIFICATE_INVALID', 'No PEM certificate block was found');
  return Buffer.from(match[1].replace(/\s+/g, ''), 'base64');
}

/** Convenience for callers that only need to know the key pair type is supported. */
export function assertSupportedAccountKey(jwk: AcmeJwk): void {
  if (jwk.kty !== 'EC' && jwk.kty !== 'RSA') {
    throw new AcmeError('UNSUPPORTED_ACCOUNT_KEY', `Unsupported account key type: ${jwk.kty ?? 'missing'}`);
  }
}
