/**
 * SSL issuance orchestration — the layer that turns an ACME conversation into a truthful row.
 *
 * The contract this file enforces, in one place:
 *
 *   1. **A certificate is only stored as ISSUED when the CA issued one and it parses, covers every
 *      requested name, and is currently valid.** Anything else stores the state that actually
 *      happened (PENDING / VALIDATING / FAILED) with the CA's own reason.
 *   2. **`expires_at` comes from the certificate's `validTo`, never from a duration constant.**
 *      (The prior implementation set it from `+90 days` or left it null; both are guesses.)
 *   3. **A challenge is never marked valid locally.** Only the authorization status returned by the
 *      CA moves it, which is why a test that never completes the challenge leaves the row PENDING.
 *   4. **A missing CA configuration is a 503, not a fake success.** With `ACME_DIRECTORY_URL`
 *      unset, `assertConfigured()` throws `SSL_ISSUANCE_NOT_CONFIGURED` and nothing is written.
 *
 * The service takes an `AcmeClient` (or a factory) so tests can point it at a loopback CA, and the
 * production path builds the real client from env.
 */
import { randomUUID } from 'node:crypto';
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import { withTransaction } from '../db/transaction';
import { buildKeyRing, encryptSecret, decryptSecret, type EncryptionKeyRing } from '../lib/crypto';
import { ConflictError, NotFoundError } from '../lib/errors';
import {
  AcmeClient,
  AcmeError,
  accountKeyFromJwk,
  dns01TxtValue,
  http01ResponseBody,
  type AcmeAccountKey,
  type AcmeJwk,
} from './acme-client';
import {
  assertCertificateCoversRequest,
  buildCsr,
  parseIssuedCertificate,
  type ParsedCertificate,
} from './certificate';

/** The code a route maps to `503` when the operator has not configured a CA. */
export const SSL_ISSUANCE_NOT_CONFIGURED = 'SSL_ISSUANCE_NOT_CONFIGURED';

export interface SslCertificateLike {
  id: string;
  user_id: string;
  domain_name: string;
  sans: string[];
  status: string;
  challenge_type: string;
  certificate_pem: string | null;
}

export interface IssuanceResult {
  status: 'ISSUED' | 'PENDING' | 'VALIDATING' | 'FAILED';
  certificatePem: string | null;
  /** Only present when the CA actually issued. Every field is read from the certificate. */
  parsed: ParsedCertificate | null;
  /** The CA's own refusal, when there is one. Never a paraphrase. */
  failureReason: string | null;
  /** Challenges the caller must satisfy before issuance can complete (HTTP-01/DNS-01). */
  pendingChallenges: {
    id: string;
    type: 'HTTP_01' | 'DNS_01';
    authorizationUrl: string;
    token: string;
    /** What to publish: the `.well-known` body for HTTP-01, the TXT value for DNS-01. */
    publish: string;
    status: string;
  }[];
}

export interface IssuanceDeps {
  env: Env;
  pool: Queryable;
  keyRing?: EncryptionKeyRing;
  /** Overrides the client entirely (tests point this at a loopback CA). */
  clientFactory?: (directoryUrl: string) => AcmeClient;
}

class NotConfiguredError extends Error {
  readonly code = SSL_ISSUANCE_NOT_CONFIGURED;
  constructor() {
    super(
      'No ACME certificate authority is configured. Set ACME_DIRECTORY_URL to issue real certificates; nothing was requested from any CA.'
    );
    this.name = 'NotConfiguredError';
  }
}

/**
 * The key ring for this operation, built from the env the caller handed us.
 *
 * Deliberately NOT the process-wide `getKeyRing()`: that reads `process.env` (and caches a value per
 * process), so a service called with an explicit env — as the routes do, and as every test does —
 * would silently use a different key than the one that env names. Building from `deps.env` is the
 * same pattern `totp-mfa-service.ts` uses, and it keeps the injection contract honest.
 */
function resolveKeyRing(deps: IssuanceDeps): EncryptionKeyRing {
  return (
    deps.keyRing ?? buildKeyRing(deps.env.CREDENTIAL_ENCRYPTION_KEY, deps.env.CREDENTIAL_ENCRYPTION_KEYS)
  );
}

export function assertIssuanceConfigured(env: Env): string {
  if (!env.ACME_DIRECTORY_URL) throw new NotConfiguredError();
  return env.ACME_DIRECTORY_URL;
}

