/**
 * Email route reconstruction for the forensics analyzer.
 *
 * Builds a visual transmission timeline from the Received headers. For each hop it records the
 * receiving mail server, sending server (when available), extracted IP address, timestamp,
 * hostname, TLS information, header source, trust classification, and anomaly flags.
 *
 * Hops are reported in the order the Received headers appear (topmost = closest to the receiver,
 * added by the trusted receiving server). Contradictory or missing timestamps are flagged, never
 * silently corrected.
 *
 * Trust labels used in the UI:
 *   - Verified receiving-server observation
 *   - Unverified upstream observation
 *   - Private network hop
 *   - Public network hop
 *   - Origin IP unavailable
 */

import type { AnomalyFlag, HopTrustClass, RouteHop } from './types';
import { findIpCandidatesInValue } from './parser';
import { classifyAddress } from './ip-classification';

/** Max Received headers to reconstruct (guard against pathological input). */
const MAX_HOPS = 50;

/** Known TLS-related tokens that may appear in a Received header. */
const TLS_TOKENS = /(TLS|SSL|ECDHE|RSA|AES|SHA|cipher|bits)/i;

function firstMatchGroup(headerText: string, regexp: RegExp): string | null {
  const match = headerText.match(regexp);
  return match ? (match[1] ?? null) : null;
}

/**
 * Parse one Received header into a route hop.
 */
function parseReceivedHeader(headerText: string, hopNumber: number): {
  hop: RouteHop;
  timestamp: Date | null;
} {
  const timestamp = extractTimestamp(headerText);
  const tlsMatch = headerText.match(TLS_TOKENS);
  const tlsInformation = tlsMatch ? tlsMatch[0] : null;

  // "from <host> [<ip>]" — the sending server as claimed in this hop.
  const sendingRaw = firstMatchGroup(headerText, /\bfrom\s+([^;(]+?)(?:\s*\(|$)/i);
  const sendingHostname = sendingRaw ? sendingRaw.trim().replace(/[\[\]]/g, '').trim() : null;

  // "by <host>" — the receiving server that added this header.
  const receivingRaw = firstMatchGroup(headerText, /\bby\s+([^\s(;]+)/i);
  const receivingHostname = receivingRaw ? receivingRaw.trim().replace(/[\[\]]/g, '').trim() : null;

  // IP candidates in this header.
  const ipCandidates = findIpCandidatesInValue(headerText);
  const ipAddress = ipCandidates.length > 0 ? ipCandidates[0]!.ip : null;

  // Prefer the receiving (by) hostname as the hop's host; fall back to sending host.
  const hostname = receivingHostname ?? sendingHostname ?? null;

  const addressClass = ipAddress ? classifyAddress(ipAddress) : 'unavailable';

  // Trust classification for this hop.
  let trustClassification: HopTrustClass;
  if (hopNumber === 1) {
    trustClassification = 'verified_receiving_server';
  } else if (addressClass === 'private' || addressClass === 'loopback') {
    trustClassification = 'private_network_hop';
  } else if (addressClass === 'public') {
    trustClassification = 'public_network_hop';
  } else if (addressClass === 'unavailable') {
    trustClassification = 'origin_ip_unavailable';
  } else {
    trustClassification = 'unverified_upstream';
  }

  // Anomaly flags.
  const anomalyFlags: AnomalyFlag[] = [];
  if (!timestamp) anomalyFlags.push('missing_timestamp');
  if (ipCandidates.length > 1) anomalyFlags.push('unusual_routing');
  if (!tlsInformation && hopNumber === 1) anomalyFlags.push('unverified_upstream_header');

  const hop: RouteHop = {
    hopNumber,
    hostname,
    ipAddress,
    receivedTimestamp: timestamp ? timestamp.toISOString() : null,
    tlsInformation,
    headerSource: headerText,
    trustClassification,
    anomalyFlags,
  };

  return { hop, timestamp };
}

/** Extract a timestamp from a Received header (everything after the last semicolon). */
function extractTimestamp(headerText: string): Date | null {
  const semicolon = headerText.lastIndexOf(';');
  if (semicolon === -1) return null;
  const dateString = headerText.slice(semicolon + 1).trim();
  if (!dateString) return null;
  const parsed = new Date(dateString);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Reconstruct the full route from all Received headers.
 */
export function reconstructRoute(received: string[]): {
  hops: RouteHop[];
  chronological: boolean;
  anomalies: Array<{ hop: number; flag: AnomalyFlag; description: string }>;
} {
  const headers = Array.isArray(received) ? received : [];
  const scanned = headers.slice(0, MAX_HOPS);

  const parsedHops: { hop: RouteHop; timestamp: Date | null }[] = [];
  for (let i = 0; i < scanned.length; i += 1) {
    const headerText = scanned[i];
    if (headerText === undefined) continue;
    const { hop, timestamp } = parseReceivedHeader(headerText, i + 1);
    parsedHops.push({ hop, timestamp });
  }

  // Cross-hop anomaly detection.
  const anomalies: Array<{ hop: number; flag: AnomalyFlag; description: string }> = [];

  // Duplicate hops: same receiving hostname appearing more than once.
  const seenHostnames = new Map<string, number[]>();
  for (const { hop } of parsedHops) {
    if (!hop.hostname) continue;
    const list = seenHostnames.get(hop.hostname) ?? [];
    list.push(hop.hopNumber);
    seenHostnames.set(hop.hostname, list);
  }
  for (const [_hostname, hops] of seenHostnames) {
    if (hops.length > 1 && hops[0] !== undefined) {
      anomalies.push({
        hop: hops[0]!,
        flag: 'duplicate_hop',
        description: `Receiving server "${_hostname}" appears in multiple Received hops (${hops.join(', ')})`,
      });
    }
  }

  // Contradictory timestamps: a later hop (closer to sender) newer than an earlier hop.
  let chronological = true;
  for (let i = 1; i < parsedHops.length; i += 1) {
    const prev = parsedHops[i - 1];
    const curr = parsedHops[i];
    if (!prev || !curr || !prev.timestamp || !curr.timestamp) continue;
    if (curr.timestamp.getTime() > prev.timestamp.getTime()) {
      chronological = false;
      anomalies.push({
        hop: curr.hop.hopNumber,
        flag: 'contradictory_timestamp',
        description: `Hop ${curr.hop.hopNumber} timestamp (${curr.timestamp.toISOString()}) is later than hop ${prev.hop.hopNumber} (${prev.timestamp.toISOString()}) — timestamps contradict and are not corrected`,
      });
    }
  }

  // Collect per-hop missing_timestamp / unusual_routing anomalies.
  for (const { hop } of parsedHops) {
    if (hop.anomalyFlags.includes('missing_timestamp')) {
      anomalies.push({
        hop: hop.hopNumber,
        flag: 'missing_timestamp',
        description: `Hop ${hop.hopNumber} (${hop.hostname ?? 'unknown server'}) has no usable timestamp`,
      });
    }
    if (hop.anomalyFlags.includes('unusual_routing')) {
      anomalies.push({
        hop: hop.hopNumber,
        flag: 'unusual_routing',
        description: `Hop ${hop.hopNumber} contains multiple IP addresses — routing sequence is unusual`,
      });
    }
  }

  return { hops: parsedHops.map(({ hop }) => hop), chronological, anomalies };
}
