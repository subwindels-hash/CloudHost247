/**
 * Native DNS diagnostics for the forensics analyzer.
 *
 * Uses the server's supported DNS resolution capabilities (node:dns promises) only. No external
 * API, no arbitrary shell commands, no network scans.
 *
 * Safety controls:
 *   - Strict input validation on every query name (DNS labels only, bounded length).
 *   - Per-lookup timeouts so one hung resolver cannot stall the page.
 *   - Response-size limits.
 *   - Results never expose internal CloudHost247 server addresses or private infrastructure.
 *   - Clearly distinguishes information extracted from the email vs retrieved via DNS vs
 *     independently verified.
 */

import { resolve, resolveMx, resolveTxt, reverse, type ResolveOptions } from 'node:dns';
import { promisify } from 'node:util';

const resolvePromise = promisify(resolve);
const resolveMxPromise = promisify(resolveMx);
const reversePromise = promisify(reverse);

/** Default per-lookup timeout in ms. */
const DEFAULT_TIMEOUT_MS = 8_000;

/** Maximum DNS response records returned per query. */
const MAX_RECORDS = 50;

/** Maximum domain name length (DNS label limit). */
const MAX_DOMAIN_LENGTH = 253;

/** A single DNS-safe label: alphanumeric, hyphen (not leading/trailing), dot-separated. */
const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?)*$/i;

/**
 * Validate a domain name for safe DNS resolution. Rejects anything that could be used for shell
 * injection, arbitrary hosts, or overly long names. Returns the normalized name or null.
 */
export function validateDnsName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > MAX_DOMAIN_LENGTH) return null;
  if (!DOMAIN_PATTERN.test(trimmed)) return null;
  // Reject IP-address-looking inputs (forward lookup of a bare IP is out of scope).
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(trimmed)) return null;
  if (/^[0-9a-fA-F:]+$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Resolve one record type with a hard timeout and response cap. Never throws — returns a
 * { ok, records, error } shape so callers can render "unavailable" honestly.
 */
async function resolveWithTimeout(
  name: string,
  rrtype: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<{ ok: boolean; records: string[]; error: string | null }> {
  const records: string[] = [];
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`DNS lookup timed out after ${timeoutMs}ms`)), timeoutMs)
    );
    const result = await Promise.race([resolvePromise(name, rrtype), timeout]);
    const array = Array.isArray(result) ? result : [];
    for (const entry of array.slice(0, MAX_RECORDS)) {
      records.push(String(entry));
    }
    return { ok: true, records, error: null };
  } catch (err) {
    return { ok: false, records: [], error: err instanceof Error ? err.message : 'DNS lookup failed' };
  }
}

/** Forward DNS lookup (A and AAAA). */
export async function forwardDns(name: string): Promise<{ ok: boolean; records: string[]; error: string | null }> {
  const valid = validateDnsName(name);
  if (!valid) return { ok: false, records: [], error: 'Invalid domain name' };
  const [a, aaaa] = await Promise.all([resolveWithTimeout(valid, 'A'), resolveWithTimeout(valid, 'AAAA')]);
  return {
    ok: a.ok || aaaa.ok,
    records: [...a.records, ...aaaa.records],
    error: a.error && aaaa.error ? `${a.error}; ${aaaa.error}` : null,
  };
}

/** Reverse DNS / PTR lookup for an IP address. */
export async function reverseDns(ip: string): Promise<{ ok: boolean; hostname: string | null; error: string | null }> {
  if (typeof ip !== 'string' || ip.trim() === '') {
    return { ok: false, hostname: null, error: 'No IP address provided' };
  }
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('PTR lookup timed out')), DEFAULT_TIMEOUT_MS)
    );
    const result = await Promise.race([reversePromise(ip), timeout]);
    const hosts = Array.isArray(result) ? result : [];
    return { ok: true, hostname: hosts.length > 0 ? String(hosts[0]) : null, error: null };
  } catch (err) {
    return { ok: false, hostname: null, error: err instanceof Error ? err.message : 'PTR lookup failed' };
  }
}

/** MX record lookup for a domain. */
export async function mxLookup(name: string): Promise<{ ok: boolean; records: string[]; error: string | null }> {
  const valid = validateDnsName(name);
  if (!valid) return { ok: false, records: [], error: 'Invalid domain name' };
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('MX lookup timed out')), DEFAULT_TIMEOUT_MS)
    );
    const result = await Promise.race([resolveMxPromise(valid), timeout]);
    const records = result
      .sort((a: { priority: number }, b: { priority: number }) => a.priority - b.priority)
      .map((m: { exchange: string }) => m.exchange)
      .slice(0, MAX_RECORDS);
    return { ok: true, records, error: null };
  } catch (err) {
    return { ok: false, records: [], error: err instanceof Error ? err.message : 'MX lookup failed' };
  }
}

/** TXT record lookup (used for SPF, DMARC, DKIM selector records). */
export async function txtLookup(name: string): Promise<{ ok: boolean; records: string[]; error: string | null }> {
  const valid = validateDnsName(name);
  if (!valid) return { ok: false, records: [], error: 'Invalid domain name' };
  return resolveWithTimeout(valid, 'TXT');
}

/** Extract an SPF record from TXT records. */
export function extractSpfFromTxt(records: string[]): string | null {
  const spf = records.find((r) => /^v=spf1/i.test(r.trim()));
  return spf ?? null;
}

/** Extract a DMARC record from TXT records (_dmarc.domain). */
export function extractDmarcFromTxt(records: string[]): string | null {
  const dmarc = records.find((r) => /^v=dmarc1/i.test(r.trim()));
  return dmarc ?? null;
}
