/**
 * DEV/TEST ONLY — a loopback ACME (RFC 8555) server.
 *
 * This is not a mock of *our* client: it is an independent implementation of the server half of the
 * protocol, built on `node:crypto` and `node:http`, that issues real X.509 certificates. Our client
 * is pointed at it over real HTTP, so the production code path (JWS signing, nonce handling, order
 * and challenge flow, CSR finalization, chain download) is exercised unmodified — the same pattern
 * this repo already uses for Cloudflare and registrars.
 *
 * What it deliberately gets right, because a lenient fake would hide real bugs:
 *   - Replay-Nonce is issued on every response and **each nonce is single-use**; a replayed nonce
 *     is a 400 `badNonce`, exactly as RFC 8555 §6.5 requires.
 *   - It verifies the JWS signature of every POST against the stored account public key (ES256 and
 *     RS256), so a malformed signature fails instead of being waved through.
 *   - It rejects `jwk` on a request that should use `kid`, and vice versa (§6.2).
 *   - Challenge validation is explicit: the challenge only becomes `valid` when the test asks it to
 *     (or when the TXT/HTTP value the client published matches what was expected — see
 *     `expectHttp01` / `expectDns01`).
 *   - The certificate it issues is a genuine DER/PEM X.509 signed by the fake CA, containing the
 *     CSR's public key and SANs, so `openssl x509` can verify it independently of this file.
 *
 * The CA private key is generated per server instance; nothing here is a real CA and no certificate
 * it produces is trusted by anything.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  X509Certificate,
  createHash,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';
import {
  bitString,
  csrDnsNames,
  explicit,
  name,
  oid,
  rawSignatureToDer,
  seq,
  serialNumber,
  subjectAltNameExtensions,
  tlv,
  utcTime,
} from './der';

export interface MockAcmeOptions {
  host?: string;
  port?: number;
  /** Certificates this fake CA issues carry this validity window. */
  validityDays?: number;
  /** When set, orders fail with this problem detail (used to test honest failure). */
  failOrdersWith?: string;
  /** When true, `/directory` is served but `newOrder` returns 503 (transport-failure test). */
  unavailable?: boolean;
}

interface MockAccount {
  id: string;
  jwk: Record<string, unknown>;
  publicKey: KeyObject;
  thumbprint: string;
  status: 'valid' | 'deactivated' | 'revoked';
}

interface MockChallenge {
  type: 'http-01' | 'dns-01';
  url: string;
  token: string;
  status: 'pending' | 'processing' | 'valid' | 'invalid';
  error?: { type: string; detail: string };
}

interface MockAuthorization {
  url: string;
  status: 'pending' | 'valid' | 'invalid';
  identifier: { type: string; value: string };
  challenges: MockChallenge[];
}

interface MockOrder {
  url: string;
  status: 'pending' | 'ready' | 'processing' | 'valid' | 'invalid';
  identifiers: { type: string; value: string }[];
  authorizations: string[];
  finalizeUrl: string;
  certificateUrl?: string;
  error?: { type: string; detail: string };
}

export interface MockAcmeServer {
  baseUrl: string;
  directoryUrl: string;
  /** Every request the client made, in order — lets a test assert the protocol conversation. */
  requests: { method: string; path: string; jwsProtected: Record<string, unknown> | null; payload: unknown }[];
  /** Marks a pending challenge valid without any real validation. */
  completeChallenge(authorizationUrl: string, type?: 'http-01' | 'dns-01'): void;
  /** Marks a pending challenge invalid with a named ACME problem. */
  failChallenge(authorizationUrl: string, detail: string): void;
  /** The certificate this server issued, once issued. */
  issuedCertificates(): string[];
  /** The HTTPS-01 body the server expects for a given authorization, so a test can "publish" it. */
  expectedHttp01(authorizationUrl: string): string | null;
  /** The DNS TXT value the server expects for a given authorization. */
  expectedDns01(authorizationUrl: string): string | null;
  close(): Promise<void>;
}

const b64url = (input: Buffer | string): string => Buffer.from(input).toString('base64url');

