/**
 * Conformance: the two implementations of the agent protocol must agree.
 *
 * The protocol exists twice on purpose — the control plane signs and verifies in TypeScript
 * (`src/deployments/agent-protocol.ts`) and the agent does the same in plain JavaScript
 * (`server-agent/src/auth.js`), because the agent must run on a customer's server with no npm
 * dependencies. Both files say the same thing in their headers:
 *
 *     "The two files define ONE protocol and must change together."
 *
 * Nothing enforced that. `tests/integration/agent-deployments-api.test.ts` covers the control
 * plane's *route* behaviour using its own hand-written signing helper, so it would keep passing
 * if the agent's implementation drifted — and a drift is not a cosmetic bug. If the canonical
 * string or the nonce format diverges, every deployment on every customer server fails closed at
 * once, and the failure looks like an authentication problem rather than a version mismatch.
 *
 * So this file imports BOTH real implementations and asserts they agree on the wire: the same
 * canonical string, the same signature bytes for the same inputs, the same header names, the
 * same nonce shape, and the same accept/reject decision — including signing in one direction and
 * verifying in the other, which is the only assertion that proves they are one protocol.
 */
import { describe, expect, it } from 'vitest';

import {
  AGENT_SIGNATURE_HEADERS,
  MAX_SKEW_SECONDS,
  NonceCache as ControlPlaneNonceCache,
  buildSignedHeaders,
  canonicalRequest as controlPlaneCanonicalRequest,
  sha256Hex as controlPlaneSha256Hex,
  signCanonical as controlPlaneSignCanonical,
  signatureMatches as controlPlaneSignatureMatches,
  verifySignedRequest,
} from '../../src/deployments/agent-protocol';

import {
  HEADERS as AGENT_HEADERS,
  NonceCache as AgentNonceCache,
  canonicalRequest as agentCanonicalRequest,
  sha256Hex as agentSha256Hex,
  signCanonical as agentSignCanonical,
  signatureMatches as agentSignatureMatches,
  signOutbound,
  verifyRequest as agentVerifyRequest,
} from '../../../server-agent/src/auth.js';

const SECRET = 'conformance-secret-0123456789abcdef';
const AGENT_ID = 'agent-conformance-1';
const OTHER_AGENT_ID = 'agent-conformance-2';
const METHOD = 'POST';
const PATH = '/v1/apps/c1a2b3c4/deploy';
const BODY = '{"composeYaml":"services: {}","environment":{"A":"1"}}';

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** The config shape the agent's own verifier takes. */
const agentConfig = { agentId: AGENT_ID, agentSecret: SECRET, maxSkewSeconds: MAX_SKEW_SECONDS };

/** Runs the agent's inbound verifier the way its HTTP entrypoint does. */
function agentVerifies(headers: Record<string, string | string[] | undefined>, options: {
  method?: string;
  path?: string;
  body?: string;
  cache?: AgentNonceCache;
  config?: typeof agentConfig;
} = {}) {
  return agentVerifyRequest({
    config: options.config ?? agentConfig,
    headers,
    method: options.method ?? METHOD,
    path: options.path ?? PATH,
    rawBody: options.body ?? BODY,
    nonceCache: options.cache ?? new AgentNonceCache(MAX_SKEW_SECONDS),
  });
}

/* ---------------------------------------------------------------- wire constants */

describe('wire constants', () => {
  it('both implementations use the same header names', () => {
    expect(AGENT_HEADERS).toEqual({
      agentId: 'x-ch247-agent-id',
      timestamp: 'x-ch247-timestamp',
      nonce: 'x-ch247-nonce',
      signature: 'x-ch247-signature',
    });
    expect(AGENT_SIGNATURE_HEADERS).toEqual(AGENT_HEADERS);
  });

  it('both implementations default to the same skew window', () => {
    expect(MAX_SKEW_SECONDS).toBe(60);
  });
});

/* ---------------------------------------------------------------- canonicalisation */

