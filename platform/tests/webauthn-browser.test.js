/**
 * Tests for the browser-side WebAuthn helper (public/assets/js/webauthn.js).
 *
 * The helper performs the base64url ↔ ArrayBuffer marshalling that both frontends depend on, and
 * that is where client-side WebAuthn bugs actually live. Node has no WebAuthn stack, so this suite
 * supplies one honestly:
 *
 *   - `navigator.credentials` is replaced by a stub that returns the buffers a real authenticator
 *     would (produced by the same software authenticator the server suite uses)
 *   - the helper's output is then POSTed to a **real server** and must be accepted, which is the
 *     property that matters: the bytes the browser would send are the bytes the server verifies
 *
 * What this does not prove: that a real browser's `navigator.credentials` marshals the same way.
 * No browser was driven (that limitation is recorded in the module report, not glossed over).
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

const { startServer, jsonFetch, register } = require('./helpers');
const { hashPassword } = require('../src/lib/password');

const HELPER_PATH = path.join(__dirname, '../public/assets/js/webauthn.js');

/**
 * Imports the ESM helper from this CommonJS test.
 *
 * A plain `import()` cannot be used: this package is CommonJS, so Node would treat the .js file as
 * CJS and choke on `export`. The data: URL runs the file's exact source as an ES module, with no
 * temp copy that could drift from the real file.
 */
