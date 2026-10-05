/**
 * Browser-side WebAuthn helper — dependency-free, shared by the public site and the React SPA.
 *
 * The browser's `navigator.credentials` API speaks `ArrayBuffer`s while JSON (and therefore the
 * API) speaks base64url. Everything this module does is bridge those two worlds correctly, because
 * that is where client-side WebAuthn bugs live: a challenge decoded with the wrong padding, a
 * credential id re-encoded as standard base64, or a `userHandle` that is `null` for a discoverable
 * credential and must stay `null` rather than becoming the string "null".
 *
 * It deliberately does not talk to the API itself — each frontend posts through its own API client
 * (`public/assets/js/api.js`, `spa/src/lib/api.js`) so session handling stays in one place.
 *
 * There is no top-level browser access, so the module can be imported and unit-tested in Node with
 * a stubbed `navigator` (see tests/webauthn-browser.test.js).
 */

/** base64url → ArrayBuffer. Throws on anything that is not valid base64url. */
export function base64urlToBuffer(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Expected a base64url string');
  }
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('Expected a base64url string (no padding, no + or /)');
  }
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  let binary;
  try {
    binary = atob(padded);
  } catch {
    throw new Error('Expected a base64url string');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** ArrayBuffer/TypedArray → unpadded base64url. */
export function bufferToBase64url(buffer) {
  if (buffer === null || buffer === undefined) return null;
  const bytes = buffer instanceof ArrayBuffer
    ? new Uint8Array(buffer)
    : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** True when this browser can run a WebAuthn ceremony at all. */
export function isPasskeySupported() {
  return typeof navigator !== 'undefined'
    && typeof navigator.credentials?.create === 'function'
    && typeof navigator.credentials?.get === 'function'
    && typeof window !== 'undefined'
    && Boolean(window.PublicKeyCredential);
}

function assertSupported() {
  if (!isPasskeySupported()) {
    throw new Error('This browser or device does not support passkeys');
  }
}

/**
 * Runs `navigator.credentials.create()` and returns the JSON response the server expects.
 * @param {object} options `options` from POST /auth/passkeys/register/options
 */
export async function createPasskey(options) {
  assertSupported();
  if (!options?.challenge || !options?.user?.id) throw new Error('Registration options are incomplete');

  const publicKey = {
    ...options,
    challenge: base64urlToBuffer(options.challenge),
    user: { ...options.user, id: base64urlToBuffer(options.user.id) },
    excludeCredentials: (options.excludeCredentials ?? []).map((credential) => ({
      ...credential,
      id: base64urlToBuffer(credential.id),
    })),
  };

  // A cancelled or timed-out ceremony rejects (NotAllowedError) — let it propagate so the UI can
  // show "you cancelled" rather than inventing a credential.
  const credential = await navigator.credentials.create({ publicKey });

  return {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToBase64url(credential.response.clientDataJSON),
      attestationObject: bufferToBase64url(credential.response.attestationObject),
      transports: typeof credential.response.getTransports === 'function'
        ? credential.response.getTransports()
        : [],
    },
    clientExtensionResults: typeof credential.getClientExtensionResults === 'function'
      ? credential.getClientExtensionResults()
      : {},
  };
}

/**
 * Runs `navigator.credentials.get()` and returns the JSON response the server expects.
 * @param {object} options `options` from POST /auth/passkeys/login/options
 */
export async function getAssertion(options) {
  assertSupported();
  if (!options?.challenge) throw new Error('Sign-in options are incomplete');

  const publicKey = {
    ...options,
    challenge: base64urlToBuffer(options.challenge),
    allowCredentials: (options.allowCredentials ?? []).map((credential) => ({
      ...credential,
      id: base64urlToBuffer(credential.id),
    })),
  };

  const credential = await navigator.credentials.get({ publicKey });

  return {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToBase64url(credential.response.clientDataJSON),
      authenticatorData: bufferToBase64url(credential.response.authenticatorData),
      signature: bufferToBase64url(credential.response.signature),
      // null for a discoverable credential — must stay null, not become "null".
      userHandle: credential.response.userHandle
        ? bufferToBase64url(credential.response.userHandle)
        : null,
    },
    clientExtensionResults: typeof credential.getClientExtensionResults === 'function'
      ? credential.getClientExtensionResults()
      : {},
  };
}
