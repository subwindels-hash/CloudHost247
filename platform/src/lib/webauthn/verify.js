/**
 * WebAuthn ceremony verification (registration + assertion).
 *
 * This is the module that decides whether a client's `navigator.credentials` response proves control
 * of a credential. Every check below exists because skipping it is a known attack:
 *
 *   - **clientDataJSON.type** — a registration response replayed as an assertion (or vice versa)
 *   - **challenge** — replayed ceremonies; compared in constant time, and consumed exactly once by
 *     the caller, so a captured response cannot be presented twice
 *   - **origin** — a phishing site completing a ceremony against this RP; matched exactly against
 *     the configured origins, never against the request's Host header (which the attacker controls)
 *   - **crossOrigin** — an origin that performed the ceremony on behalf of another origin
 *   - **rpIdHash** — a credential scoped to a different relying party id
 *   - **UP** — user presence; **UV** — user verification, required because this deployment asks for
 *     it and because UV is what makes a passkey a genuine second factor
 *   - **AT / credential id binding** — the credential the authenticator attested must be the one
 *     the client claims in `rawId`
 *   - **signature** — over `authenticatorData || SHA-256(clientDataJSON)`, verified with the COSE
 *     public key stored at registration
 *   - **signCount** — a counter that does not advance can mean a cloned authenticator. Zero counters
 *     are the documented exception (many synced passkeys always report 0) and are exempt.
 *
 * Attestation is deliberately limited to `fmt: "none"`, which is what the options request. Any other
 * format is refused rather than stored unverified — accepting an attestation statement this build
 * cannot validate would be claiming a trust decision nobody made.
 */
'use strict';

const crypto = require('node:crypto');

const { decodeAll, CborError } = require('./cbor');
const { parseCosePublicKey, CoseKeyError } = require('./cose');
const { parseAuthenticatorData, AuthenticatorDataError } = require('./authenticator-data');

const CLIENT_DATA_TYPE = {
  create: 'webauthn.create',
  get: 'webauthn.get',
};

/** Fixed-length constant-time string comparison (used for challenges). */
function timingSafeEqualString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length === 0 || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest();
}

function normalizeOrigin(origin) {
  return String(origin ?? '').trim().replace(/\/+$/, '');
}

/** Checks the collected client data. Returns `{ ok, clientData, reason }`. */
function verifyClientData(clientDataBytes, { type, expectedChallenge, origins }) {
  let clientData;
  try {
    clientData = JSON.parse(clientDataBytes.toString('utf8'));
  } catch {
    return { ok: false, reason: 'clientDataJSON is not valid JSON' };
  }
  if (clientData === null || typeof clientData !== 'object') {
    return { ok: false, reason: 'clientDataJSON is not an object' };
  }
  if (clientData.type !== type) {
    return { ok: false, reason: `clientDataJSON type "${clientData.type}" does not match the expected "${type}"` };
  }
  if (clientData.crossOrigin === true) {
    return { ok: false, reason: 'cross-origin ceremonies are refused' };
  }
  if (!timingSafeEqualString(clientData.challenge, expectedChallenge)) {
    return { ok: false, reason: 'challenge does not match the ceremony this server issued' };
  }
  const origin = normalizeOrigin(clientData.origin);
  const allowed = (origins ?? []).map(normalizeOrigin);
  if (!origin || !allowed.includes(origin)) {
    return { ok: false, reason: `origin "${clientData.origin}" is not an allowed relying-party origin` };
  }
  return { ok: true, clientData, origin };
}

function decodeBase64Url(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    return { ok: false, reason: `${field} is missing` };
  }
  const buffer = Buffer.from(value, 'base64url');
  // Node silently ignores invalid base64url characters; require a faithful round-trip so a
  // corrupted field is a refusal rather than a shorter buffer treated as valid.
  if (buffer.length === 0 || buffer.toString('base64url') !== value) {
    return { ok: false, reason: `${field} is not valid base64url` };
  }
  return { ok: true, buffer };
}

/**
 * Verifies a registration (`navigator.credentials.create`) response.
 *
 * @returns {{verified: boolean, reason?: string, registration?: object}}
 */
