/**
 * Tools Center — SSL/TLS certificate checker (spec §40).
 *
 * Opens a real TLS connection (pinned to the SSRF-validated address) and reports what the server
 * actually presented: the leaf certificate and the chain it sent, hostname match, expiry, key and
 * signature algorithms, negotiated protocol/cipher, OCSP stapling and which TLS versions the server
 * still accepts.
 *
 * Certificate errors are DATA here, not exceptions: `rejectUnauthorized` is false because an expired
 * or self-signed certificate is exactly what a checker is asked to report. Every verification
 * problem is surfaced explicitly in `verification` so nothing looks "fine" by omission.
 */
import tls from 'node:tls';
import { performance } from 'node:perf_hooks';
import { invalidInput, ToolError } from '../core/errors';
import { resolvePublicAddresses } from '../core/ssrf';

export interface CertificateSummary {
  subject: Record<string, string>;
  issuer: Record<string, string>;
  subjectAltNames: string[];
  validFrom: string | null;
  validTo: string | null;
  daysRemaining: number | null;
  serialNumber: string | null;
  fingerprintSha256: string | null;
  signatureAlgorithm: string | null;
  publicKey: { type: string | null; bits: number | null; curve: string | null };
  isCA: boolean;
  keyUsage: string[];
  extendedKeyUsage: string[];
  ocspUrls: string[];
  crlUrls: string[];
  issuerCertificateUrls: string[];
  selfSigned: boolean;
}

export interface ChainLink extends CertificateSummary {
  position: 'leaf' | 'intermediate' | 'root';
  verified: boolean;
  problems: string[];
}

export type SslStatus = 'VALID' | 'EXPIRING_SOON' | 'EXPIRED' | 'NOT_YET_VALID' | 'HOSTNAME_MISMATCH' | 'CHAIN_NOT_TRUSTED';

export interface SslCheckResult {
  host: string;
  port: number;
  address: string;
  serverName: string | null;
  /** Overall verdict, derived from the problems below in a fixed order of severity. */
  status: SslStatus;
  statusDetail: string;
  verification: {
    authorized: boolean;
    authorizationError: string | null;
    hostnameMatch: { matched: boolean; reason: string | null };
    chainComplete: boolean;
    chainLength: number;
    mozillaGuidance: string;
  };
  certificate: CertificateSummary;
  chain: ChainLink[];
  connection: {
    protocol: string | null;
    cipher: string | null;
    alpnProtocol: string | null;
    sessionResumed: boolean;
    ocspStapled: boolean;
    serverNameIndication: boolean;
  };
  supportedProtocols: Array<{ version: string; supported: boolean; detail: string }>;
  expiry: { validTo: string | null; daysRemaining: number | null; status: 'OK' | 'EXPIRING_SOON' | 'EXPIRED' | 'NOT_YET_VALID'; detail: string };
  problems: Array<{ severity: 'error' | 'warning' | 'info'; code: string; message: string; evidence: string | null }>;
  recommendations: string[];
  durationMs: number;
}

const EXPIRY_WARNING_DAYS = 30;
const MAX_CHAIN = 6;

function nameRecord(subject: tls.PeerCertificate['subject']): Record<string, string> {
  if (!subject) return {};
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(subject)) {
    output[key] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return output;
}

