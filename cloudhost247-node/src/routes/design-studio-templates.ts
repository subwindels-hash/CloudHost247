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
  overwriteTemplate,
  overwriteTemplateForced,
  publicTemplate,
  renameTemplate,
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

    /**
     * Overwrite a saved template's document, keeping its id.
     *
     * `expectedRevision` is **required**. An optional version check only protects callers that already
     * opted in, and the last unconditional writer wins — silently discarding whatever a careful client
     * saved. A request without it is a 400 that says where the number comes from, not a best-effort
     * write.
     *
     * ### Compatibility path (deprecated)
     *
     * A client that genuinely cannot supply a revision can send `force: true` (or
     * `X-Design-Studio-Allow-Unconditional: true`) and the write proceeds without the check. That path
     * is deliberately loud: a different audit action, `last_forced_at` on the row, and a response that
     * states what it may have destroyed. Sunset **2026-05-09**; see `docs/tools/DESIGN-STUDIO.md`.
     */
    app.put(`${base}/:id`, async (request) => {
      const db = pool ?? getPool(env);
      const auth = await authenticate(request, env, db);
      const id = (request.params as { id?: string }).id ?? '';
      const body = (request.body ?? {}) as Record<string, unknown>;
      const header = request.headers['x-design-studio-allow-unconditional'];
      const forced = body.force === true || header === 'true' || header === '1';
      if (forced && body.expectedRevision !== undefined) {
        // Naming both is a contradiction, not a preference: a caller that knows the revision is telling
        // us it can do the safe thing. Refusing removes the option of "force" quietly winning.
        throw new ValidationError(
          'Send either "expectedRevision" (a version-checked save) or "force": true — not both. If you know the revision, send it.'
        );
      }

      if (forced) {
        const { template, previousRevision } = await overwriteTemplateForced(db, auth.userId, id, {
          document: body.document,
          summary: body.summary,
        });
        await auditRequest(db, request, auth.userId, {
          action: 'DESIGN_STUDIO_TEMPLATE_FORCED',
          resourceType: 'design_studio_template',
          resourceId: template.id,
          // The exception is recorded as an exception: revision numbers, no document.
          metadata: { kind: template.kind, name: template.name, revision: template.revision, previousRevision },
        });
        return {
          success: true,
          template: publicTemplate(template),
          // Said out loud, because the caller chose not to check and cannot see what it replaced.
          warning:
            'This save skipped the version check you did not send, so any edit made since you last read this template has been replaced and cannot be recovered. Send "expectedRevision" to have this refused instead.',
        };
      }

      const { template, previousRevision } = await overwriteTemplate(db, auth.userId, id, {
        document: body.document,
        summary: body.summary,
        expectedRevision: body.expectedRevision,
      });
      await auditRequest(db, request, auth.userId, {
        action: 'DESIGN_STUDIO_TEMPLATE_UPDATED',
        resourceType: 'design_studio_template',
        resourceId: template.id,
        // What changed, by number and name. The document is not quoted, for the same reason the save
        // and delete rows do not quote it.
        metadata: { kind: template.kind, name: template.name, revision: template.revision, previousRevision },
      });
      return { success: true, template: publicTemplate(template) };
    });

    /**
     * Rename a template, or change its description. Never its document.
     *
     * A separate verb because it is a separate intention: renaming is not destructive and needs no
     * confirmation, while overwriting replaces the layout. `PUT` requires a document precisely so a
     * rename cannot be smuggled through a path that overwrites.
     */
    app.patch(`${base}/:id`, async (request) => {
      const db = pool ?? getPool(env);
      const auth = await authenticate(request, env, db);
      const id = (request.params as { id?: string }).id ?? '';
      const body = (request.body ?? {}) as Record<string, unknown>;
      if (body.document !== undefined) {
        throw new ValidationError('Renaming a template cannot change its document. Save the layout with PUT /templates/:id.');
      }
      if (body.name === undefined && body.summary === undefined) {
        throw new ValidationError('Send a new "name" or "summary" to update.');
      }
      const { template, previousName } = await renameTemplate(db, auth.userId, id, {
        name: body.name,
        summary: body.summary,
      });
      await auditRequest(db, request, auth.userId, {
        action: 'DESIGN_STUDIO_TEMPLATE_RENAMED',
        resourceType: 'design_studio_template',
        resourceId: template.id,
        metadata: { kind: template.kind, name: template.name, previousName },
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