async function loadHelper() {
  const source = require('node:fs').readFileSync(HELPER_PATH, 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest();
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };

/** The same minimal ES256 authenticator the server suite uses, exposed as buffer-level primitives. */
function makeAuthenticator(rpId) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const credentialId = crypto.randomBytes(16);

  // COSE key, hand-built (the server-side encoder lives in the server suite).
  const head = (major, value) => (value < 24
    ? Buffer.from([(major << 5) | value])
    : Buffer.from([(major << 5) | 24, value]));
  const cose = Buffer.concat([
    Buffer.from([0xa5]),
    head(0, 1), head(0, 2),          // 1: 2   (kty: EC2)
    head(0, 3), Buffer.from([0x26]), // 3: -7  (alg: ES256)
    Buffer.from([0x20]), head(0, 1), // -1: 1  (crv: P-256)
    Buffer.from([0x21]), Buffer.concat([head(2, 32), Buffer.from(jwk.x, 'base64url')]),
    Buffer.from([0x22]), Buffer.concat([head(2, 32), Buffer.from(jwk.y, 'base64url')]),
  ]);

  return {
    credentialId,
    cose,
    registration(clientDataJSON) {
      const authData = Buffer.concat([
        sha256(rpId), Buffer.from([0x45]), u32(0), Buffer.alloc(16), u16(credentialId.length), credentialId, cose,
      ]);
      // attestationObject = {fmt: "none", attStmt: {}, authData}
      const attestationObject = Buffer.concat([
        Buffer.from([0xa3]),
        Buffer.from([0x63]), Buffer.from('fmt'), Buffer.from([0x64]), Buffer.from('none'),
        Buffer.from([0x67]), Buffer.from('attStmt'), Buffer.from([0xa0]),
        Buffer.from([0x68]), Buffer.from('authData'),
        Buffer.concat([Buffer.from([0x58, authData.length]), authData]),
      ]);
      return { clientDataJSON, attestationObject };
    },
    assertion(clientDataJSON, counter) {
      const authData = Buffer.concat([sha256(rpId), Buffer.from([0x05]), u32(counter)]);
      const signature = crypto.sign('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), privateKey);
      return { clientDataJSON, authenticatorData: authData, signature };
    },
  };
}

/**
 * Runs `fn` with the two globals the helper feature-detects — `navigator.credentials` and
 * `window.PublicKeyCredential` — replaced by stubs the test controls. Both are restored afterwards.
 */
function withFakeBrowser({ create, get }, fn) {
  const originals = new Map();
  const install = (key, value) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  install('navigator', { credentials: { create, get } });
  install('window', { PublicKeyCredential: function PublicKeyCredential() {} });
  try {
    return fn();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

function jsonToBuffer(value) {
  return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
}

test('unit: the browser helper marshals base64url correctly', async (t) => {
  const { base64urlToBuffer, bufferToBase64url, isPasskeySupported } = await loadHelper();

  await t.test('round-trips every byte value, including the URL-unsafe ones', () => {
    const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    const encoded = bufferToBase64url(bytes);
    assert.match(encoded, /^[A-Za-z0-9_-]+$/, 'no padding, no + or /');
    assert.deepStrictEqual(Buffer.from(base64urlToBuffer(encoded)), bytes);
  });

  await t.test('round-trips typed-array views', () => {
    const underlying = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepStrictEqual(Buffer.from(base64urlToBuffer(bufferToBase64url(underlying.subarray(2, 6)))), Buffer.from([3, 4, 5, 6]));
  });

  await t.test('refuses padding, standard base64 and empty input', () => {
    assert.throws(() => base64urlToBuffer('abcd='), /base64url/);
    assert.throws(() => base64urlToBuffer('ab+cd'), /base64url/);
    assert.throws(() => base64urlToBuffer(''), /base64url/);
    assert.throws(() => base64urlToBuffer(null), /base64url/);
  });

  await t.test('reports an unsupported environment instead of pretending', () => {
    assert.strictEqual(isPasskeySupported(), false, 'Node has no WebAuthn');
  });

  await t.test('a ceremony in an unsupported environment fails with a clear message', async () => {
    const { createPasskey, getAssertion } = await loadHelper();
    await assert.rejects(() => createPasskey({ challenge: 'abc', user: { id: 'abc' } }), /does not support passkeys/);
    await assert.rejects(() => getAssertion({ challenge: 'abc' }), /does not support passkeys/);
  });
});

test('integration: the helper drives a real registration and sign-in against the real server', async (t) => {
  const { base, app, close } = await startServer({});
  try {
    app.config.APP_URL = base;
    const rpId = '127.0.0.1';

    const password = 'browser-helper-password-01';
    const registration = await register(base, 'browser-helper@example.com');
    const token = registration.data.accessToken;
    await app.store.table('users').updateById(registration.data.user.id, { password_hash: await hashPassword(password) });

    const authenticator = makeAuthenticator(rpId);
    const { createPasskey, getAssertion } = await loadHelper();

    await t.test('createPasskey decodes the options and encodes a response the server accepts', async () => {
      const options = await jsonFetch(base, {
        path: '/api/v1/auth/passkeys/register/options', method: 'POST', body: { password },
      }, token);
      assert.strictEqual(options.status, 200, JSON.stringify(options.data));

      let seenPublicKey = null;
      const credential = await withFakeBrowser({
        create: async ({ publicKey }) => {
          seenPublicKey = publicKey;
          const clientDataJSON = jsonToBuffer({
            type: 'webauthn.create',
            challenge: Buffer.from(publicKey.challenge).toString('base64url'),
            origin: base,
            crossOrigin: false,
          });
          const { attestationObject } = authenticator.registration(clientDataJSON);
          return {
            id: Buffer.from(authenticator.credentialId).toString('base64url'),
            rawId: authenticator.credentialId.buffer.slice(
              authenticator.credentialId.byteOffset,
              authenticator.credentialId.byteOffset + authenticator.credentialId.byteLength,
            ),
            type: 'public-key',
            response: {
              clientDataJSON: clientDataJSON.buffer.slice(clientDataJSON.byteOffset, clientDataJSON.byteOffset + clientDataJSON.byteLength),
              attestationObject: attestationObject.buffer.slice(attestationObject.byteOffset, attestationObject.byteOffset + attestationObject.byteLength),
              getTransports: () => ['internal'],
            },
            getClientExtensionResults: () => ({}),
          };
        },
        get: async () => { throw new Error('not used'); },
      }, () => createPasskey(options.data.options));

      // The helper handed the browser real bytes, not base64 strings.
      assert.ok(seenPublicKey.challenge instanceof ArrayBuffer);
      assert.ok(seenPublicKey.user.id instanceof ArrayBuffer);
      assert.deepStrictEqual(Buffer.from(seenPublicKey.challenge), Buffer.from(options.data.options.challenge, 'base64url'));
      assert.deepStrictEqual(Buffer.from(seenPublicKey.user.id), Buffer.from(registration.data.user.id, 'utf8'));

      // …and produced JSON the server accepts.
      assert.match(credential.rawId, /^[A-Za-z0-9_-]+$/);
      assert.deepStrictEqual(credential.response.transports, ['internal']);

      const verified = await jsonFetch(base, {
        path: '/api/v1/auth/passkeys/register/verify', method: 'POST',
        body: { challengeId: options.data.challengeId, response: credential, name: 'Browser test' },
      }, token);
      assert.strictEqual(verified.status, 201, JSON.stringify(verified.data));
      assert.strictEqual(verified.data.passkey.credentialId, credential.rawId);
    });

    await t.test('getAssertion decodes the options and its response signs the user in', async () => {
      const options = await jsonFetch(base, {
        path: '/api/v1/auth/passkeys/login/options', method: 'POST',
        body: { email: 'browser-helper@example.com' },
      });
      assert.strictEqual(options.status, 200, JSON.stringify(options.data));

      let seenAllowCredentials = null;
      const assertion = await withFakeBrowser({
        create: async () => { throw new Error('not used'); },
        get: async ({ publicKey }) => {
          seenAllowCredentials = publicKey.allowCredentials;
          const clientDataJSON = jsonToBuffer({
            type: 'webauthn.get',
            challenge: Buffer.from(publicKey.challenge).toString('base64url'),
            origin: base,
            crossOrigin: false,
          });
          const { authenticatorData, signature } = authenticator.assertion(clientDataJSON, 3);
          const view = (buffer) => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
          return {
            id: Buffer.from(authenticator.credentialId).toString('base64url'),
            rawId: view(authenticator.credentialId),
            type: 'public-key',
            response: {
              clientDataJSON: view(clientDataJSON),
              authenticatorData: view(authenticatorData),
              signature: view(signature),
              userHandle: null, // discoverable credential: must stay null
            },
            getClientExtensionResults: () => ({}),
          };
        },
      }, () => getAssertion(options.data.options));

      assert.strictEqual(seenAllowCredentials.length, 1);
      assert.ok(seenAllowCredentials[0].id instanceof ArrayBuffer);
      assert.strictEqual(assertion.response.userHandle, null, 'a null userHandle stays null');

      const signedIn = await jsonFetch(base, {
        path: '/api/v1/auth/passkeys/login/verify', method: 'POST',
        body: { challengeId: options.data.challengeId, response: assertion },
      });
      assert.strictEqual(signedIn.status, 200, JSON.stringify(signedIn.data));
      assert.ok(signedIn.data.accessToken, 'the browser flow yields a session');

      const me = await jsonFetch(base, { path: '/api/v1/auth/me' }, signedIn.data.accessToken);
      assert.strictEqual(me.data.user.email, 'browser-helper@example.com');

      // The counter the helper's assertion carried is now stored.
      const stored = await app.store.table('webauthn_passkeys').findOne({ user_id: registration.data.user.id });
      assert.strictEqual(stored.counter, 3);
      assert.ok(stored.last_used_at, 'last use is stamped');
    });

    await t.test('a discoverable sign-in carries the account handle through the helper', async () => {
      // No email: the server offers an empty allowCredentials list and the authenticator chooses.
      const options = await jsonFetch(base, {
        path: '/api/v1/auth/passkeys/login/options', method: 'POST', body: {},
      });
      assert.deepStrictEqual(options.data.options.allowCredentials, []);

      let seenHandle = null;
      const assertion = await withFakeBrowser({
        create: async () => { throw new Error('not used'); },
        get: async ({ publicKey }) => {
          const clientDataJSON = jsonToBuffer({
            type: 'webauthn.get',
            challenge: Buffer.from(publicKey.challenge).toString('base64url'),
            origin: base,
            crossOrigin: false,
          });
          const { authenticatorData, signature } = authenticator.assertion(clientDataJSON, 4);
          const view = (buffer) => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
          // A real discoverable credential returns the handle the RP set at registration.
          const handle = Buffer.from(String(registration.data.user.id), 'utf8');
          seenHandle = handle;
          return {
            id: Buffer.from(authenticator.credentialId).toString('base64url'),
            rawId: view(authenticator.credentialId),
            type: 'public-key',
            response: {
              clientDataJSON: view(clientDataJSON),
              authenticatorData: view(authenticatorData),
              signature: view(signature),
              userHandle: view(handle),
            },
            getClientExtensionResults: () => ({}),
          };
        },
      }, () => getAssertion(options.data.options));

      assert.strictEqual(
        Buffer.from(assertion.response.userHandle, 'base64url').toString('utf8'),
        String(registration.data.user.id),
        'the helper re-encodes the handle without padding',
      );
      assert.match(assertion.response.userHandle, /^[A-Za-z0-9_-]+$/);

      const signedIn = await jsonFetch(base, {
        path: '/api/v1/auth/passkeys/login/verify', method: 'POST',
        body: { challengeId: options.data.challengeId, response: assertion },
      });
      assert.strictEqual(signedIn.status, 200, JSON.stringify(signedIn.data));
      assert.ok(seenHandle, 'the browser really was asked for a handle');
    });
  } finally {
    await close();
  }
});
