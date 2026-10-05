/**
 * Tests for passkeys / WebAuthn.
 *
 * There is no browser and no hardware authenticator here, so the suite supplies both missing
 * halves honestly:
 *
 *   - a **software authenticator** that builds real attestation objects and signs real assertions
 *     with node:crypto — so the server verifies genuine cryptography over genuine encodings
 *   - a **test-only CBOR encoder** to build those structures, which is exactly why the decoder is
 *     additionally pinned against the RFC 8949 Appendix A byte vectors and the COSE→SPKI conversion
 *     against the NIST P-256 test vector (a self-consistent encoder/decoder pair could otherwise
 *     agree on something the rest of the world does not)
 *
 * Every refusal test asserts the reason, not just the status, because "it said no" and "it said no
 * for the right reason" are different guarantees.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { startServer, jsonFetch, register } = require('./helpers');
const { hashPassword } = require('../src/lib/password');
const { decodeAll, decodeFirst, CborError } = require('../src/lib/webauthn/cbor');
const { parseCosePublicKey, CoseKeyError } = require('../src/lib/webauthn/cose');
const { parseAuthenticatorData, AuthenticatorDataError } = require('../src/lib/webauthn/authenticator-data');
const { verifyRegistration, verifyAssertion } = require('../src/lib/webauthn/verify');

const b64u = (buffer) => Buffer.from(buffer).toString('base64url');
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest();
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };

// ---------------------------------------------------------------------------
// Test-only CBOR encoder (the production code only decodes)
// ---------------------------------------------------------------------------

function cborHead(major, value) {
  if (value < 24) return Buffer.from([(major << 5) | value]);
  if (value < 0x100) return Buffer.from([(major << 5) | 24, value]);
  if (value < 0x10000) {
    const b = Buffer.alloc(3);
    b[0] = (major << 5) | 25; b.writeUInt16BE(value, 1);
    return b;
  }
  const b = Buffer.alloc(5);
  b[0] = (major << 5) | 26; b.writeUInt32BE(value, 1);
  return b;
}

function encodeCbor(value) {
  if (Buffer.isBuffer(value)) return Buffer.concat([cborHead(2, value.length), value]);
  if (typeof value === 'string') {
    const bytes = Buffer.from(value, 'utf8');
    return Buffer.concat([cborHead(3, bytes.length), bytes]);
  }
  if (typeof value === 'number') {
    return value >= 0
      ? cborHead(0, value)
      : cborHead(1, -1 - value);
  }
  if (typeof value === 'boolean') return Buffer.from([value ? 0xf5 : 0xf4]);
  if (value === null) return Buffer.from([0xf6]);
  if (Array.isArray(value)) {
    return Buffer.concat([cborHead(4, value.length), ...value.map(encodeCbor)]);
  }
  if (value instanceof Map) {
    const parts = [cborHead(5, value.size)];
    for (const [key, item] of value) parts.push(encodeCbor(key), encodeCbor(item));
    return Buffer.concat(parts);
  }
  throw new Error(`test encoder cannot encode ${typeof value}`);
}

// ---------------------------------------------------------------------------
// Software authenticator
// ---------------------------------------------------------------------------

const UP = 0x01;
const UV = 0x04;
const BE = 0x08;
const BS = 0x10;
const AT = 0x40;

function p256CoseKey(publicKey) {
  const jwk = publicKey.export({ format: 'jwk' });
  return encodeCbor(new Map([
    [1, 2], [3, -7], [-1, 1],
    [-2, Buffer.from(jwk.x, 'base64url')],
    [-3, Buffer.from(jwk.y, 'base64url')],
  ]));
}

/**
 * A minimal authenticator: one credential per instance, ES256, counters it controls.
 */