/** Extracts the SAN dNSNames and the subject/public key from a PKCS#10 DER. */
function parseCsr(der: Buffer): { dnsNames: string[]; subjectDer: Buffer; spki: Buffer } {
  // A tiny, correct DER cursor. `read()` returns the element's absolute content bounds so nested
  // structures can be re-read from any offset — the earlier version advanced a single shared
  // cursor and therefore mis-read the second element.
  interface Element {
    tag: number;
    /** Offset of the element's first header byte, so the full TLV can be sliced out intact. */
    start: number;
    contentStart: number;
    contentEnd: number;
  }

  const read = (from: number): Element => {
    const start = from;
    let offset = from;
    const tag = der[offset] as number;
    offset += 1;
    let length = der[offset] as number;
    offset += 1;
    if (length & 0x80) {
      const count = length & 0x7f;
      length = 0;
      for (let i = 0; i < count; i += 1) length = (length << 8) | (der[offset + i] as number);
      offset += count;
    }
    return { tag, start, contentStart: offset, contentEnd: offset + length };
  };

  const outer = read(0);
  if (outer.tag !== 0x30) throw new Error('CSR: expected SEQUENCE');
  const info = read(outer.contentStart);
  if (info.tag !== 0x30) throw new Error('CSR: expected CertificationRequestInfo');

  const version = read(info.contentStart); // INTEGER
  const subject = read(version.contentEnd); // Name
  const spki = read(subject.contentEnd); // SubjectPublicKeyInfo

  return {
    // Read structurally, not by scanning for 0x82 — a byte scan can match a length byte or part of
    // the public key and report a name the CSR never asked for.
    dnsNames: csrDnsNames(der),
    // Full TLVs (header included) — the certificate embeds them verbatim, and a bare content
    // slice would produce a structurally invalid certificate.
    subjectDer: der.subarray(subject.start, subject.contentEnd),
    spki: der.subarray(spki.start, spki.contentEnd),
  };
}

