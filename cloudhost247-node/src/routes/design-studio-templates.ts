/**
 * Design Studio — saved templates (`/api/tools/design-studio/templates`, mirrored at `/api/v1/...`).
 *
 * This is the only part of Design Studio that stores anything, and it stores exactly one thing: a
 * document the customer deliberately named and saved. Everything else about the module — barcodes,
 * labels, cards, addresses — is rendered for a single request and forgotten, which is why the five
 * generation tools are listed in `NON_PERSISTABLE_TOOL_SLUGS`.
 *
 * The distinction matters in the routes below:
 *
 *   • **Nothing here accepts a payload.** A route takes a *document* (element positions, sizes,
 *     bindings) and metadata, never the values that go in it. A saved template therefore cannot
 *     become a back door that stores the addresses and contact details the generation endpoints
 *     refuse to keep.
 *   • **Every read and write is owner-scoped.** `userId` comes from the authenticated request, never
 *     from the body, so an id from another account resolves to NOT_FOUND rather than to that
 *     account's document.
 *   • **Anonymous callers are refused, not silently given an empty list.** Saving needs an account
 *     because there is nowhere else to put the row; listing without one would render "you have no
 *     saved templates", which is a different (and misleading) statement.
 */
import type { FastifyInstance } from 'fastify';
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import { getPool } from '../db/pool';
import { ValidationError } from '../lib/errors';
import { authenticate } from '../lib/require-auth';
import { auditRequest } from '../lib/audit';
import {
  TEMPLATE_KINDS,
  createTemplate,
  deleteTemplate,
  duplicateTemplate,
  getTemplate,
  listTemplates,
  publicTemplate,
  updateTemplate,
  type TemplateKind,
} from '../tools/design-studio/templates/repository';

function templateKind(value: unknown): TemplateKind | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  if (!TEMPLATE_KINDS.includes(value as TemplateKind)) {
    throw new ValidationError(`Template kind must be one of ${TEMPLATE_KINDS.join(', ')}.`);
  }
  return value as TemplateKind;
}

/**
 * Register the saved-template routes.
 *
 * `prefix` is applied twice (`/api` and `/api/v1`) exactly like the rest of the Tools Center surface,
 * so a client that pins the versioned alias keeps working.
 */
export async function registerDesignStudioTemplateRoutes(app: FastifyInstance, env: Env, pool: Queryable | null): Promise<void> {
  const register = (prefix: string) => {
    const base = `${prefix}/tools/design-studio/templates`;

    app.get(base, async (request) => {
      const db = pool ?? getPool(env);
      const auth = await authenticate(request, env, db);
      const query = request.query as Record<string, unknown> | undefined;
      const kind = templateKind(query?.kind);
      const templates = await listTemplates(db, auth.userId, kind);
      return { success: true, templates, count: templates.length };
    });

    app.post(base, async (request) => {
      const db = pool ?? getPool(env);
      const auth = await authenticate(request, env, db);
      const body = (request.body ?? {}) as Record<string, unknown>;
      const template = await createTemplate(db, auth.userId, {
        kind: body.kind,
        name: body.name,
        summary: body.summary,
        document: body.document,
        sourceTemplate: body.sourceTemplate,
      });
      await auditRequest(db, request, auth.userId, {
        action: 'DESIGN_STUDIO_TEMPLATE_SAVED',
        resourceType: 'design_studio_template',
        resourceId: template.id,
        // The name and the kind, never the document: the document is the customer's layout, and an
        // audit log that quotes it in full is a second copy of the data with different retention.
        metadata: { kind: template.kind, name: template.name, sourceTemplate: template.sourceTemplate },
      });
      return { success: true, template: publicTemplate(template) };
    });

    app.get(`${base}/:id`, async (request) => {
      const db = pool ?? getPool(env);
      const auth = await authenticate(request, env, db);
      const id = (request.params as { id?: string }).id ?? '';
      const template = await getTemplate(db, auth.userId, id);
      return { success: true, template: publicTemplate(template) };
    });

    app.put(`${base}/:id`, async (request) => {
      const db = pool ?? getPool(env);
      const auth = await authenticate(request, env, db);
      const id = (request.params as { id?: string }).id ?? '';
      const body = (request.body ?? {}) as Record<string, unknown>;
      const template = await updateTemplate(db, auth.userId, id, {
        name: body.name,
        summary: body.summary,
        document: body.document,
      });
      return { success: true, template: publicTemplate(template) };
    });

    app.post(`${base}/:id/duplicate`, async (request) => {
      const db = pool ?? getPool(env);
      const auth = await authenticate(request, env, db);
      const id = (request.params as { id?: string }).id ?? '';
      const body = (request.body ?? {}) as Record<string, unknown>;
      const name = typeof body.name === 'string' ? body.name : undefined;
      const template = await duplicateTemplate(db, auth.userId, id, name);
      return { success: true, template: publicTemplate(template) };
    });

    app.delete(`${base}/:id`, async (request) => {
      const db = pool ?? getPool(env);
      const auth = await authenticate(request, env, db);
      const id = (request.params as { id?: string }).id ?? '';
      await deleteTemplate(db, auth.userId, id);
      await auditRequest(db, request, auth.userId, {
        action: 'DESIGN_STUDIO_TEMPLATE_DELETED',
        resourceType: 'design_studio_template',
        resourceId: id,
        metadata: {},
      });
      return { success: true, deleted: true };
    });
  };

  register('/api');
  register('/api/v1');
}
