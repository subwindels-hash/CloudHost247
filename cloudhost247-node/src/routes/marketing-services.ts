/**
 * CloudHost247 managed digital marketing — customer API (`/api/v1/marketing-services/*`).
 *
 * A campaign request is a real engagement record: it is queued for the delivery team through the
 * notification pipeline, and every stage (planning → active → reporting → completed) is a stored
 * transition with a timeline the customer can read. Reporting numbers are only ever the numbers an
 * integration reported, each labelled with the source that produced it.
 *
 * `channelStatus` is published alongside the catalogue so the page can say plainly which channels
 * are connected today and which are still being onboarded — instead of implying capability we do
 * not have. No credential names are exposed to customers; the admin surface shows those.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { authenticate } from '../lib/require-auth';
import { ValidationError } from '../lib/errors';
import {
  addCampaignMessage,
  configuredProviderKeys,
  createCampaign,
  getCampaignForCustomer,
  listMyCampaigns,
  listOfferings,
  providerKeysFor,
} from '../marketing-services/campaign-service';

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join(', '));
  return parsed.data;
}

const createCampaignSchema = z.object({
  offeringCode: z.string().min(1).max(64),
  name: z.string().min(3).max(200),
  goal: z.string().min(20).max(4000),
  targetUrl: z.string().max(500).nullable().optional(),
  targetAudience: z.string().max(2000).nullable().optional(),
  monthlyBudgetAmount: z.number().min(0).nullable().optional(),
});

export async function registerMarketingServiceRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  app.get('/api/v1/marketing-services/offerings', async (_request, reply) => {
    const offerings = await listOfferings(pool);
    const connected = new Set(configuredProviderKeys(process.env));
    reply.header('Cache-Control', 'public, max-age=120');
    return {
      offerings: offerings.map((offering) => {
        const required = providerKeysFor(String(offering.channel));
        const live = required.filter((providerKey) => connected.has(providerKey));
        return {
          ...offering,
          // A channel with no integration requirement is always live; otherwise it is live once at
          // least one of its providers is actually configured.
          channelConnected: required.length === 0 || live.length > 0,
          channelNote:
            required.length === 0 || live.length > 0
              ? null
              : 'This channel is still being onboarded. You can start a request now and the delivery team will confirm the timeline before any work begins.',
        };
      }),
      channelStatus: Object.fromEntries(
        [...new Set(offerings.map((offering) => String(offering.channel)))].map((channel) => {
          const required = providerKeysFor(channel);
          return [channel, { requiredProviders: required.length, connected: required.some((key) => connected.has(key)) }];
        })
      ),
    };
  });

  app.get('/api/v1/marketing-services/campaigns', async (request) => {
    const auth = await authenticate(request, env, pool);
    return { campaigns: await listMyCampaigns(pool, auth.userId) };
  });

  app.post('/api/v1/marketing-services/campaigns', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const input = parseOrThrow(createCampaignSchema, request.body);
    const result = await createCampaign(pool, auth.userId, input);
    reply.code(201);
    return result;
  });

  app.get<{ Params: { id: string } }>('/api/v1/marketing-services/campaigns/:id', async (request) => {
    const auth = await authenticate(request, env, pool);
    return getCampaignForCustomer(pool, auth.userId, request.params.id);
  });

  app.post<{ Params: { id: string } }>('/api/v1/marketing-services/campaigns/:id/messages', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const input = parseOrThrow(z.object({ body: z.string().min(1).max(8000) }), request.body);
    const message = await addCampaignMessage(pool, auth.userId, request.params.id, input.body);
    reply.code(201);
    return { message };
  });
}