function verifyRegistration({ response, expectedChallenge, rpId, origins, requireUserVerification = true }) {
  if (!response || typeof response !== 'object') return { verified: false, reason: 'registration response is missing' };
  if (typeof response.id !== 'string' || typeof response.rawId !== 'string') {
    return { verified: false, reason: 'registration response is missing the credential id' };
  }
  if (response.id !== response.rawId) {
    return { verified: false, reason: 'credential id and rawId disagree' };
  }
  const rawId = decodeBase64Url(response.rawId, 'rawId');
  if (!rawId.ok) return { verified: false, reason: rawId.reason };

  const body = response.response;
  if (!body || typeof body !== 'object') return { verified: false, reason: 'registration response has no attestation payload' };

  const clientDataBytes = decodeBase64Url(body.clientDataJSON, 'clientDataJSON');
  if (!clientDataBytes.ok) return { verified: false, reason: clientDataBytes.reason };
  const attestationBytes = decodeBase64Url(body.attestationObject, 'attestationObject');
  if (!attestationBytes.ok) return { verified: false, reason: attestationBytes.reason };

  const clientData = verifyClientData(clientDataBytes.buffer, {
    type: CLIENT_DATA_TYPE.create, expectedChallenge, origins,
  });
  if (!clientData.ok) return { verified: false, reason: clientData.reason };

  let attestationObject;
  try {
    attestationObject = decodeAll(attestationBytes.buffer);
  } catch (err) {
    if (err instanceof CborError) return { verified: false, reason: `attestationObject is not valid CBOR: ${err.message}` };
    throw err;
  }
  if (!(attestationObject instanceof Map)) return { verified: false, reason: 'attestationObject is not a CBOR map' };

  const fmt = attestationObject.get('fmt');
  const authDataBytes = attestationObject.get('authData');
  const attStmt = attestationObject.get('attStmt');

  if (fmt !== 'none') {
    return {
      verified: false,
      reason: `attestation format "${fmt}" is not accepted: this deployment requests attestation "none" and will not store an attestation statement it cannot validate`,
    };
  }
  if (!(attStmt instanceof Map)) return { verified: false, reason: 'attestationObject has no attStmt map' };
  if (!Buffer.isBuffer(authDataBytes)) return { verified: false, reason: 'attestationObject has no authData' };

  let authenticatorData;
  try {
    authenticatorData = parseAuthenticatorData(authDataBytes);
  } catch (err) {
    if (err instanceof AuthenticatorDataError) return { verified: false, reason: err.message };
    throw err;
  }

  if (!timingSafeEqualString(authenticatorData.rpIdHash.toString('hex'), sha256(rpId).toString('hex'))) {
    return { verified: false, reason: `rpIdHash does not match relying party id "${rpId}"` };
  }
  if (!authenticatorData.flags.up) return { verified: false, reason: 'user presence flag is not set' };
  if (requireUserVerification && !authenticatorData.flags.uv) {
    return { verified: false, reason: 'user verification is required but the authenticator did not perform it' };
  }
  if (!authenticatorData.flags.at || !authenticatorData.cosePublicKeyBytes) {
    return { verified: false, reason: 'authData carries no attested credential data' };
  }
  if (authenticatorData.trailingBytes !== 0) {
    return { verified: false, reason: `authData has ${authenticatorData.trailingBytes} trailing bytes` };
  }
  if (authenticatorData.credentialId.toString('base64url') !== response.rawId) {
    return { verified: false, reason: 'attested credential id does not match the response rawId' };
  }

  let cose;
  try {
    cose = parseCosePublicKey(authenticatorData.cosePublicKeyBytes);
  } catch (err) {
    if (err instanceof CoseKeyError) return { verified: false, reason: err.message };
    throw err;
  }

  return {
    verified: true,
    registration: {
      credentialId: response.rawId,
      publicKeyCose: authenticatorData.cosePublicKeyBytes,
      algorithm: cose.algorithm,
      counter: authenticatorData.signCount,
      aaguid: authenticatorData.aaguid,
      transports: Array.isArray(body.transports) ? body.transports.filter((t) => typeof t === 'string') : [],
      deviceType: authenticatorData.flags.be ? 'multiDevice' : 'singleDevice',
      backedUp: authenticatorData.flags.bs,
      origin: clientData.origin,
    },
  };
}

