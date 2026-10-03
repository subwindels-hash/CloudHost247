/**
 * CloudHost247 Server Agent — request-authentication tests.
 *
 * The agent shipped with no tests at all, and it is the only component that talks to Docker on a
 * customer's server: its HMAC verification, skew window and replay cache are the whole boundary
 * between the control plane and that machine. These tests run with `node --test` and no npm
 * dependencies, matching the agent's own dependency-free design.
 *
 * The half of the contract these tests cannot see is the control plane's mirror implementation
 * (cloudhost247-node/src/deployments/agent-protocol.ts). Agreement between the two is enforced by
 * cloudhost247-node/tests/integration/agent-protocol-conformance.test.ts, which imports both.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  HEADERS,
  NonceCache,
  canonicalRequest,
  sha256Hex,
  signCanonical,
  signOutbound,
  signatureMatches,
  verifyRequest,
} from '../src/auth.js';
import { AgentConfigError, AGENT_VERSION, loadConfig } from '../src/config.js';

const SECRET = 'agent-secret-0123456789abcdef';
const config = { agentId: 'agent-abc123', agentSecret: SECRET, maxSkewSeconds: 60 };

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** Builds a signed inbound request the same way the control plane would. */
function signedRequest({
  agentId = config.agentId,
  secret = SECRET,
  method = 'POST',
  path = '/v1/apps/abc12345/deploy',
  body = '{"a":1}',
  timestamp = String(nowSeconds()),
  nonce = 'a'.repeat(32),
  overrides = {},
} = {}) {
  const signature = signCanonical(
    secret,
    canonicalRequest(agentId, timestamp, nonce, method, path, sha256Hex(body))
  );
  return {
    headers: {
      [HEADERS.agentId]: agentId,
      [HEADERS.timestamp]: timestamp,
      [HEADERS.nonce]: nonce,
      [HEADERS.signature]: signature,
      ...overrides,
    },
    method,
    path,
    rawBody: body,
  };
}

function verify(request, { nonceCache = new NonceCache(60), cfg = config } = {}) {
  return verifyRequest({
    config: cfg,
    headers: request.headers,
    method: request.method,
    path: request.path,
    rawBody: request.rawBody,
    nonceCache,
  });
}

/* ------------------------------------------------------------------ canonical form */

test('canonical request joins the six fields with newlines and uppercases the method', () => {
  assert.equal(
    canonicalRequest('agent-1', '1700000000', 'nonce', 'post', '/v1/ping', 'deadbeef'),
    'agent-1\n1700000000\nnonce\nPOST\n/v1/ping\ndeadbeef'
  );
});

test('sha256Hex hashes the exact bytes handed to it', () => {
  assert.equal(
    sha256Hex(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  );
  assert.equal(sha256Hex('abc').length, 64);
});

test('signCanonical is deterministic and hex', () => {
  const a = signCanonical(SECRET, 'canonical-string');
  const b = signCanonical(SECRET, 'canonical-string');
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, signCanonical('another-secret', 'canonical-string'));
});

/* ------------------------------------------------------------------ constant-time compare */

test('signatureMatches accepts an exact match and rejects everything else without throwing', () => {
  const sig = signCanonical(SECRET, 'x');
  assert.equal(signatureMatches(sig, sig), true);
  // A degenerate or wrong-length value must be a clean false, never a thrown TypeError:
  // timingSafeEqual throws on unequal lengths, and an absent header reaches here in practice.
  assert.equal(signatureMatches(sig, ''), false);
  assert.equal(signatureMatches(sig, sig.slice(0, -1)), false);
  assert.equal(signatureMatches(sig, sig + 'ff'), false);
  assert.equal(signatureMatches(sig, null), false);
  assert.equal(signatureMatches(sig, undefined), false);
  assert.equal(signatureMatches('', ''), false);
  assert.equal(signatureMatches(sig, signCanonical('other', 'x')), false);
});

/* ------------------------------------------------------------------ inbound verification */

test('a correctly signed request verifies', () => {
  assert.deepEqual(verify(signedRequest()), { ok: true });
});

test('verification is case-insensitive in the method and binds the exact path', () => {
  // Signed as "post", presented as "POST" — the canonical form uppercases both ways.
  const request = signedRequest({ method: 'post' });
  assert.deepEqual(verify({ ...request, method: 'POST' }), { ok: true });
  // ...but the path is bound verbatim.
  assert.equal(verify({ ...request, path: '/v1/apps/abc12345/teardown' }).ok, false);
});

