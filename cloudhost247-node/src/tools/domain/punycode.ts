/**
 * Tools Center — Punycode / IDN converter (spec §45).
 *
 * Implements the Punycode algorithm (RFC 3492) directly. That is deliberate: the `punycode` module
 * that used to ship with Node is deprecated, and the alternative (`url.domainToASCII`) applies the
 * full IDNA/UTS-46 mapping — which silently rewrites more than Punycode does, so it is a useful
 * cross-check but not a substitute when the question is "what does Punycode do to this label?".
 *
 * The converter reports both: the raw RFC 3492 label encoding, and what Node's IDNA implementation
 * produces for the whole domain, plus a mixed-script warning because homograph domains are the
 * reason most people need this tool at all.
 */
import { invalidInput } from '../core/errors';
import { domainToASCII, domainToUnicode } from 'node:url';
import { normalizeDomain } from '../dns/common';

const BASE = 36;
const TMIN = 1;
const TMAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;
const DELIMITER = '-';

function adapt(delta: number, numPoints: number, firstTime: boolean): number {
  let value = firstTime ? Math.floor(delta / DAMP) : delta >> 1;
  value += Math.floor(value / numPoints);
  let k = 0;
  const limit = Math.floor(((BASE - TMIN) * TMAX) / 2);
  while (value > limit) {
    value = Math.floor(value / (BASE - TMIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - TMIN + 1) * value) / (value + SKEW));
}

function encodeDigit(digit: number): string {
  return String.fromCharCode(digit < 26 ? digit + 97 : digit - 26 + 48);
}

function decodeDigit(code: number): number | null {
  if (code >= 48 && code <= 57) return code - 48 + 26;
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 97;
  return null;
}

/** RFC 3492 §6.3 — the raw Punycode encoder for one label. */
export function punycodeEncode(input: string): string {
  const codePoints = [...input].map((character) => character.codePointAt(0)!);
  let n = INITIAL_N;
  let delta = 0;
  let bias = INITIAL_BIAS;
  const basic = codePoints.filter((code) => code < 0x80);
  let output = basic.map((code) => String.fromCharCode(code)).join('');
  let handled = basic.length;
  if (handled > 0) output += DELIMITER;

  while (handled < codePoints.length) {
    let m = Number.MAX_SAFE_INTEGER;
    for (const code of codePoints) if (code >= n && code < m) m = code;
    if (m - n > Math.floor((Number.MAX_SAFE_INTEGER - delta) / (handled + 1))) throw invalidInput('The label is too large to encode.');
    delta += (m - n) * (handled + 1);
    n = m;
    for (const code of codePoints) {
      if (code < n) {
        delta += 1;
        if (delta > Number.MAX_SAFE_INTEGER) throw invalidInput('The label is too large to encode.');
      }
      if (code === n) {
        let q = delta;
        for (let k = BASE; ; k += BASE) {
          const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
          if (q < t) break;
          output += encodeDigit(t + ((q - t) % (BASE - t)));
          q = Math.floor((q - t) / (BASE - t));
        }
        output += encodeDigit(q);
        bias = adapt(delta, handled + 1, handled === basic.length);
        delta = 0;
        handled += 1;
      }
    }
    delta += 1;
    n += 1;
  }
  return output;
}

