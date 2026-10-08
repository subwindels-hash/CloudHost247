/**
 * Domain-name normalisation and validation shared by every domain-services workflow — ported from
 * `cloudhost247-node/src/domain-services/domain-name.ts`.
 *
 * Deliberately strict and provider-agnostic: the same normalised string is what gets persisted, what
 * is sent to a registry or registrar adapter, and what is compared for ownership. **A name that
 * fails here must never reach a provider call or a database write.**
 *
 * Why this exists rather than a regex at each call site: the platform's own route regex accepted a
 * single label, so `not a domain` was three "domains", and a bulk search would happily ask a registry
 * about the word `domain`. A registrable name has at least two labels — a name and a TLD — and that
 * rule belongs in one place.
 */
'use strict';

const { domainToASCII } = require('node:url');

/** Total length limit from RFC 1035 (253 octets in presentation format). */
const MAX_DOMAIN_LENGTH = 253;

/** A single DNS label: 1–63 chars, alphanumeric, hyphens only in the middle. */
const LABEL_SOURCE = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const LABEL_PATTERN = new RegExp(`^${LABEL_SOURCE}$`);

/**
 * A syntactically valid registrable domain: at least two labels. Built from the *unanchored* label
 * source — embedding the anchored pattern here would bake `^`/`$` into the middle and make
 * multi-label names like `example.com` unmatchable.
 */
const DOMAIN_PATTERN = new RegExp(`^(?=.{1,${MAX_DOMAIN_LENGTH}}$)${LABEL_SOURCE}(?:\\.${LABEL_SOURCE})+$`);

/** A bare search term: a single label with no dot (e.g. `mybrand`). */
const TERM_PATTERN = new RegExp(`^${LABEL_SOURCE}$`);

/**
 * Lowercase, trim, drop a trailing dot, and convert an internationalised name to its ASCII
 * (punycode) form — DNS and every registrar API speak punycode, so `münchen.de` becomes
 * `xn--mnchen-3ya.de` once, here, before it is validated, stored, compared or sent anywhere.
 * Input that cannot be converted is returned unchanged, so the grammar below rejects it rather than
 * the platform silently searching a different name.
 */
function normalizeDomainName(input) {
  const lowered = String(input ?? '').trim().toLowerCase().replace(/\.$/, '');
  if (/[^\x00-\x7f]/.test(lowered)) {
    const ascii = domainToASCII(lowered);
    if (ascii) return ascii.replace(/\.$/, '');
  }
  return lowered;
}

function isValidDomainName(input) {
  const normalized = normalizeDomainName(input);
  return normalized.length >= 4 && normalized.length <= MAX_DOMAIN_LENGTH && DOMAIN_PATTERN.test(normalized);
}

function isValidSearchTerm(input) {
  return TERM_PATTERN.test(normalizeDomainName(input));
}

function isValidLabel(input) {
  return LABEL_PATTERN.test(String(input ?? ''));
}

/** The extension including its leading dot, e.g. `.com`. Empty when there is no dot. */
function extensionOf(domainName) {
  const normalized = normalizeDomainName(domainName);
  const lastDot = normalized.lastIndexOf('.');
  return lastDot === -1 ? '' : normalized.slice(lastDot);
}

/** The registrable label: everything before the final dot, e.g. `example` from `example.com`. */
function registrableLabelOf(domainName) {
  const normalized = normalizeDomainName(domainName);
  const lastDot = normalized.lastIndexOf('.');
  return lastDot === -1 ? normalized : normalized.slice(0, lastDot);
}

module.exports = {
  MAX_DOMAIN_LENGTH,
  normalizeDomainName,
  isValidDomainName,
  isValidSearchTerm,
  isValidLabel,
  extensionOf,
  registrableLabelOf,
};
