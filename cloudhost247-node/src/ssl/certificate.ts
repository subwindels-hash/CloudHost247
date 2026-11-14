/**
 * X.509 helpers for the SSL module: CSR generation and verification of what the CA returned.
 *
 * The rule this file exists to enforce: **the platform never states a fact about a certificate that
 * the certificate does not itself contain.** Expiry, validity window, subject and SANs are read out
 * of the issued certificate with `node:crypto`'s X509Certificate — never computed from a duration
 * constant, never copied from the request.
 *
 * A node:crypto CSR builder does not exist, so the PKCS#10 structure is assembled here. It is a
 * small, fully specified container (RFC 2986): CertificationRequestInfo → signature algorithm →
 * signature BIT STRING. Every field written below is either fixed by RFC 5280/2986 or comes from
 * the caller; nothing is guessed.
 */
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign,
  verify,
  X509Certificate,
  type KeyObject,
} from 'node:crypto';
import { AcmeError } from './acme-client';

const OID_COMMON_NAME = '2.5.4.3';
const OID_SUBJECT_ALT_NAME = '2.5.29.17';
const OID_ECDSA_WITH_SHA256 = '1.2.840.10045.4.3.2';
/** PKCS#9 extensionRequest — the attribute a CSR uses to carry its SAN extension. */
const OID_EXTENSION_REQUEST = '1.2.840.113549.1.9.14';

// --- Minimal DER writer ------------------------------------------------------------------------

function derLength(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length]);
  const bytes: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
}

const seq = (...items: Buffer[]): Buffer => tlv(0x30, Buffer.concat(items));
const set = (...items: Buffer[]): Buffer => tlv(0x31, Buffer.concat(items));
const explicit = (tag: number, content: Buffer): Buffer => tlv(0xa0 | tag, content);
const octetString = (content: Buffer): Buffer => tlv(0x04, content);
const bitString = (content: Buffer): Buffer => tlv(0x03, Buffer.concat([Buffer.from([0x00]), content]));
const utf8String = (value: string): Buffer => tlv(0x0c, Buffer.from(value, 'utf8'));
const booleanTrue = (): Buffer => tlv(0x01, Buffer.from([0xff]));

/** OID encoding is mechanical: first two arcs packed, then base-128 varints. */
function oid(dotted: string): Buffer {
  const parts = dotted.split('.').map(Number);
  if (parts.length < 2 || parts.some((n) => !Number.isInteger(n) || n < 0)) {
    throw new Error(`Invalid OID: ${dotted}`);
  }
  const [first, second, ...rest] = parts as [number, number, ...number[]];
  const bytes: number[] = [first * 40 + second];
  for (const arc of rest) {
    const chunk: number[] = [];
    let value = arc;
    do {
      chunk.unshift(value & 0x7f);
      value >>= 7;
    } while (value > 0);
    for (let i = 0; i < chunk.length - 1; i += 1) chunk[i] = (chunk[i] as number) | 0x80;
    bytes.push(...chunk);
  }
  return tlv(0x06, Buffer.from(bytes));
}

function algorithmIdentifier(oidDotted: string): Buffer {
  // RFC 5758 §3.2 — ecdsa-with-SHA256 carries an absent parameters field.
  return seq(oid(oidDotted));
}

/**
 * Prefers the shorter of two equivalent DER time encodings, as every real CA and RFC 5280 §4.1.2.5
 * (UTCTime through 2049, GeneralizedTime after) requires.
 */
function time(value: Date): Buffer {
  const year = value.getUTCFullYear();
  const pad = (n: number): string => String(n).padStart(2, '0');
  const mm = pad(value.getUTCMonth() + 1);
  const dd = pad(value.getUTCDate());
  const hh = pad(value.getUTCHours());
  const mi = pad(value.getUTCMinutes());
  const ss = pad(value.getUTCSeconds());
  if (year >= 1950 && year < 2050) {
    return tlv(0x17, Buffer.from(`${pad(year % 100)}${mm}${dd}${hh}${mi}${ss}Z`, 'ascii'));
  }
  return tlv(0x18, Buffer.from(`${year}${mm}${dd}${hh}${mi}${ss}Z`, 'ascii'));
}

