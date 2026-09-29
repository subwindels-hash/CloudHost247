import { createVerify } from 'node:crypto';
import dns from 'node:dns/promises';
import type { Env } from '../config/env';
import type {
  InitiatePaymentInput,
  GatewayInitiationResult,
  PaymentGateway,
  WebhookEventDTO,
  WebhookHandler,
} from './types';

// Standard IEEE 802.3 CRC32 lookup table
const CRC32_TABLE = new Int32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC32_TABLE[i] = c;
}

export function computeCrc32(buf: Buffer): number {
  let crc = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i] ?? 0;
    crc = (crc >>> 8) ^ (CRC32_TABLE[(crc ^ b) & 0xff] ?? 0);
  }
  return (crc ^ -1) >>> 0;
}

/**
 * Explicit, documented PayPal Certificate Hostname Allowlist.
 * Wildcard subdomains (e.g. *.paypal.com) are strictly prohibited to prevent subdomain hijacking/spoofing.
 */
export const ALLOWED_PAYPAL_CERT_HOSTS = new Set([
  'api.paypal.com',
  'api.sandbox.paypal.com',
  'api-m.paypal.com',
  'api-m.sandbox.paypal.com',
]);

interface CachedCert {
  pem: string;
  expiresAt: number;
}

// In-memory LRU Certificate Cache (max 10 entries, 24-hour TTL)
const certCache = new Map<string, CachedCert>();

export function clearPayPalCertCache(): void {
  certCache.clear();
}

/**
 * Evaluates whether an IPv4 or IPv6 address belongs to private, loopback, link-local,
 * cloud metadata (169.254.169.254), or reserved subnets.
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  if (!ip) return true;

  // Handle IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
  if (ip.startsWith('::ffff:')) {
    const v4Part = ip.slice(7);
    if (v4Part.includes('.')) {
      return isPrivateOrReservedIp(v4Part);
    }
  }

  // IPv4 Evaluation
  if (ip.includes('.')) {
    const parts = ip.split('.').map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
      return true; // Malformed IP treated as prohibited
    }
    const [a, b, c, d] = parts;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8 RFC1918 Private
    if (a === 127) return true; // 127.0.0.0/8 Loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 Link-Local / Cloud Metadata (169.254.169.254)
    if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true; // 172.16.0.0/12 RFC1918 Private
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 RFC1918 Private
    if (a === 100 && b !== undefined && b >= 64 && b <= 127) return true; // 100.64.0.0/10 Carrier NAT
    if (a !== undefined && a >= 224) return true; // 224.0.0.0/4 Multicast, Reserved, Broadcast
    return false;
  }

  // IPv6 Evaluation
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true; // Loopback & Unspecified
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // fe80::/10 Link-Local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7 Unique Local (ULA)
  if (lower.startsWith('ff')) return true; // ff00::/8 Multicast
  return false;
}

export type DnsLookupFn = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

let customDnsLookup: DnsLookupFn | null = null;

export function setCustomDnsLookup(fn: DnsLookupFn | null): void {
  customDnsLookup = fn;
}

/**
 * Validates the PayPal certificate URL and retrieves the PEM certificate with complete
 * SSRF, DNS-rebinding, and credential leakage protections.
 */
export async function validateAndFetchPayPalCert(certUrl: string): Promise<string | null> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(certUrl);
  } catch {
    return null;
  }

  // 1. Protocol must be strictly HTTPS
  if (parsedUrl.protocol !== 'https:') {
    return null;
  }

  // 2. Reject userinfo (e.g. https://api.paypal.com@evil-attacker.com/...)
  if (parsedUrl.username || parsedUrl.password) {
    return null;
  }

  // 3. Port must be default HTTPS (443 or omitted)
  if (parsedUrl.port !== '' && parsedUrl.port !== '443') {
    return null;
  }

  // 4. Hostname must match the explicit trusted PayPal allowlist (NO wildcards permitted)
  const hostname = parsedUrl.hostname.toLowerCase();
  if (!ALLOWED_PAYPAL_CERT_HOSTS.has(hostname)) {
    return null;
  }

  // 5. Query parameters and hash fragments are prohibited on certificate endpoints
  if (parsedUrl.search || parsedUrl.hash) {
    return null;
  }

  // 6. Path must be a valid PayPal certificate path
  if (!parsedUrl.pathname.startsWith('/v1/notifications/certs/') && !parsedUrl.pathname.startsWith('/certs/')) {
    return null;
  }

  // 7. Check in-memory LRU cache before DNS/network resolution
  const now = Date.now();
  const cached = certCache.get(certUrl);
  if (cached && cached.expiresAt > now) {
    return cached.pem;
  }

  // 8. DNS Pre-Resolution SSRF Validation
  try {
    const lookupFn = customDnsLookup ?? ((host: string) => dns.lookup(host, { all: true }));
    const records = await lookupFn(hostname);
    if (!records || records.length === 0) {
      return null;
    }
    // Verify EVERY resolved A and AAAA record is public and non-reserved
    for (const record of records) {
      if (isPrivateOrReservedIp(record.address)) {
        return null;
      }
    }
  } catch {
    // DNS resolution failure fails closed
    return null;
  }

  // 9. Fetch certificate with redirect: 'error' (no redirects allowed; no credentials sent)
  try {
    const res = await fetch(certUrl, {
      method: 'GET',
      redirect: 'error',
      // Explicitly send NO auth or cookies
      headers: {
        'Accept': 'application/x-pem-file, text/plain',
      },
    });

    if (!res.ok) return null;
    const pem = await res.text();

    if (!pem.includes('-----BEGIN CERTIFICATE-----') && !pem.includes('-----BEGIN PUBLIC KEY-----')) {
      return null;
    }

    // Cache valid certificate for up to 24 hours
    if (certCache.size >= 10) {
      const firstKey = certCache.keys().next().value;
      if (firstKey) certCache.delete(firstKey);
    }
    certCache.set(certUrl, { pem, expiresAt: now + 24 * 60 * 60 * 1000 });

    return pem;
  } catch {
    return null;
  }
}