/** RFC 3492 §6.2 — the decoder. Throws on malformed input instead of guessing. */
export function punycodeDecode(input: string): string {
  const output: number[] = [];
  let n = INITIAL_N;
  let i = 0;
  let bias = INITIAL_BIAS;
  const delimiterIndex = input.lastIndexOf(DELIMITER);
  let index = 0;
  if (delimiterIndex !== -1) {
    for (const character of input.slice(0, delimiterIndex)) {
      const code = character.codePointAt(0) ?? 0;
      if (code >= 0x80) throw invalidInput('The basic part of a Punycode label must be ASCII.');
      output.push(code);
    }
    index = delimiterIndex + 1;
  }

  while (index < input.length) {
    const oldi = i;
    let w = 1;
    for (let k = BASE; ; k += BASE) {
      if (index >= input.length) throw invalidInput('The Punycode input ended unexpectedly.');
      const digit = decodeDigit(input.charCodeAt(index));
      if (digit === null) throw invalidInput(`"${input[index]}" is not a valid Punycode digit.`);
      index += 1;
      if (digit > Math.floor((Number.MAX_SAFE_INTEGER - i) / w)) throw invalidInput('The Punycode input overflows.');
      i += digit * w;
      const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
      if (digit < t) break;
      if (w > Math.floor(Number.MAX_SAFE_INTEGER / (BASE - t))) throw invalidInput('The Punycode input overflows.');
      w *= BASE - t;
    }
    const outLength = output.length + 1;
    bias = adapt(i - oldi, outLength, oldi === 0);
    if (Math.floor(i / outLength) > Number.MAX_SAFE_INTEGER - n) throw invalidInput('The Punycode input overflows.');
    n += Math.floor(i / outLength);
    i %= outLength;
    output.splice(i, 0, n);
    i += 1;
  }
  return output.map((code) => String.fromCodePoint(code)).join('');
}

export interface PunycodeLabel {
  original: string;
  ascii: string;
  unicode: string;
  changed: boolean;
  isPunycodePrefix: boolean;
  scripts: string[];
  mixedScripts: boolean;
  error: string | null;
}

export interface PunycodeResult {
  input: string;
  mode: 'to-ascii' | 'to-unicode';
  domain: string;
  asciiDomain: string | null;
  unicodeDomain: string | null;
  labels: PunycodeLabel[];
  idnaCrossCheck: { nodeDomainToAscii: string | null; nodeDomainToUnicode: string | null; matchesPunycode: boolean; detail: string };
  warnings: string[];
  notes: string[];
}

const SCRIPT_RANGES: Array<{ name: string; start: number; end: number }> = [
  { name: 'Latin', start: 0x41, end: 0x24f },
  { name: 'Greek', start: 0x370, end: 0x3ff },
  { name: 'Cyrillic', start: 0x400, end: 0x52f },
  { name: 'Hebrew', start: 0x590, end: 0x5ff },
  { name: 'Arabic', start: 0x600, end: 0x6ff },
  { name: 'Devanagari', start: 0x900, end: 0x97f },
  { name: 'Thai', start: 0xe00, end: 0xe7f },
  { name: 'Han', start: 0x4e00, end: 0x9fff },
  { name: 'Hiragana', start: 0x3040, end: 0x309f },
  { name: 'Katakana', start: 0x30a0, end: 0x30ff },
  { name: 'Hangul', start: 0xac00, end: 0xd7af },
];

function scriptsOf(label: string): string[] {
  const found = new Set<string>();
  for (const character of label) {
    const code = character.codePointAt(0) ?? 0;
    for (const range of SCRIPT_RANGES) {
      if (code >= range.start && code <= range.end) {
        found.add(range.name);
        break;
      }
    }
  }
  return [...found];
}

/**
 * IDN-aware normalisation. `normalizeDomain` from the shared validation layer is deliberately
 * ASCII-only (it guards DNS lookups), so an IDN converter must not use it: "münchen.de" is a
 * perfectly valid input that the ASCII validator rejects. Structure is validated here instead.
 */
