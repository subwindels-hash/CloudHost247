/**
 * WordPress hosting (A02 — hosting product ecosystem).
 *
 *   POST /api/v1/wordpress/:id/clone     — clone a WordPress installation
 *   POST /api/v1/wordpress/:id/stage     — create a staging environment
 *   POST /api/v1/wordpress/:id/migrate   — migrate to another server
 *
 * Authorization: the authenticated customer must own the installation (404, never 403,
 * for other customers' rows — tenant isolation never confirms another customer's
 * installation exists).
 *
 * These endpoints enqueue deployment jobs. Actual clone/stage/migrate work is performed
 * by a deployment worker; no WP-CLI bridge is configured, so jobs are accepted and queued
 * but not yet executed. Honest about the absence of a WP-CLI bridge rather than fabricating
 * clone/stage/migrate success.
 *
 * No provider credentials are required to define the API surface; activation of actual
 * clone/stage/migrate execution needs a WP-CLI bridge worker and provider sandbox access.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { authenticate } from '../lib/require-auth';
import { ValidationError, NotFoundError } from '../lib/errors';
import { enqueueDeployment, type DeploymentAction } from '../db/deployments';
import { findInstallationById } from '../db/application-installations';

const STAGING_PREFIX = 'staging-';

const wordpressIdParamSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
});

const cloneBodySchema = z.object({
  name: z.string().min(1).max(160).optional(),
  domain: z.string().max(253).nullable().optional(),
});

const stageBodySchema = z.object({
  name: z.string().min(1).max(160).optional(),
});

const migrateBodySchema = z.object({
  server_id: z.string().uuid('server_id must be a valid UUID'),
});

export async function registerWordPressRoutes(app: FastifyInstance, env: Env, pool?: Queryable) {
  const db = pool ?? getPool(env);

  // --- Clone WordPress installation ------------------------------------------

  app.post<{ Params: z.infer<typeof wordpressIdParamSchema>; Body: z.infer<typeof cloneBodySchema> }>(
    '/api/v1/wordpress/:id/clone',
    async (request, reply) => {
      const auth = await authenticate(request, env, db);
      const paramsParsed = wordpressIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        throw new ValidationError(paramsParsed.error.issues.map((i) => i.message).join(', '));
      }
      const bodyParsed = cloneBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        throw new ValidationError(bodyParsed.error.issues.map((i) => i.message).join(', '));
      }

      const installation = await findInstallationById(db, paramsParsed.data.id);
      if (!installation || installation.customer_id !== auth.userId) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'WordPress installation not found' };
      }

      const result = await enqueueDeployment(db, {
        installationId: installation.id,
        serverId: installation.server_id ?? null,
        action: 'clone' as DeploymentAction,
        requestedBy: auth.userId,
        idempotencyKey: `wordpress:clone:${installation.id}`,
        payload: {
          name: bodyParsed.data.name,
          domain: bodyParsed.data.domain,
          note: 'WP-CLI bridge not configured — clone job queued but not yet executed.',
        },
      });

      return {
        deployment: result.deployment,
        created: result.created,
        notice: 'Clone job queued. WP-CLI bridge is not configured, so execution is pending worker activation.',
      };
    }
  );

  // --- Stage WordPress installation ------------------------------------------

  app.post<{ Params: z.infer<typeof wordpressIdParamSchema>; Body: z.infer<typeof stageBodySchema> }>(
    '/api/v1/wordpress/:id/stage',
    async (request, reply) => {
      const auth = await authenticate(request, env, db);
      const paramsParsed = wordpressIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        throw new ValidationError(paramsParsed.error.issues.map((i) => i.message).join(', '));
      }
      const bodyParsed = stageBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        throw new ValidationError(bodyParsed.error.issues.map((i) => i.message).join(', '));
      }

      const installation = await findInstallationById(db, paramsParsed.data.id);
      if (!installation || installation.customer_id !== auth.userId) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'WordPress installation not found' };
      }

      const result = await enqueueDeployment(db, {
        installationId: installation.id,
        serverId: installation.server_id ?? null,
        action: 'stage' as DeploymentAction,
        requestedBy: auth.userId,
        idempotencyKey: `wordpress:stage:${installation.id}`,
        payload: {
          name: bodyParsed.data.name,
          stagingDomain: `${STAGING_PREFIX}${installation.id}`,
          note: 'WP-CLI bridge not configured — stage job queued but not yet executed.',
        },
      });

      return {
        deployment: result.deployment,
        created: result.created,
        notice: 'Stage job queued. WP-CLI bridge is not configured, so execution is pending worker activation.',
      };
    }
  );

  // --- Migrate WordPress installation ----------------------------------------

  app.post<{ Params: z.infer<typeof wordpressIdParamSchema>; Body: z.infer<typeof migrateBodySchema> }>(
    '/api/v1/wordpress/:id/migrate',
    async (request, reply) => {
      const auth = await authenticate(request, env, db);
      const paramsParsed = wordpressIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        throw new ValidationError(paramsParsed.error.issues.map((i) => i.message).join(', '));
      }
      const bodyParsed = migrateBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        throw new ValidationError(bodyParsed.error.issues.map((i) => i.message).join(', '));
      }

      const installation = await findInstallationById(db, paramsParsed.data.id);
      if (!installation || installation.customer_id !== auth.userId) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'WordPress installation not found' };
      }

      const result = await enqueueDeployment(db, {
        installationId: installation.id,
        serverId: bodyParsed.data.server_id,
        action: 'migrate' as DeploymentAction,
        requestedBy: auth.userId,
        idempotencyKey: `wordpress:migrate:${installation.id}`,
        payload: {
          target_server_id: bodyParsed.data.server_id,
          note: 'WP-CLI bridge not configured — migrate job queued but not yet executed.',
        },
      });

      return {
        deployment: result.deployment,
        created: result.created,
        notice: 'Migrate job queued. WP-CLI bridge is not configured, so execution is pending worker activation.',
      };
    }
  );
}