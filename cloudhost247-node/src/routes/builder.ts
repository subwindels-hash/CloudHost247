/**
 * Website Builder + AI Website Builder customer API (`/api/v1/builder/*`, `/api/v1/ai-builder/*`).
 *
 * Every route authenticates and scopes to the caller's own resources; ownership is re-checked by
 * the service layer (src/builders/site-service.ts) rather than trusted from the URL. Mutations are
 * validated against the section registry, so the API can never store content the renderer cannot
 * display safely.
 *
 * The public render endpoints (`/api/v1/public/sites/*`) are deliberately unauthenticated but only
 * ever serve an immutable published snapshot: no draft, no unpublished site, no archived
 * publication, and no field the visitor was never meant to see.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { authenticate } from '../lib/require-auth';
import { ValidationError, NotFoundError, ForbiddenError } from '../lib/errors';
import { auditRequest } from '../lib/audit';
import {
  archivePage,
  archiveSite,
  createForm,
  createPage,
  createSite,
  getRevision,
  getPublishedSite,
  importTemplateIntoNewPage,
  listForms,
  listMedia,
  listPages,
  listPublications,
  listRevisions,
  listSites,
  listSubmissions,
  publishSite,
  readMedia,
  requireOwnedPage,
  requireOwnedSite,
  restoreRevision,
  submitPublishedForm,
  unpublishSite,
  updateForm,
  updatePage,
  updateSite,
  uploadMedia,
} from '../builders/site-service';
import { listSections } from '../builders/sections';
import { FIRST_PARTY_TEMPLATES } from '../builders/templates';
import { listStoredTemplates } from '../builders/site-service';
import { getSiteLimits } from '../builders/entitlements';
import { listEngines } from '../builders/ai/registry';
import {
  applyPlanToSite,
  createProject,
  generatePlan,
  listGenerations,
  listProjects,
  requireOwnedProject,
} from '../builders/ai/generation-service';
import { AiProviderError, safeAiMessage } from '../builders/ai/types';
import { MAX_MEDIA_BYTES } from '../lib/media-upload';

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join(', '));
  return parsed.data;
}

const idParam = z.object({ id: z.string().uuid('A valid id is required') });

const createSiteSchema = z.object({
  name: z.string().min(2).max(160),
  templateSlug: z.string().min(1).max(80).nullable().optional(),
  theme: z.record(z.unknown()).optional(),
});

const updateSiteSchema = z.object({
  name: z.string().min(2).max(160).optional(),
  theme: z.record(z.unknown()).optional(),
  seo: z.record(z.unknown()).optional(),
  settings: z.record(z.unknown()).optional(),
  domainId: z.string().uuid().nullable().optional(),
});

const createPageSchema = z.object({
  title: z.string().min(1).max(200),
  path: z.string().max(200).optional(),
  content: z.array(z.unknown()).optional(),
  seo: z.record(z.unknown()).optional(),
  isHome: z.boolean().optional(),
});

const updatePageSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  path: z.string().max(200).optional(),
  content: z.array(z.unknown()).optional(),
  seo: z.record(z.unknown()).optional(),
  note: z.string().max(200).nullable().optional(),
});

const uploadMediaSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(3).max(64),
  // Base64 payload; the decoded size cap is enforced server-side (never the string length).
  base64: z.string().min(1).max(Math.ceil((MAX_MEDIA_BYTES * 4) / 3) + 2048),
  altText: z.string().max(255).nullable().optional(),
});

const formSchema = z.object({
  name: z.string().min(1).max(160),
  fields: z.array(z.unknown()),
  notifyEmail: z.string().email().max(255).nullable().optional(),
  successMessage: z.string().max(500).optional(),
});

const updateFormSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  fields: z.array(z.unknown()).optional(),
  notifyEmail: z.string().email().max(255).nullable().optional(),
  successMessage: z.string().max(500).optional(),
  status: z.enum(['active', 'archived']).optional(),
});

const briefSchema = z.object({
  brief: z.record(z.unknown()),
  siteId: z.string().uuid().nullable().optional(),
  name: z.string().max(200).optional(),
});

export async function registerBuilderRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  /* ----------------------------------------------------------------------------------------
   * Catalogue: sections, templates, engines, limits (authenticated but read-only)
   * -------------------------------------------------------------------------------------- */

  app.get('/api/v1/builder/sections', async () => ({
    sections: listSections().map((definition) => ({
      type: definition.type,
      label: definition.label,
      description: definition.description,
      group: definition.group,
      fields: definition.fields,
    })),
  }));

  app.get('/api/v1/builder/templates', async () => {
    const stored = await listStoredTemplates(pool).catch(() => []);
    return {
      templates: [
        ...FIRST_PARTY_TEMPLATES.map((template) => ({
          slug: template.slug,
          name: template.name,
          category: template.category,
          description: template.description,
          palette: template.palette,
          source: 'first_party' as const,
        })),
        ...stored.map((template) => ({
          slug: template.slug,
          name: template.name,
          category: template.category,
          description: template.description,
          palette: template.palette,
          source: 'custom' as const,
        })),
      ],
    };
  });

  app.get('/api/v1/builder/limits', async (request) => {
    const auth = await authenticate(request, env, pool);
    const limits = await getSiteLimits(pool, auth.userId);
    const sites = await listSites(pool, auth.userId);
    return {
      limits,
      usage: {
        sites: sites.length,
        pages: 0,
      },
    };
  });

  /* ----------------------------------------------------------------------------------------
   * Sites
   * -------------------------------------------------------------------------------------- */

  app.get('/api/v1/builder/sites', async (request) => {
    const auth = await authenticate(request, env, pool);
    return { sites: await listSites(pool, auth.userId) };
  });

  app.post('/api/v1/builder/sites', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const input = parseOrThrow(createSiteSchema, request.body);
    const result = await createSite(pool, auth.userId, {
      name: input.name,
      templateSlug: input.templateSlug ?? null,
      theme: input.theme,
    });
    await auditRequest(pool, request, auth.userId, {
      action: 'builder_site_created',
      resourceType: 'builder_site',
      resourceId: result.site.id,
      metadata: { templateSlug: input.templateSlug ?? null },
    });
    reply.code(201);
    return { site: result.site, homePageId: result.homePageId };
  });

  app.get<{ Params: { id: string } }>('/api/v1/builder/sites/:id', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const site = await requireOwnedSite(pool, auth.userId, id);
    return {
      site,
      pages: await listPages(pool, site.id),
      forms: await listForms(pool, auth.userId, site.id),
      publications: await listPublications(pool, auth.userId, site.id),
    };
  });

  app.patch<{ Params: { id: string } }>('/api/v1/builder/sites/:id', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const patch = parseOrThrow(updateSiteSchema, request.body);
    const site = await updateSite(pool, auth.userId, id, patch);
    return { site };
  });

  app.delete<{ Params: { id: string } }>('/api/v1/builder/sites/:id', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    await archiveSite(pool, auth.userId, id);
    await auditRequest(pool, request, auth.userId, {
      action: 'builder_site_archived',
      resourceType: 'builder_site',
      resourceId: id,
    });
    return { ok: true };
  });

  /* ----------------------------------------------------------------------------------------
   * Pages, revisions, publishing
   * -------------------------------------------------------------------------------------- */

  app.get<{ Params: { id: string } }>('/api/v1/builder/sites/:id/pages', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    await requireOwnedSite(pool, auth.userId, id);
    return { pages: await listPages(pool, id, true) };
  });

  app.post<{ Params: { id: string } }>('/api/v1/builder/sites/:id/pages', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const input = parseOrThrow(createPageSchema, request.body);
    const page = await createPage(pool, auth.userId, id, input);
    reply.code(201);
    return { page };
  });

  app.get<{ Params: { id: string } }>('/api/v1/builder/pages/:id', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const { page } = await requireOwnedPage(pool, auth.userId, id);
    return { page };
  });

  app.patch<{ Params: { id: string } }>('/api/v1/builder/pages/:id', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const patch = parseOrThrow(updatePageSchema, request.body);
    const page = await updatePage(pool, auth.userId, id, patch);
    return { page };
  });

  app.delete<{ Params: { id: string } }>('/api/v1/builder/pages/:id', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    await archivePage(pool, auth.userId, id);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/v1/builder/pages/:id/revisions', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    return { revisions: await listRevisions(pool, auth.userId, id) };
  });

  app.get<{ Params: { id: string; revision: string } }>(
    '/api/v1/builder/pages/:id/revisions/:revision',
    async (request) => {
      const auth = await authenticate(request, env, pool);
      const { id } = parseOrThrow(idParam, request.params);
      const revision = Number(request.params.revision);
      if (!Number.isInteger(revision) || revision < 1) throw new ValidationError('A numeric version is required');
      return { revision: await getRevision(pool, auth.userId, id, revision) };
    }
  );

  app.post<{ Params: { id: string; revision: string } }>(
    '/api/v1/builder/pages/:id/revisions/:revision/restore',
    async (request) => {
      const auth = await authenticate(request, env, pool);
      const { id } = parseOrThrow(idParam, request.params);
      const revision = Number(request.params.revision);
      if (!Number.isInteger(revision) || revision < 1) throw new ValidationError('A numeric version is required');
      const page = await restoreRevision(pool, auth.userId, id, revision);
      return { page };
    }
  );

  app.post<{ Params: { id: string } }>('/api/v1/builder/sites/:id/publish', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const publication = await publishSite(pool, auth.userId, id);
    await auditRequest(pool, request, auth.userId, {
      action: 'builder_site_published',
      resourceType: 'builder_site',
      resourceId: id,
      metadata: { version: publication.version },
    });
    return { publication: { ...publication, snapshot: undefined }, url: `/api/v1/public/sites/${id}` };
  });

  app.post<{ Params: { id: string } }>('/api/v1/builder/sites/:id/unpublish', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    await unpublishSite(pool, auth.userId, id);
    await auditRequest(pool, request, auth.userId, {
      action: 'builder_site_unpublished',
      resourceType: 'builder_site',
      resourceId: id,
    });
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/v1/builder/sites/:id/publications', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    return { publications: await listPublications(pool, auth.userId, id) };
  });

  app.post<{ Params: { id: string } }>('/api/v1/builder/sites/:id/template', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const input = parseOrThrow(
      z.object({ templateSlug: z.string().min(1).max(80), title: z.string().min(1).max(200), path: z.string().max(200).optional() }),
      request.body
    );
    const page = await importTemplateIntoNewPage(pool, auth.userId, id, input.templateSlug, {
      title: input.title,
      path: input.path,
    });
    reply.code(201);
    return { page };
  });

  /* ----------------------------------------------------------------------------------------
   * Media
   * -------------------------------------------------------------------------------------- */

  app.get<{ Params: { id: string } }>('/api/v1/builder/sites/:id/media', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    return { media: await listMedia(pool, auth.userId, id) };
  });

  app.post<{ Params: { id: string } }>('/api/v1/builder/sites/:id/media', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const input = parseOrThrow(uploadMediaSchema, request.body);
    const media = await uploadMedia(pool, auth.userId, id, {
      filename: input.filename,
      contentType: input.contentType,
      base64: input.base64,
      altText: input.altText ?? null,
    });
    reply.code(201);
    return { media };
  });

  /**
   * Serves one media object. Ownership is checked before any bytes are read, and the response
   * carries the stored (whitelisted) content type plus a sniff-resistant disposition, so a stored
   * file can never be interpreted as markup by a browser.
   */
  app.get<{ Params: { id: string; mediaId: string } }>(
    '/api/v1/builder/sites/:id/media/:mediaId',
    async (request, reply) => {
      const auth = await authenticate(request, env, pool);
      const { id } = parseOrThrow(idParam, request.params);
      await requireOwnedSite(pool, auth.userId, id);
      const mediaId = request.params.mediaId;
      if (!mediaId) throw new NotFoundError('No media file was found with that id');
      const media = await readMedia(pool, id, mediaId);
      if (!media) throw new NotFoundError('No media file was found with that id');
      reply
        .header('Content-Type', media.content_type)
        .header('Content-Disposition', `inline; filename="${media.filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`)
        .header('X-Content-Type-Options', 'nosniff')
        .header('Cache-Control', 'private, max-age=300');
      return reply.send(Buffer.from(media.data));
    }
  );

  app.delete<{ Params: { id: string; mediaId: string } }>(
    '/api/v1/builder/sites/:id/media/:mediaId',
    async (request) => {
      const auth = await authenticate(request, env, pool);
      const { id } = parseOrThrow(idParam, request.params);
      await requireOwnedSite(pool, auth.userId, id);
      await (await import('../builders/site-service')).deleteMedia(pool, auth.userId, request.params.mediaId);
      return { ok: true };
    }
  );

  /* ----------------------------------------------------------------------------------------
   * Forms
   * -------------------------------------------------------------------------------------- */

  app.get<{ Params: { id: string } }>('/api/v1/builder/sites/:id/forms', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    return { forms: await listForms(pool, auth.userId, id) };
  });

  app.post<{ Params: { id: string } }>('/api/v1/builder/sites/:id/forms', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const input = parseOrThrow(formSchema, request.body);
    const form = await createForm(pool, auth.userId, id, input);
    reply.code(201);
    return { form };
  });

  app.patch<{ Params: { id: string } }>('/api/v1/builder/forms/:id', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const input = parseOrThrow(updateFormSchema, request.body);
    return { form: await updateForm(pool, auth.userId, id, input) };
  });

  app.get<{ Params: { id: string } }>('/api/v1/builder/forms/:id/submissions', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    return { submissions: await listSubmissions(pool, auth.userId, id) };
  });

  /* ----------------------------------------------------------------------------------------
   * AI Website Builder
   * -------------------------------------------------------------------------------------- */

  app.get('/api/v1/ai-builder/engines', async (request) => {
    await authenticate(request, env, pool);
    return { engines: listEngines(env) };
  });

  app.get('/api/v1/ai-builder/projects', async (request) => {
    const auth = await authenticate(request, env, pool);
    return { projects: await listProjects(pool, auth.userId) };
  });

  app.post('/api/v1/ai-builder/projects', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const input = parseOrThrow(briefSchema, request.body);
    const project = await createProject(pool, auth.userId, {
      brief: input.brief,
      siteId: input.siteId ?? null,
      name: input.name,
    });
    reply.code(201);
    return { project };
  });

  app.get<{ Params: { id: string } }>('/api/v1/ai-builder/projects/:id', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const project = await requireOwnedProject(pool, auth.userId, id);
    return { project, generations: await listGenerations(pool, auth.userId, project.id) };
  });

  app.post<{ Params: { id: string } }>('/api/v1/ai-builder/projects/:id/generate', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const input = parseOrThrow(z.object({ engine: z.enum(['rules', 'llm', 'anthropic']).default('rules') }), request.body ?? {});
    try {
      const result = await generatePlan(pool, env, auth.userId, id, input.engine ?? 'rules');
      return { generation: result };
    } catch (error) {
      if (error instanceof AiProviderError) {
        // Configuration problems are a 503 with the honest reason — never a silent substitution of
        // the built-in generator for the model the customer asked for.
        throw new ForbiddenError(safeAiMessage(error));
      }
      throw error;
    }
  });

  app.get('/api/v1/ai-builder/generations', async (request) => {
    const auth = await authenticate(request, env, pool);
    return { generations: await listGenerations(pool, auth.userId) };
  });

  app.post<{ Params: { id: string } }>('/api/v1/ai-builder/generations/:id/apply', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const input = parseOrThrow(z.object({ siteId: z.string().uuid() }), request.body);
    const result = await applyPlanToSite(pool, auth.userId, id, input.siteId);
    await auditRequest(pool, request, auth.userId, {
      action: 'ai_generation_applied',
      resourceType: 'builder_site',
      resourceId: result.siteId,
      metadata: { generationId: id, pagesCreated: result.pagesCreated },
    });
    return { result };
  });

  /* ----------------------------------------------------------------------------------------
   * Public render (published snapshots only)
   * -------------------------------------------------------------------------------------- */

  app.get<{ Params: { slug: string } }>('/api/v1/public/sites/:slug', async (request, reply) => {
    const host = typeof request.headers['x-site-host'] === 'string' ? request.headers['x-site-host'] : null;
    const published = await getPublishedSite(pool, host ? { host } : { slug: request.params.slug });
    if (!published) throw new NotFoundError('No published CloudHost247 website was found at that address');
    reply.header('Cache-Control', 'public, max-age=60');
    return {
      site: { id: published.site.id, name: published.site.name, slug: published.site.slug },
      publication: { version: published.publication.version, publishedAt: published.publication.created_at },
      snapshot: published.publication.snapshot,
    };
  });


  /**
   * Public form submission. A visitor to a published site can send a form; the submission is
   * validated against the form's own field definitions, stored, and delivered into the Unified
   * Inbox — the same path every other conversation takes. Rate-limited, and only ever accepted for a
   * form that is part of an active publication.
   */
  app.post<{ Params: { slug: string; formId: string } }>(
    '/api/v1/public/sites/:slug/forms/:formId/submissions',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const slug = parseOrThrow(z.string().min(1).max(80), request.params.slug);
      const formId = parseOrThrow(z.string().uuid('That form id is not valid'), request.params.formId);
      const input = parseOrThrow(z.object({ fields: z.record(z.unknown()) }), request.body ?? {});
      const outcome = await submitPublishedForm(pool, slug, formId, input.fields, {
        sourceIp: typeof request.ip === 'string' ? request.ip : null,
        origin: typeof request.headers.origin === 'string' ? request.headers.origin : null,
        source: process.env,
      });
      reply.code(201);
      // The visitor learns their message arrived; delivery metadata stays on the server.
      return { received: true, successMessage: outcome.successMessage };
    }
  );

  app.get<{ Params: { slug: string; path: string } }>('/api/v1/public/sites/:slug/pages/:path', async (request) => {
    const published = await getPublishedSite(pool, { slug: request.params.slug });
    if (!published) throw new NotFoundError('No published CloudHost247 website was found at that address');
    const wanted = `/${String(request.params.path ?? '').replace(/^\/+/, '')}`.replace(/\/$/, '') || '/';
    const page = published.publication.snapshot.pages.find((entry) => entry.path === wanted);
    if (!page) throw new NotFoundError('No such page on this website');
    return {
      site: { name: published.publication.snapshot.name },
      page,
      forms: published.publication.snapshot.forms,
    };
  });
}
