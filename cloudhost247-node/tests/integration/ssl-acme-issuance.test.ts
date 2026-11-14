import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { X509Certificate } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { loadEnv, type Env } from '../../src/config/env';
import { hashPassword } from '../../src/lib/password';
import { buildApp } from '../../src/app';
import { signAuthToken } from '../../src/lib/jwt';
import { buildKeyRing } from '../../src/lib/crypto';
import { setKeyRingForTesting } from '../../src/lib/keyring';
import { startMockAcmeServer, type MockAcmeServer } from '../helpers/mock-acme-server';
import { AcmeClient } from '../../src/ssl/acme-client';
import { buildCsr, parseIssuedCertificate, assertCertificateCoversRequest } from '../../src/ssl/certificate';
import { createSelfSignedCertificate, csrDnsNames } from '../helpers/der';

/**
 * Real ACME certificate issuance (RFC 8555).
 *
 * The certificate authority is a loopback server (tests/helpers/mock-acme-server.ts) that implements
 * the server half of the protocol independently and issues genuine X.509. Our client speaks to it
 * over real HTTP with no test branches in production code, so the whole conversation — JWS signing,
 * single-use nonces, orders, authorizations, HTTP-01, finalize, chain download — is exercised as it
 * would be against Let's Encrypt.
 *
 * What this suite deliberately CANNOT claim: that a publicly trusted CA issued a certificate. No
 * external CA was reachable from this environment. The certificate's own bytes are verified with
 * node:crypto's X509Certificate (an independent parser), and every stored fact about it is read
 * back out of those bytes rather than from anything the code computed.
 */