function altNames(value: tls.PeerCertificate['subjectaltname']): string[] {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function summarise(certificate: tls.PeerCertificate, level: 'leaf' | 'intermediate' | 'root', verified: boolean): ChainLink {
  const validFrom = certificate.valid_from ? new Date(certificate.valid_from) : null;
  const validTo = certificate.valid_to ? new Date(certificate.valid_to) : null;
  const problems: string[] = [];
  const now = Date.now();
  if (validFrom && validFrom.getTime() > now) problems.push('This certificate is not valid yet.');
  if (validTo && validTo.getTime() < now) problems.push('This certificate has expired.');
  const bits = (certificate as { bits?: number }).bits ?? null;
  const keyType = (certificate as { pubkey?: { type?: string } }).pubkey?.type ?? null;
  const signatureAlgorithm = (certificate as { sigalg?: string }).sigalg ?? null;
  if (keyType?.startsWith('RSA') && bits !== null && bits < 2048) problems.push(`The key is only ${bits} bits; RSA keys below 2048 bits are considered weak.`);
  if (signatureAlgorithm && /^(sha1|md5)/i.test(signatureAlgorithm.replace(/^RSA-/, ''))) {
    problems.push(`The signature algorithm is ${signatureAlgorithm}, which is no longer trusted by browsers.`);
  }
  if (signatureAlgorithm === null) problems.push('The certificate did not expose a signature algorithm (older OpenSSL versions do not report it; do not read this as "unsigned").');

  const issuerCommonName = Array.isArray(certificate.issuer?.CN) ? certificate.issuer.CN.join(', ') : certificate.issuer?.CN;
  const subjectCommonName = Array.isArray(certificate.subject?.CN) ? certificate.subject.CN.join(', ') : certificate.subject?.CN;
  const selfSigned = Boolean(issuerCommonName && subjectCommonName && issuerCommonName === subjectCommonName);

  return {
    position: level,
    verified,
    problems,
    subject: nameRecord(certificate.subject),
    issuer: nameRecord(certificate.issuer),
    subjectAltNames: altNames(certificate.subjectaltname),
    validFrom: validFrom && !Number.isNaN(validFrom.getTime()) ? validFrom.toISOString() : null,
    validTo: validTo && !Number.isNaN(validTo.getTime()) ? validTo.toISOString() : null,
    daysRemaining: validTo && !Number.isNaN(validTo.getTime()) ? Math.floor((validTo.getTime() - now) / 86_400_000) : null,
    serialNumber: certificate.serialNumber ?? null,
    fingerprintSha256: certificate.fingerprint256 ?? null,
    signatureAlgorithm,
    publicKey: {
      type: keyType,
      bits,
      curve: (certificate as { asn1Curve?: string }).asn1Curve ?? (certificate as { nistCurve?: string }).nistCurve ?? null,
    },
    isCA: certificate.ca === true,
    keyUsage: certificate.ext_key_usage ? String(certificate.ext_key_usage).split(',').map((entry) => entry.trim()) : [],
    extendedKeyUsage: certificate.ext_key_usage ? String(certificate.ext_key_usage).split(',').map((entry) => entry.trim()) : [],
    ocspUrls: certificate.infoAccess?.['OCSP'] ?? [],
    crlUrls: certificate.infoAccess?.['OCSP'] ?? [],
    issuerCertificateUrls: certificate.infoAccess?.['CA Issuers'] ?? [],
    selfSigned,
  };
}

interface HandshakeOutcome {
  protocol: string | null;
  cipher: string | null;
  alpnProtocol: string | null;
  sessionResumed: boolean;
  ocspStapled: boolean;
  authorized: boolean;
  authorizationError: string | null;
  peer: tls.PeerCertificate;
  issuerChain: tls.PeerCertificate[];
}

async function handshake(address: string, host: string, port: number, timeoutMs: number): Promise<HandshakeOutcome> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      {
        host: address,
        port,
        servername: /^[0-9a-f:.]+$/i.test(host) ? undefined : host,
        rejectUnauthorized: false,
        timeout: timeoutMs,
      },
      () => {
        const peer = socket.getPeerCertificate(true);
        if (!peer || Object.keys(peer).length === 0) {
          socket.destroy();
          reject(new ToolError('PROVIDER_ERROR', `${host}:${port} completed a TLS handshake but presented no certificate.`));
          return;
        }
        const issuerChain: tls.PeerCertificate[] = [];
        let current = peer.issuerCertificate;
        let depth = 0;
        const seen = new Set<string>([peer.fingerprint256 ?? 'leaf']);
        while (current && depth < MAX_CHAIN) {
          const fingerprint = current.fingerprint256 ?? `depth-${depth}`;
          if (seen.has(fingerprint)) break;
          seen.add(fingerprint);
          issuerChain.push(current);
          current = current.issuerCertificate;
          depth += 1;
        }
        const outcome: HandshakeOutcome = {
          protocol: socket.getProtocol(),
          cipher: socket.getCipher()?.name ?? null,
          alpnProtocol: socket.alpnProtocol ? String(socket.alpnProtocol) : null,
          sessionResumed: socket.isSessionReused(),
          // `OCSPResponse` is present on TLS sockets but omitted from @types/node's TLSSocket
          // surface, hence the typed cast rather than an `any`.
          ocspStapled: Boolean((socket as unknown as { OCSPResponse?: Buffer }).OCSPResponse?.length),
          authorized: socket.authorized,
          authorizationError: socket.authorizationError ? String(socket.authorizationError) : null,
          peer,
          issuerChain,
        };
        socket.end();
        resolve(outcome);
      }
    );
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error('TLS_TIMEOUT')));
    socket.on('error', (error: NodeJS.ErrnoException) => {
      if (error.message === 'TLS_TIMEOUT') {
        reject(new ToolError('TIMEOUT', `The TLS handshake with ${host}:${port} did not complete within ${timeoutMs} ms.`));
        return;
      }
      reject(new ToolError('PROVIDER_ERROR', `The TLS connection to ${host}:${port} failed: ${error.code ?? error.message}. If the service is not HTTPS, use the port checker instead.`));
    });
  });
}

