import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MAX_CART_ITEM_QUANTITY } from '../config/billing';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { authenticate } from '../lib/require-auth';
import { ValidationError } from '../lib/errors';
import {
  addItemToCart,
  checkoutCart,
  getCartSummary,
  getMyOrderDetail,
  listMyOrders,
  removeItemFromCart,
  updateCartItemQuantity,
} from '../services/commerce-service';

const billingPeriodEnum = z.enum(['one_time', 'monthly', 'quarterly', 'semi_annually', 'annually']);

const addCartItemSchema = z.object({
  planId: z.string().uuid('planId must be a valid UUID'),
  billingPeriod: billingPeriodEnum,
  quantity: z.number().int().min(1).max(MAX_CART_ITEM_QUANTITY).optional(),
});

const updateCartItemSchema = z.object({
  quantity: z.number().int().min(1).max(MAX_CART_ITEM_QUANTITY),
});

const idParamSchema = z.object({ id: z.string().uuid('id must be a valid UUID') });

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
  }
  return parsed.data;
}

/**
 * Phase 5A "Commerce foundation" API — cart and order endpoints. See docs/API_BILLING.md for the
 * full contract.
 *
 * Every route here follows the same rules as src/routes/account.ts (Phase 4):
 *   - `authenticate()` establishes who the caller is on every request; every query is scoped to
 *     that caller's own data. A cart item or order that exists but belongs to someone else is
 *     never distinguishable from one that doesn't exist — both are 404, never 403.
 *   - No request body here ever carries a price, subtotal, total, or currency. The client can only
 *     say *what* it wants (a planId + billingPeriod + quantity) — src/services/commerce-service.ts
 *     is the only code that decides what anything costs, always from the live, server-side
 *     catalog at the moment of the request.
 *   - There is no DELETE (or any other mutation) route for orders — once created, an order is
 *     append-only history (see database/migrations/0016's comment); customers can view but never
 *     remove their own order records.
 *   - Admin/staff order-viewing and management routes are explicitly out of scope for this phase
 *     (deferred to 5F).
 */
export async function registerCommerceRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  app.get('/api/v1/cart', async (request) => {
    const auth = await authenticate(request, env, pool);
    const cart = await getCartSummary(pool, auth.userId, randomUUID);
    return { cart };
  });

  app.post('/api/v1/cart/items', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const input = parseOrThrow(addCartItemSchema, request.body);

    const cart = await addItemToCart(pool, auth.userId, { ...input, quantity: input.quantity ?? 1 }, randomUUID);
    reply.code(201);
    return { cart };
  });

  app.patch<{ Params: { id: string } }>('/api/v1/cart/items/:id', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParamSchema, request.params);
    const { quantity } = parseOrThrow(updateCartItemSchema, request.body);

    const cart = await updateCartItemQuantity(pool, auth.userId, id, quantity);
    return { cart };
  });

  app.delete<{ Params: { id: string } }>('/api/v1/cart/items/:id', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParamSchema, request.params);

    const cart = await removeItemFromCart(pool, auth.userId, id);
    return { cart };
  });

  app.post('/api/v1/orders', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const order = await checkoutCart(pool, auth.userId, randomUUID);
    reply.code(201);
    return { order };
  });

  app.get('/api/v1/orders', async (request) => {
    const auth = await authenticate(request, env, pool);
    const orders = await listMyOrders(pool, auth.userId);
    return { orders };
  });

  app.get<{ Params: { id: string } }>('/api/v1/orders/:id', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParamSchema, request.params);

    const order = await getMyOrderDetail(pool, auth.userId, id);
    return { order };
  });
}