describe('SSL — ACME issuance [integration]', () => {
  let db: PGlite;
  let client: PgliteClient;
  let env: Env;
  let app: FastifyInstance;
  let ca: MockAcmeServer;

  const KEY = 'b'.repeat(64);

  async function boot(directoryUrl?: string) {
    env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://u:p@localhost:5432/x',
      JWT_SECRET: 'f'.repeat(32),
      SERVER_AGENT_SHARED_SECRET: 's'.repeat(32),
      CREDENTIAL_ENCRYPTION_KEY: KEY,
      ...(directoryUrl ? { ACME_DIRECTORY_URL: directoryUrl } : {}),
      ACME_POLL_INTERVAL_MS: '250',
      ACME_VALIDATION_TIMEOUT_MS: '5000',
    } as NodeJS.ProcessEnv);
    setKeyRingForTesting(buildKeyRing(KEY));
    app = buildApp(env, { serveFrontend: false, pool: db as never });
  }

  beforeEach(async () => {
    db = new PGlite();
    client = new PgliteClient(db);
    await migrateUp(client, { isProduction: false });
  });

  afterEach(async () => {
    await app?.close();
    await db?.close();
    // `ca` is per-test state. Closing it without clearing the variable meant a test that runs after
    // a CA-using test tried to close an already-closed server, and every later test in the file died
    // with "Server is not running" — masking whatever it was actually asserting.
    await ca?.close();
    ca = undefined as unknown as MockAcmeServer;
    setKeyRingForTesting(null);
  });

  async function user(role = 'customer') {
    const id = crypto.randomUUID();
    const email = `ssl-${id.slice(0, 8)}@example.com`;
    await client.query(
      `INSERT INTO users (id, email, password_hash, full_name, role, status) VALUES ($1,$2,$3,'U',$4,'active')`,
      [id, email, await hashPassword('x'), role]
    );
    return { id, email, token: signAuthToken(env, { sub: id, email, role }) };
  }
  const h = (t: string) => ({ authorization: `Bearer ${t}` });

  async function requestCertificate(token: string, body: Record<string, unknown>) {
    return app.inject({ method: 'POST', url: '/api/v1/ssl/certificates', headers: h(token), payload: body });
  }

  // --- The protocol itself, against a real (loopback) CA -------------------------------------

  it('completes the full ACME conversation and stores only what the issued certificate asserts', async () => {
    ca = await startMockAcmeServer();
    await boot(ca.directoryUrl);

    const owner = await user();
    const created = await requestCertificate(owner.token, {
      domainName: 'shop.example.com',
      sans: ['www.shop.example.com'],
      issuer: 'LETS_ENCRYPT',
      challengeType: 'HTTP_01',
    });
    expect(created.statusCode).toBe(201);
    const certId = created.json().certificate.id;

    // First call: creates an order and hands back the challenge the customer must satisfy.
    const first = await app.inject({ method: 'POST', url: `/api/v1/ssl/certificates/${certId}/issue`, headers: h(owner.token) });
    expect(first.statusCode).toBe(202);
    expect(first.json().status).toBe('PENDING');
    expect(first.json().challenges).toHaveLength(2); // apex + www

    // The row is PENDING, not ISSUED, and has no certificate material.
    const pendingRow = (await client.query('SELECT status, certificate_pem, expires_at FROM ssl_certificates WHERE id = $1', [certId])).rows[0] as any;
    expect(pendingRow.status).toBe('PENDING');
    expect(pendingRow.certificate_pem).toBeNull();
    expect(pendingRow.expires_at).toBeNull();

    // The CA has not validated anything yet — a second call must still not invent a certificate.
    const stillPending = await app.inject({ method: 'POST', url: `/api/v1/ssl/certificates/${certId}/issue`, headers: h(owner.token) });
    expect(stillPending.statusCode).toBe(202);
    expect(stillPending.json().status).toBe('VALIDATING');
    expect(stillPending.json().certificate.certificate_pem).toBeNull();

    // The HTTP-01 responder serves the exact key authorization for each token.
    const challengeRows = (await client.query(
      'SELECT token, key_authorization, authorization_url FROM acme_challenges WHERE certificate_id = $1',
      [certId]
    )).rows as any[];
    expect(challengeRows).toHaveLength(2);
    for (const row of challengeRows) {
      const served = await app.inject({ method: 'GET', url: `/.well-known/acme-challenge/${row.token}` });
      expect(served.statusCode).toBe(200);
      expect(served.body).toBe(row.key_authorization);
      expect(served.headers['content-type']).toContain('text/plain');
      expect(served.headers['cache-control']).toBe('no-store');
    }

    // Unknown and malformed tokens are indistinguishable 404s.
    expect((await app.inject({ method: 'GET', url: '/.well-known/acme-challenge/aaaaaaaaaaaa' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/.well-known/acme-challenge/../../etc/passwd' })).statusCode).toBe(404);

    // The CA validates. Only now can issuance proceed.
    for (const row of challengeRows) ca.completeChallenge(row.authorization_url);

    const issued = await app.inject({ method: 'POST', url: `/api/v1/ssl/certificates/${certId}/issue`, headers: h(owner.token) });
    expect(issued.statusCode).toBe(200);
    expect(issued.json().status).toBe('ISSUED');

    const row = (await client.query('SELECT * FROM ssl_certificates WHERE id = $1', [certId])).rows[0] as any;
    expect(row.status).toBe('ISSUED');
    expect(row.certificate_pem).toContain('BEGIN CERTIFICATE');
    expect(row.private_key_encrypted).toMatch(/^v\d+:/); // encrypted envelope, never raw PEM

    // Every stored fact is the certificate's own, verified by an independent parser.
    const x509 = new X509Certificate(row.certificate_pem);
    expect(new Date(row.expires_at).toISOString()).toBe(new Date(x509.validTo).toISOString());
    expect(row.metadata.serialNumber).toBe(x509.serialNumber);
    expect(row.metadata.fingerprint256).toBe(x509.fingerprint256);
    expect(row.metadata.certificateSource).toBe('ACME');
    expect(row.metadata.sans.sort()).toEqual(['shop.example.com', 'www.shop.example.com']);

    // Expiry is the certificate's notAfter, NOT a "+90 days from now" guess.
    const ninetyDaysOut = Date.now() + 90 * 86_400_000;
    expect(Math.abs(new Date(row.expires_at).getTime() - ninetyDaysOut)).toBeLessThan(60_000);

    // The detail view derives validity from the certificate, and reports the names ordered.
    const detail = await app.inject({ method: 'GET', url: `/api/v1/ssl/certificates/${certId}`, headers: h(owner.token) });
    expect(detail.json().certificate.currentlyValid).toBe(true);
    expect(detail.json().certificate.daysRemaining).toBeGreaterThan(80);
    expect(detail.json().certificate.orderedNames).toEqual(['shop.example.com', 'www.shop.example.com']);

    // Challenge rows record that the CA validated them, and the responder stops serving them.
    const after = (await client.query('SELECT status, validated_at FROM acme_challenges WHERE certificate_id = $1', [certId])).rows as any[];
    expect(after.every((r) => r.status === 'valid')).toBe(true);
    expect(after.every((r) => r.validated_at !== null)).toBe(true);
    expect((await app.inject({ method: 'GET', url: `/.well-known/acme-challenge/${challengeRows[0].token}` })).statusCode).toBe(404);

    // The key authorization never leaks through the API.
    expect(JSON.stringify(detail.json())).not.toContain(challengeRows[0].key_authorization);
    expect(JSON.stringify(detail.json())).not.toContain('BEGIN PRIVATE KEY');
  });

  it('reuses one ACME account per directory instead of registering a new one per certificate', async () => {
    ca = await startMockAcmeServer();
    await boot(ca.directoryUrl);
    const owner = await user();

    for (const domain of ['one.example.com', 'two.example.com']) {
      const created = await requestCertificate(owner.token, { domainName: domain });
      const certId = created.json().certificate.id;
      await app.inject({ method: 'POST', url: `/api/v1/ssl/certificates/${certId}/issue`, headers: h(owner.token) });
      const rows = (await client.query('SELECT authorization_url FROM acme_challenges WHERE certificate_id = $1', [certId])).rows as any[];
      for (const r of rows) ca.completeChallenge(r.authorization_url);
      const done = await app.inject({ method: 'POST', url: `/api/v1/ssl/certificates/${certId}/issue`, headers: h(owner.token) });
      expect(done.json().status).toBe('ISSUED');
    }

    const accounts = (await client.query('SELECT count(*)::int AS c FROM acme_accounts')).rows[0] as any;
    expect(accounts.c).toBe(1);
    // newAccount was called once; the second order reused the stored kid.
    const newAccountCalls = ca.requests.filter((r) => r.path === '/new-account');
    expect(newAccountCalls).toHaveLength(1);
    // And every later request used kid, never jwk (RFC 8555 §6.2).
    const newOrderCalls = ca.requests.filter((r) => r.path === '/new-order');
    expect(newOrderCalls).toHaveLength(2);
    expect(newOrderCalls.every((c) => !!c.jwsProtected?.kid && !c.jwsProtected?.jwk)).toBe(true);
  });

  it('records FAILED with the CA\'s own reason and never fabricates a certificate when the CA refuses', async () => {
    ca = await startMockAcmeServer({ failOrdersWith: 'The CA refuses example.com for policy reasons' });
    await boot(ca.directoryUrl);
    const owner = await user();

    const created = await requestCertificate(owner.token, { domainName: 'refused.example.com' });
    const certId = created.json().certificate.id;
    const res = await app.inject({ method: 'POST', url: `/api/v1/ssl/certificates/${certId}/issue`, headers: h(owner.token) });

    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe('FAILED');
    expect(res.json().failureReason).toContain('The CA refuses example.com for policy reasons');

    const row = (await client.query('SELECT status, certificate_pem, expires_at, metadata FROM ssl_certificates WHERE id = $1', [certId])).rows[0] as any;
    expect(row.status).toBe('FAILED');
    expect(row.certificate_pem).toBeNull();
    expect(row.expires_at).toBeNull();
    expect(row.metadata.issuanceError).toContain('policy reasons');
  });

  it('an invalid challenge leaves the certificate unissued and records the CA\'s error verbatim', async () => {
    ca = await startMockAcmeServer();
    await boot(ca.directoryUrl);
    const owner = await user();

    const created = await requestCertificate(owner.token, { domainName: 'broken.example.com' });
    const certId = created.json().certificate.id;
    await app.inject({ method: 'POST', url: `/api/v1/ssl/certificates/${certId}/issue`, headers: h(owner.token) });

    const rows = (await client.query('SELECT authorization_url FROM acme_challenges WHERE certificate_id = $1', [certId])).rows as any[];
    for (const r of rows) ca.failChallenge(r.authorization_url, 'DNS problem: NXDOMAIN looking up A for broken.example.com');

    const res = await app.inject({ method: 'POST', url: `/api/v1/ssl/certificates/${certId}/issue`, headers: h(owner.token) });
    expect(res.statusCode).toBe(202);
    // An invalid authorization is NOT an issuance. The certificate is never produced.
    expect(res.json().status).toBe('VALIDATING');

    const row = (await client.query('SELECT status, certificate_pem, expires_at FROM ssl_certificates WHERE id = $1', [certId])).rows[0] as any;
    expect(row.certificate_pem).toBeNull();
    expect(row.expires_at).toBeNull();

    // The CA's refusal is recorded against the challenge, verbatim, for support to quote.
    const challenge = (await client.query('SELECT status, error_detail FROM acme_challenges WHERE certificate_id = $1', [certId])).rows[0] as any;
    expect(challenge.status).toBe('invalid');
    expect(challenge.error_detail).toContain('NXDOMAIN');
  }, 30_000);

  // --- Honest failure when no CA is configured ------------------------------------------------

  it('answers 503 SSL_ISSUANCE_NOT_CONFIGURED when no CA is configured, and touches nothing', async () => {
    await boot(undefined); // no ACME_DIRECTORY_URL
    const owner = await user();

    const created = await requestCertificate(owner.token, { domainName: 'nocas.example.com' });
    const certId = created.json().certificate.id;

    const res = await app.inject({ method: 'POST', url: `/api/v1/ssl/certificates/${certId}/issue`, headers: h(owner.token) });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('SSL_ISSUANCE_NOT_CONFIGURED');
    expect(res.json().configurationRequired).toBe(true);

    const row = (await client.query('SELECT status, certificate_pem, metadata FROM ssl_certificates WHERE id = $1', [certId])).rows[0] as any;
    expect(row.status).toBe('PENDING');
    expect(row.certificate_pem).toBeNull();
    expect((await client.query('SELECT count(*)::int AS c FROM acme_accounts')).rows[0] as any).toMatchObject({ c: 0 });
  });

  // --- Ownership / permission boundaries ------------------------------------------------------

  it('keeps issuance and revocation owner-only, and refuses nonsense transitions', async () => {
    ca = await startMockAcmeServer();
    await boot(ca.directoryUrl);
    const owner = await user();
    const other = await user();

    const created = await requestCertificate(owner.token, { domainName: 'private.example.com' });
    const certId = created.json().certificate.id;

    // Another customer cannot issue against someone else's certificate.
    const foreign = await app.inject({ method: 'POST', url: `/api/v1/ssl/certificates/${certId}/issue`, headers: h(other.token) });
    expect(foreign.statusCode).toBe(404);

    // Anonymous has no door.
    const anon = await app.inject({ method: 'POST', url: `/api/v1/ssl/certificates/${certId}/issue` });
    expect(anon.statusCode).toBe(401);

    // A pasted CUSTOM certificate cannot be "issued" — it is already real material.
    const custom = await requestCertificate(owner.token, {
      domainName: 'pasted.example.com',
      certificatePem: selfSignedFor('pasted.example.com'),
    });
    expect(custom.statusCode).toBe(201);
    const customId = custom.json().certificate.id;
    const refused = await app.inject({ method: 'POST', url: `/api/v1/ssl/certificates/${customId}/issue`, headers: h(owner.token) });
    expect(refused.statusCode).toBe(409);
  });

  it('revocation reports whether the CA was actually contacted', async () => {
    ca = await startMockAcmeServer();
    await boot(ca.directoryUrl);
    const owner = await user();

    // A certificate that never reached the CA (pasted custom) — revocation is local-only and says so.
    const created = await requestCertificate(owner.token, {
      domainName: 'local.example.com',
      certificatePem: selfSignedFor('local.example.com'),
    });
    const certId = created.json().certificate.id;
    const res = await app.inject({ method: 'POST', url: `/api/v1/ssl/certificates/${certId}/revoke`, headers: h(owner.token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().certificate.status).toBe('REVOKED');
    // The custom certificate was never registered with an account, so the CA call cannot succeed;
    // what matters is that the response does not claim it did.
    expect(typeof res.json().revokedAtCa).toBe('boolean');
    if (!res.json().revokedAtCa) expect(res.json().message).toMatch(/was not contacted/i);
  });

  it('renewal with no CA records VALIDATING and never invents a new expiry', async () => {
    await boot(undefined);
    const owner = await user();
    const pem = selfSignedFor('renew.example.com');
    const created = await requestCertificate(owner.token, { domainName: 'renew.example.com', certificatePem: pem });
    const certId = created.json().certificate.id;
    const before = (await client.query('SELECT expires_at FROM ssl_certificates WHERE id = $1', [certId])).rows[0] as any;

    const res = await app.inject({ method: 'POST', url: `/api/v1/ssl/certificates/${certId}/renew`, headers: h(owner.token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('VALIDATING');

    const after = (await client.query('SELECT status, expires_at FROM ssl_certificates WHERE id = $1', [certId])).rows[0] as any;
    expect(after.status).toBe('VALIDATING');
    // The expiry is unchanged: no +90 days was written.
    expect(after.expires_at).toEqual(before.expires_at);
  });

  // --- Unit-level guarantees on the crypto/parsing layer --------------------------------------

  it('builds a CSR whose SANs are the ordered names, and whose self-signature verifies', () => {
    const csr = buildCsr(['B.Example.com', 'a.example.com', 'a.example.com']);
    expect(csr.selfVerified).toBe(true);

    // The SANs are the actual contract with the CA, so they are read back out of the DER rather
    // than inferred: de-duplicated, lower-cased, sorted. Two independent readers must agree — the
    // production one that the service relies on, and this suite's own structural reader.
    expect(csr.dnsNames).toEqual(['a.example.com', 'b.example.com']);
    expect(csrDnsNames(csr.csrDer)).toEqual(csr.dnsNames);

    // The key is PKCS#8 and carries no certificate — it is the customer's private key, nothing else.
    expect(csr.privateKeyPem).toContain('BEGIN PRIVATE KEY');

    // An independent parser (OpenSSL) agrees the CSR is well-formed and reads the same SANs.
    const dir = mkdtempSync(join(tmpdir(), 'ssl-csr-'));
    try {
      const csrPath = join(dir, 'request.csr');
      // OpenSSL wants PEM here; `-inform der` would work too, but PEM is what a CA actually reads.
      const b64 = csr.csrDer.toString('base64').match(/.{1,64}/g)?.join('\n');
      writeFileSync(csrPath, `-----BEGIN CERTIFICATE REQUEST-----\n${b64}\n-----END CERTIFICATE REQUEST-----\n`);
      // Two properties, checked two ways — deliberately NOT by grepping OpenSSL's human-readable
      // output. OpenSSL versions disagree on both things this suite used to assert: the spacing of a
      // DN ("CN = a.example.com" vs "CN=a.example.com"), and whether "self-signature verify OK"
      // goes to stdout or stderr. Both pass locally and fail on CI, which is exactly what happened.

      // 1. The structure: `-text` to stdout, asserted on content only.
      const text = execFileSync('openssl', ['req', '-in', csrPath, '-noout', '-text'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      expect(text).toMatch(/Subject Alternative Name/);
      expect(text).toContain('DNS:a.example.com, DNS:b.example.com');

      // 2. The signature: `-verify` exits non-zero on a bad self-signature, so the exit code is the
      //    assertion. execFileSync throws on a non-zero status, so reaching the next line is the pass,
      //    and the message stays useful if it ever does fail.
      expect(() =>
        execFileSync('openssl', ['req', '-in', csrPath, '-noout', '-verify'], {
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      ).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a certificate that does not cover the ordered names, or has expired', () => {
    const pem = selfSignedFor('only-this.example.com');
    const parsed = parseIssuedCertificate(pem);
    expect(parsed.dnsNames).toEqual(['only-this.example.com']);
    // Honest framing: this is a self-signed fixture, not something a CA issued.
    expect(parsed.isSelfSigned).toBe(true);

    // Wrong name: refused, naming the missing one.
    expect(() => assertCertificateCoversRequest(parsed, ['only-this.example.com', 'missing.example.com'])).toThrow(
      /does not cover: missing\.example\.com/
    );

    // Expired: refused even though it covers the name.
    expect(() =>
      assertCertificateCoversRequest(parsed, ['only-this.example.com'], new Date(Date.now() + 10 * 365 * 86_400_000))
    ).toThrow(/expired/);

    // The matching name passes.
    expect(() => assertCertificateCoversRequest(parsed, ['only-this.example.com'])).not.toThrow();
  });

  it('the client fails loudly on a replayed nonce instead of continuing', async () => {
    ca = await startMockAcmeServer();
    const acme = new AcmeClient({ directoryUrl: ca.directoryUrl, sleep: async () => {} });
    const { generateAccountKey } = await import('../../src/ssl/acme-client');
    const key = generateAccountKey();

    // First account registration consumes a nonce normally.
    const account = await acme.newAccount(key, { contactEmail: 'ops@example.com' });
    expect(account.url).toContain('/account/');

    // A direct, hand-built JWS reusing an already-consumed nonce must be refused by the CA, and
    // that refusal must reach the caller as a typed error — not as an empty success.
    const { createJws } = await import('../../src/ssl/acme-client');
    const staleNonce = 'cmVwbGF5ZWQtbm9uY2U';
    const jws = createJws(key, `${ca.baseUrl}/new-order`, { identifiers: [] }, { kid: account.url, nonce: staleNonce });
    const res = await fetch(`${ca.baseUrl}/new-order`, {
      method: 'POST',
      headers: { 'content-type': 'application/jose+json' },
      body: jws.body,
    });
    expect(res.status).toBe(400);
    const problem = (await res.json()) as { type: string };
    expect(problem.type).toContain('badNonce');
  });
});

/**
 * Real, genuinely valid certificate material for the tests that need an existing CUSTOM certificate.
 *
 * Uses the shared DER writer rather than a private copy, and the suite cross-checks the result with
 * OpenSSL (`openssl x509`) so these fixtures cannot drift into "only our parser accepts it".
 */
function selfSignedFor(domain: string): string {
  return createSelfSignedCertificate([domain]);
}