async function probeProtocol(address: string, host: string, port: number, version: 'TLSv1' | 'TLSv1.1' | 'TLSv1.2' | 'TLSv1.3', timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = tls.connect(
      {
        host: address,
        port,
        servername: /^[0-9a-f:.]+$/i.test(host) ? undefined : host,
        rejectUnauthorized: false,
        minVersion: version,
        maxVersion: version,
        timeout: Math.min(timeoutMs, 6000),
      },
      () => {
        socket.end();
        resolve(true);
      }
    );
    socket.setTimeout(Math.min(timeoutMs, 6000), () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => resolve(false));
  });
}

export interface SslCheckInput {
  host: string;
  port?: number;
  /** Skip the four-connection protocol probe (faster, less information). */
  skipProtocolProbe?: boolean;
  timeoutMs?: number;
}

export async function sslCheck(input: SslCheckInput): Promise<SslCheckResult> {
  const started = performance.now();
  const host = (input.host ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (host.length === 0) throw invalidInput('Enter a hostname (for example example.com).');
  const hostAndPort = host.includes(':') && !host.includes('::') ? host : host;
  const [parsedHost, parsedPort] = hostAndPort.includes(':') ? [hostAndPort.slice(0, hostAndPort.lastIndexOf(':')), Number(hostAndPort.slice(hostAndPort.lastIndexOf(':') + 1))] : [hostAndPort, undefined];
  const port = input.port ?? parsedPort ?? 443;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw invalidInput('The port must be between 1 and 65535.');
  const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 10_000, 2000), 20_000);

  const addresses = await resolvePublicAddresses(parsedHost);
  const address = addresses[0];
  if (!address) throw new ToolError('DNS_LOOKUP_FAILED', `"${parsedHost}" did not resolve to an address.`);

  const outcome = await handshake(address, parsedHost, port, timeoutMs);
  const leaf = summarise(outcome.peer, 'leaf', outcome.authorized);
  const chain: ChainLink[] = [leaf];
  outcome.issuerChain.forEach((certificate, index) => {
    const position = index === outcome.issuerChain.length - 1 ? 'root' : 'intermediate';
    chain.push(summarise(certificate, position, outcome.authorized));
  });

  const hostnameCheck = /^[0-9a-f:.]+$/i.test(parsedHost)
    ? (() => {
        const names = [...leaf.subjectAltNames.map((entry) => entry.replace(/^DNS:/, '')), leaf.subject.CN ?? ''];
        return { matched: names.includes(parsedHost), reason: names.includes(parsedHost) ? null : `The certificate does not list ${parsedHost} in its alternative names or common name.` };
      })()
    : (() => {
        try {
          const error = tls.checkServerIdentity(parsedHost, outcome.peer);
          return { matched: !error, reason: error ? error.message : null };
        } catch (error) {
          return { matched: false, reason: error instanceof Error ? error.message : 'Hostname verification failed.' };
        }
      })();

  const problems: SslCheckResult['problems'] = [];
  if (!outcome.authorized) {
    problems.push({
      severity: 'error',
      code: 'CHAIN_NOT_TRUSTED',
      message: `Node's TLS stack did not authorise this certificate chain: ${outcome.authorizationError ?? 'unknown reason'}. Browsers will show a warning unless the root is trusted in their store.`,
      evidence: outcome.authorizationError,
    });
  }
  if (!hostnameCheck.matched) {
    problems.push({ severity: 'error', code: 'HOSTNAME_MISMATCH', message: hostnameCheck.reason ?? 'The certificate does not match the requested hostname.', evidence: leaf.subjectAltNames.slice(0, 10).join(', ') || leaf.subject.CN || null });
  }
  if (leaf.daysRemaining !== null && leaf.daysRemaining < 0) {
    problems.push({ severity: 'error', code: 'EXPIRED', message: `The certificate expired ${Math.abs(leaf.daysRemaining)} day(s) ago.`, evidence: leaf.validTo });
  } else if (leaf.daysRemaining !== null && leaf.daysRemaining <= EXPIRY_WARNING_DAYS) {
    problems.push({ severity: 'warning', code: 'EXPIRING_SOON', message: `The certificate expires in ${leaf.daysRemaining} day(s).`, evidence: leaf.validTo });
  }
  if (leaf.validFrom && new Date(leaf.validFrom).getTime() > Date.now()) {
    problems.push({ severity: 'error', code: 'NOT_YET_VALID', message: 'The certificate is not valid yet (its notBefore is in the future).', evidence: leaf.validFrom });
  }
  for (const problem of leaf.problems) problems.push({ severity: 'warning', code: 'LEAF_WEAKNESS', message: problem, evidence: leaf.fingerprintSha256 });
  if (outcome.issuerChain.length === 0) {
    problems.push({
      severity: 'warning',
      code: 'NO_INTERMEDIATES',
      message: 'The server sent no intermediate certificates. Some clients will fail to build the chain even though browsers with cached intermediates may succeed.',
      evidence: null,
    });
  }
  if (!outcome.ocspStapled) {
    problems.push({ severity: 'info', code: 'NO_OCSP_STAPLE', message: 'The server did not staple an OCSP response. This is not an error; stapling speeds up revocation checking for browsers that use it.', evidence: null });
  }

  const supportedProtocols: SslCheckResult['supportedProtocols'] = [];
  if (!input.skipProtocolProbe) {
    const versions: Array<{ version: 'TLSv1' | 'TLSv1.1' | 'TLSv1.2' | 'TLSv1.3'; label: string }> = [
      { version: 'TLSv1.3', label: 'TLS 1.3' },
      { version: 'TLSv1.2', label: 'TLS 1.2' },
      { version: 'TLSv1.1', label: 'TLS 1.1 (deprecated)' },
      { version: 'TLSv1', label: 'TLS 1.0 (deprecated)' },
    ];
    for (const entry of versions) {
      const supported = await probeProtocol(address, parsedHost, port, entry.version, timeoutMs);
      supportedProtocols.push({
        version: entry.label,
        supported,
        detail: supported
          ? entry.version === 'TLSv1' || entry.version === 'TLSv1.1'
            ? 'Accepted. PCI DSS and modern guidance require these to be disabled.'
            : 'Accepted.'
          : 'Refused (or the probe timed out).',
      });
    }
    for (const entry of supportedProtocols) {
      if (entry.supported && entry.version.startsWith('TLS 1.0')) problems.push({ severity: 'warning', code: 'LEGACY_TLS10', message: 'The server still accepts TLS 1.0; disable it.', evidence: 'protocol probe' });
      if (entry.supported && entry.version.startsWith('TLS 1.1')) problems.push({ severity: 'warning', code: 'LEGACY_TLS11', message: 'The server still accepts TLS 1.1; disable it.', evidence: 'protocol probe' });
    }
    if (!supportedProtocols.find((entry) => entry.version.startsWith('TLS 1.2'))?.supported && !supportedProtocols.find((entry) => entry.version.startsWith('TLS 1.3'))?.supported) {
      problems.push({ severity: 'error', code: 'NO_MODERN_TLS', message: 'Neither TLS 1.2 nor TLS 1.3 could be negotiated; every modern client will fail.', evidence: 'protocol probe' });
    }
  }

  const daysRemaining = leaf.daysRemaining;
  const expiryStatus: SslCheckResult['expiry']['status'] = daysRemaining === null ? 'OK' : daysRemaining < 0 ? 'EXPIRED' : leaf.validFrom && new Date(leaf.validFrom).getTime() > Date.now() ? 'NOT_YET_VALID' : daysRemaining <= EXPIRY_WARNING_DAYS ? 'EXPIRING_SOON' : 'OK';

  const recommendations: string[] = [];
  if (problems.some((problem) => problem.code === 'NO_INTERMEDIATES')) recommendations.push('Configure the server to send the full chain (leaf + intermediates). Most ACME clients do this by default; a misconfigured `fullchain.pem` reference is the usual cause when it is missing.');
  if (problems.some((problem) => problem.code === 'LEGACY_TLS10' || problem.code === 'LEGACY_TLS11')) recommendations.push('Set the TLS minimum version to 1.2 (or 1.3) in the web server configuration; cPanel/WHM exposes this per-domain under SSL/TLS → Manage SSL Hosts.');
  if (expiryStatus === 'EXPIRING_SOON') recommendations.push('Renew the certificate before it expires. On cPanel, check AutoSSL: it renews automatically unless a domain failed validation (HTTP-01 validation can fail if the domain\'s DNS or redirects changed).');
  if (expiryStatus === 'EXPIRED') recommendations.push('The certificate has expired: browsers will show a full-page warning. Renew immediately and, if this is a customer site, check whether the ACME validation is failing.');
  if (problems.some((problem) => problem.code === 'HOSTNAME_MISMATCH')) recommendations.push(`The certificate does not cover ${parsedHost}. Add it as a SAN (AutoSSL does this for domains pointed at the server) or fix the redirect/site mapping.`);

  const status: SslStatus =
    expiryStatus === 'NOT_YET_VALID'
      ? 'NOT_YET_VALID'
      : problems.some((problem) => problem.code === 'EXPIRED')
        ? 'EXPIRED'
        : problems.some((problem) => problem.code === 'HOSTNAME_MISMATCH')
          ? 'HOSTNAME_MISMATCH'
          : problems.some((problem) => problem.code === 'CHAIN_NOT_TRUSTED')
            ? 'CHAIN_NOT_TRUSTED'
            : expiryStatus === 'EXPIRING_SOON'
              ? 'EXPIRING_SOON'
              : 'VALID';
  const statusDetail =
    status === 'VALID'
      ? `The certificate is valid and trusted for ${parsedHost}, expiring in ${daysRemaining ?? 'an unknown number of'} day(s).`
      : status === 'EXPIRING_SOON'
        ? `The certificate is valid but expires in ${daysRemaining} day(s). Renew it now.`
        : status === 'EXPIRED'
          ? 'The certificate has expired; browsers will refuse the connection with a full-page warning.'
          : status === 'NOT_YET_VALID'
            ? 'The certificate is not valid yet (notBefore is in the future).'
            : status === 'HOSTNAME_MISMATCH'
              ? `The certificate does not cover ${parsedHost}.`
              : `The certificate chain is not trusted: ${outcome.authorizationError ?? 'verification failed'}.`;

  return {
    host: parsedHost,
    port,
    address,
    serverName: /^[0-9a-f:.]+$/i.test(parsedHost) ? null : parsedHost,
    status,
    statusDetail,
    verification: {
      authorized: outcome.authorized,
      authorizationError: outcome.authorizationError,
      hostnameMatch: hostnameCheck,
      chainComplete: outcome.issuerChain.length > 0,
      chainLength: chain.length,
      mozillaGuidance: 'Mozilla and the CA/Browser Forum require at least 2048-bit RSA (or 256-bit ECDSA), SHA-256 signatures, and a complete chain. This checker reports what the server sent; it cannot see root-store differences between browsers.',
    },
    certificate: leaf,
    chain,
    connection: {
      protocol: outcome.protocol,
      cipher: outcome.cipher,
      alpnProtocol: outcome.alpnProtocol,
      sessionResumed: outcome.sessionResumed,
      ocspStapled: outcome.ocspStapled,
      serverNameIndication: !/^[0-9a-f:.]+$/i.test(parsedHost),
    },
    supportedProtocols,
    expiry: {
      validTo: leaf.validTo,
      daysRemaining,
      status: expiryStatus,
      detail:
        daysRemaining === null
          ? 'The certificate did not report an expiry date.'
          : daysRemaining < 0
            ? `Expired ${Math.abs(daysRemaining)} day(s) ago.`
            : `Valid for ${daysRemaining} more day(s) (until ${leaf.validTo}).`,
    },
    problems,
    recommendations,
    durationMs: Math.round(performance.now() - started),
  };
}
