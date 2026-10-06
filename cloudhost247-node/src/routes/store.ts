/**
 * Online Store customer + merchant API (`/api/v1/store/*`) and public storefront
 * (`/api/v1/public/stores/*`).
 *
 * The public endpoints are unauthenticated because a storefront is public by definition; they only
 * ever read `status = 'active'` stores and products, and they never expose merchant-only fields
 * (no cost prices, no internal metadata, no other customers' orders).
 *
 * The shopper checkout and the provider-callback endpoints are rate-limited and validate every
 * amount server-side (src/store/store-service.ts).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { authenticate } from '../lib/require-auth';
import { requireRole } from '../lib/require-role';
import { ValidationError, NotFoundError } from '../lib/errors';
import {
  adjustInventory,
  cancelOrder,
  createDiscount,
  createProduct,
  createShippingMethod,
  createStore,
  createTaxRate,
  fulfilOrderItem,
  getOrder,
  getPublicStore,
  getShopperOrderStatus,
  listDiscounts,
  listOrders,
  listProducts,
  listStores,
  placeShopperOrder,
  redeemDownloadToken,
  recordPaymentEvent,
  requireOwnedStore,
  updateProduct,
  updateStore,
} from '../store/store-service';
import { MAX_DIGITAL_PRODUCT_BYTES } from '../lib/media-upload';

const STAFF = ['admin', 'super_admin'] as const;

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join(', '));
  return parsed.data;
}

const idParam = z.object({ id: z.string().uuid('A valid id is required') });

const createStoreSchema = z.object({
  name: z.string().min(2).max(160),
  description: z.string().max(2000).optional(),
  siteId: z.string().uuid().nullable().optional(),
  currency: z.string().length(3).optional(),
});

const updateStoreSchema = z.object({
  name: z.string().min(2).max(160).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(['draft', 'active', 'suspended']).optional(),
  paymentMode: z.enum(['order_intake', 'provider']).optional(),
  settings: z.record(z.unknown()).optional(),
  theme: z.record(z.unknown()).optional(),
});

const downloadSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(3).max(64),
  base64: z.string().min(1).max(Math.ceil((MAX_DIGITAL_PRODUCT_BYTES * 4) / 3) + 4096),
});

const productSchema = z.object({
  kind: z.enum(['physical', 'digital', 'service']),
  name: z.string().min(1).max(200),
  slug: z.string().max(120).optional(),
  description: z.string().max(8000).optional(),
  priceAmount: z.number().min(0),
  compareAtAmount: z.number().min(0).nullable().optional(),
  sku: z.string().max(80).nullable().optional(),
  trackInventory: z.boolean().optional(),
  inventoryQuantity: z.number().int().min(0).optional(),
  weightGrams: z.number().int().min(1).nullable().optional(),
  downloadLimit: z.number().int().min(1).max(100).optional(),
  downloadExpiryDays: z.number().int().min(1).max(3650).optional(),
  metadata: z.record(z.unknown()).optional(),
  download: downloadSchema.nullable().optional(),
});

const checkoutSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        variantId: z.string().uuid().nullable().optional(),
        quantity: z.number().int().min(1).max(1000),
      })
    )
    .min(1)
    .max(50),
  customerName: z.string().min(2).max(200),
  customerEmail: z.string().email().max(255),
  customerPhone: z.string().max(40).nullable().optional(),
  shippingMethodId: z.string().uuid().nullable().optional(),
  shippingAddress: z.record(z.string().max(200)).nullable().optional(),
  discountCode: z.string().max(40).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export async function registerStoreRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  /* ------------------------------------------------------------------------------------------
   * Merchant side (authenticated, ownership-scoped)
   * ---------------------------------------------------------------------------------------- */

  app.get('/api/v1/store/stores', async (request) => {
    const auth = await authenticate(request, env, pool);
    return { stores: await listStores(pool, auth.userId) };
  });

  app.post('/api/v1/store/stores', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const input = parseOrThrow(createStoreSchema, request.body);
    const store = await createStore(pool, auth.userId, input);
    reply.code(201);
    return { store };
  });

  app.get<{ Params: { id: string } }>('/api/v1/store/stores/:id', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const store = await requireOwnedStore(pool, auth.userId, id);
    return {
      store,
      products: await listProducts(pool, store.id),
      discounts: await listDiscounts(pool, auth.userId, store.id),
      limitsCode: store.plan_code,
    };
  });

  app.patch<{ Params: { id: string } }>('/api/v1/store/stores/:id', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const patch = parseOrThrow(updateStoreSchema, request.body);
    return { store: await updateStore(pool, auth.userId, id, patch) };
  });

  app.get<{ Params: { id: string } }>('/api/v1/store/stores/:id/products', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    await requireOwnedStore(pool, auth.userId, id);
    return { products: await listProducts(pool, id, true) };
  });

  app.post<{ Params: { id: string } }>('/api/v1/store/stores/:id/products', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const input = parseOrThrow(productSchema, request.body);
    const product = await createProduct(pool, auth.userId, id, input);
    reply.code(201);
    return { product };
  });

  app.patch<{ Params: { id: string } }>('/api/v1/store/products/:id', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const patch = parseOrThrow(productSchema.partial().extend({ status: z.enum(['draft', 'active', 'archived']).optional() }), request.body);
    return { product: await updateProduct(pool, auth.userId, id, patch) };
  });

  app.post<{ Params: { id: string } }>('/api/v1/store/products/:id/inventory', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const input = parseOrThrow(
      z.object({ delta: z.number().int().min(-100000).max(100000), reason: z.enum(['restock', 'adjustment']) }),
      request.body
    );
    return adjustInventory(pool, auth.userId, id, input.delta, input.reason, auth.userId);
  });

  app.get<{ Params: { id: string } }>('/api/v1/store/stores/:id/orders', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const status = (request.query as { status?: string }).status;
    return { orders: await listOrders(pool, auth.userId, id, status) };
  });

  app.get<{ Params: { id: string; orderId: string } }>('/api/v1/store/stores/:id/orders/:orderId', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const orderId = parseOrThrow(z.string().uuid(), request.params.orderId);
    return getOrder(pool, auth.userId, id, orderId);
  });

  app.post<{ Params: { id: string; orderId: string; itemId: string } }>(
    '/api/v1/store/stores/:id/orders/:orderId/items/:itemId/fulfil',
    async (request) => {
      const auth = await authenticate(request, env, pool);
      const { id, orderId, itemId } = request.params;
      const input = parseOrThrow(
        z.object({
          status: z.enum(['processing', 'shipped', 'delivered', 'cancelled']),
          carrier: z.string().max(80).nullable().optional(),
          trackingNumber: z.string().max(120).nullable().optional(),
          trackingUrl: z.string().url().max(500).nullable().optional(),
          notes: z.string().max(500).nullable().optional(),
        }),
        request.body
      );
      return {
        fulfilment: await fulfilOrderItem(pool, auth.userId, id, orderId, itemId, input),
      };
    }
  );

  app.post<{ Params: { id: string; orderId: string } }>('/api/v1/store/stores/:id/orders/:orderId/cancel', async (request) => {
    const auth = await authenticate(request, env, pool);
    const input = parseOrThrow(z.object({ reason: z.string().max(500) }), request.body ?? {});
    return cancelOrder(pool, auth.userId, request.params.id, request.params.orderId, input.reason ?? '');
  });

  app.post<{ Params: { id: string } }>('/api/v1/store/stores/:id/discounts', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const input = parseOrThrow(
      z.object({
        code: z.string().min(3).max(40),
        kind: z.enum(['percentage', 'fixed']),
        value: z.number().positive(),
        minOrderAmount: z.number().min(0).nullable().optional(),
        maxRedemptions: z.number().int().min(1).nullable().optional(),
        endsAt: z.string().datetime().nullable().optional(),
      }),
      request.body
    );
    const discount = await createDiscount(pool, auth.userId, id, input);
    reply.code(201);
    return { discount };
  });

  app.post<{ Params: { id: string } }>('/api/v1/store/stores/:id/shipping-methods', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const input = parseOrThrow(
      z.object({
        name: z.string().min(1).max(120),
        description: z.string().max(255).optional(),
        priceAmount: z.number().min(0),
        countries: z.array(z.string().length(2)).max(250).optional(),
        minOrderAmount: z.number().min(0).nullable().optional(),
      }),
      request.body
    );
    const method = await createShippingMethod(pool, auth.userId, id, input);
    reply.code(201);
    return { shippingMethod: method };
  });

  app.post<{ Params: { id: string } }>('/api/v1/store/stores/:id/tax-rates', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const input = parseOrThrow(
      z.object({
        name: z.string().min(1).max(120),
        countryCode: z.string().min(1).max(2),
        region: z.string().max(80).nullable().optional(),
        ratePercent: z.number().min(0).max(100),
        includesShipping: z.boolean().optional(),
      }),
      request.body
    );
    const rate = await createTaxRate(pool, auth.userId, id, input);
    reply.code(201);
    return { taxRate: rate };
  });

  /* ------------------------------------------------------------------------------------------
   * Public storefront (unauthenticated reads, rate-limited writes)
   * ---------------------------------------------------------------------------------------- */

  app.get<{ Params: { slug: string } }>('/api/v1/public/stores/:slug', async (request, reply) => {
    const storefront = await getPublicStore(pool, request.params.slug);
    if (!storefront) throw new NotFoundError('No store was found at that address');
    reply.header('Cache-Control', 'public, max-age=120');
    return {
      store: {
        name: storefront.store.name,
        slug: storefront.store.slug,
        description: storefront.store.description,
        currency: storefront.store.currency,
        theme: storefront.store.theme,
        // Reported exactly as stored: a store with no connected payment provider says so.
        paymentMode: storefront.store.payment_mode,
      },
      products: storefront.products,
      shippingMethods: storefront.shippingMethods.map((method) => ({
        id: method.id,
        name: method.name,
        description: method.description,
        priceAmount: method.price_amount,
        currency: method.currency,
        countries: method.countries,
        minOrderAmount: method.min_order_amount,
      })),
      // A country with no configured rate charges no tax — stated, not silently assumed.
      configuredTaxCountries: storefront.taxRates.map((rate) => rate.country_code),
    };
  });

  app.post<{ Params: { slug: string } }>(
    '/api/v1/public/stores/:slug/orders',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const input = parseOrThrow(checkoutSchema, request.body);
      const result = await placeShopperOrder(pool, request.params.slug, input, { sourceIp: request.ip });
      reply.code(201);
      return result;
    }
  );

  app.get<{ Params: { slug: string; orderNumber: string } }>('/api/v1/public/stores/:slug/orders/:orderNumber', async (request) => {
    const query = request.query as { email?: string };
    if (!query.email) throw new ValidationError('Provide the email address used for the order');
    return {
      order: await getShopperOrderStatus(pool, request.params.slug, request.params.orderNumber, query.email),
    };
  });

  /**
   * Digital delivery. The token is the credential — there is no session requirement — so the route
   * is rate-limited and the response is served as an attachment with a sniff-resistant type.
   */
  app.get<{ Params: { token: string } }>(
    '/api/v1/public/downloads/:token',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const file = await redeemDownloadToken(pool, request.params.token);
      reply
        .header('Content-Type', file.contentType)
        .header('Content-Disposition', `attachment; filename="${file.filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`)
        .header('X-Content-Type-Options', 'nosniff')
        .header('Cache-Control', 'private, no-store');
      return reply.send(file.data);
    }
  );

  /**
   * Provider callback. The signature is verified by the caller's gateway adapter before this route
   * is reached; an event that did not verify is recorded but never applied, which is why
   * `recordPaymentEvent` takes `signatureVerified` explicitly.
   */
  app.post('/api/v1/webhooks/store-payment', async (request, reply) => {
    const input = parseOrThrow(
      z.object({
        storeId: z.string().uuid(),
        provider: z.string().min(1).max(40),
        providerReference: z.string().min(1).max(160),
        eventType: z.string().min(1).max(60),
        status: z.enum(['paid', 'failed', 'refunded', 'pending']),
        amount: z.string().max(20).nullable().optional(),
        currency: z.string().length(3).nullable().optional(),
        signatureVerified: z.boolean(),
        orderId: z.string().uuid().nullable().optional(),
        payload: z.record(z.unknown()).optional(),
      }),
      request.body
    );
    const result = await recordPaymentEvent(pool, input, { source: process.env });
    reply.code(result.duplicate ? 200 : 202);
    return result;
  });

  /* ------------------------------------------------------------------------------------------
   * Admin oversight
   * ---------------------------------------------------------------------------------------- */

  app.get('/api/v1/admin/store/overview', async (request) => {
    await requireRole(request, env, pool, STAFF);
    const { rows } = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM store_stores) AS stores,
         (SELECT count(*)::int FROM store_stores WHERE status = 'active') AS active_stores,
         (SELECT count(*)::int FROM store_products WHERE status = 'active') AS active_products,
         (SELECT count(*)::int FROM store_products WHERE kind = 'digital') AS digital_products,
         (SELECT count(*)::int FROM store_orders) AS orders,
         (SELECT count(*)::int FROM store_orders WHERE payment_status = 'paid') AS paid_orders,
         (SELECT count(*)::int FROM store_orders WHERE status = 'pending') AS open_orders`,
    );
    return { overview: rows[0] ?? {} };
  });

  app.get('/api/v1/admin/store/stores', async (request) => {
    await requireRole(request, env, pool, STAFF);
    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.slug, s.status, s.payment_mode, s.currency, s.plan_code, s.created_at,
              u.email AS owner_email,
              (SELECT count(*)::int FROM store_products p WHERE p.store_id = s.id) AS product_count,
              (SELECT count(*)::int FROM store_orders o WHERE o.store_id = s.id) AS order_count
         FROM store_stores s JOIN users u ON u.id = s.user_id
        ORDER BY s.created_at DESC LIMIT 200`
    );
    return { stores: rows };
  });
}
