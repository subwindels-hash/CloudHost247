/**
 * Hire an Expert / Website Design Services API (`/api/v1/experts/*`).
 *
 * The catalogue price is a *public starting price* and is never what the customer is charged: the
 * charge is the quote a member of staff issues, which the customer then approves. Approval turns
 * the stored quote into a normal platform order + invoice (the same commerce path as every other
 * service), and verified payment is what moves the request to `in_progress`.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { authenticate } from '../lib/require-auth';
import { ValidationError } from '../lib/errors';
import {
  addCustomerMessage,
  approveQuote,
  cancelRequest,
  createRequest,
  getRequestForCustomer,
  listMyRequests,
  listOfferings,
} from '../experts/expert-service';

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join(', '));
  return parsed.data;
}

const createRequestSchema = z.object({
  offeringCode: z.string().min(1).max(64),
  title: z.string().min(4).max(200),
  description: z.string().min(30).max(8000),
  goals: z.array(z.string().min(1).max(160)).max(10).optional(),
  referenceUrl: z.string().max(500).nullable().optional(),
  budgetAmount: z.number().min(0).nullable().optional(),
  desiredStartDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date in YYYY-MM-DD form')
    .nullable()
    .optional(),
});

export async function registerExpertRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  app.get('/api/v1/experts/offerings', async (_request, reply) => {
    reply.header('Cache-Control', 'public, max-age=300');
    return { offerings: await listOfferings(pool) };
  });

  app.get('/api/v1/experts/requests', async (request) => {
    const auth = await authenticate(request, env, pool);
    return { requests: await listMyRequests(pool, auth.userId) };
  });

  app.post('/api/v1/experts/requests', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const input = parseOrThrow(createRequestSchema, request.body);
    const result = await createRequest(pool, auth.userId, input);
    reply.code(201);
    return result;
  });

  app.get<{ Params: { id: string } }>('/api/v1/experts/requests/:id', async (request) => {
    const auth = await authenticate(request, env, pool);
    return getRequestForCustomer(pool, auth.userId, request.params.id);
  });

  app.post<{ Params: { id: string } }>('/api/v1/experts/requests/:id/messages', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const input = parseOrThrow(z.object({ body: z.string().min(1).max(8000) }), request.body);
    const message = await addCustomerMessage(pool, auth.userId, request.params.id, input.body);
    reply.code(201);
    return { message };
  });

  /**
   * Approves a quote. The body names the quote only — amounts, line items and currency are read
   * from the stored quote server-side, so a client cannot influence what it is billed.
   */
  app.post<{ Params: { id: string } }>('/api/v1/experts/requests/:id/approve-quote', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const input = parseOrThrow(z.object({ quoteId: z.string().uuid() }), request.body);
    const result = await approveQuote(pool, auth.userId, request.params.id, input.quoteId);
    reply.code(201);
    return result;
  });

  app.post<{ Params: { id: string } }>('/api/v1/experts/requests/:id/cancel', async (request) => {
    const auth = await authenticate(request, env, pool);
    const input = parseOrThrow(z.object({ reason: z.string().max(500).optional() }), request.body ?? {});
    return { request: await cancelRequest(pool, auth.userId, request.params.id, input.reason ?? '') };
  });
}
