/**
 * DEV/TEST ONLY — a minimal DER writer, shared by the test fixtures.
 *
 * Two callers need genuine ASN.1 bytes: the loopback ACME CA (which must issue real X.509) and the
 * tests that need "existing real certificate material" (a pasted CUSTOM certificate). Both used to
 * carry their own copy of these helpers, which meant a DER fix had to be applied twice — and the
 * copies drifted. Everything here is small, pure and has no dependencies beyond `node:crypto`.
 *
 * Correctness of this writer is not taken on trust: every certificate it produces is verified with
 * OpenSSL in the SSL suite, and it was OpenSSL that caught the one real bug this code has had (a
 * non-minimal INTEGER serial, which makes a certificate unparseable).
 */
import { generateKeyPairSync, sign } from 'node:crypto';

export function derLength(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length]);
  const bytes: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

export const tlv = (tag: number, content: Buffer): Buffer =>
  Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
export const seq = (...items: Buffer[]): Buffer => tlv(0x30, Buffer.concat(items));
export const set = (...items: Buffer[]): Buffer => tlv(0x31, Buffer.concat(items));
export const explicit = (tag: number, content: Buffer): Buffer => tlv(0xa0 | tag, content);
export const octetString = (content: Buffer): Buffer => tlv(0x04, content);
export const bitString = (content: Buffer): Buffer => tlv(0x03, Buffer.concat([Buffer.from([0x00]), content]));
export const utf8 = (v: string): Buffer => tlv(0x0c, Buffer.from(v, 'utf8'));
export const integer = (v: Buffer): Buffer => tlv(0x02, v);

