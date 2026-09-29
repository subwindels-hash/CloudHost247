import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import { getPool } from '../db/pool';
import { processIncomingWebhook } from '../services/webhook-service';
import { ValidationError } from '../lib/errors';

export async function registerWebhookRoutes(
  app: FastifyInstance,
  env: Env,
  poolOverride?: Queryable
): Promise<void> {
  const getDb = () => poolOverride ?? getPool(env);

  app.post(
    '/api/v1/webhooks/:gateway',
    async (
      request: FastifyRequest<{
        Params: { gateway: string };
      }>,
      reply
    ) => {
      const { gateway } = request.params;
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
  );
}
