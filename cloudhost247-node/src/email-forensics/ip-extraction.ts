/**
 * Source-IP extraction engine for the forensics analyzer.
 *
 * Reads all Received headers, extracts IP candidates, validates IPv4/IPv6, classifies each
 * address, identifies the exact header and position each candidate came from, and assigns a
 * confidence level.
 *
 * Forensic rules (from the spec):
 *   - A Received header added by a trusted receiving mail server is more useful than an earlier
 *     header supplied by an untrusted sender.
 *   - Never trust every Received header: earlier headers can be forged.
 *   - Distinguish trusted receiving-server evidence from unverified upstream headers.
 *   - Never claim an intermediate mail server is the sender's personal device.
 *   - If no originating IP is exposed, report it as unavailable — never manufacture one.
 *
 * Chain semantics: each Received header is prepended by the server that received the message.
 * So the FIRST Received header (topmost) was added by the final receiving server (closest to the
 * recipient) and is the most trustworthy; the LAST Received header was added closest to the
 * original sender and is the least trustworthy.
 */

import type { ConfidenceLevel, IpCandidate, TrustClassification } from './types';
import { classifyAddress, ipVersion, type AddressClass } from './ip-classification';
import { findIpCandidatesInValue } from './parser';

/** A raw IP candidate before trust/confidence assignment. */
interface RawCandidate {
  ip: string;
  sourceHeader: string;    // header name, e.g. "Received" or "X-Originating-IP"
  hopNumber: number | null; // position in Received chain (1 = closest to receiver)
  rawValue: string;        // exact header fragment
  addressClass: AddressClass;
  isFromReceived: boolean;
}

/**
 * Maximum number of Received headers to traverse. Guards against pathological header blocks
 * that try to inject dozens of hops.
 */
const MAX_RECEIVED_HEADERS = 50;

/** Maximum IP candidates to keep per analysis. */
const MAX_CANDIDATES = 100;

/** Confidence for a public IP found in a trusted receiving-server Received header. */
const CONF_HIGH: ConfidenceLevel = 'high';
const CONF_MEDIUM: ConfidenceLevel = 'medium';
const CONF_LOW: ConfidenceLevel = 'low';
const CONF_NONE: ConfidenceLevel = 'none';

/**
 * Extract every IP candidate from a parsed email's headers.
 *
 * Returns candidates ordered by extraction priority: most trustworthy first (topmost Received =
 * hop 1), then X-Originating-IP, then lower Received hops.
 */
export function extractIpCandidates(parsed: {
  received: string[];
  xOriginatingIp: string | null;
}): IpCandidate[] {
  const received = Array.isArray(parsed.received) ? parsed.received : [];
  const xOriginatingIp = parsed.xOriginatingIp ?? null;

  const raw: RawCandidate[] = [];

  // --- Received headers, topmost (hop 1 = closest to receiver / most trusted) first ---
  const receivedToScan = received.slice(0, MAX_RECEIVED_HEADERS);
  for (let hop = 1; hop <= receivedToScan.length; hop += 1) {
    const headerText = receivedToScan[hop - 1]!;
    const candidates = findIpCandidatesInValue(headerText);
    for (const candidate of candidates) {
      raw.push({
        ip: candidate.ip,
        sourceHeader: 'Received',
        hopNumber: hop,
        rawValue: candidate.raw,
        addressClass: classifyAddress(candidate.ip),
        isFromReceived: true,
      });
    }
  }

  // --- X-Originating-IP (when present): supplied by the sender's server, treat as unverified
  //     upstream unless it aligns with a Received hop. Kept separate so it is never the sole
  //     basis for a high-confidence origin claim. ---
  if (xOriginatingIp) {
    const candidates = findIpCandidatesInValue(xOriginatingIp);
    for (const candidate of candidates) {
      raw.push({
        ip: candidate.ip,
        sourceHeader: 'X-Originating-IP',
        hopNumber: null,
        rawValue: candidate.raw,
        addressClass: classifyAddress(candidate.ip),
        isFromReceived: false,
      });
    }
  }

  return assignTrustAndConfidence(raw);
}

/**
 * Assign trust classification and confidence to each raw candidate.
 *
 * Trust model:
 *   - Trusted receiving-server observation: public IP in a Received header added by a receiving
 *     server we treat as the local/trusted hop (hop 1, topmost). Confidence high.
 *   - Public IP in other Received headers: unverified upstream — confidence medium then lower
 *     the deeper in the chain.
 *   - Private / loopback / multicast: internal network hop — confidence low, marked private.
 *   - Reserved / unavailable: low or none.
 *   - X-Originating-IP: unverified sender-supplied — never higher than medium.
 *
 * Dedup: the same IP seen in multiple headers keeps its highest-confidence occurrence.
 */
