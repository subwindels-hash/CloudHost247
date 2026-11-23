/**
 * Abuse reporting (F13).
 *
 *   POST   /api/v1/abuse/reports                      — public, rate-limited intake
 *   GET    /api/v1/abuse/reports                      — staff list (+ optional status/category filter)
 *   GET    /api/v1/abuse/reports/:id                  — staff single report
 *   PATCH  /api/v1/abuse/reports/:id                  — staff status/priority/notes update
 *
 * Authorization model:
 *   - Submission is public: anyone can report abuse without an account. Rate-limited
 *     (5 per 15 minutes per IP) because it is an unauthenticated write.
 *   - Listing, viewing and updating require staff / admin / super_admin, re-verified
 *     against the database on every request.
 *
 * Nothing is auto-delivered to any abuse@ mailbox or external party. A report is stored
 * for staff review; the response confirms receipt only. This is honest about the absence
 * of configured abuse-handling providers rather than promising a response path that does
 * not exist. No billing, no gateway, no real transaction.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import {
  createAbuseReport,
  findAbuseReportById,
  listAbuseReports,
  countAbuseReports,
  type AbuseReportCategory,
  type AbuseReportStatus,
  updateAbuseReport,
} from '../db/abuse-reports';
import { requireRole } from '../lib/require-role';
import { NotFoundError, ValidationError } from '../lib/errors';

const STAFF_ROLES = ['staff', 'admin', 'super_admin'] as const;

const createAbuseReportBodySchema = z.object({
  reporter_name: z.string().trim().min(1).max(255).optional().nullable(),
  reporter_email: z.string().trim().email().max(255).optional().nullable(),
  category: z.enum(['spam', 'phishing', 'copyright', 'illegal_content', 'security', 'other']),
  subject: z.string().trim().min(1).max(255),
  body: z.string().trim().min(1).max(10000),
  target: z.string().trim().min(1).max(255).optional().nullable(),
  priority: z.enum(['low', 'normal', 'high', 'critical']).optional(),
});

const listAbuseReportsQuerySchema = z.object({
  status: z.enum(['received', 'under_review', 'actioned', 'closed']).optional(),
  category: z.enum(['spam', 'phishing', 'copyright', 'illegal_content', 'security', 'other']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const updateAbuseReportBodySchema = z.object({
  status: z.enum(['received', 'under_review', 'actioned', 'closed']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'critical']).optional(),
  staff_notes: z.string().trim().max(10000).optional().nullable(),
});

const abuseReportParamSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
});

function abuseReportDto(row: {
  id: string;
  reporter_name: string | null;
  reporter_email: string | null;
  category: AbuseReportCategory;
  subject: string;
  body: string;
  target: string | null;
  status: AbuseReportStatus;
  priority: string;
  staff_notes: string | null;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    id: row.id,
    reporter_name: row.reporter_name,
    reporter_email: row.reporter_email,
    category: row.category,
    subject: row.subject,
    body: row.body,
    target: row.target,
    status: row.status,
    priority: row.priority,
    staff_notes: row.staff_notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function registerAbuseReportRoutes(app: FastifyInstance, env: Env, pool?: Queryable) {
  const db = pool ?? getPool(env);

  // --- Public submission ------------------------------------------------------

  app.post<{ Body: z.infer<typeof createAbuseReportBodySchema> }>(
    '/api/v1/abuse/reports',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const parsed = createAbuseReportBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }
      const report = await createAbuseReport(db, {
        reporter_name: parsed.data.reporter_name ?? null,
        reporter_email: parsed.data.reporter_email ?? null,
        category: parsed.data.category,
        subject: parsed.data.subject,
        body: parsed.data.body,
        target: parsed.data.target ?? null,
        priority: parsed.data.priority,
      });
      reply.code(201);
      return {
        received: true,
        abuse_report: abuseReportDto(report),
        // Honest about what happens next: the report is queued for staff review.
        // No delivery to an external abuse@ address is promised or implied.
        notice: 'Your report has been received and is queued for staff review.',
      };
    }
  );

  // --- Staff review surface ---------------------------------------------------

  app.get<{ Querystring: z.infer<typeof listAbuseReportsQuerySchema> }>(
    '/api/v1/abuse/reports',
    async (request, reply) => {
      await requireRole(request, env, db, STAFF_ROLES);
      const parsed = listAbuseReportsQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }
      const reports = await listAbuseReports(db, {
        status: parsed.data.status,
        category: parsed.data.category,
        limit: parsed.data.limit,
        offset: parsed.data.offset,
      });
      const total = await countAbuseReports(db, {
        status: parsed.data.status,
        category: parsed.data.category,
      });
      return {
        abuse_reports: reports.map(abuseReportDto),
        total,
        limit: parsed.data.limit ?? 50,
        offset: parsed.data.offset ?? 0,
      };
    }
  );

  app.get<{ Params: z.infer<typeof abuseReportParamSchema> }>(
    '/api/v1/abuse/reports/:id',
    async (request, reply) => {
      await requireRole(request, env, db, STAFF_ROLES);
      const parsed = abuseReportParamSchema.safeParse(request.params);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }
      const report = await findAbuseReportById(db, parsed.data.id);
      if (!report) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'Abuse report not found' };
      }
      return abuseReportDto(report);
    }
  );

  app.patch<{ Params: z.infer<typeof abuseReportParamSchema> }>(
    '/api/v1/abuse/reports/:id',
    async (request, reply) => {
      await requireRole(request, env, db, STAFF_ROLES);
      const paramsParsed = abuseReportParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        throw new ValidationError(paramsParsed.error.issues.map((i) => i.message).join(', '));
      }
      const bodyParsed = updateAbuseReportBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        throw new ValidationError(bodyParsed.error.issues.map((i) => i.message).join(', '));
      }
      const existing = await findAbuseReportById(db, paramsParsed.data.id);
      if (!existing) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'Abuse report not found' };
      }
      const updated = await updateAbuseReport(db, paramsParsed.data.id, bodyParsed.data);
      if (!updated) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'Abuse report not found' };
      }
      return abuseReportDto(updated);
    }
  );
}
