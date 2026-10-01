import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import { getPool } from '../db/pool';
import { requireRole } from '../lib/require-role';
import { ValidationError } from '../lib/errors';

export async function registerAuditRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  const registerHandlers = (prefix: string) => {
    app.get(`${prefix}/audit-logs`, async (request) => {
      await requireRole(request, env, pool, ['admin', 'super_admin']);

      const query = request.query as {
        actorId?: string;
        resourceType?: string;
        resourceId?: string;
        action?: string;
        limit?: string;
        offset?: string;
      };

      const limit = query.limit ? Math.min(parseInt(query.limit, 10), 200) : 50;
      const offset = query.offset ? parseInt(query.offset, 10) : 0;

      const clauses: string[] = [];
      const params: unknown[] = [];

      if (query.actorId) {
        params.push(query.actorId);
        clauses.push(`a.actor_id = $${params.length}`);
      }

      if (query.resourceType) {
        params.push(query.resourceType);
        clauses.push(`a.resource_type = $${params.length}`);
      }

      if (query.resourceId) {
        params.push(query.resourceId);
        clauses.push(`a.resource_id = $${params.length}`);
      }

      if (query.action) {
        params.push(`%${query.action.toUpperCase()}%`);
        clauses.push(`upper(a.action) LIKE $${params.length}`);
      }

      const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
      params.push(limit);
      const limitParam = `$${params.length}`;
      params.push(offset);
      const offsetParam = `$${params.length}`;

      const { rows } = await pool.query(
        `SELECT
           a.id,
           a.actor_id,
           u.email AS actor_email,
           u.full_name AS actor_name,
           a.action,
           a.resource_type,
           a.resource_id,
           a.ip_address,
           a.user_agent,
           a.metadata,
           a.created_at
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.actor_id
         ${where}
         ORDER BY a.created_at DESC
         LIMIT ${limitParam} OFFSET ${offsetParam}`,
        params
      );

      const countResult = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM audit_logs a ${where}`,
        params.slice(0, clauses.length)
      );

      return {
        logs: rows.map((r) => ({
          id: r.id,
          actorId: r.actor_id,
          actorEmail: r.actor_email,
          actorName: r.actor_name,
          action: r.action,
          resourceType: r.resource_type,
          resourceId: r.resource_id,
          ipAddress: r.ip_address,
          userAgent: r.user_agent,
          metadata: r.metadata,
          createdAt: r.created_at,
        })),
        total: parseInt(countResult.rows[0]?.count ?? '0', 10),
        limit,
        offset,
      };
    });
  };

  registerHandlers('/api/v1');
  registerHandlers('/api');
}
