/**
 * Public site search (`GET /api/v1/search`).
 *
 * Backed by the in-memory index in `src/search/site-search.ts`, which runs over the corpus the site
 * generator builds from published content. The endpoint is unauthenticated on purpose — the search
 * page is a public marketing surface, like the hosting catalogue — and it returns no account data,
 * no draft content and no tool output: only a title, a category, a summary and a link.
 *
 * The query is sent to the server (the old on-page filter deliberately kept it in the browser), so
 * the response is marked `no-store`: a search term says something about a visitor, and it is never
 * written anywhere — there is no search-history table and no logging of the term.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import { ValidationError } from '../lib/errors';
import {
  SITE_SEARCH_DEFAULT_LIMIT,
  SITE_SEARCH_MAX_LIMIT,
  searchSite,
} from '../search/site-search';

const querySchema = z.object({
  q: z.string().trim().min(1).max(100),
  // `limit` is accepted as any positive integer and clamped to the ceiling below, so a generous
  // caller is served rather than rejected.
  limit: z.coerce.number().int().min(1).optional(),
});

export async function registerSearchRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  void env;
  void overridePool;

  app.get(
    '/api/v1/search',
    // Search is cheap but unbounded queries are not free; this bucket is per route, per client.
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = querySchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join(', '));
      }
      reply.header('Cache-Control', 'no-store');
      return searchSite(parsed.data.q, parsed.data.limit ?? SITE_SEARCH_DEFAULT_LIMIT);
    }
  );
}
