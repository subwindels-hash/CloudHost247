import { saveGa4BrowserId, ga4ClientIdPattern } from '../marketing/ga4-browser-id';
import { ga4PurchaseCredentials } from '../marketing/ga4-purchase-config';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { ValidationError } from '../lib/errors';
import { loadConfiguration } from '../marketing/config-service';
import { googleAdsRuntime, loadGoogleAds } from '../marketing/google-ads';
import { runtimeConfiguration } from '../marketing/types';
import { ga4Runtime } from '../marketing/ga4-config';
import { ensureConsent, consentDTO, assertConsentMutation, saveConsent, requestConsent, consentGranted, safeSourceUrl } from '../marketing/consent-service';
import { authenticate } from '../lib/require-auth';
import { verifiedPurchaseReceipt } from '../marketing/conversion-service';
import { recordBrowserEvents } from '../marketing/event-service';

export async function registerMarketingRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);
  const base = '/api/v1/marketing';
  const privateResponse = (reply: import('fastify').FastifyReply) => {
    reply.header('Cache-Control', 'private, no-store');
    reply.header('Vary', 'Cookie, Host');
    reply.header('X-Content-Type-Options', 'nosniff');
  };
  app.get(`${base}/bootstrap`, { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
    privateResponse(reply);
    const [row, googleAdsRow, consent, analytics] = await Promise.all([loadConfiguration(pool), loadGoogleAds(pool), ensureConsent(pool, request, reply, env), ga4Runtime(pool, request.hostname).catch(() => ({ enabled: false, measurementId: null, testMode: false, revision: 0 }))]);
    const runtime = runtimeConfiguration(row, request.hostname);
    return { configuration: runtime, googleAds: googleAdsRuntime(googleAdsRow, request.hostname), analytics: { ...analytics, purchaseCapture: Boolean(ga4PurchaseCredentials(env, analytics.measurementId)) }, consent: consentDTO(consent, runtime.consentPolicy) };
  });
  app.put(`${base}/consent`, { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    privateResponse(reply);
    const consent = await ensureConsent(pool, request, reply, env);
    assertConsentMutation(request, consent, env);
    const parsed = z.object({ action: z.enum(['accept_all','reject_optional','save_preferences','withdraw']), preferences: z.unknown().optional(), policyVersion: z.literal(1) }).strict().safeParse(request.body);
    if (!parsed.success) throw new ValidationError('Invalid cookie preference request');
    consent.row = await saveConsent(pool, consent.token, parsed.data.action, parsed.data.preferences);
    const config = await loadConfiguration(pool);
    return { consent: consentDTO(consent, config?.configuration.consentPolicy ?? 'global_opt_in') };
  });
  // Only the consent-bound, same-origin browser may attach its gtag client ID. This does not
  // accept payment or transaction data and never returns the identifier or server secret.
  app.post(`${base}/ga4-client-id`, { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    privateResponse(reply);
    const context = await ensureConsent(pool, request, reply, env);
    assertConsentMutation(request, context, env);
    const parsed = z.object({ clientId: z.string().regex(ga4ClientIdPattern), revision: z.number().int().positive(), consentRevision: z.number().int().nonnegative() }).strict().safeParse(request.body);
    if (!parsed.success) throw new ValidationError('Invalid analytics client identifier');
    const stored = await saveGa4BrowserId(pool, env, context.row.id, request.hostname, parsed.data.revision, parsed.data.consentRevision, parsed.data.clientId);
    return reply.code(stored ? 204 : 403).send();
  });
  app.get<{ Params: { invoiceId: string } }>(`${base}/purchase-receipt/:invoiceId`, async (request, reply) => {
    privateResponse(reply);
    const auth = await authenticate(request, env, pool);
    const id = z.string().uuid().safeParse(request.params.invoiceId);
    if (!id.success) throw new ValidationError('Invalid invoice id');
    const consent = await requestConsent(pool, request);
    if (!consentGranted(consent)) throw new ValidationError('Marketing consent is not granted');
    return verifiedPurchaseReceipt(pool, auth.userId, id.data, consent!.id);
  });

  // This measures local SDK dispatch only. It is not a Meta delivery acknowledgement and never
  // accepts Purchase: purchases are created from authoritative successful payment rows instead.
  app.post(`${base}/browser-events`, { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    privateResponse(reply);
    // Bind CSRF to the actual opaque cookie, not to a client-supplied header, and use the
    // same session row for the consent decision and the event write (no pre-read/write gap).
    const context = await ensureConsent(pool, request, reply, env);
    assertConsentMutation(request, context, env);
    if (!consentGranted(context.row)) return reply.code(403).send({ error: 'CONSENT_REQUIRED', message: 'Marketing consent is not granted' });
    const result = await recordBrowserEvents(pool, request.body, context.row.id, env.APP_URL);
    return reply.code(202).send({ ...result, meaning: 'browser_dispatch_recorded_not_meta_receipt' });
  });
}