/** Encodes a dotted OID (e.g. `2.5.29.17`) as a primitive OBJECT IDENTIFIER. */
export function oid(dotted: string): Buffer {
  const parts = dotted.split('.').map(Number);
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

/** UTCTime (tag 0x17) in the `YYMMDDHHMMSSZ` form DER requires for years 1950–2049. */
export function utcTime(date: Date): Buffer {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return tlv(
    0x17,
    Buffer.from(
      `${pad(date.getUTCFullYear() % 100)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(
        date.getUTCHours()
      )}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`,
      'ascii'
    )
  );
}

/** A single-RDN Name carrying one CN, as both a CSR subject and a certificate subject need. */
export function name(commonName: string): Buffer {
  return seq(set(seq(oid('2.5.4.3'), utf8(commonName))));
}

/**
 * DER forbids non-minimal INTEGER content, so a serial number must not be zero-padded. Encoding
 * `'0011'` or `'0000000000000002'` yields "illegal padding" and makes the *whole certificate*
 * unparseable — OpenSSL reports `BAD INTEGER` / `Could not read certificate`. This is the one bug
 * this helper has produced, so the rule is enforced in a single place.
 */
export function serialNumber(value: bigint): Buffer {
  let hex = value.toString(16);
  if (hex.length % 2 === 1) hex = `0${hex}`;
  let bytes = Buffer.from(hex, 'hex');
  // Positive values whose top bit is set need a leading 0x00 to stay positive.
  if ((bytes[0] as number) & 0x80) bytes = Buffer.concat([Buffer.from([0]), bytes]);
  return integer(bytes);
}

/** Unwraps a raw (JWS-style, r||s) ECDSA signature into an `ECDSA-Sig-Value` SEQUENCE. */
export function rawSignatureToDer(raw: Buffer): Buffer {
  const half = raw.length / 2;
  const enc = (buf: Buffer): Buffer => {
    let start = 0;
    while (start < buf.length - 1 && buf[start] === 0) start += 1;
    let content = buf.subarray(start);
    if ((content[0] as number) & 0x80) content = Buffer.concat([Buffer.from([0]), content]);
    return integer(content);
  };
  return seq(enc(raw.subarray(0, half)), enc(raw.subarray(half)));
}

const OID_ECDSA_WITH_SHA256 = '1.2.840.10045.4.3.2';
const OID_SUBJECT_ALT_NAME = '2.5.29.17';

/**
 * The SubjectAltName extension (dNSName is context tag [2]) — the only place modern CAs look.
 *
 * NOTE the two levels of SEQUENCE: `Extensions ::= SEQUENCE OF Extension`, so a single extension
 * still needs the outer SEQUENCE. Wrapping only the extension itself produces `[3] { Extension }`
 * where X.509 requires `[3] { Extensions }`, and OpenSSL rejects the whole certificate with
 * "Could not read certificate" — a failure with no hint about which structure is wrong.
 */
export function subjectAltNameExtensions(dnsNames: string[]): Buffer {
  const extension = seq(
    oid(OID_SUBJECT_ALT_NAME),
    octetString(seq(...dnsNames.map((dns) => tlv(0x82, Buffer.from(dns, 'ascii')))))
  );
  return seq(extension);
}

/**
 * Builds a genuinely valid, self-signed X.509 certificate for the given DNS names.
 *
 * Used by tests that need pre-existing real certificate material (a customer pasting a CUSTOM
 * certificate). Two things this must not do: pretend to be CA-issued (the issuer equals the subject,
 * and `parseIssuedCertificate` reports `isSelfSigned`), and produce bytes that only *our* parser
 * accepts — hence the SAN extension and a real ECDSA signature OpenSSL can verify.
 */
export function createSelfSignedCertificate(dnsNames: string[], validityDays = 90): string {
  const names = Array.from(new Set(dnsNames.map((n) => n.toLowerCase()))).sort();
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });

  const now = new Date(Date.now() - 60_000); // avoid clock-skew flakiness on notBefore
  const notAfter = new Date(now.getTime() + validityDays * 86_400_000);
  const subject = name(names[0] as string);
  const spki = publicKey.export({ format: 'der', type: 'spki' }) as Buffer;

  const tbs = seq(
    explicit(0, tlv(0x02, Buffer.from([0x02]))), // version v3
    serialNumber(BigInt(Date.now())), // strictly positive, minimal encoding
    seq(oid(OID_ECDSA_WITH_SHA256)),
    subject,
    seq(utcTime(now), utcTime(notAfter)),
    subject,
    spki,
    explicit(3, subjectAltNameExtensions(names))
  );

  const der = seq(
    tbs,
    seq(oid(OID_ECDSA_WITH_SHA256)),
    bitString(rawSignatureToDer(sign('sha256', tbs, { key: privateKey, dsaEncoding: 'ieee-p1363' })))
  );

  return `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g)?.join('\n')}\n-----END CERTIFICATE-----\n`;
}

/**
 * Reads the DNS names out of a DER-encoded PKCS#10 CSR by walking the structure, rather than by
 * scanning for `0x82` bytes — a scan can match a length byte or a public-key byte and silently
 * report a name the CSR never contained (it did, before this was rewritten).
 *
 * Returns [] when the CSR carries no SAN extension; the caller decides whether that is a refusal.
 */
export function csrDnsNames(csrDer: Buffer): string[] {
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

  const outer = read(0);
  if (outer.tag !== 0x30) throw new Error('CSR: expected SEQUENCE');
  const info = read(outer.contentStart);
  if (info.tag !== 0x30) throw new Error('CSR: expected CertificationRequestInfo');
  const version = read(info.contentStart); // INTEGER
  const subject = read(version.contentEnd); // Name
  const spki = read(subject.contentEnd); // SubjectPublicKeyInfo

  // attributes [0] IMPLICIT: SEQUENCE OF Attribute { type OID, values SET OF Extension }.
  // The SubjectAltName extension is an OCTET STRING wrapping GeneralNames.
  const attributes = read(spki.contentEnd);
  if (attributes.tag !== 0xa0) return [];

  const names: string[] = [];
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
  return Array.from(new Set(names));
}
