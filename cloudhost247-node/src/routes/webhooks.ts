import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import { getPool } from '../db/pool';
import { processIncomingWebhook } from '../services/webhook-service';
import { ValidationError } from '../lib/errors';

/**
 * Payment-provider webhook entrypoints. The canonical route is
 * `/api/v1/webhooks/:gateway`; `/api/v1/webhooks/payment/:provider` is retained as the explicit
 * public contract from the hosting platform API specification. Both routes share exactly the
 * same signature verification, idempotency, and settlement implementation.
 */
export async function registerWebhookRoutes(
  app: FastifyInstance,
  env: Env,
  poolOverride?: Queryable
): Promise<void> {
  const getDb = () => poolOverride ?? getPool(env);

  async function receiveWebhook(
    request: FastifyRequest<{ Params: { gateway?: string; provider?: string } }>,
    reply: FastifyReply
  ) {
    const gateway = request.params.gateway ?? request.params.provider;
    if (!gateway) throw new ValidationError('Payment provider is required');
    const rawBody = (request as unknown as { rawBody?: Buffer }).rawBody;

    if (!rawBody || !Buffer.isBuffer(rawBody)) {
      throw new ValidationError('Missing raw request body for webhook processing');
    }

    const result = await processIncomingWebhook(
      getDb(),
      env,
      gateway,
      rawBody,
      request.headers as Record<string, string | string[] | undefined>
    );

    return reply.code(200).send(result);
  }

  app.post(
    '/api/v1/webhooks/:gateway',
    receiveWebhook
  );
  app.post(
    '/api/v1/webhooks/payment/:provider',
    receiveWebhook
  );
}
