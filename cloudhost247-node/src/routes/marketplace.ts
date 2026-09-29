/**
 * Phase 6 — public application marketplace API (spec §22, §41).
 *
 * Unauthenticated by design (the marketplace is browsable before login, like the hosting
 * catalog). Only published applications/versions are ever visible; responses contain slugs and
 * public metadata only. Handlers contain no SQL — all reads go through
 * src/services/marketplace-service.ts, the single visibility-enforcement point.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { ValidationError } from '../lib/errors';
import { getMarketplaceApp, listMarketplaceApps, listMarketplaceCategories } from '../services/marketplace-service';

const slugSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'slug must be lowercase letters, numbers, and single hyphens only');

const listQuerySchema = z.object({
  category: z.string().max(80).optional(),
  search: z.string().max(120).optional(),
  featured: z.enum(['true', 'false']).optional(),
  sort: z.enum(['popular', 'recent', 'name']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(10000).optional(),
});

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
  }
  return parsed.data;
}

export async function registerMarketplaceRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  app.get('/api/v1/apps', async (request) => {
    const query = parseOrThrow(listQuerySchema, request.query ?? {});
    const { apps, total } = await listMarketplaceApps(pool, {
      category: query.category,
      search: query.search?.trim() || undefined,
      featured: query.featured === 'true' ? true : undefined,
      sort: query.sort,
      limit: query.limit,
      offset: query.offset,
    });
    return { apps, total };
  });

  app.get('/api/v1/app-categories', async () => {
    return { categories: await listMarketplaceCategories(pool) };
  });

  app.get<{ Params: { slug: string } }>('/api/v1/apps/:slug', async (request) => {
    const slug = parseOrThrow(slugSchema, request.params.slug);
    return { app: await getMarketplaceApp(pool, slug) };
  });

  app.get<{ Params: { slug: string } }>('/api/v1/apps/:slug/versions', async (request) => {
    const slug = parseOrThrow(slugSchema, request.params.slug);
    const detail = await getMarketplaceApp(pool, slug);
    return { versions: detail.versions };
  });
}