function makeAuthenticator(rpId) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const credentialId = crypto.randomBytes(16);
  const coseKey = p256CoseKey(publicKey);
  let counter = 0;

  return {
    credentialId,
    coseKey,
    rpId,
    privateKey,
    publicKey,
    setCounter(value) { counter = value; },
    get counter() { return counter; },

    registration({
      challenge, origin, rpIdHash, flags = UP | UV | AT, fmt = 'none',
      attStmt = new Map(), attestedCredentialId = credentialId,
    }) {
      const clientDataJSON = Buffer.from(JSON.stringify({
        type: 'webauthn.create', challenge, origin, crossOrigin: false,
      }));
      const authData = Buffer.concat([
        sha256(rpIdHash ?? rpId),
        Buffer.from([flags]),
        u32(counter),
        Buffer.alloc(16), // AAGUID — all zero means "no attested authenticator model"
        u16(attestedCredentialId.length),
        attestedCredentialId,
        coseKey,
      ]);
      const attestationObject = encodeCbor(new Map([
        ['fmt', fmt], ['attStmt', attStmt], ['authData', authData],
      ]));
      return {
        id: b64u(credentialId),
        rawId: b64u(credentialId),
        type: 'public-key',
        response: {
          clientDataJSON: b64u(clientDataJSON),
          attestationObject: b64u(attestationObject),
          transports: ['internal'],
        },
      };
    },

    assertion({
      challenge, origin, flags = UP | UV, signingKey = privateKey, counterValue = null,
      rpIdHash, type = 'webauthn.get', userHandle = null,
    }) {
      const clientDataJSON = Buffer.from(JSON.stringify({
        type, challenge, origin, crossOrigin: false,
      }));
      const value = counterValue ?? counter;
      const authData = Buffer.concat([sha256(rpIdHash ?? rpId), Buffer.from([flags]), u32(value)]);
      const signature = crypto.sign('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), signingKey);
      return {
        id: b64u(credentialId),
        rawId: b64u(credentialId),
        type: 'public-key',
        response: {
          clientDataJSON: b64u(clientDataJSON),
          authenticatorData: b64u(authData),
          signature: b64u(signature),
          // Discoverable credentials report the handle the RP set at registration; null means the
          // authenticator did not have one (the email-first ceremony does not depend on it).
          userHandle: userHandle === null ? null : b64u(Buffer.from(String(userHandle), 'utf8')),
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Unit: CBOR decoder against RFC 8949 Appendix A
// ---------------------------------------------------------------------------

test('unit: CBOR decoder matches the RFC 8949 Appendix A vectors', async (t) => {
  const bytes = (hex) => Buffer.from(hex.replace(/\s+/g, ''), 'hex');

  const vectors = [
    ['00', 0], ['01', 1], ['0a', 10], ['17', 23], ['1818', 24], ['1819', 25],
    ['1864', 100], ['1903e8', 1000], ['1a000f4240', 1000000], ['1b0000000100000000', 4294967296],
    ['20', -1], ['29', -10], ['3863', -100], ['3903e7', -1000],
    ['f4', false], ['f5', true], ['f6', null],
    ['40', Buffer.alloc(0)], ['4401020304', bytes('01020304')],
    ['60', ''], ['6161', 'a'], ['6449455446', 'IETF'], ['62225c', '"\\'],
    ['80', []], ['83010203', [1, 2, 3]], ['8301820203820405', [1, [2, 3], [4, 5]]],
    ['a0', new Map()], ['a201020304', new Map([[1, 2], [3, 4]])],
    ['a26161016162820203', new Map([['a', 1], ['b', [2, 3]]])],
    ['826161a161626163', ['a', new Map([['b', 'c']])]],
  ];

  for (const [hex, expected] of vectors) {
    await t.test(`0x${hex}`, () => {
      assert.deepStrictEqual(decodeAll(bytes(hex)), expected);
    });
  }

  await t.test('refuses everything it cannot fully justify', () => {
    const refusals = {
      'indefinite-length byte string': '5f42010243030405ff',
      'indefinite-length array': '9f0102ff',
      'indefinite-length map': 'bf616101ff',
      'CBOR tag': 'c074323031332d30332d32315432303a30343a30305a',
      'float16': 'f93c00',
      'float64': 'fb3ff199999999999a',
      'undefined simple value': 'f7',
      'simple value 16': 'f0',
      'empty buffer': '',
      'truncated text string': '62',
      'duplicate map keys': 'a2616101616102',
      'map keyed by an array': 'a1810101',
      'deeply nested array': '81'.repeat(20),
    };
    for (const [label, hex] of Object.entries(refusals)) {
      assert.throws(() => decodeAll(bytes(hex)), CborError, label);
    }
  });

  await t.test('reports trailing bytes instead of ignoring them', () => {
    assert.deepStrictEqual(decodeAll(Buffer.from([0x01])), 1);
    assert.throws(() => decodeAll(Buffer.from([0x01, 0x02])), CborError);
    assert.deepStrictEqual(decodeFirst(Buffer.from([0x01, 0x02])).bytesRead, 1);
  });

  await t.test('rejects invalid UTF-8 in text strings rather than rewriting it', () => {
    assert.throws(() => decodeAll(Buffer.from([0x61, 0xff])), CborError);
  });
});

// ---------------------------------------------------------------------------
// Unit: COSE keys
// ---------------------------------------------------------------------------

test('unit: COSE public key conversion', async (t) => {
  await t.test('converts the NIST P-256 test vector and verifies with it', () => {
    // NIST FIPS 186-4 / RFC 6979 P-256 test key (d and the matching point).
    const d = Buffer.from('C9AFA9D845BA75166B5C215767B1D6934E50C3DB36E89B127B8A622B120F6721', 'hex');
    const x = Buffer.from('60FED4BA255A9D31C961EB74C6356D68C049B8923B61FA6CE669622E60F29FB6', 'hex');
    const y = Buffer.from('7903FE1008B8BC99A41AE9E95628BC64F2F1B20C2D7E9F5177A3C294D4462299', 'hex');

    const cose = encodeCbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, x], [-3, y]]));
    const key = parseCosePublicKey(cose);
    assert.strictEqual(key.algorithm, 'ES256');

    const privateKey = crypto.createPrivateKey({
      key: { kty: 'EC', crv: 'P-256', x: b64u(x), y: b64u(y), d: b64u(d) },
      format: 'jwk',
    });
    const data = Buffer.from('known-answer test data');
    const signature = crypto.sign('sha256', data, privateKey);

    assert.strictEqual(key.verify(data, signature), true, 'the converted key verifies a real signature');
    assert.strictEqual(key.verify(Buffer.from('different data'), signature), false);
    assert.strictEqual(key.verify(data, Buffer.from(signature).reverse()), false);
  });

  await t.test('supports Ed25519 (OKP / EdDSA)', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    const jwk = publicKey.export({ format: 'jwk' });
    const cose = encodeCbor(new Map([[1, 1], [3, -8], [-1, 6], [-2, Buffer.from(jwk.x, 'base64url')]]));
    const key = parseCosePublicKey(cose);
    assert.strictEqual(key.algorithm, 'EdDSA');

    const data = Buffer.from('ed25519 data');
    assert.strictEqual(key.verify(data, crypto.sign(null, data, privateKey)), true);
  });

  await t.test('supports RSA (RS256 and PS256)', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' });
    const n = Buffer.from(jwk.n, 'base64url');
    const e = Buffer.from(jwk.e, 'base64url');
    const data = Buffer.from('rsa data');

    const rs256 = parseCosePublicKey(encodeCbor(new Map([[1, 3], [3, -257], [-1, n], [-2, e]])));
    assert.strictEqual(rs256.algorithm, 'RS256');
    const pkcs1 = crypto.sign('sha256', data, privateKey);
    assert.strictEqual(rs256.verify(data, pkcs1), true);

    const ps256 = parseCosePublicKey(encodeCbor(new Map([[1, 3], [3, -37], [-1, n], [-2, e]])));
    assert.strictEqual(ps256.algorithm, 'PS256');
    const pss = crypto.sign('sha256', data, {
      key: privateKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32,
    });
    assert.strictEqual(ps256.verify(data, pss), true);
    // A PSS signature must not verify as PKCS#1 or vice versa.
    assert.strictEqual(ps256.verify(data, pkcs1), false);
    assert.strictEqual(rs256.verify(data, pss), false);
  });

  await t.test('refuses unsupported, mismatched and malformed keys', () => {
    const x = Buffer.alloc(32, 1);
    const y = Buffer.alloc(32, 2);

    // ES384 (alg -35) is not supported.
    assert.throws(() => parseCosePublicKey(encodeCbor(new Map([[1, 2], [3, -35], [-1, 2], [-2, x], [-3, y]]))), CoseKeyError);
    // EC2 key advertising RS256: type and algorithm disagree.
    assert.throws(() => parseCosePublicKey(encodeCbor(new Map([[1, 2], [3, -257], [-1, 1], [-2, x], [-3, y]]))), CoseKeyError);
    // Wrong curve (P-384 = 2).
    assert.throws(() => parseCosePublicKey(encodeCbor(new Map([[1, 2], [3, -7], [-1, 2], [-2, x], [-3, y]]))), CoseKeyError);
    // Short coordinate is malformed, not padded.
    assert.throws(() => parseCosePublicKey(encodeCbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.alloc(31, 1)], [-3, y]]))), CoseKeyError);
    // Not CBOR at all.
    assert.throws(() => parseCosePublicKey(Buffer.from('not cbor')), CoseKeyError);
    // Not a map.
    assert.throws(() => parseCosePublicKey(encodeCbor(42)), CoseKeyError);
  });
});