function normalizeIdnDomain(input: string): string {
  const trimmed = input.trim().replace(/^[a-z]+:\/\//i, '').replace(/[/?#].*$/, '').replace(/\.$/, '');
  if (trimmed.length === 0) throw invalidInput('Enter a domain name or a single label.');
  if (/[\s]/.test(trimmed)) throw invalidInput('A domain name cannot contain spaces. Enter a registrable name such as example.com.');
  const labels = trimmed.toLowerCase().split('.');
  for (const label of labels) {
    if (label.length === 0) throw invalidInput('That domain has an empty label (two dots in a row). Enter a registrable name such as example.com.');
    if (label.length > 63) throw invalidInput(`The label "${label}" is longer than 63 characters, which DNS does not allow.`);
    if (/[\u0000-\u001f\u007f]/.test(label)) throw invalidInput('That domain contains a control character.');
  }
  if (labels.length < 2) throw invalidInput('Enter a full domain name including its extension, for example münchen.de.');
  return labels.join('.');
}

export function convertPunycode(input: { domain: string; mode?: 'to-ascii' | 'to-unicode' }): PunycodeResult {
  const raw = (input.domain ?? '').trim();
  if (raw.length === 0) throw invalidInput('Enter a domain name or a single label.');
  if (raw.length > 512) throw invalidInput('That is longer than a domain name can be.');
  const mode = input.mode ?? (/xn--/i.test(raw) ? 'to-unicode' : 'to-ascii');
  const domain = normalizeIdnDomain(raw);
  const labels: PunycodeLabel[] = [];
  const warnings: string[] = [];

  for (const label of domain.split('.')) {
    let ascii = label;
    let unicode = label;
    let error: string | null = null;
    try {
      if (/^xn--/i.test(label)) {
        unicode = punycodeDecode(label.slice(4));
        ascii = label.toLowerCase();
      } else if (/[^\x00-\x7f]/.test(label)) {
        ascii = `xn--${punycodeEncode(label)}`;
      }
    } catch (conversionError) {
      error = conversionError instanceof Error ? conversionError.message : 'The label could not be converted.';
      if (/^xn--/i.test(label)) {
        unicode = label;
        warnings.push(`"${label}" starts with xn-- but is not valid Punycode: ${error}`);
      } else {
        ascii = label;
        warnings.push(`"${label}" could not be encoded: ${error}`);
      }
    }
    const scripts = scriptsOf(unicode);
    const mixedScripts = scripts.length > 1 && scripts.includes('Latin');
    if (mixedScripts) {
      warnings.push(`The label "${unicode}" mixes ${scripts.join(' and ')}. Mixed-script domains are how homograph attacks imitate another brand.`);
    }
    labels.push({
      original: label,
      ascii,
      unicode,
      changed: ascii !== label || unicode !== label,
      isPunycodePrefix: /^xn--/i.test(label),
      scripts,
      mixedScripts,
      error,
    });
  }

  const asciiDomain = labels.map((label) => label.ascii).join('.');
  const unicodeDomain = labels.map((label) => label.unicode).join('.');
  const nodeAscii = domainToASCII(domain) || null;
  const nodeUnicode = domainToUnicode(domain) || null;
  const matchesPunycode = nodeAscii === null || nodeAscii === asciiDomain;

  return {
    input: raw,
    mode,
    domain,
    asciiDomain,
    unicodeDomain,
    labels,
    idnaCrossCheck: {
      nodeDomainToAscii: nodeAscii,
      nodeDomainToUnicode: nodeUnicode,
      matchesPunycode,
      detail: matchesPunycode
        ? "Node's IDNA implementation produces the same ASCII form as the raw RFC 3492 encoding used above."
        : `Node's IDNA implementation produces "${nodeAscii}" where RFC 3492 encoding produces "${asciiDomain}". The difference usually comes from IDNA mapping (case folding, disallowed characters, transitional processing for ß/ς) rather than from Punycode itself. Browsers follow IDNA, so prefer the IDNA form for anything that must resolve.`,
    },
    warnings,
    notes: [
      'Punycode encodes the non-ASCII characters of a label and prefixes it with xn--. ASCII labels pass through unchanged.',
      'DNS itself only carries the ASCII form. The Unicode form is a display convention: browsers show Unicode when they can, and a domain that displays as one script but encodes as another is a homograph.',
      'This is a converter, not a browser. It does not apply the full IDNA 2008/UTS-46 mapping table (that is what the Node cross-check column is for) and it does not resolve anything.',
    ],
  };
}