test('every missing signature header is rejected before anything else runs', () => {
  for (const name of Object.values(HEADERS)) {
    const request = signedRequest();
    delete request.headers[name];
    const result = verify(request);
    assert.equal(result.ok, false, `${name} must be mandatory`);
    assert.equal(result.reason, 'missing signature headers');
  }
});

test('a duplicate header arriving as an array is read as its first value', () => {
  const request = signedRequest();
  request.headers[HEADERS.agentId] = [config.agentId, 'agent-attacker'];
  assert.deepEqual(verify(request), { ok: true });
});

test('an agent id that is not this agent is rejected', () => {
  // Signed correctly, but for a different identity — the agent is single-tenant.
  const request = signedRequest({ agentId: 'agent-someone-else' });
  const result = verify(request);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'agent id mismatch');
});

test('the agent id is bound into the signature, so swapping it invalidates the request', () => {
  const request = signedRequest();
  request.headers[HEADERS.agentId] = 'agent-someone-else';
  assert.equal(verify(request).ok, false);
});

test('timestamps outside the skew window are rejected in both directions', () => {
  for (const offset of [-3600, -61, 61, 3600]) {
    const request = signedRequest({ timestamp: String(nowSeconds() + offset) });
    const result = verify(request);
    assert.equal(result.ok, false, `offset ${offset} must be rejected`);
    assert.equal(result.reason, 'timestamp outside allowed skew');
  }
});

test('a non-numeric timestamp is rejected rather than coerced', () => {
  for (const timestamp of ['not-a-number', '', 'NaN', '12e3x']) {
    const request = signedRequest({ timestamp });
    assert.equal(verify(request).ok, false, `timestamp ${JSON.stringify(timestamp)}`);
  }
});

test('a replayed nonce is rejected even when the signature is valid', () => {
  const nonceCache = new NonceCache(60);
  const request = signedRequest({ nonce: 'b'.repeat(32) });
  assert.deepEqual(verify(request, { nonceCache }), { ok: true });
  const replay = verify(request, { nonceCache });
  assert.equal(replay.ok, false);
  assert.equal(replay.reason, 'replayed nonce');
});

test('a different nonce with an otherwise identical request is accepted', () => {
  const nonceCache = new NonceCache(60);
  assert.equal(verify(signedRequest({ nonce: 'c'.repeat(32) }), { nonceCache }).ok, true);
  assert.equal(verify(signedRequest({ nonce: 'd'.repeat(32) }), { nonceCache }).ok, true);
});

