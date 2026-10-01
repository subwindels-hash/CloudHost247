/**
 * Domain-name normalization and validation shared by every Domain Services workflow.
 *
 * This module is deliberately strict and provider-agnostic: the same normalized string is what
 * gets persisted, what is sent to a registrar adapter, and what is compared for ownership. A
 * domain that fails here must never reach a provider call or a database write.
 */

/** Total length limit from RFC 1035 (253 octets for the presentation format). */
const MAX_DOMAIN_LENGTH = 253;

/** A single DNS label: 1–63 chars, alnum, hyphens only in the middle, no leading/trailing hyphen. */
const LABEL_SOURCE = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const LABEL_PATTERN = new RegExp(`^${LABEL_SOURCE}$`);

/**
 * A syntactically valid registrable domain: at least two labels (name + TLD). Built from the
 * UNANCHORED label source — embedding the anchored pattern here would bake the `^`/`$` anchors
 * into the middle of the expression and make multi-label domains like `example.com` unmatchable.
 */
const DOMAIN_PATTERN = new RegExp(`^(?=.{1,${MAX_DOMAIN_LENGTH}}$)${LABEL_SOURCE}(?:\\.${LABEL_SOURCE})+$`);

/** A bare search term: a single label with no dot (e.g. `mybrand`). */
const TERM_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizeDomainName(input: string): string {
  return input.trim().toLowerCase().replace(/\.$/, '');
}

export function isValidDomainName(input: string): boolean {
  const normalized = normalizeDomainName(input);
  return normalized.length >= 4 && DOMAIN_PATTERN.test(normalized);
}

export function isValidSearchTerm(input: string): boolean {
  const normalized = normalizeDomainName(input);
  return TERM_PATTERN.test(normalized);
}

/** Returns the TLD (last label, with the leading dot) of a valid domain name, e.g. `.com`. */
export function extensionOf(domainName: string): string {
  const normalized = normalizeDomainName(domainName);
  const lastDot = normalized.lastIndexOf('.');
  if (lastDot === -1) return '';
  return normalized.slice(lastDot);
}

/** Returns the registrable label (everything before the final dot), e.g. `example`. */
export function registrableLabelOf(domainName: string): string {
  const normalized = normalizeDomainName(domainName);
  const lastDot = normalized.lastIndexOf('.');
  if (lastDot === -1) return normalized;
  return normalized.slice(0, lastDot);
}

export function normalizeExtension(input: string): string {
  const trimmed = input.trim().toLowerCase();
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
}

export function isValidExtension(input: string): boolean {
  const normalized = normalizeExtension(input);
  if (normalized.length < 2 || normalized.length > 63) return false;
  return LABEL_PATTERN.test(normalized.slice(1));
}

export interface ParsedDomainQuery {
  /** A single, normalized domain name the caller explicitly named, if any. */
  domainName: string | null;
  /** A bare term (no dot) to combine with candidate extensions. */
  term: string | null;
}

/**
 * Accepts either `example.com` (an explicit domain) or `example` (a term to pair with the
 * platform's enabled extensions) and rejects everything else with a clear, user-safe message.
 */
export function parseDomainQuery(input: string): ParsedDomainQuery & { error?: string } {
  const normalized = normalizeDomainName(input);
  if (!normalized) return { domainName: null, term: null, error: 'Enter a domain name to search' };
  if (normalized.length > MAX_DOMAIN_LENGTH) {
    return { domainName: null, term: null, error: 'That domain name is too long' };
  }
  if (DOMAIN_PATTERN.test(normalized)) {
    return { domainName: normalized, term: null };
  }
  if (TERM_PATTERN.test(normalized)) {
    return { domainName: null, term: normalized };
  }
  return {
    domainName: null,
    term: null,
    error: 'Enter a valid domain name (letters, numbers and hyphens), e.g. example.com',
  };
}

/**
 * Parses unstructured bulk-search input (typed text, TXT or CSV content) into candidate domain
 * names. Handles comma/newline/whitespace separation, CSV columns (first column that looks like a
 * domain wins), surrounding quotes, and the bare `term` form (no dot — later combined with the
 * enabled extensions by the search service). Duplicates (case-insensitive) are removed while
 * preserving first-seen order.
 */
export function parseBulkDomainInput(raw: string, maxCount: number): { domains: string[]; rejected: number } {
  const seen = new Set<string>();
  const domains: string[] = [];
  let rejected = 0;

  for (const token of raw.split(/[\r\n,;"\t]+/)) {
    const candidate = token.trim().toLowerCase().replace(/\.$/, '');
    if (!candidate) continue;
    if (seen.has(candidate)) continue;

    const valid = TERM_PATTERN.test(candidate) || DOMAIN_PATTERN.test(candidate);
    if (!valid) {
      rejected += 1;
      continue;
    }
    if (domains.length >= maxCount) {
      // Still count so the caller can tell the user the list was truncated by the server cap.
      rejected += 1;
      continue;
    }
    seen.add(candidate);
    domains.push(candidate);
  }

  return { domains, rejected };
}