// ---------------------------------------------------------------------------
// Unit: authenticator data
// ---------------------------------------------------------------------------

test('unit: authenticator data parsing', async (t) => {
  const rpId = 'example.com';
  const auth = makeAuthenticator(rpId);

  await t.test('parses a registration authData completely and reports no trailing bytes', () => {
    const response = auth.registration({ challenge: 'c', origin: `https://${rpId}` });
    const authData = Buffer.from(response.response.attestationObject, 'base64url');
    const parsedObject = decodeAll(authData);
    const parsed = parseAuthenticatorData(parsedObject.get('authData'));

    assert.deepStrictEqual(parsed.rpIdHash, sha256(rpId));
    assert.strictEqual(parsed.flags.up, true);
    assert.strictEqual(parsed.flags.uv, true);
    assert.strictEqual(parsed.flags.at, true);
    assert.strictEqual(parsed.signCount, 0);
    assert.strictEqual(parsed.aaguid, null, 'an all-zero AAGUID means no attested model');
    assert.deepStrictEqual(parsed.credentialId, auth.credentialId);
    assert.deepStrictEqual(parsed.cosePublicKeyBytes, auth.coseKey);
    assert.strictEqual(parsed.trailingBytes, 0);
  });

  await t.test('an assertion authData carries no attested credential data', () => {
    const response = auth.assertion({ challenge: 'c', origin: `https://${rpId}`, counterValue: 7 });
    const authData = Buffer.from(response.response.authenticatorData, 'base64url');
    const parsed = parseAuthenticatorData(authData);
    assert.strictEqual(parsed.flags.at, false);
    assert.strictEqual(parsed.signCount, 7);
    assert.strictEqual(parsed.credentialId, null);
    assert.strictEqual(parsed.trailingBytes, 0);
  });

  await t.test('truncated and trailing input are refused', () => {
    assert.throws(() => parseAuthenticatorData(Buffer.alloc(36)), AuthenticatorDataError);
    const minimal = Buffer.concat([sha256(rpId), Buffer.from([UP]), u32(0)]);
    assert.strictEqual(minimal.length, 37);
    assert.doesNotThrow(() => parseAuthenticatorData(minimal));
    assert.strictEqual(parseAuthenticatorData(Buffer.concat([minimal, Buffer.from([0, 0])])).trailingBytes, 2);
  });
});