/**
 * Verifies an assertion (`navigator.credentials.get`) response against the credential stored at
 * registration.
 *
 * @returns {{verified: boolean, reason?: string, newCounter?: number, flags?: object}}
 */
function verifyAssertion({
  response, expectedChallenge, rpId, origins, storedCredential, requireUserVerification = true,
}) {
  if (!response || typeof response !== 'object') return { verified: false, reason: 'assertion response is missing' };
  if (typeof response.id !== 'string' || typeof response.rawId !== 'string') {
    return { verified: false, reason: 'assertion response is missing the credential id' };
  }
  if (!storedCredential) return { verified: false, reason: 'no stored credential to verify against' };

  const body = response.response;
  if (!body || typeof body !== 'object') return { verified: false, reason: 'assertion response has no authenticator payload' };

  if (!timingSafeEqualString(response.id, storedCredential.credential_id)) {
    return { verified: false, reason: 'assertion credential id does not match the stored passkey' };
  }

  const clientDataBytes = decodeBase64Url(body.clientDataJSON, 'clientDataJSON');
  if (!clientDataBytes.ok) return { verified: false, reason: clientDataBytes.reason };
  const authDataBytes = decodeBase64Url(body.authenticatorData, 'authenticatorData');
  if (!authDataBytes.ok) return { verified: false, reason: authDataBytes.reason };
  const signature = decodeBase64Url(body.signature, 'signature');
  if (!signature.ok) return { verified: false, reason: signature.reason };

  const clientData = verifyClientData(clientDataBytes.buffer, {
    type: CLIENT_DATA_TYPE.get, expectedChallenge, origins,
  });
  if (!clientData.ok) return { verified: false, reason: clientData.reason };

  let authenticatorData;
  try {
    authenticatorData = parseAuthenticatorData(authDataBytes.buffer);
  } catch (err) {
    if (err instanceof AuthenticatorDataError) return { verified: false, reason: err.message };
    throw err;
  }

  if (authenticatorData.flags.at) {
    return { verified: false, reason: 'assertion authData must not carry attested credential data' };
  }
  if (authenticatorData.trailingBytes !== 0) {
    return { verified: false, reason: `assertion authData has ${authenticatorData.trailingBytes} trailing bytes` };
  }
  if (!timingSafeEqualString(authenticatorData.rpIdHash.toString('hex'), sha256(rpId).toString('hex'))) {
    return { verified: false, reason: `rpIdHash does not match relying party id "${rpId}"` };
  }
  if (!authenticatorData.flags.up) return { verified: false, reason: 'user presence flag is not set' };
  if (requireUserVerification && !authenticatorData.flags.uv) {
    return { verified: false, reason: 'user verification is required but the authenticator did not perform it' };
  }

  let cose;
  try {
    cose = parseCosePublicKey(Buffer.from(storedCredential.public_key, 'base64url'));
  } catch (err) {
    if (err instanceof CoseKeyError) return { verified: false, reason: `stored passkey is unusable: ${err.message}` };
    throw err;
  }

  // What the authenticator signed: authenticatorData followed by SHA-256(clientDataJSON).
  const signedData = Buffer.concat([authDataBytes.buffer, sha256(clientDataBytes.buffer)]);
  let signatureValid = false;
  try {
    signatureValid = cose.verify(signedData, signature.buffer);
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) return { verified: false, reason: 'assertion signature does not verify against the stored passkey' };

  // Clone detection: both counters must be non-zero for the comparison to mean anything, because
  // many synced passkeys report 0 forever.
  const previousCounter = Number(storedCredential.counter ?? 0);
  const newCounter = authenticatorData.signCount;
  if (previousCounter !== 0 && newCounter !== 0 && newCounter <= previousCounter) {
    return {
      verified: false,
      reason: `signature counter did not advance (${previousCounter} -> ${newCounter}); the authenticator may be cloned`,
    };
  }

  return { verified: true, newCounter, flags: authenticatorData.flags };
}

module.exports = { verifyRegistration, verifyAssertion, verifyClientData, timingSafeEqualString };