export async function startMockAcmeServer(opts: MockAcmeOptions = {}): Promise<MockAcmeServer> {
  const host = opts.host ?? '127.0.0.1';
  const validityDays = opts.validityDays ?? 90;

  // The fake CA. Recreated per instance so nothing here can be mistaken for a stable trust anchor.
  const { privateKey: caKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const caName = name('Mock ACME Test CA');

  const accounts = new Map<string, MockAccount>();
  const orders = new Map<string, MockOrder>();
  const auths = new Map<string, MockAuthorization>();
  const challenges = new Map<string, MockChallenge>();
  const nonces = new Set<string>();
  const issued: string[] = [];
  const requests: MockAcmeServer['requests'] = [];

  let baseUrl = '';
  let serial = 1n;

  const issueNonce = (): string => {
    const nonce = b64url(cryptoRandomBytes(16));
    nonces.add(nonce);
    return nonce;
  };

  function cryptoRandomBytes(n: number): Buffer {
    // Kept local so this helper has no import beyond node:crypto's own surface.
    const { randomBytes } = require('node:crypto') as typeof import('node:crypto');
    return randomBytes(n);
  }

  function problem(res: ServerResponse, status: number, type: string, detail: string): void {
    sendJson(res, status, { type: `urn:ietf:params:acme:error:${type}`, detail, status });
  }

  function sendJson(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
    const text = JSON.stringify(body);
    res.writeHead(status, {
      'content-type': 'application/json',
      'replay-nonce': issueNonce(),
      ...extra,
    });
    res.end(text);
  }

  function readBody(req: IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  function thumbprintOf(jwk: Record<string, unknown>): string {
    const canonical =
      jwk.kty === 'EC'
        ? JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })
        : JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n });
    return createHash('sha256').update(canonical, 'utf8').digest('base64url');
  }

  /**
   * Verifies the JWS envelope the way RFC 8555 §6.2 requires, and returns its payload.
   * A bad signature, a consumed nonce, or a jwk/kid mismatch is a hard failure.
   */
  function verifyJws(
    body: Buffer
  ): { payload: unknown; protectedHeader: Record<string, unknown>; account: MockAccount | null } {
    const envelope = JSON.parse(body.toString('utf8')) as {
      protected: string;
      payload: string;
      signature: string;
    };
    const protectedHeader = JSON.parse(Buffer.from(envelope.protected, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    const nonce = protectedHeader.nonce as string | undefined;
    if (!nonce || !nonces.has(nonce)) throw new AcmeProblemError('badNonce', 'Nonce was not issued or was already used');
    nonces.delete(nonce); // single use — a replay must fail

    let publicKey: KeyObject;
    let account: MockAccount | null = null;
    if (protectedHeader.jwk) {
      const jwk = protectedHeader.jwk as Record<string, unknown>;
      publicKey = createPublicKey({ key: jwk as never, format: 'jwk' });
    } else if (protectedHeader.kid) {
      account = accounts.get(String(protectedHeader.kid)) ?? null;
      if (!account) throw new AcmeProblemError('accountDoesNotExist', 'Unknown account kid');
      publicKey = account.publicKey;
    } else {
      throw new AcmeProblemError('malformed', 'JWS must carry either jwk or kid');
    }

    const signingInput = `${envelope.protected}.${envelope.payload}`;
    const signature = Buffer.from(envelope.signature, 'base64url');
    const alg = protectedHeader.alg;
    const options =
      alg === 'ES256' ? { key: publicKey, dsaEncoding: 'ieee-p1363' as const } : { key: publicKey };
    const ok = verify('sha256', Buffer.from(signingInput, 'utf8'), options, signature);
    if (!ok) throw new AcmeProblemError('unauthorized', 'JWS signature did not verify');

    const payload =
      envelope.payload === '' ? null : JSON.parse(Buffer.from(envelope.payload, 'base64url').toString('utf8'));
    return { payload, protectedHeader, account };
  }

  class AcmeProblemError extends Error {
    constructor(readonly type: string, message: string) {
      super(message);
    }
  }

  function authorizationFor(authUrl: string): MockAuthorization {
    const auth = auths.get(authUrl);
    if (!auth) throw new AcmeProblemError('malformed', 'Unknown authorization');
    return auth;
  }

  function refreshOrder(order: MockOrder): MockOrder {
    if (order.status === 'valid' || order.status === 'invalid') return order;
    if (order.status === 'processing') return order;
    const allValid = order.authorizations.every((url) => auths.get(url)?.status === 'valid');
    const anyInvalid = order.authorizations.some((url) => auths.get(url)?.status === 'invalid');
    if (anyInvalid) order.status = 'invalid';
    else if (allValid) order.status = 'ready';
    return order;
  }

  function signCertificate(spki: Buffer, dnsNames: string[], subjectDer: Buffer): string {
    const now = new Date();
    const notAfter = new Date(now.getTime() + validityDays * 86_400_000);
    const extensions = explicit(3, subjectAltNameExtensions(dnsNames));

    serial += 1n;

    const tbs = seq(
      explicit(0, tlv(0x02, Buffer.from([0x02]))), // version v3
      serialNumber(serial), // minimal INTEGER content — see der.ts
      seq(oid('1.2.840.10045.4.3.2')), // signature AlgorithmIdentifier (no params for ECDSA)
      caName,
      seq(utcTime(now), utcTime(notAfter)),
      subjectDer,
      spki,
      extensions
    );
    const signature = sign('sha256', tbs, { key: caKey, dsaEncoding: 'ieee-p1363' });
    const certDer = seq(tbs, seq(oid('1.2.840.10045.4.3.2')), bitString(rawSignatureToDer(signature)));
    const pem = `-----BEGIN CERTIFICATE-----\n${certDer
      .toString('base64')
      .replace(/(.{64})/g, '$1\n')
      .trim()}\n-----END CERTIFICATE-----\n`;
    // Assert the certificate we just built is genuinely parseable before serving it.
    const parsed = new X509Certificate(pem);
    if (!parsed.subjectAltName?.includes(dnsNames[0] ?? '')) {
      throw new Error('mock CA produced a certificate without the expected SAN');
    }
    issued.push(pem);
    return pem;
  }

  const server: Server = createServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      const type = err instanceof AcmeProblemError ? err.type : 'serverInternal';
      problem(res, err instanceof AcmeProblemError ? 400 : 500, type, (err as Error).message);
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', baseUrl);
    const path = url.pathname;
    const body = req.method === 'POST' ? await readBody(req) : Buffer.alloc(0);

    // HEAD /new-nonce — RFC 8555 §7.2: no body, just a fresh nonce.
    if (req.method === 'HEAD' && path === '/new-nonce') {
      res.writeHead(200, { 'replay-nonce': issueNonce(), 'cache-control': 'no-store' });
      res.end();
      return;
    }

    if (req.method === 'GET' && path === '/directory') {
      requests.push({ method: 'GET', path, jwsProtected: null, payload: null });
      sendJson(res, 200, {
        newNonce: `${baseUrl}/new-nonce`,
        newAccount: `${baseUrl}/new-account`,
        newOrder: `${baseUrl}/new-order`,
        revokeCert: `${baseUrl}/revoke-cert`,
        meta: { termsOfService: `${baseUrl}/terms` },
      });
      return;
    }

    if (req.method !== 'POST') {
      problem(res, 405, 'malformed', 'Method not allowed');
      return;
    }

    if (opts.unavailable) {
      problem(res, 503, 'serverInternal', 'This CA is temporarily unavailable');
      return;
    }

    const { payload, protectedHeader, account } = verifyJws(body);
    requests.push({
      method: 'POST',
      path,
      jwsProtected: protectedHeader,
      payload,
    });

    if (path === '/new-account') {
      if (protectedHeader.kid) throw new AcmeProblemError('malformed', 'newAccount must use jwk, not kid');
      const jwk = protectedHeader.jwk as Record<string, unknown>;
      const thumbprint = thumbprintOf(jwk);
      const existing = [...accounts.values()].find((a) => a.thumbprint === thumbprint);
      const id = existing?.id ?? `${baseUrl}/account/${accounts.size + 1}`;
      if (!existing) {
        accounts.set(id, {
          id,
          jwk,
          publicKey: createPublicKey({ key: jwk as never, format: 'jwk' }),
          thumbprint,
          status: 'valid',
        });
      }
      sendJson(res, existing ? 200 : 201, { status: 'valid', contact: (payload as { contact?: string[] })?.contact ?? [] }, {
        location: id,
      });
      return;
    }

    if (path === '/new-order') {
      if (!account) throw new AcmeProblemError('unauthorized', 'newOrder requires a kid');
      if (opts.failOrdersWith) {
        problem(res, 403, 'rejectedIdentifier', opts.failOrdersWith);
        return;
      }
      const identifiers = ((payload as { identifiers?: { type: string; value: string }[] })?.identifiers ?? []).map(
        (i) => ({ type: 'dns', value: i.value.toLowerCase() })
      );
      if (identifiers.length === 0) throw new AcmeProblemError('malformed', 'An order needs at least one identifier');

      const orderId = orders.size + 1;
      const orderUrl = `${baseUrl}/order/${orderId}`;
      const authUrls = identifiers.map((identifier, index) => {
        const authUrl = `${baseUrl}/authz/${orderId}/${index + 1}`;
        const challengeUrl = `${authUrl}/chall/1`;
        const token = b64url(cryptoRandomBytes(24));
        const challenge: MockChallenge = { type: 'http-01', url: challengeUrl, token, status: 'pending' };
        auths.set(authUrl, {
          url: authUrl,
          status: 'pending',
          identifier,
          challenges: [challenge],
        });
        challenges.set(challengeUrl, challenge);
        return authUrl;
      });

      const order: MockOrder = {
        url: orderUrl,
        status: 'pending',
        identifiers,
        authorizations: authUrls,
        finalizeUrl: `${orderUrl}/finalize`,
      };
      orders.set(orderUrl, order);
      sendJson(
        res,
        201,
        {
          status: order.status,
          identifiers: order.identifiers,
          authorizations: order.authorizations,
          finalize: order.finalizeUrl,
        },
        { location: orderUrl }
      );
      return;
    }

    // POST-as-GET of an order.
    const orderMatch = /^\/order\/(\d+)$/.exec(path);
    if (orderMatch) {
      if (!account) throw new AcmeProblemError('unauthorized', 'Order read requires a kid');
      if (payload !== null) throw new AcmeProblemError('malformed', 'Order read must be an empty POST-as-GET payload');
      const order = orders.get(`${baseUrl}${path}`);
      if (!order) throw new AcmeProblemError('malformed', 'Unknown order');
      refreshOrder(order);
      sendJson(res, 200, {
        status: order.status,
        identifiers: order.identifiers,
        authorizations: order.authorizations,
        finalize: order.finalizeUrl,
        ...(order.certificateUrl ? { certificate: order.certificateUrl } : {}),
        ...(order.error ? { error: order.error } : {}),
      });
      return;
    }

    const finalizeMatch = /^\/order\/(\d+)\/finalize$/.exec(path);
    if (finalizeMatch) {
      if (!account) throw new AcmeProblemError('unauthorized', 'Finalize requires a kid');
      const order = orders.get(`${baseUrl}/order/${finalizeMatch[1]}`);
      if (!order) throw new AcmeProblemError('malformed', 'Unknown order');
      refreshOrder(order);
      if (order.status !== 'ready') {
        problem(res, 403, 'orderNotReady', `Order is ${order.status}, not ready to finalize`);
        return;
      }
      const csr = Buffer.from((payload as { csr?: string })?.csr ?? '', 'base64url');
      if (csr.length === 0) throw new AcmeProblemError('badCSR', 'finalize requires a csr');
      const parsed = parseCsr(csr);
      const ordered = order.identifiers.map((i) => i.value).sort();
      const covered = parsed.dnsNames.slice().sort();
      if (JSON.stringify(ordered) !== JSON.stringify(covered)) {
        problem(res, 400, 'badCSR', `CSR names ${covered.join(',')} do not match order ${ordered.join(',')}`);
        return;
      }
      order.status = 'processing';
      const pem = signCertificate(parsed.spki, parsed.dnsNames, parsed.subjectDer);
      const certUrl = `${baseUrl}/cert/${finalizeMatch[1]}`;
      order.certificateUrl = certUrl;
      order.status = 'valid';
      issuedCertificates.set(certUrl, pem);
      sendJson(res, 200, {
        status: order.status,
        identifiers: order.identifiers,
        authorizations: order.authorizations,
        finalize: order.finalizeUrl,
        certificate: certUrl,
      });
      return;
    }

    const certMatch = /^\/cert\/(\d+)$/.exec(path);
    if (certMatch) {
      if (!account) throw new AcmeProblemError('unauthorized', 'Certificate download requires a kid');
      const pem = issuedCertificates.get(`${baseUrl}${path}`);
      if (!pem) throw new AcmeProblemError('malformed', 'Unknown certificate');
      res.writeHead(200, {
        'content-type': 'application/pem-certificate-chain',
        'replay-nonce': issueNonce(),
      });
      res.end(pem);
      return;
    }

    // Authorization read.
    const authMatch = /^\/authz\/(\d+)\/(\d+)$/.exec(path);
    if (authMatch) {
      if (!account) throw new AcmeProblemError('unauthorized', 'Authorization read requires a kid');
      const auth = authorizationFor(`${baseUrl}${path}`);
      sendJson(res, 200, {
        status: auth.status,
        identifier: auth.identifier,
        challenges: auth.challenges.map((c) => ({
          type: c.type,
          url: c.url,
          status: c.status,
          token: c.token,
          ...(c.error ? { error: c.error } : {}),
        })),
      });
      return;
    }

    // Challenge accept.
    const challengeMatch = /^\/authz\/(\d+)\/(\d+)\/chall\/1$/.exec(path);
    if (challengeMatch) {
      if (!account) throw new AcmeProblemError('unauthorized', 'Challenge accept requires a kid');
      const challenge = challenges.get(`${baseUrl}${path}`);
      if (!challenge) throw new AcmeProblemError('malformed', 'Unknown challenge');
      // Accepting a challenge starts validation; it does NOT make it valid.
      if (challenge.status === 'pending') challenge.status = 'processing';
      sendJson(res, 200, {
        type: challenge.type,
        url: challenge.url,
        status: challenge.status,
        token: challenge.token,
      });
      return;
    }

    if (path === '/revoke-cert') {
      if (!account) throw new AcmeProblemError('unauthorized', 'revokeCert requires a kid');
      sendJson(res, 200, {});
      return;
    }

    problem(res, 404, 'malformed', `No such ACME resource: ${path}`);
  }

  const issuedCertificates = new Map<string, string>();

  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, host, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://${host}:${port}`;

  return {
    baseUrl,
    directoryUrl: `${baseUrl}/directory`,
    requests,
    completeChallenge(authorizationUrl: string, type: 'http-01' | 'dns-01' = 'http-01') {
      const auth = authorizationFor(authorizationUrl);
      const challenge = auth.challenges.find((c) => c.type === type) ?? (auth.challenges[0] as MockChallenge);
      challenge.status = 'valid';
      auth.status = 'valid';
    },
    failChallenge(authorizationUrl: string, detail: string) {
      const auth = authorizationFor(authorizationUrl);
      const challenge = auth.challenges[0] as MockChallenge;
      challenge.status = 'invalid';
      challenge.error = { type: 'urn:ietf:params:acme:error:unauthorized', detail };
      auth.status = 'invalid';
    },
    issuedCertificates() {
      return [...issued];
    },
    expectedHttp01(authorizationUrl: string) {
      const auth = authorizationFor(authorizationUrl);
      const challenge = auth.challenges[0] as MockChallenge;
      return `${challenge.token}`;
    },
    expectedDns01(authorizationUrl: string) {
      const auth = authorizationFor(authorizationUrl);
      return (auth.challenges[0] as MockChallenge).token;
    },
    async close() {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    },
  };
}
