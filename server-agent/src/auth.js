/**
 * CloudHost247 Server Agent — request authentication (spec §31).
 *
 * Mirrors src/deployments/agent-protocol.ts in the control plane: HMAC-SHA256 over
 * agentId + timestamp + nonce + method + path + sha256(body), with timestamp skew and nonce
 * replay protection. The two files define ONE protocol and must change together — the
 * agreement is enforced by tests/integration/agent-protocol-conformance.test.ts, not only by
 * this comment.
 *
 * The agent never holds a Docker credential of any kind for the control plane — knowing the
 * secret only lets the control plane call this agent's small allowlisted operation set.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const HEADERS = {
  agentId: 'x-ch247-agent-id',
  timestamp: 'x-ch247-timestamp',
  nonce: 'x-ch247-nonce',
  signature: 'x-ch247-signature',
};

export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

export function canonicalRequest(agentId, timestamp, nonce, method, path, bodySha256) {
  return [agentId, timestamp, nonce, method.toUpperCase(), path, bodySha256].join('\n');
}

export function signCanonical(secret, canonical) {
  return createHmac('sha256', secret).update(canonical).digest('hex');
}

export function signatureMatches(expected, provided) {
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(provided ?? ''));
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

export class NonceCache {
  constructor(skewSeconds = 60) {
    this.skewSeconds = skewSeconds;
    this.seen = new Map();
  }

  checkAndRecord(nonce, timestampSeconds) {
    const now = Math.floor(Date.now() / 1000);
    for (const [key, ts] of this.seen) {
      if (Math.abs(now - ts) > this.skewSeconds * 2) this.seen.delete(key);
    }
    if (this.seen.has(nonce)) return false;
    this.seen.set(nonce, timestampSeconds);
    return true;
  }
}

/**
 * Full inbound verification. Returns { ok, reason } — callers must reject on !ok BEFORE parsing
 * or executing anything.
 */
export function verifyRequest({ config, headers, method, path, rawBody, nonceCache }) {
  const read = (name) => {
    const value = headers[name];
    return Array.isArray(value) ? value[0] : value;
  };
  const agentId = read(HEADERS.agentId);
  const timestamp = read(HEADERS.timestamp);
  const nonce = read(HEADERS.nonce);
  const signature = read(HEADERS.signature);
  if (!agentId || !timestamp || !nonce || !signature) {
    return { ok: false, reason: 'missing signature headers' };
  }
  if (agentId !== config.agentId) {
    return { ok: false, reason: 'agent id mismatch' };
  }
  const now = Math.floor(Date.now() / 1000);
  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > config.maxSkewSeconds) {
    return { ok: false, reason: 'timestamp outside allowed skew' };
  }
  if (!nonceCache.checkAndRecord(nonce, ts)) {
    return { ok: false, reason: 'replayed nonce' };
  }
  const expected = signCanonical(
    config.agentSecret,
    canonicalRequest(agentId, timestamp, nonce, method, path, sha256Hex(rawBody))
  );
  if (!signatureMatches(expected, signature)) {
    return { ok: false, reason: 'signature mismatch' };
  }
  return { ok: true };
}

/** Signs an OUTBOUND request to the control plane (same scheme, reverse direction). */
export function signOutbound(config, method, path, body, nowSeconds) {
  const timestamp = Math.floor(nowSeconds ?? Date.now() / 1000).toString();
  // 16 random bytes from the CSPRNG, hex-encoded — exactly what docs/SERVER_AGENT.md and the
  // control-plane mirror specify ("random 16-byte hex per request"). This must not be derived
  // from Math.random(): the nonce is the replay-protection primitive, and Math.random() is a
  // predictable PRNG, not a cryptographic one.
  const nonce = randomBytes(16).toString('hex');
  const signature = signCanonical(
    config.agentSecret,
    canonicalRequest(config.agentId, timestamp, nonce, method, path, sha256Hex(body))
  );
  return {
    [HEADERS.agentId]: config.agentId,
    [HEADERS.timestamp]: timestamp,
    [HEADERS.nonce]: nonce,
    [HEADERS.signature]: signature,
  };
}