test('a tampered body is rejected — the hash covers the whole payload', () => {
  const request = signedRequest({ body: '{"amount":1}' });
  const result = verify({ ...request, rawBody: '{"amount":2}' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'signature mismatch');
});

test('a signature made with another secret is rejected', () => {
  const request = signedRequest({ secret: 'a-different-secret' });
  assert.equal(verify(request).ok, false);
});

test('an empty body verifies when it was signed empty', () => {
  assert.deepEqual(verify(signedRequest({ body: '' })), { ok: true });
  assert.equal(verify({ ...signedRequest({ body: '' }), rawBody: 'x' }).ok, false);
});

/* ------------------------------------------------------------------ nonce cache */

test('the nonce cache reports the first sighting and remembers it', () => {
  const cache = new NonceCache(60);
  const ts = nowSeconds();
  assert.equal(cache.checkAndRecord('n1', ts), true);
  assert.equal(cache.checkAndRecord('n1', ts), false);
  assert.equal(cache.checkAndRecord('n2', ts), true);
});

test('the nonce cache ages entries out so it cannot grow without bound', () => {
  const cache = new NonceCache(60);
  const now = nowSeconds();
  // Far older than skew * 2, so the next call prunes it.
  assert.equal(cache.checkAndRecord('stale', now - 600), true);
  assert.equal(cache.checkAndRecord('fresh', now), true);
  assert.equal(cache.checkAndRecord('stale', now - 600), true, 'a pruned nonce is forgotten');
});

test('the nonce cache is bounded over a long run', () => {
  const cache = new NonceCache(60);
  const now = nowSeconds();
  for (let index = 0; index < 500; index += 1) {
    cache.checkAndRecord(`nonce-${index}`, now);
  }
  // Pruning runs on every call; all 500 share a timestamp inside the window, so they are all
  // still live — the point is that the map tracks real nonces rather than one entry per call.
  assert.equal(cache.checkAndRecord('nonce-0', now), false);
});

/* ------------------------------------------------------------------ outbound signing */

test('outbound signatures verify against this agent like an inbound request', () => {
  const headers = signOutbound(config, 'POST', '/api/v1/agent/report', '{"cpu":1}');
  const result = verify({
    headers,
    method: 'POST',
    path: '/api/v1/agent/report',
    rawBody: '{"cpu":1}',
  });
  assert.deepEqual(result, { ok: true });
});

test('the outbound nonce is 16 CSPRNG bytes as hex, and never repeats', () => {
  const seen = new Set();
  for (let index = 0; index < 200; index += 1) {
    const { [HEADERS.nonce]: nonce } = signOutbound(config, 'POST', '/x', 'b');
    assert.match(nonce, /^[0-9a-f]{32}$/, 'random 16-byte hex per request (docs/SERVER_AGENT.md)');
    seen.add(nonce);
  }
  assert.equal(seen.size, 200, 'a repeated nonce would break replay protection');
});

test('the outbound nonce is not derived from Math.random()', () => {
  // Regression guard. The original implementation built the nonce as
  // sha256(`agentId:timestamp:${Math.random()}`) — the documented protocol and the control-plane
  // mirror both require 16 random bytes from a CSPRNG, and Math.random() is a predictable PRNG,
  // so the nonce was not the replay-protection primitive it claimed to be. Static, because no
  // black-box test can distinguish a predictable nonce from a random one.
  //
  // Comments are stripped first: the fix is documented in prose that necessarily names the call
  // it removed, and a guard that fires on its own explanation is a guard nobody keeps.
  const source = readFileSync(fileURLToPath(new URL('../src/auth.js', import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(source, /Math\.random/, 'the agent must not use Math.random() in code');
  assert.match(source, /randomBytes\(16\)\.toString\('hex'\)/);
});

test('an outbound signature is bound to this agent id and secret', () => {
  const headers = signOutbound(config, 'POST', '/api/v1/agent/report', 'body');
  assert.equal(
    verify({ headers, method: 'POST', path: '/api/v1/agent/report', rawBody: 'body' }, {
      cfg: { ...config, agentId: 'agent-other' },
    }).ok,
    false
  );
  assert.equal(
    verify({ headers, method: 'POST', path: '/api/v1/agent/report', rawBody: 'body' }, {
      cfg: { ...config, agentSecret: 'wrong-secret' },
    }).ok,
    false
  );
});

test('an outbound timestamp honours an injected clock', () => {
  const headers = signOutbound(config, 'POST', '/x', 'b', 1700000000);
  assert.equal(headers[HEADERS.timestamp], '1700000000');
});

/* ------------------------------------------------------------------ configuration */

test('missing required configuration is named in the error', () => {
  assert.throws(
    () => loadConfig({}),
    (error) => {
      assert.ok(error instanceof AgentConfigError);
      assert.match(error.message, /CH247_AGENT_ID, CH247_AGENT_SECRET, CH247_CONTROL_URL/);
      return true;
    }
  );
});

test('defaults are the documented ones', () => {
  const loaded = loadConfig({
    CH247_AGENT_ID: 'agent-1',
    CH247_AGENT_SECRET: 'secret',
    CH247_CONTROL_URL: 'https://portal.cloudhost247.com',
  });
  assert.equal(loaded.port, 8787);
  assert.equal(loaded.bind, '127.0.0.1', 'must not default to a public interface');
  assert.equal(loaded.appsDir, '/opt/cloudhost247/apps');
  assert.equal(loaded.backupDir, '/opt/cloudhost247/backups');
  assert.equal(loaded.reportSeconds, 60);
  assert.equal(loaded.maxSkewSeconds, 60);
});

test('overrides are honoured and a trailing slash is stripped from the control URL', () => {
  const loaded = loadConfig({
    CH247_AGENT_ID: 'agent-1',
    CH247_AGENT_SECRET: 'secret',
    CH247_CONTROL_URL: 'https://control.example.com/',
    CH247_PORT: '9000',
    CH247_BIND: '0.0.0.0',
    CH247_MAX_SKEW: '120',
    CH247_REPORT_SECONDS: '0',
  });
  assert.equal(loaded.controlUrl, 'https://control.example.com');
  assert.equal(loaded.port, 9000);
  assert.equal(loaded.bind, '0.0.0.0');
  assert.equal(loaded.maxSkewSeconds, 120);
  assert.equal(loaded.reportSeconds, 0);
});

test('the agent reports a version the control plane can read', () => {
  assert.match(AGENT_VERSION, /^\d+\.\d+\.\d+$/);
});
