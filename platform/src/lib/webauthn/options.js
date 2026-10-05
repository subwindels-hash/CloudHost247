/**
 * Relying-party configuration and the two ceremony option builders.
 *
 * `relyingParty()` derives the rpID and the exact set of accepted origins from the deployment's own
 * URL — never from the incoming request. Accepting the `Host`/`Origin` header the client sent would
 * let an attacker complete a ceremony on their own origin and have this server believe it happened
 * on ours.
 *
 * Passkeys additionally require a secure context: HTTPS, or the loopback exceptions browsers also
 * grant (`localhost`, `127.0.0.1`, `::1`). A deployment reached over plain HTTP on a real hostname
 * cannot run WebAuthn at all, so the API says exactly that instead of issuing options no browser
 * will accept.
 */
'use strict';

const crypto = require('node:crypto');
const { ServiceUnavailableError } = require('../../core/errors');

const CHALLENGE_BYTES = 32;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const CEREMONY_TIMEOUT_MS = 60 * 1000;

/** Hosts browsers treat as secure contexts over plain HTTP (RFC 6761 loopback names). */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Public-key algorithms offered, in the order an authenticator should prefer them. */
const PUB_KEY_CRED_PARAMS = [
  { type: 'public-key', alg: -7 },   // ES256 — the WebAuthn default
  { type: 'public-key', alg: -257 }, // RS256
  { type: 'public-key', alg: -8 },   // EdDSA
];

function relyingParty(config) {
  let url;
  try {
    url = new URL(config.APP_URL);
  } catch {
    throw new ServiceUnavailableError('APP_URL is not a valid URL, so passkeys cannot be configured');
  }

  const https = url.protocol === 'https:';
  if (!https && !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new ServiceUnavailableError(
      `Passkeys require a secure context: APP_URL must be https:// (or a loopback host for development), but it is ${url.origin}`,
    );
  }

  const extra = String(config.WEBAUTHN_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    rpId: url.hostname,
    rpName: config.WEBAUTHN_RP_NAME ?? 'CloudHost247',
    // The deployment's own origin first, then any origin an operator explicitly declared (for
    // example www + apex, or an SPA served from a sibling host).
    origins: [...new Set([url.origin, ...extra])],
  };
}

function newChallenge() {
  return crypto.randomBytes(CHALLENGE_BYTES).toString('base64url');
}

/** `navigator.credentials.create()` options. */
function buildRegistrationOptions({ rpId, rpName, user, challenge, excludeCredentials = [] }) {
  return {
    challenge,
    rp: { id: rpId, name: rpName },
    user: {
      // The user handle is opaque and must not be an email address (WebAuthn §5.4.3).
      id: Buffer.from(String(user.id), 'utf8').toString('base64url'),
      name: user.email,
      displayName: user.full_name ?? user.email,
    },
    pubKeyCredParams: PUB_KEY_CRED_PARAMS,
    timeout: CEREMONY_TIMEOUT_MS,
    attestation: 'none',
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'required',
    },
    excludeCredentials: excludeCredentials.map((credential) => ({
      type: 'public-key',
      id: credential.credential_id,
      transports: credential.transports ?? [],
    })),
  };
}

/** `navigator.credentials.get()` options. */
function buildAuthenticationOptions({ rpId, challenge, allowCredentials = [] }) {
  return {
    challenge,
    rpId,
    timeout: CEREMONY_TIMEOUT_MS,
    userVerification: 'required',
    allowCredentials: allowCredentials.map((credential) => ({
      type: 'public-key',
      id: credential.credential_id,
      transports: credential.transports ?? [],
    })),
  };
}

module.exports = {
  relyingParty,
  newChallenge,
  buildRegistrationOptions,
  buildAuthenticationOptions,
  CHALLENGE_TTL_MS,
  CEREMONY_TIMEOUT_MS,
  LOOPBACK_HOSTS,
};
