/**
 * Incident notifications (K07).
 *
 *   GET    /api/v1/incidents                       — public list, most recent first
 *   GET    /api/v1/incidents/:id                   — public single incident (id or number)
 *   POST   /api/v1/admin/incidents                 — admin/super_admin: create
 *   PATCH  /api/v1/admin/incidents/:id             — admin/super_admin: transition status
 *
 * Authorization model:
 *   - Reading incidents is public — the status page is a public surface.
 *   - Creating / transitioning is admin or super_admin only, re-verified against
 *     the database on every request (requireRole).
 *   - A `major` or `critical` creation queues an in-app + email notification to
 *     every active customer through the existing notification outbox
 *     (createNotification → notification_outbox → worker sweep). `minor`
 *     incidents are recorded only: no broadcast, no blast.
 *
 * Nothing is auto-detected. `monitored: false` stays permanent on the status
 * page: incidents are declared by an operator, never inferred.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import {
  createIncident,
  findIncidentById,
  findIncidentByNumber,
  listIncidents,
  nextIncidentNumber,
  type IncidentSeverity,
  type IncidentStatus,
  updateIncident,
} from '../db/incidents';
import { listUsers } from '../db/users';
import { createNotification } from '../services/notification-service';
import { requireRole } from '../lib/require-role';
import { NotFoundError, ValidationError } from '../lib/errors';

const INCIDENT_READ_ROLES = ['customer', 'staff', 'admin', 'super_admin'] as const;
const INCIDENT_WRITE_ROLES = ['admin', 'super_admin'] as const;

const incidentParamSchema = z.object({
  id: z.string()
    .min(1)
    .refine(
      (v) => /^[0-9a-fA-F-]{36}$/.test(v) || /^INC-\d{4}-\d{3}$/.test(v),
      'id must be a UUID or an incident number (INC-YYYY-NNN)',
    ),
});

const listIncidentsQuerySchema = z.object({
  status: z.enum(['investigating', 'identified', 'monitoring', 'resolved']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const createIncidentBodySchema = z.object({
  title: z.string().min(1).max(255),
  body: z.string().min(1),
  status: z.enum(['investigating', 'identified', 'monitoring', 'resolved']).optional(),
  severity: z.enum(['minor', 'major', 'critical']).optional(),
  started_at: z.string().datetime().optional(),
});

const updateIncidentBodySchema = z.object({
  title: z.string().min(1).max(255).optional(),
  body: z.string().min(1).optional(),
  status: z.enum(['investigating', 'identified', 'monitoring', 'resolved']).optional(),
  severity: z.enum(['minor', 'major', 'critical']).optional(),
});

function incidentDto(row: {
  id: string;
  incident_number: string;
  title: string;
  body: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  started_at: Date;
  resolved_at: Date | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    id: row.id,
    incident_number: row.incident_number,
    title: row.title,
    body: row.body,
    status: row.status,
    severity: row.severity,
    started_at: row.started_at,
    resolved_at: row.resolved_at,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Severities that trigger a customer broadcast. */
function isBroadcastSeverity(severity: IncidentSeverity): boolean {
  return severity === 'major' || severity === 'critical';
}

/** Queue an in-app + email incident notice to every active customer. */
async function broadcastIncident(db: Queryable, incident: {
  id: string;
  incident_number: string;
  title: string;
  severity: IncidentSeverity;
}) {
  const { users } = await listUsers(db, { status: 'active', limit: 1000, offset: 0 });
  const type = `INCIDENT_${incident.severity.toUpperCase()}`;
  const title = `[${incident.incident_number}] ${incident.title}`;
  const body = `Incident ${incident.incident_number} (${incident.severity}): ${incident.title}\n\nView it on the status page.\n`;
  for (const user of users) {
    await createNotification(db, {
      userId: user.id,
      type,
      title,
      message: body,
      resourceType: 'incident',
      resourceId: incident.id,
    }).catch(() => undefined);
  }
}

export async function registerIncidentRoutes(app: FastifyInstance, env: Env, pool?: Queryable) {
  const db = pool ?? getPool(env);

  // --- Public read surface -------------------------------------------------

  app.get<{ Querystring: z.infer<typeof listIncidentsQuerySchema> }>(
    '/api/v1/incidents',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const parsed = listIncidentsQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }
      const all = await listIncidents(db);
      let filtered = all;
      if (parsed.data.status) {
        filtered = all.filter((i) => i.status === parsed.data.status);
      }
      const limit = parsed.data.limit ?? 50;
      const offset = parsed.data.offset ?? 0;
      const page = filtered.slice(offset, offset + limit);
      return {
        incidents: page.map(incidentDto),
        total: filtered.length,
        limit,
        offset,
      };
    }
  );

  app.get<{ Params: z.infer<typeof incidentParamSchema> }>(
    '/api/v1/incidents/:id',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = incidentParamSchema.safeParse(request.params);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }
      const { id } = parsed.data;
      let incident;
      if (/^INC-\d{4}-\d{3}$/.test(id)) {
        incident = await findIncidentByNumber(db, id);
      } else {
        incident = await findIncidentById(db, id);
      }
      if (!incident) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'Incident not found' };
      }
      return incidentDto(incident);
    }
  );

  // --- Admin write surface -------------------------------------------------

  app.post<{ Body: z.infer<typeof createIncidentBodySchema> }>(
    '/api/v1/admin/incidents',
    async (request, reply) => {
      const actor = await requireRole(request, env, db, INCIDENT_WRITE_ROLES);
      const parsed = createIncidentBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }
      const createdBy = actor.userId;
      const started_at = parsed.data.started_at ? new Date(parsed.data.started_at) : undefined;
      const incident = await createIncident(db, {
        title: parsed.data.title,
        body: parsed.data.body,
        status: parsed.data.status,
        severity: parsed.data.severity,
        started_at,
        created_by: createdBy,
      });

      if (isBroadcastSeverity(incident.severity)) {
        await broadcastIncident(db, incident);
      }

      reply.code(201);
      return incidentDto(incident);
    }
  );

  app.patch<{ Params: z.infer<typeof incidentParamSchema>; Body: z.infer<typeof updateIncidentBodySchema> }>(
    '/api/v1/admin/incidents/:id',
    async (request, reply) => {
      await requireRole(request, env, db, INCIDENT_WRITE_ROLES);
      const paramsParsed = incidentParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        throw new ValidationError(paramsParsed.error.issues.map((i) => i.message).join(', '));
      }
      const bodyParsed = updateIncidentBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        throw new ValidationError(bodyParsed.error.issues.map((i) => i.message).join(', '));
      }
      const { id: idOrNumber } = paramsParsed.data;
      const existing = /^INC-\d{4}-\d{3}$/.test(idOrNumber)
        ? await findIncidentByNumber(db, idOrNumber)
        : await findIncidentById(db, idOrNumber);
      if (!existing) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'Incident not found' };
      }
      const updated = await updateIncident(db, existing.id, bodyParsed.data);
      if (!updated) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'Incident not found' };
      }
      return incidentDto(updated);
    }
  );
}
