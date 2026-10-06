/**
 * Public navigation route. Serves the single mega-menu definition (src/navigation/mega-menu.ts) that
 * the desktop menu, the mobile drawer, the footer and the sitemap all render, so the platform can
 * never present two different navigation structures.
 */
import type { FastifyInstance } from 'fastify';
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import { MEGA_MENU, allNavLinks, validateNavigationTargets } from '../navigation/mega-menu';

export async function registerNavigationRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  void env;
  void overridePool;

  app.get('/api/v1/navigation', async (_request, reply) => {
    const validation = validateNavigationTargets();
    // A broken navigation is a release blocker, so it is reported loudly rather than served as if
    // it were fine. The menu is still returned (the UI can render what is valid) alongside the
    // problem list.
    reply.header('Cache-Control', 'public, max-age=300');
    return {
      sections: MEGA_MENU,
      linkCount: allNavLinks().length,
      validation: { ok: validation.ok, errors: validation.errors },
    };
  });
}