/** The identifiers an order covers: the CN plus every SAN, de-duplicated and lower-cased. */
export function orderedDnsNames(cert: Pick<SslCertificateLike, 'domain_name' | 'sans'>): string[] {
  return Array.from(
    new Set([cert.domain_name, ...(cert.sans ?? [])].map((n) => n.trim().toLowerCase()).filter(Boolean))
  ).sort();
}

/**
 * Returns the account for this directory, creating and persisting one on first use.
 *
 * The key is generated locally, registered with `newAccount`, and stored encrypted in the same
 * transaction that records the account URL — so a crash mid-way cannot leave an account row whose
 * key is missing, nor a key with no account URL.
 */
async function getOrCreateAccount(
  deps: IssuanceDeps,
  client: AcmeClient,
  directoryUrl: string
): Promise<{ id: string; key: AcmeAccountKey; accountUrl: string }> {
  const ring = resolveKeyRing(deps);
  const existing = await deps.pool.query<{
    id: string;
    account_url: string | null;
    account_key_encrypted: string;
  }>(
    'SELECT id, account_url, account_key_encrypted FROM acme_accounts WHERE directory_url = $1 LIMIT 1',
    [directoryUrl]
  );
  const row = existing.rows[0];

  if (row?.account_url) {
    const jwk = JSON.parse(decryptSecret(ring, row.account_key_encrypted)) as AcmeJwk;
    return { id: row.id, key: accountKeyFromJwk(jwk), accountUrl: row.account_url };
  }

  // No usable account yet — register one.
  const { generateAccountKey } = await import('./acme-client');
  const key = generateAccountKey();
  const registered = await client.newAccount(key, {
    contactEmail: deps.env.ACME_CONTACT_EMAIL,
    termsOfServiceAgreed: true,
  });
  const envelope = encryptSecret(ring, JSON.stringify(key.jwk));
  const id = row?.id ?? randomUUID();

  if (row) {
    await deps.pool.query(
      `UPDATE acme_accounts
          SET account_url = $1, account_key_encrypted = $2, status = 'valid',
              contact_email = $3, terms_of_service_agreed_at = now(), updated_at = now()
        WHERE id = $4`,
      [registered.url, envelope, deps.env.ACME_CONTACT_EMAIL ?? null, id]
    );
  } else {
    await deps.pool.query(
      `INSERT INTO acme_accounts
         (id, directory_url, account_url, account_key_encrypted, contact_email, terms_of_service_agreed_at)
       VALUES ($1, $2, $3, $4, $5, now())`,
      [id, directoryUrl, registered.url, envelope, deps.env.ACME_CONTACT_EMAIL ?? null]
    );
  }

  return { id, key, accountUrl: registered.url };
}

function describeAcmeFailure(err: unknown): string {
  if (err instanceof AcmeError) {
    const problem = err.problem?.detail ? `: ${err.problem.detail}` : '';
    return `${err.code}${problem}`;
  }
  return (err as Error).message ?? 'The certificate authority request failed';
}

/**
 * Starts (or resumes) issuance for one certificate row.
 *
 * Two entry points behave differently on purpose:
 *   - the first call creates an order with the CA and records the challenges the customer must
 *     satisfy; it returns `PENDING` with those challenges.
 *   - a later call, after the challenges have been satisfied, re-reads the order and finalizes.
 *
 * Both are the same function: the state the row is in decides what happens next, so a retried
 * request cannot create a second order for the same certificate while one is already in flight.
 */