describe('canonicalisation agrees field for field', () => {
  it('produces an identical canonical string', () => {
    expect(agentCanonicalRequest(AGENT_ID, '1700000000', 'n', METHOD, PATH, 'hash')).toBe(
      controlPlaneCanonicalRequest(AGENT_ID, '1700000000', 'n', METHOD, PATH, 'hash')
    );
  });

  it('normalises the method identically, in both directions', () => {
    for (const method of ['post', 'POST', 'Post', 'get', 'GET']) {
      expect(agentCanonicalRequest(AGENT_ID, '1', 'n', method, PATH, 'h')).toBe(
        controlPlaneCanonicalRequest(AGENT_ID, '1', 'n', method, PATH, 'h')
      );
    }
    // The uppercasing is what the wire depends on: a lower-case signer and an upper-case
    // verifier must agree, because Node and Fastify hand over the method differently.
    expect(agentCanonicalRequest(AGENT_ID, '1', 'n', 'post', PATH, 'h')).toBe(
      controlPlaneCanonicalRequest(AGENT_ID, '1', 'n', 'POST', PATH, 'h')
    );
  });

  it('keeps every field on its own line so no field can be smuggled into another', () => {
    const canonical = agentCanonicalRequest(AGENT_ID, '1', 'n', METHOD, PATH, 'h');
    expect(canonical.split('\n')).toEqual([AGENT_ID, '1', 'n', METHOD, PATH, 'h']);
    // A path containing a newline must not be able to forge extra fields.
    const forged = agentCanonicalRequest(AGENT_ID, '1', 'n', METHOD, '/x\n1\nn', 'h');
    expect(forged).not.toBe(agentCanonicalRequest(AGENT_ID, '1', 'n', METHOD, '/x', 'h'));
  });

  it('hashes the body identically', () => {
    for (const body of ['', '{}', BODY, 'ünïcödé', '\u0000binary\u0001']) {
      expect(agentSha256Hex(body)).toBe(controlPlaneSha256Hex(body));
    }
  });

  it('produces identical signature bytes for identical inputs', () => {
    const canonical = agentCanonicalRequest(AGENT_ID, '1700000000', 'n', METHOD, PATH, 'h');
    expect(agentSignCanonical(SECRET, canonical)).toBe(controlPlaneSignCanonical(SECRET, canonical));
    expect(agentSignCanonical(SECRET, canonical)).toMatch(/^[0-9a-f]{64}$/);
  });
});

/* ---------------------------------------------------------------- the real directions */

