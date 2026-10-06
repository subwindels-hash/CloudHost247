/**
 * Logo Maker API (`/api/v1/logo-maker/*`).
 *
 * Generation, editing and export are deterministic and server-side: the same inputs always produce
 * the same logo, and the exported SVG is the platform's own vector output (the PNG is a convenience
 * raster of the same geometry, not a screenshot of a browser).
 *
 * `POST /projects/:id/suggest` is the only route that may call an external model. When no LLM
 * credential is configured it fails closed with `CONFIGURATION_REQUIRED` and names the setting — it
 * never quietly substitutes a "random" suggestion and presents it as AI output.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { authenticate } from '../lib/require-auth';
import { ForbiddenError, ValidationError } from '../lib/errors';
import {
  createProject,
  designCatalogue,
  editConcept,
  exportConcept,
  generateConcepts,
  listConcepts,
  listConceptRevisions,
  listExports,
  listProjects,
  requireOwnedProject,
  restoreConceptRevision,
  selectConcept,
  suggestPalette,
  updateProject,
} from '../logo-maker/logo-service';

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join(', '));
  return parsed.data;
}

const createProjectSchema = z.object({
  companyName: z.string().min(1).max(160),
  tagline: z.string().max(200).nullable().optional(),
  industry: z.string().max(80).nullable().optional(),
  style: z.string().max(60).optional(),
  paletteSlug: z.string().max(60).optional(),
  fontSlug: z.string().max(60).optional(),
  brandKeywords: z.array(z.string().max(40)).max(10).optional(),
  notes: z.string().max(2000).nullable().optional(),
});

/** Only the fields the service can actually change are accepted — silently dropping input is a bug. */
const updateProjectSchema = z.object({
  companyName: z.string().min(1).max(160).optional(),
  tagline: z.string().max(200).nullable().optional(),
  style: z.string().max(60).optional(),
  paletteSlug: z.string().max(60).optional(),
  fontSlug: z.string().max(60).optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const conceptPatchSchema = z.object({
  layout: z.string().max(60).optional(),
  markStyle: z.string().max(60).optional(),
  paletteSlug: z.string().max(60).optional(),
  fontSlug: z.string().max(60).optional(),
  companyName: z.string().min(1).max(160).optional(),
  tagline: z.string().max(200).nullable().optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colours must be hex values like #1a2b3c').optional(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colours must be hex values like #1a2b3c').optional(),
  note: z.string().max(200).nullable().optional(),
});

export async function registerLogoMakerRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  app.get('/api/v1/logo-maker/catalogue', async (_request, reply) => {
    reply.header('Cache-Control', 'public, max-age=600');
    return designCatalogue();
  });

  app.get('/api/v1/logo-maker/projects', async (request) => {
    const auth = await authenticate(request, env, pool);
    return { projects: await listProjects(pool, auth.userId) };
  });

  app.post('/api/v1/logo-maker/projects', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const input = parseOrThrow(createProjectSchema, request.body);
    const project = await createProject(pool, auth.userId, input);
    reply.code(201);
    return { project };
  });

  app.get<{ Params: { id: string } }>('/api/v1/logo-maker/projects/:id', async (request) => {
    const auth = await authenticate(request, env, pool);
    const project = await requireOwnedProject(pool, auth.userId, request.params.id);
    return { project, concepts: await listConcepts(pool, auth.userId, project.id) };
  });

  app.patch<{ Params: { id: string } }>('/api/v1/logo-maker/projects/:id', async (request) => {
    const auth = await authenticate(request, env, pool);
    const input = parseOrThrow(updateProjectSchema, request.body);
    return { project: await updateProject(pool, auth.userId, request.params.id, input) };
  });

  app.post<{ Params: { id: string } }>('/api/v1/logo-maker/projects/:id/concepts', async (request) => {
    const auth = await authenticate(request, env, pool);
    return { concepts: await generateConcepts(pool, auth.userId, request.params.id) };
  });

  app.patch<{ Params: { id: string; conceptId: string } }>(
    '/api/v1/logo-maker/projects/:id/concepts/:conceptId',
    async (request) => {
      const auth = await authenticate(request, env, pool);
      const patch = parseOrThrow(conceptPatchSchema, request.body);
      // The project path segment is verified too, so a concept id alone is never enough.
      await requireOwnedProject(pool, auth.userId, request.params.id);
      return { concept: await editConcept(pool, auth.userId, request.params.conceptId, patch) };
    }
  );

  app.get<{ Params: { id: string; conceptId: string } }>(
    '/api/v1/logo-maker/projects/:id/concepts/:conceptId/revisions',
    async (request) => {
      const auth = await authenticate(request, env, pool);
      await requireOwnedProject(pool, auth.userId, request.params.id);
      return { revisions: await listConceptRevisions(pool, auth.userId, request.params.conceptId) };
    }
  );

  app.post<{ Params: { id: string; conceptId: string; revision: string } }>(
    '/api/v1/logo-maker/projects/:id/concepts/:conceptId/revisions/:revision/restore',
    async (request) => {
      const auth = await authenticate(request, env, pool);
      await requireOwnedProject(pool, auth.userId, request.params.id);
      const revision = Number.parseInt(request.params.revision, 10);
      if (!Number.isInteger(revision) || revision < 1) throw new ValidationError('That version number is not valid');
      return { concept: await restoreConceptRevision(pool, auth.userId, request.params.conceptId, revision) };
    }
  );

  app.post<{ Params: { id: string; conceptId: string } }>(
    '/api/v1/logo-maker/projects/:id/concepts/:conceptId/select',
    async (request) => {
      const auth = await authenticate(request, env, pool);
      await requireOwnedProject(pool, auth.userId, request.params.id);
      return await selectConcept(pool, auth.userId, request.params.conceptId);
    }
  );

  app.post<{ Params: { id: string; conceptId: string } }>(
    '/api/v1/logo-maker/projects/:id/concepts/:conceptId/export',
    { config: { rateLimit: { max: 40, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const auth = await authenticate(request, env, pool);
      await requireOwnedProject(pool, auth.userId, request.params.id);
      const input = parseOrThrow(
        z.object({
          format: z.enum(['svg', 'png']),
          width: z.number().int().min(64).max(4096).optional(),
          height: z.number().int().min(64).max(4096).optional(),
          background: z.enum(['transparent', 'palette']).optional(),
        }),
        request.body ?? {}
      );
      const art = await exportConcept(pool, auth.userId, request.params.conceptId, input);
      reply
        .header('Content-Type', art.contentType)
        .header('Content-Disposition', `attachment; filename="${art.filename}"`)
        .header('X-Content-Type-Options', 'nosniff');
      return reply.send(art.data);
    }
  );

  app.get<{ Params: { id: string; conceptId: string } }>(
    '/api/v1/logo-maker/projects/:id/concepts/:conceptId/exports',
    async (request) => {
      const auth = await authenticate(request, env, pool);
      await requireOwnedProject(pool, auth.userId, request.params.id);
      return { exports: await listExports(pool, auth.userId, request.params.conceptId) };
    }
  );

  /**
   * Assisted palette/style suggestion. Answers 403 `CONFIGURATION_REQUIRED` with the exact settings
   * an operator must provide when no LLM credential is configured.
   */
  app.post<{ Params: { id: string } }>(
    '/api/v1/logo-maker/projects/:id/suggest',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => {
      const auth = await authenticate(request, env, pool);
      const input = parseOrThrow(z.object({ brief: z.string().min(20).max(1500).optional() }), request.body ?? {});
      try {
        return await suggestPalette(pool, env, auth.userId, request.params.id, { brief: input.brief ?? null });
      } catch (error) {
        // A missing model credential is a configuration state, not a server fault — the route says
        // which setting is needed instead of returning an opaque 500.
        if ((error as { code?: string }).code === 'CONFIGURATION_REQUIRED') {
          throw new ForbiddenError((error as Error).message);
        }
        throw error;
      }
    }
  );
}
