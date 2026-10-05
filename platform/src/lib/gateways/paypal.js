/**
 * PayPal webhook gateway (signature verification + canonical event parsing).
 *
 * Ported from cloudhost247-node/src/payments/paypal-gateway.ts. PayPal does not sign with a shared
 * secret: it sends a detached RSA-SHA256 signature over the verification string
 *
 *     <transmission-id>|<transmission-time>|<webhook-id>|<decimal crc32 of the raw body>
 *
 * and points at the certificate that signed it via `paypal-cert-url`. That URL is the dangerous
 * part: it is attacker-controlled in a forged request, so fetching it naively would be a server-side
 * request forgery (SSRF) primitive pointed straight at the hosting platform's metadata service.
 * Everything below exists to make that fetch safe:
 *
 *   - https only, no userinfo, default port only, no query/fragment, known certificate path
 *   - hostname must be on the explicit PayPal allowlist (no wildcards — a wildcard would accept any
 *     paypal.com subdomain, and subdomain takeover would then be enough to forge settlements)
 *   - DNS is resolved first and **every** A/AAAA record must be public (blocks DNS-rebinding and
 *     169.254.169.254 / RFC1918 / loopback / CGNAT / multicast targets)
 *   - redirects are disabled, no credentials or cookies are sent, the response must look like a PEM
 *   - certificates are cached in memory (max 10, 24h) so a burst of deliveries is not a fetch storm
 *
 * Settlement rule: only PAYMENT.CAPTURE.COMPLETED is a completed capture. CHECKOUT.ORDER.APPROVED
 * means the buyer approved the order but funds are not captured yet, so it is deliberately reported
 * as pending/unhandled — treating an approval as money received is how a platform ships goods for
 * free.
 */
'use strict';

const { createVerify } = require('node:crypto');
const dns = require('node:dns/promises');

const { computeCrc32 } = require('../crc32');
const { headerValue } = require('../webhook-signing');

const id = 'paypal';
const label = 'PayPal';
const configKey = 'PAYPAL_WEBHOOK_ID';
const MAX_SKEW_MS = 600 * 1000;
const CERT_TTL_MS = 24 * 60 * 60 * 1000;
const CERT_CACHE_MAX = 10;

/**
 * Explicit PayPal certificate host allowlist. Wildcards are prohibited on purpose: a wildcard entry
 * would let any paypal.com subdomain (or a hijacked one) sign webhooks this platform then trusts.
 */
const ALLOWED_CERT_HOSTS = new Set([
  'api.paypal.com',
  'api.sandbox.paypal.com',
  'api-m.paypal.com',
  'api-m.sandbox.paypal.com',
]);

const certCache = new Map();

/** Test seam: replaces the network certificate fetch. Production always uses the real one. */
let certResolver = null;

function setPayPalCertResolver(fn) {
  certResolver = typeof fn === 'function' ? fn : null;
}

function clearPayPalCertCache() {
  certCache.clear();
}

/** True for loopback, RFC1918, link-local (incl. cloud metadata), CGNAT, multicast and reserved. */
function isPrivateOrReservedIp(ip) {
  if (!ip) return true;

  // IPv4-mapped IPv6, e.g. ::ffff:127.0.0.1
  if (ip.startsWith('::ffff:')) {
    const v4 = ip.slice(7);
    if (v4.includes('.')) return isPrivateOrReservedIp(v4);
  }

  if (ip.includes('.')) {
    const parts = ip.split('.').map((p) => Number.parseInt(p, 10));
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true;
    const [a, b] = parts;
    if (a === 0) return true;                                   // 0.0.0.0/8
    if (a === 10) return true;                                  // RFC1918
    if (a === 127) return true;                                 // loopback
    if (a === 169 && b === 254) return true;                    // link-local / 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true;           // RFC1918
    if (a === 192 && b === 168) return true;                    // RFC1918
    if (a === 100 && b >= 64 && b <= 127) return true;          // CGNAT
    if (a >= 224) return true;                                  // multicast / reserved
    return false;
  }

  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (/^fe[89ab]/.test(lower)) return true;                     // fe80::/10
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7
  if (lower.startsWith('ff')) return true;                      // ff00::/8
  return false;
}

/**
 * Validates a PayPal `cert_url` and returns its PEM, or null when anything about it is not
 * provably safe. Never throws: a failure to prove safety is a refusal, not an error.
 */
