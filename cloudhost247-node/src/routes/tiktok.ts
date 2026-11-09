import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { ValidationError } from '../lib/errors';
import { loadTikTokConfiguration } from '../tiktok/config-service';
import { tiktokRuntimeConfiguration } from '../tiktok/types';
import { recordTikTokBrowserEvents, verifiedTikTokPurchaseReceipt } from '../tiktok/event-service';
import { loadConfiguration } from '../marketing/config-service';
import { ensureConsent, consentDTO, assertConsentMutation, requestConsent, consentGranted } from '../marketing/consent-service';
import { authenticate } from '../lib/require-auth';

/**
 * Public TikTok runtime endpoints. Consent is the shared CloudHost247
 * marketing consent (the single consent manager) — TikTok never gets its own
 * consent system and the Events API is never used to bypass a refusal.
 */
export async function registerTikTokRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);
  const base = '/api/v1/marketing/tiktok';
  const privateResponse = (reply: import('fastify').FastifyReply) => {
    reply.header('Cache-Control', 'private, no-store');
    reply.header('Vary', 'Cookie, Host');
    reply.header('X-Content-Type-Options', 'nosniff');
  };
  app.get(`${base}/bootstrap`, { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
    privateResponse(reply);
    const [row, consent, metaRow] = await Promise.all([loadTikTokConfiguration(pool), ensureConsent(pool, request, reply, env), loadConfiguration(pool)]);
    return { configuration: tiktokRuntimeConfiguration(row, request.hostname), consent: consentDTO(consent, metaRow?.configuration.consentPolicy ?? 'global_opt_in') };
  });

  // Local dispatch ledger for browser/server event_id deduplication. This is
  // not a TikTok delivery acknowledgement and never accepts CompletePayment.
  app.post(`${base}/browser-events`, { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    privateResponse(reply);
    const context = await ensureConsent(pool, request, reply, env);
    assertConsentMutation(request, context, env);
    if (!consentGranted(context.row)) return reply.code(403).send({ error: 'CONSENT_REQUIRED', message: 'Marketing consent is not granted' });
    const result = await recordTikTokBrowserEvents(pool, request.body, context.row.id, env.APP_URL);
    return reply.code(202).send({ ...result, meaning: 'browser_dispatch_recorded_not_tiktok_receipt' });
  });

  app.get<{ Params: { invoiceId: string } }>(`${base}/purchase-receipt/:invoiceId`, async (request, reply) => {
    privateResponse(reply);
    const auth = await authenticate(request, env, pool);
    const id = z.string().uuid().safeParse(request.params.invoiceId);
    if (!id.success) throw new ValidationError('Invalid invoice id');
    const consent = await requestConsent(pool, request);
    if (!consentGranted(consent)) throw new ValidationError('Marketing consent is not granted');
    return verifiedTikTokPurchaseReceipt(pool, auth.userId, id.data, consent!.id);
  });
}
