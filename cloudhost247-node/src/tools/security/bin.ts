/**
 * Tools Center — BIN/IIN checker (spec §48).
 *
 * Hard rules, enforced before any provider call:
 *   - The input must be 6–8 digits. A 16-digit (or Luhn-valid) string is REJECTED, never truncated:
 *     accepting a full card number even once would turn this into a card-handling endpoint, which is
 *     explicitly out of scope.
 *   - Nothing is stored: no history target beyond the BIN prefix, no cache write, no database row.
 *   - The result requires a configured BIN provider. Without one the tool returns
 *     CONFIGURATION_REQUIRED rather than guessing an issuer from a prefix.
 */
import type { Queryable } from '../../db/types';
import { invalidInput, ToolError } from '../core/errors';
import { fetchWithGuard } from '../core/ssrf';
import { providerSecret, recordProviderOutcome, requireProvider } from '../core/providers';

export interface BinLookupResult {
  bin: string;
  scheme: string | null;
  cardType: string | null;
  cardLevel: string | null;
  issuer: { name: string | null; url: string | null; phone: string | null };
  country: { name: string | null; code: string | null; currency: string | null };
  provider: { name: string; slug: string };
  notices: string[];
  notes: string[];
}

/** Accepts only a 6–8 digit BIN/IIN. Everything longer is rejected with an explanation. */
export function validateBin(input: string): string {
  const digits = (input ?? '').replace(/[\s-]/g, '');
  if (digits.length === 0) throw invalidInput('Enter a BIN/IIN (the first 6–8 digits of a card number).');
  if (!/^\d+$/.test(digits)) throw invalidInput('A BIN/IIN contains digits only.');
  if (digits.length < 6) throw invalidInput('A BIN/IIN is at least 6 digits.');
  if (digits.length > 8) {
    throw invalidInput(
      `That input is ${digits.length} digits. CloudHost247 accepts only the 6–8 digit BIN/IIN prefix and never a full card number — do not submit one.`
    );
  }
  return digits;
}

function pick(source: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return null;
}

export async function binLookup(db: Queryable, input: { bin: string }): Promise<BinLookupResult> {
  const bin = validateBin(input.bin);
  const provider = await requireProvider(db, 'BIN', 'BIN lookup');
  const template = typeof provider.configuration.pathTemplate === 'string' ? provider.configuration.pathTemplate : '/{bin}';
  const jsonPath = typeof provider.configuration.jsonPaths === 'object' && provider.configuration.jsonPaths !== null
    ? String((provider.configuration.jsonPaths as Record<string, unknown>).result ?? '')
    : '';
  const apiKeyHeader = typeof provider.configuration.apiKeyHeader === 'string' ? provider.configuration.apiKeyHeader : null;
  const url = `${(provider.endpoint ?? '').replace(/\/$/, '')}${template.replace('{bin}', encodeURIComponent(bin))}`;

  try {
    const secret = await providerSecret(db, provider.slug);
    const response = await fetchWithGuard(url, {
      timeoutMs: provider.timeoutMs,
      maxBytes: 256 * 1024,
      headers: {
        accept: 'application/json',
        ...(secret.apiKey && apiKeyHeader ? { [apiKeyHeader]: secret.apiKey } : {}),
        ...(secret.apiKey && !apiKeyHeader ? { authorization: `Bearer ${secret.apiKey}` } : {}),
      },
      userAgent: 'CloudHost247-ToolsCenter/1.0 (BIN lookup)',
    });
    if (response.status === 404) throw new ToolError('NOT_FOUND', 'The provider has no record for that BIN/IIN.');
    if (response.status === 429) throw new ToolError('RATE_LIMITED', 'The BIN provider is rate limiting this platform. Try again shortly.');
    if (response.status !== 200) throw new ToolError('PROVIDER_ERROR', `The BIN provider answered HTTP ${response.status}.`);

    const payload = JSON.parse(response.bodyText) as Record<string, unknown>;
    const root = jsonPath ? ((): Record<string, unknown> => {
      let current: unknown = payload;
      for (const part of jsonPath.split('.')) {
        if (current === null || typeof current !== 'object') return payload;
        current = (current as Record<string, unknown>)[part];
      }
      return (current && typeof current === 'object' ? (current as Record<string, unknown>) : payload);
    })() : payload;
    const nested = root.data && typeof root.data === 'object' ? (root.data as Record<string, unknown>) : root;
    const country = nested.country && typeof nested.country === 'object' ? (nested.country as Record<string, unknown>) : {};
    const bank = nested.bank && typeof nested.bank === 'object' ? (nested.bank as Record<string, unknown>) : {};
    const issuerName = pick(nested, 'bank_name', 'issuer', 'issuer_name') ?? pick(bank, 'name');

    await recordProviderOutcome(db, provider.slug, { ok: true });

    return {
      bin,
      scheme: pick(nested, 'scheme', 'card_scheme', 'brand', 'network'),
      cardType: pick(nested, 'type', 'card_type', 'funding'),
      cardLevel: pick(nested, 'level', 'card_level', 'tier'),
      issuer: {
        name: issuerName,
        url: pick(nested, 'bank_url', 'url') ?? pick(bank, 'url'),
        phone: pick(nested, 'bank_phone', 'phone') ?? pick(bank, 'phone'),
      },
      country: {
        name: pick(nested, 'country_name') ?? pick(country, 'name'),
        code: pick(nested, 'country_code', 'alpha2', 'country_iso') ?? pick(country, 'alpha2', 'code'),
        currency: pick(nested, 'currency', 'currency_code') ?? pick(country, 'currency'),
      },
      provider: { name: provider.name, slug: provider.slug },
      notices: [
        'Only the 6–8 digit BIN/IIN prefix was submitted; CloudHost247 never received a full card number and stores nothing from this lookup.',
        'BIN data describes the institution that issued the prefix. It does not verify a card, does not check whether an account exists, and must not be used to attempt a payment or to infer a person\'s identity.',
      ],
      notes: [
        'Issuer names change as banks rename and portfolios move between processors, and providers update their tables at different times. Treat a mismatch with the card in your hand as normal.',
        'A card number from the same BIN can be issued in several countries when a bank operates internationally.',
      ],
    };
  } catch (error) {
    const message = error instanceof ToolError ? error.message : `The BIN lookup failed: ${error instanceof Error ? error.message : 'unknown error'}`;
    await recordProviderOutcome(db, provider.slug, { ok: false, error: message });
    if (error instanceof ToolError) throw error;
    throw new ToolError('PROVIDER_ERROR', message);
  }
}