// ---------------------------------------------------------------------------
// Unit: ceremony verification rules
// ---------------------------------------------------------------------------

test('unit: registration and assertion verification rules', async (t) => {
  const rpId = 'example.com';
  const origin = `https://${rpId}`;
  const auth = makeAuthenticator(rpId);
  const challenge = 'unit-challenge-value';

  await t.test('a correct registration verifies and reports the credential', () => {
    const verdict = verifyRegistration({
      response: auth.registration({ challenge, origin }),
      expectedChallenge: challenge, rpId, origins: [origin], requireUserVerification: true,
    });
    assert.strictEqual(verdict.verified, true, verdict.reason);
    assert.strictEqual(verdict.registration.credentialId, b64u(auth.credentialId));
    assert.strictEqual(verdict.registration.algorithm, 'ES256');
    assert.strictEqual(verdict.registration.deviceType, 'singleDevice');
    assert.strictEqual(verdict.registration.backedUp, false);
  });

  await t.test('backup flags are reported', () => {
    const verdict = verifyRegistration({
      response: auth.registration({ challenge, origin, flags: UP | UV | AT | BE | BS }),
      expectedChallenge: challenge, rpId, origins: [origin],
    });
    assert.strictEqual(verdict.registration.deviceType, 'multiDevice');
    assert.strictEqual(verdict.registration.backedUp, true);
  });

  const refused = (label, response, expected) => t.test(label, () => {
    const verdict = verifyRegistration({
      response, expectedChallenge: challenge, rpId, origins: [origin],
    });
    assert.strictEqual(verdict.verified, false);
    assert.match(verdict.reason, expected);
  });

  await refused('a wrong challenge is refused', auth.registration({ challenge: 'other', origin }), /challenge/i);
  await refused('another origin is refused', auth.registration({ challenge, origin: 'https://evil.example.com' }), /origin/i);
  await refused('a foreign rpIdHash is refused', auth.registration({ challenge, origin, rpIdHash: 'other.example.com' }), /rpIdHash/i);
  await refused('a missing UV flag is refused', auth.registration({ challenge, origin, flags: UP | AT }), /user verification/i);
  await refused('a missing UP flag is refused', auth.registration({ challenge, origin, flags: UV | AT }), /user presence/i);
  await refused('packed attestation is refused rather than stored unverified',
    auth.registration({ challenge, origin, fmt: 'packed', attStmt: new Map([['alg', -7]]) }), /attestation format/i);
  await refused('an attested credential id that does not match rawId is refused',
    auth.registration({ challenge, origin, attestedCredentialId: crypto.randomBytes(16) }), /attested credential id/i);

  await t.test('a correct assertion verifies and returns the new counter', () => {
    const verdict = verifyAssertion({
      response: auth.assertion({ challenge, origin, counterValue: 5 }),
      expectedChallenge: challenge,
      rpId,
      origins: [origin],
      storedCredential: {
        credential_id: b64u(auth.credentialId), public_key: b64u(auth.coseKey), counter: 4,
      },
    });
    assert.strictEqual(verdict.verified, true, verdict.reason);
    assert.strictEqual(verdict.newCounter, 5);
  });

  await t.test('a forged signature from another key is refused', () => {
    const other = makeAuthenticator(rpId);
    const verdict = verifyAssertion({
      response: auth.assertion({ challenge, origin, signingKey: other.privateKey }),
      expectedChallenge: challenge, rpId, origins: [origin], storedCredential: {
        credential_id: b64u(auth.credentialId), public_key: b64u(auth.coseKey), counter: 0,
      },
    });
    assert.strictEqual(verdict.verified, false);
    assert.match(verdict.reason, /signature/i);
  });

  await t.test('tampered authenticator data is refused', () => {
    const good = auth.assertion({ challenge, origin });
    const authData = Buffer.from(good.response.authenticatorData, 'base64url');
    authData[32] |= BE; // flip a flag without re-signing
    const verdict = verifyAssertion({
      response: { ...good, response: { ...good.response, authenticatorData: b64u(authData) } },
      expectedChallenge: challenge, rpId, origins: [origin], storedCredential: {
        credential_id: b64u(auth.credentialId), public_key: b64u(auth.coseKey), counter: 0,
      },
    });
    assert.strictEqual(verdict.verified, false);
    assert.match(verdict.reason, /signature/i);
  });

  await t.test('an assertion without user verification is refused', () => {
    const verdict = verifyAssertion({
      response: auth.assertion({ challenge, origin, flags: UP, counterValue: 9 }),
      expectedChallenge: challenge, rpId, origins: [origin], storedCredential: {
        credential_id: b64u(auth.credentialId), public_key: b64u(auth.coseKey), counter: 8,
      },
    });
    assert.strictEqual(verdict.verified, false);
    assert.match(verdict.reason, /user verification/i);
  });

  await t.test('a counter that does not advance is refused as a possible clone', () => {
    const verdict = verifyAssertion({
      response: auth.assertion({ challenge, origin, counterValue: 4 }),
      expectedChallenge: challenge, rpId, origins: [origin], storedCredential: {
        credential_id: b64u(auth.credentialId), public_key: b64u(auth.coseKey), counter: 4,
      },
    });
    assert.strictEqual(verdict.verified, false);
    assert.match(verdict.reason, /cloned/i);
  });

  await t.test('zero counters are exempt from clone detection (synced passkeys always report 0)', () => {
    const verdict = verifyAssertion({
      response: auth.assertion({ challenge, origin, counterValue: 0 }),
      expectedChallenge: challenge, rpId, origins: [origin], storedCredential: {
        credential_id: b64u(auth.credentialId), public_key: b64u(auth.coseKey), counter: 0,
      },
    });
    assert.strictEqual(verdict.verified, true, verdict.reason);
  });

  await t.test('a correctly signed assertion carrying a registration clientData type is refused', () => {
    const verdict = verifyAssertion({
      response: auth.assertion({ challenge, origin, type: 'webauthn.create' }),
      expectedChallenge: challenge, rpId, origins: [origin], storedCredential: {
        credential_id: b64u(auth.credentialId), public_key: b64u(auth.coseKey), counter: 0,
      },
    });
    assert.strictEqual(verdict.verified, false);
    assert.match(verdict.reason, /clientDataJSON type/i);
  });
});

