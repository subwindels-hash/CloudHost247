/**
 * Phase 6 — request-signing protocol between the control plane's worker and the server agent
 * (spec §31), and the same scheme in reverse (agent → control plane status reports).
 *
 * Wire format (headers on every request):
 *   X-CH247-Agent-Id:   the server's agent_id (stable identity registered on the server row)
 *   X-CH247-Timestamp:  unix seconds — requests with |skew| > MAX_SKEW_SECONDS are rejected
 *   X-CH247-Nonce:      random 16-byte hex per request — replays within the window are rejected
 *   X-CH247-Signature:  hex(HMAC-SHA256(secret, agentId + '\n' + timestamp + '\n' + nonce + '\n'
 *                       + method + '\n' + path + '\n' + sha256(body)))
 *
 * Properties:
 *   - The secret is the per-server agent_secret stored encrypted in server_credentials; each
 *     server has its own secret, so one compromised agent cannot impersonate another.
 *   - The body hash covers the entire payload — signature verification implies integrity.
 *   - Timestamp + nonce gives replay protection: a captured request cannot be re-sent even
 *     verbatim, because the nonce is remembered for the skew window.
 *   - Rotating a server's secret instantly invalidates all previously signed requests.
 *
 * The mirror-image implementation lives in server-agent/src/auth.js — the two files define one
 * protocol and must be changed together (see docs/SERVER_AGENT.md).
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const AGENT_SIGNATURE_HEADERS = {
  agentId: 'x-ch247-agent-id',
  timestamp: 'x-ch247-timestamp',
  nonce: 'x-ch247-nonce',
  signature: 'x-ch247-signature',
} as const;

export const MAX_SKEW_SECONDS = 60;

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Canonical string that is signed. Identical construction in the agent (server-agent/src/auth.js). */
export function canonicalRequest(
  agentId: string,
  timestamp: string,
  nonce: string,
  method: string,
  path: string,
  bodySha256: string
): string {
  return [agentId, timestamp, nonce, method.toUpperCase(), path, bodySha256].join('\n');
}

export function signCanonical(secret: string, canonical: string): string {
  return createHmac('sha256', secret).update(canonical).digest('hex');
}

export interface SignedRequestHeaders {
  [AGENT_SIGNATURE_HEADERS.agentId]: string;
  [AGENT_SIGNATURE_HEADERS.timestamp]: string;
  [AGENT_SIGNATURE_HEADERS.nonce]: string;
  [AGENT_SIGNATURE_HEADERS.signature]: string;
}

/** Produces the headers the control plane sends with an agent request. */
export function buildSignedHeaders(
  agentId: string,
  secret: string,
  method: string,
  path: string,
  body: string
): SignedRequestHeaders {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomBytes(16).toString('hex');
  const signature = signCanonical(
    secret,
    canonicalRequest(agentId, timestamp, nonce, method, path, sha256Hex(body))
  );
  return {
    [AGENT_SIGNATURE_HEADERS.agentId]: agentId,
    [AGENT_SIGNATURE_HEADERS.timestamp]: timestamp,
    [AGENT_SIGNATURE_HEADERS.nonce]: nonce,
    [AGENT_SIGNATURE_HEADERS.signature]: signature,
  };
}

/**
 * Constant-time signature comparison.
 *
 * Tolerant of a missing or non-string argument, matching server-agent/src/auth.js: a
 * degenerate signature must be a clean `false` (→ 401) rather than a thrown TypeError
 * (→ 500), and the two implementations must agree on that. An empty or length-mismatched
 * value returns false without calling timingSafeEqual, which throws on unequal lengths.
 */
export function signatureMatches(
  expected: string,
  provided: string | null | undefined
): boolean {
  const a = Buffer.from(String(expected ?? ''), 'utf8');
  const b = Buffer.from(String(provided ?? ''), 'utf8');
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/**
 * In-memory nonce cache for replay protection. Bounded (older entries age out with the skew
 * window), and per-process: the timestamp bound makes cross-process replay harmless — a replayed
 * request from before a restart is older than the skew window and rejected on its timestamp.
 */
export class NonceCache {
  private readonly seen = new Map<string, number>();
  private readonly skewSeconds: number;

  constructor(skewSeconds = MAX_SKEW_SECONDS) {
    this.skewSeconds = skewSeconds;
  }

  /** Returns true when the nonce is fresh (first sighting); false when it is a replay. */
  checkAndRecord(nonce: string, timestampSeconds: number): boolean {
    const now = Math.floor(Date.now() / 1000);
    // Age out everything outside the valid window; the map can never grow unbounded.
    for (const [key, ts] of this.seen) {
      if (Math.abs(now - ts) > this.skewSeconds * 2) this.seen.delete(key);
    }
    if (this.seen.has(nonce)) return false;
    this.seen.set(nonce, timestampSeconds);
    return true;
  }

  get size(): number {
    return this.seen.size;
  }
}

export function verifySignedRequest(
  secret: string,
  headers: Record<string, string | string[] | undefined>,
  method: string,
  path: string,
  body: string,
  nonceCache: NonceCache
): { valid: boolean; agentId?: string; reason?: string } {
  const read = (name: string): string | undefined => {
    const value = headers[name];
    return Array.isArray(value) ? value[0] : value;
  };
  const agentId = read(AGENT_SIGNATURE_HEADERS.agentId);
  const timestamp = read(AGENT_SIGNATURE_HEADERS.timestamp);
  const nonce = read(AGENT_SIGNATURE_HEADERS.nonce);
  const signature = read(AGENT_SIGNATURE_HEADERS.signature);
  if (!agentId || !timestamp || !nonce || !signature) {
    return { valid: false, reason: 'missing signature headers' };
  }

  const now = Math.floor(Date.now() / 1000);
  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > MAX_SKEW_SECONDS) {
    return { valid: false, reason: 'timestamp outside allowed skew' };
  }
  if (!nonceCache.checkAndRecord(nonce, ts)) {
    return { valid: false, reason: 'replayed nonce' };
  }

  const expected = signCanonical(
    secret,
    canonicalRequest(agentId, timestamp, nonce, method, path, sha256Hex(body))
  );
  if (!signatureMatches(expected, signature)) {
    return { valid: false, reason: 'signature mismatch' };
  }
  return { valid: true, agentId };
}