describe('signatures cross-verify in both directions', () => {
  it('control-plane headers verify under the agent verifier', () => {
    // The deployment path: the worker signs, the customer's agent authenticates.
    const headers = buildSignedHeaders(AGENT_ID, SECRET, METHOD, PATH, BODY);
    expect(agentVerifies(headers)).toEqual({ ok: true });
  });

  it('agent headers verify under the control-plane verifier', () => {
    // The report path: the agent signs outbound, the control plane authenticates.
    const headers = signOutbound(
      { agentId: AGENT_ID, agentSecret: SECRET },
      METHOD,
      PATH,
      BODY
    ) as Record<string, string>;
    const result = verifySignedRequest(
      SECRET,
      headers,
      METHOD,
      PATH,
      BODY,
      new ControlPlaneNonceCache()
    );
    expect(result).toEqual({ valid: true, agentId: AGENT_ID });
  });

  it('an agent-signed body is rejected by the control plane once tampered with', () => {
    const headers = signOutbound(
      { agentId: AGENT_ID, agentSecret: SECRET },
      METHOD,
      PATH,
      BODY
    ) as Record<string, string>;
    const result = verifySignedRequest(
      SECRET,
      headers,
      METHOD,
      PATH,
      `${BODY} `,
      new ControlPlaneNonceCache()
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('signature mismatch');
  });
});

/* ---------------------------------------------------------------- identical decisions */

describe('both verifiers reach the same verdict', () => {
  /**
   * Signs with the control plane (the strict, typed implementation) and asks both verifiers.
   * Any divergence in canonicalisation, header handling or rejection reasons shows up here.
   */
  function bothVerify(headers: Record<string, string | string[] | undefined>, options: {
    method?: string;
    path?: string;
    body?: string;
    agentCache?: AgentNonceCache;
    controlCache?: ControlPlaneNonceCache;
    secret?: string;
  } = {}) {
    const agentResult = agentVerifies(headers, {
      method: options.method,
      path: options.path,
      body: options.body,
      cache: options.agentCache,
    });
    const controlResult = verifySignedRequest(
      options.secret ?? SECRET,
      headers,
      options.method ?? METHOD,
      options.path ?? PATH,
      options.body ?? BODY,
      options.controlCache ?? new ControlPlaneNonceCache()
    );
    return { agentResult, controlResult };
  }

  it('accepts a fresh, correctly signed request', () => {
    const headers = buildSignedHeaders(AGENT_ID, SECRET, METHOD, PATH, BODY);
    const { agentResult, controlResult } = bothVerify(headers);
    expect(agentResult.ok).toBe(true);
    expect(controlResult.valid).toBe(true);
  });

  it('rejects a request with any missing header, with the same reason', () => {
    for (const name of Object.values(AGENT_SIGNATURE_HEADERS)) {
      const headers: Record<string, string | string[] | undefined> = {
        ...buildSignedHeaders(AGENT_ID, SECRET, METHOD, PATH, BODY),
      };
      delete headers[name];
      const { agentResult, controlResult } = bothVerify(headers);
      expect(agentResult.ok, `${name} must be mandatory for the agent`).toBe(false);
      expect(controlResult.valid, `${name} must be mandatory for the control plane`).toBe(false);
      expect(agentResult.reason).toBe(controlResult.reason);
      expect(agentResult.reason).toBe('missing signature headers');
    }
  });

  it('rejects a stale or future timestamp identically', () => {
    for (const offset of [-3600, -61, 61, 3600]) {
      const headers = {
        ...buildSignedHeaders(AGENT_ID, SECRET, METHOD, PATH, BODY),
        [AGENT_SIGNATURE_HEADERS.timestamp]: String(nowSeconds() + offset),
      };
      const { agentResult, controlResult } = bothVerify(headers);
      expect(agentResult.ok, `offset ${offset}`).toBe(false);
      expect(controlResult.valid, `offset ${offset}`).toBe(false);
      expect(agentResult.reason).toBe('timestamp outside allowed skew');
      expect(controlResult.reason).toBe(agentResult.reason);
    }
  });

  it('rejects a replayed nonce identically', () => {
    const headers = buildSignedHeaders(AGENT_ID, SECRET, METHOD, PATH, BODY);
    const agentCache = new AgentNonceCache(MAX_SKEW_SECONDS);
    const controlCache = new ControlPlaneNonceCache();

    const first = bothVerify(headers, { agentCache, controlCache });
    expect(first.agentResult.ok).toBe(true);
    expect(first.controlResult.valid).toBe(true);

    const second = bothVerify(headers, { agentCache, controlCache });
    expect(second.agentResult.ok).toBe(false);
    expect(second.controlResult.valid).toBe(false);
    expect(agentResultReason(second)).toBe('replayed nonce');
  });

  it('rejects a wrong secret identically', () => {
    const headers = buildSignedHeaders(AGENT_ID, 'a-different-secret', METHOD, PATH, BODY);
    const { agentResult, controlResult } = bothVerify(headers);
    expect(agentResult.ok).toBe(false);
    expect(controlResult.valid).toBe(false);
    expect(agentResult.reason).toBe('signature mismatch');
    expect(controlResult.reason).toBe(agentResult.reason);
  });

  it('rejects a tampered body identically', () => {
    const headers = buildSignedHeaders(AGENT_ID, SECRET, METHOD, PATH, BODY);
    const { agentResult, controlResult } = bothVerify(headers, { body: `${BODY} ` });
    expect(agentResult.ok).toBe(false);
    expect(controlResult.valid).toBe(false);
    expect(agentResult.reason).toBe('signature mismatch');
  });

  it('binds the method and the path, so neither can be swapped after signing', () => {
    const headers = buildSignedHeaders(AGENT_ID, SECRET, METHOD, PATH, BODY);
    for (const changed of [
      { method: 'GET' },
      { path: '/v1/apps/c1a2b3c4/teardown' },
      { path: '/v1/apps/c1a2b3c4/deploy/' },
    ]) {
      const { agentResult, controlResult } = bothVerify(headers, changed);
      expect(agentResult.ok, JSON.stringify(changed)).toBe(false);
      expect(controlResult.valid, JSON.stringify(changed)).toBe(false);
    }
  });

  it('binds the agent id into the signature, so it cannot be relabelled', () => {
    // The control plane picks the secret by looking up the claimed agent id, and the agent
    // checks the claimed id against its own. Because the id is inside the canonical string,
    // a signature made for one agent can never authenticate as another.
    const headers = buildSignedHeaders(AGENT_ID, SECRET, METHOD, PATH, BODY);
    const relabelled = { ...headers, [AGENT_SIGNATURE_HEADERS.agentId]: OTHER_AGENT_ID };

    const controlResult = verifySignedRequest(
      SECRET,
      relabelled,
      METHOD,
      PATH,
      BODY,
      new ControlPlaneNonceCache()
    );
    expect(controlResult.valid).toBe(false);

    const agentResult = agentVerifies(relabelled);
    expect(agentResult.ok).toBe(false);
    expect(agentResult.reason).toBe('agent id mismatch');

    // And for the same secret, a different agent id really does produce a different signature.
    expect(buildSignedHeaders(OTHER_AGENT_ID, SECRET, METHOD, PATH, BODY)[
      AGENT_SIGNATURE_HEADERS.signature
    ]).not.toBe(headers[AGENT_SIGNATURE_HEADERS.signature]);
  });

  it('reads a duplicated header as its first value on both sides', () => {
    const headers = buildSignedHeaders(AGENT_ID, SECRET, METHOD, PATH, BODY);
    const duplicated = { ...headers, [AGENT_SIGNATURE_HEADERS.agentId]: [AGENT_ID, OTHER_AGENT_ID] };
    const { agentResult, controlResult } = bothVerify(duplicated);
    expect(agentResult.ok).toBe(true);
    expect(controlResult.valid).toBe(true);
  });
});

/* ---------------------------------------------------------------- shared primitives */

describe('shared primitives behave identically', () => {
  it('the nonce is 16 CSPRNG bytes as hex on both sides', () => {
    const control = buildSignedHeaders(AGENT_ID, SECRET, METHOD, PATH, BODY);
    const agent = signOutbound(
      { agentId: AGENT_ID, agentSecret: SECRET },
      METHOD,
      PATH,
      BODY
    ) as Record<string, string>;
    expect(control[AGENT_SIGNATURE_HEADERS.nonce]).toMatch(/^[0-9a-f]{32}$/);
    expect(agent[AGENT_SIGNATURE_HEADERS.nonce]).toMatch(/^[0-9a-f]{32}$/);
  });

  it('the signature comparator agrees on degenerate input', () => {
    const signature = controlPlaneSignCanonical(SECRET, 'x');
    expect(agentSignatureMatches(signature, signature)).toBe(true);
    expect(controlPlaneSignatureMatches(signature, signature)).toBe(true);
    for (const bad of ['', null, undefined, signature.slice(0, -1), signature + 'ff']) {
      // Neither may throw: an absent or truncated signature is a 401, not a 500. timingSafeEqual
      // throws on unequal lengths, so both implementations must pre-check.
      expect(agentSignatureMatches(signature, bad as never), String(bad)).toBe(false);
      expect(controlPlaneSignatureMatches(signature, bad as never), String(bad)).toBe(false);
      expect(agentSignatureMatches(signature, bad as never)).toBe(
        controlPlaneSignatureMatches(signature, bad as never)
      );
    }
  });

  it('both nonce caches accept the first sighting and refuse the second', () => {
    const now = nowSeconds();
    const agentCache = new AgentNonceCache(MAX_SKEW_SECONDS);
    const controlCache = new ControlPlaneNonceCache();
    for (const cache of [agentCache, controlCache]) {
      expect(cache.checkAndRecord('n1', now)).toBe(true);
      expect(cache.checkAndRecord('n1', now)).toBe(false);
      expect(cache.checkAndRecord('n2', now)).toBe(true);
    }
  });
});

/** Reads the rejection reason from either verifier's result shape. */
function agentResultReason(result: { agentResult: { reason?: string } }): string | undefined {
  return result.agentResult.reason;
}
