/**
 * Agent request authentication protocol (spec §30, §31).
 *
 * Implements the mutual HMAC-SHA256 signature protocol between the control plane and the
 * CloudHost247 Server Agent (wire compatibility with server-agent/src/auth.js and
 * cloudhost247-node/src/deployments/agent-protocol.ts).
 *
 * Wire headers:
 *   x-ch247-agent-id:   server's agent_id registered on the server row
 *   x-ch247-timestamp:  unix seconds (skew must be within MAX_SKEW_SECONDS)
 *   x-ch247-nonce:      random hex nonce (replayed nonces within skew window rejected)
 *   x-ch247-signature:  hex(HMAC-SHA256(secret, agentId + '\n' + timestamp + '\n' + nonce + '\n'
 *                       + method + '\n' + path + '\n' + sha256(body)))
 *
 * Also supports fallback Bearer token authentication when AGENT_TOKEN is configured in environment.
 */
'use strict';

const crypto = require('node:crypto');
const { UnauthorizedError } = require('../core/errors');

const HEADERS = {
  agentId: 'x-ch247-agent-id',
  timestamp: 'x-ch247-timestamp',
  nonce: 'x-ch247-nonce',
  signature: 'x-ch247-signature',
};

const MAX_SKEW_SECONDS = 60;

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data ?? '').digest('hex');
}

function canonicalRequest(agentId, timestamp, nonce, method, path, bodySha256) {
  return [agentId, timestamp, nonce, method.toUpperCase(), path, bodySha256].join('\n');
}

function signCanonical(secret, canonical) {
  return crypto.createHmac('sha256', secret).update(canonical).digest('hex');
}

function constantTimeEqual(a, b) {
  const ab = Buffer.from(String(a ?? ''));
  const bb = Buffer.from(String(b ?? ''));
  if (ab.length !== bb.length || ab.length === 0) return false;
  return crypto.timingSafeEqual(ab, bb);
}

class NonceCache {
  constructor(skewSeconds = MAX_SKEW_SECONDS) {
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

/** Global in-memory nonce cache for inbound agent requests across routes */
const inboundNonces = new NonceCache(MAX_SKEW_SECONDS);

/**
 * Authenticates an inbound agent request.
 * Supports:
 *   1. HMAC-SHA256 signature signed with server's agent_secret.
 *   2. Shared AGENT_TOKEN via Authorization: Bearer <token>.
 */
async function authenticateAgent(ctx, deps, nonceCache = inboundNonces) {
  const { store, config } = deps;
  if (typeof ctx.parseBody === 'function') {
    await ctx.parseBody();
  }
  const headers = ctx.headers || {};
  const agentIdHeader = headers[HEADERS.agentId];
  const agentId = Array.isArray(agentIdHeader) ? agentIdHeader[0] : agentIdHeader;

  if (agentId) {
    const server = await store.table('servers').findOne({ agent_id: agentId });
    if (!server) throw new UnauthorizedError('Unknown agent');

    const cred = await store.table('server_credentials').findOne({ server_id: server.id, kind: 'agent_secret' });
    if (!cred || !cred.secret) throw new UnauthorizedError('Agent has no secret registered');

    const timestampHeader = headers[HEADERS.timestamp];
    const timestamp = Array.isArray(timestampHeader) ? timestampHeader[0] : timestampHeader;
    const nonceHeader = headers[HEADERS.nonce];
    const nonce = Array.isArray(nonceHeader) ? nonceHeader[0] : nonceHeader;
    const signatureHeader = headers[HEADERS.signature];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

    if (!timestamp || !nonce || !signature) {
      throw new UnauthorizedError('Agent request rejected: missing signature headers');
    }

    const now = Math.floor(Date.now() / 1000);
    const ts = Number.parseInt(timestamp, 10);
    if (!Number.isFinite(ts) || Math.abs(now - ts) > MAX_SKEW_SECONDS) {
      throw new UnauthorizedError('Agent request rejected: timestamp outside allowed skew');
    }

    if (!nonceCache.checkAndRecord(nonce, ts)) {
      throw new UnauthorizedError('Agent request rejected: replayed nonce');
    }

    const path = ctx.pathname || ctx.url?.pathname || (typeof ctx.url === 'string' ? ctx.url.split('?')[0] : '/');
    const rawBody = ctx.rawBody ? ctx.rawBody.toString('utf8') : '';
    const canonical = canonicalRequest(agentId, timestamp, nonce, ctx.method, path, sha256Hex(rawBody));
    const expectedSig = signCanonical(cred.secret, canonical);

    if (!constantTimeEqual(expectedSig, signature)) {
      throw new UnauthorizedError('Agent request rejected: signature mismatch');
    }

    return { server, mode: 'signed', agentId };
  }

  // Fallback to shared AGENT_TOKEN if provided
  const expectedToken = config?.AGENT_TOKEN;
  const authHeader = headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (expectedToken && token && constantTimeEqual(token, expectedToken)) {
    return { server: null, mode: 'bearer', agentId: null };
  }

  if (!agentId && !token) {
    throw new UnauthorizedError('Missing agent identity');
  }

  throw new UnauthorizedError('Invalid agent token');
}

function signOutbound(agentId, agentSecret, method, path, body, nowSeconds) {
  const timestamp = Math.floor(nowSeconds ?? Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString('hex');
  const bodySha = sha256Hex(typeof body === 'string' ? body : JSON.stringify(body ?? ''));
  const canonical = canonicalRequest(agentId, timestamp, nonce, method, path, bodySha);
  const signature = signCanonical(agentSecret, canonical);
  return {
    [HEADERS.agentId]: agentId,
    [HEADERS.timestamp]: timestamp,
    [HEADERS.nonce]: nonce,
    [HEADERS.signature]: signature,
  };
}

module.exports = {
  HEADERS,
  MAX_SKEW_SECONDS,
  sha256Hex,
  canonicalRequest,
  signCanonical,
  constantTimeEqual,
  NonceCache,
  inboundNonces,
  authenticateAgent,
  signOutbound,
};