async function validateAndFetchPayPalCert(certUrl) {
  let parsed;
  try {
    parsed = new URL(certUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.port !== '' && parsed.port !== '443') return null;

  const hostname = parsed.hostname.toLowerCase();
  if (!ALLOWED_CERT_HOSTS.has(hostname)) return null;

  if (parsed.search || parsed.hash) return null;
  if (!parsed.pathname.startsWith('/v1/notifications/certs/') && !parsed.pathname.startsWith('/certs/')) {
    return null;
  }

  const cached = certCache.get(certUrl);
  if (cached && cached.expiresAt > Date.now()) return cached.pem;

  // DNS pre-resolution: every resolved record must be public, which is what blocks a hostname that
  // passes the allowlist check but resolves to an internal address.
  try {
    const records = await dns.lookup(hostname, { all: true });
    if (!records || records.length === 0) return null;
    for (const record of records) {
      if (isPrivateOrReservedIp(record.address)) return null;
    }
  } catch {
    return null;
  }

  try {
    const res = await fetch(certUrl, {
      method: 'GET',
      redirect: 'error',
      headers: { Accept: 'application/x-pem-file, text/plain' },
    });
    if (!res.ok) return null;

    const pem = await res.text();
    if (!pem.includes('-----BEGIN CERTIFICATE-----') && !pem.includes('-----BEGIN PUBLIC KEY-----')) {
      return null;
    }

    if (certCache.size >= CERT_CACHE_MAX) {
      const oldest = certCache.keys().next().value;
      if (oldest) certCache.delete(oldest);
    }
    certCache.set(certUrl, { pem, expiresAt: Date.now() + CERT_TTL_MS });
    return pem;
  } catch {
    return null;
  }
}

function isConfigured(config) {
  return Boolean(config?.[configKey]);
}

async function verify(rawBody, headers, config) {
  const webhookId = config?.[configKey];
  if (!webhookId) return false;

  const transmissionId = headerValue(headers, 'paypal-transmission-id');
  const transmissionTime = headerValue(headers, 'paypal-transmission-time');
  const transmissionSig = headerValue(headers, 'paypal-transmission-sig');
  const certUrl = headerValue(headers, 'paypal-cert-url');
  const authAlgo = headerValue(headers, 'paypal-auth-algo');

  if (!transmissionId || !transmissionTime || !transmissionSig || !certUrl || !authAlgo) return false;
  if (authAlgo.toUpperCase() !== 'SHA256WITHRSA') return false;

  const timeMs = Date.parse(transmissionTime);
  if (Number.isNaN(timeMs) || Math.abs(Date.now() - timeMs) > MAX_SKEW_MS) return false;

  // The cert_url is validated (allowlist, SSRF guards) inside the resolver; the test seam replaces
  // the network leg only, never the validation, so a test cannot smuggle in a non-allowlisted host.
  let certPem;
  if (certResolver) {
    const parsedHost = (() => {
      try {
        return new URL(certUrl).hostname.toLowerCase();
      } catch {
        return null;
      }
    })();
    if (!parsedHost || !ALLOWED_CERT_HOSTS.has(parsedHost)) return false;
    certPem = await certResolver(certUrl);
  } else {
    certPem = await validateAndFetchPayPalCert(certUrl);
  }
  if (!certPem) return false;

  const verificationString = `${transmissionId}|${transmissionTime}|${webhookId}|${computeCrc32(rawBody)}`;

  try {
    const verifier = createVerify('RSA-SHA256');
    verifier.update(verificationString, 'utf8');
    return verifier.verify(certPem, Buffer.from(transmissionSig, 'base64'));
  } catch {
    return false;
  }
}

function parseEvent(rawBody, headers, payloadHash) {
  const json = JSON.parse(rawBody.toString('utf8'));
  const eventType = String(json.event_type || '');
  const resource = json.resource || {};

  let canonicalEventType = 'unhandled';
  let outcome = 'unhandled';
  let failureReason;

  if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
    canonicalEventType = 'payment.success';
    outcome = 'succeeded';
  } else if (eventType === 'PAYMENT.CAPTURE.DENIED' || eventType === 'PAYMENT.CAPTURE.DECLINED') {
    canonicalEventType = 'payment.failed';
    outcome = 'failed';
    failureReason = resource.status_details?.reason || 'PayPal capture denied';
  } else if (eventType === 'CHECKOUT.ORDER.APPROVED') {
    // Approval only — the buyer authorised the order, funds are not captured. Never settlement.
    canonicalEventType = 'unhandled';
    outcome = 'pending';
  }

  const amountStr = resource.amount?.value || '0.00';

  return {
    gateway: id,
    providerEventId: String(json.id || ''),
    providerTransmissionId: headerValue(headers, 'paypal-transmission-id') ?? undefined,
    providerPaymentReference: String(resource.id || json.id || ''),
    cloudhostPaymentId: resource.custom_id ? String(resource.custom_id) : undefined,
    canonicalEventType,
    outcome,
    amountCents: Math.round(Number.parseFloat(amountStr) * 100),
    currency: String(resource.amount?.currency_code || 'USD').toUpperCase(),
    failureReason,
    eventOccurredAt: json.create_time ? new Date(json.create_time).toISOString() : new Date().toISOString(),
    payloadHash,
  };
}

module.exports = {
  id,
  label,
  configKey,
  isConfigured,
  verify,
  parseEvent,
  // exported for tests and for operators diagnosing a refused certificate
  ALLOWED_CERT_HOSTS,
  isPrivateOrReservedIp,
  validateAndFetchPayPalCert,
  setPayPalCertResolver,
  clearPayPalCertCache,
};
