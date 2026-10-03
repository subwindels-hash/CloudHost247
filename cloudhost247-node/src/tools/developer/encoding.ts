/**
 * Tools Center — encoding / decoding tools (spec §35).
 *
 * Base64 and Base64URL, percent-encoding, hexadecimal, HTML entities, Unicode escapes, ROT13/ROT47,
 * binary text and JWT inspection.
 *
 * Two rules run through the whole file:
 *   - Decoding is strict. Invalid Base64, a bad percent escape or a JWT with the wrong number of
 *     segments is an error with a reason, never a best-effort guess.
 *   - The JWT tool decodes; it does not verify. It says so, loudly, every single time.
 */
import { invalidInput } from '../core/errors';
import { sanitizeUntrustedText } from '../core/validation';

export type EncodingFormat = 'base64' | 'base64url' | 'hex' | 'url' | 'html' | 'unicode-escape' | 'binary' | 'rot13' | 'rot47';

export interface EncodeResult {
  format: EncodingFormat;
  mode: 'encode' | 'decode';
  input: string;
  output: string;
  warnings: string[];
  notes: string[];
}

function assertSize(text: string): void {
  if (text.length > 500_000) throw invalidInput('Input is limited to 500,000 characters.');
}

export function encodeBase64(text: string, urlSafe = false): string {
  const base = Buffer.from(text, 'utf8').toString('base64');
  return urlSafe ? base.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : base;
}

export function decodeBase64(input: string): string {
  const normalized = input.trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw invalidInput('That is not valid Base64: it contains characters outside the Base64 alphabet.');
  }
  if (normalized.length % 4 === 1) {
    throw invalidInput('That is not valid Base64: the length is impossible (a valid Base64 string has a length that is a multiple of 4, ignoring padding).');
  }
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64').toString('utf8');
}

export function encodeHtmlEntities(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–', euro: '€', pound: '£', yen: '¥', cent: '¢', sect: '§', deg: '°', plusmn: '±', times: '×', divide: '÷', laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', bull: '•', middot: '·', dagger: '†', permil: '‰' };

export function decodeHtmlEntities(text: string): { output: string; unknown: string[] } {
  const unknown: string[] = [];
  const output = text.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (match, entity: string) => {
    if (entity.startsWith('#')) {
      const codePoint = entity[1]?.toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
        unknown.push(match);
        return match;
      }
      return String.fromCodePoint(codePoint);
    }
    const named = NAMED_ENTITIES[entity.toLowerCase()];
    if (named === undefined) {
      unknown.push(match);
      return match;
    }
    return named;
  });
  return { output, unknown };
}

function rot13(text: string): string {
  return text.replace(/[a-z]/gi, (character) => {
    const code = character.charCodeAt(0);
    const base = code >= 97 ? 97 : 65;
    return String.fromCharCode(((code - base + 13) % 26) + base);
  });
}

function rot47(text: string): string {
  return text.replace(/[!-~]/g, (character) => String.fromCharCode(33 + ((character.charCodeAt(0) - 33 + 47) % 94)));
}

