/**
 * Tools Center — Security and Domain category handlers (spec §40–§47).
 *
 * `ssl-checker` performs a real TLS handshake, `password-tools` never stores or logs the value it
 * is given, `bin-checker` refuses anything longer than a BIN before touching a provider, and
 * `domain-availability` never claims "available" without a registry answer. Those properties are
 * enforced in the services; the handlers only pass validated input through.
 */
import { sslCheck } from '../security/ssl';
import { generatePassword, hashValue, scorePassword } from '../security/password';
import { binLookup } from '../security/bin';
import { blacklistCheck } from '../ip/blacklist';
import { convertPunycode } from '../domain/punycode';
import { checkDomainAvailability } from '../domain/availability';
import { domainHealthCenter } from '../domain/health';
import { invalidInput } from '../core/errors';
import type { ToolHandler } from './kit';
import { bool, maybeNum, maybeStr, oneOf, str, strArray, targetLabel } from './kit';

const ALGORITHMS = ['md5', 'sha1', 'sha256', 'sha512', 'bcrypt'] as const;
const PRESETS = ['pin', 'memorable', 'strong', 'maximum'] as const;

export const securityDomainHandlers: Record<string, ToolHandler> = {
  'ssl-checker': async (input) => {
    const hostInput = str(input, 'host', { max: 300 }) || str(input, 'domain', { max: 300 }) || str(input, 'url', { max: 2000 });
    if (hostInput.length === 0) throw invalidInput('Enter a hostname, for example example.com or https://example.com/.');
    const host = hostInput.replace(/^https?:\/\//i, '').split('/')[0] ?? hostInput;
    return sslCheck({
      host,
      port: maybeNum(input, 'port', { min: 1, max: 65535 }),
      skipProtocolProbe: bool(input, 'skipProtocolProbe', false),
      timeoutMs: maybeNum(input, 'timeoutMs', { min: 2000, max: 20_000 }),
    });
  },

  'ip-blacklist': async (input, context) => {
    const address = str(input, 'address', { max: 60 }) || str(input, 'ip', { required: true, max: 60 });
    return blacklistCheck(context.db, {
      address,
      resolverId: maybeStr(input, 'resolverId'),
      providerSlugs: strArray(input, 'providers', { max: 40 }),
      deadlineMs: maybeNum(input, 'deadlineMs', { min: 2000, max: 60_000 }),
    });
  },

  'password-tools': async (input) => {
    const operation = oneOf(input, 'operation', ['generate', 'score', 'hash'] as const, { required: true });
    if (operation === 'generate') {
      return generatePassword({
        length: maybeNum(input, 'length', { min: 4, max: 256 }),
        lowercase: input.lowercase === undefined ? undefined : bool(input, 'lowercase', true),
        uppercase: input.uppercase === undefined ? undefined : bool(input, 'uppercase', true),
        digits: input.digits === undefined ? undefined : bool(input, 'digits', true),
        symbols: input.symbols === undefined ? undefined : bool(input, 'symbols', true),
        excludeAmbiguous: input.excludeAmbiguous === undefined ? undefined : bool(input, 'excludeAmbiguous', false),
        preset: maybeStr(input, 'preset') === undefined ? undefined : oneOf(input, 'preset', PRESETS, { default: 'strong' }),
      });
    }
    if (operation === 'score') {
      return scorePassword({
        password: str(input, 'password', { required: true, max: 1024, trim: false }),
        context: maybeStr(input, 'context', { max: 200 }),
      });
    }
    return hashValue({
      value: str(input, 'value', { required: true, max: 100_000, trim: false }),
      algorithm: oneOf(input, 'algorithm', ALGORITHMS, { default: 'sha256' }),
    });
  },

  'bin-checker': async (input, context) => binLookup(context.db, { bin: str(input, 'bin', { required: true, max: 20 }) }),

  punycode: async (input) => {
    const domain = str(input, 'domain', { max: 300 }) || str(input, 'text', { required: true, max: 300 });
    return convertPunycode({ domain, mode: oneOf(input, 'mode', ['to-ascii', 'to-unicode'] as const, { default: 'to-ascii' }) });
  },

  'domain-availability': async (input, context) => {
    const list = strArray(input, 'domains', { max: 10 });
    const single = str(input, 'domain', { max: 300 });
    const domains = list && list.length > 0 ? list : single.length > 0 ? [single] : [];
    if (domains.length === 0) throw invalidInput('Enter at least one domain name to check.');
    const results = [];
    // Sequential on purpose: registry RDAP endpoints rate-limit per client, and a burst of ten
    // parallel requests is the fastest way to get the whole tool blocked.
    for (const domain of domains) {
      results.push(
        await checkDomainAvailability(context.db, {
          domain,
          userId: context.caller.userId,
          publicSignalsOnly: bool(input, 'publicSignalsOnly', false),
        })
      );
    }
    return {
      count: results.length,
      results,
      summary: results.map((result) => `${result.domain}: ${result.status}`).join(' · '),
      notes: [
        'Each domain is checked against its registry (RDAP/WHOIS) and the live DNS. A registry that cannot be reached leaves the status as UNKNOWN — this tool never guesses that a name is free.',
        'Availability is a point-in-time answer: a name can be registered between the check and your order.',
      ],
    };
  },

  'domain-health': async (input, context) =>
    domainHealthCenter(context.db, {
      domain: str(input, 'domain', { required: true, max: 253 }),
      userId: context.caller.userId,
      dkimSelectors: strArray(input, 'selectors', { max: 12 }),
      extended: bool(input, 'extended', true),
      resolverId: maybeStr(input, 'resolverId'),
    }),
};

export const securityDomainTargets: Record<string, (input: Record<string, unknown>) => string | null> = {
  'ssl-checker': (input) => targetLabel(typeof input.host === 'string' ? input.host : typeof input.domain === 'string' ? input.domain : typeof input.url === 'string' ? input.url : null),
  'ip-blacklist': (input) => targetLabel(typeof input.address === 'string' ? input.address : typeof input.ip === 'string' ? input.ip : null),
  'password-tools': () => null,
  'bin-checker': (input) => targetLabel(typeof input.bin === 'string' ? `BIN ${String(input.bin).slice(0, 6)}…` : null),
  punycode: (input) => targetLabel(typeof input.domain === 'string' ? input.domain : null),
  'domain-availability': (input) => targetLabel(typeof input.domain === 'string' ? input.domain : Array.isArray(input.domains) ? input.domains.slice(0, 3).join(', ') : null),
  'domain-health': (input) => targetLabel(typeof input.domain === 'string' ? input.domain : null),
};