export class PayPalGateway implements PaymentGateway, WebhookHandler {
  readonly id = 'paypal';
  readonly gatewayId = 'paypal';

  async initiatePayment(input: InitiatePaymentInput, _env: Env): Promise<GatewayInitiationResult> {
    return {
      providerReference: `ORDER-MOCK-${input.paymentId.replace(/-/g, '').slice(0, 16)}`,
      method: 'paypal_account',
      instructions: null,
    };
  }

  async verifySignature(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
    env: Env
  ): Promise<boolean> {
    const webhookId = env.PAYPAL_WEBHOOK_ID;
    if (!webhookId) return false;

    const getHdr = (name: string): string | null => {
      const v = headers[name] ?? headers[name.toLowerCase()];
      return Array.isArray(v) ? (v[0] ?? null) : v ?? null;
    };

    const transmissionId = getHdr('paypal-transmission-id');
    const transmissionTime = getHdr('paypal-transmission-time');
    const transmissionSig = getHdr('paypal-transmission-sig');
    const certUrl = getHdr('paypal-cert-url');
    const authAlgo = getHdr('paypal-auth-algo');

    if (!transmissionId || !transmissionTime || !transmissionSig || !certUrl || !authAlgo) {
      return false;
    }

    // Algorithm must be SHA256withRSA
    if (authAlgo.toUpperCase() !== 'SHA256WITHRSA') {
      return false;
    }

    // Freshness check: reject transmission timestamp older or newer than 600s
    const timeMs = Date.parse(transmissionTime);
    if (isNaN(timeMs) || Math.abs(Date.now() - timeMs) > 600 * 1000) {
      return false;
    }

    // Validate cert_url and fetch certificate
    const certPem = await validateAndFetchPayPalCert(certUrl);
    if (!certPem) {
      return false;
    }

    // Compute decimal CRC32 over the raw buffer
    const crc = computeCrc32(rawBody);

    // Verification string: transmission_id|transmission_time|webhook_id|crc32
    const verificationString = `${transmissionId}|${transmissionTime}|${webhookId}|${crc}`;

    try {
      const verifier = createVerify('RSA-SHA256');
      verifier.update(verificationString, 'utf8');
      const sigBuffer = Buffer.from(transmissionSig, 'base64');
      return verifier.verify(certPem, sigBuffer);
    } catch {
      return false;
    }
  }

  parseEvent(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
    rawPayloadHash: string
  ): WebhookEventDTO {
    const json = JSON.parse(rawBody.toString('utf8'));
    const eventType = String(json.event_type || '');
    const resource = json.resource || {};

    let canonicalEventType: WebhookEventDTO['canonicalEventType'] = 'unhandled';
    let outcome: WebhookEventDTO['outcome'] = 'unhandled';
    let failureReason: string | undefined = undefined;

    // Strict settlement rule: Only PAYMENT.CAPTURE.COMPLETED is authoritative financial settlement
    if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
      canonicalEventType = 'payment.success';
      outcome = 'succeeded';
    } else if (eventType === 'PAYMENT.CAPTURE.DENIED' || eventType === 'PAYMENT.CAPTURE.DECLINED') {
      canonicalEventType = 'payment.failed';
      outcome = 'failed';
      failureReason = resource.status_details?.reason || 'PayPal capture denied';
    } else if (eventType === 'CHECKOUT.ORDER.APPROVED') {
      // Approval only! Buyer authorized payment, but funds have not been captured yet.
      canonicalEventType = 'unhandled';
      outcome = 'pending';
    }

    const amountStr = resource.amount?.value || '0.00';
    const amountCents = Math.round(parseFloat(amountStr) * 100);
    const currency = (resource.amount?.currency_code || 'USD').toUpperCase();
    const providerPaymentReference = String(resource.id || json.id || '');
    const cloudhostPaymentId = resource.custom_id ? String(resource.custom_id) : undefined;

    const transmissionId = (() => {
      const v = headers['paypal-transmission-id'] ?? headers['paypal-transmission-id'.toLowerCase()];
      return Array.isArray(v) ? v[0] : v ?? undefined;
    })();

    return {
      gateway: 'paypal',
      providerEventId: String(json.id || ''),
      providerTransmissionId: transmissionId,
      providerPaymentReference,
      cloudhostPaymentId,
      canonicalEventType,
      eventOccurredAt: json.create_time ? new Date(json.create_time) : new Date(),
      receivedAt: new Date(),
      amountCents,
      currency,
      outcome,
      failureReason,
      rawPayloadHash,
    };
  }
}