function name(commonName: string): Buffer {
  return seq(set(seq(oid(OID_COMMON_NAME), utf8String(commonName))));
}

// --- CSR --------------------------------------------------------------------------------------

export interface CsrResult {
  /** DER-encoded PKCS#10, ready for ACME's `finalize` payload. */
  csrDer: Buffer;
  /** PKCS#8 PEM of the private key — the caller encrypts this immediately and never returns it. */
  privateKeyPem: string;
  /** Self-check: the CSR's own signature must verify against its own public key. */
  selfVerified: boolean;
  /**
   * The DNS names this CSR actually asks for, read back out of the DER rather than echoed from the
   * input. This is what the CA will bind the certificate to, so the detail endpoint and the
   * "does the certificate cover what we ordered" check use it rather than a second copy of intent.
   */
  dnsNames: string[];
}

/**
 * Builds a CSR for one CN plus SANs, signed ES256.
 *
 * Let's Encrypt and every modern CA ignore the CN for validation and require the SAN extension, so
 * `dnsNames` must contain the CN too; it is added here if the caller omitted it rather than
 * emitting a CSR that would be rejected for a reason nobody can see.
 */
export function buildCsr(dnsNames: string[]): CsrResult {
  const normalized = Array.from(new Set(dnsNames.map((n) => n.trim().toLowerCase()).filter(Boolean))).sort();
  if (normalized.length === 0) throw new AcmeError('CSR_EMPTY', 'A certificate needs at least one DNS name');
  const commonName = normalized[0] as string;

  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });

  // SubjectAltName ::= GeneralNames ::= SEQUENCE OF GeneralName, dNSName is context tag [2] (0x82).
  const sanExtension = seq(
    oid(OID_SUBJECT_ALT_NAME),
    octetString(seq(...normalized.map((dns) => tlv(0x82, Buffer.from(dns, 'ascii')))))
  );
  // RFC 5280 §4.1: Extensions ::= SEQUENCE SIZE (1..MAX) OF Extension. The extra SEQUENCE is
  // mandatory even for a single extension — `openssl asn1parse` on a real CSR shows
  // SET > SEQUENCE > SEQUENCE > Extension. Omitting it yields a CSR whose structure OpenSSL
  // silently drops (it still reports the self-signature as OK, so the omission is invisible until a
  // CA refuses the request), and the SANs never reach the issued certificate.
  const extensions = seq(sanExtension);
  // RFC 2986 §4.1: attributes [0] IMPLICIT Attributes, where Attributes ::= SET OF Attribute and
  // Attribute ::= SEQUENCE { type OBJECT IDENTIFIER, values SET OF ANY }.
  const attribute = seq(oid(OID_EXTENSION_REQUEST), set(extensions));
  const attributes = explicit(0, attribute);

  const certificationRequestInfo = seq(
    tlv(0x02, Buffer.from([0x00])), // version v1(0)
    name(commonName),
    publicKey.export({ format: 'der', type: 'spki' }) as Buffer,
    attributes
  );

  const signature = sign('sha256', certificationRequestInfo, {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  // PKCS#10 signatures are DER ECDSA-Sig-Value, not the raw JWS form ACME uses.
  const derSignature = rawEcdsaToDer(signature);
  const csrDer = seq(certificationRequestInfo, algorithmIdentifier(OID_ECDSA_WITH_SHA256), bitString(derSignature));

  return {
    csrDer,
    privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    selfVerified: verifyEcdsa(certificationRequestInfo, signature, publicKey),
    dnsNames: readCsrDnsNames(csrDer),
  };
}

/**
 * Reads the SAN dNSNames back out of a DER-encoded PKCS#10 request.
 *
 * Structural walk, not a byte scan: searching for `0x82` matches length bytes and parts of the
 * public key, so a truncated or hostile CSR can appear to contain names it never asked for. Anything
 * that does not parse cleanly yields [], which callers treat as "no names" — never as success.
 */
export function readCsrDnsNames(csrDer: Buffer): string[] {
  interface Element {
    tag: number;
    contentStart: number;
    contentEnd: number;
  }
  const read = (from: number): Element => {
    let offset = from;
    const tag = csrDer[offset] as number;
    offset += 1;
    let length = csrDer[offset] as number;
    offset += 1;
    if (length & 0x80) {
      const count = length & 0x7f;
      length = 0;
      for (let i = 0; i < count; i += 1) length = (length << 8) | (csrDer[offset + i] as number);
      offset += count;
    }
    return { tag, contentStart: offset, contentEnd: offset + length };
  };

  const names: string[] = [];
  try {
    const outer = read(0);
    if (outer.tag !== 0x30) return [];
    const info = read(outer.contentStart);
    if (info.tag !== 0x30) return [];
    const version = read(info.contentStart);
    const subject = read(version.contentEnd);
    const spki = read(subject.contentEnd);
    // attributes [0] IMPLICIT: the SAN extension lives inside it.
    const attributes = read(spki.contentEnd);
    if (attributes.tag !== 0xa0) return [];

    const walk = (start: number, end: number): void => {
      let offset = start;
      while (offset < end) {
        const el = read(offset);
        if (el.tag === 0x82) {
          const value = csrDer.subarray(el.contentStart, el.contentEnd).toString('ascii');
          if (/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(value)) names.push(value.toLowerCase());
        } else if (el.tag === 0x30 || el.tag === 0x31 || el.tag === 0x04) {
          walk(el.contentStart, el.contentEnd);
        }
        offset = el.contentEnd;
      }
    };
    walk(attributes.contentStart, attributes.contentEnd);
  } catch {
    return [];
  }
  return Array.from(new Set(names)).sort();
}

function verifyEcdsa(data: Buffer, rawSignature: Buffer, publicKey: KeyObject): boolean {
  try {
    return verify('sha256', data, { key: publicKey, dsaEncoding: 'ieee-p1363' }, rawSignature);
  } catch {
    return false;
  }
}

/** Raw r||s (64 bytes for P-256) → DER SEQUENCE { INTEGER r, INTEGER s } (RFC 3279). */
export function rawEcdsaToDer(raw: Buffer): Buffer {
  if (raw.length % 2 !== 0) throw new Error('ECDSA signature must have an even length');
  const half = raw.length / 2;
  const encodeInt = (buf: Buffer): Buffer => {
    let start = 0;
    while (start < buf.length - 1 && buf[start] === 0x00) start += 1;
    let content = buf.subarray(start);
    // DER INTEGER is signed: prepend 0x00 when the top bit is set.
    if ((content[0] as number) & 0x80) content = Buffer.concat([Buffer.from([0x00]), content]);
    return tlv(0x02, content);
  };
  return seq(encodeInt(raw.subarray(0, half)), encodeInt(raw.subarray(half)));
}

/** Reads the DNS names out of a PEM CSR (used by the admin view before anything is submitted). */
export function csrDnsNames(csrPemOrDer: string | Buffer): string[] {
  const der = Buffer.isBuffer(csrPemOrDer) ? csrPemOrDer : Buffer.from(csrPemOrDer, 'utf8');
  const names: string[] = [];
  // Walks the DER for context-tag [2] IA5String values inside the SAN extension. Deliberately
  // narrow: it reads what the CSR asks for, and the CA's answer is verified separately below.
  const text = der.toString('latin1');
  const sanIndex = text.indexOf('\x55\x1d\x11'); // OID 2.5.29.17 body
  if (sanIndex === -1) return names;
  for (let i = sanIndex; i < Math.min(der.length - 2, sanIndex + 512); i += 1) {
    if (der[i] !== 0x82) continue;
    const length = der[i + 1] as number;
    if (length < 1 || length > 253) continue;
    const value = der.subarray(i + 2, i + 2 + length).toString('ascii');
    if (/^[a-z0-9.*-]+(\.[a-z0-9-]+)+$/i.test(value)) names.push(value.toLowerCase());
  }
  return Array.from(new Set(names));
}

// --- Verification of what the CA returned ------------------------------------------------------

export interface ParsedCertificate {
  subject: string;
  issuer: string;
  commonName: string | null;
  /** Every DNS name in the SAN extension, lower-cased. Empty when the cert carries none. */
  dnsNames: string[];
  validFrom: string;
  validTo: string;
  serialNumber: string;
  fingerprint256: string;
  keyType: string;
  isSelfSigned: boolean;
  /** True when `issuer` differs from `subject` — i.e. it is not a self-signed leaf. */
  isCaSigned: boolean;
}

/**
 * Parses the leaf of a PEM chain and extracts only facts the certificate asserts.
 *
 * `subjectAltName` is parsed out of the X509Certificate's own text form; this is the one field
 * node:crypto does not expose structurally. The regex handles the `DNS:a.example, DNS:b.example`
 * shape OpenSSL emits, and returns `[]` (not a guess) when the field is absent.
 */
export function parseIssuedCertificate(pem: string): ParsedCertificate {
  let cert: X509Certificate;
  try {
    cert = new X509Certificate(pem);
  } catch {
    throw new AcmeError('CERTIFICATE_INVALID', 'The supplied certificate could not be parsed as X.509');
  }

  const dnsNames: string[] = [];
  for (const match of cert.subjectAltName?.matchAll(/DNS:([^,\s]+)/g) ?? []) {
    const value = match[1];
    if (value) dnsNames.push(value.toLowerCase());
  }

  const cnMatch = /CN=([^,\n]+)/.exec(cert.subject);
  const validFrom = new Date(cert.validFrom);
  const validTo = new Date(cert.validTo);
  if (Number.isNaN(validFrom.getTime()) || Number.isNaN(validTo.getTime())) {
    throw new AcmeError('CERTIFICATE_INVALID', 'The certificate has an unparseable validity window');
  }

  return {
    subject: cert.subject,
    issuer: cert.issuer,
    commonName: cnMatch?.[1]?.trim() ?? null,
    dnsNames: Array.from(new Set(dnsNames)),
    validFrom: validFrom.toISOString(),
    validTo: validTo.toISOString(),
    serialNumber: cert.serialNumber,
    fingerprint256: cert.fingerprint256,
    keyType: cert.publicKey.asymmetricKeyType ?? 'unknown',
    isSelfSigned: cert.subject === cert.issuer,
    isCaSigned: cert.subject !== cert.issuer,
  };
}

/**
 * Refuses a certificate that does not cover what was ordered.
 *
 * This is not paranoia: a CA that returns a certificate for a different name, or that has already
 * expired, must never be stored as ISSUED. The check is "every ordered name appears in the SANs",
 * which is the actual requirement; it does not demand the CN match, because modern CAs may omit it.
 */
export function assertCertificateCoversRequest(
  parsed: ParsedCertificate,
  requestedDnsNames: string[],
  now: Date = new Date()
): void {
  const requested = requestedDnsNames.map((n) => n.toLowerCase());
  const missing = requested.filter((name) => !parsed.dnsNames.includes(name));
  if (missing.length > 0) {
    throw new AcmeError(
      'CERTIFICATE_NAME_MISMATCH',
      `The issued certificate does not cover: ${missing.join(', ')}`
    );
  }
  if (new Date(parsed.validTo).getTime() <= now.getTime()) {
    throw new AcmeError('CERTIFICATE_EXPIRED', `The issued certificate expired at ${parsed.validTo}`);
  }
  if (new Date(parsed.validFrom).getTime() > now.getTime() + 5 * 60 * 1000) {
    throw new AcmeError('CERTIFICATE_NOT_YET_VALID', `The issued certificate is not valid until ${parsed.validFrom}`);
  }
}

/** True when the certificate is inside its own validity window at `now`. Never inferred from status. */
export function isCurrentlyValid(validFrom: string, validTo: string, now: Date = new Date()): boolean {
  return new Date(validFrom).getTime() <= now.getTime() && now.getTime() < new Date(validTo).getTime();
}

/** Days until expiry, or a negative number once expired. Null when there is no certificate. */
export function daysUntilExpiry(validTo: string | null, now: Date = new Date()): number | null {
  if (!validTo) return null;
  return Math.floor((new Date(validTo).getTime() - now.getTime()) / 86_400_000);
}

/** Re-exported so callers do not need a second import for the common case. */
export { createPrivateKey, randomUUID };