export async function startOrResumeIssuance(
  deps: IssuanceDeps,
  cert: SslCertificateLike
): Promise<IssuanceResult> {
  const directoryUrl = assertIssuanceConfigured(deps.env);
  const client = deps.clientFactory
    ? deps.clientFactory(directoryUrl)
    : new AcmeClient({
        directoryUrl,
        timeoutMs: 20_000,
        pollIntervalMs: deps.env.ACME_POLL_INTERVAL_MS,
        maxPolls: Math.max(1, Math.floor(deps.env.ACME_VALIDATION_TIMEOUT_MS / deps.env.ACME_POLL_INTERVAL_MS)),
      });

  const account = await getOrCreateAccount(deps, client, directoryUrl);
  const names = orderedDnsNames(cert);

  const pending = await deps.pool.query<{
    id: string;
    authorization_url: string;
    challenge_url: string | null;
    challenge_type: 'HTTP_01' | 'DNS_01';
    token: string;
    key_authorization: string;
    status: string;
  }>(
    `SELECT id, authorization_url, challenge_url, challenge_type, token, key_authorization, status
       FROM acme_challenges
      WHERE certificate_id = $1 AND status <> 'invalid'
      ORDER BY created_at ASC`,
    [cert.id]
  );

  // --- No order yet: create one.
  if (pending.rows.length === 0) {
    let order;
    try {
      order = await client.newOrder(
        account.key,
        account.accountUrl,
        names.map((value) => ({ type: 'dns' as const, value }))
      );
    } catch (err) {
      const reason = describeAcmeFailure(err);
      await deps.pool.query(
        `UPDATE ssl_certificates SET status = 'FAILED', metadata = $2::jsonb, updated_at = now() WHERE id = $1`,
        [cert.id, JSON.stringify({ issuanceError: reason, failedAt: new Date().toISOString() })]
      );
      return { status: 'FAILED', certificatePem: null, parsed: null, failureReason: reason, pendingChallenges: [] };
    }

    const created: IssuanceResult['pendingChallenges'] = [];
    for (const authorizationUrl of order.authorizations) {
      const auth = await client.getAuthorization(account.key, account.accountUrl, authorizationUrl);
      const challenge = auth.challenges.find((c) => c.type === 'http-01') ?? auth.challenges[0];
      if (!challenge) continue;

      const challengeType: 'HTTP_01' | 'DNS_01' =
        cert.challenge_type === 'DNS_01' && challenge.type === 'dns-01' ? 'DNS_01' : 'HTTP_01';
      const publish =
        challengeType === 'DNS_01'
          ? dns01TxtValue(challenge.token, account.key.thumbprint)
          : http01ResponseBody(challenge.token, account.key.thumbprint);

      const id = randomUUID();
      await deps.pool.query(
        `INSERT INTO acme_challenges
           (id, certificate_id, account_id, authorization_url, challenge_url, challenge_type,
            token, key_authorization, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
         ON CONFLICT (authorization_url) DO UPDATE
           SET challenge_url = EXCLUDED.challenge_url, token = EXCLUDED.token,
               key_authorization = EXCLUDED.key_authorization, updated_at = now()`,
        [id, cert.id, account.id, authorizationUrl, challenge.url, challengeType, challenge.token, publish]
      );

      created.push({
        id,
        type: challengeType,
        authorizationUrl,
        token: challenge.token,
        publish,
        status: 'pending',
      });
    }

    await deps.pool.query(
      `UPDATE ssl_certificates
          SET status = 'PENDING',
              metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
              updated_at = now()
        WHERE id = $1`,
      [cert.id, JSON.stringify({ acmeOrderUrl: order.url, acmeDirectory: directoryUrl, orderedNames: names })]
    );

    return {
      status: 'PENDING',
      certificatePem: null,
      parsed: null,
      failureReason: null,
      pendingChallenges: created,
    };
  }

  // --- An order exists: ask the CA what it is waiting for.
  const metadata = await deps.pool.query<{ metadata: Record<string, unknown> | null }>(
    'SELECT metadata FROM ssl_certificates WHERE id = $1',
    [cert.id]
  );
  const orderUrl = (metadata.rows[0]?.metadata as { acmeOrderUrl?: string } | null)?.acmeOrderUrl;
  if (!orderUrl) {
    const reason = 'ACME_ORDER_MISSING: challenge rows exist but the order URL was not recorded';
    return { status: 'FAILED', certificatePem: null, parsed: null, failureReason: reason, pendingChallenges: [] };
  }

  // Tell the CA we are ready for it to validate, then poll. Accepting a challenge is idempotent on
  // the server (a processing/valid challenge stays as it is), so re-running is safe.
  for (const row of pending.rows) {
    if (!row.challenge_url) continue;
    try {
      await client.acceptChallenge(account.key, account.accountUrl, row.challenge_url);
      await deps.pool.query(
        `UPDATE acme_challenges SET status = 'processing', updated_at = now() WHERE id = $1 AND status = 'pending'`,
        [row.id]
      );
    } catch (err) {
      await deps.pool.query(
        `UPDATE acme_challenges SET error_detail = $2, updated_at = now() WHERE id = $1`,
        [row.id, describeAcmeFailure(err)]
      );
    }
  }

  const stillPending: IssuanceResult['pendingChallenges'] = [];
  for (const row of pending.rows) {
    let auth;
    try {
      auth = await client.pollAuthorization(account.key, account.accountUrl, row.authorization_url);
    } catch (err) {
      await deps.pool.query(
        `UPDATE acme_challenges SET error_detail = $2, updated_at = now() WHERE id = $1`,
        [row.id, describeAcmeFailure(err)]
      );
      stillPending.push({
        id: row.id,
        type: row.challenge_type,
        authorizationUrl: row.authorization_url,
        token: row.token,
        publish: row.key_authorization,
        status: 'invalid',
      });
      continue;
    }

    // Only the CA's assertion moves this. `valid` here came from the CA's own response.
    await deps.pool.query(
      // Explicit casts: `$2` is compared against a text literal as well as written to a varchar
      // column, and Postgres refuses to infer one type for both ("inconsistent types deduced for
      // parameter $2"). Caught by the integration suite against a real Postgres.
      `UPDATE acme_challenges
          SET status = $2::varchar,
              error_detail = $3::text,
              validated_at = CASE WHEN $2::text = 'valid' THEN now() ELSE validated_at END,
              updated_at = now()
        WHERE id = $1`,
      [row.id, auth.status === 'valid' ? 'valid' : auth.status === 'invalid' ? 'invalid' : 'pending', null]
    );

    if (auth.status !== 'valid') {
      const errorDetail = auth.challenges.find((c) => c.status === 'invalid')?.error?.detail ?? null;
      stillPending.push({
        id: row.id,
        type: row.challenge_type,
        authorizationUrl: row.authorization_url,
        token: row.token,
        publish: row.key_authorization,
        status: auth.status,
      });
      if (errorDetail) {
        await deps.pool.query('UPDATE acme_challenges SET error_detail = $2 WHERE id = $1', [row.id, errorDetail]);
      }
    }
  }

  if (stillPending.length > 0) {
    // Not a failure yet: the CA simply has not finished. The row records the truth (VALIDATING)
    // and the caller gets the outstanding challenges back so the customer can act.
    await deps.pool.query(
      `UPDATE ssl_certificates SET status = 'VALIDATING', updated_at = now() WHERE id = $1 AND status = 'PENDING'`,
      [cert.id]
    );
    return {
      status: 'VALIDATING',
      certificatePem: null,
      parsed: null,
      failureReason: null,
      pendingChallenges: stillPending,
    };
  }

  // --- Every authorization is valid: finalize and download.
  const order = await client.getOrder(account.key, account.accountUrl, orderUrl);
  if (order.status === 'invalid') {
    const reason = order.error?.detail ?? 'The certificate authority marked the order invalid';
    await deps.pool.query(
      `UPDATE ssl_certificates SET status = 'FAILED', metadata = COALESCE(metadata,'{}'::jsonb) || $2::jsonb, updated_at = now() WHERE id = $1`,
      [cert.id, JSON.stringify({ issuanceError: reason })]
    );
    return { status: 'FAILED', certificatePem: null, parsed: null, failureReason: reason, pendingChallenges: [] };
  }

  const csr = buildCsr(names);
  if (!csr.selfVerified) {
    const reason = 'CSR_SELF_CHECK_FAILED: the generated key pair did not verify its own signature';
    return { status: 'FAILED', certificatePem: null, parsed: null, failureReason: reason, pendingChallenges: [] };
  }

  try {
    if (order.status === 'ready') {
      await client.finalizeOrder(account.key, account.accountUrl, order.finalize, csr.csrDer);
    }
    const issuance = await client.awaitIssuance(account.key, account.accountUrl, orderUrl);
    if (!issuance.certificatePem) {
      const reason = `ACME_ORDER_${issuance.status.toUpperCase()}: no certificate was issued`;
      await deps.pool.query(
        `UPDATE ssl_certificates SET status = 'FAILED', metadata = COALESCE(metadata,'{}'::jsonb) || $2::jsonb, updated_at = now() WHERE id = $1`,
        [cert.id, JSON.stringify({ issuanceError: reason })]
      );
      return { status: 'FAILED', certificatePem: null, parsed: null, failureReason: reason, pendingChallenges: [] };
    }

    // Re-verify the CA's output against the order before storing it.
    const parsed = parseIssuedCertificate(issuance.certificatePem);
    assertCertificateCoversRequest(parsed, names);

    // The private key is stored encrypted alongside the certificate; the caller that wants to
    // install it decrypts it. It is never returned from an endpoint.
    const ring = resolveKeyRing(deps);
    const keyEnvelope = encryptSecret(ring, csr.privateKeyPem);

    await withTransaction(deps.pool, async (tx) => {
      await tx.query(
        `UPDATE ssl_certificates
            SET status = 'ISSUED',
                certificate_pem = $2,
                private_key_encrypted = $3,
                expires_at = $4,
                metadata = COALESCE(metadata,'{}'::jsonb) || $5::jsonb,
                updated_at = now()
          WHERE id = $1 AND status <> 'REVOKED'`,
        [
          cert.id,
          issuance.certificatePem,
          keyEnvelope,
          parsed.validTo,
          JSON.stringify({
            issuedAt: new Date().toISOString(),
            validFrom: parsed.validFrom,
            serialNumber: parsed.serialNumber,
            fingerprint256: parsed.fingerprint256,
            sans: parsed.dnsNames,
            issuer: parsed.issuer,
            // Recorded so it is auditable that the CA, not this platform, certified the name.
            certificateSource: 'ACME',
          }),
        ]
      );
    });

    return {
      status: 'ISSUED',
      certificatePem: issuance.certificatePem,
      parsed,
      failureReason: null,
      pendingChallenges: [],
    };
  } catch (err) {
    const reason = describeAcmeFailure(err);
    await deps.pool.query(
      `UPDATE ssl_certificates SET status = 'FAILED', metadata = COALESCE(metadata,'{}'::jsonb) || $2::jsonb, updated_at = now() WHERE id = $1`,
      [cert.id, JSON.stringify({ issuanceError: reason, failedAt: new Date().toISOString() })]
    );
    return { status: 'FAILED', certificatePem: null, parsed: null, failureReason: reason, pendingChallenges: [] };
  }
}

