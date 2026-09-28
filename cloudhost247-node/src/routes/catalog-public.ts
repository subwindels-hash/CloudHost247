import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { NotFoundError, ValidationError } from '../lib/errors';
import { getPublicCatalog, getPublicPlansForProduct, getPublicProductBySlug, getPublicProductList } from '../services/catalog-service';

const productTypeSchema = z.enum(['hosting', 'domain', 'service']);

const slugSchema = z
  .string()
  .min(1, 'slug is required')
  .max(160, 'slug is too long')
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'slug must be lowercase letters, numbers, and single hyphens only');

const listQuerySchema = z.object({
  type: productTypeSchema.optional(),
});

/**
 * Public, unauthenticated catalog API — see docs/API_CATALOG.md for the full contract.
 *
 * Every handler here returns *only* publicly-safe DTOs (src/dto/catalog.ts): no database ids,
 * internal status/visibility flags, or unpublished pricing ever reach these responses. Routes
 * never touch the database directly — all reads go through src/services/catalog-service.ts, which
 * is the single place the "public visibility" and "published pricing only" rules are enforced.
 */
export async function registerPublicCatalogRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  app.get('/api/v1/catalog', async () => {
    return getPublicCatalog(pool);
  });

  app.get('/api/v1/catalog/products', async (request) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    return getPublicProductList(pool, parsed.data.type);
  });

  app.get<{ Params: { slug: string } }>('/api/v1/catalog/products/:slug', async (request) => {
    const parsedSlug = slugSchema.safeParse(request.params.slug);
    if (!parsedSlug.success) {
      throw new ValidationError(parsedSlug.error.issues.map((i) => i.message).join(', '));
    }

    const product = await getPublicProductBySlug(pool, parsedSlug.data);
    if (!product) {
      throw new NotFoundError('No product was found with that identifier');
    }
    return { product };
  });

  app.get<{ Params: { slug: string } }>('/api/v1/catalog/products/:slug/plans', async (request) => {
    const parsedSlug = slugSchema.safeParse(request.params.slug);
    if (!parsedSlug.success) {
      throw new ValidationError(parsedSlug.error.issues.map((i) => i.message).join(', '));
    }

    const result = await getPublicPlansForProduct(pool, parsedSlug.data);
    if (!result) {
      throw new NotFoundError('No product was found with that identifier');
    }
    return result;
  });
}