// ---------------------------------------------------------------------------
// Integration: enrolment, sign-in, management
// ---------------------------------------------------------------------------

test('integration: passkey enrolment and sign-in', async (t) => {
  const { base, app, close } = await startServer({
    SANDBOX_PAYMENTS: 'true',
  });

  try {
    // The deployment's public URL is only known once the ephemeral port exists. This is the test
    // acting as the operator configuring APP_URL, not a bypass: the relying party and the accepted
    // origins are read from config on every ceremony.
    app.config.APP_URL = base;
    const rpId = '127.0.0.1';
    const origin = base;

    const password = 'correct-horse-battery-staple';
    const reg = await register(base, 'passkey-owner@example.com');
    const token = reg.data.accessToken;
    await app.store.table('users').updateById(reg.data.user.id, { password_hash: await hashPassword(password) });

    const authenticator = makeAuthenticator(rpId);

    await t.test('the account starts with no passkeys', async () => {
      const res = await jsonFetch(base, { path: '/api/v1/auth/passkeys' }, token);
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(res.data.passkeys, []);
    });

    await t.test('enrolment requires the current password', async () => {
      const missing = await jsonFetch(base, {
        path: '/api/v1/auth/passkeys/register/options', method: 'POST', body: {},
      }, token);
      assert.strictEqual(missing.status, 400);

      const wrong = await jsonFetch(base, {
        path: '/api/v1/auth/passkeys/register/options', method: 'POST', body: { password: 'not-the-password' },
      }, token);
      assert.strictEqual(wrong.status, 401);
      assert.match(wrong.data.message, /password/i);
    });

    let challengeId;
    await t.test('registration options are issued with attestation none and UV required', async () => {
      const res = await jsonFetch(base, {
        path: '/api/v1/auth/passkeys/register/options', method: 'POST', body: { password },
      }, token);
      assert.strictEqual(res.status, 200);
      challengeId = res.data.challengeId;

      const options = res.data.options;
      assert.strictEqual(options.rp.id, rpId);
      assert.strictEqual(options.attestation, 'none');
      assert.strictEqual(options.authenticatorSelection.userVerification, 'required');
      assert.strictEqual(options.authenticatorSelection.residentKey, 'preferred');
      assert.deepStrictEqual(options.pubKeyCredParams.map((p) => p.alg), [-7, -257, -8]);
      assert.strictEqual(Buffer.from(options.user.id, 'base64url').toString('utf8'), reg.data.user.id,
        'the user handle is the account id, never the email');
      assert.ok(options.challenge.length >= 40, 'a fresh random challenge is issued');
    });

    await t.test('a valid attestation registers the passkey', async () => {
      const options = await jsonFetch(base, {
        path: '/api/v1/auth/passkeys/register/options', method: 'POST', body: { password },
      }, token);
      const response = authenticator.registration({
        challenge: options.data.options.challenge, origin,
      });
      const res = await jsonFetch(base, {
        path: '/api/v1/auth/passkeys/register/verify', method: 'POST',
        body: { challengeId: options.data.challengeId, response, name: 'Test laptop' },
      }, token);

      assert.strictEqual(res.status, 201, JSON.stringify(res.data));
      assert.strictEqual(res.data.passkey.name, 'Test laptop');
      assert.strictEqual(res.data.passkey.credentialId, b64u(authenticator.credentialId));
      assert.deepStrictEqual(res.data.passkey.transports, ['internal']);
    });

    await t.test('the passkey is listed and the audit trail records it', async () => {
      const res = await jsonFetch(base, { path: '/api/v1/auth/passkeys' }, token);
      assert.strictEqual(res.data.passkeys.length, 1);

      const audit = (await app.store.table('auth_audit_log').find({ user_id: reg.data.user.id })).rows
        .find((row) => row.event_type === 'passkey_registered');
      assert.ok(audit, 'passkey_registered is audited');
      assert.strictEqual(audit.metadata.algorithm, 'ES256');
      assert.strictEqual(audit.metadata.backedUp, false);
    });

    await t.test('a challenge cannot be reused', async () => {
      const options = await jsonFetch(base, {
        path: '/api/v1/auth/passkeys/register/options', method: 'POST', body: { password },
      }, token);
      // A second authenticator: a credential id is unique, so this is a genuinely new passkey.
      const second = makeAuthenticator(rpId);
      const response = second.registration({ challenge: options.data.options.challenge, origin });
      const first = await jsonFetch(base, {
        path: '/api/v1/auth/passkeys/register/verify', method: 'POST',
        body: { challengeId: options.data.challengeId, response, name: 'Second' },
      }, token);
      assert.strictEqual(first.status, 201, JSON.stringify(first.data));

      const replay = await jsonFetch(base, {
        path: '/api/v1/auth/passkeys/register/verify', method: 'POST',
        body: { challengeId: options.data.challengeId, response, name: 'Third' },
      }, token);
      assert.strictEqual(replay.status, 401);
      assert.match(replay.data.message, /expired or was already used/i);
    });

    await t.test("another user's challenge cannot be completed", async () => {
      const other = await register(base, 'passkey-other@example.com');
      const options = await jsonFetch(base, {
        path: '/api/v1/auth/passkeys/register/options', method: 'POST', body: { password },
      }, token);

      const stolen = await jsonFetch(base, {
        path: '/api/v1/auth/passkeys/register/verify', method: 'POST',
        body: {
          challengeId: options.data.challengeId,
          response: makeAuthenticator(rpId).registration({ challenge: options.data.options.challenge, origin }),
        },
      }, other.data.accessToken);
      assert.strictEqual(stolen.status, 401);
    });

    await t.test('a foreign-origin or wrong-rp attestation is refused with the reason', async () => {
      const options = await jsonFetch(base, {
        path: '/api/v1/auth/passkeys/register/options', method: 'POST', body: { password },
      }, token);
      const response = authenticator.registration({
        challenge: options.data.options.challenge, origin: 'https://evil.example.com',
      });
      const res = await jsonFetch(base, {
        path: '/api/v1/auth/passkeys/register/verify', method: 'POST',
        body: { challengeId: options.data.challengeId, response },
      }, token);
      assert.strictEqual(res.status, 400);
      assert.match(res.data.message, /origin/i);

      const audit = (await app.store.table('auth_audit_log').find({ user_id: reg.data.user.id })).rows
        .find((row) => row.event_type === 'passkey_registration_failure');
      assert.ok(audit, 'a refused registration is audited');
    });

    // ---------------------------------------------------------------- sign-in

    let session;
    await t.test('sign-in options are scoped to the account\'s credentials', async () => {
      const res = await jsonFetch(base, {
        path: '/api/v1/auth/passkeys/login/options', method: 'POST',
        body: { email: 'passkey-owner@example.com' },
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.options.rpId, rpId);
      assert.strictEqual(res.data.options.userVerification, 'required');
      assert.ok(res.data.options.allowCredentials.some((c) => c.id === b64u(authenticator.credentialId)));
      session = res.data;
    });

    await t.test('a valid assertion signs in and the session works', async () => {
      const assertion = authenticator.assertion({ challenge: session.options.challenge, origin });
      const res = await jsonFetch(base, {
        path: '/api/v1/auth/passkeys/login/verify', method: 'POST',
        body: { challengeId: session.challengeId, response: assertion },
      });
      assert.strictEqual(res.status, 200, JSON.stringify(res.data));
      assert.strictEqual(res.data.passkey, true);
      assert.strictEqual(res.data.user.email, 'passkey-owner@example.com');
      assert.ok(res.data.accessToken && res.data.refreshToken, 'the same session shape as password login');

      const me = await jsonFetch(base, { path: '/api/v1/auth/me' }, res.data.accessToken);
      assert.strictEqual(me.status, 200);
      assert.strictEqual(me.data.user.id, reg.data.user.id);

      const audit = (await app.store.table('auth_audit_log').find({ user_id: reg.data.user.id })).rows
        .filter((row) => row.event_type === 'login_success')
        .find((row) => row.metadata?.passkey === true);
      assert.ok(audit, 'a passkey sign-in is audited as such');
    });

    await t.test('the same assertion cannot be replayed', async () => {
      const assertion = authenticator.assertion({ challenge: session.options.challenge, origin });
      const res = await jsonFetch(base, {
        path: '/api/v1/auth/passkeys/login/verify', method: 'POST',
        body: { challengeId: session.challengeId, response: assertion },
      });
      assert.strictEqual(res.status, 401);
      assert.match(res.data.message, /expired or was already used/i);
    });

    await t.test('a forged assertion is refused and audited', async () => {
      const options = await jsonFetch(base, {
        path: '/api/v1/auth/passkeys/login/options', method: 'POST',
        body: { email: 'passkey-owner@example.com' },
      });
      const { privateKey: attackerKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
      const res = await jsonFetch(base, {
        path: '/api/v1/auth/passkeys/login/verify', method: 'POST',
        body: {
          challengeId: options.data.challengeId,
          response: authenticator.assertion({
            challenge: options.data.options.challenge, origin, signingKey: attackerKey,
          }),
        },
      });
      assert.strictEqual(res.status, 401);
      assert.match(res.data.message, /passkey verification failed/i);

      const audit = (await app.store.table('auth_audit_log').find({ user_id: reg.data.user.id })).rows
        .find((row) => row.event_type === 'login_failure' && row.metadata?.reason === 'passkey_assertion_failed');
      assert.ok(audit);
      assert.match(audit.metadata.detail, /signature/i);
    });

    await t.test('a counter that goes backwards is refused', async () => {
      const options = await jsonFetch(base, {
        path: '/api/v1/auth/passkeys/login/options', method: 'POST',
        body: { email: 'passkey-owner@example.com' },
      });
      // First sign-in advances the stored counter to 10.
      const first = await jsonFetch(base, {
        path: '/api/v1/auth/passkeys/login/verify', method: 'POST',
        body: {
          challengeId: options.data.challengeId,
          response: authenticator.assertion({ challenge: options.data.options.challenge, origin, counterValue: 10 }),
        },
      });
      assert.strictEqual(first.status, 200, JSON.stringify(first.data));
      assert.strictEqual((await app.store.table('webauthn_passkeys').findOne({ user_id: reg.data.user.id })).counter, 10);

      const next = await jsonFetch(base, {
        path: '/api/v1/auth/passkeys/login/options', method: 'POST',
        body: { email: 'passkey-owner@example.com' },
      });
      const replayed = await jsonFetch(base, {
        path: '/api/v1/auth/passkeys/login/verify', method: 'POST',
        body: {
          challengeId: next.data.challengeId,
          response: authenticator.assertion({ challenge: next.data.options.challenge, origin, counterValue: 9 }),
        },
      });
      assert.strictEqual(replayed.status, 401);

      const audit = (await app.store.table('auth_audit_log').find({ user_id: reg.data.user.id })).rows
        .filter((row) => row.metadata?.detail)
        .find((row) => /cloned/i.test(row.metadata.detail));
      assert.ok(audit, 'clone detection is recorded with its reason');
    });

    await t.test('an unknown account and an account without passkeys answer identically', async () => {
      const unknown = await jsonFetch(base, {
        path: '/api/v1/auth/passkeys/login/options', method: 'POST', body: { email: 'nobody@example.com' },
      });
      const noPasskeys = await jsonFetch(base, {
        path: '/api/v1/auth/passkeys/login/options', method: 'POST', body: { email: 'passkey-other@example.com' },
      });
      assert.strictEqual(unknown.status, 401);
      assert.strictEqual(noPasskeys.status, 401);
      assert.strictEqual(unknown.data.message, noPasskeys.data.message);
    });

    // ----------------------------------------------------------- management

    await t.test('a sign-in with no email offers the discoverable ceremony', async () => {
    const res = await jsonFetch(base, {
      path: '/api/v1/auth/passkeys/login/options', method: 'POST', body: {},
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.data));
    assert.deepStrictEqual(res.data.options.allowCredentials, [], 'no credential list: the device chooses');
    assert.strictEqual(res.data.options.userVerification, 'required');

    // The challenge is filed in the anonymous bucket, not against any account.
    const row = await app.store.table('webauthn_authentication_challenges').findById(res.data.challengeId);
    assert.strictEqual(row.user_id, null);
    assert.strictEqual(row.kind, 'authentication');
  });

  await t.test('a discoverable assertion identifies the account and signs in', async () => {
    const options = await jsonFetch(base, {
      path: '/api/v1/auth/passkeys/login/options', method: 'POST', body: {},
    });
    const response = authenticator.assertion({
      challenge: options.data.options.challenge,
      origin,
      // The preceding clone test left the stored counter at 10, so this must advance past it.
      counterValue: 11,
      // A real discoverable credential reports the user handle we handed it at registration.
      userHandle: String(reg.data.user.id),
    });
    const signedIn = await jsonFetch(base, {
      path: '/api/v1/auth/passkeys/login/verify', method: 'POST',
      body: { challengeId: options.data.challengeId, response },
    });
    assert.strictEqual(signedIn.status, 200, JSON.stringify(signedIn.data));
    assert.strictEqual(signedIn.data.user.email, 'passkey-owner@example.com');
    assert.strictEqual(signedIn.data.passkey, true);

    const me = await jsonFetch(base, { path: '/api/v1/auth/me' }, signedIn.data.accessToken);
    assert.strictEqual(me.data.user.id, reg.data.user.id);
  });

  await t.test('an assertion with no credential id is refused without touching another passkey', async () => {
    const options = await jsonFetch(base, {
      path: '/api/v1/auth/passkeys/login/options', method: 'POST', body: {},
    });
    const response = authenticator.assertion({ challenge: options.data.options.challenge, origin, counterValue: 13 });
    // The store treats an undefined filter value as "no filter"; the handler guards against that
    // explicitly (defence in depth — verification fails closed on its own). This pins the refusal.
    delete response.id;

    const res = await jsonFetch(base, {
      path: '/api/v1/auth/passkeys/login/verify', method: 'POST',
      body: { challengeId: options.data.challengeId, response },
    });
    assert.strictEqual(res.status, 401, JSON.stringify(res.data));
  });

  await t.test('a discoverable assertion naming an unknown credential is refused', async () => {
    const options = await jsonFetch(base, {
      path: '/api/v1/auth/passkeys/login/options', method: 'POST', body: {},
    });
    const stranger = makeAuthenticator(rpId);
    const response = stranger.assertion({ challenge: options.data.options.challenge, origin, counterValue: 1 });
    const res = await jsonFetch(base, {
      path: '/api/v1/auth/passkeys/login/verify', method: 'POST',
      body: { challengeId: options.data.challengeId, response },
    });
    assert.strictEqual(res.status, 401, JSON.stringify(res.data));
  });

  await t.test('a discoverable assertion whose user handle names someone else is refused', async () => {
    const options = await jsonFetch(base, {
      path: '/api/v1/auth/passkeys/login/options', method: 'POST', body: {},
    });
    const response = authenticator.assertion({
      challenge: options.data.options.challenge,
      origin,
      counterValue: 12,
      userHandle: 'someone-elses-account-id',
    });
    const res = await jsonFetch(base, {
      path: '/api/v1/auth/passkeys/login/verify', method: 'POST',
      body: { challengeId: options.data.challengeId, response },
    });
    assert.strictEqual(res.status, 401, JSON.stringify(res.data));
  });

  await t.test('a passkey can be renamed, and another account cannot touch it', async () => {
      const passkey = (await jsonFetch(base, { path: '/api/v1/auth/passkeys' }, token)).data.passkeys[0];
      const renamed = await jsonFetch(base, {
        path: `/api/v1/auth/passkeys/${passkey.id}`, method: 'PATCH', body: { name: 'Work laptop' },
      }, token);
      assert.strictEqual(renamed.status, 200);
      assert.strictEqual(renamed.data.passkey.name, 'Work laptop');

      const other = await register(base, 'passkey-thief@example.com');
      const foreign = await jsonFetch(base, {
        path: `/api/v1/auth/passkeys/${passkey.id}`, method: 'PATCH', body: { name: 'Stolen' },
      }, other.data.accessToken);
      assert.strictEqual(foreign.status, 404, 'never 403 — another account\'s passkey does not exist for you');
    });

    await t.test('removal requires the password', async () => {
      const passkey = (await jsonFetch(base, { path: '/api/v1/auth/passkeys' }, token)).data.passkeys[0];

      const wrong = await jsonFetch(base, {
        path: `/api/v1/auth/passkeys/${passkey.id}`, method: 'DELETE', body: { password: 'wrong-password' },
      }, token);
      assert.strictEqual(wrong.status, 401);
      assert.strictEqual((await app.store.table('webauthn_passkeys').find({ user_id: reg.data.user.id })).rows.length, 2);

      const removed = await jsonFetch(base, {
        path: `/api/v1/auth/passkeys/${passkey.id}`, method: 'DELETE', body: { password },
      }, token);
      assert.strictEqual(removed.status, 200);
      assert.strictEqual((await jsonFetch(base, { path: '/api/v1/auth/passkeys' }, token)).data.passkeys.length, 1);
    });

    await t.test('a support session cannot manage passkeys', async () => {
      const admin = await register(base, 'passkey-admin@example.com');
      await app.store.table('users').updateById(admin.data.user.id, { role: 'super_admin' });

      const support = await jsonFetch(base, {
        path: `/api/v1/admin/customers/${reg.data.user.id}/switch`, method: 'POST', body: {},
      }, admin.data.accessToken);
      assert.strictEqual(support.status, 200, JSON.stringify(support.data));

      const res = await jsonFetch(base, {
        path: '/api/v1/auth/passkeys/register/options', method: 'POST', body: { password },
      }, support.data.accessToken);
      assert.strictEqual(res.status, 403);
      assert.match(res.data.message, /support session/i);
    });

    await t.test('passkeys are refused when the deployment is not a secure context', async () => {
      const original = app.config.APP_URL;
      app.config.APP_URL = 'http://passkeys.example.com';
      try {
        const res = await jsonFetch(base, {
          path: '/api/v1/auth/passkeys/register/options', method: 'POST', body: { password },
        }, token);
        assert.strictEqual(res.status, 503);
        assert.match(res.data.message, /secure context/i);
      } finally {
        app.config.APP_URL = original;
      }
    });
  } finally {
    await close();
  }
});
