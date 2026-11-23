/**
 * PHP configuration (A08 — A Hosting).
 *
 *   GET    /api/v1/php-config              — list PHP configs (customer: own services; staff: any)
 *   GET    /api/v1/php-config/:id          — get a PHP config
 *   PATCH  /api/v1/php-config/:id          — update PHP version/settings (honest: stores preference only)
 *   DELETE /api/v1/php-config/:id          — delete a PHP config (staff only)
 *
 * Authorization:
 *   - Customers manage PHP configs for their own services.
 *   - Staff / admin / super_admin can manage any PHP config.
 *
 * No PHP-FPM provider or control panel is called — the version is stored
 * as a preference only. Honest about the absence of a PHP runtime provider.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import {
  deletePhpConfig,
  getPhpConfig,
  getPhpConfigByService,
  listPhpConfigs,
  type PhpConfigRow,
  type UpsertPhpConfigInput,
  upsertPhpConfig,
} from '../db/php-config';
import { authenticate } from '../lib/require-auth';
import { NotFoundError, ValidationError } from '../lib/errors';

const STAFF_ROLES = ['staff', 'admin', 'super_admin'] as const;

const phpIdParamSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
});

const phpListQuerySchema = z.object({
  service_id: z.string().uuid().optional(),
  php_version: z.string().optional(),
});

const phpCreateBodySchema = z.object({
  service_id: z.string().uuid('service_id must be a valid UUID'),
  php_version: z.string().min(1, 'php_version is required').optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

const phpPatchBodySchema = z.object({
  php_version: z.string().min(1, 'php_version is required').optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

type PhpConfigDto = {
  id: string;
  service_id: string;
  php_version: string;
  settings: Record<string, unknown>;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
};

function toPhpConfigDto(row: PhpConfigRow): PhpConfigDto {
  return {
    id: row.id,
    service_id: row.service_id,
    php_version: row.php_version,
    settings: row.settings,
    updated_by: row.updated_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function registerPhpConfigRoutes(app: FastifyInstance, env: Env, pool?: Queryable) {
  const db = pool ?? getPool(env);

  // --- List PHP configs -------------------------------------------------------

  app.get<{ Querystring: z.infer<typeof phpListQuerySchema> }>(
    '/api/v1/php-config',
    async (request, reply) => {
      const auth = await authenticate(request, env, db);
      const parsed = phpListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }

      const isStaff = STAFF_ROLES.includes(auth.role as (typeof STAFF_ROLES)[number]);
      const filters: { service_id?: string; php_version?: string } = {};
      if (parsed.data.service_id) filters.service_id = parsed.data.service_id;
      if (parsed.data.php_version) filters.php_version = parsed.data.php_version;

      // Non-staff customers need service ownership verified per result.
      const rows = await listPhpConfigs(db, filters);
      if (!isStaff) {
        // Filter to services owned by the customer — verify via customer_services.
        const owned = new Set<string>();
        const { rows: serviceRows } = await db.query<{ id: string }>(
          `SELECT id FROM customer_services WHERE user_id = $1`,
          [auth.userId],
        );
        for (const s of serviceRows) owned.add(s.id);
        return { php_configs: rows.filter((r) => owned.has(r.service_id)).map(toPhpConfigDto) };
      }

      return { php_configs: rows.map(toPhpConfigDto) };
    },
  );

  // --- Create a PHP config ----------------------------------------------------

  app.post<{ Body: z.infer<typeof phpCreateBodySchema> }>(
    '/api/v1/php-config',
    async (request, reply) => {
      const auth = await authenticate(request, env, db);
      const isStaff = STAFF_ROLES.includes(auth.role as (typeof STAFF_ROLES)[number]);

      const bodyParsed = phpCreateBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        throw new ValidationError(bodyParsed.error.issues.map((i) => i.message).join(', '));
      }

      // Non-staff customers can only create configs for their own services.
      if (!isStaff) {
        const { rows } = await db.query<{ id: string }>(
          `SELECT id FROM customer_services WHERE id = $1 AND user_id = $2`,
          [bodyParsed.data.service_id, auth.userId],
        );
        if (!rows[0]) {
          reply.code(404);
          return { error: 'NOT_FOUND', message: 'Service not found' };
        }
      }

      // Honest: no PHP-FPM provider or control panel is called. The version is
      // stored as a customer preference only; no runtime change is applied.
      const row = await upsertPhpConfig(db, {
        service_id: bodyParsed.data.service_id,
        php_version: bodyParsed.data.php_version,
        settings: bodyParsed.data.settings,
        updated_by: auth.userId,
      });
      reply.code(201);
      return { php_config: toPhpConfigDto(row) };
    },
  );

  // --- Get a PHP config -------------------------------------------------------

  app.get<{ Params: z.infer<typeof phpIdParamSchema> }>(
    '/api/v1/php-config/:id',
    async (request, reply) => {
      const auth = await authenticate(request, env, db);
      const paramsParsed = phpIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        throw new ValidationError(paramsParsed.error.issues.map((i) => i.message).join(', '));
      }

      const isStaff = STAFF_ROLES.includes(auth.role as (typeof STAFF_ROLES)[number]);
      const row = await getPhpConfig(db, paramsParsed.data.id);
      if (!row) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'PHP config not found' };
      }
      if (!isStaff) {
        const { rows } = await db.query<{ id: string }>(
          `SELECT id FROM customer_services WHERE id = $1 AND user_id = $2`,
          [row.service_id, auth.userId],
        );
        if (!rows[0]) {
          reply.code(404);
          return { error: 'NOT_FOUND', message: 'PHP config not found' };
        }
      }
      return { php_config: toPhpConfigDto(row) };
    },
  );

  // --- Upsert a PHP config ----------------------------------------------------

  app.patch<{ Params: z.infer<typeof phpIdParamSchema>; Body: z.infer<typeof phpPatchBodySchema> }>(
    '/api/v1/php-config/:id',
    async (request, reply) => {
      const auth = await authenticate(request, env, db);
      const paramsParsed = phpIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        throw new ValidationError(paramsParsed.error.issues.map((i) => i.message).join(', '));
      }

      const isStaff = STAFF_ROLES.includes(auth.role as (typeof STAFF_ROLES)[number]);
      const existing = await getPhpConfig(db, paramsParsed.data.id);
      if (!existing) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'PHP config not found' };
      }
      if (!isStaff) {
        const { rows } = await db.query<{ id: string }>(
          `SELECT id FROM customer_services WHERE id = $1 AND user_id = $2`,
          [existing.service_id, auth.userId],
        );
        if (!rows[0]) {
          reply.code(404);
          return { error: 'NOT_FOUND', message: 'PHP config not found' };
        }
      }

      const bodyParsed = phpPatchBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        throw new ValidationError(bodyParsed.error.issues.map((i) => i.message).join(', '));
      }

      // Honest: no PHP-FPM provider or control panel is called. The version is
      // stored as a customer preference only; no runtime change is applied.
      const row = await upsertPhpConfig(db, {
        service_id: existing.service_id,
        php_version: bodyParsed.data.php_version,
        settings: bodyParsed.data.settings,
        updated_by: auth.userId,
      });
      return { php_config: toPhpConfigDto(row) };
    },
  );

  // --- Delete a PHP config ----------------------------------------------------

  app.delete<{ Params: z.infer<typeof phpIdParamSchema> }>(
    '/api/v1/php-config/:id',
    async (request, reply) => {
      const auth = await authenticate(request, env, db);
      const isStaff = STAFF_ROLES.includes(auth.role as (typeof STAFF_ROLES)[number]);
      if (!isStaff) {
        reply.code(403);
        return { error: 'FORBIDDEN', message: 'Only staff can delete PHP configs' };
      }

      const paramsParsed = phpIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        throw new ValidationError(paramsParsed.error.issues.map((i) => i.message).join(', '));
      }

      const existing = await getPhpConfig(db, paramsParsed.data.id);
      if (!existing) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'PHP config not found' };
      }

      const row = await deletePhpConfig(db, paramsParsed.data.id);
      return { php_config: toPhpConfigDto(row!) };
    },
  );
}