/**
 * Reads the one challenge the HTTP-01 responder should serve for `(domain, token)`.
 *
 * Only `pending`/`processing` challenges are served: once an authorization is valid the CA will
 * never ask again, and continuing to answer keeps a stale token resolvable.
 */
export async function findHttp01Challenge(
  pool: Queryable,
  token: string
): Promise<{ keyAuthorization: string } | null> {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(token)) return null;
  const { rows } = await pool.query<{ key_authorization: string }>(
    `SELECT c.key_authorization
       FROM acme_challenges c
       JOIN ssl_certificates s ON s.id = c.certificate_id
      WHERE c.token = $1
        AND c.challenge_type = 'HTTP_01'
        AND c.status IN ('pending', 'processing')
        AND s.status IN ('PENDING', 'VALIDATING')
      LIMIT 1`,
    [token]
  );
  return rows[0] ? { keyAuthorization: rows[0].key_authorization } : null;
}

/** Revokes at the CA, and only then marks the row REVOKED. A CA refusal leaves the row intact. */
export async function revokeAtCa(
  deps: IssuanceDeps,
  cert: SslCertificateLike
): Promise<{ revokedAtCa: boolean; reason: string | null }> {
  const directoryUrl = deps.env.ACME_DIRECTORY_URL;
  if (!directoryUrl) {
    // No CA configured: there is nothing to revoke at a CA. The local record is still revocable,
    // but the caller must be told the CA was not contacted rather than assume it was.
    return { revokedAtCa: false, reason: SSL_ISSUANCE_NOT_CONFIGURED };
  }
  if (!cert.certificate_pem) {
    return { revokedAtCa: false, reason: 'NO_CERTIFICATE_MATERIAL' };
  }

  const client = deps.clientFactory ? deps.clientFactory(directoryUrl) : new AcmeClient({ directoryUrl });
  const account = await getOrCreateAccount(deps, client, directoryUrl);
  try {
    await client.revokeCertificate(account.key, account.accountUrl, cert.certificate_pem);
    return { revokedAtCa: true, reason: null };
  } catch (err) {
    return { revokedAtCa: false, reason: describeAcmeFailure(err) };
  }
}

export { NotFoundError, ConflictError, NotConfiguredError };