export function convertEncoding(input: { text: string; format: EncodingFormat; mode: 'encode' | 'decode' }): EncodeResult {
  if (typeof input.text !== 'string') throw invalidInput('Provide the text to convert.');
  assertSize(input.text);
  const warnings: string[] = [];
  let output: string;

  switch (input.format) {
    case 'base64':
      output = input.mode === 'encode' ? encodeBase64(input.text, false) : decodeBase64(input.text);
      if (input.mode === 'encode') warnings.push('Standard Base64 uses + and /, which must be encoded in a URL. Use Base64URL for query strings and JWTs.');
      break;
    case 'base64url':
      output = input.mode === 'encode' ? encodeBase64(input.text, true) : decodeBase64(input.text);
      break;
    case 'hex':
      output =
        input.mode === 'encode'
          ? Buffer.from(input.text, 'utf8').toString('hex')
          : (() => {
              const cleaned = input.text.replace(/\s+/g, '');
              if (!/^[0-9a-f]*$/i.test(cleaned)) throw invalidInput('Hexadecimal decoding accepts only 0-9, a-f and whitespace.');
              if (cleaned.length % 2 !== 0) throw invalidInput('Hexadecimal input must have an even number of digits.');
              return Buffer.from(cleaned, 'hex').toString('utf8');
            })();
      break;
    case 'url':
      output = input.mode === 'encode' ? encodeURIComponent(input.text) : (() => {
        try {
          return decodeURIComponent(input.text.replace(/\+/g, '%20'));
        } catch {
          throw invalidInput('The percent-encoding is malformed (a % is not followed by two hexadecimal digits).');
        }
      })();
      if (input.mode === 'encode') warnings.push('encodeURIComponent escapes everything that is not unreserved, including / ? & = — correct for a single value, wrong for a whole URL. Use the URL tools page for whole URLs.');
      break;
    case 'html':
      if (input.mode === 'encode') output = encodeHtmlEntities(input.text);
      else {
        const decoded = decodeHtmlEntities(input.text);
        output = decoded.output;
        if (decoded.unknown.length > 0) warnings.push(`These entities are not in this tool's table and were left as-is: ${decoded.unknown.slice(0, 10).join(', ')}`);
      }
      break;
    case 'unicode-escape':
      output =
        input.mode === 'encode'
          ? input.text.replace(/[^\x20-\x7e]/g, (character) => [...character].map((entry) => `\\u${entry.codePointAt(0)!.toString(16).padStart(4, '0')}`).join(''))
          : input.text.replace(/\\u\{([0-9a-f]{1,6})\}|\\u([0-9a-f]{4})|\\x([0-9a-f]{2})/gi, (match, brace: string | undefined, four: string | undefined, two: string | undefined) => {
              const hex = brace ?? four ?? two;
              if (!hex) return match;
              return String.fromCodePoint(Number.parseInt(hex, 16));
            });
      break;
    case 'binary':
      output =
        input.mode === 'encode'
          ? [...Buffer.from(input.text, 'utf8')].map((byte) => byte.toString(2).padStart(8, '0')).join(' ')
          : (() => {
              const bits = input.text.replace(/[^01]/g, '');
              if (bits.length === 0) throw invalidInput('Binary decoding found no 0 or 1 digits.');
              if (bits.length % 8 !== 0) warnings.push(`The digit count is ${bits.length}, which is not a multiple of 8; the final partial byte was padded with zeros.`);
              const padded = bits.padEnd(Math.ceil(bits.length / 8) * 8, '0');
              const bytes: number[] = [];
              for (let index = 0; index < padded.length; index += 8) bytes.push(Number.parseInt(padded.slice(index, index + 8), 2));
              return Buffer.from(bytes).toString('utf8');
            })();
      break;
    case 'rot13':
      output = rot13(input.text);
      if (input.mode === 'encode') warnings.push('ROT13 is not encryption and offers no security. Decode uses the same operation.');
      break;
    case 'rot47':
      output = rot47(input.text);
      if (input.mode === 'encode') warnings.push('ROT47 is not encryption and offers no security. Decode uses the same operation.');
      break;
    default:
      throw invalidInput(`"${input.format}" is not a supported format.`);
  }

  return {
    format: input.format,
    mode: input.mode,
    input: input.text,
    output,
    warnings,
    notes: [
      input.mode === 'encode' ? 'Encoding is not encryption: it is reversible by anyone, and it hides nothing.' : 'Decoding succeeded; the result is text as interpreted by this server, which may not match the encoding the producer intended (UTF-8 is assumed).',
      'Nothing is stored or logged: the text is transformed in memory and returned in this response.',
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// JWT
// ---------------------------------------------------------------------------------------------

export interface JwtInspection {
  segments: number;
  header: Record<string, unknown> | null;
  payload: Record<string, unknown> | null;
  signature: { present: boolean; bytes: number | null; algorithm: string | null };
  registeredClaims: Array<{ claim: string; value: string; meaning: string; status: 'ok' | 'warning' | 'info' }>;
  securityNotes: string[];
  verified: false;
}

const CLAIM_MEANINGS: Record<string, string> = {
  iss: 'Issuer — who created the token.',
  sub: 'Subject — usually the user or entity the token is about.',
  aud: 'Audience — who the token is intended for.',
  exp: 'Expiry time (seconds since the Unix epoch). After this moment the token must be rejected.',
  nbf: 'Not before (seconds since the Unix epoch). Before this moment the token must be rejected.',
  iat: 'Issued at (seconds since the Unix epoch).',
  jti: 'JWT ID — a unique identifier for this token, used for revocation lists.',
};

export function inspectJwt(input: { token: string }): JwtInspection {
  const token = input.token.trim().replace(/^Bearer\s+/i, '');
  if (token.length === 0) throw invalidInput('Paste a JWT to inspect.');
  if (token.length > 100_000) throw invalidInput('That is too long to be a JWT.');
  const segments = token.split('.');
  if (segments.length !== 3) throw invalidInput(`A JWT has exactly three dot-separated segments; this one has ${segments.length}.`);

  const decode = (segment: string, label: string): Record<string, unknown> => {
    try {
      return JSON.parse(decodeBase64(segment)) as Record<string, unknown>;
    } catch {
      throw invalidInput(`The ${label} segment is not valid Base64URL-encoded JSON.`);
    }
  };

  const header = decode(segments[0]!, 'header');
  const payload = decode(segments[1]!, 'payload');
  const signaturePart = segments[2] ?? '';
  const algorithm = typeof header.alg === 'string' ? header.alg : null;

  const now = Math.floor(Date.now() / 1000);
  const registeredClaims: JwtInspection['registeredClaims'] = [];
  for (const [claim, meaning] of Object.entries(CLAIM_MEANINGS)) {
    if (!(claim in payload)) continue;
    const raw = payload[claim];
    if ((claim === 'exp' || claim === 'nbf' || claim === 'iat') && typeof raw === 'number') {
      const iso = new Date(raw * 1000).toISOString();
      let status: 'ok' | 'warning' | 'info' = 'info';
      let suffix = '';
      if (claim === 'exp') {
        status = raw < now ? 'warning' : 'ok';
        suffix = raw < now ? ` — EXPIRED ${Math.round((now - raw) / 60)} minutes ago` : ` — valid for another ${Math.round((raw - now) / 60)} minutes`;
      }
      if (claim === 'nbf' && raw > now) {
        status = 'warning';
        suffix = ` — not valid for another ${Math.round((raw - now) / 60)} minutes`;
      }
      registeredClaims.push({ claim, value: `${raw} (${iso})${suffix}`, meaning, status });
      continue;
    }
    registeredClaims.push({ claim, value: sanitizeUntrustedText(JSON.stringify(raw), { maxLength: 300 }), meaning, status: 'info' });
  }

  const securityNotes = [
    'This tool decodes the token and shows its contents. It does NOT verify the signature, and it does not check the claims against a key, an issuer or an audience. A token that decodes cleanly can still be forged, expired or intended for a different service.',
    'Never paste a production token into a third-party decoder: whoever receives it can use it as you until it expires. Prefer decoding locally. If you did paste one here, treat it as compromised and revoke it.',
    'For a token in a browser, only a server that holds the signing key can tell you whether the signature is genuine.',
  ];
  if (algorithm === 'none') {
    securityNotes.push('This token declares alg: "none". A verifier that accepts that algorithm accepts unsigned tokens from anyone. This is a known vulnerability class (algorithm confusion).');
  }
  if (typeof header.alg === 'string' && /^HS/.test(header.alg)) {
    securityNotes.push('HMAC-signed tokens (HS*) use a shared secret. If the same secret is used for symmetric signing and for a public-key verification path, the alg-confusion attack applies.');
  }

  return {
    segments: 3,
    header,
    payload,
    signature: { present: signaturePart.length > 0, bytes: signaturePart.length > 0 ? Math.floor((signaturePart.length * 3) / 4) : null, algorithm },
    registeredClaims,
    securityNotes,
    verified: false,
  };
}

export { invalidInput as encodingInvalidInput };