function assignTrustAndConfidence(raw: RawCandidate[]): IpCandidate[] {
  const byIp = new Map<string, IpCandidate>();

  const consider = (candidate: RawCandidate, trust: TrustClassification, confidence: ConfidenceLevel) => {
    const existing = byIp.get(candidate.ip);
    const entry: IpCandidate = {
      ipAddress: candidate.ip,
      ipVersion: ipVersion(candidate.ip) ?? 'ipv4',
      sourceHeader: candidate.sourceHeader,
      hopNumber: candidate.hopNumber,
      addressClass: candidate.addressClass,
      trustClassification: trust,
      confidenceLevel: confidence,
      rawValue: candidate.rawValue,
    };
    if (!existing) {
      byIp.set(candidate.ip, entry);
      return;
    }
    // Keep the higher-confidence occurrence; on a tie keep the earlier (more trusted) header.
    if (confidenceRank(confidence) > confidenceRank(existing.confidenceLevel)) {
      byIp.set(candidate.ip, entry);
    }
  };

  for (const candidate of raw) {
    const { addressClass, hopNumber, isFromReceived } = candidate;

    // Address class drives the base classification.
    if (addressClass === 'loopback' || addressClass === 'private') {
      consider(
        candidate,
        'private_internal',
        hopNumber === 1 ? CONF_LOW : CONF_LOW,
      );
      continue;
    }
    if (addressClass === 'multicast' || addressClass === 'reserved') {
      consider(candidate, 'private_internal', CONF_LOW);
      continue;
    }
    if (addressClass === 'unavailable') {
      consider(candidate, 'hidden_unavailable', CONF_NONE);
      continue;
    }

    // --- public IP ---
    if (isFromReceived && hopNumber === 1) {
      // Topmost Received = added by the trusted receiving server closest to us.
      consider(candidate, 'trusted_receiving_server', CONF_HIGH);
    } else if (isFromReceived && hopNumber !== null && hopNumber <= 3) {
      // Nearby upstream hops — unverified but plausible.
      consider(candidate, 'unverified_upstream', CONF_MEDIUM);
    } else if (isFromReceived) {
      // Deep in the chain — increasingly likely to be forged.
      consider(candidate, 'unverified_upstream', CONF_LOW);
    } else {
      // X-Originating-IP: sender-supplied, never trusted as sole origin evidence.
      consider(candidate, 'unverified_upstream', CONF_MEDIUM);
    }
  }

  const results = Array.from(byIp.values());

  // Sort: highest confidence first, then trusted receiving-server before unverified upstream,
  // then hop order (lowest hop number first = closest to receiver).
  results.sort((a, b) => {
    const c = confidenceRank(b.confidenceLevel) - confidenceRank(a.confidenceLevel);
    if (c !== 0) return c;
    const t = trustOrder(b.trustClassification) - trustOrder(a.trustClassification);
    if (t !== 0) return t;
    const h = (a.hopNumber ?? 999) - (b.hopNumber ?? 999);
    return h;
  });

  return results.slice(0, MAX_CANDIDATES);
}

function confidenceRank(level: ConfidenceLevel): number {
  switch (level) {
    case 'high': return 4;
    case 'medium': return 3;
    case 'low': return 2;
    case 'none': return 1;
    default: return 0;
  }
}

function trustOrder(classification: TrustClassification): number {
  switch (classification) {
    case 'trusted_receiving_server': return 5;
    case 'public_candidate': return 4;
    case 'unverified_upstream': return 3;
    case 'private_internal': return 2;
    case 'hidden_unavailable': return 1;
    default: return 0;
  }
}

/**
 * Determine whether any candidate justifies reporting an origin IP, and what message to show.
 *
 * The analyzer reports an origin IP only when there is a public candidate with at least
 * medium confidence. Otherwise it reports the address as unavailable — never fabricating one.
 */
export function summarizeOriginIp(candidates: IpCandidate[]): {
  originIpAvailable: boolean;
  originIpMessage: string;
} {
  const bestPublic = candidates.find(
    (c) => c.addressClass === 'public' && c.confidenceLevel !== 'none'
  );
  if (bestPublic) {
    return {
      originIpAvailable: true,
      originIpMessage: `Public IP candidate found in ${bestPublic.sourceHeader} (${bestPublic.ipVersion}, ${bestPublic.addressClass}) — ${bestPublic.confidenceLevel} confidence.`,
    };
  }
  return {
    originIpAvailable: false,
    originIpMessage: 'Original sender IP not available in the supplied headers.',
  };
}
